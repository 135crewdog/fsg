// The simple F-4C: what the plan asks to be reported, with no pass or fail, beside Wings', the data-built
// jet's and the book's. Milestone 3 re-planned, pull request 3 (docs/milestones/3-replan.md, "PR 3 ...
// Reported, no pass or fail"). The lines themselves are tests/simple-f4c.test.js; the test pilots are
// tests/checkride/simple-pilot.js; where each figure beside ours comes from is in
// tests/checkride/simple-reference.js and f4c-reference.js. The owner judges these by flying.
//
// A degree of tilt is one twenty-third of the stick: the tilt is nothing for 2 degrees and then a straight
// line to full stick at 25 (Wings' tilt, which the simple airplanes take straight: the owner, 28 November 2026).
// So a stick position is 2 degrees and 23 more for all of it.
//
// Everything printed is kept in jsbsim/build/results/checkride-simple-f4c-reported.txt.
import { test } from 'node:test';
import { F4C_SIMPLE } from '../src/sim/aircraft/f4c-simple.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { moduleWith } from './checkride/files.js';
import * as F4C_REFERENCE from './checkride/f4c-reference.js';
import * as REFERENCE from './checkride/simple-reference.js';
import * as P from './checkride/simple-pilot.js';

const A = F4C_SIMPLE, AB = 1, MIL = A.mil, DEGREE = 1 / 23;
const { WINGS_ROLL_RATE_250, WINGS_ROLL_RATE_400, WINGS_ROLL_RATE_600, WINGS_STALL, WINGS_IDLE_SLOWDOWN, WINGS_TAKEOFF, F4E_APPROACH, WEIGHT } = F4C_REFERENCE;
const { WINGS_HELD_TAKEOFF, WINGS_G_PER_DEGREE, WINGS_LEVEL_TILT, WINGS_LEVEL_TILT_LANDING, WINGS_LOOP, WINGS_MIL_TOP_SPEEDS, WINGS_ACCELERATION, DATA_BUILT_G_PER_DEGREE, DATA_BUILT_STRAIGHT_G_PER_DEGREE,
  DATA_BUILT_FINAL, SUSTAINED_G_AT_450, DATA_BUILT_LOOP, STALL_CLEAN } = REFERENCE;
const f0 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(0)), f1 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(1)), f2 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(2));
/** A stick position as a pilot holds it: per cent, which way, and the degrees of tilt. */
const tilt = (stick) => (Math.abs(stick) < 0.005 ? 'level' : `${f0(Math.abs(stick) * 100)}% ${stick > 0 ? 'back' : 'forward'} (${f1(2 + 23 * Math.abs(stick))} degrees of tilt)`);

const report = new Report('checkride-simple-f4c-reported');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);
let loaded;
const module = () => (loaded ??= moduleWith(A, 'weh'));

test('simple f4c, reported (no pass or fail): the takeoff with the tilt simply held at full, three quarters and a half', async () => {
  const m = await module();
  report.line('simple f4c, reported: the takeoff, full afterburner, the back tilt simply held from 80 knots (the owner eases it; this is what happens if he does not):');
  for (const [name, flaps] of [['1/2 flaps (the game\'s takeoff setting)', 0.5], ['full flaps (as Wings\' table was flown)', 1]]) {
    for (const [stick, wingsNose, wingsOff, wingsPitch, wingsLater] of WINGS_HELD_TAKEOFF.value) {
      const t = P.takeoff(m, A, P.heldFrom80(stick), { flaps });
      const later = [2, 5, 10].map((s) => { const r = t.after(s); return r ? `${s} s later the nose ${f0(r.pitch)} degrees up, ${f0(r.kt)} kt, ${f0(r.agl)} ft${Math.abs(r.alpha) > t.angle ? ', stalled' : ''}` : `${s} s later: not flown`; });
      say(`${name}, ${f0(stick * 100)}% back: the nosewheel lifts at ${f0(t.nose?.kt)} kt, airborne at ${f0(t.off?.kt)} kt with the nose ${f1(t.off?.pitch)} degrees up after ${f0(t.off?.rollFt)} ft; ${later.join('; ')}; touched besides the wheels: ${t.touched.join(', ') || 'nothing'}`);
      if (flaps === 1) say(`    Wings: the nosewheel off at ${wingsNose} kt, airborne at ${wingsOff}${wingsPitch === null ? '' : ` with the nose ${wingsPitch} degrees up`}; 2 s later the nose ${wingsLater} degrees up`);
    }
  }
  say(`(${WINGS_HELD_TAKEOFF.source}, ${WINGS_HELD_TAKEOFF.where}; Wings' ground roll ${WINGS_TAKEOFF.value[1]} ft)`);
});

