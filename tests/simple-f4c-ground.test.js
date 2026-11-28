// The simple F-4C on the ground and round the pattern: tilt steers on the ground, the swap between pedals and
// ailerons as the wheels leave and touch, the straight stick, and the circuit. Milestone 3 re-planned, pull
// request 4 (docs/milestones/3-replan.md, "PR 4. Tilt steers on the ground; the simple F-4C in the picker: first
// flight"). The "done" lines were written in the plan before any of this was built; each test that holds one is
// named for it, in the plan's words, and asserts what the line says. The swap itself is in the shared control
// run (aircraft/simple/controls.xml), which says how it is built.
//
// How each line is read, where the plan's words leave a choice. Each is the plain reading, written down after the
// throwaway runs (which tried every line before this file existed) and before these tests were first run; none
// was changed after a result:
//   "a 10 degree tilt"   the phone turned 10 degrees from neutral. Through the tilt's own mapping
//                     (src/input/tilt.js: nothing for 1.5 degrees, then a straight line to full stick at 30)
//                     that is 8.5 / 28.5 = 0.298 of the roll stick, and on the straight stick that is what is
//                     sent. Full aileron and full rudder are 30 degrees each, so it asks 8.95 degrees of either.
//   "half a second after any wheel touches"   a wheel has been on the ground for half a second without a break.
//                     (A bounce shorter than that is neither on the ground nor in the air by these lines.)
//   "half a second after the last wheel leaves"   no wheel has touched for half a second.
//   "whatever the tilt"   full left, full right, 10 degrees and neutral, held through the touch and put in at it;
//                     and all the way round the circuit.
//   "the ailerons follow the tilt"   each aileron is within half a degree (the line's own figure for neutral) of
//                     what the tilt asks: the stick times the aileron's travel times the control run's share
//                     at that speed (all of it below 400 knots).
//   "the tilt no longer moves the rudder"   the rudder is where the copilot's command alone puts it, to a
//                     hundredth of a degree; and two flights the same to that moment, given opposite full
//                     tilts for one step, have the same rudder to the last digit.
//   "with a 10 degree tilt held"   held from the moment the nosewheel lifts, through the liftoff, for a second
//                     more. (Held from the brakes' release it would steer the airplane off the runway: on the
//                     ground the tilt is the pedals.)
//   "the wheels leave"   the first step with no wheel on the ground, none touching again for a second.
//   "reach what the tilt asks"   the first step from which the left aileron is within a hundredth of a degree
//                     of what the tilt asks.
//   "with no step"    in no one physics step (1/120 s) do the ailerons move more than a steady swap over that
//                     quarter second would: a thirtieth of what the tilt asks.
//   "a taxi, tilt full over, a quarter throttle"   as tests/f4c-low.test.js flew the line this gear met before:
//                     from the numbers, brakes off, for 90 s; the circle is the box round where the centre of
//                     gravity went after the first 30 s.
//   "at 100 knots on the roll, a 10 degree tilt for 3 s"   full afterburner from the numbers, the stick neutral in
//                     pitch, the tilt put in as the airspeed passes 100 knots and held 3 s. "Comes round": the
//                     heading's change over those 3 s, toward the tilt.
//   "hands off in roll ... to liftoff"   the owner's takeoff (full back tilt from 80 knots, eased once it flies),
//                     the roll stick never touched: the furthest from the centreline with any wheel on the ground.
//   "the copilot's only moving command"   of the commands the copilot writes (the tape's inputs that no control
//                     drives), only the rudder ever changes, all the way round the circuit.
//   "the pitch trim it holds reads zero all flight"   JSBSim's fcs/pitch-trim-cmd-norm read back after every step
//                     of the circuit.
//   "a 1,500 ft pattern at 250 knots, final at 150"   as the data-built jet's circuit line had them
//                     (docs/milestones/3.md): downwind within 100 ft and 10 knots, final within 10 knots.
//   "at 600 ft/min or less"   every touch of the landing, not only the first.
//   "stopped on the runway"   standing still inside the runway's edges, brakes on, on brakes alone.
//
// Every measured number is printed and kept in jsbsim/build/results/checkride-simple-f4c-ground.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { F4C_SIMPLE } from '../src/sim/aircraft/f4c-simple.js';
import { assistWrites, wheelShare } from '../src/sim/assists.js';
import { DT, Flight, commandsFor } from '../src/sim/game.js';
import { controlsFrom, gentle } from '../src/input/pilot.js';
import { MAPPING, shape } from '../src/input/tilt.js';
import { FIELD, FT, toWorld } from '../src/sim/world.js';
import { bitEqual, classB, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { CIRCUIT, flyCircuit } from './checkride/circuit.js';
import { bytesOf, moduleWith } from './checkride/files.js';
import * as P from './checkride/simple-pilot.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

const A = F4C_SIMPLE;
const DEG = 180 / Math.PI, KT = 1.6878;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const f0 = (x) => x.toFixed(0), f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3), f0pc = (x) => `${(x * 100).toFixed(0)}%`;
/** Any seven controls: only the names of the commands they drive are wanted. */
const flyingControls = { pitch: 0, roll: 0, throttle: 0, gear: true, flaps: 0.5, speedbrake: false, brake: false };
/** A 10 degree tilt of the phone, as the roll stick (src/input/tilt.js). */
const TEN = shape(10, MAPPING.rollDeadband, MAPPING.rollFull);
/** The travels in the airplane's file, degrees: each aileron, the rudder, the nosewheel. */
const file = bytesOf(A, A.files[0]).toString();
const number = (name) => Number(file.match(new RegExp(`<property value="([^"]+)"> ${name} </property>`))[1]);
const AILERON = number('simple/aileron-deg'), RUDDER = number('simple/rudder-deg'), NOSEWHEEL = Number(file.match(/<max_steer unit="DEG"> (\d+) <\/max_steer>/)[1]);
/** FSG's steering curve, the one the data-built F-4C's copilot has (src/sim/aircraft/f4c.js). */
const CURVE = F4C.assists.steer.wheel;

