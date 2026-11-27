// What the flaps and the gear change in the F-4C's aerodynamics: the tables of aircraft/f4c/f4c.xml between
// its two "FLAP AND GEAR TABLES" marks, worked out here and nowhere by hand. New in FSG, milestone 3
// (docs/milestones/3.md, pull request 7). The same way of working as tools/f4c-mach.mjs, whose arithmetic it
// borrows (conditionAt, valuesAt).
//
//   node tools/f4c-flaps.mjs            print the tables and what they were made from
//   node tools/f4c-flaps.mjs --write    write them into aircraft/f4c/f4c.xml
// tests/f4c-low.test.js works them out again and holds the aircraft file to them, cell for cell.
//
// The data. NASA CR-2144 has the F-4C with its gear and flaps down at one flight condition: its number 1,
// the power approach (its Tables IV-1 and IV-2: sea level, 136 knots, Mach 0.206, 33,197 lb, the centre of
// gravity at 29.1% of the chord, trim angle of attack 11.7 degrees, stabilator -9.1, drag coefficient
// 0.242; its derivatives in Tables IV-3 and IV-13). The flaps are full (the trailing edge 60 degrees, with
// its blowing, "Boundary layer control is automatically induced when full flap deflection occurs", and the
// leading edge down), the gear is down. AFWAL-TR-80-3141 has nothing on flaps, gear, speedbrakes or ground
// effect: its airplane is "a relatively clean aircraft (no flap, slat, or gear deflection)"
// (aircraft/f4c/data/afwal-f4j.json, data_sources). No F-4 source read gives the two apart, or half flaps.
//
// What is matched. At condition 1, with the flaps full and the gear down, the airplane is to have
// CR-2144's lift, drag and pitching moment in trimmed level flight, and every one of its derivatives:
// exactly what tools/f4c-mach.mjs does for the nine clean conditions, on the same terms of AFWAL's build-up.
// So valuesAt (that tool) gives, at condition 1:
//   a factor on each of 17 terms      CR-2144's derivative over AFWAL's at 11.7 degrees angle of attack
//   two increments on the yaw terms   CR-2144's less AFWAL's (the yawing moment for roll rate, for aileron)
//   three levels                      what makes the airplane fly level at 11.7 degrees, with the stabilator at
//                                     -9.1 and CR-2144's drag: lift, drag and pitching moment added
// Below Mach 0.3 every Mach factor is 1 and every Mach level 0 (tools/f4c-mach.mjs), so at 136 knots the
// clean airplane is AFWAL's model alone, and these are everything that differs from it. Not all of that is
// the flaps: part of each factor is CR-2144's F-4C against AFWAL's F-4J at low speed, which the clean
// airplane does not have below Mach 0.5 (at Mach 0.6, clean, the same ratios run from 0.6 to 1.6). With no
// clean low-speed data for the F-4C that cannot be taken apart, and the whole is put on the flaps.
//
// Two things about condition 1 that the file's airplane cannot copy. Its centre of gravity is at 29.1% of the
// chord and its thrust line passes 0.57 ft above it (Table IV-2, LTH); the file's are 28.9% and 0.37 ft, at
// every weight. The aerodynamics are made from CR-2144's own numbers (the moment about 29.1%, and the thrust's
// moment on 0.57 ft), so they are the airframe's; flown at condition 1, the file's airplane trims a little
// off CR-2144's stabilator (tests/f4c-low.test.js says by how much).
//
// How it is split. Reasoned, all of it; the plan's words: "how full flaps + gear splits between the two".
//   the gear    drag only, and the pitching moment of that drag: GEAR_DRAG (Wings' F-4C card, gear_drag in
//               the middle of its range: 0.01 + 0.5 x 0.03 = 0.025), acting GEAR_ARM_FT below the centre of
//               gravity, so it pitches the nose down. No lift, and no change to any derivative. By gear position.
//   the flaps   all the rest: every factor and increment of condition 1, the lift, and the drag and the
//               pitching moment less the gear's. By flap position.
// Half flaps (the trailing edge 30 degrees, the leading edge down) have no data of their own: every factor
// and increment is halfway between clean and full. Reasoned: the leading edge is fully down at half flaps,
// so their lift near the stall may be more than half of full's. The flight manual says only "Stalls with
// one-half or full flaps display essentially identical characteristics."
//
// One exception, the owner's choice (27 November 2026): the stabilator's power. Full flaps leave the
// stabilator 58% of its pitching power (condition 1; the flight manual: "full flaps degrade stabilator
// effectiveness while the aircraft is on the ground"). With half of that loss at half flaps the nosewheel
// lifted at 166 knots on the takeoff setting, not at the owner's 150 (CLAUDE.md). Half flaps have no data
// either way, so the owner chose which gives: his 150 stands, and the half flaps' share of the loss is sized
// to it. HALF_FLAP_TAIL_SHARE, an eighth, is the size: the nosewheel lifts at 153 knots. (A quarter gives
// 157, a fifth 155, none 149; flaps up it lifts at 152.6, and the flight manual has the flaps-up airplane
// rotating "at lower than normal airspeeds", so an eighth is about as little as the share can be.)
// Reasoned, and the right side of the truth by what there is: the tail loses power to the downwash of the
// flaps' lift, and the blown trailing edge at 60 degrees lifts far more than twice what it does unblown at
// 30; the flight manual's F-4E appendix has the nosewheel lifting at 167 knots at 55,000 lb, which is about
// 140 at this weight (as the square root of the weight). The performance manual's own table of nosewheel
// lift-off speeds (T.O. 1F-4C-1-1) would settle it; no copy was found.
//
// The lift near the stall. CR-2144's condition 1 is at 11.7 degrees and says nothing above it. The flight
// manual does (figure 6-1, its stall chart): full flaps, gear down, 38,000 lb, the nose slice at "26 to 30
// units" and "STALL SPEED = 122-126 KCAS". AFWAL's clean wing bends over at 15 degrees, and the flaps' fixed
// increment on it stalls the airplane 10 knots too fast. So the flaps' lift grows above 12 degrees, by
// STALL_EXTRA at 22 degrees (the nose slice's onset in AFWAL's true angle of attack: 22 to 25.5 degrees for
// 26 to 30 units, tests/checkride/f4c-reference.js, NOSE_SLICE_ALPHA), held to 30 and gone by 50, where
// flaps are only drag. STALL_EXTRA is sized here so that at 22 degrees, at 38,000 lb, 1 g and power off,
// the airplane balances in pitch at the manual's 126 knots (the plan: flaps "Reasoned, sized to the flight
// manual's approach and stall speeds"). The manual's chart is headed "POWER-ON STALL SPEEDS"; the plan's
// line is power off, and this follows the line (tests/f4c-low.test.js reports the speed with power too).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FACTORS, FILE, INCREMENTS, WING, afwal, basic, conditionAt, rounded, valuesAt } from './f4c-mach.mjs';

