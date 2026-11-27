// The F-4C's aerodynamics at low speed (aircraft/f4c/f4c.xml, the <aerodynamics> section): the F-4C's
// checkride begins here. New in FSG, milestone 3 (docs/milestones/3.md, pull request 5, first half).
//
// The aerodynamics are one report's model: AFWAL-TR-80-3141 Part III, appendix I, 28 tables in angle of
// attack and the equations that add them up (its Table 1). The tables as read from the scan are in
// aircraft/f4c/data/afwal-f4j.json. This file:
//   1. holds every table in the aircraft file to that record, cell for cell;
//   2. works Table 1 out again in JavaScript from the record, and holds the six totals JSBSim computes to
//      it at a grid of states (Verified against AFWAL's own tables: nothing in the comparison is ours but
//      the reading of the scan);
//   3. flies the airplane at low speed against loose lines, each written before it was flown: the task's
//      own ("within 1.5 degrees", "between +2 and -10 degrees") and, where the task said only "bounded",
//      "damped" or "dies away", the numbers under LINES below;
//   4. reports the edge of the envelope with no pass or fail (pull request 10 judges it);
//   5. flies a two-minute tape again in native JSBSim, by milestone 1's lines.
// What Mach changes, and NASA CR-2144's nine flight conditions, are the second half of pull request 5:
// tests/f4c-conditions.test.js. Since it, the flights that hold the file to AFWAL's Table 1 are flown slower
// than Mach 0.3 (they were at Mach 0.57), where nothing of what Mach changes is in the airplane; and the
// low-speed sanity flights at 300 and 400 knots have Mach in them. Their lines are as they were.
// Every measured number is printed beside its reference and kept in jsbsim/build/results/checkride-f4c-aero.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { assistWrites } from '../src/sim/assists.js';
import { DT, Flight } from '../src/sim/game.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace } from '../jsbsim/tests/lib/scenario.js';
import { STRAIGHT } from './checkride/conditions.js';
import { bytesOf, moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';
import { DATA, LISTING, SIX, SLOW_FPS, constant, dimension, snapshot, startAt, table1 } from './checkride/table1.js';

const { WING_AREA, WING_SPAN, WING_CHORD, WEIGHT, CG_PERCENT_CHORD, AFWAL_REFERENCE_CENTRE, AFWAL_REFERENCE_HEIGHT, STABILATOR_TRAVEL, AILERON_TRAVEL,
  SPOILER_PER_AILERON, RUDDER_TRAVEL, WING_ROCK_ALPHA, NOSE_SLICE_ALPHA, WINGS_NEUTRAL_SPEED, WINGS_ROLL_RATE_250, WINGS_ROLL_RATE_400 } = REFERENCE;
const DEG = 180 / Math.PI, KT = 1.6878, G = 32.174;
const S = WING_AREA.value, SPAN = WING_SPAN.value, CHORD = WING_CHORD.value;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;

/** The aircraft file, as text, and its aerodynamics section. */
const file = bytesOf(F4C, F4C.files[0]).toString();
const aerodynamics = file.slice(file.indexOf('<aerodynamics>'), file.indexOf('</aerodynamics>'));

/** The 24 functions the model uses: set 1 of AFWAL's doubled ones (its Table 4, configuration A, the F-4J). */
/** The large-sideslip bend's terms (pull request 10, round 3): each multiplied by the factors of the term it bends, not one of its own. */
const BEND_TERMS = ['side-sideslip-bend', 'roll-sideslip-bend', 'roll-sideslip-below-zero', 'yaw-sideslip-bend'];
const USED = ['CLBAS', 'CLSTAB', 'CDBAS', 'CYB', 'CYDR', 'CRB1', 'CRP1', 'CRR', 'CRDA', 'CRDSP', 'CRDR',
  'CMBAS', 'DCM1', 'CMQ', 'CMAD', 'CMSTAB', 'CMDA', 'CMDSP', 'CNB1', 'CNP', 'CNR', 'CNDA', 'CNDSP', 'CNDR'];

/**
 * The lines for the low-speed sanity flights, where the task said a word and not a number. Written before
 * any of these flights was flown (26 November 2026) and not changed since.
 *   bounded    started 10% off the trim speed, controls fixed: for 60 s the speed stays within 15% of the trim
 *              speed, and the height within one and a half times the full swing of a slow speed-and-height
 *              swing with no damping at all, 2 V dV / g (energy: what it loses in speed it gains in height).
 *   damped     after the stabilator's pulse, each swing of the pitch rate (from one turning point to the next)
 *              is smaller than the one before, and 10 s after the pulse the pitch rate is back within 5% of
 *              the largest it reached.
 *   dies away  after the rudder's kick, each of the first four swings of the sideslip is smaller than the one
 *              before, and any swing that starts later than 15 s after the kick is under a quarter of the first.
 */
const LINES = { speedShare: 0.15, heightSwings: 1.5, pitchLeftAt10s: 0.05, slipSwings: 4, slipLateSeconds: 15, slipLateShare: 0.25 };

/** Runs a flight for some seconds, calling `each(t)` before every step. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
    assert.equal(flight.ended, null, 'the flight goes on');
  }
}

// ---- flying it ----

const knots = (flight) => flight.value('velocities/vc-kts');
const feet = (flight) => flight.value('position/h-sl-ft');
const bank = (flight) => flight.value('attitude/phi-rad') * DEG;
const pitch = (flight) => flight.value('attitude/theta-rad') * DEG;
const slip = (flight) => flight.value('aero/beta-rad') * DEG;
const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
/** The three speeds of the sanity flights, knots calibrated, all at AFWAL's 15,000 ft. */
const SPEEDS = [250, 300, 400];

/** In the air by JSBSim's own trim (as tests/assists.test.js), read back: the F-4C's one weight, gear up, level and steady at that speed and height. */
function inTheAir(module, at, options = {}) {
  // Pull request 5's airplane: the stick and the rudder straight to the surfaces (the aircraft file's test
  // switch, tests/checkride/conditions.js); tests/f4c-fcs.test.js flies the real controls.
  const flight = Flight.start(module, F4C, { airborne: at, ...options, sets: [...STRAIGHT, ...(options.sets ?? [])] });
  assert.ok(Math.abs(knots(flight) - at.knots) < 0.5 && Math.abs(feet(flight) - at.heightFt) < 1, `${knots(flight)} kt at ${feet(flight)} ft`);
  assert.ok(Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && Math.abs(flight.value('velocities/v-down-fps')) < 0.5 && Math.abs(bank(flight)) < 0.5,
    `level and steady: ${flight.value('accelerations/Nz')} g, sinking ${flight.value('velocities/v-down-fps')} ft/s, bank ${bank(flight)} degrees`);
  assert.ok(flight.value('inertia/weight-lbs') === WEIGHT.value && flight.value('gear/gear-pos-norm') === 0, `${flight.value('inertia/weight-lbs')} lb, gear ${flight.value('gear/gear-pos-norm')}`);
  return flight;
}

/** By hand: the angle of attack, from 0 to 15 degrees, at which AFWAL's basic lift is `lift` (its listing, straight lines between its points). */
function angleForLift(lift) {
  const { alpha_deg: xs, values: ys } = LISTING.CLBAS;
  for (let i = 1; xs[i] <= 15; i++) if (lift >= ys[i - 1] && lift <= ys[i]) return xs[i - 1] + ((lift - ys[i - 1]) / (ys[i] - ys[i - 1])) * (xs[i] - xs[i - 1]);
  throw new Error(`no angle of attack from 0 to 15 degrees gives a lift coefficient of ${lift}`);
}

/**
 * Where a record of { t, x } turns round: each highest and lowest point, once the record has come back from it
 * by more than `floor` (so that a swing smaller than the floor is not found, and ends the list).
 */
function turningPoints(samples, floor) {
  const points = [];
  let going = 0, best = samples[0];
  for (const sample of samples) {
    if (going === 0) {
      if (Math.abs(sample.x - samples[0].x) > floor) { going = Math.sign(sample.x - samples[0].x); best = sample; }
    } else if ((sample.x - best.x) * going > 0) best = sample;
    else if ((best.x - sample.x) * going > floor) { points.push(best); going = -going; best = sample; }
  }
  return points;
}
/** The size of each swing: from one turning point to the next, and first from `start` (where the record began) if given. */
function swingsOf(start, turns) {
  const points = start ? [start, ...turns] : turns;
  return points.slice(1).map((point, i) => Math.abs(point.x - points[i].x));
}
/** Each swing as a share of the one before. */
const ratios = (swings) => swings.slice(1).map((swing, i) => swing / swings[i]);

const report = new Report('checkride-f4c-aero');
test.after(() => report.save());

// ---- 1. The aircraft file's tables are the record's ----

test('f4c: every table of AFWAL\'s in the aircraft file is its listing as read, cell for cell: the 24 functions of set 1; the only other tables are the 22 that carry what Mach changes (and since then the flaps\' and gear\'s, ground effect\'s, and the large-sideslip bend\'s)', () => {
  // The first half of pull request 5 had these 24 and no other table. The second half added what Mach changes:
  // 22 tables in Mach and height, between two marks, which tests/f4c-conditions.test.js holds to their own record.
  const every = [...aerodynamics.matchAll(/<function name="([^"]+)">\s*<table>([^]*?)<\/table>\s*<\/function>/g)];
  const tables = every.filter(([, name]) => name.startsWith('aero/table/')), others = every.filter(([, name]) => !name.startsWith('aero/table/'));
  assert.equal(tables.length, USED.length);
  // Pull request 6 added the flight controls' own four tables (CR-2144's feel system, figure IV-5, three; its
  // rudder flexure, figure IV-6), which tests/f4c-fcs.test.js holds to their record: none anywhere else.
  const controls = file.slice(file.indexOf('<flight_control'), file.indexOf('</flight_control>'));
  assert.equal(controls.split('<table>').length - 1, 4, 'the flight controls have the feel system\'s three and the flexure\'s one');
  assert.equal(file.split('<table>').length - 1, every.length + 4, 'there is no table anywhere else in the file');
  // Pull request 7 added the flaps' and the gear's 24 (between their own two marks, held to tools/f4c-flaps.mjs
  // by tests/f4c-low.test.js) and ground effect's two: none of them is AFWAL's.
  const mach = others.filter(([, name]) => /^aero\/(factor|increment)\//.test(name)), low = others.filter(([, name]) => /^aero\/(flaps|gear)\//.test(name));
  // Pull request 10 (round 3) added TN D-6425's large-sideslip bend: four tables between their own two marks, held
  // to tools/f4c-sideslip.mjs by tests/f4c-sideslip.test.js.
  const bend = others.filter(([, name]) => /^aero\/sideslip\//.test(name));
  const bendMarked = file.slice(file.indexOf('<!-- SIDESLIP TABLES'), file.indexOf('<!-- END OF SIDESLIP TABLES -->'));
  assert.ok(bend.length === 4 && bendMarked.split('<table>').length - 1 === 4, 'the bend\'s four, all between their two marks');
  assert.ok(mach.length === 22 && low.length === 24, 'every other table is a factor or an increment of what Mach changes, or of the flaps and the gear');
  assert.deepEqual(others.filter(([, name]) => !mach.some(([, n]) => n === name) && !low.some(([, n]) => n === name) && !bend.some(([, n]) => n === name)).map(([, name]) => name), ['aero/ground-effect/lift-factor', 'aero/ground-effect/drag-factor'], 'and ground effect\'s two');
  const marked = file.slice(file.indexOf('<!-- MACH TABLES'), file.indexOf('<!-- END OF MACH TABLES -->'));
  assert.equal(marked.split('<table>').length - 1, mach.length, 'what Mach changes is all between its two marks');
  const flapsMarked = file.slice(file.indexOf('<!-- FLAP AND GEAR TABLES'), file.indexOf('<!-- END OF FLAP AND GEAR TABLES -->'));
  assert.equal(flapsMarked.split('<table>').length - 1, low.length, 'and the flaps\' and the gear\'s between theirs');
  assert.deepEqual(tables.map(([, name]) => name), USED.map((name) => `aero/table/${name}`), 'each table is named for AFWAL\'s function, in the listing\'s order');
  assert.deepEqual(Object.keys(LISTING).filter((name) => !USED.includes(name)), ['CRB2', 'CRP2', 'DCM2', 'CNB2'], 'what is left out is AFWAL\'s second set');
  let cells = 0;
  for (const [, name, body] of tables) {
    const listing = LISTING[name.replace('aero/table/', '')];
    const lookups = [...body.matchAll(/<independentVar lookup="(\w+)">\s*(\S+)\s*<\/independentVar>/g)].map((m) => [m[1], m[2]]);
    const rows = body.match(/<tableData>([^]*?)<\/tableData>/)[1].trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
    assert.ok(rows.flat().every(Number.isFinite), `${name}: every cell is a number`);
    if (listing.values_by_beta) {
      // The one table in two variables: a row for each angle of attack, a column for each sideslip.
      assert.deepEqual(lookups, [['row', 'aero/alpha-abs-deg'], ['column', 'aero/mag-beta-deg']], `${name}: read at the angle of attack and the sideslip, both without their sign`);
      assert.deepEqual(rows[0], listing.values_by_beta.map((row) => row.beta_deg), `${name}: the sideslips`);
      const alphas = listing.values_by_beta[0].alpha_deg;
      assert.deepEqual(rows.slice(1).map((row) => row[0]), alphas, `${name}: the angles of attack`);
      for (const [i, row] of rows.slice(1).entries()) {
        assert.deepEqual(row.slice(1), listing.values_by_beta.map((byBeta) => byBeta.values[i]), `${name} at ${alphas[i]} degrees`);
        cells += row.length - 1;
      }
    } else {
      assert.deepEqual(lookups, [['row', 'aero/alpha-abs-deg']], `${name}: read at the angle of attack without its sign`);
      assert.deepEqual(rows.map((row) => row[0]), listing.alpha_deg, `${name}: the angles of attack`);
      assert.deepEqual(rows.map((row) => row[1]), listing.values, `${name}: the values`);
      cells += rows.length;
    }
  }
  // 24 of the listing's 28 functions: its 504 cells less the second set's.
  const all = Object.values(LISTING).reduce((sum, f) => sum + (f.values_by_beta ? f.values_by_beta.length * f.values_by_beta[0].values.length : f.values.length), 0);
  assert.equal(all, DATA.counts.table_9_cells);
  report.line(`f4c: ${tables.length} tables of AFWAL's in the aircraft file, ${cells} cells, each equal to AFWAL's listing as read (aircraft/f4c/data/afwal-f4j.json: ${all} cells in ${Object.keys(LISTING).length} functions; the second set is not used)`);

  // The four numbers that are not tables, and a factor for every term of Table 1. In the first half every
  // factor was the number 1. Now a factor is 1 by declaration (a term NASA CR-2144 says nothing about), or a
  // table in Mach whose first row is 1 (tests/f4c-conditions.test.js), or another term's factor (the
  // spoiler's is the aileron's). The flights below read every one back as 1 at low Mach.
  const declared = new Map([...aerodynamics.matchAll(/<property value="([^"]+)">\s*(\S+)\s*<\/property>/g)].map((m) => [m[2], Number(m[1])]));
  assert.equal(declared.get('aero/constant/CLBAS-at-zero'), LISTING.CLBAS.values[0]);
  assert.equal(LISTING.CLBAS.alpha_deg[0], 0);
  assert.equal(declared.get('aero/constant/Cy-delta-a'), constant('Cy_delta_a'));
  assert.equal(declared.get('aero/constant/Cy-delta-sp'), constant('Cy_delta_sp'));
  assert.equal(declared.get('aero/constant/K-beta'), constant('K_beta^(Cm_delta_stab)'));
  const byDeclaration = [...declared].filter(([name]) => name.startsWith('aero/factor/')), byTable = others.map(([, name]) => name).filter((name) => name.startsWith('aero/factor/'));
  const shared = [...aerodynamics.matchAll(/<function name="(aero\/factor\/[a-z-]+)">\s*<property> aero\/factor\/[a-z-]+ <\/property>\s*<\/function>/g)].map((m) => m[1]);
  const terms = [...aerodynamics.matchAll(/<function name="aero\/coefficient\/([a-z-]+)">/g)].map((m) => m[1]).filter((name) => !SIX.includes(name) && !name.endsWith('-mach') && !BEND_TERMS.includes(name));
  assert.equal(terms.length, 26);
  assert.deepEqual([...byDeclaration.map(([name]) => name), ...byTable, ...shared].sort(), terms.map((term) => `aero/factor/${term}`).sort(), 'a factor for every term of Table 1, and no other');
  assert.ok(byDeclaration.every(([, value]) => value === 1), 'every factor that is a number is 1');
  assert.deepEqual([byDeclaration.length, byTable.length, shared.length], [7, 17, 2]);
  assert.equal(declared.size, 4 + byDeclaration.length);
  for (const term of terms) assert.ok(aerodynamics.includes(`<function name="aero/coefficient/${term}">\n   <product>\n    <property> aero/factor/${term} </property>`), `${term} is multiplied by its factor`);

  // The geometry is AFWAL's and CR-2144's alike, and the reference point is where the two reports put it.
  assert.deepEqual([dimension('S'), dimension('b'), dimension('c')], [S, SPAN, CHORD]);
  assert.equal(dimension('Xref'), AFWAL_REFERENCE_CENTRE.value);
  assert.equal(dimension('H'), AFWAL_REFERENCE_HEIGHT.value);
  const point = file.match(/<location name="AERORP" unit="IN">\s*<x>\s*(\S+)\s*<\/x>\s*<y>\s*(\S+)\s*<\/y>\s*<z>\s*(\S+)\s*<\/z>/).slice(1).map(Number);
  const behind = ((AFWAL_REFERENCE_CENTRE.value - CG_PERCENT_CHORD.value) / 100) * CHORD * 12;
  report.line(`f4c: the aerodynamic reference point is ${point[0]} in behind the centre of gravity, on its waterline; (${AFWAL_REFERENCE_CENTRE.value} - ${CG_PERCENT_CHORD.value})% of ${CHORD} ft is ${behind.toFixed(5)} in (${cite(AFWAL_REFERENCE_CENTRE)}; ${cite(CG_PERCENT_CHORD)})`);
  assert.ok(Math.abs(point[0] - behind) < 1e-6 && point[1] === 0 && point[2] === 0);
  // The control travels in the file are the reference's.
  assert.match(file, /<aerosurface_scale name="fcs\/stabilator">\s*<input> fcs\/pitch-stick-and-trim <\/input>\s*<range>\s*<min> -21 <\/min>\s*<max> 9 <\/max>/);
  assert.deepEqual(STABILATOR_TRAVEL.value, DATA.table_6.rows[0].range_deg);
  assert.deepEqual([AILERON_TRAVEL.value, RUDDER_TRAVEL.value], [DATA.table_6.rows[1].range_deg[1], DATA.table_6.rows[3].range_deg[1]]);
  assert.equal(DATA.control_system.spoiler_aileron_relation.as_printed, `delta_sp = ${REFERENCE.AFWAL_SPOILER_PER_AILERON.value} delta_a`);
});

for (const variant of VARIANTS) {
  const say = (line) => report.line(`  ${variant}: ${line}`);

  // ---- The controls, straight to the surfaces ----

  test(`${variant}, f4c: the stick straight to the surfaces: full back is the stabilator 21 degrees up and full forward 9 down; full right is the left aileron 30 degrees down and the right spoiler up 1.5 times as far (45 degrees), the other pair flush; the rudder 30 degrees each way`, async () => {
    const module = await moduleWith(F4C, variant);
    const surfaces = (controls, rudder = 0) => {
      const flight = startAt(module, { alpha: 2, beta: 0, ...controls, rudder });
      const at = Object.fromEntries(['fcs/elevator-pos-deg', 'fcs/left-aileron-pos-deg', 'fcs/right-aileron-pos-deg', 'fcs/left-spoiler-pos-deg', 'fcs/right-spoiler-pos-deg', 'fcs/rudder-pos-deg']
        .map((name) => [name.replace(/fcs\/|-pos-deg/g, ''), flight.get(name)]));
      // The game's state has the same surfaces, in radians.
      for (const [name, key] of [['fcs/elevator-pos-rad', 'elevator'], ['fcs/left-aileron-pos-rad', 'left-aileron'], ['fcs/right-aileron-pos-rad', 'right-aileron'], ['fcs/rudder-pos-rad', 'rudder']]) {
        assert.ok(Math.abs(flight.value(name) * DEG - at[key]) < 1e-9, `${name} in the state`);
      }
      flight.dispose();
      return at;
    };
    const near = (value, wanted, what) => assert.ok(Math.abs(value - wanted) < 1e-9, `${what}: ${value}, wanted ${wanted}`);
    const [up, down] = STABILATOR_TRAVEL.value, most = AILERON_TRAVEL.value, ratio = SPOILER_PER_AILERON.value;
    near(surfaces({ pitch: 1 }).elevator, up, 'full back stick');
    near(surfaces({ pitch: -1 }).elevator, down, 'full forward stick');
    near(surfaces({ pitch: 0 }).elevator, 0, 'stick in the middle');
    near(surfaces({ pitch: 0.5 }).elevator, up / 2, 'half back stick');
    const right = surfaces({ roll: 1 }), left = surfaces({ roll: -1 }), half = surfaces({ roll: 0.5 }), none = surfaces({});
    for (const [name, wanted] of [['left-aileron', most], ['right-spoiler', ratio * most], ['right-aileron', 0], ['left-spoiler', 0]]) near(right[name], wanted, `full right stick, ${name}`);
    for (const [name, wanted] of [['right-aileron', most], ['left-spoiler', ratio * most], ['left-aileron', 0], ['right-spoiler', 0]]) near(left[name], wanted, `full left stick, ${name}`);
    near(half['left-aileron'], most / 2, 'half right stick');
    for (const name of ['left-aileron', 'right-aileron', 'left-spoiler', 'right-spoiler', 'rudder']) near(none[name], 0, `stick in the middle, ${name}`);
    near(surfaces({}, 1).rudder, RUDDER_TRAVEL.value, 'full left pedal (JSBSim\'s positive)');
    near(surfaces({}, -1).rudder, -RUDDER_TRAVEL.value, 'full right pedal');
    say(`full back stick: stabilator ${up} degrees (trailing edge up); full forward ${down}. Full right stick: left aileron ${right['left-aileron']} down, right spoiler ${right['right-spoiler'].toFixed(2)} up, the other two ${right['right-aileron']} and ${right['left-spoiler']}. Rudder ${RUDDER_TRAVEL.value} each way. References: ${cite(STABILATOR_TRAVEL)}; ${cite(AILERON_TRAVEL)}; ${cite(SPOILER_PER_AILERON)}`);
  });

  // ---- 2. The wiring: JSBSim's six totals are Table 1's ----

  test(`${variant}, f4c: at a grid of states below Mach 0.3 the six coefficients JSBSim works out are AFWAL's Table 1 worked out in JavaScript from the record, within 0.000001: angles of attack from -120 to 130 degrees, sideslip to 35 either way, every control, and the airplane turning`, async () => {
    const module = await moduleWith(F4C, variant);
    const ALPHAS = [-120, -45, -10, -5, -2, 0, 2.5, 5, 10, 15, 20, 22.5, 25, 30, 37, 45, 52.5, 60, 90, 110, 130];
    const BETAS = [0, 5, -5, 20, -20, 35, -35, 12];
    // Controls and rates are taken in turn from lists whose lengths share no factor, so that over the grid
    // every value meets every other. Pitch +1 is full back stick (21 degrees up), -1 full forward (9 down).
    const PITCH = [1, 0, -1, 0.4, -0.5], ROLL = [0, 1, -1, 0.6, -0.3, 0.25, -0.75], RUDDER = [0, 1, -1, 0.5];
    const P = [0, 0.8, -1.5], Q = [0.3, 0, -0.2, 0.1, 0], R = [0, -0.4, 0.25, 0, 0.1, -0.1, 0.3];
    const worst = Object.fromEntries(SIX.map((name) => [name, { off: 0 }]));
    const seen = { states: 0, mach: 0, alphaDot: 0, negative: 0, above45: 0, above110: 0, slipBeyond30: 0, stabilators: new Set(), ailerons: new Set(), rudders: new Set(), turning: 0 };
    const check = (flight, what) => {
      const { state, measured } = snapshot(flight), wanted = table1(state, CG_PERCENT_CHORD.value);
      for (const name of SIX) {
        const off = Math.abs(measured[name] - wanted[name]);
        assert.ok(off <= 1e-6, `${name} ${what}: JSBSim ${measured[name]}, Table 1 ${wanted[name]} (${JSON.stringify(state)})`);
        if (off > worst[name].off) worst[name] = { off, what, value: wanted[name] };
      }
      seen.states++;
      seen.mach = Math.max(seen.mach, flight.get('velocities/mach'));
      seen.alphaDot = Math.max(seen.alphaDot, Math.abs(state.alphaDot));
      if (state.alpha < 0) seen.negative++;
      if (Math.abs(state.alpha) > 45) seen.above45++;
      if (Math.abs(state.alpha) > 110) seen.above110++;
      if (Math.abs(state.beta) > 30) seen.slipBeyond30++;
      if (state.p !== 0 && state.q !== 0 && state.r !== 0) seen.turning++;
      return state;
    };
    let n = 0;
    const one = (alpha, beta, k) => {
      const asked = { alpha, beta, pitch: PITCH[k % 5], roll: ROLL[k % 7], rudder: RUDDER[k % 4], p: P[k % 3], q: Q[k % 5], r: R[k % 7] };
      const flight = startAt(module, asked), what = `at ${alpha} and ${beta} degrees (state ${k})`;
      // As started: read back that the state is the one asked for.
      const state = check(flight, `${what}, as started`);
      assert.ok(Math.abs(state.alpha - alpha) < 1e-6 && Math.abs(state.beta - beta) < 1e-6 && Math.abs(state.vt - SLOW_FPS) < 1e-6, `${what}: started at ${state.alpha} and ${state.beta} degrees, ${state.vt} ft/s`);
      assert.ok(Math.abs(state.p - asked.p) < 1e-4 && Math.abs(state.q - asked.q) < 1e-4 && Math.abs(state.r - asked.r) < 1e-4, `${what}: turning at ${state.p}, ${state.q}, ${state.r}`);
      const [up, down] = STABILATOR_TRAVEL.value;
      assert.ok(Math.abs(state.stabilator - (asked.pitch >= 0 ? asked.pitch * up : -asked.pitch * down)) < 1e-9, `${what}: stabilator ${state.stabilator}`);
      assert.ok(Math.abs(state.aileron - asked.roll * AILERON_TRAVEL.value) < 1e-9 && Math.abs(state.spoiler - asked.roll * AILERON_TRAVEL.value * SPOILER_PER_AILERON.value) < 1e-9, `${what}: aileron ${state.aileron}, spoiler ${state.spoiler}`);
      assert.ok(Math.abs(state.rudder - asked.rudder * RUDDER_TRAVEL.value) < 1e-9, `${what}: rudder ${state.rudder}`);
      seen.stabilators.add(state.stabilator); seen.ailerons.add(state.aileron); seen.rudders.add(state.rudder);
      // And three steps on, when the airplane has moved off the tables' own points and its angle of attack is changing.
      assert.equal(flight.step(3), 0);
      check(flight, `${what}, three steps on`);
      flight.dispose();
    };
    for (const alpha of ALPHAS) for (const beta of BETAS) { one(alpha, beta, n); one(alpha, beta, n + 17); n++; }
    // Every control against every other at one state.
    for (const pitch of [1, 0, -1]) for (const roll of ROLL.slice(0, 5)) for (const rudder of [0, 1, -1]) {
      const flight = startAt(module, { alpha: 10, beta: 5, pitch, roll, rudder, p: 0.5, q: 0.1, r: -0.2 });
      check(flight, `at 10 and 5 degrees, stick ${pitch} and ${roll}, rudder ${rudder}`);
      flight.dispose();
    }
    // Clean: AFWAL's stores drag (a centreline tank and a missile) is not in the file. With it, Table 1's drag would be that much more.
    const clean = startAt(module, { alpha: 4, beta: 0 }), { state, measured } = snapshot(clean);
    const withStores = table1(state, CG_PERCENT_CHORD.value, { stores: true }).drag;
    assert.ok(Math.abs(withStores - measured.drag - constant('Delta_CD_STORES')) < 1e-9 && constant('Delta_CD_STORES') === 0.0037, `drag ${measured.drag}; with AFWAL's stores ${withStores}`);
    say(`clean: at 4 degrees the drag coefficient is ${measured.drag.toFixed(4)}; with AFWAL's centreline tank and missile it would be ${withStores.toFixed(4)}`);
    clean.dispose();
    // The grid is what its name says.
    const [up, down] = STABILATOR_TRAVEL.value;
    assert.ok([up, 0, down].every((x) => seen.stabilators.has(x)), 'the stabilator at 21 up, 0 and 9 down');
    assert.ok([-30, 0, 30].every((x) => seen.ailerons.has(x)) && [-30, 0, 30].every((x) => seen.rudders.has(x)), 'full aileron and rudder each way');
    assert.ok(seen.negative > 50 && seen.above45 > 50 && seen.above110 > 20 && seen.slipBeyond30 > 50 && seen.turning > 20 && seen.alphaDot > 0.1, JSON.stringify(seen));
    // All of it slower than Mach 0.3, where nothing of what Mach changes is in the airplane: read back, every factor 1 and every increment 0.
    assert.ok(seen.mach > 0.2 && seen.mach < 0.3, `the fastest state was at Mach ${seen.mach}`);
    const slow = startAt(module, { alpha: 4, beta: 0 });
    for (const term of [...aerodynamics.matchAll(/<function name="aero\/coefficient\/([a-z-]+)">/g)].map((m) => m[1]).filter((name) => !SIX.includes(name) && !name.endsWith('-mach') && !BEND_TERMS.includes(name))) {
      assert.equal(slow.get(`aero/factor/${term}`), 1, `aero/factor/${term} at Mach ${slow.get('velocities/mach')}`);
    }
    for (const name of ['lift', 'drag', 'pitch', 'yaw-roll-rate', 'yaw-aileron']) assert.equal(slow.get(`aero/increment/${name}`), 0, `aero/increment/${name} at Mach ${slow.get('velocities/mach')}`);
    slow.dispose();
    say(`${seen.states} states, all at Mach ${seen.mach.toFixed(2)} or less (${seen.negative} below zero angle of attack, ${seen.above45} above 45 degrees, ${seen.above110} above 110, ${seen.slipBeyond30} beyond 30 degrees of sideslip; the angle of attack changing at up to ${seen.alphaDot.toFixed(2)} rad/s): the largest difference from Table 1, each within 0.000001:`);
    for (const name of SIX) say(`  ${name}: ${worst[name].off.toExponential(2)}${worst[name].off ? ` (${worst[name].what}, where it is ${worst[name].value.toFixed(6)})` : ''}`);
  });

  test(`${variant}, f4c: the axes are AFWAL's: at 20 and 35 degrees of sideslip the aerodynamic force in the airplane's own axes is drag along the velocity's shadow on the plane of symmetry, lift at right angles to it, and side force along the y axis, within a millionth of the wing's load; JSBSim's wind axes would be thousands of pounds away`, async () => {
    const module = await moduleWith(F4C, variant);
    for (const [alpha, beta] of [[20, 20], [20, -35], [8, 35], [-5, -20]]) {
      const flight = startAt(module, { alpha, beta, pitch: 0.3, roll: 0.5, rudder: -0.5 });
      const { state, qbar, force } = snapshot(flight), c = table1(state, CG_PERCENT_CHORD.value);
      const [drag, side, lift] = [c.drag, c.side, c.lift].map((coefficient) => coefficient * qbar * S);
      const ca = Math.cos(alpha / DEG), sa = Math.sin(alpha / DEG), cb = Math.cos(beta / DEG), sb = Math.sin(beta / DEG);
      // AFWAL's: turned from the airplane's axes by the angle of attack alone.
      const afwal = [-drag * ca + lift * sa, side, -drag * sa - lift * ca];
      // Wind axes (JSBSim's LIFT, DRAG and SIDE): turned by the sideslip too (AFWAL's own equation 1, wind to body).
      const wind = [-drag * ca * cb - side * ca * sb + lift * sa, -drag * sb + side * cb, -drag * sa * cb - side * sa * sb - lift * ca];
      const off = (other) => Math.hypot(...force.map((f, i) => f - other[i]));
      say(`at ${alpha} degrees and ${beta} of sideslip: drag ${drag.toFixed(0)} lb, side force ${side.toFixed(0)}, lift ${lift.toFixed(0)}. JSBSim's force along the airplane's axes [${force.map((f) => f.toFixed(1)).join(', ')}] lb; AFWAL's axes give [${afwal.map((f) => f.toFixed(1)).join(', ')}] (${off(afwal).toExponential(1)} lb away); wind axes would give [${wind.map((f) => f.toFixed(1)).join(', ')}] (${off(wind).toFixed(0)} lb away)`);
      assert.ok(off(afwal) <= 1e-6 * qbar * S, 'AFWAL\'s axes');
      assert.ok(off(wind) > 1000, 'and the test can tell them from wind axes');
      flight.dispose();
    }
  });

  test(`${variant}, f4c: the reference centre: JSBSim's own move of the moments from 31% of the chord to the centre of gravity at 28.9% is AFWAL's two transfer terms, (Xcg - Xref)/100 (CL cos alpha + CD sin alpha) in pitch and (Xcg - Xref)/100 (c/b) Cy in yaw, within 0.000001; nothing is moved in roll`, async () => {
    const module = await moduleWith(F4C, variant);
    const probe = startAt(module, { alpha: 0, beta: 0 });
    // Read back where JSBSim has the two points: the centre of gravity as loaded, and the reference point.
    const cg = ['x', 'y', 'z'].map((axis) => probe.get(`inertia/cg-${axis}-in`)), point = ['x', 'y', 'z'].map((axis) => probe.get(`metrics/aero-rp-${axis}-in`));
    const behind = (point[0] - cg[0]) / 12 / CHORD * 100;
    say(`JSBSim has the centre of gravity at [${cg.join(', ')}] in and the reference point at [${point.join(', ')}] in: ${behind.toFixed(4)}% of the chord behind it; AFWAL's tables are about ${cite(AFWAL_REFERENCE_CENTRE)}, the F-4C's centre of gravity is at ${cite(CG_PERCENT_CHORD)}`);
    assert.ok(Math.abs(behind - (AFWAL_REFERENCE_CENTRE.value - CG_PERCENT_CHORD.value)) < 1e-6 && point[1] === cg[1] && point[2] === cg[2]);
    probe.dispose();
    let most = 0;
    for (const [alpha, beta, pitch] of [[4, 0, 0.1], [20, 10, 1], [60, -20, 0.5], [-8, 35, -1], [100, 5, 0]]) {
      const flight = startAt(module, { alpha, beta, pitch, roll: 0.5, rudder: 1, p: 0.3, q: 0.1, r: 0.1 });
      const { state, measured } = snapshot(flight), c = table1(state, CG_PERCENT_CHORD.value);
      // What JSBSim added to each moment about the reference centre, beside AFWAL's term.
      const moved = { pitch: measured.pitch - c.pitchAtReference, yaw: measured.yaw - c.yawAtReference, roll: measured.roll - c.roll };
      say(`at ${alpha} degrees and ${beta} of sideslip: in pitch JSBSim's move adds ${moved.pitch.toFixed(7)} and AFWAL's term is ${c.pitchShift.toFixed(7)}; in yaw ${moved.yaw.toFixed(7)} and ${c.yawShift.toFixed(7)}; in roll ${moved.roll.toExponential(1)} and none`);
      assert.ok(Math.abs(moved.pitch - c.pitchShift) <= 1e-6 && Math.abs(moved.yaw - c.yawShift) <= 1e-6 && Math.abs(moved.roll) <= 1e-6);
      most = Math.max(most, Math.abs(c.pitchShift));
      // With the centre of gravity where AFWAL's own airplane has it, 29.3%, the totals would not agree: the test can tell.
      const elsewhere = table1(state, dimension('Xcg'));
      if (Math.abs(c.lift) > 0.1) assert.ok(Math.abs(measured.pitch - elsewhere.pitch) > 1e-4, 'the test can tell 28.9% from 29.3%');
      flight.dispose();
    }
    assert.ok(most > 0.01, 'the transfer is not a small thing');
  });

  // ---- 3. Low-speed sanity: it trims, and it flies like an airplane ----

  test(`${variant}, f4c: the copilot's neutral trim is JSBSim's own for ${F4C.assists.trim.knots} knots (Wings' neutral speed), JSBSim has it from the start, and with the stick in the middle the airplane holds that speed`, async () => {
    // tests/assists.test.js holds the other aircraft to the same lines: the stored trim within 0.002 of JSBSim's
    // own; stick neutral for a minute, the speed within 3 knots, the height within 50 ft, the bank within 5 degrees.
    const { trim } = F4C.assists, module = await moduleWith(F4C, variant);
    assert.equal(trim.knots, WINGS_NEUTRAL_SPEED.value);
    // (Pull request 7 gave the copilot the rudder too: its feet.)
    assert.deepEqual(assistWrites(F4C.assists), ['fcs/pitch-trim-cmd-norm', 'fcs/rudder-cmd-norm', 'fcs/steer-cmd-norm'], 'the copilot writes the pitch trim, the rudder and the nosewheel steering, all cockpit controls');
    const parked = Flight.start(module, F4C, { settleSeconds: 0 });
    for (const [command, value] of trim.sets) {
      assert.ok(parked.startSets.some(([n, v]) => n === command && v === value), `${command} is in the start`);
      assert.equal(parked.get(command), value);
    }
    parked.dispose();
    const flight = inTheAir(module, { heightFt: trim.heightFt, knots: trim.knots });
    const stored = new Map(trim.sets), own = flight.trimmed.jsbsim;
    assert.ok(Math.abs(own.pitchTrim - stored.get('fcs/pitch-trim-cmd-norm')) <= 0.002, `pitch trim: JSBSim's ${own.pitchTrim}, stored ${stored.get('fcs/pitch-trim-cmd-norm')}`);
    assert.ok(Math.abs(own.rollStick) <= 0.002 && !stored.has('fcs/roll-trim-cmd-norm'), `no roll trim: JSBSim's roll stick is ${own.rollStick}`);
    // The stored trim with the stick in the middle: the copilot holds JSBSim's own (src/sim/game.js,
    // `airborneTrim`), so with the stick straight the stick makes up the difference, as the stored trim would.
    flight.fly({ pitch: F4C.controls.pitch.sign * (stored.get('fcs/pitch-trim-cmd-norm') - flight.trimmed.heldPitchTrim), roll: 0 });
    const seen = { slow: Infinity, fast: -Infinity, low: Infinity, high: -Infinity, bank: 0 };
    run(flight, 60, (t) => {
      // The copilot holds the trim the airborne start kept: JSBSim's own, within 0.002 of the stored one (above; src/sim/game.js, `airborneTrim`).
      if (t > 0) assert.equal(flight.get('fcs/pitch-trim-cmd-norm'), flight.trimmed.heldPitchTrim, `the pitch trim at ${t} s`);
      seen.slow = Math.min(seen.slow, knots(flight)); seen.fast = Math.max(seen.fast, knots(flight));
      seen.low = Math.min(seen.low, feet(flight)); seen.high = Math.max(seen.high, feet(flight));
      seen.bank = Math.max(seen.bank, Math.abs(bank(flight)));
    });
    say(`neutral trim: JSBSim's own pitch trim at ${trim.knots} kt and ${trim.heightFt} ft is ${own.pitchTrim.toFixed(4)} (the stabilator ${(own.pitchTrim * -STABILATOR_TRAVEL.value[0]).toFixed(2)} degrees), its roll stick ${own.rollStick.toFixed(6)}; stored ${stored.get('fcs/pitch-trim-cmd-norm')}; within 0.002. Stick in the middle for 60 s: ${seen.slow.toFixed(1)} to ${seen.fast.toFixed(1)} kt, ${seen.low.toFixed(0)} to ${seen.high.toFixed(0)} ft, bank up to ${seen.bank.toFixed(2)} degrees; Wings' neutral speed: ${cite(WINGS_NEUTRAL_SPEED)}`);
    assert.ok(seen.slow >= trim.knots - 3 && seen.fast <= trim.knots + 3, 'speed within 3 kt');
    assert.ok(seen.low >= trim.heightFt - 50 && seen.high <= trim.heightFt + 50, 'altitude within 50 ft');
    assert.ok(seen.bank <= 5, 'bank within 5 degrees');
    flight.dispose();
  });

  test(`${variant}, f4c: at 15,000 ft and 38,924 lb JSBSim's own trim finds level flight at 250, 300 and 400 knots, gear up: the angle of attack within 1.5 degrees of a hand calculation from AFWAL's basic lift, and the stabilator between 2 degrees trailing edge down and 10 up`, async () => {
    const module = await moduleWith(F4C, variant);
    for (const speed of SPEEDS) {
      const flight = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: speed });
      const alpha = flight.get('aero/alpha-deg'), stabilator = flight.get('fcs/elevator-pos-deg'), qbar = flight.get('aero/qbar-psf');
      // By hand: the angle of attack at which AFWAL's basic lift alone carries the weight, CLBAS(alpha) = W / (q S).
      const needed = WEIGHT.value / (qbar * S), byHand = angleForLift(needed);
      say(`level at ${speed} kt and ${AFWAL_REFERENCE_HEIGHT.value} ft (Mach ${flight.value('velocities/mach').toFixed(2)}, ${qbar.toFixed(0)} lb/sq ft): angle of attack ${alpha.toFixed(2)} degrees; by hand ${byHand.toFixed(2)} (the lift coefficient that carries ${WEIGHT.value} lb is ${needed.toFixed(3)}); within 1.5. Stabilator ${stabilator.toFixed(2)} degrees (trailing edge down positive); between +2 and -10. Throttle ${(flight.trimmed.throttle / F4C.mil * 100).toFixed(0)}% of the way to MIL, ${(flight.get('propulsion/engine[0]/thrust-lbs') * 2).toFixed(0)} lb of thrust`);
      assert.ok(Math.abs(alpha - byHand) <= 1.5, `${speed} kt: angle of attack ${alpha}, by hand ${byHand}`);
      assert.ok(stabilator <= 2 && stabilator >= -10, `${speed} kt: stabilator ${stabilator}`);
      flight.dispose();
    }
  });

  test(`${variant}, f4c: started 10% off the trim speed at 250, 300 and 400 knots with the controls fixed, the speed and the height stay bounded for 60 s (within 15% of the trim speed; within one and a half full swings, 3 V dV / g, of the height)`, async () => {
    const module = await moduleWith(F4C, variant);
    for (const speed of SPEEDS) {
      const level = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: speed });
      const hold = { ...level.trimmed }, trueFps = level.value('velocities/vtrue-kts') * KT;
      level.dispose();
      const heightLine = LINES.heightSwings * 2 * trueFps * (0.1 * trueFps) / G;
      for (const share of [1.1, 0.9]) {
        const flight = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: speed * share });
        // The stick that puts the stabilator where the level flight had it: this flight's copilot holds the trim
        // its own start found (src/sim/game.js, `airborneTrim`), and with the stick straight, stick and trim add.
        flight.fly({ throttle: hold.throttle, pitch: hold.pitch + F4C.controls.pitch.sign * (hold.heldPitchTrim - flight.trimmed.heldPitchTrim), roll: hold.roll });
        const from = feet(flight), speeds = [];
        const seen = { slow: Infinity, fast: -Infinity, low: Infinity, high: -Infinity };
        // Five minutes: the first minute is judged, the rest is for the swing's period, which is only reported.
        run(flight, 300, (t) => {
          if (t <= 60) {
            seen.slow = Math.min(seen.slow, knots(flight)); seen.fast = Math.max(seen.fast, knots(flight));
            seen.low = Math.min(seen.low, feet(flight) - from); seen.high = Math.max(seen.high, feet(flight) - from);
          }
          speeds.push({ t, x: knots(flight) });
        });
        const turns = turningPoints(speeds, 0.5), swings = swingsOf(speeds[0], turns);
        const period = turns.length >= 3 ? (2 * (turns.at(-1).t - turns[0].t)) / (turns.length - 1) : NaN;
        say(`trimmed for ${speed} kt, started at ${(speed * share).toFixed(0)}, controls fixed: in 60 s the speed goes ${seen.slow.toFixed(1)} to ${seen.fast.toFixed(1)} kt (line: within ${(LINES.speedShare * 100).toFixed(0)}%, ${(speed * (1 - LINES.speedShare)).toFixed(1)} to ${(speed * (1 + LINES.speedShare)).toFixed(1)}) and the height ${seen.low.toFixed(0)} to ${seen.high.toFixed(0)} ft from the start (line: ${heightLine.toFixed(0)}).` +
          ` Reported: the slow swing takes ${period.toFixed(0)} s (a textbook's rule for it, pi sqrt 2 V / g: ${(Math.PI * Math.SQRT2 * trueFps / G).toFixed(0)} s), each swing ${(mean(ratios(swings)) * 100).toFixed(0)}% of the one before; after five minutes it is at ${knots(flight).toFixed(1)} kt, banked ${bank(flight).toFixed(1)} degrees`);
        assert.ok(seen.slow >= speed * (1 - LINES.speedShare) && seen.fast <= speed * (1 + LINES.speedShare), `${speed} kt from ${share}: speed`);
        assert.ok(Math.max(-seen.low, seen.high) <= heightLine, `${speed} kt from ${share}: height`);
        flight.dispose();
      }
    }
  });

  test(`${variant}, f4c: one degree of stabilator for half a second at 250, 300 and 400 knots gives a damped pitch swing: each swing of the pitch rate smaller than the one before, and under 5% of its peak left 10 s after`, async () => {
    const module = await moduleWith(F4C, variant);
    for (const speed of SPEEDS) {
      const flight = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: speed });
      const hold = { ...flight.trimmed }, stabilator = flight.get('fcs/elevator-pos-deg'), steady = flight.value('velocities/q-rad_sec');
      const after = [];
      let peak = 0, moved = 0;
      run(flight, 16, (t) => {
        const pulse = t >= 1 && t < 1.5;
        // The reading is of the step before: the surface follows the stick in the same step.
        if (t > 1 + DT && t < 1.5) moved = flight.get('fcs/elevator-pos-deg') - stabilator;
        const rate = (flight.value('velocities/q-rad_sec') - steady) * DEG;
        peak = Math.max(peak, Math.abs(rate));
        if (t >= 1.5) after.push({ t: t - 1.5, x: rate });
        // One degree more trailing edge up: the stick back by a 21st of its travel.
        flight.fly({ pitch: hold.pitch + (pulse ? 1 / -STABILATOR_TRAVEL.value[0] : 0) });
      });
      assert.ok(Math.abs(moved + 1) < 1e-6, `the stabilator moved ${moved} degrees`);
      const turns = turningPoints(after, 0.02 * peak), swings = swingsOf(after[0], turns);
      const period = turns.length >= 3 ? turns[2].t - turns[0].t : turns.length === 2 ? 2 * (turns[1].t - turns[0].t) : NaN;
      const left = turns.length >= 3 ? Math.abs(turns[2].x / turns[0].x) : NaN, at10 = Math.abs(after.find((sample) => sample.t >= 10).x);
      say(`at ${speed} kt, 1 degree of stabilator (trailing edge up) for 0.5 s: the pitch rate reaches ${peak.toFixed(2)} deg/s and then swings ${turns.map((turn) => `${turn.x.toFixed(2)} at ${turn.t.toFixed(2)} s`).join(', ')} after the pulse: a swing takes ${period.toFixed(2)} s, and ${(left * 100).toFixed(0)}% is left one swing later; 10 s after, ${at10.toFixed(3)} deg/s (${(at10 / peak * 100).toFixed(1)}% of the peak; line: under ${LINES.pitchLeftAt10s * 100}%)`);
      assert.ok(swings.length >= 2 && swings.every((swing, i) => i === 0 || swing < swings[i - 1]), `${speed} kt: each swing smaller than the one before (${swings.map((swing) => swing.toFixed(3)).join(', ')})`);
      assert.ok(at10 <= LINES.pitchLeftAt10s * peak, `${speed} kt: ${at10} deg/s left after 10 s of ${peak}`);
      flight.dispose();
    }
  });

  test(`${variant}, f4c: a rudder kick at 300 knots gives a Dutch roll that dies away: each of the first four swings of the sideslip smaller than the one before, and under a quarter of the first left 15 s after`, async () => {
    const module = await moduleWith(F4C, variant);
    // The game has no rudder control: the kick is a test's own "feet", so that it goes in through the input
    // array like everything else. Ten degrees (a third of the travel) for half a second.
    let clock = 0;
    const kick = { ...F4C.assists, feet: { to: 'fcs/rudder-cmd-norm', sign: 1, law: () => (clock >= 1 && clock < 1.5 ? 1 / 3 : 0) } };
    const flight = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: 300 }, { assists: kick });
    const after = [];
    let rudder = 0;
    run(flight, 31.5, (t) => {
      clock = t;
      rudder = Math.max(rudder, Math.abs(flight.get('fcs/rudder-pos-deg')));
      if (t >= 1.5) after.push({ t: t - 1.5, x: slip(flight) });   // the seven controls stay where the trim left them
    });
    assert.ok(Math.abs(rudder - RUDDER_TRAVEL.value / 3) < 1e-9, `the rudder went to ${rudder} degrees`);
    const most = Math.max(...after.map((sample) => Math.abs(sample.x)));
    const turns = turningPoints(after, 0.02 * most), swings = swingsOf(null, turns);
    const first = turns.slice(0, 5), period = (2 * (first.at(-1).t - first[0].t)) / (first.length - 1);
    // From the share of a swing that is left half a period later, the damping ratio of a textbook's second-order motion.
    const share = mean(ratios(swings.slice(0, LINES.slipSwings))), damping = -Math.log(share) / Math.hypot(Math.PI, Math.log(share));
    const late = turns.map((turn, i) => ({ start: turn.t, size: swings[i] })).filter((swing) => swing.size !== undefined && swing.start > LINES.slipLateSeconds);
    say(`at 300 kt, 10 degrees of rudder for 0.5 s, controls fixed: the sideslip swings to ${turns.slice(0, 5).map((turn) => turn.x.toFixed(2)).join(', ')} degrees: a swing takes ${period.toFixed(2)} s, each half swing is ${(share * 100).toFixed(0)}% of the one before (damping ratio ${damping.toFixed(2)}; half of it gone in ${(Math.LN2 / (damping * 2 * Math.PI / period / Math.sqrt(1 - damping ** 2))).toFixed(1)} s);` +
      ` the first swing is ${swings[0].toFixed(2)} degrees and the largest starting later than ${LINES.slipLateSeconds} s after the kick is ${late.length ? Math.max(...late.map((swing) => swing.size)).toFixed(2) : 'none to be found'} (line: under ${(LINES.slipLateShare * swings[0]).toFixed(2)}); the bank goes to ${bank(flight).toFixed(1)} degrees by the end`);
    assert.ok(swings.length >= LINES.slipSwings && swings.slice(0, LINES.slipSwings).every((swing, i) => i === 0 || swing < swings[i - 1]), `each of the first four swings smaller than the one before (${swings.slice(0, 5).map((swing) => swing.toFixed(3)).join(', ')})`);
    assert.ok(late.every((swing) => swing.size < LINES.slipLateShare * swings[0]), 'it has died away');
    flight.dispose();
  });

  test(`${variant}, f4c: full aileron at 300 knots rolls the right way: the roll rate is toward the stick from a quarter of a second on, and the bank follows`, async () => {
    const module = await moduleWith(F4C, variant);
    // Wings' way of measuring (its checkride, "GRADED: roll rate"): full stick from trimmed level flight, the
    // pitch stick held; the steady rate is the average from 1.5 to 3 s in.
    const roll = (speed, heightFt, stick) => {
      const flight = inTheAir(module, { heightFt, knots: speed });
      const out = { least: Infinity, slip: 0, sum: 0, n: 0, bankAtHalfSecond: 0, alpha: 0, trueKt: flight.value('velocities/vtrue-kts') };
      run(flight, 3, (t) => {
        const rate = stick * flight.value('velocities/p-rad_sec') * DEG;
        if (t >= 0.25) out.least = Math.min(out.least, rate);
        if (t >= 1.5) { out.sum += rate; out.n++; }
        if (Math.abs(t - 0.5) < DT / 2) out.bankAtHalfSecond = stick * bank(flight);
        out.slip = Math.max(out.slip, Math.abs(slip(flight)));
        out.alpha = Math.max(out.alpha, flight.value('aero/alpha-rad') * DEG);
        flight.fly({ roll: stick });
      });
      flight.dispose();
      return { ...out, rate: out.sum / out.n };
    };
    for (const stick of [1, -1]) {
      const r = roll(300, AFWAL_REFERENCE_HEIGHT.value, stick);
      say(`at 300 kt and ${AFWAL_REFERENCE_HEIGHT.value} ft, full ${stick > 0 ? 'right' : 'left'} stick: ${r.bankAtHalfSecond.toFixed(1)} degrees of bank that way after half a second; the roll rate never under ${r.least.toFixed(0)} deg/s that way from 0.25 s on; steady (1.5 to 3 s) ${r.rate.toFixed(0)} deg/s; sideslip up to ${r.slip.toFixed(1)} degrees, angle of attack up to ${r.alpha.toFixed(1)}`);
      assert.ok(r.least > 0 && r.bankAtHalfSecond > 0, `full ${stick > 0 ? 'right' : 'left'} stick rolls that way`);
    }
    // Reported beside Wings' figures, like for like: low down, where true and indicated speed are the same.
    // (At sea level itself JSBSim's trim fails: it is on the ground.)
    for (const [speed, wings] of [[250, WINGS_ROLL_RATE_250], [400, WINGS_ROLL_RATE_400]]) {
      const r = roll(speed, 1000, 1);
      say(`reported: at ${speed} kt and 1,000 ft (${r.trueKt.toFixed(0)} kt true), full right stick: steady roll rate ${r.rate.toFixed(0)} deg/s, sideslip up to ${r.slip.toFixed(1)} degrees, angle of attack up to ${r.alpha.toFixed(1)}; Wings at sea level: ${cite(wings)}`);
    }
  });
}

