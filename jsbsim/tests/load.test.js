// From 135crewdog/FDM, tests/load.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 6: every aircraft that loads natively also loads in WebAssembly.
// "Loads" (REPORT.md part 2): on a fresh instance, LoadModel(<folder name>) returns true and throws nothing.
import assert from "node:assert/strict";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { Fdm, FdmCrash } from "../../src/sim/core.js";
import { REPO_ROOT, VARIANTS } from "./lib/node.js";
import { RESULTS_DIR, Report, loadWithData } from "./lib/harness.js";
import { runNative, runWasmCpp } from "./lib/scenario.js";

const AIRCRAFT_DIR = join(REPO_ROOT, "jsbsim-data", "aircraft");
const names = readdirSync(AIRCRAFT_DIR).filter((n) => statSync(join(AIRCRAFT_DIR, n)).isDirectory()).sort();

const scenario = (name) => ({
  name: `load-${name}`, root: "@data", dt: 1 / 120, model: name, outs: ["simulation/sim-time-sec"], steps: 10,
});
// The same message on both platforms: drop the platform's data folder.
const clean = (m) => m.replaceAll(join(REPO_ROOT, "jsbsim-data"), "<data>").replaceAll("/data", "<data>").replace(/\s+/g, " ").trim();
const steps = (r) => (!r.meta.loaded ? "-" : !r.meta.icOk ? "RunIC failed" : r.meta.stepsDone === 10 ? "10 steps" : `stopped after ${r.meta.stepsDone}`);

test("load test: all aircraft folders, native and both WebAssembly builds", async () => {
  const report = new Report("load-test");
  assert.equal(names.length, 61);
  const native = runNative(names.map(scenario), "native-load");
  const wasm = {};
  const tsLoads = {};
  const heap = {};
  for (const variant of VARIANTS) {
    const { module } = await loadWithData(variant);
    wasm[variant] = [];
    tsLoads[variant] = [];
    let stackFreeMin = Infinity;
    for (const name of names) {
      wasm[variant].push(runWasmCpp(module, scenario(name)));
      // The TypeScript path as well: loadModel throws FdmError or returns.
      const f = Fdm.create(module);
      try {
        f.loadModel(name);
        tsLoads[variant].push(true);
      } catch (e) {
        if (e instanceof FdmCrash) throw e;
        tsLoads[variant].push(false);
      } finally {
        f.dispose();
      }
      stackFreeMin = Math.min(stackFreeMin, module.stackFree());
    }
    heap[variant] = { top: module.heapTop(), inUseEnd: module.heapInUse(), memory: module.memoryBytes(), stackFreeMin };
  }

  let md = "| Aircraft | Native | wasm-EH | JS-EH | After load: RunIC + 10 steps (native / wasm-EH / JS-EH) | JSBSim's message when it does not load |\n|---|---|---|---|---|---|\n";
  const mismatches = [];
  let loadedNative = 0;
  names.forEach((name, i) => {
    const n = native[i], a = wasm.weh[i], b = wasm.jseh[i];
    if (n.meta.loaded) loadedNative++;
    const yes = (x) => (x ? "loads" : "fails");
    if (n.meta.loaded !== a.meta.loaded || n.meta.loaded !== b.meta.loaded) mismatches.push(`${name}: native ${yes(n.meta.loaded)}, weh ${yes(a.meta.loaded)}, jseh ${yes(b.meta.loaded)}`);
    if (tsLoads.weh[i] !== a.meta.loaded || tsLoads.jseh[i] !== b.meta.loaded) mismatches.push(`${name}: TypeScript loadModel disagrees with the C++ runner`);
    const msg = n.meta.loaded ? "" : clean(n.meta.message);
    if (!n.meta.loaded && (clean(a.meta.message) !== msg || clean(b.meta.message) !== msg)) mismatches.push(`${name}: failure messages differ: native "${msg}" / weh "${clean(a.meta.message)}" / jseh "${clean(b.meta.message)}"`);
    md += `| ${name} | ${yes(n.meta.loaded)} | ${yes(a.meta.loaded)} | ${yes(b.meta.loaded)} | ${steps(n)} / ${steps(a)} / ${steps(b)} | ${msg.replaceAll("|", "\\|")} |\n`;
  });
  writeFileSync(join(RESULTS_DIR, "load-table.md"), md);

  report.line(`Aircraft folders: ${names.length}. Load natively: ${loadedNative}. Do not load natively: ${names.length - loadedNative}.`);
  report.line(`wasm-EH loads ${wasm.weh.filter((r) => r.meta.loaded).length}, JS-EH loads ${wasm.jseh.filter((r) => r.meta.loaded).length}.`);
  report.line(`Mismatches between native and WebAssembly: ${mismatches.length}`);
  for (const m of mismatches) report.line(`  ${m}`);
  const stepDiff = names.filter((_, i) => steps(native[i]) !== steps(wasm.weh[i]) || steps(native[i]) !== steps(wasm.jseh[i]));
  const noStep = names.filter((_, i) => native[i].meta.loaded && steps(native[i]) !== "10 steps");
  report.line(`Information: aircraft that load but do not complete RunIC + 10 steps natively: ${noStep.length ? noStep.map((n) => `${n} (${steps(native[names.indexOf(n)])}: ${clean(native[names.indexOf(n)].meta.message).slice(0, 160)})`).join("; ") : "none"}`);
  report.line(`Information: aircraft where RunIC + 10 steps ends differently in WebAssembly: ${stepDiff.length ? stepDiff.join(", ") : "none"}`);
  for (const variant of VARIANTS) {
    const h = heap[variant];
    report.line(`${variant}: after loading all ${names.length} twice (C++ runner and TypeScript) in one module: heap top ${h.top} bytes (${(h.top / 1048576).toFixed(2)} MiB) of ${h.memory} fixed; in use at the end ${h.inUseEnd} bytes; stack free between calls ${h.stackFreeMin} bytes`);
  }
  report.line("Full table: results/load-table.md");
  report.save();
  assert.deepEqual(mismatches, []);
});