const DEG = 180 / Math.PI, KT = 1.6878, RHO0 = 0.0023769;

/** CR-2144's condition 1 as its Table IV-1 gives the trim (stabilator and drag) and Table IV-2 the thrust line (LTH). */
export const POWER_APPROACH = { fc: 1, stabilator: -9.1, drag: 0.242, armFt: 0.57 };
/** The gear's drag coefficient, and how far below the centre of gravity it acts, ft. Reasoned (see the top). */
export const GEAR_DRAG = 0.025;
/** The middle of the gear's legs and wheels: they hang from the belly, 3.35 ft below the centre of gravity, to the tyres at 6.4 (the model, Wings' card); taken at 4.5. Reasoned. */
export const GEAR_ARM_FT = 4.5;
/** The flap positions the tables are written at: up, half (the trailing edge 30 degrees and the leading edge down) and full. */
export const FLAP_POSITIONS = [0, 0.5, 1];
/** The share of full flaps' loss of stabilator power that half flaps take (see the top of this file). */
export const HALF_FLAP_TAIL_SHARE = 0.125;
const TAIL = ['lift-stabilator', 'pitch-stabilator'];
/** The angles of attack the flaps' lift is written at, degrees (see the top). */
export const LIFT_ALPHAS = [12, 22, 30, 50];
/** The stall the extra lift is sized to: the flight manual's figure 6-1. */
export const STALL = { weightLb: 38000, alphaDeg: 22, knots: 126 };
/** The centre of gravity of the file's airplane, % of the chord (CR-2144, Table IV-2, the clean conditions). */
const CG = 28.9;

