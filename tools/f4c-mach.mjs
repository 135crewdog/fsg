// What Mach changes in the F-4C's aerodynamics: the tables of aircraft/f4c/f4c.xml between its two
// "MACH TABLES" marks, worked out here from the two records of data, and nowhere by hand.
// New in FSG, milestone 3 (docs/milestones/3.md, pull request 5, second half).
//
//   node tools/f4c-mach.mjs            print the tables and what they were made from
//   node tools/f4c-mach.mjs --write    write them into aircraft/f4c/f4c.xml
// tests/f4c-conditions.test.js works them out again and holds the aircraft file to them, cell for cell.
//
// The idea. AFWAL-TR-80-3141 (aircraft/f4c/data/afwal-f4j.json) gives each term of the aerodynamics its
// shape in angle of attack and sideslip, at low speed. NASA CR-2144 (aircraft/f4c/data/cr2144-f4c.json)
// gives the F-4C's stability derivatives at nine clean flight conditions from Mach 0.6 to 2.15, flexible
// airframe. So each term of AFWAL's build-up is multiplied by a factor that depends on Mach: at each of
// CR-2144's conditions, CR-2144's derivative divided by AFWAL's at that condition's trim angle of attack.
// The airplane then has CR-2144's derivative at each condition, and AFWAL's shape, scaled, away from it.
//
// Where a factor cannot do it, an increment is added instead (CR-2144's value less AFWAL's):
//   - the yawing moment for roll rate and for aileron, which in AFWAL's tables are small and change sign
//     near the conditions' angles of attack, so that a ratio there means nothing;
//   - the three levels: the lift, the drag and the pitching moment in trimmed level flight. A factor fixes
//     a slope, not a level. These have tables of their own (below).
//
// The factors' rows are Mach numbers: 0.5, where every factor is 1 and the two yaw increments 0, and then
// CR-2144's own eight. Below Mach 0.5 they hold their first row: AFWAL's high-angle-of-attack data are
// low-speed data, and CR-2144's one low-speed condition (the power approach) is with the flaps down. Above
// Mach 2.15 they hold their last row.
//
// Their columns are heights, 15,000 and 35,000 ft, held below and above. CR-2144 has two heights at one
// Mach number only (0.9: conditions 4 and 6), and there the flexible airframe's derivatives differ by up
// to a third. At every other Mach number it has one condition, and both columns carry it. So between
// CR-2144's conditions the factors are straight lines in Mach, through conditions flown at different
// heights; how the flexible airframe changes with height at one Mach is known only at 0.9. Reasoned: it is
// the simplest table that passes through all nine conditions. CR-2144's plotted derivative curves (in the
// record, by height) are the data for doing better.
//
// The three levels are done from CR-2144's plots, because that is where it gives them: the trim angle of
// attack and the trim stabilator against Mach in level flight at five heights, sea level to 55,000 ft (its
// trim plot), and the trimmed drag coefficient the same way (its CL and CD plot). At each Mach number and
// height on those plots, the three increments are what makes the airplane, with its factors as they are
// there, fly level at CR-2144's angle of attack, with CR-2144's stabilator and CR-2144's drag:
//   drag    CR-2144's plotted drag, less AFWAL's at the plotted trim angle of attack
//   lift    the weight less the thrust's upward part (CR-2144's CL line for the height, less its drag times
//           the tangent of the thrust line's angle), less the airplane's lift there without the increment
//   pitch   what holds the thrust's own moment, less the airplane's pitching moment there without it
// A first try carried the levels in the factors' rows, one condition for each Mach number, and it was
// wrong away from the conditions: Mach 0.6 came from 35,000 ft and 9 degrees of angle of attack, so at sea
// level the airplane trimmed a degree of stabilator off CR-2144's sea-level curve, and between Mach 0.5 and
// 0.6 its speed slowly ran away by itself (the pitching moment fell with speed there, which no curve of
// CR-2144's does). How the stabilator to trim changes with speed at one height is the airplane's speed
// stability, and it is these curves; so the levels follow them, height by height.
//
// The levels' first row, where they are 0, is Mach 0.3, the slowest CR-2144 plots: they do not stop at
// 0.5. The difference they correct is not a Mach effect alone: at small angles of attack AFWAL's drag is
// about twice CR-2144's (0.035 against its minimum of 0.0174) and its lift about 0.06 more, at every Mach
// number CR-2144 plots, and CR-2144's are the F-4C's own. A cell with no plotted point (the height's curves
// do not reach that Mach number) takes the nearest height's in its row. At one of the nine conditions the
// angle of attack is Table IV-2's, as for the factors (the plot agrees with it within 0.3 degrees).
//
// Read from CR-2144, for each clean condition (2 to 10):
//   Table IV-2    Mach, height, true airspeed, dynamic pressure, trim angle of attack, weight, inertias
//   Table IV-3    the longitudinal derivatives, in the airplane's own axes
//   Table IV-13   the lateral ones, in the airplane's own axes and "primed" (each already mixed with the
//                 other through the cross inertia)
//   its trim plot       the trim stabilator at the condition's Mach, on its height's curve
//   its CL and CD plot  the trimmed drag coefficient there
// and turned into coefficients by its own definitions (its appendices A to C, as the record's
// "cross_check" has them):
//   lift-curve slope           CL alpha = -Zw m V / (q S) - CD, with Zw turned to the flight path:
//                              Zw cos2 a - (Zu + Xw) sin a cos a + Xu sin2 a
//   pitch stiffness            Cm alpha = (Mw cos a - Mu sin a) Iy V / (q S c)
//   pitch damping              Cm q = 2 V Iy Mq / (q S c2);  Cm alpha-dot = 2 V2 Iy Mw-dot / (q S c2)
//   stabilator                 CL delta = -(Zd cos a - Xd sin a) m / (q S);  Cm delta = Md Iy / (q S c)
//   side force                 Cy beta = Yv m V / (q S);  Cy delta = Y*delta m V / (q S)
//   roll and yaw               first unprimed, L = L' - (Ixz/Ix) N' and N = N' - (Ixz/Iz) L'; then
//                              Cl = L Ix / (q S b), Cn = N Iz / (q S b), times 2V/b for the rate derivatives
// All are per radian; AFWAL's static and control tables are per degree. CR-2144's roll and yaw
// derivatives are about the airplane's own axes, as AFWAL's are, so nothing is turned. CR-2144's moments
// are about the centre of gravity (28.9% of the chord) and AFWAL's about 31%: the factors are worked out
// so that the airplane's moment about the centre of gravity, with JSBSim's own move of the forces from 31%
// in it, is CR-2144's.
//
// Left as AFWAL has them, because CR-2144 has no derivative for them: what sideslip adds to the pitching
// moment, the pitching moment of the aileron and the spoiler, and what sideslip takes from the
// stabilator's. Left out, as AFWAL leaves them out: CR-2144's lift for pitch rate and for the rate the
// angle of attack changes at (Zq, Zw-dot: about 1% of the airplane's own speed), and the stabilator's drag.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const inRepo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const CR = JSON.parse(readFileSync(inRepo('aircraft/f4c/data/cr2144-f4c.json')));
const AFWAL = JSON.parse(readFileSync(inRepo('aircraft/f4c/data/afwal-f4j.json')));
export const FILE = inRepo('aircraft/f4c/f4c.xml');

