// The game in the Worker (src/sim/flight-run.js), through the Worker's handler, on a made-up clock: no real
// clock is read here. The real Worker on a real clock is the browser check (tests/browser/app.chromium.mjs)
// and the owner's phone. The "done" lines are in docs/milestones/1.md, pull request 11.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, DATA } from '../src/fdm.js';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { C172X_FILES } from '../src/sim/c172x-files.js';
import { CLOCK_PERIOD_MS } from '../src/sim/clock.js';
import { buildPack } from '../src/sim/files.js';
import { flightRun } from '../src/sim/flight-run.js';
import { DT } from '../src/sim/game.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';
import { FT, toWorld } from '../src/sim/world.js';
import { madeUpTimer } from './made-up-timer.js';

const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
const bytes = (file) => readFileSync(fileURLToPath(inSrc(DATA + file)));
const DEG = 180 / Math.PI, KT = 1.6878;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** A Worker's handler with the game in it, in this thread, on a made-up clock; `states` collects what it posts unasked. */
async function workerWith(build) {
  const timer = madeUpTimer(), states = [];
  let handle;
  const client = new WorkerClient((message) => void handle(message));
  handle = createHandler((message) => {
    if (message.type === 'state') states.push(message);
    else queueMicrotask(() => client.receive(message));
  }, flightRun(timer, { c172x: C172X }));   // the test aircraft is not in the app's list since milestone 3, pull request 8: it is handed in
  await client.request({ type: 'init', moduleUrl: inSrc(BUILDS[build].module).href, packs: [['/data', buildPack(new Map(C172X_FILES.map((file) => [file, bytes(file)])))]] });
  return { timer, states, request: (body) => client.request(body) };
}

/** What a state says, by name. */
const reader = (stateNames) => {
  const at = (name) => stateNames.indexOf(name);
  const wheels = stateNames.map((name, i) => (/^gear\/unit\[\d+\]\/WOW$/.test(name) ? i : -1)).filter((i) => i >= 0);
  return (state) => {
    const { north, east } = toWorld(state[at('position/lat-geod-rad')], state[at('position/long-gc-rad')]);
    return {
      knots: state[at('velocities/vc-kts')], groundKt: state[at('velocities/vg-fps')] / KT, aboveGround: state[at('position/h-agl-ft')], pitch: state[at('attitude/theta-rad')] * DEG, bank: state[at('attitude/phi-rad')] * DEG,
      heading: state[at('attitude/psi-rad')] * DEG, northFt: north / FT, eastFt: east / FT, wheels: wheels.filter((i) => state[i] === 1).length, time: state[at('simulation/sim-time-sec')],
    };
  };
};
const parked = (r) => r.wheels === 3 && r.groundKt < 0.1 && Math.hypot(r.northFt, r.eastFt) < 1 && Math.abs(r.aboveGround - C172X.standingFt) < 0.3 && Math.abs(r.heading - 90) < 0.1;

/**
 * A takeoff flown through the Worker's messages: the controls are sent `rate` times a second, worked out from
 * the last state that arrived, for `seconds` of the made-up clock.
 */
async function takeoff(worker, rate, seconds) {
  const { timer, states, request } = worker;
  const started = await request({ type: 'fly', aircraft: 'c172x' });
  const read = reader(started.stateNames);
  assert.ok(parked(read(started.state)), 'the flight starts parked on the numbers');
  states.length = 0;
  timer.fire();   // the first firing starts the loop's clock
  const t0 = timer.ms, everyMs = 1000 / rate;
  let sent = 0, liftoff = null, airborne = false, last = read(started.state);
  while (timer.ms - t0 < seconds * 1000) {
    if (timer.ms - t0 >= sent * everyMs) {
      sent++;
      if (states.length) last = read(states.at(-1).state);
      airborne ||= last.wheels === 0 && last.aboveGround > C172X.standingFt + 2;
      await request({ type: 'controls', controls: {
        throttle: 1, brake: false,
        pitch: airborne ? clamp(0.08 * (8 - last.pitch), -1, 1) : last.knots > 55 ? 0.5 : 0,
        roll: airborne ? clamp(-0.03 * last.bank, -1, 1) : clamp(-0.5 * (last.heading - 90) - 0.05 * last.northFt, -1, 1),
      } });
    }
    const before = states.length;
    timer.fire();
    if (liftoff === null && states.length > before) { const now = read(states.at(-1).state); if (now.wheels === 0) liftoff = now; }
  }
  return { started, read, liftoff, sent, elapsedMs: timer.ms - t0, steps: states.at(-1).totalSteps, states: states.slice() };
}