test('simple f4c, reported (no pass or fail): g for one more degree of tilt at 180, 250, 350, 450 and 550 knots; the nose\'s overshoot, low and high, on both of JSBSim\'s stepping rules', async () => {
  const m = await module(), speeds = [180, 250, 350, 450, 550];
  report.line('simple f4c, reported: g for one more degree of tilt from level flight at 2,000 ft (settled, 2 to 3 s after), and how far the g overshoots on the way:');
  speeds.forEach((knots, i) => {
    const s = P.stickStep(m, A, { heightFt: 2000, knots, more: DEGREE });
    say(`${knots} kt: ${f2(s.g - s.g0)} g (overshoot ${f0(s.overshoot * 100)}%; level flight there holds ${tilt(s.stick0)}) | Wings ${WINGS_G_PER_DEGREE.value[i]} | the data-built jet as flown in 0.0.22: ${DATA_BUILT_G_PER_DEGREE.value[i]}; with its tilt straight to the tail: ${DATA_BUILT_STRAIGHT_G_PER_DEGREE.value[i]}`);
  });
  say(`(Wings: ${WINGS_G_PER_DEGREE.where}; the data-built jet: ${DATA_BUILT_G_PER_DEGREE.source}, ${DATA_BUILT_G_PER_DEGREE.where})`);
  // The stepping rule (src/sim/aircraft/f4c-simple.js, `stepping`), checked once: the same step on JSBSim's default.
  const DEFAULT = { ...A, stepping: [1, 3, 1, 4] };
  for (const [heightFt, knots] of [[2000, 350], [20000, 350], [40000, 300], [40000, 500]]) {
    const [ours, theirs] = [A, DEFAULT].map((aircraft) => P.stickStep(m, aircraft, { heightFt, knots, more: DEGREE }));
    say(`${knots} kt at ${heightFt.toLocaleString('en-US')} ft (Mach ${f2(ours.mach)}): ${f2(ours.g - ours.g0)} g, overshoot ${f1(ours.overshoot * 100)}%; on JSBSim's default stepping ${f2(theirs.g - theirs.g0)} g, overshoot ${f1(theirs.overshoot * 100)}%`);
  }
});

test('simple f4c, reported (no pass or fail): tilt for level flight at 180, 250, 450 and 600 knots clean, and at 150 and 180 with gear and flaps; a 3 degree final at 150 knots', async () => {
  const m = await module();
  const level = (knots, controls) => { const flight = P.inTheAir(m, A, 500, knots, { controls }), out = { stick: flight.trimmed.pitch, throttle: flight.trimmed.throttle, alpha: flight.get('aero/alpha-deg') }; flight.dispose(); return out; };
  report.line('simple f4c, reported: the tilt and the throttle that hold level flight at 500 ft (JSBSim\'s own trim; phone level holds 350 kt):');
  [180, 250, 450, 600].forEach((knots, i) => { const l = level(knots, {}); say(`${knots} kt clean: ${tilt(l.stick)}, throttle ${f0(l.throttle * 100)}%, angle of attack ${f1(l.alpha)} | Wings ${f0(Math.abs(WINGS_LEVEL_TILT.value[i]) * 100)}% ${WINGS_LEVEL_TILT.value[i] > 0 ? 'back' : 'forward'}`); });
  [150, 180].forEach((knots, i) => { const l = level(knots, { gear: true, flaps: 1 }); say(`${knots} kt, gear and full flaps: ${tilt(l.stick)}, throttle ${f0(l.throttle * 100)}%, angle of attack ${f1(l.alpha)} | Wings ${f0(WINGS_LEVEL_TILT_LANDING.value[i] * 100)}% back`); });
  say(`(Wings: ${WINGS_LEVEL_TILT.where}; ${WINGS_LEVEL_TILT_LANDING.where})`);
  const final = P.onFinal(m, A, { knots: 150 }), stall = P.stallSpeed(m, A, { fromKt: 170, heightFt: 6000, gear: true, flaps: 1 });
  const [e, at, per] = F4E_APPROACH.value;
  report.line(`simple f4c, reported: on a ${f1(final.slopeDeg)} degree final at ${f1(final.kt)} kt with gear and full flaps (${f0(-final.fpm)} ft/min down): ${f0(final.kt - stall.kt)} kt above its stall there (${f1(stall.kt)} kt), the angle of attack ${f1(final.alpha)} of the ${f1(final.angle)} degrees it stalls at; the nose ${f1(final.nose)} degrees up; the throttle at ${f0(final.throttle * 100)}% (MIL is ${MIL * 100}%); the tilt ${tilt(final.stick)}`);
  say(`beside it: the data-built jet flew final at ${cite(DATA_BUILT_FINAL)}; the F-4E appendix's approach speed at ${WEIGHT.value.toLocaleString('en-US')} lb is ${f0(e + per * (WEIGHT.value - at) / 1000)} kt (${F4E_APPROACH.source}, ${F4E_APPROACH.where})`);
});

