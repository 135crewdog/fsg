// The pilot's controls, headless: device tilt to stick, the throttle, the buttons, and what is sent.
// After 135crewdog/wings, tests/controls.test.js, commit 6d689b7: Wings' two tilt tests are kept as they are.
// (Its look-around test is tests/look.test.js; its throttle test was of a throttle with a MIL detent, and the
// throttle's tests here are FSG's own.) New for FSG: a reading that is not a number, what is sent, the buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAPPING, createTilt, smooth, stickFrom, tiltOf, upInScreen } from '../src/input/tilt.js';
import { BUTTONS, buttonText, buttonsFor, controlsFrom } from '../src/input/pilot.js';
import { positionFromThrottle, throttleFromPosition } from '../src/ui/throttle.js';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { F16 } from '../src/sim/aircraft/f16.js';

const D = Math.PI / 180;
const near = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

// What the phone's sensor reads (beta, gamma in degrees) when "up" lies along
// (x, y, z) in the phone's own directions: x to its right edge, y to its top
// edge, z out of the screen. From the sensor's definition (W3C DeviceOrientation).
function sensor([x, y, z]) {
  for (const beta of [Math.asin(y), Math.PI - Math.asin(y)]) {
    const c = Math.cos(beta);
    if (Math.abs(c) < 1e-9) return { beta: beta / D, gamma: 0 };
    if (z / c >= -1e-12) return { beta: beta / D, gamma: Math.atan2(-x / c, z / c) / D };
  }
  throw new Error('no reading');
}

// A phone held in landscape like a steering wheel, the screen turned
// `screenAngle` from portrait, tipped `back` degrees (top edge toward the
// pilot) and turned `clockwise` degrees as the pilot sees it. Returns the tilt.
function held(screenAngle, back, clockwise) {
  // "Up" as seen on the screen: turning the wheel clockwise swings it anticlockwise;
  // tipping the top edge toward the pilot points it into the screen.
  const onScreen = [-Math.sin(clockwise * D) * Math.cos(back * D), Math.cos(clockwise * D) * Math.cos(back * D), -Math.sin(back * D)];
  // The same direction in the phone's own axes: undo the screen's turn.
  const t = -screenAngle * D, c = Math.cos(t), s = Math.sin(t);
  const { beta, gamma } = sensor([c * onScreen[0] - s * onScreen[1], s * onScreen[0] + c * onScreen[1], onScreen[2]]);
  return tiltOf(upInScreen(beta, gamma, screenAngle));
}

test('tilt: top edge toward you is back stick, clockwise is right stick, in both landscapes', () => {
  for (const angle of [90, 270]) {
    const neutral = held(angle, -15, 0);   // held with the screen leaning back 15 degrees, as on a lap
    const at = (back, clockwise) => stickFrom(held(angle, -15 + back, clockwise), neutral);
    for (const axis of ['pitch', 'roll']) {
      assert.ok(at(0, 0)[axis] === 0, 'at neutral the stick is centred');
      assert.ok(at(1.5, -1)[axis] === 0, 'a small wobble does nothing');
    }
    assert.ok(at(10, 0).pitch > 0 && at(-10, 0).pitch < 0, 'top edge toward you pulls; away pushes');
    assert.ok(at(0, 10).roll > 0 && at(0, -10).roll < 0, 'clockwise is right; anticlockwise is left');
    near(at(MAPPING.pitchFull, 0).pitch, 1, 1e-9, `full back stick at ${MAPPING.pitchFull} degrees`);
    near(at(60, 0).pitch, 1, 1e-9, 'and no more beyond it');
    near(at(0, MAPPING.rollFull).roll, 1, 1e-9, `full right stick at ${MAPPING.rollFull} degrees`);
    near(at(13.5, 0).pitch, 0.5, 1e-9, 'half back stick half way between the dead spot and full');
    near(at(8, 0).roll, 0, 1e-9, 'tipping the phone does not roll');
    near(at(0, 12).pitch, 0, 1e-9, 'turning the phone does not pitch');
  }
  console.log(`  full stick at ${MAPPING.pitchFull} deg of pitch and ${MAPPING.rollFull} deg of roll; dead spot ${MAPPING.pitchDeadband} and ${MAPPING.rollDeadband} deg`);
});

