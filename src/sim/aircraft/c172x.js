// The game's settings for JSBSim's bundled Cessna 172 (`c172x`): a test aircraft, flown as upstream ships it.
// New in FSG, milestone 1. Everything here is about the game; the airplane itself is JSBSim's file.
import { WINGS_CRASH_FPM } from '../rules.js';

export const C172X = {
  /** JSBSim's name for it: aircraft/c172x/c172x.xml. */
  model: 'c172x',
  /** The files JSBSim reads to load it, relative to jsbsim/jsbsim-data/. tests/flight.test.js shows each is needed. */
  files: [
    'aircraft/c172x/c172x.xml',
    'aircraft/c172x/c172ap.xml',
    'engine/eng_io320.xml',
    'engine/prop_75in2f.xml',
    'systems/GNCUtilities.xml',
    'systems/Autopilot.xml',
  ],
  /** Height of JSBSim's reference point above the ground when it stands on its wheels, ft (upstream's reset00.xml). */
  standingFt: 4.305,
  /**
   * Which JSBSim command each of the game's seven controls drives. The stick is -1 to 1 (pitch: back is
   * positive, as in Wings), the throttle 0 to 1, the four toggles off or on. A control the airplane does not
   * have drives nothing: the Cessna's gear is fixed and it has no speedbrake.
   */
  controls: {
    pitch: { to: ['fcs/elevator-cmd-norm'], sign: -1 },   // JSBSim: positive is nose down
    roll: { to: ['fcs/aileron-cmd-norm'], sign: 1 },
    throttle: { to: ['fcs/throttle-cmd-norm'] },
    gear: { to: [] },
    flaps: { to: ['fcs/flap-cmd-norm'] },
    speedbrake: { to: [] },
    brake: { to: ['fcs/left-brake-cmd-norm', 'fcs/right-brake-cmd-norm'] },
  },
  /**
   * The game's assists (src/sim/assists.js).
   *   trim   Neutral speed 100 knots: JSBSim's own pitch and roll trim for level flight at 100 knots and
   *          2,000 ft, set once. tests/assists.test.js re-derives them. (The roll trim holds the wings level
   *          against the engine's torque at that power.)
   *   feet   The game's: this file has no yaw damper. JSBSim's rudder command is positive nose left.
   *   steer  Upstream's file gives a pilot no nosewheel steering: its autopilot system writes the steering
   *          command every step (systems/Autopilot.xml, `ap/roll-command-selector-steering`), zero unless the
   *          autopilot is flying. So on the ground the stick works the rudder, and below 30 knots the wheel
   *          brake on the inside of the turn, at half strength at a standstill: how a pilot steers an
   *          airplane whose nosewheel only casters.
   */
  assists: {
    trim: { knots: 100, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', 0.2187], ['fcs/roll-trim-cmd-norm', -0.0749]] },
    feet: { to: 'fcs/rudder-cmd-norm', sign: -1 },
    steer: {
      rudder: { to: 'fcs/rudder-cmd-norm', sign: -1 },
      brakes: { left: 'fcs/left-brake-cmd-norm', right: 'fcs/right-brake-cmd-norm', strength: 0.5, untilKt: 30 },
    },
  },
  /** A name for each wheel and airframe contact point, in the aircraft file's order (tests/rules.test.js checks it against the file). */
  contacts: ['nose wheel', 'left main wheel', 'right main wheel', 'tail skid', 'left wingtip', 'right wingtip'],
  /** The crash line: closing with the ground faster than this at a touch is a hard impact. Wings' 8 m/s. */
  crash: { closingFpm: WINGS_CRASH_FPM },
  /** Limits, reported and not enforced: 3.8 g and about 160 knots, a Cessna 172's handbook figures (from memory; not checked against a handbook). */
  limits: { g: 3.8, knots: 160 },
};
