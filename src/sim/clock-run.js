// What the Worker's handler does with a "clock-run" request: runs the loaded airplane on the Worker's own
// clock for a number of seconds, posting a state after every batch of steps, and replies with the count.
// New in FSG, milestone 1 (pull request 3). It is how the developer overlay measures the Worker's clock on
// the phone; the game's own messages replace it when the game moves into the Worker (pull request 11).
//
//   request   { type: "clock-run", seconds, periodMs? }      after "create"
//   unasked   { type: "state", steps, simTime, totalSteps, curr }      after each firing that ran a step
//   reply     { steps, seconds, droppedSeconds, fires, states, result }
import { CLOCK_PERIOD_MS, startClock } from "./clock.js";

/** The Worker's own time and timer. Tests hand in made-up ones. */
const workerEnv = () => ({
  now: () => performance.now() / 1000,
  every: (fn, ms) => setInterval(fn, ms),
  cancel: (handle) => clearInterval(handle),
});

/** Returns the function createHandler() hands the requests it does not know. */
export function clockRun(env = workerEnv()) {
  return (req, held) => {
    if (req.type !== "clock-run") throw new Error(`unknown request: ${req.type}`);
    const fdm = held.fdm(), loop = held.loop();
    if (!fdm || !loop) throw new Error("no instance: send create first");
    return new Promise((resolve) => {
      const steps0 = loop.totalSteps, dropped0 = loop.droppedSeconds;
      let first = null, states = 0;
      const clock = startClock({
        loop, now: env.now, every: env.every, cancel: env.cancel, periodMs: req.periodMs ?? CLOCK_PERIOD_MS,
        onFire: (steps, t) => {
          if (first === null) first = t;   // the loop's clock starts at the first firing
          if (steps > 0) {
            states++;
            // A copy: the view points into WebAssembly memory, which never leaves the Worker.
            const curr = Float64Array.from(loop.curr);
            held.post({ type: "state", steps, simTime: fdm.simTime, totalSteps: loop.totalSteps, curr }, [curr.buffer]);
          }
          // 1e-9: ten seconds of 4 ms firings must not need one firing more through rounding.
          if (t - first >= req.seconds - 1e-9 || loop.lastResult !== 0) {
            clock.stop();
            resolve({ steps: loop.totalSteps - steps0, seconds: t - first, droppedSeconds: loop.droppedSeconds - dropped0, fires: clock.fires, states, result: loop.lastResult });
          }
        },
      });
    });
  };
}
