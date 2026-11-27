// The F-4C's reference numbers: what the aircraft file (aircraft/f4c/) is built from and its checkride
// (tests/f4c.test.js, tests/f4c-aero.test.js, tests/model.test.js) is checked against. New in FSG, milestone 3 (docs/milestones/3.md, pull request 3);
// each later pull request adds the numbers it uses.
//
// Every number is { value, unit, source, where }: the report or manual it is from, and the table, figure,
// section or file in it. A test fails if one of them does not say. None of these is ours: a number we chose
// ourselves lives in the aircraft file, with its reason, and is not a reference.

/** NASA CR-2144: Heffley and Jewell, "Aircraft Handling Qualities Data", 1972, section IV, the F-4C. https://ntrs.nasa.gov/citations/19730003312 */
const CR_2144 = 'NASA CR-2144';
/**
 * AFWAL-TR-80-3141 Part III (Mitchell, Myers, Teper and Johnston, Systems Technology, Inc., December 1980; DTIC
 * ADA101648), appendix I, "F-4J Extended Angle-of-Attack Simulation Model". Its tables and equations are in
 * aircraft/f4c/data/afwal-f4j.json, which is where the aerodynamics' own numbers live; only the few numbers a
 * test names are here. Pages are the PDF's; the printed page is 16 less.
 */
const AFWAL = 'AFWAL-TR-80-3141 Part III';
/** The F-4C flight manual. */
const FLIGHT_MANUAL = 'T.O. 1F-4C-1 (1 October 1970)';
/** The owner's model as Wings measured it: the model's origin is the centre of gravity. */
const WINGS = '135crewdog/wings, commit 6d689b7';
const CARD = 'src/sim/cards/f4c.js';

export const WING_AREA = { value: 530, unit: 'sq ft', source: CR_2144, where: 'table IV-2' };
export const WING_SPAN = { value: 38.67, unit: 'ft', source: CR_2144, where: 'table IV-2 and figure IV-2' };
export const WING_CHORD = { value: 16.04, unit: 'ft', source: CR_2144, where: 'table IV-2' };

/** The one weight the F-4C flies at: clean, about 60% internal fuel. */
export const WEIGHT = { value: 38924, unit: 'lb', source: CR_2144, where: 'table IV-2' };
export const ROLL_INERTIA = { value: 25002, unit: 'slug-ft2', source: CR_2144, where: 'table IV-2 (Ixx, body axes)' };
export const PITCH_INERTIA = { value: 122193, unit: 'slug-ft2', source: CR_2144, where: 'table IV-2 (Iyy, body axes)' };
export const YAW_INERTIA = { value: 139767, unit: 'slug-ft2', source: CR_2144, where: 'table IV-2 (Izz, body axes)' };
/** Positive in the usual sense: the airplane's long axis of mass points nose down. */
export const CROSS_INERTIA = { value: 2177, unit: 'slug-ft2', source: CR_2144, where: 'table IV-2 (Ixz, body axes)' };

/** The centre of gravity at that weight, as a share of the mean chord ("C.G. (MGC) .289" at each of the nine clean conditions). */
export const CG_PERCENT_CHORD = { value: 28.9, unit: '% of the chord', source: CR_2144, where: 'table IV-2 (C.G., the nine clean flight conditions)' };

