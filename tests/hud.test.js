// The HUD, headless: what it writes, and the readings it is drawn from.
// After 135crewdog/wings, tests/hud.test.js, commit 6d689b7. Wings' tests are kept as they are for everything
// FSG's HUD keeps: the heading's text and the apex symbols, the magnetic tape, the tape over the horizon and
// following the view, the mirrored numbers, the bank scale and the VSI's text. Not kept: the steerpoint's
// (milestone 4), and the two that flew Wings' own flight model. In their place the readings are taken from
// JSBSim's states (src/instruments.js), to the lines of docs/milestones/2.md, pull request 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apexFor, headingText, powerText, magnetic, tapeMarks, tapeX, focalLength, viewHeading, vsiText, numberPlaces, bankTickAngle, BANK_TICKS, longBankTick } from '../src/hud.js';
import { VSI_SECONDS, createVsi, instrumentReader } from '../src/instruments.js';
import { readouts } from '../src/readouts.js';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { DT, Flight, STATE } from '../src/sim/game.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

test('the HUD writes heading and the apex symbols as a fighter HUD does', () => {
  assert.equal(headingText(0), '000');
  assert.equal(headingText(-90), '270');
  assert.equal(headingText(359.6), '000');
  assert.equal(headingText(85), '085');
  assert.equal(apexFor(0), null);
  assert.equal(apexFor(80), 'zenith');
  assert.equal(apexFor(-80), 'nadir');
});

test('power: a jet reads IDLE, percent, MIL and AB as in Wings; the Cessna reads percent of throttle to the top', () => {
  assert.equal(powerText(0), 'IDLE');
  assert.equal(powerText(0.62), '62%');
  assert.equal(powerText(1), 'MIL');
  assert.equal(powerText(1.5), 'AB 50%');
  assert.equal(powerText(2), 'AB 100%');
  assert.equal(powerText(0, false), 'IDLE');
  assert.equal(powerText(0.62, false), '62%');
  assert.equal(powerText(1, false), '100%', 'no MIL on an airplane that has none');
  assert.notEqual(C172P.jet, true, 'the Cessna is not a jet');
});

test('the heading tape reads magnetic, War Wagon style', () => {
  // 8R at Honolulu points 090 true; with Hawaii's 9.6 degrees east it reads 080.
  assert.equal(headingText(magnetic(90)), '080');
  assert.equal(headingText(magnetic(5)), '355');
  const marks = tapeMarks(80.4, 802, 190);
  assert.ok(marks.every((m) => Math.abs(m.x) >= 8 && Math.abs(m.x) <= 190), 'nothing under the pointer, nothing past the tape');
  assert.ok(marks.every((m) => !m.label || Math.abs(m.x) > 30), 'no number under the readout');
  assert.deepEqual(marks.filter((m) => m.label).map((m) => m.label), ['07', '09'], 'the tens either side, the 08 under the readout left out');
});

// iPhone 16 in landscape, 852 by 393 points, the chase camera's 55-degree
// view: the tape reaches 22% of the width either side of the middle.
const IPHONE = { w: 852, h: 393 }, FOCAL = focalLength(55, IPHONE.h), REACH = IPHONE.w * 0.22;

test('each heading on the tape sits over its own direction on the horizon', async () => {
  // Three.js's own camera, as the view is drawn: a direction on the horizon
  // some degrees right of where the camera looks lands where tapeX puts it.
  const THREE = await import('../vendor/three/build/three.module.js');
  const camera = new THREE.PerspectiveCamera(55, IPHONE.w / IPHONE.h, 1, 1000);
  camera.updateMatrixWorld();
  for (const right of [-40, -25, -10, 5, 20, 35]) {
    const r = right * Math.PI / 180, p = new THREE.Vector3(Math.sin(r), 0, -Math.cos(r)).project(camera);
    const x = (p.x * IPHONE.w) / 2;
    assert.ok(Math.abs(x - tapeX(right, FOCAL)) < 0.01, `${right} deg right: ${x.toFixed(2)} px on the view, ${tapeX(right, FOCAL).toFixed(2)} on the tape`);
  }
  assert.equal(tapeX(100, FOCAL), null, 'nothing for a heading behind the view');
});

