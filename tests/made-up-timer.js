// For tests of the Worker's clock: no real clock is read, so the numbers are exact and the same on every machine.

/** A made-up clock that ticks in whole milliseconds, like the phone's, and a timer that fires when told to. */
export function madeUpTimer(startMs = 5000) {
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
