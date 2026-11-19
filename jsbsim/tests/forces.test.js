// From 135crewdog/FDM, tests/forces.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 8: external forces set from TypeScript every step, compared with native; cost of the bulk path.
// Lines (REPORT.md part 2): Class A on the whole run, including the external force and moment totals;
// TypeScript-driven = C++ runner, bit for bit. Timings are information only.
import assert from "node:assert/strict";
import { test } from "node:test";

import { NUM_FORCES, benchSteps, forceInputs } from "../../src/sim/bench.js";
import { VARIANTS } from "./lib/node.js";
import { bitEqual, classA, compareTraces, describe as describeResult, table, touchesGround } from "./lib/compare.js";
import { Report, loadWithData } from "./lib/harness.js";
import { STATE_COLUMNS, TURBULENCE_COLUMNS, runNative, runWasmCpp, runWasmTs, turbulenceRows } from "./lib/scenario.js";

const STEPS = 3600; // 30 s at 1/120 s
const EXTERNAL = ["forces/fbx-external-lbs", "forces/fby-external-lbs", "forces/fbz-external-lbs", "moments/l-external-lbsft", "moments/m-external-lbsft", "moments/n-external-lbsft"];
const INS = forceInputs(140); // per force: location x y z (in), direction x y z, magnitude (lb)

/**
 * The schedule: every force changes every step, in magnitude, direction and point of action.
 * Only +, -, * and / with exactly representable results, so the table is the same bits everywhere.
 */
function schedule() {
  const t = new Float64Array(STEPS * INS.length);
  for (let k = 0; k < STEPS; k++) {
    for (let i = 0; i < NUM_FORCES; i++) {
      const o = k * INS.length + i * 7;
      const period = 64 + 8 * i;
      const phase = (k + 5 * i) % period;
      const tri = phase < period / 2 ? phase : period - phase; // 0 .. period/2
      t[o] = 43.25 + ((k + i) % 16) / 8; // location x, in
      t[o + 1] = -190 + 20 * i + ((k + 3 * i) % 8) / 4; // location y, in
      t[o + 2] = 59.5 - ((k + 2 * i) % 4) / 8; // location z, in
      t[o + 3] = (((k + i) % 7) - 3) / 8; // direction x
      t[o + 4] = (((k + 2 * i) % 5) - 2) / 8; // direction y
      t[o + 5] = -1; // direction z (up)
      t[o + 6] = (tri * 16) / 8 - period / 2 / 2 + 4 * (i % 3); // magnitude, lb: a triangle wave, up to about 180 lb per force
    }
  }
  return t;
}

