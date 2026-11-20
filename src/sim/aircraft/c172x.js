// The game's settings for JSBSim's bundled Cessna 172 (`c172x`): a test aircraft, flown as upstream ships it.
// New in FSG, milestone 1. Everything here is about the game; the airplane itself is JSBSim's file.
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
};
