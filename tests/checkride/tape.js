// A recorded flight (Flight.tape(), src/sim/game.js) as a scenario for FDM's harness (jsbsim/tests/lib/):
// the same scenario runs in native JSBSim (the answer key), in the C++ runner inside each WebAssembly build,
// and nudged by one last digit eight times in native, which is how far native differs from itself.
// New in FSG, milestone 1 (docs/milestones/1.md, "The checkride, and matching native").
import { fileURLToPath } from 'node:url';
import { STATE_COLUMNS, ensembleScenarios, runNative, runWasmCpp, runWasmTs } from '../../jsbsim/tests/lib/scenario.js';

/** The columns FDM judges, with the airspeed a pilot reads. Wheel and contact flags are added by the runner. */
export const JUDGED = [...STATE_COLUMNS, 'velocities/vc-kts', 'velocities/v-down-fps'];

/**
 * FSG's own aircraft (milestone 3; an aircraft whose settings say `own: true`) are in the repo's aircraft/
 * folder, not in JSBSim's data. Native JSBSim is told to look there for aircraft, and everywhere else in its
 * own data as before: the scenario's `paths`, which FDM's runner hands to JSBSim's SetAircraftPath. Inside a
 * WebAssembly module nothing changes: the test has put the aircraft's files under /data/aircraft already.
 */
export const OWN_AIRCRAFT = fileURLToPath(new URL('../../aircraft', import.meta.url));

/**
 * The tape as a scenario. `outs` are the columns to record; left out, the flight's own state. `where` is who
 * will fly it: 'native' or 'wasm' (it matters only for FSG's own aircraft, above).
 */
export function scenarioOf(tape, name, outs, where = 'wasm') {
  return {
    name, root: '@data', dt: tape.dt, ground: tape.ground, model: tape.model, sets: tape.sets,
    ...(tape.own && where === 'native' ? { paths: { aircraft: OWN_AIRCRAFT, engine: 'engine', systems: 'systems' } } : null),
    ins: tape.ins, inputs: tape.inputs, steps: tape.steps,
    outs: outs ?? tape.states.columns, outGear: outs !== undefined,
  };
}

/** The tape flown by native JSBSim: once as it is, and eight times nudged by one last digit of its start height. */
export function flyNative(tape, name) {
  const sc = scenarioOf(tape, name, JUDGED, 'native');
  const [native, ...ensemble] = runNative([sc, ...ensembleScenarios(sc)], `tape-${name}`);
  for (const run of [native, ...ensemble]) if (run.meta.stage !== 'done') throw new Error(`native ${name}: ${run.meta.stage}: ${run.meta.message}`);
  return { native: native.trace, ensemble: ensemble.map((run) => run.trace) };
}

/**
 * The tape flown again inside a WebAssembly module (which must hold JSBSim's data at /data): by FDM's C++
 * runner, or with `stepByStep` through the wrapper one step at a time, the way the game runs (FDM's
 * runWasmTs). The C++ runner keeps the whole flight's table inside the module's fixed 16 MiB of memory, so
 * it has room for about two minutes of flight; step by step, the table is kept outside and any length fits.
 */
export function flyWasm(module, tape, name, outs, { stepByStep = false } = {}) {
  const run = (stepByStep ? runWasmTs : runWasmCpp)(module, scenarioOf(tape, name, outs));
  if (run.meta.stage !== 'done') throw new Error(`wasm ${name}: ${run.meta.stage}: ${run.meta.message}`);
  return run.trace;
}

/** The first `steps` steps of a tape, as a tape. */
export function headOf(tape, steps) {
  const width = tape.states.columns.length;
  return { ...tape, steps, inputs: tape.inputs.subarray(0, steps * tape.ins.length), states: { columns: tape.states.columns, rows: steps + 1, data: tape.states.data.subarray(0, (steps + 1) * width) } };
}

// ---- numbers a pilot would read off a flight, from any trace with the JUDGED columns ----
const column = (trace, name) => { const i = trace.columns.indexOf(name); if (i < 0) throw new Error(`no column ${name}`); return i; };
const at = (trace, row, name) => trace.data[row * trace.columns.length + column(trace, name)];
const wheels = (trace) => trace.columns.map((name, i) => (/^gear\/unit\[\d+\]\/WOW$/.test(name) ? i : -1)).filter((i) => i >= 0);
const onWheels = (trace, row, idx) => idx.some((i) => trace.data[row * trace.columns.length + i] !== 0);
const feetBetween = (trace, a, b) => Math.hypot(...['x', 'y', 'z'].map((axis) => at(trace, a, `position/ecef-${axis}-ft`) - at(trace, b, `position/ecef-${axis}-ft`)));

/** Liftoff: the first row from which no wheel touches for a whole second. Returns its speed (kt) and the roll to it (ft). */
export function liftoff(trace, dt) {
  const idx = wheels(trace), second = Math.round(1 / dt);
  let clear = 0, moving = 0;
  for (let row = 0; row < trace.rows; row++) {
    if (!moving && at(trace, row, 'velocities/vc-kts') > 5) moving = row;
    clear = onWheels(trace, row, idx) ? 0 : clear + 1;
    if (clear === second) {
      const off = row - second + 1;
      return { row: off, knots: at(trace, off, 'velocities/vc-kts'), rollFt: feetBetween(trace, 0, off) };
    }
  }
  return null;
}

/**
 * The landing: the first row, at least 10 s after liftoff, where a wheel touches. Returns its speed (kt),
 * the sink in the row before (ft/min), and how far from the start it is (ft). Null if it never comes down.
 */
export function touchdown(trace, dt) {
  const off = liftoff(trace, dt);
  if (!off) return null;
  const idx = wheels(trace);
  for (let row = off.row + Math.round(10 / dt); row < trace.rows; row++) {
    if (onWheels(trace, row, idx)) return { row, knots: at(trace, row - 1, 'velocities/vc-kts'), sinkFpm: at(trace, row - 1, 'velocities/v-down-fps') * 60, fromStartFt: feetBetween(trace, 0, row) };
  }
  return null;
}

/** Where the flight ends: how far from the start (ft), and how fast it is still moving there (kt, true airspeed in still air). */
export function stopped(trace) {
  const last = trace.rows - 1;
  return { fromStartFt: feetBetween(trace, 0, last), knots: at(trace, last, 'velocities/vtrue-kts') };
}

/** The highest the flight went, feet above sea level. */
export function highest(trace) {
  let most = -Infinity;
  for (let row = 0; row < trace.rows; row++) most = Math.max(most, at(trace, row, 'position/h-sl-ft'));
  return most;
}