test("external forces: set from TypeScript every step, against native", async () => {
  const report = new Report("forces");
  const inputs = schedule();
  const sc = {
    name: "ext-forces", root: "@data", paths: { aircraft: "@fix/aircraft", engine: "engine", systems: "systems" },
    dt: 1 / 120, model: "c172x_ext20", ic: "reset01", outs: [...STATE_COLUMNS, ...EXTERNAL, ...TURBULENCE_COLUMNS], outGear: true,
    ins: INS, inputs, steps: STEPS,
  };
  const noForces = { ...sc, name: "ext-forces-zero", ins: [], inputs: undefined };
  const failures = [];

  const [native, nativeAgain, nativeZero] = [runNative([sc])[0], runNative([sc], "native-again")[0], runNative([noForces])[0]];
  assert.equal(native.meta.stage, "done", native.meta.message);
  report.line(`External forces: c172x_ext20 (upstream c172x + 20 body-frame forces), airborne start (reset01), ${STEPS} steps at 1/120 s`);
  report.line(`  inputs: ${INS.length} values per step (20 forces x location xyz, direction xyz, magnitude), a different value every step`);
  const n = native.trace.columns.length, col = (name) => native.trace.columns.indexOf(name);
  const at = (r, row, name) => r.trace.data[row * n + r.trace.columns.indexOf(name)];

  // The forces really act, and act as written: after step k the external total is the sum of what was written for step k.
  let worstSum = 0;
  for (let k = 0; k < STEPS; k++) {
    let fx = 0, fy = 0, fz = 0;
    for (let i = 0; i < NUM_FORCES; i++) {
      const o = k * INS.length + i * 7;
      fx += inputs[o + 6] * inputs[o + 3];
      fy += inputs[o + 6] * inputs[o + 4];
      fz += inputs[o + 6] * inputs[o + 5];
    }
    worstSum = Math.max(worstSum, Math.abs(at(native, k + 1, EXTERNAL[0]) - fx), Math.abs(at(native, k + 1, EXTERNAL[1]) - fy), Math.abs(at(native, k + 1, EXTERNAL[2]) - fz));
  }
  let peakF = 0;
  for (let r = 0; r < native.trace.rows; r++) for (const e of EXTERNAL.slice(0, 3)) peakF = Math.max(peakF, Math.abs(at(native, r, e)));
  report.line(`  check that inputs act in the step they are written for: row k+1 external force total minus the sum of the step-k table, largest ${worstSum.toExponential(2)} lb (peak total ${peakF.toFixed(1)} lb)`);
  if (!(worstSum < 1e-9 * Math.max(1, peakF))) failures.push(`external totals do not match the table (${worstSum})`);
  const last = native.trace.rows - 1;
  report.line(`  effect on the flight after 30 s (native, with forces minus without): altitude ${(at(native, last, "position/h-sl-ft") - at(nativeZero, last, "position/h-sl-ft")).toFixed(2)} ft, ` +
    `bank ${((at(native, last, "attitude/phi-rad") - at(nativeZero, last, "attitude/phi-rad")) * 57.29578).toFixed(2)} deg; end state altitude ${at(native, last, "position/h-sl-ft").toFixed(1)} ft, airspeed ${at(native, last, "velocities/vtrue-kts").toFixed(1)} kt`);
  const ground = touchesGround(native.trace, native.trace.rows);
  report.line(`  ground contact during the run: ${ground ? "YES" : "no"}; turbulence rows: ${turbulenceRows(native.trace)}`);
  if (ground) failures.push("the run touched the ground; it was meant to be airborne");
  const twice = bitEqual(native.trace, nativeAgain.trace);
  if (!twice.equal) failures.push(`native run twice differs (${twice.reason})`);

  const cpp = {};
  for (const variant of VARIANTS) {
    const { module } = await loadWithData(variant);
    // "Set from TypeScript every step": the TypeScript-driven run is the one judged against native.
    const ts = runWasmTs(module, sc);
    const tsAgain = runWasmTs(module, sc);
    cpp[variant] = runWasmCpp(module, sc);
    assert.equal(ts.meta.stage, "done", ts.meta.message);
    const res = compareTraces(native.trace, ts.trace, { tolerance: classA });
    report.line(`  ${variant}, forces written from TypeScript, vs native, Class A, whole run: ${describeResult(res)}`);
    report.line(table(res).split("\n").map((l) => `      ${l}`).join("\n"));
    if (!res.pass) failures.push(`${variant} Class A: ${describeResult(res)}`);
    const eqCpp = bitEqual(ts.trace, cpp[variant].trace), eqTwice = bitEqual(ts.trace, tsAgain.trace);
    report.line(`  ${variant}: TypeScript-driven = C++ runner ${eqCpp.equal ? "bit for bit" : `NO (${eqCpp.reason})`}; run twice ${eqTwice.equal ? "identical" : "DIFFERENT"}`);
    if (!eqCpp.equal) failures.push(`${variant}: TypeScript-driven differs from the C++ runner (${eqCpp.reason})`);
    if (!eqTwice.equal) failures.push(`${variant}: run twice differs`);
  }
  const eh = bitEqual(cpp.weh.trace, cpp.jseh.trace);
  report.line(`  -fwasm-exceptions vs -fexceptions: ${eh.equal ? "identical" : `DIFFERENT (${eh.reason})`}; native run twice: ${twice.equal ? "identical" : "DIFFERENT"}`);
  if (!eh.equal) failures.push(`weh vs jseh: ${eh.reason}`);
  void col;

  // Cost (information only): one call into WebAssembly per step, inputs written before each step.
  report.line();
  report.line("Cost in Node on this machine (information only): microseconds per step, median of 5 fresh instances x 3000 steps after 300 warm-up steps,");
  report.line("one call into WebAssembly per step, 16 outputs read back per step; c172x airborne");
  for (const variant of VARIANTS) {
    const { module } = await loadWithData(variant);
    for (const dt of [1 / 120, 1 / 1000]) {
      const cells = [];
      const base = [];
      for (const forces of [0, 20, 140]) {
        const r = benchSteps(module, { dt, forces, fixtureAircraftPath: "/fix/aircraft" });
        base.push(r.usPerStep);
        cells.push(`${forces === 0 ? "no forces (upstream c172x)" : forces === 20 ? "20 forces, 20 values written" : "20 forces, 140 values written"}: ${r.usPerStep.toFixed(2)} (runs ${r.all.map((x) => x.toFixed(1)).join(" ")})`);
      }
      report.line(`  ${variant}, dt 1/${Math.round(1 / dt)}: ${cells.join("; ")}`);
      report.line(`      cost of 20 forces through the bulk path: +${(base[1] - base[0]).toFixed(2)} us/step with 20 values, +${(base[2] - base[0]).toFixed(2)} us/step with 140 values`);
    }
  }
  report.line();
  report.line(failures.length ? `FAILED LINES (${failures.length}):` : "No line failed.");
  for (const f of failures) report.line(`  ${f}`);
  report.save();
  assert.deepEqual(failures, []);
});