const report = new Report('checkride-simple-f4c-ground');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);

const loaded = {};
const module = (variant = 'weh') => (loaded[variant] ??= moduleWith(A, variant));

/** What a test reads after a step: where the airplane is on the runway, and where its surfaces are. */
function look(flight) {
  const v = (name) => flight.value(name), at = toWorld(v('position/lat-geod-rad'), v('position/long-gc-rad'));
  const wheels = [0, 1, 2].map((k) => v(`gear/unit[${k}]/WOW`));
  return {
    t: v('simulation/sim-time-sec'), kt: v('velocities/vc-kts'), groundKt: v('velocities/vg-fps') / KT, heading: v('attitude/psi-rad') * DEG - FIELD.runway.headingDeg,
    off: (at.north - FIELD.start.north) / FT, bank: v('attitude/phi-rad') * DEG, pitch: v('attitude/theta-rad') * DEG, feet: v('position/h-agl-ft') - A.standingFt,
    left: v('fcs/left-aileron-pos-rad') * DEG, right: v('fcs/right-aileron-pos-rad') * DEG, rudder: v('fcs/rudder-pos-rad') * DEG, wheel: v('fcs/steer-pos-deg'),
    wheels, down: wheels.filter((w) => w === 1).length,
  };
}
/** How long a wheel has been on the ground without a break, and how long none has, seconds (-1: not so now). */
function spells() {
  let on = null, off = null;
  return (r) => {
    if (r.down > 0) { on ??= r.t; off = null; } else { off ??= r.t; on = null; }
    return { onFor: on === null ? -1 : r.t - on, offFor: off === null ? -1 : r.t - off };
  };
}
/** The copilot's rudder command as it was written for the last step, -1 to 1 (JSBSim's sense: positive nose left). */
const copilotRudder = (flight) => flight.inputs[flight.inputNames.indexOf(A.assists.feet.to)];
const step = (flight) => assert.equal(flight.step(1), 0, 'JSBSim stepped');

// ---- the settings, and the straight stick ----

test('simple f4c ground: the straight stick: for an airplane whose settings ask for it the tilt\'s stick is sent as it is; the data-built F-4C and the Cessna keep the softer middle; no airplane but the simple one asks', () => {
  const pilot = { throttle: 0.4, gear: true, flaps: 0.5, speedbrake: false, brake: false };
  for (const held of [-1, -0.75, -TEN, -0.1, 0, 0.1, TEN, 0.5, 0.75, 1]) {
    const simple = controlsFrom(pilot, { pitch: held, roll: -held }, A);
    assert.deepEqual([simple.pitch, simple.roll], [held, -held], `the simple F-4C at ${held}: straight`);
    for (const other of [F4C, C172P, null]) {
      const sent = controlsFrom(pilot, { pitch: held, roll: -held }, other);
      assert.deepEqual([sent.pitch, sent.roll], [gentle(held), gentle(-held)], `${other?.model ?? 'no airplane'} at ${held}: the softer middle`);
    }
  }
  assert.equal(A.straightStick, true);
  assert.equal(F4C.straightStick, undefined);
  assert.equal(C172P.straightStick, undefined);
  // Whatever comes in, what goes out is still a number from -1 to 1.
  for (const bad of [NaN, Infinity, undefined, null, 'x']) assert.deepEqual([controlsFrom(pilot, { pitch: bad, roll: bad }, A).pitch, controlsFrom(pilot, { pitch: bad, roll: bad }, A).roll].map(Number.isFinite), [true, true]);
  assert.deepEqual([controlsFrom(pilot, { pitch: 3, roll: -3 }, A).pitch, controlsFrom(pilot, { pitch: 3, roll: -3 }, A).roll], [1, -1]);
  assert.ok(Math.abs(TEN - 8.5 / 28.5) < 1e-12, 'a 10 degree tilt is 8.5 / 28.5 of the roll stick');
  report.line(`simple f4c ground: the straight stick: a 10 degree tilt sends ${f3(controlsFrom(pilot, { pitch: 0, roll: TEN }, A).roll)} of the roll stick on the simple F-4C (${f2(TEN * AILERON)} degrees of aileron in the air, of rudder on the ground) and ${f3(controlsFrom(pilot, { pitch: 0, roll: TEN }, F4C).roll)} on the data-built one`);
});

