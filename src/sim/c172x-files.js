// The files JSBSim reads to load the Cessna 172 test aircraft (`c172x`), out of
// the 485 in jsbsim/jsbsim-data/: the aircraft, its autopilot, a start in the
// air, its engine and propeller, and the two shared systems it includes.
// tests/fdm.test.js loads c172x with only these, and shows each one is needed.
// Paths are relative to jsbsim/jsbsim-data/, which is JSBSim's root folder.
export const C172X_FILES = [
  'aircraft/c172x/c172x.xml',
  'aircraft/c172x/c172ap.xml',
  'aircraft/c172x/reset01.xml',   // in the air: 4,000 ft, 100 knots
  'engine/eng_io320.xml',
  'engine/prop_75in2f.xml',
  'systems/GNCUtilities.xml',
  'systems/Autopilot.xml',
];