const DEG = 180 / Math.PI, G = 32.174;
/** CR-2144's reference wing (its Table IV-2's heading), the same as AFWAL's (its Table 5). */
const { S_ft2: S, b_ft: SPAN, c_bar_ft: CHORD } = CR.general_arrangement.printed;
/** AFWAL's reference centre and CR-2144's centre of gravity, percent of the chord: the forces' moments are moved by the difference. */
const XREF = AFWAL.table_5.rows.find((row) => row.symbol === 'Xref').value;
/** CR-2144's thrust line: tilted nose-up by this, and passing this far above the centre of gravity (Table IV-2: ITH, LTH). */
const THRUST_TILT = 5.25, THRUST_ARM_FT = 0.37;
/** AFWAL's spoiler for each degree of aileron: CR-2144's aileron derivatives have the spoiler in them, and AFWAL's are apart. */
const SPOILER = 1.433;
/** The Mach number at and below which the airplane is AFWAL's model alone. */
export const FADE_MACH = 0.5;
/** The tables' two columns, feet: CR-2144 has two heights at one Mach number only (0.9), 15,000 and 35,000 ft. */
export const HEIGHTS = [15000, 35000];

// ---- reading the two records ----

/** Straight lines between a table's points, its end values held. */
export function along(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs.at(-1)) return ys.at(-1);
  let i = 1;
  while (xs[i] < x) i++;
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
}
/** One of AFWAL's functions at an angle of attack, degrees, read without its sign. */
const afwal = (name, alpha) => along(AFWAL.table_9.functions[name].alpha_deg, AFWAL.table_9.functions[name].values, Math.abs(alpha));
const afwalConstant = (symbol) => AFWAL.table_3.rows.find((row) => row.symbol === symbol).value;
/** AFWAL's basic lift, drag and pitching moment with Table 1's rules for an angle of attack below zero. */
const basic = {
  lift: (alpha) => (alpha >= 0 ? afwal('CLBAS', alpha) : 2 * afwal('CLBAS', 0) - afwal('CLBAS', alpha)),
  drag: (alpha) => afwal('CDBAS', alpha),
  pitch: (alpha) => (alpha >= 0 ? 1 : -1) * afwal('CMBAS', alpha),
};
/** The slope of a function of the angle of attack, per degree, at an angle (the tables are straight lines between their points). */
const slope = (f, alpha, h = 0.01) => (f(alpha + h) - f(alpha - h)) / (2 * h);

