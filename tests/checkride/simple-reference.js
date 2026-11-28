// The simple F-4C's reference numbers: what its checkride (tests/simple-f4c.test.js) is checked against, and
// the figures its reported numbers are printed beside. New in FSG, milestone 3 re-planned
// (docs/milestones/3-replan.md, pull request 3). Written before the checkride was run against it.
//
// Every number is { value, unit, source, where }, as in tests/checkride/f4c-reference.js; a test fails if one
// does not say. Numbers that file already has (the weight, the wheels, the 8.5 g limit, the 750 knot limit, the
// flight manual's full-flap stall, Wings' figures that milestone 3 quoted) are used from there and not written
// twice. None of these is ours: a number we chose lives in the aircraft file, with its reason.

/** Wings: the F-4C the owner flew and liked. Its card, and its own checkride run at this commit (26 of 26 pass). */
const WINGS = '135crewdog/wings, commit 6d689b7';
const CARD = 'src/sim/cards/f4c.js';
const RIDE = 'tests/checkride.test.js, run at that commit';
/** Flown on Wings' own code for this pull request, in memory, with its own test pilots (tests/fly.js); nothing was written to Wings. */
const FLOWN = 'flown on its own code (tests/fly.js: airborne, level, the stick moved one twenty-third, as a degree of tilt is) for docs/milestones/3-replan.md, pull request 3';
/** The record of the data-built F-4C. */
const MILESTONE_3 = 'docs/milestones/3.md';
/** What the owner's first flights of the data-built jet found. */
const FINDINGS = 'docs/milestones/3-feel-findings.md';
/** The approved plan, where it flew Wings itself. */
const PLAN = 'docs/milestones/3-replan.md';

// ---- the lines' own references ----

export const STALL_CLEAN = { value: 145, unit: 'kt (indicated, 1 g, sea level)', source: WINGS, where: `${CARD}, stall_clean_kt` };
export const STALL_LANDING = { value: 125, unit: 'kt, gear and flaps down', source: WINGS, where: `${CARD}, stall_landing_kt` };
export const TOP_SPEED_HIGH = { value: [2.2, 40000], unit: 'Mach at ft, full afterburner', source: WINGS, where: `${CARD}, top_speed_high_mach at top_speed_high_ft` };
/** The plan's lines are "within 10%". */
export const WITHIN = { value: 0.1, unit: 'of the reference', source: PLAN, where: 'PR 3, "Done when": "within 10% means of the reference"' };

/** Wings' thrust: "thrust along the nose through the CG". The simple F-4C's is the same, and tests/model.test.js holds its aircraft file to it. */
export const THRUST_TILT = { value: 0, unit: 'degrees', source: WINGS, where: 'src/sim/sim.js, totalForces: "thrust along the nose through the CG"' };
export const THRUST_LINE_ABOVE_CG = { value: 0, unit: 'ft', source: WINGS, where: 'src/sim/sim.js, totalForces: "thrust along the nose through the CG"' };

// ---- beside the reported numbers: Wings ----

