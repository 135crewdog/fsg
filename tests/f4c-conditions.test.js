// The F-4C across its Mach range, at NASA CR-2144's nine clean flight conditions: the second half of the
// plan's pull request 5 (docs/milestones/3.md, "PR 5. How it flies, clean"). Each test that holds a line of
// the plan is named for the line, in the plan's words. The first half is tests/f4c-aero.test.js.
//
// What Mach changes is in the aircraft file as 22 tables (aircraft/f4c/f4c.xml, "What Mach changes"), worked
// out by tools/f4c-mach.mjs from the two records of data in aircraft/f4c/data/. This file:
//   1. holds the reference numbers to CR-2144's record, and the aircraft file's Mach tables to the tool's
//      arithmetic, cell for cell;
//   2. holds the six totals JSBSim works out, at a grid of Mach numbers, heights and states, to AFWAL's
//      Table 1 with those tables in it, worked out in JavaScript;
//   3. flies the airplane at each of CR-2144's nine conditions, trimmed at its Mach number and height, and
//      lays its trim and its responses beside CR-2144's own: the plan's lines;
//   4. reports, with no pass or fail, the slow motions, the drag and the thrust;
//   5. flies a two-minute tape at one of the conditions again in native JSBSim.
//
// What this is not (the plan's words): "an independent proof at CR-2144's conditions. The file is built from
// those numbers, so matching them shows it was built right."
//
// The inputs, chosen before anything was flown against CR-2144's tables, small so that the airplane stays
// where CR-2144's straight-line model of it holds:
//   stabilator   a quarter of a degree trailing edge down (a push) for one second. A push, because condition
//                5 trims at 9.4 degrees of angle of attack and AFWAL's tables turn a corner at 10.
//   rudder       one degree for one second
//   aileron      a step of one degree (with its spoiler)
//   the pull     a twentieth of a g more and a twentieth less, and the stabilator between the two
// "The time to die to half" is the free motion's, after the control is back (tests/checkride/linear.js).
//
// The stepping rule. Flown on JSBSim v1.3.3's default way of stepping a rotation (rectangular Euler, the
// simplest there is), six of the plan's lines were not met, all of them "the time to die to half within 25%":
// the pitch swing at conditions 8, 9 and 10 (34% to 45% slow) and the Dutch roll at 6, 7 and 8 (25.2% to
// 25.3% slow). That rule takes a little damping off every swing, in proportion to how fast it swings, and
// the F-4C's quick motions without its stability augmentation have very little damping to lose. The cause
// was not in the aircraft file, so the lines were not touched and the cause was fixed: the F-4C's settings
// (src/sim/aircraft/f4c.js, `stepping`) tell JSBSim to step rotations by its own second-order rule, and all
// nine conditions meet every line, most within 2%. The last-but-one test here flies the six pulses on
// JSBSim's default again and prints what it gave: the written reason for the departure.
//
// Every measured number is printed beside its reference and kept in
// jsbsim/build/results/checkride-f4c-conditions.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { Fdm } from '../src/sim/core.js';
import { DT, Flight } from '../src/sim/game.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace } from '../jsbsim/tests/lib/scenario.js';
import { FACTORS, FADE_MACH, HEIGHTS, INCREMENTS, LEVELS, LEVEL_FADE_MACH, LEVEL_HEIGHTS, PLOTTED, PLOTTED_MACHS, SHARED, UNCHANGED, asXml, conditions, inFile, lookup, machTables, plottedDerivative, valuesAt } from '../tools/f4c-mach.mjs';
import { GROUND, STRAIGHT, atCondition as atConditionOf, pitchRate, respond, rollRate, rudderFeet, startNear, stateOf, steadyPull, yawRate } from './checkride/conditions.js';
import { moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';
import { exponential, factorsOf, measures, polynomial, respond as respondLinear, transferFunction, turningPoints, measuresBeside } from './checkride/linear.js';
import { SIX, snapshot, startAt, table1 } from './checkride/table1.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

/**
 * Every flight in this file is pull request 5's airplane: the stick and the rudder straight to the surfaces,
 * as CR-2144's tables IV-4, IV-14 and IV-15 assume (the aircraft file's test switch; pull request 6 gave the
 * file its real flight controls, which tests/f4c-fcs.test.js flies).
 */
const atCondition = (module, c, options = {}) => atConditionOf(module, c, { ...options, sets: [...STRAIGHT, ...(options.sets ?? [])] });

const { WING_AREA, CG_PERCENT_CHORD, CONDITION_MACH, CONDITION_HEIGHT, CONDITION_TRIM_ALPHA, CONDITION_TRIM_STABILATOR, CONDITION_DRAG, CONDITION_STABILATOR_PER_G,
  CONDITION_PITCH_DAMPING, CONDITION_PITCH_FREQUENCY, CONDITION_DUTCH_ROLL_DAMPING, CONDITION_DUTCH_ROLL_FREQUENCY, CONDITION_SPIRAL_ROOT, TUCK_SECONDS_TO_DOUBLE } = REFERENCE;
const DEG = 180 / Math.PI, S = WING_AREA.value;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const percent = (ours, theirs) => `${ours / theirs >= 1 ? '+' : ''}${((ours / theirs - 1) * 100).toFixed(1)}%`;
const within = (ours, theirs, share) => Math.abs(ours / theirs - 1) <= share;

/** The record of CR-2144, and its nine clean conditions as the tool reads them. */
const CR = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/cr2144-f4c.json', import.meta.url)));
const NINE = conditions();
const nameOf = (c) => `condition ${c.fc} (Mach ${c.mach} at ${c.heightFt ? `${c.heightFt.toLocaleString('en-US')} ft` : 'sea level'})`;
const cell = (table, label, fc) => CR.tables[table].rows.find((row) => row.label.trim() === label).values[fc - 1];

/** The inputs (see the top of this file). */
const PUSH = { degrees: 0.25, seconds: 1, record: 20 }, KICK = { degrees: 1, seconds: 1, record: 30 }, STEP = { degrees: 1, record: 2.5 }, PULL_G = 0.05;
const pulse = ({ degrees, seconds }) => (t) => (t < seconds ? degrees : 0);

const report = new Report('checkride-f4c-conditions');
test.after(() => report.save());

// ---- 1. The records, the reference numbers and the aircraft file agree ----

test('f4c: CR-2144\'s numbers in the reference file are the record\'s, condition by condition', () => {
  assert.deepEqual(NINE.map((c) => c.fc), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(NINE.map((c) => c.mach), CONDITION_MACH.value);
  assert.deepEqual(NINE.map((c) => c.heightFt), CONDITION_HEIGHT.value);
  assert.deepEqual(NINE.map((c) => c.alpha), CONDITION_TRIM_ALPHA.value);
  // The two read from plots: the record's curve at the condition's Mach number, to the plot's last figure.
  assert.deepEqual(NINE.map((c) => Number(c.stabilator.toFixed(2))), CONDITION_TRIM_STABILATOR.value);
  assert.deepEqual(NINE.map((c) => Number(c.drag.toFixed(4))), CONDITION_DRAG.value);
  for (const [reference, table, label] of [[CONDITION_STABILATOR_PER_G, 'IV-12', 'DE/G (DEG/G)'], [CONDITION_PITCH_DAMPING, 'IV-4', 'Z(DET)2'], [CONDITION_PITCH_FREQUENCY, 'IV-4', 'W(DET)2'],
    [CONDITION_DUTCH_ROLL_DAMPING, 'IV-14', 'Z(DET)1'], [CONDITION_DUTCH_ROLL_FREQUENCY, 'IV-14', 'W(DET)1'], [CONDITION_SPIRAL_ROOT, 'IV-14', '1/T(DET)1']]) {
    assert.deepEqual(NINE.map((c) => cell(table, label, c.fc)), reference.value, `${table} ${label}`);
  }
  assert.deepEqual([2, 4, 6].map((fc) => cell('IV-12', 'PHUGOID(2) (SEC) ( TUCK(2) )', fc)), TUCK_SECONDS_TO_DOUBLE.value);
  // The rudder's table with the augmentation off is IV-15: the plan says "table IV-14's", which is the aileron's.
  assert.match(CR.tables['IV-15'].title, /RUDDER TRANSFER FUNCTION FACTORS {2}SAS Off/);
  assert.match(CR.tables['IV-14'].title, /AILERON TRANSFER FUNCTION FACTORS {2}SAS Off/);
  assert.match(CR.tables['IV-4'].title, /STABILIZER TRANSFER FUNCTION FACTORS {2}SAS Off - Bobweight Loop Open/);
  report.line(`f4c: ${NINE.length} conditions; the reference file's ${Object.keys(REFERENCE).filter((name) => name.startsWith('CONDITION_')).length} lists of them are the record's`);
});

test('f4c: every table of what Mach changes in the aircraft file is what tools/f4c-mach.mjs works out from the two records, cell for cell: 15 factors and 2 increments through CR-2144\'s nine conditions, the roll power and the roll damping along its plots by height through the nine, and the three levels along its plots', () => {
  const tables = machTables(), { tables: inTheFile } = inFile();
  assert.deepEqual(Object.keys(tables), [...FACTORS.map((name) => `aero/factor/${name}`), ...INCREMENTS.map((name) => `aero/increment/${name}`), ...LEVELS.map((name) => `aero/increment/${name}`)]);
  // Cell for cell: each table read out of the file as numbers.
  const found = [...inTheFile.matchAll(/<function name="([^"]+)">\s*<table>([^]*?)<\/table>\s*<\/function>/g)];
  assert.deepEqual(found.map(([, name]) => name), Object.keys(tables));
  let cells = 0;
  for (const [, name, body] of found) {
    const lookups = [...body.matchAll(/<independentVar lookup="(\w+)">\s*(\S+)\s*<\/independentVar>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(lookups, [['row', 'velocities/mach'], ['column', 'position/h-sl-ft']], `${name}: read at the Mach number and the height`);
    const rows = body.match(/<tableData>([^]*?)<\/tableData>/)[1].trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
    assert.ok(rows.flat().every(Number.isFinite), `${name}: every cell is a number`);
    assert.deepEqual(rows[0], tables[name].columns, `${name}: the heights`);
    assert.deepEqual(rows.slice(1), tables[name].rows, `${name}: the rows`);
    cells += tables[name].rows.length * tables[name].columns.length;
  }
  // And to the letter: the file's text between its two marks is the tool's.
  assert.equal(inTheFile, asXml(tables), 'node tools/f4c-mach.mjs --write would change nothing');

  // What the tables are. The factors and the two yaw increments: Mach 0.5, then CR-2144's eight Mach numbers;
  // 15,000 and 35,000 ft; the first row 1 (or 0); one condition in both columns but at Mach 0.9.
  const machs = [...new Set(CONDITION_MACH.value)].sort((a, b) => a - b);
  for (const name of [...FACTORS.filter((n) => !PLOTTED[n]).map((n) => `aero/factor/${n}`), ...INCREMENTS.map((n) => `aero/increment/${n}`)]) {
    const { columns, rows } = tables[name], at = name.startsWith('aero/factor') ? 1 : 0;
    assert.deepEqual(columns, HEIGHTS);
    assert.deepEqual(rows.map((row) => row[0]), [FADE_MACH, ...machs], `${name}: its Mach numbers`);
    assert.deepEqual(rows[0], [FADE_MACH, at, at], `${name}: ${at} at Mach ${FADE_MACH}`);
    for (const row of rows.slice(1)) if (row[0] !== 0.9) assert.equal(row[1], row[2], `${name} at Mach ${row[0]}: one condition, both columns`);
  }
  // The roll power and the roll damping (pull request 11): Mach 0.5, where they are 1, then the plots' Mach
  // numbers above it; the plots' five heights; at each of the nine conditions the condition's own factor, the
  // same number the other factors' tables are made from (valuesAt), so the conditions stay where they were.
  for (const term of Object.keys(PLOTTED)) {
    const { columns, rows } = tables[`aero/factor/${term}`];
    assert.deepEqual(columns, LEVEL_HEIGHTS);
    assert.deepEqual(rows.map((row) => row[0]), [FADE_MACH, ...PLOTTED_MACHS], `${term}: its Mach numbers`);
    assert.deepEqual(rows[0], [FADE_MACH, 1, 1, 1, 1, 1], `${term}: 1 at Mach ${FADE_MACH}`);
    for (const c of NINE) {
      const row = rows.find((r) => r[0] === c.mach), own = Number(valuesAt(c).factor[term].toPrecision(4));
      assert.equal(row[1 + columns.indexOf(c.heightFt)], own, `${term} at ${nameOf(c)}: the condition's own`);
      const curve = plottedDerivative(term, c.mach, c.heightFt), derivative = term === 'roll-aileron' ? c.derivatives.Clda : c.derivatives.Clp;
      report.line(`  ${term} at ${nameOf(c)}: CR-2144's tables give ${derivative.toFixed(4)}; its plotted curve there ${curve ? curve.derivative.toFixed(4) : 'is not drawn'}`);
    }
  }
  // The three levels: Mach 0.3, where they are 0, then the plots' Mach numbers; the plots' five heights.
  for (const name of LEVELS.map((n) => `aero/increment/${n}`)) {
    const { columns, rows } = tables[name];
    assert.deepEqual(columns, LEVEL_HEIGHTS);
    assert.deepEqual(rows[0], [LEVEL_FADE_MACH, 0, 0, 0, 0, 0], `${name}: 0 at Mach ${LEVEL_FADE_MACH}`);
    for (const c of NINE) assert.ok(rows.some((row) => row[0] === c.mach) && columns.includes(c.heightFt), `${name}: ${nameOf(c)} is a cell`);
  }
  assert.deepEqual([...FACTORS, ...Object.keys(SHARED), ...UNCHANGED].length, 26, 'every term of Table 1 has its factor');
  report.line(`f4c: ${found.length} tables of what Mach changes in the aircraft file, ${cells} cells, each what tools/f4c-mach.mjs works out from aircraft/f4c/data/cr2144-f4c.json and afwal-f4j.json`);
  report.line('  the factors at each Mach number (15,000 ft | 35,000 ft where they differ):');
  for (const name of FACTORS.filter((n) => !PLOTTED[n])) report.line(`    ${name.padEnd(17)} ${tables[`aero/factor/${name}`].rows.map((row) => (row[1] === row[2] ? `${row[1]}` : `${row[1]}|${row[2]}`)).join('  ')}`);
  for (const name of Object.keys(PLOTTED)) report.line(`    ${name.padEnd(17)} by height (sea level, 15,000, 35,000, 45,000, 55,000 ft): ${tables[`aero/factor/${name}`].rows.map((row) => `M${row[0]} ${row.slice(1).join('|')}`).join('  ')}`);
});

// ---- The checkride's tool: a transfer function's response ----

test('linear: a first-order lag and a second-order swing answer a step as the textbook says, and a dying swing\'s time to half is ln 2 / (damping ratio x frequency)', () => {
  // 1 / (tau s + 1), a step: 1 - e^(-t / tau).
  const tau = 0.7, lag = respondLinear({ numerator: [1 / tau], denominator: polynomial([{ root: 1 / tau }]) }, () => 1, DT, 5);
  for (const { t, x } of lag) assert.ok(Math.abs(x - (1 - Math.exp(-t / tau))) < 1e-12, `the lag at ${t} s`);
  // omega2 / (s2 + 2 zeta omega s + omega2), a step: 1 - e^(-zeta omega t) (cos wd t + zeta omega / wd sin wd t).
  const zeta = 0.2, omega = 3, wd = omega * Math.sqrt(1 - zeta ** 2);
  const swing = respondLinear({ numerator: [omega ** 2], denominator: polynomial([{ zeta, omega }]) }, () => 1, DT, 10);
  for (const { t, x } of swing) assert.ok(Math.abs(x - (1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t)))) < 1e-11, `the swing at ${t} s`);
  // The first overshoot of that step: at pi / wd, of e^(-zeta pi / sqrt(1 - zeta2)).
  const m = measures(swing.map(({ t, x }) => ({ t, x })));
  assert.ok(Math.abs(m.peakTime - Math.PI / wd) < DT && Math.abs(m.peak - (1 + Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta ** 2)))) < 1e-4, `first peak ${m.peak} at ${m.peakTime} s`);
  // A pulse, then the swing left alone: its time to half.
  const free = measures(respondLinear({ numerator: [omega ** 2], denominator: polynomial([{ zeta, omega }]) }, (t) => (t < 0.5 ? 1 : 0), DT, 20), 0.5);
  assert.ok(Math.abs(free.halfTime / (Math.LN2 / (zeta * omega)) - 1) < 0.01, `time to half ${free.halfTime} s; the textbook's ${Math.LN2 / (zeta * omega)}`);
  // A motion that does not die away has none; one that does not swing has none to time.
  assert.equal(measures(respondLinear({ numerator: [omega ** 2], denominator: polynomial([{ zeta: -0.01, omega }]) }, (t) => (t < 0.5 ? 1 : 0), DT, 20), 0.5).halfTime, Infinity);
  assert.ok(Number.isNaN(measures(respondLinear({ numerator: [1 / tau], denominator: polynomial([{ root: 1 / tau }]) }, (t) => (t < 0.5 ? 1 : 0), DT, 20), 0.5).halfTime));
  // Two records laid beside each other are timed over the same swings, though a peak of one falls just before
  // the pulse's end and the other's just after it: the same pulse response, one of them 16 ms early.
  const late = respondLinear({ numerator: [omega ** 2], denominator: polynomial([{ zeta, omega }]) }, (t) => (t < 1 ? 1 : 0), DT, 20);
  const early = late.map(({ t, x }) => ({ t: t - 2 * DT, x })), cut = measures(late).peakTime - DT;
  assert.ok(measures(late, cut).free[0].t - measures(early, cut).free[0].t < -0.5, 'measured apart, they start a swing apart');
  const pair = measuresBeside(early, late, cut);
  assert.ok(Math.abs(pair.ours.free[0].t - pair.theirs.free[0].t) < 3 * DT && Math.abs(pair.ours.halfTime - pair.theirs.halfTime) < 0.01, `beside: ${pair.ours.halfTime} s and ${pair.theirs.halfTime}`);
  // The matrix exponential itself, on a turn: e^[[0, a], [-a, 0]] is a rotation by a.
  const turn = exponential([[0, 2], [-2, 0]]);
  assert.ok(Math.abs(turn[0][0] - Math.cos(2)) < 1e-12 && Math.abs(turn[0][1] - Math.sin(2)) < 1e-12);
  assert.equal(turningPoints([0, 1, 0.5, 2, 0].map((x, t) => ({ t, x })), 0.1).length, 3);
});