/** A cell of one of CR-2144's tables: the value the record says to use (a misprint has `use_instead` in the table's doubt list). */
function cell(table, label, fc) {
  const { rows, doubt } = CR.tables[table], row = rows.find((r) => r.label.trim() === label);
  if (!row) throw new Error(`CR-2144 table ${table} has no row ${label}`);
  const corrected = doubt.find((d) => d.row === label && d.fc === fc && d.use_instead !== undefined);
  return corrected ? corrected.use_instead : row.values[fc - 1];
}
/** A plotted curve of CR-2144 at a Mach number: straight lines between the points measured from the page. */
const plotted = (curve, mach) => along(curve.map(([m]) => m), curve.map(([, value]) => value), mach);

/**
 * CR-2144's nine clean flight conditions (its numbers 2 to 10), each with what the tables are made from:
 * where it is, its trim, and its derivatives as coefficients per radian.
 */
export function conditions() {
  const out = [];
  for (let fc = 2; fc <= 10; fc++) {
    const two = (label) => cell('IV-2', label, fc), three = (label) => cell('IV-3', label, fc), thirteen = (label) => cell('IV-13', label, fc);
    const height = two('H(FT)'), heightFt = height === 'SL' ? 0 : Number(height.replace('K', '')) * 1000, curve = height === 'SL' ? 'SL' : String(heightFt);
    const mach = two('M(-)'), V = two('VTO(FPS)'), q = two('Q(PSF)'), alpha = two('ALPHA(DEG)'), weight = two('W(LBS)'), m = weight / G;
    const [Ix, Iy, Iz, Ixz] = ['IX (SLUG-FT SQ)', 'IY (SLUG-FT SQ)', 'IZ (SLUG-FT SQ)', 'IXZ(SLUG-FT SQ)'].map(two);
    const stabilator = plotted(CR.figures.trim.delta_s_deg[curve], mach), drag = plotted(CR.figures.CL_CD.CD.curves[curve], mach);
    const ca = Math.cos(alpha / DEG), sa = Math.sin(alpha / DEG);
    // Level and steady: thrust along its line equals the drag, and its upward part carries some of the weight.
    const thrust = (drag * q * S) / Math.cos((alpha + THRUST_TILT) / DEG);
    const lift = (weight - thrust * Math.sin((alpha + THRUST_TILT) / DEG)) / (q * S);
    const zw = three('ZW') * ca * ca - (three('ZU *') + three('XW')) * sa * ca + three('XU *') * sa * sa;
    const unprimed = (lPrimed, nPrimed) => [lPrimed - (Ixz / Ix) * nPrimed, nPrimed - (Ixz / Iz) * lPrimed];
    const rollAndYaw = (name, scale = 1) => {
      const [l, n] = unprimed(thirteen(`L${name}`), thirteen(`N${name}`));
      return [(l * Ix * scale) / (q * S * SPAN), (n * Iz * scale) / (q * S * SPAN)];
    };
    const [Clb, Cnb] = rollAndYaw('B\''), [Clp, Cnp] = rollAndYaw('P\'', (2 * V) / SPAN), [Clr, Cnr] = rollAndYaw('R\'', (2 * V) / SPAN);
    const [Clda, Cnda] = rollAndYaw('\'DA'), [Cldr, Cndr] = rollAndYaw('\'DR');
    out.push({
      fc, mach, heightFt, V, q, weight, alpha, stabilator, drag, thrust, lift,
      // The aerodynamic pitching moment about the centre of gravity that holds the thrust's own moment: the thrust line passes above it.
      pitch: (THRUST_ARM_FT * thrust) / (q * S * CHORD),
      derivatives: {
        CLa: (-zw * m * V) / (q * S) - drag, Cma: ((three('MW') * ca - three('MU *') * sa) * Iy * V) / (q * S * CHORD),
        Cmq: (2 * V * Iy * three('MQ')) / (q * S * CHORD ** 2), Cmad: (2 * V * V * Iy * three('MWD')) / (q * S * CHORD ** 2),
        CLd: (-(three('ZDS') * ca - three('XDS') * sa) * m) / (q * S), Cmd: (three('MDS') * Iy) / (q * S * CHORD),
        Cyb: (thirteen('YV') * m * V) / (q * S), Cyda: (thirteen('Y*DA') * m * V) / (q * S), Cydr: (thirteen('Y*DR') * m * V) / (q * S),
        Clb, Cnb, Clp, Cnp, Clr, Cnr, Clda, Cnda, Cldr, Cndr,
      },
    });
  }
  return out;
}