// ---- 4. The edge, reported only ----

test('f4c, reported (no pass or fail; pull request 10 judges it): slowing a knot a second at idle with the ailerons neutral, the speed and the nose\'s height as the angle of attack passes 22 degrees, and the next 10 s with the stick held', async () => {
  const module = await moduleWith(F4C, 'weh'), say = (line) => report.line(`  ${line}`);
  say(`AFWAL on the real airplane (the F-4E's stall tests): wing rock at ${cite(WING_ROCK_ALPHA)}; the nose slice at ${cite(NOSE_SLICE_ALPHA)}`);
  // `tap` is a touch of rudder, in degrees for half a second, as the angle of attack passes 19 degrees: with
  // none, a simulated airplane that is the same left and right has nothing to start a wing rock with.
  for (const tap of [0, 2]) {
    let clock = 0, tapAt = Infinity;
    const tapper = { to: 'fcs/rudder-cmd-norm', sign: 1, law: () => (clock >= tapAt && clock < tapAt + 0.5 ? tap / RUDDER_TRAVEL.value : 0) };
    const flight = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: 220 }, { assists: { ...F4C.assists, feet: tapper } });
    const from = knots(flight);
    // The test's pilot: idle, ailerons neutral, and a pitch attitude chosen to lose a knot a second (the nose
    // up if the speed is above the plan), held with the stick.
    let stick = flight.trimmed.pitch, trimmer = stick, nose = pitch(flight), passed = null, held = null;
    run(flight, 200, (t) => {
      clock = t;
      const speed = knots(flight), alpha = flight.value('aero/alpha-rad') * DEG;
      if (!passed) {
        const plan = from - t;
        nose = clamp(nose + 0.25 * (speed - plan) * DT, -15, 25);
        const aim = clamp(nose + (speed - plan), -15, 25);
        trimmer = clamp(trimmer + 0.02 * (aim - pitch(flight)) * DT, -1, 1);
        stick = clamp(trimmer + 0.03 * (aim - pitch(flight)) - 0.02 * flight.value('velocities/q-rad_sec') * DEG, -1, 1);
        if (tap && tapAt === Infinity && alpha >= WING_ROCK_ALPHA.value[0]) tapAt = t;
        if (alpha >= NOSE_SLICE_ALPHA.value[0]) {
          passed = { t, speed, plan, nose: pitch(flight), sink: flight.value('velocities/v-down-fps') * 60, height: feet(flight), stabilator: flight.get('fcs/elevator-pos-deg'), bank: bank(flight), slip: slip(flight) };
          held = { alpha: [alpha, alpha], bank: [bank(flight), bank(flight)], slip: [slip(flight), slip(flight)], nose: [passed.nose, passed.nose], yaw: 0, roll: 0 };
        }
      } else {
        const widen = (range, x) => { range[0] = Math.min(range[0], x); range[1] = Math.max(range[1], x); };
        widen(held.alpha, alpha); widen(held.bank, bank(flight)); widen(held.slip, slip(flight)); widen(held.nose, pitch(flight));
        held.yaw = Math.max(held.yaw, Math.abs(flight.value('velocities/r-rad_sec')) * DEG);
        held.roll = Math.max(held.roll, Math.abs(flight.value('velocities/p-rad_sec')) * DEG);
        if (t >= passed.t + 10) { held.end = { speed, height: feet(flight), sink: flight.value('velocities/v-down-fps') * 60 }; return false; }
      }
      flight.fly({ throttle: 0, roll: 0, pitch: stick });
      return true;
    });
    const range = ([low, high], digits = 1) => `${low.toFixed(digits)} to ${high.toFixed(digits)}`;
    say(`${tap ? `with ${tap} degrees of rudder for half a second as it passes ${WING_ROCK_ALPHA.value[0]} degrees` : 'with nothing to disturb it'}: after ${passed.t.toFixed(0)} s the angle of attack passes ${NOSE_SLICE_ALPHA.value[0]} degrees at ${passed.speed.toFixed(1)} kt (the plan was ${passed.plan.toFixed(0)}), the nose ${passed.nose.toFixed(1)} degrees above the horizon, sinking ${passed.sink.toFixed(0)} ft/min at ${passed.height.toFixed(0)} ft, stabilator ${passed.stabilator.toFixed(1)} degrees, bank ${passed.bank.toFixed(1)}, sideslip ${passed.slip.toFixed(1)}.` +
      ` The next 10 s, stick held: angle of attack ${range(held.alpha)} degrees, nose ${range(held.nose)}, bank ${range(held.bank)}, sideslip ${range(held.slip)}, roll rate up to ${held.roll.toFixed(0)} deg/s and yaw rate up to ${held.yaw.toFixed(1)}; it ends at ${held.end.speed.toFixed(1)} kt, ${(passed.height - held.end.height).toFixed(0)} ft lower, sinking ${held.end.sink.toFixed(0)} ft/min`);
    flight.dispose();
  }
});

