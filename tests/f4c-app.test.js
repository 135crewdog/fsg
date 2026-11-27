// The F-4C in the app (milestone 3, pull request 8): what the page draws and reads from JSBSim, headless.
// New in FSG; the "done" lines are in docs/milestones/3.md, PR 8, written before this was built. The ones a
// browser must show (the buttons, the throttle, the takeoff) are tests/browser/app.chromium.mjs; these hold
// the numbers under them: the model's moving parts follow JSBSim's own positions of the parts, and both
// engines' thrust and afterburners go out beside the state. (The other npm lines are where they always were:
// the settings' contact names, tests/f4c.test.js; what the copilot writes, tests/f4c.test.js and
// tests/f4c-aero.test.js; sw.js and the three versions, tests/app.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, homeOf as pageHomeOf } from '../src/fdm.js';
import { motionAt, surfaceReader } from '../src/render/surfaces.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { buildPack } from '../src/sim/files.js';
import { flightRun } from '../src/sim/flight-run.js';
import { DT, Flight, parkedFor } from '../src/sim/game.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { moduleWith } from './checkride/files.js';
import { madeUpTimer } from './made-up-timer.js';

const DEG = 180 / Math.PI;
const run = (flight, seconds) => { for (let k = 0; k < Math.round(seconds / DT); k++) assert.equal(flight.step(1), 0, 'JSBSim stepped'); };