test('tilt: roll fades out as the screen comes to face straight up, and smoothing settles', () => {
  const neutral = held(90, -15, 0);
  const upright = stickFrom(held(90, -15, 20), neutral).roll, flat = stickFrom(held(90, -85, 20), neutral).roll;
  assert.ok(upright > 0.6 && Math.abs(flat) < upright / 2, 'less roll when the phone is nearly flat');
  let x = 0;
  for (let i = 0; i < 10; i++) x = smooth(x, 1, 1 / 60);
  assert.ok(x > 0.99 && x <= 1, 'a sixth of a second after a move the stick is there');
  assert.equal(smooth(0.3, 1, 0), 1, 'with no time between readings, the new one is used');
});

// ---- FSG's own ----
test('tilt: whatever the sensor gives, the stick stays a number, and works again at the next good reading', () => {
  // The browser's two things the listener touches, made up: a window that takes events, and a screen turned to landscape.
  const had = { window: globalThis.window, screen: globalThis.screen };
  globalThis.window = new EventTarget();
  globalThis.screen = { orientation: { angle: 90 } };
  try {
    const sent = [];
    const tilt = createTilt({ onStick: (stick) => sent.push({ ...stick }) });
    let t = 0;
    const reading = (beta, gamma, timeStamp = (t += 16)) => {
      const event = new Event('deviceorientation');
      Object.defineProperties(event, { beta: { value: beta }, gamma: { value: gamma }, timeStamp: { value: timeStamp } });
      globalThis.window.dispatchEvent(event);
    };
    const good = (back, clockwise) => {   // held in landscape, leaning back 15 degrees, then tipped and turned
      const u = [-Math.sin(clockwise * D) * Math.cos((back - 15) * D), Math.cos(clockwise * D) * Math.cos((back - 15) * D), -Math.sin((back - 15) * D)];
      const a = -90 * D, c = Math.cos(a), s = Math.sin(a);
      const { beta, gamma } = sensor([c * u[0] - s * u[1], s * u[0] + c * u[1], u[2]]);
      reading(beta, gamma);
    };
    const ok = () => [tilt.stick.pitch, tilt.stick.roll].every((x) => Number.isFinite(x) && x >= -1 && x <= 1);
    good(0, 0);   // the neutral
    for (let k = 0; k < 20; k++) good(12, 10);
    assert.ok(tilt.stick.pitch > 0.3 && tilt.stick.roll > 0.2 && ok(), 'tipped back and turned clockwise: back and right stick');
    const before = { ...tilt.stick };
    for (const [beta, gamma] of [[null, null], [NaN, 10], [10, NaN], [Infinity, 5], [5, -Infinity], [undefined, undefined]]) {
      reading(beta, gamma);
      assert.ok(ok(), `after a reading of ${beta}, ${gamma} the stick is still a number`);
      assert.deepEqual({ ...tilt.stick }, before, 'and it has not moved');
    }
    reading(NaN, NaN, NaN);
    for (let k = 0; k < 20; k++) good(-12, -10);
    assert.ok(tilt.stick.pitch < -0.3 && tilt.stick.roll < -0.2 && ok(), 'the next good readings move it again: forward and left');
    // A clock that is not a number does not break it either.
    reading(0, 0, NaN);
    good(12, 10);
    assert.ok(ok(), 'nor does a time that is not a number');
    assert.ok(sent.length > 40 && sent.every((s) => Number.isFinite(s.pitch) && Number.isFinite(s.roll)), 'every stick position handed on is a number');
    tilt.recenter();
    assert.deepEqual({ ...tilt.stick }, { pitch: 0, roll: 0 }, 'Recenter centres the stick until the next reading');
    good(12, 10);
    assert.ok(Math.abs(tilt.stick.pitch) < 0.02 && Math.abs(tilt.stick.roll) < 0.02, 'and that reading is the new neutral: the stick within 0.02 of zero');
  } finally {
    globalThis.window = had.window;
    globalThis.screen = had.screen;
  }
});

