// The game's settings for JSBSim's bundled F-16 (`f16`): a test aircraft, flown as upstream ships it, and
// never part of the app. New in FSG, milestone 1.
export const F16 = {
  /** JSBSim's name for it: aircraft/f16/f16.xml. */
  model: 'f16',
  /** The files JSBSim reads to load it, relative to jsbsim/jsbsim-data/. tests/flight.test.js shows each is needed. */
  files: [
    'aircraft/f16/f16.xml',
    'aircraft/f16/Systems/pushback.xml',
    'aircraft/f16/Systems/hook.xml',
    'engine/F100-PW-229.xml',
    'engine/direct.xml',
  ],
  /** Height of JSBSim's reference point above the ground when it stands on its wheels, ft (upstream's reset00.xml). */
  standingFt: 5.5,
  /**
   * Which JSBSim command each of the game's seven controls drives (see c172x.js). The F-16's flaps are worked
   * by its flight computer, not by a lever, so the flaps toggle drives nothing.
   */
  controls: {
    pitch: { to: ['fcs/elevator-cmd-norm'], sign: -1 },
    roll: { to: ['fcs/aileron-cmd-norm'], sign: 1 },
    throttle: { to: ['fcs/throttle-cmd-norm'] },
    gear: { to: ['gear/gear-cmd-norm'] },
    flaps: { to: [] },
    speedbrake: { to: ['fcs/speedbrake-cmd-norm'] },
    brake: { to: ['fcs/left-brake-cmd-norm', 'fcs/right-brake-cmd-norm', 'fcs/center-brake-cmd-norm'] },
  },
  /**
   * The game's assists (src/sim/assists.js).
   *   trim   Neutral speed 350 knots: JSBSim's own pitch trim for level flight at 350 knots and 2,000 ft, set
   *          once. tests/assists.test.js re-derives it. This file's flight computer has no roll trim to set,
   *          and JSBSim's trim asks for none.
   *   feet   Its own: the file's flight computer has a yaw damper and a sideways-g loop, so the game writes
   *          no rudder at all.
   *   steer  The nosewheel, which this file already makes gentler with speed, so the game adds no fade.
   */
  assists: {
    trim: { knots: 350, heightFt: 2000, sets: [['fcs/pitch-trim-cmd-norm', -0.0598]] },
    feet: null,
    steer: { wheel: { to: 'fcs/steer-cmd-norm', sign: 1, halfAtKt: 0 } },
  },
};
