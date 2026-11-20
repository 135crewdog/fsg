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
/** How long each clock is measured for, seconds. */
export const CLOCK_SECONDS = 10;

/** The gaps between the moments in `times` (milliseconds): the middle one, the one 99 in 100 are no longer than, the longest. */
export function gapsOf(times) {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  if (!gaps.length) return { typical: NaN, most: NaN, worst: NaN };
  return { typical: gaps[Math.floor(gaps.length / 2)], most: gaps[Math.max(0, Math.ceil(0.99 * gaps.length) - 1)], worst: gaps.at(-1) };
}

const AIRBORNE = { type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] };
const clockLines = (name, c) => [
  `${name}: ${c.stepsPerSecond.toFixed(1)} steps/s, ${c.droppedSeconds.toFixed(2)} s dropped`,
  `  gaps between states: ${Math.round(c.gaps.typical)} ms typical, ${Math.round(c.gaps.most)} ms for 99 in 100, ${Math.round(c.gaps.worst)} ms worst`,
];

/**
 * The physics clock, measured both ways with the Cessna in the air, CLOCK_SECONDS each (docs/milestones/1.md,
 * pull request 3). The numbers decide which one the game is built on.
 *  - The Worker's own clock: the Worker's timer drives the steps and posts a state after each batch.
 *  - Page ticks (FDM's way): the page asks for the steps once a frame and gets the state back.
 * A gap is the time from one state reaching the page to the next, by the page's clock.
 */
async function measureClocks(request, states, say) {
  // 1. The Worker's own clock.
  await request(AIRBORNE);
  let arrivals = [];
  states.on = () => arrivals.push(performance.now());
  const ran = await request({ type: 'clock-run', seconds: CLOCK_SECONDS });
  states.on = null;
  await request({ type: 'dispose' });
  const worker = { steps: ran.steps, seconds: ran.seconds, stepsPerSecond: ran.steps / ran.seconds, droppedSeconds: ran.droppedSeconds, states: arrivals.length, gaps: gapsOf(arrivals) };
  for (const line of clockLines("Worker's clock", worker)) say(line);

  // 2. Page ticks: one request a frame, each with the page's time.
  await request(AIRBORNE);
  arrivals = [];
  let first = null, ended = false;
  await new Promise((done) => {
    const end = () => { if (!ended) { ended = true; done(); } };
    const frame = () => {
      if (ended) return;
      const now = performance.now();
      if (first === null) first = now;
      if (now - first >= CLOCK_SECONDS * 1000) { end(); return; }
      request({ type: 'tick', now: now / 1000 }).then((reply) => { if (reply.steps > 0) arrivals.push(performance.now()); }, () => {});
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setTimeout(end, CLOCK_SECONDS * 1000 + 3000);   // a page that is not on screen gets no frames
  });
  const last = performance.now();
  const final = await request({ type: 'tick', now: last / 1000 });
  await request({ type: 'dispose' });
  const seconds = first === null ? 0 : (last - first) / 1000;
  const page = { steps: final.totalSteps, seconds, stepsPerSecond: seconds > 0 ? final.totalSteps / seconds : 0, droppedSeconds: final.droppedSeconds, states: arrivals.length, gaps: gapsOf(arrivals) };
  for (const line of clockLines('page ticks', page)) say(line);
  return { worker, page };
}

// Set while the fast build is starting. If the app dies there (Safari 26.0
// and 26.1 did, WebKit bug 299629), the marker is still set at the next
// launch, which then goes straight to the fallback build.
const STARTING_KEY = 'fsg.fdmStarting';
const marker = {
  get() { try { return localStorage.getItem(STARTING_KEY); } catch { return null; } },
  set(on) { try { if (on) localStorage.setItem(STARTING_KEY, 'weh'); else localStorage.removeItem(STARTING_KEY); } catch { /* storage may be blocked: no marker */ } },
};

async function fetchBytes(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`cannot fetch ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** One build, in a fresh Worker: start JSBSim, load c172x, time the step, measure the two clocks. The Worker is ended afterwards. */
async function run(build, say) {
  const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const client = new WorkerClient((message, transfer) => worker.postMessage(message, transfer ?? []));
  // A state the Worker posts unasked (the Worker's own clock) is not an answer to a request.
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
    say(`${version}   ${BUILDS[build].name}`);

    const before = performance.now();
    const created = await request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] });
    const loadMs = performance.now() - before;
    await request({ type: 'dispose' });
    say(`c172x loaded in ${Math.round(loadMs)} ms`);

    // FDM's benchmark, unchanged: c172x in the air, the middle one of five timed batches of 3,000 steps.
    // (On iPhone the clock ticks in whole milliseconds, so only whole batches are timed.)
    const { result } = await request({ type: 'bench', options: { dt: DT, forces: 0, fixtureAircraftPath: '' } });
    say(`${result.usPerStep.toFixed(1)} µs per step   (${result.batchSteps} steps at 1/120 s)`);
    const clocks = await measureClocks(request, states, say);
    return { build, version: init.version, loadMs, usPerStep: result.usPerStep, startAltitudeFt: created.curr[0], endAltitudeFt: result.endAltitudeFt, endAirspeedKt: result.endAirspeedKt, clocks };
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
    return run('jseh', say);
  }
  marker.set(true);
  try {
    return await run('weh', say);
  } catch {
    return await run('jseh', say);
  } finally {
    marker.set(false);
  }
}
