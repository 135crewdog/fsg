// The game's rules (src/sim/rules.js): contact points, hard impacts, water, the crash override, a broken
// state, and limits that are reported and not enforced. New in FSG, milestone 1 (pull request 9). The "done"
// lines are in docs/milestones/1.md, written before any of this was flown.
//
// An arrival is set up just above the ground by JSBSim's initial conditions (the start's `sets`), and its
// sink is adjusted until the sink rate at the last step before the first touch is the one named, within
// 25 ft/min, read back. The verdict judged is the one at that first touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { StepResult } from '../src/sim/codes.js';
import { DT, Flight } from '../src/sim/game.js';
import { TEST_TERRAIN, flatSource, testTerrain } from '../src/sim/ground.js';
import { WINGS_CRASH_FPM } from '../src/sim/rules.js';
import { FT, toWorld } from '../src/sim/world.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(variant) {
  const module = await loadVariant(variant);
  for (const file of new Set([...C172X.files, ...F16.files])) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const DEG = 180 / Math.PI, KT = 1.6878;
const touching = (flight) => flight.stateNames.filter((name, i) => name.endsWith('/WOW') && flight.state[i] === 1);

/**
 * Flies one arrival: `knots` over the ground along `headingDeg`, at `pitchDeg` and `bankDeg`, started
 * `heightFt` above the ground with nothing touching, sinking so that the last step before the first touch
 * sinks at `sinkFpm` (within 25); `sinkFpm: null` with `startSinkFpm` takes whatever sink it arrives with.
 * Then `seconds` more, or until the flight ends.
 */
function arrive(module, aircraft, { knots, sinkFpm, startSinkFpm = sinkFpm, pitchDeg = 0, bankDeg = 0, heightFt, gear = true, at = { north: 0, east: 0 }, headingDeg = 90, terrain = flatSource(0), crashOverride = false, seconds = 3 }) {
  let startSink = startSinkFpm, out, tried = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const sets = [['ic/h-agl-ft', heightFt], ['ic/theta-deg', pitchDeg], ['ic/phi-deg', bankDeg],
      ['ic/vn-fps', knots * KT * Math.cos(headingDeg / DEG)], ['ic/ve-fps', knots * KT * Math.sin(headingDeg / DEG)], ['ic/vd-fps', startSink / 60]];
    const flight = Flight.start(module, aircraft, { at: { ...at, headingDeg }, terrain, sets, settleSeconds: 0, crashOverride, controls: { gear, brake: false, flaps: false } });
    assert.deepEqual(touching(flight), [], 'nothing is touching at the start');
    assert.ok(Math.abs(flight.value('attitude/theta-rad') * DEG - pitchDeg) < 0.01 && Math.abs(Math.abs(flight.value('attitude/phi-rad') * DEG) - Math.abs(bankDeg)) < 0.01, 'the attitude asked for');
    out = { events: [], touches: [], sink: null, speed: null, highest: 0, mostG: 0, flight };
    for (let step = 0; step < 30 / DT && out.sink === null; step++) {
      const sink = flight.value('velocities/v-down-fps') * 60, speed = flight.value('velocities/vg-fps') / KT;
      flight.step(1);
      out.events.push(...flight.rules.takeEvents());
      if (out.events.some((e) => e.type === 'touch') || flight.ended) { out.sink = sink; out.speed = speed; }
    }
    assert.ok(out.sink !== null, 'it reached the ground');
    if (sinkFpm === null || Math.abs(out.sink - sinkFpm) <= 10) break;
    flight.dispose();
    // The next start sink: along the line through the last two tries, or one for one on the first.
    const slope = tried && Math.abs(out.sink - tried.sink) > 1 ? (startSink - tried.start) / (out.sink - tried.sink) : 1;
    tried = { start: startSink, sink: out.sink };
    startSink -= Math.max(0.2, Math.min(2, slope)) * (out.sink - sinkFpm);
  }
  if (sinkFpm !== null) assert.ok(Math.abs(out.sink - sinkFpm) <= 25, `sink at the last step before the touch ${out.sink} ft/min, wanted ${sinkFpm}`);
  const { flight } = out;
  out.firstTouches = out.events.filter((e) => e.type === 'touch');
  for (let step = 0; step < seconds / DT && !flight.ended; step++) {
    out.result = flight.step(1);
    out.events.push(...flight.rules.takeEvents());
    if (flight.ended) break;
    out.highest = Math.max(out.highest, flight.value('position/h-agl-ft'));
    out.mostG = Math.max(out.mostG, flight.value('accelerations/Nz'));
    assert.ok(flight.state.every(Number.isFinite), 'every number given out is finite');
  }
  out.touches = out.events.filter((e) => e.type === 'touch');
  out.ended = flight.ended;
  out.verdict = out.firstTouches.some((e) => e.hard) ? 'hard impact' : out.firstTouches.some((e) => e.water) ? 'water' : 'carry on';
  return out;
}
const said = (r) => `sinking ${r.sink.toFixed(0)} ft/min at ${r.speed.toFixed(0)} kt; first to touch: ${r.firstTouches.map((e) => e.point).join(' and ')}, closing at ${r.firstTouches[0].closingFpm.toFixed(0)} ft/min; ` +
  `${r.ended ? `the flight ends: ${r.ended.reason}` : 'the flight carries on'}`;