test('the tape follows the view, and the pointer stays with the nose', () => {
  const labels = (marks) => marks.filter((m) => m.label).map((m) => `${m.label}${m.x > 0 ? ' right' : ' left'}`);
  // Not swung, flying 080: the pointer in the middle, the tens either side, as before.
  assert.equal(tapeX(0, FOCAL), 0);
  assert.deepEqual(labels(tapeMarks(80, FOCAL, REACH, 0)), ['06 left', '07 left', '09 right', '10 right']);
  // Flying north, the view swung 70 degrees right: the tape is centred on 070
  // and 090 is over the right side of the view. The nose is 70 degrees left,
  // off the tape, so the pointer has gone with it.
  const yaw = -70, pointer = tapeX(yaw, FOCAL);
  assert.ok(Math.abs(pointer) > REACH + 30, 'the pointer is off the end of the tape');
  const swung = tapeMarks(0 - yaw, FOCAL, REACH, null);
  assert.deepEqual(labels(swung), ['05 left', '06 left', '07 left', '08 right', '09 right']);
  const nine = swung.find((m) => m.label === '09');
  assert.ok(Math.abs(nine.x - tapeX(20, FOCAL)) < 1e-9, '090 sits 20 degrees right of the middle, where the horizon has it');
  // Swung 15 degrees right: the pointer and readout have moved left with the
  // nose, still on the tape, and the numbers under the readout are left out there.
  const near = tapeX(-15, FOCAL), marks = tapeMarks(15, FOCAL, REACH, near);
  assert.ok(near < -90 && near > -REACH, `the pointer ${near.toFixed(0)} px left of the middle`);
  assert.ok(marks.every((m) => Math.abs(m.x - near) >= 8 && (!m.label || Math.abs(m.x - near) > 30)), 'clear of the pointer and readout wherever they are');
  assert.ok(labels(marks).includes('02 right'), 'the middle and right of the tape read on as usual');
});

test('the airspeed and altitude mirror each other, and the horizon line stops short of both', () => {
  // iPhone 16 in landscape: 852 points wide, a 59-point safe-area inset each
  // side, the HUD's edges 84 in from the left (the throttle) and 170 in from
  // the right (the buttons).
  const cx = 426, left = 59 + 84, right = 852 - 59 - 170;
  const at = numberPlaces(cx, left, right);
  assert.equal(cx - at.airspeed, at.altitude - cx, 'the same distance either side of the middle');
  assert.equal(at.altitude, right - 42, 'the altitude stays where the buttons let it, 155 points out');
  assert.ok(at.horizon < at.out && at.horizon > at.out - 30, `the horizon line ends a little short of the numbers (${at.horizon} of ${at.out})`);
  // A screen where the throttle is the tighter side: the airspeed decides.
  const tight = numberPlaces(300, 120, 560);
  assert.equal(tight.airspeed, 120 + 42, 'the airspeed never goes under the throttle');
  assert.equal(300 - tight.airspeed, tight.altitude - 300);
});

test('the bank scale reads the Boeing way, on the banked side', () => {
  assert.deepEqual(BANK_TICKS, [-90, -60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60, 90], '0, 10, 20, 30, 45, 60 and 90 each side');
  assert.deepEqual(BANK_TICKS.filter(longBankTick), [-90, -60, -45, -30, 0, 30, 45, 60, 90], 'long at 0, 30, 45, 60 and 90; short at 10 and 20');
  assert.equal(bankTickAngle(0, 0), 0, 'level: the zero tick under the pointer');
  // In a 30-degree right bank the horizon turns 30 degrees anticlockwise on
  // the glass, and so does the arc: the right-hand 30 tick comes under the
  // pointer, which stays straight up with the jet.
  assert.equal(bankTickAngle(30, -30), 0);
  assert.equal(bankTickAngle(0, -30), -30, 'the zero tick has gone 30 degrees to the left');
  assert.equal(bankTickAngle(-45, 45), 0, 'a 45-degree left bank: the left-hand 45 tick under the pointer');
});

test('the VSI reads feet per minute to the nearest 50, signed, with a true minus sign and "0" near level', () => {
  assert.equal(vsiText(750), '+750');
  assert.equal(vsiText(-1200), '−1200');
  assert.equal(vsiText(-1200)[0], '\u2212', 'a true minus sign, not a hyphen');
  assert.equal(vsiText(0), '0');
  assert.equal(vsiText(24), '0');
  assert.equal(vsiText(-24), '0');
  assert.equal(vsiText(-0.001), '0', 'never "-0"');
  assert.equal(vsiText(26), '+50');
  assert.equal(vsiText(-26), '−50');
  assert.equal(vsiText(774), '+750');
  assert.equal(vsiText(776), '+800');
  assert.equal(vsiText(-12345), '−12350');
});