/**
 * The three levels at a trim point: what must be added to the lift, the drag and the pitching moment of the
 * airplane, with the factors `f` it has there, for it to fly level at this angle of attack with this
 * stabilator and this drag. `lift` and `pitch` are the aerodynamic lift coefficient and the pitching moment
 * about the centre of gravity that level flight needs (thrust's parts taken out); `shift` is how far the
 * centre of gravity is from AFWAL's reference centre, in chords. A level whose factor is not in `f` yet
 * is left out (the pitch's, while the factors are being worked out).
 */
function levelsAt({ alpha, stabilator, drag, lift, pitch, shift }, f) {
  const plus = { drag: drag - basic.drag(alpha) };
  plus.lift = lift - (f['lift-basic'] * basic.lift(alpha) + f['lift-stabilator'] * afwal('CLSTAB', alpha) * stabilator);
  if (f['pitch-basic'] !== undefined) {
    const moved = shift * (lift * Math.cos(alpha / DEG) + drag * Math.sin(alpha / DEG));
    plus.pitch = pitch - (f['pitch-basic'] * basic.pitch(alpha) + f['pitch-stabilator'] * afwal('CMSTAB', alpha) * stabilator + moved);
  }
  return plus;
}

/**
 * At one condition, what each table must be there. Factors are CR-2144's derivative over AFWAL's at the
 * condition's trim angle of attack; increments are CR-2144's value less AFWAL's.
 */
