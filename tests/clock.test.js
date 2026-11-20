// The Worker's own clock (src/sim/clock.js), with a made-up time and timer: no real clock is read here, so
// the numbers are exact and the same on every machine. The game on this clock, through the Worker's handler, is
// tests/worker-flight.test.js. The real clock is measured in the browser check
// (tests/browser/app.chromium.mjs) and on the owner's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/fdm.js';
import { CLOCK_PERIOD_MS, startClock } from '../src/sim/clock.js';
import { FixedStepLoop } from '../src/sim/loop.js';
import { madeUpTimer } from './made-up-timer.js';

/** A stand-in simulation: the state is the step count (as in jsbsim/tests/loop.test.js). */
class FakeSim {
  dt = DT;
  steps = 0;
  prev = new Float64Array(1);
  curr = new Float64Array(1);
  step(n) { this.steps += n; this.curr[0] = this.steps; return 0; }
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