test('linear: CR-2144\'s shorthand is read as its page A-11 says, on the report\'s own example and on its parentheses', () => {
  // The example: beta / delta r = .0295 (s - .0494)(s + 2.05)(s + 42.3) / [(s + .0318)(s + 2.20)(s2 + 2 x .0609 x 1.13 s + 1.13 squared)].
  assert.ok(CR.how_to_read.transfer_function_notation.quote[2].includes('.0295 (s - .0494)(s + 2.05)(s + 42.3)'));
  const rows = (block, entries) => entries.map(([label, value, inParentheses = false]) => ({ label, block, values: [value], parenthesised: [inParentheses] }));
  const example = { rows: [...rows('DENOMINATOR', [['1/T(DET)1', 0.0318], ['1/T(DET)2', 2.2], ['Z(DET)1', 0.0609], ['W(DET)1', 1.13]]), ...rows('N(B /DR)', [['A(B)', 0.0295], ['1/T(B)1', -0.0494], ['1/T(B)2', 2.05], ['1/T(B)3', 42.3]])] };
  const tf = transferFunction(factorsOf(example, 'N(B /DR)', 1), factorsOf(example, 'DENOMINATOR', 1));
  const close = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-12 * Math.max(1, Math.abs(b[i])));
  assert.ok(close(tf.numerator, [1, -0.0494 + 2.05 + 42.3, -0.0494 * 2.05 + -0.0494 * 42.3 + 2.05 * 42.3, -0.0494 * 2.05 * 42.3].map((c) => 0.0295 * c)), 'the numerator');
  assert.ok(close(tf.denominator, polynomial([{ root: 0.0318 }, { root: 2.2 }, { zeta: 0.0609, omega: 1.13 }])) && tf.denominator.length === 5, 'the denominator');
  // "Any roots enclosed in parentheses imply the opposite order of what is specified."
  const odd = { rows: [...rows('DENOMINATOR', [['Z(DET)1', -0.0378, true], ['W(DET)1', 0.0516, true], ['Z(DET)2', 0.393], ['W(DET)2', 4.44]]), ...rows('N(U /DS)', [['A(U)', 2], ['1/T(U)1', 136], ['1/T(U)2', 0.98, true], ['1/T(U)3', 0.307, true]])] };
  assert.deepEqual(factorsOf(odd, 'DENOMINATOR', 1).factors, [{ root: -0.0378 }, { root: 0.0516 }, { zeta: 0.393, omega: 4.44 }]);
  assert.deepEqual(factorsOf(odd, 'N(U /DS)', 1), { gain: 2, factors: [{ root: 136 }, { zeta: 0.98, omega: 0.307 }] });
  // In the record itself: condition 2's slow pair is two roots, one of them the "tuck"; and the misprint the record caught is put right.
  assert.deepEqual(factorsOf(CR.tables['IV-4'], 'DENOMINATOR', 2).factors.slice(0, 2), [{ root: -0.0378 }, { root: 0.0516 }]);
  assert.equal(cell('IV-14', 'A(P)', 6), 0, 'printed 0.00');
  assert.equal(factorsOf(CR.tables['IV-14'], 'N(P /DA)', 6).gain, 10, 'and read as the 10.0 it is');
});

