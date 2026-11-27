// The F-4C's own flight controls: the plan's pull request 6 (docs/milestones/3.md, "PR 6. The jet's own
// flight controls (headless)"). New in FSG, milestone 3. Each test that holds a line of the plan is named for
// the line, in the plan's words.
//
// What is flown here is the aircraft file's flight controls (aircraft/f4c/f4c.xml, "The jet's own flight
// controls"): the feel system, so that pitch is a pull in pounds; the pitch, roll and yaw dampers; the
// aileron-rudder interconnect; the actuators. This file:
//   1. holds each piece by itself to the number it was written from (CR-2144's figures IV-3 to IV-7);
//   2. flies the airplane at CR-2144's nine conditions with them in, beside CR-2144's own transfer functions
//      for the rudder with the yaw damper in (IV-17), and for the stick force (tables IV-6 and IV-10): those
//      two are the plan's lines as written, reported and not met, because the file leaves out the stick's own
//      swing; the lines held instead are N1 and N2, against CR-2144's own model (tests/checkride/cr2144-pitch.js);
//   3. holds the plan's lines on the pull, the push, the roll damper, the trim, the surfaces and the
//      interconnect, and reports the rest;
//   4. flies a two-minute tape again in native JSBSim.
//
// The inputs, chosen before anything was flown against CR-2144's tables, as pull request 5's were:
//   the stick   a push for one second: the force that would hold the stabilator a quarter of a degree trailing
//               edge down at the condition (its static spring times a quarter of a degree's stick travel),
//               so that the airplane stays where CR-2144's straight-line model holds, as pull request 5's
//               quarter degree did
//   the rudder  one degree of pedal for one second
// "The time to die to half" is pull request 5's measure (tests/checkride/linear.js), unchanged.
//
// Every measured number is printed beside its reference and kept in jsbsim/build/results/checkride-f4c-fcs.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { DT, Flight } from '../src/sim/game.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { RESULTS_DIR as RESULTS, Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace } from '../jsbsim/tests/lib/scenario.js';
import { conditions } from '../tools/f4c-mach.mjs';
import { GROUND, STRAIGHT, atCondition, rudderFeet } from './checkride/conditions.js';
import { pitchModel } from './checkride/cr2144-pitch.js';
import { moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';
import { factorsOf, measures, respond as respondLinear, transferFunction, measuresBeside } from './checkride/linear.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

const { STICK_INERTIA, BELLOWS_SPRING, BELLOWS_PRESSURE_SPRING, BOBWEIGHT, PITCH_GEARING, ACTUATOR_LAG, LATERAL_FEEL, LATERAL_GEARING,
  PITCH_DAMPER, ROLL_DAMPER, ROLL_DAMPER_OUT_ABOVE, YAW_DAMPER, YAW_GYRO_TILT, YAW_DAMPER_AUTHORITY, INTERCONNECT_GAIN, INTERCONNECT_LIMIT, INTERCONNECT_BELOW_KNOTS,
  SPOILER_TRAVEL, SPOILER_PER_AILERON, SPOILER_PER_AILERON_CR, AILERON_TRAVEL, STABILATOR_TRAVEL, PULL_PER_G, G_LIMIT, MOST_G_AT_450, WINGS_G_AT_FULL_TILT,
  WINGS_NEGATIVE_G, WINGS_ROLL_RATE_250, WINGS_ROLL_RATE_400, WINGS_ROLL_RATE_600, WINGS_NEUTRAL_SPEED } = REFERENCE;
const DEG = 180 / Math.PI;
const cite = (r) => `${Array.isArray(r.value) ? r.value.join(', ') : r.value} ${r.unit} (${r.source}, ${r.where})`;
const percent = (ours, theirs) => `${ours / theirs >= 1 ? '+' : ''}${((ours / theirs - 1) * 100).toFixed(1)}%`;
const within = (ours, theirs, share) => Math.abs(ours / theirs - 1) <= share;

const CR = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/cr2144-f4c.json', import.meta.url)));
const NINE = conditions();
const nameOf = (c) => `condition ${c.fc} (Mach ${c.mach} at ${c.heightFt ? `${c.heightFt.toLocaleString('en-US')} ft` : 'sea level'})`;

const report = new Report('checkride-f4c-fcs');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);

let loaded = null;
const module = () => (loaded ??= moduleWith(F4C, 'weh'));

/** The game's pitch control (back positive) that puts `pounds` on the stick (aft positive), through the aircraft file's full pull and push. */
const stickFor = (flight, pounds) => (pounds >= 0 ? pounds / flight.get('fcs/stick/full-pull-lbs') : pounds / flight.get('fcs/stick/full-push-lbs'));

/** Runs a flight for some seconds, calling `each(t)` before every step; stops early if it returns false. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
    assert.equal(flight.ended, null, 'the flight goes on');
  }
}

/** Level at a speed and height by JSBSim's own trim, the real flight controls in, read back. */
function inTheAir(m, at, options = {}) {
  const flight = Flight.start(m, F4C, { airborne: at, terrain: GROUND, ...options });
  assert.ok(Math.abs(flight.value('velocities/vc-kts') - at.knots) < 0.5 && Math.abs(flight.value('position/h-sl-ft') - at.heightFt) < 1, `${flight.value('velocities/vc-kts')} kt at ${flight.value('position/h-sl-ft')} ft`);
  assert.equal(flight.get('fcs/test/straight'), 0, 'the real flight controls');
  return flight;
}

// ---- CR-2144's feel system, worked out here from the record ----

const feel = CR.figures.feel_system_parameters;
/** A plotted line's value at x: straight lines between its points, held at its ends. */
function along(points, x) {
  const pts = points.map(([a, b]) => [a, b]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts.at(-1)[0]) return pts.at(-1)[1];
  const k = pts.findIndex(([a], i) => a <= x && x <= pts[i + 1][0]);
  const [[a, b], [e, g]] = [pts[k], pts[k + 1]];
  return b + ((x - a) / (e - a)) * (g - b);
}
/** CR-2144's qB PBF, pounds, at a Mach number, dynamic pressure and height (figure IV-5: PBF's three lines, by height, straight lines between). */
function qbPbf(mach, qbar, heightFt) {
  const lines = feel.PBF_ft2.curves, heights = [0, 15000, 35000, 45000];
  const at = [along(lines.upper_SL, mach), along(lines.upper_SL, mach), along(lines.middle_35000, mach), along(lines.lower_45000_55000, mach)];
  const h = Math.min(Math.max(heightFt, 0), 45000), k = Math.min(heights.findIndex((x, i) => h >= x && h <= heights[i + 1]), 2);
  const pbf = at[k] + ((h - heights[k]) / (heights[k + 1] - heights[k])) * (at[k + 1] - at[k]);
  return along(feel.qB_over_q.points, mach) * qbar * pbf;
}
/** Whether CR-2144's viscous damper is off its stop there (figure IV-5's boundary). */
function damperFree(mach, heightFt) {
  const boundary = feel.viscous_damper_boundary.points_M_h_ft;
  if (mach < boundary[0][0]) return false;
  return heightFt > along(boundary, mach);
}
/** CR-2144's static stick stiffness, lb/in: both springs on the stop, the bellows spring alone off it. */
const staticStiffness = (mach, qbar, heightFt) => (BELLOWS_SPRING.value + (damperFree(mach, heightFt) ? 0 : BELLOWS_PRESSURE_SPRING.value)) * qbPbf(mach, qbar, heightFt);

// ---- 1. Each piece by itself ----

test('f4c fcs: the feel system\'s tables are CR-2144\'s figure IV-5 as the record has it, cell for cell', () => {
  const xml = readFileSync(new URL('../aircraft/f4c/f4c.xml', import.meta.url), 'utf8');
  const block = xml.slice(xml.indexOf('<fcs_function name="fcs/stick/qB-PBF-lbs">'), xml.indexOf('<fcs_function name="fcs/stick/quick-lbs_in">'));
  const tables = [...block.matchAll(/<tableData>([^]*?)<\/tableData>/g)].map(([, body]) => body.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)));
  assert.deepEqual(tables[0], feel.qB_over_q.points.map(([m, v]) => [m, v]), 'qB/q');
  const [heads, ...rows] = tables[1];
  assert.deepEqual(heads, [0, 15000, 35000, 45000]);
  const lines = feel.PBF_ft2.curves;
  for (const [mach, ...cells] of rows) {
    const wanted = [lines.upper_SL, lines.upper_SL, lines.middle_35000, lines.lower_45000_55000].map((line) => Number(along(line, mach).toFixed(4)));
    assert.deepEqual(cells, wanted, `PBF at Mach ${mach}`);
  }
  const boundary = xml.slice(xml.indexOf('<fcs_function name="fcs/stick/damper-free">'), xml.indexOf('<fcs_function name="fcs/stick/quick-lbs_in">'));
  const points = boundary.match(/<tableData>([^]*?)<\/tableData>/)[1].trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  assert.deepEqual(points.slice(1), feel.viscous_damper_boundary.points_M_h_ft.map(([m, h]) => [m, h]), 'the damper\'s boundary');
  report.line(`f4c fcs: figure IV-5 in the aircraft file: qB/q at ${tables[0].length} Mach numbers, PBF at ${rows.length} by 4 heights, the damper's boundary at ${points.length - 1} points; each the record's`);
});