// The aerodynamics at low speed (pull request 5a): AFWAL's model.
/** The point AFWAL's moment tables are taken about ("Xref, reference center of gravity"). */
export const AFWAL_REFERENCE_CENTRE = { value: 31, unit: '% of the chord', source: AFWAL, where: 'Table 5, PDF p.35' };
/** The one height AFWAL's model was made for. */
export const AFWAL_REFERENCE_HEIGHT = { value: 15000, unit: 'ft', source: AFWAL, where: 'Table 5, PDF p.35' };
/** The stabilator's travel, trailing edge down positive: "21 up, 9 down". */
export const STABILATOR_TRAVEL = { value: [-21, 9], unit: 'degrees, trailing edge down positive', source: AFWAL, where: 'Table 6, PDF p.36' };
/** Each aileron goes down only ("0 up, 30 down"); on the F-4J the other wing's spoiler goes up 1.433 times as far ("delta sp = 1.433 delta a"; "43 up"). */
export const AILERON_TRAVEL = { value: 30, unit: 'degrees down', source: AFWAL, where: 'Table 6, PDF p.36' };
export const AFWAL_SPOILER_PER_AILERON = { value: 1.433, unit: 'degrees of spoiler for each degree of aileron', source: AFWAL, where: 'section D, PDF p.34, and Table 6, PDF p.36' };
/** The F-4C's own: the ailerons 30 degrees down and the spoilers 45 up (pull request 6; AFWAL's F-4J has 1.433, above). */
export const SPOILER_PER_AILERON = { value: 1.5, unit: 'degrees of spoiler for each degree of aileron', source: FLIGHT_MANUAL, where: 'section I, "Lateral control system": the ailerons "travel downward 30 degrees", "The spoilers travel 45 degrees upward": 45/30' };
export const RUDDER_TRAVEL = { value: 30, unit: 'degrees each way', source: AFWAL, where: 'Table 6, PDF p.36' };
/** The clean F-4's wing rock, and the nose slice that follows it, as AFWAL quotes the F-4E's stall tests (its reference 8), in true angle of attack. */
export const WING_ROCK_ALPHA = { value: [19, 22], unit: 'degrees of angle of attack', source: AFWAL, where: 'section G, PDF p.59' };
export const NOSE_SLICE_ALPHA = { value: [22, 25.5], unit: 'degrees of angle of attack', source: AFWAL, where: 'section G, PDF p.59' };

/** The thrust line: tilted so the exhaust goes down and aft, and passing above the centre of gravity, so power pushes the nose down. */
export const THRUST_TILT = { value: 5.25, unit: 'degrees', source: CR_2144, where: 'table IV-2 (the thrust line\'s inclination)' };
export const THRUST_LINE_ABOVE_CG = { value: 0.37, unit: 'ft', source: CR_2144, where: 'table IV-2 (the thrust line\'s offset, given as -0.37 ft)' };

/** Each engine, sea level, standing still. "The J79-15 engine is rated at 10,900 pounds thrust at Mil power, while Max power is rated at 17,000." */
export const MIL_THRUST = { value: 10900, unit: 'lb', source: FLIGHT_MANUAL, where: 'section I, the engines' };
export const MAX_THRUST = { value: 17000, unit: 'lb', source: FLIGHT_MANUAL, where: 'section I, the engines' };

/** Where the tyres meet the runway with the airplane standing: feet forward, right and down from the centre of gravity. */
const WHEEL_UNIT = 'ft forward, right and down from the centre of gravity';
export const NOSE_WHEEL = { value: [19.75, 0, 6.4], unit: WHEEL_UNIT, source: WINGS, where: `${CARD}, wheels_ft.nose` };
export const LEFT_MAIN_WHEEL = { value: [-3.52, -8.96, 6.4], unit: WHEEL_UNIT, source: WINGS, where: `${CARD}, wheels_ft.left` };
export const RIGHT_MAIN_WHEEL = { value: [-3.52, 8.96, 6.4], unit: WHEEL_UNIT, source: WINGS, where: `${CARD}, wheels_ft.right` };
/** The middle of each engine's exit. Fore and aft and sideways the file's thrust points are here; in height they are CR-2144's thrust line. */
export const LEFT_ENGINE_EXIT = { value: [-16.16, -2.17, 0.61], unit: WHEEL_UNIT, source: WINGS, where: `${CARD}, nozzles_ft[0]` };
export const RIGHT_ENGINE_EXIT = { value: [-16.16, 2.17, 0.61], unit: WHEEL_UNIT, source: WINGS, where: `${CARD}, nozzles_ft[1]` };
/**
 * The middle of the two speedbrake panels, fully open, on the centreline: where their drag acts. Measured from the
 * owner's model (models/f4c.glb, the same file as Wings') by models/measure.mjs; Wings' card has the same figure.
 * tests/model.test.js holds this number to the model. The aircraft file gets its speedbrakes in pull request 7.
 */
export const SPEEDBRAKE_PANELS = { value: [-5.99, 0, 2.49], unit: WHEEL_UNIT, source: WINGS, where: `models/f4c.glb, measured by models/measure.mjs (speedbrakeAt); ${CARD}, speedbrake_ft` };
/** Gear up or down. Wings' figure: the flight manual gives none. */
export const GEAR_SECONDS = { value: 4, unit: 's', source: WINGS, where: 'src/sim/sim.js, GEAR_SECONDS' };