test('simple f4c, reported (no pass or fail): sustained g at 450 knots at sea level; the loop\'s speed over the top and height gained; roll rate at 250, 400 and 600 knots', async () => {
  const m = await module();
  const turn = P.sustainedTurn(m, A, { heightFt: 500, knots: 450, throttle: AB });
  report.line(`simple f4c, reported: sustained in a level turn at 450 kt and 500 ft in full afterburner: ${f1(turn.out?.g)} g (${tilt(turn.stick)}; a full circle from ${f1(turn.from.kt)} to ${f1(turn.out?.kt)} kt in ${f0(turn.seconds)} s, height ${f0(turn.low)} to ${f0(turn.high)} ft) | NASA CR-2144's lift and drag imply ${SUSTAINED_G_AT_450.value[0]}; the data-built jet ${SUSTAINED_G_AT_450.value[1]} (${SUSTAINED_G_AT_450.source})`);
  const stick = P.stickForG(m, A, { g: 4, heightFt: 5000, knots: 450, throttle: AB }), l = P.loop(m, A, { heightFt: 5000, knots: 450, throttle: AB, stick, slowestKt: STALL_CLEAN.value });
  report.line(`simple f4c, reported: the loop, the 4 g tilt (${tilt(stick)}) held from 450 kt at 5,000 ft in full afterburner: ${f0(l.top?.kt)} kt over the top, ${f0(l.gainedFt)} ft gained, ${f0(l.seconds)} s to the top | Wings' own loop: ${cite(WINGS_LOOP)} | the data-built jet: ${cite(DATA_BUILT_LOOP)}`);
  const wings = [WINGS_ROLL_RATE_250, WINGS_ROLL_RATE_400, WINGS_ROLL_RATE_600];
  report.line('simple f4c, reported: full right tilt from level flight at 500 ft, the steady roll rate (the mean from 1.5 to 3 s):');
  [250, 400, 600].forEach((knots, i) => { const r = P.rollRate(m, A, { heightFt: 500, knots }); say(`${knots} kt: ${f0(r.dps)} degrees a second (90 degrees of bank in ${f2(r.secondsTo90)} s; sideslip ${f1(r.mostSlip)} degrees at most with the copilot's feet) | Wings ${wings[i].value}`); });
  const slow = P.rollRate(m, A, { heightFt: 500, knots: 150 });
  say(`150 kt: ${f0(slow.dps)} degrees a second (90 degrees of bank in ${f2(slow.secondsTo90)} s; sideslip ${f1(slow.mostSlip)} degrees at most)`);
});

