// The picture's clock: which moment of the flight to draw, when the physics runs in a Worker and its states
// arrive at their own pace. New in FSG, milestone 2 (docs/milestones/2.md, "The picture between physics steps").
//
// After WebFlight's pose-smoother (github.com/rtnicolae/WebFlight, apps/web/src/pose-smoother.ts), which is
// Glenn Fiedler's snapshot interpolation: the page keeps the last states, a clock trails the newest one, and
// the picture is blended between the two states either side of that clock. Drawing the newest state alone
// puts every frame up to a whole step out, and the chase camera shakes the world with it.
//
// Two departures from WebFlight, each for a reason the plan gives:
//   - the easing is worked out after the clock has moved on by the frame's time, not before. Before, the
//     clock settles a frame ahead of where it is meant to be, and at 30 frames a second (Low Power Mode) it
//     sits on the newest state;
//   - the clock trails by two steps, not 25 ms: enough on the owner's phone, and the hands feel the rest.
//
// Four rules, each with a test (tests/picture.test.js): never ahead of the newest state; never backwards;
// more than 50 ms behind where it should be, it jumps forward; while the game is held, it stands still.
// And from a standstill (a new flight, or the game let go) it waits for the states to get two steps ahead
// before it moves, so that it starts with its trail and never sits on the newest state.
//
// No DOM and no Three.js: times are the flight's own seconds (the state's sim time), and a state is whatever
// the caller hands in.

/** How far the picture trails the newest state: two physics steps, in seconds. */
export const TRAIL = 2 / 120;
/** How fast the clock is eased back to that distance: this share of the error each second. */
export const EASE = 2;
/** Further behind than this (seconds), the clock jumps instead of easing. */
export const JUMP = 0.05;
const KEEP = 64;   // states kept: half a second of them

export function createBetween() {
  let states = [], time = null, held = false, moving = false;
  return {
    /** A new flight: everything known about the one before is dropped. */
    reset() {
      states = [];
      time = null;
      held = moving = false;
    },
    /** The newest state has arrived: `seconds` is its own time in the flight. An older one than the newest is dropped. */
    push(seconds, state) {
      if (states.length && seconds <= states.at(-1).seconds) return;
      states.push({ seconds, state });
      if (states.length > KEEP) states.shift();
      if (time === null) time = seconds;   // the first state: there is nothing earlier to show
    },
    /** The game is held (the pause screen), or let go. Held, the clock stands still. */
    hold(on) {
      held = on;
      moving = false;
    },
    /** A frame is about to be drawn, `dt` seconds after the last one. Returns the picture's time. */
    advance(dt) {
      if (time === null || held) return time;
      const newest = states.at(-1).seconds, was = time;
      if (!moving) {
        if (newest - time < TRAIL) return time;   // from a standstill: wait for the trail
        moving = true;
      }
      time += Math.max(dt, 0);
      const error = newest - TRAIL - time;
      time += error > JUMP ? error : error * Math.min(1, dt * EASE);
      time = Math.max(was, Math.min(time, newest));   // never ahead of the newest state, never backwards
      return time;
    },
    /** The picture's time, and the newest state's. Null before the first state. */
    get time() { return time; },
    get newest() { return states.length ? states.at(-1) : null; },
    /**
     * The two states either side of the picture's time and how far between them it is:
     * { before, after, fraction }, or null before the first state. Where there is nothing earlier
     * (a flight's first frames), both are the oldest state kept.
     */
    sample() {
      if (time === null) return null;
      let i = states.length - 1;
      while (i > 0 && states[i - 1].seconds >= time) i--;
      const after = states[i], before = i > 0 && after.seconds > time ? states[i - 1] : after;
      const span = after.seconds - before.seconds;
      return { before: before.state, after: after.state, fraction: span > 0 ? Math.min(1, Math.max(0, (time - before.seconds) / span)) : 0 };
    },
  };
}