test('simple f4c ground: the nosewheel\'s share in the control run is FSG\'s curve (src/sim/assists.js, wheelShare: a half at 28 knots, power 3), read back from JSBSim from standing to 150 knots; nothing in the game steers', async () => {
  assert.deepEqual([CURVE.halfAtKt, CURVE.power], [28, 3], 'the curve FSG has');
  assert.equal(A.assists.steer, undefined, 'the simple F-4C\'s copilot has no steering');
  const flight = Flight.start(await module(), A);
  assert.ok(!flight.inputNames.includes('fcs/steer-cmd-norm'), 'the game writes no nosewheel command');
  let most = 0, last = 0, kt = 0;
  const seen = [];
  for (let k = 0; k < 40 / DT; k++) {
    flight.fly({ brake: false, throttle: 1, pitch: 0, roll: 0 });
    // The control run works with the ground speed JSBSim had as the step began: the one in the state before it.
    kt = flight.value('velocities/vg-fps') / KT;
    step(flight);
    const share = flight.get('simple/wheel-share');
    most = Math.max(most, Math.abs(share - wheelShare(kt, CURVE)));
    if (kt >= last) { seen.push(`${(share * 100).toFixed(1)}% at ${kt.toFixed(0)} kt`); last += 28; }
    if (kt > 150) break;
  }
  flight.dispose();
  report.line(`simple f4c ground: the nosewheel's share of the tilt, read back from JSBSim on a takeoff roll: ${seen.join(', ')}; the most it differs from src/sim/assists.js's wheelShare: ${most.toExponential(1)}`);
  assert.ok(last > 140, 'read up to 150 knots');
  assert.ok(most < 1e-9, `${most}`);
});

// ---- the swap ----

/** An arrival on the mains: a few feet up at 150 knots, the nose 8 degrees up, sinking 300 ft/min, gear and full flaps down, idle (after tests/f4c-low.test.js, `arrive`). */
function arrive(m, { before, after, bankDeg = 0, heightFt = 7.6 }) {
  const sets = [['ic/h-agl-ft', heightFt], ['ic/theta-deg', 8], ['ic/phi-deg', bankDeg], ['ic/vn-fps', 0], ['ic/ve-fps', 150 * KT], ['ic/vd-fps', 300 / 60]];
  const flight = Flight.start(m, A, { sets, settleSeconds: 0, controls: { gear: true, brake: false, flaps: 1, throttle: 0 } }), since = spells();
  assert.equal(look(flight).down, 0, 'in the air at the start');
  const out = { touched: null, ailerons: 0, pedals: 0, copilot: 0, checked: 0, atTouch: null, later: {} };
  for (let k = 0; k < 5 / DT; k++) {
    flight.fly({ roll: out.touched === null ? before : after, pitch: 0, throttle: 0 });
    step(flight);
    const r = look(flight), { onFor } = since(r);
    if (out.touched === null && r.down > 0) { out.touched = r.t; out.atTouch = r; }
    if (out.touched !== null) for (const s of [0.1, 0.2, 0.3]) if (out.later[s] === undefined && r.t >= out.touched + s - 1e-9) out.later[s] = r;
    if (onFor >= 0.5) {
      out.checked++;
      out.ailerons = Math.max(out.ailerons, Math.abs(r.left), Math.abs(r.right));
      out.pedals = Math.max(out.pedals, Math.abs(r.rudder + after * RUDDER));       // right tilt, right rudder: JSBSim's angle is negative
      out.copilot = Math.max(out.copilot, Math.abs(copilotRudder(flight)));
    }
  }
  flight.dispose();
  return out;
}

