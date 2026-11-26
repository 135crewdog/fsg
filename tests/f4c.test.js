// The F-4C, FSG's own aircraft file (aircraft/f4c/, src/sim/aircraft/f4c.js): how it stands and runs its
// engines. New in FSG, milestone 3 (pull request 3); the "done" lines are in docs/milestones/3.md, written
// before any of this was built, and each test below is named for the line it holds. After tests/c172p.test.js.
// How it flies is tests/f4c-aero.test.js (pull request 5). Since the file has aerodynamics, two tests here
// changed with it, and each says how: the one that rolls the airplane in the air now counts the air's own
// pitching moment, and the list of what the game writes has the pitch trim in it.
// Every measured number is printed beside its reference (tests/checkride/f4c-reference.js) and kept in
// jsbsim/build/results/checkride-f4c.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, homeOf as pageHomeOf } from '../src/fdm.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { assistWrites } from '../src/sim/assists.js';
import { buildPack } from '../src/sim/files.js';
import { flightRun } from '../src/sim/flight-run.js';
import { DT, Flight, SETTLE_SECONDS } from '../src/sim/game.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';
import { FIELD, FT } from '../src/sim/world.js';
import { bitEqual, classA, classB, classN, describeN, fmt } from '../jsbsim/tests/lib/compare.js';
import { Report } from '../jsbsim/tests/lib/harness.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { headTrace, runNative } from '../jsbsim/tests/lib/scenario.js';
import { bytesOf, moduleWith, rootWith } from './checkride/files.js';
import * as REFERENCE from './checkride/f4c-reference.js';
import { JUDGED, flyNative, flyWasm } from './checkride/tape.js';
import { madeUpTimer } from './made-up-timer.js';

const { WEIGHT, ROLL_INERTIA, PITCH_INERTIA, YAW_INERTIA, CROSS_INERTIA, THRUST_TILT, THRUST_LINE_ABOVE_CG, MIL_THRUST, MAX_THRUST,
  NOSE_WHEEL, LEFT_MAIN_WHEEL, RIGHT_MAIN_WHEEL, LEFT_ENGINE_EXIT, RIGHT_ENGINE_EXIT, GEAR_SECONDS, WINGS_SECONDS_TO_MIL, WINGS_SECONDS_TO_FULL_AFTERBURNER, RUN_UP_RPM } = REFERENCE;
const DEG = 180 / Math.PI, KT = 1.6878;
const ENGINES = [0, 1];
const thrust = (flight, n) => flight.get(`propulsion/engine[${n}]/thrust-lbs`);
const rpm = (flight, n) => flight.get(`propulsion/engine[${n}]/n2`);
/** What the afterburner gives, 0 to 1: the aircraft file's own number, the one the plumes will read. */
const burner = (flight, n) => flight.get(`fcs/afterburner-norm${n ? `[${n}]` : ''}`);
const toEngine = (flight, n) => flight.get(`fcs/throttle-pos-norm${n ? `[${n}]` : ''}`);
/** A reference number, as text: its value, and where it is from. */
const cite = (ref) => `${Array.isArray(ref.value) ? `[${ref.value.join(', ')}]` : ref.value} ${ref.unit} (${ref.source}, ${ref.where})`;
/** The aircraft file, as text. */
const file = bytesOf(F4C, F4C.files[0]).toString();

/** Runs a flight for some seconds, calling `each(t)` before every step. */
function run(flight, seconds, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
  }
}
/**
 * Parked and held down: JSBSim's own hold-down (forces/hold-down), which keeps the airplane where it is
 * whatever the engines do, so "standing still" is true at any power. Read back: held, and not moving.
 */
function heldDown(module) {
  const flight = Flight.start(module, F4C, { sets: [['forces/hold-down', 1]] });
  assert.equal(flight.get('forces/hold-down'), 1, 'held down');
  return flight;
}
const still = (flight) => {
  assert.ok(flight.value('velocities/vg-fps') < 0.001 && flight.value('velocities/mach') < 1e-6, `standing still (${flight.value('velocities/vg-fps')} ft/s)`);
  assert.ok(Math.abs(flight.value('position/h-sl-ft') - F4C.standingFt) < 0.1 && FIELD.heightFt === 0, `at sea level (${flight.value('position/h-sl-ft')} ft)`);
};
/** In the air with no trim, so not in steady flight: 20,000 ft and 400 knots, gear up. Read back. */
function inTheAir(module, controls, sets = []) {
  const flight = Flight.start(module, F4C, { sets: [['ic/h-sl-ft', 20000], ['ic/vc-kts', 400], ...sets], settleSeconds: 0, controls: { gear: false, brake: false, ...controls } });
  assert.ok(Math.abs(flight.value('position/h-sl-ft') - 20000) < 1 && Math.abs(flight.value('velocities/vc-kts') - 400) < 0.5, `${flight.value('velocities/vc-kts')} kt at ${flight.value('position/h-sl-ft')} ft`);
  assert.deepEqual(flight.stateNames.filter((name, i) => name.endsWith('/WOW') && flight.state[i] !== 0), [], 'nothing touches the ground');
  assert.equal(flight.value('gear/gear-pos-norm'), 0, 'gear up');
  return flight;
}

const report = new Report('checkride-f4c');
test.after(() => report.save());

