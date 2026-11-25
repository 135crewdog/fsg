// The picture's clock (src/render/between.js) and the picture's axes (src/render/frames.js).
// New in FSG, milestone 2 (pull request 3). The "done" lines are in docs/milestones/2.md, written before
// either was built. No real clock is read: the states and the frames arrive by a made-up feed, written here
// and not changed after a result is seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUMP, TRAIL, createBetween } from '../src/render/between.js';
import { attitude, blend, poseReader, toPicture, turned } from '../src/render/frames.js';
import { STATE } from '../src/sim/game.js';
import { FT, toLatLon } from '../src/sim/world.js';

const DT = 1 / 120, DEG = Math.PI / 180;

/**
 * The made-up feed. The Worker's timer fires about every 10 ms (9.5 to 11), and one firing in a hundred is
 * late, up to 16 ms after the one before: what the owner's phone showed (docs/milestones/1.md). Each firing
 * runs the whole steps due, 8 at most, and drops what is more than a quarter second behind (loop.js). Its
 * state reaches the page 0.3 to 1.3 ms later. The page draws a frame every 1/60 or 1/30 s, one in 50 of them
 * 12 ms late. `workerStall` and `pageStall` are [at, for] in seconds; `hold` is [from, to]: the page holds its
 * clock and the Worker stops posting 5 ms later, then both let go; `restart` is a time at which a new flight
 * starts, its own time beginning again at 10 s.
 * Calls each(frame) for every frame drawn: { real, dt, time, newest, sample, flight, behind }. `behind` is how
 * far the picture's time is behind the flight's own time at that moment, as the Worker's clock has it: the
 * time of its last firing, and what has passed since. (My first measure took real time from the feed's zero;
 * the Worker's clock starts at its first firing, about 10 ms later, so every frame read 10 ms too far behind.
 * After a stall the Worker drops time too, on purpose. This measures what the line means.)
 */
function feed({ fps, seconds = 120, workerStall = null, pageStall = null, hold = null, restart = null, seed = 1 }, each) {
  let s = seed;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // The Worker's side, worked out first: when each state arrives, and what it holds.
  const arrivals = [], firings = [];
  let t = 0.0005, lastT = null, sim = 0, owed = 0, flight = 1;
  while (t < seconds) {
    let gap = 0.0095 + random() * 0.0015;
    if (random() < 0.01) gap = 0.011 + random() * 0.005;
    if (workerStall && t < workerStall[0] && t + gap >= workerStall[0]) gap += workerStall[1];
    t += gap;
    if (restart !== null && flight === 1 && t >= restart) { flight = 2; sim = 10; owed = 0; lastT = null; arrivals.push({ at: t, restart: true }); }
    const stopped = hold && t >= hold[0] + 0.005 && t < hold[1];
    if (stopped) { lastT = null; firings.push({ t, now: sim + owed, running: false }); continue; }   // held: no step, and letting go catches nothing up
    if (lastT !== null) owed += Math.min(t - lastT, 0.25);
    lastT = t;
    const steps = Math.min(8, Math.floor(owed / DT + 1e-9));
    if (steps > 0) {
      owed -= steps * DT;
      sim += steps * DT;
      arrivals.push({ at: t + 0.0003 + random() * 0.001, seconds: sim, flight });
    }
    firings.push({ t, now: sim + owed, running: true });
  }
  let fired = 0;
  const flightTime = (real) => {
    while (fired < firings.length - 1 && firings[fired + 1].t <= real) fired++;
    const f = firings[fired];
    return f.now + (f.running ? Math.min(real - f.t, 0.25) : 0);
  };
  // The page's side.
  const between = createBetween(), period = 1 / fps;
  let i = 0, last = null, shownFlight = 1, held = false;
  for (let n = 0; ; n++) {
    let real = 0.2 + n * period;
    if (real >= seconds) break;
    if (n % 50 === 49) real += 0.012;
    if (pageStall && real >= pageStall[0] && real < pageStall[0] + pageStall[1]) continue;   // the page was busy: these frames never happened
    if (hold && !held && real >= hold[0] && real < hold[1]) { held = true; between.hold(true); }
    if (hold && held && real >= hold[1]) { held = false; between.hold(false); }
    for (; i < arrivals.length && arrivals[i].at <= real; i++) {
      if (arrivals[i].restart) { between.reset(); shownFlight = 2; } else between.push(arrivals[i].seconds, { flight: arrivals[i].flight, seconds: arrivals[i].seconds });
    }
    const dt = last === null ? period : real - last;
    last = real;
    const time = between.advance(dt);
    if (time !== null) each({ real, dt, time, newest: between.newest.seconds, sample: between.sample(), flight: shownFlight, held, behind: flightTime(real) - time });
  }
}
const worst = (list) => list.reduce((a, b) => Math.max(a, b), -Infinity);