test('simple f4c, reported (no pass or fail): MIL top speeds; 300 to 600 knots in afterburner; idle slow-down with the boards in and out', async () => {
  const m = await module();
  const low = P.topSpeed(m, A, { heightFt: 500, knots: 550, throttle: MIL }), mid = P.topSpeed(m, A, { heightFt: 30000, knots: 330, throttle: MIL }), high = P.topSpeed(m, A, { heightFt: 40000, knots: 280, throttle: MIL });
  report.line(`simple f4c, reported: top speed at MIL, level: ${f0(low.kt)} kt at 500 ft (Mach ${f2(low.mach)}); Mach ${f2(mid.mach)} at 30,000 ft; Mach ${f2(high.mach)} at 40,000 ft | Wings ${cite(WINGS_MIL_TOP_SPEEDS)}`);
  const sea = P.flyLevel(m, A, { heightFt: 500, knots: 280, throttle: AB, until: (r) => r.kt >= 601, seconds: 120 }), ten = P.flyLevel(m, A, { heightFt: 10000, knots: 280, throttle: AB, until: (r) => r.kt >= 501, seconds: 120 });
  report.line(`simple f4c, reported: full afterburner, level: 300 to 600 kt at 500 ft in ${f1(P.secondsBetween(sea, 300, 600))} s; 300 to 500 kt at 10,000 ft in ${f1(P.secondsBetween(ten, 300, 500))} s | Wings ${cite(WINGS_ACCELERATION)}`);
  const slowing = (speedbrake) => P.secondsBetween(P.flyLevel(m, A, { heightFt: 10000, knots: 420, throttle: 0, controls: { speedbrake }, until: (r) => r.kt <= 249, seconds: 200 }), 400, 250);
  const opened = P.handsOff(m, A, { heightFt: 10000, knots: 350, seconds: 4, controls: { speedbrake: true } });
  report.line(`simple f4c, reported: idle, level at 10,000 ft, 400 to 250 kt: ${f0(slowing(false))} s with the boards in, ${f0(slowing(true))} s with them out; opened at 350 kt with the stick held at neutral the nose drops ${f1(opened.start.pitch - Math.min(...opened.rows.map((r) => r.pitch)))} degrees in 4 s | Wings ${cite(WINGS_IDLE_SLOWDOWN)}`);
});

test('simple f4c, reported (no pass or fail): the stall\'s nose attitude and sink; the full-afterburner, full-back climb', async () => {
  const m = await module();
  const s = P.levelStall(m, A, { fromKt: 190, heightFt: 3000 });
  report.line(`simple f4c, reported: the stall as Wings' checkride flies it (clean, idle, holding its height at 3,000 ft, then the stick held where it was): it stalls at ${f1(s.at.kt)} kt with the nose ${f1(s.at.pitch)} degrees up, the stick ${f0(s.stick * 100)}% back; over the next 5 s the nose goes from ${f0(s.nose[1])} to ${f0(s.nose[0])} degrees up, and 5 s on it is sinking ${f0(-s.after.fpm)} ft/min at ${f0(s.after.kt)} kt, the angle of attack ${f0(s.after.alpha)} | Wings ${cite(WINGS_STALL)}`);
  const held = P.powerOffStall(m, A, { fromKt: 190 });
  say(`with the stick brought on to full back and held 5 s (the power-off stall line): the nose ${f0(held.held.nose[0])} to ${f0(held.held.nose[1])} degrees up, sinking up to ${f0(-held.held.fpm[0])} ft/min at ${f0(held.held.kt[0])} to ${f0(held.held.kt[1])} kt: a nose-high mush with a high sink rate`);
  report.line('simple f4c, reported: full afterburner and full back tilt held 15 s from level flight at 2,000 ft:');
  for (const knots of [250, 350, 450]) {
    const c = P.fullBackClimb(m, A, { heightFt: 2000, knots, throttle: AB });
    const five = c.at(5), end = c.at(15);
    say(`from ${knots} kt: ${f1(c.mostG)} g at most; ${c.stalledAfter === null ? 'never stalled' : `stalled after ${f1(c.stalledAfter)} s at ${f0(c.stalledAt.kt)} kt with the nose ${f0(c.stalledAt.pitch)} degrees up`}; 5 s in: the nose ${f0(five.pitch)} degrees up, ${f0(five.kt)} kt, ${f0(five.ft - c.from.ft)} ft higher; the nose reaches ${f0(c.noseHighest)} degrees; the slowest ${f0(c.slowest)} kt; ${f0(c.gainedFt)} ft gained at most; after 15 s ${f0(end.kt)} kt, the nose ${f0(end.pitch)}, banked ${f0(Math.abs(end.bank))}`);
  }
});

function cite(ref) {
  return `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
}
