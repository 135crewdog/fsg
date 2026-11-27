// The F-4C low and slow: its flaps, gear, speedbrakes and ground effect, its copilot, and its circuit.
// Milestone 3, pull request 7 (docs/milestones/3.md, "PR 7. Low and slow"). Each test that holds a line of
// the plan is named for the line, in the plan's words; the lines were written before any of this was built,
// and one of them is not met (the rotation): it stays here, a plain failing assertion, with what was found.
//
// How each line is read, where the plan's words leave a choice (decided before the runs; the reasons are at
// each test):
//   "the nosewheel lifts at"   the speed at the first step its tyre leaves the runway, the stick held full
//                              back from the brakes' release.
//   the stall                  the speed at which the angle of attack reaches the nose slice's onset (22
//                              degrees, and its end, 25.5: AFWAL's true angles for the flight manual's "26 to
//                              30 units"), in a slow wings-level approach to the stall (the angle of attack
//                              raised half a degree a second), reduced to 1 g the flight-test way: the speed
//                              over the square root of the load factor normal to the flight path.
//   "the speed is" (approach)  JSBSim's own trim, level, at the speed where its angle of attack is 11.7
//                              degrees: a settled value, not a moment of a flight.
//   "each swing"               a swing is from one turning point of the speed to the next, as the
//                              checkride measures every swing (tests/checkride/linear.js).
//   "within 3 s" (the nose)    half a degree the right way by 3 s, and still that way at 3 s.
//   final (the circuit)        from the first moment on the runway's heading after the base turn to the flare.
//   flap travel                from the switch moved to the flaps within 0.001 of the setting.
//
// Every measured number is printed beside its reference (tests/checkride/f4c-reference.js) and kept in
// jsbsim/build/results/checkride-f4c-low.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { Assists, askedTurn, wheelShare } from '../src/sim/assists.js';
import { DT, Flight } from '../src/sim/game.js';
import { gentle } from '../src/input/pilot.js';
import { flatSource } from '../src/sim/ground.js';
import { WINGS_CRASH_FPM } from '../src/sim/rules.js';
import { FIELD, FT, toWorld } from '../src/sim/world.js';
import { bitEqual, classB, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import * as FLAPS from '../tools/f4c-flaps.mjs';
import { FACTORS, INCREMENTS, SHARED, UNCHANGED, lookup, machTables } from '../tools/f4c-mach.mjs';
import { CIRCUIT, flyCircuit } from './checkride/circuit.js';
import { GROUND, NO_FEET, STRAIGHT, pitchRate, respond, rudderFeet, yawRate } from './checkride/conditions.js';
import { bytesOf, moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';
import { factorsOf, measuresBeside, respond as respondLinear, transferFunction } from './checkride/linear.js';
import { SIX, snapshot, table1 } from './checkride/table1.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

const { WEIGHT, CG_PERCENT_CHORD, POWER_APPROACH_WEIGHT, POWER_APPROACH_KNOTS, POWER_APPROACH_ALPHA, POWER_APPROACH_STABILATOR, POWER_APPROACH_LIFT, POWER_APPROACH_DRAG,
  POWER_APPROACH_INERTIAS, ROLL_INERTIA, PITCH_INERTIA, YAW_INERTIA, CROSS_INERTIA, FULL_FLAP_STALL, FULL_FLAP_STALL_WEIGHT, NOSE_SLICE_ALPHA, ROTATION_SPEED, F4E_NOSEWHEEL_LIFTOFF,
  ON_SPEED_UNITS, F4E_APPROACH, HALF_FLAP_APPROACH_MORE, F4E_LANDING_ROLL, FLAPS_DOWN_SECONDS, FLAPS_UP_SECONDS, NOSEWHEEL_STEERING_UNTIL, NOSEWHEEL_STEERING_LIMIT, GEAR_SECONDS,
  WINGS_NEUTRAL_SPEED, WINGS_TAKEOFF, WINGS_LEAN, WINGS_SPEEDBRAKE_SECONDS, WINGS_IDLE_SLOWDOWN, SPEEDBRAKE_PANELS, WING_AREA, FLY_OFF_ATTITUDE } = REFERENCE;
const DEG = 180 / Math.PI, KT = 1.6878, S = WING_AREA.value;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
const file = bytesOf(F4C, F4C.files[0]).toString();
const CR = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/cr2144-f4c.json', import.meta.url)));
/** The fuel that makes a weight: the file's airplane is 30,000 lb and its one tank (aircraft/f4c/f4c.xml). */
const fuelFor = (weightLb) => ['propulsion/tank[0]/contents-lbs', weightLb - 30000];

const report = new Report('checkride-f4c-low');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);

let loaded = {};
const module = (variant = 'weh') => (loaded[variant] ??= moduleWith(F4C, variant));

/** Runs a flight for some seconds, calling `each(t)` before every step; stops early if `each` gives false. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
  }
}

// ---- 1. The tables are the tool's, and the wiring holds ----

test('f4c low: the flap and gear tables in the aircraft file are what tools/f4c-flaps.mjs works out, cell for cell, and the flaps\' factors at full are condition 1\'s', () => {
  const tables = FLAPS.flapTables(), { tables: inTheFile } = FLAPS.inFile();
  assert.equal(inTheFile, FLAPS.asXml(tables), 'node tools/f4c-flaps.mjs --write would change nothing');
  const found = [...inTheFile.matchAll(/<function name="([^"]+)">/g)].map(([, name]) => name);
  assert.deepEqual(found, Object.keys(tables));
  assert.deepEqual(found.filter((n) => n.startsWith('aero/flaps/factor/')).map((n) => n.slice('aero/flaps/factor/'.length)), FACTORS, 'a flap factor for every term the Mach factors have');
  // At full flaps the factors and increments are condition 1's (the tool's valuesAt); at half, halfway; up,
  // nothing. But the stabilator's power: half flaps take an eighth of full flaps' loss (the owner's choice
  // to keep his rotation speed: tools/f4c-flaps.mjs, HALF_FLAP_TAIL_SHARE).
  assert.equal(FLAPS.HALF_FLAP_TAIL_SHARE, 0.125);
  const pa = FLAPS.powerApproach();
  for (const name of FACTORS) {
    const rows = tables[`aero/flaps/factor/${name}`].rows;
    assert.deepEqual(rows.map((r) => r[0]), [0, 0.5, 1]);
    assert.equal(rows[0][1], 1);
    assert.ok(Math.abs(rows[2][1] / pa.factor[name] - 1) < 5e-4, `${name} full`);
    const share = ['lift-stabilator', 'pitch-stabilator'].includes(name) ? FLAPS.HALF_FLAP_TAIL_SHARE : 0.5;
    assert.ok(Math.abs(rows[1][1] - (1 + (pa.factor[name] - 1) * share)) < 5e-4 * Math.abs(rows[1][1]) + 1e-12, `${name} half`);
  }
  // The gear's and the flaps' drag and moment add up to condition 1's.
  const at1 = (name) => tables[name].rows.at(-1)[1];
  assert.ok(Math.abs(at1('aero/flaps/increment/drag') + at1('aero/gear/increment/drag') - pa.increment.drag) < 1e-4, 'the drag of condition 1, split');
  assert.ok(Math.abs(at1('aero/flaps/increment/pitch') + at1('aero/gear/increment/pitch') - pa.increment.pitch) < 1e-4, 'the pitching moment of condition 1, split');
  assert.equal(at1('aero/gear/increment/drag'), FLAPS.GEAR_DRAG);
  const { extra, stabilator, wanted } = FLAPS.stallExtra();
  report.line(`f4c low: ${found.length} tables of the flaps and the gear, each the tool's. Condition 1's factors (flaps full): ${FACTORS.map((n) => `${n} ${pa.factor[n].toFixed(3)}`).join(', ')}`);
  say(`increments at full flaps and gear down: lift ${pa.increment.lift.toFixed(4)}, drag ${pa.increment.drag.toFixed(4)} (the gear's ${FLAPS.GEAR_DRAG}), pitch ${pa.increment.pitch.toFixed(4)} (the gear's ${(-FLAPS.GEAR_DRAG * FLAPS.GEAR_ARM_FT / 16.04).toFixed(4)}), yaw for roll rate ${pa.increment['yaw-roll-rate'].toFixed(4)}, yaw for aileron ${pa.increment['yaw-aileron'].toFixed(5)}`);
  say(`the flaps' extra lift for the stall: ${extra.toFixed(4)} at ${FLAPS.STALL.alphaDeg} degrees (1 g at ${FLAPS.STALL.knots} kt and ${FLAPS.STALL.weightLb} lb is a lift coefficient of ${wanted.toFixed(3)}, the stabilator then ${stabilator.toFixed(1)} degrees)`);
});

/**
 * A flight started (not stepped) at a state, as tests/checkride/table1.js's startAt, with the flaps and the gear
 * where asked (both their control and their position, so they stay), far above the ground.
 */
function startLow(m, { alpha, beta, vt, heightFt = 15000, p = 0, q = 0, r = 0, pitch = 0, roll = 0, rudder = 0, flaps = 0, gear = 0 }) {
  const a = alpha / DEG, b = beta / DEG;
  return Flight.start(m, F4C, {
    assists: null, settleSeconds: 0, terrain: GROUND, controls: { gear: gear === 1, flaps, brake: false, throttle: 0, pitch, roll },
    sets: [['ic/h-sl-ft', heightFt], ['ic/u-fps', vt * Math.cos(a) * Math.cos(b)], ['ic/v-fps', vt * Math.sin(b)], ['ic/w-fps', vt * Math.sin(a) * Math.cos(b)],
      ['ic/p-rad_sec', p], ['ic/q-rad_sec', q], ['ic/r-rad_sec', r], ['fcs/rudder-cmd-norm', rudder], ['fcs/flap-pos-norm', flaps], ['gear/gear-pos-norm', gear], ...STRAIGHT],
  });
}

/** A table of the tool's, by flap or gear position (rows), as JSBSim reads it: straight lines, ends held. */
const byPosition = (rows, x) => (x <= rows[0][0] ? rows[0][1] : x >= rows.at(-1)[0] ? rows.at(-1)[1] : (() => { let i = 1; while (rows[i][0] < x) i++; const [x0, y0] = rows[i - 1], [x1, y1] = rows[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); })());
/** The flaps' lift: rows the angle of attack, columns the flap position. */
function flapLift(table, alpha, flaps) {
  const alphas = table.rows.map((r) => r[0]), col = (k) => table.rows.map((r) => [r[0], r[k + 1]]);
  const atAlpha = table.columns.map((_, k) => byPosition(col(k), alpha));
  return byPosition(table.columns.map((x, k) => [x, atAlpha[k]]), flaps);
}

for (const variant of VARIANTS) {
  test(`${variant}, f4c low: the wiring holds with the flaps and the gear: at a grid of states, flaps up, half and full, gear up and down, Mach to 0.7, the six coefficients JSBSim works out are AFWAL's Table 1 with the Mach tables and the flap and gear tables in it, worked out in JavaScript, within 0.000001`, async () => {
    const m = await module(variant), mach = machTables(), low = FLAPS.flapTables();
    const ALPHAS = [-6, 0, 5, 11.7, 17, 22, 26, 34, 48, 70], FLAP = [0, 0.5, 1, 0.25, 0.8], GEAR = [0, 1], SPEEDS = [230, 300, 450, 700];
    let k = 0, worst = 0, states = 0;
    for (const alpha of ALPHAS) for (const flaps of FLAP) for (const gear of GEAR) {
      const vt = SPEEDS[k % 4];
      const flight = startLow(m, { alpha, beta: [0, 4, -7][k % 3], vt, p: [0, 0.3, -0.5][k % 3], q: [0.1, 0, -0.2, 0.05][k % 4], r: [0, -0.2, 0.15][k % 3], pitch: [0, 0.6, -0.4][k % 3], roll: [0, 0.5, -1, 0.3][k % 4], rudder: [0, 0.4, -0.6][k % 3], flaps, gear });
      assert.equal(flight.get('fcs/flap-pos-norm'), flaps, 'the flaps read back');
      assert.equal(flight.get('gear/gear-pos-norm'), gear, 'the gear reads back');
      assert.equal(flight.get('aero/ground-effect/lift-factor'), 1, 'far from the ground');
      const { state, measured, mach: M, heightFt } = snapshot(flight);
      const f = (term) => (UNCHANGED.includes(term) ? 1 : lookup(mach[`aero/factor/${SHARED[term] ?? term}`], M, heightFt)) * (UNCHANGED.includes(term) ? 1 : byPosition(low[`aero/flaps/factor/${SHARED[term] ?? term}`].rows, flaps));
      const plus = (name) => {
        if (INCREMENTS.includes(name)) return lookup(mach[`aero/increment/${name}`], M, heightFt) + byPosition(low[`aero/flaps/increment/${name}`].rows, flaps);
        const level = lookup(mach[`aero/increment/${name}`], M, heightFt);
        if (name === 'lift') return level + flapLift(low['aero/flaps/increment/lift'], state.alpha, flaps);
        return level + byPosition(low[`aero/flaps/increment/${name}`].rows, flaps) + byPosition(low[`aero/gear/increment/${name}`].rows, gear);
      };
      const wanted = table1(state, CG_PERCENT_CHORD.value, { mach: { factor: f, increment: plus } });
      for (const name of SIX) {
        const off = Math.abs(measured[name] - wanted[name]);
        worst = Math.max(worst, off);
        assert.ok(off <= 1e-6, `${name} at ${alpha} degrees, flaps ${flaps}, gear ${gear}, Mach ${M.toFixed(3)}: JSBSim ${measured[name]}, Table 1 ${wanted[name]}`);
      }
      flight.dispose();
      k++; states++;
    }
    say(`${variant}: ${states} states, angles of attack ${ALPHAS[0]} to ${ALPHAS.at(-1)}, flaps ${FLAP.join(', ')}, gear up and down: the largest difference from Table 1 with the tables in it ${worst.toExponential(1)}; within 0.000001`);
  });

  test(`${variant}, f4c low: ground effect is the file's table at the height over the span, on the lift and the drag; and the speedbrakes' drag acts aft at the model's panels, its moment nose down`, async () => {
    const m = await module(variant);
    // Standing on the runway, and at heights above it on the climb out.
    const ge = (name) => [...file.matchAll(new RegExp(`<function name="aero/ground-effect/${name}">[^]*?<tableData>([^]*?)</tableData>`, 'g'))][0][1].trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const lift = ge('lift-factor'), drag = ge('drag-factor');
    const parked = Flight.start(m, F4C, { settleSeconds: 0 });
    const hb = parked.get('aero/h_b-mac-ft');
    say(`${variant}: standing, the height over the span is ${hb.toFixed(3)}: lift x ${parked.get('aero/ground-effect/lift-factor').toFixed(4)}, drag x ${parked.get('aero/ground-effect/drag-factor').toFixed(4)} (JSBSim's F-15's tables)`);
    assert.ok(Math.abs(parked.get('aero/ground-effect/lift-factor') - byPosition(lift, hb)) < 1e-9 && Math.abs(parked.get('aero/ground-effect/drag-factor') - byPosition(drag, hb)) < 1e-9);
    parked.dispose();
    // The speedbrakes, out at 300 knots: aft, at the panels, nose down, read back from JSBSim's external reactions.
    const flight = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots: 300 }, terrain: GROUND });
    flight.fly({ speedbrake: true });
    run(flight, 2);
    const at = ['x', 'y', 'z'].map((axis) => flight.get(`external_reactions/speedbrake/location-${axis}-in`)), cg = ['x', 'y', 'z'].map((axis) => flight.get(`inertia/cg-${axis}-in`));
    const where = [-(at[0] - cg[0]) / 12, (at[1] - cg[1]) / 12, -(at[2] - cg[2]) / 12], drag0 = flight.get('aero/force/speedbrake-lbs'), qS = flight.get('aero/qbar-psf') * S;
    const fx = flight.get('forces/fbx-external-lbs'), my = flight.get('moments/m-external-lbsft');
    say(`${variant}: speedbrakes out at ${flight.value('velocities/vc-kts').toFixed(0)} kt: ${drag0.toFixed(0)} lb (0.06 of the wing at its dynamic pressure: ${(0.06 * qS).toFixed(0)}), along the airplane's x ${fx.toFixed(0)} lb, pitching ${my.toFixed(0)} lb-ft, acting at [${where.map((v) => v.toFixed(3)).join(', ')}] ft forward, right and down (${cite(SPEEDBRAKE_PANELS)})`);
    assert.equal(flight.get('fcs/speedbrake-pos-norm'), 1);
    assert.ok(Math.abs(drag0 - 0.06 * qS) < 1e-6 * qS && fx < -0.9 * drag0 && my < 0, 'aft, and nose down');
    where.forEach((v, k) => assert.ok(Math.abs(v - SPEEDBRAKE_PANELS.value[k]) * 12 <= 1, 'at the panels within 1 in'));
    flight.dispose();
  });

  // ---- 2. CR-2144's power approach ----

  /** CR-2144's condition 1: 33,197 lb, sea level, 136 knots, gear and flaps down, trimmed by JSBSim, the stick straight to the surfaces. */
  const powerApproach = (m, assists = NO_FEET) => Flight.start(m, F4C, { airborne: { heightFt: 0, knots: POWER_APPROACH_KNOTS.value }, terrain: GROUND, assists, controls: { gear: true, flaps: 1 },
    sets: [...STRAIGHT, fuelFor(POWER_APPROACH_WEIGHT.value), ['ic/vc-kts', POWER_APPROACH_KNOTS.value]] });
  const crResponse = (table, block, input, seconds, timesS = false) => respondLinear(transferFunction(factorsOf(CR.tables[table], block, 1), factorsOf(CR.tables[table], 'DENOMINATOR', 1), timesS ? [{ root: 0 }] : []), input, DT, seconds);
  const pulse = (degrees, seconds) => (t) => (t < seconds ? degrees : 0);

  test(`${variant}, f4c low: "CR-2144's power approach (the test sets its weight: 33,197 lb; 136 knots, gear and flaps down): trim angle of attack 11.7 degrees within 1, stabilator -9.1 within 1.5"`, async () => {
    const flight = powerApproach(await module(variant)), get = (name) => flight.get(name);
    // Read back that it is the condition.
    assert.equal(get('inertia/weight-lbs'), POWER_APPROACH_WEIGHT.value);
    assert.ok(Math.abs(get('velocities/vc-kts') - POWER_APPROACH_KNOTS.value) < 0.01 && Math.abs(get('position/h-sl-ft')) < 1, 'sea level, 136 kt');
    assert.ok(get('gear/gear-pos-norm') === 1 && get('fcs/flap-pos-norm') === 1 && get('fcs/test/straight') === 1, 'gear and flaps down; the stick straight to the stabilator, as CR-2144\'s tables are');
    assert.ok(Math.abs(get('accelerations/udot-ft_sec2')) < 0.01 && Math.abs(get('accelerations/wdot-ft_sec2')) < 0.01 && Math.abs(get('accelerations/qdot-rad_sec2')) < 1e-4 && Math.abs(get('flight-path/gamma-deg')) < 0.01, 'level and steady');
    const alpha = get('aero/alpha-deg'), stabilator = get('fcs/elevator-pos-deg');
    say(`${variant}: power approach: angle of attack ${alpha.toFixed(2)} degrees (${cite(POWER_APPROACH_ALPHA)}; within 1), stabilator ${stabilator.toFixed(2)} (${cite(POWER_APPROACH_STABILATOR)}; within 1.5); lift coefficient ${get('aero/coefficient/lift').toFixed(3)} and drag ${get('aero/coefficient/drag').toFixed(3)} (CR-2144 ${POWER_APPROACH_LIFT.value} and ${POWER_APPROACH_DRAG.value}; the lift here holds the weight with the thrust's upward part, as tools/f4c-mach.mjs balances every condition), throttle ${(flight.trimmed.throttle / F4C.mil * 100).toFixed(0)}% of MIL`);
    say(`${variant}:   the file's airplane at this weight: the centre of gravity at 28.9% of the chord and the thrust line 0.37 ft above it, where CR-2144's condition 1 has 29.1% and 0.57 ft; and the clean inertias (${[ROLL_INERTIA, PITCH_INERTIA, YAW_INERTIA, CROSS_INERTIA].map((r) => r.value).join(', ')} slug-ft2) against condition 1's ${POWER_APPROACH_INERTIAS.value.join(', ')}`);
    assert.ok(Math.abs(alpha - POWER_APPROACH_ALPHA.value) <= 1, `${alpha}`);
    assert.ok(Math.abs(stabilator - POWER_APPROACH_STABILATOR.value) <= 1.5, `${stabilator}`);
    flight.dispose();
  });

  test(`${variant}, f4c low: CR-2144's power approach: "a stabilator pulse and a rudder pulse by PR 5's lines against tables IV-4 and IV-14" (the rudder's table is IV-15: IV-14 is the aileron's): time to the first peak within 15%, the peak within 15%, the time to die to half within 25%`, async () => {
    const m = await module(variant);
    // PR 5's inputs (tests/f4c-conditions.test.js): a quarter of a degree of stabilator for 1 s, recorded 20 s;
    // a degree of rudder for 1 s, recorded 30 s. CR-2144's rudder derivatives are per degree of flexed rudder,
    // and so is fcs/rudder-pos-deg (with the stick straight to the surfaces, the rudder is what is asked).
    let flight = powerApproach(m);
    const stab = measuresBeside(respond(flight, 'stabilator', pulse(0.25, 1), pitchRate, 20), crResponse('IV-4', 'N(THE/DS)', pulse(0.25, 1), 20, true), 1);
    flight.dispose();
    const holder = {};
    flight = powerApproach(m, rudderFeet(holder));
    holder.flight = flight;
    const rud = measuresBeside(respond(flight, 'rudder', pulse(1, 1), yawRate, 30), crResponse('IV-15', 'N(R /DR)', pulse(1, 1), 30), 1);
    flight.dispose();
    assert.match(CR.tables['IV-15'].title, /RUDDER TRANSFER FUNCTION FACTORS {2}SAS Off/);
    for (const [what, { ours, theirs }] of [['stabilator pulse, pitch rate', stab], ['rudder pulse, yaw rate', rud]]) {
      const half = (x) => (Number.isNaN(x) ? 'no swing to time' : x === Infinity ? 'does not die' : `${x.toFixed(2)} s`);
      say(`${variant}: power approach, ${what}: first peak ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s (CR-2144 ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}); to half ${half(ours.halfTime)} (CR-2144 ${half(theirs.halfTime)})`);
      assert.ok(Math.abs(ours.peakTime / theirs.peakTime - 1) <= 0.15, `${what}: time to the first peak`);
      assert.ok(Math.abs(ours.peak / theirs.peak - 1) <= 0.15, `${what}: the peak`);
      if (Number.isFinite(theirs.halfTime)) assert.ok(Math.abs(ours.halfTime / theirs.halfTime - 1) <= 0.25, `${what}: the time to die to half`);
      else if (Number.isNaN(theirs.halfTime)) assert.ok(!(ours.halfTime === Infinity), `${what}: CR-2144's has no swing to time; ours must not grow`);
    }
  });
}