export function valuesAt(condition) {
  const { alpha: a, stabilator, drag, lift, pitch, derivatives: d } = condition;
  const shift = (CR.tables['IV-2'].rows.find((r) => r.label === 'C.G.(MGC)').values[condition.fc - 1] * 100 - XREF) / 100, chords = CHORD / SPAN;
  const ca = Math.cos(a / DEG), sa = Math.sin(a / DEG), at = (name) => afwal(name, a), slopeOf = (name) => slope((x) => afwal(name, x), a);
  const f = {}, plus = {};
  // Lift: the stabilator's, then the slope, then the level at the trim point.
  f['lift-stabilator'] = d.CLd / (at('CLSTAB') * DEG);
  f['lift-basic'] = (d.CLa - f['lift-stabilator'] * slopeOf('CLSTAB') * DEG * stabilator) / (slope(basic.lift, a) * DEG);
  // The three levels at the trim point (levelsAt, below): the airplane's lift and drag near the trim point are
  // needed for the move of their moment from 31% of the chord to the centre of gravity.
  Object.assign(plus, levelsAt({ alpha: a, stabilator, drag, lift, pitch, shift }, f));
  const liftNear = (x) => f['lift-basic'] * basic.lift(x) + plus.lift + f['lift-stabilator'] * afwal('CLSTAB', x) * stabilator;
  const moved = (x) => shift * (liftNear(x) * Math.cos(x / DEG) + (basic.drag(x) + plus.drag) * Math.sin(x / DEG));
  // Pitch: the stabilator's, the two dampings, the stiffness, then the level that makes the trim stabilator CR-2144's.
  f['pitch-stabilator'] = (d.Cmd - shift * f['lift-stabilator'] * at('CLSTAB') * DEG * ca) / (at('CMSTAB') * DEG);
  f['pitch-pitch-rate'] = d.Cmq / at('CMQ');
  f['pitch-alpha-rate'] = d.Cmad / at('CMAD');
  f['pitch-basic'] = (d.Cma - f['pitch-stabilator'] * slopeOf('CMSTAB') * DEG * stabilator - slope(moved, a) * DEG) / (slope(basic.pitch, a) * DEG);
  Object.assign(plus, levelsAt({ alpha: a, stabilator, drag, lift, pitch, shift }, f));
  // Side force. One factor for the aileron and the spoiler together: CR-2144's aileron has the spoiler in it.
  f['side-sideslip'] = d.Cyb / (at('CYB') * DEG);
  f['side-aileron'] = d.Cyda / ((afwalConstant('Cy_delta_a') + SPOILER * afwalConstant('Cy_delta_sp')) * DEG);
  f['side-rudder'] = d.Cydr / (at('CYDR') * DEG);
  // Roll.
  f['roll-sideslip'] = d.Clb / (at('CRB1') * DEG);
  f['roll-roll-rate'] = d.Clp / at('CRP1');
  f['roll-yaw-rate'] = d.Clr / at('CRR');
  f['roll-aileron'] = d.Clda / ((at('CRDA') + SPOILER * at('CRDSP')) * DEG);
  f['roll-rudder'] = d.Cldr / (at('CRDR') * DEG);
  // Yaw, about the centre of gravity: the side force's moment from 31% is in CR-2144's number and is taken out first.
  f['yaw-sideslip'] = (d.Cnb - shift * chords * d.Cyb) / (at('CNB1') * DEG);
  f['yaw-yaw-rate'] = d.Cnr / at('CNR');
  f['yaw-rudder'] = (d.Cndr - shift * chords * d.Cydr) / (at('CNDR') * DEG);
  plus['yaw-roll-rate'] = d.Cnp - at('CNP');                                                                  // for each unit of p b/2V
  plus['yaw-aileron'] = (d.Cnda - shift * chords * d.Cyda) / DEG - (at('CNDA') + SPOILER * at('CNDSP'));   // for each degree of aileron
  return { factor: f, increment: plus };
}

/** The factors, in the order of the aircraft file's terms, and the increments. */
export const FACTORS = ['lift-basic', 'lift-stabilator', 'side-sideslip', 'side-aileron', 'side-rudder', 'roll-sideslip', 'roll-roll-rate', 'roll-yaw-rate',
  'roll-aileron', 'roll-rudder', 'pitch-basic', 'pitch-pitch-rate', 'pitch-alpha-rate', 'pitch-stabilator', 'yaw-sideslip', 'yaw-yaw-rate', 'yaw-rudder'];
