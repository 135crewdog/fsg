// From 135crewdog/FDM, ts/bench.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Batched timing of the step, shared by the test page (main thread), the Worker and Node.
// performance.now() has 1 ms resolution on iPhone, so only whole batches are timed.
import { StepResult } from "./codes.js";
import { Fdm } from "./core.js";

/** Columns a game would read every step. */
export const BENCH_OUTPUTS = [
  "simulation/sim-time-sec",
  "position/ecef-x-ft", "position/ecef-y-ft", "position/ecef-z-ft", "position/h-sl-ft", "position/h-agl-ft",
  "velocities/u-fps", "velocities/v-fps", "velocities/w-fps", "velocities/vtrue-kts",
  "velocities/p-rad_sec", "velocities/q-rad_sec", "velocities/r-rad_sec",
  "attitude/phi-rad", "attitude/theta-rad", "attitude/psi-rad",
];

export const NUM_FORCES = 20;
const forceName = (i) => `f${String(i).padStart(2, "0")}`;

/** Input lists for the c172x_ext20 fixture: 20 magnitudes, or all 7 values of each of the 20 forces. */
export function forceInputs(kind) {
  const names = [];
  for (let i = 0; i < NUM_FORCES; i++) {
    const base = `external_reactions/${forceName(i)}`;
    if (kind === 140) names.push(`${base}/location-x-in`, `${base}/location-y-in`, `${base}/location-z-in`, `${base}/x`, `${base}/y`, `${base}/z`);
    names.push(`${base}/magnitude`);
  }
  return names;
}

/**
 * Fills the inputs for one step. Only +, -, * and / on small integers, so every platform gets the same bits.
 * Each force swings between -8 and +8 lb with its own period; directions stay (0, 0, -1), locations fixed.
 */
export function fillForceInputs(inputs, kind, step) {
  for (let i = 0; i < NUM_FORCES; i++) {
    const period = 64 + 8 * i;
    const phase = (step + 5 * i) % period;
    const tri = phase < period / 2 ? phase : period - phase; // 0 .. period/2
    const magnitude = (tri * 4) / period * 8 - 8; // -8 .. +8
    if (kind === 140) {
      const o = i * 7;
      inputs[o] = 43.2;
      inputs[o + 1] = -190 + (380 * i) / (NUM_FORCES - 1);
      inputs[o + 2] = 59.4;
      inputs[o + 3] = 0;
      inputs[o + 4] = 0;
      inputs[o + 5] = -1;
      inputs[o + 6] = magnitude;
    } else {
      inputs[i] = magnitude;
    }
  }
}

// export interface BenchOptions {
//   dt: number;
//   /** 0 = upstream c172x; 20 = c172x_ext20 writing 20 magnitudes per step; 140 = writing all 140 values. */
//   forces: 0 | 20 | 140;
//   /** Folder holding c172x_ext20 (the fixtures' aircraft folder). */
//   fixtureAircraftPath: string;
//   warmupSteps?: number;
//   batchSteps?: number;
//   /** Fresh instances; each times one batch. The median is reported. */
//   repeats?: number;
//   now?: () => number;
// }

// export interface BenchResult {
//   dt: number;
//   forces: number;
//   usPerStep: number; // median
//   all: number[];
//   batchSteps: number;
//   /** State at the end of the last run, to show the aircraft was really flying. */
//   endAltitudeFt: number;
//   endAirspeedKt: number;
// }

/** Times `batchSteps` single steps (one call into WebAssembly per step, inputs written before each). */
export function benchSteps(module, o) {
  const warmup = o.warmupSteps ?? 300;
  const batch = o.batchSteps ?? 3000;
  const repeats = o.repeats ?? 5;
  const now = o.now ?? (() => performance.now());
  const all = [];
  let endAltitudeFt = NaN, endAirspeedKt = NaN;
  for (let r = 0; r < repeats; r++) {
    const fdm = Fdm.create(module, o.forces ? { dt: o.dt, paths: { aircraft: o.fixtureAircraftPath, engine: "engine", systems: "systems" } } : { dt: o.dt });
    try {
      fdm.loadModel(o.forces ? "c172x_ext20" : "c172x");
      fdm.loadIC("reset01"); // airborne: 4000 ft, 100 kt
      fdm.bindOutputs(BENCH_OUTPUTS);
      const inputs = fdm.bindInputs(o.forces ? forceInputs(o.forces) : []);
      fdm.runIC();
      let step = 0;
      const run = (n) => {
        for (let k = 0; k < n; k++, step++) {
          if (o.forces) fillForceInputs(inputs, o.forces, step);
          if (fdm.step(1) !== StepResult.OK) throw new Error(`benchmark step failed at step ${step}`);
        }
      };
      run(warmup);
      const t0 = now();
      run(batch);
      all.push(((now() - t0) * 1000) / batch);
      endAltitudeFt = fdm.curr[4];
      endAirspeedKt = fdm.curr[9];
    } finally {
      fdm.dispose();
    }
  }
  const sorted = all.slice().sort((a, b) => a - b);
  return { dt: o.dt, forces: o.forces, usPerStep: sorted[Math.floor(sorted.length / 2)], all, batchSteps: batch, endAltitudeFt, endAirspeedKt };
}

// export interface CyclesResult {
//   /** Bytes in use on the C heap after each create / load / step / destroy cycle. */
//   heap: number[];
//   heapTop: number;
//   memoryBytes: number;
// }

/** Creates, loads, steps and destroys one instance `count` times in the same module (the memory check). */
export function runCycles(module, count, model, ic, steps) {
  const heap = [];
  for (let i = 0; i < count; i++) {
    const fdm = Fdm.create(module);
    try {
      fdm.loadModel(model);
      fdm.loadIC(ic);
      fdm.bindOutputs(BENCH_OUTPUTS);
      fdm.runIC();
      if (fdm.step(steps) !== StepResult.OK) throw new Error(`cycle ${i}: step failed`);
    } finally {
      fdm.dispose();
    }
    heap.push(module.heapInUse());
  }
  return { heap, heapTop: module.heapTop(), memoryBytes: module.memoryBytes() };
}
