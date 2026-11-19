// From 135crewdog/FDM, tests/parity.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 7: step-by-step parity of WebAssembly against the native answer key.
// Every pass/fail rule here is the one written in REPORT.md part 2 (frozen lines and the added Class N).
//   PARITY_QUICK=1  skips the 63-script sweep.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FdmCrash } from "../../src/sim/core.js";
import { REPO_ROOT, VARIANTS } from "./lib/node.js";
import {
  bitEqual, classA, classB, classN, classS, compareTraces, describe as describeResult, describeN, fmt, table,
  tableN, touchesGround, windowRows, worstColumn, wrapAngle,
} from "./lib/compare.js";
import { RESULTS_DIR, Report, loadWithData } from "./lib/harness.js";
import {
  STATE_COLUMNS, TURBULENCE_COLUMNS, ensembleScenarios, headTrace, runNative, runWasmCpp, runWasmTs, turbulenceRows,
} from "./lib/scenario.js";

const QUICK = !!process.env.PARITY_QUICK;
const COLS = [...STATE_COLUMNS, ...TURBULENCE_COLUMNS];
const INERTIAL_RATES = ["velocities/pi-rad_sec", "velocities/qi-rad_sec", "velocities/ri-rad_sec"];
const DEG = 180 / Math.PI;

// --- running ------------------------------------------------------------------------------------------------

/** Native runs that survive one scenario crashing the process: the batch is retried one by one. */
function runNativeSafe(scenarios, tag) {
  try {
    return runNative(scenarios, tag);
  } catch {
    return scenarios.map((sc) => {
      try {
        return runNative([sc], tag)[0];
      } catch (e) {
        const meta = { loaded: false, icOk: false, stage: "process-crash", message: String(e).slice(0, 300), endCode: -99, stepsDone: 0, rows: 0, dt: 0, columns: [], counters: [] };
        return { meta, trace: { columns: [], rows: 0, data: new Float64Array(0) } };
      }
    });
  }
}

/** WebAssembly runs that survive a trap: the module is replaced and the scenario is recorded as crashed. */
class WasmRunner {
  variant;
  loaded;
  constructor(variant) {
    this.variant = variant;
  }
  async init() {
    this.loaded = await loadWithData(this.variant);
  }
  async run(sc, how = "cpp") {
    try {
      return how === "cpp" ? runWasmCpp(this.loaded.module, sc) : runWasmTs(this.loaded.module, sc);
    } catch (e) {
      if (!(e instanceof FdmCrash)) throw e;
      await this.init();
      const meta = { loaded: false, icOk: false, stage: "trap", message: e.message, endCode: -99, stepsDone: 0, rows: 0, dt: 0, columns: [], counters: [] };
      return { meta, trace: { columns: [], rows: 0, data: new Float64Array(0) } };
    }
  }
}

const outcome = (r) =>
  r.meta.stage === "done"
    ? `ran ${r.meta.stepsDone} steps${r.meta.endCode === 1 ? ", script ended" : r.meta.endCode === 2 ? ", terminate" : ""}`
    : `FAILED at ${r.meta.stage}${r.meta.stage === "step" ? ` ${r.meta.stepsDone}` : ""}`;
const sameOutcome = (a, b) => a.meta.stage === b.meta.stage && a.meta.stepsDone === b.meta.stepsDone && a.meta.endCode === b.meta.endCode;
const indent = (text, by = "      ") => text.split("\n").map((l) => by + l).join("\n");

// --- NASA reference data (information only) ----------------------------------------------------------------

// interface NasaSim { name: string; time: number[]; cols: Record<string, number[]> }
function readNasa(caseNo) {
  const dir = join(REPO_ROOT, "tests", "reference", "nasa");
  return readdirSync(dir).filter((f) => f.startsWith(`Atmos_${caseNo}_sim_`)).sort().map((f) => {
    const lines = readFileSync(join(dir, f), "utf8").trim().split(/\r?\n/);
    const head = lines[0].split(",").map((h) => h.trim());
    const cols = Object.fromEntries(head.map((h) => [h, []]));
    for (const line of lines.slice(1)) line.split(",").forEach((v, i) => cols[head[i]].push(Number(v)));
    return { name: f.replace(".csv", ""), time: cols.time, cols };
  });
}
const NASA_QUANTITIES = [
  ["altitudeMsl_ft", "ft", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("position/h-sl-ft")], false],
  ["eulerAngle_deg_Roll", "deg", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("attitude/phi-rad")] * DEG, true],
  ["eulerAngle_deg_Pitch", "deg", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("attitude/theta-rad")] * DEG, true],
  ["eulerAngle_deg_Yaw", "deg", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("attitude/psi-rad")] * DEG, true],
  ["bodyAngularRateWrtEi_deg_s_Roll", "deg/s", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("velocities/pi-rad_sec")] * DEG, false],
  ["bodyAngularRateWrtEi_deg_s_Pitch", "deg/s", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("velocities/qi-rad_sec")] * DEG, false],
  ["bodyAngularRateWrtEi_deg_s_Yaw", "deg/s", (t, r) => t.data[r * t.columns.length + t.columns.indexOf("velocities/ri-rad_sec")] * DEG, false],
];
const wrapDeg = (d) => wrapAngle(d / DEG) * DEG;