// ---- 3. The full-flap stall, the approach speed ----

/**
 * The approach to a stall, flown: full flaps and gear down, wings level, the throttle where asked, the angle of
 * attack raised half a degree a second from the trim at 165 knots by a pilot working the stick (a pull in
 * pounds). At each angle asked for, the speed reduced to 1 g: the calibrated airspeed over the square root of
 * the load factor normal to the flight path (the aerodynamic lift and the thrust's part across the flight path,
 * over the weight), the flight-test way (FAA Advisory Circular 25-7, the 1-g stall speed).
 */
function stallApproach(m, { throttle = 0, weightLb = FULL_FLAP_STALL_WEIGHT.value, at = NOSE_SLICE_ALPHA.value } = {}) {
  const flight = Flight.start(m, F4C, { airborne: { heightFt: 8000, knots: 165 }, terrain: GROUND, controls: { gear: true, flaps: 1 }, sets: [fuelFor(weightLb)] });
  assert.ok(flight.get('inertia/weight-lbs') === weightLb && flight.get('fcs/flap-pos-norm') === 1 && flight.get('gear/gear-pos-norm') === 1, 'the weight, full flaps, gear down');
  const a0 = flight.get('aero/alpha-deg'), out = {};
  let held = flight.controls.pitch, worst = 0;
  run(flight, 90, (t) => {
    const alpha = flight.value('aero/alpha-rad') * DEG, err = a0 + 0.5 * t - alpha;
    held = clamp(held + 0.03 * err * DT, -1, 1);
    const pitch = clamp(held + 0.03 * err - 0.03 * flight.value('velocities/q-rad_sec') * DEG, -1, 1);
    flight.fly({ throttle: t < 0.5 ? flight.controls.throttle : throttle, pitch, roll: clamp(-2 * flight.value('attitude/phi-rad') - 0.5 * flight.value('velocities/p-rad_sec'), -1, 1) });
    if (t > 3) worst = Math.max(worst, Math.abs(err));
    for (const a of at) {
      if (out[a] || alpha < a) continue;
      const tilt = (alpha + REFERENCE.THRUST_TILT.value) / DEG, thrust = flight.get('propulsion/engine[0]/thrust-lbs') + flight.get('propulsion/engine[1]/thrust-lbs');
      // The lift (at right angles to the flight path, in the plane of symmetry: AFWAL's, the aircraft file's) and the thrust's part across the path.
      const lift = flight.get('aero/coefficient/lift') * flight.get('aero/qbar-psf') * S;
      const n = (lift + thrust * Math.sin(tilt)) / weightLb, kt = flight.value('velocities/vc-kts');
      out[a] = { kt, n, vs: kt / Math.sqrt(n), bank: flight.value('attitude/phi-rad') * DEG };
    }
    return !out[at.at(-1)];
  });
  flight.dispose();
  return { ...out, worst };
}

