// From 135crewdog/FDM, tests/lib/scenario.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// One scenario definition, three ways to run it:
//   runNative   the native answer key (fdm_native, the C++ scenario runner built with the system compiler)
//   runWasmCpp  the same C++ scenario runner inside the WebAssembly module
//   runWasmTs   driven step by step from TypeScript through the Fdm class (the path the game uses)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { StepResult } from "../../../src/sim/codes.js";
import { Fdm, runScenarioInWasm } from "../../../src/sim/core.js";
import { REPO_ROOT } from "./node.js";

// export interface Scenario {
//   name: string;
//   /** JSBSim root. "@data" = jsbsim-data, "@fix" = build/fixtures; a sub-path may follow. */
//   root: string;
//   /** Aircraft, engine, systems folders; "@data/..." and "@fix/..." are allowed. */
//   paths?: { aircraft: string; engine: string; systems: string };
//   /** Step size; 0 = the script's own dt. */
//   dt: number;
//   integrators?: [number, number, number, number];
//   ground?: GroundGrid;
//   model?: string;
//   script?: string;
//   initfile?: string;
//   ic?: string;
//   sets?: [string, number][];
//   adds?: [string, number][];
//   outs: string[];
//   outGear?: boolean;
//   ins?: string[];
//   /** steps x ins.length values. */
//   inputs?: Float64Array;
//   steps?: number;
//   duration?: number;
// }

// export interface RunResult {
//   meta: {
//     loaded: boolean;
//     icOk: boolean;
//     stage: string;
//     message: string;
//     endCode: number;
//     stepsDone: number;
//     rows: number;
//     dt: number;
//     columns: string[];
//     counters: number[];
//   };
//   trace: Trace;
// }

export const NATIVE_DIR = join(REPO_ROOT, "build", "native");
export const TMP_DIR = join(REPO_ROOT, "build", "test-tmp");
export const FIX_DIR = join(REPO_ROOT, "build", "fixtures");

// type Where = "native" | "wasm";

/** Maps "@data/..." and "@fix/..." to a real path on disk or inside the module. */
export function resolvePath(p, where) {
  const roots = [
    ["@data", join(REPO_ROOT, "jsbsim-data"), "/data"],
    ["@fix", FIX_DIR, "/fix"],
  ];
  for (const [token, disk, mem] of roots) {
    if (p === token || p.startsWith(`${token}/`)) return (where === "native" ? disk : mem) + p.slice(token.length);
  }
  return p;
}

function num(x) {
  // JavaScript prints the shortest decimal that reads back to the same double; strtod reads it back exactly.
  return Object.is(x, -0) ? "-0" : String(x);
}

function gridBytes(g) {
  const a = new Float64Array(6 + g.heights.length);
  a.set([g.lat0, g.lon0, g.dlat, g.dlon, g.nlat, g.nlon]);
  a.set(g.heights, 6);
  return new Uint8Array(a.buffer);
}

/** Scenario text for host/scenario_runner.cpp plus the side files it refers to. */
export function scenarioFiles(sc, where, dir, outdir) {
  const files = [];
  const lines = [`# ${sc.name}`, `root ${resolvePath(sc.root, where)}`, `outdir ${outdir}`];
  if (sc.paths) lines.push(`paths ${resolvePath(sc.paths.aircraft, where)} ${resolvePath(sc.paths.engine, where)} ${resolvePath(sc.paths.systems, where)}`);
  lines.push(`dt ${num(sc.dt)}`);
  if (sc.integrators) lines.push(`integrators ${sc.integrators.join(" ")}`);
  if (sc.ground) {
    files.push([`${dir}/grid.bin`, gridBytes(sc.ground)]);
    lines.push(`ground ${dir}/grid.bin`);
  }
  if (sc.model) lines.push(`model ${sc.model}`);
  if (sc.script) lines.push(`script ${sc.script}${sc.initfile ? ` ${sc.initfile}` : ""}`);
  if (sc.ic) lines.push(`ic ${sc.ic}`);
  for (const [p, v] of sc.sets ?? []) lines.push(`set ${p} ${num(v)}`);
  for (const [p, v] of sc.adds ?? []) lines.push(`add ${p} ${num(v)}`);
  for (const p of sc.outs) lines.push(`out ${p}`);
  if (sc.outGear) lines.push("outgear");
  for (const p of sc.ins ?? []) lines.push(`in ${p}`);
  if (sc.inputs) {
    files.push([`${dir}/inputs.bin`, new Uint8Array(sc.inputs.buffer, sc.inputs.byteOffset, sc.inputs.byteLength)]);
    lines.push(`inputs ${dir}/inputs.bin`);
  }
  if (sc.steps !== undefined) lines.push(`steps ${sc.steps}`);
  if (sc.duration !== undefined) lines.push(`duration ${num(sc.duration)}`);
  return { text: `${lines.join("\n")}\n`, files };
}

