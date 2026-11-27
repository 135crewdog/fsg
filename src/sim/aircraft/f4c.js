// The game's settings for the F-4C Phantom II, FSG's own aircraft file (aircraft/f4c/f4c.xml). New in FSG,
// milestone 3 (docs/milestones/3.md, pull request 3), after c172p.js and f16.js.
//
// So far the file has weight, wheels, engines and, since pull request 5, its aerodynamics across its Mach
// range with the stick straight to the surfaces: it flies, headless. It is not in the app yet (the Cessna
// still flies there); pull request 8 puts it in. Everything here is about the game; the airplane itself,
// with its own throttle system and afterburner, is the aircraft file.
import { WINGS_CRASH_FPM } from '../rules.js';

export const F4C = {
  /** JSBSim's name for it: aircraft/f4c/f4c.xml. */
  model: 'f4c',
  /**
   * FSG's own: its files are in the repo's aircraft/ folder, not in JSBSim's data (jsbsim/jsbsim-data/),
   * which is never edited. Inside JSBSim they go where its usual layout finds them, as any aircraft's do.
   */
  own: true,
  /**
   * The files JSBSim reads to load it, relative to the repo's root. tests/f4c.test.js shows each is needed.
   * (aircraft/f4c/data/ is the record of where the aircraft file's tables came from. JSBSim does not read it,
   * and the app does not fetch it.)
   */
  files: [
    'aircraft/f4c/f4c.xml',
    'aircraft/f4c/Engines/J79-GE-15.xml',
    'aircraft/f4c/Engines/direct.xml',
  ],
  /** Height of its centre of gravity above the ground when it stands on its wheels, ft (read back from a parked flight; the model's wheels are 6.4 ft below its origin). */
  standingFt: 6.403,
  /** How far its nose is up as it stands there, degrees (read back the same way): level, but for the idle thrust leaning it on its nose leg. */
  standingPitchDeg: -0.07,
  /**
   * Which JSBSim command each of the game's seven controls drives (as in c172x.js). The one throttle works
   * both engines. The flaps and the speedbrakes drive nothing yet: the file gets them in pull request 7.
   * The stick's two commands are JSBSim's standard ones. For now (pull request 5a) the file takes them
   * straight to the surfaces: full back stick is the stabilator 21 degrees trailing edge up, full right
   * stick the left aileron 30 degrees down and the right spoiler up. The jet's own flight controls (pull
   * request 6) will say what they mean after that.
   */
  controls: {
    pitch: { to: ['fcs/elevator-cmd-norm'], sign: -1 },   // JSBSim: positive is nose down
    roll: { to: ['fcs/aileron-cmd-norm'], sign: 1 },
    throttle: { to: ['fcs/throttle-cmd-norm', 'fcs/throttle-cmd-norm[1]'] },
    gear: { to: ['gear/gear-cmd-norm'] },
    flaps: { to: [] },
    speedbrake: { to: [] },
    brake: { to: ['fcs/left-brake-cmd-norm', 'fcs/right-brake-cmd-norm'] },
  },
  /**
   * Where MIL is on the game's throttle, 0 to 1: beyond it is the afterburner. The aircraft file's throttle
   * system has the same number (fcs/mil-throttle-norm), and tests/f4c.test.js holds the two together.
   */
  mil: 0.8,
  /** A jet: the HUD shows its power as a jet's (src/hud.js). */
  jet: true,
  /**
   * The copilot (src/sim/assists.js).
   *   trim   Neutral speed 350 knots, Wings' own for its F-4C (135crewdog/wings, src/sim/cards/f4c.js,
   *          neutral_speed_kt, commit 6d689b7): JSBSim's own pitch trim for level flight at 350 knots and
   *          2,000 ft, set once. tests/f4c-aero.test.js re-derives it. It is the trim of pull request 5's
   *          airplane, stick straight to the stabilator: each pull request that changes the airplane there
   *          finds it again (5a had -0.0333; with what Mach changes, at Mach 0.53, it is -0.0191: the
   *          stabilator 0.4 degrees trailing edge up). The airplane is the same left and right, so there
   *          is no roll trim.
   *   feet   None yet: the rudder stays in the middle. Pull requests 6 and 7 decide what is the jet's own
   *          (its yaw damper, its aileron-rudder interconnect) and what the copilot's.
   *   steer  The nosewheel, straight from the stick with no fade, as f16.js has it for now. Pull request 7
   *          gives the jet its copilot's feet on the ground; until then no test taxis it at speed.
   */
  assists: {
    trim: { knots: 350, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', -0.0191]] },
    feet: null,
    steer: { wheel: { to: 'fcs/steer-cmd-norm', sign: 1, halfAtKt: 0 } },
  },
  /** A name for each wheel and airframe contact point, in the aircraft file's order (tests/f4c.test.js checks it against the file). */
  contacts: ['nose wheel', 'left main wheel', 'right main wheel', 'nose', 'belly (left)', 'belly (right)', 'tail underside (left)', 'tail underside (right)',
    'left wingtip', 'right wingtip', 'left stabilator tip', 'right stabilator tip', 'top of the fin'],
  /** The crash line: closing with the ground faster than this at a touch is a hard impact. Wings' 8 m/s. */
  crash: { closingFpm: WINGS_CRASH_FPM },
  /** Limits, reported and not enforced. Placeholders until pull request 11: 8.5 g and 750 knots, Wings' card's g limit and a round speed. */
  limits: { g: 8.5, knots: 750 },
};
