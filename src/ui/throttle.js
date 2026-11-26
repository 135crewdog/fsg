// The throttle: a knob in a groove on the left edge. It stays where it is left.
// After 135crewdog/wings, src/ui/throttle.js, commit 6d689b7 (itself after 135crewdog/rage, src/ui/throttle.js).
// Changed for FSG: Wings' throttle always had a detent at MIL and an afterburner above it. Here that is for
// an airplane that has them (`mil`, the throttle position of MIL power): a finger anywhere in a band around
// the mark gives exactly MIL, so reaching for MIL gets MIL, and the band has to be crossed to light the
// afterburner. An airplane with no afterburner (the Cessna) has a plain throttle: idle at the bottom, full at
// the top, a straight line between, and no caution stripes.

// Places along the track, 0 at the bottom, 1 at the top, for a throttle with a MIL detent.
const DRY = 0.66;    // idle to MIL runs up to here
const MARK = 0.72;   // where the thumb sits at MIL, and where the caution stripes start
const BURNER = 0.8;  // the afterburner starts here and is full at the top

/** A finger's place along the track (0 bottom, 1 top) to a throttle position 0..1. `mil`: MIL's position, or null for none. */
export function throttleFromPosition(place, mil = null) {
  const p = Math.max(0, Math.min(1, place));
  if (mil === null) return p;
  if (p <= DRY) return (p / DRY) * mil;
  if (p <= BURNER) return mil;
  return mil + ((p - BURNER) / (1 - BURNER)) * (1 - mil);
}

/** The other way, for drawing the thumb: at MIL it sits on the mark. */
export function positionFromThrottle(throttle, mil = null) {
  if (mil === null) return Math.max(0, Math.min(1, throttle));
  if (throttle < mil) return (throttle / mil) * DRY;
  if (throttle === mil) return MARK;
  return BURNER + ((throttle - mil) / (1 - mil)) * (1 - BURNER);
}

/** Makes the slider work. onChange(throttle) is called on every change; returns { set(throttle) }. */
export function createThrottle(root, onChange, { mil = null } = {}) {
  const rail = root.querySelector('.rail'), thumb = root.querySelector('.thumb'), stripes = root.querySelector('.ab');
  // The caution stripes run from the knob's place at MIL to the top of the groove; with no afterburner there are none.
  stripes.hidden = mil === null;
  if (mil !== null) stripes.style.bottom = `${MARK * 100}%`;
  let finger = null;
  const set = (throttle) => {
    const value = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
    const place = positionFromThrottle(value, mil);
    thumb.style.top = `${(1 - place) * 100}%`;
    root.classList.toggle('burner', mil !== null && value > mil);
    root.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    onChange(value);
  };
  const follow = (event) => {
    const r = rail.getBoundingClientRect();
    set(throttleFromPosition(1 - (event.clientY - r.top) / r.height, mil));
  };
  root.addEventListener('pointerdown', (event) => {
    if (finger !== null) return;
    finger = event.pointerId;
    root.setPointerCapture(event.pointerId);
    follow(event);
    event.preventDefault();
  });
  root.addEventListener('pointermove', (event) => { if (event.pointerId === finger) follow(event); });
  const lift = (event) => { if (event.pointerId === finger) finger = null; };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);
  return { set };
}