// ---- 2 and 3. JSBSim's side ----

/** What Mach changes at a Mach number and a height, as Table 1 in JavaScript wants it: each factor and increment from the tool's tables. */
function machAt(tables, mach, heightFt) {
  return {
    factor: (term) => (UNCHANGED.includes(term) ? 1 : lookup(tables[`aero/factor/${SHARED[term] ?? term}`], mach, heightFt)),
    increment: (name) => lookup(tables[`aero/increment/${name}`], mach, heightFt),
  };
}

/** CR-2144's response to an input, from one of its tables: the numerator's block over the denominator, at a condition. */
const crResponse = (table, block, fc, input, seconds, timesS = false) => respondLinear(transferFunction(factorsOf(CR.tables[table], block, fc), factorsOf(CR.tables[table], 'DENOMINATOR', fc), timesS ? [{ root: 0 }] : []), input, DT, seconds);

/**
 * Everything flown at one condition, flown once: the trim, the three responses beside CR-2144's, and the pull.
 */
function flyCondition(module, c) {
  const out = {};
  // The trim.
  const { flight, diveDeg } = atCondition(module, c);
  const qbar = flight.get('aero/qbar-psf');
  out.trim = {
    diveDeg, mach: flight.value('velocities/mach'), heightFt: flight.value('position/h-sl-ft'), alpha: flight.get('aero/alpha-deg'), stabilator: flight.get('fcs/elevator-pos-deg'), qbar,
    gamma: flight.get('flight-path/gamma-deg'), drag: flight.get('forces/fwx-aero-lbs') / (qbar * S), thrust: flight.get('propulsion/engine[0]/thrust-lbs') + flight.get('propulsion/engine[1]/thrust-lbs'),
    throttle: flight.trimmed.throttle, weight: flight.value('inertia/weight-lbs'), gear: flight.value('gear/gear-pos-norm'),
    steady: [flight.get('accelerations/udot-ft_sec2'), flight.get('accelerations/wdot-ft_sec2'), flight.get('accelerations/qdot-rad_sec2')],
  };
  const base = stateOf(flight);
  // The stabilator's pulse: the pitch rate.
  out.stabilator = measuresBeside(respond(flight, 'stabilator', pulse(PUSH), pitchRate, PUSH.record), crResponse('IV-4', 'N(THE/DS)', c.fc, pulse(PUSH), PUSH.record, true), PUSH.seconds);
  flight.dispose();
  // The rudder's: the yaw rate.
  const holder = {}, kicked = atCondition(module, c, { assists: rudderFeet(holder) }).flight;
  holder.flight = kicked;
  const yaw = respond(kicked, 'rudder', pulse(KICK), yawRate, KICK.record);
  kicked.dispose();
  out.rudder = measuresBeside(yaw, crResponse('IV-15', 'N(R /DR)', c.fc, pulse(KICK), KICK.record), KICK.seconds);
  // The aileron's step: the roll rate after half a second and after two.
  const rolled = atCondition(module, c).flight, roll = respond(rolled, 'aileron', () => STEP.degrees, rollRate, STEP.record);
  rolled.dispose();
  const theirRoll = crResponse('IV-14', 'N(P /DA)', c.fc, () => STEP.degrees, STEP.record), at = (record, t) => record.find((s) => s.t >= t - 1e-9).x;
  out.aileron = { ours: [at(roll, 0.5), at(roll, 2)], theirs: [at(theirRoll, 0.5), at(theirRoll, 2)] };
  // The steady pull: stabilator for each g.
  const more = steadyPull(module, base, PULL_G), less = steadyPull(module, base, -PULL_G);
  out.pull = { perG: (more.stabilatorDeg - less.stabilatorDeg) / (2 * PULL_G), alphaPerG: (more.alphaDeg - less.alphaDeg) / (2 * PULL_G), left: [...more.left, ...less.left] };
  return out;
}