test('f4c low: "The full-flap stall at 38,000 lb, power off: within 5 knots of the flight manual\'s 122 to 126"', async () => {
  const m = await module();
  const off = stallApproach(m), on = stallApproach(m, { throttle: 0.5 });
  const [onset, end] = NOSE_SLICE_ALPHA.value, [low, high] = FULL_FLAP_STALL.value;
  const line = (r) => `${r[onset].vs.toFixed(1)} kt at ${onset} degrees (${r[onset].kt.toFixed(1)} kt flown at ${r[onset].n.toFixed(3)} g across the flight path), ${r[end].vs.toFixed(1)} at ${end} (${r[end].kt.toFixed(1)} at ${r[end].n.toFixed(3)} g)`;
  report.line(`f4c low: the full-flap stall, gear down, ${FULL_FLAP_STALL_WEIGHT.value.toLocaleString('en-US')} lb, reduced to 1 g, at the nose slice's onset and end (${cite(NOSE_SLICE_ALPHA)}):`);
  say(`power off (idle): ${line(off)}; the angle of attack held to within ${off.worst.toFixed(2)} degrees of the pilot's ramp`);
  say(`reported: with power (the throttle at 0.5, 62% of MIL): ${line(on)}`);
  say(`the flight manual: ${cite(FULL_FLAP_STALL)}; within 5 knots of the band, ${low - 5} to ${high + 5}. Its chart is power-on; the plan's line is power off, and the flaps' lift near the stall is sized to it (tools/f4c-flaps.mjs)`);
  for (const a of [onset, end]) assert.ok(off[a].vs >= low - 5 && off[a].vs <= high + 5, `${off[a].vs} kt at ${a} degrees`);
});