function safeName(name) {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** Runs scenarios with the native answer key (one process for the whole list). */
export function runNative(scenarios, tag = "native", binary = join(NATIVE_DIR, "fdm_native")) {
  const outdir = join(TMP_DIR, "out");
  mkdirSync(outdir, { recursive: true });
  const args = [];
  const prefixes = [];
  for (const sc of scenarios) {
    const dir = join(TMP_DIR, tag, safeName(sc.name));
    mkdirSync(dir, { recursive: true });
    const { text, files } = scenarioFiles(sc, "native", dir, outdir);
    for (const [path, bytes] of files) writeFileSync(path, bytes);
    writeFileSync(join(dir, "scenario.scn"), text);
    const prefix = join(dir, "trace");
    args.push(join(dir, "scenario.scn"), prefix);
    prefixes.push(prefix);
  }
  // In chunks, so the command line stays short.
  for (let i = 0; i < args.length; i += 40) {
    execFileSync(binary, args.slice(i, i + 40), { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, JSBSIM_DEBUG: "" } });
  }
  return prefixes.map((prefix) => {
    const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
    const raw = readFileSync(`${prefix}.bin`);
    const data = new Float64Array(raw.length / 8);
    new Uint8Array(data.buffer).set(raw);
    return { meta, trace: { columns: meta.columns, rows: meta.rows, data } };
  });
}

/** Runs one scenario with the C++ scenario runner inside the WebAssembly module. */
export function runWasmCpp(module, sc) {
  const dir = `/tmp/${safeName(sc.name)}`;
  module.mkdir(dir);
  const { text, files } = scenarioFiles(sc, "wasm", dir, "/out");
  for (const [path, bytes] of files) module.writeFile(path, bytes);
  module.writeFile(`${dir}/scenario.scn`, text);
  const { meta, data } = runScenarioInWasm(module, `${dir}/scenario.scn`);
  return { meta, trace: { columns: meta.columns, rows: meta.rows, data } };
}

/** Runs one scenario step by step from TypeScript, the way the game will. Mirrors host/scenario_runner.cpp. */
export function runWasmTs(module, sc) {
  const meta = { loaded: false, icOk: false, stage: "create", message: "", endCode: 0, stepsDone: 0, rows: 0, dt: 0, columns: [], counters: [] };
  const rowsOut = [];
  let fdm;
  try {
    fdm = Fdm.create(module, {
      dt: sc.dt,
      root: resolvePath(sc.root, "wasm"),
      outDir: "/out",
      paths: sc.paths ? { aircraft: resolvePath(sc.paths.aircraft, "wasm"), engine: resolvePath(sc.paths.engine, "wasm"), systems: resolvePath(sc.paths.systems, "wasm") } : undefined,
      integrators: sc.integrators,
      ground: sc.ground,
    });
    meta.stage = "load";
    if (sc.model) fdm.loadModel(sc.model);
    else fdm.loadScript(sc.script, sc.initfile ?? "");
    meta.loaded = true;
    meta.dt = fdm.dt;
    meta.stage = "setup";
    if (sc.ic) fdm.loadIC(sc.ic);
    for (const [p, v] of sc.sets ?? []) fdm.setByName(p, v);
    for (const [p, v] of sc.adds ?? []) fdm.setByName(p, fdm.getByName(p) + v);
    const outs = sc.outs.slice();
    if (sc.outGear) {
      const units = fdm.getByName("gear/num-units");
      for (let k = 0; k < units; k++) {
        const a = `gear/unit[${k}]/WOW`, b = `contact/unit[${k}]/WOW`;
        outs.push(fdm.has(a) ? a : b);
      }
    }
    fdm.bindOutputs(outs);
    const ins = sc.ins ?? [];
    const inputs = fdm.bindInputs(ins);
    meta.columns = outs;
    const steps = sc.steps !== undefined ? sc.steps : Math.floor(sc.duration / fdm.dt + 1e-9);
    meta.stage = "runic";
    fdm.runIC();
    meta.icOk = true;
    meta.stage = "step";
    for (const v of fdm.curr) rowsOut.push(v);
    meta.rows = 1;
    for (let k = 0; k < steps; k++) {
      if (sc.inputs) inputs.set(sc.inputs.subarray(k * ins.length, (k + 1) * ins.length));
      meta.endCode = fdm.step(1);
      if (fdm.stepsInLastCall === 1) {
        meta.stepsDone++;
        for (const v of fdm.curr) rowsOut.push(v);
        meta.rows++;
      }
      if (meta.endCode !== StepResult.OK) break;
    }
    for (let i = 0; i < 8; i++) meta.counters.push(fdm.counter(i));
    if (meta.endCode < 0 || meta.endCode === StepResult.NONFINITE) meta.message = "step failed";
    else meta.stage = "done";
  } catch (e) {
    meta.message = e instanceof Error ? e.message : String(e);
  } finally {
    if (fdm) fdm.dispose();
  }
  return { meta, trace: { columns: meta.columns, rows: meta.rows, data: Float64Array.from(rowsOut) } };
}

