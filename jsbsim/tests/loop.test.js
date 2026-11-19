// From 135crewdog/FDM, tests/loop.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 5: the fixed-step loop, and the same Worker handler run in Node directly and in a worker thread.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { StepResult } from "../../src/sim/codes.js";
import { buildPack } from "../../src/sim/files.js";
import { FixedStepLoop } from "../../src/sim/loop.js";
import { REPO_ROOT, VARIANTS, readDir } from "./lib/node.js";
import { WorkerClient, createHandler } from "../../src/sim/worker-handler.js";
import { prepareFixtures } from "./lib/fixtures.js";

const DT = 1 / 120;

/** A stand-in simulation: the state is just the step count. */
class FakeSim {
  dt = DT;
  steps = 0;
  prev = new Float64Array(1);
  curr = new Float64Array(1);
  endAt = Infinity;
  step(n) {
    for (let i = 0; i < n; i++) {
      this.prev[0] = this.curr[0];
      this.steps++;
      this.curr[0] = this.steps;
      if (this.steps >= this.endAt) return StepResult.SCRIPT_END;
    }
    return StepResult.OK;
  }
}

describe("FixedStepLoop with a fake clock", () => {
  test("1 s of frames at 60 Hz gives exactly 120 steps at 1/120 s", () => {
    const sim = new FakeSim();
    const loop = new FixedStepLoop(sim);
    for (let i = 0; i <= 60; i++) loop.advance(100 + i / 60);
    assert.equal(sim.steps, 120);
    assert.equal(loop.totalSteps, 120);
    assert.equal(loop.droppedSeconds, 0);
  });

  test("other frame rates: 10 s at 50, 90 and 144 Hz give 1200 steps", () => {
    for (const hz of [50, 90, 144]) {
      const sim = new FakeSim();
      const loop = new FixedStepLoop(sim);
      for (let i = 0; i <= 10 * hz; i++) loop.advance(i / hz);
      assert.equal(sim.steps, 1200, `${hz} Hz`);
      assert.ok(loop.alpha >= 0 && loop.alpha < 1);
    }
  });

  test("one 10 s frame gives no more than the cap, and the dropped time is counted", () => {
    const sim = new FakeSim();
    const loop = new FixedStepLoop(sim, { maxStepsPerAdvance: 8 });
    loop.advance(0);
    const steps = loop.advance(10);
    assert.equal(steps, 8);
    assert.equal(sim.steps, 8);
    assert.ok(Math.abs(loop.droppedSeconds - (10 - 8 * DT)) < 1e-9, `dropped ${loop.droppedSeconds}`);
    assert.ok(loop.accumulator < DT);
    // The next normal frame is normal again: no backlog.
    assert.equal(loop.advance(10 + 1 / 60), 2);
  });

  test("pause, 10 s pass, resume: 0 catch-up steps", () => {
    const sim = new FakeSim();
    const loop = new FixedStepLoop(sim);
    for (let i = 0; i <= 60; i++) loop.advance(i / 60);
    assert.equal(sim.steps, 120);
    loop.pause();
    assert.equal(loop.advance(5), 0);
    assert.equal(loop.advance(11), 0);
    loop.resume();
    assert.equal(loop.advance(11), 0); // the first frame after resume only restarts the clock
    assert.equal(loop.advance(11 + 1 / 60), 2);
    assert.equal(sim.steps, 122);
    assert.equal(loop.droppedSeconds, 0);
  });

  test("prev and curr are the states before and after the last step; 0 <= alpha < 1", () => {
    const sim = new FakeSim();
    const loop = new FixedStepLoop(sim);
    loop.advance(0);
    for (let i = 1; i <= 500; i++) {
      loop.advance(i * 0.0137); // an awkward frame time
      if (sim.steps > 0) {
        assert.equal(loop.curr[0], sim.steps);
        assert.equal(loop.prev[0], sim.steps - 1);
      }
      assert.ok(loop.alpha >= 0 && loop.alpha < 1, `alpha ${loop.alpha}`);
    }
  });

  test("the loop stops when the sim ends", () => {
    const sim = new FakeSim();
    sim.endAt = 5;
    const loop = new FixedStepLoop(sim);
    for (let i = 0; i <= 60; i++) loop.advance(i / 60);
    assert.ok(sim.steps >= 5 && sim.steps <= 6, `steps ${sim.steps}`); // ended inside a batch
    assert.equal(loop.lastResult, StepResult.SCRIPT_END);
    const before = sim.steps;
    loop.advance(100);
    assert.equal(sim.steps, before);
  });
});

// --- the real core through the Worker handler ---------------------------------------------------------------

function packs() {
  const data = readDir(join(REPO_ROOT, "jsbsim-data", "aircraft", "c172x"), "aircraft/c172x/");
  readDir(join(REPO_ROOT, "jsbsim-data", "engine"), "engine/", data);
  readDir(join(REPO_ROOT, "jsbsim-data", "systems"), "systems/", data);
  return [["/data", buildPack(data)], ["/fix", buildPack(readDir(prepareFixtures()))]];
}