/** JSBSim's own trim, level at sea level, with the flaps and gear as asked and the weight: the angle of attack and the stabilator. */
function trimAt(m, knots, { flaps = 1, gear = true, weightLb = WEIGHT.value } = {}) {
  const flight = Flight.start(m, F4C, { airborne: { heightFt: 0, knots }, terrain: GROUND, controls: { gear, flaps }, sets: [fuelFor(weightLb), ['ic/vc-kts', knots]] });
  const out = { alpha: flight.get('aero/alpha-deg'), knots: flight.get('velocities/vc-kts'), throttle: flight.trimmed.throttle };
  flight.dispose();
  return out;
}
/** The speed at which the level trim's angle of attack is `alpha`: by the secant rule from two speeds. */
function speedAtAlpha(m, alpha, options) {
  let [a, b] = [140, 160], fa = trimAt(m, a, options).alpha - alpha, fb = trimAt(m, b, options).alpha - alpha;
  for (let i = 0; i < 8 && Math.abs(fb) > 0.001; i++) { const c = b - fb * (b - a) / (fb - fa); [a, fa] = [b, fb]; b = c; fb = trimAt(m, b, options).alpha - alpha; }
  return b;
}

test('f4c low: "Approach: at 11.7 degrees angle of attack, gear and flaps down (CR-2144\'s approach; the flight manual\'s on-speed, 19.2 units), level at 38,924 lb, the speed is 147 knots within 5 (CR-2144\'s 136 at 33,197 lb, scaled by weight). Reported beside it: the F-4E appendix\'s 152"', async () => {
  const m = await module(), alpha = POWER_APPROACH_ALPHA.value;
  const speed = speedAtAlpha(m, alpha), scaled = POWER_APPROACH_KNOTS.value * Math.sqrt(WEIGHT.value / POWER_APPROACH_WEIGHT.value);
  const [e, at, per] = F4E_APPROACH.value, f4e = e + per * (WEIGHT.value - at) / 1000;
  const half = speedAtAlpha(m, alpha, { flaps: 0.5 });
  report.line(`f4c low: level at ${alpha} degrees, gear and full flaps, ${WEIGHT.value.toLocaleString('en-US')} lb, sea level (JSBSim's trim): ${speed.toFixed(1)} kt; CR-2144's ${POWER_APPROACH_KNOTS.value} at ${POWER_APPROACH_WEIGHT.value.toLocaleString('en-US')} lb scaled by weight: ${scaled.toFixed(1)}; within 5`);
  say(`reported: the F-4E appendix's ${f4e.toFixed(0)} kt at this weight (${cite(F4E_APPROACH)}); on-speed is ${cite(ON_SPEED_UNITS)}`);
  say(`reported: on half flaps at the same angle of attack ${half.toFixed(1)} kt, ${(half - speed).toFixed(1)} more (${cite(HALF_FLAP_APPROACH_MORE)})`);
  assert.ok(Math.abs(speed - 147) <= 5, `${speed} kt`);
  assert.ok(Math.abs(scaled - 147) < 0.5, 'the plan\'s 147 is CR-2144\'s scaled');
});

// ---- 4. The rotation ----

/** A takeoff: from the numbers, brakes off, full afterburner, the stick held full back, flaps as asked. When the nosewheel leaves, and the mains. */
function takeoff(m, flaps, aircraft = F4C) {
  const flight = Flight.start(m, aircraft, { controls: { flaps } }), from = flight.where(), out = {};
  assert.equal(flight.get('fcs/flap-pos-norm'), flaps, 'the flaps where asked');
  run(flight, 60, () => {
    flight.fly({ brake: false, throttle: 1, pitch: 1, roll: 0, flaps });
    const nose = flight.get('gear/unit[0]/WOW'), mains = flight.get('gear/unit[1]/WOW') || flight.get('gear/unit[2]/WOW');
    if (!out.nose && !nose && flight.value('velocities/vc-kts') > 50) out.nose = { kt: flight.value('velocities/vc-kts'), stabilator: flight.get('fcs/elevator-pos-deg') };
    if (out.nose && !nose && !mains) {
      const at = flight.where();
      out.off = { kt: flight.value('velocities/vc-kts'), ft: Math.hypot(at.north - from.north, at.east - from.east) / FT, pitch: flight.value('attitude/theta-rad') * DEG };
      return false;
    }
    return true;
  });
  flight.dispose();
  return out;
}

test('f4c low: "The owner\'s rotation speed (CLAUDE.md): flaps at 1/2 (the flight manual\'s takeoff setting), full afterburner, full back tilt, the nosewheel lifts at 150 knots within 5"', async () => {
  const m = await module(), half = takeoff(m, 0.5), full = takeoff(m, 1), up = takeoff(m, 0);
  const row = (name, r) => `${name}: the nosewheel lifts at ${r.nose.kt.toFixed(1)} kt (stabilator ${r.nose.stabilator.toFixed(1)} degrees), liftoff at ${r.off.kt.toFixed(1)} kt after ${r.off.ft.toFixed(0)} ft, ${r.off.pitch.toFixed(1)} degrees nose up`;
  report.line(`f4c low: the rotation, full afterburner, the stick full back from the brakes' release (${cite(ROTATION_SPEED)}; within 5):`);
  say(row('1/2 flaps', half));
  say(`reported: ${row('full flaps', full)}`);
  say(`reported: ${row('flaps up', up)}`);
  say(`reported beside them: Wings, full flaps, liftoff and ground roll ${cite(WINGS_TAKEOFF)}; the flight manual's F-4E nosewheel lift-off ${cite(F4E_NOSEWHEEL_LIFTOFF)}, scaled to this weight as the square root of the weight: ${(F4E_NOSEWHEEL_LIFTOFF.value[0] * Math.sqrt(WEIGHT.value / F4E_NOSEWHEEL_LIFTOFF.value[1])).toFixed(0)} kt; the fly-off attitude ${cite(FLY_OFF_ATTITUDE)}`);
  // As first flown this line was not met: with half flaps taking half of full flaps' loss of stabilator power
  // (the first guess, with no data for half flaps) the nosewheel lifted at 165.6 knots. The plan's risk: "the
  // owner decides which figure gives". He chose to keep his 150 (27 November 2026): half flaps take an eighth
  // of that loss (tools/f4c-flaps.mjs, HALF_FLAP_TAIL_SHARE, with the reasons). The line is unchanged. The
  // flight manual has the flaps-up nosewheel lifting earlier than the takeoff setting's: a test below holds that.
  assert.ok(Math.abs(half.nose.kt - ROTATION_SPEED.value) <= 5, `the nosewheel lifts at ${half.nose.kt.toFixed(1)} kt on 1/2 flaps`);
  // The flight manual, "Takeoff": "Due to increased stabilator authority with the flaps up, aircraft rotation can
  // be initiated at lower than normal airspeeds"; and full flaps "degrade stabilator effectiveness".
  assert.ok(up.nose.kt < half.nose.kt && half.nose.kt < full.nose.kt, `flaps up ${up.nose.kt.toFixed(1)}, half ${half.nose.kt.toFixed(1)}, full ${full.nose.kt.toFixed(1)} kt`);
});

// ---- 5. Neutral tilt ----

/** The copilot as the game has it: the stored neutral trim, from now on, in a flight started (and trimmed by JSBSim) somewhere else. */
function copilotNow(flight) {
  const at = (name) => flight.stateNames.indexOf(name), wheels = [0, 1, 2].map((k) => at(`gear/unit[${k}]/WOW`));
  flight.assists = new Assists(F4C.assists, at, (name) => flight.inputNames.indexOf(name), wheels, DT);
}

