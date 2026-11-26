// The flap lever: milestone 3, PR F (docs/milestones/3.md). An airplane with more than one flap setting has
// two buttons, Flaps Up and Flaps Down, and an indicator between them that reads the setting; every flight
// starts at the airplane's takeoff setting. The "done" lines were written in the plan before any of this was
// built:
//   - from each setting, Down gives the next and Up the one before; at the ends nothing changes;
//   - whatever is pressed, the control sent is one of the airplane's settings;
//   - JSBSim's flaps arrive at each of the Cessna's four settings within 1 degree and stay;
//   - the start is at the takeoff setting, read back;
//   - milestone 1's tests, which send flaps on or off, pass unchanged (they are tests/controls.test.js,
//     flight.test.js, checkride.test.js and the rest, untouched; on or off is also flown here on the Cessna).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { buttonsFor, controlsFrom, flapLever, flapSetting, flapSettings } from '../src/input/pilot.js';
import { DT, Flight, PARKED, commandsFor, parkedFor } from '../src/sim/game.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

/** A made-up airplane with the flight manual's F-4C flap switch (Up, 1/2, Full), taking off on half flaps. It is not in the app yet. */
const LIKE_F4C = {
  controls: { flaps: { to: ['fcs/flap-cmd-norm'] } },
  flaps: { settings: [{ at: 0, reads: 'Up' }, { at: 0.5, reads: '1/2' }, { at: 1, reads: 'Full' }], takeoff: 1 },
};
/** A made-up airplane whose flaps are only up or down. */
const UP_OR_DOWN = { controls: { flaps: { to: ['fcs/flap-cmd-norm'] } }, flaps: { settings: [{ at: 0, reads: 'Up' }, { at: 1, reads: 'Down' }], takeoff: 1 } };
const LEVERS = [['the Cessna', C172P, ['0°', '10°', '20°', '30°']], ['an airplane like the F-4C', LIKE_F4C, ['Up', '1/2', 'Full']]];

test('the Cessna\'s settings file: four settings from up (0) to fully down (1), in order, read in degrees; it takes off on the second, 10 degrees', () => {
  const { settings, takeoff } = C172P.flaps;
  assert.deepEqual(settings.map((s) => s.reads), ['0°', '10°', '20°', '30°']);
  assert.equal(settings[0].at, 0);
  assert.equal(settings.at(-1).at, 1);
  for (let k = 1; k < settings.length; k++) assert.ok(settings[k].at > settings[k - 1].at, 'each setting is further down than the one before');
  assert.equal(settings[takeoff].reads, '10°');
});

test('which airplane has the lever: more than one flap setting, the two buttons; flaps only up or down, the one button; none, nothing', () => {
  assert.equal(flapSettings(C172P), C172P.flaps.settings, 'the Cessna: the lever');
  assert.equal(flapSettings(LIKE_F4C), LIKE_F4C.flaps.settings, 'an airplane like the F-4C: the lever');
  assert.equal(flapSettings(UP_OR_DOWN), null, 'flaps only up or down: no lever');
  assert.equal(flapSettings(C172X), null, 'c172x, flown with its flaps up or down: no lever');
  assert.ok(buttonsFor(C172X).some(([control]) => control === 'flaps'), 'it keeps the one Flaps button');
  assert.equal(flapSettings(F16), null, 'the F-16, whose flaps are its flight computer\'s: no lever');
  assert.ok(!buttonsFor(F16).some(([control]) => control === 'flaps'), 'and no Flaps button either');
  assert.equal(flapSettings({ ...LIKE_F4C, controls: { flaps: { to: [] } } }), null, 'settings that drive nothing: no lever');
  // FSG's own F-4C (pull request 3) has no flaps in its aircraft file yet: nothing shows, and it parks as it did.
  assert.equal(flapSettings(F4C), null, 'the F-4C, for now: no lever');
  assert.ok(!buttonsFor(F4C).some(([control]) => control === 'flaps'), 'and no Flaps button');
  assert.equal(parkedFor(F4C), PARKED, 'it parks as an airplane with no settings does');
});