test('f4c fcs: rudder flexure: the aircraft file\'s table is CR-2144\'s figure IV-6, cell for cell; and the report\'s own tables apply it to the summed rudder command: with the yaw damper in, IV-17\'s rudder numerators are IV-15\'s over (1 + K), K the damper\'s feedthrough of figure IV-7 times figure IV-6\'s factor', () => {
  // The file's table, from the record by the rule its comment gives.
  const flex = CR.figures.rudder_flexure.K_FLEX, heights = [['SL', 0], ['15000', 15000], ['35000', 35000], ['45000', 45000], ['55000', 55000]];
  const covers = (curve, m) => curve[0][0] <= m && m <= curve.at(-1)[0];
  const xml = readFileSync(new URL('../aircraft/f4c/f4c.xml', import.meta.url), 'utf8');
  const block = xml.slice(xml.indexOf('<fcs_function name="fcs/rudder-flexure">'), xml.indexOf('<fcs_function name="fcs/rudder-flexed-deg">'));
  const [heads, ...rows] = block.match(/<tableData>([^]*?)<\/tableData>/)[1].trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  assert.deepEqual(heads, heights.map(([, h]) => h));
  assert.deepEqual(rows[0], [0, 1, 1, 1, 1, 1], '1 at Mach 0');
  assert.deepEqual(rows.slice(1).map((row) => row[0]), [...new Set(Object.values(flex).flatMap((curve) => curve.map(([m]) => m)))].sort((a, b) => a - b));
  for (const [mach, ...cells] of rows.slice(1)) {
    const wanted = heights.map(([name, h]) => {
      const nearest = heights.filter(([n]) => covers(flex[n], mach)).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0];
      return Number(along(flex[covers(flex[name], mach) ? name : nearest ? nearest[0] : name], mach).toFixed(4));
    });
    assert.deepEqual(cells, wanted, `K FLEX at Mach ${mach}`);
  }
  // The report's own tables. K from them: IV-15's gain over IV-17's, less 1, for the yaw rate and the sideslip.
  // K from figure IV-7 and table IV-13: 0.0168 times what one radian of rudder gives the lateral accelerometer
  // at once, |V Y*dr + 9.9 N'dr - 0.39 L'dr|. Their ratio is the flexure factor at the condition.
  const row = (table, label) => CR.tables[table].rows.find((r) => r.label.trim() === label).values;
  const [V, Ydr, Ndr, Ldr, H, M] = [row('IV-2', 'VTO(FPS)'), row('IV-13', 'Y*DR'), row('IV-13', "N'DR"), row('IV-13', "L'DR"), row('IV-2', 'H(FT)'), row('IV-2', 'M(-)')];
  const [ka, l, z] = [YAW_DAMPER.value[2], ...REFERENCE.LATERAL_ACCELEROMETER.value];
  for (const fc of [1, 2, 3, 4, 6]) {
    const k = fc - 1, fromTables = [row('IV-15', 'A(R)')[k] / row('IV-17', 'A(R)')[k] - 1, row('IV-15', 'A(B)')[k] / row('IV-17', 'A(B)')[k] - 1];
    const fromFigure = ka * Math.abs(V[k] * Ydr[k] + l * Ndr[k] + z * Ldr[k]);
    const heightFt = H[k] === 'SL' ? 0 : Number(String(H[k]).replace('K', '')) * 1000, name = heightFt ? String(heightFt) : 'SL';
    // The file's rule: 1 at Mach 0, a straight line to the curve's first point (condition 1, Mach 0.206, is below it).
    const factor = along([[0, 1], ...flex[name]], M[k]), ratio = fromTables[0] / fromFigure;
    say(`condition ${fc} (Mach ${M[k]}, ${heightFt.toLocaleString('en-US')} ft): K from tables IV-15 and IV-17 ${fromTables.map((x) => x.toFixed(3)).join(' (yaw rate) and ')} (sideslip); from figure IV-7 with table IV-13 ${fromFigure.toFixed(3)}; their ratio ${ratio.toFixed(3)}; figure IV-6's flexure factor there ${factor.toFixed(3)}${covers(flex[name], M[k]) ? '' : ' (between 1 at Mach 0 and the curve\'s first point)'}; within 0.035 (the figure's reading error, 0.01 to 0.03)`);
    assert.ok(Math.abs(fromTables[0] - fromTables[1]) < 0.02, `the two numerators agree at condition ${fc}`);
    assert.ok(Math.abs(ratio - factor) <= 0.035, `condition ${fc}: ${ratio} against ${factor}`);
  }
});

test('f4c fcs: the game never writes a test switch: its inputs are the seven controls and the copilot\'s', async () => {
  const flight = Flight.start(await module(), F4C, { settleSeconds: 0 });
  assert.deepEqual(flight.inputNames.filter((name) => name.startsWith('fcs/test/') || name.startsWith('fcs/stick/')), []);
  for (const [name, value] of [['fcs/test/straight', 0], ['fcs/test/pitch-damper', 1], ['fcs/test/roll-damper', 1], ['fcs/test/yaw-damper', 1], ['fcs/test/bobweight', 1], ['fcs/stick/trimming', 0]]) assert.equal(flight.get(name), value, `${name}: the real jet`);
  flight.dispose();
});

test('f4c fcs: the feel system\'s static stiffness at three flight states equals CR-2144\'s within 2%, and the stabilator moves 3.36 degrees per inch', async () => {
  const m = await module();
  for (const fc of [2, 6, 8]) {
    const c = NINE.find((x) => x.fc === fc);
    const { flight } = atCondition(m, c, { sets: [['fcs/test/bobweight', 0], ['fcs/test/pitch-damper', 0]] });
    const trimStabilator = flight.get('fcs/stick/trim-stabilator-deg');
    // A small pull: a twentieth of an inch at the trim's static spring.
    const pounds = 0.05 * flight.get('fcs/stick/static-lbs_in');
    // Held 8 s: off its stop the damper lets the bellows-pressure spring relax, and the stick creeps for a second or two.
    run(flight, 8, () => flight.fly({ pitch: stickFor(flight, pounds) }));
    const mach = flight.value('velocities/mach'), qbar = flight.get('aero/qbar-psf'), heightFt = flight.value('position/h-sl-ft');
    const inches = flight.get('fcs/stick/deflection-in'), ours = flight.get('fcs/stick/pilot-force-lbs') / inches, theirs = staticStiffness(mach, qbar, heightFt);
    const gearing = (flight.get('fcs/stabilator-cmd-deg') - trimStabilator) / inches;
    say(`${nameOf(c)}, held ${pounds.toFixed(2)} lb for 8 s (now Mach ${mach.toFixed(3)}, ${qbar.toFixed(0)} lb/sq ft, ${heightFt.toFixed(0)} ft, the damper ${damperFree(mach, heightFt) ? 'free' : 'on its stop'}): the stick ${inches.toFixed(4)} in, ${ours.toFixed(2)} lb/in; CR-2144 ${theirs.toFixed(2)} (${cite(BELLOWS_SPRING)}; ${cite(BELLOWS_PRESSURE_SPRING)}); ${percent(ours, theirs)}; within 2%. The stabilator ${gearing.toFixed(3)} degrees an inch; ${cite(PITCH_GEARING)}`);
    assert.ok(within(ours, theirs, 0.02), `${ours} lb/in against ${theirs}`);
    assert.ok(Math.abs(gearing - PITCH_GEARING.value) < 1e-9, `${gearing} degrees an inch`);
    assert.equal(flight.get('fcs/stick/damper-free'), damperFree(mach, heightFt) ? 1 : 0);
    flight.dispose();
  }
});