test('f4c in the app: each of the model\'s six motions is a straight line through JSBSim\'s own travel, and the ailerons are the left less the right', () => {
  const { elevator, aileron, rudder } = F4C.surfaces;
  // The stabilator: 9 degrees trailing edge down at full forward stick, 21 up at full back (docs/models.md; the file's stops).
  assert.deepEqual([9, 4.5, 0, -10.5, -21].map((degrees) => motionAt(degrees / DEG, elevator.at)), [0, 0.25, 0.5, 0.75, 1]);
  // The ailerons only go down: the left one 30 degrees for full right, the right one for full left.
  const roll = surfaceReader({ aileron }, [aileron.from, aileron.minus]);
  assert.deepEqual([[0, 30], [0, 15], [0, 0], [15, 0], [30, 0]].map(([left, right]) => roll([left / DEG, right / DEG]).aileron), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual([30, 0, -30].map((degrees) => motionAt(degrees / DEG, rudder.at)), [0, 0.5, 1], 'the rudder: trailing edge left (JSBSim\'s positive) is the motion\'s 0');
  assert.deepEqual(Object.keys(F4C.surfaces).sort(), ['aileron', 'elevator', 'flaps', 'gear', 'rudder', 'speedbrake'], 'all six of the model\'s motions (docs/models.md)');
});

for (const variant of VARIANTS) {
  test(`${variant}, f4c in the app: the model's gear, flaps, boards and surfaces follow JSBSim's: parked as every flight starts, then each control moved`, async () => {
    const module = await moduleWith(F4C, variant);
    const flight = Flight.start(module, F4C), motions = surfaceReader(F4C.surfaces, flight.stateNames);
    const after = (controls, seconds = 3) => { flight.fly({ pitch: 0, roll: 0, ...controls }); run(flight, seconds); return motions(flight.state); };
    // Parked: gear down, flaps at 1/2, boards in, brakes on, engines at idle; the surfaces at neutral but for the copilot's trim.
    const parked = motions(flight.state);
    assert.deepEqual(parkedFor(F4C), { pitch: 0, roll: 0, throttle: 0, gear: true, flaps: 0.5, speedbrake: false, brake: true });
    assert.equal(flight.value('fcs/flap-pos-norm'), 0.5, 'JSBSim\'s flaps at 1/2');
    assert.ok(parked.gear === 1 && parked.flaps === 0.5 && parked.speedbrake === 0, `gear down, flaps at 1/2, boards in (${shortly(parked)})`);
    const stabilator = flight.value('fcs/elevator-pos-rad') * DEG;
    assert.ok(Math.abs(parked.elevator - (0.5 - stabilator / 42)) < 1e-9 && Math.abs(stabilator) < 1, `the stabilator at the trim, ${stabilator.toFixed(2)} degrees, drawn there`);
    assert.ok(Math.abs(parked.aileron - 0.5) < 1e-6 && Math.abs(parked.rudder - 0.5) < 0.01, `ailerons and rudder neutral (${shortly(parked)})`);
    assert.ok(flight.value('propulsion/engine[0]/thrust-lbs') < 1000 && flight.value('fcs/throttle-pos-norm') === 0, 'engines at idle');
    // Each control, through the feel system and the actuators: the motion is where JSBSim has the part.
    const back = after({ pitch: 1 }), forward = after({ pitch: -1 }), right = after({ roll: 1 }), left = after({ roll: -1 });
    assert.ok(back.elevator > 0.99 && forward.elevator < 0.01, `full back stick, the stabilator 21 up: ${back.elevator.toFixed(3)}; full forward, 9 down: ${forward.elevator.toFixed(3)}`);
    assert.ok(right.aileron > 0.99 && left.aileron < 0.01, `full right stick: ${right.aileron.toFixed(3)}; full left: ${left.aileron.toFixed(3)}`);
    const out = after({ speedbrake: true }, 2), full = after({ speedbrake: false, flaps: 1 }, 5), up = after({ flaps: 0 }, 9);
    assert.ok(out.speedbrake === 1, 'Boards Out: the panels open, in 1.5 s');
    assert.ok(full.flaps === 1 && full.speedbrake === 0, 'Flaps Full: fully down, in 4 s from 1/2; Boards In');
    assert.ok(up.flaps === 0, 'Flaps Up: up, in 6 s from full');
    console.log(`  ${variant}: parked ${shortly(parked)}; back ${back.elevator.toFixed(3)}, forward ${forward.elevator.toFixed(3)}, right ${right.aileron.toFixed(3)}, left ${left.aileron.toFixed(3)}`);
    flight.dispose();

    // In the air (the gear can come up only there): 10,000 ft, 250 knots, the copilot's feet out and full left rudder set:
    // the rudder's motion goes toward 0 and the nose swings left; gear down and up again, the gear's motion follows, 4 s each way.
    const flying = Flight.start(module, F4C, { assists: null, settleSeconds: 0, sets: [['ic/h-sl-ft', 10000], ['ic/vc-kts', 250], ['fcs/rudder-cmd-norm', 1]], controls: { gear: false, flaps: 0, brake: false } });
    const air = surfaceReader(F4C.surfaces, flying.stateNames), heading = flying.value('attitude/psi-rad') * DEG;
    flying.fly({ gear: true });
    run(flying, 1);
    const rudder = air(flying.state).rudder, swung = flying.value('attitude/psi-rad') * DEG - heading, flexed = flying.value('fcs/rudder-pos-rad') * DEG;
    assert.ok(rudder < 0.5 && Math.abs(rudder - (0.5 - flexed / 60)) < 1e-9 && swung < -1, `full left rudder: ${flexed.toFixed(1)} degrees as the flexure lets it go, drawn at ${rudder.toFixed(3)}; the nose swung ${swung.toFixed(1)} degrees in a second`);
    assert.ok(air(flying.state).gear > 0 && air(flying.state).gear < 1, 'the gear on its way down');
    run(flying, 3.1);
    assert.equal(air(flying.state).gear, 1, 'down in 4 s');
    flying.fly({ gear: false });
    run(flying, 4.1);
    assert.equal(air(flying.state).gear, 0, 'gear up: up in 4 s');
    console.log(`  ${variant}: full left rudder ${flexed.toFixed(1)} degrees (flexed), drawn at ${rudder.toFixed(3)}; the gear follows JSBSim's, down and up`);
    flying.dispose();
  });

  test(`${variant}, f4c in the app: both engines' thrust and their afterburners go beside the state, through the Worker, as the page gets them`, async () => {
    // The app's own Worker list, on a made-up clock (as tests/f4c.test.js's Worker test), with the files as the page fetches them.
    const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
    const timer = madeUpTimer(), states = [];
    let handle;
    const client = new WorkerClient((message) => void handle(message));
    handle = createHandler((message) => {
      if (message.type === 'state') states.push(message);
      else queueMicrotask(() => client.receive(message));
    }, flightRun(timer));
    const pack = buildPack(new Map(F4C.files.map((path) => [path, readFileSync(fileURLToPath(inSrc(pageHomeOf(F4C) + path)))])));
    await client.request({ type: 'init', moduleUrl: inSrc(BUILDS[variant].module).href, packs: [['/data', pack]] });
    const started = await client.request({ type: 'fly', aircraft: 'f4c' });
    const at = (name) => started.stateNames.indexOf(name);
    assert.equal(started.stateNames.length, 34 + F4C.contacts.length, 'the state is milestone 1\'s 34 numbers and the contact points: nothing added to it');
    assert.equal(started.propellerRpm, null, 'no propeller');
    assert.ok(started.engines.thrust.length === 2 && started.engines.thrust[0] === started.state[at('propulsion/engine[0]/thrust-lbs')] && started.engines.thrust[1] > 0, `parked, idle: ${started.engines.thrust.map((lb) => lb.toFixed(0)).join(' and ')} lb`);
    assert.deepEqual(started.engines.afterburner, [0, 0], 'no afterburner at idle');
    const after = async (throttle, ms) => { await client.request({ type: 'controls', controls: { throttle, brake: true } }); timer.fire(); timer.run(ms); return states.at(-1); };
    const mil = await after(F4C.mil, 8000), full = await after(1, 3000);
    for (const s of [mil, full]) {
      assert.ok(s.ended === null && s.engines.thrust[0] === s.state[at('propulsion/engine[0]/thrust-lbs')], 'the first engine\'s is the state\'s own');
      assert.ok(Math.abs(s.engines.thrust[1] / s.engines.thrust[0] - 1) < 1e-9, 'the one throttle works both engines');
    }
    assert.deepEqual(mil.engines.afterburner, [0, 0], 'at MIL, none');
    assert.deepEqual(full.engines.afterburner, [1, 1], 'full afterburner: both lit, all the way');
    assert.ok(full.state[at('fcs/throttle-pos-norm')] === 2, 'the HUD\'s power, the engine\'s lever: 2, AB 100%');
    console.log(`  ${variant}: thrust beside the state, both engines: MIL ${mil.engines.thrust.map((lb) => lb.toFixed(0)).join(' + ')} lb, full afterburner ${full.engines.thrust.map((lb) => lb.toFixed(0)).join(' + ')} lb`);
    await client.request({ type: 'end' });
  });
}

/** A motion reading, as short text. */
function shortly(motions) { return Object.entries(motions).map(([name, at]) => `${name} ${at.toFixed(3)}`).join(', '); }