test('f4c low: "Neutral tilt, clean, 350 knots: after 60 s the speed is within 5 knots, the height within 100 ft and the bank within 5 degrees. Started 50 knots fast or slow, the nose moves the right way within 3 s and each swing is smaller than the last"', async () => {
  const m = await module(), { trim } = F4C.assists;
  assert.equal(trim.knots, WINGS_NEUTRAL_SPEED.value);
  const level = Flight.start(m, F4C, { airborne: { heightFt: trim.heightFt, knots: trim.knots }, terrain: GROUND }), throttle = level.trimmed.throttle;
  say(`JSBSim's own trim at ${trim.knots} kt and ${trim.heightFt} ft: ${level.trimmed.heldPitchTrim.toFixed(4)}; the copilot's stored ${trim.sets[0][1]}`);
  assert.ok(Math.abs(level.trimmed.heldPitchTrim - trim.sets[0][1]) <= 0.002, 'the stored trim is JSBSim\'s own');
  level.dispose();
  for (const off of [0, -50, 50]) {
    // Started trimmed at its speed (JSBSim's trim), then from the first step the copilot's own neutral trim, the stick in the middle, the throttle where 350 knots wants it: the pilot lets go.
    const flight = Flight.start(m, F4C, { airborne: { heightFt: trim.heightFt, knots: trim.knots + off }, terrain: GROUND });
    copilotNow(flight);
    const pitch0 = flight.value('attitude/theta-rad') * DEG, height = flight.value('position/h-sl-ft');
    let moved = null, before = flight.value('velocities/vc-kts'), going = 0, slow = Infinity, fast = -Infinity, low = Infinity, high = -Infinity, bank = 0, atThree = null;
    const turns = [];
    run(flight, off ? 300 : 60, (t) => {
      flight.fly({ pitch: 0, roll: 0, throttle });
      for (const [name, value] of trim.sets) assert.equal(flight.inputs[flight.inputNames.indexOf(name)], value, 'the stored trim at every step');
      const kt = flight.value('velocities/vc-kts'), nose = flight.value('attitude/theta-rad') * DEG - pitch0;
      if (moved === null && Math.sign(off) * nose > 0.5) moved = t;
      if (atThree === null && t >= 3) atThree = nose;
      slow = Math.min(slow, kt); fast = Math.max(fast, kt);
      low = Math.min(low, flight.value('position/h-sl-ft')); high = Math.max(high, flight.value('position/h-sl-ft')); bank = Math.max(bank, Math.abs(flight.value('attitude/phi-rad') * DEG));
      const now = Math.sign(kt - before);
      if (t > 1 && now !== 0 && going !== 0 && now !== going) turns.push({ t, kt: before });   // after the first second: the start itself is not a turning point
      if (now !== 0) going = now;
      before = kt;
    });
    const end = flight.value('velocities/vc-kts');
    if (!off) {
      say(`neutral tilt for 60 s at ${trim.knots} kt: ${slow.toFixed(1)} to ${fast.toFixed(1)} kt, ${(low - height).toFixed(0)} to ${(high - height).toFixed(0)} ft, bank ${bank.toFixed(1)} degrees at most; after 60 s ${end.toFixed(1)} kt, ${(flight.value('position/h-sl-ft') - height).toFixed(0)} ft`);
      assert.ok(slow >= trim.knots - 5 && fast <= trim.knots + 5, 'speed within 5 kt');
      assert.ok(low >= height - 100 && high <= height + 100, 'height within 100 ft');
      assert.ok(bank <= 5, 'bank within 5 degrees');
    } else {
      // A swing is from one turning point of the speed to the next (the start is the first): tests/checkride/linear.js's rule.
      const points = [{ t: 0, kt: trim.knots + off }, ...turns.filter((p) => Math.abs(p.kt - trim.knots) > 0.5)];
      const swings = points.slice(1).map((p, i) => Math.abs(p.kt - points[i].kt));
      say(`started ${Math.abs(off)} kt ${off < 0 ? 'slow' : 'fast'}: the nose ${off < 0 ? 'down' : 'up'} half a degree at ${moved?.toFixed(2)} s (${atThree.toFixed(1)} degrees at 3 s); turning points ${points.slice(1, 8).map((p) => `${p.kt.toFixed(1)} kt at ${p.t.toFixed(0)} s`).join(', ')}; swings ${swings.slice(0, 7).map((x) => x.toFixed(1)).join(', ')} kt; ${end.toFixed(1)} kt after 300 s; height ${(low - height).toFixed(0)} to ${(high - height).toFixed(0)} ft`);
      assert.ok(moved !== null && moved <= 3 && Math.sign(off) * atThree > 0.5, `the nose the right way at ${moved} s and still at 3 s`);
      assert.ok(swings.length >= 3, 'it swings');
      swings.forEach((x, i) => assert.ok(i === 0 || x < swings[i - 1], `swing ${i + 1}, ${x} kt, is smaller than the one before`));
    }
    flight.dispose();
  }
});

// ---- 6. The takeoff roll with the copilot's feet: PR 2's lines, "at 100 knots in place of 60 and 30 in place of 20" ----

const { wheel, hold } = F4C.assists.steer;
/** A 10 degree right tilt, as it is sent (tests/feet.test.js). */
const TEN_DEGREES = gentle((10 - 1.5) / (30 - 1.5));
const NO_RUDDER = { trim: F4C.assists.trim, steer: { wheel } };
/** The nosewheel's angle for that tilt standing still: the file's nosewheel turns 70 degrees (the flight manual). */
const STILL = TEN_DEGREES * NOSEWHEEL_STEERING_LIMIT.value;

/** A takeoff roll from the numbers: full afterburner, 1/2 flaps, `pilot(c)` giving the roll stick (after tests/feet.test.js). */
function rollOut(m, pilot, { pitch = 0, throttle = 1, seconds = 80, until = null, assists = F4C.assists, aircraft = F4C } = {}) {
  const f = Flight.start(m, aircraft, { assists }), wheels = [0, 1, 2].map((k) => f.stateNames.indexOf(`gear/unit[${k}]/WOW`));
  const c = {}, box = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity };
  let off = 0, bank = 0;
  for (let k = 0; k < seconds / DT; k++) {
    const t = k * DT, at = toWorld(f.value('position/lat-geod-rad'), f.value('position/long-gc-rad')), phi = f.value('attitude/phi-rad');
    Object.assign(c, { t, kt: f.value('velocities/vc-kts'), heading: f.value('attitude/psi-rad') * DEG - 90, off: at.north / FT, bank: phi * DEG, wheelDeg: f.value('fcs/steer-pos-deg'), aileronDeg: f.value('fcs/left-aileron-pos-rad') * DEG });
    c.steer = clamp(-0.5 * c.heading + 0.05 * c.off, -1, 1);
    c.level = clamp(-2 * phi - 0.5 * f.value('velocities/p-rad_sec'), -1, 1);
    f.fly({ brake: false, throttle, pitch: c.kt > 50 ? pitch : 0, roll: clamp(pilot(c), -1, 1) });
    assert.equal(f.step(1), 0, 'JSBSim stepped');
    if (t > 30) { box.w = Math.min(box.w, at.east); box.e = Math.max(box.e, at.east); box.s = Math.min(box.s, at.north); box.n = Math.max(box.n, at.north); }
    const onGround = wheels.some((i) => f.state[i] === 1);
    if (t > 1 && onGround) { off = Math.max(off, Math.abs(c.off)); bank = Math.max(bank, Math.abs(c.bank)); }
    if (until && until(c)) break;
    if (throttle === 1 && t > 1 && !onGround) break;
  }
  f.dispose();
  return { ...c, offMost: off, bankMost: bank, circleFt: ((box.e - box.w) + (box.n - box.s)) / 2 / FT };
}
const holds = (kt, stick, seconds) => (c) => {
  if (c.began === undefined && c.kt >= kt) Object.assign(c, { began: c.t, heading0: c.heading, wheel0: null, bankHeld: 0 });
  if (c.began === undefined) return c.steer;
  if (c.wheel0 === null && c.t > c.began) c.wheel0 = c.wheelDeg;
  if (c.t < c.began + seconds) { c.bankHeld = Math.max(c.bankHeld, Math.abs(c.bank)); if (c.t >= c.began + seconds / 2 && c.mid === undefined) c.mid = { aileron: c.aileronDeg, kt: c.kt }; return stick; }
  return 0;
};
const after = (seconds) => (c) => c.began !== undefined && c.t >= c.began + seconds;
const swing = (r) => r.heading - r.heading0;

test('f4c low: the nosewheel\'s share: "the steering curve set so the nosewheel\'s share is 10% or less at 70 knots (the flight manual)"; and PR 2\'s: from 0 to 120 knots it never rises and never steps by more than 3% of full between one knot and the next; 90% or more at 10 knots, 30% or less at 100', () => {
  let most = 0;
  for (let kt = 0; kt < 120; kt++) {
    const step = wheelShare(kt, wheel) - wheelShare(kt + 1, wheel);
    assert.ok(step >= 0, `it rose between ${kt} and ${kt + 1} knots`);
    most = Math.max(most, step);
  }
  report.line(`f4c low: the nosewheel's share of the tilt: ${(wheelShare(10, wheel) * 100).toFixed(1)}% at 10 kt, ${(wheelShare(70, wheel) * 100).toFixed(1)}% at 70 (${cite(NOSEWHEEL_STEERING_UNTIL)}: 10% or less), ${(wheelShare(100, wheel) * 100).toFixed(1)}% at 100; its largest step ${(most * 100).toFixed(2)}% of full a knot`);
  assert.ok(wheelShare(70, wheel) <= 0.1);
  assert.ok(most <= 0.03);
  assert.ok(wheelShare(10, wheel) >= 0.9 && wheelShare(100, wheel) <= 0.3);
});

