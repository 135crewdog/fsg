// The F-4C's reference numbers: what the aircraft file (aircraft/f4c/) is built from and its checkride
// (tests/f4c.test.js) is checked against. New in FSG, milestone 3 (docs/milestones/3.md, pull request 3);
// each later pull request adds the numbers it uses.
//
// Every number is { value, unit, source, where }: the report or manual it is from, and the table, figure,
// section or file in it. A test fails if one of them does not say. None of these is ours: a number we chose
// ourselves lives in the aircraft file, with its reason, and is not a reference.

/** NASA CR-2144: Heffley and Jewell, "Aircraft Handling Qualities Data", 1972, section IV, the F-4C. https://ntrs.nasa.gov/citations/19730003312 */
const CR_2144 = 'NASA CR-2144';
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
/** Gear up or down. Wings' figure: the flight manual gives none. */
export const GEAR_SECONDS = { value: 4, unit: 's', source: WINGS, where: 'src/sim/sim.js, GEAR_SECONDS' };

// For the numbers that are only reported, with no pass or fail.
/** Wings' engine, from a slam at idle: to MIL thrust, and to full afterburner. */
export const WINGS_SECONDS_TO_MIL = { value: 4.5, unit: 's', source: WINGS, where: 'its checkride (tests/checkride.test.js); the figure is as docs/milestones/3.md, pull request 3, has it' };
export const WINGS_SECONDS_TO_FULL_AFTERBURNER = { value: 6.3, unit: 's', source: WINGS, where: 'its checkride (tests/checkride.test.js); the figure is as docs/milestones/3.md, pull request 3, has it' };
/** The engine speed of the run-up before takeoff: above it the brakes may not hold. Not re-read from the manual for this file. */
export const RUN_UP_RPM = { value: 85, unit: '% rpm', source: FLIGHT_MANUAL, where: 'the run-up before takeoff; the figure is as docs/milestones/3.md, pull request 3, has it, and its page is still to be read into this file' };
