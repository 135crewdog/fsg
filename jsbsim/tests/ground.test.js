// From 135crewdog/FDM, tests/ground.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 4: the height-grid ground hook. Thresholds are the ones frozen in REPORT.md part 2.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { Counter } from "../../src/sim/codes.js";
import { Fdm } from "../../src/sim/core.js";
import { REPO_ROOT, VARIANTS } from "./lib/node.js";
import { bitEqual, classA, classN, compareTraces, describe as describeResult, describeN, table, tableN, touchesGround } from "./lib/compare.js";
import { WGS84_A, WGS84_B, flatGrid, geodeticToEcef, gridFileBytes, radii, slopeGrid } from "./lib/grids.js";
import { Report, loadWithData } from "./lib/harness.js";
import { NATIVE_DIR, STATE_COLUMNS, TMP_DIR, ensembleScenarios, runNative, runWasmCpp, runWasmTs } from "./lib/scenario.js";

const report = new Report("ground");
after(() => report.save());
const RAD = Math.PI / 180;
const NATIVE = join(NATIVE_DIR, "fdm_native");
const NATIVE_ASSERTS = join(REPO_ROOT, "build", "native-asserts", "fdm_native");

// c172x's runway start (aircraft/c172x/reset00.xml): latitude 29.593978 deg is GEOCENTRIC in that file.
// The grid is laid out in geodetic latitude, so convert (exact for a point on the ellipsoid).
const C172_LAT_GEOCENTRIC = 29.593978, C172_LON = -95.163839;
const C172_LAT = Math.atan(Math.tan(C172_LAT_GEOCENTRIC * (Math.PI / 180)) / ((WGS84_B * WGS84_B) / (WGS84_A * WGS84_A))) / (Math.PI / 180);

// --- scenarios ---------------------------------------------------------------------------------------------

const c1723First30s = (ground) => ({
  name: ground ? "c1723-30s-flatgrid" : "c1723-30s-default",
  root: "@data", dt: 0, script: "scripts/c1723.xml", outs: STATE_COLUMNS, outGear: true, duration: 30, ground,
});
const nasa02 = (ground) => ({
  name: ground ? "nasa02-flatgrid" : "nasa02-default",
  root: "@data/check_cases/NASA_EOM_2015", dt: 0, script: "scripts/Atmos_02.xml", outs: STATE_COLUMNS, outGear: true, duration: 30, ground,
});
/** c172x on a 5 degree slope rising to the north, brakes on, 10 s at 1/120 s. Height is 0 under the aircraft. */
const slopeRest = {
  name: "slope-rest", root: "@data", dt: 1 / 120, model: "c172x", ic: "reset00",
  sets: [["fcs/left-brake-cmd-norm", 1], ["fcs/right-brake-cmd-norm", 1]],
  outs: STATE_COLUMNS, outGear: true, steps: 1200, ground: slopeGrid(C172_LAT, C172_LON, "north", 5),
};

