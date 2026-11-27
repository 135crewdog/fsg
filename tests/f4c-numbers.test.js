// The F-4C's numbers: speed, climb, turn and limits. The plan's pull request 11 (docs/milestones/3.md, "PR 11.
// The numbers: speed, climb, turn, limits"). Each test that holds a line of the plan is named for the line, in
// the plan's words. New in FSG, milestone 3.
//
// What it holds:
//   1. the engines' MIL and afterburner tables to tools/f4c-thrust.mjs, cell for cell, and that tool's anchors
//      to NASA CR-2144's record; then the anchors flown in JSBSim: full afterburner there is CR-2144's drag;
//   2. the plan's lines: the two fastest conditions reached level, the throttle at all ten conditions, Mach 1.8
//      at 55,000 ft, the drag at the nine clean conditions, and the limits;
//   3. reports, with no pass or fail, the performance numbers, each beside a published figure where one was found.
//
// How the lines are read (where the words leave it open):
//   "reaches"         level flight holds there with the throttle at or below full afterburner: JSBSim's own trim
//                     finds it level (not in a dive), so with full afterburner the jet holds the speed or passes
//                     it, level. Each is read back: its Mach number, its height, level, and the throttle.
//   "the throttle for level flight"   the throttle JSBSim's trim finds for steady level flight, with the jet's
//                     own flight controls (feel system and augmentation in), as the game flies it.
//   "needs 90% to 100% of full afterburner"   that throttle as a share of the afterburner's range: 0% at MIL,
//                     100% at full afterburner, as the checkride's other reports put it ("85% into the
//                     afterburner"). The share of full afterburner's thrust is printed beside it.
//   "the drag in level flight"   JSBSim's drag coefficient in that trimmed level flight (its drag over the dynamic
//                     pressure and CR-2144's wing area), beside CR-2144's for the condition (the reference file's
//                     CONDITION_DRAG, read from its figure IV-9 and held to the record by tests/f4c-conditions.test.js).
//
// How the reported numbers are worked out (the energy method, the textbook way for performance charts: the
// specific excess power, Rutowski 1954; Raymer, "Aircraft Design", chapter 17): at each speed the jet is
// trimmed level by JSBSim, then started again at exactly that state with the engines at the power asked and
// stepped once, and the forces read: the thrust along the flight path less the drag is what accelerates or climbs it.
//   top speed         the fastest speed at which level flight needs no more than that power (the throttle at MIL,
//                     or level flight trims at all, for full afterburner), found going up in steps of Mach 0.01
//   300 to 600 knots  the time to go through each 25 knots at the acceleration there, added up (level, 1 g)
//   climb rate        the excess power at each speed as a rate of climb; the best of them
//   sustained turn    the g at which the drag, pulled to it at the same speed, is full afterburner's thrust
//   instantaneous     flown: full back tilt from level at that speed, the most g in 3 s, and its turn rate
//   glide             idle; at each speed the glide angle is (drag less idle thrust) over the lift: the best of them
//                     at 30,000, 20,000, 10,000 ft and sea level, and the distance from 30,000 ft added up through them
// All Reasoned as a method (none is a flight flown through the manoeuvre); each number is Supported by the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { DT, Flight } from '../src/sim/game.js';
import { limitsNow } from '../src/sim/rules.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import * as THRUST from '../tools/f4c-thrust.mjs';
import { conditions } from '../tools/f4c-mach.mjs';
import { GROUND, NO_FEET, STRAIGHT, startNear, stateOf, trimmed } from './checkride/conditions.js';
import { moduleWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';

const { WEIGHT, WING_AREA, CONDITION_DRAG, CONDITION_MACH, CONDITION_HEIGHT, G_LIMIT, AIRSPEED_LIMIT, GEAR_LIMIT, FLAPS_LIMIT,
  GLIDE, FASTEST_AT_SEA_LEVEL, POWER_APPROACH_WEIGHT, POWER_APPROACH_KNOTS } = REFERENCE;
// What the flight manual's section V has that the game does not report: words, not numbers, so they live here
// and not in the reference file (whose entries are all numbers).
const FLIGHT_MANUAL = 'T.O. 1F-4C-1 (1 October 1970)', LIMITS = 'section V, "Operating limitations"';
/** Not limits the game can report: of time or of manoeuvre. */
const LIMITS_NOT_REPORTED = { value: ['30 s of negative g, 10 s of zero g', 'no full-deflection aileron roll beyond 360 degrees; no intentional spins', 'MIL and full afterburner 30 minutes below 35,000 ft', 'caution above Mach 0.87 below 10,000 ft'], unit: 'limits of time or manoeuvre', source: FLIGHT_MANUAL, where: `${LIMITS}: "Engine G limitations" p.5-3 (line 29940); "Prohibited maneuvers" p.5-6 (lines 30306 to 30310); "Thrust limitations" p.5-4 (line 29984); the note under "Airspeed limitations" p.5-6 (line 30301)` };
/** Limits the text gives only as charts (their labels only are in the text read here): Reasoned, for the owner. */
const LIMITS_IN_CHARTS = { value: ['the airplane speed restrictions, clean, by height: the Mach limit (figure 5-4)', 'positive g above Mach 0.72 and at other weights, negative g, and g while rolling (figure 5-9, figure 5-10)', 'touchdown sink rate (figure 5-7)'], unit: 'charts', source: FLIGHT_MANUAL, where: `${LIMITS}, figures 5-4, 5-7, 5-9 and 5-10 (pp.5-5 to 5-11): their labels only are in the text` };
const DEG = 180 / Math.PI, KT = 1.6878, G = 32.174, S = WING_AREA.value, NM = 6076.12;
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
const NINE = conditions();
const nameOf = (c) => `condition ${c.fc} (Mach ${c.mach} at ${c.heightFt ? `${c.heightFt.toLocaleString('en-US')} ft` : 'sea level'})`;
/** The throttle as a share of the afterburner's range: 0 at MIL, 1 at full afterburner (negative below MIL). */
const burnerShare = (throttle) => (throttle - F4C.mil) / (1 - F4C.mil);
/** The fuel that makes a weight: the file's airplane is 30,000 lb and its one tank (aircraft/f4c/f4c.xml). */
const fuelFor = (weightLb) => ['propulsion/tank[0]/contents-lbs', weightLb - 30000];

const report = new Report('checkride-f4c-numbers');
test.after(() => report.save());
const say = (line) => report.line(`  ${line}`);

let loaded = {};
const module = (variant = 'weh') => (loaded[variant] ??= moduleWith(F4C, variant));

// ---- 1. The engines' tables ----

test('f4c numbers: the engines\' MIL and afterburner tables are what tools/f4c-thrust.mjs works out, cell for cell: JSBSim\'s own J79 with its 60,000 ft column carried on, and the afterburner anchored to CR-2144\'s record', () => {
  const tables = THRUST.thrustTables(), { tables: inTheFile } = THRUST.inFile(), engine = readFileSync(THRUST.FILE, 'utf8'), jsbsim = readFileSync(THRUST.JSBSIM_J79, 'utf8');
  assert.equal(inTheFile, THRUST.asXml(tables), 'node tools/f4c-thrust.mjs --write would change nothing');
  // Read back from the file as numbers, as JSBSim reads it.
  for (const name of ['MilThrust', 'AugThrust']) assert.deepEqual(THRUST.readTable(engine, name), { columns: tables[name].columns, rows: tables[name].rows }, name);
  // The idle table is JSBSim's own, untouched.
  assert.deepEqual(THRUST.readTable(engine, 'IdleThrust'), THRUST.readTable(jsbsim, 'IdleThrust'), 'the idle table is JSBSim\'s');
  // Every cell is JSBSim's, but the 60,000 ft column (its own lapse carried on) and the afterburner's factors.
  const { rows: factorRows } = tables.factors;
  for (const name of ['MilThrust', 'AugThrust']) {
    const theirs = THRUST.readTable(jsbsim, name), ours = tables[name];
    assert.deepEqual(ours.columns, theirs.columns);
    assert.deepEqual(ours.rows.map((r) => r[0]), theirs.rows.map((r) => r[0]));
    ours.rows.forEach(([mach, ...v], i) => {
      // Beyond the last anchor (Mach 2.0) the afterburner's rows hold its row.
      if (name === 'AugThrust' && mach > THRUST.ZET_ROWS.at(-1)) { assert.deepEqual(v, ours.rows.find((r) => r[0] === THRUST.ZET_ROWS.at(-1)).slice(1), `Mach ${mach}: Mach 2.0's row, held`); return; }
      const t = theirs.rows[i].slice(1), i40 = theirs.columns.indexOf(40000), i50 = i40 + 1;
      v.forEach((x, j) => {
        const carried = j === theirs.columns.length - 1 ? (t[i50] * t[i50]) / t[i40] : t[j];
        const f = name === 'AugThrust' ? THRUST.factorAt(factorRows[i], theirs.columns[j]) : 1;
        assert.ok(Math.abs(x - carried * f) <= 0.00005 + 1e-12, `${name} at Mach ${mach}, ${theirs.columns[j]} ft: ${x}, JSBSim's ${t[j]} (carried ${carried}) times ${f}`);
      });
    });
    // Sea level, standing still: 1, the ratings (pull request 3's line holds them in a run: tests/f4c.test.js).
    assert.equal(ours.rows[0][1 + ours.columns.indexOf(0)], 1, `${name}: the sea-level static rating does not move`);
  }
  // Factors are 1 below Mach 1 and at sea level away from the sea-level anchor.
  for (const r of factorRows) {
    if (r.mach < 1) assert.deepEqual([r.low, r.high], [1, 1], `Mach ${r.mach}: JSBSim's`);
    if (!tables.factors.between.includes(r.mach)) assert.equal(r.low, 1, `Mach ${r.mach}: JSBSim's at sea level`);
  }
  // The anchors are the record's numbers: CR-2144's figure IV-9.
  const CR = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/cr2144-f4c.json', import.meta.url))).figures.CL_CD;
  assert.equal(CR.CL.zero_excess_thrust.note.startsWith('labelled \'Zero Excess Thrust\''), true);
  for (const a of tables.factors.zet) {
    assert.deepEqual(CR.CL.zero_excess_thrust.points.find(([m]) => m === a.mach), [a.mach, a.cl]);
    // CL M^2 = W / (0.7 p S): the height in the standard atmosphere has that pressure.
    assert.ok(Math.abs((0.7 * THRUST.pressureAt(a.heightFt) * S * a.cl * a.mach ** 2) / WEIGHT.value - 1) < 1e-9, `Mach ${a.mach}: the height`);
    say(`zero excess thrust at Mach ${a.mach}: CL ${a.cl} (CR-2144 figure IV-9, the record), so ${a.heightFt.toFixed(0)} ft; CD ${a.cd.toFixed(4)} (the parabola through its 45,000 and 55,000 ft curves there: ${a.from.map(([cl, cd]) => `CL ${cl.toFixed(3)}, CD ${cd}`).join('; ')}); both engines' full afterburner = drag = 38,924 x CD / CL = ${a.dragLb.toFixed(0)} lb; the row's factor at 40,000 ft and up ${factorRows.find((r) => r.mach === a.mach).high.toFixed(4)}`);
  }
  const sea = tables.factors.sea;
  assert.ok(sea.mach > 1.1 && sea.mach < 1.2, `${sea.mach}`);
  say(`sea level: CR-2144's speed restriction crosses its sea-level line at Mach ${sea.mach} (CL ${sea.cl.toFixed(4)}); CD there ${sea.cd.toFixed(4)} (its minimum-drag line, which its sea-level curve runs along past Mach 1.1); drag ${sea.dragLb.toFixed(0)} lb; the factor on JSBSim's sea-level cells at Mach ${tables.factors.between.join(' and ')}: ${factorRows.find((r) => r.mach === tables.factors.between[0]).low.toFixed(4)}. The flight manual's 750 knots there: Mach ${(750 / 661.47).toFixed(3)} (${cite(AIRSPEED_LIMIT)})`);
  say(`the afterburner's factors by Mach row (sea level / 40,000 ft and up): ${factorRows.map((r) => `${r.mach} ${r.low.toFixed(3)}/${r.high.toFixed(3)}`).join(', ')}`);
  // Between the anchors: the zero-excess-thrust line's other points, read through JSBSim's interpolation. Reported only.
  const aug = { columns: tables.AugThrust.columns, rows: tables.AugThrust.rows };
  const others = CR.CL.zero_excess_thrust.points.filter(([m]) => !THRUST.ZET_ROWS.includes(m)).map(([mach, cl]) => {
    const heightFt = THRUST.heightOf(WEIGHT.value / (0.7 * S * cl * mach ** 2)), drag = (WEIGHT.value * THRUST.dragCoefficient(mach, cl).cd) / cl;
    return `Mach ${mach} (${heightFt.toFixed(0)} ft): ${((2 * THRUST.MAX_LB * THRUST.lookup(aug, mach, heightFt)) / drag * 100 - 100).toFixed(1)}%`;
  });
  say(`between the anchors, full afterburner against CR-2144's drag at the line's other points, JSBSim's shape in between (Reasoned): ${others.join('; ')}`);
});

/** A flight at a Mach number and a density height (ft), the engines at full speed and the throttle at `throttle`, stepped once. */
function atDensityHeight(m, mach, densityFt, throttle) {
  let h = densityFt, flight = null;
  for (let pass = 0; pass < 4; pass++) {
    flight?.dispose();
    flight = Flight.start(m, F4C, {
      terrain: GROUND, settleSeconds: 0, controls: { gear: false, flaps: false, brake: false, speedbrake: false, throttle, pitch: 0, roll: 0 },
      sets: [['ic/h-sl-ft', h], ['ic/mach', mach], ['propulsion/engine[0]/n2', 100], ['propulsion/engine[1]/n2', 100], ...STRAIGHT],
    });
    h += densityFt - flight.get('atmosphere/density-altitude');
  }
  assert.equal(flight.step(1), 0);
  return flight;
}

for (const variant of VARIANTS) {
  test(`${variant}, f4c numbers: the anchors flown: at each, both engines' full afterburner is CR-2144's drag within 0.5%, read back at the anchor's Mach number and density height`, async () => {
    const m = await module(variant), { zet, sea } = THRUST.factors();
    for (const a of [...zet, sea]) {
      const flight = atDensityHeight(m, a.mach, a.heightFt, 1);
      const thrust = flight.get('propulsion/engine[0]/thrust-lbs') + flight.get('propulsion/engine[1]/thrust-lbs'), density = flight.get('atmosphere/density-altitude'), mach = flight.value('velocities/mach');
      flight.dispose();
      assert.ok(Math.abs(density - a.heightFt) < 2 && Math.abs(mach - a.mach) < 2e-3, `at Mach ${mach} and ${density} ft`);
      say(`${variant}: Mach ${a.mach} at ${a.heightFt.toFixed(0)} ft (density height read back ${density.toFixed(0)}): full afterburner ${thrust.toFixed(0)} lb; CR-2144's drag there ${a.dragLb.toFixed(0)} lb; within 0.5%`);
      assert.ok(Math.abs(thrust / a.dragLb - 1) <= 0.005, `Mach ${a.mach}: ${thrust} lb against ${a.dragLb}`);
    }
  });
}

// ---- 2. The plan's lines ----

/** Trimmed level by JSBSim with the jet's own flight controls (or the stick straight to the surfaces, `straight`), or null if it cannot be. */
function levelAt(m, { mach, heightFt }, { straight = false, sets = [] } = {}) {
  try {
    return trimmed(m, { mach, heightFt }, 0, { sets: [...(straight ? STRAIGHT : []), ...sets] });
  } catch {
    return null;
  }
}
/** What a trimmed flight is doing, read back. */
const readBack = (flight) => ({
  mach: flight.value('velocities/mach'), heightFt: flight.value('position/h-sl-ft'), knots: flight.value('velocities/vtrue-kts'), vc: flight.value('velocities/vc-kts'),
  gamma: flight.get('flight-path/gamma-deg'), throttle: flight.trimmed.throttle, drag: flight.get('forces/fwx-aero-lbs') / (flight.get('aero/qbar-psf') * S),
  thrust: flight.get('propulsion/engine[0]/thrust-lbs') + flight.get('propulsion/engine[1]/thrust-lbs'), weight: flight.value('inertia/weight-lbs'), gear: flight.value('gear/gear-pos-norm'),
  steady: [flight.get('accelerations/udot-ft_sec2'), flight.get('accelerations/wdot-ft_sec2'), flight.get('accelerations/qdot-rad_sec2')],
});
const isSteadyLevel = (r) => Math.abs(r.gamma) < 0.01 && Math.abs(r.steady[0]) < 0.01 && Math.abs(r.steady[1]) < 0.01 && Math.abs(r.steady[2]) < 1e-4;

/** Full afterburner's thrust at a trimmed flight's speed and height (a fresh start there, stepped once). */
function fullThrustAt(m, flight) {
  const probe = startNear(m, { ...stateOf(flight), throttle: 1, turning: 100 });
  assert.equal(probe.step(1), 0);
  const thrust = probe.get('propulsion/engine[0]/thrust-lbs') + probe.get('propulsion/engine[1]/thrust-lbs');
  probe.dispose();
  return thrust;
}

for (const variant of VARIANTS) {
  const flown = new Map();
  const at = async (c) => {
    if (!flown.has(c.fc)) {
      const flight = levelAt(await module(variant), c);
      flown.set(c.fc, flight && { ...readBack(flight), full: fullThrustAt(await module(variant), flight) });
      flight?.dispose();
    }
    return flown.get(c.fc);
  };

  test(`${variant}, f4c numbers: "Full afterburner, level: it reaches Mach 2.15 at 45,000 ft and 728 knots at sea level, the two fastest of CR-2144's conditions"`, async () => {
    for (const fc of [9, 3]) {
      const c = NINE.find((x) => x.fc === fc), r = await at(c);
      assert.ok(r, `${nameOf(c)}: JSBSim's trim finds no level flight there`);
      assert.ok(Math.abs(r.mach - c.mach) < 1e-3 && Math.abs(r.heightFt - c.heightFt) < 1 && r.weight === WEIGHT.value && r.gear === 0, JSON.stringify(r));
      assert.ok(isSteadyLevel(r), `level and steady: ${JSON.stringify(r)}`);
      say(`${variant}: ${nameOf(c)}, ${r.knots.toFixed(1)} kt true: level, the throttle ${(burnerShare(r.throttle) * 100).toFixed(0)}% into the afterburner (${r.thrust.toFixed(0)} lb); full afterburner there gives ${r.full.toFixed(0)} lb, ${((r.full / r.thrust - 1) * 100).toFixed(1)}% more than level flight needs`);
      assert.ok(r.throttle <= 1, `the throttle ${r.throttle}`);
      assert.ok(r.full >= r.thrust, 'full afterburner holds it or passes it');
      if (fc === 3) assert.ok(r.knots >= FASTEST_AT_SEA_LEVEL.value - 0.5, `${r.knots} kt; ${cite(FASTEST_AT_SEA_LEVEL)}`);
    }
  });

  test(`${variant}, f4c numbers: "at each of the ten conditions the throttle for level flight is at or below full afterburner"`, async () => {
    for (const c of NINE) {
      const r = await at(c);
      assert.ok(r, `${nameOf(c)}: JSBSim's trim finds no level flight there`);
      assert.ok(isSteadyLevel(r) && Math.abs(r.mach - c.mach) < 1e-3 && Math.abs(r.heightFt - c.heightFt) < 1, `${nameOf(c)}: ${JSON.stringify(r)}`);
      say(`${variant}: ${nameOf(c)}: level, the throttle ${r.throttle.toFixed(4)} (${r.throttle <= F4C.mil ? `${(r.throttle / F4C.mil * 100).toFixed(0)}% of the way to MIL` : `${(burnerShare(r.throttle) * 100).toFixed(0)}% into the afterburner`}); at or below full afterburner (1)`);
      assert.ok(r.throttle >= 0 && r.throttle <= 1, `${nameOf(c)}: the throttle ${r.throttle}`);
    }
    // Condition 1, the power approach: 33,197 lb, sea level, 136 knots calibrated, gear and flaps down.
    const m = await module(variant);
    const flight = Flight.start(m, F4C, { airborne: { heightFt: 0, knots: POWER_APPROACH_KNOTS.value }, terrain: GROUND, assists: NO_FEET, controls: { gear: true, flaps: 1 },
      sets: [fuelFor(POWER_APPROACH_WEIGHT.value), ['ic/vc-kts', POWER_APPROACH_KNOTS.value]] });
    const r = readBack(flight);
    flight.dispose();
    assert.ok(r.weight === POWER_APPROACH_WEIGHT.value && r.gear === 1 && Math.abs(r.vc - POWER_APPROACH_KNOTS.value) < 0.01 && Math.abs(r.heightFt) < 1 && isSteadyLevel(r), `condition 1: ${JSON.stringify(r)}`);
    say(`${variant}: condition 1 (the power approach, ${POWER_APPROACH_WEIGHT.value} lb, ${POWER_APPROACH_KNOTS.value} kt at sea level, gear and flaps down): level, the throttle ${r.throttle.toFixed(4)} (${(r.throttle / F4C.mil * 100).toFixed(0)}% of the way to MIL); at or below full afterburner (1)`);
    assert.ok(r.throttle >= 0 && r.throttle <= 1, `condition 1: the throttle ${r.throttle}`);
  });

  test(`${variant}, f4c numbers: "At Mach 1.8 and 55,000 ft, which sits on CR-2144's zero-excess-thrust line, level flight needs 90% to 100% of full afterburner"`, async () => {
    const c = NINE.find((x) => x.fc === 10), r = await at(c);
    assert.ok(r && isSteadyLevel(r) && Math.abs(r.mach - 1.8) < 1e-3 && Math.abs(r.heightFt - 55000) < 1, JSON.stringify(r));
    const share = burnerShare(r.throttle);
    say(`${variant}: ${nameOf(c)}: level, the throttle ${(share * 100).toFixed(1)}% into the afterburner (0% MIL, 100% full); its thrust ${r.thrust.toFixed(0)} lb is ${(r.thrust / r.full * 100).toFixed(1)}% of full afterburner's ${r.full.toFixed(0)} there; 90% to 100%. (CR-2144's record puts its zero-excess-thrust line at Mach 1.8 at CL 0.183, about 1,500 ft above the condition's CL 0.168: within 10% of the figure's reading, not on it.)`);
    assert.ok(share >= 0.9 && share <= 1, `${share}`);
  });

  test(`${variant}, f4c numbers: "CR-2144's drag: at each of the nine clean conditions the drag in level flight is within 10% of CR-2144's own for that condition"`, async () => {
    assert.deepEqual(NINE.map((c) => c.mach), CONDITION_MACH.value);
    assert.deepEqual(NINE.map((c) => c.heightFt), CONDITION_HEIGHT.value);
    NINE.forEach((c, i) => assert.equal(Number(c.drag.toFixed(4)), CONDITION_DRAG.value[i], 'the reference file\'s value is the record\'s'));
    for (const c of NINE) {
      const i = NINE.indexOf(c), r = await at(c);
      assert.ok(r && isSteadyLevel(r), `${nameOf(c)}: level`);
      say(`${variant}: ${nameOf(c)}: drag coefficient in level flight ${r.drag.toFixed(4)}; CR-2144 ${CONDITION_DRAG.value[i]} (${CONDITION_DRAG.source}, ${CONDITION_DRAG.where.split(';')[0]}); ${((r.drag / CONDITION_DRAG.value[i] - 1) * 100).toFixed(1)}%; within 10%`);
      assert.ok(Math.abs(r.drag / CONDITION_DRAG.value[i] - 1) <= 0.1, `${r.drag}`);
    }
  });
}

test('f4c numbers: "The limits the game reports are the flight manual\'s where its text gives a number (8.5 g at 37,500 lb up to Mach 0.72; gear 250 knots), each with its place in the text. A limit that exists only as a chart is marked Reasoned and named for the owner"', async () => {
  // Each limit's number is the manual's, with its page and its lines in the text.
  for (const ref of [G_LIMIT, AIRSPEED_LIMIT, GEAR_LIMIT, FLAPS_LIMIT]) {
    assert.equal(ref.source, 'T.O. 1F-4C-1 (1 October 1970)');
    assert.match(ref.where, /section V, "Operating limitations", figure 5-\d+ .*p\.5-\d+: ".+" \(lines \d+ to \d+/);
    say(cite(ref));
  }
  assert.deepEqual(F4C.limits, {
    g: G_LIMIT.value, knots: AIRSPEED_LIMIT.value[0], high: { aboveFt: AIRSPEED_LIMIT.value[1], knots: AIRSPEED_LIMIT.value[2] },
    gear: { knots: GEAR_LIMIT.value[0], g: GEAR_LIMIT.value[1] }, flaps: { knots: FLAPS_LIMIT.value[0], g: FLAPS_LIMIT.value[1] },
  });
  // The lowest that applies, by height, gear and flaps.
  assert.deepEqual(limitsNow(F4C.limits, { heightFt: 10000, gear: 0, flaps: 0 }), { g: 8.5, knots: 750 });
  assert.deepEqual(limitsNow(F4C.limits, { heightFt: 35000, gear: 0, flaps: 0 }), { g: 8.5, knots: 710 });
  assert.deepEqual(limitsNow(F4C.limits, { heightFt: 2000, gear: 1, flaps: 0 }), { g: 2, knots: 250 });
  assert.deepEqual(limitsNow(F4C.limits, { heightFt: 2000, gear: 0, flaps: 0.01 }), { g: 2, knots: 250 });
  // Read back from a run: gear down at 270 knots is reported, against 250, and nothing else changes.
  const m = await module(), flight = Flight.start(m, F4C, { airborne: { heightFt: 3000, knots: 270 }, terrain: GROUND, controls: { gear: true, flaps: 0 } });
  assert.equal(flight.value('gear/gear-pos-norm'), 1);
  assert.equal(flight.step(1), 0);
  const events = flight.rules.takeEvents(), over = events.find((e) => e.type === 'overspeed');
  flight.dispose();
  assert.ok(over && over.limit === 250 && over.knots > 250, JSON.stringify(events));
  say(`gear down at ${over.knots.toFixed(0)} kt calibrated, 3,000 ft: reported "overspeed", limit ${over.limit} kt`);
  // Named for the owner: Reasoned, the charts.
  say(`only as charts, so not reported (Reasoned; for the owner, who may have them): ${LIMITS_IN_CHARTS.value.join('; ')} (${LIMITS_IN_CHARTS.where})`);
  say(`in the text but not limits the game reports (time or manoeuvre): ${LIMITS_NOT_REPORTED.value.join('; ')} (${LIMITS_NOT_REPORTED.where})`);
});

// ---- 3. Reported, no pass or fail ----

/** The forces at a trimmed flight's state, started again with the engines at `throttle` and `turning` and its angle of attack raised by `alphaDeg`, stepped once. */
function forcesAt(m, base, { throttle, turning, alphaDeg = 0 }) {
  const probe = startNear(m, { ...base, throttle, turning }, { alphaDeg });
  assert.equal(probe.step(1), 0);
  const a = probe.get('aero/alpha-rad'), fx = probe.get('forces/fbx-prop-lbs'), fz = probe.get('forces/fbz-prop-lbs');
  const out = {
    along: fx * Math.cos(a) + fz * Math.sin(a), up: fx * Math.sin(a) - fz * Math.cos(a), drag: probe.get('forces/fwx-aero-lbs'), lift: probe.get('forces/fwz-aero-lbs'),
    weight: probe.value('inertia/weight-lbs'), fps: probe.get('velocities/vt-fps'), alphaDeg: a * DEG,
  };
  probe.dispose();
  return { ...out, excess: out.along - out.drag, g: (out.lift + out.up) / out.weight };
}
const FULL = { throttle: 1, turning: 100 }, MIL = { throttle: F4C.mil, turning: 100 }, IDLE = { throttle: 0, turning: 53 };   // 53%: the engine file's idle speed

/** Level, the stick straight to the stabilator (for startNear), at a calibrated airspeed and height; null if it cannot be. */
const levelAtKnots = (m, vc, heightFt) => levelAt(m, { mach: 0.5, heightFt }, { straight: true, sets: [['ic/vc-kts', vc]] });

test('f4c numbers, reported (no pass or fail): top speed at sea level and 36,000 ft in MIL and in full afterburner; seconds from 300 to 600 knots at sea level in full afterburner; best climb rate at sea level', async () => {
  const m = await module();
  // Top speeds: going up in Mach 0.01, the last at which level flight needs no more than the power.
  const top = (heightFt, power, from, to) => {
    let best = null;
    for (let mach = from; mach <= to + 1e-9; mach = Number((mach + 0.01).toFixed(2))) {
      const flight = levelAt(m, { mach, heightFt }, { straight: true });
      const ok = flight && (power === 'full' || flight.trimmed.throttle <= F4C.mil);
      if (ok) best = { mach, knots: flight.value('velocities/vtrue-kts'), vc: flight.value('velocities/vc-kts') };
      flight?.dispose();
      if (!ok && best) break;
    }
    return best;
  };
  const WINGS_TOP = { MIL: 621, full: 780 };
  for (const [heightFt, ranges] of [[0, { MIL: [0.8, 1.2], full: [1.0, 1.4] }], [36000, { MIL: [0.8, 1.3], full: [1.2, 2.8] }]]) {
    for (const power of ['MIL', 'full']) {
      const t = top(heightFt, power, ...ranges[power]);
      assert.ok(t, `${power} at ${heightFt} ft`);
      say(`top speed, ${power === 'MIL' ? 'MIL' : 'full afterburner'}, level at ${heightFt ? '36,000 ft' : 'sea level'}: Mach ${t.mach.toFixed(2)}, ${t.knots.toFixed(0)} kt true (${t.vc.toFixed(0)} calibrated). Wings: ${heightFt ? (power === 'full' ? 'Mach 2.2' : 'none given') : `${WINGS_TOP[power]} kt`} (135crewdog/wings, commit 6d689b7, its F-4C card, as docs/milestones/3.md quotes it). The flight manual's limit: ${heightFt ? '710' : '750'} kt calibrated (${AIRSPEED_LIMIT.where.split(':')[0]}); its speeds by height are charts only`);
    }
  }
  // 300 to 600 knots, level at sea level, full afterburner.
  const knotsSteps = [];
  for (let kt = 300; kt <= 600; kt += 25) {
    const flight = levelAtKnots(m, kt, 0);
    assert.ok(flight, `level at ${kt} kt`);
    const f = forcesAt(m, stateOf(flight), FULL);
    flight.dispose();
    knotsSteps.push({ kt, accel: (G * f.excess) / f.weight });
  }
  let seconds = 0;
  for (let i = 1; i < knotsSteps.length; i++) seconds += ((knotsSteps[i].kt - knotsSteps[i - 1].kt) * KT * (1 / knotsSteps[i].accel + 1 / knotsSteps[i - 1].accel)) / 2;
  say(`300 to 600 kt, level at sea level, full afterburner: ${seconds.toFixed(1)} s (the acceleration ${knotsSteps[0].accel.toFixed(1)} ft/s2 at 300 kt, ${knotsSteps.at(-1).accel.toFixed(1)} at 600). No published figure found in the flight manual's text (its F-4E appendix has acceleration charts only)`);
  // Best climb rate at sea level.
  for (const [what, power] of [['full afterburner', FULL], ['MIL', MIL]]) {
    let best = null;
    for (let kt = 250; kt <= 725; kt += 25) {
      const flight = levelAtKnots(m, kt, 0);
      if (!flight) continue;
      const f = forcesAt(m, stateOf(flight), power);
      flight.dispose();
      const fpm = ((f.fps * f.excess) / f.weight) * 60;
      if (!best || fpm > best.fpm) best = { kt, fpm };
    }
    say(`best climb rate at sea level, ${what}: ${best.fpm.toFixed(0)} ft/min at ${best.kt} kt (the excess power at 1 g; the steps 25 kt). No published figure found in the flight manual's text (its climb charts are the F-4E appendix's)`);
  }
});

test('f4c numbers, reported (no pass or fail): the sustained and instantaneous turn at 450 knots at sea level and at 15,000 ft; glide from 30,000 ft at idle', async () => {
  const m = await module();
  for (const heightFt of [0, 15000]) {
    const flight = levelAtKnots(m, 450, heightFt);
    assert.ok(flight, `level at 450 kt at ${heightFt} ft`);
    const base = stateOf(flight), knots = flight.value('velocities/vtrue-kts');
    flight.dispose();
    const at = (alphaDeg) => forcesAt(m, base, { ...FULL, alphaDeg });
    // Sustained: where the excess is gone.
    let lo = 0, hi = 0;
    while (at(hi).excess > 0 && hi < 30) hi += 1;
    let sustained = null;
    if (hi > 0 && hi < 30) {
      lo = hi - 1;
      for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (at(mid).excess > 0) lo = mid; else hi = mid; }
      sustained = at(lo);
    }
    // Instantaneous: flown. Level at 450 knots with the jet's own flight controls, then full back tilt in full
    // afterburner, wings level: the most g in the first 3 s, and the turn rate it gives at that speed.
    const pulled = Flight.start(m, F4C, { airborne: { heightFt, knots: 450 }, terrain: GROUND });
    let most = { g: 0 };
    for (let k = 0; k < 3 / DT; k++) {
      pulled.fly({ pitch: 1, roll: 0, throttle: 1 });
      assert.equal(pulled.step(1), 0);
      const g = pulled.value('accelerations/Nz');
      if (g > most.g) most = { g, fps: pulled.get('velocities/vt-fps'), alphaDeg: pulled.value('aero/alpha-rad') * DEG, knots: pulled.value('velocities/vc-kts') };
    }
    pulled.dispose();
    const rate = (f) => ((G * Math.sqrt(Math.max(f.g ** 2 - 1, 0))) / f.fps) * DEG;
    say(`450 kt calibrated (${knots.toFixed(0)} true) at ${heightFt ? '15,000 ft' : 'sea level'}, full afterburner: sustained ${sustained ? `${sustained.g.toFixed(1)} g, ${rate(sustained).toFixed(1)} deg/s (angle of attack ${sustained.alphaDeg.toFixed(1)})` : 'not found'}; instantaneous, full back tilt, ${most.g.toFixed(1)} g, ${rate(most).toFixed(1)} deg/s (angle of attack ${most.alphaDeg.toFixed(1)}, at ${most.knots.toFixed(0)} kt calibrated), the limit ${G_LIMIT.value} g. No published figure found in the flight manual's text (its turn charts are the F-4E appendix's). Wings: none at these speeds`);
  }
  // Glide at idle: the best glide angle at each height, then the distance from 30,000 ft.
  const heights = [30000, 20000, 10000, 0], best = [];
  for (const heightFt of heights) {
    let b = null;
    for (let kt = 160; kt <= 360; kt += 10) {
      const flight = levelAtKnots(m, kt, heightFt);
      if (!flight) continue;
      const f = forcesAt(m, stateOf(flight), IDLE);
      flight.dispose();
      const ratio = (f.lift + f.up) / (f.drag - f.along), aero = f.lift / f.drag;
      if (!b || ratio > b.ratio) b = { kt, ratio, aero, thrust: f.along };
    }
    best.push(b);
  }
  let nm = 0;
  for (let i = 1; i < heights.length; i++) nm += (((heights[i - 1] - heights[i]) * (best[i - 1].ratio + best[i].ratio)) / 2) / NM;
  const manual = (GLIDE.value[0] / GLIDE.value[1]) * 30000;
  say(`glide at idle, the best at each height: ${heights.map((h, i) => `${h.toLocaleString('en-US')} ft ${best[i].ratio.toFixed(1)} to 1 at ${best[i].kt} kt calibrated (idle thrust ${best[i].thrust.toFixed(0)} lb; the air's lift over drag alone ${best[i].aero.toFixed(1)})`).join('; ')}: from 30,000 ft about ${nm.toFixed(0)} nm. The flight manual, engines windmilling: ${manual.toFixed(0)} nm from 30,000 ft (${(GLIDE.value[0] * NM / GLIDE.value[1]).toFixed(1)} to 1) at ${GLIDE.value[2]} kt (${GLIDE.source}, ${GLIDE.where})`);
});