test('simple f4c ground: "from half a second after any wheel touches, whatever the tilt: both ailerons within 0.5 degrees of neutral; from half a second after the last wheel leaves: the ailerons follow the tilt and the tilt no longer moves the rudder"', async () => {
  const m = await module();
  // Touching down, whatever the tilt: held through the touch, and put in at it.
  report.line('simple f4c ground: touching down on the mains at 150 kt, sinking 300 ft/min, with the tilt as said; from half a second after the touch:');
  for (const [label, before, after, bankDeg, heightFt] of [['neutral', 0, 0, 0], ['10 degrees right, held through', TEN, TEN, 0], ['10 degrees left, held through', -TEN, -TEN, 0], ['full right, held through', 1, 1, 0], ['full left, held through', -1, -1, 0],
    ['full right, put in at the touch', 0, 1, 0], ['full left, put in at the touch', 0, -1, 0], ['10 degrees right, one wheel first (banked 3 degrees left)', TEN, TEN, -3, 8.5]]) {
    const a = arrive(m, { before, after, bankDeg, heightFt });
    say(`${label}: at the touch the left aileron is at ${f2(a.atTouch.left)} degrees, ${f2(a.later[0.1].left)} a tenth of a second on, ${f2(a.later[0.2].left)} at two, ${f2(a.later[0.3].left)} at three; from half a second on: the ailerons ${f3(a.ailerons)} degrees from neutral at most, the rudder ${f3(a.pedals)} from what the tilt asks (${f1(-after * RUDDER)}), while the copilot asked for up to ${f0pc(a.copilot)} of it`);
    assert.ok(a.touched !== null && a.checked > 4 / DT - 10, 'it touched and stayed down');
    assert.ok(a.ailerons <= 0.5, `${label}: the ailerons ${a.ailerons} degrees from neutral`);
    assert.ok(a.pedals <= 0.01, `${label}: on the ground the rudder is the tilt's alone (${a.pedals})`);
  }

  // A takeoff with the tilt moved about, on the runway from 100 knots and in the air: every step of it.
  const moved = [1, -1, -1, 1, TEN, -TEN, 0, 0.5, -0.5, -TEN, TEN, 0];   // a quarter second each, over and over
  const flight = Flight.start(m, A), since = spells();
  const seen = { ground: { ailerons: 0, pedals: 0, copilot: 0, steps: 0 }, air: { ailerons: 0, rudder: 0, steps: 0, tilts: new Set(), copilot: 0 }, left: null, gearing: null };
  for (let k = 0; k < 60 / DT; k++) {
    const p = P.seen(flight), tilt = p.kt > 100 ? moved[Math.floor(k / 30) % moved.length] : 0;
    flight.fly({ brake: false, throttle: 1, pitch: P.wingsTakeoffPilot(p), roll: tilt });
    step(flight);
    const r = look(flight), { onFor, offFor } = since(r);
    if (onFor >= 0.5) {
      seen.ground.steps++;
      seen.ground.ailerons = Math.max(seen.ground.ailerons, Math.abs(r.left), Math.abs(r.right));
      seen.ground.pedals = Math.max(seen.ground.pedals, Math.abs(r.rudder + tilt * RUDDER));
      if (tilt !== 0) seen.ground.copilot = Math.max(seen.ground.copilot, Math.abs(copilotRudder(flight)));
    }
    if (r.down === 0) seen.left ??= r.t;
    if (offFor >= 0.5) {
      seen.gearing ??= flight.get('simple/roll-gearing');
      seen.air.steps++;
      seen.air.tilts.add(tilt);
      seen.air.ailerons = Math.max(seen.air.ailerons, Math.abs(r.left - tilt * AILERON), Math.abs(r.right + tilt * AILERON));
      seen.air.rudder = Math.max(seen.air.rudder, Math.abs(r.rudder - copilotRudder(flight) * RUDDER));
      seen.air.copilot = Math.max(seen.air.copilot, Math.abs(copilotRudder(flight)));
    }
    if (seen.left !== null && r.t > seen.left + 4) break;
  }
  flight.dispose();
  report.line(`simple f4c ground: a takeoff with the tilt moved about (${moved.map((x) => f2(x)).join(', ')} of the stick, a quarter second each) from 100 kt on the runway and for 4 s after the liftoff:`);
  say(`on the runway, ${seen.ground.steps} steps half a second or more after a wheel touched: the ailerons ${f3(seen.ground.ailerons)} degrees from neutral at most; the rudder ${f3(seen.ground.pedals)} degrees from what the tilt asks, while the copilot asked for up to ${f0pc(seen.ground.copilot)} of it`);
  say(`in the air, ${seen.air.steps} steps half a second or more after the last wheel left: each aileron ${f3(seen.air.ailerons)} degrees at most from what the tilt asks; the rudder ${f3(seen.air.rudder)} degrees at most from where the copilot's command alone puts it (the copilot asked for up to ${f0pc(seen.air.copilot)} of it)`);
  assert.ok(seen.ground.steps > 2 / DT && seen.air.steps > 3 / DT && seen.air.tilts.size >= 6, 'both were flown, with the tilt moved');
  assert.equal(seen.gearing, 1, 'below 400 knots the tilt asks all of the aileron\'s travel');
  assert.ok(seen.ground.ailerons <= 0.5, `on the ground the ailerons are within 0.5 degrees of neutral (${seen.ground.ailerons})`);
  assert.ok(seen.ground.pedals <= 0.01, `on the ground the rudder is the tilt's alone (${seen.ground.pedals})`);
  assert.ok(seen.ground.copilot > 0.01, 'and the copilot was asking for rudder there, which did not count');
  assert.ok(seen.air.ailerons <= 0.5, `in the air the ailerons follow the tilt (${seen.air.ailerons})`);
  assert.ok(seen.air.rudder <= 0.01, `in the air the rudder is the copilot's alone (${seen.air.rudder})`);
  assert.ok(seen.air.copilot > 0.01, 'and the copilot was using it');

  // The tilt no longer moves the rudder: two flights the same until half a second after the liftoff, then one step
  // with full right tilt in one and full left in the other. And the mirror image at 100 knots on the runway.
  const twins = (when) => {
    const out = [];
    for (const tilt of [1, -1]) {
      const f = Flight.start(m, A), s = spells();
      let r, done = false;
      for (let k = 0; k < 60 / DT && !done; k++) {
        const p = P.seen(f);
        done = when(p, s(look(f)));
        f.fly({ brake: false, throttle: 1, pitch: P.wingsTakeoffPilot(p), roll: done ? tilt : 0 });
        step(f);
        r = look(f);
      }
      assert.ok(done, 'the moment came');
      out.push({ ...r, rudderRad: f.value('fcs/rudder-pos-rad'), copilot: copilotRudder(f) });
      f.dispose();
    }
    return out;
  };
  const [airRight, airLeft] = twins((p, { offFor }) => offFor >= 0.5), [groundRight, groundLeft] = twins((p) => p.onWheels && p.kt >= 100);
  say(`two flights the same to half a second after the liftoff (${f1(airRight.kt)} kt), then one step with full right tilt in one and full left in the other: the left aileron ${f2(airRight.left)} and ${f2(airLeft.left)} degrees; the rudder ${airRight.rudder.toFixed(6)} and ${airLeft.rudder.toFixed(6)}`);
  say(`the same at 100 kt on the runway: the left aileron ${f2(groundRight.left)} and ${f2(groundLeft.left)} degrees; the rudder ${f2(groundRight.rudder)} and ${f2(groundLeft.rudder)} (the copilot asked for ${f0pc(Math.abs(groundRight.copilot))} of it in both)`);
  assert.equal(airRight.down + airLeft.down, 0);
  assert.equal(airRight.rudderRad, airLeft.rudderRad, 'in the air the rudder is the same whatever the tilt, to the last digit');
  assert.ok(Math.abs(airRight.left - AILERON) < 1e-6 && Math.abs(airLeft.left + AILERON) < 1e-6 && airRight.right === -airRight.left, 'and the ailerons are the tilt\'s');
  assert.ok(groundRight.down === 3 && groundLeft.down === 3);
  assert.ok(groundRight.left === 0 && groundRight.right === 0 && groundLeft.left === 0 && groundLeft.right === 0, 'on the ground the ailerons are neutral whatever the tilt');
  assert.ok(Math.abs(groundRight.rudder + RUDDER) < 1e-6 && Math.abs(groundLeft.rudder - RUDDER) < 1e-6, 'and the rudder is the tilt\'s: right tilt, right rudder');
});