// Where each kind of arrival starts: how high, and in what attitude, so that the wheels touch first.
const ON_THE_WHEELS = new Map([[C172X, { knots: 60, pitchDeg: 3, heightFt: 4.8 }], [F16, { knots: 150, pitchDeg: 11, heightFt: 6.4 }]]);
const WINGTIP = new Map([[C172X, { knots: 60, bankDeg: -40, heightFt: 10.6 }], [F16, { knots: 150, bankDeg: -40, pitchDeg: 3, heightFt: 10.3 }]]);
const INTO_THE_FACE = new Map([[C172X, { pitchDeg: 2 }], [F16, { pitchDeg: 12 }]]);

for (const variant of VARIANTS) {
  for (const aircraft of [C172X, F16]) {
    const name = `${variant}, ${aircraft.model}`;
    const wheels = ON_THE_WHEELS.get(aircraft);

    test(`${name}: every wheel and airframe point of the aircraft file can touch, and the touch names it`, async () => {
      // The settings' names are the file's contacts, in the file's order.
      const file = data(aircraft.files[0]).toString();
      const inFile = [...file.matchAll(/<contact type="(BOGEY|STRUCTURE)" name="([^"]+)"/g)].map((m) => m[2]);
      assert.equal(inFile.length, aircraft === C172X ? 6 : 10);
      assert.equal(aircraft.contacts.length, inFile.length);
      console.log(`  ${name}: ${inFile.map((n, i) => `${n} = ${aircraft.contacts[i]}`).join(', ')}`);
      const module = await moduleWith(variant);
      const arrivals = aircraft === C172X ? [
        ['nose low', { knots: 60, startSinkFpm: 300, pitchDeg: -5, heightFt: 5.6 }],
        ['on the mains', { ...wheels, startSinkFpm: 600 }],
        ['tail low', { knots: 55, startSinkFpm: 600, pitchDeg: 16, heightFt: 5.6 }],
        ['left wing low', { ...WINGTIP.get(aircraft), startSinkFpm: 300 }],
        ['right wing low', { ...WINGTIP.get(aircraft), bankDeg: 40, startSinkFpm: 300 }],
      ] : [
        ['nose low', { knots: 150, startSinkFpm: 300, pitchDeg: -3, heightFt: 6.5 }],
        ['on the mains', { ...wheels, startSinkFpm: 600 }],
        ['left wing low', { ...WINGTIP.get(aircraft), startSinkFpm: 300 }],
        ['right wing low', { ...WINGTIP.get(aircraft), bankDeg: 40, startSinkFpm: 300 }],
        ['gear up, level', { knots: 150, startSinkFpm: 300, pitchDeg: 2, heightFt: 5, gear: false }],
        ['gear up, nose 6 degrees down', { knots: 150, startSinkFpm: 300, pitchDeg: -6, heightFt: 5, gear: false }],
        ['gear up, nose 15 degrees down', { knots: 150, startSinkFpm: 300, pitchDeg: -15, heightFt: 8, gear: false }],
        ['on its back', { knots: 150, startSinkFpm: 300, bankDeg: 180, heightFt: 13, gear: false }],
      ];
      const seen = new Map();
      for (const [label, how] of arrivals) {
        const r = arrive(module, aircraft, { ...how, sinkFpm: null, crashOverride: true });
        r.touches.forEach((e, i) => { if (!seen.has(e.point)) seen.set(e.point, `${label}${e === r.firstTouches[0] ? ' (first to touch)' : ''}`); });
        r.flight.dispose();
      }
      console.log(`  ${name}: ${aircraft.contacts.map((point) => `${point}: ${seen.get(point) ?? 'NEVER'}`).join('; ')}`);
      for (const point of aircraft.contacts) assert.ok(seen.has(point), `${point} touched in some arrival`);
    });

    test(`${name}: hard impact. On the wheels at 1,500 ft/min the flight carries on; at 1,900 it ends, with the closing speed within 5% of the sink`, async () => {
      const module = await moduleWith(variant);
      const soft = arrive(module, aircraft, { ...wheels, sinkFpm: 1500 });
      console.log(`  ${name}: ${said(soft)}`);
      assert.equal(soft.verdict, 'carry on');
      assert.equal(soft.ended, null);
      assert.ok(soft.firstTouches.every((e) => e.wheel), 'it arrived on its wheels');
      soft.flight.dispose();
      const hard = arrive(module, aircraft, { ...wheels, sinkFpm: 1900 });
      console.log(`  ${name}: ${said(hard)}`);
      assert.ok(hard.firstTouches.every((e) => e.wheel), 'it arrived on its wheels');
      assert.equal(hard.ended?.reason, 'hard impact');
      assert.ok(Math.abs(hard.ended.closingFpm / hard.sink - 1) <= 0.05, `closing ${hard.ended.closingFpm} ft/min, sink ${hard.sink}`);
      assert.equal(aircraft.crash.closingFpm, WINGS_CRASH_FPM);
      // An ended flight runs no more steps, and says so once.
      const time = hard.flight.value('simulation/sim-time-sec');
      assert.equal(hard.flight.step(120), 0);
      assert.equal(hard.flight.stepsRun, 0);
      assert.equal(hard.flight.value('simulation/sim-time-sec'), time);
      assert.equal(hard.events.filter((e) => e.type === 'ended').length, 1);
      hard.flight.dispose();
    });

    test(`${name}: a scrape. A wingtip touching at 300 ft/min or less: the flight carries on, and the touch is reported`, async () => {
      const r = arrive(await moduleWith(variant), aircraft, { ...WINGTIP.get(aircraft), sinkFpm: 280 });
      console.log(`  ${name}: ${said(r)}`);
      assert.ok(r.sink <= 300);
      assert.equal(r.firstTouches[0].point, 'left wingtip');
      assert.equal(r.verdict, 'carry on');
      assert.equal(r.ended, null);
      r.flight.dispose();
    });

    test(`${name}: a hillside. Level at 100 knots into the 30 degree face: the flight ends, closing at 40 to 60 knots`, async () => {
      const face = TEST_TERRAIN.face;
      const how = { knots: 100, sinkFpm: 0, ...INTO_THE_FACE.get(aircraft), heightFt: 40, headingDeg: 0, at: { north: face.fromNorth + 200, east: 0 }, terrain: testTerrain() };
      const r = arrive(await moduleWith(variant), aircraft, how);
      console.log(`  ${name}: ${said(r)} (${(r.ended.closingFpm / 60 / KT).toFixed(1)} kt)`);
      assert.ok(Math.abs(r.speed - 100) < 2, `${r.speed} kt`);
      assert.equal(r.ended?.reason, 'hard impact');
      const closingKt = r.ended.closingFpm / 60 / KT;
      assert.ok(closingKt >= 40 && closingKt <= 60, `closing at ${closingKt} kt`);
      r.flight.dispose();
    });

    test(`${name}: water. Touching the lake or the sea at 100 ft/min ends the flight`, async () => {
      const module = await moduleWith(variant), { lake, sea } = TEST_TERRAIN;
      for (const [label, at] of [['the lake', { north: lake.north, east: lake.east - 100 }], ['the sea', { north: sea.southOf - 500, east: 0 }]]) {
        const r = arrive(module, aircraft, { ...wheels, sinkFpm: 100, at, terrain: testTerrain() });
        console.log(`  ${name}, ${label}: ${said(r)}`);
        assert.equal(r.ended?.reason, 'water');
        r.flight.dispose();
      }
      // The same arrival on the land between them is a landing.
      const land = arrive(module, aircraft, { ...wheels, sinkFpm: 100, terrain: testTerrain() });
      assert.equal(land.ended, null);
      land.flight.dispose();
    });

    test(`${name}: with the crash override on (the default) none of those four ends the flight, and each is still reported`, async () => {
      const module = await moduleWith(variant), { lake, face } = TEST_TERRAIN;
      assert.equal(Flight.start(module, aircraft).rules.crashOverride, true, 'on unless told otherwise');
      const four = [
        ['hard impact at 1,900 ft/min', { ...wheels, sinkFpm: 1900 }, 'hard impact'],
        ['a wingtip at 280 ft/min', { ...WINGTIP.get(aircraft), sinkFpm: 280 }, 'carry on'],
        ['the hillside', { knots: 100, sinkFpm: 0, ...INTO_THE_FACE.get(aircraft), heightFt: 40, headingDeg: 0, at: { north: face.fromNorth + 200, east: 0 }, terrain: testTerrain() }, 'hard impact'],
        ['the lake', { ...wheels, sinkFpm: 100, at: { north: lake.north, east: lake.east - 100 }, terrain: testTerrain() }, 'water'],
      ];
      for (const [label, how, verdict] of four) {
        const r = arrive(module, aircraft, { ...how, crashOverride: true, seconds: 1 });
        assert.equal(r.verdict, verdict, `${label} is reported as what it is`);
        assert.ok(r.ended === null || r.ended.reason === 'broken state', `${label} does not end the flight`);
        assert.ok(r.firstTouches.length > 0);
        console.log(`  ${name}, override on, ${label}: reported as "${r.verdict}" (${r.firstTouches[0].point}, ${r.firstTouches[0].closingFpm.toFixed(0)} ft/min); ${r.ended ? 'then JSBSim broke' : 'the flight goes on'}`);
        r.flight.dispose();
      }
    });

    test(`${name}: a broken state ends the flight, crash override on or off; every number given out before it is finite; a restart is a parked airplane again`, async () => {
      const module = await moduleWith(variant);
      const parkedAgain = () => {
        const again = Flight.start(module, aircraft);
        const { north, east } = toWorld(again.value('position/lat-geod-rad'), again.value('position/long-gc-rad'));
        assert.ok(Math.hypot(north, east) / FT < 1 && touching(again).length >= 3 && again.value('velocities/vg-fps') < 0.1 && again.ended === null, 'a restart is parked on the numbers');
        again.dispose();
      };
      const over = (flight) => {
        assert.ok(flight.state.every(Number.isFinite), 'the state it keeps is finite');
        const time = flight.value('simulation/sim-time-sec');
        assert.equal(flight.step(10), 0);
        assert.equal(flight.stepsRun, 0, 'an ended flight runs no steps');
        assert.equal(flight.value('simulation/sim-time-sec'), time);
      };
      // JSBSim's own numbers stop being numbers: straight down into the ground, the crash override on, so that
      // nothing ends the flight before JSBSim breaks. (arrive() checks every state given out on the way.)
      const down = arrive(module, aircraft, aircraft === C172X ? { knots: 1, sinkFpm: 10000, pitchDeg: -89, heightFt: 16, crashOverride: true } : { knots: 1, sinkFpm: 30000, pitchDeg: -89, heightFt: 45, crashOverride: true });
      assert.equal(down.ended?.reason, 'broken state');
      assert.equal(down.result, StepResult.NONFINITE);
      assert.equal(down.events.filter((e) => e.type === 'ended').length, 1);
      // The touchdown is still reported, though JSBSim broke inside its half second (Codex's finding on pull
      // request 16): once, before the ending, with the sink of the first touch.
      const types = down.events.map((e) => e.type), reported = down.events.filter((e) => e.type === 'touchdown');
      if (down.firstTouches.some((e) => e.wheel)) {
        assert.equal(reported.length, 1, 'one touchdown is reported');
        assert.ok(Math.abs(reported[0].sinkFpm - down.sink) < 1 && Number.isFinite(reported[0].g), JSON.stringify(reported[0]));
        assert.ok(types.indexOf('touchdown') < types.indexOf('ended'), 'before the ending');
      }
      console.log(`  ${name}: straight down at ${down.sink.toFixed(0)} ft/min, override on: reported "${down.verdict}" at the touch, and JSBSim's numbers broke ${(down.ended.time - down.firstTouches[0].time).toFixed(2)} s later: the flight ended on its last good state`);
      over(down.flight);
      // Every way of reading the ended flight gives the state it kept, not JSBSim's broken numbers (Codex's finding on pull request 16).
      const where = down.flight.where();
      assert.ok(Object.values(where).every(Number.isFinite), JSON.stringify(where));
      assert.equal(where.aboveGroundFt, down.flight.value('position/h-agl-ft'));
      assert.equal(where.heightFt, down.flight.value('position/h-sl-ft'));
      for (const stateName of down.flight.stateNames) assert.ok(Object.is(down.flight.get(stateName), down.flight.value(stateName)), stateName);
      down.flight.dispose();
      parkedAgain();
      // With the override off the same arrival ends at the touch, as a hard impact, before JSBSim can break.
      // The other way a flight breaks: the game hands JSBSim a control that is not a number. The host layer
      // refuses it, and the flight ends there, override on or off.
      for (const crashOverride of [true, false]) {
        const flight = Flight.start(module, aircraft, { crashOverride });
        flight.fly({ brake: false, throttle: 1 });
        assert.equal(flight.step(240), 0);
        const last = Float64Array.from(flight.state);
        flight.fly({ pitch: NaN });
        const result = flight.step(1);
        assert.equal(flight.ended?.reason, 'broken state', `override ${crashOverride ? 'on' : 'off'}`);
        assert.notEqual(result, StepResult.OK);
        assert.deepEqual(flight.state, last, 'the state is the last good one');
        assert.equal(flight.rules.takeEvents().filter((e) => e.type === 'ended').length, 1);
        over(flight);
        console.log(`  ${name}, override ${crashOverride ? 'on' : 'off'}: a control that is not a number ends the flight: "${flight.ended.detail}"`);
        flight.dispose();
        parkedAgain();
      }
    });

    test(`${name}: limits are reported, not enforced: over g and over speed raise a flag and change nothing else; a touchdown is reported with its sink, speed and g`, async () => {
      const module = await moduleWith(variant);
      const unlimited = { ...aircraft, limits: { g: Infinity, knots: Infinity } };
      const fly = (settings) => {
        // Level at a good speed, then full back stick for two seconds (g), then nose down at full power (speed).
        const [start, dive, seconds] = aircraft === C172X ? [{ heightFt: 4000, knots: 110 }, -25, 25] : [{ heightFt: 20000, knots: 600 }, -30, 30];
        const flight = Flight.start(module, settings, { airborne: start });
        const events = [], flags = { g: false, speed: false };
        let fastest = 0, mostG = 0, lowest = Infinity;
        for (let step = 0; step < seconds / DT; step++) {
          const t = step * DT, pitch = flight.value('attitude/theta-rad') * DEG;
          flight.fly({ throttle: 1, roll: Math.max(-1, Math.min(1, -2 * flight.value('attitude/phi-rad'))), pitch: t < 1 ? flight.trimmed.pitch : t < 3 ? 1 : Math.max(-1, Math.min(1, 0.05 * (dive - pitch))) });
          assert.equal(flight.step(1), 0);
          events.push(...flight.rules.takeEvents());
          flags.g ||= flight.rules.over.g; flags.speed ||= flight.rules.over.speed;
          fastest = Math.max(fastest, flight.value('velocities/vc-kts')); mostG = Math.max(mostG, flight.value('accelerations/Nz'));
          lowest = Math.min(lowest, flight.value('position/h-agl-ft'));
        }
        assert.ok(lowest > 500, `it stayed in the air (${lowest} ft)`);
        const state = Float64Array.from(flight.state);
        flight.dispose();
        return { events, flags, fastest, mostG, state };
      };
      const limited = fly(aircraft), free = fly(unlimited);
      console.log(`  ${name}: pulled ${limited.mostG.toFixed(1)} g (limit ${aircraft.limits.g}) and reached ${limited.fastest.toFixed(0)} kt (limit ${aircraft.limits.knots}): ${limited.events.map((e) => e.type).join(', ')}`);
      if (aircraft === C172X) assert.ok(limited.mostG > 3.8 && limited.flags.g && limited.events.some((e) => e.type === 'over g'), 'the Cessna was pulled past 3.8 g and the flag went up');
      assert.ok(limited.fastest > aircraft.limits.knots && limited.flags.speed && limited.events.some((e) => e.type === 'overspeed'), 'it was flown past its speed limit and the flag went up');
      assert.deepEqual(free.events, [], 'with no limits there is nothing to report');
      assert.deepEqual(limited.state, free.state, 'and the flight is the same flight, bit for bit');

      const landing = arrive(module, aircraft, { ...wheels, sinkFpm: 300, crashOverride: true, seconds: 1 });
      const touchdown = landing.events.find((e) => e.type === 'touchdown');
      assert.ok(touchdown && Math.abs(touchdown.sinkFpm - landing.sink) < 1 && Math.abs(touchdown.knots - landing.speed) < 1 && touchdown.g > 1 && touchdown.g < 10, JSON.stringify(touchdown));
      console.log(`  ${name}: a touchdown is reported: sinking ${touchdown.sinkFpm.toFixed(0)} ft/min at ${touchdown.knots.toFixed(0)} kt, ${touchdown.g.toFixed(1)} g`);
      landing.flight.dispose();
      // A bounce that comes down again inside the half second does not replace the touchdown being reported
      // (Codex's finding on pull request 16: at 550 ft/min the report was of the rebound, 16 ft/min and 1.2 g).
      const bounce = arrive(module, aircraft, { ...wheels, sinkFpm: 550, crashOverride: true, seconds: 3 });
      const reported = bounce.events.filter((e) => e.type === 'touchdown');
      const wheelsDown = bounce.touches.filter((e) => e.wheel).map((e) => e.time);
      assert.ok(Math.abs(reported[0].sinkFpm - bounce.sink) < 1 && reported[0].time === bounce.firstTouches[0].time, `the first touchdown reported is the first touch: ${JSON.stringify(reported[0])}`);
      reported.slice(1).forEach((e, i) => assert.ok(e.time >= reported[i].time + 0.5 - DT, 'a later touchdown is at least half a second after the one before'));
      console.log(`  ${name}: arriving at ${bounce.sink.toFixed(0)} ft/min: wheels touch at ${[...new Set(wheelsDown.map((t) => (t - wheelsDown[0]).toFixed(2)))].join(', ')} s; touchdowns reported: ${reported.map((e) => `${e.sinkFpm.toFixed(0)} ft/min, ${e.g.toFixed(1)} g`).join('; ')}`);
      bounce.flight.dispose();
    });
  }
}