test('in a bank, the tape follows where the swung view really looks', async () => {
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.05, `${what}: ${a.toFixed(2)}, expected ${b.toFixed(2)}`);
  near(viewHeading(0, 0, 0), 0, 'not swung');
  near(viewHeading(0, 0, -15), 15, 'wings level, swung 15 degrees right: 15 degrees of heading');
  near(viewHeading(0, 0, 40, -20), -40, 'wings level, swung left and down: 40 left');
  near(viewHeading(0, 90, -30), 0, 'in a 90-degree right bank, swinging right looks down, not round');
  // Against three.js's own rotations, as the chase camera turns the view:
  // the jet's attitude, then the swing about its own axes (src/render/camera.js).
  const THREE = await import('../vendor/three/build/three.module.js');
  const D = Math.PI / 180;
  for (const [pitch, roll, yaw, look] of [[0, 60, -15, 0], [10, -45, 30, 10], [-20, 120, -60, -25], [35, 30, 90, 0]]) {
    const jet = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, 0, -roll * D, 'YXZ'));   // heading north: three's axes, x east, y up, -z north
    const swing = new THREE.Quaternion().setFromEuler(new THREE.Euler(look * D, yaw * D, 0, 'YXZ'));
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(jet.multiply(swing));
    near(viewHeading(pitch, roll, yaw, look), Math.atan2(ahead.x, -ahead.z) / D, `pitch ${pitch}, bank ${roll}, swung ${yaw}/${look}`);
  }
});

test('the pause screen has the HUD and debug overlay switches, kept as fsg.hud and fsg.dev', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const pause = page.slice(page.indexOf('id="screen-pause"'), page.indexOf('id="screen-crashed"'));
  assert.ok(pause.includes('id="hud-switch"') && pause.includes('id="dev-switch"'), 'both switches are on the pause screen');
  assert.ok(main.includes("'fsg.hud'") && main.includes("'fsg.dev'"), 'the choices are kept under fsg. keys');
});

// ---- the readings, from JSBSim's states ----
const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function cessna() {
  const module = await loadVariant(VARIANTS[0]);
  for (const file of C172P.files) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const read = instrumentReader(STATE.map(([name]) => name), C172P.standingFt);
const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** Flies for some seconds; `each(t)` before every step; the VSI's needle follows as it does on screen. */
function run(flight, seconds, each, vsi) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    each?.(k * DT);
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
    vsi?.toward(read(flight.state).climb, DT);
  }
}

test('parked on the runway it reads heading 080, 0 knots, R 0, VSI 0, and the bank pointer stands on the 0 tick', async () => {
  const flight = Flight.start(await cessna(), C172P);
  const r = read(flight.state), text = readouts(r.knots, r.feet, r.aboveGround);
  assert.equal(headingText(magnetic(r.heading)), '080', '090 true reads 080 magnetic');
  assert.equal(text.airspeed, '0');
  assert.equal(text.radar, 'R 0', `the wheels are on the ground (${r.aboveGround.toFixed(2)} ft)`);
  assert.equal(vsiText(r.climb), '0');
  assert.ok(Math.abs(bankTickAngle(0, -r.roll)) < 1, `the 0 tick is under the pointer (${r.roll.toFixed(2)} deg of bank)`);
  assert.deepEqual(r.velocity, r.nose, 'standing still, the flight path marker is on the nose');
  assert.ok(r.up[2] < -0.99, 'its own up is straight up');
  flight.dispose();
});

test('trimmed at 100 knots and 2,000 ft it reads 100, 2,000, 1.0 g, JSBSim\'s angle of attack, the flight path on the horizon, VSI 0', async () => {
  const flight = Flight.start(await cessna(), C172P, { airborne: { heightFt: 2000, knots: 100 } });
  const r = read(flight.state), text = readouts(r.knots, r.feet, r.aboveGround);
  assert.ok(Math.abs(Number(text.airspeed) - 100) <= 1, `${text.airspeed} kt`);
  assert.ok(Math.abs(Number(text.altitude.replace(',', '')) - 2000) <= 10, `${text.altitude} ft`);
  assert.ok(Math.abs(r.g - 1) < 0.05, `${r.g.toFixed(3)} g`);
  assert.ok(Math.abs(r.alpha - flight.get('aero/alpha-deg')) < 0.1, `angle of attack ${r.alpha.toFixed(2)}, JSBSim's ${flight.get('aero/alpha-deg').toFixed(2)}`);
  const path = Math.asin(-r.velocity[2]) * DEG;
  assert.ok(Math.abs(path) < 0.2, `the flight path marker is ${path.toFixed(2)} deg off the horizon`);
  assert.ok(Math.abs(r.pitch - r.alpha) < 0.2 && r.nose[2] < 0 === r.pitch > 0, 'level, the nose is off the flight path by the angle of attack');
  assert.equal(vsiText(r.climb), '0');
  console.log(`  trimmed: ${r.knots.toFixed(1)} kt, ${text.altitude} ft (wheels at ${r.feet.toFixed(0)}), ${r.g.toFixed(3)} g, alpha ${r.alpha.toFixed(2)}, path ${path.toFixed(2)} deg`);
  flight.dispose();
});