test('simple f4c ground: "across a liftoff with a 10 degree tilt held, the ailerons reach what the tilt asks no sooner than a quarter second and no later than half a second after the wheels leave, with no step"', async () => {
  const asked = TEN * AILERON, rows = [];
  for (const tilt of [TEN, -TEN]) {
    const flight = Flight.start(await module(), A), run = [];
    let held = false, clear = 0, left = null;
    for (let k = 0; k < 60 / DT; k++) {
      const p = P.seen(flight);
      held ||= p.kt > 30 && !p.touching.includes('nose wheel');   // from the moment the nosewheel lifts
      flight.fly({ brake: false, throttle: 1, pitch: P.wingsTakeoffPilot(p), roll: held ? tilt : 0 });
      step(flight);
      const r = look(flight);
      run.push({ ...r, held, copilot: copilotRudder(flight) });
      clear = r.down === 0 ? clear + 1 : 0;
      if (clear === 1) left = run.length - 1;
      if (clear >= 1.5 / DT) break;
    }
    flight.dispose();
    assert.ok(left !== null && run.length - 1 - left >= 1 / DT, 'the wheels left, and none touched again for a second');
    const t0 = run[left].t, sign = Math.sign(tilt), after = (s) => run.find((r) => r.t >= t0 + s - 1e-9);
    // "Reach": the first step from which the left aileron stays within a hundredth of a degree of what the tilt asks.
    let reached = run.length;
    while (reached > 0 && Math.abs(run[reached - 1].left - tilt * AILERON) <= 0.01) reached--;
    const seconds = run[reached].t - t0;
    // "No step": the most either aileron moves in one physics step, from when the tilt went in to the end.
    const from = run.findIndex((r) => r.held);
    let most = 0, mostRudder = 0;
    for (let i = Math.max(from + 1, left - Math.round(0.5 / DT)); i < run.length; i++) {
      most = Math.max(most, Math.abs(run[i].left - run[i - 1].left), Math.abs(run[i].right - run[i - 1].right));
      mostRudder = Math.max(mostRudder, Math.abs(run[i].rudder - run[i - 1].rudder));
    }
    rows.push({ tilt, seconds, most, run, left, t0 });
    report.line(`simple f4c ground: a liftoff with a 10 degree ${sign > 0 ? 'right' : 'left'} tilt held from the nosewheel's lifting (${f1(run[from].kt)} kt; it has the nose ${f2(sign * run[left].heading)} degrees round and is ${f1(Math.abs(run[left].off))} ft off the centreline as the wheels leave at ${f1(run[left].kt)} kt):`);
    say(`the left aileron reaches the ${f2(sign * asked)} degrees the tilt asks ${f3(seconds)} s after the wheels leave (the line: 0.25 to 0.5); the most it moves in one step is ${f3(most)} degrees (the line: no more than a thirtieth of ${f2(asked)}, ${f3(asked / 30)}); the rudder's most in a step ${f3(mostRudder)}`);
    say(`aileron and rudder against time from the wheels leaving: ${[0, 0.1, 0.2, 0.3, 0.4, 0.5, 1].map((s) => { const r = after(s); return `${s} s: ${f2(r.left)} and ${f2(r.rudder)} (bank ${f1(r.bank)})`; }).join('; ')} degrees. The rudder after the swap is the copilot's, coordinating the roll.`);
    assert.ok(Math.abs(run[left].left) < 0.3 && run[left - 1].left === 0, 'as the wheels leave the ailerons are still neutral');
    assert.ok(seconds >= 0.25, `no sooner than a quarter second (${seconds})`);
    assert.ok(seconds <= 0.5, `no later than half a second (${seconds})`);
    assert.ok(most <= asked / 30 + 1e-9, `no step: ${most} degrees in one step`);
    // And it goes one way only: never back toward neutral, never past what the tilt asks.
    for (let i = left; i < reached; i++) assert.ok(sign * (run[i + 1].left - run[i].left) >= -1e-9 && sign * run[i + 1].left <= asked + 1e-9, 'the ailerons go steadily to what the tilt asks');
  }
  assert.ok(Math.abs(rows[0].seconds - rows[1].seconds) < 1e-9, 'left and right alike');
});

// ---- steering ----

