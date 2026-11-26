// The game's Cessna, JSBSim's `c172p` as shipped (src/sim/aircraft/c172p.js), held to the lines milestone 1
// held `c172x` to. New in FSG, milestone 2 (pull request 3); the "done" lines are in docs/milestones/2.md,
// written before any of this was built. The ways of measuring are milestone 1's (tests/flight.test.js,
// assists.test.js, rules.test.js, checkride.test.js), copied here so that those tests stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { assistWrites } from '../src/sim/assists.js';
import { DT, Flight, SETTLE_SECONDS } from '../src/sim/game.js';
import { surfaceReader } from '../src/render/surfaces.js';
import { FIELD, FT, toWorld } from '../src/sim/world.js';
import { bitEqual, classB, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report, loadWithData } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';
import { CIRCUIT, flyCircuit } from './checkride/circuit.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(files, variant) {
  const module = await loadVariant(variant);
  for (const file of files) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const DEG = 180 / Math.PI, KT = 1.6878;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const knots = (flight) => flight.value('velocities/vc-kts');
const feet = (flight) => flight.value('position/h-sl-ft');
const bank = (flight) => flight.value('attitude/phi-rad') * DEG;
const pitch = (flight) => flight.value('attitude/theta-rad') * DEG;
const slip = (flight) => flight.value('aero/beta-rad') * DEG;
/** Runs a flight for some seconds, calling `each(t)` before every step. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
  }
}
/** In the air by JSBSim's own trim, read back: level, steady, at that speed. */
function inTheAir(module, at, options = {}) {
  const flight = Flight.start(module, C172P, { airborne: at, ...options });
  assert.ok(Math.abs(knots(flight) - at.knots) < 0.5 && Math.abs(feet(flight) - at.heightFt) < 1, `${knots(flight)} kt at ${feet(flight)} ft`);
  assert.ok(Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && Math.abs(flight.value('velocities/v-down-fps')) < 0.5 && Math.abs(bank(flight)) < 0.5, 'level and steady');
  return flight;
}
const wingsLevel = (flight) => clamp(-2 * flight.value('attitude/phi-rad') - 0.5 * flight.value('velocities/p-rad_sec'), -1, 1);
const { trim } = C172P.assists;

// The circuit's pilot flies it with the numbers he flies `c172x` with: the same airplane to a pilot.
CIRCUIT.set(C172P, CIRCUIT.get(C172X));
const report = new Report('checkride-c172p');
test.after(() => report.save());