/** The same protocol test, whatever carries the messages. */
async function protocolTest(client, variant) {
  const events = [];
  client.onEvent = (e) => events.push(e);
  const dist = join(REPO_ROOT, "dist-wasm");
  const init = await client.request({
    type: "init", moduleUrl: pathToFileURL(join(dist, `fdm-${variant}.mjs`)).href,
    wasmBinary: readFileSync(join(dist, `fdm-${variant}.wasm`)), packs: packs(),
  });
  assert.match(init.version, /^JSBSim 1\.3\.3/);

  const outputs = ["simulation/sim-time-sec", "position/h-sl-ft", "velocities/vtrue-kts"];
  const created = await client.request({ type: "create", model: "c172x", ic: "reset01", outputs });
  assert.equal(created.dt, DT);
  assert.ok(Math.abs(created.curr[1] - 4000) < 0.1, `start altitude ${created.curr[1]}`); // reset01: 4000 ft

  // 1 s of frames at 60 Hz: exactly 120 steps, sim time 1 s.
  let state;
  for (let i = 0; i <= 60; i++) state = await client.request({ type: "tick", now: 50 + i / 60 });
  assert.equal(state.totalSteps, 120);
  assert.ok(Math.abs(state.simTime - 1) < 1e-9);
  assert.ok(state.prev instanceof Float64Array && state.curr instanceof Float64Array);
  assert.ok(Math.abs(state.curr[0] - state.prev[0] - DT) < 1e-12, "prev and curr are one step apart");
  assert.ok(Math.abs(state.curr[0] - 1) < 1e-9);
  assert.ok(state.alpha >= 0 && state.alpha < 1);
  assert.ok(Math.abs(state.curr[1] - 4000) < 50, `altitude ${state.curr[1]}`); // untrimmed, so it wanders a little

  // Hidden for 10 s: no steps while paused, none to catch up afterwards.
  await client.request({ type: "pause" });
  state = await client.request({ type: "tick", now: 56 });
  assert.equal(state.steps, 0);
  await client.request({ type: "resume" });
  state = await client.request({ type: "tick", now: 61 });
  assert.equal(state.steps, 0);
  state = await client.request({ type: "tick", now: 61 + 1 / 60 });
  assert.equal(state.steps, 2);
  assert.equal(state.totalSteps, 122);

  // One very long frame: capped.
  state = await client.request({ type: "tick", now: 80 });
  assert.equal(state.steps, 8);
  assert.ok(state.droppedSeconds > 18);
  await client.request({ type: "dispose" });

  // A broken aircraft is caught and reported with JSBSim's message.
  const broken = await client.request({ type: "tryload", model: "broken_xml", paths: { aircraft: "/fix/aircraft", engine: "engine", systems: "systems" } });
  assert.equal(broken.loaded, false);
  assert.equal(broken.isError, true);
  assert.match(broken.message, /XML parse error: mismatched tag/);

  // Create and destroy 20 times.
  const cycles = await client.request({ type: "cycles", count: 20, model: "c172x", ic: "reset01", steps: 50 });
  assert.equal(cycles.heap.length, 20);
  assert.equal(cycles.heap[19], cycles.heap[1], "heap in use grew between cycle 2 and cycle 20");

  // A script that ends: the event arrives and the loop stops.
  await client.request({ type: "create", dt: 0, script: "/fix/scripts/t_short.xml", outputs });
  await client.request({ type: "tick", now: 0 });
  for (let i = 1; i <= 80; i++) state = await client.request({ type: "tick", now: i / 60 });
  assert.equal(state.ended, true);
  assert.equal(state.result, StepResult.SCRIPT_END);
  assert.ok(events.some((e) => e.type === "script-end"));

  // Errors come back as rejected requests, not as silence.
  await assert.rejects(client.request({ type: "create", model: "does_not_exist", outputs }), /does_not_exist/);
}

for (const variant of VARIANTS) {
  describe(`the same handler, ${variant}`, () => {
    test("in Node directly (no thread)", async () => {
      let handle;
      const client = new WorkerClient((message) => void handle(message));
      handle = createHandler((message) => queueMicrotask(() => client.receive(message)));
      await protocolTest(client, variant);
    });

    test("inside a worker_threads Worker", async () => {
      const worker = new Worker(new URL("./lib/node-worker.js", import.meta.url));
      const client = new WorkerClient((message, transfer) => worker.postMessage(message, transfer ?? []));
      worker.on("message", (m) => client.receive(m));
      worker.on("error", (e) => client.failAll(String(e)));
      try {
        await protocolTest(client, variant);
      } finally {
        await worker.terminate();
      }
    });
  });
}