/** That a control moved as the test says: read during its pulse, from a fresh flight. */
function moved(module, c, control, degrees) {
  const holder = {}, flight = atCondition(module, c, control === 'rudder' ? { assists: rudderFeet(holder) } : {}).flight;
  holder.flight = flight;
  const read = { stabilator: () => flight.get('fcs/elevator-pos-deg'), rudder: () => flight.get('fcs/rudder-pos-deg'), aileron: () => flight.get('fcs/left-aileron-pos-deg') - flight.get('fcs/right-aileron-pos-deg') }[control];
  const spoilers = () => flight.get('fcs/right-spoiler-pos-deg') - flight.get('fcs/left-spoiler-pos-deg'), before = read(), spoilersBefore = spoilers();
  respond(flight, control, () => degrees, () => 0, 3 * DT);
  const by = read() - before, spoiler = spoilers() - spoilersBefore;
  flight.dispose();
  return { by, spoiler };
}

/**
 * The six lines JSBSim's default stepping of rotations did not meet, by key "<condition> <control>", with what
 * it gave (the same in both builds; measured in this pull request before the F-4C's settings changed the
 * rule). The test near the end of this file flies them on the default again and holds these numbers to it.
 * Condition 9's was 3.54 s while it was flown in a dive of 4.8 degrees (the engines could not hold it level);
 * since pull request 11 it is flown level, as CR-2144 has it, and gives 3.68 (still 44% slower than
 * CR-2144's 2.56). Condition 10's moved from 3.19 to 3.17 the same way (in a dive of 8.1 degrees, then level).
 */
const ON_DEFAULT = new Map([
  ['8 stabilator', 5.86],
  ['9 stabilator', 3.68],
  ['10 stabilator', 3.19],
  ['6 rudder', 7.36],
  ['7 rudder', 3.35],
  ['8 rudder', 4.02],
]);
/** JSBSim's own names for its stepping rules (FGPropagate.h, eIntegrateType), and its defaults. */
const RULES = { rotationRate: 'simulation/integrator/rate/rotational', speed: 'simulation/integrator/rate/translational', attitude: 'simulation/integrator/position/rotational', position: 'simulation/integrator/position/translational' };
const JSBSIM_DEFAULT_STEPPING = [1, 3, 1, 4];

