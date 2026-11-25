// Starting JSBSim in its Worker, from the page, and timing it.
// After 135crewdog/FDM, web/page.ts, commit e478825: how the Worker is made
// and spoken to, and the marker that falls back to the second build. Changed
// for FSG: the Worker is plain modules (FDM's was one bundled file), the
// data arrives as JSBSim's own files and not a prepared pack, and the marker
// is kept in local storage under an fsg. key, because a home-screen app that
// is closed and reopened starts a new session.
//
// Nothing here runs until start() is called.
import { buildPack } from './sim/files.js';
import { WorkerClient } from './sim/worker-handler.js';
import { C172X_FILES } from './sim/c172x-files.js';

// The two builds of the same JSBSim (CLAUDE.md, "Known facts"). Each .mjs
// fetches the .wasm of the same name from beside itself.
export const BUILDS = {
  weh: { name: 'wasm exceptions', module: '../jsbsim/dist-wasm/fdm-weh.mjs', wasm: '../jsbsim/dist-wasm/fdm-weh.wasm' },
  jseh: { name: 'fallback build', module: '../jsbsim/dist-wasm/fdm-jseh.mjs', wasm: '../jsbsim/dist-wasm/fdm-jseh.wasm' },
};
export const DATA = '../jsbsim/jsbsim-data/';
export const DT = 1 / 120;
/** How long the parked airplane is run for, seconds. */
export const FLY_SECONDS = 10;

/**
 * The game in the Worker (src/sim/flight-run.js): a Cessna parked on the runway of the test field, run on the
 * Worker's own clock for FLY_SECONDS, with the time one game step takes (controls, assists, JSBSim, rules).
 * Steps a second are by the Worker's clock. Every state the Worker posts is counted: one missing or out of
 * order would show.
 */
async function flyOnRunway(request, states, say) {
  const bench = await request({ type: 'game-bench', aircraft: 'c172x' });
  const seen = { states: 0, missing: 0, outOfOrder: 0, last: 0, steps: 0, seconds: 0, state: null, ended: null };
  let over;
  const enough = new Promise((done) => { over = done; });
  states.on = (message) => {
    if (message.n === seen.last + 1) seen.states++;
    else if (message.n > seen.last) { seen.states++; seen.missing += message.n - seen.last - 1; } else seen.outOfOrder++;
    seen.last = Math.max(seen.last, message.n);
    if (message.ended) seen.ended = message.ended;
    if (message.seconds > FLY_SECONDS || message.ended) { over(); return; }
    seen.steps = message.totalSteps;   // the steps run when the Worker's clock last read FLY_SECONDS or less
    seen.seconds = message.seconds;
    seen.state = message.state;
  };
  const started = await request({ type: 'fly', aircraft: 'c172x' });
  // A Worker keeps its clock when the page is not on screen; the timeout is for a Worker that has stopped.
  await Promise.race([enough, new Promise((done) => setTimeout(done, FLY_SECONDS * 1000 + 5000))]);
  states.on = null;
  const ended = await request({ type: 'end' });
  const at = (name) => (seen.state ?? started.state)[started.stateNames.indexOf(name)];
  const wheels = started.stateNames.filter((name) => /^gear\/unit\[\d+\]\/WOW$/.test(name));
  const flight = {
    aircraft: started.aircraft, steps: seen.steps, seconds: seen.seconds, stepsPerSecond: seen.seconds > 0 ? seen.steps / seen.seconds : 0,
    states: seen.states, missing: seen.missing, outOfOrder: seen.outOfOrder, droppedSeconds: ended.droppedSeconds, ended: seen.ended, usPerGameStep: bench.usPerStep,
    // Read back that it is what it says: on its wheels, standing still, at the runway's height.
    wheelsOnGround: wheels.filter((name) => at(name) === 1).length, groundKt: at('velocities/vg-fps') / 1.6878, aboveGroundFt: at('position/h-agl-ft'),
  };
  say(`${flight.aircraft} on the runway   ${flight.stepsPerSecond.toFixed(1)} steps/s   ${flight.usPerGameStep.toFixed(1)} µs per game step`);
  return flight;
}

