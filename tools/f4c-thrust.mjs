// How the F-4C's engines' thrust changes with speed and height: the MIL and afterburner tables of
// aircraft/f4c/Engines/J79-GE-15.xml between its two "THRUST TABLES" marks, worked out here and nowhere by
// hand. New in FSG, milestone 3 (docs/milestones/3.md, pull request 11).
//
//   node tools/f4c-thrust.mjs            print the anchors and the tables
//   node tools/f4c-thrust.mjs --write    write the tables into the engine file
// tests/f4c-numbers.test.js works them out again, holds the engine file to them cell for cell, and flies the
// anchors in JSBSim.
//
// The plan's choice (docs/milestones/3.md, section 1, "The engines"): nobody publishes the J79-GE-15's thrust
// against speed and height, so the tables are JSBSim's own generic J79 (jsbsim-data/engine/J79-GE-11A.xml,
// Aeromatic's, read from there, never edited) "anchored to CR-2144 instead: along its zero-excess-thrust line
// the engines' thrust must equal its drag, and at its other conditions thrust must be at least the drag.
// Between those anchors the shape is JSBSim's."
//
// The anchors, all from NASA CR-2144's trimmed lift and drag plot (its figure IV-9, PDF p.78), as the record
// has it (aircraft/f4c/data/cr2144-f4c.json, figures.CL_CD), at the figure's own weight, 38,924 lb:
//   1. The zero-excess-thrust line, at the record's points at Mach 1.0, 1.2, 1.4, 1.6, 1.8 and 2.0 (the
//      Mach numbers of JSBSim's rows). Each point is a lift coefficient at a Mach number; in level flight
//      CL M^2 = W / (0.7 p S), which gives the air's pressure there and so its height in the standard
//      atmosphere (47,800 to 56,800 ft: all above the tropopause). The drag there is CR-2144's: its drag
//      curves are drawn along its five heights' level-flight lines, so at the point's Mach number the plot
//      has the drag at the lift of 45,000 ft and of 55,000 ft; between (and, at Mach 1.8 and 2.0, a little
//      beyond 55,000 ft) the drag is the parabola CD = a + b CL^2 through those two (the textbook drag
//      polar). The thrust of both engines in full afterburner there is the drag, W CD / CL.
//   2. Sea level. The figure's envelope ends at sea level at its speed restriction, not at the zero-excess-
//      thrust line, which does not come down to sea level: so in level flight at sea level the engines' thrust
//      is at least the drag up to where the restriction line crosses the sea-level line (Mach 1.14, from the
//      record's points). The least thrust that says so is thrust equal to the drag there: CR-2144's sea-level
//      drag curve, which beyond Mach 1.1 runs along its minimum-drag line (the record's note). Condition 3,
//      Mach 1.1 at sea level, is inside it. (The flight manual's own limit there, 750 knots, is Mach 1.134 at
//      sea level: the same place, within the figure's reading.)
// The other conditions (CR-2144's 2 and 4 to 9) are checked, not anchored: the thrust there is at least the
// drag (tests/f4c-numbers.test.js flies them level).
//
// What is JSBSim's, and how the anchors go in (Reasoned: the least change that meets them):
//   - The afterburner table is JSBSim's, cell by cell, times a factor. A row's factor is 1 where nothing
//     anchors it. At 40,000 ft and above it is the zero-excess-thrust anchor's for that row (one factor for
//     the row's 40,000, 50,000 and 60,000 ft cells, so JSBSim's proportions between them stand: above the
//     tropopause its thrust goes as the air's density, 0.62 from 40,000 to 50,000 ft against a density
//     ratio of 0.618). At sea level (and
//     -10,000 ft) the factor is the sea-level anchor's, on the two rows it falls between (Mach 1.0 and 1.2),
//     and 1 on every other row. Between sea level and 40,000 ft the factor runs straight with height.
//   - Beyond Mach 2.0, where the line ends (CR-2144's envelope ends at its speed restriction at Mach 2.1), the
//     table holds Mach 2.0's row, as JSBSim holds any table's last row, instead of JSBSim's thrust rising on
//     with speed: nothing anchors it there, and the flight manual has the J79's "transient operation zone"
//     from Mach 2.0 to 2.4 (section VII) and cuts its speed back at high inlet temperatures (section VII,
//     "The rpm maximum speed reduction starts at +45 C"). Carried on with Mach 2.0's factor instead, JSBSim's
//     rising rows took the jet level to Mach 2.7 at 36,000 ft (pull request 11, a throwaway run).
//   - JSBSim's tables have nothing at 60,000 ft (Aeromatic's way of ending them), which the plan says cannot
//     stand: the zero-excess-thrust line lies between 47,800 and 57,400 ft. So the MIL and afterburner
//     tables' 60,000 ft cells are JSBSim's own lapse carried on: the 50,000 ft cell times its own ratio to
//     the 40,000 ft cell. The idle table is left as JSBSim has it.
//   - The MIL table is JSBSim's but for that column: CR-2144's line is in full afterburner, and nothing it
//     gives anchors MIL. Sea-level static thrust is unchanged (the Mach 0 row at sea level is JSBSim's 1).
// What the factors come to is printed by the tool and the test.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const inRepo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const CR = JSON.parse(readFileSync(inRepo('aircraft/f4c/data/cr2144-f4c.json')));
export const FILE = inRepo('aircraft/f4c/Engines/J79-GE-15.xml');
/** JSBSim's own generic J79, the tables' starting point. In JSBSim's data, which is never edited. */
export const JSBSIM_J79 = inRepo('jsbsim/jsbsim-data/engine/J79-GE-11A.xml');