test('f4c fcs: the bobweight gives 5.35 lb per g within 2%', async () => {
  // Its g is the g where it is, 39.3 ft ahead: JSBSim's own g at the centre of gravity plus the pitching
  // acceleration's share there. Read as the change over a pull held 5 s.
  const m = await module(), c = NINE.find((x) => x.fc === 2), { flight } = atCondition(m, c), l = REFERENCE.BOBWEIGHT_STATION.value;
  const there = () => flight.value('accelerations/Nz') + (flight.get('accelerations/qdot-rad_sec2') * l) / 32.174;
  // JSBSim's accelerometer reads the accelerations a step late (they are worked out after the flight
  // controls), so the bobweight at each step is set beside the g of the step before; averaged over the last second.
  const g0 = there(), bob0 = flight.get('fcs/stick/bobweight-lbs'), bobs = [], gs = [];
  let before = g0;
  run(flight, 5, (t) => { flight.fly({ pitch: stickFor(flight, 8) }); if (t >= 4) { bobs.push(flight.get('fcs/stick/bobweight-lbs') - bob0); gs.push(before - g0); } before = there(); });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length, dg = mean(gs), ours = mean(bobs) / dg;
  say(`${nameOf(c)}, an 8 lb pull held 5 s: over its last second ${dg.toFixed(3)} g more where the bobweight is (JSBSim's own g at the centre of gravity, and ${REFERENCE.BOBWEIGHT_STATION.value} ft of pitching acceleration ahead), and ${mean(bobs).toFixed(3)} lb more from the bobweight: ${ours.toFixed(3)} lb per g; ${cite(BOBWEIGHT)}; within 2%`);
  assert.ok(dg > 0.4 && within(ours, BOBWEIGHT.value, 0.02), `${ours} lb per g over ${dg} g`);
  flight.dispose();
});

/** CR-2144-style first-order checks: the response of a transfer function to a recorded input, held between steps. */
/** K s / (s + a), a washout, on a record of samples held between steps: K times the input less its lag a / (s + a). */
function washoutOf(K, a, samples) {
  const lag = respondLinear({ numerator: [a], denominator: [1, a] }, (t) => samples[Math.round(t / DT)] ?? 0, DT, (samples.length - 1) * DT);
  return samples.map((u, i) => K * (u - lag[i].x));
}

test('f4c fcs: each damper\'s response to its rate matches its transfer function within 2%, and respects its authority', async () => {
  const m = await module(), c = NINE.find((x) => x.fc === 6);
  // Pitch: a push of a second, the pitch rate and the damper's stabilator. The filter's input at a step is the rate JSBSim had then.
  {
    const { flight } = atCondition(m, c);
    const q = [], out = [];
    run(flight, 6, (t) => { q.push(flight.value('velocities/q-rad_sec')); out.push(flight.get('fcs/pitch-damper/stabilator-deg')); flight.fly({ pitch: stickFor(flight, t < 1 ? -3 : 0) }); });
    flight.dispose();
    const [K, a] = PITCH_DAMPER.value, wanted = washoutOf(K * DEG, a, q.map((x) => x - q[0]));
    const peak = Math.max(...out.map(Math.abs)), off = Math.max(...out.map((x, i) => Math.abs(x - wanted[i])));
    say(`pitch damper at ${nameOf(c)}, a 3 lb push for 1 s: its stabilator up to ${peak.toFixed(4)} degrees; the most it differs from ${K} s / (s + ${a}) on the pitch rate is ${off.toFixed(5)} degrees, ${(off / peak * 100).toFixed(2)}% of its peak (${cite(PITCH_DAMPER)}); within 2%`);
    assert.ok(peak > 0.01 && off <= 0.02 * peak);
  }
  // Roll: a second of aileron, then the stick in the middle: the damper's aileron against the roll rate.
  {
    const { flight } = atCondition(m, c);
    let off = 0, peak = 0;
    run(flight, 4, (t) => {
      if (t > 1.2) { const want = ROLL_DAMPER.value * flight.value('velocities/p-rad_sec') * DEG, got = flight.get('fcs/roll-damper/aileron-deg'); off = Math.max(off, Math.abs(got - want)); peak = Math.max(peak, Math.abs(want)); }
      flight.fly({ roll: t < 1 ? 0.1 : 0 });
    });
    flight.dispose();
    say(`roll damper at ${nameOf(c)}, after a second of a tenth of full stick: the damper's aileron within ${off.toExponential(2)} degrees of ${ROLL_DAMPER.value} times the roll rate (up to ${peak.toFixed(3)} degrees) (${cite(ROLL_DAMPER)})`);
    assert.ok(peak > 0.05 && off <= 0.02 * peak);
  }
  // Yaw: a second of rudder: the damper's rudder against 3 s / (s + 0.5) on the tilted gyro plus 0.0168 on the accelerometer.
  {
    const holder = {}, { flight } = atCondition(m, c, { assists: rudderFeet(holder) });
    holder.flight = flight;
    flight.rudderDeg = 0;
    const gyro = [], accel = [], out = [], tilt = YAW_GYRO_TILT.value / DEG;
    run(flight, 6, (t) => {
      gyro.push(flight.value('velocities/r-rad_sec') * Math.cos(tilt) + flight.value('velocities/p-rad_sec') * Math.sin(tilt));
      accel.push(flight.get('fcs/yaw-damper/lateral-accel-fps2'));
      out.push(flight.get('fcs/yaw-damper/rudder-deg'));
      flight.rudderDeg = t < 1 ? 1 : 0;
    });
    flight.dispose();
    const [K, a, ka] = YAW_DAMPER.value, washed = washoutOf(K * DEG, a, gyro.map((x) => x - gyro[0]));
    const wanted = washed.map((x, i) => x + ka * DEG * accel[i]);
    const peak = Math.max(...out.map(Math.abs)), off = Math.max(...out.map((x, i) => Math.abs(x - wanted[i])));
    say(`yaw damper at ${nameOf(c)}, a degree of rudder for 1 s: its rudder up to ${peak.toFixed(4)} degrees; the most it differs from ${K} s / (s + ${a}) on the gyro plus ${ka} on the accelerometer is ${off.toFixed(5)} degrees, ${(off / peak * 100).toFixed(2)}% of its peak (${cite(YAW_DAMPER)})`);
    assert.ok(peak > 0.05 && off <= 0.02 * peak);
  }
  // Authority: started turning hard every way at once, each damper at its limit.
  for (const sign of [1, -1]) {
    const flight = Flight.start(m, F4C, { assists: null, settleSeconds: 0, terrain: GROUND, controls: { gear: false, brake: false, throttle: 0.5 },
      sets: [['ic/h-sl-ft', 20000], ['ic/vc-kts', 350], ['ic/p-rad_sec', sign * 2], ['ic/q-rad_sec', sign * 1], ['ic/r-rad_sec', sign * 1]] });
    assert.equal(flight.step(1), 0);
    const pitch = flight.get('fcs/pitch-damper/stabilator-deg'), roll = flight.get('fcs/roll-damper/aileron-deg'), yaw = flight.get('fcs/yaw-damper/rudder-deg');
    flight.dispose();
    say(`turning hard ${sign > 0 ? 'one way' : 'the other'} (2 rad/s of roll, 1 of pitch and yaw): pitch damper ${pitch.toFixed(2)} degrees (its limit 3.5, Reasoned), roll damper ${roll.toFixed(2)} (5, Reasoned), yaw damper ${yaw.toFixed(2)} (${cite(YAW_DAMPER_AUTHORITY)})`);
    assert.equal(pitch, sign * 3.5);
    assert.equal(roll, -sign * 5);
    assert.equal(Math.abs(yaw), YAW_DAMPER_AUTHORITY.value);
  }
});