// CR-2144's nine clean flight conditions (pull request 5, second half): its conditions 2 to 10, in that order,
// 38,925 lb, centre of gravity at 28.9% of the chord, level flight. Pages are the PDF's; the printed page is 6
// less. The transfer functions the checkride lays the airplane's responses beside (Tables IV-4, IV-14 and
// IV-15) are too many numbers to repeat here: they are read from the record, aircraft/f4c/data/cr2144-f4c.json,
// and tests/f4c-conditions.test.js holds every list below to that record.
const NINE = 'conditions 2 to 10';
export const CONDITION_MACH = { value: [0.8, 1.1, 0.9, 0.6, 0.9, 1.2, 1.5, 2.15, 1.8], unit: 'Mach', source: CR_2144, where: `table IV-2 (M), PDF p.88; ${NINE}` };
export const CONDITION_HEIGHT = { value: [0, 0, 15000, 35000, 35000, 35000, 45000, 45000, 55000], unit: 'ft', source: CR_2144, where: `table IV-2 (H), PDF p.88; ${NINE}` };
/** Trim angle of attack, from the fuselage reference line. */
export const CONDITION_TRIM_ALPHA = { value: [0.3, -0.3, 0.5, 9.4, 2.6, 1.6, 2.6, 1.4, 3.3], unit: 'degrees', source: CR_2144, where: `table IV-2 (ALPHA), PDF p.88; ${NINE}` };
/** Trim stabilator, trailing edge down positive: read from the plot at each condition's Mach number on its height's curve (the plot reads to about 0.1 degree, 0.4 where it is steep). */
export const CONDITION_TRIM_STABILATOR = { value: [0.43, -0.5, -0.23, -4.36, -1.99, -3.79, -6.89, -7.34, -9.58], unit: 'degrees, trailing edge down positive', source: CR_2144, where: `the trim plot (figure IV-8), PDF p.77; ${NINE}` };
/** The trimmed drag coefficient, read from the plot the same way (the plot reads to about 3%). */
export const CONDITION_DRAG = { value: [0.0175, 0.0414, 0.0226, 0.0921, 0.0336, 0.0487, 0.0477, 0.0381, 0.0476], unit: 'drag coefficient', source: CR_2144, where: `the CL and CD plot (figure IV-9), PDF p.78; ${NINE}` };
/** Stabilator for each g in a steady pull at constant speed, augmentation off, its size (the stabilator goes trailing edge up). */
export const CONDITION_STABILATOR_PER_G = { value: [0.867, 0.827, 1.29, 4.54, 2.99, 3.64, 5.65, 6.08, 8.44], unit: 'degrees per g', source: CR_2144, where: `table IV-12 (DE/G), PDF p.104; ${NINE}` };
/** The quick pitch swing (the short period), augmentation off: its damping ratio and its frequency. */
export const CONDITION_PITCH_DAMPING = { value: [0.393, 0.324, 0.308, 0.259, 0.224, 0.162, 0.102, 0.0645, 0.065], unit: 'damping ratio', source: CR_2144, where: `table IV-4 (Z(DET)2), PDF p.90; ${NINE}` };
export const CONDITION_PITCH_FREQUENCY = { value: [4.44, 7.99, 4.24, 1.41, 2.85, 5.43, 5.39, 6.54, 4.84], unit: 'rad/s', source: CR_2144, where: `table IV-4 (W(DET)2), PDF p.90; ${NINE}` };
/** The Dutch roll, augmentation off: its damping ratio and its frequency. */
export const CONDITION_DUTCH_ROLL_DAMPING = { value: [0.125, 0.134, 0.0972, 0.0881, 0.0491, 0.0727, 0.067, 0.0731, 0.0535], unit: 'damping ratio', source: CR_2144, where: `table IV-14 (Z(DET)1), PDF p.106; ${NINE}` };
export const CONDITION_DUTCH_ROLL_FREQUENCY = { value: [4.01, 6.21, 3.45, 1.83, 2.43, 3.57, 3.23, 2.93, 2.58], unit: 'rad/s', source: CR_2144, where: `table IV-14 (W(DET)1), PDF p.106; ${NINE}` };
/** The spiral: its root, 1/s (positive dies away; condition 8's is the one that grows, doubling in 3,868 s). */
export const CONDITION_SPIRAL_ROOT = { value: [0.00469, 0.00568, 0.00848, 0.0173, 0.00969, 0.00187, -0.000179, 0.000558, 0.000226], unit: '1/s', source: CR_2144, where: `table IV-14 (1/T(DET)1), PDF p.106; ${NINE}` };
/** The "tuck": at conditions 2, 4 and 6 the slow speed-and-height swing is replaced by a slow divergence. Seconds for a speed error to double, stick fixed. */
export const TUCK_SECONDS_TO_DOUBLE = { value: [18.4, 11.3, 15.2], unit: 's, at conditions 2, 4 and 6', source: CR_2144, where: 'table IV-12 (TUCK(2)), PDF p.104' };