for (const [fps, line] of [[60, 1], [30, 1.5]]) {
  test(`the picture's clock at ${fps} frames a second for two minutes: each frame it moves on by the frame's own time within ${line} ms; never ahead of the newest state, never backwards; 35 ms or less behind real time`, () => {
    const off = [], behind = [], ahead = [];
    let before = null, count = 0;
    feed({ fps }, (f) => {
      if (count++ < 30) { before = f.time; return; }   // the first half second: the clock starts from a standstill
      off.push(Math.abs(f.time - before - f.dt) * 1000);
      assert.ok(f.time >= before, 'never backwards');
      ahead.push(f.time - f.newest);
      behind.push(f.behind * 1000);
      // The picture is drawn between two states that are either side of its time.
      assert.ok(f.sample.before.seconds <= f.time + 1e-12 && f.sample.after.seconds >= f.time - 1e-12 && f.sample.fraction >= 0 && f.sample.fraction <= 1);
      assert.ok(Math.abs(f.sample.before.seconds + (f.sample.after.seconds - f.sample.before.seconds) * f.sample.fraction - f.time) < 1e-9, 'the share between them is the time');
      before = f.time;
    });
    console.log(`  ${fps} frames a second, ${off.length} frames: off the frame's own time by ${worst(off).toFixed(2)} ms at most; nearest to the newest state ${(-worst(ahead) * 1000).toFixed(2)} ms behind it; behind real time ${worst(behind).toFixed(1)} ms at most`);
    assert.ok(worst(off) <= line, `${worst(off)} ms`);
    assert.ok(worst(ahead) <= 0, 'never ahead of the newest state');
    assert.ok(worst(behind) <= 35, `${worst(behind)} ms behind`);
  });

  for (const [what, stall] of [['the Worker', { workerStall: [30, 0.5] }], ['the page', { pageStall: [30, 0.5] }]]) {
    test(`at ${fps} frames a second, after ${what} stalls for half a second: the clock holds the newest state, jumps forward and never back, and is inside its lines again within a second`, () => {
      let before = null, heldNewest = 0, jumped = 0;
      const off = [], behind = [];
      feed({ fps, seconds: 60, ...stall }, (f) => {
        if (before !== null) {
          assert.ok(f.time >= before, 'never backwards');
          assert.ok(f.time <= f.newest, 'never ahead of the newest state');
          if (f.real > 30 && f.real < 31) {
            if (f.time === f.newest) heldNewest++;
            if (f.time - before > f.dt + JUMP / 2) jumped++;
          }
          if (f.real > 31.5 || (f.real > 1 && f.real < 30)) { off.push(Math.abs(f.time - before - f.dt) * 1000); behind.push(f.behind * 1000); }
        }
        before = f.time;
      });
      console.log(`  ${fps} frames a second, ${what} stalled: ${heldNewest} frames on the newest state, ${jumped} jump forward; outside the stall off by ${worst(off).toFixed(2)} ms and behind by ${worst(behind).toFixed(1)} ms at most`);
      // The Worker stalled: no states came, so the clock ran up to the newest and held it; then they came in a
      // rush and it jumped. The page stalled: its one late frame is as long as the stall, and takes it there.
      if (what === 'the Worker') assert.ok(heldNewest > 0 && jumped >= 1, 'it held the newest state while none came, then jumped forward');
      assert.ok(worst(off) <= line && worst(behind) <= 35, 'inside its lines before the stall, and again a second after it');
    });
  }

  test(`at ${fps} frames a second, held and let go: held, the clock stands still; afterwards no frame shows a moment from before, and none sits on the newest state`, () => {
    let atHold = null, before = null, after = 0;
    const off = [];
    feed({ fps, seconds: 60, hold: [20, 23] }, (f) => {
      if (f.held) {
        atHold ??= before;
        assert.equal(f.time, atHold, 'held: the clock stands still');
      } else if (atHold !== null) {
        after++;
        assert.ok(f.time >= atHold, 'no moment from before the hold');
        assert.ok(f.time < f.newest, 'not on the newest state');
        if (f.real > 23.5) off.push(Math.abs(f.time - before - f.dt) * 1000);
      }
      before = f.time;
    });
    assert.ok(atHold !== null && after > 100);
    assert.ok(worst(off) <= line, `half a second after it is let go it is inside its line again (${worst(off)} ms)`);
  });

  test(`at ${fps} frames a second, a restart: no frame shows a state of the flight before, and none sits on the newest state once the new flight is moving`, () => {
    let frames = 0;
    feed({ fps, seconds: 40, restart: 20 }, (f) => {
      if (f.flight !== 2) return;
      frames++;
      assert.ok(f.sample.before.flight === 2 && f.sample.after.flight === 2, 'only the new flight is drawn');
      assert.ok(f.time >= 10, 'the new flight\'s own time');
      if (frames > 5) assert.ok(f.time < f.newest, 'not on the newest state');
    });
    assert.ok(frames > 100);
  });
}