for (const variant of VARIANTS) {
  const say = (line) => report.line(`  ${variant}: ${line}`);
  let loaded = null;
  const module = () => (loaded ??= moduleWith(F4C, variant));
  const flown = new Map();
  const at = async (c) => { if (!flown.has(c.fc)) flown.set(c.fc, flyCondition(await module(), c)); return flown.get(c.fc); };

  test(`${variant}, f4c: with Mach in it the wiring holds: at a grid of Mach numbers from under 0.4 to over 2.1, heights from sea level to 60,000 ft, and states, the six coefficients JSBSim works out are AFWAL's Table 1 with the tool's factors and increments in it, worked out in JavaScript, within 0.000001`, async () => {
    const m = await module(), tables = machTables();
    const HEIGHTS_FT = [0, 8000, 15000, 25000, 35000, 40000, 50000, 60000], SPEEDS = [400, 560, 640, 800, 900, 1000, 1150, 1300, 1600, 2100];
    const ALPHAS = [-3, 0.5, 4, 9.4, 22, -0.3, 2.6], BETAS = [0, 5, -12, 2], PITCH = [1, 0, -1, 0.4, -0.5], ROLL = [0, 1, -1, 0.6, -0.3, 0.25, -0.75], RUDDER = [0, 1, -1, 0.5];
    const P = [0, 0.8, -1.5], Q = [0.3, 0, -0.2, 0.1, 0], R = [0, -0.4, 0.25, 0, 0.1, -0.1, 0.3];
    const worst = Object.fromEntries(SIX.map((name) => [name, { off: 0 }])), seen = { states: 0, slowest: Infinity, fastest: 0, different: 0 };
    let k = 0;
    for (const heightFt of HEIGHTS_FT) for (const vt of SPEEDS) {
      const flight = startAt(m, { heightFt, vt, alpha: ALPHAS[k % 7], beta: BETAS[k % 4], pitch: PITCH[k % 5], roll: ROLL[k % 7], rudder: RUDDER[k % 4], p: P[k % 3], q: Q[k % 5], r: R[k % 7] });
      for (const what of ['as started', 'three steps on']) {
        const { state, measured, mach, heightFt: height } = snapshot(flight), changes = machAt(tables, mach, height);
        const wanted = table1(state, CG_PERCENT_CHORD.value, { mach: changes }), plain = table1(state, CG_PERCENT_CHORD.value);
        for (const name of SIX) {
          const off = Math.abs(measured[name] - wanted[name]);
          assert.ok(off <= 1e-6, `${name} at Mach ${mach} and ${height} ft, ${what}: JSBSim ${measured[name]}, Table 1 with Mach ${wanted[name]} (${JSON.stringify(state)})`);
          if (off > worst[name].off) worst[name] = { off, mach, height };
        }
        // The file's own numbers for each factor and increment are the tool's tables read the same way.
        if (what === 'as started') {
          for (const term of [...FACTORS, ...Object.keys(SHARED), ...UNCHANGED]) assert.ok(Math.abs(flight.get(`aero/factor/${term}`) - changes.factor(term)) < 1e-12, `aero/factor/${term} at Mach ${mach} and ${height} ft`);
          for (const name of [...INCREMENTS, ...LEVELS]) assert.ok(Math.abs(flight.get(`aero/increment/${name}`) - changes.increment(name)) < 1e-12, `aero/increment/${name} at Mach ${mach} and ${height} ft`);
        }
        if (SIX.some((name) => Math.abs(wanted[name] - plain[name]) > 1e-4)) seen.different++;
        seen.states++; seen.slowest = Math.min(seen.slowest, mach); seen.fastest = Math.max(seen.fastest, mach);
        if (what === 'as started') assert.equal(flight.step(3), 0);
      }
      flight.dispose();
      k++;
    }
    assert.ok(seen.slowest < 0.4 && seen.fastest > 2.1 && seen.different > 100, JSON.stringify(seen));
    say(`${seen.states} states from Mach ${seen.slowest.toFixed(2)} to ${seen.fastest.toFixed(2)}, sea level to 60,000 ft (${seen.different} of them where Mach changes a coefficient by more than 0.0001): the largest difference from Table 1 with the tables in it: ${SIX.map((name) => `${name} ${worst[name].off.toExponential(1)}`).join(', ')}; each within 0.000001`);
  });

  for (const c of NINE) {
    const i = NINE.indexOf(c);

    test(`${variant}, f4c at ${nameOf(c)}: "started trimmed and level at its speed and height": "Trim angle of attack within 0.5 degrees, and stabilator within 1.0 degree, of CR-2144's"`, async () => {
      const { trim } = await at(c);
      // Read back that it is the condition: its Mach number and height, the F-4C's one weight, gear up, steady, and level or in the dive.
      assert.ok(Math.abs(trim.mach - c.mach) < 1e-3 && Math.abs(trim.heightFt - c.heightFt) < 1, `Mach ${trim.mach} at ${trim.heightFt} ft`);
      assert.ok(trim.weight === REFERENCE.WEIGHT.value && trim.gear === 0);
      assert.ok(Math.abs(trim.steady[0]) < 0.01 && Math.abs(trim.steady[1]) < 0.01 && Math.abs(trim.steady[2]) < 1e-4, `steady: ${trim.steady}`);
      assert.ok(Math.abs(trim.gamma + trim.diveDeg) < 0.01, `flight path ${trim.gamma} degrees`);
      // "If a condition cannot be trimmed because the engines cannot hold the speed, it is flown in the shallow dive that does, and the results say so."
      const how = trim.diveDeg
        ? `the engines cannot hold it level (full afterburner gives ${trim.thrust.toFixed(0)} lb; the drag is ${(trim.drag * trim.qbar * S).toFixed(0)}): FLOWN IN A DIVE OF ${trim.diveDeg.toFixed(1)} DEGREES, the shallowest that holds the speed`
        : `level, the throttle ${trim.throttle <= F4C.mil ? `${(trim.throttle / F4C.mil * 100).toFixed(0)}% of the way to MIL` : `${((trim.throttle - F4C.mil) / (1 - F4C.mil) * 100).toFixed(0)}% into the afterburner`} (${trim.thrust.toFixed(0)} lb)`;
      say(`${nameOf(c)}: ${how}. Trim angle of attack ${trim.alpha.toFixed(2)} degrees; CR-2144 ${CONDITION_TRIM_ALPHA.value[i]} (${CONDITION_TRIM_ALPHA.where.split(';')[0]}); within 0.5. Stabilator ${trim.stabilator.toFixed(2)}; CR-2144 ${CONDITION_TRIM_STABILATOR.value[i]} (${CONDITION_TRIM_STABILATOR.where.split(';')[0]}); within 1.0`);
      assert.ok(Math.abs(trim.alpha - CONDITION_TRIM_ALPHA.value[i]) <= 0.5, `angle of attack ${trim.alpha}`);
      assert.ok(Math.abs(trim.stabilator - CONDITION_TRIM_STABILATOR.value[i]) <= 1.0, `stabilator ${trim.stabilator}`);
    });

    for (const [control, input, table, what, quote] of [
      ['stabilator', PUSH, 'IV-4', 'pitch rate', '"A stabilator pulse, laid beside the response CR-2144\'s table IV-4 gives for the same pulse (pitch rate)"'],
      ['rudder', KICK, 'IV-15', 'yaw rate', '"A rudder pulse beside table IV-14\'s (yaw rate), by the same three lines" (the rudder\'s table is IV-15)'],
    ]) {
      test(`${variant}, f4c at ${nameOf(c)}: ${quote}: "time to the first peak within 15%, the peak within 15%"`, async () => {
        const { ours, theirs } = (await at(c))[control], m = moved(await module(), c, control, input.degrees);
        assert.ok(Math.abs(m.by - input.degrees) < 1e-6, `the ${control} moved ${m.by} degrees`);
        say(`${nameOf(c)}, ${input.degrees} degree of ${control} for ${input.seconds} s, the ${what}: first peak ${ours.peak.toFixed(3)} deg/s at ${ours.peakTime.toFixed(3)} s; CR-2144's table ${table}: ${theirs.peak.toFixed(3)} at ${theirs.peakTime.toFixed(3)}; the time ${percent(ours.peakTime, theirs.peakTime)}, the peak ${percent(ours.peak, theirs.peak)}; within 15%`);
        assert.ok(within(ours.peakTime, theirs.peakTime, 0.15), `time to the first peak: ${ours.peakTime} s, CR-2144 ${theirs.peakTime}`);
        assert.ok(within(ours.peak, theirs.peak, 0.15), `the peak: ${ours.peak}, CR-2144 ${theirs.peak}`);
      });

      test(`${variant}, f4c at ${nameOf(c)}: ${quote}: "the time to die to half within 25%. Where CR-2144's motion dies away, ours must"`, async () => {
        const { ours, theirs } = (await at(c))[control];
        say(`${nameOf(c)}, the ${what} after the ${control}'s pulse: its swings die to half in ${ours.halfTime.toFixed(2)} s; CR-2144's table ${table}: ${theirs.halfTime.toFixed(2)} s; ${percent(ours.halfTime, theirs.halfTime)}; within 25%`);
        assert.ok(Number.isFinite(theirs.halfTime), 'CR-2144\'s motion dies away');
        assert.ok(Number.isFinite(ours.halfTime), 'ours dies away');
        assert.ok(within(ours.halfTime, theirs.halfTime, 0.25), `time to die to half: ${ours.halfTime} s, CR-2144 ${theirs.halfTime}`);
      });
    }

    test(`${variant}, f4c at ${nameOf(c)}: "An aileron step beside CR-2144's own roll response: the roll rate after 0.5 s and after 2 s within 15%"`, async () => {
      const { ours, theirs } = (await at(c)).aileron, m = moved(await module(), c, 'aileron', STEP.degrees);
      assert.ok(Math.abs(m.by - STEP.degrees) < 1e-6 && Math.abs(m.spoiler - STEP.degrees * REFERENCE.SPOILER_PER_AILERON.value) < 1e-6, `the aileron moved ${m.by} degrees and the spoiler ${m.spoiler}`);
      say(`${nameOf(c)}, a step of ${STEP.degrees} degree of aileron: the roll rate after 0.5 s ${ours[0].toFixed(3)} deg/s and after 2 s ${ours[1].toFixed(3)}; CR-2144's table IV-14: ${theirs[0].toFixed(3)} and ${theirs[1].toFixed(3)}; ${percent(ours[0], theirs[0])} and ${percent(ours[1], theirs[1])}; within 15%`);
      assert.ok(within(ours[0], theirs[0], 0.15) && within(ours[1], theirs[1], 0.15));
    });

    test(`${variant}, f4c at ${nameOf(c)}: "Stabilator per g in a steady pull within 10% of table IV-12's"`, async () => {
      const { pull } = await at(c), theirs = CONDITION_STABILATOR_PER_G.value[i];
      assert.ok(pull.left.every((x) => Math.abs(x) < 1e-5), `the pull is steady: ${pull.left}`);
      say(`${nameOf(c)}, a steady pull: ${(-pull.perG).toFixed(3)} degrees of stabilator (trailing edge up) for each g, and ${pull.alphaPerG.toFixed(2)} degrees of angle of attack; CR-2144 ${theirs} (${CONDITION_STABILATOR_PER_G.where.split(';')[0]}); ${percent(-pull.perG, theirs)}; within 10%`);
      assert.ok(within(-pull.perG, theirs, 0.1), `${-pull.perG} degrees per g, CR-2144 ${theirs}`);
    });
  }
}