test('f4c fcs: the actuators reach 63% of a small step in the lag\'s time constant and never move faster than their rate limits', async () => {
  const m = await module();
  // Each surface stepped through a cockpit control a test copilot works (the rudder read at its actuator, before
  // the flexure, which is the air's and not the actuator's): the stabilator by its trim, the rudder
  // by the feet, the ailerons and spoilers by the stick; the dampers out, so that the step is all there is.
  let clock = 0, size = 0;
  const step = () => (clock >= 0.5 ? size : 0);
  const cases = [
    ['stabilator', 'fcs/elevator-pos-deg', 60, { trim: null, feet: { to: 'fcs/pitch-trim-cmd-norm', sign: 1, law: () => step() / STABILATOR_TRAVEL.value[0] } }, (d) => -d],
    ['rudder', 'fcs/rudder-actuator', 120, { trim: null, feet: { to: 'fcs/rudder-cmd-norm', sign: 1, law: () => step() / 30 } }, (d) => d],
    ['left aileron', 'fcs/left-aileron-pos-deg', 80, null, (d) => d],
    ['right spoiler', 'fcs/right-spoiler-pos-deg', 80, null, (d) => d * SPOILER_PER_AILERON.value],
  ];
  for (const [what, read, limit, assists, expect] of cases) {
    for (const degrees of [1, 20]) {
      size = degrees;
      clock = 0;
      const flight = Flight.start(m, F4C, { assists: assists ? { ...F4C.assists, ...assists } : null, settleSeconds: 0, terrain: GROUND,
        controls: { gear: false, brake: false, throttle: 0.5 }, sets: [['ic/h-sl-ft', 20000], ['ic/vc-kts', 350], ['fcs/test/pitch-damper', 0], ['fcs/test/roll-damper', 0], ['fcs/test/yaw-damper', 0], ['fcs/test/bobweight', 0]] });
      const from = flight.get(read), seen = [];
      run(flight, 1.5, (t) => {
        clock = t;
        if (!assists) flight.fly({ roll: step() / 30 });
        seen.push({ t, x: flight.get(read) - from });
      });
      flight.dispose();
      const target = expect(degrees);
      const fastest = Math.max(...seen.slice(1).map((s, i) => Math.abs(s.x - seen[i].x) / DT));
      const at = (t) => seen.find((s) => s.t >= t - 1e-9).x;
      // The command steps at the start of the step after 0.5 s; the actuator answers from the step after.
      const share = at(0.5 + DT + ACTUATOR_LAG.value) / target;
      say(`${what}, a step of ${Math.abs(target).toFixed(2)} degrees: ${(share * 100).toFixed(1)}% of it ${ACTUATOR_LAG.value} s after the step; fastest ${fastest.toFixed(1)} deg/s, its limit ${limit} (Reasoned, the file)`);
      if (degrees === 1) assert.ok(Math.abs(share - (1 - Math.exp(-1))) < 0.03, `${what}: ${share} of the step at the lag's time constant`);
      assert.ok(fastest <= limit + 1e-6, `${what}: ${fastest} deg/s`);
    }
  }
});

test(`f4c fcs: an airborne start at ${WINGS_NEUTRAL_SPEED.value} knots and 2,000 ft is level, steady and hands-off (stick force zero) for 60 s; and the copilot's neutral trim is still JSBSim's own there`, async () => {
  const m = await module(), { trim } = F4C.assists;
  const flight = inTheAir(m, { heightFt: trim.heightFt, knots: trim.knots });
  const found = flight.trimmed.jsbsim.pitchTrim, stored = new Map(trim.sets).get('fcs/pitch-trim-cmd-norm');
  assert.equal(flight.trimmed.pitch, 0, 'no force on the stick');
  const seen = { slow: Infinity, fast: -Infinity, low: Infinity, high: -Infinity, bank: 0, force: 0 };
  run(flight, 60, () => {
    const kt = flight.value('velocities/vc-kts'), ft = flight.value('position/h-sl-ft');
    seen.slow = Math.min(seen.slow, kt); seen.fast = Math.max(seen.fast, kt); seen.low = Math.min(seen.low, ft); seen.high = Math.max(seen.high, ft);
    seen.bank = Math.max(seen.bank, Math.abs(flight.value('attitude/phi-rad') * DEG)); seen.force = Math.max(seen.force, Math.abs(flight.get('fcs/stick/pilot-force-lbs')));
  });
  flight.dispose();
  say(`neutral trim with the feel system in: JSBSim's own pitch trim at ${trim.knots} kt and ${trim.heightFt} ft ${found.toFixed(4)}; the copilot's ${stored}; within 0.002. Hands-off 60 s: ${seen.slow.toFixed(2)} to ${seen.fast.toFixed(2)} kt, ${seen.low.toFixed(1)} to ${seen.high.toFixed(1)} ft, bank up to ${seen.bank.toFixed(2)} degrees, stick force up to ${seen.force} lb (lines: 3 kt, 50 ft, 5 degrees, as tests/f4c-aero.test.js)`);
  assert.ok(Math.abs(found - stored) <= 0.002);
  assert.equal(seen.force, 0);
  assert.ok(seen.slow >= trim.knots - 3 && seen.fast <= trim.knots + 3 && seen.low >= trim.heightFt - 50 && seen.high <= trim.heightFt + 50 && seen.bank <= 5);
});

test('f4c fcs: at 120 steps a second nothing oscillates and grows hands-off; a quick 20 lb pull and release dies away within 5 s (the stick\'s own natural period reported; its swing is left out, the plan\'s fallback)', async () => {
  const m = await module();
  for (const fc of [2, 3, 6, 9, 10]) {
    const c = NINE.find((x) => x.fc === fc), { flight } = atCondition(m, c);
    // A swing bends the stick's path; a slow drift (condition 2's tuck, CR-2144's own; condition 3's dive into
    // thicker air) hardly does. So the measure is the most the path bends from one step to the next (its
    // second difference), in the first 5 s and in the last.
    const travel = [];
    run(flight, 30, () => travel.push(flight.get('fcs/stick/deflection-in')));
    flight.dispose();
    const bend = (from, to) => { let most = 0; for (let k = Math.max(from, 1); k + 1 < to; k++) most = Math.max(most, Math.abs(travel[k + 1] - 2 * travel[k] + travel[k - 1])); return most; };
    const early = bend(0, Math.round(5 / DT)), late = bend(travel.length - Math.round(5 / DT), travel.length);
    say(`${nameOf(c)}, hands-off 30 s: the most the stick's path bends in a step ${early.toExponential(2)} in over the first 5 s, ${late.toExponential(2)} in over the last`);
    assert.ok(late <= Math.max(1e-6, early), 'no swing grows');
  }
  const flight = inTheAir(m, { heightFt: 2000, knots: 350 }), K = flight.get('fcs/stick/quick-lbs_in');
  const stick = [], rate = [];
  run(flight, 6, (t) => { flight.fly({ pitch: stickFor(flight, t < 0.2 ? 20 : 0) }); stick.push({ t, x: flight.get('fcs/stick/deflection-in') }); rate.push({ t, x: flight.value('velocities/q-rad_sec') }); });
  flight.dispose();
  const after = (record, t0) => record.filter((s) => s.t >= t0);
  const peakStick = Math.max(...stick.map((s) => Math.abs(s.x))), peakRate = Math.max(...rate.map((s) => Math.abs(s.x)));
  const leftStick = Math.max(...after(stick, 5.2).map((s) => Math.abs(s.x))), leftRate = Math.max(...after(rate, 5.2).map((s) => Math.abs(s.x)));
  const natural = 2 * Math.PI / Math.sqrt(K / STICK_INERTIA.value);
  say(`at 350 kt and 2,000 ft, 20 lb for 0.2 s and let go: the stick up to ${peakStick.toFixed(3)} in and the pitch rate up to ${(peakRate * DEG).toFixed(2)} deg/s; 5 s after letting go ${(leftStick / peakStick * 100).toFixed(2)}% and ${(leftRate / peakRate * 100).toFixed(2)}% of those are left (line: it dies away, under 5%). The stick's own swing is left out (the plan's fallback: aircraft/f4c/f4c.xml, "The stick itself"); with CR-2144's ${cite(STICK_INERTIA)} its natural period there would be ${natural.toFixed(3)} s (its spring ${K.toFixed(1)} lb/in)`);
  assert.ok(leftStick < 0.05 * peakStick && leftRate < 0.05 * peakRate);
});

// ---- 2. The plan's lines at CR-2144's nine conditions ----

/** The push of the stick pulse: the force that would hold the stabilator a quarter of a degree down at the condition's static spring. */
const PUSH = { degrees: 0.25, seconds: 1, record: 20 }, KICK = { degrees: 1, seconds: 1, record: 30 };
const pulse = (size, seconds) => (t) => (t < seconds ? size : 0);
const crResponse = (table, block, fc, input, seconds, timesS) => respondLinear(transferFunction(factorsOf(CR.tables[table], block, fc), factorsOf(CR.tables[table], 'DENOMINATOR', fc), timesS ? [{ root: 0 }] : []), input, DT, seconds);

function pullPulse(m, c, table) {
  const { flight, diveDeg } = atCondition(m, c, { sets: table === 'IV-6' ? [['fcs/test/pitch-damper', 0]] : [] });
  const pounds = -(PUSH.degrees / -PITCH_GEARING.value) * flight.get('fcs/stick/static-lbs_in'), q0 = flight.value('velocities/q-rad_sec'), out = [];
  for (let k = 0; k <= Math.round(PUSH.record / DT); k++) {
    const t = k * DT;
    out.push({ t, x: (flight.value('velocities/q-rad_sec') - q0) * DEG });
    flight.fly({ pitch: stickFor(flight, pulse(pounds, PUSH.seconds)(t)) });
    assert.equal(flight.step(1), 0);
  }
  flight.dispose();
  // CR-2144's theta / F_ST is in radians per pound: times s for the pitch rate, and in degrees.
  const theirs = crResponse(table, 'N(THE/FST)', c.fc, pulse(pounds * DEG, PUSH.seconds), PUSH.record, true);
  return { ...measuresBeside(out, theirs, PUSH.seconds), pounds, diveDeg, record: out };
}

