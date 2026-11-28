// The simple F-4C (aircraft/f4c-simple/, src/sim/aircraft/f4c-simple.js) on the shared simple physics and
// control run (aircraft/simple/): its checkride. Milestone 3 re-planned, pull request 3
// (docs/milestones/3-replan.md, "PR 3. The simple physics and the simple F-4C, headless"). The "done" lines were
// written in the plan before any of this was built; each test that holds one is named for it, in the plan's
// words, and asserts what the line says. The plan's "Reported, no pass or fail" list is
// tests/simple-f4c-reported.test.js. The test pilots are tests/checkride/simple-pilot.js.
//
// How each line is read, where the plan's words leave a choice (the plain reading; the reasons are at each test):
//   "slowing 1 knot a second in level flight" (the two stall speeds, and the power-off stalls' "from level
//                     flight at idle, slowing 1 knot a second")   WRONG WORDING, found before any result, and
//                     NOT MET AS WRITTEN: at idle this airplane slows about 3 knots a second if it holds its
//                     height, so idle, level flight and a knot a second cannot all be had at once. The line is
//                     kept on record as it was written, and a new one is the owner's to approve. Until then
//                     both stalls that CAN be flown are held to the line's speed, so neither reading is let
//                     off: at idle slowing a knot a second with the nose, descending as it must; and at idle
//                     holding its height, slowing as fast as it then does (asserted level within 200 ft).
//                     (Codex's review of pull request 58 asked that the level-flight stall be asserted, not
//                     only printed.)
//   "stalled at 145 knots"   the speed at the moment the angle of attack first passes the file's stall angle.
//   "the nosewheel lifts at"   the speed at the first step its tyre is off the runway.
//   "climbing, not stalled"   5 s after liftoff the climb rate is above zero and the angle of attack below the stall angle.
//   "at sea level" (top speed)   level at 500 ft over the sea: as low as a level pilot is flown.
//   "hands off"       the stick at neutral in pitch and roll; the throttle where level flight at the start had it.
//   "still within 35 knots"   through the whole minute, not only at its end.
//   "the nose rises within 3 s"   half a degree or more higher 3 s after the stick is let go.
//   "it settles"      over the last 30 s of three minutes with the gear and full flaps down, the stick let go and
//                     the throttle where level flight at 200 knots in that state has it.
//   "8.5 g within 10%"   the most g in a 4 s wings-level pull with the stick full back from level flight at 5,000 ft,
//                     and the g it holds from 1 to 2 s in: both.
//   "stalled before it reaches 8.5 g"   it stalls in that pull, and the most g up to then is under 8.5.
//   "level" (the hard turn)   within 500 ft of 5,000 ft all the way round: the pilot's hands only roll.
//   "comes out"       the speed at the moment the heading has changed 180 degrees.
//   "a tilt that gives 4 g at 450 knots"   the stick position whose wings-level pull from level flight at 450 knots
//                     holds 4 g from 1 to 2 s in; then held there, the roll stick left alone.
//   "held 5 s: stalled"   stalled at the end of the 5 s (how much of it was stalled is printed).
//   "flying again within 5 s, upright"   the moment it came back below the stall angle to stay for 2 s is within
//                     5 s of letting go, and at that moment it is banked less than 90 degrees. (The sloppy
//                     stall's 15 s the same way.)
//   "from the clean power-off stall"   the clean power-off stall as the line above flies it, its 5 s of full back
//                     tilt, and then 5 s more with full right tilt as well.
//   "A two-minute tape"   a recorded flight of two minutes from the brakes' release, using all seven controls.
//
// Every measured number is printed beside its reference and kept in jsbsim/build/results/checkride-simple-f4c.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { F4C_SIMPLE } from '../src/sim/aircraft/f4c-simple.js';
import { assistWrites } from '../src/sim/assists.js';
import { DT, Flight, SETTLE_SECONDS } from '../src/sim/game.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace, runNative } from '../jsbsim/tests/lib/scenario.js';
import * as THRUST from '../tools/simple-thrust.mjs';
import { bytesOf, moduleWith, rootWith } from './checkride/files.js';
import * as F4C_REFERENCE from './checkride/f4c-reference.js';
import * as REFERENCE from './checkride/simple-reference.js';
import * as P from './checkride/simple-pilot.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

const A = F4C_SIMPLE;
const { WEIGHT, NOSE_WHEEL, LEFT_MAIN_WHEEL, RIGHT_MAIN_WHEEL, ROTATION_SPEED, AIRSPEED_LIMIT, G_LIMIT, WINGS_NEUTRAL_SPEED, FULL_FLAP_STALL, MIL_THRUST, MAX_THRUST, WINGS_TAKEOFF, WINGS_G_AT_FULL_TILT } = F4C_REFERENCE;
const { STALL_CLEAN, STALL_LANDING, TOP_SPEED_HIGH, WITHIN, WINGS_STALL_SPEEDS, WINGS_TOP_SPEEDS, WINGS_HANDS_OFF, WINGS_PILOT_TAKEOFF, WINGS_HARD_TURN, WINGS_LOOP, WINGS_SLOPPY_STALL, WINGS_STALL_LET_GO,
  DATA_BUILT_STALL, DATA_BUILT_TOP_SPEED, DATA_BUILT_LET_GO, DATA_BUILT_LOOP } = REFERENCE;
const DEG = 180 / Math.PI, AB = 1, MIL = A.mil;
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
const within = (x, ref, share = WITHIN.value) => Math.abs(x / ref - 1) <= share;
const band = (ref, share = WITHIN.value) => `${(ref * (1 - share)).toFixed(ref < 10 ? 2 : 1)} to ${(ref * (1 + share)).toFixed(ref < 10 ? 2 : 1)}`;
const f0 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(0)), f1 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(1)), f2 = (x) => (x === null || x === undefined ? 'never' : x.toFixed(2));
const file = bytesOf(A, A.files[0]).toString(), dataBuilt = bytesOf(F4C, F4C.files[0]).toString();

const report = new Report('checkride-simple-f4c');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);

const loaded = {};
const module = (variant = 'weh') => (loaded[variant] ??= moduleWith(A, variant));