/** Largest difference of our native run from each NASA sim, and NASA's own largest sim-to-sim difference. */
function nasaInfo(report, caseNo, ours) {
  const sims = readNasa(caseNo);
  const n = ours.columns.length, tc = ours.columns.indexOf("simulation/sim-time-sec");
  const rowAt = new Map();
  for (let r = 0; r < ours.rows; r++) rowAt.set(Math.round(ours.data[r * n + tc] * 1e6), r);
  report.line(`    NASA reference data, case ${caseNo} (information only): largest |ours (native, default integrators, dt 0.01) - NASA sim|, and NASA's own largest sim-to-sim difference`);
  for (const [q, unit, get, angle] of NASA_QUANTITIES) {
    const parts = [];
    for (const sim of sims) {
      if (!sim.cols[q]) continue;
      let worst = 0, matched = 0;
      sim.time.forEach((t, i) => {
        const row = rowAt.get(Math.round(t * 1e6));
        if (row === undefined) return;
        matched++;
        let d = get(ours, row) - sim.cols[q][i];
        if (angle) d = wrapDeg(d);
        worst = Math.max(worst, Math.abs(d));
      });
      parts.push(`${sim.name.slice(-6)} ${fmt(worst)} (${matched} pts)`);
    }
    let spread = 0;
    for (let a = 0; a < sims.length; a++) {
      for (let b = a + 1; b < sims.length; b++) {
        if (!sims[a].cols[q] || !sims[b].cols[q]) continue;
        const idx = new Map(sims[b].time.map((t, i) => [Math.round(t * 1e6), i]));
        sims[a].time.forEach((t, i) => {
          const j = idx.get(Math.round(t * 1e6));
          if (j === undefined) return;
          let d = sims[a].cols[q][i] - sims[b].cols[q][j];
          if (angle) d = wrapDeg(d);
          spread = Math.max(spread, Math.abs(d));
        });
      }
    }
    report.line(`      ${q} [${unit}]: ${parts.join("; ")}; NASA sim-to-sim ${fmt(spread)}`);
  }
}

// --- the test -----------------------------------------------------------------------------------------------