// --- column sets -------------------------------------------------------------------------------------------

/** The judged columns of REPORT.md part 2, plus the two information-only ones. Gear WOW comes from outGear. */
export const STATE_COLUMNS = [
  "simulation/sim-time-sec",
  "position/ecef-x-ft", "position/ecef-y-ft", "position/ecef-z-ft", "position/h-sl-ft", "position/h-agl-ft",
  "velocities/u-fps", "velocities/v-fps", "velocities/w-fps", "velocities/vtrue-kts",
  "velocities/p-rad_sec", "velocities/q-rad_sec", "velocities/r-rad_sec",
  "attitude/phi-rad", "attitude/theta-rad", "attitude/psi-rad",
  "forces/fbx-total-lbs", "forces/fby-total-lbs", "forces/fbz-total-lbs",
  "moments/l-total-lbsft", "moments/m-total-lbsft", "moments/n-total-lbsft",
  "aero/alpha-rad", "aero/beta-rad",
];

/** Read back in every run to show turbulence is off. */
export const TURBULENCE_COLUMNS = [
  "atmosphere/turbulence/milspec/severity",
  "atmosphere/turb-north-fps", "atmosphere/turb-east-fps", "atmosphere/turb-down-fps",
  "atmosphere/p-turb-rad_sec", "atmosphere/q-turb-rad_sec", "atmosphere/r-turb-rad_sec",
];

/** Rows on which any turbulence column is not exactly zero. */
export function turbulenceRows(t) {
  const idx = TURBULENCE_COLUMNS.map((c) => t.columns.indexOf(c)).filter((i) => i >= 0);
  const n = t.columns.length;
  let bad = 0;
  for (let r = 0; r < t.rows; r++) if (idx.some((i) => t.data[r * n + i] !== 0)) bad++;
  return bad;
}

// --- native ensemble (Class B and Class N) -----------------------------------------------------------------

/** One unit in the last place of an Earth-radius-sized coordinate, in feet. */
export const POSITION_QUANTUM_FT = 2 ** -28;
export const ENSEMBLE_K = [1, -1, 2, -2, 3, -3, 4, -4];

/** The 8 perturbed copies of a scenario: start altitude moved by k * 2^-28 ft before RunIC. */
export function ensembleScenarios(sc, steps) {
  return ENSEMBLE_K.map((k) => ({
    ...sc,
    name: `${sc.name}-ens${k > 0 ? "p" : "m"}${Math.abs(k)}`,
    adds: [...(sc.adds ?? []), ["ic/h-sl-ft", k * POSITION_QUANTUM_FT]],
    ...(steps !== undefined ? { steps, duration: undefined } : {}),
  }));
}

/** The first `rows` rows of a trace. */
export function headTrace(t, rows) {
  const r = Math.min(rows, t.rows);
  return { columns: t.columns, rows: r, data: t.data.subarray(0, r * t.columns.length) };
}
