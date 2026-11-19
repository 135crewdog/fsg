// From 135crewdog/FDM, tests/wrapper.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Criterion 3: the wrapper, tested through TypeScript on both WebAssembly builds.
// The same checks run natively in tests/native/host_selftest.cpp (fdm_native --selftest).
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { Counter, SetStatus, State, StepResult } from "../../src/sim/codes.js";
import { Fdm, FdmCrash, FdmError } from "../../src/sim/core.js";
import { VARIANTS } from "./lib/node.js";
import { Report, loadWithData } from "./lib/harness.js";

const INTEG = ["rate/rotational", "rate/translational", "position/rotational", "position/translational"].map((n) => `simulation/integrator/${n}`);
const FIX_PATHS = { aircraft: "/fix/aircraft", engine: "engine", systems: "systems" };
const report = new Report("wrapper-memory");
after(() => report.save());

function refused(fn, status, pattern) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof FdmError, `expected FdmError, got ${String(err)}`);
  assert.ok(err instanceof Error);
  if (status !== undefined) assert.equal(err.status, status);
  if (pattern) assert.match(err.message, pattern);
  return err;
}

for (const variant of VARIANTS) {
  describe(`wrapper, ${variant}`, async () => {
    const { module, logs } = await loadWithData(variant);
    const integ = (f) => INTEG.map((n) => f.getByName(n));

    test("one load per instance", () => {
      const f = Fdm.create(module);
      f.loadModel("c172x");
      refused(() => f.loadModel("c172x"), undefined, /already loaded/);
      refused(() => f.loadScript("scripts/c1723.xml"), undefined, /already loaded/);
      assert.equal(f.state, State.LOADED);
      f.dispose();
    });

    test("dt set before load is in force after load and RunIC", () => {
      const f = Fdm.create(module, { dt: 1 / 240 });
      f.loadModel("c172x");
      assert.equal(f.dt, 1 / 240);
      assert.equal(f.getByName("simulation/dt"), 1 / 240);
      f.loadIC("reset01");
      f.runIC();
      assert.equal(f.getByName("simulation/dt"), 1 / 240);
      assert.deepEqual(integ(f), [1, 3, 1, 4]);
      assert.equal(f.step(10), StepResult.OK);
      assert.ok(Math.abs(f.simTime - 10 / 240) < 1e-12);
      f.dispose();
    });

    test("a script runs at the host dt, or at its own dt when the host dt is 0", () => {
      const a = Fdm.create(module, { dt: 1 / 120 });
      a.loadScript("/fix/scripts/t_short.xml");
      assert.equal(a.getByName("simulation/dt"), 1 / 120);
      a.dispose();
      const b = Fdm.create(module, { dt: 0 });
      b.loadScript("/fix/scripts/t_short.xml");
      assert.equal(b.dt, 0.02);
      assert.equal(b.getByName("simulation/dt"), 0.02);
      b.dispose();
      const c = Fdm.create(module, { dt: 0 });
      refused(() => c.loadModel("c172x"), undefined, /dt must be set/);
      c.dispose();
      refused(() => Fdm.create(module, { dt: -1 }), undefined, /dt must be/);
      refused(() => Fdm.create(module, { dt: NaN }), undefined, /dt must be/);
    });

    test("integrator settings: enforced after load, reported while stepping", () => {
      const events = [];
      const a = Fdm.create(module, { onEvent: (e) => events.push(e) });
      a.loadScript("/fix/scripts/t_integrators.xml");
      assert.deepEqual(integ(a), [1, 3, 1, 4]); // the script asked for 4 on the first; put back
      assert.equal(a.counter(Counter.INTEGRATORS_RESTORED), 1);
      assert.ok(events.some((e) => e.type === "warning" && e.what === "integrators-restored"));
      a.runIC();
      assert.deepEqual(integ(a), [1, 3, 1, 4]);
      for (let i = 0; i < 30; i++) a.step(1);
      assert.deepEqual(integ(a), [1, 3, 2, 4]); // changed by a script event: not undone
      assert.equal(a.counter(Counter.INTEGRATORS_CHANGED), 1);
      assert.ok(events.some((e) => e.type === "warning" && e.what === "integrators-changed"));
      a.dispose();
      const b = Fdm.create(module, { integrators: [-1, -1, -1, -1] });
      b.loadScript("/fix/scripts/t_integrators.xml");
      assert.deepEqual(integ(b), [4, 3, 1, 4]);
      b.dispose();
    });

    test("validated writes: read-only, NaN, integer", () => {
      const f = Fdm.create(module);
      f.loadModel("c172x");
      const ro = f.prop("simulation/sim-time-sec");
      const thr = f.prop("fcs/throttle-cmd-norm");
      const ig = f.prop(INTEG[0]);
      assert.equal(f.isWritable(ro), false);
      assert.equal(f.isInteger(ig), true);
      const t0 = f.get(ro);
      refused(() => f.set(ro, 5), SetStatus.READ_ONLY);
      assert.equal(f.get(ro), t0);
      assert.equal(f.set(thr, 0.25), 0.25);
      refused(() => f.set(thr, NaN), SetStatus.NAN);
      refused(() => f.set(thr, Infinity), SetStatus.NAN);
      refused(() => f.set(thr, "0.9"), SetStatus.NAN);
      assert.equal(f.get(thr), 0.25);
      refused(() => f.set(ig, 1.5), SetStatus.NOT_INTEGER);
      refused(() => f.set(ig, 2 ** 40), SetStatus.NOT_INTEGER);
      assert.equal(f.get(ig), 1);
      refused(() => f.bindInputs(["simulation/sim-time-sec"]), undefined, /read-only/);
      // Bulk path: a NaN input refuses the step and nothing moves.
      const inputs = f.bindInputs(["fcs/throttle-cmd-norm"]);
      f.loadIC("reset01");
      f.runIC();
      inputs[0] = NaN;
      const before = f.simTime;
      assert.equal(f.step(1), StepResult.BAD_INPUT);
      assert.equal(f.simTime, before);
      assert.equal(f.state, State.RUNNING);
      inputs[0] = 0.5;
      assert.equal(f.step(1), StepResult.OK);
      assert.equal(f.get(thr), 0.5);
      f.dispose();
    });

    test("unknown and invalid property names are errors and create nothing", () => {
      const f = Fdm.create(module);
      f.loadModel("c172x");
      refused(() => f.prop("no/such/property"), undefined, /unknown property/);
      refused(() => f.prop("no/such/property"), undefined, /unknown property/); // still unknown: not created
      assert.equal(f.has("no/such/property"), false);
      refused(() => f.setByName("fcs/throtle-cmd-norm", 1), undefined, /unknown property/); // a typo does not "succeed"
      refused(() => f.prop("fcs/[bad"));
      refused(() => f.prop("fcs"), undefined, /folder/);
      f.dispose();
    });

    test("a malformed aircraft becomes an Error with JSBSim's message; the log reaches JavaScript", () => {
      logs.length = 0;
      const f = Fdm.create(module, { paths: FIX_PATHS });
      const err = refused(() => f.loadModel("broken_xml"));
      assert.ok(err instanceof Error);
      assert.match(err.message, /XML parse error: mismatched tag/);
      assert.match(err.message, /broken_xml\.xml: line 8/);
      assert.equal(f.state, State.DEAD);
      assert.ok(logs.length >= 1, "no log record arrived");
      assert.ok(logs.some((l) => l.levelName === "FATAL" && /XML parse error/.test(l.text)));
      f.dispose();
      // A missing aircraft returns false inside JSBSim without throwing: the message comes from the log.
      const g = Fdm.create(module);
      refused(() => g.loadModel("does_not_exist"), undefined, /Could not open file.*does_not_exist/s);
      g.dispose();
      // The module is fine afterwards.
      const h = Fdm.create(module);
      h.loadModel("c172x");
      h.runIC();
      assert.equal(h.step(5), StepResult.OK);
      h.dispose();
    });

    test("log records of a running script reach JavaScript", () => {
      logs.length = 0;
      const f = Fdm.create(module, { dt: 0 });
      f.loadScript("scripts/c1723.xml");
      f.runIC();
      f.step(400); // the script's first notify event fires at about 3 s
      f.dispose();
      assert.ok(logs.some((l) => /Begin roll/.test(l.text)), "the script's event notice did not arrive");
    });

    test("events: script end, terminate, non-finite state", () => {
      const events = [];
      const a = Fdm.create(module, { dt: 0, onEvent: (e) => events.push(e) });
      a.loadScript("/fix/scripts/t_short.xml");
      a.runIC();
      assert.equal(a.step(1000), StepResult.SCRIPT_END);
      assert.equal(a.state, State.ENDED);
      assert.equal(events.filter((e) => e.type === "script-end").length, 1);
      assert.equal(a.stepsInLastCall, 26);
      a.dispose();

      const b = Fdm.create(module, { dt: 0, onEvent: (e) => events.push(e) });
      b.loadScript("/fix/scripts/t_terminate.xml");
      b.runIC();
      assert.equal(b.step(1000), StepResult.TERMINATE);
      const term = events.find((e) => e.type === "terminate");
      assert.ok(term && term.simTime > 0.24 && term.simTime < 0.3);
      b.dispose();

      const c = Fdm.create(module, { paths: FIX_PATHS, onEvent: (e) => events.push(e) });
      c.loadModel("c172x_ext20");
      c.loadIC("reset01");
      c.runIC();
      c.setByName("external_reactions/f00/magnitude", 1e300); // a force no state can survive
      assert.equal(c.step(1000), StepResult.NONFINITE);
      assert.equal(c.state, State.DEAD);
      const crash = events.find((e) => e.type === "crash");
      assert.ok(crash && crash.type === "crash" && crash.reason === "non-finite");
      assert.equal(c.step(1), StepResult.NOT_RUNNING);
      c.dispose();
    });

    test("20 create/destroy cycles: heap in use is recorded", () => {
      const used = [];
      for (let i = 0; i < 20; i++) {
        const f = Fdm.create(module, { dt: 0 });
        f.loadScript("scripts/c1723.xml");
        f.bindOutputs(["position/h-sl-ft"]);
        f.runIC();
        assert.equal(f.step(100), StepResult.OK);
        f.dispose();
        used.push(module.heapInUse());
      }
      report.line(`${variant}: heap bytes in use after each of 20 create/load/step/destroy cycles (fixed memory ${module.memoryBytes()} bytes):`);
      report.line(`  ${used.join(" ")}`);
      report.line(`  growth from cycle 2 to cycle 20: ${used[19] - used[1]} bytes; heap top ${module.heapTop()} bytes`);
    });

    // Last: this kills the module.
    test("a WebAssembly trap becomes FdmCrash and the module is dead", () => {
      let err;
      try {
        module.call(() => module.raw._fdm_state(0x7ffffff0)); // a wild pointer: out-of-bounds read
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof FdmCrash);
      assert.ok(err instanceof Error);
      assert.equal(module.dead, true);
      assert.throws(() => module.version(), FdmCrash);
      assert.throws(() => Fdm.create(module), FdmCrash);
    });
  });
}