for (const build of Object.keys(BUILDS)) {
  test(`${BUILDS[build].name}: a takeoff sent as control messages 60 and 30 times a second runs the same steps, the whole steps in the time; the Cessna lifts off between 45 and 70 knots both ways`, async () => {
    const flown = {};
    for (const rate of [60, 30]) {
      const worker = await workerWith(build);
      const t = flown[rate] = await takeoff(worker, rate, 40);
      const whole = Math.floor((120 * t.elapsedMs) / 1000 + 1e-9);
      console.log(`  ${BUILDS[build].name}, controls ${rate} times a second (${t.sent} messages): ${t.steps} steps in ${t.elapsedMs / 1000} s, ${t.states.length} states; liftoff at ${t.liftoff?.knots.toFixed(1)} kt, ${t.liftoff?.eastFt.toFixed(0)} ft down the runway`);
      assert.equal(t.steps, whole, 'the whole steps in the time');
      assert.ok(t.liftoff && t.liftoff.knots >= 45 && t.liftoff.knots <= 70, `liftoff at ${t.liftoff?.knots} kt`);
      // Every state follows the one before: numbered from 1, no step missing, the flight's own time to match.
      let total = 0;
      t.states.forEach((state, i) => {
        total += state.steps;
        assert.equal(state.n, i + 1);
        assert.equal(state.totalSteps, total);
        assert.ok(state.state.every(Number.isFinite) && state.ended === null && state.waiting === false && state.droppedSeconds === 0);
      });
      const ended = await worker.request({ type: 'end' });
      assert.equal(ended.steps, t.steps);
      assert.equal(ended.states, t.states.length);
      assert.equal(worker.timer.running, false, 'ending the flight stops the clock');
    }
    assert.equal(flown[60].steps, flown[30].steps, 'the same number of steps both ways');
    assert.equal(flown[60].steps, 4800);
  });

  test(`${BUILDS[build].name}: hold stops the flight, letting go catches nothing up, and fly again is a parked airplane`, async () => {
    const worker = await workerWith(build), { timer, states, request } = worker;
    const started = await request({ type: 'fly', aircraft: 'c172x' });
    const read = reader(started.stateNames);
    await request({ type: 'controls', controls: { throttle: 1, brake: false } });
    timer.fire();
    timer.run(5000);
    const rolling = states.at(-1);
    assert.equal(rolling.totalSteps, 600);
    assert.ok(read(rolling.state).groundKt > 5, 'it is rolling');

    await request({ type: 'hold', on: true });
    const before = states.length;
    timer.run(30000);   // half a minute on the pause screen
    assert.equal(states.length, before, 'held: no state is posted');
    await request({ type: 'hold', on: false });
    timer.fire();       // the first firing after letting go only starts the clock again
    assert.equal(states.length, before, 'nothing is caught up');
    timer.run(1000);
    assert.equal(states.at(-1).totalSteps, 720, 'one second later, 120 steps more');
    assert.ok(Math.abs(read(states.at(-1).state).time - read(rolling.state).time - 1) < 1e-9, 'and one second more of the flight\'s own time');
    assert.equal(states.at(-1).droppedSeconds, 0);

    // The crash override switch reaches the flight; then fly again: a new flight, parked, numbered from 1.
    await request({ type: 'override', on: false });
    const again = await request({ type: 'fly', aircraft: 'c172x' });
    assert.ok(parked(read(again.state)), 'parked on the numbers again');
    states.length = 0;
    timer.fire();
    timer.run(1000);
    assert.equal(states[0].n, 1);
    assert.equal(states.at(-1).totalSteps, 120);
    assert.ok(parked(read(states.at(-1).state)), 'and it stays parked: brakes on, engine at idle');

    // What the handler refuses.
    await assert.rejects(request({ type: 'fly', aircraft: 'f16' }), /unknown aircraft: f16/);
    await assert.rejects(request({ type: 'no-such-request' }), /unknown request: no-such-request/);
    await request({ type: 'end' });
    await assert.rejects(request({ type: 'controls', controls: { throttle: 1 } }), /send fly first/);
    await assert.rejects(request({ type: 'hold', on: true }), /send fly first/);
    // The game step is timed in whole batches (the made-up clock does not move while one runs, so the time here is 0).
    const bench = await request({ type: 'game-bench', aircraft: 'c172x', steps: 600, batches: 3 });
    assert.deepEqual(bench, { id: bench.id, ok: true, usPerStep: 0, steps: 600 });
  });

  test(`${BUILDS[build].name}: with the crash override off, flying into the ground ends the flight: the last state says why, and the clock stops`, async () => {
    const worker = await workerWith(build), { timer, states, request } = worker;
    const started = await request({ type: 'fly', aircraft: 'c172x', crashOverride: false });
    const read = reader(started.stateNames);
    timer.fire();
    // Full power, steer, rotate, climb a little; then the stick full forward.
    let airborne = false, pushed = false;
    for (let ms = 0; ms < 60000 && timer.running; ms += CLOCK_PERIOD_MS) {
      const last = states.length ? read(states.at(-1).state) : read(started.state);
      airborne ||= last.wheels === 0 && last.aboveGround > 50;
      if (ms % 20 === 0) {
        await request({ type: 'controls', controls: { throttle: 1, brake: false, pitch: airborne ? -1 : last.knots > 55 ? 0.5 : 0, roll: last.wheels ? clamp(-0.5 * (last.heading - 90) - 0.05 * last.northFt, -1, 1) : clamp(-0.03 * last.bank, -1, 1) } });
        pushed ||= airborne;
      }
      timer.fire();
    }
    const final = states.at(-1);
    assert.ok(pushed, 'it got into the air first');
    assert.equal(final.ended?.reason, 'hard impact');
    assert.ok(final.state.every(Number.isFinite));
    assert.ok(final.events.some((e) => e.type === 'ended') && final.events.some((e) => e.type === 'touch' && e.hard), 'the state carries what the rules reported');
    assert.equal(timer.running, false, 'the clock has stopped');
    console.log(`  ${BUILDS[build].name}: ended ${final.ended.reason} (${final.ended.point}, closing at ${final.ended.closingFpm.toFixed(0)} ft/min) after ${final.totalSteps} steps`);
    const again = await request({ type: 'fly', aircraft: 'c172x' });
    assert.ok(parked(read(again.state)), 'fly again: parked on the numbers');
    await request({ type: 'end' });
  });
}
