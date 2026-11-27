// The F-4C at the edge: the stall, the nose slice, wing rock, ailerons and rudder at high angle of attack, the
// recovery, a spin, AFWAL's wind-up turn; and the buffet band. Milestone 3, pull request 10 (docs/milestones/3.md,
// "PR 10. The edge"). Each test that holds a line of the plan is named for the line, in the plan's words; the
// lines were written before any of this was flown. Reported items have no assertion on the reported number.
// Three of the plan's lines are not met: the nose slice in still air (nothing starts it within 10 s), the ailerons at
// the stall (at 22 degrees the jet rolls the way the stick asks), and the recovery (it asked for the wings within 30
// degrees of level, which neutral ailerons cannot give). They are flown and printed every run, marked "the plan's line
// as written, NOT MET", with no assertion on what is not met, and listed in checkride-f4c-edge-not-met.json. The owner
// replaced each with a line of his own on 27 November 2026; those are asserted.
//
// Every flight here is clean, at 38,924 lb (CR-2144's weight, the file's own: read back), started level at
// 15,000 ft (AFWAL's one height) and 250 knots by JSBSim's own trim, over ground far below. The jet's own flight
// controls (feel system, pitch, roll and yaw dampers, the interconnect, which is out with the flaps up) are in, as
// the game flies it, except in AFWAL's wing-rock case, which its report says was flown "with all augmentation
// off" (section G, PDF p.59) and is flown so here too. "Feet off" is the copilot's feet out (NO_FEET); where the
// pilot's rudder is moved, it goes in through the same input the copilot's feet use (rudderFeet).
//
// How each line is read, where the plan's words leave a choice:
//   the 1 g stall      slowing 1 knot a second: the pilot works the stick so the airspeed follows a line falling
//                      1 knot a second from 250, at idle, ailerons neutral, until the angle of attack reaches 22
//                      degrees; then the stick is held where it is. "The nose falls" is the pitch attitude at 22
//                      degrees less the lowest in the 5 s after. The stall speed is, as the line says, the speed at
//                      22 degrees: the calibrated airspeed flown there. Reduced to 1 g the flight-test way
//                      (tests/f4c-low.test.js: over the square root of the load across the flight path) it is
//                      printed beside it, but not used: slowing at idle the path is bending down there. It is
//                      flown as the game flies it, the copilot's feet on: the line does not say feet off.
//   the nose slice     feet off, from that stall, the pilot brings the angle of attack from 22 to 24 degrees (the
//                      band's middle) at a degree a second and holds it there with the stick, ailerons neutral, at
//                      idle. "Swings off to one side at more than 10 degrees a second within 10 s" (within N s is by
//                      then and still true after): at some moment no later than 10 s after reaching 22, the heading
//                      is moving one way at more than 10 deg/s (over half a second), and a second later it is further
//                      off that way still: a swing away, not one side of a rock. Nothing disturbs the air (the game's
//                      standard day) and the model is the same left and right, so nothing but the last digits of the
//                      sums starts it: the test adds no disturbance the line does not name. What a small one does is
//                      reported beside it.
//   buffet             the first speed in the 1 g stall's slowing at which the buffet (src/sim/buffet.js, through the
//                      F-4C's band) is above nothing, less the stall speed.
//   ailerons           at the stall angle (22), feet off, the pitch stick held where it is and the roll stick put
//                      full right: "the nose yaws left" is the heading's first move of half a degree being left;
//                      "within 3 s it is rolling left" is the roll rate left from some moment no later than 3 s and
//                      still left 1 s after that, at 4 s.
//   rudder, and the copilot's feet with the tilt, at 18 degrees: started at 18 by the same slowing, the pitch stick
//                      then held; "rolls it right" is read as the aileron line is: the roll rate right from some moment
//                      no later than 3 s and still right at 4 s, and the bank to the right at 3 s.
//   recovery           from the nose slice (the moment the heading swings at more than 10 deg/s, held at the band's
//                      top, 25.5 degrees, as long as that takes), the stick forward to the flight manual's 5 to 10
//                      units (3 to 6 degrees, scaled by CR-2144's on-speed: 11.7 degrees at 19.2 units), the pilot
//                      holding 4 degrees with the stick, ailerons and rudder neutral (feet off), idle. "Flying again"
//                      is the angle of attack below 12, the wings within 30 degrees of level and the speed higher
//                      than half a second before, all at once; "within 10 s" is from some moment no later than 10 s
//                      and still so, unbroken, to 15 s.
//   let go             from the stall (22, the copilot's feet on as the game flies), full back and full right tilt
//                      for 5 s, then the phone neutral: flying again, by the same measure, from some moment no later
//                      than 20 s after letting go, still so to 25 s.
//   a spin             from the stall, pro-spin controls for 15 s: the stick full back, full right rudder and full
//                      left aileron (aileron against the spin is pro-spin on the F-4: the flight manual says aileron
//                      with the spin speeds the recovery). Turns are counted about the vertical. Then the flight
//                      manual's out-of-control recovery (section III).
//
// Every measured number is printed beside its reference (tests/checkride/f4c-reference.js) and kept in
// jsbsim/build/results/checkride-f4c-edge.txt.
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { BUFFET_FULL_KT, buffetOf } from '../src/sim/buffet.js';
import { wingsFeet } from '../src/sim/assists.js';
import { DT, Flight } from '../src/sim/game.js';
import { gentle } from '../src/input/pilot.js';
import { MAPPING, shape } from '../src/input/tilt.js';
import { RESULTS_DIR as RESULTS, Report } from '../jsbsim/tests/lib/harness.js';
import { GROUND, NO_FEET, rudderFeet } from './checkride/conditions.js';
import { moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';

const { WEIGHT, WING_AREA, THRUST_TILT, NOSE_SLICE_ALPHA, WING_ROCK_ALPHA, POWER_APPROACH_ALPHA, ON_SPEED_UNITS, BUFFET_ONSET_ABOVE_STALL, WING_ROCK_FROM, STALL_UNITS,
  STALL_RECOVERY_UNITS, AILERON_WRONG_WAY, RUDDER_ROLLS, STALL_HEIGHT_LOSS, SPIN_HEIGHT_PER_TURN, SPIN_YAW_RATE, WING_ROCK_TIME_HISTORY, WIND_UP_TURN_DEPARTURE, WINGS_STALL } = REFERENCE;
const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
const f1 = (x) => x.toFixed(1);

const report = new Report('checkride-f4c-edge');
/**
 * The plan's three lines as written that are not met (pull request 10): flown and printed every run, beside their
 * numbers, with no assertion on what is not met; the owner replaced each on 27 November 2026 with a line of his own
 * (below, each named so). Written to jsbsim/build/results/checkride-f4c-edge-not-met.json, as tests/f4c-fcs.test.js
 * does for pull request 6's.
 */
const NOT_MET = [];
test.after(() => {
  report.save();
  writeFileSync(join(RESULTS, 'checkride-f4c-edge-not-met.json'), `${JSON.stringify(NOT_MET, null, 1)}\n`);
});
const say = (line) => report.line(`  ${line}`);

let loaded = null;
const module = () => (loaded ??= moduleWith(F4C, 'weh'));

/** The stall angle: where AFWAL has the nose slice begin, the angle the stall speed is read at. */
const STALL_ALPHA = NOSE_SLICE_ALPHA.value[0];
/** The flight manual's recovery angle of attack, 5 to 10 units, in degrees by CR-2144's on-speed (11.7 degrees at 19.2 units): 3.0 to 6.1. */
const RECOVERY_ALPHA = 4;

/** What a test reads each step: degrees, deg/s, knots, feet, ft/min, g. */
function read(f) {
  return {
    t: f.value('simulation/sim-time-sec'), kt: f.value('velocities/vc-kts'), a: f.value('aero/alpha-rad') * DEG, b: f.value('aero/beta-rad') * DEG,
    th: f.value('attitude/theta-rad') * DEG, ph: f.value('attitude/phi-rad') * DEG, psi: f.value('attitude/psi-rad') * DEG,
    p: f.value('velocities/p-rad_sec') * DEG, q: f.value('velocities/q-rad_sec') * DEG, r: f.value('velocities/r-rad_sec') * DEG,
    h: f.value('position/h-sl-ft'), nz: f.value('accelerations/Nz'), climb: -f.value('velocities/v-down-fps') * 60, flaps: f.value('fcs/flap-pos-norm'),
  };
}
/** The turn rate about the vertical, deg/s, right positive: the body's rates put into the Earth's frame (no trouble pointing straight down). */
const vertical = (s) => {
  const [th, ph] = [s.th / DEG, s.ph / DEG];
  return -s.p * Math.sin(th) + s.q * Math.sin(ph) * Math.cos(th) + s.r * Math.cos(ph) * Math.cos(th);
};
/** The change of heading from `a` to `b`, degrees, -180 to 180. */
const turned = (a, b) => ((b - a + 540) % 360) - 180;

/** One step, the flight must go on. */
function step(f) {
  assert.equal(f.step(1), 0, 'JSBSim stepped');
  assert.equal(f.ended, null, 'the flight goes on');
}

/**
 * The start: clean, level at 15,000 ft and 250 knots by JSBSim's trim, the jet's own flight controls in, read back.
 * `assists` the copilot (the game's own unless given); `sets` added to the start (a test switch).
 */
function start(m, { assists = F4C.assists, sets = [], heightFt = 15000, knots = 250, controls = null } = {}) {
  const f = Flight.start(m, F4C, { airborne: { heightFt, knots }, terrain: GROUND, assists, sets, ...(controls ? { controls } : {}) });
  assert.equal(f.get('inertia/weight-lbs'), WEIGHT.value, 'the weight');
  assert.ok(Math.abs(f.value('velocities/vc-kts') - knots) < 0.5 && Math.abs(f.value('position/h-sl-ft') - heightFt) < 1, 'at the speed and height asked');
  if (!controls) assert.ok(f.get('gear/gear-pos-norm') === 0 && f.get('fcs/flap-pos-norm') === 0, 'clean');
  assert.equal(f.get('fcs/test/straight'), 0, 'the real flight controls');
  return f;
}

/** The speed reduced to 1 g: the calibrated airspeed over the square root of the load across the flight path (lift and the thrust's part), as tests/f4c-low.test.js does. */
function oneG(f) {
  const s = read(f), tilt = (s.a + THRUST_TILT.value) / DEG;
  const thrust = f.get('propulsion/engine[0]/thrust-lbs') + f.get('propulsion/engine[1]/thrust-lbs');
  const n = (f.get('aero/coefficient/lift') * f.get('aero/qbar-psf') * WING_AREA.value + thrust * Math.sin(tilt)) / WEIGHT.value;
  return { n, kt: s.kt / Math.sqrt(n) };
}

/**
 * The 1 g stall's slowing: the pilot works the stick so the airspeed follows a line falling `rate` knots a second
 * from where it is, at `throttle`, ailerons neutral, until the angle of attack reaches `to`. `each(s)` is called
 * every step with the reading (the pilot may add to the roll stick by returning a number). Returns the trace and
 * the reading where it got there.
 */
function slowTo(f, to, { rate = 1, throttle = 0, each = null } = {}) {
  const v0 = read(f).kt, trace = [];
  let held = f.controls.pitch, last = null, acc = 0;
  for (let k = 0; k < 400 / DT; k++) {
    const s = read(f), t = k * DT, err = s.kt - (v0 - rate * t);
    if (last !== null) acc += ((s.kt - last) / DT - acc) * (DT / 0.5);
    last = s.kt;
    s.buffet = buffetOf(F4C.buffet, s.a, s.kt, s.flaps);
    trace.push(s);
    if (s.a >= to) { const g = oneG(f); return { trace, at: { ...s, n: g.n, vs: g.kt } }; }
    held = clamp(held + 0.002 * err * DT, -1, 1);
    const roll = each ? each(s) ?? 0 : 0;
    f.fly({ throttle, pitch: clamp(held + 0.01 * err + 0.05 * (acc + rate) - 0.02 * s.q, -1, 1), roll });
    step(f);
  }
  throw new Error(`the angle of attack never reached ${to}`);
}

/** The pilot holds an angle of attack with the stick, brought there at a degree a second, for `seconds` or until `until(s, t)` is true; returns the trace. */
function holdAlpha(f, target, seconds, { roll = 0, throttle = 0, until = null } = {}) {
  let held = f.controls.pitch, want = read(f).a;
  const trace = [];
  for (let k = 0; k < seconds / DT; k++) {
    const s = read(f);
    s.time = k * DT;
    trace.push(s);
    if (until && until(s, trace)) break;
    want = want < target ? Math.min(target, want + DT) : Math.max(target, want - DT);
    const err = want - s.a;
    held = clamp(held + 0.03 * err * DT, -1, 1);
    f.fly({ throttle, pitch: clamp(held + 0.03 * err - 0.03 * s.q, -1, 1), roll: typeof roll === 'function' ? roll(s) : roll });
    step(f);
  }
  return trace;
}

/** Runs with `controls(s, t)` giving the controls (and the pilot's rudder, through `holder`) each step, for `seconds`; returns the trace with `time`. */
function fly(f, seconds, controls) {
  const trace = [];
  for (let k = 0; k <= seconds / DT; k++) {
    const s = read(f);
    s.time = k * DT;
    trace.push(s);
    f.fly(controls(s, s.time));
    step(f);
  }
  return trace;
}

/** The heading's rate over the last half second, deg/s, at each point of a trace. */
const headingRates = (trace) => trace.map((s, i) => (i < 60 ? 0 : turned(trace[i - 60].psi, s.psi) / 0.5));

/**
 * "Flying again": the angle of attack below 12, the wings within 30 degrees of level and the speed higher than half
 * a second before. Returns { from }: the time from which it holds unbroken to the end of the trace (null if not at the end).
 */
function flyingAgain(trace) {
  const ok = (s, i) => i >= 60 && s.a < 12 && Math.abs(s.ph) < 30 && s.kt > trace[i - 60].kt;
  let from = null;
  trace.forEach((s, i) => { if (!ok(s, i)) from = null; else from ??= s.time; });
  return { from };
}

/** A roll rate one way "from some moment no later than `by` and still so at `until`": the moment, or null. */
function rollingFrom(trace, sign, by, until) {
  let from = null;
  for (const s of trace) {
    if (s.time > until) break;
    if (sign * s.p > 0) from ??= s.time; else from = null;
  }
  return from !== null && from <= by ? from : null;
}

/** The stick a back tilt of `deg` degrees sends: the page's own curve (src/input/tilt.js, src/input/pilot.js). */
const backTilt = (deg) => gentle(shape(deg, MAPPING.pitchDeadband, MAPPING.pitchFull));

// ---- the 1 g stall, which the lines below start from ----

let stalled = null;
/** The 1 g stall, flown once: as the game flies it (the copilot's feet on). */
async function theStall() {
  if (stalled) return stalled;
  const m = await module(), f = start(m);
  const { trace, at } = slowTo(f, STALL_ALPHA);
  const after = fly(f, 5, () => ({ throttle: 0, roll: 0 }));
  f.dispose();
  stalled = { trace, at, after, drop: at.th - Math.min(...after.map((s) => s.th)), speed: at.kt };
  return stalled;
}

test('f4c edge: "The 1 g stall, slowing 1 knot a second at idle with ailerons neutral and the stick then held: the angle of attack reaches 22 degrees with no sharp nose drop: in the 5 s after it gets there the nose falls less than 10 degrees. The speed at 22 degrees is the stall speed for the lines below"', async () => {
  const { at, after, drop, trace } = await theStall();
  const start0 = trace[0], last = after.at(-1);
  report.line(`f4c edge: the 1 g stall, clean, ${WEIGHT.value.toLocaleString('en-US')} lb, from 250 kt at 15,000 ft, idle, slowing 1 kt a second (the copilot's feet on):`);
  say(`the angle of attack reaches ${STALL_ALPHA} degrees (${cite(NOSE_SLICE_ALPHA)}; the flight manual's ${cite(STALL_UNITS)}) at ${f1(at.kt)} kt flown, ${at.n.toFixed(3)} g across the flight path: the stall speed is ${f1(at.kt)} kt (reduced to 1 g, reported: ${f1(at.vs)}); the nose ${f1(at.th)} degrees up, sinking ${(-at.climb).toFixed(0)} ft/min, ${(start0.h - at.h).toFixed(0)} ft below the start`);
  say(`in the 5 s after, the stick held: the nose falls ${f1(drop)} degrees (less than 10); the angle of attack ends at ${f1(last.a)}, the speed at ${f1(last.kt)} kt, the bank ${f1(last.ph)} degrees`);
  say(`reported, beside Wings' (${cite(WINGS_STALL)}): stall speed ${f1(at.kt)} kt; the nose from ${f1(at.th)} to ${f1(Math.min(...after.map((s) => s.th)))} degrees; sinking ${(-at.climb).toFixed(0)} ft/min`);
  assert.ok(at.a >= STALL_ALPHA, `${at.a} degrees`);
  assert.ok(drop < 10, `the nose fell ${drop} degrees`);
});


// ---- the nose slice ----

/** The stall, flown feet off (the copilot's feet out from the start), and the stick then worked to hold `alpha`, ailerons neutral, idle. */
async function slice(alpha, seconds, { assists = NO_FEET, nudge = 0, until = null, sets = [] } = {}) {
  const m = await module(), f = start(m, { assists, sets });
  const { at } = slowTo(f, STALL_ALPHA);
  // A nudge (reported only): the roll stick a quarter right for `nudge` seconds as it gets there.
  const trace = holdAlpha(f, alpha, seconds, { roll: (s) => (s.time < nudge ? 0.25 : 0), until });
  return { f, at, trace };
}
/** When a trace's heading first swings one way at more than 10 deg/s and is further that way a second later: { time, rate } or null. */
function swingsOff(trace, by) {
  const rates = headingRates(trace);
  for (let i = 0; i < trace.length - 120; i++) {
    if (trace[i].time > by) break;
    if (Math.abs(rates[i]) > 10 && Math.sign(rates[i]) * turned(trace[i].psi, trace[i + 120].psi) > 0) return { time: trace[i].time, rate: rates[i] };
  }
  return null;
}
const firstSwing = (trace) => { const rates = headingRates(trace), i = rates.findIndex((x) => Math.abs(x) > 10); return i < 0 ? null : { time: trace[i].time, rate: rates[i] }; };

test('f4c edge, the plan\'s line as written, NOT MET (replaced by the owner\'s line of 27 November 2026, below): "The nose slice, feet off: held between 22 and 26 degrees with ailerons neutral, the nose swings off to one side at more than 10 degrees a second within 10 s. With the copilot\'s feet on, what happens is reported. Reported beside Wings\' (nose from 21 to 17 degrees, sinking 1,357 ft/min at 135 knots): the stall speed, the nose\'s height and the sink rate"', async () => {
  const held = await slice(24, 10);
  held.f.dispose();
  const tr = held.trace, band = [Math.min(...tr.slice(60).map((s) => s.a)), Math.max(...tr.map((s) => s.a))];
  const swing = swingsOff(tr, 10), most = Math.max(...headingRates(tr).map(Math.abs)), last = tr.at(-1);
  report.line('f4c edge: the nose slice, feet off, held at 24 degrees from the stall at a degree a second, ailerons neutral, idle:');
  say(`the angle of attack held between ${f1(band[0])} and ${f1(band[1])} degrees (from 0.5 s); in 10 s the heading's fastest swing is ${most.toFixed(2)} deg/s, the sideslip ends at ${last.b.toFixed(2)} degrees and the bank at ${last.ph.toFixed(2)}: ${swing ? `it swings off at ${f1(swing.rate)} deg/s at ${f1(swing.time)} s` : 'NO SWING OFF within 10 s'}`);
  // What happens held longer, at the band's middle and top; and from a small disturbance; and with the copilot's feet on. Reported.
  for (const alpha of [24, NOSE_SLICE_ALPHA.value[1]]) {
    const long = await slice(alpha, 60, { until: (s, t) => firstSwing(t) !== null });
    long.f.dispose();
    const off = firstSwing(long.trace);
    say(`reported: held at ${alpha} degrees, still air: ${off ? `the nose swings off at ${f1(off.rate)} deg/s ${f1(off.time)} s after reaching 22` : 'no swing in 60 s'}`);
  }
  const nudged = await slice(24, 30, { nudge: 0.5, until: (s, t) => firstSwing(t) !== null });
  nudged.f.dispose();
  const offN = firstSwing(nudged.trace);
  say(`reported: held at 24 degrees after a nudge (the roll stick a quarter right for half a second as it reaches 22): ${offN ? `the nose swings off at ${f1(offN.rate)} deg/s ${f1(offN.time)} s after` : 'no swing in 30 s'}`);
  const feet = await slice(24, 30, { assists: F4C.assists });
  feet.f.dispose();
  const ft = feet.trace, mostFeet = Math.max(...headingRates(ft).map(Math.abs));
  say(`reported: with the copilot's feet on, held at 24 degrees for 30 s: the heading's fastest swing ${mostFeet.toFixed(2)} deg/s, the most sideslip ${Math.max(...ft.map((s) => Math.abs(s.b))).toFixed(2)} degrees, the most bank ${Math.max(...ft.map((s) => Math.abs(s.ph))).toFixed(2)}`);
  const at = held.at;
  say(`reported, beside Wings' (${cite(WINGS_STALL)}): the stall speed ${f1(at.kt)} kt; held at 24 degrees the nose from ${f1(tr[0].th)} to ${f1(last.th)} degrees up, sinking ${(-tr[0].climb).toFixed(0)} to ${(-last.climb).toFixed(0)} ft/min`);
  // Flown right: the band held. The swing is not asserted: in the game's still air nothing starts it (the owner's line below adds a nudge).
  assert.ok(band[0] >= 22 && band[1] <= 26, `held between ${band[0]} and ${band[1]}`);
  say(`the plan's line as written: ${swing ? 'met' : 'NOT MET'}`);
  if (!swing) NOT_MET.push({ line: 'The nose slice, feet off: held between 22 and 26 degrees with ailerons neutral, the nose swings off to one side at more than 10 degrees a second within 10 s', measured: { heldDeg: band, fastestSwingDegPerSec: most, sideslipAt10sDeg: last.b }, why: 'the model is the same left and right and the game\'s air is still: nothing starts the slice; held at 24 degrees it swings off after 45 s, at 25.5 after 30 s', replacedBy: 'P1 (the owner, 27 November 2026): the same after a nudge of a quarter of the roll stick for half a second' });
});

// ---- the owner's replacement lines (proposed in round 2; the owner said yes, 27 November 2026) ----

test('f4c edge, the owner\'s replacement line (27 November 2026; asked: "In still air nothing starts the slice. Should the checkride give it the small nudge a real stall always has?" Yes): "P1, the nose slice with a disturbance: held at 24 degrees, ailerons neutral, feet off, after a nudge of a quarter of the roll stick for half a second as it reaches 22 (AFWAL\'s own simulation was started with an aileron pulse): the nose swings off at more than 10 degrees a second within 10 s"', async () => {
  const run = await slice(24, 12, { nudge: 0.5 });
  run.f.dispose();
  const swing = swingsOff(run.trace, 10), until = run.trace.filter((s, i) => i >= 60 && (!swing || s.time <= swing.time)), band = [Math.min(...until.map((s) => s.a)), Math.max(...until.map((s) => s.a))];
  report.line('f4c edge, the owner\'s line P1 (27 November 2026): the nose slice after a nudge (the roll stick a quarter right for 0.5 s at 22 degrees), held at 24, ailerons then neutral, feet off, idle:');
  say(`${swing ? `the nose swings off at ${f1(swing.rate)} deg/s ${f1(swing.time)} s after reaching 22, and is further that way a second later` : 'NO swing off within 10 s'}; the angle of attack held ${f1(band[0])} to ${f1(band[1])} until then`);
  assert.ok(band[0] >= 22 && band[1] <= 26, `held between ${band[0]} and ${band[1]}`);
  assert.ok(swing !== null, 'it swings off within 10 s');
});

// ---- buffet ----

test('f4c edge: "Buffet: the shake begins 30 to 50 knots above the stall speed"; and it is full at the stall, from the F-4C\'s own band (src/sim/buffet.js)', async () => {
  const { trace, at } = await theStall();
  const onset = trace.find((s) => s.buffet > 0), above = onset.kt - at.kt, full = buffetOf(F4C.buffet, at.a, at.kt, at.flaps);
  report.line(`f4c edge: buffet, the camera's shake (src/sim/buffet.js, the F-4C's band: from ${F4C.buffet.onsetDeg} to ${F4C.buffet.fullDeg} degrees, flaps up), in the 1 g stall's slowing:`);
  say(`it begins at ${f1(onset.kt)} kt (${f1(onset.a)} degrees), ${f1(above)} kt above the stall speed ${f1(at.kt)}; 30 to 50 (the flight manual: ${cite(BUFFET_ONSET_ABOVE_STALL)})`);
  say(`at the stall it is ${full.toFixed(3)}; halfway, at ${f1(trace.find((s) => s.buffet >= 0.5).kt)} kt`);
  // The flaps: an approach on speed (CR-2144's 11.7 degrees, the flight manual's 19.2 units, at 147 knots) does not shake; at the stall it does.
  const onSpeed = buffetOf(F4C.buffet, POWER_APPROACH_ALPHA.value, 147, 1), flapStall = buffetOf(F4C.buffet, STALL_ALPHA, 124, 1), parked = buffetOf(F4C.buffet, 90, 0.5, 0.5);
  say(`flaps down on speed (${POWER_APPROACH_ALPHA.value} degrees, ${cite(ON_SPEED_UNITS)}, 147 kt): ${onSpeed}; at the full-flap stall (22 degrees, 124 kt): ${flapStall.toFixed(3)}; parked (0.5 kt, any angle): ${parked.toExponential(1)} (below ${BUFFET_FULL_KT} kt it fades with the square of the speed, Wings' rule)`);
  assert.ok(above >= 30 && above <= 50, `${above} kt`);
  assert.equal(full, 1, 'full at the stall');
  assert.equal(onSpeed, 0, 'no shake on speed with the flaps down');
});

// ---- wing rock (reported) ----

test('f4c edge, reported: "Wing rock: reported beside the flight manual\'s (from about 10 knots above the stall, up to plus or minus 30 degrees) and AFWAL\'s time history; no pass or fail"', async () => {
  const m = await module();
  report.line(`f4c edge, reported: wing rock (the flight manual: ${cite(WING_ROCK_FROM)}; AFWAL: ${cite(WING_ROCK_ALPHA)})`);
  const { at, trace, after } = await theStall();
  const last10 = [...trace.filter((s) => s.kt <= at.kt + 10), ...after];
  say(`as the game flies it, in still air: in the last 10 kt to the stall and the 5 s held after, the most bank ${Math.max(...last10.map((s) => Math.abs(s.ph))).toFixed(2)} degrees and sideslip ${Math.max(...last10.map((s) => Math.abs(s.b))).toFixed(2)}`);
  // The same with a nudge 10 knots above the stall: the roll stick a quarter right for half a second.
  for (const [name, assists] of [['the copilot\'s feet on', F4C.assists], ['feet off', NO_FEET]]) {
    const f = start(m, { assists });
    let from = null, n = 0;
    const run = slowTo(f, STALL_ALPHA, { each: (s) => { if (s.kt <= at.kt + 10) { from ??= s.t; return n++ < 60 ? 0.25 : 0; } return 0; } });
    const held = fly(f, 10, () => ({ throttle: 0, roll: 0 }));
    f.dispose();
    const near = [...run.trace.filter((s) => s.t >= from), ...held];
    say(`nudged 10 kt above the stall, ${name}: the bank swings ${f1(Math.min(...near.map((s) => s.ph)))} to ${f1(Math.max(...near.map((s) => s.ph)))} degrees from there to 10 s after the stall (sideslip ${f1(Math.min(...near.map((s) => s.b)))} to ${f1(Math.max(...near.map((s) => s.b)))})`);
  }
  // AFWAL's case: 21 degrees, all augmentation off, controls fixed after a pulse of aileron (its figure 31).
  const off = [['fcs/test/pitch-damper', 0], ['fcs/test/roll-damper', 0], ['fcs/test/yaw-damper', 0]];
  const f = start(m, { assists: NO_FEET, sets: off });
  assert.ok(off.every(([name]) => f.get(name) === 0), 'all augmentation off');
  slowTo(f, 21);
  holdAlpha(f, 21, 3);
  // The roll and yaw controls fixed after the pulse; the angle of attack held at 21 with the stick, as AFWAL's flight test's pilot held it in his turn.
  let held = f.controls.pitch;
  const rock = fly(f, 30, (s, t) => { const err = 21 - s.a; held = clamp(held + 0.03 * err * DT, -1, 1); return { throttle: 0, pitch: clamp(held + 0.03 * err - 0.03 * s.q, -1, 1), roll: t < 1 ? 1 / 3 : 0 }; });
  f.dispose();
  const settled = rock.filter((s) => s.time >= 10), span = (key) => Math.max(...settled.map((s) => s[key])) - Math.min(...settled.map((s) => s[key]));
  const ups = settled.filter((s, i) => i > 0 && settled[i - 1].p < 0 && s.p >= 0).map((s) => s.time), period = ups.length > 1 ? (ups.at(-1) - ups[0]) / (ups.length - 1) : NaN;
  const early = rock.filter((s) => s.time >= 2 && s.time < 10), late = rock.filter((s) => s.time >= 22);
  const amp = (tr) => Math.max(...tr.map((s) => Math.abs(s.ph)));
  const [fa, fb, fph, fp, fr, fT, sa, sb, sph, sp, sr, sT] = WING_ROCK_TIME_HISTORY.value;
  say(`AFWAL's case: held at 21 degrees, all augmentation off, feet off, a 1 s pulse of 10 degrees of aileron, then the ailerons and rudder fixed, the angle of attack held; from 10 to 30 s, peak to peak: sideslip ${f1(span('b'))} degrees, bank ${f1(span('ph'))}, roll rate ${f1(span('p'))} deg/s, yaw rate ${f1(span('r'))} deg/s; period ${f1(period)} s; the angle of attack ${f1(Math.min(...settled.map((s) => s.a)))} to ${f1(Math.max(...settled.map((s) => s.a)))}; the bank's swing ${f1(amp(early))} degrees before 10 s and ${f1(amp(late))} after 22 s`);
  say(`AFWAL's flight test (F-4E, a wind-up turn): sideslip ${fb}, bank ${fph}, roll rate ${fp}, yaw rate ${fr}, period ${fT} s at ${fa} degrees; its simulation (straight and level): ${sb}, ${sph}, ${sp}, ${sr}, ${sT} s at ${sa}. Its ratios, bank to sideslip: ${(fph / fb).toFixed(1)} and ${(sph / sb).toFixed(1)}; ours ${(span('ph') / span('b')).toFixed(1)} (${WING_ROCK_TIME_HISTORY.source}, ${WING_ROCK_TIME_HISTORY.where})`);
});

// ---- ailerons and rudder at high angle of attack ----

/** From the stall's slowing to `alpha`, then `controls` for 6 s with the pitch stick held where it was. */
async function atHigh(alpha, assists, controls, holder = null) {
  const m = await module(), f = start(m, { assists });
  if (holder) { holder.flight = f; f.rudderDeg = 0; }
  slowTo(f, alpha);
  const s0 = read(f), stick = f.controls.pitch;
  const trace = fly(f, 6, (s, t) => ({ throttle: 0, pitch: stick, ...controls(f, t) }));
  f.dispose();
  return { s0, trace };
}
const firstHeading = (s0, trace) => { const s = trace.find((x) => Math.abs(turned(s0.psi, x.psi)) >= 0.5); return s ? { time: s.time, way: Math.sign(turned(s0.psi, s.psi)) } : null; };
const at3 = (trace) => trace.find((s) => s.time >= 3);
const describe = (s0, trace) => `the heading's first half degree ${(() => { const h = firstHeading(s0, trace); return h ? `${h.way < 0 ? 'LEFT' : 'RIGHT'} at ${h.time.toFixed(2)} s` : 'never'; })()}; roll rate at 1, 2, 3 and 4 s: ${[1, 2, 3, 4].map((t) => f1(trace.find((s) => s.time >= t).p)).join(', ')} deg/s; bank at 3 and 6 s: ${f1(at3(trace).ph)}, ${f1(trace.at(-1).ph)} degrees; the most sideslip ${f1(Math.max(...trace.map((s) => Math.abs(s.b))))}; the angle of attack from ${f1(s0.a)} to ${f1(trace.at(-1).a)}`;

test('f4c edge, the plan\'s line as written, NOT MET (replaced by the owner\'s line of 27 November 2026, below): "Ailerons at the stall: full right tilt at the stall angle, feet off (the copilot\'s feet switched out for this test): the nose yaws left and within 3 s it is rolling left. The wrong way, as the flight manual says"', async () => {
  const { s0, trace } = await atHigh(STALL_ALPHA, NO_FEET, () => ({ roll: 1 }));
  const yaw = firstHeading(s0, trace), left = rollingFrom(trace, -1, 3, 4);
  report.line(`f4c edge: ailerons at the stall (${STALL_ALPHA} degrees, ${f1(s0.kt)} kt), full right tilt, feet off, the pitch stick held (the flight manual: ${cite(AILERON_WRONG_WAY)}):`);
  say(describe(s0, trace));
  say(`rolling left from some moment by 3 s and still at 4 s: ${left === null ? 'NO' : `yes, from ${left.toFixed(2)} s`}; the roll rate's first move ${trace.find((s) => Math.abs(s.p) > 1).p > 0 ? 'RIGHT' : 'left'}`);
  // Reported: the same deeper in the slice band.
  for (const alpha of [24, NOSE_SLICE_ALPHA.value[1]]) {
    const deep = await atHigh(alpha, NO_FEET, () => ({ roll: 1 }));
    say(`reported, at ${alpha} degrees: ${describe(deep.s0, deep.trace)}`);
  }
  // Flown right: started at the stall angle. The wrong-way roll is not asserted: at 22 degrees the data's ailerons still roll it the way the stick asks.
  assert.ok(s0.a >= STALL_ALPHA, `started at ${s0.a} degrees`);
  const met = Boolean(yaw && yaw.way < 0 && left !== null);
  say(`the plan's line as written: ${met ? 'met' : 'NOT MET'}`);
  if (!met) NOT_MET.push({ line: 'Ailerons at the stall: full right tilt at the stall angle, feet off: the nose yaws left and within 3 s it is rolling left', measured: { noseFirstWay: yaw ? (yaw.way < 0 ? 'left' : 'right') : null, rollRateDegPerSec: [1, 2, 3, 4].map((t) => Number(trace.find((s) => s.time >= t).p.toFixed(1))), bankAt3And6Deg: [Number(at3(trace).ph.toFixed(1)), Number(trace.at(-1).ph.toFixed(1))] }, why: 'at 22 degrees AFWAL\'s ailerons still roll the jet the way the stick asks; it rolls the wrong way only deeper, at 25.5', replacedBy: 'P2 (the owner, 27 November 2026): the same at 25.5 degrees' });
});

test('f4c edge, the owner\'s replacement line (27 November 2026; asked: "At the stall itself the ailerons still roll it the right way, and only deeper in, at about 30 units, the wrong way. Should the checkride hold the wrong-way roll there?" Yes): "P2, ailerons deep in the stall: full right tilt at 25.5 degrees (the deep end of AFWAL\'s nose-slice band; the flight manual\'s 30 units), feet off: the nose yaws left, and it is rolling left by 3 s and still at 4 s"', async () => {
  const { s0, trace } = await atHigh(NOSE_SLICE_ALPHA.value[1], NO_FEET, () => ({ roll: 1 }));
  const yaw = firstHeading(s0, trace), left = rollingFrom(trace, -1, 3, 4);
  report.line(`f4c edge, the owner's line P2 (27 November 2026): full right tilt at ${NOSE_SLICE_ALPHA.value[1]} degrees (${f1(s0.kt)} kt), feet off, the pitch stick held:`);
  say(describe(s0, trace));
  say(`rolling left from some moment by 3 s and still at 4 s: ${left === null ? 'NO' : `yes, from ${left.toFixed(2)} s`}`);
  assert.ok(yaw && yaw.way < 0, 'the nose yaws left');
  assert.ok(left !== null, 'rolling left by 3 s and still at 4 s');
});

test('f4c edge: "Rudder at 18 degrees, ailerons neutral: full right rudder rolls it right"', async () => {
  const holder = {};
  const { s0, trace } = await atHigh(18, rudderFeet(holder), (f) => { f.rudderDeg = -30; return { roll: 0 }; }, holder);
  const right = rollingFrom(trace, 1, 3, 4);
  report.line(`f4c edge: full right rudder at 18 degrees (${f1(s0.kt)} kt), ailerons neutral, the pilot's feet (the copilot's out), the pitch stick held (the flight manual: ${cite(RUDDER_ROLLS)}):`);
  say(describe(s0, trace));
  say(`rolling right from some moment by 3 s and still at 4 s: ${right === null ? 'NO' : `yes, from ${right.toFixed(2)} s`}; banked ${f1(at3(trace).ph)} degrees right at 3 s`);
  assert.ok(right !== null && at3(trace).ph > 0, 'full right rudder rolls it right');
});

test('f4c edge: "With the copilot\'s feet on, full right tilt at 18 degrees rolls it right. The copilot does what the flight manual tells the pilot to do"', async () => {
  const { s0, trace } = await atHigh(18, F4C.assists, () => ({ roll: 1 }));
  const right = rollingFrom(trace, 1, 3, 4);
  report.line(`f4c edge: full right tilt at 18 degrees (${f1(s0.kt)} kt), the copilot's feet on, the pitch stick held:`);
  say(describe(s0, trace));
  say(`rolling right from some moment by 3 s and still at 4 s: ${right === null ? 'NO' : `yes, from ${right.toFixed(2)} s`}; banked ${f1(at3(trace).ph)} degrees right at 3 s`);
  assert.ok(right !== null && at3(trace).ph > 0, 'full right tilt rolls it right');
});

// ---- recovery, and letting go ----

test('f4c edge, the plan\'s line as written, NOT MET (replaced by the owner\'s line of 27 November 2026, below): "Recovery, the flight manual\'s: from the nose slice, stick forward with ailerons and rudder neutral: flying again (angle of attack below 12 degrees, wings within 30 degrees of level, speed rising) within 10 s"', async () => {
  const sliced = await slice(NOSE_SLICE_ALPHA.value[1], 90, { until: (s, t) => firstSwing(t) !== null });
  const { f, trace: before } = sliced, s0 = read(f), off = firstSwing(before);
  assert.ok(off !== null, 'it slices');
  let held = f.controls.pitch;
  const trace = fly(f, 15, (s) => { const err = RECOVERY_ALPHA - s.a; held = clamp(held + 0.03 * err * DT, -1, 1); return { throttle: 0, roll: 0, pitch: clamp(held + 0.03 * err - 0.03 * s.q, -1, 1) }; });
  f.dispose();
  const again = flyingAgain(trace);
  report.line(`f4c edge: recovery from the nose slice (held at ${NOSE_SLICE_ALPHA.value[1]} degrees, swinging off at ${f1(off.rate)} deg/s ${f1(off.time)} s after the stall; sideslip ${f1(s0.b)}, bank ${f1(s0.ph)}), the stick forward to ${RECOVERY_ALPHA} degrees (the flight manual: ${cite(STALL_RECOVERY_UNITS)}), ailerons and rudder neutral, idle:`);
  say(`flying again, unbroken to 15 s: ${again.from === null ? 'NOT by 15 s' : `from ${f1(again.from)} s`} (by 10 s); at 5, 10 and 15 s the angle of attack ${[5, 10, 15].map((t) => f1(trace.find((s) => s.time >= t - 1e-9).a)).join(', ')}, the bank ${[5, 10, 15].map((t) => f1(trace.find((s) => s.time >= t - 1e-9).ph)).join(', ')}, the roll rate ${[5, 10, 15].map((t) => f1(trace.find((s) => s.time >= t - 1e-9).p)).join(', ')} deg/s; the most angle of attack ${f1(Math.max(...trace.map((s) => s.a)))}; ${(s0.h - trace.at(-1).h).toFixed(0)} ft lost in the 15 s`);
  // Reported: the same with the stick full forward, from the same slice.
  const again2 = await slice(NOSE_SLICE_ALPHA.value[1], 90, { until: (s, t) => firstSwing(t) !== null });
  const full = fly(again2.f, 15, () => ({ throttle: 0, roll: 0, pitch: -1 }));
  again2.f.dispose();
  const fullAgain = flyingAgain(full);
  say(`reported: the stick full forward instead: flying again ${fullAgain.from === null ? 'NOT by 15 s' : `from ${f1(fullAgain.from)} s`}; the roll rate at 5, 10 and 15 s ${[5, 10, 15].map((t) => f1(full.find((s) => s.time >= t - 1e-9).p)).join(', ')} deg/s`);
  // Flown right: it slices first (above). "Flying again" is not asserted: the line also asked for the wings within 30
  // degrees of level within 10 s, which the flight manual does not say and neutral ailerons cannot give: the rotation
  // stops, and the jet comes out 55 to 80 degrees nose down at whatever bank it had.
  const met = again.from !== null && again.from <= 10;
  say(`the plan's line as written: ${met ? 'met' : 'NOT MET'}`);
  if (!met) NOT_MET.push({ line: 'Recovery, the flight manual\'s: from the nose slice, stick forward with ailerons and rudder neutral: flying again (angle of attack below 12 degrees, wings within 30 degrees of level, speed rising) within 10 s', measured: { flyingAgainFromS: again.from, at5_10_15s: [5, 10, 15].map((t) => { const x = trace.find((s) => s.time >= t - 1e-9); return { alphaDeg: Number(x.a.toFixed(1)), bankDeg: Number(x.ph.toFixed(1)), rollRateDegPerSec: Number(x.p.toFixed(1)) }; }) }, why: 'the wings within 30 degrees of level, which the flight manual does not ask and neutral ailerons cannot give: the rotation stops but the bank is wherever it was', replacedBy: 'the owner, 27 November 2026: the rotation stops within 15 s, at each of ten moments of entry' });
});

/**
 * Round 2: why the stick forward does not recover it (reported, no assertion). From the same nose slice as the line
 * above, entered `delay` seconds after the swing passes 10 deg/s (a pilot's reaction time; the motion is so
 * sensitive to the moment that one flight says little), with the copilot's feet switchable mid-flight (their law
 * gives nothing until `holder.on`), and `each(f, s, t)` called every step of the recovery for the record.
 */
async function recovery({ delay = 0, mode = 'alpha', throttle = 0, feetOn = false, sets = [], seconds = 15, each = null }) {
  const holder = { on: false };
  const assists = { ...F4C.assists, feet: { to: 'fcs/rudder-cmd-norm', sign: -1, law: (air) => (holder.on ? wingsFeet(air) : 0) }, steer: { wheel: F4C.assists.steer.wheel } };
  const sliced = await slice(NOSE_SLICE_ALPHA.value[1], 90, { assists, sets, until: (s, t) => firstSwing(t) !== null && s.time >= firstSwing(t).time + delay });
  const f = sliced.f, s0 = read(f);
  holder.on = feetOn;
  let held = f.controls.pitch, unloaded = false;
  const trace = fly(f, seconds, (s, t) => {
    if (each) each(f, s, t);
    let pitch;
    if (mode === 'alpha' || mode === 'unload-then-alpha') { const err = RECOVERY_ALPHA - s.a; held = clamp(held + 0.03 * err * DT, -1, 1); pitch = clamp(held + 0.03 * err - 0.03 * s.q, -1, 1); }
    if (mode === 'full') pitch = -1;
    if (mode === 'neutral') pitch = 0;
    if (mode === 'unload') { unloaded ||= s.a < 10; pitch = unloaded ? 0 : -1; }
    return { throttle, roll: 0, pitch };
  });
  f.dispose();
  let calm = 0, stopped = null;
  for (const x of trace) { calm = Math.abs(x.p) < 10 && Math.abs(x.r) < 10 ? calm + DT : 0; if (stopped === null && calm >= 2) stopped = x.time - 2; }
  const again = flyingAgain(trace), at10 = trace.find((x) => x.time >= 10);
  return { s0, trace, stopped, stoppedFt: stopped === null ? null : s0.h - trace.find((x) => x.time >= stopped).h, again: again.from, at10 };
}

test('f4c edge, the owner\'s replacement line (27 November 2026; asked: "Pushing forward stops the rotation, but it comes out steeply nose down at whatever bank it had, with the ailerons left neutral. Should the checkride ask only that the rotation stops?" Yes): "from the nose slice, the stick forward (5 to 10 units: 4 degrees), ailerons and rudder neutral, feet off: the rotation stops (roll and yaw both under 10 degrees a second for 2 s) within 15 s, at each of ten moments of entry 0 to 0.9 s after the swing passes 10 degrees a second"', async () => {
  // "Within 15 s": the 2 s of quiet begin no later than 15 s after the stick goes forward (flown 17 s to see them).
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push({ delay: i / 10, ...(await recovery({ delay: i / 10, seconds: 17 })) });
  report.line(`f4c edge, the owner's recovery line (27 November 2026): from the nose slice at ${NOSE_SLICE_ALPHA.value[1]} degrees, the stick forward to ${RECOVERY_ALPHA} degrees, ailerons and rudder neutral, feet off, idle; ten moments of entry:`);
  for (const r of runs) {
    const out = r.stopped === null ? null : r.trace.find((x) => x.time >= r.stopped);
    say(`entered ${r.delay.toFixed(1)} s after the swing passes 10 deg/s: ${r.stopped === null ? 'the rotation does NOT stop in 17 s' : `the rotation stops at ${f1(r.stopped)} s, ${r.stoppedFt.toFixed(0)} ft lower, coming out with the nose ${f1(out.th)} degrees and the bank ${f1(out.ph)}`}`);
  }
  const stops = runs.filter((r) => r.stopped !== null).map((r) => r.stopped).sort((a, b) => a - b);
  if (stops.length) say(`the times: ${f1(stops[0])} s at the least, ${f1(stops[Math.floor(stops.length / 2)])} the median, ${f1(stops.at(-1))} at the most`);
  for (const r of runs) assert.ok(r.stopped !== null && r.stopped <= 15, `entered ${r.delay} s after: stopped at ${r.stopped} s`);
});

test('f4c edge, reported (round 2): why the stick forward does not recover it: the build-up of roll, yaw and pitch through the recovery, and the recovery flown four other ways', async () => {
  // 1. The line's recovery, the build-up recorded each step (coefficients; the moments are these times the dynamic pressure, the wing area and the span or chord).
  const rows = [];
  const C = (f, name) => f.get(`aero/coefficient/${name}`);
  const first = await recovery({ each: (f, s, t) => {
    if (Math.abs(t / 0.5 - Math.round(t / 0.5)) > 1e-9 || t > 12) return;
    rows.push({ t, s, Clb: C(f, 'roll-sideslip'), Clp: C(f, 'roll-roll-rate'), Clr: C(f, 'roll-yaw-rate'), Cl: C(f, 'roll'), Cnb: C(f, 'yaw-sideslip'), Cnr: C(f, 'yaw-yaw-rate'), Cnp: C(f, 'yaw-roll-rate'), Cndr: C(f, 'yaw-rudder'), Cn: C(f, 'yaw'),
      Cmb: C(f, 'pitch-basic'), Cmbeta: C(f, 'pitch-sideslip'), Cms: C(f, 'pitch-stabilator'), Cmq: C(f, 'pitch-pitch-rate'), Cm: C(f, 'pitch'),
      roll: f.get('aero/moment/roll-lbsft'), yaw: f.get('aero/moment/yaw-lbsft'), pitch: f.get('aero/moment/pitch-lbsft'),
      rollDamper: f.get('fcs/roll-damper/aileron-deg'), yawDamper: f.get('fcs/yaw-damper/rudder-deg'), pitchDamper: f.get('fcs/pitch-damper/stabilator-deg'), stab: f.get('fcs/elevator-pos-deg'),
      force: f.get('fcs/stick/pilot-force-lbs'), bob: f.get('fcs/stick/bobweight-lbs'), mach: f.get('velocities/mach'), factors: [f.get('aero/factor/yaw-sideslip'), f.get('aero/flaps/factor/yaw-sideslip'), f.get('aero/factor/roll-sideslip'), f.get('aero/flaps/factor/roll-sideslip')] });
  } });
  report.line('f4c edge, reported (round 2): the recovery from the nose slice, stick forward to 4 degrees, ailerons and rudder neutral, feet off, idle, the build-up every half second (coefficients x 1000; the yaw-from-sideslip term is CNB1 x sideslip):');
  say('   t  alpha  beta     p     r |  Cl beta  Cl p  Cl r  = Cl | Cn beta  Cn r  Cn p  Cn rud  = Cn | Cm basic  Cm beta  Cm stab  Cm q  = Cm | roll lb-ft  yaw lb-ft | roll dmp yaw dmp stab  force  bob');
  const k = (x) => (x * 1000).toFixed(0).padStart(6);
  for (const r of rows) say(`${f1(r.t).padStart(4)} ${f1(r.s.a).padStart(6)} ${f1(r.s.b).padStart(5)} ${r.s.p.toFixed(0).padStart(5)} ${r.s.r.toFixed(0).padStart(5)} | ${k(r.Clb)}${k(r.Clp)}${k(r.Clr)} ${k(r.Cl)} | ${k(r.Cnb)}${k(r.Cnr)}${k(r.Cnp)}${k(r.Cndr)} ${k(r.Cn)} | ${k(r.Cmb)}${k(r.Cmbeta)}${k(r.Cms)}${k(r.Cmq)} ${k(r.Cm)} | ${r.roll.toFixed(0).padStart(9)} ${r.yaw.toFixed(0).padStart(9)} | ${f1(r.rollDamper).padStart(5)} ${f1(r.yawDamper).padStart(5)} ${f1(r.stab).padStart(5)} ${r.force.toFixed(0).padStart(5)} ${r.bob.toFixed(0).padStart(4)}`);
  const held = rows.filter((r) => r.t <= 3), share = (key) => held.reduce((x, r) => x + Math.abs(r[key]), 0);
  say(`in the first 3 s the yaw from sideslip is ${(share('Cnb') / (share('Cnb') + share('Cnr') + share('Cnp') + share('Cndr')) * 100).toFixed(0)}% of all the yaw terms by size; the dampers are on their 5-degree limits (roll ${rows.filter((r) => Math.abs(r.rollDamper) > 4.99).length} of ${rows.length} looks, yaw ${rows.filter((r) => Math.abs(r.yawDamper) > 4.99).length}), each against the motion; Mach ${Math.min(...rows.map((r) => r.mach)).toFixed(2)} to ${Math.max(...rows.map((r) => r.mach)).toFixed(2)}, so the Mach and flap factors are ${[...new Set(rows.flatMap((r) => r.factors))].join(', ')}`);
  // What the sources say about these terms (round 2): AFWAL's Table 1 has the sideslip terms linear in sideslip at every
  // sideslip (its only limit is on Delta Cm: 30 degrees, which the file has, DCM1's last column), and enters every
  // table with |alpha| at negative angles of attack; its base data are "an excellent model of the aircraft" only for
  // -10 < beta < 10 (PDF p.39). NASA TN D-6425, its source past the stall, says "each of the coefficients exhibit
  // nonlinearities with respect to sideslip ... near the stall angle of attack, these nonlinearities generally occur at
  // beta = +-10 or +-15 degrees" (p.9); its figure 7 shows, read by eye (Reasoned), the yawing moment at 25 and 30
  // degrees peaking near 12 to 15 degrees of sideslip and turning restoring past about 25, and at -5 and -10 degrees of
  // angle of attack a small rolling moment of the other sign from the one Cl_beta(|alpha|) gives.
  const pushed = rows.filter((r) => r.s.a < 0);
  if (pushed.length) say(`pushed below 0 degrees (${pushed.length} looks, ${f1(Math.min(...pushed.map((r) => r.s.a)))} to ${f1(Math.max(...pushed.map((r) => r.s.a)))} degrees, sideslip ${f1(Math.min(...pushed.map((r) => r.s.b)))} to ${f1(Math.max(...pushed.map((r) => r.s.b)))}): the roll from sideslip ${k(Math.min(...pushed.map((r) => r.Clb)))} to ${k(Math.max(...pushed.map((r) => r.Clb)))}, against the roll damping's ${k(Math.min(...pushed.map((r) => r.Clp)))} to ${k(Math.max(...pushed.map((r) => r.Clp)))} (AFWAL's dihedral table, entered with |alpha| there)`);
  say(`the motion: the rotation (roll and yaw both under 10 deg/s for 2 s) ${first.stopped === null ? 'does not stop in 15 s' : `stops at ${f1(first.stopped)} s`}`);
  // 2. The four other ways (and two more for the record), each flown from ten moments of entry 0.1 s apart.
  const ways = [
    ['the line\'s: the stick forward to 4 degrees', {}],
    ['the stick full forward', { mode: 'full' }],
    ['everything let go (the stick neutral)', { mode: 'neutral' }],
    ['(i) the dampers out (from the start), the stick forward to 4 degrees', { sets: [['fcs/test/pitch-damper', 0], ['fcs/test/roll-damper', 0], ['fcs/test/yaw-damper', 0]] }],
    ['(ii) the copilot\'s feet on as it starts, the stick forward to 4 degrees', { feetOn: true }],
    ['(iii) the stick full forward until below 10 degrees, then neutral', { mode: 'unload' }],
    ['(iii) the same, the copilot\'s feet on', { mode: 'unload', feetOn: true }],
    ['(iv) at MIL, the stick forward to 4 degrees', { throttle: F4C.mil }],
  ];
  report.line('f4c edge, reported (round 2): the recovery flown each way from ten moments of entry, 0 to 0.9 s after the swing passes 10 deg/s. "Stops": roll and yaw both under 10 deg/s for 2 s; "flying again": the line\'s measure, by 10 s and unbroken to 15 s:');
  for (const [name, o] of ways) {
    const runs = [];
    for (let i = 0; i < 10; i++) runs.push(await recovery({ ...o, delay: i / 10 }));
    const stops = runs.filter((r) => r.stopped !== null).sort((a, b) => a.stopped - b.stopped), mid = stops[Math.floor(stops.length / 2)];
    const flying = runs.filter((r) => r.again !== null && r.again <= 10);
    const down = runs.map((r) => r.at10.th), banks = runs.map((r) => Math.abs(r.at10.ph));
    say(`${name}: the rotation stops in ${stops.length} of 10 within 15 s${mid ? ` (median ${f1(mid.stopped)} s and ${mid.stoppedFt.toFixed(0)} ft)` : ''}; flying again in ${flying.length} of 10; at 10 s the nose ${Math.min(...down).toFixed(0)} to ${Math.max(...down).toFixed(0)} degrees, the bank ${Math.min(...banks).toFixed(0)} to ${Math.max(...banks).toFixed(0)} either way`);
  }
});

test('f4c edge: "Let go: from the stall with full back tilt and full right tilt held for 5 s, then phone neutral: flying again by the same measure within 20 s, without the pilot\'s help; height lost reported"', async () => {
  const m = await module(), f = start(m);
  slowTo(f, STALL_ALPHA);
  const s0 = read(f);
  const held = fly(f, 5, () => ({ throttle: 0, pitch: 1, roll: 1 }));
  const s1 = read(f);
  const trace = fly(f, 25, () => ({ throttle: 0, pitch: 0, roll: 0 }));
  f.dispose();
  const again = flyingAgain(trace), then = again.from === null ? null : trace.find((s) => s.time >= again.from);
  report.line('f4c edge: let go: from the stall, full back and full right tilt for 5 s (the copilot\'s feet on), then the phone neutral (the copilot\'s trim for 350 kt), idle:');
  say(`in the 5 s held: the most angle of attack ${f1(Math.max(...held.map((s) => s.a)))}, sideslip ${f1(Math.max(...held.map((s) => Math.abs(s.b))))}, yaw rate ${f1(Math.max(...held.map((s) => Math.abs(s.r))))} deg/s; at letting go the bank ${f1(s1.ph)}, the nose ${f1(s1.th)}`);
  say(`flying again, unbroken to 25 s: ${then ? `from ${f1(again.from)} s after letting go, at ${f1(then.kt)} kt, the nose ${f1(then.th)} degrees` : 'NOT by 25 s'} (by 20 s); height lost from the stall ${then ? (s0.h - then.h).toFixed(0) : '-'} ft, from letting go ${then ? (s1.h - then.h).toFixed(0) : '-'} ft (the flight manual: ${cite(STALL_HEIGHT_LOSS)})`);
  assert.ok(again.from !== null && again.from <= 20, `flying again from ${again.from} s`);
});

// ---- a spin (reported) ----

test('f4c edge, reported: "A spin, if pro-spin controls held for 15 s make one: turns, seconds a turn and height lost a turn are reported beside the flight manual\'s (up to 2,000 ft a turn), and the flight manual\'s out-of-control recovery is flown and its result reported. No pass or fail"', async () => {
  const m = await module(), holder = {}, f = start(m, { assists: rudderFeet(holder) });
  holder.flight = f;
  f.rudderDeg = 0;
  slowTo(f, STALL_ALPHA);
  const pro = fly(f, 15, (s) => { f.rudderDeg = -30; return { throttle: 0, pitch: 1, roll: -1 }; });
  const turns = (tr) => tr.reduce((sum, s) => sum + vertical(s) * DT, 0) / 360;
  const last5 = pro.filter((s) => s.time >= 10), each = turns(pro);
  const spun = Math.abs(turns(last5)) > 0.5 && last5.every((s) => Math.sign(vertical(s)) === Math.sign(turns(last5)) || Math.abs(vertical(s)) < 20);
  report.line('f4c edge, reported: pro-spin controls for 15 s from the stall: the stick full back, full right rudder, full left aileron, idle:');
  say(`${each.toFixed(2)} turns about the vertical (${turns(last5).toFixed(2)} in the last 5 s): ${spun ? 'a spin' : 'no steady spin: it tumbles and rolls, turning both ways'}; ${(pro[0].h - pro.at(-1).h).toFixed(0)} ft lost, ${Math.abs(each) > 0.1 ? `${(15 / Math.abs(each)).toFixed(1)} s and ${((pro[0].h - pro.at(-1).h) / Math.abs(each)).toFixed(0)} ft a turn` : 'too few turns to count'} (the flight manual: ${cite(SPIN_HEIGHT_PER_TURN)}; ${cite(SPIN_YAW_RATE)}); the angle of attack from ${f1(Math.min(...pro.map((s) => s.a)))} to ${f1(Math.max(...pro.map((s) => s.a)))}, the yaw rate to ${f1(Math.max(...pro.map((s) => Math.abs(s.r))))} deg/s`);
  // The out-of-control recovery (section III): ailerons and rudder neutral while the stick goes smoothly forward (over 2 s here),
  // full forward if need be, throttles idle; a spin (the turn about the vertical faster than 30 deg/s after 3 s): full aileron
  // with it until it unloads or the turn slows below 20 deg/s; the stick forward until the yaw and roll stop (both under 10 deg/s
  // for 2 s), then neutral.
  let aileron = 0, calm = 0, done = null;
  const h0 = read(f).h;
  const rec = fly(f, 40, (s, t) => {
    f.rudderDeg = 0;
    const turn = vertical(s);
    if (aileron === 0 && t > 3 && Math.abs(turn) > 30) aileron = Math.sign(turn);
    if (aileron !== 0 && aileron !== 2 && (Math.abs(turn) < 20 || s.nz < 0)) aileron = 2;
    calm = Math.abs(s.p) < 10 && Math.abs(s.r) < 10 ? calm + DT : 0;
    if (done === null && calm >= 2) done = { t, h: s.h, kt: s.kt, th: s.th };
    return { throttle: 0, roll: aileron === 2 ? 0 : aileron, pitch: done ? 0 : -Math.min(1, t / 2) };
  });
  f.dispose();
  // Reported beside it: the same spin entry, then every control let go (the phone neutral, the pilot's feet off the rudder).
  const g = start(m, { assists: rudderFeet(holder) });
  holder.flight = g;
  g.rudderDeg = 0;
  slowTo(g, STALL_ALPHA);
  fly(g, 15, () => { g.rudderDeg = -30; return { throttle: 0, pitch: 1, roll: -1 }; });
  let quiet = 0, still = null;
  const hg = read(g).h;
  const free = fly(g, 40, (s, t) => { g.rudderDeg = 0; quiet = Math.abs(s.p) < 10 && Math.abs(s.r) < 10 ? quiet + DT : 0; if (still === null && quiet >= 2) still = { t, h: s.h }; return { throttle: 0, roll: 0, pitch: 0 }; });
  g.dispose();
  say(`reported beside it: the same entry, then every control let go: ${still ? `the yaw and roll stopped ${f1(still.t - 2)} s after, ${(hg - still.h).toFixed(0)} ft lower` : `NOT stopped after 40 s (${(hg - free.at(-1).h).toFixed(0)} ft lower)`}`);
  say(`the out-of-control recovery: ${aileron === 0 ? 'no spin seen, so no aileron' : `aileron with the spin${aileron === 2 ? ', then neutral' : ' throughout'}`}; ${done ? `the yaw and roll stopped ${f1(done.t - 2)} s after it began, ${(h0 - done.h).toFixed(0)} ft lower, at ${f1(done.kt)} kt, the nose ${f1(done.th)} degrees` : `the yaw and roll had NOT stopped after 40 s, ${(h0 - rec.at(-1).h).toFixed(0)} ft lower; the roll rate in the last 10 s up to ${f1(Math.max(...rec.filter((s) => s.time >= 30).map((s) => Math.abs(s.p))))} deg/s, sideslip to ${f1(Math.max(...rec.filter((s) => s.time >= 30).map((s) => Math.abs(s.b))))} degrees`}`);
});

// ---- AFWAL's wind-up turn (reported) ----

test('f4c edge, reported: "The wind-up turn of AFWAL\'s validation (its figure 34) is flown; where it departs is reported beside theirs"', async () => {
  const m = await module();
  report.line(`f4c edge, reported: AFWAL's wind-up turn to the left (${cite(WIND_UP_TURN_DEPARTURE)}): from 300 kt at 15,000 ft at MIL, rolled to 60 degrees of left bank and held there with the ailerons, the angle of attack raised a degree a second; "departs" is the sideslip past 10 degrees:`);
  for (const [name, assists] of [['the copilot\'s feet on (as the game flies)', F4C.assists], ['feet off (the jet alone)', NO_FEET]]) {
    const f = start(m, { assists, knots: 300 });
    let held = f.controls.pitch, want = null, gone = null;
    const trace = fly(f, 40, (s, t) => {
      const roll = clamp(0.05 * (-60 - s.ph) - 0.02 * s.p, -1, 1);
      if (t < 5) return { throttle: F4C.mil, roll };
      want ??= s.a;
      want += DT;
      const err = want - s.a;
      held = clamp(held + 0.03 * err * DT, -1, 1);
      if (gone === null && Math.abs(s.b) > 10) gone = { ...s };
      return { throttle: F4C.mil, roll: gone ? 0 : roll, pitch: gone ? 0 : clamp(held + 0.03 * err - 0.03 * s.q, -1, 1) };
    });
    f.dispose();
    const after = gone ? trace.filter((s) => s.time >= gone.time && s.time <= gone.time + 3) : [];
    say(`${name}: ${gone ? `departs ${f1(gone.time - 5)} s into the wind-up at ${f1(gone.a)} degrees, ${f1(gone.kt)} kt, ${gone.nz.toFixed(1)} g, bank ${f1(gone.ph)}; in the 3 s after (controls let go) the yaw rate to ${f1(Math.max(...after.map((s) => Math.abs(s.r))))} deg/s ${Math.sign(after.reduce((x, s) => x + s.r, 0)) < 0 ? 'left' : 'right'}, the roll rate to ${f1(Math.max(...after.map((s) => Math.abs(s.p))))} deg/s` : 'NO departure in 35 s of the wind-up'}`);
  }
});

// ---- for the owner: a held back tilt (reported) ----

test('f4c edge, reported: a held back tilt, what the owner meets: just after liftoff at 180 knots (gear down, flaps 1/2, full afterburner) for 3, 4, 5, 6, 10 and 20 degrees; at 300 knots clean at 2,000 ft for 10, 20 degrees and full back; 10 s each, then the phone neutral; with the copilot\'s feet off beside where that changes what happens', async () => {
  const m = await module();
  report.line('f4c edge, reported: a back tilt held 10 s, wings left alone (the copilot\'s feet on), then the phone neutral for 20 s. "Departs": the sideslip past 10 degrees. Flying again: the measure above. The tilt is the phone\'s, through the page\'s curve. Feet off is shown only where it changes the story (a departure, a roll past 60 degrees, or flying again, one way and not the other):');
  const cases = [
    ...[3, 4, 5, 6, 10, 20].map((deg) => ({ deg, where: 'after liftoff, 180 kt, gear down, flaps 1/2, full afterburner, 500 ft', start: { heightFt: 500, knots: 180, controls: { gear: true, flaps: 0.5 } }, throttle: 1 })),
    ...[10, 20, MAPPING.pitchFull].map((deg) => ({ deg, where: '300 kt clean at 2,000 ft, the throttle as trimmed', start: { heightFt: 2000, knots: 300 }, throttle: null })),
  ];
  const flyCase = (c, assists) => {
    const f = start(m, { ...c.start, assists }), throttle = c.throttle ?? f.controls.throttle, stick = backTilt(c.deg);
    const held = fly(f, 10, () => ({ throttle, pitch: stick, roll: 0 }));
    const s1 = read(f);
    const free = fly(f, 20, () => ({ throttle, pitch: 0, roll: 0 }));
    f.dispose();
    const gone = held.find((s) => Math.abs(s.b) > 10) ?? free.find((s) => Math.abs(s.b) > 10);
    const again = flyingAgain(free), lowest = Math.min(...free.map((s) => s.h)), at = (t) => free.find((s) => s.time >= t - 1e-9);
    const late = (t) => `${f1(at(t).a)} degrees, bank ${f1(at(t).ph)}, ${f1(at(t).kt)} kt`;
    const rolled = Math.max(...[...held, ...free].map((s) => Math.abs(s.ph)));
    const text = `${c.deg === MAPPING.pitchFull ? 'full' : `${c.deg} degrees`} back (stick ${stick.toFixed(3)}): the most angle of attack ${f1(Math.max(...held.map((s) => s.a)))} degrees (${f1(held.find((s) => s.time >= 1.5).a)} at 1.5 s), the most g ${Math.max(...held.map((s) => s.nz)).toFixed(1)}, the speed down to ${f1(Math.min(...held.map((s) => s.kt)))} kt, ${(s1.h - held[0].h).toFixed(0)} ft gained; ${gone ? `DEPARTS (sideslip past 10) at ${f1(gone.a)} degrees` : 'no departure'}. Let go: 5 s later ${late(5)}; 20 s later ${late(20)}; ${again.from === null ? 'not "flying again" by the measure at 20 s' : `flying again from ${f1(again.from)} s`}; the most bank ${f1(rolled)} degrees and the nose up to ${f1(Math.max(...free.map((s) => s.th)))} after letting go; ${s1.h - lowest > 1 ? `the lowest ${(s1.h - lowest).toFixed(0)} ft below where it let go` : 'no height lost'}`;
    return { text, story: [Boolean(gone), rolled > 60, again.from !== null].join() };
  };
  for (const c of cases) {
    const on = flyCase(c, F4C.assists), off = flyCase(c, NO_FEET);
    say(`${c.where}: ${on.text}`);
    if (off.story !== on.story) say(`  feet off: ${off.text}`);
  }
});