for (const [name, aircraft, reads] of LEVERS) {
  const settings = flapSettings(aircraft), ats = settings.map((s) => s.at), last = settings.length - 1;

  test(`${name}: from each setting Flaps Down gives the next and Flaps Up the one before; at the ends nothing changes and that button is dim`, () => {
    settings.forEach(({ at }, k) => {
      const lever = flapLever(settings, at);
      assert.equal(lever.at, at);
      assert.equal(lever.down, k < last ? ats[k + 1] : null, `Flaps Down from "${reads[k]}"`);
      assert.equal(lever.up, k > 0 ? ats[k - 1] : null, `Flaps Up from "${reads[k]}"`);
    });
    // Pressed as the app presses them (src/main.js): a button that has nowhere to go changes nothing.
    const press = (flaps, way) => flapLever(settings, flaps)[way] ?? flaps;
    let flaps = ats[0];
    const read = [];
    for (let k = 0; k < settings.length; k++) { flaps = press(flaps, 'down'); read.push(flapLever(settings, flaps).reads); }
    assert.deepEqual(read, [...reads.slice(1), reads.at(-1)], 'Flaps Down, once more than there are settings below up');
    assert.equal(flapLever(settings, flaps).down, null, 'at the last setting Flaps Down is dim');
    read.length = 0;
    for (let k = 0; k < settings.length; k++) { flaps = press(flaps, 'up'); read.push(flapLever(settings, flaps).reads); }
    assert.deepEqual(read, [...reads.slice(0, -1).reverse(), reads[0]], 'Flaps Up, the same');
    assert.equal(flapLever(settings, flaps).up, null, 'at up Flaps Up is dim');
  });

  test(`${name}: the indicator reads ${reads.map((r) => `"${r}"`).join(', ')}`, () => {
    assert.deepEqual(ats.map((at) => flapLever(settings, at).reads), reads);
  });

  test(`${name}: whatever is pressed, and whatever comes in, the flaps control sent is one of its settings`, () => {
    const stick = { pitch: 0, roll: 0 }, pilot = { throttle: 0, gear: true, flaps: parkedFor(aircraft).flaps, speedbrake: false, brake: true };
    const sent = () => controlsFrom(pilot, stick, aircraft).flaps;
    assert.equal(sent(), ats[aircraft.flaps.takeoff], 'parked: the takeoff setting');
    // A thousand presses, by a made-up hand with no plan (a fixed sequence, so every run is the same).
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seen = new Set();
    for (let k = 0; k < 1000; k++) {
      const to = flapLever(settings, pilot.flaps)[next() < 0.5 ? 'up' : 'down'];
      if (to !== null) pilot.flaps = to;
      assert.ok(ats.includes(sent()), `press ${k}: ${sent()} is one of ${ats.join(', ')}`);
      seen.add(sent());
    }
    assert.equal(seen.size, settings.length, 'every setting was reached');
    // Anything else that could be handed in: the nearest setting; on is fully down, off is up, and what is not a number is up.
    for (const odd of [true, false, NaN, undefined, null, Infinity, -Infinity, 'x', -3, 7, 0.01, 0.49, 0.26, 0.99, 1 / 3 + 1e-9]) {
      const flaps = controlsFrom({ ...pilot, flaps: odd }, stick, aircraft).flaps;
      assert.ok(typeof flaps === 'number' && ats.includes(flaps), `${odd} is sent as ${flaps}`);
    }
    const as = (flaps) => controlsFrom({ ...pilot, flaps }, stick, aircraft).flaps;
    assert.deepEqual([as(true), as(false), as(NaN), as(7), as(-3)], [1, 0, 0, 1, 0]);
    assert.equal(flapSetting(settings, ats[last] - 0.01), last, 'a little short of fully down is fully down');
  });
}

