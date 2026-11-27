// The buffet: how hard the airframe shakes near the stall, a number from 0 (none) to 1 (as hard as it gets), which
// the chase camera shakes the picture with (src/render/camera.js). New in FSG, milestone 3 (docs/milestones/3.md,
// pull request 10), after 135crewdog/wings, commit 6d689b7: its src/sim/aero.js (`buffet`: nothing in ordinary
// flight, rising with the angle of attack to 1 at the stall angle) and its src/flight.js (`BUFFET_FULL`: weaker
// below about 110 knots, so a parked or slow-rolling airplane, whose angle of attack means nothing, does not shake).
//
// It is worked out from the state the game already has (the angle of attack, the speed and the flaps), not from
// JSBSim: JSBSim knows nothing of buffet, and the shake is a picture of the airplane, not a force on it. Plain sums
// with no browser code, so the tests hold the band headless (tests/f4c-edge.test.js), and the page works it out
// each frame from the newest state (src/flight.js). The band is each aircraft's own (`buffet` in its settings).

/** Below this calibrated airspeed the shake fades, with the square of the speed: Wings' 2,000 Pa of dynamic pressure. */
export const BUFFET_FULL_KT = 111;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * The buffet, 0 to 1, for an aircraft's band (`aircraft.buffet`; none, none at all): at `alphaDeg` of angle of
 * attack, `knots` calibrated, with the flaps at `flaps` (0 up to 1 fully down). The band is
 *   onsetDeg      where the shake begins, flaps up
 *   fullDeg       where it is full: the stall angle
 *   flapsOnsetDeg where it begins with the flaps at `flapsAt` or further down; between up and there, in proportion
 *   flapsAt       the flap position from which the flapped band holds
 * Rising in a straight line from the onset to full, and full beyond it, as Wings' did.
 */
export function buffetOf(band, alphaDeg, knots, flaps = 0) {
  if (!band || !(knots > 0)) return 0;
  const share = band.flapsAt ? clamp01(flaps / band.flapsAt) : 0;
  const onset = band.onsetDeg + share * ((band.flapsOnsetDeg ?? band.onsetDeg) - band.onsetDeg);
  const rise = clamp01((Math.abs(alphaDeg) - onset) / (band.fullDeg - onset));
  return rise * Math.min(1, (knots / BUFFET_FULL_KT) ** 2);
}