// ---- 4. Reported, no pass or fail ----

test('f4c, reported (no pass or fail): "the slow speed-and-height swing (phugoid) and the spiral, beside CR-2144\'s"; and at the three conditions where CR-2144 has the airplane slowly tuck, what ours does hands-off', async () => {
  const module = await moduleWith(F4C, 'weh'), say = (line) => report.line(`  ${line}`);
  say('The slow motions are not CR-2144\'s by construction: how the lift, the drag and the trim stabilator change with speed comes from its plotted trim curves, height by height, and its derivatives with speed (Table IV-3\'s XU, ZU and MU) are not used.');
  for (const c of NINE) {
    const i = NINE.indexOf(c), slow = factorsOf(CR.tables['IV-4'], 'DENOMINATOR', c.fc).factors;
    // CR-2144's slow motion: a swing (a damping ratio and a frequency), or two roots, one of them growing.
    const theirs = 'zeta' in slow[0]
      ? `a swing of ${(2 * Math.PI / (slow[0].omega * Math.sqrt(1 - slow[0].zeta ** 2))).toFixed(0)} s that halves in ${(Math.LN2 / (slow[0].zeta * slow[0].omega)).toFixed(0)} s`
      : `no swing: a speed error that doubles in ${(Math.LN2 / Math.abs(Math.min(slow[0].root, slow[1].root))).toFixed(1)} s (the "tuck"; table IV-12: ${cell('IV-12', 'PHUGOID(2) (SEC) ( TUCK(2) )', c.fc)} s)`;
    const { flight, diveDeg } = atCondition(module, c);
    if (diveDeg) {
      say(`${nameOf(c)}: flown in a dive of ${diveDeg.toFixed(1)} degrees, where the air thickens as it goes, so its slow motion is not level flight's and is not reported. CR-2144: ${theirs}; its spiral ${CONDITION_SPIRAL_ROOT.value[i]} 1/s`);
      flight.dispose();
      continue;
    }
    // Hands-off after the stabilator's small push: the speed for five minutes.
    const speed = respond(flight, 'stabilator', pulse(PUSH), (f) => f.value('velocities/vtrue-kts'), 300);
    const endBank = flight.value('attitude/phi-rad') * DEG;
    flight.dispose();
    const late = speed.filter((sample) => sample.t >= 5), most = Math.max(...late.map((sample) => Math.abs(sample.x)));
    const turns = turningPoints(late, 0.05 * most), sizeAt = (t) => speed.find((sample) => sample.t >= t).x;
    let ours;
    if (turns.length >= 3) {
      const swings = turns.slice(1).map((turn, k) => Math.abs(turn.x - turns[k].x)), n = Math.min(4, swings.length - 1), ratio = n > 0 ? (swings[n] / swings[0]) ** (1 / n) : NaN;
      const half = (turns.at(-1).t - turns[0].t) / (turns.length - 1);
      ours = `a swing of ${(2 * half).toFixed(0)} s, each half swing ${(ratio * 100).toFixed(0)}% of the one before${ratio < 1 ? ` (it halves in ${(half * Math.LN2 / -Math.log(ratio)).toFixed(0)} s)` : ratio > 1 ? ` (it doubles in ${(half * Math.LN2 / Math.log(ratio)).toFixed(0)} s)` : ''}; the speed is off by ${sizeAt(30).toFixed(2)}, ${sizeAt(60).toFixed(2)} and ${sizeAt(120).toFixed(2)} kt at 30, 60 and 120 s`;
    } else ours = `no swing in five minutes: the speed is off by ${sizeAt(30).toFixed(2)}, ${sizeAt(60).toFixed(2)}, ${sizeAt(120).toFixed(2)} and ${sizeAt(240).toFixed(2)} kt at 30, 60, 120 and 240 s`;
    // The spiral: hands-off after a second of aileron, the bank.
    const rolled = atCondition(module, c).flight;
    const banks = respond(rolled, 'aileron', (t) => (t < 1 ? 1 : 0), (f) => f.value('attitude/phi-rad') * DEG, 120), bankAt = (t) => banks.find((sample) => sample.t >= t).x;
    rolled.dispose();
    const spiral = CONDITION_SPIRAL_ROOT.value[i];
    say(`${nameOf(c)}, hands off after the stabilator's push: ${ours} (the bank drifts to ${endBank.toFixed(1)} degrees). CR-2144: ${theirs}.`);
    const rate = Math.log(bankAt(20) / bankAt(120)) / 100;   // 1/s, positive if the bank dies away
    say(`    its spiral, hands off after a second of aileron: the bank is ${bankAt(20).toFixed(2)}, ${bankAt(60).toFixed(2)} and ${bankAt(120).toFixed(2)} degrees at 20, 60 and 120 s: it ${rate > 0 ? `halves in ${(Math.LN2 / rate).toFixed(0)} s` : `doubles in ${(Math.LN2 / -rate).toFixed(0)} s`}. CR-2144's spiral root ${spiral} 1/s: the bank ${spiral > 0 ? `halves in ${(Math.LN2 / spiral).toFixed(0)} s` : `doubles in ${(Math.LN2 / -spiral).toFixed(0)} s`}`);
  }
});

