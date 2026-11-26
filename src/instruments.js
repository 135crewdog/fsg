// What the HUD reads off the airplane, from a JSBSim state. New in FSG, milestone 2 (pull request 6), in the
// place of Wings' `instruments` (135crewdog/wings, src/sim/airdata.js, commit 6d689b7), which read Wings' own
// flight model: the same readings under the same names, so Wings' HUD is drawn from them unchanged.
// Plain sums, no browser code.

const DEG = Math.PI / 180;

/** The VSI's light smoothing, seconds: Wings' (src/sim/sim.js, VSI_SECONDS). No built-in lag, just enough to keep it from flickering. */
export const VSI_SECONDS = 0.5;

/**
 * Returns read(state) for a flight whose state has `stateNames` (src/sim/game.js, STATE). The readings:
 * knots (calibrated), feet above sea level and above the ground, both at the wheels (`standingFt` is how high
 * the centre of gravity stands above them); heading, pitch and roll (degrees; heading true, 0 to 360); g; angle
 * of attack (degrees); Mach; climb (ft/min, up positive, as JSBSim has it this instant); power (the engine's
 * power lever, 0 to 1, 2 in afterburner); and three unit directions in north, east, down: where the airplane
 * is going (`velocity`; its nose while it stands still), where its nose points, and its own up.
 */
export function instrumentReader(stateNames, standingFt = 0) {
  const at = (name) => {
    const i = stateNames.indexOf(name);
    if (i < 0) throw new Error(`the state has no ${name}`);
    return i;
  };
  const i = {
    feet: at('position/h-sl-ft'), agl: at('position/h-agl-ft'), roll: at('attitude/phi-rad'), pitch: at('attitude/theta-rad'), heading: at('attitude/psi-rad'),
    vn: at('velocities/v-north-fps'), ve: at('velocities/v-east-fps'), vd: at('velocities/v-down-fps'), knots: at('velocities/vc-kts'), mach: at('velocities/mach'),
    alpha: at('aero/alpha-rad'), g: at('accelerations/Nz'), power: at('fcs/throttle-pos-norm'),
  };
  return (s) => {
    const f = s[i.roll], t = s[i.pitch], h = s[i.heading];
    const nose = [Math.cos(t) * Math.cos(h), Math.cos(t) * Math.sin(h), -Math.sin(t)];
    // The airplane's own up: its body's -z axis, turned by heading, pitch and roll into north, east, down.
    const up = [
      -(Math.cos(f) * Math.sin(t) * Math.cos(h) + Math.sin(f) * Math.sin(h)),
      -(Math.cos(f) * Math.sin(t) * Math.sin(h) - Math.sin(f) * Math.cos(h)),
      -Math.cos(f) * Math.cos(t),
    ];
    const speed = Math.hypot(s[i.vn], s[i.ve], s[i.vd]);   // ft/s
    return {
      knots: s[i.knots], feet: s[i.feet] - standingFt, aboveGround: s[i.agl] - standingFt,
      heading: h / DEG, pitch: t / DEG, roll: f / DEG,
      g: s[i.g], alpha: s[i.alpha] / DEG, mach: s[i.mach], climb: -s[i.vd] * 60, power: s[i.power],
      velocity: speed > 3 ? [s[i.vn] / speed, s[i.ve] / speed, s[i.vd] / speed] : nose,
      nose, up,
    };
  };
}

/**
 * The VSI's needle: follows the climb rate with VSI_SECONDS of smoothing. set(fpm) puts it there at once (a
 * new flight); toward(fpm, seconds) moves it on by that much time and returns where it is.
 */
export function createVsi() {
  let shown = 0;
  return {
    get value() { return shown; },
    set(fpm) { shown = fpm; },
    toward(fpm, seconds) {
      shown += (fpm - shown) * (1 - Math.exp(-Math.max(0, seconds) / VSI_SECONDS));
      return shown;
    },
  };
}