test('the clock\'s numbers: two steps behind, and a jump when it is more than 50 ms out', () => {
  assert.equal(TRAIL, 2 / 120);
  assert.equal(JUMP, 0.05);
  const between = createBetween();
  assert.equal(between.advance(1 / 60), null, 'no state yet: nothing to draw');
  assert.equal(between.sample(), null);
  between.push(10, 'a');
  assert.deepEqual(between.sample(), { before: 'a', after: 'a', fraction: 0 }, 'one state: that state');
  between.push(9.9, 'late');   // an older state than the newest is dropped
  assert.equal(between.newest.state, 'a');
});

// ---- the axes ----
const near = (a, b, within = 1e-9) => a.every((x, k) => Math.abs(x - b[k]) <= within);
const NOSE = [0, 0, -1], RIGHT_WING = [1, 0, 0], TOP = [0, 1, 0];   // a model's own axes (docs/models.md)

test('the picture\'s axes: an airplane on heading 090 has its nose to the east; nose up is up; right bank puts the right wing down', () => {
  assert.ok(near(turned(attitude(90 * DEG, 0, 0), NOSE), [1, 0, 0]), 'heading 090: the nose points east (+x)');
  assert.ok(near(turned(attitude(0, 0, 0), NOSE), [0, 0, -1]), 'heading 000: north (-z)');
  assert.ok(near(turned(attitude(90 * DEG, 0, 0), TOP), [0, 1, 0]), 'level: its top is up (+y)');
  assert.ok(turned(attitude(90 * DEG, 10 * DEG, 0), NOSE)[1] > 0.17, 'pitched up 10 degrees: the nose is up');
  assert.ok(near(turned(attitude(90 * DEG, 10 * DEG, 0), NOSE), [Math.cos(10 * DEG), Math.sin(10 * DEG), 0]), 'and still to the east');
  assert.ok(near(turned(attitude(90 * DEG, 0, 30 * DEG), RIGHT_WING), [0, -Math.sin(30 * DEG), Math.cos(30 * DEG)]), 'banked 30 degrees right on 090: the right wing is down, and to the south (+z)');
  for (let k = 0; k < 200; k++) {   // any attitude: a turn, with nothing stretched or mirrored
    const q = attitude(k * 0.7, Math.sin(k) * 1.5, k * 1.3);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-12);
    const [n, r, u] = [NOSE, RIGHT_WING, TOP].map((v) => turned(q, v));
    const cross = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
    assert.ok(near(cross, u.map((x) => -x), 1e-9), 'right-handed still');
  }
});

test('the picture\'s place: 1,000 m north, 2,000 m east and 3,000 ft up is at x 2,000, y 914.4, z -1,000, within 0.01 m, read from a state', () => {
  assert.deepEqual(toPicture([1000, 2000, -914.4]), [2000, 914.4, -1000]);
  const names = STATE.map(([name]) => name), state = new Float64Array(names.length);
  const { lat, lon } = toLatLon(1000, 2000);
  state[names.indexOf('position/lat-geod-rad')] = lat;
  state[names.indexOf('position/long-gc-rad')] = lon;
  state[names.indexOf('position/h-sl-ft')] = 3000;
  state[names.indexOf('attitude/psi-rad')] = 90 * DEG;
  const pose = poseReader(names)(state);
  assert.ok(near(pose.position, [2000, 3000 * FT, -1000], 0.01), `${pose.position}`);
  assert.ok(near(turned(pose.quaternion, NOSE), [1, 0, 0]), 'and its nose to the east');
  assert.throws(() => poseReader(['simulation/sim-time-sec']), /is not in the state/);
});

test('between two states: the position in a straight line, the attitude the short way round at an even rate', () => {
  const a = { position: [0, 100, 0], quaternion: attitude(350 * DEG, 0, 0) }, b = { position: [10, 104, -20], quaternion: attitude(10 * DEG, 0, 20 * DEG) };
  assert.deepEqual(blend(a, b, 0).position, a.position);
  assert.ok(near(blend(a, b, 0.25).position, [2.5, 101, -5]));
  assert.ok(near(blend(a, b, 1).quaternion, b.quaternion, 1e-12) || near(blend(a, b, 1).quaternion, b.quaternion.map((x) => -x), 1e-12));
  // Heading 350 to 010 goes through north, not round by the south; and half way is half the turn.
  const half = turned(blend(a, { ...b, quaternion: attitude(10 * DEG, 0, 0) }, 0.5).quaternion, NOSE);
  assert.ok(near(half, [0, 0, -1], 1e-9), `half way from 350 to 010 is north (${half})`);
  const quarter = turned(blend(a, { ...b, quaternion: attitude(10 * DEG, 0, 0) }, 0.25).quaternion, NOSE);
  assert.ok(Math.abs(Math.atan2(quarter[0], -quarter[2]) / DEG - -5) < 1e-6, 'a quarter of the way is heading 355');
});