// For the numbers that are only reported, with no pass or fail.
/** Wings' F-4C: the speed it holds with the phone at neutral, which FSG's neutral trim is set for (src/sim/aircraft/f4c.js). */
export const WINGS_NEUTRAL_SPEED = { value: 350, unit: 'kt', source: WINGS, where: `${CARD}, neutral_speed_kt` };
/** Wings' F-4C, full right stick from level flight at sea level: the roll rate averaged from 1.5 to 3 s in. */
export const WINGS_ROLL_RATE_250 = { value: 102, unit: 'deg/s', source: WINGS, where: 'tests/checkride.test.js, "GRADED: roll rate": the row "at 250 kt true, sea level" of a run at that commit' };
export const WINGS_ROLL_RATE_400 = { value: 180, unit: 'deg/s', source: WINGS, where: `${CARD}, roll_rate_dps at roll_rate_at_kt (400 kt, sea level); its checkride flies 180` };
/** Wings' engine, from a slam at idle: to MIL thrust, and to full afterburner. */
export const WINGS_SECONDS_TO_MIL = { value: 4.5, unit: 's', source: WINGS, where: 'its checkride (tests/checkride.test.js); the figure is as docs/milestones/3.md, pull request 3, has it' };
export const WINGS_SECONDS_TO_FULL_AFTERBURNER = { value: 6.3, unit: 's', source: WINGS, where: 'its checkride (tests/checkride.test.js); the figure is as docs/milestones/3.md, pull request 3, has it' };
/** The engine speed of the run-up before takeoff: above it the brakes may not hold. Not re-read from the manual for this file. */
export const RUN_UP_RPM = { value: 85, unit: '% rpm', source: FLIGHT_MANUAL, where: 'the run-up before takeoff; the figure is as docs/milestones/3.md, pull request 3, has it, and its page is still to be read into this file' };