/** What condition 1 gives, as valuesAt works it out: { factor, increment } with increment.lift, drag, pitch, yaw-roll-rate, yaw-aileron. */
export function powerApproach() {
  return valuesAt(conditionAt(POWER_APPROACH.fc, POWER_APPROACH));
}

/**
 * The extra lift the flaps give at the nose slice (above): with full flaps and the gear down, 1 g at 38,000 lb
 * and 126 knots at sea level, power off, steady, the lift and the pitching moment both balance. Two equations,
 * straight lines in the two unknowns (the extra lift and the stabilator), solved.
 */
export function stallExtra(pa = powerApproach()) {
  const { S, CHORD, XREF } = WING(), a = STALL.alphaDeg, f = pa.factor, plus = pa.increment, shift = (CG - XREF) / 100;
  const q = 0.5 * RHO0 * (STALL.knots * KT) ** 2, wanted = STALL.weightLb / (q * S);
  const drag = basic.drag(a) + plus.drag;   // the flaps' and the gear's together: condition 1's
  // Lift: fixed + extra + stabilator x s = wanted.   Pitch: fixed + shift (lift cos a + drag sin a) + stabilator power x s = 0.
  const fixedLift = f['lift-basic'] * basic.lift(a) + plus.lift, liftPerDeg = f['lift-stabilator'] * afwal('CLSTAB', a);
  const fixedPitch = f['pitch-basic'] * basic.pitch(a) + plus.pitch, pitchPerDeg = f['pitch-stabilator'] * afwal('CMSTAB', a);
  const ca = Math.cos(a / DEG), sa = Math.sin(a / DEG);
  // With the lift at what is wanted, the pitch equation gives the stabilator; the lift equation then the extra.
  const stabilator = -(fixedPitch + shift * (wanted * ca + drag * sa)) / pitchPerDeg;
  return { extra: wanted - fixedLift - liftPerDeg * stabilator, stabilator, wanted, CHORD };
}

/** The tables: for each, its rows (the first number of a row the flap position, or the angle of attack), and its columns. */
export function flapTables() {
  const pa = powerApproach(), { extra } = stallExtra(pa), { CHORD } = WING();
  const byFlaps = (full, clean, atHalf = 0.5) => FLAP_POSITIONS.map((x) => [x, rounded(clean + (full - clean) * (x === 0.5 ? atHalf : x))]);
  const tables = {};
  for (const name of FACTORS) tables[`aero/flaps/factor/${name}`] = { rows: byFlaps(pa.factor[name], 1, TAIL.includes(name) ? HALF_FLAP_TAIL_SHARE : 0.5) };
  for (const name of INCREMENTS) tables[`aero/flaps/increment/${name}`] = { rows: byFlaps(pa.increment[name], 0) };
  const gearPitch = (-GEAR_DRAG * GEAR_ARM_FT) / CHORD;
  tables['aero/flaps/increment/drag'] = { rows: byFlaps(pa.increment.drag - GEAR_DRAG, 0) };
  tables['aero/flaps/increment/pitch'] = { rows: byFlaps(pa.increment.pitch - gearPitch, 0) };
  // The lift: rows the angle of attack, columns the flap position. Condition 1's up to 12 degrees (and below
  // zero: JSBSim holds a table's first row), the extra added by 22 and held to 30, nothing at 50.
  const full = [pa.increment.lift, pa.increment.lift + extra, pa.increment.lift + extra, 0];
  tables['aero/flaps/increment/lift'] = { columns: FLAP_POSITIONS, rows: LIFT_ALPHAS.map((alpha, k) => [alpha, ...FLAP_POSITIONS.map((x) => rounded(full[k] * x))]) };
  tables['aero/gear/increment/drag'] = { rows: [[0, 0], [1, GEAR_DRAG]] };
  tables['aero/gear/increment/pitch'] = { rows: [[0, 0], [1, rounded(gearPitch)]] };
  return tables;
}