test('f4c low: the takeoff roll, PR 2\'s lines on the F-4C (100 knots for 60, 30 for 20): a 10 degree right tilt held 3 s at 10 knots turns the nose right 5 degrees or more, the nosewheel doing it; at 100 knots the nose eases right 1 to 4 degrees, the nosewheel at 30% or less; the ailerons the same at both; bank under 3 degrees', async () => {
  const m = await module();
  const slow = rollOut(m, holds(10, TEN_DEGREES, 3), { until: after(3) }), bare = rollOut(m, holds(10, TEN_DEGREES, 3), { until: after(3), assists: NO_RUDDER });
  const fast = rollOut(m, holds(100, TEN_DEGREES, 3), { until: after(3) });
  say(`10 degree right tilt for 3 s from 10 kt (full afterburner: ${slow.kt.toFixed(0)} kt at the end): the nose comes right ${swing(slow).toFixed(1)} degrees (${swing(bare).toFixed(1)} with the copilot's rudder left out); the nosewheel at ${(slow.wheel0 / STILL * 100).toFixed(0)}% of its standing-still angle; bank ${slow.bankHeld.toFixed(2)}`);
  say(`the same from 100 kt: the nose eases right ${swing(fast).toFixed(2)} degrees; the nosewheel at ${(fast.wheel0 / STILL * 100).toFixed(1)}%; bank ${fast.bankHeld.toFixed(2)}; left aileron ${fast.mid.aileron.toFixed(2)} degrees down (${slow.mid.aileron.toFixed(2)} at the slow one)`);
  assert.ok(swing(slow) >= 5 && slow.wheel0 / STILL >= 0.9, 'at 10 kt: 5 degrees or more, the nosewheel at 90% or more');
  assert.ok(Math.abs(swing(slow) - swing(bare)) / swing(bare) < 0.1, 'the rudder changes the turn by less than a tenth');
  assert.ok(swing(fast) >= 1 && swing(fast) <= 4 && fast.wheel0 / STILL <= 0.3, 'at 100 kt: 1 to 4 degrees, the nosewheel at 30% or less');
  assert.ok(Math.abs(fast.mid.aileron - slow.mid.aileron) < 0.05, 'the ailerons follow the tilt the same');
  assert.ok(slow.bankHeld < 3 && fast.bankHeld < 3, 'bank under 3 degrees');
});

test('f4c low: who turns it: at 100 knots the rudder (with the nosewheel held straight and the ailerons left out, the tilt still brings the nose right 1 degree or more); at 10 knots the nosewheel (held straight, the nose comes right less than a tenth as far)', async () => {
  const m = await module();
  const straight = { ...F4C.assists, steer: { ...F4C.assists.steer, wheel: { ...wheel, sign: 0 } } }, FEET_ONLY = { ...F4C, controls: { ...F4C.controls, roll: { to: [] } } };
  const turned = (kt, options) => swing(rollOut(m, holds(kt, TEN_DEGREES, 3), { until: after(3), ...options })) - swing(rollOut(m, holds(kt, 0, 3), { until: after(3), ...options }));
  const rudderAlone = turned(100, { assists: straight, aircraft: FEET_ONLY }), all100 = turned(100, {}), all10 = turned(10, {}), noWheel = turned(10, { assists: straight });
  say(`at 100 kt: all three controls ${all100.toFixed(2)} degrees, the rudder alone ${rudderAlone.toFixed(2)}; at 10 kt: all three ${all10.toFixed(2)}, with the nosewheel held straight ${noWheel.toFixed(2)}`);
  assert.ok(rudderAlone >= 1, `${rudderAlone}`);
  assert.ok(Math.abs(noWheel) < 0.1 * all10, `${noWheel} of ${all10}`);
});

test('f4c low: picking up a wing at 100 knots, 30% right stick for one second: the nose swings 1.5 degrees or less; taxi with the stick full over at a quarter throttle: a circle 84 ft across or less', async () => {
  const m = await module();
  const r = rollOut(m, holds(100, 0.3, 1), { until: after(2) }), taxi = rollOut(m, () => 1, { throttle: 0.25, seconds: 90 });
  say(`30% right stick for 1 s at 100 kt: the nose swings ${swing(r).toFixed(2)} degrees; taxi, full stick, a quarter throttle: a circle ${taxi.circleFt.toFixed(0)} ft across at ${taxi.kt.toFixed(1)} kt`);
  assert.ok(Math.abs(swing(r)) <= 1.5);
  assert.ok(taxi.circleFt <= 84);
});

test('f4c low: held straight: a takeoff with a 10 degree back tilt from 50 knots, the pilot only holding the wings level, stays within 25 ft of the centreline; holding the wings and steering a little, within 10 ft and 3 degrees of bank', async () => {
  const m = await module(), back = gentle((10 - 2) / (25 - 2));
  const hands = rollOut(m, (c) => c.level, { pitch: back }), both = rollOut(m, (c) => c.level + 0.25 * c.steer, { pitch: back });
  say(`hands only: ${hands.offMost.toFixed(1)} ft off the centreline at most, ${hands.bankMost.toFixed(1)} degrees of bank (liftoff at ${hands.kt.toFixed(0)} kt); hands and a quarter of the steering: ${both.offMost.toFixed(1)} ft, ${both.bankMost.toFixed(1)} degrees`);
  assert.ok(hands.offMost <= 25);
  assert.ok(both.offMost <= 10 && both.bankMost <= 3);
});

test('f4c low: the copilot\'s settings: neutral trim for 350 knots at 2,000 ft, Wings\' feet in the air, the steering hold on the ground, and it writes only the trim, the rudder and the nosewheel; reported: sideslip rolling into and out of a 30 degree bank, with and without the copilot\'s feet', async () => {
  const m = await module();
  assert.deepEqual(Object.keys(F4C.assists).sort(), ['feet', 'steer', 'trim']);
  assert.equal(F4C.assists.feet.law, undefined, 'Wings\' feet: src/sim/assists.js\'s own law');
  // Rolls as milestone 1's: full stick for 30 degrees of bank, held, then 30 the other way at 16 s. No line: reported.
  const rows = [];
  for (const [knots, flaps] of [[150, 1], [200, 1], [250, 0], [350, 0], [500, 0]]) {
    const out = [];
    for (const assists of [F4C.assists, NO_FEET]) {
      const flight = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots }, terrain: GROUND, assists, controls: { flaps, gear: flaps === 1 } }), held = { ...flight.trimmed };
      let peak = 0;
      run(flight, 30, (t) => {
        const target = t < 2 ? 0 : t < 16 ? 30 : -30, bank = flight.value('attitude/phi-rad') * DEG;
        flight.fly({ roll: clamp(held.roll + (4 * (target - bank)) / DEG - 0.8 * flight.value('velocities/p-rad_sec'), -1, 1), pitch: held.pitch });
        if (t > 2) peak = Math.max(peak, Math.abs(flight.value('aero/beta-rad') * DEG));
      });
      flight.dispose();
      out.push(peak);
    }
    rows.push(`${knots} kt ${flaps ? 'gear and flaps down' : 'clean'}: ${out[0].toFixed(1)} degrees with them, ${out[1].toFixed(1)} without`);
  }
  report.line(`f4c low: the copilot's feet in the air (Wings' law, on top of the jet's own yaw damper and interconnect): the most sideslip in the rolls: ${rows.join('; ')}`);
});

// ---- 7. The circuit ----

