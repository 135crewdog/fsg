// The game's settings for JSBSim's bundled Cessna 172P (`c172p`): the Cessna on screen in milestone 2, flown
// as upstream ships it. New in FSG, milestone 2 (docs/milestones/2.md), after c172x.js.
//
// Why this Cessna and not `c172x` (the plan has the numbers): its elevator has no free play, so it comes back
// to its trimmed speed; a pilot can steer its nosewheel; and FlightGear's own model of it, the picture in
// models/c172p.glb, has its wheels where this file has its gear.
import { STEER_HALF_KT } from '../assists.js';
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
   * The game's assists (src/sim/assists.js).
   *   trim   Neutral speed 100 knots: JSBSim's own pitch and roll trim for level flight at 100 knots and
   *          2,000 ft, set once. tests/c172p.test.js re-derives them.
   *   feet   The game's: this file has no yaw damper. JSBSim's rudder command is positive nose left.
   *   steer  On the ground the stick works the rudder and the nosewheel together, as a Cessna's pedals do.
   *          The nosewheel's share fades with speed (Wings' fade: half at 29 knots), so it does not twitch
   *          on the takeoff roll. No wheel brakes are used to steer: this nosewheel is the pilot's.
   */
  assists: {
    trim: { knots: 100, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', 0.1873], ['fcs/roll-trim-cmd-norm', 0.0331]] },
    feet: { to: 'fcs/rudder-cmd-norm', sign: -1 },
    steer: {
      rudder: { to: 'fcs/rudder-cmd-norm', sign: -1 },
      wheel: { to: 'fcs/steer-cmd-norm', sign: 1, halfAtKt: STEER_HALF_KT },
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