// Abuse, with the crash override on: hard arrivals that nothing stops. Each must end sane or as a broken
// state, never hung. What JSBSim does with them is reported in pilot terms, with no pass or fail.
test('abuse with the crash override on: six hard arrivals end sane or as "broken state", never hung', async () => {
  const module = await moduleWith('weh');
  const six = [
    [C172X, 'shallow: 90 kt, sinking 3,000 ft/min', { knots: 90, sinkFpm: 3000, pitchDeg: -5, heightFt: 8 }],
    [C172X, 'steep: 80 kt, sinking 9,000 ft/min, nose 40 degrees down', { knots: 80, sinkFpm: 9000, pitchDeg: -40, heightFt: 12 }],
    [C172X, 'straight down at 10,000 ft/min', { knots: 1, sinkFpm: 10000, pitchDeg: -89, heightFt: 16 }],
    [F16, 'shallow, gear down: 200 kt, sinking 3,000 ft/min', { knots: 200, sinkFpm: 3000, pitchDeg: 2, heightFt: 8 }],
    [F16, 'steep, gear up: 350 kt, sinking 20,000 ft/min, nose 30 degrees down', { knots: 350, sinkFpm: 20000, pitchDeg: -30, heightFt: 22, gear: false }],
    [F16, 'straight down at 30,000 ft/min, gear down', { knots: 1, sinkFpm: 30000, pitchDeg: -89, heightFt: 45 }],
  ];
  for (const [aircraft, label, how] of six) {
    const started = Date.now();
    const r = arrive(module, aircraft, { ...how, crashOverride: true, seconds: 30 });
    const { flight } = r;
    assert.ok(Date.now() - started < 20000, 'it did not hang');
    assert.ok(flight.state.every(Number.isFinite), 'what it gives out is finite');
    assert.ok(r.ended === null || r.ended.reason === 'broken state');
    const { north, east } = toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
    console.log(`  ${aircraft.model}, ${label}: reported "${r.verdict}", ${r.firstTouches[0].point} first; ` + (r.ended
      ? `JSBSim broke ${(r.ended.time - r.firstTouches[0].time).toFixed(2)} s after the touch (${r.ended.detail})`
      : `bounced ${r.highest.toFixed(0)} ft high, ${r.mostG.toFixed(0)} g at most; after 30 s it is ${(Math.hypot(north, east) / FT).toFixed(0)} ft from the touch, ${(flight.value('velocities/vg-fps') / KT).toFixed(0)} kt, ${flight.value('position/h-agl-ft').toFixed(0)} ft up, ` +
        `pitch ${(flight.value('attitude/theta-rad') * DEG).toFixed(0)}, bank ${(flight.value('attitude/phi-rad') * DEG).toFixed(0)} deg`));
    flight.dispose();
  }
});
