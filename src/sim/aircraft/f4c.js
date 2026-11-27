// The game's settings for the F-4C Phantom II, FSG's own aircraft file (aircraft/f4c/f4c.xml). New in FSG,
// milestone 3 (docs/milestones/3.md, pull request 3), after c172p.js and f16.js.
//
// So far the file has weight, wheels, engines, its aerodynamics across its Mach range (pull request 5),
// since pull request 6 its own flight controls (feel system, stability augmentation, interconnect), and
// since pull request 7 its flaps, gear drag, speedbrakes and ground effect: it flies a circuit, headless.
// Since pull request 8 it is the airplane in the app, in the Cessna's place: its picture (`glb`, `surfaces`)
// and the engines' numbers sent beside the state (`engines`); since pull request 9 its afterburner plumes
// (`plumes`). Everything here is about the game; the airplane
// itself, with its own throttle system and afterburner, is the aircraft file.
import { WINGS_CRASH_FPM } from '../rules.js';

const DEG = Math.PI / 180;

export const F4C = {
  /** JSBSim's name for it: aircraft/f4c/f4c.xml. */
  model: 'f4c',
  /**
   * FSG's own: its files are in the repo's aircraft/ folder, not in JSBSim's data (jsbsim/jsbsim-data/),
   * which is never edited. Inside JSBSim they go where its usual layout finds them, as any aircraft's do.
   */
  own: true,
  /**
   * How JSBSim steps this airplane forward, JSBSim's own setting (its numbers: rotation rates, speeds,
   * attitude, position; 1 is rectangular Euler, 3 and 4 Adams-Bashforth of second and third order).
   * JSBSim's default is 1, 3, 1, 4. A departure from it, for a measured reason: at the game's 120 steps a
   * second the default takes damping off a quick swing (the damping ratio falls by about the swing's
   * frequency in rad/s over 240), and without its stability augmentation the F-4C has little to lose high
   * and fast: flown on the default, its pitch swing died to half 34% to 45% slower than NASA CR-2144's at
   * Mach 1.5 to 2.15, and its Dutch roll 25% slower at 35,000 ft. With rotations stepped by the second-order
   * rule every condition is within 9% and most within 2% (Supported: tests/f4c-conditions.test.js flies both).
   * On its wheels nothing changes: standing and the engine run-up (tests/f4c.test.js), and in a throwaway
   * run a full-afterburner roll to 340 knots and a firm arrival at 160 (one touch, 4.4 g on both rules);
   * pull request 7's circuit, flown on both rules, takes off, lands and stops within 3 ft and 3 ft/min of
   * each other, and parked the jet is still on both (tests/f4c-low.test.js). The test aircraft keep JSBSim's
   * default, which milestones 1 and 2 tested them on.
   */
  stepping: [3, 3, 3, 4],
  /**
   * The pitch stick is a force, not a position: the aircraft file's feel system turns it into stabilator
   * (pull request 6), so the stick and the trim do not add. An airborne start (tests only) holds the feel
   * system still with `holding` while JSBSim trims, then keeps the trim JSBSim found as the copilot's, with
   * no force on the stick (src/sim/game.js).
   */
  airborneTrim: { holding: 'fcs/stick/trimming' },
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
  /** Its picture: the owner's own model, built to docs/models.md, as the app's page finds it (models/CREDITS.md). */
  glb: './models/f4c.glb',
  /** Height of its centre of gravity above the ground when it stands on its wheels, ft (read back from a parked flight; the model's wheels are 6.4 ft below its origin). */
  standingFt: 6.403,
  /** How far its nose is up as it stands there, degrees (read back the same way): level, but for the idle thrust leaning it on its nose leg. */
  standingPitchDeg: -0.07,
  /**
   * Which JSBSim command each of the game's seven controls drives (as in c172x.js). The one throttle works
   * both engines. The flaps and the speedbrakes drive the aircraft file's own (pull request 7).
   * The stick's two commands are JSBSim's standard ones, and the aircraft file's flight controls say what
   * they mean (pull request 6): the pitch stick is a pull in pounds (full back 103 lb, full forward 48: the
   * file's fcs/stick/full-pull-lbs and full-push-lbs), which the jet's feel system turns into stabilator; the
   * roll stick is a position, full right the left aileron 30 degrees down and the right spoiler up.
   */
  controls: {
    pitch: { to: ['fcs/elevator-cmd-norm'], sign: -1 },   // JSBSim: positive is nose down
    roll: { to: ['fcs/aileron-cmd-norm'], sign: 1 },
    throttle: { to: ['fcs/throttle-cmd-norm', 'fcs/throttle-cmd-norm[1]'] },
    gear: { to: ['gear/gear-cmd-norm'] },
    flaps: { to: ['fcs/flap-cmd-norm'] },
    speedbrake: { to: ['fcs/speedbrake-cmd-norm'] },
    brake: { to: ['fcs/left-brake-cmd-norm', 'fcs/right-brake-cmd-norm'] },
  },
  /**
   * Its flap settings, from up to fully down (milestone 3, PR F; the aircraft file's flaps, pull request 7).
   * The flight manual's switch: UP, 1/2 and DN, "Selecting the 1/2 position moves the leading edge flaps to
   * the full down position and the trailing edge flaps 1/2 down. Selection of DN, moves the trailing edge
   * flaps to the fully extended position" (T.O. 1F-4C-1, section I, "Wing flap switch"). The indicator reads
   * "Up", "1/2" and "Full" (the plan's, docs/milestones/3.md). Every flight starts at 1/2, the flight manual's
   * takeoff setting ("full flap takeoffs are prohibited"). tests/f4c-low.test.js reads back that each `at`
   * puts the flaps there.
   */
  flaps: {
    settings: [{ at: 0, reads: 'Up' }, { at: 0.5, reads: '1/2' }, { at: 1, reads: 'Full' }],
    takeoff: 1,
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
   *          stabilator 0.4 degrees trailing edge up). With the jet's own flight controls (pull request 6)
   *          the trim moves the feel system's neutral, so it means the trimmed stabilator with no force on
   *          the stick: JSBSim's trim finds -0.0191 again (tests/f4c-fcs.test.js). The airplane is the same
   *          left and right, so there is no roll trim.
   *          With the flaps (pull request 7) the trim is the same: they are up at 350 knots. JSBSim's trim
   *          there still finds -0.0191 (tests/f4c-low.test.js, which flies it hands off for a minute).
   *   feet   Wings' feet (src/sim/assists.js, wingsFeet), on top of the jet's own yaw damper and, with the
   *          flaps down and slow, its aileron-rudder interconnect, both in the aircraft file. Kept because
   *          they still help: rolling into and out of a 30 degree bank with full stick, the most sideslip with
   *          the copilot's feet and without them was 2.6 and 23 degrees at 150 knots with gear and flaps down,
   *          3.4 and 14 at 200, and 0.9 and 2.0 clean at 250 (Supported: tests/f4c-low.test.js reports it).
   *          The yaw damper's 5 degrees and the interconnect's stick-linked rudder do not hold the ball in a
   *          brisk roll on approach; the feet do. JSBSim's rudder command is positive nose left.
   *   steer  The copilot's feet on the ground (milestone 3, PR 2), as c172p.js has them, with the F-4C's
   *          numbers. The nosewheel's share of the tilt: a half at 28 knots, 6% at 70 (the flight manual: "use
   *          nose gear steering until the rudder becomes effective at approximately 70 knots"; the plan's
   *          line is 10% or less there), 2% at 100. The rudder holds the nose against what the tilt did not
   *          ask for. The hold's numbers are the Cessna's (tried first, and they meet every line of PR 2 on
   *          the jet: tests/f4c-low.test.js), but the wheelbase, the jet's own: 23.27 ft from the nosewheel to
   *          the mains (the aircraft file's gear). The nosewheel turns 70 degrees each way (the flight manual;
   *          the aircraft file).
   */
  assists: {
    trim: { knots: 350, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', -0.0191]] },
    feet: { to: 'fcs/rudder-cmd-norm', sign: -1 },
    steer: {
      wheel: { to: 'fcs/steer-cmd-norm', sign: 1, halfAtKt: 28, power: 3 },
      hold: { turnRadPerSec: 4 * DEG, follow: 0.65, wheelbaseFt: 23.27, rate: 6, heading: 40, forgetSeconds: 10 },
    },
  },
  /** A name for each wheel and airframe contact point, in the aircraft file's order (tests/f4c.test.js checks it against the file). */
  contacts: ['nose wheel', 'left main wheel', 'right main wheel', 'nose', 'belly (left)', 'belly (right)', 'tail underside (left)', 'tail underside (right)',
    'left wingtip', 'right wingtip', 'left stabilator tip', 'right stabilator tip', 'top of the fin'],
  /** The crash line: closing with the ground faster than this at a touch is a hard impact. Wings' 8 m/s. */
  crash: { closingFpm: WINGS_CRASH_FPM },
  /** Limits, reported and not enforced. Placeholders until pull request 11: 8.5 g and 750 knots, Wings' card's g limit and a round speed. */
  limits: { g: 8.5, knots: 750 },
  /**
   * The model's moving parts (src/render/surfaces.js), as c172p.js has them: for each of the model's six
   * motions (docs/models.md), the number of the state that drives it and that number's values where the
   * motion is at 0, 0.5 and 1. Each is JSBSim's own position of the part, after the aircraft file's actuators,
   * so the picture shows what the flight model's surfaces are doing, not what the stick asks (pull request 8):
   *   elevator    the stabilator, 9 degrees trailing edge down (JSBSim's positive) to 21 up: the file's stops
   *               and the model's travel
   *   aileron     the left aileron less the right: each only goes down, 30 degrees, the left one for a right
   *               roll. The model's one motion moves both ailerons and both spoilers; the file's spoilers go
   *               up 1.5 degrees for each degree of the other wing's aileron, as the model's do (45 to 30)
   *   rudder      the rudder as the file's flexure lets it go at speed, 30 degrees each way; JSBSim counts its
   *               trailing edge left as positive
   *   flaps       the flaps, up 0, 1/2 at 0.5 and full at 1: the model's flaps at half their travel at 1/2
   *   gear, speedbrake   their positions, 0 up or in, 1 down or out
   * tests/f4c-app.test.js moves each control and reads the motion.
   */
  surfaces: {
    gear: { from: 'gear/gear-pos-norm', at: [0, 0.5, 1] },
    flaps: { from: 'fcs/flap-pos-norm', at: [0, 0.5, 1] },
    speedbrake: { from: 'fcs/speedbrake-pos-norm', at: [0, 0.5, 1] },
    elevator: { from: 'fcs/elevator-pos-rad', at: [9 * DEG, 0, -21 * DEG] },
    aileron: { from: 'fcs/left-aileron-pos-rad', minus: 'fcs/right-aileron-pos-rad', at: [-30 * DEG, 0, 30 * DEG] },
    rudder: { from: 'fcs/rudder-pos-rad', at: [30 * DEG, 0, -30 * DEG] },
  },
  /**
   * The engines' numbers, sent beside every state (src/sim/flight-run.js), as the Cessna's propeller speed is:
   * the state's own list is the same for every aircraft (milestone 1's tests fix it at 34 numbers, with the
   * first engine's thrust), so both engines' go here. `thrust`, each engine's, lb; `afterburner`, what each
   * engine's afterburner gives, 0 to 1 (the aircraft file's own number: 0 at any dry power, and 0 until the
   * engine is at MIL speed), which the plumes read (pull request 9).
   */
  engines: {
    thrust: ['propulsion/engine[0]/thrust-lbs', 'propulsion/engine[1]/thrust-lbs'],
    afterburner: ['fcs/afterburner-norm', 'fcs/afterburner-norm[1]'],
  },
  /**
   * The afterburner plumes (src/render/plume.js; pull request 9), one for each engine, in the engines' order,
   * each lit by that engine's `afterburner` above. As Wings' card had them (135crewdog/wings,
   * src/sim/cards/f4c.js, nozzles_ft and nozzle_radius_ft, commit 6d689b7), with this repo's measure of the
   * same model:
   *   exits     the middle of each engine's exit, ft forward, right and down from the centre of gravity: the
   *             model's, as models/measure.mjs finds them (docs/models.md). tests/model.test.js holds them to
   *             the model within an inch. Engine 0 is the left one, as in the aircraft file.
   *   radiusFt  the exit's opening, the same way
   *   flame     the J79's flame, Wings' own (its src/render/plume.js, J79, commit 6d689b7), as the owner
   *             approved it on his phone there: from photographs of QF-4s climbing out in afterburner, a
   *             glowing orange-yellow nozzle, a short yellow-white core, and a salmon-orange flame about as
   *             wide as the nozzle and four to five metres long at full burner, the shock diamonds faint
   *             (an F-16's F100, Rage's, is long, pale and blue-white). Lengths in metres, at the least and
   *             the most afterburner; `coreLength` a share of the flame's; `diamonds` how bright the shock
   *             diamonds are against the flame, 0 to 1; `body` how solid the flame looks face-on, 0 (only
   *             its edges glow) to 1.
   */
  plumes: {
    exits: [[-16.16, -2.14, 0.60], [-16.16, 2.14, 0.60]],
    radiusFt: 1.2,
    flame: {
      minLength: 1.5, maxLength: 4.5,
      sheath: 0xff6a3a,     // the flame's body: salmon-orange
      core: 0xffd890,       // the hot core at the nozzle: yellow-white
      coreLength: 0.4,
      glow: 0xffa040,       // the nozzle's hot inside, seen from behind
      diamonds: 0.25,
      body: 0.6,
    },
  },
};