test('f4c low: "The circuit, crash override off: takeoff, a 1,500 ft pattern, downwind at 250 knots within 100 ft and 10 knots, final at the approach speed above within 10 knots, touchdown on the mains in the first third and within 25 ft of the centreline, every touch 600 ft/min or less, stopped on the 10,000 ft runway on brakes alone. Its tape replays in native JSBSim by milestone 1\'s lines"', async () => {
  const { runway } = FIELD, firstThird = { from: -runway.startBackFt, to: -runway.startBackFt + runway.lengthFt / 3 };
  const how = CIRCUIT.get(F4C), flown = {};
  assert.ok(how.patternFt === 1500 && how.downwindKt === 250 && how.finalKt === 147 && how.takeoffFlaps === 0.5, 'the plan\'s pattern');
  for (const variant of VARIANTS) {
    const c = flown[variant] = flyCircuit(await module(variant), F4C, { record: true });
    const d = c.downwind, f = c.final, landing = c.touches.filter((e) => e.time > c.marks.liftoff.t + 10), first = landing[0], td = c.marks.touchdown;
    report.line(`f4c low, the circuit, ${variant}: ${c.seconds.toFixed(0)} s from parked to stopped`);
    say(`${variant}: liftoff at ${c.marks.liftoff.knots.toFixed(0)} kt, ${c.marks.liftoff.along.toFixed(0)} ft down the runway, ${Math.abs(c.marks.liftoff.right).toFixed(1)} ft from the centreline`);
    say(`${variant}: downwind for ${d.seconds.toFixed(0)} s: ${d.low.toFixed(0)} to ${d.high.toFixed(0)} ft (target ${how.patternFt}), ${d.slow.toFixed(1)} to ${d.fast.toFixed(1)} kt (target ${how.downwindKt})`);
    say(`${variant}: final for ${f.seconds.toFixed(0)} s: ${f.slow.toFixed(1)} to ${f.fast.toFixed(1)} kt (target ${how.finalKt})`);
    say(`${variant}: touchdown: ${first.point} first, ${td.along.toFixed(0)} ft down the runway, ${Math.abs(td.right).toFixed(1)} ft from the centreline, ${td.knots.toFixed(0)} kt; every touch: ${landing.map((e) => `${e.point} ${e.closingFpm.toFixed(0)}`).join(', ')} ft/min`);
    say(`${variant}: stopped ${c.end.along.toFixed(0)} ft down the runway: a landing roll of ${(c.end.along - td.along).toFixed(0)} ft from ${td.knots.toFixed(0)} kt, brakes ${c.brakeOn ? 'on' : 'off'} (${cite(F4E_LANDING_ROLL)})`);
    assert.ok(c.onlyTheSeven, 'the pilot used only the seven controls');
    assert.equal(c.ended, null, `no crash (${JSON.stringify(c.ended)})`);
    assert.equal(c.phase, 'stop');
    assert.ok(d.seconds > 30 && d.low >= how.patternFt - 100 && d.high <= how.patternFt + 100, 'downwind within 100 ft of the pattern height');
    assert.ok(d.slow >= how.downwindKt - 10 && d.fast <= how.downwindKt + 10, 'downwind within 10 kt');
    assert.ok(f.seconds > 30 && f.slow >= how.finalKt - 10 && f.fast <= how.finalKt + 10, 'final within 10 kt of the approach speed');
    assert.ok(/main wheel/.test(first.point), `touchdown on the main wheels (${first.point})`);
    assert.ok(td.along >= firstThird.from && td.along <= firstThird.to, `in the first third (${td.along} ft)`);
    assert.ok(Math.abs(td.right) <= 25, `within 25 ft of the centreline (${td.right} ft)`);
    for (const e of landing) assert.ok(e.closingFpm <= 600, `${e.point} at ${e.closingFpm} ft/min`);
    assert.ok(c.touches.every((e) => e.wheel), 'no airframe point touched');
    assert.ok(c.end.groundKt < 1 && c.brakeOn, 'stopped, brakes on');
    assert.ok(c.end.along >= -runway.startBackFt && c.end.along <= runway.lengthFt - runway.startBackFt && Math.abs(c.end.right) <= runway.widthFt / 2, 'stopped on the runway');
    // On brakes alone: the speedbrakes stayed in on the runway, and nothing but the brakes slowed it there.
    assert.equal(how.speedbrakeOnRunway ?? false, false);
    assert.equal(c.fuelChange, 0, 'fuel as at the start');
  }
  assert.ok(bitEqual(flown.weh.tape.states, flown.jseh.tape.states).equal, 'both builds flew the same flight');
  // Matching native over the whole flight, by milestone 1's lines, as tests/c172p.test.js has them.
  const tape = flown.weh.tape, { native, ensemble } = flyNative(tape, 'circuit-f4c');
  for (const variant of VARIANTS) {
    const whole = classB(native, flyWasm(await module(variant), tape, `circuit-f4c-${variant}-judged`, JUDGED, { stepByStep: true }), ensemble);
    say(`${variant} against native, whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const col of whole.columns) say(`  ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole flight against native`);
  }
});

test('f4c low, reported: the circuit on JSBSim\'s default stepping of rotations (1, 3, 1, 4) beside the F-4C\'s (3, 3, 3, 4), and the wheels standing still on each', async () => {
  const m = await module(), DEFAULT = { ...F4C, stepping: [1, 3, 1, 4] };
  CIRCUIT.set(DEFAULT, CIRCUIT.get(F4C));
  for (const aircraft of [F4C, DEFAULT]) {
    const c = flyCircuit(m, aircraft), td = c.marks.touchdown, landing = c.touches.filter((e) => e.time > c.marks.liftoff.t + 10);
    // Standing on the brakes at idle for 20 s: how much the airplane still moves on its legs.
    const parked = Flight.start(m, aircraft, {});
    let q = 0, z = [Infinity, -Infinity];
    run(parked, 20, () => { q = Math.max(q, Math.abs(parked.value('velocities/q-rad_sec') * DEG)); const h = parked.value('position/h-agl-ft'); z = [Math.min(z[0], h), Math.max(z[1], h)]; });
    parked.dispose();
    say(`stepping ${aircraft.stepping.join(', ')}: ${c.ended ? `ENDED ${JSON.stringify(c.ended)}` : 'flown'}; liftoff ${c.marks.liftoff?.knots.toFixed(1)} kt at ${c.marks.liftoff?.along.toFixed(0)} ft; touchdown ${td?.along.toFixed(0)} ft at ${td?.knots.toFixed(1)} kt, touches ${landing.map((e) => `${e.point} ${e.closingFpm.toFixed(0)}`).join(', ')} ft/min; stopped at ${c.end.along.toFixed(0)} ft. Parked 20 s: pitch rate ${q.toFixed(4)} deg/s at most, the centre of gravity moves ${((z[1] - z[0]) * 12).toFixed(3)} in`);
  }
});

// ---- 8. The flaps, gear and speedbrakes travel ----

test('f4c low: "Flaps take 8 s down and 6 s up, within 1 s (the flight manual)"; and each of the settings puts them there: Up, 1/2 and Full, the takeoff setting 1/2', async () => {
  const m = await module();
  assert.deepEqual(F4C.flaps.settings.map((s) => [s.at, s.reads]), [[0, 'Up'], [0.5, '1/2'], [1, 'Full']]);
  assert.equal(F4C.flaps.settings[F4C.flaps.takeoff].reads, '1/2');
  const flight = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots: 200 }, terrain: GROUND });
  assert.equal(flight.get('fcs/flap-pos-norm'), 0, 'up');
  const time = (to) => {
    let t0 = null;
    flight.fly({ flaps: to });
    run(flight, 12, (t) => { if (t0 === null && Math.abs(flight.value('fcs/flap-pos-norm') - to) < 0.001) { t0 = t; return false; } return true; });
    run(flight, 1);
    assert.ok(Math.abs(flight.value('fcs/flap-pos-norm') - to) < 1e-9, `the flaps stay at ${to}`);
    return t0;
  };
  const half = time(0.5), full = time(1), up = time(0);
  const allDown = (() => { time(0); return time(1); })();
  say(`flaps: up to 1/2 in ${half.toFixed(2)} s, 1/2 to full in ${full.toFixed(2)} s, full to up in ${up.toFixed(2)} s; up to full in ${allDown.toFixed(2)} s (${cite(FLAPS_DOWN_SECONDS)}; ${cite(FLAPS_UP_SECONDS)}; within 1)`);
  flight.dispose();
  assert.ok(Math.abs(allDown - FLAPS_DOWN_SECONDS.value) <= 1 && Math.abs(up - FLAPS_UP_SECONDS.value) <= 1);
  // The game's start: on the runway at the takeoff setting, read back.
  const parked = Flight.start(m, F4C);
  assert.equal(parked.get('fcs/flap-cmd-norm'), 0.5);
  assert.equal(parked.get('fcs/flap-pos-norm'), 0.5, 'parked at 1/2 flaps');
  parked.dispose();
});

test('f4c low, reported: gear and speedbrake travel times; at idle from 400 to 250 knots, speedbrakes in and out, and the pitch change as they open; the lean (the tilt for level flight at 250, 450 and 600 knots); the landing roll from on-speed', async () => {
  const m = await module();
  // Travel.
  const flight = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots: 220 }, terrain: GROUND });
  const travel = (control, name) => { let t0 = null; flight.fly({ [control]: true }); run(flight, 6, (t) => { if (t0 === null && flight.get(name) >= 0.999999) { t0 = t; return false; } return true; }); return t0; };
  const gear = travel('gear', 'gear/gear-pos-norm'), boards = travel('speedbrake', 'fcs/speedbrake-pos-norm');
  flight.dispose();
  report.line(`f4c low, reported: the gear comes down in ${gear.toFixed(2)} s (${cite(GEAR_SECONDS)}), the speedbrakes open in ${boards.toFixed(2)} s (${cite(WINGS_SPEEDBRAKE_SECONDS)})`);

  // Idle from 400 to 250 knots, level at 5,000 ft (the pilot holds the height with the stick), boards in and out.
  const slowDown = (out) => {
    const f = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots: 400 }, terrain: GROUND }), h0 = f.value('position/h-sl-ft'), pitch0 = f.value('attitude/theta-rad') * DEG;
    let held = f.controls.pitch, seconds = null, nose = 0;
    run(f, 200, (t) => {
      const err = h0 - f.value('position/h-sl-ft'), climb = -f.value('velocities/v-down-fps');
      held = clamp(held + 0.0002 * err * DT, -1, 1);
      f.fly({ throttle: 0, speedbrake: out, pitch: clamp(held + 0.002 * err - 0.01 * climb, -1, 1), roll: clamp(-2 * f.value('attitude/phi-rad'), -1, 1) });
      if (t < 4) nose = Math.min(nose, f.value('attitude/theta-rad') * DEG - pitch0);
      if (f.value('velocities/vc-kts') <= 250) { seconds = t; return false; }
      return true;
    });
    f.dispose();
    return seconds;
  };
  const [inside, outside] = [slowDown(false), slowDown(true)];
  // The pitch change as they open: from 400 knots, trimmed, the stick held where the trim left it.
  const f = Flight.start(m, F4C, { airborne: { heightFt: 5000, knots: 400 }, terrain: GROUND }), pitch0 = f.value('attitude/theta-rad') * DEG;
  let drop = 0;
  run(f, 5, () => { f.fly({ speedbrake: true }); drop = Math.min(drop, f.value('attitude/theta-rad') * DEG - pitch0); });
  f.dispose();
  say(`idle, level at 5,000 ft, 400 to 250 kt: ${inside.toFixed(0)} s with the speedbrakes in, ${outside.toFixed(0)} s with them out; opened at 400 kt with the stick held, the nose drops ${(-drop).toFixed(1)} degrees in 5 s (Wings ${cite(WINGS_IDLE_SLOWDOWN)})`);

  // The lean: the tilt that holds level flight at each speed with the copilot's neutral trim. Worked out from
  // JSBSim's own trim there (no force on the stick, its own pitch trim): the stabilator it needs, against the
  // copilot's trimmed stabilator, is a stick travel at the feel system's gearing (3.36 degrees an inch), held
  // against its static spring there; that force is the pull or push the tilt gives (full 103 lb back, 48 forward:
  // the aircraft file's fcs/stick/full-pull-lbs and full-push-lbs), and the tilt is what sends that stick through
  // the gentler middle. A settled value: level, steady flight. (Flown with a pilot holding the height instead,
  // 250 knots took the stick to its back stop: the tilt that holds it is a settled number, a held pull is not.)
  const trimStabilator = (t) => (t < 0 ? 21 * t : 9 * t), lean = [];
  for (const knots of [250, 450, 600]) {
    const g = Flight.start(m, F4C, { airborne: { heightFt: F4C.assists.trim.heightFt, knots }, terrain: GROUND });
    const stick = (trimStabilator(g.trimmed.heldPitchTrim) - trimStabilator(F4C.assists.trim.sets[0][1])) / -3.36;   // inches aft
    const pounds = stick * g.get('fcs/stick/static-lbs_in'), sent = pounds >= 0 ? pounds / g.get('fcs/stick/full-pull-lbs') : pounds / g.get('fcs/stick/full-push-lbs');
    lean.push(`${knots} kt: ${Math.abs(pounds).toFixed(1)} lb ${pounds >= 0 ? 'pull' : 'push'}, the stick ${(Math.abs(sent) * 100).toFixed(1)}%, the tilt ${(Math.abs(solveGentle(sent)) * 100).toFixed(0)}% ${sent >= 0 ? 'back' : 'forward'}`);
    g.dispose();
  }
  say(`the lean, neutral trim for 350 kt: ${lean.join('; ')} (Wings ${cite(WINGS_LEAN)})`);

  // The landing roll from on-speed: touching down at 147 knots, idle, brakes on, the nose let down.
  const r = Flight.start(m, F4C, { controls: { flaps: 1, brake: false }, sets: [['ic/h-agl-ft', 7.0], ['ic/theta-deg', 8], ['ic/vn-fps', 0], ['ic/ve-fps', 147 * KT], ['ic/vd-fps', 5]], settleSeconds: 0 });
  const from = r.where();
  run(r, 60, () => { r.fly({ throttle: 0, brake: r.value('gear/unit[1]/WOW') === 1, pitch: 0, roll: 0 }); return r.value('velocities/vg-fps') > 1; });
  const at = r.where();
  say(`the landing roll: touching down at 147 kt, idle, brakes on as the mains touch, on the dry test runway: ${(Math.hypot(at.north - from.north, at.east - from.east) / FT).toFixed(0)} ft to a stop (${cite(F4E_LANDING_ROLL)})`);
  r.dispose();
});

/** The tilt that sends a stick (src/input/pilot.js, gentle), by bisection. */
function solveGentle(stick) {
  let lo = -1, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (gentle(mid) < stick) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---- 9. The ground: every contact point, hard and soft arrivals ----

/**
 * An arrival, after tests/rules.test.js's `arrive`: started `heightFt` above the runway, `knots` along it, at a
 * pitch and bank, sinking so that the last step before the first touch sinks at `sinkFpm` (within 25); with
 * `sinkFpm: null`, whatever it arrives with.
 */
function arrive(m, { knots = 150, sinkFpm, startSinkFpm = sinkFpm, pitchDeg = 0, bankDeg = 0, heightFt, gear = true, crashOverride = false, seconds = 3 }) {
  let start = startSinkFpm, out, tried = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const sets = [['ic/h-agl-ft', heightFt], ['ic/theta-deg', pitchDeg], ['ic/phi-deg', bankDeg], ['ic/vn-fps', 0], ['ic/ve-fps', knots * KT], ['ic/vd-fps', start / 60]];
    const flight = Flight.start(m, F4C, { sets, settleSeconds: 0, crashOverride, controls: { gear, brake: false, flaps: 1 } });
    assert.deepEqual(flight.stateNames.filter((n, i) => n.endsWith('/WOW') && flight.state[i] === 1), [], 'nothing touching at the start');
    out = { events: [], sink: null, flight };
    for (let k = 0; k < 30 / DT && out.sink === null; k++) {
      const sink = flight.value('velocities/v-down-fps') * 60;
      flight.step(1);
      out.events.push(...flight.rules.takeEvents());
      if (out.events.some((e) => e.type === 'touch') || flight.ended) out.sink = sink;
    }
    assert.ok(out.sink !== null, 'it reached the ground');
    if (sinkFpm === null || Math.abs(out.sink - sinkFpm) <= 10) break;
    flight.dispose();
    const slope = tried && Math.abs(out.sink - tried.sink) > 1 ? (start - tried.start) / (out.sink - tried.sink) : 1;
    tried = { start, sink: out.sink };
    start -= Math.max(0.2, Math.min(2, slope)) * (out.sink - sinkFpm);
  }
  if (sinkFpm !== null) assert.ok(Math.abs(out.sink - sinkFpm) <= 25, `sink ${out.sink}, wanted ${sinkFpm}`);
  out.first = out.events.filter((e) => e.type === 'touch');
  for (let k = 0; k < seconds / DT && !out.flight.ended; k++) { out.flight.step(1); out.events.push(...out.flight.rules.takeEvents()); }
  out.touches = out.events.filter((e) => e.type === 'touch');
  out.ended = out.flight.ended;
  out.flight.dispose();
  return out;
}

test('f4c low: "Every contact point is made to touch and is named; a 1,500 ft/min arrival survives and a 1,900 ft/min one ends the flight (Wings\' line; the owner flew it)"', async () => {
  const m = await module(), seen = new Map();
  // With the crash override on, each from a few feet up at 150 knots, sinking 300 ft/min, in an attitude that brings one part of the airplane down first.
  const arrivals = [
    ['on the mains, nose up', { pitchDeg: 8, heightFt: 7.6 }],
    ['nose low', { pitchDeg: -3, heightFt: 9 }],
    ['gear up, level', { pitchDeg: 1, heightFt: 4, gear: false }],
    ['gear up, nose 6 degrees down', { pitchDeg: -6, heightFt: 6.5, gear: false }],
    ['gear up, tail low', { pitchDeg: 10, heightFt: 6.5, gear: false }],
    ['gear up, tail low and settling', { pitchDeg: 4, heightFt: 4, gear: false, seconds: 6 }],
    ['left wing low', { bankDeg: -40, heightFt: 13.5, gear: false }],
    ['right wing low', { bankDeg: 40, heightFt: 13.5, gear: false }],
    ['on its back', { bankDeg: 180, heightFt: 11, gear: false }],
  ];
  for (const [label, how] of arrivals) {
    const r = arrive(m, { ...how, sinkFpm: null, startSinkFpm: 300, crashOverride: true });
    r.touches.forEach((e) => { if (!seen.has(e.point)) seen.set(e.point, `${label}${r.first.includes(e) ? ' (first)' : ''}`); });
  }
  report.line(`f4c low: every contact point, named, and the arrival that first made it touch: ${F4C.contacts.map((point) => `${point}: ${seen.get(point) ?? 'NEVER'}`).join('; ')}`);
  for (const point of F4C.contacts) assert.ok(seen.has(point), `${point} touched`);
  // Hard and soft, on the wheels, crash override off.
  const soft = arrive(m, { pitchDeg: 8, heightFt: 7.6, sinkFpm: 1500 }), hard = arrive(m, { pitchDeg: 8, heightFt: 7.6, sinkFpm: 1900 });
  say(`on the mains at ${soft.sink.toFixed(0)} ft/min (first: ${soft.first.map((e) => `${e.point} closing at ${e.closingFpm.toFixed(0)}`).join(', ')}): ${soft.ended ? `ended, ${soft.ended.reason}` : 'carries on'}; at ${hard.sink.toFixed(0)} ft/min: ${hard.ended ? `ended, ${hard.ended.reason}` : 'carries on'} (the line: ${F4C.crash.closingFpm.toFixed(0)} ft/min, Wings' 8 m/s)`);
  assert.equal(F4C.crash.closingFpm, WINGS_CRASH_FPM);
  assert.ok(soft.first.every((e) => e.wheel) && hard.first.every((e) => e.wheel), 'on the wheels');
  assert.equal(soft.ended, null);
  assert.equal(hard.ended?.reason, 'hard impact');
});
