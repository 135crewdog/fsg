// The Worker's own clock (src/sim/clock.js), with a made-up time and timer: no real clock is read here, so
// the numbers are exact and the same on every machine. The real clock is measured in the browser check
// (tests/browser/app.chromium.mjs) and on the owner's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, DATA, DT } from '../src/fdm.js';
import { C172X_FILES } from '../src/sim/c172x-files.js';
import { CLOCK_PERIOD_MS, startClock } from '../src/sim/clock.js';
import { clockRun } from '../src/sim/clock-run.js';
import { buildPack } from '../src/sim/files.js';
import { FixedStepLoop } from '../src/sim/loop.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';

/** A stand-in simulation: the state is the step count (as in jsbsim/tests/loop.test.js). */
class FakeSim {
  dt = DT;
  steps = 0;
  prev = new Float64Array(1);
  curr = new Float64Array(1);
  step(n) { this.steps += n; this.curr[0] = this.steps; return 0; }
}

/** A made-up clock that ticks in whole milliseconds, like the phone's, and a timer that fires when told to. */
function madeUpTimer(startMs = 5000) {
  let ms = startMs, fn = null, period = 0;
  return {
    now: () => ms / 1000,
    every: (f, p) => { fn = f; period = p; return 1; },
    cancel: () => { fn = null; },
    get ms() { return ms; },
    get running() { return fn !== null; },
    /** One firing, `late` milliseconds later than its period. */
    fire(late = 0) { ms += period + late; if (fn) fn(); },
    /** Firings on time until `duration` milliseconds have passed. */
    run(duration) { const end = ms + duration; while (fn && ms + period <= end) this.fire(); },
  };
}

for (const period of [1, 4, 8, 16, 33]) {
  test(`a timer every ${period} ms: after every firing, the steps run are the whole steps in the time, and none is dropped`, () => {
    const sim = new FakeSim(), loop = new FixedStepLoop(sim), timer = madeUpTimer();
    startClock({ loop, ...timer, periodMs: period });
    timer.fire();   // the first firing starts the loop's clock
    const t0 = timer.ms;
    assert.equal(sim.steps, 0);
    while (timer.ms - t0 < 10000) {
      timer.fire();
      const whole = Math.floor((120 * (timer.ms - t0)) / 1000 + 1e-9);
      assert.equal(sim.steps, whole, `${timer.ms - t0} ms after the start`);
    }
    assert.equal(loop.droppedSeconds, 0);
    assert.ok(sim.steps >= 1200 && sim.steps <= 1204, `${sim.steps} steps in ${timer.ms - t0} ms`);
  });
}

test('the timer firing unevenly, between on time and 12 ms late: still the whole steps in the time', () => {
  const sim = new FakeSim(), loop = new FixedStepLoop(sim), timer = madeUpTimer();
  startClock({ loop, ...timer });
  timer.fire();
  const t0 = timer.ms;
  for (let i = 0; timer.ms - t0 < 10000; i++) {
    timer.fire((i * 7) % 13);
    assert.equal(sim.steps, Math.floor((120 * (timer.ms - t0)) / 1000 + 1e-9));
  }
  assert.equal(loop.droppedSeconds, 0);
});

test('a 10-second stall: no more steps than the cap, and the rest of the time is counted as dropped', () => {
  const sim = new FakeSim(), loop = new FixedStepLoop(sim), timer = madeUpTimer();
  startClock({ loop, ...timer });
  timer.fire();
  timer.run(1000);
  const before = sim.steps;
  assert.equal(before, 120);
  timer.fire(10000);   // the Worker was held up for ten seconds
  assert.equal(sim.steps - before, loop.maxStepsPerAdvance);
  const stall = (10000 + CLOCK_PERIOD_MS) / 1000;
  assert.ok(Math.abs(loop.droppedSeconds - (stall - loop.maxStepsPerAdvance * DT)) < DT, `${loop.droppedSeconds} s dropped of a ${stall} s stall`);
  // And afterwards it keeps time again.
  const after = sim.steps, t1 = timer.ms;
  timer.run(1000);
  assert.equal(sim.steps - after, Math.floor((120 * (timer.ms - t1)) / 1000 + 1e-9));
});