/** The figure's weight and CR-2144's wing (Table IV-2). */
export const WEIGHT_LB = 38924, S = CR.general_arrangement.printed.S_ft2;
/** Each engine's ratings, sea level, standing still (T.O. 1F-4C-1, section I): what JSBSim's table fractions are fractions of. */
export const MIL_LB = 10900, MAX_LB = 17000;
/** The Mach numbers of JSBSim's afterburner rows that the zero-excess-thrust line anchors. */
export const ZET_ROWS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
/** The heights at and above which a row's high-altitude factor holds, and at and below which its sea-level one does. */
export const HIGH_FT = 40000, LOW_FT = 0;

// ---- the standard atmosphere (pressure, lb/sq ft, at a pressure height, ft), as JSBSim's ----
const P0 = 2116.22, TROPOPAUSE_FT = 36089.24, P_TROPOPAUSE = 472.68, SCALE_FT = 20806.7;
export const pressureAt = (h) => (h <= TROPOPAUSE_FT ? P0 * (1 - 6.875586e-6 * h) ** 5.255876 : P_TROPOPAUSE * Math.exp(-(h - TROPOPAUSE_FT) / SCALE_FT));
export const heightOf = (p) => (p >= P_TROPOPAUSE ? (1 - (p / P0) ** (1 / 5.255876)) / 6.875586e-6 : TROPOPAUSE_FT - SCALE_FT * Math.log(p / P_TROPOPAUSE));

// ---- reading the record ----

/** Straight lines between [x, y, ...] points; null outside them. */
function on(points, x) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    if (x0 <= x && x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}
const FIG = CR.figures.CL_CD;
/** CL M^2 of each height's level-flight line (the record's measured line positions). */
const LINE = FIG.CL.CL_times_M_squared;

/** CR-2144's drag at a Mach number and a lift coefficient: the parabola through its 45,000 and 55,000 ft curves there. */
export function dragCoefficient(mach, cl) {
  const [[c1, d1], [c2, d2]] = ['45000', '55000'].map((h) => [LINE[h] / mach ** 2, on(FIG.CD.curves[h], mach)]);
  if (d1 === null || d2 === null) throw new Error(`CR-2144's 45,000 and 55,000 ft drag curves do not both reach Mach ${mach}`);
  const b = (d2 - d1) / (c2 ** 2 - c1 ** 2), a = d1 - b * c1 ** 2;
  return { cd: a + b * cl ** 2, from: [[c1, d1], [c2, d2]] };
}

/** The zero-excess-thrust anchors: at each of ZET_ROWS, the height and the drag the engines' full afterburner must equal. */
export function zetAnchors() {
  return ZET_ROWS.map((mach) => {
    const point = FIG.CL.zero_excess_thrust.points.find(([m]) => m === mach);
    if (!point) throw new Error(`the record has no zero-excess-thrust point at Mach ${mach}`);
    const cl = point[1], pressure = WEIGHT_LB / (0.7 * S * cl * mach ** 2), heightFt = heightOf(pressure);
    const { cd, from } = dragCoefficient(mach, cl);
    return { mach, cl, heightFt, cd, from, dragLb: (WEIGHT_LB * cd) / cl };
  });
}