// ---- 5. A two-minute flight's tape, in native JSBSim ----

test('f4c: "A two-minute flight\'s tape replays in native JSBSim by milestone 1\'s lines"', async () => {
  // A flight trimmed into the air cannot be a tape (the trim is not on it). So a twin is trimmed first, and
  // the taped flight starts where the twin stood, by values in its start alone: the height, the speed, the
  // angle of attack with the nose up by as much, the engines' speed, and the twin's throttle and stick.
  const modules = {}, tapes = {};
  let seen;
  for (const variant of VARIANTS) {
    const module = modules[variant] = await moduleWith(F4C, variant);
    const twin = inTheAir(module, { heightFt: AFWAL_REFERENCE_HEIGHT.value, knots: 300 });
    const hold = { ...twin.trimmed }, alpha = twin.get('aero/alpha-deg'), turning = twin.get('propulsion/engine[0]/n2');
    twin.dispose();
    // The copilot holds the trim the twin's start kept (src/sim/game.js, `airborneTrim`).
    const assists = { ...F4C.assists, trim: { ...F4C.assists.trim, sets: [['fcs/pitch-trim-cmd-norm', hold.heldPitchTrim]] } };
    const flight = Flight.start(module, F4C, {
      record: true, settleSeconds: 0, assists, controls: { gear: false, flaps: false, brake: false, throttle: hold.throttle, pitch: hold.pitch, roll: hold.roll },
      // The speed before the angle of attack: with no speed JSBSim has no flight path to raise the nose from.
      sets: [['ic/h-sl-ft', AFWAL_REFERENCE_HEIGHT.value], ['ic/vc-kts', 300], ['ic/alpha-deg', alpha], ['propulsion/engine[0]/n2', turning], ['propulsion/engine[1]/n2', turning], ...STRAIGHT],
    });
    // Read back: it starts where the twin stood, level and steady.
    assert.ok(Math.abs(knots(flight) - 300) < 0.01 && Math.abs(feet(flight) - AFWAL_REFERENCE_HEIGHT.value) < 0.01 && Math.abs(flight.get('aero/alpha-deg') - alpha) < 1e-9, `${knots(flight)} kt at ${feet(flight)} ft`);
    assert.ok(Math.abs(flight.value('velocities/v-down-fps')) < 1e-6 && Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && Math.abs(flight.get('accelerations/qdot-rad_sec2')) < 1e-3 && Math.abs(flight.get('accelerations/udot-ft_sec2')) < 0.01, 'level and steady');
    // Two minutes of an ordinary flight: a pitch pulse; a turn each way at 45 degrees of bank, holding the
    // height; MIL power; a pull; idle; the gear down.
    seen = { alpha: [Infinity, -Infinity], bank: [Infinity, -Infinity], height: [Infinity, -Infinity], speed: [Infinity, -Infinity], g: [Infinity, -Infinity] };
    const widen = (range, x) => { range[0] = Math.min(range[0], x); range[1] = Math.max(range[1], x); };
    run(flight, 120, (t) => {
      const target = t < 10 ? 0 : t < 40 ? 45 : t < 70 ? -45 : 0;
      const roll = clamp(hold.roll + 4 * (target - bank(flight)) / DEG - 0.8 * flight.value('velocities/p-rad_sec'), -1, 1);
      const height = t >= 10 && t < 100 ? clamp(0.0004 * (AFWAL_REFERENCE_HEIGHT.value - feet(flight)) + 0.003 * flight.value('velocities/v-down-fps'), -0.1, 0.1) : 0;
      const pulse = t >= 5 && t < 5.5 ? 1 / 21 : 0, pull = t >= 100 && t < 104 ? 0.05 : 0;
      flight.fly({ roll, pitch: hold.pitch + height + pulse + pull, throttle: t >= 80 && t < 100 ? F4C.mil : t >= 110 ? 0 : hold.throttle, gear: t >= 112 });
      widen(seen.alpha, flight.value('aero/alpha-rad') * DEG); widen(seen.bank, bank(flight)); widen(seen.height, feet(flight)); widen(seen.speed, knots(flight)); widen(seen.g, flight.value('accelerations/Nz'));
    });
    // Read back that it was the flight described: it turned both ways, and the gear came down.
    assert.ok(seen.bank[0] < -40 && seen.bank[1] > 40 && flight.value('gear/gear-pos-norm') === 1 && seen.alpha[1] < 15, JSON.stringify(seen));
    tapes[variant] = flight.tape();
    flight.dispose();
  }
  const tape = tapes.weh, range = ([low, high], digits = 0) => `${low.toFixed(digits)} to ${high.toFixed(digits)}`;
  assert.equal(tape.steps, Math.round(120 / DT));
  assert.equal(tape.own, true, 'the tape says the aircraft is FSG\'s own');
  report.line(`f4c: a ${tape.steps}-step tape (two minutes from level flight at 300 kt and 15,000 ft: a pitch pulse, a turn each way, MIL, a pull, idle, gear down; speed ${range(seen.speed)} kt, height ${range(seen.height)} ft, bank ${range(seen.bank)} degrees, angle of attack ${range(seen.alpha, 1)}, ${range(seen.g, 2)} g), ${tape.ins.length} inputs a step, ${tape.sets.length} values in the start`);

  // 1. The tape is the whole truth: flown again by the C++ runner inside the same build, the same flight bit for bit.
  for (const variant of VARIANTS) {
    const again = flyWasm(modules[variant], tapes[variant], `f4c-air-${variant}-again`);
    const same = bitEqual(tapes[variant].states, again);
    report.line(`  ${variant}: flown again from its tape by the C++ runner: ${same.equal ? `identical, ${again.rows} rows of ${again.columns.length} numbers` : `DIFFERENT (${same.reason})`}`);
    assert.ok(same.equal, same.reason);
  }
  assert.ok(bitEqual(tapes.weh.states, tapes.jseh.states).equal, 'both builds recorded the same flight');

  // 2. Matching native, by milestone 1's lines (tests/tape.test.js): the whole flight within altitude 1 ft,
  // angles 0.05 rad and speed 1 knot, or 3 times native's own spread where that is larger; and the first
  // second by FDM's tighter line.
  const { native, ensemble } = flyNative(tape, 'f4c-air');
  const last = native.rows - 1, numberAt = (name) => native.data[last * native.columns.length + native.columns.indexOf(name)];
  assert.ok(Math.abs(numberAt('position/h-sl-ft') - tape.states.data[tape.steps * tape.states.columns.length + tape.states.columns.indexOf('position/h-sl-ft')]) < 1, 'native JSBSim flew the F-4C to the same place');
  for (const variant of VARIANTS) {
    const wasm = flyWasm(modules[variant], tape, `f4c-air-${variant}-judged`, JUDGED);
    const whole = classB(native, wasm, ensemble);
    report.line(`  ${variant} against native, the whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const c of whole.columns) report.line(`    ${c.column}: largest difference ${fmt(c.maxAbs)}; allowed ${fmt(c.allowed)} (line ${fmt(c.cap)}, native's own spread ${fmt(c.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole-flight line`);
    const rows = Math.round(1 / DT) + 1;
    const first = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
    report.line(`  ${variant} against native, first second: ${describeN(first)}`);
    assert.ok(first.pass, `${variant}: the first-second line`);
  }
});