// Set while the fast build is starting. If the app dies there (Safari 26.0
// and 26.1 did, WebKit bug 299629), the marker is still set at the next
// launch, which then goes straight to the fallback build. It is cleared as
// soon as JSBSim has loaded an aircraft and stepped, not when the run ends:
// an app closed or updated while the game is running has not died starting.
// (Found on the owner's phone at 0.0.5: the marker was held for the whole
// run, he took an update during one, and the next launch used the fallback.)
const STARTING_KEY = 'fsg.fdmStarting';
/** Why a launch is on the fallback build: the two causes there are. The developer overlay shows the one it was. */
export const WHY = {
  marker: 'the launch before this stopped while the fast build was starting',
  failed: 'the fast build did not start',
};
const marker = {
  get() { try { return localStorage.getItem(STARTING_KEY); } catch { return null; } },
  set(on) { try { if (on) localStorage.setItem(STARTING_KEY, 'weh'); else localStorage.removeItem(STARTING_KEY); } catch { /* storage may be blocked: no marker */ } },
};

async function fetchBytes(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`cannot fetch ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * One build, in a fresh Worker: start JSBSim, load c172x, time the step, run the game with a parked airplane.
 * `started` is called once the build has shown it starts. The Worker is ended afterwards.
 * `why` is why this build and not the fast one, for the fallback: the overlay's line says it, so a launch on
 * the slow build explains itself (docs/milestones/1.md: twice the phone opened on it after an update, and
 * nothing on screen said which of the two causes it was).
 */
async function run(build, say, started = () => {}, why = '') {
  const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const client = new WorkerClient((message, transfer) => worker.postMessage(message, transfer ?? []));
  // A state the Worker posts unasked (the game, on the Worker's own clock) is not an answer to a request.
  const states = { on: null };
  worker.onmessage = (event) => { if (event.data?.type === 'state') states.on?.(event.data); else client.receive(event.data); };
  // A Worker that fails (its own file or one of its imports did not load, say) answers nothing from then on.
  // So the failure is kept: it ends the requests already waiting, and every request made after it.
  let dead = null;
  worker.onerror = (event) => {
    dead = new Error(`the Worker failed: ${event.message || 'it did not load'}`);
    client.failAll(dead.message);
  };
  const request = (body, transfer) => (dead ? Promise.reject(dead) : client.request(body, transfer));
  try {
    const files = new Map();
    for (const path of C172X_FILES) files.set(path, await fetchBytes(DATA + path));
    const pack = buildPack(files);
    const init = await request({ type: 'init', moduleUrl: new URL(BUILDS[build].module, import.meta.url).href, packs: [['/data', pack]] }, [pack.buffer]);
    const version = init.version.match(/^JSBSim [\d.]+/)?.[0] ?? init.version;
    say(`${version}   ${BUILDS[build].name}${why ? `: ${why}` : ''}`);

    const before = performance.now();
    const created = await request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] });
    const loadMs = performance.now() - before;
    await request({ type: 'dispose' });
    say(`c172x loaded in ${Math.round(loadMs)} ms`);

    // FDM's benchmark, unchanged: c172x in the air, the middle one of five timed batches of 3,000 steps.
    // (On iPhone the clock ticks in whole milliseconds, so only whole batches are timed.)
    const { result } = await request({ type: 'bench', options: { dt: DT, forces: 0, fixtureAircraftPath: '' } });
    say(`${result.usPerStep.toFixed(1)} µs per step   (${result.batchSteps} steps at 1/120 s)`);
    started();   // this build has loaded an aircraft and run 15,000 steps: it starts
    const flight = await flyOnRunway(request, states, say);
    return { build, why, version: init.version, loadMs, usPerStep: result.usPerStep, startAltitudeFt: created.curr[0], endAltitudeFt: result.endAltitudeFt, endAirspeedKt: result.endAirspeedKt, flight };
  } finally {
    worker.terminate();
  }
}

/**
 * Starts JSBSim with the fast build, or the fallback if the fast one doesn't
 * start. `say` is called with each line for the developer overlay, as it
 * happens. Resolves with the numbers; rejects if neither build starts.
 */
export async function start(say = () => {}) {
  if (marker.get()) {
    marker.set(false);   // one launch on the fallback; the next tries the fast build again
    return run('jseh', say, undefined, WHY.marker);
  }
  marker.set(true);
  try {
    return await run('weh', say, () => marker.set(false));
  } catch (error) {
    return await run('jseh', say, undefined, `${WHY.failed} (${String(error?.message ?? error).slice(0, 80)})`);
  } finally {
    marker.set(false);
  }
}