export const INCREMENTS = ['yaw-roll-rate', 'yaw-aileron'];
/** The three levels, each a table on CR-2144's plots' own grid of Mach numbers and heights. */
export const LEVELS = ['lift', 'drag', 'pitch'];
/** A factor that is another's: the spoiler goes with the aileron. And the terms CR-2144 says nothing about, which stay 1. */
export const SHARED = { 'side-spoiler': 'side-aileron', 'roll-spoiler': 'roll-aileron' };
export const UNCHANGED = ['drag-basic', 'pitch-sideslip', 'pitch-aileron', 'pitch-spoiler', 'yaw-roll-rate', 'yaw-aileron', 'yaw-spoiler'];

/** A cell as the aircraft file has it: four significant figures. */
const rounded = (x) => Number(x.toPrecision(4));

/** The Mach number at and below which the three levels are 0: the slowest CR-2144 plots. */
export const LEVEL_FADE_MACH = 0.3;
/** The levels' rows and columns: Mach numbers on CR-2144's plots (every condition's among them), and the plots' five heights. */
export const LEVEL_MACHS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3, 1.5, 1.8, 2.15];
export const LEVEL_HEIGHTS = [0, 15000, 35000, 45000, 55000];

/**
 * The trim point CR-2144 plots at a Mach number and a height, as levelsAt wants it; null where one of its
 * three curves (trim angle of attack, trim stabilator, drag) does not reach that Mach number. At one of the
 * nine conditions it is the condition's own.
 */
function plottedTrim(mach, heightFt, all) {
  const condition = all.find((c) => c.mach === mach && c.heightFt === heightFt);
  const shift = (CR.tables['IV-2'].rows.find((r) => r.label === 'C.G.(MGC)').values[1] * 100 - XREF) / 100;   // the clean conditions' centre of gravity
  if (condition) return { ...condition, shift };
  const key = heightFt === 0 ? 'SL' : String(heightFt);
  const curves = [CR.figures.trim.alpha0_deg[key], CR.figures.trim.delta_s_deg[key], CR.figures.CL_CD.CD.curves[key]];
  if (!curves.every((curve) => mach >= curve[0][0] - 1e-9 && mach <= curve.at(-1)[0] + 1e-9)) return null;
  const [alpha, stabilator, drag] = curves.map((curve) => plotted(curve, mach)), tilt = (alpha + THRUST_TILT) / DEG;
  // The weight as a lift coefficient is CR-2144's CL line for the height: a constant over Mach squared.
  const weight = CR.figures.CL_CD.CL.CL_times_M_squared[key] / mach ** 2;
  // Level and steady: thrust along its line equals the drag, its upward part carries some of the weight, and its moment is held.
  return { alpha, stabilator, drag, lift: weight - drag * Math.tan(tilt), pitch: (THRUST_ARM_FT * drag) / Math.cos(tilt) / CHORD, shift };
}

/** The three levels' tables, given the factors' tables: see the top of this file. */
export function levelTables(factors) {
  const all = conditions(), tables = Object.fromEntries(LEVELS.map((name) => [`aero/increment/${name}`, { columns: LEVEL_HEIGHTS, rows: [[LEVEL_FADE_MACH, ...LEVEL_HEIGHTS.map(() => 0)]], from: [] }]));
  for (const mach of LEVEL_MACHS) {
    const here = LEVEL_HEIGHTS.map((heightFt) => {
      const trim = plottedTrim(mach, heightFt, all);
      if (!trim) return null;
      // The airplane's factors at this Mach number and height, as its tables give them.
      const f = Object.fromEntries(['lift-basic', 'lift-stabilator', 'pitch-basic', 'pitch-stabilator'].map((name) => [name, lookup(factors[`aero/factor/${name}`], mach, heightFt)]));
      return levelsAt(trim, f);
    });
    // A height with no plotted point takes the nearest height's that has one.
    const filled = here.map((value, k) => value ?? here.map((v, j) => [Math.abs(j - k), j, v]).filter(([, , v]) => v).sort((x, y) => x[0] - y[0] || x[1] - y[1])[0]?.[2]);
    if (filled.includes(undefined)) throw new Error(`CR-2144 plots no trim at Mach ${mach}`);
    for (const name of LEVELS) {
      tables[`aero/increment/${name}`].rows.push([mach, ...filled.map((levels) => rounded(levels[name]))]);
      tables[`aero/increment/${name}`].from.push(here.map((value) => value !== null));
    }
  }
  return tables;
}

