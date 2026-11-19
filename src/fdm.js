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

/** One build, in a fresh Worker: start JSBSim, load c172x, time the step. The Worker is ended afterwards. */
async function run(build, say) {
  const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const client = new WorkerClient((message, transfer) => worker.postMessage(message, transfer ?? []));
  worker.onmessage = (event) => client.receive(event.data);
  worker.onerror = (event) => client.failAll(`worker error: ${event.message ?? 'it did not load'}`);
  try {
    const files = new Map();
    for (const path of C172X_FILES) files.set(path, await fetchBytes(DATA + path));
    const pack = buildPack(files);
    const init = await client.request({ type: 'init', moduleUrl: new URL(BUILDS[build].module, import.meta.url).href, packs: [['/data', pack]] }, [pack.buffer]);
    const version = init.version.match(/^JSBSim [\d.]+/)?.[0] ?? init.version;
    say(`${version}   ${BUILDS[build].name}`);

    const before = performance.now();
    const created = await client.request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] });
    const loadMs = performance.now() - before;
    await client.request({ type: 'dispose' });
    say(`c172x loaded in ${Math.round(loadMs)} ms`);

    // FDM's benchmark, unchanged: c172x in the air, the middle one of five timed batches of 3,000 steps.
    // (On iPhone the clock ticks in whole milliseconds, so only whole batches are timed.)
    const { result } = await client.request({ type: 'bench', options: { dt: DT, forces: 0, fixtureAircraftPath: '' } });
    say(`${result.usPerStep.toFixed(1)} µs per step   (${result.batchSteps} steps at 1/120 s)`);
    return { build, version: init.version, loadMs, usPerStep: result.usPerStep, startAltitudeFt: created.curr[0], endAltitudeFt: result.endAltitudeFt, endAirspeedKt: result.endAirspeedKt };
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
