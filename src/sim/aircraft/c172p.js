// The game's settings for JSBSim's bundled Cessna 172P (`c172p`): the Cessna on screen in milestone 2, flown
// as upstream ships it. New in FSG, milestone 2 (docs/milestones/2.md), after c172x.js.
//
// Why this Cessna and not `c172x` (the plan has the numbers): its elevator has no free play, so it comes back
// to its trimmed speed; a pilot can steer its nosewheel; and FlightGear's own model of it, the picture in
// models/c172p.glb, has its wheels where this file has its gear.
import { WINGS_CRASH_FPM } from '../rules.js';

const DEG = Math.PI / 180;

export const C172P = {
  /** JSBSim's name for it: aircraft/c172p/c172p.xml. */
  model: 'c172p',
  /** The files JSBSim reads to load it, relative to jsbsim/jsbsim-data/. tests/c172p.test.js shows each is needed. */
  files: [
    'aircraft/c172p/c172p.xml',
    'engine/eng_io320.xml',
    'engine/prop_75in2f.xml',
  ],
  /** Height of its centre of gravity above the ground when it stands on its wheels, ft (read back from a parked flight). */
  standingFt: 4.356,
  /** How far its nose is up as it stands there, degrees (read back the same way). The picture parks it by these two until a flight is running. */
  standingPitchDeg: 2.28,
  /** Its picture: a model built to docs/models.md, as the app's page finds it (models/CREDITS.md says whose it is). */
  glb: './models/c172p.glb',
  /**
   * Which JSBSim command each of the game's seven controls drives (as in c172x.js). The gear is fixed and
   * there is no speedbrake: those two drive nothing, and the app shows no button for them.
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
   * Its flap settings, from up to fully down (milestone 3, PR F: docs/milestones/3.md). `at` is the flaps
   * control that selects the setting, 0 to 1; `reads` is what the indicator says, the airplane's own way: a
   * Cessna's indicator is in degrees. `takeoff` is which setting every flight starts at: 10 degrees.
   * The aircraft file's flaps have a stop at 0, 10, 20 and 30 degrees, and its command runs 0 to 1 over the
   * 30 (c172p.xml, "Flaps Control"). tests/flaps.test.js reads back that each `at` puts them there.
   */
  flaps: {
    settings: [{ at: 0, reads: '0°' }, { at: 1 / 3, reads: '10°' }, { at: 2 / 3, reads: '20°' }, { at: 1, reads: '30°' }],
    takeoff: 1,
  },
  /**
   * The game's assists (src/sim/assists.js).
   *   trim   Neutral speed 100 knots: JSBSim's own pitch and roll trim for level flight at 100 knots and
   *          2,000 ft, set once. tests/c172p.test.js re-derives them.
   *   feet   The game's: this file has no yaw damper. JSBSim's rudder command is positive nose left.
   *   steer  The copilot's feet on the ground (milestone 3, PR 2; docs/milestones/3.md has what was flown).
   *          The tilt is always the ailerons. The nosewheel turns the airplane as the tilt asks, its share
   *          falling smoothly with speed: a half at 28 knots, 9% at 60. The rudder is the copilot's alone:
   *          it holds the nose against any swing the tilt did not ask for, which is what keeps this Cessna
   *          straight against its engine at full power. No wheel brakes are used to steer.
   *            wheel.halfAtKt, power  the nosewheel's curve (src/sim/assists.js `wheelShare`)
   *            hold.turnRadPerSec     the gentle turn full tilt asks for once the nosewheel has let go: 4 degrees a second
   *            hold.follow            how much of the turn its angle promises the nosewheel really makes (tyres slip)
   *            hold.wheelbaseFt       nosewheel to main wheels, 65 in (the aircraft file's gear)
   *            hold.rate, heading     how firmly the feet oppose an unasked swing, and the heading it has drifted
   *            hold.forgetSeconds     how slowly that heading is forgotten
   */
  assists: {
    trim: { knots: 100, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', 0.1873], ['fcs/roll-trim-cmd-norm', 0.0331]] },
    feet: { to: 'fcs/rudder-cmd-norm', sign: -1 },
    steer: {
      wheel: { to: 'fcs/steer-cmd-norm', sign: 1, halfAtKt: 28, power: 3 },
      hold: { turnRadPerSec: 4 * DEG, follow: 0.65, wheelbaseFt: 65 / 12, rate: 6, heading: 40, forgetSeconds: 10 },
    },
  },
  /** A name for each wheel and airframe contact point, in the aircraft file's order (tests/c172p.test.js checks it against the file). */
  contacts: ['nose wheel', 'left main wheel', 'right main wheel', 'nose skid', 'tail skid', 'left wingtip', 'right wingtip'],
  /** The crash line: closing with the ground faster than this at a touch is a hard impact. Wings' 8 m/s. */
  crash: { closingFpm: WINGS_CRASH_FPM },
  /** Limits, reported and not enforced: 3.8 g and about 160 knots, as for c172x (from memory; not checked against a handbook). */
  limits: { g: 3.8, knots: 160 },
  /**
   * The model's moving parts (src/render/surfaces.js): for each motion of docs/models.md, the number of the
   * state that drives it, and that number's values where the motion is at 0, at 0.5 and at 1. The angles are
   * this aircraft file's own full travel, in radians: elevator 28 degrees up and 23 down, the left aileron
   * 20 up and 15 down, the rudder 16 each way. JSBSim counts trailing edge down as positive, and the rudder's
   * trailing edge left. tests/c172p.test.js moves each control and reads the motion.
   */
  surfaces: {
    flaps: { from: 'fcs/flap-pos-norm', at: [0, 0.5, 1] },
    elevator: { from: 'fcs/elevator-pos-rad', at: [23 * DEG, 0, -28 * DEG] },
    aileron: { from: 'fcs/left-aileron-pos-rad', at: [-20 * DEG, 0, 15 * DEG] },
    rudder: { from: 'fcs/rudder-pos-rad', at: [16 * DEG, 0, -16 * DEG] },
  },
  /** The propeller's speed, for the picture: a JSBSim number sent beside every state (src/sim/flight-run.js). */
  propellerRpm: 'propulsion/engine[0]/propeller-rpm',
};