test("parity: WebAssembly against native", async () => {
  const report = new Report("parity");
  const detail = new Report("parity-detail");
  const failures = [];
  const runners = { weh: new WasmRunner("weh"), jseh: new WasmRunner("jseh") };
  for (const v of VARIANTS) await runners[v].init();

  /** Runs a scenario on every platform, twice, and applies the exact checks. */
  async function runEverywhere(sc, label) {
    const [native] = runNativeSafe([sc], "native");
    const [nativeAgain] = runNativeSafe([sc], "native-again");
    const wasm = {};
    const notes = [];
    const twiceNative = bitEqual(native.trace, nativeAgain.trace);
    if (!twiceNative.equal) failures.push(`${label}: native run twice differs (${twiceNative.reason})`);
    notes.push(`native twice ${twiceNative.equal ? "identical" : "DIFFERENT"}`);
    for (const v of VARIANTS) {
      wasm[v] = await runners[v].run(sc);
      const again = await runners[v].run(sc);
      const twice = bitEqual(wasm[v].trace, again.trace);
      if (!twice.equal) failures.push(`${label}: ${v} run twice differs (${twice.reason})`);
      notes.push(`${v} twice ${twice.equal ? "identical" : "DIFFERENT"}`);
    }
    const eh = bitEqual(wasm.weh.trace, wasm.jseh.trace);
    if (!eh.equal) failures.push(`${label}: -fwasm-exceptions vs -fexceptions differ (${eh.reason})`);
    notes.push(`weh = jseh ${eh.equal ? "bit for bit" : `NO (${eh.reason})`}`);
    return { native, wasm, exact: notes.join("; ") };
  }

  /** Frozen class on a window or the whole run, with Class N added when the run touches the ground. */
  function judge(label, native, wasm, frozen, frozenName, opt, members) {
    const rows = windowRows(native.trace, opt);
    const ground = touchesGround(native.trace, rows);
    let ensemble;
    for (const v of VARIANTS) {
      const res = compareTraces(native.trace, wasm[v].trace, { tolerance: frozen, ...opt });
      const where = opt.windowSeconds !== undefined ? `first ${opt.windowSeconds} s` : "whole run";
      report.line(`    ${v}, ${where}, frozen ${frozenName}${ground ? " (result kept)" : ""}: ${describeResult(res)}`);
      detail.line(`${label}, ${v}, ${where}, frozen ${frozenName}: ${describeResult(res)}`);
      detail.line(indent(table(res), "  "));
      if (res.refused) {
        failures.push(`${label} ${v} ${frozenName}: ${describeResult(res)}`);
        continue;
      }
      if (!ground) {
        if (!res.pass) failures.push(`${label} ${v} ${frozenName}: ${describeResult(res)}`);
        continue;
      }
      // Ground contact inside the judged rows: the added Class N line decides.
      ensemble ??= members().map((m) => headTrace(m, rows));
      const resN = classN(headTrace(native.trace, rows), headTrace(wasm[v].trace, rows), ensemble, { tolerance: frozen });
      report.line(`    ${v}, ${where}, Class N (added; ground contact): ${describeN(resN)}`);
      detail.line(`${label}, ${v}, ${where}, Class N with frozen ${frozenName}: ${describeN(resN)}`);
      detail.line(indent(tableN(resN), "  "));
      if (!resN.pass) failures.push(`${label} ${v} Class N: ${describeN(resN)}`);
    }
  }

  function turbulenceCheck(label, r, who) {
    const bad = turbulenceRows(r.trace);
    if (bad > 0) failures.push(`${label}: turbulence is not off in ${who} (${bad} rows)`);
  }

  // --- the runs the prompt names -------------------------------------------------------------------------
  report.line("PARITY: WebAssembly against the native answer key");
  report.line(`Columns: the judged list of REPORT.md part 2, alpha/beta (information), turbulence read-back, every gear and contact WOW flag.`);
  report.line();

  // c1723: 200 s at the script's own dt (1/120 s).
  {
    const sc = { name: "c1723", root: "@data", dt: 0, script: "scripts/c1723.xml", outs: COLS, outGear: true, steps: 24100 };
    const { native, wasm, exact } = await runEverywhere(sc, "c1723");
    report.line(`c1723 (c172x take-off with autopilot): native ${outcome(native)}, dt ${native.meta.dt}; weh ${outcome(wasm.weh)}; jseh ${outcome(wasm.jseh)}`);
    report.line(`    exact checks: ${exact}`);
    for (const v of VARIANTS) if (!sameOutcome(native, wasm[v])) failures.push(`c1723: ${v} ended differently from native`);
    turbulenceCheck("c1723", native, "native");
    turbulenceCheck("c1723", wasm.weh, "weh");
    const ensemble = runNativeSafe(ensembleScenarios(sc), "native-ensemble");
    for (const m of ensemble) assert.equal(m.meta.stage, "done", m.meta.message);
    judge("c1723", native, wasm, classA, "Class A", { windowSeconds: 1 }, () => ensemble.map((m) => m.trace));
    for (const v of VARIANTS) {
      const b = classB(native.trace, wasm[v].trace, ensemble.map((m) => m.trace));
      report.line(`    ${v}, whole run (200 s), Class B: ${b.refused ? `REFUSED: ${b.refused}` : b.pass ? "pass" : "FAIL"}`);
      for (const c of b.columns) report.line(`        ${c.column}: |wasm - native| ${fmt(c.maxAbs)} at row ${c.rowOfMax}; cap ${c.cap}, ensemble spread ${fmt(c.spread)}, allowed ${fmt(c.allowed)}: ${c.pass ? "pass" : "FAIL"}`);
      if (!b.pass) failures.push(`c1723 ${v} Class B failed`);
    }
    // TypeScript-driven against the C++ runner, first 10 s.
    const short = { ...sc, name: "c1723-10s", steps: 1200 };
    for (const v of VARIANTS) {
      const eq = bitEqual((await runners[v].run(short, "cpp")).trace, (await runners[v].run(short, "ts")).trace);
      report.line(`    ${v}, first 10 s: TypeScript-driven = C++ runner ${eq.equal ? "bit for bit" : `NO (${eq.reason})`}`);
      if (!eq.equal) failures.push(`c1723 ${v}: TypeScript-driven differs from the C++ runner`);
    }
    report.line();
  }

  // f16_test: judged up to sim time 120 s (it hits the ground inverted at about 128 s).
  {
    const sc = { name: "f16_test", root: "@data", dt: 0, script: "scripts/f16_test.xml", outs: COLS, outGear: true, steps: 14400 };
    const { native, wasm, exact } = await runEverywhere(sc, "f16_test");
    report.line(`f16_test (the f16 script): native ${outcome(native)}, dt ${native.meta.dt}; weh ${outcome(wasm.weh)}; jseh ${outcome(wasm.jseh)}`);
    report.line(`    exact checks: ${exact}`);
    for (const v of VARIANTS) if (!sameOutcome(native, wasm[v])) failures.push(`f16_test: ${v} ended differently from native`);
    turbulenceCheck("f16_test", native, "native");
    turbulenceCheck("f16_test", wasm.weh, "weh");
    const ensemble = runNativeSafe(ensembleScenarios(sc), "native-ensemble");
    for (const m of ensemble) assert.equal(m.meta.stage, "done", m.meta.message);
    judge("f16_test", native, wasm, classA, "Class A", { windowSeconds: 1 }, () => ensemble.map((m) => m.trace));
    for (const v of VARIANTS) {
      const b = classB(native.trace, wasm[v].trace, ensemble.map((m) => m.trace), 120);
      report.line(`    ${v}, sim time up to 120 s (${b.rowsJudged} rows), Class B: ${b.refused ? `REFUSED: ${b.refused}` : b.pass ? "pass" : "FAIL"}`);
      for (const c of b.columns) report.line(`        ${c.column}: |wasm - native| ${fmt(c.maxAbs)} at row ${c.rowOfMax}; cap ${c.cap}, ensemble spread ${fmt(c.spread)}, allowed ${fmt(c.allowed)}: ${c.pass ? "pass" : "FAIL"}`);
      if (!b.pass) failures.push(`f16_test ${v} Class B failed`);
    }
    report.line();
  }

  // NASA check cases: 02 as shipped; 01 and 03 are this project's fixtures.
  for (const [caseNo, root, script, what] of [
    ["02", "@data/check_cases/NASA_EOM_2015", "scripts/Atmos_02.xml", "as shipped by JSBSim"],
    ["01", "@fix/nasa", "scripts/Atmos_01.xml", "project fixture"],
    ["03", "@fix/nasa", "scripts/Atmos_03.xml", "project fixture"],
  ]) {
    const label = `NASA ${caseNo}`;
    const sc = { name: `nasa${caseNo}`, root, dt: 0, script, outs: [...COLS, ...INERTIAL_RATES], outGear: true, steps: 3000 };
    const { native, wasm, exact } = await runEverywhere(sc, label);
    report.line(`${label} (${what}): native ${outcome(native)}, dt ${native.meta.dt}; weh ${outcome(wasm.weh)}; jseh ${outcome(wasm.jseh)}`);
    report.line(`    exact checks: ${exact}`);
    for (const v of VARIANTS) if (!sameOutcome(native, wasm[v])) failures.push(`${label}: ${v} ended differently from native`);
    if (native.meta.stage !== "done") failures.push(`${label}: native did not run: ${native.meta.message}`);
    turbulenceCheck(label, native, "native");
    turbulenceCheck(label, wasm.weh, "weh");
    judge(label, native, wasm, classA, "Class A", {}, () => runNativeSafe(ensembleScenarios(sc), "native-ensemble").map((m) => m.trace));
    if (caseNo === "02") {
      for (const v of VARIANTS) {
        const eq = bitEqual(wasm[v].trace, (await runners[v].run(sc, "ts")).trace);
        report.line(`    ${v}: TypeScript-driven = C++ runner ${eq.equal ? "bit for bit" : `NO (${eq.reason})`}`);
        if (!eq.equal) failures.push(`NASA 02 ${v}: TypeScript-driven differs from the C++ runner`);
      }
    }
    if (native.meta.stage === "done") nasaInfo(report, caseNo, native.trace);
    report.line();
  }

  // --- the sweep: every other upstream script, first 1 s --------------------------------------------------
  if (!QUICK) {
    const scripts = readdirSync(join(REPO_ROOT, "jsbsim-data", "scripts")).filter((f) => f.endsWith(".xml")).sort();
    // The folder holds 63 files: 61 .xml and 2 .kml. Three of the .xml files are helper files, not scripts
    // (kml_output, plotfile, unitconversions); they are run anyway and must fail the same way on both sides.
    assert.equal(scripts.length, 61);
    const others = scripts.filter((f) => f !== "c1723.xml" && f !== "f16_test.xml");
    const INFO_STEPS = 12000; // whole-run information is cut here
    const scenarios = others.map((f) => ({ name: `sweep-${f.replace(".xml", "")}`, root: "@data", dt: 0, script: `scripts/${f}`, outs: COLS, outGear: true, steps: INFO_STEPS }));
    const native = runNativeSafe(scenarios, "native-sweep");
    const nativeAgain = runNativeSafe(scenarios, "native-sweep-again");
    const wasm = {};
    const wasmAgain = {};
    for (const v of VARIANTS) {
      wasm[v] = [];
      wasmAgain[v] = [];
      for (const sc of scenarios) {
        wasm[v].push(await runners[v].run(sc));
        wasmAgain[v].push(await runners[v].run(sc));
      }
    }
    let md = "| Script | Aircraft | dt (s) | Native | Same outcome in wasm | Ground contact in first 1 s | Frozen Class S, first 1 s | Class N (added), first 1 s | Verdict | Exact checks | Whole run (information) |\n|---|---|---|---|---|---|---|---|---|---|---|\n";
    const counts = { pass: 0, passFailureParity: 0, fail: 0, rng: 0, classSFailButN: 0, ground: 0 };
    for (const [i, f] of others.entries()) {
      const sc = scenarios[i], n = native[i];
      const label = `sweep ${f}`;
      const aircraft = /use\s+aircraft="([^"]*)"/.exec(readFileSync(join(REPO_ROOT, "jsbsim-data", "scripts", f), "utf8"))?.[1] ?? "?";
      const same = VARIANTS.every((v) => sameOutcome(n, wasm[v][i]));
      const exactBits = [];
      const twiceN = bitEqual(n.trace, nativeAgain[i].trace);
      if (!twiceN.equal) { failures.push(`${label}: native run twice differs`); exactBits.push("native twice DIFFERENT"); }
      for (const v of VARIANTS) {
        const tw = bitEqual(wasm[v][i].trace, wasmAgain[v][i].trace);
        if (!tw.equal) { failures.push(`${label}: ${v} run twice differs`); exactBits.push(`${v} twice DIFFERENT`); }
      }
      const eh = bitEqual(wasm.weh[i].trace, wasm.jseh[i].trace);
      if (!eh.equal) { failures.push(`${label}: weh and jseh differ (${eh.reason})`); exactBits.push("weh/jseh DIFFERENT"); }
      const exact = exactBits.length ? exactBits.join("; ") : "all identical";

      let ground = "-", sText = "-", nText = "-", verdict = "", whole = "-";
      if (!same) {
        verdict = "FAIL: different outcome";
        failures.push(`${label}: native ${outcome(n)}, weh ${outcome(wasm.weh[i])}, jseh ${outcome(wasm.jseh[i])}`);
        counts.fail++;
      } else if (n.meta.stage !== "done") {
        // Fails natively and fails the same way in wasm: a pass for parity, listed.
        verdict = `pass (fails the same way: ${n.meta.message.replace(/\s+/g, " ").replaceAll(REPO_ROOT, "").slice(0, 110)})`;
        counts.passFailureParity++;
      } else if (turbulenceRows(n.trace) > 0 || turbulenceRows(wasm.weh[i].trace) > 0) {
        verdict = "not comparable (RNG): turbulence is on";
        counts.rng++;
      } else {
        const rows = windowRows(n.trace, { windowSeconds: 1 });
        const touches = touchesGround(n.trace, rows);
        ground = touches ? "yes" : "no";
        if (touches) counts.ground++;
        let ensemble;
        let ok = true, sFailed = false;
        const sParts = [], nParts = [];
        for (const v of VARIANTS) {
          const res = compareTraces(n.trace, wasm[v][i].trace, { tolerance: classS, windowSeconds: 1 });
          const w = worstColumn(res);
          sParts.push(`${v}: ${res.refused ? `REFUSED ${res.refused}` : `${res.pass ? "pass" : "FAIL"}${w ? ` (${w.column.split("/").pop()} ${fmt(w.maxAbs)} / ${fmt(w.allowed)})` : ""}`}`);
          detail.line(`${label}, ${v}, first 1 s, frozen Class S: ${describeResult(res)}`);
          if (res.refused) { ok = false; failures.push(`${label} ${v} Class S: ${describeResult(res)}`); continue; }
          if (!touches) {
            if (!res.pass) { ok = false; failures.push(`${label} ${v} Class S: ${describeResult(res)}`); detail.line(indent(table(res), "  ")); }
            continue;
          }
          if (!res.pass) sFailed = true;
          ensemble ??= runNativeSafe(ensembleScenarios(sc, rows - 1), "native-sweep-ensemble").map((m) => m.trace);
          const resN = classN(headTrace(n.trace, rows), headTrace(wasm[v][i].trace, rows), ensemble, { tolerance: classS });
          nParts.push(`${v}: ${resN.refused ? `REFUSED ${resN.refused}` : resN.pass ? "pass" : "FAIL"}`);
          detail.line(`${label}, ${v}, first 1 s, Class N with frozen Class S: ${describeN(resN)}`);
          if (!resN.pass) { ok = false; failures.push(`${label} ${v} Class N: ${describeN(resN)}`); detail.line(indent(tableN(resN), "  ")); }
        }
        sText = sParts.join("<br>");
        nText = nParts.length ? nParts.join("<br>") : "-";
        if (ok && sFailed) counts.classSFailButN++;
        verdict = ok ? "pass" : "FAIL";
        if (ok) counts.pass++;
        else counts.fail++;
        // Whole run, information only.
        const all = compareTraces(n.trace, wasm.weh[i].trace, { tolerance: classS });
        const w = worstColumn(all);
        whole = all.refused ? `not compared (${all.refused})` : `${n.trace.rows} rows; ${all.pass ? "inside" : "outside"} Class S${w ? `; worst ${w.column.split("/").pop()} ${fmt(w.maxAbs)}` : ""}`;
      }
      md += `| ${f.replace(".xml", "")} | ${aircraft} | ${n.meta.dt || "-"} | ${outcome(n)} | ${same ? "yes" : "NO"} | ${ground} | ${sText} | ${nText} | ${verdict} | ${exact} | ${whole} |\n`;
    }
    writeFileSync(join(RESULTS_DIR, "parity-sweep.md"), md);
    report.line(`SCRIPT SWEEP: the other ${others.length} upstream scripts, each at its own dt with the upstream ground callback, first 1 s judged`);
    report.line(`    pass: ${counts.pass} (of these, ${counts.ground} touch the ground in the first second and are judged on Class N; ${counts.classSFailButN} of them fail the frozen Class S)`);
    report.line(`    pass because the script fails natively and fails the same way in wasm: ${counts.passFailureParity}`);
    report.line(`    not comparable (RNG): ${counts.rng}`);
    report.line(`    FAIL: ${counts.fail}`);
    report.line("    table: results/parity-sweep.md; per-column tables of every failure: results/parity-detail.txt");
    report.line();
  }

  // Frozen lines that failed and are kept as failed (REPORT.md part 3, second stop; user decision 2026-11-18).
  // Each entry matches one script and one line. They are still printed as FAILED; the test's exit code is for
  // anything that is not on this list.
  const KEPT_AS_FAILED = [
    /^sweep c3104\.xml (weh|jseh) Class S: FAIL /,
    /^sweep c3105\.xml (weh|jseh) Class S: FAIL /,
    /^sweep mk82_script\.xml: native FAILED at step \d+, weh FAILED at step \d+, jseh FAILED at step \d+$/,
  ];
  const kept = failures.filter((f) => KEPT_AS_FAILED.some((re) => re.test(f)));
  const fresh = failures.filter((f) => !KEPT_AS_FAILED.some((re) => re.test(f)));
  report.line(kept.length ? `FAILED LINES kept on record (${kept.length}; see REPORT.md part 3):` : "No kept failed line appeared in this run.");
  for (const f of kept) report.line(`  ${f}`);
  report.line(fresh.length ? `NEW FAILED LINES (${fresh.length}):` : "No other line failed.");
  for (const f of fresh) report.line(`  ${f}`);
  report.save();
  detail.lines.length && detail.save();
  assert.deepEqual(fresh, []);
});
