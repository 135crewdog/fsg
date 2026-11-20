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
};