test('an airplane with no lever sends its flaps down or up, as it always has; a parked one starts with them down, and the Cessna at 10 degrees', () => {
  const pilot = { throttle: 0, gear: true, flaps: true, speedbrake: false, brake: true };
  for (const aircraft of [C172X, F16, UP_OR_DOWN, undefined]) {
    assert.equal(controlsFrom(pilot, { pitch: 0, roll: 0 }, aircraft).flaps, true);
    assert.equal(controlsFrom({ ...pilot, flaps: 0 }, { pitch: 0, roll: 0 }, aircraft).flaps, false);
  }
  assert.equal(parkedFor(C172X), PARKED);
  assert.equal(parkedFor(F16), PARKED);
  assert.equal(PARKED.flaps, true);
  assert.deepEqual(parkedFor(C172P), { ...PARKED, flaps: 1 / 3 });
  assert.deepEqual(parkedFor(LIKE_F4C), { ...PARKED, flaps: 0.5 });
  // What JSBSim is given: on and off are 1 and 0, and a setting goes as it is.
  const command = (controls) => new Map(commandsFor(C172P, { ...PARKED, ...controls })).get('fcs/flap-cmd-norm');
  assert.deepEqual([command({ flaps: true }), command({ flaps: false }), command({ flaps: 2 / 3 })], [1, 0, 2 / 3]);
});

test('the page: the lever is in the buttons\' column after the Flaps button, with Flaps Up, Flaps Down and the indicator; its buttons are cut away round the indicator in Safari\'s way and the standard way', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(page, /<button id="flaps"><\/button>\s*(<!--[\s\S]*?-->\s*)?<div id="flap-lever" class="lever" hidden>\s*<button id="flaps-up" class="up">Flaps Up<\/button>\s*<button id="flaps-down" class="down">Flaps Down<\/button>\s*<div id="flaps-reads" class="pill"><\/div>\s*<\/div>/);
  for (const button of ['up', 'down']) {
    const rule = style.match(new RegExp(`#toggles \\.lever \\.${button} \\{([^}]*)\\}`))?.[1] ?? '';
    const masks = [...rule.matchAll(/(-webkit-mask|(?<!-)mask): (url\("[^"]+"\));/g)];
    assert.deepEqual(masks.map((m) => m[1]), ['-webkit-mask', 'mask'], `Flaps ${button}`);
    assert.equal(masks[0][2], masks[1][2], 'the same shape both ways');
  }
});

// ---- on JSBSim's c172p, in both builds ----
const DEGREES = [0, 10, 20, 30];
async function cessna(variant, options) {
  const module = await loadVariant(variant);
  for (const file of C172P.files) module.writeFile(`/data/${file}`, readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url)));
  return Flight.start(module, C172P, options);
}
const flapsDeg = (flight) => flight.get('fcs/flap-pos-deg');
/** Runs a flight for some seconds; returns after how many JSBSim's flaps were first within 1 degree of `degrees`, and the furthest from it they were after that. */
function travel(flight, seconds, degrees) {
  let arrived = null, furthest = 0;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
    const off = Math.abs(flapsDeg(flight) - degrees);
    if (arrived === null && off < 1) arrived = (k + 1) * DT;
    if (arrived !== null) furthest = Math.max(furthest, off);
  }
  return { arrived, furthest };
}

