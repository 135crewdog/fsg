// A recorded flight (Flight.tape(), src/sim/game.js) as a scenario for FDM's harness (jsbsim/tests/lib/):
// the same scenario runs in native JSBSim (the answer key), in the C++ runner inside each WebAssembly build,
// and nudged by one last digit eight times in native, which is how far native differs from itself.
// New in FSG, milestone 1 (docs/milestones/1.md, "The checkride, and matching native").
import { STATE_COLUMNS, ensembleScenarios, runNative, runWasmCpp } from '../../jsbsim/tests/lib/scenario.js';

/** The columns FDM judges, with the airspeed a pilot reads. Wheel and contact flags are added by the runner. */
export const JUDGED = [...STATE_COLUMNS, 'velocities/vc-kts'];

/** The tape as a scenario. `outs` are the columns to record; left out, the flight's own state. */
export function scenarioOf(tape, name, outs) {
  return {
    name, root: '@data', dt: tape.dt, ground: tape.ground, model: tape.model, sets: tape.sets,
    ins: tape.ins, inputs: tape.inputs, steps: tape.steps,
    outs: outs ?? tape.states.columns, outGear: outs !== undefined,
  };
}

/** The tape flown by native JSBSim: once as it is, and eight times nudged by one last digit of its start height. */
export function flyNative(tape, name) {
  const sc = scenarioOf(tape, name, JUDGED);
  const [native, ...ensemble] = runNative([sc, ...ensembleScenarios(sc)], `tape-${name}`);
  for (const run of [native, ...ensemble]) if (run.meta.stage !== 'done') throw new Error(`native ${name}: ${run.meta.stage}: ${run.meta.message}`);
  return { native: native.trace, ensemble: ensemble.map((run) => run.trace) };
}

/** The tape flown by the C++ runner inside a WebAssembly module (which must hold JSBSim's data at /data). */
export function flyWasm(module, tape, name, outs) {
  const run = runWasmCpp(module, scenarioOf(tape, name, outs));
  if (run.meta.stage !== 'done') throw new Error(`wasm ${name}: ${run.meta.stage}: ${run.meta.message}`);
  return run.trace;
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