for (const variant of VARIANTS) {
  const say = (line) => report.line(`  ${variant}: ${line}`);

  test(`${variant}, f4c: "It loads in both WebAssembly builds ... from only its listed files, each shown to be needed"`, async () => {
    assert.equal(F4C.files.length, 3);
    assert.ok(F4C.own && F4C.files.every((path) => path.startsWith('aircraft/f4c/')), 'its files are FSG\'s own, in aircraft/f4c/');
    Flight.start(await moduleWith(F4C, variant), F4C, { settleSeconds: 0 }).dispose();
    for (const missing of F4C.files) {
      const module = await moduleWith(F4C, variant, F4C.files.filter((path) => path !== missing));
      assert.throws(() => Flight.start(module, F4C, { settleSeconds: 0 }), (error) => error instanceof Error && error.message.length > 0, `it loaded without ${missing}`);
    }
    say(`loads from ${F4C.files.join(', ')}; not without any one of them`);
  });

  test(`${variant}, f4c: "Read back from a run: 38,924 lb within 5; the centre of gravity as loaded at the model's origin within 0.1 in; roll, pitch and yaw inertias within 0.5% of CR-2144's (25,002, 122,193 and 139,767 slug-ft2), and the cross inertia within 1% (2,177)"`, async () => {
    const module = await moduleWith(F4C, variant), flight = Flight.start(module, F4C);
    const weight = flight.get('inertia/weight-lbs'), cg = ['x', 'y', 'z'].map((axis) => flight.get(`inertia/cg-${axis}-in`));
    say(`weight ${weight} lb (${flight.get('inertia/empty-weight-lbs')} and ${flight.get('propulsion/total-fuel-lbs')} of fuel); reference ${cite(WEIGHT)}; within 5`);
    assert.ok(Math.abs(weight - WEIGHT.value) <= 5);
    say(`centre of gravity as loaded: ${cg.join(', ')} in from the model's origin; within 0.1`);
    assert.ok(cg.every((inches) => Math.abs(inches) <= 0.1));
    for (const [what, name, ref] of [['roll', 'ixx', ROLL_INERTIA], ['pitch', 'iyy', PITCH_INERTIA], ['yaw', 'izz', YAW_INERTIA]]) {
      const inertia = flight.get(`inertia/${name}-slugs_ft2`);
      say(`${what} inertia ${inertia} slug-ft2; reference ${cite(ref)}; within 0.5%`);
      assert.ok(Math.abs(inertia / ref.value - 1) <= 0.005);
    }
    // JSBSim's inertia/ixz-slugs_ft2 is the corner of its inertia matrix, which is minus the usual Ixz
    // (FGMassBalance.h, GetIxz; the other two products are given the usual way round). So the usual one is its opposite.
    const cross = -flight.get('inertia/ixz-slugs_ft2');
    say(`cross inertia ${cross} slug-ft2 (JSBSim's own number has the other sign: ${-cross}); reference ${cite(CROSS_INERTIA)}; within 1%`);
    assert.ok(Math.abs(cross / CROSS_INERTIA.value - 1) <= 0.01);
    assert.ok(Math.abs(flight.get('inertia/ixy-slugs_ft2')) < 1e-9 && Math.abs(flight.get('inertia/iyz-slugs_ft2')) < 1e-9, 'the airplane is the same left and right');
    flight.dispose();

    // The sense of it, from a run and not from a sign in a file. Rolled at 2 radians a second, an airplane
    // whose mass leans nose down (a positive Ixz) is pitched nose down by its own rolling, at Ixz p2 / Iyy:
    // the pitch equation of any textbook (Stevens, Lewis and Johnson: Iyy q' = (Izz - Ixx) p r - Ixz (p2 - r2) + M).
    // M is what the engines and, since pull request 5, the air add. Both are read from the same moment and
    // taken out, so what is judged is still the rolling's own part, by the same 1%.
    const rolling = inTheAir(module, { throttle: 0 }, [['ic/p-rad_sec', 2]]);
    const p = rolling.value('velocities/p-rad_sec'), r = rolling.value('velocities/r-rad_sec');
    const power = rolling.get('moments/m-prop-lbsft'), air = rolling.get('moments/m-aero-lbsft');
    assert.ok(Math.abs(p - 2) < 1e-3 && Math.abs(r) < 1e-3, `rolling at ${p} rad/s, yawing at ${r}`);
    const pitching = rolling.get('accelerations/qdot-rad_sec2');
    const measured = pitching - (power + air) / PITCH_INERTIA.value;
    const expected = (-CROSS_INERTIA.value * (p * p - r * r)) / PITCH_INERTIA.value;
    say(`rolling at 2 rad/s, the nose is pitching at ${pitching.toFixed(5)} rad/s2, of which the engines' ${power.toFixed(1)} lb-ft and the air's ${air.toFixed(1)} lb-ft give ${((power + air) / PITCH_INERTIA.value).toFixed(5)}; the rest, the rolling's own, is nose ${measured < 0 ? 'down' : 'UP'} at ${measured.toFixed(5)}; a positive Ixz of ${CROSS_INERTIA.value} gives ${expected.toFixed(5)}; within 1%`);
    assert.ok(measured < 0, 'nose down: the cross inertia has CR-2144\'s sense');
    assert.ok(Math.abs(measured / expected - 1) <= 0.01);
    rolling.dispose();
  });

  test(`${variant}, f4c: "It stands on the numbers: all three wheels down, each within 1 in of where Wings' card has it; the nosewheel carries 13% to 17% of the weight (the geometry says 15.1%); it sits within 0.5 degrees of level; over 10 s at idle with the brakes on it moves less than 1 ft"`, async () => {
    const flight = Flight.start(await moduleWith(F4C, variant), F4C);
    assert.ok(Math.abs(flight.fdm.simTime - SETTLE_SECONDS) < 1e-9, 'settled for the settle time');
    const at = flight.where(), fromTheNumbers = Math.hypot(at.north - FIELD.start.north, at.east - FIELD.start.east) / FT;
    const pitch0 = flight.get('attitude/theta-deg'), bank0 = flight.get('attitude/phi-deg');
    assert.ok(fromTheNumbers < 1, `${fromTheNumbers} ft from the numbers`);
    assert.ok(Math.abs(at.headingDeg - FIELD.start.headingDeg) < 0.1, `heading ${at.headingDeg}`);
    assert.ok(Math.abs(at.aboveGroundFt - F4C.standingFt) < 0.01, `its centre of gravity stands ${at.aboveGroundFt} ft up; the settings say ${F4C.standingFt}`);
    assert.ok(Math.abs(pitch0 - F4C.standingPitchDeg) < 0.05, `it stands ${pitch0} degrees nose up; the settings say ${F4C.standingPitchDeg}`);
    for (let k = 0; k < 3; k++) assert.equal(flight.get(`gear/unit[${k}]/WOW`), 1, `wheel ${k} on the ground`);
    for (let k = 3; k < F4C.contacts.length; k++) assert.equal(flight.get(`contact/unit[${k}]/WOW`), 0, `${F4C.contacts[k]} off the ground`);
    assert.equal(flight.get('gear/gear-pos-norm'), 1, 'gear down');
    for (const name of F4C.controls.brake.to) assert.equal(flight.get(name), 1, `${name}: brakes on`);
    for (const n of ENGINES) {
      assert.equal(flight.get(`propulsion/engine[${n}]/set-running`), 1, `engine ${n} running`);
      assert.equal(toEngine(flight, n), 0, `engine ${n}: throttle at idle`);
    }
    say(`${fromTheNumbers.toFixed(3)} ft from the numbers, its centre of gravity ${at.aboveGroundFt.toFixed(4)} ft up, engines idling at ${rpm(flight, 0).toFixed(1)}% and ${rpm(flight, 1).toFixed(1)}%`);
    say(`it sits ${pitch0.toFixed(3)} degrees nose up and ${bank0.toFixed(3)} degrees right wing down; within 0.5 of level`);
    assert.ok(Math.abs(pitch0) <= 0.5 && Math.abs(bank0) <= 0.5);

    // Where each tyre meets the runway, in the airplane's own axes: JSBSim's place for the wheel with its leg
    // unloaded (read back, in inches aft, right and up, from the centre of gravity as loaded), less what the
    // leg has given under the airplane's weight.
    const cg = ['x', 'y', 'z'].map((axis) => flight.get(`inertia/cg-${axis}-in`));
    const springs = [...file.matchAll(/<contact type="BOGEY" name="[^"]+">[^]*?<spring_coeff unit="LBS\/FT">\s*([\d.]+)\s*<\/spring_coeff>/g)].map((m) => Number(m[1]));
    assert.equal(springs.length, 3);
    const weight = flight.get('inertia/weight-lbs'), loads = [];
    for (const [k, ref] of [NOSE_WHEEL, LEFT_MAIN_WHEEL, RIGHT_MAIN_WHEEL].entries()) {
      const [x, y, z] = ['x', 'y', 'z'].map((axis, i) => flight.get(`gear/unit[${k}]/${axis}-position`) - cg[i]);
      const given = flight.get(`gear/unit[${k}]/compression-ft`);
      const tyre = [-x / 12, y / 12, -z / 12 - given];   // ft forward, right and down
      const off = Math.hypot(...tyre.map((feet, i) => feet - ref.value[i])) * 12;
      loads.push(springs[k] * given);
      say(`${F4C.contacts[k]}: the tyre meets the runway at [${tyre.map((feet) => feet.toFixed(3)).join(', ')}] (its leg has given ${(given * 12).toFixed(2)} in and carries ${loads[k].toFixed(0)} lb); reference ${cite(ref)}; ${off.toFixed(2)} in off; within 1`);
      assert.ok(off <= 1, `${F4C.contacts[k]} is ${off} in from where the model has it`);
    }
    // The three legs carry the airplane, less the small upward part of the idle thrust: read back, so the share below means what it says.
    const carried = loads.reduce((sum, load) => sum + load, 0) - flight.get('forces/fbz-prop-lbs');
    assert.ok(Math.abs(carried / weight - 1) < 0.01, `the legs and the thrust carry ${carried} lb of ${weight}`);
    const share = loads[0] / weight * 100, wheelbase = NOSE_WHEEL.value[0] - LEFT_MAIN_WHEEL.value[0];
    say(`the nosewheel carries ${share.toFixed(1)}% of the weight; the geometry says ${(-LEFT_MAIN_WHEEL.value[0] / wheelbase * 100).toFixed(1)}% with the engines stopped; 13% to 17%`);
    assert.ok(share >= 13 && share <= 17);

    let most = 0;
    for (let second = 0; second < 10; second++) { assert.equal(flight.step(120), 0); most = Math.max(most, Math.abs(flight.get('attitude/theta-deg') - pitch0)); }
    const later = flight.where(), moved = Math.hypot(later.north - at.north, later.east - at.east) / FT;
    say(`over the next 10 s at idle, brakes on, it moves ${moved.toFixed(4)} ft and pitches ${most.toFixed(4)} degrees; less than 1 ft`);
    assert.ok(moved < 1, `moved ${moved} ft`);
    flight.dispose();
  });

  test(`${variant}, f4c: "Each engine, sea level, standing still: 10,900 lb at MIL and 17,000 lb in full afterburner, within 2% (T.O. 1F-4C-1). Fuel does not burn"`, async () => {
    const flight = heldDown(await moduleWith(F4C, variant));
    const weight = flight.get('inertia/weight-lbs'), fuel = flight.get('propulsion/total-fuel-lbs');
    for (const [what, throttle, ref] of [['MIL', F4C.mil, MIL_THRUST], ['full afterburner', 1, MAX_THRUST]]) {
      flight.fly({ throttle });
      run(flight, 10);
      still(flight);
      for (const n of ENGINES) {
        say(`engine ${n} at ${what} (throttle ${throttle}, ${rpm(flight, n).toFixed(1)}%): ${thrust(flight, n).toFixed(1)} lb; reference ${cite(ref)}; within 2%`);
        assert.ok(Math.abs(thrust(flight, n) / ref.value - 1) <= 0.02);
      }
    }
    run(flight, 60);
    still(flight);
    for (const n of ENGINES) assert.ok(Math.abs(thrust(flight, n) / MAX_THRUST.value - 1) <= 0.02, 'still in full afterburner');
    say(`after a minute more in full afterburner: ${flight.get('inertia/weight-lbs')} lb with ${flight.get('propulsion/total-fuel-lbs')} lb of fuel; before, ${weight} and ${fuel}`);
    assert.equal(flight.get('inertia/weight-lbs'), weight);
    assert.equal(flight.get('propulsion/total-fuel-lbs'), fuel);
    assert.equal(flight.value('inertia/weight-lbs'), WEIGHT.value);
    flight.dispose();
  });

  test(`${variant}, f4c: "The afterburner gives nothing until the engine is at MIL speed, and the number the plumes will read is 0 at any dry power and 1 in full afterburner"`, async () => {
    const flight = heldDown(await moduleWith(F4C, variant));
    // Any dry power, then the afterburner's half and its whole.
    const seen = [];
    for (const throttle of [0, 0.2, 0.4, 0.6, F4C.mil, (F4C.mil + 1) / 2, 1]) {
      flight.fly({ throttle });
      run(flight, 8);
      const dry = throttle <= F4C.mil, asked = dry ? 0 : (throttle - F4C.mil) / (1 - F4C.mil);
      for (const n of ENGINES) {
        if (dry) assert.equal(burner(flight, n), 0, `engine ${n} at throttle ${throttle}: no afterburner at dry power`);
        else assert.ok(Math.abs(burner(flight, n) - asked) < 1e-9, `engine ${n} at throttle ${throttle}: the afterburner asked, ${asked}`);
        assert.ok(Math.abs(toEngine(flight, n) - (Math.min(throttle / F4C.mil, 1) + asked)) < 1e-9, `engine ${n}: what its throttle system gives it`);
        if (dry) assert.ok(thrust(flight, n) <= MIL_THRUST.value, 'no more than MIL thrust');
      }
      seen.push(`${throttle}: ${burner(flight, 0)} (${thrust(flight, 0).toFixed(0)} lb at ${rpm(flight, 0).toFixed(1)}%)`);
    }
    for (const n of ENGINES) assert.equal(burner(flight, n), 1, 'full afterburner is 1');
    say(`the afterburner's number at each throttle: ${seen.join('; ')}`);

    // The slam: from a settled idle to full throttle in one step. Each step, the engine's speed is read before
    // it and the thrust and the afterburner's number after it.
    flight.fly({ throttle: 0 });
    run(flight, 10);
    const idle = rpm(flight, 0);
    assert.ok(idle < 97 && rpm(flight, 1) === idle && burner(flight, 0) === 0, `idling at ${idle}%`);
    flight.fly({ throttle: 1 });
    let lit = null, most = 0, speedThen = null;
    for (let k = 0; k < Math.round(10 / DT); k++) {
      const before = ENGINES.map((n) => rpm(flight, n));
      assert.equal(flight.step(1), 0, 'JSBSim stepped');
      for (const n of ENGINES) {
        if (before[n] < 97) {
          most = Math.max(most, thrust(flight, n));
          assert.equal(burner(flight, n), 0, `engine ${n} at ${before[n]}%: no afterburner below MIL speed`);
          assert.ok(thrust(flight, n) <= MIL_THRUST.value, `engine ${n} at ${before[n]}%: ${thrust(flight, n)} lb, no more than the dry maximum`);
        } else if (lit === null) { lit = (k + 1) * DT; speedThen = before[n]; }
      }
    }
    still(flight);
    say(`slammed from idle (${idle.toFixed(1)}%) to full: no afterburner and at most ${most.toFixed(0)} lb an engine until ${lit?.toFixed(2)} s, when the engine passes 97% (${speedThen?.toFixed(1)}%); then ${thrust(flight, 0).toFixed(0)} lb`);
    assert.ok(lit !== null && lit > 1, 'the afterburner waited for the engine');
    for (const n of ENGINES) {
      assert.equal(burner(flight, n), 1);
      assert.ok(Math.abs(thrust(flight, n) / MAX_THRUST.value - 1) <= 0.02);
    }
    flight.dispose();
  });

  test(`${variant}, f4c: "A flight started in the air with the throttle in afterburner has afterburner thrust from its first step"`, async () => {
    const module = await moduleWith(F4C, variant), atMilSpeed = ENGINES.map((n) => [`propulsion/engine[${n}]/n2`, 100]);
    // The same start at MIL, for the dry thrust there.
    const dry = inTheAir(module, { throttle: F4C.mil }, atMilSpeed);
    run(dry, DT);
    const milThrust = thrust(dry, 0);
    assert.ok(burner(dry, 0) === 0 && toEngine(dry, 0) === 1, 'the twin is at MIL');
    dry.dispose();

    const flight = inTheAir(module, { throttle: 1 }, atMilSpeed);
    for (const n of ENGINES) assert.equal(rpm(flight, n), 100, `engine ${n} starts at MIL speed`);
    run(flight, DT);
    assert.ok(Math.abs(flight.fdm.simTime - DT) < 1e-12, 'one step');
    const first = ENGINES.map((n) => thrust(flight, n));
    for (const n of ENGINES) {
      assert.equal(burner(flight, n), 1, `engine ${n}: the afterburner is given at the first step`);
      assert.equal(toEngine(flight, n), 2);
      assert.ok(first[n] > 1.5 * milThrust, `engine ${n}: ${first[n]} lb, against ${milThrust} at MIL`);
    }
    run(flight, 1);
    say(`20,000 ft, ${flight.value('velocities/mach').toFixed(2)} Mach, throttle full: ${first[0].toFixed(0)} lb an engine after the first step (MIL there is ${milThrust.toFixed(0)}), ${thrust(flight, 0).toFixed(0)} a second later; within 2%`);
    for (const n of ENGINES) assert.ok(Math.abs(thrust(flight, n) / first[n] - 1) <= 0.02, 'it was not still coming up');
    flight.dispose();

    // Reported: the same start with the engines' speed left alone. JSBSim's "running" leaves a turbine at MIL speed.
    const plain = inTheAir(module, { throttle: 1 });
    const speed = rpm(plain, 0);
    run(plain, DT);
    say(`the same start without setting the engines' speed: they start at ${speed.toFixed(1)}%, and give ${thrust(plain, 0).toFixed(0)} lb after the first step`);
    plain.dispose();
  });

  test(`${variant}, f4c: the thrust lines are CR-2144's: at MIL, standing still, the engines push the nose down by their thrust times 0.37 ft within 5%, and the thrust has an upward part of sin 5.25 degrees`, async () => {
    const flight = heldDown(await moduleWith(F4C, variant));
    flight.fly({ throttle: F4C.mil });
    run(flight, 10);
    still(flight);
    const total = thrust(flight, 0) + thrust(flight, 1), moment = flight.get('moments/m-prop-lbsft'), up = -flight.get('forces/fbz-prop-lbs'), forward = flight.get('forces/fbx-prop-lbs');
    assert.ok(Math.abs(total / (2 * MIL_THRUST.value) - 1) <= 0.02, 'both engines at MIL');
    const arm = -moment / total, tilt = Math.asin(up / total) * DEG;
    say(`at MIL the engines' ${total.toFixed(0)} lb turn the nose ${moment < 0 ? 'down' : 'UP'} with ${Math.abs(moment).toFixed(0)} lb-ft: the thrust line passes ${arm.toFixed(4)} ft above the centre of gravity; reference ${cite(THRUST_LINE_ABOVE_CG)}; within 5%`);
    assert.ok(moment < 0, 'nose down');
    assert.ok(Math.abs(arm / THRUST_LINE_ABOVE_CG.value - 1) <= 0.05);
    say(`${up.toFixed(0)} lb of it is upward and ${forward.toFixed(0)} forward: tilted ${tilt.toFixed(3)} degrees; reference ${cite(THRUST_TILT)}`);
    assert.ok(Math.abs(up / total / Math.sin(THRUST_TILT.value / DEG) - 1) <= 0.01 && forward > 0);
    assert.ok(Math.abs(flight.get('moments/l-prop-lbsft')) < 1 && Math.abs(flight.get('moments/n-prop-lbsft')) < 1 && Math.abs(flight.get('forces/fby-prop-lbs')) < 1e-6, 'the two engines pull evenly');
    // Fore and aft and sideways each thrust point is the model's engine exit; in height it is CR-2144's line, not the model's.
    const points = [...file.matchAll(/<thruster file="direct">\s*<location unit="IN">\s*<x>\s*(\S+)\s*<\/x>\s*<y>\s*(\S+)\s*<\/y>\s*<z>\s*(\S+)\s*<\/z>/g)].map((m) => [-m[1] / 12, m[2] / 12, -m[3] / 12]);
    assert.equal(points.length, 2);
    for (const [n, exit] of [LEFT_ENGINE_EXIT, RIGHT_ENGINE_EXIT].entries()) {
      const off = Math.hypot(points[n][0] - exit.value[0], points[n][1] - exit.value[1]) * 12;
      say(`engine ${n}'s thrust acts at [${points[n].map((feet) => feet.toFixed(3)).join(', ')}]; the model's exit: ${cite(exit)}; ${off.toFixed(2)} in off fore and aft and sideways (within 1), and ${((points[n][2] - exit.value[2]) * 12).toFixed(1)} in lower`);
      assert.ok(off <= 1);
    }
    flight.dispose();
  });

  test(`${variant}, f4c: all thirteen wheels and airframe points of the aircraft file are named in the settings, in the file's order; the settings and the file agree on MIL, the controls and the gear`, async () => {
    const inFile = [...file.matchAll(/<contact type="(BOGEY|STRUCTURE)" name="([^"]+)"/g)].map((m) => m[2]);
    assert.deepEqual(inFile, ['NOSE_WHEEL', 'LEFT_MAIN_WHEEL', 'RIGHT_MAIN_WHEEL', 'NOSE', 'LEFT_BELLY', 'RIGHT_BELLY', 'LEFT_TAIL_UNDERSIDE', 'RIGHT_TAIL_UNDERSIDE',
      'LEFT_WINGTIP', 'RIGHT_WINGTIP', 'LEFT_STABILATOR_TIP', 'RIGHT_STABILATOR_TIP', 'FIN_TOP']);
    assert.deepEqual(F4C.contacts, ['nose wheel', 'left main wheel', 'right main wheel', 'nose', 'belly (left)', 'belly (right)', 'tail underside (left)', 'tail underside (right)',
      'left wingtip', 'right wingtip', 'left stabilator tip', 'right stabilator tip', 'top of the fin']);
    const module = await moduleWith(F4C, variant), flight = Flight.start(module, F4C);
    assert.equal(flight.get('gear/num-units'), F4C.contacts.length);
    assert.deepEqual(flight.stateNames.filter((name) => name.endsWith('/WOW')), F4C.contacts.map((_, k) => `${k < 3 ? 'gear' : 'contact'}/unit[${k}]/WOW`), 'three wheels, then ten airframe points');
    say(F4C.contacts.map((point, i) => `${inFile[i]} = ${point}`).join('; '));

    // MIL is in one place on the throttle for the game and for the airplane.
    assert.equal(flight.get('fcs/mil-throttle-norm'), F4C.mil, 'the file\'s MIL is the settings\'');
    assert.equal(F4C.jet, true);
    // Everything the game writes is a cockpit control, and both engines have the one throttle. (The pitch
    // trim came with the aerodynamics, pull request 5: the copilot's neutral trim, set once.)
    assert.deepEqual(assistWrites(F4C.assists), ['fcs/pitch-trim-cmd-norm', 'fcs/steer-cmd-norm']);
    assert.deepEqual([...flight.inputNames].sort(), ['fcs/aileron-cmd-norm', 'fcs/elevator-cmd-norm', 'fcs/left-brake-cmd-norm', 'fcs/pitch-trim-cmd-norm', 'fcs/right-brake-cmd-norm', 'fcs/steer-cmd-norm',
      'fcs/throttle-cmd-norm', 'fcs/throttle-cmd-norm[1]', 'gear/gear-cmd-norm']);
    flight.fly({ throttle: 0.5 });
    run(flight, 1);
    assert.ok(flight.get('fcs/throttle-cmd-norm') === 0.5 && flight.get('fcs/throttle-cmd-norm[1]') === 0.5 && toEngine(flight, 0) === toEngine(flight, 1), 'the one throttle works both engines');
    flight.dispose();

    // The gear: up or down in Wings' 4 seconds.
    const flying = inTheAir(module, { throttle: 0 });
    flying.fly({ gear: true });
    let down = null;
    run(flying, 6, (t) => { if (down === null && flying.value('gear/gear-pos-norm') === 1) down = t; });
    say(`the gear comes down in ${down?.toFixed(2)} s; reference ${cite(GEAR_SECONDS)}`);
    assert.ok(down !== null && Math.abs(down - GEAR_SECONDS.value) <= 0.05);
    flying.dispose();
  });

  test(`${variant}, f4c: the Worker flies it from the three files as the page fetches them (src/fdm.js)`, async () => {
    // The Worker's handler with the game in it, in this thread, on a made-up clock (as tests/worker-flight.test.js).
    // The app's own list of aircraft does not have the F-4C yet (pull request 8), so the handler is given one that does.
    const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
    const timer = madeUpTimer(), states = [];
    let handle;
    const client = new WorkerClient((message) => void handle(message));
    handle = createHandler((message) => {
      if (message.type === 'state') states.push(message);
      else queueMicrotask(() => client.receive(message));
    }, flightRun(timer, { f4c: F4C }));
    assert.equal(pageHomeOf(F4C), '../', 'the page fetches its files from the repo\'s root, not from JSBSim\'s data');
    const pack = buildPack(new Map(F4C.files.map((path) => [path, readFileSync(fileURLToPath(inSrc(pageHomeOf(F4C) + path)))])));
    await client.request({ type: 'init', moduleUrl: inSrc(BUILDS[variant].module).href, packs: [['/data', pack]] });
    const started = await client.request({ type: 'fly', aircraft: 'f4c' });
    const at = (name) => started.stateNames.indexOf(name), wheels = [0, 1, 2].map((k) => started.state[at(`gear/unit[${k}]/WOW`)]);
    assert.deepEqual(wheels, [1, 1, 1], 'parked on its wheels');
    assert.ok(Math.abs(started.state[at('position/h-agl-ft')] - F4C.standingFt) < 0.01 && started.state[at('inertia/weight-lbs')] === WEIGHT.value);
    await client.request({ type: 'controls', controls: { throttle: F4C.mil } });
    timer.fire();   // the first firing starts the loop's clock
    timer.run(5000);
    const last = states.at(-1);
    assert.ok(last && last.ended === null && last.state.every(Number.isFinite));
    say(`through the Worker's messages: parked ${started.state[at('position/h-agl-ft')].toFixed(3)} ft up; 5 s after the throttle goes to MIL, ${last.state[at('propulsion/engine[0]/thrust-lbs')].toFixed(0)} lb from the left engine (${last.totalSteps} steps)`);
    assert.ok(Math.abs(last.state[at('propulsion/engine[0]/thrust-lbs')] / MIL_THRUST.value - 1) <= 0.02);
    await client.request({ type: 'end' });
  });
}

test('f4c: "It loads ... in native JSBSim from only its listed files, each shown to be needed"', () => {
  // A folder for each case, holding only those files, as JSBSim's root: all three, then each one left out.
  const cases = [['all', F4C.files], ...F4C.files.map((missing) => [`without ${missing}`, F4C.files.filter((path) => path !== missing)])];
  const scenarios = cases.map(([name, files], i) => ({
    name: `f4c-files-${i}`, root: rootWith(F4C, `f4c-files-${i}`, files), dt: DT, model: F4C.model,
    sets: [['ic/h-agl-ft', F4C.standingFt], ['propulsion/set-running', -1], ['propulsion/fuel_freeze', 1]], outs: ['inertia/weight-lbs', 'propulsion/engine[0]/thrust-lbs', 'propulsion/engine[1]/thrust-lbs'], outGear: true, steps: 120,
  }));
  const runs = runNative(scenarios, 'f4c-files');
  for (const [i, { meta, trace }] of runs.entries()) {
    report.line(`  native, ${cases[i][0]}: ${meta.stage === 'done' ? `loaded and ran ${meta.stepsDone} steps` : `stopped at "${meta.stage}": ${meta.message.split('\n')[0].replace(/\S*\/roots\//, '')}`}`);
    if (i > 0) { assert.ok(!meta.loaded && meta.stage === 'load' && meta.message.length > 0, `native JSBSim loaded it ${cases[i][0]}`); continue; }
    assert.ok(meta.loaded && meta.stage === 'done' && meta.stepsDone === 120, `native JSBSim: ${meta.stage}: ${meta.message}`);
    // Read back that it is the F-4C, standing, with both engines running.
    const last = [...trace.data.subarray((trace.rows - 1) * trace.columns.length)], number = (name) => last[trace.columns.indexOf(name)];
    assert.equal(number('inertia/weight-lbs'), WEIGHT.value);
    assert.ok(number('propulsion/engine[0]/thrust-lbs') > 100 && number('propulsion/engine[0]/thrust-lbs') === number('propulsion/engine[1]/thrust-lbs'), 'both engines idling');
    assert.deepEqual([0, 1, 2].map((k) => number(`gear/unit[${k}]/WOW`)), [1, 1, 1], 'on its wheels');
    assert.equal(trace.columns.filter((name) => name.endsWith('/WOW')).length, F4C.contacts.length);
  }
});

test('f4c: "A parked minute, throttle run up and down, replayed in native JSBSim agrees by milestone 1\'s lines"', async () => {
  // The run-up is to the flight manual's 85%: at MIL the wheel brakes do not hold this airplane (see the
  // reported numbers below), and a minute sliding down the runway is not a parked one.
  const modules = {}, tapes = {};
  let peak = 0, moved = 0;
  for (const variant of VARIANTS) {
    modules[variant] = await moduleWith(F4C, variant);
    const flight = Flight.start(modules[variant], F4C, { record: true });
    const idle = rpm(flight, 0), runUp = F4C.mil * (RUN_UP_RPM.value - idle) / (100 - idle), from = flight.where();
    peak = 0;
    run(flight, 60, (t) => { flight.fly({ throttle: t >= 5 && t < 30 ? runUp : 0 }); peak = Math.max(peak, rpm(flight, 0)); });
    const to = flight.where();
    moved = Math.hypot(to.north - from.north, to.east - from.east) / FT;
    assert.ok(Math.abs(peak - RUN_UP_RPM.value) < 0.5, `run up to ${peak}%`);
    assert.ok(Math.abs(rpm(flight, 0) - idle) < 0.01 && toEngine(flight, 0) === 0, 'and back to idle');
    assert.ok(moved < 1, `parked: it moved ${moved} ft`);
    tapes[variant] = flight.tape();
    flight.dispose();
  }
  const tape = tapes.weh;
  assert.equal(tape.steps, Math.round((SETTLE_SECONDS + 60) / DT));
  assert.equal(tape.own, true, 'the tape says the aircraft is FSG\'s own');
  report.line(`f4c: a ${tape.steps}-step tape (${SETTLE_SECONDS} s settling, then a parked minute: run up to ${peak.toFixed(1)}% for 25 s and back; it moved ${moved.toFixed(3)} ft), ${tape.ins.length} inputs a step, ${tape.sets.length} values in the start`);

  // 1. The tape is the whole truth: flown again by the C++ runner inside the same build, the same minute bit for bit.
  for (const variant of VARIANTS) {
    const again = flyWasm(modules[variant], tapes[variant], `f4c-${variant}-again`);
    const same = bitEqual(tapes[variant].states, again);
    report.line(`  ${variant}: flown again from its tape by the C++ runner: ${same.equal ? `identical, ${again.rows} rows of ${again.columns.length} numbers` : `DIFFERENT (${same.reason})`}`);
    assert.ok(same.equal, same.reason);
  }
  assert.ok(bitEqual(tapes.weh.states, tapes.jseh.states).equal, 'both builds recorded the same minute');

  // 2. Matching native, by milestone 1's lines (tests/tape.test.js): the whole minute within altitude 1 ft,
  // angles 0.05 rad and speed 1 knot, or 3 times native's own spread where that is larger; and the first
  // second by FDM's tighter line for a run with wheels on the ground.
  const { native, ensemble } = flyNative(tape, 'f4c-parked');
  const last = native.rows - 1, numberAt = (name) => native.data[last * native.columns.length + native.columns.indexOf(name)];
  assert.deepEqual([0, 1, 2].map((k) => numberAt(`gear/unit[${k}]/WOW`)), [1, 1, 1], 'native JSBSim flew the F-4C, and it stands on its wheels at the end');
  assert.ok(Math.abs(numberAt('position/h-agl-ft') - F4C.standingFt) < 0.01);
  for (const variant of VARIANTS) {
    const wasm = flyWasm(modules[variant], tape, `f4c-${variant}-judged`, JUDGED);
    const whole = classB(native, wasm, ensemble);
    report.line(`  ${variant} against native, the whole minute: ${whole.refused ? `REFUSED: ${whole.refused}` : whole.pass ? 'pass' : 'FAIL'} (${whole.rowsJudged} rows)`);
    for (const c of whole.columns) report.line(`    ${c.column}: largest difference ${fmt(c.maxAbs)}; allowed ${fmt(c.allowed)} (line ${fmt(c.cap)}, native's own spread ${fmt(c.spread)})`);
    assert.ok(whole.pass, `${variant}: the whole-minute line`);
    const rows = Math.round(1 / DT) + 1;
    const first = classN(headTrace(native, rows), headTrace(wasm, rows), ensemble.map((member) => headTrace(member, rows)), { tolerance: classA });
    report.line(`  ${variant} against native, first second: ${describeN(first)}`);
    assert.ok(first.pass, `${variant}: the first-second line`);
  }
});

// Reported, as the plan asks: no pass or fail. One build is enough.
test('f4c, reported (no pass or fail): idle thrust; seconds from idle to MIL and to full afterburner; the power at which the brakes no longer hold', async () => {
  const module = await moduleWith(F4C, 'weh'), say = (line) => report.line(`  ${line}`);
  // Standing still, held down.
  const held = heldDown(module);
  say(`idle: ${thrust(held, 0).toFixed(0)} lb an engine at ${rpm(held, 0).toFixed(1)}%`);
  const secondsTo = (throttle, pounds) => {
    held.fly({ throttle: 0 });
    run(held, 10);
    held.fly({ throttle });
    let reached = null, lit = null;
    run(held, 15, (t) => {
      if (reached === null && thrust(held, 0) >= pounds) reached = t;
      if (lit === null && burner(held, 0) > 0) lit = t;
    });
    return { reached, lit };
  };
  const toMil = secondsTo(F4C.mil, 0.95 * MIL_THRUST.value), toFull = secondsTo(1, 0.95 * MAX_THRUST.value);
  say(`from idle to 95% of MIL thrust: ${toMil.reached?.toFixed(2)} s; Wings: ${cite(WINGS_SECONDS_TO_MIL)}`);
  say(`from idle to 95% of full afterburner thrust: ${toFull.reached?.toFixed(2)} s (the afterburner lights at ${toFull.lit?.toFixed(2)} s, all at once); Wings: ${cite(WINGS_SECONDS_TO_FULL_AFTERBURNER)}`);
  held.dispose();

  // The brakes: on, and the throttle raised slowly (1% a second) until the airplane moves faster than half a knot.
  const flight = Flight.start(module, F4C), pitch0 = flight.get('attitude/theta-deg');
  let gone = null, before = null;
  run(flight, 100, (t) => {
    if (flight.value('velocities/vg-fps') / KT > 0.5) { gone = before; return false; }
    before = { throttle: flight.controls.throttle, rpm: rpm(flight, 0), thrust: thrust(flight, 0) + thrust(flight, 1), dip: pitch0 - flight.get('attitude/theta-deg') };
    flight.fly({ throttle: t / 100 });
    return true;
  });
  say(gone
    ? `brakes on, throttle raised slowly: they hold until the throttle is at ${(gone.throttle * 100).toFixed(0)}% (MIL is ${F4C.mil * 100}%), the engines at ${gone.rpm.toFixed(1)}% and ${gone.thrust.toFixed(0)} lb together; the nose has dipped ${gone.dip.toFixed(2)} degrees by then. The flight manual's run-up: ${cite(RUN_UP_RPM)}`
    : 'brakes on, throttle raised slowly: they hold at any power');
  flight.dispose();

  // And at the flight manual's run-up.
  const runUp = Flight.start(module, F4C), from = runUp.where(), level = runUp.get('attitude/theta-deg'), idle = rpm(runUp, 0);
  runUp.fly({ throttle: F4C.mil * (RUN_UP_RPM.value - idle) / (100 - idle) });
  run(runUp, 20);
  const to = runUp.where();
  say(`run up to ${rpm(runUp, 0).toFixed(1)}% with the brakes on for 20 s: ${(thrust(runUp, 0) + thrust(runUp, 1)).toFixed(0)} lb together; it moves ${(Math.hypot(to.north - from.north, to.east - from.east) / FT).toFixed(2)} ft and the nose dips ${(level - runUp.get('attitude/theta-deg')).toFixed(2)} degrees`);
  runUp.dispose();
});

test('f4c: every reference number names its source and where in it', () => {
  const entries = Object.entries(REFERENCE);
  assert.ok(entries.length >= 15);
  for (const [name, ref] of entries) {
    assert.deepEqual(Object.keys(ref).sort(), ['source', 'unit', 'value', 'where'], `${name} is a value, a unit, a source and where`);
    assert.ok([ref.value].flat().every((x) => typeof x === 'number' && Number.isFinite(x)), `${name}: a number`);
    assert.ok(typeof ref.unit === 'string' && ref.unit.trim().length > 0, `${name}: its unit`);
    for (const key of ['source', 'where']) assert.ok(typeof ref[key] === 'string' && ref[key].trim().length > 5, `${name}: its ${key}`);
    assert.match(ref.source, /^(NASA CR-2144|AFWAL-TR-80-3141 Part III|T\.O\. 1F-4C-1 \(1 October 1970\)|135crewdog\/wings, commit [0-9a-f]{7})$/, `${name}: a source we have read`);
  }
  console.log(`  ${entries.length} reference numbers, each with its source and where`);
});
