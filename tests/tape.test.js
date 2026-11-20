// The tape, and native: a flight flown in WebAssembly is recorded, flown again from its tape, and compared with
// native JSBSim by FDM's lines. Proven here on a 60-second takeoff of each aircraft flown by a crude loop,
// long before the circuit depends on it. docs/milestones/1.md, pull request 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { DT, Flight, SETTLE_SECONDS } from '../src/sim/game.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report, loadWithData } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace } from '../jsbsim/tests/lib/scenario.js';
import { JUDGED, flyNative, flyWasm, liftoff } from './checkride/tape.js';

const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const ROTATE = new Map([[C172X, 55], [F16, 150]]);   // knots

/** A crude takeoff through the seven controls: full power, back stick at rotation speed, then 8 degrees of pitch and the wings level. No feet yet: the Cessna swings off the runway heading, which this test does not mind. */
function takeoff(module, aircraft) {
  const flight = Flight.start(module, aircraft, { record: true });
  let airborne = false;
  for (let step = 0; step < 60 / DT; step++) {
    const knots = flight.value('velocities/vc-kts'), pitch = flight.value('attitude/theta-rad') * DEG, bank = flight.value('attitude/phi-rad');
    airborne ||= flight.value('position/h-agl-ft') > aircraft.standingFt + 5;
    flight.fly({
      throttle: 1, brake: false,
      pitch: airborne ? clamp(0.08 * (8 - pitch), -1, 1) : knots > ROTATE.get(aircraft) ? 0.3 : 0,
      roll: airborne ? clamp(-2 * bank, -1, 1) : 0,
    });
    assert.equal(flight.step(1), 0);
  }
  const tape = flight.tape();
  flight.dispose();
  return tape;
}

const report = new Report('tape');
test.after(() => report.save());

for (const aircraft of [C172X, F16]) {
  test(`${aircraft.model}: a recorded takeoff flies again from its tape, bit for bit, and matches native JSBSim`, async () => {
    const modules = {}, tapes = {};
    for (const variant of VARIANTS) {
      modules[variant] = (await loadWithData(variant)).module;
      tapes[variant] = takeoff(modules[variant], aircraft);
    }
    const tape = tapes.weh;
    assert.equal(tape.steps, Math.round((SETTLE_SECONDS + 60) / DT));
    report.line(`${aircraft.model}: a ${tape.steps}-step tape (${SETTLE_SECONDS} s settling, 60 s of takeoff), ${tape.ins.length} inputs a step, ${tape.sets.length} values in the start`);

    // Read back that the flight is what its name says: it left the ground and climbed.
    const last = tape.states.rows - 1, width = tape.states.columns.length;
    const numberAt = (row, name) => tape.states.data[row * width + tape.states.columns.indexOf(name)];
    const touching = tape.states.columns.filter((name) => name.endsWith('/WOW')).some((name) => numberAt(last, name) !== 0);
    assert.ok(!touching && numberAt(last, 'position/h-agl-ft') > 100, `at the end: ${numberAt(last, 'position/h-agl-ft')} ft above the ground, ${touching ? 'touching' : 'nothing touching'}`);

    // 1. The tape is the whole truth: flown again by the C++ runner inside the same build, the same flight bit for bit.
    for (const variant of VARIANTS) {
      const again = flyWasm(modules[variant], tapes[variant], `${aircraft.model}-${variant}-again`);
      const same = bitEqual(tapes[variant].states, again);
      report.line(`  ${variant}: flown again from its tape by the C++ runner: ${same.equal ? `identical, ${again.rows} rows of ${again.columns.length} numbers` : `DIFFERENT (${same.reason})`}`);
      assert.ok(same.equal, same.reason);
    }
    // The two builds flew the same flight, so one tape serves both.
    assert.ok(bitEqual(tapes.weh.states, tapes.jseh.states).equal, 'both builds recorded the same flight');

    // 2. Matching native: the tape in native JSBSim, against each build, by FDM's lines.
    const { native, ensemble } = flyNative(tape, aircraft.model);
    const wasm = Object.fromEntries(VARIANTS.map((variant) => [variant, flyWasm(modules[variant], tape, `${aircraft.model}-${variant}-judged`, JUDGED)]));
    const nativeOff = liftoff(native, DT);
    assert.ok(nativeOff, 'native JSBSim left the ground too');
    const spread = (metric) => Math.max(...ensemble.map((member) => Math.abs(metric(liftoff(member, DT)) - metric(nativeOff))));
    for (const variant of VARIANTS) {
      // The whole flight: altitude 1 ft, angles 0.05 rad, speed 1 knot, or 3 times native's own spread where larger.
      const whole = classB(native, wasm[variant], ensemble);
      report.line(`  ${variant} against native, whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
      for (const c of whole.columns) report.line(`    ${c.column}: largest difference ${fmt(c.maxAbs)}; allowed ${fmt(c.allowed)} (line ${fmt(c.cap)}, native's own spread ${fmt(c.spread)})`);
      assert.ok(whole.pass, `${variant}: the whole-flight line`);
      // The first second: FDM's tighter line for a run with wheels on the ground.
      const rows = Math.round(1 / DT) + 1;
      const first = classN(headTrace(native, rows), headTrace(wasm[variant], rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
      report.line(`  ${variant} against native, first second: ${describeN(first)}`);
      assert.ok(first.pass, `${variant}: the first-second line`);

      // 3. The numbers a pilot would read, WebAssembly beside native.
      const off = liftoff(wasm[variant], DT);
      const lines = [['liftoff speed', 'kt', (l) => l.knots, 1], ['takeoff roll', 'ft', (l) => l.rollFt, 10]];
      for (const [what, unit, metric, line] of lines) {
        const s = spread(metric), allowed = Math.max(line, 3 * s), difference = Math.abs(metric(off) - metric(nativeOff));
        report.line(`  ${variant}, ${what}: ${metric(off).toFixed(3)} ${unit}; native ${metric(nativeOff).toFixed(3)}; difference ${fmt(difference)}; allowed ${fmt(allowed)} (line ${line}, native's own spread ${fmt(s)})`);
        assert.ok(difference <= allowed, `${variant}: ${what}`);
      }
    }
  });
}