for (const variant of VARIANTS) {
  test(`${variant}, c172p: every flight starts at the takeoff setting, read back: the command at 1/3, the flaps at 10 degrees, and they stay`, async () => {
    const flight = await cessna(variant);
    assert.equal(flight.controls.flaps, 1 / 3, 'the flaps control');
    assert.ok(flight.startSets.some(([name, value]) => name === 'fcs/flap-cmd-norm' && value === 1 / 3), 'it is in the start, so in the tape');
    assert.equal(flight.get('fcs/flap-cmd-norm'), 1 / 3, 'JSBSim\'s flap command, read back');
    assert.ok(Math.abs(flapsDeg(flight) - 10) < 1, `the flaps are at ${flapsDeg(flight)} degrees`);
    assert.ok(Math.abs(flight.value('fcs/flap-pos-norm') - 1 / 3) < 1 / 30, 'and the state says so, for the picture');
    const { furthest } = travel(flight, 10, 10);
    assert.ok(furthest < 1, `over the next 10 s they are never more than ${furthest} degrees from 10`);
    console.log(`  ${variant}: parked with the flaps at ${flapsDeg(flight)} degrees`);
    flight.dispose();
  });

  test(`${variant}, c172p: JSBSim's flaps arrive at each of the four settings within 1 degree and stay, going down and coming up, and the indicator reads the degrees they arrive at`, async () => {
    const flight = await cessna(variant), settings = flapSettings(C172P), times = [];
    // Down through every setting, up through every setting, then all the way down and all the way up in one go.
    let from = C172P.flaps.takeoff;
    for (const to of [0, 1, 2, 3, 2, 1, 0, 3, 0]) {
      flight.fly({ flaps: settings[to].at });
      const { arrived, furthest } = travel(flight, 15, DEGREES[to]);
      assert.equal(flight.get('fcs/flap-cmd-norm'), settings[to].at, 'JSBSim\'s flap command, read back');
      assert.ok(arrived !== null && arrived <= 5, `from ${DEGREES[from]} to ${DEGREES[to]} degrees: there within 5 s (${arrived})`);
      assert.ok(furthest < 1 && Math.abs(flapsDeg(flight) - DEGREES[to]) < 1, `and they stay: ${flapsDeg(flight)} degrees 15 s after the press, never more than ${furthest} from ${DEGREES[to]} once there`);
      assert.equal(flapLever(settings, settings[to].at).reads, `${Math.round(flapsDeg(flight))}°`, 'the indicator reads what JSBSim\'s flaps are at');
      times.push(`${DEGREES[from]} to ${DEGREES[to]} in ${arrived.toFixed(1)} s`);
      from = to;
    }
    console.log(`  ${variant}: within 1 degree of the setting: ${times.join(', ')}`);
    flight.dispose();
  });

  test(`${variant}, c172p: through the pilot's hands: each press of Flaps Down, then of Flaps Up, sent as the app sends it, puts JSBSim's flaps at what the indicator reads`, async () => {
    const flight = await cessna(variant), settings = flapSettings(C172P), stick = { pitch: 0, roll: 0 };
    const pilot = { throttle: 0, gear: true, flaps: parkedFor(C172P).flaps, speedbrake: false, brake: true };
    const read = [];
    for (const way of ['up', 'down', 'down', 'down', 'down', 'up', 'up', 'up', 'up']) {
      const to = flapLever(settings, pilot.flaps)[way];
      if (to !== null) pilot.flaps = to;
      flight.fly(controlsFrom(pilot, stick, C172P));
      travel(flight, 5, 0);
      const says = flapLever(settings, pilot.flaps).reads;
      assert.ok(Math.abs(flapsDeg(flight) - parseInt(says, 10)) < 1, `Flaps ${way}: it reads "${says}" and the flaps are at ${flapsDeg(flight)} degrees`);
      read.push(says);
    }
    assert.deepEqual(read, ['0°', '10°', '20°', '30°', '30°', '20°', '10°', '0°', '0°']);
    flight.dispose();
  });

  test(`${variant}, c172p: flaps sent on or off, as milestone 1's tests send them, still go fully down and up`, async () => {
    const flight = await cessna(variant);
    flight.fly({ flaps: true });
    travel(flight, 5, 30);
    assert.equal(flapsDeg(flight), 30, 'on: fully down');
    flight.fly({ flaps: false });
    travel(flight, 5, 0);
    assert.equal(flapsDeg(flight), 0, 'off: up');
    // And a flight can still be started with them on or off, whatever the airplane's takeoff setting.
    for (const [flaps, degrees] of [[true, 30], [false, 0]]) {
      const started = await cessna(variant, { controls: { flaps } });
      assert.equal(flapsDeg(started), degrees, `started with flaps ${flaps ? 'on' : 'off'}`);
      started.dispose();
    }
    flight.dispose();
  });
}
