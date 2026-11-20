// Controls in, state out (src/sim/game.js), for both test aircraft and in both WebAssembly builds. Every
// control is read back at JSBSim's end, and every number of the state comes from JSBSim.
// docs/milestones/1.md, pull request 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { FdmError } from '../src/sim/core.js';
import { assistWrites } from '../src/sim/assists.js';
import { DT, Flight, PARKED, STATE, commandsFor } from '../src/sim/game.js';
import { FT, toWorld } from '../src/sim/world.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(files, variant) {
  const module = await loadVariant(variant);
  for (const file of files) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const DEG = 180 / Math.PI;
const seconds = (flight, s) => assert.equal(flight.step(Math.round(s / DT)), 0, 'JSBSim stepped');
// Level and steady in the air, by JSBSim's own trim, at a speed and height that suit each airplane.
const AIRBORNE = new Map([[C172X, { heightFt: 2000, knots: 100 }], [F16, { heightFt: 5000, knots: 350 }]]);
const inTheAir = async (aircraft, variant) => {
  const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft, { airborne: AIRBORNE.get(aircraft) });
  // Read back that the start is what it says: in the air, at the speed asked for, steady.
  assert.ok(Math.abs(flight.value('velocities/vc-kts') - AIRBORNE.get(aircraft).knots) < 0.5, `${flight.value('velocities/vc-kts')} kt`);
  assert.ok(Math.abs(flight.value('position/h-sl-ft') - AIRBORNE.get(aircraft).heightFt) < 1);
  // The state handed over is the trimmed one, not the one from before JSBSim's trim (Codex's finding on pull
  // request 12): every number of it is what JSBSim has now, and the airplane is flying, not falling.
  flight.stateNames.forEach((name, i) => assert.ok(Object.is(flight.state[i], flight.get(name)), `${name}: the state has ${flight.state[i]}, JSBSim ${flight.get(name)}`));
  assert.ok(Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && flight.value('propulsion/engine[0]/thrust-lbs') > 50, `trimmed: ${flight.value('accelerations/Nz')} g, ${flight.value('propulsion/engine[0]/thrust-lbs')} lb of thrust`);
  return flight;
};