test('what is sent: numbers from -1 to 1 for the stick, 0 to 1 for the throttle, whatever comes in', () => {
  const pilot = { throttle: 0.4, gear: true, flaps: true, speedbrake: false, brake: false };
  assert.deepEqual(controlsFrom(pilot, { pitch: 0.25, roll: -0.5 }), { pitch: 0.25, roll: -0.5, throttle: 0.4, gear: true, flaps: true, speedbrake: false, brake: false });
  for (const bad of [NaN, undefined, null, Infinity, -Infinity, 'x']) {
    const sent = controlsFrom({ ...pilot, throttle: bad }, { pitch: bad, roll: bad });
    for (const control of ['pitch', 'roll', 'throttle']) assert.ok(Number.isFinite(sent[control]) && sent[control] >= -1 && sent[control] <= 1, `${control} from ${bad}: ${sent[control]}`);
  }
  assert.deepEqual(controlsFrom(pilot, { pitch: 3, roll: -3 }), { ...pilot, pitch: 1, roll: -1 });
  assert.equal(controlsFrom({ ...pilot, throttle: 7 }, null).throttle, 1);
  assert.deepEqual(controlsFrom(pilot, undefined).pitch, 0, 'no stick at all is a centred one');
});

test('the throttle: idle at the bottom, full at the top, a straight line between; a place and back is the same place', () => {
  assert.equal(throttleFromPosition(0), 0);
  assert.equal(throttleFromPosition(1), 1);
  assert.equal(throttleFromPosition(0.5), 0.5);
  assert.equal(throttleFromPosition(-0.2), 0, 'a finger below the groove is idle');
  assert.equal(throttleFromPosition(1.3), 1, 'and above it, full');
  for (const place of [0, 0.1, 0.37, 0.66, 0.72, 0.8, 1]) near(positionFromThrottle(throttleFromPosition(place)), place, 1e-12, `place ${place}`);
  // With a MIL detent (an airplane with an afterburner: the F-4C, milestone 3), Wings' throttle as it was.
  const mil = 0.8;
  assert.equal(throttleFromPosition(0.72, mil), mil, 'a finger on the mark is exactly MIL');
  assert.equal(throttleFromPosition(0.7, mil), mil, 'and anywhere in the band round it');
  assert.equal(throttleFromPosition(1, mil), 1);
  assert.ok(throttleFromPosition(0.6, mil) < mil);
  assert.equal(positionFromThrottle(mil, mil), 0.72, 'at MIL the knob sits on the mark');
});

test('a button shows only if the airplane has the thing, and reads in title case', () => {
  assert.deepEqual(buttonsFor(C172P).map(([control]) => control), ['flaps', 'brake'], 'the Cessna: Flaps and Brakes');
  assert.deepEqual(buttonsFor(F16).map(([control]) => control), ['gear', 'flaps', 'speedbrake', 'brake'].filter((c) => F16.controls[c].to.length > 0));
  const says = (control, pressed) => buttonText(BUTTONS.find(([c]) => c === control), pressed);
  assert.deepEqual([says('flaps', true), says('flaps', false), says('brake', true), says('brake', false)], ['Flaps Down', 'Flaps Up', 'Brakes On', 'Brakes Off']);
  assert.deepEqual([says('gear', true), says('gear', false), says('speedbrake', true), says('speedbrake', false)], ['Gear Down', 'Gear Up', 'Boards Out', 'Boards In']);
});

test('the motion-access screen and the start screen say it in Wings\' few words', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /<section id="screen-denied" class="screen" hidden>\s*<div class="card">\s*<h2>Motion access denied<\/h2>\s*<p>Reopen FSG, tap Fly and allow motion\. If it doesn't ask, allow motion in your browser's settings\.<\/p>/);
  assert.match(page, /<h1>FSG<\/h1>\s*<p class="sub">Hold the device like a steering wheel\.<\/p>/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /const allowed = tilt\.request\(\);\s*keepAwake\(\);/, 'motion access is asked for inside the Fly tap, before anything that waits');
});
