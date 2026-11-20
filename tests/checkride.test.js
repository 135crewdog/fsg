// The checkride: each aircraft takes off, flies a circuit and lands, flown by a pilot of simple loops through
// the game's seven controls; then the flight's tape is flown again in the same build and in native JSBSim,
// and the numbers a pilot would read are set side by side. The "done" lines are in docs/milestones/1.md
// (pull request 10), written before any of this was flown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { DT } from '../src/sim/game.js';
import { FIELD } from '../src/sim/world.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report, loadWithData } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace } from '../jsbsim/tests/lib/scenario.js';
import { CIRCUIT, flyCircuit } from './checkride/circuit.js';
import { JUDGED, flyNative, flyWasm, headOf, highest, liftoff, stopped, touchdown } from './checkride/tape.js';

const report = new Report('checkride');
test.after(() => report.save());
const { runway } = FIELD;
const firstThird = { from: -runway.startBackFt, to: -runway.startBackFt + runway.lengthFt / 3 };

for (const aircraft of [C172X, F16]) {
  test(`${aircraft.model}: the circuit. Take off, a left-hand pattern, land, stop; then the tape again in the same build, and in native JSBSim`, async () => {
    const how = CIRCUIT.get(aircraft), modules = {}, flown = {};
    for (const variant of VARIANTS) {
      modules[variant] = (await loadWithData(variant)).module;
      flown[variant] = flyCircuit(modules[variant], aircraft, { record: true });
    }
    for (const variant of VARIANTS) {
      // ---- The circuit is flown, by the seven controls alone ----
      const c = flown[variant], say = (line) => report.line(`  ${variant}: ${line}`);
      report.line(`${aircraft.model}, ${variant}: ${c.seconds.toFixed(0)} s from parked to stopped`);
      assert.ok(c.onlyTheSeven, 'the pilot used only the seven controls');
      assert.equal(c.ended, null, `no crash (${JSON.stringify(c.ended)})`);
      assert.equal(c.phase, 'stop');
      assert.ok(c.marks.liftoff && c.marks.touchdown && c.marks.stopped, 'it took off, landed and stopped');
      say(`liftoff at ${c.marks.liftoff.knots.toFixed(0)} kt, ${c.marks.liftoff.along.toFixed(0)} ft down the runway; highest ${c.highest.toFixed(0)} ft`);

      const d = c.downwind;
      say(`downwind for ${d.seconds.toFixed(0)} s: ${d.low.toFixed(0)} to ${d.high.toFixed(0)} ft (target ${how.patternFt}), ${d.slow.toFixed(0)} to ${d.fast.toFixed(0)} kt (target ${how.downwindKt})`);
      assert.ok(d.seconds > 30, 'there was a downwind leg');
      assert.ok(d.low >= how.patternFt - 100 && d.high <= how.patternFt + 100, 'downwind within 100 ft of the pattern height for its whole length');
      assert.ok(d.slow >= how.downwindKt - 10 && d.fast <= how.downwindKt + 10, 'downwind within 10 kt of the target for its whole length');

      const landing = c.touches.filter((e) => e.time > c.marks.liftoff.t + 10);
      const first = landing[0], td = c.marks.touchdown;
      say(`touchdown: ${first.point} first, ${td.along.toFixed(0)} ft down the runway, ${Math.abs(td.right).toFixed(1)} ft ${td.right > 0 ? 'right' : 'left'} of the centreline, ${td.knots.toFixed(0)} kt, sinking ${first.closingFpm.toFixed(0)} ft/min` +
        (c.touchdowns.at(-1) ? `, ${c.touchdowns.at(-1).g.toFixed(1)} g` : ''));
      say(`every touch of the landing: ${landing.map((e) => `${e.point} ${e.closingFpm.toFixed(0)}`).join(', ')} ft/min`);
      assert.ok(/main wheel/.test(first.point), `touchdown on the main wheels (${first.point})`);
      assert.ok(td.along >= firstThird.from && td.along <= firstThird.to, `in the first third of the runway (${td.along} ft)`);
      assert.ok(Math.abs(td.right) <= 25, `within 25 ft of the centreline (${td.right} ft)`);
      for (const e of landing) assert.ok(e.closingFpm <= 600, `${e.point} at ${e.closingFpm} ft/min`);
      assert.ok(c.touches.every((e) => e.wheel), `no airframe point touched (${c.touches.filter((e) => !e.wheel).map((e) => e.point).join(', ')})`);

      say(`stopped ${c.end.along.toFixed(0)} ft down the runway, ${Math.abs(c.end.right).toFixed(1)} ft from the centreline, brakes ${c.brakeOn ? 'on' : 'off'}; fuel changed by ${c.fuelChange} lb`);
      assert.ok(c.end.groundKt < 1 && c.brakeOn, 'stopped, brakes on');
      assert.ok(c.end.along >= -runway.startBackFt && c.end.along <= runway.lengthFt - runway.startBackFt && Math.abs(c.end.right) <= runway.widthFt / 2, 'stopped on the runway');
      assert.equal(c.fuelChange, 0, 'fuel as at the start');
      assert.ok(c.events.every((e) => e.type === 'touch' || e.type === 'touchdown'), `nothing else was reported (${c.events.filter((e) => e.type !== 'touch' && e.type !== 'touchdown').map((e) => e.type).join(', ')})`);

      // ---- The tape is the whole truth ----
      // The whole flight again, step by step through the wrapper as the game runs; and its first 70 seconds
      // (the settle and the takeoff) by the C++ runner, which has no room for more (tape.js, flyWasm).
      const again = flyWasm(modules[variant], c.tape, `circuit-${aircraft.model}-${variant}-again`, undefined, { stepByStep: true });
      const same = bitEqual(c.tape.states, again);
      say(`flown again from its tape (${c.tape.steps} steps), step by step: ${same.equal ? 'identical, bit for bit' : `DIFFERENT (${same.reason})`}`);
      assert.ok(same.equal, same.reason);
      const head = headOf(c.tape, Math.round(70 / DT));
      const headAgain = bitEqual(head.states, flyWasm(modules[variant], head, `circuit-${aircraft.model}-${variant}-head`));
      say(`its first 70 s by the C++ runner: ${headAgain.equal ? 'identical, bit for bit' : `DIFFERENT (${headAgain.reason})`}`);
      assert.ok(headAgain.equal, headAgain.reason);
    }
    assert.ok(bitEqual(flown.weh.tape.states, flown.jseh.tape.states).equal, 'both builds flew the same flight');

    // ---- Matching native, over the whole flight, and the checkride's numbers side by side ----
    const tape = flown.weh.tape;
    const { native, ensemble } = flyNative(tape, `circuit-${aircraft.model}`);
    const numbers = [
      ['liftoff speed', 'kt', (t) => liftoff(t, DT)?.knots, 1],
      ['takeoff roll', 'ft', (t) => liftoff(t, DT)?.rollFt, 10],
      ['highest altitude', 'ft', (t) => highest(t), 1],
      ['touchdown speed', 'kt', (t) => touchdown(t, DT)?.knots, 1],
      ['touchdown sink', 'ft/min', (t) => touchdown(t, DT)?.sinkFpm, 50],
      ['touchdown point, from the start', 'ft', (t) => touchdown(t, DT)?.fromStartFt, 10],
      ['stopping point, from the start', 'ft', (t) => stopped(t).fromStartFt, 10],
    ];
    const failures = [];
    for (const variant of VARIANTS) {
      const wasm = flyWasm(modules[variant], tape, `circuit-${aircraft.model}-${variant}-judged`, JUDGED, { stepByStep: true });
      const whole = classB(native, wasm, ensemble);
      report.line(`  ${variant} against native, whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
      for (const col of whole.columns) report.line(`    ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
      if (!whole.pass) failures.push(`${variant}: the whole-flight line`);
      const rows = Math.round(1 / DT) + 1;
      const firstSecond = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
      report.line(`  ${variant} against native, first second: ${describeN(firstSecond)}`);
      if (!firstSecond.pass) failures.push(`${variant}: the first-second line`);
      for (const [what, unit, metric, line] of numbers) {
        const here = metric(wasm), there = metric(native);
        const own = ensemble.map((member) => metric(member));
        if (here === undefined || there === undefined || own.some((x) => x === undefined)) { report.line(`  ${variant}, ${what}: MISSING (WebAssembly ${here}, native ${there}, nudged ${own.join(', ')})`); failures.push(`${variant}: ${what} missing`); continue; }
        const spread = Math.max(...own.map((x) => Math.abs(x - there))), allowed = Math.max(line, 3 * spread), difference = Math.abs(here - there);
        report.line(`  ${variant}, ${what}: ${here.toFixed(3)} ${unit}; native ${there.toFixed(3)}; difference ${fmt(difference)}; allowed ${fmt(allowed)} (line ${line}, native's own spread ${fmt(spread)})${difference > line ? '  <- over the line itself; passes only on native\'s own spread' : ''}`);
        if (difference > allowed) failures.push(`${variant}: ${what}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}