for (const variant of VARIANTS) {
  for (const aircraft of [C172X, F16]) {
    const name = `${variant}, ${aircraft.model}`;

    test(`${name}: each of the seven controls reaches the JSBSim command it drives, and the ones the airplane lacks drive nothing`, async () => {
      const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
      const given = { pitch: 0.25, roll: -0.5, throttle: 0.75, gear: true, flaps: true, speedbrake: true, brake: true };
      flight.fly(given);
      seconds(flight, DT);
      const table = [];
      for (const [control, { to, sign = 1 }] of Object.entries(aircraft.controls)) {
        const want = typeof given[control] === 'boolean' ? 1 : sign * given[control];
        for (const command of to) assert.equal(flight.get(command), want, `${control} -> ${command}`);
        table.push(`${control}: ${to.length ? to.map((command) => `${command} = ${flight.get(command)}`).join(', ') : 'nothing (the airplane has none)'}`);
      }
      console.log(`  ${name}, given pitch 0.25 back, roll 0.5 left, throttle 0.75, all four toggles on:\n    ${table.join('\n    ')}`);
      // The inputs are those commands, then the ones the assists alone write (tests/assists.test.js lists them).
      assert.deepEqual(flight.inputNames, [...new Set([...commandsFor(aircraft, PARKED).map(([command]) => command), ...assistWrites(aircraft.assists)])]);
      // A control the airplane does not have does nothing to it.
      seconds(flight, 6);
      if (aircraft === C172X) {
        flight.fly({ gear: false });
        seconds(flight, 6);
        assert.equal(flight.value('gear/gear-pos-norm'), 1, 'the Cessna\'s gear is fixed');
        assert.equal(flight.value('fcs/speedbrake-pos-norm'), 0, 'the Cessna has no speedbrake');
      } else {
        const before = flight.value('fcs/flap-pos-norm');
        flight.fly({ flaps: false });
        seconds(flight, 6);
        assert.equal(flight.value('fcs/flap-pos-norm'), before, 'the F-16 has no flap lever');
      }
      flight.dispose();
    });

    test(`${name}: in flight, back stick raises the nose and right stick rolls right, within a second; the throttle and the toggles move what they should`, async () => {
      const flight = await inTheAir(aircraft, variant);
      const level = { ...flight.trimmed };
      const pitch0 = flight.value('attitude/theta-rad') * DEG;
      flight.fly({ pitch: level.pitch + 0.3 });
      seconds(flight, 1);
      const pitch1 = flight.value('attitude/theta-rad') * DEG;
      assert.ok(pitch1 - pitch0 > 2, `back stick: pitch ${pitch0.toFixed(1)} to ${pitch1.toFixed(1)} degrees`);
      flight.fly({ pitch: level.pitch, roll: level.roll + 0.3 });
      const bank0 = flight.value('attitude/phi-rad') * DEG;
      seconds(flight, 1);
      const bank1 = flight.value('attitude/phi-rad') * DEG;
      assert.ok(bank1 - bank0 > 5, `right stick: bank ${bank0.toFixed(1)} to ${bank1.toFixed(1)} degrees`);
      flight.fly({ roll: level.roll, throttle: 0 });
      seconds(flight, 2);
      const idle = flight.value('fcs/throttle-pos-norm');
      flight.fly({ throttle: 1 });
      seconds(flight, 2);
      const full = flight.value('fcs/throttle-pos-norm');
      assert.equal(idle, 0, 'throttle closed');
      assert.ok(full >= 1, `throttle open: ${full}`);
      const moved = [`back stick 0.3 for a second: pitch ${pitch0.toFixed(1)} to ${pitch1.toFixed(1)} deg`, `right stick 0.3 for a second: bank ${bank0.toFixed(1)} to ${bank1.toFixed(1)} deg`, `throttle 0 and 1: the engine's lever reads ${idle} and ${full}`];
      flight.fly({ throttle: level.throttle });
      if (aircraft === C172X) {
        flight.fly({ flaps: true });
        seconds(flight, 5);
        assert.equal(flight.value('fcs/flap-pos-norm'), 1, 'flaps down in 5 seconds');
        flight.fly({ flaps: false });
        seconds(flight, 5);
        assert.equal(flight.value('fcs/flap-pos-norm'), 0, 'and up again');
        moved.push('flaps: down in 5 s, up in 5 s');
      } else {
        assert.equal(flight.value('gear/gear-pos-norm'), 0, 'an airborne start has the gear up');
        flight.fly({ gear: true, speedbrake: true });
        seconds(flight, 6);
        const out = flight.value('fcs/speedbrake-pos-norm');
        assert.equal(flight.value('gear/gear-pos-norm'), 1, 'gear down in 6 seconds');
        assert.ok(out > 0.5, `speedbrake out: ${out}`);
        flight.fly({ gear: false, speedbrake: false });
        seconds(flight, 6);
        assert.equal(flight.value('gear/gear-pos-norm'), 0, 'and up again');
        assert.equal(flight.value('fcs/speedbrake-pos-norm'), 0, 'speedbrake in');
        moved.push(`gear: down in 6 s, up in 6 s; speedbrake: out to ${out.toFixed(2)} of its travel, and in`);
      }
      console.log(`  ${name}: ${moved.join('; ')}`);
      flight.dispose();
    });

    test(`${name}: the brakes hold against power, and let go`, async () => {
      const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
      const place = () => toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
      const feetFrom = (a) => { const b = place(); return Math.hypot(b.north - a.north, b.east - a.east) / FT; };
      const power = aircraft === C172X ? 0.4 : 0;   // the F-16 pulls 870 lb at idle
      const start = place();
      flight.fly({ throttle: power });
      seconds(flight, 10);
      const held = feetFrom(start);
      const from = place();
      flight.fly({ brake: false });
      seconds(flight, 10);
      const rolled = feetFrom(from);
      console.log(`  ${name}: throttle ${power}, brakes on for 10 s: moved ${held.toFixed(2)} ft; brakes off for 10 s: rolled ${rolled.toFixed(0)} ft`);
      assert.ok(held < 1, `moved ${held} ft with the brakes on`);
      assert.ok(rolled > 10, `rolled ${rolled} ft with the brakes off`);
      flight.dispose();
    });

    test(`${name}: the state is one list of finite numbers from JSBSim, with every wheel and contact point`, async () => {
      const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
      const points = aircraft === C172X ? 6 : 10;   // 3 wheels, and 3 or 7 airframe points in the aircraft file
      assert.equal(flight.stateNames.length, STATE.length + points);
      assert.equal(flight.state.length, flight.stateNames.length);
      assert.deepEqual(flight.stateNames.slice(0, STATE.length), STATE.map(([n]) => n));
      for (const [n, unit, what] of STATE) assert.ok(typeof unit === 'string' && what.length > 3, `${n} has its unit and meaning written down`);
      assert.deepEqual(flight.stateNames.slice(STATE.length, STATE.length + 3), ['gear/unit[0]/WOW', 'gear/unit[1]/WOW', 'gear/unit[2]/WOW']);
      assert.ok(flight.stateNames.slice(STATE.length + 3).every((n) => /^contact\/unit\[\d+\]\/WOW$/.test(n)));
      // A full-power run down the runway and into the air: every number of every state is finite.
      flight.fly({ throttle: 1, brake: false });
      let airborne = false;
      for (let step = 0; step < 60 / DT; step++) {
        if (flight.value('velocities/vc-kts') > (aircraft === C172X ? 60 : 160)) flight.fly({ pitch: 0.3 });
        assert.equal(flight.step(1), 0);
        assert.ok(flight.state.every(Number.isFinite), `step ${step}: ${flight.stateNames.filter((n, i) => !Number.isFinite(flight.state[i])).join(', ')}`);
        airborne ||= flight.stateNames.every((n, i) => !n.endsWith('/WOW') || flight.state[i] === 0) && flight.value('position/h-agl-ft') > 20;
      }
      assert.ok(airborne, 'it left the ground: no wheel or contact point touching');
      assert.ok(Math.abs(flight.value('simulation/sim-time-sec') - flight.fdm.simTime) < 1e-12);
      flight.dispose();
    });

    test(`${name}: a standard day in still air, read back`, async () => {
      const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
      const pressure = flight.get('atmosphere/P-sl-psf'), fahrenheit = flight.get('atmosphere/T-sl-R') - 459.67;
      const wind = flight.get('atmosphere/wind-mag-fps');
      const turbulence = ['north', 'east', 'down'].map((d) => flight.get(`atmosphere/turb-${d}-fps`));
      console.log(`  ${name}: sea-level pressure ${pressure.toFixed(1)} lb/ft2, ${fahrenheit.toFixed(1)} F; wind ${wind} ft/s; turbulence ${turbulence.join(', ')} ft/s; temperature off standard ${flight.get('atmosphere/delta-T')}`);
      assert.ok(Math.abs(pressure - 2116.2) < 0.05, `sea-level pressure ${pressure}`);
      assert.ok(Math.abs(fahrenheit - 59) < 0.01, `sea-level temperature ${fahrenheit} F`);
      assert.equal(flight.get('atmosphere/delta-T'), 0);
      // JSBSim reads its own zero wind back as about 5e-13 ft/s (rounding in turning it to its own axes): no wind was set.
      assert.ok(wind < 1e-9, `wind ${wind} ft/s`);
      assert.deepEqual(turbulence, [0, 0, 0]);
      assert.ok(!flight.startSets.some(([n]) => n.startsWith('atmosphere/')), 'the game sets nothing in the atmosphere');
      flight.dispose();
    });

    test(`${name}: constant weight: five minutes at full power burn nothing`, async () => {
      const flight = await inTheAir(aircraft, variant);
      const fuel = flight.value('propulsion/total-fuel-lbs'), weight = flight.value('inertia/weight-lbs');
      assert.ok(fuel > 100, `${fuel} lb of fuel on board`);
      const level = { ...flight.trimmed };
      for (let step = 0; step < 300 / DT; step++) {
        // A pilot holding about 4 degrees of pitch and the wings level, at full throttle.
        const pitch = flight.value('attitude/theta-rad') * DEG, bank = flight.value('attitude/phi-rad');
        flight.fly({ throttle: 1, pitch: Math.max(-1, Math.min(1, 0.05 * (4 - pitch))), roll: Math.max(-1, Math.min(1, level.roll - 2 * bank)) });
        assert.equal(flight.step(1), 0);
      }
      console.log(`  ${name}: after five minutes at full power: fuel ${flight.value('propulsion/total-fuel-lbs')} lb (was ${fuel}), weight ${flight.value('inertia/weight-lbs')} lb (was ${weight}); thrust now ${flight.value('propulsion/engine[0]/thrust-lbs').toFixed(0)} lb`);
      assert.equal(flight.value('propulsion/total-fuel-lbs'), fuel);
      assert.equal(flight.value('inertia/weight-lbs'), weight);
      assert.ok(flight.value('propulsion/engine[0]/thrust-lbs') > 100, 'the engine was running');
      flight.dispose();
    });

    test(`${name}: a start and a tape: after the start nothing reaches JSBSim but the input array, and the same controls give the same flight bit for bit`, async () => {
      const once = async () => {
        const flight = Flight.start(await moduleWith(aircraft.files, variant), aircraft);
        assert.throws(() => flight.fdm.setByName('fcs/throttle-cmd-norm', 1), (e) => e instanceof FdmError && /a start and a tape/.test(e.message));
        const states = [];
        for (let step = 0; step < 40 / DT; step++) {
          const t = step * DT;
          flight.fly({ throttle: t < 2 ? 0 : 1, brake: t < 2, pitch: t > 25 ? 0.3 : 0, roll: 0.2 * Math.sin(t), flaps: t < 30, gear: t < 35, speedbrake: t > 38 });
          assert.equal(flight.step(1), 0);
          states.push(Float64Array.from(flight.state));
        }
        flight.dispose();
        return states;
      };
      const a = await once(), b = await once();
      for (let step = 0; step < a.length; step++) for (let i = 0; i < a[step].length; i++) assert.ok(Object.is(a[step][i], b[step][i]), `step ${step}, number ${i}`);
    });
  }
}