/**
 * The tables: for each factor and increment, its columns (heights, ft) and its rows (a Mach number, then a
 * value for each column). For the factors and the two yaw increments the first row is the fade, factors 1
 * and increments 0 at Mach 0.5; each other row is a Mach number CR-2144 has, with its one condition there
 * in both columns, or at Mach 0.9 the two conditions, one in each. The three levels' tables are levelTables'.
 */
export function machTables() {
  const all = conditions(), machs = [...new Set(all.map((c) => c.mach))].sort((x, y) => x - y);
  const tables = {};
  for (const name of FACTORS) tables[`aero/factor/${name}`] = { columns: HEIGHTS, rows: [[FADE_MACH, ...HEIGHTS.map(() => 1)]], from: [] };
  for (const name of INCREMENTS) tables[`aero/increment/${name}`] = { columns: HEIGHTS, rows: [[FADE_MACH, ...HEIGHTS.map(() => 0)]], from: [] };
  for (const mach of machs) {
    const here = all.filter((c) => c.mach === mach);
    // The condition for each column: the one at that height if CR-2144 has it, or else the only one.
    const forColumn = HEIGHTS.map((heightFt) => here.find((c) => c.heightFt === heightFt) ?? (here.length === 1 ? here[0] : null));
    if (forColumn.includes(null)) throw new Error(`CR-2144's conditions at Mach ${mach} do not fill the columns`);
    const values = forColumn.map(valuesAt);
    for (const name of FACTORS) tables[`aero/factor/${name}`].rows.push([mach, ...values.map((v) => rounded(v.factor[name]))]);
    for (const name of INCREMENTS) tables[`aero/increment/${name}`].rows.push([mach, ...values.map((v) => rounded(v.increment[name]))]);
    for (const table of Object.values(tables)) table.from.push(forColumn.map((c) => c.fc));
  }
  // The factors are rounded as the aircraft file has them before the levels are worked out with them.
  return { ...tables, ...levelTables(tables) };
}

/** A table at a Mach number and a height: straight lines between its rows and between its two columns, held at the ends, as JSBSim reads it. */
export function lookup(table, mach, heightFt) {
  const machs = table.rows.map((row) => row[0]);
  return along(table.columns, table.columns.map((_, k) => along(machs, table.rows.map((row) => row[k + 1]), mach)), heightFt);
}

// ---- the aircraft file ----

const SAY = {
  'aero/factor/lift-basic': 'the lift-curve slope',
  'aero/factor/lift-stabilator': 'the stabilator\'s lift',
  'aero/factor/side-sideslip': 'side force for sideslip',
  'aero/factor/side-aileron': 'side force for the aileron and the spoiler, which share it',
  'aero/factor/side-rudder': 'side force for the rudder',
  'aero/factor/roll-sideslip': 'rolling moment for sideslip (the dihedral effect)',
  'aero/factor/roll-roll-rate': 'the roll damping',
  'aero/factor/roll-yaw-rate': 'rolling moment for yaw rate',
  'aero/factor/roll-aileron': 'rolling moment for the aileron and the spoiler, which share it',
  'aero/factor/roll-rudder': 'rolling moment for the rudder',
  'aero/factor/pitch-basic': 'the pitch stiffness: where the lift acts, which moves aft as the airplane goes supersonic',
  'aero/factor/pitch-pitch-rate': 'the pitch damping',
  'aero/factor/pitch-alpha-rate': 'pitching moment for the rate the angle of attack changes at',
  'aero/factor/pitch-stabilator': 'the stabilator\'s pitching moment',
  'aero/factor/yaw-sideslip': 'yawing moment for sideslip (the weathercock stability)',
  'aero/factor/yaw-yaw-rate': 'the yaw damping',
  'aero/factor/yaw-rudder': 'yawing moment for the rudder',
  'aero/increment/lift': 'added to the lift coefficient: what makes the trim angle of attack CR-2144\'s plotted one',
  'aero/increment/drag': 'added to the drag coefficient: CR-2144\'s plotted trimmed drag, less AFWAL\'s at its plotted trim angle of attack',
  'aero/increment/pitch': 'added to the pitching-moment coefficient: what makes the trim stabilator CR-2144\'s plotted one',
  'aero/increment/yaw-roll-rate': 'added to the yawing moment for roll rate, for each unit of p b/2V',
  'aero/increment/yaw-aileron': 'added to the yawing moment for the aileron with its spoiler, for each degree of aileron',
};
const number = (x) => (Object.is(x, -0) ? '0' : String(x));