const SAY = {
  factor: (name) => `Factor on the term ${name}, by flap position: 1 up, condition 1's (CR-2144 over AFWAL at 11.7 degrees) full, ${TAIL.includes(name) ? `an eighth of the way at half (the owner's choice: tools/f4c-flaps.mjs, HALF_FLAP_TAIL_SHARE)` : 'halfway at half'}.`,
  'aero/flaps/increment/yaw-roll-rate': 'Added to the yawing moment for roll rate, for each unit of p b/2V, by flap position: condition 1\'s full (CR-2144\'s less AFWAL\'s), halfway at half.',
  'aero/flaps/increment/yaw-aileron': 'Added to the yawing moment for the aileron with its spoiler, for each degree of aileron, by flap position: condition 1\'s full, halfway at half.',
  'aero/flaps/increment/drag': 'Added to the drag coefficient, by flap position: condition 1\'s level less the gear\'s drag, halfway at half.',
  'aero/flaps/increment/pitch': 'Added to the pitching-moment coefficient, by flap position: condition 1\'s level less the gear\'s drag\'s moment, halfway at half.',
  'aero/flaps/increment/lift': 'Added to the lift coefficient. Rows: the angle of attack; columns: the flap position. Condition 1\'s level to 12 degrees, the extra for the stall added by 22 and held to 30, none by 50; halfway at half flaps.',
  'aero/gear/increment/drag': 'Added to the drag coefficient, by gear position: GEAR_DRAG.',
  'aero/gear/increment/pitch': 'Added to the pitching-moment coefficient, by gear position: the gear\'s drag acting GEAR_ARM_FT below the centre of gravity, -GEAR_DRAG x GEAR_ARM_FT / chord (nose down).',
};
const number = (x) => (Object.is(x, -0) ? '0' : String(x));
const varOf = (name) => (name.startsWith('aero/gear') ? 'gear/gear-pos-norm' : 'fcs/flap-pos-norm');

/** The tables as they stand in the aircraft file. */
export function asXml(tables = flapTables()) {
  const lines = [];
  for (const [name, { rows, columns }] of Object.entries(tables)) {
    lines.push(`  <!-- ${name.startsWith('aero/flaps/factor/') ? SAY.factor(name.slice('aero/flaps/factor/'.length)) : SAY[name]} -->`);
    lines.push(`  <function name="${name}">`, '   <table>');
    if (columns) {
      lines.push('    <independentVar lookup="row"> aero/alpha-deg </independentVar>', '    <independentVar lookup="column"> fcs/flap-pos-norm </independentVar>', '    <tableData>');
      lines.push(`            ${columns.map((x) => String(x).padStart(12)).join(' ')}`);
      for (const row of rows) lines.push(`      ${String(row[0]).padStart(5)} ${row.slice(1).map((x) => number(x).padStart(12)).join(' ')}`);
    } else {
      lines.push(`    <independentVar lookup="row"> ${varOf(name)} </independentVar>`, '    <tableData>');
      for (const row of rows) lines.push(`      ${String(row[0]).padStart(5)} ${number(row[1]).padStart(12)}`);
    }
    lines.push('    </tableData>', '   </table>', '  </function>');
  }
  return `${lines.join('\n')}\n`;
}

export const MARKS = ['  <!-- FLAP AND GEAR TABLES: made by tools/f4c-flaps.mjs. Not edited by hand. -->\n', '  <!-- END OF FLAP AND GEAR TABLES -->\n'];
/** The part of the aircraft file between the two marks. */
export function inFile(text = readFileSync(FILE, 'utf8')) {
  const from = text.indexOf(MARKS[0]), to = text.indexOf(MARKS[1]);
  if (from < 0 || to < from) throw new Error('aircraft/f4c/f4c.xml has no FLAP AND GEAR TABLES marks');
  return { before: text.slice(0, from + MARKS[0].length), tables: text.slice(from + MARKS[0].length, to), after: text.slice(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = flapTables();
  if (process.argv.includes('--write')) {
    const { before, after } = inFile();
    writeFileSync(FILE, before + asXml(tables) + after);
    console.log(`wrote ${Object.keys(tables).length} tables into aircraft/f4c/f4c.xml`);
  } else {
    const pa = powerApproach(), s = stallExtra(pa);
    console.log('condition 1:', JSON.stringify(pa, null, 1));
    console.log(`the extra lift at ${STALL.alphaDeg} degrees for ${STALL.knots} knots at ${STALL.weightLb} lb: ${s.extra.toFixed(4)} (lift wanted ${s.wanted.toFixed(4)}, the stabilator ${s.stabilator.toFixed(2)} degrees)`);
    process.stdout.write(asXml(tables));
  }
}