function rudderPulse(m, c) {
  const holder = {}, { flight, diveDeg } = atCondition(m, c, { assists: rudderFeet(holder), sets: [['fcs/test/roll-damper', 0]] });
  holder.flight = flight;
  flight.rudderDeg = 0;
  // CR-2144's tables are per degree of the flexed rudder: the pilot's share goes in as the command that gives
  // one degree of it at this condition (the pedal over the flexure factor); the damper's goes through the flexure.
  const flexure = flight.get('fcs/rudder-flexure'), r0 = flight.value('velocities/r-rad_sec'), out = [];
  for (let k = 0; k <= Math.round(KICK.record / DT); k++) {
    const t = k * DT;
    out.push({ t, x: (flight.value('velocities/r-rad_sec') - r0) * DEG });
    flight.rudderDeg = pulse(KICK.degrees / flexure, KICK.seconds)(t);
    assert.equal(flight.step(1), 0);
  }
  flight.dispose();
  const theirs = crResponse('IV-17', 'N(R /DR)', c.fc, pulse(KICK.degrees, KICK.seconds), KICK.record, false);
  return { ...measuresBeside(out, theirs, KICK.seconds), diveDeg, flexure };
}

const PULL_LINES = [
  ['IV-6', 'a pull on the stick, augmentation off: table IV-6 (the bobweight in the loop)', 'pitch rate', pullPulse],
  ['IV-10', 'a pull on the stick, augmentation on: table IV-10', 'pitch rate', pullPulse],
];
const LINES = [
  ['IV-17', 'a rudder pulse, yaw augmentation on and the roll damper switched out, as CR-2144 has it: table IV-16 (the rudder\'s, SAS on, is IV-17 in the record)', 'yaw rate', (m, c) => rudderPulse(m, c)],
];

test('f4c fcs: CR-2144\'s tables for these lines are what the plan says they are', () => {
  assert.match(CR.tables['IV-6'].title, /STICK FORCE TRANSFER FUNCTION FACTORS {2}SAS Off - Bobweight Loop Closed/);
  assert.match(CR.tables['IV-10'].title, /STICK FORCE TRANSFER FUNCTION FACTORS {2}SAS On - Bobweight Loop Closed/);
  assert.match(CR.tables['IV-16'].title, /AILERON TRANSFER FUNCTION FACTORS {2}SAS On/);
  assert.match(CR.tables['IV-17'].title, /RUDDER TRANSFER FUNCTION FACTORS {2}SAS On/);
  // IV-17's gain rows were read once in the record; read again from the page image (PDF p.111) for this pull request: A(R) as the record has it.
  assert.deepEqual(CR.tables['IV-17'].rows.find((row) => row.label.trim() === 'A(R)').values, [-0.641, -5.26, -6.57, -4.06, -1.22, -2.17, -2.73, -1.91, -1.84, -1.27]);
});

const flown = new Map();
const flyLine = async (table, fly, c) => { const key = `${table} ${c.fc}`; if (!flown.has(key)) flown.set(key, fly(await module(), c, table)); return flown.get(key); };

for (const [table, line, what, fly] of LINES) {
  for (const c of NINE) {
    test(`f4c fcs at ${nameOf(c)}: "${line}": "time to the first peak within 15%, the peak within 15%"`, async () => {
      const { ours, theirs, diveDeg, pounds, flexure } = await flyLine(table, fly, c);
      say(`${nameOf(c)}${diveDeg ? ` (in a dive of ${diveDeg.toFixed(1)} degrees)` : ''}, ${pounds === undefined ? `${KICK.degrees} degree of rudder for ${KICK.seconds} s (the pedals ${(KICK.degrees / flexure).toFixed(3)} degrees: the flexure factor here is ${flexure.toFixed(3)})` : `a push of ${(-pounds).toFixed(2)} lb for ${PUSH.seconds} s`}, the ${what}: first peak ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s; CR-2144's table ${table}: ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}; the time ${percent(ours.peakTime, theirs.peakTime)}, the peak ${percent(ours.peak, theirs.peak)}; within 15%`);
      assert.ok(within(ours.peakTime, theirs.peakTime, 0.15), `time to the first peak: ${ours.peakTime} s, CR-2144 ${theirs.peakTime}`);
      assert.ok(within(ours.peak, theirs.peak, 0.15), `the peak: ${ours.peak}, CR-2144 ${theirs.peak}`);
    });
    test(`f4c fcs at ${nameOf(c)}: "${line}": "the time to die to half within 25%. Where CR-2144's motion dies away, ours must"`, async () => {
      const { ours, theirs } = await flyLine(table, fly, c);
      say(`${nameOf(c)}, the ${what} after the pulse (table ${table}): its swings die to half in ${ours.halfTime.toFixed(2)} s; CR-2144's ${theirs.halfTime.toFixed(2)} s; ${percent(ours.halfTime, theirs.halfTime)}; within 25%`);
      // Where CR-2144's response has no two swings to time, or does not die to half in the record, there is no line to hold.
      if (Number.isFinite(theirs.halfTime)) {
        assert.ok(Number.isFinite(ours.halfTime), 'ours dies away');
        assert.ok(within(ours.halfTime, theirs.halfTime, 0.25), `time to die to half: ${ours.halfTime} s, CR-2144 ${theirs.halfTime}`);
      }
    });
  }
}

// ---- The pull against IV-6 and IV-10: the plan's lines as written, reported; and the lines that hold ----
//
// The plan's lines lay JSBSim's response to a pull beside CR-2144's printed tables IV-6 and IV-10. Those tables
// have the stick's own mass and damping in them, and the aircraft file leaves them out (the plan's fallback,
// aircraft/f4c/f4c.xml, "The stick itself"), so those lines cannot be met as written: they are flown and
// reported here, every number kept, each marked where it is not met, with no assertion; accepting that is the
// owner's. The lines that are asserted, written before they were run (the coordinator's, pull request 6, round 2):
//   N1  CR-2144's own linear model built here (tests/checkride/cr2144-pitch.js), the stick's mass and damping
//       in, against the printed tables IV-6 and IV-10 at the nine conditions: the time to the first peak within
//       10%, the peak within 10%. A check of our reading of the report's figures against the report: Verified.
//   N2  the same model with the stick's mass and damping out, as the aircraft file has them, against JSBSim's
//       response to the same pull, augmentation off and on, by pull request 5's three lines unchanged: the
//       time to the first peak within 15%, the peak within 15%, the time to die to half within 25%; where the
//       model's motion dies away, ours must.

test('f4c fcs, reported (no pass or fail): the plan\'s lines as written, the pull against CR-2144\'s printed tables IV-6 and IV-10, which have the stick\'s own swing that the aircraft file leaves out', async () => {
  const notMet = [];
  for (const [table, line] of PULL_LINES) {
    for (const c of NINE) {
      const { ours, theirs, diveDeg, pounds } = await flyLine(table, pullPulse, c);
      const checks = [['the time to the first peak', ours.peakTime, theirs.peakTime, 0.15], ['the peak', ours.peak, theirs.peak, 0.15]];
      if (Number.isFinite(theirs.halfTime)) checks.push(['the time to die to half', ours.halfTime, theirs.halfTime, 0.25]);
      const missed = checks.filter(([, a, b, share]) => !(Number.isFinite(a) && within(a, b, share)));
      say(`${nameOf(c)}${diveDeg ? ` (in a dive of ${diveDeg.toFixed(1)} degrees)` : ''}, "${line}": a push of ${(-pounds).toFixed(2)} lb for ${PUSH.seconds} s, the pitch rate: first peak ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s, dying to half in ${ours.halfTime.toFixed(2)} s; CR-2144's table ${table}: ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}, ${theirs.halfTime.toFixed(2)} s; the time ${percent(ours.peakTime, theirs.peakTime)}, the peak ${percent(ours.peak, theirs.peak)}, the time to half ${percent(ours.halfTime, theirs.halfTime)}: ${missed.length ? `the plan's line as written: NOT MET (${missed.map(([what]) => what).join(', ')})` : 'met'}`);
      for (const [what, a, b, share] of missed) notMet.push({ table, condition: c.fc, mach: c.mach, heightFt: c.heightFt, what, ours: a, cr2144: b, by: a / b - 1, within: share });
    }
  }
  report.line(`  THE PLAN'S LINES AS WRITTEN AGAINST IV-6 AND IV-10, NOT MET: ${notMet.length}`);
  for (const n of notMet) report.line(`    ${n.table}, condition ${n.condition}: ${n.what} ${n.ours.toFixed(3)} against CR-2144's ${n.cr2144.toFixed(3)} (${percent(n.ours, n.cr2144)}; the line ${n.within * 100}%)`);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'checkride-f4c-fcs-not-met.json'), `${JSON.stringify(notMet, null, 1)}\n`);
});