test('f4c, reported (no pass or fail; pull request 11 judges it): at each condition our drag in level flight beside CR-2144\'s, and the thrust needed beside the thrust the engines have; the drag at zero angle of attack by Mach', async () => {
  const module = await moduleWith(F4C, 'weh'), say = (line) => report.line(`  ${line}`);
  say('CR-2144 gives the drag as a plot only (figure IV-9); its Table IV-3 has the drag\'s changes with speed and angle of attack (XU, XW), not the drag.');
  for (const c of NINE) {
    const i = NINE.indexOf(c), { flight, diveDeg } = atCondition(module, c), base = stateOf(flight);
    const qbar = flight.get('aero/qbar-psf'), drag = flight.get('forces/fwx-aero-lbs'), thrust = flight.get('propulsion/engine[0]/thrust-lbs') + flight.get('propulsion/engine[1]/thrust-lbs');
    flight.dispose();
    // The same state with the throttle full and the engines at full speed, one step on: what the engines have there.
    const full = startNear(module, { ...base, throttle: 1, turning: 100 });
    assert.equal(full.step(1), 0);
    const available = full.get('propulsion/engine[0]/thrust-lbs') + full.get('propulsion/engine[1]/thrust-lbs');
    full.dispose();
    say(`${nameOf(c)}: drag coefficient ${(drag / (qbar * S)).toFixed(4)}; CR-2144 ${CONDITION_DRAG.value[i]} (${CONDITION_DRAG.where.split(';')[0]}). Drag ${drag.toFixed(0)} lb; thrust at the trim ${thrust.toFixed(0)} lb${diveDeg ? ` (in a dive of ${diveDeg.toFixed(1)} degrees)` : ''}; full afterburner there gives ${available.toFixed(0)} lb: ${available >= drag ? `${((available / drag - 1) * 100).toFixed(0)}% to spare` : `${((1 - available / drag) * 100).toFixed(0)}% SHORT`}`);
  }
  // The drag at zero angle of attack, stabilator at zero, at sea level: AFWAL's alone is 0.035 at any speed.
  const minimum = CR.figures.CL_CD.CD.CD_min.points, lowest = (mach) => (mach < minimum[0][0] ? null : minimum.reduce((value, [m, cd], k) => (m <= mach ? (minimum[k + 1] ? cd + ((mach - m) / (minimum[k + 1][0] - m)) * (minimum[k + 1][1] - cd) : cd) : value), null));
  const points = [];
  for (const fps of [300, 450, 560, 670, 890, 1000, 1120, 1230, 1340]) {
    const flight = startAt(module, { alpha: 0, beta: 0, vt: fps, heightFt: 0 }), { measured, mach } = snapshot(flight);
    flight.dispose();
    points.push(`Mach ${mach.toFixed(2)}: ${measured.drag.toFixed(4)}${lowest(mach) === null ? '' : ` (${lowest(mach).toFixed(4)})`}`);
  }
  say(`the drag coefficient at zero angle of attack at sea level, with CR-2144's plotted minimum drag in brackets (its "CD MIN" line, figure IV-9): ${points.join('; ')}. AFWAL's alone, as pull request 5a had it at every speed: 0.0350`);
});

test('f4c: its settings ask JSBSim for second-order stepping of rotations, and JSBSim has it; on JSBSim\'s default the six pulses die away 25% to 45% slower than CR-2144\'s, which is the reason', async () => {
  // JSBSim v1.3.3 steps the rotation rates and the attitude by "rectangular Euler" unless told otherwise
  // (FGPropagate.cpp: integrator_rotational_rate and integrator_rotational_position = eRectEuler). For a swing
  // of frequency w that rule takes w2 dt / 2 off the damping: at 120 steps a second, 0.017 of damping ratio
  // at 4 rad/s. The F-4C's settings set both to Adams-Bashforth 2 (JSBSim's number 3, its own default for the
  // speeds). This test reads the rules back from a flight, then flies the six pulses on JSBSim's defaults,
  // given to the JSBSim instance by wrapping the one call that makes it, and put back after.
  const module = await moduleWith(F4C, 'weh'), say = (line) => report.line(`  ${line}`), create = Fdm.create;
  assert.deepEqual(F4C.stepping, [3, 3, 3, 4]);
  {
    const { flight } = atCondition(module, NINE.find((x) => x.fc === 6));
    const has = [RULES.rotationRate, RULES.speed, RULES.attitude, RULES.position].map((name) => flight.get(name));
    flight.dispose();
    assert.deepEqual(has, F4C.stepping, 'read back from JSBSim');
    say(`JSBSim's stepping rules in an F-4C flight, read back: rotation rates ${has[0]}, speeds ${has[1]}, attitude ${has[2]}, position ${has[3]} (1 rectangular Euler, 3 and 4 Adams-Bashforth of second and third order); JSBSim's defaults are ${JSBSIM_DEFAULT_STEPPING.join(', ')}`);
  }
  Fdm.create = (m, options) => create.call(Fdm, m, { ...options, integrators: JSBSIM_DEFAULT_STEPPING });
  try {
    for (const [key, was] of ON_DEFAULT) {
      const [fc, control] = key.split(' '), c = NINE.find((x) => x.fc === Number(fc));
      const holder = {}, { flight } = atCondition(module, c, control === 'rudder' ? { assists: rudderFeet(holder) } : {});
      holder.flight = flight;
      assert.equal(flight.get(RULES.rotationRate), 1, 'flown on the default');
      const [input, table, block, read] = control === 'rudder' ? [KICK, 'IV-15', 'N(R /DR)', yawRate] : [PUSH, 'IV-4', 'N(THE/DS)', pitchRate];
      const { ours, theirs } = measuresBeside(respond(flight, control, pulse(input), read, input.record), crResponse(table, block, c.fc, pulse(input), input.record, control === 'stabilator'), input.seconds);
      flight.dispose();
      say(`${nameOf(c)}, the ${control}'s pulse on JSBSim's default stepping: its swings die to half in ${ours.halfTime.toFixed(2)} s against CR-2144's ${theirs.halfTime.toFixed(2)} (${percent(ours.halfTime, theirs.halfTime)}): outside the plan's 25%`);
      assert.ok(Math.abs(ours.halfTime - was) < 0.02, `${key}: ${ours.halfTime} s on the default; this pull request measured ${was}`);
      assert.ok(ours.halfTime > 1.25 * theirs.halfTime, `${key}: the default no longer misses the line: ${ours.halfTime} against ${theirs.halfTime}`);
    }
  } finally {
    Fdm.create = create;
  }
});

// ---- 5. A two-minute flight's tape, in native JSBSim ----