test('in a steady climb and a steady descent the VSI is within 50 ft/min of JSBSim\'s own climb rate', async () => {
  // Flown by holding a pitch attitude, wings level: 8 degrees up at full power, 4 down at idle. (Held by speed
  // instead, this Cessna's climb rate wanders for minutes, and a wandering rate is not a steady climb.)
  for (const [what, throttle, pitchDeg] of [['climb', 1, 8], ['descent', 0, -4]]) {
    const flight = Flight.start(await cessna(), C172P, { airborne: { heightFt: 3000, knots: 80 } });
    const vsi = createVsi();
    vsi.set(read(flight.state).climb);
    const hold = () => flight.fly({ throttle, roll: clamp(-2 * flight.value('attitude/phi-rad') - 0.5 * flight.value('velocities/p-rad_sec'), -1, 1),
      pitch: clamp(flight.trimmed.pitch + 3 * (pitchDeg / DEG - flight.value('attitude/theta-rad')) - 0.5 * flight.value('velocities/q-rad_sec'), -1, 1) });
    run(flight, 38, hold, vsi);
    const before = flight.get('velocities/h-dot-fps') * 60;
    run(flight, 2, hold, vsi);
    assert.ok(Math.abs(flight.get('velocities/h-dot-fps') * 60 - before) < 20, `steady: ${before.toFixed(0)} ft/min two seconds ago`);
    const own = flight.get('velocities/h-dot-fps') * 60;
    assert.ok(what === 'climb' ? own > 300 : own < -300, `a ${what}: ${own.toFixed(0)} ft/min`);
    assert.ok(Math.abs(vsi.value - own) < 50, `${what}: the VSI ${vsi.value.toFixed(0)}, JSBSim ${own.toFixed(0)} ft/min`);
    console.log(`  ${what}: VSI ${vsiText(vsi.value)} (${vsi.value.toFixed(0)}), JSBSim's own ${own.toFixed(0)} ft/min at ${flight.value('velocities/vc-kts').toFixed(0)} kt`);
    flight.dispose();
  }
});

test('the VSI has no lag to speak of: a 1,000 ft/min change is about 370 short at half a second and true by two', () => {
  const vsi = createVsi();
  vsi.set(0);
  assert.equal(vsi.value, 0);
  for (let k = 0; k < Math.round(VSI_SECONDS / DT); k++) vsi.toward(1000, DT);
  const left = 1000 - vsi.value;
  assert.ok(left > 330 && left < 410, `half a second after a 1,000 ft/min change, ${Math.round(left)} ft/min is still to come (about 370)`);
  for (let k = 0; k < Math.round(1.5 / DT); k++) vsi.toward(1000, DT);
  assert.ok(Math.abs(1000 - vsi.value) < 25, `two seconds on it reads true (${vsi.value.toFixed(0)})`);
  vsi.set(-600);
  assert.equal(vsi.value, -600, 'a new flight reads its climb rate at once');
  // The same whatever the frame rate: thirty frames a second, as in Low Power Mode.
  const slow = createVsi();
  for (let k = 0; k < 15; k++) slow.toward(1000, 1 / 30);
  assert.ok(Math.abs((1000 - slow.value) - left) < 5, 'and at 30 frames a second it moves the same');
});

test('banked 30 degrees right, the pointer stands on the right-hand 30 tick', async () => {
  const flight = Flight.start(await cessna(), C172P, { airborne: { heightFt: 3000, knots: 100 } });
  const want = 30 / DEG;
  run(flight, 15, () => flight.fly({ roll: clamp(flight.trimmed.roll - 3 * (flight.value('attitude/phi-rad') - want) - 0.5 * flight.value('velocities/p-rad_sec'), -1, 1) }));
  const r = read(flight.state);
  assert.ok(Math.abs(r.roll - flight.value('attitude/phi-rad') * DEG) < 1e-9 && r.roll > 0, 'a right bank is a positive roll');
  assert.ok(Math.abs(bankTickAngle(30, -r.roll)) < 1, `the right-hand 30 tick is ${bankTickAngle(30, -r.roll).toFixed(2)} deg from the pointer (bank ${r.roll.toFixed(2)})`);
  assert.ok(Math.abs(bankTickAngle(-30, -r.roll)) > 55, 'and the left-hand one is far from it');
  // Its own up leans toward the right wing: to the right of where it is heading.
  const h = r.heading / DEG, right = [-Math.sin(h), Math.cos(h), 0];
  assert.ok(r.up[0] * right[0] + r.up[1] * right[1] > 0.4, 'its own up leans to the right');
  flight.dispose();
});