/** A roll from the numbers, brakes off: `tilt(c)` gives the roll stick, the pitch stick neutral. Stops at `until(c)` or when it flies. */
function rollOut(m, tilt, { throttle = 1, seconds = 80, until = null } = {}) {
  const flight = Flight.start(m, A), c = {}, box = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity };
  let bank = 0, wheelsDown = true, ailerons = 0;
  for (let k = 0; k < seconds / DT; k++) {
    const t = k * DT, before = look(flight), at = toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
    Object.assign(c, before, { t });
    flight.fly({ brake: false, throttle, pitch: 0, roll: clamp(tilt(c), -1, 1) });
    step(flight);
    const r = look(flight);
    if (t > 30) { box.w = Math.min(box.w, at.east); box.e = Math.max(box.e, at.east); box.s = Math.min(box.s, at.north); box.n = Math.max(box.n, at.north); }
    if (c.began !== undefined && t < c.began + c.holdFor) { bank = Math.max(bank, Math.abs(r.bank)); wheelsDown &&= r.down === 3; }
    if (t > 1) ailerons = Math.max(ailerons, Math.abs(r.left), Math.abs(r.right));
    Object.assign(c, { end: r });
    if (until && until(c)) break;
    if (r.down === 0) break;
  }
  flight.dispose();
  return { ...c, bank, wheelsDown, ailerons, circleFt: ((box.e - box.w) + (box.n - box.s)) / 2 / FT };
}
/** From `kt`, the roll stick at `stick` for `seconds`, and neutral before. */
const holds = (kt, stick, seconds) => (c) => {
  if (c.began === undefined && c.kt >= kt) Object.assign(c, { began: c.t, heading0: c.heading, holdFor: seconds, wheel0: null });
  if (c.began === undefined) return 0;
  if (c.wheel0 === null && c.t > c.began) c.wheel0 = { deg: c.wheel, groundKt: c.groundKt, rudder: c.rudder };
  return c.t < c.began + seconds ? stick : 0;
};
const after = (seconds) => (c) => c.began !== undefined && c.t >= c.began + seconds - 1e-9;

test('simple f4c ground: "a taxi, tilt full over, a quarter throttle: it turns in a circle 84 ft across or less (the line this gear met before)"', async () => {
  const m = await module();
  for (const [name, stick] of [['right', 1], ['left', -1]]) {
    const taxi = rollOut(m, () => stick, { throttle: 0.25, seconds: 90 }), r = taxi.end, share = wheelShare(r.groundKt, CURVE);
    report.line(`simple f4c ground: a taxi, tilt full ${name}, a quarter throttle, 90 s: a circle ${f1(taxi.circleFt)} ft across at ${f1(r.groundKt)} kt (the line: 84 or less; the data-built jet on the same gear: 27 ft, docs/milestones/3.md); the nosewheel ${f1(r.wheel)} degrees (${f0pc(share)} of its ${NOSEWHEEL}), the rudder ${f1(r.rudder)}, the ailerons ${f2(r.left)} and ${f2(r.right)}, banked ${f1(r.bank)}`);
    assert.ok(taxi.circleFt <= 84, `${taxi.circleFt} ft`);
    assert.ok(taxi.circleFt > 10, 'and it does go round');
    assert.ok(Math.abs(r.wheel - stick * NOSEWHEEL * share) < 0.5, 'the nosewheel is the tilt, by its share at that speed');
    assert.ok(Math.abs(r.rudder + stick * RUDDER) < 1e-6 && taxi.ailerons === 0, 'the rudder is full over and the ailerons never moved');
  }
});

test('simple f4c ground: "at 100 knots on the roll, a 10 degree tilt for 3 s: the nose comes round 1 to 10 degrees, the bank stays under 3 degrees, every wheel stays down"', async () => {
  const m = await module();
  for (const [name, stick] of [['right', TEN], ['left', -TEN]]) {
    const r = rollOut(m, holds(100, stick, 3), { until: after(3) }), round = (r.end.heading - r.heading0) * Math.sign(stick);
    report.line(`simple f4c ground: at ${f1(r.wheel0.groundKt)} kt on the roll, full afterburner, a 10 degree ${name} tilt for 3 s (to ${f0(r.end.kt)} kt): the nose comes round ${f2(round)} degrees (the line: 1 to 10), the most bank ${f2(r.bank)} degrees (under 3), every wheel down: ${r.wheelsDown ? 'yes' : 'NO'}; the rudder ${f2(r.wheel0.rudder)} degrees, the nosewheel ${f2(r.wheel0.deg)}, the ailerons ${f2(r.ailerons)}; it ends ${f1(Math.abs(r.end.off))} ft off the centreline`);
    assert.ok(Math.abs(r.wheel0.groundKt - 100) < 2, 'at 100 knots');
    assert.ok(round >= 1 && round <= 10, `the nose comes round ${round} degrees`);
    assert.ok(r.bank < 3, `bank ${r.bank}`);
    assert.ok(r.wheelsDown, 'every wheel stays down');
    assert.equal(r.ailerons, 0, 'and the ailerons do not move');
  }
  // Reported beside it: the same tilt slower, where the nosewheel has more of it; and full tilt at 100 knots.
  for (const [what, kt, stick] of [['a 10 degree right tilt for 3 s from 10 kt', 10, TEN], ['from 30 kt', 30, TEN], ['from 60 kt', 60, TEN], ['from 140 kt', 140, TEN], ['full right tilt for 3 s from 100 kt', 100, 1]]) {
    const r = rollOut(m, holds(kt, stick, 3), { until: after(3) });
    say(`reported: ${what} (to ${f0(r.end.kt)} kt): the nose comes round ${f1(r.end.heading - r.heading0)} degrees, the most bank ${f2(r.bank)}, every wheel down: ${r.wheelsDown ? 'yes' : 'no'}; the nosewheel ${f2(r.wheel0.deg)} degrees at the start; ${f0(Math.abs(r.end.off))} ft off the centreline at the end`);
  }
});

