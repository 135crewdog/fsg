// The game's assists: what a helpful copilot does with the controls so the airplane is easy to fly from a
// tilted phone. In the owner's words (CLAUDE.md, "Controls and assists"): the pilot is the player, this file
// is the copilot, and an airplane's own systems (its FCS, in its aircraft file) are not. New in FSG, milestone 1 (docs/milestones/1.md, "Automatic feet and nosewheel steering" and
// "Phone at neutral = a trimmed speed").
//
// They act only through the controls a pilot has: pitch and roll trim, the rudder, the nosewheel steering and
// the two wheel brakes. They add no force and change nothing in the aircraft file. Every number they write
// goes through the flight's one input array, so it is on the tape.
//
//   Neutral trim     set once: JSBSim's own pitch and roll trim for the aircraft's neutral speed, never moved.
//                    Phone neutral is then stick neutral, and the lean of the phone is the trim control.
//   Automatic feet   Wings' law (135crewdog/wings, src/sim/sim.js `coordinate`, commit 557a8d0): rudder against
//                    the sideslip and against where the sideslip is going a second ahead. An aircraft whose
//                    own systems do this (the F-16's flight computer) is left to them, as X-Plane does.
//   Steering         on the ground the roll stick steers: the nosewheel where a pilot can steer it, and the
//                    rudder and the wheel brake on the inside of the turn where he cannot (see c172x.js).
//   The copilot's feet on the ground (milestone 3, docs/milestones/3.md, PR 2; an aircraft's `steer.hold`
//                    chooses it): two jobs, three controls. The ailerons are always the pilot's tilt. The
//                    nosewheel turns the airplane as the tilt asks, less and less with speed, on one smooth
//                    curve. The rudder is the copilot's alone: it never takes the stick directly; it holds the
//                    nose against any swing the tilt did not ask for (the engine's pull), more and more as the
//                    nosewheel's share falls. After X-Plane 12's automatic rudder for pilots with no pedals,
//                    which holds the track on the ground (developer.x-plane.com, "Rudder auto-coordination").
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const KT = 1.6878;   // ft/s in a knot
const G = 32.174;    // ft/s2

/** Wings' feet, in Wings' numbers. */
export const FEET = {
  fullRudderSlipRad: (12 * Math.PI) / 180,   // sideslip that calls for full rudder
  leadSeconds: 1,                            // the feet act on where the sideslip will be this far ahead
  slowestFps: 30 / 0.3048,                   // below this speed the sideslip's rate is worked out as if at it
  // A departure from Wings: below 20 knots the feet do nothing, and they are fully in by 40. JSBSim's sideslip
  // is the angle of whatever small velocity a standing airplane has, so it means nothing until there is airflow.
  fromKt: 20,
  fullKt: 40,
};

/**
 * The rudder a pilot's feet would hold, -1 to 1, right rudder positive. `air` has beta, alpha, bank and pitch
 * in radians, p and r in rad/s, and vtrueFps. The sideslip's rate is known without waiting to see it: the nose
 * slips when the airplane rolls at an angle of attack, when it yaws, and when gravity pulls it sideways in a bank.
 */
export function wingsFeet(air) {
  const slipRate = air.p * Math.sin(air.alpha) - air.r * Math.cos(air.alpha) + (G * Math.sin(air.bank) * Math.cos(air.pitch)) / Math.max(air.vtrueFps, FEET.slowestFps);
  return clamp((air.beta + FEET.leadSeconds * slipRate) / FEET.fullRudderSlipRad, -1, 1);
}

/** Wings' steering fade: at this ground speed the nosewheel steering is down to half (15 m/s). */
export const STEER_HALF_KT = 15 / 0.3048 / KT;

/**
 * The nosewheel's share of the tilt at a ground speed: 1 standing still, a half at `halfAtKt`, falling on a
 * smooth curve with no step. `power` 2 is Wings' curve; 3 keeps more of the steering at a taxi and lets go
 * sooner after. No `halfAtKt`: the aircraft file fades its own steering, and the share is always 1.
 */
export const wheelShare = (groundKt, { halfAtKt = 0, power = 2 } = {}) => (halfAtKt ? 1 / (1 + (groundKt / halfAtKt) ** power) : 1);

/**
 * The turn the tilt asks of the copilot's feet, rad/s, nose right positive. `hold` is the aircraft's
 * `steer.hold`; `share` the nosewheel's share now; `stick` the roll stick; `wheelRad` the nosewheel's angle
 * and `groundFps` the speed. Two parts, mixed by the share: the turn the nosewheel's own angle makes at this
 * speed (a wheel that slips makes less: `follow`), and, as the nosewheel lets go, a gentle turn for the tilt.
 */
export function askedTurn(hold, share, stick, wheelRad, groundFps) {
  return hold.follow * share * (groundFps * Math.tan(wheelRad)) / hold.wheelbaseFt + (1 - share) * hold.turnRadPerSec * stick;
}

