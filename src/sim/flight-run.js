// The game in the Worker: what the Worker's handler does with the game's own messages. It starts a flight
// (src/sim/game.js), runs it on the Worker's own clock (src/sim/clock.js), takes the controls in and posts
// the state out. New in FSG, milestone 1 (pull request 11); it replaces the clock measurement of pull request 3.
//
// After "init" (FDM's, which loads JSBSim and the aircraft's files):
//   request   { type: "fly", aircraft, crashOverride? }      a new flight, parked on the runway; a flight already
//                                                            going is ended first, so this is also the restart
//   reply     { aircraft, dt, stateNames, inputNames, state }
//   request   { type: "controls", controls }                 any of the seven controls; they hold until changed
//   request   { type: "hold", on }                           on: the flight stands still (the pause screen);
//                                                            off: it carries on from now, and catches nothing up
//   request   { type: "override", on }                       the crash override switch
//   request   { type: "end" }                                ends the flight; replies with what the clock did
//   reply     { steps, seconds, droppedSeconds, fires, states }
//   request   { type: "game-bench", aircraft, steps?, batches? }   times whole batches of game steps of a parked airplane
//   reply     { usPerStep, steps }
//   unasked   { type: "state", n, steps, totalSteps, seconds, state, events, waiting, ended, droppedSeconds }
//             after every firing of the clock that ran a step: n counts these messages from 1, `seconds` is
//             the Worker's clock since its first firing, `state` is the flight's state (game.js, STATE),
//             `events` what the rules reported in those steps, `ended` why the flight is over, or null.
//
// ("pause" and "resume" are FDM's own messages, for its own loop; the game's is "hold".)
import { C172X } from "./aircraft/c172x.js";
import { CLOCK_PERIOD_MS, startClock } from "./clock.js";
import { StepResult } from "./codes.js";
import { DT, Flight } from "./game.js";
import { FixedStepLoop } from "./loop.js";

/** The aircraft the app can fly. (The F-16 is for the tests only: its files are not in the app.) */
export const AIRCRAFT = { c172x: C172X };

/** The Worker's own time and timer. Tests hand in made-up ones. */
const workerEnv = () => ({
  now: () => performance.now() / 1000,
  every: (fn, ms) => setInterval(fn, ms),
  cancel: (handle) => clearInterval(handle),
});

/** Returns the function createHandler() hands the requests it does not know. */
export function flightRun(env = workerEnv(), aircraftByName = AIRCRAFT) {
  let flight = null, loop = null, clock = null, first = null, last = null, states = 0, steps = 0;
  const named = (name) => {
    const aircraft = aircraftByName[name];
    if (!aircraft) throw new Error(`unknown aircraft: ${name}`);
    return aircraft;
  };
  const flying = () => {
    if (!flight) throw new Error("no flight: send fly first");
    return flight;
  };
  const end = () => {
    const did = { steps, seconds: first === null ? 0 : last - first, droppedSeconds: loop ? loop.droppedSeconds : 0, fires: clock ? clock.fires : 0, states };
    if (clock) clock.stop();
    if (flight) flight.dispose();
    flight = loop = clock = first = last = null;
    states = steps = 0;
    return did;
  };

  return (req, held) => {
    switch (req.type) {
      case "fly": {
        end();
        const now = flight = Flight.start(held.module(), named(req.aircraft), { crashOverride: req.crashOverride ?? true });
        // The loop drives the flight as it would drive JSBSim itself. A flight that has ended, or that waits
        // for ground, runs fewer steps than asked: the steps counted are the ones it ran.
        loop = new FixedStepLoop({ dt: DT, step: (n) => { const result = now.step(n); steps += now.stepsRun; return now.ended ? StepResult.TERMINATE : result; } });
        clock = startClock({
          loop, now: env.now, every: env.every, cancel: env.cancel, periodMs: req.periodMs ?? CLOCK_PERIOD_MS,
          onFire: (asked, t) => {
            if (first === null) first = t;   // the loop's clock starts at the first firing
            last = t;
            if (asked === 0) return;
            // A copy: the view points into WebAssembly memory, which never leaves the Worker.
            const state = Float64Array.from(now.state);
            held.post({ type: "state", n: ++states, steps: now.stepsRun, totalSteps: steps, seconds: t - first, state, events: now.rules.takeEvents(),
              waiting: now.waiting, ended: now.ended, droppedSeconds: loop.droppedSeconds }, [state.buffer]);
            if (now.ended) clock.stop();   // the flight is over: nothing more to run until the next "fly"
          },
        });
        return { aircraft: req.aircraft, dt: DT, stateNames: flight.stateNames, inputNames: flight.inputNames, state: Float64Array.from(flight.state) };
      }
      case "controls":
        flying().fly(req.controls);
        return {};
      case "hold":
        flying();
        if (req.on) loop.pause();
        else loop.resume();
        return {};
      case "override":
        flying().rules.crashOverride = Boolean(req.on);
        return {};
      case "end":
        return end();
      case "game-bench": {
        // Whole batches are timed, never single steps: on the phone the clock ticks in whole milliseconds.
        const parked = Flight.start(held.module(), named(req.aircraft));
        try {
          const batch = req.steps ?? 3000, times = [];
          for (let k = 0; k < (req.batches ?? 5); k++) {
            const before = env.now();
            parked.step(batch);
            times.push(env.now() - before);
            if (parked.stepsRun !== batch) throw new Error(`the parked airplane ran ${parked.stepsRun} of ${batch} steps`);
          }
          times.sort((a, b) => a - b);
          return { usPerStep: (times[Math.floor(times.length / 2)] / batch) * 1e6, steps: batch };
        } finally {
          parked.dispose();
        }
      }
      default:
        throw new Error(`unknown request: ${req.type}`);
    }
  };
}