test('f4c fcs, reported: the model\'s airframe alone, a quarter degree of stabilator for a second, beside CR-2144\'s table IV-4 (which its equations should give)', () => {
  for (const c of NINE) {
    const model = pitchModel(c.fc);
    const { ours, theirs } = measuresBeside(model.airframe(pulse(PUSH.degrees, PUSH.seconds), DT, PUSH.record), crResponse('IV-4', 'N(THE/DS)', c.fc, pulse(PUSH.degrees, PUSH.seconds), PUSH.record, true), PUSH.seconds);
    say(`${nameOf(c)}: the model's airframe, first peak ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s, to half in ${ours.halfTime.toFixed(2)} s; table IV-4 ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}, ${theirs.halfTime.toFixed(2)} s (${percent(ours.peak, theirs.peak)}, ${percent(ours.peakTime, theirs.peakTime)})`);
  }
});

for (const [table, damper] of [['IV-6', false], ['IV-10', true]]) {
  for (const c of NINE) {
    test(`f4c fcs at ${nameOf(c)}, N1: CR-2144's own linear model, the stick's mass and damping in, augmentation ${damper ? 'on' : 'off'}, against the printed table ${table}: the time to the first peak within 10%, the peak within 10%`, () => {
      const model = pitchModel(c.fc, { stick: true, damper }), pounds = -(PUSH.degrees / -PITCH_GEARING.value) * model.staticStiffness;
      const { ours, theirs } = measuresBeside(model.respond(pulse(pounds, PUSH.seconds), DT, PUSH.record), crResponse(table, 'N(THE/FST)', c.fc, pulse(pounds * DEG, PUSH.seconds), PUSH.record, true), PUSH.seconds);
      say(`N1, ${nameOf(c)}, ${table}: a push of ${(-pounds).toFixed(2)} lb for ${PUSH.seconds} s: the model ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s; printed ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}; the time ${percent(ours.peakTime, theirs.peakTime)}, the peak ${percent(ours.peak, theirs.peak)}; within 10%`);
      assert.ok(within(ours.peakTime, theirs.peakTime, 0.1), `time to the first peak: ${ours.peakTime} s, printed ${theirs.peakTime}`);
      assert.ok(within(ours.peak, theirs.peak, 0.1), `the peak: ${ours.peak}, printed ${theirs.peak}`);
    });
  }
}

for (const [table, damper] of [['IV-6', false], ['IV-10', true]]) {
  for (const c of NINE) {
    const model = () => pitchModel(c.fc, { stick: false, damper });
    const both = async () => {
      const { record, pounds } = await flyLine(table, pullPulse, c);
      return { ...measuresBeside(record, model().respond(pulse(pounds, PUSH.seconds), DT, PUSH.record), PUSH.seconds), pounds };
    };
    test(`f4c fcs at ${nameOf(c)}, N2: a pull, augmentation ${damper ? 'on' : 'off'}, beside CR-2144's model with the stick's mass and damping out: "time to the first peak within 15%, the peak within 15%"`, async () => {
      const { ours, theirs, pounds } = await both();
      say(`N2, ${nameOf(c)}, augmentation ${damper ? 'on' : 'off'}, a push of ${(-pounds).toFixed(2)} lb: JSBSim ${ours.peak.toFixed(4)} deg/s at ${ours.peakTime.toFixed(3)} s; the model ${theirs.peak.toFixed(4)} at ${theirs.peakTime.toFixed(3)}; the time ${percent(ours.peakTime, theirs.peakTime)}, the peak ${percent(ours.peak, theirs.peak)}; within 15%`);
      assert.ok(within(ours.peakTime, theirs.peakTime, 0.15), `time to the first peak: ${ours.peakTime} s, the model ${theirs.peakTime}`);
      assert.ok(within(ours.peak, theirs.peak, 0.15), `the peak: ${ours.peak}, the model ${theirs.peak}`);
    });
    test(`f4c fcs at ${nameOf(c)}, N2: a pull, augmentation ${damper ? 'on' : 'off'}, beside CR-2144's model with the stick's mass and damping out: "the time to die to half within 25%. Where CR-2144's motion dies away, ours must"`, async () => {
      const { ours, theirs } = await both();
      say(`N2, ${nameOf(c)}, augmentation ${damper ? 'on' : 'off'}: JSBSim's swings die to half in ${ours.halfTime.toFixed(2)} s; the model's ${theirs.halfTime.toFixed(2)} s; ${percent(ours.halfTime, theirs.halfTime)}; within 25%`);
      if (Number.isFinite(theirs.halfTime)) {
        assert.ok(Number.isFinite(ours.halfTime), 'ours dies away');
        assert.ok(within(ours.halfTime, theirs.halfTime, 0.25), `time to die to half: ${ours.halfTime} s, the model ${theirs.halfTime}`);
      }
    });
  }
}