/** Runs a flight for some seconds, calling `each(t)` before every step. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each) each(k * DT);
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
  }
}

// ---- 1. It is what its files say ----

test('simple f4c: the engine\'s three thrust tables are what tools/simple-thrust.mjs writes, character for character; standing still at sea level each engine gives 10,900 lb at MIL and 17,000 lb in full afterburner within 2%, and no afterburner at dry power; the thrust does not pitch the nose', async () => {
  for (const [path, { rule, says }] of Object.entries(THRUST.ENGINES)) assert.equal(THRUST.inFile(path).tables, THRUST.asXml(THRUST.thrustTables(rule), says), `node tools/simple-thrust.mjs --write would change nothing in ${path}`);
  assert.deepEqual(Object.keys(THRUST.ENGINES), [A.files[1]]);
  // Wings' rule, at three places a pilot can check by hand: standing still at sea level, 1 and 1; Mach 1 at sea level, MIL 1.05 and afterburner 1.35.
  assert.deepEqual([THRUST.wingsJet(0, 0).mil, THRUST.wingsJet(0, 0).afterburner, THRUST.wingsJet(0, 0).idle], [1, 1, 0.05]);
  assert.ok(Math.abs(THRUST.wingsJet(1, 0).mil - 1.05) < 1e-12 && Math.abs(THRUST.wingsJet(1, 0).afterburner - 1.35) < 1e-12);
  assert.ok(Math.abs(THRUST.densityRatio(40000) - 0.2462) < 0.0005, `the standard atmosphere at 40,000 ft: ${THRUST.densityRatio(40000)}`);
  const flight = Flight.start(await module(), A, { sets: [['forces/hold-down', 1]] });
  assert.equal(flight.get('fcs/mil-throttle-norm'), A.mil, 'the file\'s MIL is the settings\'');
  const thrust = (n) => flight.get(`propulsion/engine[${n}]/thrust-lbs`), burner = (n) => flight.get(`fcs/afterburner-norm${n ? '[1]' : ''}`), seen = [];
  for (const [what, throttle, ref] of [['idle', 0, null], ['MIL', MIL, MIL_THRUST], ['full afterburner', AB, MAX_THRUST]]) {
    flight.fly({ throttle });
    run(flight, 12);
    assert.ok(flight.value('velocities/vg-fps') < 0.001, 'held down: standing still');
    for (const n of [0, 1]) {
      if (ref) assert.ok(Math.abs(thrust(n) / ref.value - 1) <= 0.02, `engine ${n} at ${what}: ${thrust(n)} lb`);
      assert.equal(burner(n), throttle === AB ? 1 : 0, `engine ${n} at ${what}: the afterburner's number`);
    }
    seen.push(`${what} ${thrust(0).toFixed(0)} lb an engine${ref ? ` (${cite(ref)})` : ' (the rule: 5% of MIL)'}`);
    assert.ok(Math.abs(flight.get('moments/m-prop-lbsft')) < 1 && Math.abs(flight.get('forces/fbz-prop-lbs')) < 1e-6, `at ${what} the thrust is along the body's axis through the centre of gravity's height: no pitching moment`);
  }
  report.line(`simple f4c: the engine's tables are the tool's (Wings' rule); standing still at sea level: ${seen.join('; ')}; within 2%; the thrust pitches the nose with 0 lb-ft`);
  flight.dispose();
});

test('simple f4c: what is borrowed from the data-built F-4C is the same there: the wheels and contact points, the throttles and afterburners, the flaps, speedbrakes and gear, element for element; the settings name its contact points, and the copilot holds the pitch trim at zero', async () => {
  const strip = (xml) => xml.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').trim();
  const block = (xml, open, close) => { const from = xml.indexOf(open); assert.ok(from >= 0, `${open} is there`); return strip(xml.slice(from, xml.indexOf(close, from) + close.length)); };
  assert.equal(block(file, '<ground_reactions>', '</ground_reactions>'), block(dataBuilt, '<ground_reactions>', '</ground_reactions>'), 'the wheels and contact points');
  for (const name of ['Left throttle', 'Right throttle', 'Flaps', 'Speedbrakes', 'Landing gear']) assert.equal(block(file, `<channel name="${name}">`, '</channel>'), block(dataBuilt, `<channel name="${name}">`, '</channel>'), `the channel "${name}"`);
  for (const what of ['ixx', 'iyy', 'izz', 'ixz', 'emptywt']) assert.equal(strip(file).match(new RegExp(`<${what} [^>]*>[^<]*</${what}>`))[0], strip(dataBuilt).match(new RegExp(`<${what} [^>]*>[^<]*</${what}>`))[0], `${what}`);
  assert.equal(A.contacts, F4C.contacts);
  const flight = Flight.start(await module(), A);
  assert.equal(flight.get('gear/num-units'), A.contacts.length);
  // The copilot on a simple airplane: it writes the rudder and (until pull request 4) the nosewheel, and holds the pitch trim at zero.
  assert.deepEqual(assistWrites(A.assists), ['fcs/pitch-trim-cmd-norm', 'fcs/rudder-cmd-norm', 'fcs/steer-cmd-norm']);
  assert.deepEqual(A.assists.trim.sets, [['fcs/pitch-trim-cmd-norm', 0]]);
  assert.equal(A.airborneTrim, undefined, 'the stick and the trim add: no special airborne trim');
  run(flight, 1);
  assert.equal(flight.get('fcs/pitch-trim-cmd-norm'), 0);
  // The buffet band is this airplane's own stall: the angle the file's numbers give, and 40 knots above its stall speed.
  const angle = flight.get('simple/stall-angle-rad') * DEG;
  assert.ok(Math.abs(A.buffet.fullDeg - angle) < 0.05, `the buffet is full at the stall angle, ${angle}`);
  assert.ok(Math.abs(A.buffet.onsetDeg - angle * (STALL_CLEAN.value / (STALL_CLEAN.value + 40)) ** 2) < 0.1, 'and begins 40 knots above the stall');
  assert.ok(Math.abs(flight.get('simple/corner-speed-kt') - STALL_CLEAN.value * Math.sqrt(G_LIMIT.value)) < 0.01);
  report.line(`simple f4c: the stall angle is ${angle.toFixed(2)} degrees, the trim angle ${(flight.get('simple/trim-angle-rad') * DEG).toFixed(2)}, corner speed ${flight.get('simple/corner-speed-kt').toFixed(0)} kt; ${[...file.matchAll(/<property value="[^"]*"> simple\//g)].length} numbers in the file`);
  flight.dispose();
});

test('simple f4c: every number the shared physics asks for is declared once in the airplane\'s file, each with a comment, and nothing else is', () => {
  const aero = bytesOf(A, 'aircraft/simple/aero.xml').toString(), controls = bytesOf(A, 'aircraft/simple/controls.xml').toString();
  const listed = [...aero.slice(aero.indexOf('THE NUMBERS AN AIRPLANE\'S FILE DECLARES'), aero.indexOf('What this file gives back')).matchAll(/simple\/([a-z0-9-]+)/g)].map((m) => m[1]);
  const declared = [...file.matchAll(/<property value="[^"]*"> simple\/([a-z0-9-]+) <\/property>/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...new Set(listed)].sort(), 'the file declares exactly the numbers aero.xml lists');
  assert.equal(new Set(declared).size, declared.length, 'each once');
  // Each is used by the shared files, and each made-up name the shared files read is one of them or one they make themselves.
  const made = new Set([...(aero + controls).matchAll(/<(?:function|summer|fcs_function|pure_gain) name="simple\/([a-z0-9-]+)"/g)].map((m) => m[1]));
  const read = new Set([...(aero + controls).replace(/<!--[^]*?-->/g, '').matchAll(/<(?:property|input)>\s*simple\/([a-z0-9-]+)\s*<\/(?:property|input)>/g)].map((m) => m[1]));
  for (const name of declared) assert.ok(read.has(name), `simple/${name} is used`);
  for (const name of read) assert.ok(made.has(name) || declared.includes(name), `simple/${name} is declared or made`);
  // A comment stands before every number (or before the group it is the next of).
  const numbers = file.slice(file.indexOf('<system name="numbers">'), file.indexOf('</system>'));
  assert.doesNotMatch(numbers, /TOPSPEED|PULL|TAIL|DAMPING|SLOPPY/, 'no placeholder is left');
  assert.ok([...numbers.matchAll(/<!--/g)].length >= 24, 'the numbers carry their comments');
});

// ---- 2. "It loads ..." ----

for (const variant of VARIANTS) {
  test(`${variant}, simple f4c: "It loads in both WebAssembly builds ... from its listed files; standing, every tyre is within 1 in of the model's; weight and centre of gravity read back"`, async () => {
    assert.ok(A.own && A.files.every((path) => path.startsWith('aircraft/f4c-simple/') || path.startsWith('aircraft/simple/')), 'its files are FSG\'s own');
    // From its listed files and nothing else; and not without any one of them.
    const flight = Flight.start(await moduleWith(A, variant), A);
    for (const missing of A.files) {
      const without = await moduleWith(A, variant, A.files.filter((path) => path !== missing));
      assert.throws(() => Flight.start(without, A, { settleSeconds: 0 }), (error) => error instanceof Error && error.message.length > 0, `it loaded without ${missing}`);
    }
    const weight = flight.get('inertia/weight-lbs'), cg = ['x', 'y', 'z'].map((axis) => flight.get(`inertia/cg-${axis}-in`));
    report.line(`simple f4c, ${variant}: loads from ${A.files.join(', ')}; not without any one of them`);
    say(`${variant}: weight ${weight} lb (${cite(WEIGHT)}; within 5); centre of gravity as loaded ${cg.join(', ')} in from the model's origin (within 0.1)`);
    assert.ok(Math.abs(weight - WEIGHT.value) <= 5);
    assert.ok(cg.every((inches) => Math.abs(inches) <= 0.1));
    // Standing, as the game parks it: on its three wheels, nothing else touching, and each tyre where the model has it.
    assert.ok(Math.abs(flight.fdm.simTime - SETTLE_SECONDS) < 1e-9, 'settled');
    const at = flight.where(), pitch = flight.get('attitude/theta-deg');
    assert.ok(Math.abs(at.aboveGroundFt - A.standingFt) < 0.01, `its centre of gravity stands ${at.aboveGroundFt} ft up; the settings say ${A.standingFt}`);
    assert.ok(Math.abs(pitch - A.standingPitchDeg) < 0.05, `it stands ${pitch} degrees nose up; the settings say ${A.standingPitchDeg}`);
    for (let k = 0; k < 3; k++) assert.equal(flight.get(`gear/unit[${k}]/WOW`), 1, `wheel ${k} on the ground`);
    for (let k = 3; k < A.contacts.length; k++) assert.equal(flight.get(`contact/unit[${k}]/WOW`), 0, `${A.contacts[k]} off the ground`);
    for (const [k, ref] of [NOSE_WHEEL, LEFT_MAIN_WHEEL, RIGHT_MAIN_WHEEL].entries()) {
      const [x, y, z] = ['x', 'y', 'z'].map((axis, i) => flight.get(`gear/unit[${k}]/${axis}-position`) - cg[i]), given = flight.get(`gear/unit[${k}]/compression-ft`);
      const tyre = [-x / 12, y / 12, -z / 12 - given], off = Math.hypot(...tyre.map((feet, i) => feet - ref.value[i])) * 12;
      say(`${variant}: ${A.contacts[k]}: the tyre meets the runway at [${tyre.map((feet) => feet.toFixed(3)).join(', ')}] ft forward, right and down; the model's: ${cite(ref)}; ${off.toFixed(2)} in off; within 1 (tests/model.test.js measures the model itself)`);
      assert.ok(off <= 1, `${A.contacts[k]} is ${off} in from where the model has it`);
    }
    say(`${variant}: it stands with its centre of gravity ${at.aboveGroundFt.toFixed(4)} ft up, ${pitch.toFixed(3)} degrees nose up, flaps at ${flight.get('fcs/flap-pos-norm')}, brakes on`);
    assert.equal(flight.get('fcs/flap-pos-norm'), 0.5, 'parked at 1/2 flaps');
    flight.dispose();
  });
}

test('simple f4c: "It loads in ... native JSBSim from its listed files": the shared physics and the shared control run load from the folder beside the airplane\'s', () => {
  // A folder holding only its listed files, as JSBSim's root. And each one left out: native JSBSim does not load
  // it. (But the shared physics: with the file its <aerodynamics file="..."> names missing, native JSBSim v1.3.3
  // does not fail the load, it ends the whole process, as it traps the WebAssembly builds above. So that case
  // is shown there and not here.)
  const leftOut = A.files.filter((path) => path !== 'aircraft/simple/aero.xml');
  const cases = [['all', A.files], ...leftOut.map((missing) => [`without ${missing}`, A.files.filter((path) => path !== missing)])];
  const scenarios = cases.map(([, files], i) => ({
    name: `simple-f4c-files-${i}`, root: rootWith(A, `simple-f4c-files-${i}`, files), dt: DT, model: A.model,
    sets: [['ic/h-agl-ft', A.standingFt], ['propulsion/set-running', -1], ['propulsion/fuel_freeze', 1]],
    outs: ['inertia/weight-lbs', 'inertia/cg-x-in', 'inertia/cg-z-in', 'propulsion/engine[0]/thrust-lbs', 'propulsion/engine[1]/thrust-lbs', 'simple/stall-angle-rad', 'simple/pitch-gearing', 'fcs/elevator-pos-deg'], outGear: true, steps: 120,
  }));
  const runs = runNative(scenarios, 'simple-f4c-files');
  for (const [i, { meta, trace }] of runs.entries()) {
    say(`native, ${cases[i][0]}: ${meta.stage === 'done' ? `loaded and ran ${meta.stepsDone} steps` : `stopped at "${meta.stage}": ${meta.message.split('\n').find((line) => /Could not open|No filename/.test(line))?.replace(/\S*\/roots\//, '') ?? meta.message.split('\n')[0]}`}`);
    if (i > 0) { assert.ok(!meta.loaded && meta.stage === 'load' && meta.message.length > 0, `native JSBSim loaded it ${cases[i][0]}`); continue; }
    assert.ok(meta.loaded && meta.stage === 'done' && meta.stepsDone === 120, `native JSBSim: ${meta.stage}: ${meta.message}`);
    const last = [...trace.data.subarray((trace.rows - 1) * trace.columns.length)], number = (name) => last[trace.columns.indexOf(name)];
    assert.equal(number('inertia/weight-lbs'), WEIGHT.value, 'the weight reads back');
    assert.ok(Math.abs(number('inertia/cg-x-in')) <= 0.1 && Math.abs(number('inertia/cg-z-in')) <= 0.1, 'the centre of gravity reads back');
    assert.ok(number('propulsion/engine[0]/thrust-lbs') > 100 && number('propulsion/engine[0]/thrust-lbs') === number('propulsion/engine[1]/thrust-lbs'), 'both engines idling');
    assert.deepEqual([0, 1, 2].map((k) => number(`gear/unit[${k}]/WOW`)), [1, 1, 1], 'on its wheels');
    // The shared files are in: numbers only they make read back.
    assert.ok(Math.abs(number('simple/stall-angle-rad') * DEG - A.buffet.fullDeg) < 0.05 && number('simple/pitch-gearing') === 1, 'the shared physics and control run are loaded');
  }
});

// ---- 3. The speeds a pilot flies by ----

test('simple f4c: "Stall, clean, idle, slowing 1 knot a second in level flight: stalled at 145 knots within 10% (Wings\' card; the data-built jet 140)" (not met as written, since idle, level and a knot a second cannot all be had: flown both ways it can be, see the top of this file)', async () => {
  const m = await module(), s = P.stallSpeed(m, A, { fromKt: 190, heightFt: 6000 }), level = P.levelStall(m, A, { fromKt: 190, heightFt: 6000 });
  report.line(`simple f4c: the clean stall, idle, slowing a knot a second by the nose from level flight at ${f0(s.fromKt)} kt and 6,000 ft: the angle of attack passes ${f2(s.angle)} degrees at ${f1(s.kt)} kt (${f2(s.g)} g, the nose ${f1(s.pitch)} degrees up, descending ${f0(-s.fpm)} ft/min, slowing ${f2(s.knotsASecond)} kt a second over the last 10 s)`);
  say(`reference ${cite(STALL_CLEAN)}; within 10%: ${band(STALL_CLEAN.value)}. Beside it: Wings ${WINGS_STALL_SPEEDS.value[0]} (${WINGS_STALL_SPEEDS.where}); the data-built jet ${cite(DATA_BUILT_STALL)}`);
  say(`the line's "in level flight" cannot be flown: holding its height at idle it slows ${f1(level.knotsASecond)} kt a second (the last 10 s; height ${f0(level.low)} to ${f0(level.high)} ft) and stalls at ${f1(level.at.kt)} kt with the nose ${f1(level.at.pitch)} degrees up`);
  assert.ok(s.knotsASecond > 0.7 && s.knotsASecond < 1.3, `slowing a knot a second (${s.knotsASecond})`);
  assert.ok(within(s.kt, STALL_CLEAN.value), `${s.kt} kt`);
  assert.ok(level.high - level.low <= 200, `holding its height: ${level.low} to ${level.high} ft`);
  assert.ok(within(level.at.kt, STALL_CLEAN.value), `and held level it stalls at ${level.at.kt} kt`);
});

test('simple f4c: "Stall, gear and full flaps, idle, the same way: 125 knots within 10% (the flight manual\'s 122 to 126)"', async () => {
  const m = await module(), s = P.stallSpeed(m, A, { fromKt: 170, heightFt: 6000, gear: true, flaps: 1 }), level = P.levelStall(m, A, { fromKt: 170, heightFt: 6000, gear: true, flaps: 1 });
  report.line(`simple f4c: the stall with gear and full flaps, idle, slowing a knot a second by the nose from ${f0(s.fromKt)} kt: the angle of attack passes ${f2(s.angle)} degrees at ${f1(s.kt)} kt (${f2(s.g)} g, the nose ${f1(s.pitch)} degrees up, descending ${f0(-s.fpm)} ft/min, slowing ${f2(s.knotsASecond)} kt a second)`);
  say(`reference ${cite(STALL_LANDING)}; within 10%: ${band(STALL_LANDING.value)}. Beside it: the flight manual ${cite(FULL_FLAP_STALL)}; Wings ${WINGS_STALL_SPEEDS.value[1]}`);
  say(`holding its height at idle instead it slows ${f1(level.knotsASecond)} kt a second and stalls at ${f1(level.at.kt)} kt with the nose ${f1(level.at.pitch)} degrees up`);
  assert.ok(s.knotsASecond > 0.7 && s.knotsASecond < 1.3, `slowing a knot a second (${s.knotsASecond})`);
  assert.ok(within(s.kt, STALL_LANDING.value), `${s.kt} kt`);
  assert.ok(level.high - level.low <= 200, `holding its height: ${level.low} to ${level.high} ft`);
  assert.ok(within(level.at.kt, STALL_LANDING.value), `and held level it stalls at ${level.at.kt} kt`);
});

test('simple f4c: "Rotation, flown as Wings\' pilot flies it (1/2 flaps, full afterburner, full back tilt from 80 knots, then the nose held 10 degrees up once airborne): the nosewheel lifts at 150 knots within 10%; nothing but wheels touches; 5 s after liftoff it is climbing, not stalled. Liftoff speed and ground roll reported (Wings, on full flaps: 174 knots, 1,700 ft)"', async () => {
  const t = P.takeoff(await module(), A, P.wingsTakeoffPilot, { flaps: 0.5 }), five = t.after(5);
  report.line(`simple f4c: the takeoff as Wings' pilot flies it, 1/2 flaps, full afterburner: the nosewheel lifts at ${f1(t.nose?.kt)} kt (${cite(ROTATION_SPEED)}; within 10%: ${band(ROTATION_SPEED.value)})`);
  say(`liftoff at ${f1(t.off?.kt)} kt after ${f0(t.off?.rollFt)} ft, the nose ${f1(t.off?.pitch)} degrees up (Wings, full flaps: ${cite(WINGS_TAKEOFF)}; its pilot: ${cite(WINGS_PILOT_TAKEOFF)}); touched besides the wheels, up to 10 s after: ${t.touched.join(', ') || 'nothing'}`);
  say(`5 s after liftoff: climbing ${f0(five?.fpm)} ft/min at ${f0(five?.kt)} kt, the nose ${f1(five?.pitch)} degrees up, the angle of attack ${f1(five?.alpha)} (the stall angle ${f2(t.angle)})`);
  assert.ok(t.nose && t.off && five, 'it took off');
  assert.ok(within(t.nose.kt, ROTATION_SPEED.value), `the nosewheel lifts at ${t.nose.kt} kt`);
  assert.deepEqual(t.touched, [], 'nothing but wheels touches');
  assert.ok(five.fpm > 0, 'climbing');
  assert.ok(Math.abs(five.alpha) < t.angle, 'not stalled');
});

test('simple f4c: "Top speed, full afterburner: 750 knots at sea level within 10% (the flight manual\'s limit; the data-built jet 754); Mach 2.2 at 40,000 ft within 10%"', async () => {
  const m = await module(), low = P.topSpeed(m, A, { heightFt: 500, knots: 700 }), high = P.topSpeed(m, A, { heightFt: TOP_SPEED_HIGH.value[1], knots: 650, seconds: 600 });
  const limit = AIRSPEED_LIMIT.value[0];
  report.line(`simple f4c: top speed, full afterburner, level at 500 ft: ${f1(low.kt)} kt (Mach ${low.mach.toFixed(3)}; still changing ${low.knotsASecond?.toFixed(3)} kt a second after ${f0(low.seconds)} s; height ${f0(low.low)} to ${f0(low.high)} ft). Reference ${limit} kt (${AIRSPEED_LIMIT.source}, ${AIRSPEED_LIMIT.where}); within 10%: ${band(limit)}. Beside it: ${cite(DATA_BUILT_TOP_SPEED)}; Wings ${cite(WINGS_TOP_SPEEDS)}`);
  say(`level at ${TOP_SPEED_HIGH.value[1].toLocaleString('en-US')} ft: Mach ${high.mach.toFixed(3)} (${f0(high.kt)} kt calibrated; still changing ${high.knotsASecond?.toFixed(3)} kt a second after ${f0(high.seconds)} s; height ${f0(high.low)} to ${f0(high.high)} ft). Reference ${cite(TOP_SPEED_HIGH)}; within 10%: ${band(TOP_SPEED_HIGH.value[0])}`);
  for (const [run, feet] of [[low, 500], [high, TOP_SPEED_HIGH.value[1]]]) {
    assert.ok(run.low > feet - 200 && run.high < feet + 200, 'level');
    assert.ok(Math.abs(run.knotsASecond) < 0.1, `it has stopped speeding up (${run.knotsASecond} kt a second)`);
  }
  assert.ok(within(low.kt, limit), `${low.kt} kt`);
  assert.ok(within(high.mach, TOP_SPEED_HIGH.value[0]), `Mach ${high.mach}`);
});

test('simple f4c: "Phone level, clean: from 350 knots, hands off for 60 s, still within 35 knots; started level at 450 the nose rises within 3 s. Gear and flaps down: it settles between 180 and 220 knots"', async () => {
  const m = await module(), trim = A.assists.trim;
  assert.equal(trim.knots, WINGS_NEUTRAL_SPEED.value);
  const minute = P.handsOff(m, A, { heightFt: trim.heightFt, knots: trim.knots, seconds: 60 });
  report.line(`simple f4c: phone level from ${trim.knots} kt at ${trim.heightFt} ft for 60 s: ${f1(minute.slow)} to ${f1(minute.fast)} kt, ending at ${f1(minute.end.kt)} kt, ${f0(minute.end.ft - minute.start.ft)} ft higher, banked ${f1(minute.end.bank)} degrees (level flight there needs the stick at ${minute.trimmedStick.toFixed(4)}); the line: within 35 kt`);
  assert.ok(Math.abs(minute.start.kt - trim.knots) < 0.5);
  assert.ok(minute.slow >= trim.knots - 35 && minute.fast <= trim.knots + 35, 'within 35 kt for the whole minute');
  const fast = P.handsOff(m, A, { heightFt: trim.heightFt, knots: 450, seconds: 3 });
  say(`started level at 450 kt and let go: the nose goes from ${f2(fast.start.pitch)} to ${f2(fast.end.pitch)} degrees up in 3 s (${f2(Math.max(...fast.rows.map((r) => r.g)))} g at most; level flight there needs ${f0(-fast.trimmedStick * 100)}% forward stick)`);
  assert.ok(fast.end.pitch - fast.start.pitch >= 0.5, 'the nose rises within 3 s');
  // Gear and full flaps down from level flight at 250 knots clean, the stick let go; the throttle where level flight at 200 knots with them down has it.
  const level = P.inTheAir(m, A, 10000, 200, { controls: { gear: true, flaps: 1 } }), power = level.trimmed.throttle;
  level.dispose();
  const down = P.handsOff(m, A, { heightFt: 10000, knots: 250, seconds: 180, throttle: power, controls: { gear: true, flaps: 1 } }), settled = down.last(30);
  say(`gear and full flaps put down at 250 kt and 10,000 ft, phone level, the throttle at ${f0(power * 100)}% (level flight at 200 kt with them down): ${f0(down.slow)} to ${f0(down.fast)} kt on the way; over the last 30 s of 3 minutes ${f1(settled.slow)} to ${f1(settled.fast)} kt, ${f0(settled.fpm)} ft/min; the line: between 180 and 220 (Wings: ${WINGS_HANDS_OFF.value[1]} kt, ${WINGS_HANDS_OFF.where})`);
  assert.ok(down.end.ft > 1000, 'it did not reach the ground');
  assert.ok(settled.slow >= 180 && settled.fast <= 220, 'it settles between 180 and 220 kt');
  // Reported: the same at idle, from 20,000 ft (it comes down about 5,000 ft a minute), over the last 30 s of 2 minutes.
  const idle = P.handsOff(m, A, { heightFt: 20000, knots: 250, seconds: 120, throttle: 0, controls: { gear: true, flaps: 1 } }), gliding = idle.last(30);
  say(`reported: the same at idle from 20,000 ft: over the last 30 s of 2 minutes ${f1(gliding.slow)} to ${f1(gliding.fast)} kt, ${f0(gliding.fpm)} ft/min, down to ${f0(idle.end.ft)} ft`);
});

// ---- 4. Common sense on energy ----

test('simple f4c: "Full back tilt at 500 knots: 8.5 g within 10%. At 250 knots: stalled before it reaches 8.5 g"', async () => {
  const m = await module(), limit = G_LIMIT.value, at = (knots) => P.pull(m, A, { heightFt: 5000, knots, stick: 1, throttle: AB });
  const fast = at(500), slow = at(250);
  report.line(`simple f4c: full back tilt from level flight at 5,000 ft, full afterburner, wings level, 4 s:`);
  say(`at 500 kt: ${f2(fast.mostG)} g at most, ${f2(fast.heldG)} g held from 1 to 2 s in, ${fast.stalledAfter === null ? 'never stalled' : `stalled after ${f2(fast.stalledAfter)} s`} (angle of attack ${f1(fast.mostAlpha)} at most); reference ${limit} g (${G_LIMIT.source}; Wings' card, g_limit); within 10%: ${band(limit)}`);
  say(`at 250 kt: stalled after ${f2(slow.stalledAfter)} s at ${f2(slow.stalledG)} g, the most g before then ${f2(slow.mostGBeforeStall)} and in all ${f2(slow.mostG)} (Wings at 250, 350 and 450 kt: ${WINGS_G_AT_FULL_TILT.value.join(', ')} g)`);
  for (const knots of [350, 450, 600]) { const p = at(knots); say(`reported, at ${knots} kt: ${f2(p.mostG)} g at most, ${f2(p.heldG)} held, ${p.stalledAfter === null ? 'never stalled' : `stalled after ${f2(p.stalledAfter)} s at ${f2(p.stalledG)} g`}`); }
  assert.ok(within(fast.mostG, limit), `the most g at 500 kt: ${fast.mostG}`);
  assert.ok(within(fast.heldG, limit), `the g held at 500 kt: ${fast.heldG}`);
  assert.ok(slow.stalledAfter !== null, 'at 250 kt it stalls');
  assert.ok(slow.mostGBeforeStall < limit && slow.mostG < limit, 'before it reaches 8.5 g');
});

test('simple f4c: "A hard turn loses speed: full back tilt from 450 knots at 5,000 ft in full afterburner, level, through 180 degrees: it comes out at least 40 knots slower and still above 250"', async () => {
  const t = P.levelTurn(await module(), A, { heightFt: 5000, knots: 450, throttle: AB, stick: 1 });
  report.line(`simple f4c: a hard turn, full back tilt from ${f1(t.from.kt)} kt at 5,000 ft in full afterburner: through 180 degrees in ${f1(t.seconds)} s, out at ${f1(t.out?.kt)} kt (${f1(t.from.kt - (t.out?.kt ?? NaN))} lost), ${f1(t.mostG)} g at most and ${f1(t.out?.g)} coming out, stalled for ${f1(t.stalledFor)} s of it; height ${f0(t.low)} to ${f0(t.high)} ft`);
  say(`the line: at least 40 kt slower and still above 250. Beside it, Wings: ${cite(WINGS_HARD_TURN)}`);
  assert.ok(t.out, 'it got round');
  assert.ok(Math.abs(t.from.kt - 450) < 1 && Math.abs(t.from.ft - 5000) < 1, 'from 450 kt at 5,000 ft');
  assert.ok(t.low >= 4500 && t.high <= 5500, 'level: within 500 ft all the way round');
  assert.ok(t.out.kt <= t.from.kt - 40, 'at least 40 kt slower');
  assert.ok(t.out.kt > 250, 'still above 250 kt');
});

test('simple f4c: "A loop needs speed: a tilt that gives 4 g at 450 knots, held without easing from 450 knots at 5,000 ft in full afterburner, goes over the top. From 250 knots in MIL, no held back tilt (a quarter, a half or full) gets over the top"', async () => {
  const m = await module(), slowestKt = STALL_CLEAN.value;
  const stick = P.stickForG(m, A, { g: 4, heightFt: 5000, knots: 450, throttle: AB }), check = P.pull(m, A, { heightFt: 5000, knots: 450, stick, throttle: AB, seconds: 2.1 });
  const tell = (l) => `${l.overTheTop ? 'over the top' : 'NOT over the top'}: ${l.top ? `on its back with the nose on the horizon after ${f1(l.seconds)} s at ${f0(l.top.kt)} kt, banked ${f0(Math.abs(l.top.bank))} degrees` : `the nose got ${f0(l.noseHighest)} degrees up and no further`}; the slowest ${f0(l.slowest)} kt; ${l.stalled ? `stalled at ${f0(l.stalled.kt)} kt with the nose ${f0(l.stalled.pitch)} degrees up` : 'never stalled'}; ${f0(l.gainedFt)} ft gained; ${f1(l.mostG)} g at most`;
  const fast = P.loop(m, A, { heightFt: 5000, knots: 450, throttle: AB, stick, slowestKt });
  report.line(`simple f4c: the loop. The tilt that gives 4 g at 450 kt is ${f0(stick * 100)}% back stick (${f1(2 + stick * 23)} degrees of tilt; it holds ${f2(check.heldG)} g from 1 to 2 s in). Held from 450 kt at 5,000 ft in full afterburner: ${tell(fast)}`);
  say(`over the top is: the nose passes straight up and comes on down to wings-level inverted, never stalled, never slower than the clean stall speed (${slowestKt} kt). Beside it: Wings' own loop ${cite(WINGS_LOOP)}; the data-built jet ${cite(DATA_BUILT_LOOP)}`);
  assert.ok(Math.abs(check.heldG - 4) < 0.05, `the tilt gives 4 g (${check.heldG})`);
  assert.ok(fast.overTheTop, 'from 450 kt in full afterburner it goes over the top');
  for (const [name, held] of [['a quarter', 0.25], ['a half', 0.5], ['full', 1]]) {
    const slow = P.loop(m, A, { heightFt: 5000, knots: 250, throttle: MIL, stick: held, slowestKt });
    say(`from 250 kt in MIL, ${name} back tilt held: ${tell(slow)}`);
    assert.ok(!slow.overTheTop, `from 250 kt in MIL ${name} back tilt does not get over the top`);
  }
  for (const knots of [300, 350, 400]) {
    const s = P.stickForG(m, A, { g: 4, heightFt: 5000, knots, throttle: AB });
    say(`reported: the 4 g tilt (${f0(s * 100)}% back stick) held from ${knots} kt in full afterburner: ${tell(P.loop(m, A, { heightFt: 5000, knots, throttle: AB, stick: s, slowestKt }))}`);
  }
});

// ---- 5. It stalls when asked and recovers when let go ----

const tellStall = (s) => {
  const h = s.held, a = s.after;
  return `${s.fullBackAt ? `the stick reaches full back at ${f1(s.fullBackAt.kt)} kt; ` : ''}held: ${h.stalledAtTheEnd ? 'stalled' : 'NOT stalled'} at the end (stalled for ${f0(h.stalledShare * 100)}% of it; angle of attack ${f0(h.alpha[0])} to ${f0(h.alpha[1])} degrees, ${f0(h.kt[0])} to ${f0(h.kt[1])} kt, the nose ${f0(h.nose[0])} to ${f0(h.nose[1])} degrees up, the climb rate ${f0(h.fpm[0])} to ${f0(h.fpm[1])} ft/min)`
    + (s.sloppy ? `; then full right tilt too: banked ${f0(s.sloppy.end.bank)} degrees after 5 s (${f0(s.sloppy.mostBank)} at most), the nose ${f0(s.sloppy.end.pitch)} degrees up, still ${s.sloppy.stalledAtTheEnd ? 'stalled' : 'NOT stalled'}` : '')
    + `; let go: flying again after ${f2(a.flying)} s, ${a.uprightThen ? 'upright then' : `NOT upright then (flying and upright after ${f2(a.upright)} s)`}; ${f0(a.lostFt)} ft lost to 5 s after that, the most bank ${f0(a.mostBank)} degrees, the nose down to ${f0(a.lowestNose)}, ${f0(a.end.kt)} kt then`;
};
const recovers = (s, seconds) => {
  assert.ok(s.held.stalledAtTheEnd, 'stalled');
  assert.ok(s.after.flying !== null && s.after.flying <= seconds, `flying again within ${seconds} s (${s.after.flying})`);
  assert.ok(s.after.uprightThen, 'upright as it is flying again');
};

test('simple f4c: "A power-off stall, clean, and one with gear and full flaps: from level flight at idle, slowing 1 knot a second to full back tilt, held 5 s: stalled. Let go: flying again within 5 s, upright" (slowing by the nose, descending: see the top of this file)', async () => {
  const m = await module(), clean = P.powerOffStall(m, A, { fromKt: 190 }), dirty = P.powerOffStall(m, A, { fromKt: 170, gear: true, flaps: 1 });
  report.line(`simple f4c: the power-off stall, clean, from 15,000 ft: ${tellStall(clean)}`);
  say(`with gear and full flaps: ${tellStall(dirty)}`);
  say(`beside them: Wings, "stall, then hands off": ${cite(WINGS_STALL_LET_GO)}`);
  recovers(clean, 5);
  recovers(dirty, 5);
});

test('simple f4c: "A power-on stall: from level flight at 200 knots clean in MIL, full back tilt over 2 s and held 10 s: stalled. Let go: flying again within 5 s, upright"', async () => {
  const s = P.powerOnStall(await module(), A, { knots: 200, throttle: MIL });
  report.line(`simple f4c: the power-on stall, from level flight at ${f1(s.from.kt)} kt and 15,000 ft, MIL, full back tilt over 2 s: ${tellStall(s)}`);
  assert.ok(Math.abs(s.from.kt - 200) < 0.5);
  recovers(s, 5);
});

test('simple f4c: "A sloppy stall: from the clean power-off stall, full back and full right tilt held 5 s, then let go: flying again within 15 s, upright (Wings 10.4 s)"', async () => {
  const s = P.powerOffStall(await module(), A, { fromKt: 190, sloppy: 5 });
  report.line(`simple f4c: the sloppy stall: ${tellStall(s)}`);
  say(`beside it: Wings ${cite(WINGS_SLOPPY_STALL)}; the data-built jet ${cite(DATA_BUILT_LET_GO)}`);
  assert.ok(s.sloppy.stalledAtTheEnd, 'still stalled with the tilt held');
  assert.ok(s.sloppy.mostBank > 20, 'it drops a wing');
  recovers(s, 15);
});

// ---- 6. The tape ----

/** Two minutes from the brakes' release, using all seven controls: a takeoff, a climb to 3,000 ft, a turn, and a slow-down with the boards out, gear and flaps coming down. */
function twoMinutes(module) {
  const flight = Flight.start(module, A, { record: true }), level = P.levelPilot(3000), seen = { controls: new Set(), highest: 0, off: null, touched: new Set() };
  let cleaned = false, levelling = false;
  P.fly(flight, 120, (r, t) => {
    let c;
    if (!cleaned) {   // Wings' takeoff, then gear and flaps up at 200 ft
      cleaned = r.agl > 200;
      c = { throttle: 1, brake: false, gear: true, flaps: 0.5, speedbrake: false, pitch: P.wingsTakeoffPilot(r), roll: r.onWheels ? 0 : P.wingsLevel(r) };
    } else {
      levelling ||= r.ft > 2400;
      const turning = t > 60 && t < 85, slowing = t > 95;
      c = { throttle: slowing ? 0 : levelling ? 0.45 : MIL, brake: false, gear: t > 105, flaps: t > 105 ? 1 : 0, speedbrake: slowing && t < 105,
        pitch: levelling ? level(r) : P.clamp(0.08 * (10 - r.pitch) - 0.03 * r.pitchRate, -1, 1), roll: P.bankTo(r, turning ? 45 : 0) };
    }
    if (!r.onWheels && seen.off === null) seen.off = r.kt;
    for (const name of r.touching) if (!/wheel/.test(name)) seen.touched.add(name);
    for (const [name, value] of Object.entries(c)) if (value !== flight.controls[name]) seen.controls.add(name);
    seen.highest = Math.max(seen.highest, r.ft);
    return c;
  });
  const end = P.seen(flight), tape = flight.tape();
  flight.dispose();
  return { tape, end, ...seen };
}