export const WINGS_STALL_SPEEDS = { value: [143.5, 122.1], unit: 'kt: clean, and gear and flaps down', source: WINGS, where: `${RIDE}: "stall speed" and "stall speed, gear and flaps down"` };
export const WINGS_TOP_SPEEDS = { value: [780, 2.2], unit: 'kt at sea level; Mach at 40,000 ft', source: WINGS, where: `${RIDE}: "Top speed, full afterburner, level"` };
export const WINGS_MIL_TOP_SPEEDS = { value: [621, 1.01], unit: 'kt at sea level; Mach at 30,000 ft', source: WINGS, where: `${RIDE}: "top speed at MIL"` };
export const WINGS_HANDS_OFF = { value: [336, 199], unit: 'kt: gliding clean at idle; gear and flaps down', source: WINGS, where: `${RIDE}: "Glide, hands off" and "hands off, gear and flaps down, settles at"` };
/** The plan's table: Wings' takeoff on full flaps and full afterburner, the tilt simply held from 80 knots. */
export const WINGS_HELD_TAKEOFF = {
  value: [[1, 150, 174, 9, 40], [0.75, 162, 185, null, 37], [0.5, 179, 199, null, 30]],
  unit: 'for each back tilt held: the tilt; kt, the nosewheel off; kt, airborne; degrees nose up then (where given); degrees nose up 2 s later',
  source: PLAN, where: '"Wings\' takeoff with the tilt simply held" (flown on Wings\' code for the plan)',
};
export const WINGS_PILOT_TAKEOFF = { value: [150, 174, 9, 226, 3000], unit: 'kt, the nosewheel off; kt, airborne; degrees nose up; kt and ft/min 5 s later', source: PLAN, where: 'the same table, its first row: Wings\' own test pilot, who eases to hold 10 degrees' };
export const WINGS_G_PER_DEGREE = { value: [0.06, 0.19, 0.29, 0.19, 0.23], unit: 'g for one more degree of tilt at 180, 250, 350, 450 and 550 kt, 2,000 ft', source: WINGS, where: FLOWN };
export const WINGS_LEVEL_TILT = { value: [0.31, 0.09, -0.16, -0.36], unit: 'stick for level flight at 180, 250, 450 and 600 kt clean, sea level (back positive)', source: WINGS, where: `${RIDE}: "level at 180 kt, clean" and "tilt for level flight at"` };
export const WINGS_LEVEL_TILT_LANDING = { value: [0.25, 0.06], unit: 'stick for level flight at 150 and 180 kt, gear and flaps down, sea level (back positive)', source: WINGS, where: `${FLOWN}; its checkride has the 180 kt one: "gear and flaps down ... tilt 6% back"` };
export const WINGS_HARD_TURN = { value: [476, 10000, 407, 9, 6.8], unit: 'kt in, at ft; kt, s and g half way round: full back tilt, level, full afterburner', source: WINGS, where: `${RIDE}: "Turning (reported, not graded)"` };
export const WINGS_LOOP = { value: [175, 7725], unit: 'kt over the top; ft gained', source: WINGS, where: `${RIDE}: "loop"` };
export const WINGS_SLOPPY_STALL = { value: [1.4, 10.4, 3156], unit: 'rolls in 15 s of full back and full tilt; s to flying again after letting go; ft lower', source: WINGS, where: `${RIDE}: "Stall in a turn ... and full tilt into the turn"` };
export const WINGS_STALL_LET_GO = { value: [1.5, -33], unit: 's to flying again; degrees the nose falls to', source: WINGS, where: `${RIDE}: "Stall, then hands off"` };
export const WINGS_ACCELERATION = { value: [17.4, 10000], unit: 's from 300 to 500 kt in full afterburner, at ft', source: WINGS, where: `${RIDE}: "300 to 500 kt, 10,000 ft, afterburner"` };

// ---- beside the reported numbers: the data-built F-4C, and the book ----

export const DATA_BUILT_STALL = { value: 140.5, unit: 'kt at 22 degrees of angle of attack, clean, idle', source: MILESTONE_3, where: 'the results, PR 10: "22 degrees at 140.5 knots"' };
export const DATA_BUILT_TOP_SPEED = { value: 754, unit: 'kt at sea level, full afterburner', source: PLAN, where: 'PR 3, the top speed line: "the data-built jet 754"' };
export const DATA_BUILT_FINAL = { value: 147, unit: 'kt on final, gear and full flaps', source: MILESTONE_3, where: 'the results, PR 7: "Approach at 11.7 degrees, 38,924 lb ... 147.0 (the F-4E appendix: 152)"' };
export const DATA_BUILT_LET_GO = { value: [10.6, 3160], unit: 's to flying again after 5 s of full back and full right tilt; ft lower', source: MILESTONE_3, where: 'the results, PR 10: "Let go after 5 s of full back and full right tilt"' };
export const SUSTAINED_G_AT_450 = { value: [4.8, 4.2], unit: 'g at 450 kt at sea level in full afterburner: what NASA CR-2144\'s lift and drag imply; what the data-built jet holds', source: FINDINGS, where: '"One fault in the aerodynamics"' };
/** The findings' table: g for one more degree of tilt, version 0.0.22 as the owner flew it, and the data-built jet with the tilt straight to its tail through one speed curve. */
export const DATA_BUILT_G_PER_DEGREE = { value: [0.24, 0.16, 0.14, 0.07, 0.075], unit: 'g for one more degree of tilt at 180, 250, 350, 450 and 550 kt', source: FINDINGS, where: '"What was tried", the column "0.0.22"' };
export const DATA_BUILT_STRAIGHT_G_PER_DEGREE = { value: [0.13, 0.13, 0.16, 0.09, 0.10], unit: 'g for one more degree of tilt at 180, 250, 350, 450 and 550 kt', source: FINDINGS, where: '"What was tried", the column "Tilt straight to the tail, one speed curve"' };
export const DATA_BUILT_LOOP = { value: [590, 321, 13200], unit: 'kt in; kt over the top; ft gained: a 4 g pull eased to hold 16 degrees of angle of attack', source: FINDINGS, where: 'the table "Measured on 0.0.22", "Loop"' };