test('simple f4c ground: "hands off in roll, full afterburner: within 10 ft of the centreline to liftoff"', async () => {
  const flight = Flight.start(await module(), A);
  let off = 0, heading = 0, bank = 0, liftoff = null;
  for (let k = 0; k < 60 / DT && liftoff === null; k++) {
    flight.fly({ brake: false, throttle: 1, pitch: P.wingsTakeoffPilot(P.seen(flight)), roll: 0 });
    step(flight);
    const r = look(flight);
    if (r.down === 0) { liftoff = r; break; }
    off = Math.max(off, Math.abs(r.off)); heading = Math.max(heading, Math.abs(r.heading)); bank = Math.max(bank, Math.abs(r.bank));
    assert.ok(r.left === 0 && r.right === 0 && r.wheel === 0 && Math.abs(r.rudder) < 1e-9, 'nothing steers it: ailerons, nosewheel and rudder all neutral on the runway');
  }
  const along = toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad')).east / FT;
  flight.dispose();
  assert.ok(liftoff, 'it lifted off');
  report.line(`simple f4c ground: hands off in roll, full afterburner, the owner's takeoff (full back tilt from 80 kt): ${off.toFixed(2)} ft from the centreline at most up to the liftoff at ${f1(liftoff.kt)} kt, ${f0(along)} ft down the runway; the heading ${heading.toFixed(3)} degrees off at most, the bank ${bank.toFixed(3)} (the line: within 10 ft). Nothing pulls a simple airplane off the centreline, so nothing holds it there.`);
  assert.ok(off <= 10, `${off} ft`);
});

// ---- the circuit ----