/** The sea-level anchor: where the speed restriction crosses the sea-level line, and the drag there. */
export function seaLevelAnchor() {
  const restriction = FIG.CL.speed_restriction.points, k = LINE.SL;
  // Sloping part of the restriction (before its step at Mach 1.78): find where it meets CL = k / M^2.
  const sloping = restriction.filter(([m], i) => i === 0 || m > restriction[i - 1][0]).filter(([m]) => m < 1.78);
  let lo = sloping[0][0], hi = sloping.at(-1)[0];
  const gap = (m) => k / m ** 2 - on(sloping, m);
  if (!(gap(lo) > 0 && gap(hi) < 0)) throw new Error('the speed restriction does not cross the sea-level line');
  for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; if (gap(mid) > 0) lo = mid; else hi = mid; }
  const mach = Number(((lo + hi) / 2).toFixed(4));
  // CR-2144's sea-level drag: its curve to Mach 1.1, then (the record's note) along the minimum-drag line.
  const sl = FIG.CD.curves.SL, cd = mach <= sl.at(-1)[0] ? on(sl, mach) : on(FIG.CD.CD_min.points, mach);
  const q = 0.7 * P0 * mach ** 2;
  return { mach, cl: k / mach ** 2, heightFt: 0, cd, dragLb: cd * q * S };
}

// ---- JSBSim's tables ----

/** One of the engine file's tables, by name, as { columns, rows: [[mach, ...cells]] }. */
export function readTable(text, name) {
  const body = text.match(new RegExp(`<function name="${name}">[^]*?<tableData>([^]*?)</tableData>`));
  if (!body) throw new Error(`no table ${name}`);
  const lines = body[1].trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  return { columns: lines[0], rows: lines.slice(1) };
}

/** A table read as JSBSim reads it: straight lines between rows and between columns, its edges held. */
export function lookup({ columns, rows }, mach, heightFt) {
  const along = (xs, x) => { if (x <= xs[0]) return [0, 0]; if (x >= xs.at(-1)) return [xs.length - 1, 0]; let i = 0; while (xs[i + 1] < x) i++; return [i, (x - xs[i]) / (xs[i + 1] - xs[i])]; };
  const [r, u] = along(rows.map((row) => row[0]), mach), [c, t] = along(columns, heightFt);
  const at = (row) => { const v = rows[row].slice(1); return t === 0 ? v[c] : v[c] + t * (v[c + 1] - v[c]); };
  return u === 0 ? at(r) : at(r) + u * (at(r + 1) - at(r));
}

/** JSBSim's own MIL and afterburner tables, with the 60,000 ft column carried on by their own lapse. */
export function base() {
  const text = readFileSync(JSBSIM_J79, 'utf8'), out = {};
  for (const name of ['MilThrust', 'AugThrust']) {
    const { columns, rows } = readTable(text, name), i40 = columns.indexOf(40000), i50 = columns.indexOf(50000), i60 = columns.indexOf(60000);
    if (i50 !== i40 + 1 || i60 !== i50 + 1 || i60 !== columns.length - 1) throw new Error(`${name}: not the columns this tool knows`);
    out[name] = { columns, rows: rows.map(([mach, ...v]) => [mach, ...v.map((x, i) => (i === i60 ? (v[i50] * v[i50]) / v[i40] : x))]), jsbsim: { columns, rows } };
  }
  return out;
}

/** The factors, by row of the afterburner table: { mach, low, high }; and the anchors they meet. */
export function factors(aug = base().AugThrust) {
  const zet = zetAnchors(), sea = seaLevelAnchor(), machs = aug.rows.map((row) => row[0]);
  const high = new Map(), low = new Map();
  // Each anchored row alone: its 40,000 ft and higher cells all scaled by one factor, so the thrust read at the anchor's height is the drag.
  for (const a of zet) {
    if (!machs.includes(a.mach)) throw new Error(`JSBSim's afterburner table has no row at Mach ${a.mach}`);
    if (a.heightFt < HIGH_FT) throw new Error(`Mach ${a.mach}: the anchor at ${a.heightFt} ft is below ${HIGH_FT}`);
    high.set(a.mach, a.dragLb / (2 * MAX_LB * lookup(aug, a.mach, a.heightFt)));
  }
  // Sea level: the two rows either side of the anchor's Mach number, one factor.
  const below = Math.max(...machs.filter((m) => m <= sea.mach)), above = Math.min(...machs.filter((m) => m > sea.mach));
  const g = sea.dragLb / (2 * MAX_LB * lookup(aug, sea.mach, 0));
  low.set(below, g); low.set(above, g);
  return { rows: machs.map((mach) => ({ mach, low: low.get(mach) ?? 1, high: high.get(mach) ?? 1 })), zet, sea, between: [below, above] };
}

/** The factor for a cell: the sea-level one at and below sea level, the high one at and above 40,000 ft, straight between. */
export const factorAt = ({ low, high }, heightFt) => (heightFt <= LOW_FT ? low : heightFt >= HIGH_FT ? high : low + ((heightFt - LOW_FT) / (HIGH_FT - LOW_FT)) * (high - low));