/** Every JSBSim command an aircraft's assists write, by name. */
export function assistWrites(settings) {
  const names = [];
  if (settings.trim) for (const [name] of settings.trim.sets) names.push(name);
  if (settings.feet) names.push(settings.feet.to);
  if (settings.steer?.rudder) names.push(settings.steer.rudder.to);
  if (settings.steer?.wheel) names.push(settings.steer.wheel.to);
  if (settings.steer?.brakes) names.push(settings.steer.brakes.left, settings.steer.brakes.right);
  return [...new Set(names)];
}

/**
 * One flight's assists. `settings` is the aircraft's `assists` (src/sim/aircraft/); `stateAt` and `inputAt`
 * give where a JSBSim name is in the flight's state and input arrays; `wheels` is where each wheel's
 * "on the ground" number is in the state.
 */
export class Assists {
  #s;
  #in;
  #wheels;
  #settings;
  #feet;
  #air = { beta: 0, alpha: 0, bank: 0, pitch: 0, p: 0, r: 0, vtrueFps: 0, roll: 0 };
  #dt;
  /** How far the nose has swung, unasked, on the ground (rad), forgotten slowly: the copilot's sense of the heading it is holding. */
  #drift = 0;

  constructor(settings, stateAt, inputAt, wheels, dt = 1 / 120) {
    this.#dt = dt;
    this.#settings = settings;
    this.#wheels = wheels;
    this.#feet = settings.feet ? settings.feet.law ?? wingsFeet : null;
    const state = (name) => stateAt(name);
    this.#s = {
      beta: state('aero/beta-rad'), alpha: state('aero/alpha-rad'), bank: state('attitude/phi-rad'), pitch: state('attitude/theta-rad'),
      p: state('velocities/p-rad_sec'), r: state('velocities/r-rad_sec'), vtrue: state('velocities/vtrue-kts'), vc: state('velocities/vc-kts'), vg: state('velocities/vg-fps'),
      wheel: state('fcs/steer-pos-deg'),
    };
    const { steer = {} } = settings;
    this.#in = {
      trim: (settings.trim?.sets ?? []).map(([name, value]) => [inputAt(name), value]),
      rudder: settings.feet ? inputAt(settings.feet.to) : steer.rudder ? inputAt(steer.rudder.to) : -1,
      wheel: steer.wheel ? inputAt(steer.wheel.to) : -1,
      left: steer.brakes ? inputAt(steer.brakes.left) : -1,
      right: steer.brakes ? inputAt(steer.brakes.right) : -1,
    };
  }

  /** The values the assists hold from before JSBSim's first step, as [name, value] pairs: the trim. */
  get startSets() {
    return (this.#settings.trim?.sets ?? []).map(([name, value]) => [name, value]);
  }

  /**
   * Writes the assists' commands into `inputs`, from the state after the last step and the roll stick.
   * The controls' own commands are already there; only the wheel brakes are shared, and the assists never
   * take a brake off: each gets the larger of what the brakes toggle and the steering ask.
   */
  apply(state, controls, inputs) {
    const s = this.#s, at = this.#in, { feet, steer = {} } = this.#settings;
    for (const [i, value] of at.trim) inputs[i] = value;

    let onGround = false;
    for (const i of this.#wheels) if (state[i] === 1) { onGround = true; break; }
    const stick = controls.roll, groundKt = state[s.vg] / KT;
    const share = steer.wheel ? wheelShare(groundKt, steer.wheel) : 0, hold = steer.hold;

    if (at.rudder >= 0) {
      let rudder = 0;   // right rudder positive
      if (this.#feet) {
        const air = this.#air;
        air.beta = state[s.beta]; air.alpha = state[s.alpha]; air.bank = state[s.bank]; air.pitch = state[s.pitch];
        air.p = state[s.p]; air.r = state[s.r]; air.vtrueFps = state[s.vtrue] * KT; air.roll = stick;
        let held = 0;
        if (hold && onGround) {
          // The swing nobody asked for: the yaw rate, less the turn the tilt is asking for. The feet's own
          // law sees only that (it must not push against an asked-for turn), and so does the hold.
          const swing = air.r - askedTurn(hold, share, stick, (steer.wheel.sign * state[s.wheel] * Math.PI) / 180, state[s.vg]);
          air.r = swing;
          this.#drift += (swing - this.#drift / hold.forgetSeconds) * this.#dt;
          held = -((1 - share) ** 2) * (hold.rate * swing + hold.heading * this.#drift);
        } else this.#drift = 0;
        rudder = this.#feet(air) * clamp((state[s.vc] - FEET.fromKt) / (FEET.fullKt - FEET.fromKt), 0, 1) + held;
      }
      if (onGround && steer.rudder) rudder += stick;
      inputs[at.rudder] = (feet ?? steer.rudder).sign * clamp(rudder, -1, 1);
    }
    if (at.wheel >= 0) inputs[at.wheel] = onGround ? steer.wheel.sign * stick * share : 0;
    if (at.left >= 0 && onGround) {
      const ask = steer.brakes.strength * clamp(1 - groundKt / steer.brakes.untilKt, 0, 1);
      inputs[at.left] = Math.max(inputs[at.left], ask * clamp(-stick, 0, 1));
      inputs[at.right] = Math.max(inputs[at.right], ask * clamp(stick, 0, 1));
    }
  }
}