describe("ground hook", () => {
  test("native: a constant-height grid equals JSBSim's default ground callback, bit for bit", () => {
    const flatC172 = flatGrid(C172_LAT, C172_LON, 0);
    const flatBrick = flatGrid(0, 0, 0);
    const [d1, g1, d2, g2] = runNative([c1723First30s(), c1723First30s(flatC172), nasa02(), nasa02(flatBrick)]);
    for (const r of [d1, g1, d2, g2]) assert.equal(r.meta.stage, "done", r.meta.message);
    report.line("Flat grid vs upstream default ground callback (native, bit for bit)");
    for (const [name, dflt, grid] of [["c1723 first 30 s (rest and ground roll)", d1, g1], ["NASA 02 (30 s)", d2, g2]]) {
      const eq = bitEqual(dflt.trace, grid.trace);
      report.line(`  ${name}: rows ${dflt.trace.rows}, columns ${dflt.trace.columns.length}: ${eq.equal ? "identical" : `DIFFERENT (${eq.reason})`}`);
      report.line(`    ground-callback calls: default run ${dflt.meta.counters[Counter.GROUND_CALLS]}, grid run ${grid.meta.counters[Counter.GROUND_CALLS]}; ` +
        `SetTerrainElevation calls ignored in the grid run: ${grid.meta.counters[Counter.TERRAIN_ELEV_IGNORED]}`);
      assert.equal(dflt.meta.counters[Counter.GROUND_CALLS], 0);
      assert.ok(grid.meta.counters[Counter.GROUND_CALLS] > 0, "the grid callback was never called");
      assert.ok(eq.equal, eq.reason);
    }
    // The comparison is not empty: the c172x really is on its wheels and then moving.
    const wow = d1.trace.columns.indexOf("gear/unit[0]/WOW"), vt = d1.trace.columns.indexOf("velocities/vtrue-kts");
    const n = d1.trace.columns.length;
    assert.equal(d1.trace.data[wow], 1);
    assert.ok(d1.trace.data[(d1.trace.rows - 1) * n + vt] > 20, "the aircraft did not roll");
    report.line(`  c1723 row 0: nose gear WOW ${d1.trace.data[wow]}; airspeed at 30 s ${d1.trace.data[(d1.trace.rows - 1) * n + vt].toFixed(1)} kt`);
    report.line();
  });

  test("slope grids: height, normal and contact against an independent calculation", () => {
    const dir = join(TMP_DIR, "ground-probe");
    mkdirSync(dir, { recursive: true });
    report.line("Slope grids vs an independent calculation (tests/native/ground_oracle.cpp), 20 points each");
    report.line("  limits: height 1e-6 ft, contact 1e-6 ft per coordinate, normal 1e-6 per component, |normal| - 1 within 1e-12, normal points up");
    for (const rising of ["north", "east"]) {
      const grid = slopeGrid(C172_LAT, C172_LON, rising, 5);
      assert.notEqual(grid.nlat, grid.nlon);
      // 18 points inside the grid, off the cell edges, at mixed heights; 2 outside (the edge value is used).
      const pts = [];
      const geo = [];
      for (let k = 0; k < 20; k++) {
        const fi = k < 18 ? ((k * 7) % (grid.nlat - 1)) + 0.21 + 0.03 * (k % 17) : k === 18 ? -1.4 : grid.nlat + 0.6;
        const fj = k < 18 ? ((k * 5) % (grid.nlon - 1)) + 0.27 + 0.025 * (k % 13) : k === 18 ? 2.3 : grid.nlon + 1.7;
        const lat = grid.lat0 + fi * grid.dlat, lon = grid.lon0 + fj * grid.dlon;
        const alt = [-40, 0.5, 3, 25, 300, 4000][k % 6];
        geo.push([lat, lon, alt]);
        pts.push(...geodeticToEcef(lat, lon, alt));
      }
      writeFileSync(join(dir, `grid-${rising}.bin`), gridFileBytes(grid));
      writeFileSync(join(dir, `points-${rising}.bin`), new Uint8Array(Float64Array.from(pts).buffer));
      for (const [label, binary] of [["release", NATIVE], ["assert-enabled", NATIVE_ASSERTS]]) {
        execFileSync(binary, ["--ground-probe", join(dir, `grid-${rising}.bin`), join(dir, `points-${rising}.bin`), join(dir, `out-${rising}.bin`)]);
        const raw = readFileSync(join(dir, `out-${rising}.bin`));
        const out = new Float64Array(raw.length / 8);
        new Uint8Array(out.buffer).set(raw);
        assert.equal(out.length, 20 * 14);
        let dH = 0, dN = 0, dC = 0, dUnit = 0, minUp = Infinity;
        for (let k = 0; k < 20; k++) {
          const hook = out.subarray(7 * k, 7 * k + 7), oracle = out.subarray(7 * (20 + k), 7 * (20 + k) + 7);
          dH = Math.max(dH, Math.abs(hook[0] - oracle[0]));
          for (let c = 1; c <= 3; c++) dN = Math.max(dN, Math.abs(hook[c] - oracle[c]));
          for (let c = 4; c <= 6; c++) dC = Math.max(dC, Math.abs(hook[c] - oracle[c]));
          dUnit = Math.max(dUnit, Math.abs(Math.hypot(hook[1], hook[2], hook[3]) - 1));
          const [lat, lon] = geo[k];
          const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
          minUp = Math.min(minUp, hook[1] * up[0] + hook[2] * up[1] + hook[3] * up[2]);
        }
        report.line(`  rising ${rising} (${grid.nlat} x ${grid.nlon}), native ${label}: max |d height| ${dH.toExponential(2)} ft, ` +
          `max |d normal| ${dN.toExponential(2)}, max |d contact| ${dC.toExponential(2)} ft, max ||n|-1| ${dUnit.toExponential(2)}, min n.up ${minUp.toFixed(6)}`);
        assert.ok(dH <= 1e-6 && dC <= 1e-6 && dN <= 1e-6 && dUnit <= 1e-12 && minUp > 0);
        if (label === "release") {
          // The tilt of the surface at an inside point is the 5 degrees the grid was built for.
          const hook = out.subarray(0, 7);
          const [lat, lon] = geo[0];
          const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
          const tilt = Math.acos(hook[1] * up[0] + hook[2] * up[1] + hook[3] * up[2]) / RAD;
          report.line(`    tilt of the normal from vertical at point 0: ${tilt.toFixed(4)} deg (grid built for 5)`);
          assert.ok(Math.abs(tilt - 5) < 0.05);
          writeFileSync(join(dir, `native-${rising}.json`), JSON.stringify({ pts, hook: Array.from(out.subarray(0, 140)) }));
        }
      }
    }
    report.line();
  });

  for (const variant of VARIANTS) {
    test(`${variant}: the hook in WebAssembly gives the native values; it is installed after load`, async () => {
      const { module } = await loadWithData(variant);
      const dir = join(TMP_DIR, "ground-probe");
      for (const rising of ["north", "east"]) {
        const { pts, hook } = JSON.parse(readFileSync(join(dir, `native-${rising}.json`), "utf8"));
        const f = Fdm.create(module, { ground: slopeGrid(C172_LAT, C172_LON, rising, 5) });
        let dH = 0, dN = 0, dC = 0;
        for (let k = 0; k < 20; k++) {
          const p = f.groundProbe(pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]);
          const got = [p.height, ...p.normal, ...p.contact];
          dH = Math.max(dH, Math.abs(got[0] - hook[7 * k]));
          for (let c = 1; c <= 3; c++) dN = Math.max(dN, Math.abs(got[c] - hook[7 * k + c]));
          for (let c = 4; c <= 6; c++) dC = Math.max(dC, Math.abs(got[c] - hook[7 * k + c]));
        }
        report.line(`  ${variant}, rising ${rising}: wasm hook vs native hook over 20 points: max |d height| ${dH.toExponential(2)} ft, max |d normal| ${dN.toExponential(2)}, max |d contact| ${dC.toExponential(2)} ft`);
        // Same limits as the hook-vs-oracle line: height and contact 1e-6 ft, normal 1e-6.
        assert.ok(dH <= 1e-6 && dC <= 1e-6 && dN <= 1e-6, "wasm probe differs from native");
        f.dispose();
      }
      // Re-installed after load: the counter moves on the next step.
      const f = Fdm.create(module, { ground: slopeGrid(C172_LAT, C172_LON, "north", 5) });
      f.loadModel("c172x");
      f.loadIC("reset00");
      const afterLoad = f.counter(Counter.GROUND_CALLS);
      f.runIC();
      const afterIC = f.counter(Counter.GROUND_CALLS);
      f.step(1);
      const afterStep = f.counter(Counter.GROUND_CALLS);
      report.line(`  ${variant}: ground-callback calls after load ${afterLoad}, after RunIC ${afterIC}, after one step ${afterStep}`);
      assert.ok(afterStep > afterIC && afterIC > afterLoad);
      // Without a grid the upstream callback stays: our counter does not move.
      const g = Fdm.create(module);
      g.loadModel("c172x");
      g.runIC();
      g.step(1);
      assert.equal(g.counter(Counter.GROUND_CALLS), 0);
      f.dispose();
      g.dispose();
    });
  }

  test("slope-rest run: wasm against native (Class A kept, Class N added), exact checks, assert-enabled native", async () => {
    const [native, nativeAgain] = [runNative([slopeRest])[0], runNative([slopeRest], "native-again")[0]];
    assert.equal(native.meta.stage, "done", native.meta.message);
    report.line("Slope-rest run: c172x on a 5 degree slope rising north, brakes on, 1200 steps at 1/120 s");
    report.line(`  native run twice: ${bitEqual(native.trace, nativeAgain.trace).equal ? "identical" : "DIFFERENT"}`);
    assert.ok(bitEqual(native.trace, nativeAgain.trace).equal);

    const asserts = runNative([slopeRest, c1723First30s(flatGrid(C172_LAT, C172_LON, 0)), nasa02(flatGrid(0, 0, 0))], "native-asserts", NATIVE_ASSERTS);
    for (const r of asserts) assert.equal(r.meta.stage, "done", r.meta.message);
    report.line(`  assert-enabled native build: slope-rest, c1723 30 s on a flat grid and NASA 02 on a flat grid ran with no assertion failure; ` +
      `slope-rest trace ${bitEqual(native.trace, asserts[0].trace).equal ? "identical to" : "different from"} the release native trace`);

    // Class N (added line): the native ensemble, start altitude moved by k * 2^-28 ft.
    const ensemble = runNative(ensembleScenarios(slopeRest), "native-ensemble");
    for (const m of ensemble) assert.equal(m.meta.stage, "done", m.meta.message);
    assert.ok(touchesGround(native.trace, native.trace.rows), "the run does not touch the ground");

    const traces = {};
    const failures = [];
    for (const variant of VARIANTS) {
      const { module } = await loadWithData(variant);
      const cpp = runWasmCpp(module, slopeRest);
      const cppAgain = runWasmCpp(module, slopeRest);
      const ts = runWasmTs(module, slopeRest);
      assert.equal(cpp.meta.stage, "done", cpp.meta.message);
      assert.equal(ts.meta.stage, "done", ts.meta.message);
      traces[variant] = cpp;
      const res = compareTraces(native.trace, cpp.trace, { tolerance: classA });
      report.line(`  ${variant} vs native, frozen Class A (result kept): ${describeResult(res)}`);
      report.line(table(res).split("\n").map((l) => `      ${l}`).join("\n"));
      const resN = classN(native.trace, cpp.trace, ensemble.map((m) => m.trace), { tolerance: classA });
      report.line(`  ${variant} vs native, Class N (added line): ${describeN(resN)}`);
      report.line(tableN(resN).split("\n").map((l) => `      ${l}`).join("\n"));
      const twice = bitEqual(cpp.trace, cppAgain.trace), tsEq = bitEqual(cpp.trace, ts.trace);
      report.line(`  ${variant}: run twice ${twice.equal ? "identical" : `DIFFERENT (${twice.reason})`}; TypeScript-driven vs C++ runner ${tsEq.equal ? "identical" : `DIFFERENT (${tsEq.reason})`}`);
      // The frozen Class A line failed and stays failed; from the added line on, this run is judged on Class N.
      if (!resN.pass) failures.push(`${variant} vs native, Class N: ${describeN(resN)}`);
      if (!twice.equal) failures.push(`${variant} run twice: ${twice.reason}`);
      if (!tsEq.equal) failures.push(`${variant} TypeScript-driven vs C++ runner: ${tsEq.reason}`);
      if (!(cpp.meta.counters[Counter.GROUND_CALLS] > 0)) failures.push(`${variant}: grid callback never called`);
    }
    const eh = bitEqual(traces.weh.trace, traces.jseh.trace);
    report.line(`  -fwasm-exceptions vs -fexceptions: ${eh.equal ? "identical" : `DIFFERENT (${eh.reason})`}`);
    if (!eh.equal) failures.push(`weh vs jseh: ${eh.reason}`);

    // Read back that the run really is on the slope (do not trust the scenario's name): the ground under the
    // aircraft's starting point tilts 5 degrees, and the aircraft starts inside the grid, not on its clamped edge.
    {
      const tr = native.trace, w = tr.columns.length;
      const x = tr.data[tr.columns.indexOf("position/ecef-x-ft")], y = tr.data[tr.columns.indexOf("position/ecef-y-ft")], z = tr.data[tr.columns.indexOf("position/ecef-z-ft")];
      void w;
      const { module } = await loadWithData("weh");
      const probe = Fdm.create(module, { ground: slopeRest.ground });
      const p = probe.groundProbe(x, y, z);
      probe.dispose();
      const r = Math.hypot(x, y, z);
      // Angle between the ground normal and the direction from the Earth's centre (within 0.2 deg of true vertical).
      const tilt = Math.acos((p.normal[0] * x + p.normal[1] * y + p.normal[2] * z) / r) / RAD;
      const g = slopeRest.ground;
      const latGeod = Math.atan2(z, Math.hypot(x, y) * ((WGS84_B * WGS84_B) / (WGS84_A * WGS84_A)));
      const fi = (latGeod - g.lat0) / g.dlat;
      report.line(`  read back at the start point: height above ground ${p.height.toFixed(3)} ft, ground normal ${tilt.toFixed(2)} deg from the geocentric vertical, grid row position ${fi.toFixed(3)} of 0..${g.nlat - 1}`);
      if (!(fi > 0.5 && fi < g.nlat - 1.5)) failures.push(`the aircraft is not inside the slope grid (row position ${fi})`);
      if (!(Math.abs(tilt - 5) < 0.3)) failures.push(`the ground under the aircraft is not a 5 degree slope (tilt ${tilt})`);
    }

    // Information: what the aircraft does on the slope (upstream physics, not a pass/fail line).
    const t = native.trace, n = t.columns.length;
    const col = (name) => t.columns.indexOf(name);
    const at = (row, name) => t.data[row * n + col(name)];
    const wows = t.columns.filter((c) => c.endsWith("/WOW"));
    const last = t.rows - 1;
    const dist = (r0, r1) => Math.hypot(at(r1, "position/ecef-x-ft") - at(r0, "position/ecef-x-ft"), at(r1, "position/ecef-y-ft") - at(r0, "position/ecef-y-ft"), at(r1, "position/ecef-z-ft") - at(r0, "position/ecef-z-ft"));
    report.line("  information (upstream physics):");
    report.line(`    weight on wheels at 10 s: ${wows.map((w) => `${w}=${at(last, w)}`).join(", ")}`);
    report.line(`    pitch at 10 s: ${(at(last, "attitude/theta-rad") / RAD).toFixed(3)} deg; moved ${dist(0, last).toFixed(3)} ft in 10 s, ${dist(600, last).toFixed(4)} ft in the last 5 s; speed at 10 s ${at(last, "velocities/vtrue-kts").toExponential(2)} kt`);
    report.line();
    assert.deepEqual(failures, [], "lines failed (results are kept above)");
  });
});
void WGS84_A; void WGS84_B; void radii;
