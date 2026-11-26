// The game's Worker, from the page: starting JSBSim in it, and the messages of a flight.
// After 135crewdog/FDM, web/page.ts, commit e478825: how the Worker is made
// and spoken to, and the marker that falls back to the second build. Changed
// for FSG: the Worker is plain modules (FDM's was one bundled file), the
// data arrives as JSBSim's own files and not a prepared pack, and the marker
// is kept in local storage under an fsg. key, because a home-screen app that
// is closed and reopened starts a new session.
//
// Milestone 2: the Worker is started when the app opens and lives as long as the page does. It holds one
// flight at a time (src/sim/flight-run.js). The timing runs of milestones 0 and 1 are gone from the app:
// their numbers are in docs/milestones/, and the debug overlay now shows the flight's own.
//
// Nothing here runs until startGame() is called.
import { buildPack } from './sim/files.js';
import { WorkerClient } from './sim/worker-handler.js';

// The two builds of the same JSBSim (CLAUDE.md, "Known facts"). Each .mjs
// fetches the .wasm of the same name from beside itself.
export const BUILDS = {
  weh: { name: 'wasm exceptions', module: '../jsbsim/dist-wasm/fdm-weh.mjs', wasm: '../jsbsim/dist-wasm/fdm-weh.wasm' },
  jseh: { name: 'fallback build', module: '../jsbsim/dist-wasm/fdm-jseh.mjs', wasm: '../jsbsim/dist-wasm/fdm-jseh.wasm' },
};
export const DATA = '../jsbsim/jsbsim-data/';
// FSG's own aircraft (milestone 3): an aircraft whose settings say `own: true` has its files in the repo's
// aircraft/ folder, not in JSBSim's data, which is never edited. Its file paths are from the repo's root.
// Either way the Worker gets them under /data, where JSBSim's usual layout finds them.
export const OWN = '../';
/** Where an aircraft's files are fetched from, relative to this folder. */
export const homeOf = (aircraft) => (aircraft.own ? OWN : DATA);
export const DT = 1 / 120;

// Set while the fast build is starting. If the app dies there (Safari 26.0
// and 26.1 did, WebKit bug 299629), the marker is still set at the next
// launch, which then goes straight to the fallback build. It is cleared as
// soon as JSBSim has loaded the aircraft and stepped (the first flight has
// started, parked and held), not later: an app closed or updated while the
// game is running has not died starting.
// (Found on the owner's phone at 0.0.5: the marker was held for a whole
// run, he took an update during one, and the next launch used the fallback.)
const STARTING_KEY = 'fsg.fdmStarting';
/** Why a launch is on the fallback build: the two causes there are. The debug overlay shows the one it was. */
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
 * One build, in a fresh Worker: JSBSim started, the aircraft's files given to it, and its first flight
 * started: parked on the numbers and held, so no time passes until it is let go.
 * `onState(message)` gets every state the Worker posts (src/sim/flight-run.js); `onFailure(error)` is called
 * if the Worker fails after it has started. Rejects if it does not start.
 */
async function open(build, aircraft, why, { onState, onFailure }) {
  const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const client = new WorkerClient((message, transfer) => worker.postMessage(message, transfer ?? []));
  // A state the Worker posts unasked (the game, on the Worker's own clock) is not an answer to a request.
  worker.onmessage = (event) => { if (event.data?.type === 'state') onState?.(event.data); else client.receive(event.data); };
  // A Worker that fails (its own file or one of its imports did not load, say) answers nothing from then on.
  // So the failure is kept: it ends the requests already waiting, and every request made after it.
  let dead = null, started = false;
  worker.onerror = (event) => {
    dead = new Error(`the Worker failed: ${event.message || 'it did not load'}`);
    client.failAll(dead.message);
    worker.terminate();   // it answers nothing from now on: a restart opens a fresh one
    if (started) onFailure?.(dead);
  };
  const request = (body, transfer) => (dead ? Promise.reject(dead) : client.request(body, transfer));
  try {
    const files = new Map();
    for (const path of aircraft.files) files.set(path, await fetchBytes(homeOf(aircraft) + path));
    const pack = buildPack(files);
    const init = await request({ type: 'init', moduleUrl: new URL(BUILDS[build].module, import.meta.url).href, packs: [['/data', pack]] }, [pack.buffer]);
    const fly = (options = {}) => request({ type: 'fly', aircraft: aircraft.model, ...options });
    const first = await fly({ held: true });
    started = true;
    return {
      build, why,
      /** JSBSim's own version text, and the line the debug overlay shows for this build. */
      version: init.version,
      says: `${init.version.match(/^JSBSim [\d.]+/)?.[0] ?? init.version}   ${BUILDS[build].name}${why ? `: ${why}` : ''}`,
      /** The first flight's start: the reply to "fly" (its number, the state's names, its first state). */
      first,
      /** A new flight, parked on the numbers: the restart. `held: true` starts it held. Resolves with its start. */
      fly,
      /** Any of the seven controls; they hold until changed. */
      controls: (controls) => request({ type: 'controls', controls }),
      /** Held, the flight stands still and the Worker rests; let go, it carries on from now. */
      hold: (on) => request({ type: 'hold', on }),
      /** The crash override switch. */
      override: (on) => request({ type: 'override', on }),
      /** The Worker is ended. */
      stop() { worker.terminate(); },
      get failed() { return dead; },
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/**
 * Starts the game: JSBSim in its Worker with the fast build, or the fallback if the fast one doesn't start,
 * and `aircraft` (src/sim/aircraft/) parked on the numbers, held. Resolves with the game (see open());
 * rejects if neither build starts.
 */
export async function startGame(aircraft, handlers = {}) {
  if (marker.get()) {
    marker.set(false);   // one launch on the fallback; the next tries the fast build again
    return open('jseh', aircraft, WHY.marker, handlers);
  }
  marker.set(true);
  try {
    return await open('weh', aircraft, '', handlers);
  } catch (error) {
    return await open('jseh', aircraft, `${WHY.failed} (${String(error?.message ?? error).slice(0, 80)})`, handlers);
  } finally {
    marker.set(false);
  }
}