/** Four decimals, as JSBSim's own tables are written. */
export const DIGITS = 4;
const round = (x) => Number(x.toFixed(DIGITS));

/** The two tables as they go in the engine file. */
export function thrustTables() {
  const { MilThrust, AugThrust } = base(), f = factors(AugThrust);
  const scaled = AugThrust.rows.map(([mach, ...v], i) => [mach, ...v.map((x, j) => round(x * factorAt(f.rows[i], AugThrust.columns[j])))]);
  // Beyond the last anchor the table holds the last anchored row, as JSBSim holds any table's last row.
  const last = scaled.find(([mach]) => mach === ZET_ROWS.at(-1));
  const aug = { columns: AugThrust.columns, rows: scaled.map(([mach, ...v]) => (mach > ZET_ROWS.at(-1) ? [mach, ...last.slice(1)] : [mach, ...v])) };
  const mil = { columns: MilThrust.columns, rows: MilThrust.rows.map(([mach, ...v]) => [mach, ...v.map(round)]) };
  return { MilThrust: mil, AugThrust: aug, factors: f };
}

const SAY = {
  MilThrust: 'MIL thrust, a fraction of 10,900 lb: JSBSim\'s generic J79 (Aeromatic), its 60,000 ft column carried on by its own lapse from 40,000 to 50,000 ft',
  AugThrust: 'full afterburner thrust, a fraction of 17,000 lb: JSBSim\'s generic J79 (Aeromatic), its 60,000 ft column carried on the same way, each row times its factor (tools/f4c-thrust.mjs): CR-2144\'s zero-excess-thrust line at 40,000 ft and up, its sea-level speed restriction at sea level, straight between; beyond Mach 2.0 Mach 2.0\'s row held',
};

export function asXml(tables = thrustTables()) {
  const lines = [];
  for (const name of ['MilThrust', 'AugThrust']) {
    const { columns, rows } = tables[name];
    lines.push(`  <!-- ${SAY[name]}. Rows: Mach. Columns: density height, ft. -->`);
    lines.push(`  <function name="${name}">`, '   <table>', '    <independentVar lookup="row">velocities/mach</independentVar>', '    <independentVar lookup="column">atmosphere/density-altitude</independentVar>', '    <tableData>');
    lines.push(`         ${columns.map((h) => String(h).padStart(8)).join('')}`);
    for (const [mach, ...v] of rows) lines.push(`     ${mach.toFixed(1)} ${v.map((x) => x.toFixed(DIGITS).padStart(8)).join('')}`);
    lines.push('    </tableData>', '   </table>', '  </function>', '');
  }
  return lines.join('\n');
}

export const MARKS = ['  <!-- THRUST TABLES: made by tools/f4c-thrust.mjs from JSBSim\'s J79 and NASA CR-2144\'s record. Not edited by hand. -->\n', '  <!-- END OF THRUST TABLES -->\n'];
/** The part of the engine file between the two marks. */
export function inFile(text = readFileSync(FILE, 'utf8')) {
  const from = text.indexOf(MARKS[0]), to = text.indexOf(MARKS[1]);
  if (from < 0 || to < from) throw new Error('the engine file has no THRUST TABLES marks');
  return { before: text.slice(0, from + MARKS[0].length), tables: text.slice(from + MARKS[0].length, to), after: text.slice(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = thrustTables();
  if (process.argv.includes('--write')) {
    const { before, after } = inFile();
    writeFileSync(FILE, before + asXml(tables) + after);
    console.log('wrote the MIL and afterburner tables into aircraft/f4c/Engines/J79-GE-15.xml');
  } else {
    const { zet, sea, rows } = tables.factors;
    for (const a of zet) console.log(`zero excess thrust, Mach ${a.mach}: CL ${a.cl}, ${a.heightFt.toFixed(0)} ft, CD ${a.cd.toFixed(4)} (from ${JSON.stringify(a.from.map(([c, d]) => [Number(c.toFixed(4)), d]))}), drag ${a.dragLb.toFixed(0)} lb`);
    console.log(`sea level: the speed restriction crosses at Mach ${sea.mach} (CL ${sea.cl.toFixed(4)}), CD ${sea.cd.toFixed(4)}, drag ${sea.dragLb.toFixed(0)} lb`);
    for (const r of rows) console.log(`row Mach ${r.mach}: factor ${r.low.toFixed(4)} at sea level, ${r.high.toFixed(4)} at 40,000 ft and up`);
    process.stdout.write(asXml(tables));
  }
}
