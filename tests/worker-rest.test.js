// The Worker rests while the game is held, a flight can start held, and the propeller's speed goes out beside
// every state (src/sim/flight-run.js). New in FSG, milestone 2 (pull request 3); the "done" lines are in
// docs/milestones/2.md. Through the Worker's handler on a made-up clock, as tests/worker-flight.test.js is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, DATA } from '../src/fdm.js';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { C172X_FILES } from '../src/sim/c172x-files.js';
import { buildPack } from '../src/sim/files.js';
import { flightRun } from '../src/sim/flight-run.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';
import { FT, toWorld } from '../src/sim/world.js';
import { madeUpTimer } from './made-up-timer.js';

const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
const bytes = (file) => readFileSync(fileURLToPath(inSrc(DATA + file)));

/** A Worker's handler with the game in it, in this thread, on a made-up clock; `states` collects what it posts unasked. */
async function workerWith(build) {
  const timer = madeUpTimer(), states = [];
  let handle;
  const client = new WorkerClient((message) => void handle(message));
  handle = createHandler((message) => {
    if (message.type === 'state') states.push(message);
    else queueMicrotask(() => client.receive(message));
  }, flightRun(timer));
  const files = [...new Set([...C172X_FILES, ...C172P.files])];
  await client.request({ type: 'init', moduleUrl: inSrc(BUILDS[build].module).href, packs: [['/data', buildPack(new Map(files.map((file) => [file, bytes(file)])))]] });
  return { timer, states, request: (body) => client.request(body) };
}
const reader = (stateNames) => (state) => {
  const at = (name) => state[stateNames.indexOf(name)], { north, east } = toWorld(at('position/lat-geod-rad'), at('position/long-gc-rad'));
  return { time: at('simulation/sim-time-sec'), fromTheNumbersFt: Math.hypot(north, east) / FT, groundKt: at('velocities/vg-fps') / 1.6878 };
};

