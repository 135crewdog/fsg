// The Worker's own clock: a short timer that hands real time to the fixed-step loop (loop.js), so the
// physics keeps 120 steps a second whatever the screen is doing. New in FSG, milestone 1.
//
// How others do it (docs/milestones/1.md, "The Worker's clock"): WebFlight paces JSBSim in its Worker with a
// 2 ms timer and counts the steps due from the Worker's own clock; FlightDynamicsLab uses a 4 ms timer with
// the same accumulator. WebKit does not slow timers inside a Worker, as it does the page's in Low Power Mode.
// The timer only says "look at the clock now": how many steps run comes from the time, not from how often
// or how evenly the timer fires.
//
// Nothing here knows what a Worker is. The time and the timer are handed in, so tests run it with made-up ones.

/** How often the Worker looks at its clock, in milliseconds. A step is 8.3 ms; WebKit's floor for a repeating Worker timer is 4. */
export const CLOCK_PERIOD_MS = 4;

/**
 * Starts the clock.
 *   loop      a FixedStepLoop
 *   now       () => seconds, from any clock that only goes forward
 *   every     (fn, milliseconds) => handle: calls fn again and again (setInterval)
 *   cancel    (handle) => void (clearInterval)
 *   onFire    optional, called after every firing with (steps run by it, the time it read)
 * Returns { stop(), fires }.
 */
export function startClock({ loop, now, every, cancel, periodMs = CLOCK_PERIOD_MS, onFire }) {
  let handle = null;
  const clock = {
    /** Firings so far. */
    fires: 0,
    stop() {
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
  handle = every(() => {
    if (handle === null) return;   // stopped, and the timer fired once more
    clock.fires++;
    const t = now();
    const steps = loop.advance(t);
    if (onFire) onFire(steps, t);
  }, periodMs);
  return clock;
}