test('f4c fcs: "JSBSim\'s trim still finds level flight with the feel system in, at all nine conditions" (the three that need it in the dive that holds the speed, as pull request 5)', async () => {
  const m = await module();
  for (const c of NINE) {
    const { flight, diveDeg } = atCondition(m, c), straight = atCondition(m, c, { sets: STRAIGHT });
    const steady = [flight.get('accelerations/udot-ft_sec2'), flight.get('accelerations/wdot-ft_sec2'), flight.get('accelerations/qdot-rad_sec2')];
    const stabilator = flight.get('fcs/elevator-pos-deg'), was = straight.flight.get('fcs/elevator-pos-deg');
    say(`${nameOf(c)}: ${diveDeg ? `in a dive of ${diveDeg.toFixed(1)} degrees (pull request 5's: ${straight.diveDeg.toFixed(1)})` : 'level'}; stick force ${flight.get('fcs/stick/pilot-force-lbs')} lb; the stabilator ${stabilator.toFixed(3)} degrees, with the stick straight ${was.toFixed(3)}; steady (${steady.map((x) => x.toExponential(1)).join(', ')})`);
    assert.ok(Math.abs(flight.value('velocities/mach') - c.mach) < 1e-3 && Math.abs(flight.value('position/h-sl-ft') - c.heightFt) < 1);
    assert.ok(Math.abs(steady[0]) < 0.01 && Math.abs(steady[1]) < 0.01 && Math.abs(steady[2]) < 1e-4, `steady: ${steady}`);
    assert.equal(flight.get('fcs/stick/pilot-force-lbs'), 0);
    assert.ok(Math.abs(stabilator - was) < 0.05, `${stabilator} against ${was}`);
    assert.equal(diveDeg, straight.diveDeg, 'the same dive as with the stick straight');
    flight.dispose(); straight.flight.dispose();
  }
});

test('f4c fcs: "The pull per g in a steady pull is within 15% of table IV-12\'s at sea level and Mach 0.8 (12.5 lb) and at 35,000 ft and Mach 0.9 (12.2 lb)"', async () => {
  // A steady pull: a pull and a push of the same size, each held 4 s, and the g each holds over its last
  // second (the pitch motion has settled; the speed has not had time to change much); the pull per g is the
  // difference in force over the difference in g.
  const m = await module();
  for (const [fc, theirs] of [[2, PULL_PER_G.value[0]], [6, PULL_PER_G.value[1]]]) {
    const c = NINE.find((x) => x.fc === fc), g = [];
    for (const pounds of [4, -4]) {
      const { flight } = atCondition(m, c), seen = [];
      run(flight, 4, (t) => { flight.fly({ pitch: stickFor(flight, pounds) }); if (t >= 3) seen.push(flight.value('accelerations/Nz')); });
      flight.dispose();
      g.push(seen.reduce((a, b) => a + b, 0) / seen.length);
    }
    const ours = 8 / (g[0] - g[1]);
    say(`${nameOf(c)}: 4 lb each way, held 4 s: ${g[0].toFixed(3)} and ${g[1].toFixed(3)} g over the last second: ${ours.toFixed(2)} lb per g; CR-2144 ${theirs} (${PULL_PER_G.source}, ${PULL_PER_G.where}); ${percent(ours, theirs)}; within 15%`);
    assert.ok(within(ours, theirs, 0.15), `${ours} lb per g`);
  }
});

/**
 * What full back tilt gives at a speed: the g while the jet passes that speed in a pull held from level flight
 * `above` knots faster, by which time the pitch motion the pull started has settled. No F-4 holds 8 g at a
 * steady speed (at 480 knots the drag is about three times the thrust), so "at 480 knots" is a moment, and a
 * pull begun at 480 would be read while the nose is still coming up: that reading is the peak of a swing,
 * not what the pull holds (Codex's finding on pull request 6, which read it so). `before` is the g over the
 * half second before the speed is passed: a settled pull changes little in it.
 */
function passing(m, knots, above = 80) {
  const flight = inTheAir(m, { heightFt: 0, knots: knots + above }), g = [];
  let out = null;
  run(flight, 10, (t) => {
    flight.fly({ pitch: 1 });
    g.push(flight.value('accelerations/Nz'));
    if (flight.value('velocities/vc-kts') > knots) return true;
    const before = g.slice(-Math.round(0.5 / DT) - 1);
    out = { g: g.at(-1), seconds: t, least: Math.min(...before), most: Math.max(...before), heightFt: flight.value('position/h-sl-ft'), alpha: flight.value('aero/alpha-rad') * DEG, pounds: flight.get('fcs/stick/pilot-force-lbs'), from: knots + above };
    return false;
  });
  assert.ok(out, `the pull from ${knots + above} kt slowed through ${knots}`);
  assert.equal(out.pounds, flight.get('fcs/stick/full-pull-lbs'), 'the full pull, read back');
  flight.dispose();
  return out;
}

test(`f4c fcs: "Full back tilt holds 8.5 g within 0.5 at 480 knots at sea level. At 450 knots it reaches the wing's most lift first: 7.4 to 8.2 g"`, async () => {
  const m = await module(), at480 = passing(m, 480), at450 = passing(m, 450);
  const line = (out, knots) => `passing ${knots} kt in a full pull (${out.pounds} lb) held from level flight at ${out.from} kt and sea level, ${out.seconds.toFixed(2)} s in and ${out.heightFt.toFixed(0)} ft up: ${out.g.toFixed(2)} g at ${out.alpha.toFixed(1)} degrees of angle of attack; over the half second before, ${out.least.toFixed(2)} to ${out.most.toFixed(2)} g`;
  say(`full back tilt, ${line(at480, 480)}; ${cite(G_LIMIT)}; within 0.5, and settled (the half second within 0.25 g)`);
  say(`full back tilt, ${line(at450, 450)}; the plan: 7.4 to 8.2 g (CR-2144's most lift gives 7.9): the g is falling as the wing gives out`);
  assert.ok(Math.abs(at480.g - G_LIMIT.value) <= 0.5, `${at480.g} g passing 480 kt`);
  assert.ok(at480.most - at480.least <= 0.25 && Math.abs(at480.least - G_LIMIT.value) <= 0.5 && Math.abs(at480.most - G_LIMIT.value) <= 0.5, `held: ${at480.least} to ${at480.most} g over the half second before`);
  assert.ok(at450.g >= 7.4 && at450.g <= 8.2, `${at450.g} g passing 450 kt`);
});

test('f4c fcs: "Full forward tilt holds -3 g within 0.5 at 480 knots at sea level"', async () => {
  // Held: every reading from 2 s to 4 s after the push, the speed still near 480 (a push costs little speed).
  // Begun 1,500 ft up, so that the push does not take it below sea level.
  const m = await module(), flight = inTheAir(m, { heightFt: 1500, knots: 480 }), g = [], knots = [];
  run(flight, 4, (t) => { flight.fly({ pitch: -1 }); if (t >= 2) { g.push(flight.value('accelerations/Nz')); knots.push(flight.value('velocities/vc-kts')); } });
  const pounds = flight.get('fcs/stick/pilot-force-lbs'), heightFt = flight.value('position/h-sl-ft');
  assert.equal(pounds, -flight.get('fcs/stick/full-push-lbs'), 'the full push, read back');
  flight.dispose();
  const least = Math.min(...g), most = Math.max(...g);
  say(`full forward tilt (a push of ${-pounds} lb) held from level flight at 480 kt and 1,500 ft: from 2 s to 4 s in, ${least.toFixed(2)} to ${most.toFixed(2)} g at ${Math.min(...knots).toFixed(0)} to ${Math.max(...knots).toFixed(0)} kt, ending ${heightFt.toFixed(0)} ft up; ${cite(WINGS_NEGATIVE_G)}; within 0.5`);
  assert.ok(Math.abs(least - WINGS_NEGATIVE_G.value) <= 0.5 && Math.abs(most - WINGS_NEGATIVE_G.value) <= 0.5, `${least} to ${most} g`);
  assert.ok(Math.min(...knots) > 460 && Math.max(...knots) < 500 && heightFt > 0, `${Math.min(...knots)} to ${Math.max(...knots)} kt, ${heightFt} ft`);
});

test('f4c fcs: "The roll damper is out whenever the sideways pull on the stick is more than 1.5 lb (the flight manual), and in below it"', async () => {
  const m = await module(), full = AILERON_TRAVEL.value / LATERAL_GEARING.value * LATERAL_FEEL.value, edge = ROLL_DAMPER_OUT_ABOVE.value / full;
  for (const stick of [0, 0.5 * edge, 0.99 * edge, 1.01 * edge, 0.5, 1, -0.99 * edge, -1.01 * edge]) {
    const flight = inTheAir(m, { heightFt: 2000, knots: 350 });
    let inside = null, damper = 0;
    run(flight, 1, () => { flight.fly({ roll: stick }); inside = flight.get('fcs/roll-damper/in'); damper = flight.get('fcs/roll-damper/aileron-deg'); });
    const pounds = flight.get('fcs/stick/lateral-force-lbs'), rate = flight.value('velocities/p-rad_sec') * DEG;
    flight.dispose();
    say(`sideways stick ${(stick * 100).toFixed(2)}% of full: ${pounds.toFixed(3)} lb (full stick ${full.toFixed(2)} lb: ${cite(LATERAL_FEEL)}, ${cite(LATERAL_GEARING)}); the roll damper ${inside ? 'in' : 'out'}, giving ${damper.toFixed(3)} degrees at ${rate.toFixed(1)} deg/s of roll; ${cite(ROLL_DAMPER_OUT_ABOVE)}`);
    assert.equal(inside, Math.abs(pounds) > ROLL_DAMPER_OUT_ABOVE.value ? 0 : 1);
    if (!inside) assert.equal(Math.abs(damper), 0);
  }
  say(`the edge: ${(edge * 100).toFixed(1)}% of full sideways stick`);
});

test('f4c fcs: "Full right tilt moves the right spoiler up 45 degrees and the left aileron down 30 degrees within 1 degree"', async () => {
  const m = await module(), flight = inTheAir(m, { heightFt: 2000, knots: 350 });
  run(flight, 1, () => flight.fly({ roll: 1 }));
  const spoiler = flight.get('fcs/right-spoiler-pos-deg'), aileron = flight.get('fcs/left-aileron-pos-deg'), flush = [flight.get('fcs/left-spoiler-pos-deg'), flight.get('fcs/right-aileron-pos-deg')];
  flight.dispose();
  say(`full right tilt for 1 s at 350 kt: left aileron ${aileron.toFixed(2)} degrees down (${cite(AILERON_TRAVEL)}); right spoiler ${spoiler.toFixed(2)} up (${cite(SPOILER_TRAVEL)}): ${SPOILER_PER_AILERON.value} times the aileron (${cite(SPOILER_PER_AILERON)}; AFWAL's F-4J has ${cite(REFERENCE.AFWAL_SPOILER_PER_AILERON)}, CR-2144 ${cite(SPOILER_PER_AILERON_CR)}). The other two ${flush.map((x) => x.toFixed(4)).join(' and ')}`);
  assert.ok(Math.abs(aileron - AILERON_TRAVEL.value) <= 1, `left aileron ${aileron}`);
  assert.ok(flush.every((x) => Math.abs(x) < 0.01), `the other two: ${flush}`);
  assert.ok(Math.abs(spoiler - SPOILER_TRAVEL.value) <= 1, `right spoiler ${spoiler} degrees; the line is ${SPOILER_TRAVEL.value}`);
});

test('f4c fcs: "Flaps down and below 230 knots, full right tilt gives 15 degrees of right rudder within 2 degrees from the interconnect; flaps up, or faster, none"', async () => {
  const m = await module();
  // The file has no flaps yet (pull request 7): a start sets fcs/flap-pos-norm, as the plan says. No trim: started by values, level at the speed.
  for (const [knots, flaps] of [[200, 1], [200, 0], [260, 1], [220, 1]]) {
    const flight = Flight.start(m, F4C, { assists: null, settleSeconds: 0, terrain: GROUND, controls: { gear: false, brake: false, throttle: 0.6, roll: 1 },
      sets: [['ic/h-sl-ft', 5000], ['ic/vc-kts', knots], ['ic/alpha-deg', 8], ['fcs/flap-pos-norm', flaps]] });
    assert.equal(flight.get('fcs/flap-pos-norm'), flaps);
    run(flight, 0.5);
    const interconnect = flight.get('fcs/interconnect/rudder-deg'), rudder = flight.get('fcs/rudder-pos-deg'), kt = flight.value('velocities/vc-kts');
    flight.dispose();
    const wanted = flaps && kt < INTERCONNECT_BELOW_KNOTS.value ? -INTERCONNECT_LIMIT.value[0] : 0;
    say(`${flaps ? 'flaps down' : 'flaps up'} at ${kt.toFixed(0)} kt, full right tilt for half a second: the interconnect gives ${(-interconnect).toFixed(2)} degrees of right rudder (the rudder stands at ${(-rudder).toFixed(2)} right, the yaw damper's share in it); wanted ${-wanted} (${cite(INTERCONNECT_GAIN)}; ${cite(INTERCONNECT_LIMIT)}; ${cite(INTERCONNECT_BELOW_KNOTS)}); within 2`);
    assert.ok(Math.abs(interconnect - wanted) <= 2, `${interconnect}`);
  }
});

test('f4c fcs, reported (no pass or fail): g at full back tilt at 250, 350, 550 and 650 knots at sea level and at Mach 0.9 and 1.5 at 35,000 ft; roll rate at full tilt at 250, 400 and 600 knots, beside Wings\'', async () => {
  const m = await module();
  // As the line above: the g while passing the speed in a full pull held from 80 knots faster (40 for 650:
  // the engines cannot hold 730 knots level at sea level).
  for (const knots of [250, 350, 550, 650]) {
    const out = passing(m, knots, knots === 650 ? 40 : 80);
    say(`full back tilt, passing ${knots} kt at sea level (the pull held from ${out.from} kt): ${out.g.toFixed(2)} g at ${out.alpha.toFixed(1)} degrees of angle of attack; over the half second before, ${out.least.toFixed(2)} to ${out.most.toFixed(2)} g${knots === 250 ? `; Wings ${WINGS_G_AT_FULL_TILT.value[0]}` : knots === 350 ? `; Wings ${WINGS_G_AT_FULL_TILT.value[1]}` : ''}`);
  }
  for (const c of [{ mach: 0.9, heightFt: 35000 }, { mach: 1.5, heightFt: 35000 }]) {
    let started;
    try { started = atCondition(m, { ...c, fc: 0 }); } catch (e) { say(`full back tilt at Mach ${c.mach} and 35,000 ft: not flown, JSBSim's trim cannot start it there (${e.message})`); continue; }
    const { flight, diveDeg } = started, out = { most: -Infinity };
    run(flight, 5, () => { flight.fly({ pitch: 1 }); out.most = Math.max(out.most, flight.value('accelerations/Nz')); });
    flight.dispose();
    say(`full back tilt at Mach ${c.mach} and 35,000 ft${diveDeg ? ` (from a dive of ${diveDeg.toFixed(1)} degrees)` : ''}: the most g ${out.most.toFixed(2)}`);
  }
  // Wings' way of measuring a roll (its checkride, "GRADED: roll rate"): full stick from level flight, the average from 1.5 to 3 s in. At 1,000 ft: JSBSim's trim fails at sea level itself over this ground only if it lies on it; 1,000 ft as tests/f4c-aero.test.js.
  for (const [knots, wings] of [[250, WINGS_ROLL_RATE_250], [400, WINGS_ROLL_RATE_400], [600, WINGS_ROLL_RATE_600]]) {
    const flight = inTheAir(m, { heightFt: 1000, knots }), rates = [];
    run(flight, 3, (t) => { flight.fly({ roll: 1 }); if (t >= 1.5) rates.push(flight.value('velocities/p-rad_sec') * DEG); });
    flight.dispose();
    say(`full right tilt at ${knots} kt and 1,000 ft: roll rate ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(0)} deg/s (1.5 to 3 s in); Wings ${cite(wings)}`);
  }
});

// ---- 4. A two-minute flight's tape, in native JSBSim ----

test('f4c fcs: a two-minute flight with pulls, rolls and throttle changes, the real flight controls in, replays in native JSBSim by milestone 1\'s lines', async () => {
  // As tests/f4c-conditions.test.js: a twin is trimmed at 350 kt and 10,000 ft, and the taped flight starts where it stood, by values alone.
  const modules = {}, tapes = {}, at = { heightFt: 10000, knots: 350 };
  let seen;
  for (const variant of VARIANTS) {
    const m = modules[variant] = await moduleWith(F4C, variant);
    const twin = inTheAir(m, at), hold = { ...twin.trimmed }, alpha = twin.get('aero/alpha-deg'), turning = twin.get('propulsion/engine[0]/n2');
    twin.dispose();
    const assists = { ...F4C.assists, trim: { ...F4C.assists.trim, sets: [['fcs/pitch-trim-cmd-norm', hold.heldPitchTrim]] } };
    const flight = Flight.start(m, F4C, {
      record: true, settleSeconds: 0, terrain: GROUND, assists, controls: { gear: false, flaps: false, brake: false, throttle: hold.throttle, pitch: 0, roll: hold.roll },
      sets: [['ic/h-sl-ft', at.heightFt], ['ic/vc-kts', at.knots], ['ic/alpha-deg', alpha], ['propulsion/engine[0]/n2', turning], ['propulsion/engine[1]/n2', turning]],
    });
    seen = { g: [Infinity, -Infinity], bank: [Infinity, -Infinity], knots: [Infinity, -Infinity] };
    const widen = (range, x) => { range[0] = Math.min(range[0], x); range[1] = Math.max(range[1], x); };
    run(flight, 120, (t) => {
      const pitch = t >= 5 && t < 7 ? 0.2 : t >= 30 && t < 32 ? 0.35 : t >= 60 && t < 61 ? -0.2 : t >= 95 && t < 97 ? 0.3 : 0;
      const roll = t >= 15 && t < 16 ? 0.5 : t >= 16 && t < 17 ? -0.5 : t >= 45 && t < 45.5 ? -0.5 : t >= 45.5 && t < 46 ? 0.5 : t >= 70 && t < 72 ? 0.08 : t >= 72 && t < 74 ? -0.08 : 0;
      flight.fly({ pitch, roll, throttle: t < 40 ? hold.throttle : t < 80 ? 0.9 : F4C.mil * 0.6 });
      widen(seen.g, flight.value('accelerations/Nz')); widen(seen.bank, flight.value('attitude/phi-rad') * DEG); widen(seen.knots, flight.value('velocities/vc-kts'));
    });
    assert.ok(seen.g[1] > 2 && seen.g[0] < 0.7 && Math.max(...seen.bank.map(Math.abs)) > 20, JSON.stringify(seen));
    tapes[variant] = flight.tape();
    flight.dispose();
  }
  const tape = tapes.weh;
  assert.equal(tape.steps, Math.round(120 / DT));
  report.line(`f4c fcs: a ${tape.steps}-step tape (two minutes from 350 kt at 10,000 ft with the real flight controls: pulls to ${seen.g[1].toFixed(2)} g and a push to ${seen.g[0].toFixed(2)}, bank ${seen.bank.map((x) => x.toFixed(0)).join(' to ')} degrees, into the afterburner and back, ${seen.knots.map((x) => x.toFixed(0)).join(' to ')} kt)`);
  for (const variant of VARIANTS) {
    const again = flyWasm(modules[variant], tapes[variant], `f4c-fcs-${variant}-again`), same = bitEqual(tapes[variant].states, again);
    report.line(`  ${variant}: flown again from its tape by the C++ runner: ${same.equal ? 'identical' : `DIFFERENT (${same.reason})`}`);
    assert.ok(same.equal, same.reason);
  }
  const { native, ensemble } = flyNative(tape, 'f4c-fcs');
  for (const variant of VARIANTS) {
    const wasm = flyWasm(modules[variant], tape, `f4c-fcs-${variant}-judged`, JUDGED), whole = classB(native, wasm, ensemble);
    report.line(`  ${variant} against native, the whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const col of whole.columns) report.line(`    ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole-flight line`);
    const rows = Math.round(1 / DT) + 1, first = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
    report.line(`  ${variant} against native, first second: ${describeN(first)}`);
    assert.ok(first.pass, `${variant}: the first-second line`);
  }
});