test('paused: no steps; resumed: nothing is caught up', () => {
  const sim = new FakeSim(), loop = new FixedStepLoop(sim), timer = madeUpTimer();
  startClock({ loop, ...timer });
  timer.fire();
  timer.run(1000);
  loop.pause();
  timer.run(10000);
  assert.equal(sim.steps, 120, 'paused for ten seconds');
  loop.resume();
  timer.fire();
  assert.equal(sim.steps, 120, 'the first firing after resume only starts the clock again');
  timer.run(1000);
  assert.equal(sim.steps, 240);
  assert.equal(loop.droppedSeconds, 0);
});

test('stopped: the timer is cancelled, and a firing that was already on its way does nothing', () => {
  const sim = new FakeSim(), loop = new FixedStepLoop(sim), timer = madeUpTimer();
  let late = null;
  const clock = startClock({ loop, now: timer.now, every: (f, p) => { late = f; return timer.every(f, p); }, cancel: timer.cancel });
  timer.fire();
  timer.run(100);
  const steps = sim.steps, fires = clock.fires;
  clock.stop();
  assert.equal(timer.running, false);
  late();
  assert.equal(sim.steps, steps);
  assert.equal(clock.fires, fires);
});

// ---- through the Worker's handler, with JSBSim, on the made-up clock ----
const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
const bytes = (file) => readFileSync(fileURLToPath(inSrc(DATA + file)));

for (const build of Object.keys(BUILDS)) {
  test(`${BUILDS[build].name}: ten seconds on the Worker's clock is 1,200 steps of JSBSim, a state after every batch, in order`, async () => {
    const timer = madeUpTimer(), states = [];
    let handle;
    const client = new WorkerClient((message) => void handle(message));
    handle = createHandler((message) => {
      if (message.type === 'state') states.push(message);   // unasked: arrives while the request is still open
      else queueMicrotask(() => client.receive(message));
    }, clockRun(timer));
    await client.request({ type: 'init', moduleUrl: inSrc(BUILDS[build].module).href, packs: [['/data', buildPack(new Map(C172X_FILES.map((file) => [file, bytes(file)])))]] });
    await client.request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] });

    const reply = client.request({ type: 'clock-run', seconds: 10 });
    assert.ok(timer.running, 'the request started the timer');
    timer.run(20000);
    const ran = await reply;
    assert.equal(timer.running, false, 'and stopped it after ten seconds');
    assert.equal(ran.steps, 1200);
    assert.equal(ran.seconds, 10);
    assert.equal(ran.droppedSeconds, 0);
    assert.equal(ran.fires, 10000 / CLOCK_PERIOD_MS + 1);
    assert.equal(ran.states, states.length);
    // Every state follows the one before: no step missing, none twice, sim time to match.
    let total = 0;
    for (const state of states) {
      total += state.steps;
      assert.equal(state.totalSteps, total);
      assert.ok(Math.abs(state.simTime - total * DT) < 1e-9, `sim time ${state.simTime} after ${total} steps`);
      assert.ok(state.curr.every(Number.isFinite));
    }
    assert.equal(total, 1200);
    // Still an airplane in the air after ten seconds hands off.
    const [altitude, knots] = states.at(-1).curr;
    assert.ok(altitude > 3000 && altitude < 5000 && knots > 60 && knots < 200, `${altitude} ft, ${knots} kt`);
    console.log(`  ${BUILDS[build].name}: ${ran.steps} steps in ${ran.seconds} s, ${ran.states} states, ${ran.fires} firings; after it ${Math.round(altitude)} ft, ${Math.round(knots)} kt`);

    await assert.rejects(client.request({ type: 'no-such-request' }), /unknown request: no-such-request/);
    await client.request({ type: 'dispose' });
    await assert.rejects(client.request({ type: 'clock-run', seconds: 1 }), /send create first/);
  });
}