test('simple f4c: "A two-minute tape replays in native JSBSim by milestone 1\'s lines"', async () => {
  const flown = {};
  for (const variant of VARIANTS) flown[variant] = twoMinutes(await module(variant));
  const { tape, end, controls, highest, off, touched } = flown.weh;
  assert.equal(tape.steps, Math.round((SETTLE_SECONDS + 120) / DT));
  assert.equal(tape.own, true, 'the tape says the aircraft is FSG\'s own');
  assert.deepEqual(tape.stepping, A.stepping, 'and carries its stepping');
  assert.deepEqual([...controls].sort(), ['brake', 'flaps', 'gear', 'pitch', 'roll', 'speedbrake', 'throttle'], 'all seven controls were moved');
  assert.ok(off > 150 && highest > 2500 && touched.size === 0, 'it took off and climbed, and nothing but wheels touched');
  report.line(`simple f4c: a ${tape.steps}-step tape (${SETTLE_SECONDS} s settling, then two minutes: takeoff at ${f0(off)} kt, up to ${f0(highest)} ft, a 45 degree banked turn, boards out, gear and flaps down; it ends at ${f0(end.kt)} kt and ${f0(end.ft)} ft), ${tape.ins.length} inputs a step, ${tape.sets.length} values in the start`);
  assert.ok(bitEqual(flown.weh.tape.states, flown.jseh.tape.states).equal, 'both builds recorded the same two minutes');

  // Matching native, by milestone 1's lines (tests/tape.test.js): the whole flight within altitude 1 ft, angles
  // 0.05 rad and speed 1 knot, or 3 times native's own spread where that is larger; and the first second by
  // FDM's tighter line for a run with wheels on the ground. The tape is flown again step by step through the
  // wrapper, as the game runs: the C++ runner inside a build has room for about two minutes and no more.
  const { native, ensemble } = flyNative(tape, 'simple-f4c-two-minutes');
  const last = native.rows - 1, numberAt = (name) => native.data[last * native.columns.length + native.columns.indexOf(name)];
  assert.ok(Math.abs(numberAt('velocities/vc-kts') - end.kt) < 1, `native JSBSim flew the same flight: it ends at ${numberAt('velocities/vc-kts')} kt`);
  for (const variant of VARIANTS) {
    const wasm = flyWasm(await module(variant), tape, `simple-f4c-${variant}-judged`, JUDGED, { stepByStep: true });
    const whole = classB(native, wasm, ensemble);
    say(`${variant} against native, the whole two minutes: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const c of whole.columns) say(`  ${c.column}: largest difference ${fmt(c.maxAbs)}; allowed ${fmt(c.allowed)} (line ${fmt(c.cap)}, native's own spread ${fmt(c.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole-flight line`);
    const rows = Math.round(1 / DT) + 1;
    const first = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
    say(`${variant} against native, first second: ${describeN(first)}`);
    assert.ok(first.pass, `${variant}: the first-second line`);
  }
});

test('simple f4c: every reference number names its source and where in it', () => {
  const entries = Object.entries(REFERENCE);
  assert.ok(entries.length >= 20);
  for (const [name, ref] of entries) {
    assert.deepEqual(Object.keys(ref).sort(), ['source', 'unit', 'value', 'where'], `${name} is a value, a unit, a source and where`);
    assert.ok([ref.value].flat(2).every((x) => x === null || (typeof x === 'number' && Number.isFinite(x))), `${name}: a number`);
    assert.ok(typeof ref.unit === 'string' && ref.unit.trim().length > 0, `${name}: its unit`);
    for (const key of ['source', 'where']) assert.ok(typeof ref[key] === 'string' && ref[key].trim().length > 5, `${name}: its ${key}`);
    assert.match(ref.source, /^(135crewdog\/wings, commit [0-9a-f]{7}|docs\/milestones\/3\.md|docs\/milestones\/3-feel-findings\.md|docs\/milestones\/3-replan\.md)$/, `${name}: a source we have read`);
  }
  console.log(`  ${entries.length} reference numbers, each with its source and where`);
});