test('simple f4c ground: "the copilot\'s only moving command is the rudder; the pitch trim it holds reads zero all flight" and "the circuit, crash override off: takeoff, a 1,500 ft pattern at 250 knots, final at 150, touchdown on the mains in the first third within 25 ft of the centreline at 600 ft/min or less, stopped on the runway. Its tape replays in native JSBSim"', async () => {
  const { runway } = FIELD, firstThird = { from: -runway.startBackFt, to: -runway.startBackFt + runway.lengthFt / 3 };
  const how = CIRCUIT.get(A), flown = {};
  assert.ok(how.patternFt === 1500 && how.downwindKt === 250 && how.finalKt === 150 && how.takeoffFlaps === 0.5 && how.fullBackFromKt === 80, 'the plan\'s pattern, and the owner\'s takeoff');
  assert.deepEqual(Object.keys(A.assists).sort(), ['feet', 'trim'], 'the copilot: a held trim and the feet');
  assert.deepEqual(assistWrites(A.assists), ['fcs/pitch-trim-cmd-norm', 'fcs/rudder-cmd-norm']);
  assert.deepEqual(A.assists.trim.sets, [['fcs/pitch-trim-cmd-norm', 0]]);
  for (const variant of VARIANTS) {
    const trim = { most: 0, steps: 0 };
    const c = flown[variant] = flyCircuit(await module(variant), A, { record: true, watch: (flight) => { trim.steps++; trim.most = Math.max(trim.most, Math.abs(flight.get('fcs/pitch-trim-cmd-norm'))); } });
    const d = c.downwind, f = c.final, landing = c.touches.filter((e) => e.time > c.marks.liftoff.t + 10), first = landing[0], td = c.marks.touchdown, tape = c.tape;
    report.line(`simple f4c ground, the circuit, ${variant}: ${c.seconds.toFixed(0)} s from parked to stopped`);
    say(`${variant}: the owner's takeoff: liftoff at ${c.marks.liftoff.knots.toFixed(0)} kt, ${c.marks.liftoff.along.toFixed(0)} ft down the runway, ${Math.abs(c.marks.liftoff.right).toFixed(1)} ft from the centreline`);
    say(`${variant}: downwind for ${d.seconds.toFixed(0)} s: ${d.low.toFixed(0)} to ${d.high.toFixed(0)} ft (target ${how.patternFt}; within 100), ${d.slow.toFixed(1)} to ${d.fast.toFixed(1)} kt (target ${how.downwindKt}; within 10)`);
    say(`${variant}: final for ${f.seconds.toFixed(0)} s: ${f.slow.toFixed(1)} to ${f.fast.toFixed(1)} kt (target ${how.finalKt}; within 10)`);
    say(`${variant}: touchdown: ${first.point} first, ${td.along.toFixed(0)} ft down the runway (the first third ends at ${firstThird.to.toFixed(0)}), ${Math.abs(td.right).toFixed(1)} ft from the centreline, ${td.knots.toFixed(0)} kt; every touch: ${landing.map((e) => `${e.point} ${e.closingFpm.toFixed(0)}`).join(', ')} ft/min (600 or less)`);
    say(`${variant}: stopped ${c.end.along.toFixed(0)} ft down the runway, ${Math.abs(c.end.right).toFixed(1)} ft from the centreline: a landing roll of ${(c.end.along - td.along).toFixed(0)} ft from ${td.knots.toFixed(0)} kt, brakes ${c.brakeOn ? 'on' : 'off'}`);
    assert.ok(c.onlyTheSeven, 'the pilot used only the seven controls');
    assert.equal(c.ended, null, `no crash (${JSON.stringify(c.ended)})`);
    assert.equal(c.phase, 'stop');
    assert.ok(c.marks.liftoff.knots > 150 && c.marks.liftoff.along < runway.lengthFt - runway.startBackFt, 'the takeoff');
    assert.ok(d.seconds > 30 && d.low >= how.patternFt - 100 && d.high <= how.patternFt + 100, 'a 1,500 ft pattern: downwind within 100 ft');
    assert.ok(d.slow >= how.downwindKt - 10 && d.fast <= how.downwindKt + 10, 'at 250 knots: downwind within 10 kt');
    assert.ok(f.seconds > 30 && f.slow >= how.finalKt - 10 && f.fast <= how.finalKt + 10, 'final at 150: within 10 kt');
    assert.ok(/main wheel/.test(first.point), `touchdown on the main wheels (${first.point})`);
    assert.ok(td.along >= firstThird.from && td.along <= firstThird.to, `in the first third (${td.along} ft)`);
    assert.ok(Math.abs(td.right) <= 25, `within 25 ft of the centreline (${td.right} ft)`);
    for (const e of landing) assert.ok(e.closingFpm <= 600, `${e.point} at ${e.closingFpm} ft/min`);
    assert.ok(c.touches.every((e) => e.wheel), 'no airframe point touched');
    assert.ok(c.end.groundKt < 1 && c.brakeOn, 'stopped, brakes on');
    assert.ok(c.end.along >= -runway.startBackFt && c.end.along <= runway.lengthFt - runway.startBackFt && Math.abs(c.end.right) <= runway.widthFt / 2, 'stopped on the runway');
    assert.equal(how.speedbrakeOnRunway ?? false, false, 'on brakes alone');
    assert.equal(c.fuelChange, 0, 'fuel as at the start');

    // The copilot, all the way round: of the commands it writes, only the rudder moves; the pitch trim reads zero.
    const driven = new Set(commandsFor(A, flyingControls).map(([name]) => name)), copilots = tape.ins.filter((name) => !driven.has(name));
    assert.deepEqual(copilots, ['fcs/pitch-trim-cmd-norm', 'fcs/rudder-cmd-norm'], 'the copilot\'s commands on the tape');
    const column = (name) => { const i = tape.ins.indexOf(name), out = new Float64Array(tape.steps); for (let k = 0; k < tape.steps; k++) out[k] = tape.inputs[k * tape.ins.length + i]; return out; };
    const trimSent = column('fcs/pitch-trim-cmd-norm'), rudderSent = column('fcs/rudder-cmd-norm');
    assert.ok(trimSent.every((x) => x === 0), 'the pitch trim the copilot holds is zero at every step');
    assert.ok(trim.steps > 300 / DT && trim.most === 0, `and JSBSim's pitch trim reads zero after every step (${trim.most})`);
    assert.ok(new Set(rudderSent).size > 1000, 'the rudder is the copilot\'s moving command');
    say(`${variant}: the copilot: it writes ${copilots.join(' and ')}; the pitch trim read back after each of ${trim.steps} steps: ${trim.most} at most; the rudder command ran from ${f2(Math.min(...rudderSent))} to ${f2(Math.max(...rudderSent))}`);

    // The swap, all the way round, from the tape: row k + 1 is the state after the step that row k's inputs went into.
    const S = tape.states, at = (row, name) => S.data[row * S.columns.length + S.columns.indexOf(name)], roll = column('fcs/aileron-cmd-norm'), since = spells();
    const swap = { ground: 0, air: 0, rudder: 0, groundSteps: 0, airSteps: 0, tiltOnGround: 0, fastest: 0 };
    for (let k = 0; k < tape.steps; k++) {
      const row = k + 1, down = [0, 1, 2].filter((w) => at(row, `gear/unit[${w}]/WOW`) === 1).length, { onFor, offFor } = since({ t: at(row, 'simulation/sim-time-sec'), down });
      const left = at(row, 'fcs/left-aileron-pos-rad') * DEG, right = at(row, 'fcs/right-aileron-pos-rad') * DEG, rudder = at(row, 'fcs/rudder-pos-rad') * DEG;
      if (onFor >= 0.5) { swap.groundSteps++; swap.ground = Math.max(swap.ground, Math.abs(left), Math.abs(right)); swap.tiltOnGround = Math.max(swap.tiltOnGround, Math.abs(roll[k])); }
      if (offFor >= 0.5) {
        swap.airSteps++; swap.fastest = Math.max(swap.fastest, at(row, 'velocities/vc-kts'));
        swap.air = Math.max(swap.air, Math.abs(left - roll[k] * AILERON), Math.abs(right + roll[k] * AILERON));
        swap.rudder = Math.max(swap.rudder, Math.abs(rudder - rudderSent[k] * RUDDER));
      }
    }
    say(`${variant}: the swap, all the way round: over ${swap.groundSteps} steps half a second or more after a wheel touched (the tilt up to ${f0pc(swap.tiltOnGround)} of the stick) the ailerons were ${f3(swap.ground)} degrees from neutral at most; over ${swap.airSteps} steps half a second or more after the last wheel left (never faster than ${f0(swap.fastest)} kt) each aileron was ${f3(swap.air)} degrees at most from what the tilt asked and the rudder ${f3(swap.rudder)} from the copilot's`);
    assert.ok(swap.groundSteps > 30 / DT && swap.airSteps > 200 / DT && swap.fastest < 400);
    assert.ok(swap.ground <= 0.5 && swap.air <= 0.5 && swap.rudder <= 0.01, 'the swap\'s first line holds all the way round the circuit');
    assert.ok(swap.tiltOnGround > 0, 'and the pilot did steer with the tilt on the runway');
  }
  assert.ok(bitEqual(flown.weh.tape.states, flown.jseh.tape.states).equal, 'both builds flew the same flight');
  // Matching native over the whole flight, by milestone 1's lines, as tests/f4c-low.test.js has them for the data-built jet.
  const tape = flown.weh.tape, { native, ensemble } = flyNative(tape, 'circuit-simple-f4c');
  assert.equal(tape.own, true);
  assert.deepEqual(tape.stepping, A.stepping);
  for (const variant of VARIANTS) {
    const whole = classB(native, flyWasm(await module(variant), tape, `circuit-simple-f4c-${variant}-judged`, JUDGED, { stepByStep: true }), ensemble);
    say(`${variant} against native, whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const col of whole.columns) say(`  ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole flight against native`);
  }
});
