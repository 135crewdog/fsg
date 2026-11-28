// The game's settings for the simple F-4C Phantom II (aircraft/f4c-simple/f4c-simple.xml): a file of numbers on
// the shared simple physics and control run (aircraft/simple/). New in FSG, milestone 3 re-planned
// (docs/milestones/3-replan.md, pull request 3), after f4c.js, the data-built F-4C's, which it borrows from
// wherever the two airplanes are the same: the picture, the buttons, the plumes, the limits, the contact points.
//
// Headless for now: it is not in the app, the picker, the service worker's list or the Worker's until pull
// request 4, which also gives it tilt steering on the ground and the straight stick.
import { F4C } from './f4c.js';

const DEG = Math.PI / 180;

export const F4C_SIMPLE = {
  /** JSBSim's name for it: aircraft/f4c-simple/f4c-simple.xml. */
  model: 'f4c-simple',
  /** FSG's own: its files are in the repo's aircraft/ folder (see f4c.js). */
  own: true,
  /**
   * JSBSim's second-order stepping of rotations, as the data-built F-4C has and for its reason (f4c.js): at 120
   * steps a second JSBSim's default takes damping off a quick swing. Checked once for this airplane
   * (tests/simple-f4c.test.js reports a pitch step high and fast on both rules).
   */
  stepping: F4C.stepping,
  /**
   * The files JSBSim reads to load it, relative to the repo's root: its own file of numbers and its engine, and
   * the two shared files every simple airplane flies on. tests/simple-f4c.test.js shows each is needed.
   */
  files: [
    'aircraft/f4c-simple/f4c-simple.xml',
    'aircraft/f4c-simple/Engines/J79.xml',
    'aircraft/f4c-simple/Engines/direct.xml',
    'aircraft/simple/aero.xml',
    'aircraft/simple/controls.xml',
  ],
  /** Its picture: the owner's own model, the same one the data-built F-4C wears. */
  glb: F4C.glb,
  /** Height of its centre of gravity above the ground when it stands on its wheels, ft (read back from a parked flight; the wheels are the data-built jet's). */
  standingFt: 6.403,
  /** How far its nose is up as it stands there, degrees (read back the same way): level, but for what the nose leg gives under the idle thrust. */
  standingPitchDeg: -0.06,
  /**
   * Which JSBSim command each of the game's seven controls drives: the same as the data-built F-4C's. But the
   * pitch stick here is a position, not a pull in pounds: the shared control run adds it to the trim and moves
   * the stabilator through one curve against speed (aircraft/simple/controls.xml).
   */
  controls: F4C.controls,
  /** Its flap settings, Up, 1/2 and Full, starting at 1/2: the data-built F-4C's (the flight manual's switch). */
  flaps: F4C.flaps,
  /** Where MIL is on the game's throttle. The aircraft file's throttle system has the same number (fcs/mil-throttle-norm); tests/simple-f4c.test.js holds the two together. */
  mil: F4C.mil,
  /** A jet: the HUD shows its power as a jet's. */
  jet: true,
  /**
   * The copilot (src/sim/assists.js). On a simple airplane it only coordinates the rudder (the owner, 28
   * November 2026: "The copilot helps only with what the pilot has no control for").
   *   trim   Held at zero: the copilot does no trimming. The trim speed is the airplane's rigging, a number in
   *          its file (simple/trim-speed-kt, 350 knots): with the stick at neutral the stabilator is at zero and
   *          the nose settles at the angle of attack that holds 350 knots. `knots` and `heightFt` say where
   *          that is checked (tests/simple-f4c.test.js flies it hands off for a minute).
   *   feet   Wings' feet (src/sim/assists.js, wingsFeet): the rudder against sideslip, and the nose's swing
   *          damped. JSBSim's rudder command is positive nose left.
   *   steer  The data-built F-4C's steering on the ground, for now: pull request 4 replaces it with tilt
   *          steering in the shared control run.
   */
  assists: {
    trim: { knots: 350, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', 0]] },
    feet: F4C.assists.feet,
    steer: F4C.assists.steer,
  },
  /**
   * The buffet the chase camera shakes with near the stall (src/sim/buffet.js), by the angle of attack, set the
   * way the data-built F-4C's band is (f4c.js: the flight manual's "Onset of buffet normally occurs approximately
   * 40 knots before the stall"), for this airplane's own stall:
   *   fullDeg    21.7: its stall angle (the aircraft file's stall speed and lift slope; tests/simple-f4c.test.js
   *              reads it back from JSBSim)
   *   onsetDeg   13.3: the angle of attack at 185 knots in level flight, 40 knots above its 145 knot stall: lift
   *              goes as the speed squared, so 21.7 x (145 / 185) squared
   *   flaps      as the data-built jet (the flight manual: "virtually no increase in airframe buffet during stall
   *              approaches" with the flaps down): with the flaps at 1/2 or more the shake begins only 2 degrees
   *              before the stall, so an approach does not shake all the way down
   */
  buffet: { onsetDeg: 13.3, fullDeg: 21.7, flapsOnsetDeg: 19.7, flapsAt: 0.5 },
  /** A name for each wheel and airframe contact point, in the aircraft file's order: the data-built F-4C's, whose points these are. */
  contacts: F4C.contacts,
  /** The crash line: Wings' 8 m/s. */
  crash: F4C.crash,
  /** Limits, reported and not enforced: the flight manual's, as the data-built F-4C has them (f4c.js). */
  limits: F4C.limits,
  /**
   * The model's moving parts (src/render/surfaces.js), as f4c.js has them, each from JSBSim's own position of the
   * part as the shared control run leaves it:
   *   elevator    the stabilator, 9 degrees trailing edge down to 21 up: the aircraft file's travel and the model's
   *   aileron     the left aileron less the right. The control run writes an ordinary pair, one 30 degrees down
   *               and the other 30 up at full travel, so the difference runs to 60 degrees each way; the model's
   *               one motion shows it as the real jet's aileron down on one wing and spoiler up on the other
   *   rudder      30 degrees each way; JSBSim counts its trailing edge left as positive
   *   flaps, gear, speedbrake   their positions
   */
  surfaces: {
    ...F4C.surfaces,
    aileron: { from: 'fcs/left-aileron-pos-rad', minus: 'fcs/right-aileron-pos-rad', at: [-60 * DEG, 0, 60 * DEG] },
  },
  /** The engines' numbers sent beside every state: each engine's thrust and what its afterburner gives (f4c.js). */
  engines: F4C.engines,
  /** The afterburner plumes: the same model's exits and the same J79 flame (f4c.js). */
  plumes: F4C.plumes,
};