for (const variant of VARIANTS) {
  test(`${variant}, c172p: loads from its three listed files, and each one is needed`, async () => {
    assert.equal(C172P.files.length, 3);
    Flight.start(await moduleWith(C172P.files, variant), C172P, { settleSeconds: 0 }).dispose();
    for (const missing of C172P.files) {
      const module = await moduleWith(C172P.files.filter((file) => file !== missing), variant);
      assert.throws(() => Flight.start(module, C172P, { settleSeconds: 0 }), (error) => error instanceof Error && error.message.length > 0, `it loaded without ${missing}`);
    }
  });

  test(`${variant}, c172p: the start is what it says: on the numbers within 1 ft and 0.1 degrees, all three wheels down, engine at idle, brakes on; over the next 10 s it moves less than 1 ft`, async () => {
    const flight = Flight.start(await moduleWith(C172P.files, variant), C172P);
    assert.ok(Math.abs(flight.fdm.simTime - SETTLE_SECONDS) < 1e-9, 'settled for the settle time');
    const at = flight.where(), fromTheNumbers = Math.hypot(at.north - FIELD.start.north, at.east - FIELD.start.east) / FT;
    const pitch0 = flight.get('attitude/theta-deg'), rpm = flight.get(C172P.propellerRpm);
    assert.ok(fromTheNumbers < 1, `${fromTheNumbers} ft from the numbers`);
    assert.ok(Math.abs(at.headingDeg - FIELD.start.headingDeg) < 0.1, `heading ${at.headingDeg}`);
    assert.ok(Math.abs(at.aboveGroundFt - C172P.standingFt) < 0.01, `its centre of gravity stands ${at.aboveGroundFt} ft up; the settings say ${C172P.standingFt}`);
    assert.ok(Math.abs(pitch0 - C172P.standingPitchDeg) < 0.05, `it stands ${pitch0} degrees nose up; the settings say ${C172P.standingPitchDeg}`);
    for (let k = 0; k < 3; k++) assert.equal(flight.get(`gear/unit[${k}]/WOW`), 1, `wheel ${k} on the ground`);
    assert.equal(flight.get('propulsion/engine[0]/set-running'), 1, 'engine running');
    assert.equal(flight.get('fcs/throttle-pos-norm'), 0, 'throttle at idle');
    assert.ok(rpm >= 700 && rpm <= 900, `idling at ${rpm} RPM`);
    for (const name of C172P.controls.brake.to) assert.equal(flight.get(name), 1, `${name}: brakes on`);
    assert.equal(flight.get('fcs/flap-pos-deg'), 30, 'flaps down');
    let most = 0;
    for (let second = 0; second < 10; second++) { assert.equal(flight.step(120), 0); most = Math.max(most, Math.abs(flight.get('attitude/theta-deg') - pitch0)); }
    const later = flight.where(), moved = Math.hypot(later.north - at.north, later.east - at.east) / FT;
    console.log(`  ${variant}: ${fromTheNumbers.toFixed(3)} ft from the numbers, standing ${at.aboveGroundFt.toFixed(4)} ft up, ${pitch0.toFixed(2)} degrees nose up, idling at ${rpm.toFixed(0)} RPM; in the next 10 s it moves ${moved.toFixed(3)} ft and pitches ${most.toFixed(3)} degrees`);
    assert.ok(moved < 1, `moved ${moved} ft`);
    assert.ok(most < 0.2, `pitched ${most} degrees`);
    flight.dispose();
  });

  test(`${variant}, c172p: the assists write only the trim, the rudder and the nosewheel steering`, async () => {
    assert.deepEqual(assistWrites(C172P.assists).sort(), ['fcs/pitch-trim-cmd-norm', 'fcs/roll-trim-cmd-norm', 'fcs/rudder-cmd-norm', 'fcs/steer-cmd-norm']);
    const flight = Flight.start(await moduleWith(C172P.files, variant), C172P);
    assert.deepEqual([...flight.inputNames].sort(), ['fcs/aileron-cmd-norm', 'fcs/elevator-cmd-norm', 'fcs/flap-cmd-norm', 'fcs/left-brake-cmd-norm', 'fcs/pitch-trim-cmd-norm',
      'fcs/right-brake-cmd-norm', 'fcs/roll-trim-cmd-norm', 'fcs/rudder-cmd-norm', 'fcs/steer-cmd-norm', 'fcs/throttle-cmd-norm'], 'everything the game writes is a cockpit control');
    // With the stick held over on the ground the wheel brakes stay as the toggle has them: this nosewheel steers itself.
    flight.fly({ roll: 1, brake: false });
    run(flight, 1);
    for (const name of C172P.controls.brake.to) assert.equal(flight.get(name), 0, `${name} is not used to steer`);
    assert.ok(flight.get('fcs/steer-cmd-norm') > 0.9, 'the stick steers the nosewheel');
    flight.dispose();
  });

  test(`${variant}, c172p: the stored trim is JSBSim's own at 100 knots within 0.002; stick neutral for 60 s the speed stays within 3 knots, the altitude within 50 ft, the bank within 5 degrees`, async () => {
    const module = await moduleWith(C172P.files, variant);
    const flight = inTheAir(module, { heightFt: trim.heightFt, knots: trim.knots });
    const stored = new Map(trim.sets), own = flight.trimmed.jsbsim;
    console.log(`  ${variant}: JSBSim's own trim at ${knots(flight).toFixed(1)} kt: pitch ${own.pitchTrim.toFixed(4)}, roll ${own.rollStick.toFixed(4)}; stored ${stored.get('fcs/pitch-trim-cmd-norm')}, ${stored.get('fcs/roll-trim-cmd-norm')}`);
    assert.ok(Math.abs(own.pitchTrim - stored.get('fcs/pitch-trim-cmd-norm')) <= 0.002);
    assert.ok(Math.abs(own.rollStick - stored.get('fcs/roll-trim-cmd-norm')) <= 0.002);
    flight.fly({ pitch: 0, roll: 0 });
    const height = feet(flight);
    let slow = Infinity, fast = -Infinity, low = Infinity, high = -Infinity, most = 0;
    run(flight, 60, () => {
      for (const [name, value] of trim.sets) assert.equal(flight.inputs[flight.inputNames.indexOf(name)], value, `${name} is the stored trim at every step`);
      slow = Math.min(slow, knots(flight)); fast = Math.max(fast, knots(flight)); low = Math.min(low, feet(flight)); high = Math.max(high, feet(flight)); most = Math.max(most, Math.abs(bank(flight)));
    });
    console.log(`  ${variant}: stick neutral for 60 s: ${slow.toFixed(1)} to ${fast.toFixed(1)} kt, ${(low - height).toFixed(0)} to ${(high - height).toFixed(0)} ft, bank ${most.toFixed(1)} degrees at most`);
    assert.ok(slow >= trim.knots - 3 && fast <= trim.knots + 3);
    assert.ok(low >= height - 50 && high <= height + 50);
    assert.ok(most <= 5);
    flight.dispose();
  });

  test(`${variant}, c172p: fixed trim. Started 20 knots slow or fast the nose moves the right way within 3 s, each speed swing is smaller than the last, and the speed is within 5 knots of 100 for good inside 150 s`, async () => {
    const module = await moduleWith(C172P.files, variant);
    const level = inTheAir(module, { heightFt: 3000, knots: trim.knots }), throttle = level.trimmed.throttle;
    level.dispose();
    for (const off of [-20, 20]) {
      const flight = inTheAir(module, { heightFt: 3000, knots: trim.knots + off }), pitch0 = pitch(flight);
      let moved = null, lastOutside = 0, before = knots(flight), going = 0;
      const peaks = [];
      run(flight, 300, (t) => {
        flight.fly({ pitch: 0, throttle, roll: wingsLevel(flight) });
        const k = knots(flight);
        if (moved === null && Math.sign(off) * (pitch(flight) - pitch0) > 0.5) moved = t;   // half a degree the right way
        if (Math.abs(k - trim.knots) > 5) lastOutside = t;
        const now = Math.sign(k - before);
        if (t > 1 && now !== 0 && going !== 0 && now !== going) peaks.push({ seconds: t, off: Math.abs(before - trim.knots) });   // after the first second: the start itself is not a swing
        if (now !== 0) going = now;
        before = k;
      });
      console.log(`  ${variant}, started ${Math.abs(off)} kt ${off < 0 ? 'slow' : 'fast'}: the nose is half a degree ${off < 0 ? 'down' : 'up'} after ${moved?.toFixed(1)} s; last more than 5 kt from 100 at ${lastOutside.toFixed(0)} s; ` +
        `100 +/- ${peaks.slice(0, 8).map((p) => p.off.toFixed(1)).join(', ')} kt at ${peaks.slice(0, 8).map((p) => p.seconds.toFixed(0)).join(', ')} s; ${knots(flight).toFixed(1)} kt after 300 s`);
      assert.ok(moved !== null && moved <= 3, `the nose moved the right way at ${moved} s`);
      const swings = peaks.filter((p) => p.off > 0.5);   // below half a knot the swings are too small to tell apart
      assert.ok(swings.length >= 2, 'it swings');
      swings.forEach((p, i) => assert.ok(i === 0 || p.off < swings[i - 1].off, `swing ${i + 1} (${p.off} kt) is smaller than the one before`));
      assert.ok(lastOutside < 150, `last outside 5 kt at ${lastOutside} s`);
      flight.dispose();
    }
  });

  test(`${variant}, c172p: the takeoff roll, steering with the stick alone through the nosewheel, stays within 25 ft of the centreline until liftoff`, async () => {
    const flight = Flight.start(await moduleWith(C172P.files, variant), C172P);
    const wheels = [0, 1, 2].map((k) => flight.stateNames.indexOf(`gear/unit[${k}]/WOW`));
    let worst = 0, liftoff = null;
    run(flight, 60, (t) => {
      const { north, east } = toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
      const off = north / FT, heading = flight.value('attitude/psi-rad') * DEG - 90;
      worst = Math.max(worst, Math.abs(off));
      if (t > 1 && wheels.every((i) => flight.state[i] === 0)) { liftoff = { knots: knots(flight), rollFt: east / FT }; return false; }
      flight.fly({ brake: false, throttle: 1, roll: clamp(-0.5 * heading + 0.05 * off, -1, 1), pitch: knots(flight) > 55 ? 0.5 : 0 });
      return true;
    });
    console.log(`  ${variant}: ${worst.toFixed(1)} ft from the centreline at most; liftoff at ${liftoff?.knots.toFixed(0)} kt after ${liftoff?.rollFt.toFixed(0)} ft`);
    assert.ok(liftoff, 'it lifted off');
    assert.ok(worst <= 25, `${worst} ft off the centreline`);
    flight.dispose();
  });

  test(`${variant}, c172p: automatic feet at 70 and 100 knots. Full stick into a 30 degree bank and back the other way: sideslip 3 degrees at most`, async () => {
    const module = await moduleWith(C172P.files, variant);
    for (const speed of [70, 100]) {
      // Milestone 1's rolls: from level flight the pilot goes for 30 degrees of bank with full stick, easing
      // off as he gets there, holds the turn, and at 16 s goes for 30 degrees the other way.
      const flight = inTheAir(module, { heightFt: 3000, knots: speed }), hold = { ...flight.trimmed };
      let peak = 0, stick = 0, steady = 0;
      run(flight, 30, (t) => {
        const target = t < 2 ? 0 : t < 16 ? 30 : -30;
        const roll = clamp(hold.roll + 4 * (target - bank(flight)) / DEG - 0.8 * flight.value('velocities/p-rad_sec'), -1, 1);
        flight.fly({ roll, pitch: hold.pitch + (1 / Math.cos(bank(flight) / DEG) - 1) * 0.35 });
        if (t > 2) { peak = Math.max(peak, Math.abs(slip(flight))); stick = Math.max(stick, Math.abs(roll)); }
        if (t > 10 && t < 16) steady = Math.max(steady, Math.abs(slip(flight)));
      });
      console.log(`  ${variant}, at ${speed} kt: sideslip ${peak.toFixed(2)} degrees at most in the rolls (stick up to ${(stick * 100).toFixed(0)}%); ${steady.toFixed(2)} in the steady turn`);
      assert.equal(stick, 1, 'the stick reached full');
      assert.ok(peak <= 3, `peak sideslip ${peak} degrees`);
      flight.dispose();
    }
  });

  test(`${variant}, c172p: the picture's moving parts follow the controls the right way: stick back, the elevator's motion goes toward 1; stick right, the aileron's; right rudder, the rudder's; flaps down, the flaps'`, async () => {
    // docs/models.md: 0 is full forward or left, 0.5 neutral, 1 full back or right; flaps 0 up, 1 down.
    const flight = Flight.start(await moduleWith(C172P.files, variant), C172P), motions = surfaceReader(C172P.surfaces, flight.stateNames);
    const after = (controls) => { flight.fly({ pitch: 0, roll: 0, brake: true, ...controls }); run(flight, 4); return motions(flight.state); };
    const parked = after({});
    assert.equal(parked.flaps, 1, 'it starts with its flaps down');
    assert.ok(Math.abs(parked.elevator - 0.5) < 0.12 && Math.abs(parked.aileron - 0.5) < 0.05 && Math.abs(parked.rudder - 0.5) < 0.01, `stick neutral: near neutral, but for the trim (${JSON.stringify(parked)})`);
    const back = after({ pitch: 1 }), forward = after({ pitch: -1 }), right = after({ roll: 1 }), left = after({ roll: -1 }), clean = after({ flaps: false });
    console.log(`  ${variant}: stick back ${back.elevator.toFixed(2)}, forward ${forward.elevator.toFixed(2)}; stick right, aileron ${right.aileron.toFixed(2)} and (on the ground) rudder ${right.rudder.toFixed(2)}; left ${left.aileron.toFixed(2)} and ${left.rudder.toFixed(2)}; flaps up ${clean.flaps.toFixed(2)}`);
    // The trim is nose down and adds to the stick, so full back stick is not quite full up elevator: JSBSim's own figure.
    const pitchTrim = new Map(trim.sets).get('fcs/pitch-trim-cmd-norm');
    assert.ok(Math.abs(back.elevator - (1 - pitchTrim / 2)) < 0.01 && forward.elevator < 0.05, `the elevator (${back.elevator}, ${forward.elevator})`);
    assert.ok(right.aileron > 0.95 && left.aileron < 0.05, 'the ailerons');
    // Milestone 3, PR 2: the rudder is the copilot's alone. Parked, with no swing to hold, the stick does not move it (it was the pedals until 0.0.17).
    assert.ok(Math.abs(right.rudder - 0.5) < 0.02 && Math.abs(left.rudder - 0.5) < 0.02, `the rudder stays the copilot's: the stick does not move it (${right.rudder}, ${left.rudder})`);
    assert.ok(clean.flaps < 1e-6, `the flaps (${clean.flaps})`);
    flight.dispose();
  });

  test(`${variant}, c172p: all seven wheels and airframe points of the aircraft file are named, and each is made to touch`, async () => {
    const inFile = [...data(C172P.files[0]).toString().matchAll(/<contact type="(BOGEY|STRUCTURE)" name="([^"]+)"/g)].map((m) => m[2]);
    assert.deepEqual(inFile, ['NOSE', 'LEFT_MAIN', 'RIGHT_MAIN', 'NOSE_SKID', 'TAIL_SKID', 'LEFT_TIP', 'RIGHT_TIP']);
    assert.equal(C172P.contacts.length, 7);
    const module = await moduleWith(C172P.files, variant), seen = new Map();
    // Arrivals with the crash override on: along the runway at 60 knots (20 for the nose-down one), sinking 300 to
    // 600 ft/min, in each attitude. The nose skid is the propeller's hub: it touches before the nose wheel only
    // when the nose is more than 56 degrees down. The tail skid touches first at 16 degrees nose up.
    const arrivals = [
      ['nose low', { pitchDeg: -5, heightFt: 5.6, sinkFpm: 300 }],
      ['on its nose', { pitchDeg: -70, heightFt: 7.3, sinkFpm: 300, knots: 20 }],
      ['on the mains', { pitchDeg: 3, heightFt: 4.8, sinkFpm: 600 }],
      ['tail low', { pitchDeg: 16, heightFt: 5.9, sinkFpm: 300 }],
      ['left wing low', { bankDeg: -40, heightFt: 10.6, sinkFpm: 300 }],
      ['right wing low', { bankDeg: 40, heightFt: 10.6, sinkFpm: 300 }],
    ];
    for (const [label, { pitchDeg = 0, bankDeg = 0, heightFt, sinkFpm, knots: speed = 60 }] of arrivals) {
      const sets = [['ic/h-agl-ft', heightFt], ['ic/theta-deg', pitchDeg], ['ic/phi-deg', bankDeg], ['ic/vn-fps', 0], ['ic/ve-fps', speed * KT], ['ic/vd-fps', sinkFpm / 60]];
      const flight = Flight.start(module, C172P, { sets, settleSeconds: 0, crashOverride: true, controls: { brake: false, flaps: false } });
      assert.deepEqual(flight.stateNames.filter((name, i) => name.endsWith('/WOW') && flight.state[i] === 1), [], `${label}: nothing is touching at the start`);
      for (let step = 0; step < 5 / DT && !flight.ended; step++) {
        flight.step(1);
        for (const e of flight.rules.takeEvents()) if (e.type === 'touch' && !seen.has(e.point)) seen.set(e.point, label);
      }
      flight.dispose();
    }
    console.log(`  ${variant}: ${C172P.contacts.map((point, i) => `${inFile[i]} = ${point}: ${seen.get(point) ?? 'NEVER'}`).join('; ')}`);
    for (const point of C172P.contacts) assert.ok(seen.has(point), `${point} touched in some arrival`);
  });
}

