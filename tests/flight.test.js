// A flight starts as the game says it does (src/sim/game.js), for both test aircraft and in both WebAssembly
// builds: every number is read back from JSBSim. docs/milestones/1.md, pull request 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { C172X_FILES } from '../src/sim/c172x-files.js';
import { Flight, SETTLE_SECONDS } from '../src/sim/game.js';
import { FIELD, FT } from '../src/sim/world.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(files, variant) {
  const module = await loadVariant(variant);
  for (const file of files) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const AIRCRAFT = [C172X, F16];
const WHEELS = ['gear/unit[0]/WOW', 'gear/unit[1]/WOW', 'gear/unit[2]/WOW'];

/** What a parked airplane is read back as, and how far it moves in the next ten seconds. */
function parked(flight) {
  const at = flight.where();
  const first = { ...at, pitch: flight.get('attitude/theta-deg'), roll: flight.get('attitude/phi-deg') };
  const read = {
    feetFromTheNumbers: Math.hypot(at.north - FIELD.start.north, at.east - FIELD.start.east) / FT,
    headingOff: Math.abs(at.headingDeg - FIELD.start.headingDeg),
    wheels: WHEELS.map((name) => flight.get(name)).join(''),
    thrust: flight.get('propulsion/engine[0]/thrust-lbs'),
    running: flight.get('propulsion/engine[0]/set-running'),
    throttle: flight.get('fcs/throttle-pos-norm'),
    gear: flight.get('gear/gear-pos-norm'),
  };
  let pitch = [first.pitch, first.pitch], roll = [first.roll, first.roll];
  for (let second = 0; second < 10; second++) {
    assert.equal(flight.step(120), 0);
    const p = flight.get('attitude/theta-deg'), r = flight.get('attitude/phi-deg');
    pitch = [Math.min(pitch[0], p), Math.max(pitch[1], p)];
    roll = [Math.min(roll[0], r), Math.max(roll[1], r)];
  }
  const later = flight.where();
  return { ...read, movedFt: Math.hypot(later.north - at.north, later.east - at.east) / FT, pitchMoved: pitch[1] - pitch[0], rollMoved: roll[1] - roll[0] };
}

for (const variant of VARIANTS) {
  for (const aircraft of AIRCRAFT) {
    test(`${variant}, ${aircraft.model}: loads from its listed files, and each one is needed`, async () => {
      const whole = await moduleWith(aircraft.files, variant);
      Flight.start(whole, aircraft, { settleSeconds: 0 }).dispose();
      for (const missing of aircraft.files) {
        const module = await moduleWith(aircraft.files.filter((file) => file !== missing), variant);
        assert.throws(() => Flight.start(module, aircraft, { settleSeconds: 0 }), (error) => error instanceof Error && error.message.length > 0, `${aircraft.model} loaded without ${missing}`);
      }
    });

    test(`${variant}, ${aircraft.model}: the start is what it says, and it stays put`, async () => {
      const module = await moduleWith(aircraft.files, variant);
      const flight = Flight.start(module, aircraft);
      assert.ok(Math.abs(flight.fdm.simTime - SETTLE_SECONDS) < 1e-9, 'settled for the settle time');
      const p = parked(flight);
      console.log(`  ${variant}, ${aircraft.model}: ${p.feetFromTheNumbers.toFixed(3)} ft from the numbers, heading off ${p.headingOff.toFixed(4)} deg, wheels ${p.wheels}, thrust ${p.thrust.toFixed(0)} lb at throttle ${p.throttle}; ` +
        `in the next 10 s it moves ${p.movedFt.toFixed(3)} ft, pitches ${p.pitchMoved.toFixed(3)} deg, rolls ${p.rollMoved.toFixed(3)} deg`);
      assert.ok(p.feetFromTheNumbers < 1, `${p.feetFromTheNumbers} ft from the numbers`);
      assert.ok(p.headingOff < 0.1, `heading ${p.headingOff} degrees off the runway's`);
      assert.equal(p.wheels, '111', 'all three wheels on the ground');
      assert.equal(p.running, 1, 'engine running');
      assert.equal(p.throttle, 0, 'throttle at idle');
      assert.ok(p.thrust > 0, 'the idling engine pulls');
      assert.equal(p.gear, 1, 'gear down');
      for (const name of aircraft.controls.brake.to) assert.equal(flight.get(name), 1, `${name}: brakes on`);
      for (const name of aircraft.controls.flaps.to) assert.equal(flight.get(name), 1, `${name}: flaps selected down`);
      if (aircraft === C172X) assert.equal(flight.get('fcs/flap-pos-deg'), 30, 'the Cessna\'s flaps are down');
      assert.ok(p.movedFt < 1, `moved ${p.movedFt} ft in 10 s`);
      assert.ok(p.pitchMoved < 0.2 && p.rollMoved < 0.2, `pitched ${p.pitchMoved} and rolled ${p.rollMoved} degrees in 10 s`);
      flight.dispose();
    });

    test(`${variant}, ${aircraft.model}: two starts are identical, bit for bit`, async () => {
      const names = ['position/ecef-x-ft', 'position/ecef-y-ft', 'position/ecef-z-ft', 'velocities/u-fps', 'velocities/v-fps', 'velocities/w-fps',
        'attitude/phi-rad', 'attitude/theta-rad', 'attitude/psi-rad', 'velocities/p-rad_sec', 'velocities/q-rad_sec', 'velocities/r-rad_sec',
        'forces/fbz-gear-lbs', 'propulsion/engine[0]/thrust-lbs', 'simulation/sim-time-sec'];
      const once = async () => {
        const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
        const values = names.map((name) => flight.get(name));
        flight.dispose();
        return values;
      };
      const a = await once(), b = await once();
      names.forEach((name, i) => assert.ok(Object.is(a[i], b[i]), `${name}: ${a[i]} vs ${b[i]}`));
    });
  }

  // The plan's line said "after a 3-second settle". Flown before the code was written, that line FAILED for
  // the Cessna, and it is kept: JSBSim starts a running piston engine at full power (2,428 rpm), it takes
  // about 8 seconds to come down to idle (767 rpm), and the nose dips 1.7 degrees and comes back while it
  // does. So a flight is settled for 10 seconds, and the lines above are held after that.
  test(`${variant}: on record, the plan's 3-second settle is not enough for the Cessna (its engine is still winding down)`, async () => {
    const flight = Flight.start(await moduleWith(C172X.files, variant), C172X, { settleSeconds: 3 });
    const rpm = flight.get('propulsion/engine[0]/engine-rpm');
    const p = parked(flight);
    console.log(`  ${variant}: after 3 s the Cessna's engine is at ${rpm.toFixed(0)} rpm; in the next 10 s it pitches ${p.pitchMoved.toFixed(3)} deg (the line: less than 0.2); idle is ${flight.get('propulsion/engine[0]/engine-rpm').toFixed(0)} rpm`);
    assert.ok(p.pitchMoved > 0.2, 'if this ever passes at 3 seconds, the settle can be shortened');
    flight.dispose();
    const f16 = Flight.start(await moduleWith(F16.files, variant), F16, { settleSeconds: 3 });
    assert.ok(parked(f16).pitchMoved < 0.2, 'the F-16 is settled at 3 seconds');
    f16.dispose();
  });
}

test('the overlay\'s Cessna files are the game\'s, plus its start in the air', () => {
  assert.deepEqual([...C172X_FILES].sort(), [...C172X.files, 'aircraft/c172x/reset01.xml'].sort());
});