for (const build of Object.keys(BUILDS)) {
  const name = BUILDS[build].name;

  test(`${name}: held, the Worker's timer is stopped and does not fire, however long; let go, it runs the whole steps in the time again and catches nothing up`, async () => {
    const { timer, states, request } = await workerWith(build);
    const started = await request({ type: 'fly', aircraft: 'c172p' }), read = reader(started.stateNames);
    assert.equal(timer.running, true, 'flying: the timer runs');
    timer.fire();
    timer.run(2000);
    assert.equal(states.at(-1).totalSteps, 240);
    const before = states.length, last = states.at(-1);

    await request({ type: 'hold', on: true });
    assert.equal(timer.running, false, 'held: the timer is stopped');
    for (let k = 0; k < 2500; k++) timer.fire();   // ten made-up seconds: a stopped timer has nothing to fire
    assert.equal(states.length, before, 'no state is posted');
    await request({ type: 'hold', on: true });   // held again while held: still at rest
    assert.equal(timer.running, false);

    await request({ type: 'hold', on: false });
    assert.equal(timer.running, true, 'let go: the timer runs again');
    await request({ type: 'hold', on: false });   // let go twice: one timer, not two
    timer.fire();   // the first firing after letting go only starts the clock again
    assert.equal(states.length, before, 'nothing is caught up');
    timer.run(1000);
    assert.equal(states.at(-1).totalSteps, 360, 'one second later, 120 steps more');
    assert.ok(Math.abs(read(states.at(-1).state).time - read(last.state).time - 1) < 1e-9, 'and one second more of the flight\'s own time');
    assert.equal(states.at(-1).droppedSeconds, 0);
    states.forEach((state, i) => assert.equal(state.n, i + 1, 'the states are still numbered one after another'));

    const ended = await request({ type: 'end' });
    assert.equal(ended.steps, 360);
    // Every firing is counted, across the rest: 1 + 500 before it, 1 + 250 after.
    assert.equal(ended.fires, 752);
    assert.equal(timer.running, false);
  });

  test(`${name}: a flight started held runs no step until it is let go`, async () => {
    const { timer, states, request } = await workerWith(build);
    const started = await request({ type: 'fly', aircraft: 'c172p', held: true }), read = reader(started.stateNames);
    assert.equal(timer.running, false, 'started held: the timer is not running');
    for (let k = 0; k < 1000; k++) timer.fire();
    assert.equal(states.length, 0, 'no step, no state');
    // The controls can be set while it is held; they are flown when it is let go.
    await request({ type: 'controls', controls: { throttle: 0 } });
    await request({ type: 'hold', on: false });
    timer.fire();
    timer.run(1000);
    assert.equal(states.at(-1).totalSteps, 120);
    assert.ok(Math.abs(read(states.at(-1).state).time - read(started.state).time - 1) < 1e-9, 'one second of its own time since the start');
    assert.ok(read(states.at(-1).state).fromTheNumbersFt < 1, 'still parked on the numbers');
    await request({ type: 'end' });
  });

  test(`${name}: the propeller's speed goes out beside every state: 700 to 900 RPM parked at idle, over 2,300 at full power with the brakes on; and each flight has its number`, async () => {
    const { timer, states, request } = await workerWith(build);
    const started = await request({ type: 'fly', aircraft: 'c172p' }), read = reader(started.stateNames);
    assert.equal(started.flight, 1);
    assert.equal(started.stateNames.length, 34 + 7, 'the state is milestone 1\'s 34 numbers and the seven contact points: the propeller is beside it, not in it');
    assert.ok(started.propellerRpm >= 700 && started.propellerRpm <= 900, `parked at idle: ${started.propellerRpm} RPM`);
    timer.fire();
    timer.run(1000);
    assert.ok(states.every((s) => s.flight === 1 && s.propellerRpm >= 700 && s.propellerRpm <= 900), 'idling, in every state');
    const idle = states.at(-1).propellerRpm;
    await request({ type: 'controls', controls: { throttle: 1 } });   // the brakes stay on
    timer.run(10000);
    const full = states.at(-1);
    console.log(`  ${name}: ${idle.toFixed(0)} RPM at idle, ${full.propellerRpm.toFixed(0)} at full power with the brakes on; it has moved ${read(full.state).fromTheNumbersFt.toFixed(2)} ft`);
    assert.ok(full.propellerRpm > 2300, `${full.propellerRpm} RPM`);
    assert.ok(read(full.state).fromTheNumbersFt < 1, 'the brakes hold it');

    // Fly again: the next flight, numbered 2; a state of the first cannot be taken for one of the second.
    const again = await request({ type: 'fly', aircraft: 'c172p' });
    assert.equal(again.flight, 2);
    states.length = 0;
    timer.fire();
    timer.run(500);
    assert.ok(states.length > 0 && states.every((s) => s.flight === 2));
    // An aircraft with no propeller in its settings sends none.
    const cessnaX = await request({ type: 'fly', aircraft: 'c172x' });
    assert.equal(cessnaX.flight, 3);
    assert.equal(cessnaX.propellerRpm, null);
    await request({ type: 'end' });
  });

  test(`${name}: a flight that has ended stays at rest when it is let go`, async () => {
    const { timer, states, request } = await workerWith(build);
    await request({ type: 'fly', aircraft: 'c172p', crashOverride: false });
    timer.fire();
    // Not a number for a control: the host layer refuses it and the flight ends as a broken state (milestone 1).
    await request({ type: 'controls', controls: { pitch: NaN } });
    timer.run(100);
    assert.equal(states.at(-1).ended?.reason, 'broken state');
    assert.ok(states.at(-1).propellerRpm >= 700, 'the last state still carries the propeller\'s last speed');
    assert.equal(timer.running, false, 'ended: the Worker rests');
    await request({ type: 'hold', on: false });
    assert.equal(timer.running, false, 'and stays at rest');
    await request({ type: 'end' });
  });
}