test('f4c: "A two-minute flight\'s tape replays in native JSBSim by milestone 1\'s lines", at CR-2144\'s condition 6 (Mach 0.9 at 35,000 ft)', async () => {
  // As tests/f4c-aero.test.js: a flight trimmed into the air cannot be a tape, so a twin is trimmed first and
  // the taped flight starts where the twin stood, by values in its start alone.
  const c = NINE.find((x) => x.fc === 6), modules = {}, tapes = {};
  const knots = (f) => f.value('velocities/vc-kts'), feet = (f) => f.value('position/h-sl-ft'), bank = (f) => f.value('attitude/phi-rad') * DEG;
  let seen;
  for (const variant of VARIANTS) {
    const module = modules[variant] = await moduleWith(F4C, variant);
    const { flight: twin, diveDeg } = atCondition(module, c);
    assert.equal(diveDeg, 0, 'the engines hold condition 6 level');
    const hold = { ...twin.trimmed }, alpha = twin.get('aero/alpha-deg'), turning = twin.get('propulsion/engine[0]/n2');
    twin.dispose();
    // The copilot holds the trim the twin's start kept (src/sim/game.js, `airborneTrim`).
    const assists = { ...F4C.assists, trim: { ...F4C.assists.trim, sets: [['fcs/pitch-trim-cmd-norm', hold.heldPitchTrim]] } };
    const flight = Flight.start(module, F4C, {
      record: true, settleSeconds: 0, terrain: GROUND, assists, controls: { gear: false, flaps: false, brake: false, throttle: hold.throttle, pitch: hold.pitch, roll: hold.roll },
      // The speed before the angle of attack: with no speed JSBSim has no flight path to raise the nose from.
      sets: [['ic/h-sl-ft', c.heightFt], ['ic/mach', c.mach], ['ic/alpha-deg', alpha], ['propulsion/engine[0]/n2', turning], ['propulsion/engine[1]/n2', turning], ...STRAIGHT],
    });
    // Read back: it starts at the condition, level and steady.
    assert.ok(Math.abs(flight.value('velocities/mach') - c.mach) < 1e-6 && Math.abs(feet(flight) - c.heightFt) < 0.01 && Math.abs(flight.get('aero/alpha-deg') - alpha) < 1e-9, `Mach ${flight.value('velocities/mach')} at ${feet(flight)} ft`);
    assert.ok(Math.abs(flight.value('velocities/v-down-fps')) < 1e-6 && Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && Math.abs(flight.get('accelerations/qdot-rad_sec2')) < 1e-3 && Math.abs(flight.get('accelerations/udot-ft_sec2')) < 0.01, 'level and steady');
    // Two minutes: a pitch pulse; a turn each way at 30 degrees of bank, holding the height; MIL power; a pull; idle; the gear down.
    seen = { alpha: [Infinity, -Infinity], bank: [Infinity, -Infinity], height: [Infinity, -Infinity], mach: [Infinity, -Infinity], g: [Infinity, -Infinity] };
    const widen = (range, x) => { range[0] = Math.min(range[0], x); range[1] = Math.max(range[1], x); };
    for (let k = 0; k < Math.round(120 / DT); k++) {
      const t = k * DT, target = t < 10 ? 0 : t < 40 ? 30 : t < 70 ? -30 : 0;
      const roll = clamp(hold.roll + 2 * (target - bank(flight)) / DEG - 0.4 * flight.value('velocities/p-rad_sec'), -1, 1);
      const height = t >= 10 && t < 100 ? clamp(0.0004 * (c.heightFt - feet(flight)) + 0.003 * flight.value('velocities/v-down-fps'), -0.1, 0.1) : 0;
      const push = t >= 5 && t < 5.5 ? -1 / 21 : 0, pull = t >= 100 && t < 104 ? 0.05 : 0;
      flight.fly({ roll, pitch: hold.pitch + height + push + pull, throttle: t >= 80 && t < 100 ? F4C.mil : t >= 110 ? 0 : hold.throttle, gear: t >= 112 });
      assert.equal(flight.step(1), 0);
      assert.equal(flight.ended, null);
      widen(seen.alpha, flight.value('aero/alpha-rad') * DEG); widen(seen.bank, bank(flight)); widen(seen.height, feet(flight)); widen(seen.mach, flight.value('velocities/mach')); widen(seen.g, flight.value('accelerations/Nz'));
    }
    // Read back that it was the flight described: it turned both ways above Mach 0.5 all the way, and the gear came down.
    assert.ok(seen.bank[0] < -25 && seen.bank[1] > 25 && flight.value('gear/gear-pos-norm') === 1 && seen.alpha[1] < 15 && seen.mach[0] > FADE_MACH, JSON.stringify(seen));
    assert.ok(Math.abs(knots(flight)) > 100);
    tapes[variant] = flight.tape();
    flight.dispose();
  }
  const tape = tapes.weh, range = ([low, high], digits = 0) => `${low.toFixed(digits)} to ${high.toFixed(digits)}`;
  assert.equal(tape.steps, Math.round(120 / DT));
  assert.equal(tape.own, true, 'the tape says the aircraft is FSG\'s own');
  report.line(`f4c: a ${tape.steps}-step tape (two minutes from ${nameOf(c)}: a pitch pulse, a turn each way, MIL, a pull, idle, gear down; Mach ${range(seen.mach, 2)}, height ${range(seen.height)} ft, bank ${range(seen.bank)} degrees, angle of attack ${range(seen.alpha, 1)}, ${range(seen.g, 2)} g), ${tape.ins.length} inputs a step, ${tape.sets.length} values in the start`);

  // 1. The tape is the whole truth: flown again by the C++ runner inside the same build, the same flight bit for bit.
  for (const variant of VARIANTS) {
    const again = flyWasm(modules[variant], tapes[variant], `f4c-mach-${variant}-again`);
    const same = bitEqual(tapes[variant].states, again);
    report.line(`  ${variant}: flown again from its tape by the C++ runner: ${same.equal ? `identical, ${again.rows} rows of ${again.columns.length} numbers` : `DIFFERENT (${same.reason})`}`);
    assert.ok(same.equal, same.reason);
  }
  assert.ok(bitEqual(tapes.weh.states, tapes.jseh.states).equal, 'both builds recorded the same flight');

  // 2. Matching native, by milestone 1's lines (tests/tape.test.js): the whole flight within altitude 1 ft,
  // angles 0.05 rad and speed 1 knot, or 3 times native's own spread where that is larger; and the first
  // second by FDM's tighter line.
  const { native, ensemble } = flyNative(tape, 'f4c-mach');
  const last = native.rows - 1, numberAt = (name) => native.data[last * native.columns.length + native.columns.indexOf(name)];
  assert.ok(Math.abs(numberAt('position/h-sl-ft') - tape.states.data[tape.steps * tape.states.columns.length + tape.states.columns.indexOf('position/h-sl-ft')]) < 1, 'native JSBSim flew the F-4C to the same place');
  for (const variant of VARIANTS) {
    const wasm = flyWasm(modules[variant], tape, `f4c-mach-${variant}-judged`, JUDGED);
    const whole = classB(native, wasm, ensemble);
    report.line(`  ${variant} against native, the whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const col of whole.columns) report.line(`    ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole-flight line`);
    const rows = Math.round(1 / DT) + 1;
    const first = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
    report.line(`  ${variant} against native, first second: ${describeN(first)}`);
    assert.ok(first.pass, `${variant}: the first-second line`);
  }
});