// The jet's own flight controls (pull request 6): CR-2144's figures IV-3 to IV-7, PDF p.71 to 75 (printed 65
// to 69), as aircraft/f4c/data/cr2144-f4c.json has them ("control_system", "feel_system_schematic",
// "figures.feel_system_parameters", "stability_augmentation"); and the flight manual where it says more.
const FIG_3 = 'figure IV-3 (the control system), PDF p.71';
const FIG_4 = 'figure IV-4 (the feel system), PDF p.72';
const FIG_7 = 'figure IV-7 (the stability augmentation), PDF p.75';
export const STICK_INERTIA = { value: 0.0369, unit: 'lb s2/in', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const STICK_DAMPING = { value: 0.208, unit: 'lb s/in', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const BELLOWS_SPRING = { value: 0.0157, unit: 'lb/in for each lb of qB PBF', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const BELLOWS_PRESSURE_SPRING = { value: 0.0569, unit: 'lb/in for each lb of qB PBF', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const VISCOUS_DAMPER = { value: 3.03, unit: 'lb s/in, off its stop', source: CR_2144, where: FIG_4 };
export const BOBWEIGHT = { value: 5.35, unit: 'lb/g', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const BOBWEIGHT_STATION = { value: 39.3, unit: 'ft ahead of the centre of gravity', source: CR_2144, where: `${FIG_3} and ${FIG_4}` };
export const PITCH_GEARING = { value: -3.36, unit: 'degrees of stabilator for each inch of stick, aft positive', source: CR_2144, where: FIG_3 };
export const ACTUATOR_LAG = { value: 0.05, unit: 's', source: CR_2144, where: `${FIG_3} (the stabilator); ${AFWAL}, Figure 4, PDF p.37, has the same on every lateral surface` };
export const LATERAL_FEEL = { value: 2.96, unit: 'lb/in', source: CR_2144, where: FIG_3 };
export const LATERAL_GEARING = { value: 6.25, unit: 'degrees of aileron for each inch of stick', source: CR_2144, where: FIG_3 };
export const PITCH_DAMPER = { value: [0.15, 1], unit: 'rad of stabilator for each rad/s, through K s / (s + a): [K, a]', source: CR_2144, where: FIG_7 };
export const ROLL_DAMPER = { value: -0.265, unit: 'rad of aileron for each rad/s of roll rate', source: CR_2144, where: FIG_7 };
export const ROLL_DAMPER_OUT_ABOVE = { value: 1.5, unit: 'lb of sideways stick force', source: FLIGHT_MANUAL, where: 'section IV, "Force transducer": "A lateral stick force of approximately 1.5 pounds closes a force switch ... the roll rate gyro signal in stab aug ... [is] cut out"' };
export const YAW_DAMPER = { value: [3, 0.5, 0.0168], unit: 'rad of rudder: K s / (s + a) on the yaw-rate gyro [K, a], and per ft/s2 of the lateral accelerometer', source: CR_2144, where: `${FIG_7}; the record notes that the 3 could read .3 on the scan` };
export const YAW_GYRO_TILT = { value: -1.5, unit: 'degrees', source: CR_2144, where: `${FIG_7}: rG = r cos(-1.5 deg) + p sin(-1.5 deg)` };
export const LATERAL_ACCELEROMETER = { value: [9.9, -0.39], unit: 'a\'y = ay + 9.9 r-dot - 0.39 p-dot (ft)', source: CR_2144, where: `${FIG_7}: "lateral accelerometer at F.S. 198.0 and W.L. 23.0"` };
export const YAW_DAMPER_AUTHORITY = { value: 5, unit: 'degrees of rudder', source: FLIGHT_MANUAL, where: 'section I, "Aileron rudder interconnect (ARI)": "the yaw stab aug (5°) rudder authority"' };
export const INTERCONNECT_GAIN = { value: [-0.69, -0.46], unit: 'rad of rudder for each rad of aileron, augmentation on and off', source: CR_2144, where: FIG_3 };
export const INTERCONNECT_LIMIT = { value: [15, 10], unit: 'degrees of rudder, augmentation on and off', source: FLIGHT_MANUAL, where: 'section I, "Aileron rudder interconnect (ARI)": "The limits of the system are 15° of rudder displacement when ... in the stability augmentation ... mode, and 10° ... when the stab aug switch is disengaged"' };
export const INTERCONNECT_BELOW_KNOTS = { value: 230, unit: 'kt', source: FLIGHT_MANUAL, where: 'section IV, the aileron-rudder interconnect: "When the flap control switch is down, and airspeed is below approximately 230 knots"' };
export const SPOILER_TRAVEL = { value: 45, unit: 'degrees up', source: FLIGHT_MANUAL, where: 'section I, "Lateral control system": "The spoilers travel 45 degrees upward from a flush contour position"' };
export const SPOILER_PER_AILERON_CR = { value: 1.87, unit: 'degrees of spoiler for each degree of aileron', source: CR_2144, where: FIG_3 };
/** NASA CR-2144's pull per g, bobweight loop closed, augmentation off: sea level Mach 0.8 and 35,000 ft Mach 0.9 (conditions 2 and 6). */
export const PULL_PER_G = { value: [12.5, 12.2], unit: 'lb/g', source: CR_2144, where: 'table IV-12 (FST/G), PDF p.104, conditions 2 and 6' };
/** The flight manual's g limit at this weight, up to Mach 0.72: what full back tilt is sized to (docs/milestones/3.md, pull request 6). */
export const G_LIMIT = { value: 8.5, unit: 'g', source: FLIGHT_MANUAL, where: 'section V, the g limit at 37,500 lb, as docs/milestones/3.md has it' };
/** CR-2144's most lift at 450 knots at sea level, as docs/milestones/3.md works it out. */
export const MOST_G_AT_450 = { value: 7.9, unit: 'g', source: CR_2144, where: 'its maximum lift, as docs/milestones/3.md, pull request 6, gives it' };
/** Wings' F-4C, full back tilt at sea level, and full right tilt at 600 knots: as docs/milestones/3.md quotes them. */
export const WINGS_G_AT_FULL_TILT = { value: [3.0, 5.7, 8.3], unit: 'g at 250, 350 and 450 kt', source: WINGS, where: 'its checkride, as docs/milestones/3.md, pull request 6, quotes it' };
export const WINGS_NEGATIVE_G = { value: -3, unit: 'g', source: WINGS, where: 'as docs/milestones/3.md, pull request 6, quotes it' };
export const WINGS_ROLL_RATE_600 = { value: 183, unit: 'deg/s', source: WINGS, where: 'its checkride, as docs/milestones/3.md, pull request 6, quotes it' };