test('c172p: the circuit, by milestone 1\'s lines. Take off, a left-hand pattern, land on the mains in the first third within 25 ft of the centreline, stop; then the tape again in native JSBSim', async () => {
  const { runway } = FIELD, firstThird = { from: -runway.startBackFt, to: -runway.startBackFt + runway.lengthFt / 3 };
  const how = CIRCUIT.get(C172P), modules = {}, flown = {};
  for (const variant of VARIANTS) {
    modules[variant] = (await loadWithData(variant)).module;
    const c = flown[variant] = flyCircuit(modules[variant], C172P, { record: true });
    const say = (line) => report.line(`  ${variant}: ${line}`);
    report.line(`c172p, ${variant}: ${c.seconds.toFixed(0)} s from parked to stopped`);
    assert.ok(c.onlyTheSeven, 'the pilot used only the seven controls');
    assert.equal(c.ended, null, `no crash (${JSON.stringify(c.ended)})`);
    assert.equal(c.phase, 'stop');
    assert.ok(c.marks.liftoff && c.marks.touchdown && c.marks.stopped, 'it took off, landed and stopped');
    const d = c.downwind, landing = c.touches.filter((e) => e.time > c.marks.liftoff.t + 10), first = landing[0], td = c.marks.touchdown;
    say(`liftoff at ${c.marks.liftoff.knots.toFixed(0)} kt, ${c.marks.liftoff.along.toFixed(0)} ft down the runway, ${Math.abs(c.marks.liftoff.right).toFixed(1)} ft from the centreline`);
    say(`downwind for ${d.seconds.toFixed(0)} s: ${d.low.toFixed(0)} to ${d.high.toFixed(0)} ft (target ${how.patternFt}), ${d.slow.toFixed(0)} to ${d.fast.toFixed(0)} kt (target ${how.downwindKt})`);
    say(`touchdown: ${first.point} first, ${td.along.toFixed(0)} ft down the runway, ${Math.abs(td.right).toFixed(1)} ft from the centreline, ${td.knots.toFixed(0)} kt; every touch: ${landing.map((e) => `${e.point} ${e.closingFpm.toFixed(0)}`).join(', ')} ft/min`);
    say(`stopped ${c.end.along.toFixed(0)} ft down the runway, brakes ${c.brakeOn ? 'on' : 'off'}`);
    assert.ok(d.seconds > 30 && d.low >= how.patternFt - 100 && d.high <= how.patternFt + 100, 'downwind within 100 ft of the pattern height for its whole length');
    assert.ok(d.slow >= how.downwindKt - 10 && d.fast <= how.downwindKt + 10, 'downwind within 10 kt of the target for its whole length');
    assert.ok(/main wheel/.test(first.point), `touchdown on the main wheels (${first.point})`);
    assert.ok(td.along >= firstThird.from && td.along <= firstThird.to, `in the first third of the runway (${td.along} ft)`);
    assert.ok(Math.abs(td.right) <= 25, `within 25 ft of the centreline (${td.right} ft)`);
    for (const e of landing) assert.ok(e.closingFpm <= 600, `${e.point} at ${e.closingFpm} ft/min`);
    assert.ok(c.touches.every((e) => e.wheel), `no airframe point touched (${c.touches.filter((e) => !e.wheel).map((e) => e.point).join(', ')})`);
    assert.ok(c.end.groundKt < 1 && c.brakeOn, 'stopped, brakes on');
    assert.ok(c.end.along >= -runway.startBackFt && c.end.along <= runway.lengthFt - runway.startBackFt && Math.abs(c.end.right) <= runway.widthFt / 2, 'stopped on the runway');
    assert.equal(c.fuelChange, 0, 'fuel as at the start');
  }
  assert.ok(bitEqual(flown.weh.tape.states, flown.jseh.tape.states).equal, 'both builds flew the same flight');

  // Matching native over the whole flight, by milestone 1's lines: altitude 1 ft, angles 0.05 rad, speed
  // 1 knot, or 3 times native's own spread after a one-last-digit nudge where that is larger.
  const tape = flown.weh.tape, { native, ensemble } = flyNative(tape, 'circuit-c172p');
  for (const variant of VARIANTS) {
    const whole = classB(native, flyWasm(modules[variant], tape, `circuit-c172p-${variant}-judged`, JUDGED, { stepByStep: true }), ensemble);
    report.line(`  ${variant} against native, whole flight: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const col of whole.columns) report.line(`    ${col.column}: largest difference ${fmt(col.maxAbs)}; allowed ${fmt(col.allowed)} (line ${fmt(col.cap)}, native's own spread ${fmt(col.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole flight against native`);
  }
});

// Reported for feel, as milestone 1 did for `c172x`: no pass or fail. These are the numbers that go with the
// questions the owner is asked after his first flight (docs/milestones/2.md). One build is enough.
test('c172p, reported for feel (no pass or fail)', async () => {
  const module = await moduleWith(C172P.files, 'weh'), say = (line) => console.log(`  ${line}`);
  // The lean: the stick that holds level flight at each speed, with the trim set once for 100 knots.
  const lean = [60, 70, 80, 100, 120].map((kt) => { const f = inTheAir(module, { heightFt: 2000, knots: kt }); const stick = f.trimmed.pitch; f.dispose(); return `${kt} kt ${Math.abs(stick * 100).toFixed(0)}% ${stick > 0.005 ? 'back' : stick < -0.005 ? 'forward' : '(neutral)'}`; });
  say(`the lean (stick for level flight): ${lean.join(', ')}`);
  // The pull: the most g in three seconds of full back stick.
  const pull = [60, 100, 120].map((kt) => { const f = inTheAir(module, { heightFt: 2000, knots: kt }); f.fly({ pitch: 1 }); let g = 0; run(f, 3, () => { g = Math.max(g, f.value('accelerations/Nz')); }); f.dispose(); return `${g.toFixed(1)} g at ${kt} kt`; });
  say(`full back stick: ${pull.join(', ')}`);
  // The roll: half stick (a phone tilted 15 degrees) held for a second; and full stick to 45 degrees of bank.
  for (const kt of [70, 100]) {
    const half = inTheAir(module, { heightFt: 2000, knots: kt });
    half.fly({ roll: half.trimmed.roll + 0.47 });
    run(half, 1);
    const after = bank(half);
    half.dispose();
    const full = inTheAir(module, { heightFt: 2000, knots: kt });
    full.fly({ roll: 1 });
    let seconds = null, rate = 0;
    run(full, 5, (t) => { rate = Math.max(rate, full.value('velocities/p-rad_sec') * DEG); if (bank(full) >= 45) { seconds = t; return false; } return true; });
    full.dispose();
    say(`at ${kt} kt: half stick for one second banks it ${after.toFixed(0)} degrees; full stick reaches 45 degrees in ${seconds?.toFixed(1)} s, rolling ${rate.toFixed(0)} degrees a second at most`);
  }
  // The takeoff as a phone flies it: brakes off, full throttle, the stick 35% back from 50 knots (a 10 degree tilt), steering down the runway.
  for (const flaps of [true, false]) {
    const f = Flight.start(module, C172P), wheels = [0, 1, 2].map((k) => f.stateNames.indexOf(`gear/unit[${k}]/WOW`));
    let liftoff = null;
    run(f, 60, (t) => {
      const { north, east } = toWorld(f.value('position/lat-geod-rad'), f.value('position/long-gc-rad'));
      if (t > 1 && wheels.every((i) => f.state[i] === 0)) { liftoff = { knots: knots(f), rollFt: east / FT }; return false; }
      f.fly({ brake: false, throttle: 1, flaps, roll: clamp(-0.5 * (f.value('attitude/psi-rad') * DEG - 90) + 0.05 * north / FT, -1, 1), pitch: knots(f) > 50 ? 0.35 : 0 });
      return true;
    });
    f.dispose();
    // The climb: full power at 70 knots, held by pitch, for 30 seconds.
    const c = inTheAir(module, { heightFt: 1000, knots: 70 });
    let from = null;
    run(c, 40, (t) => {
      c.fly({ throttle: 1, flaps, roll: wingsLevel(c), pitch: clamp(c.trimmed.pitch + 0.03 * (knots(c) - 70) - 0.5 * c.value('velocities/q-rad_sec'), -1, 1) });
      if (from === null && t >= 10) from = feet(c);
    });
    const climb = (feet(c) - from) * 2;
    c.dispose();
    say(`flaps ${flaps ? 'down' : 'up'}: stick 35% back from 50 kt, it lifts off at ${liftoff?.knots.toFixed(0)} kt after ${liftoff?.rollFt.toFixed(0)} ft; at full power and 70 kt it climbs ${climb.toFixed(0)} ft/min`);
  }
  // On the ground: the stick full over at taxi power. How wide the circle, and how fast.
  {
    const f = Flight.start(module, C172P);
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity, speed = 0;
    run(f, 90, (t) => {
      f.fly({ brake: false, throttle: 0.25, roll: 1 });
      if (t > 30) { const w = f.where(); west = Math.min(west, w.east); east = Math.max(east, w.east); south = Math.min(south, w.north); north = Math.max(north, w.north); speed = Math.max(speed, f.value('velocities/vg-fps') / KT); }
    });
    f.dispose();
    say(`taxi with the stick full over at a quarter throttle: a circle ${(((east - west) + (north - south)) / 2 / FT).toFixed(0)} ft across at ${speed.toFixed(0)} kt`);
  }
  // Arrivals with the crash override on: how high it bounces.
  for (const sinkFpm of [600, 1500, 3000]) {
    const sets = [['ic/h-agl-ft', 30], ['ic/theta-deg', 3], ['ic/vn-fps', 0], ['ic/ve-fps', 65 * KT], ['ic/vd-fps', sinkFpm / 60]];
    const f = Flight.start(module, C172P, { sets, settleSeconds: 0, crashOverride: true, controls: { brake: false } });
    let touched = false, bounce = 0, g = 0, sink = 0;
    for (let step = 0; step < 8 / DT && !f.ended; step++) {
      const before = f.value('velocities/v-down-fps') * 60;
      f.step(1);
      const events = f.rules.takeEvents();
      if (!touched && events.some((e) => e.type === 'touch')) { touched = true; sink = before; }
      if (touched) { bounce = Math.max(bounce, f.value('position/h-agl-ft') - C172P.standingFt); g = Math.max(g, f.value('accelerations/Nz')); }
    }
    say(`arriving at ${sink.toFixed(0)} ft/min, hands off, crash override on: it bounces ${bounce.toFixed(0)} ft (${g.toFixed(1)} g)${f.ended ? `; the flight ends: ${f.ended.reason}` : ''}`);
    f.dispose();
  }
});