/** The tables as they stand in the aircraft file. */
export function asXml(tables = machTables()) {
  const lines = [];
  for (const [name, { columns, rows, from }] of Object.entries(tables)) {
    const rowsAre = LEVELS.some((level) => name === `aero/increment/${level}`)
      ? `Rows: Mach ${LEVEL_FADE_MACH}, then Mach numbers on CR-2144's plots. Columns: the plots' five heights; ${from.flat().filter((plottedThere) => !plottedThere).length} cells the curves do not reach take the nearest height's.`
      : `Rows: Mach ${FADE_MACH}, then CR-2144's conditions ${from.map((pair) => (pair[0] === pair[1] ? pair[0] : pair.join(' | '))).join(', ')}.`;
    lines.push(`  <!-- ${name.startsWith('aero/factor') ? 'Factor' : 'Increment'}: ${SAY[name]}. ${rowsAre} -->`);
    lines.push(`  <function name="${name}">`, '   <table>', '    <independentVar lookup="row"> velocities/mach </independentVar>', '    <independentVar lookup="column"> position/h-sl-ft </independentVar>', '    <tableData>');
    lines.push(`            ${columns.map((h) => String(h).padStart(12)).join(' ')}`);
    for (const row of rows) lines.push(`      ${String(row[0]).padStart(5)} ${row.slice(1).map((x) => number(x).padStart(12)).join(' ')}`);
    lines.push('    </tableData>', '   </table>', '  </function>');
  }
  return `${lines.join('\n')}\n`;
}

export const MARKS = ['  <!-- MACH TABLES: made by tools/f4c-mach.mjs from the two records in aircraft/f4c/data/. Not edited by hand. -->\n', '  <!-- END OF MACH TABLES -->\n'];
/** The part of the aircraft file between the two marks. */
export function inFile(text = readFileSync(FILE, 'utf8')) {
  const from = text.indexOf(MARKS[0]), to = text.indexOf(MARKS[1]);
  if (from < 0 || to < from) throw new Error('aircraft/f4c/f4c.xml has no MACH TABLES marks');
  return { before: text.slice(0, from + MARKS[0].length), tables: text.slice(from + MARKS[0].length, to), after: text.slice(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = machTables();
  if (process.argv.includes('--write')) {
    const { before, after } = inFile();
    writeFileSync(FILE, before + asXml(tables) + after);
    console.log(`wrote ${Object.keys(tables).length} tables into aircraft/f4c/f4c.xml`);
  } else {
    for (const c of conditions()) {
      console.log(`condition ${c.fc}: Mach ${c.mach} at ${c.heightFt} ft; trim angle of attack ${c.alpha}, stabilator ${c.stabilator.toFixed(2)}, drag coefficient ${c.drag.toFixed(4)}, lift ${c.lift.toFixed(4)}`);
      console.log(`  ${Object.entries(c.derivatives).map(([name, value]) => `${name} ${value.toPrecision(4)}`).join('  ')}`);
    }
    process.stdout.write(asXml(tables));
  }
}
