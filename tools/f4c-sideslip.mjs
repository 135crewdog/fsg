// How the F-4C's yaw, roll and side force bend with large sideslip: the tables of aircraft/f4c/f4c.xml between
// its two "SIDESLIP TABLES" marks, worked out here from NASA TN D-6425 (aircraft/f4c/data/tnd6425-f4.json) and
// AFWAL-TR-80-3141 (aircraft/f4c/data/afwal-f4j.json), and nowhere by hand. New in FSG, milestone 3
// (docs/milestones/3.md, pull request 10, round 3).
//
//   node tools/f4c-sideslip.mjs            print the tables
//   node tools/f4c-sideslip.mjs --write    write them into aircraft/f4c/f4c.xml
// tests/f4c-sideslip.test.js works them out again and holds the aircraft file to them, cell for cell.
//
// Why. AFWAL's Table 1 makes the yawing moment, rolling moment and side force from sideslip straight lines in
// sideslip at every sideslip (Cn_beta(alpha) x beta, and so on), and its base data are "an excellent model of the
// aircraft" only for -10 < beta < 10 (PDF p.39). TN D-6425, its source past the stall, measured them to 40
// degrees and says "each of the coefficients exhibit nonlinearities with respect to sideslip" (p.9). Flown past
// 10 degrees (pull request 10's recovery), the straight lines kept the jet turning where the report's curves
// bend back. Within 10 degrees the two do not agree (the record's cross-check: below the stall AFWAL's slopes come
// from its reference 16, not from this report), so the report's level is not used, only its bend:
//
//   term = AFWAL's slope x beta + D(alpha, beta),   D = C_report(alpha, beta) - s_report(alpha) x beta
//
// where C_report is the report's coefficient made odd in sideslip ((C(beta) - C(-beta)) / 2, which also takes out
// the tunnel's small asymmetry) and moved to AFWAL's reference (31% of the chord, 530 sq ft, 38.67 ft: the
// record's "axes_and_reference"), and s_report its own slope over plus and minus 10 degrees. D is 0 within 10
// degrees by rule, so nothing the file did there before moves. Between the report's angles of attack, straight
// lines; outside them (below -10, above 110) the nearest panel holds. Past the last sideslip a panel gives (20
// degrees up to 22.5 degrees of angle of attack, 40 from 25 up) the total, AFWAL's line plus D, is held at its
// value there (Reasoned: the report says nothing beyond, and a held total turns the jet neither way more): so D's
// rows run out to 180 degrees, falling as AFWAL's line rises. D is multiplied by the same Mach and flap factors as
// AFWAL's term, so the two scale together (at low speed, where departures happen, both factors are 1).
//
// The rolling moment from sideslip below zero angle of attack. AFWAL enters its table with |alpha|; the report
// measured -5 and -10 degrees and found the roll from sideslip falling through zero and reversing there, as a swept
// wing's does with its lift. So below zero the slope is AFWAL's value at zero times the report's ratio (its slope
// at that angle over its slope at zero), held below -10. This one changes small sideslip: CR-2144's condition 3
// trims at -0.3 degrees, and tools/f4c-mach.mjs takes this slope (rollSideslipSlope) for its factor there.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../aircraft/f4c/f4c.xml', import.meta.url));
export const RECORD = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/tnd6425-f4.json', import.meta.url)));
const AFWAL = JSON.parse(readFileSync(new URL('../aircraft/f4c/data/afwal-f4j.json', import.meta.url))).table_9.functions;

const along = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs.at(-1)) return ys.at(-1);
  let i = 1;
  while (xs[i] < x) i++;
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
};
const afwal = (name, alpha) => along(AFWAL[name].alpha_deg, AFWAL[name].values, Math.abs(alpha));

/** The report's coefficients moved to AFWAL's reference: side force, yawing and rolling moment (the record's "to_afwal"). */
const { wing_area_sqft: SD, span_ft: BD, mean_chord_ft: CD } = RECORD.axes_and_reference;
const SA = 530, BA = 38.67, DX = 0.02 * CD;
export function toAfwal(cy, cn, cl) {
  const kSb = (SD * BD) / (SA * BA);
  return { Cy: (SD / SA) * cy, Cn: kSb * (cn - (DX / BD) * cy), Cl: kSb * cl };
}

/** Each panel: its angle of attack, and at each sideslip it gives on both sides the odd part of each coefficient (AFWAL's reference). */
export const PANELS = RECORD.panels.map((p) => {
  const at = (name) => Object.fromEntries(p.coefficients[name].points.map((q) => [q.beta_deg, q.value]));
  const y = at('Cy'), n = at('Cn'), l = at('Cl');
  const moved = Object.fromEntries(Object.keys(n).filter((b) => b in y && b in l).map((b) => [b, toAfwal(y[b], n[b], l[b])]));
  const odd = {};
  for (const name of ['Cy', 'Cn', 'Cl']) {
    odd[name] = {};
    for (const b of Object.keys(moved).map(Number).filter((b) => b > 0 && -b in moved)) odd[name][b] = (moved[b][name] - moved[-b][name]) / 2;
  }
  // The report's own slope over plus and minus 10 degrees: least squares through zero at 5 and 10.
  const slope = Object.fromEntries(['Cy', 'Cn', 'Cl'].map((name) => [name, (5 * odd[name][5] + 10 * odd[name][10]) / (25 + 100)]));
  const last = Object.fromEntries(['Cy', 'Cn', 'Cl'].map((name) => [name, Math.max(...Object.keys(odd[name]).map(Number))]));
  return { alpha: p.alpha_deg, odd, slope, last };
});
const ALPHAS = PANELS.map((p) => p.alpha);
const panelAt = (alpha) => PANELS.find((p) => p.alpha === alpha);

/** The rolling moment from sideslip below zero angle of attack, as a share of AFWAL's at zero: the report's ratio, held below -10. */
export const ROLL_RATIO = PANELS.filter((p) => p.alpha <= 0).map((p) => [p.alpha, p.slope.Cl / panelAt(0).slope.Cl]);
/** AFWAL's rolling moment from sideslip at zero angle of attack, per degree. */
export const CRB1_AT_ZERO = AFWAL.CRB1.values[0];

/** The file's slope for each sideslip term at an angle of attack, per degree (AFWAL's rules; the roll's new rule below zero). */
export function afwalSlope(name, alpha) {
  if (name === 'Cy') return afwal('CYB', alpha);
  if (name === 'Cn') return afwal('CNB1', Math.min(Math.abs(alpha), 45));
  return rollSideslipSlope(alpha);
}
/** The rolling moment from sideslip, per degree, at an angle of attack: AFWAL's above zero, and below it AFWAL's at zero times the report's ratio. */
export function rollSideslipSlope(alpha) {
  if (alpha >= 0) return afwal('CRB1', alpha);
  return CRB1_AT_ZERO * along(ROLL_RATIO.map(([a]) => a), ROLL_RATIO.map(([, r]) => r), alpha);
}

/** The sideslip columns of the bend tables, degrees. */
export const BETAS = [-180, -40, -30, -20, -15, -10, 10, 15, 20, 30, 40, 180];

/** D(alpha, beta) for one term at one panel: 0 within 10 degrees; the report's bend to its last sideslip; then the total held. */
export function bend(name, panel, beta) {
  const b = Math.abs(beta), sign = Math.sign(beta);
  if (b <= 10) return 0;
  const d = (x) => panel.odd[name][x] - panel.slope[name] * x;
  if (b <= panel.last[name]) {
    const xs = Object.keys(panel.odd[name]).map(Number).filter((x) => x >= 10).sort((p, q) => p - q);
    return sign * along(xs, xs.map((x) => (x === 10 ? 0 : d(x))), b);
  }
  // Past the report's last sideslip: AFWAL's line plus D held at its value there.
  const L = panel.last[name], s = afwalSlope(name, panel.alpha), total = s * L + d(L);
  return sign * (total - s * b);
}

/** The three bend tables: rows the report's angles of attack, columns BETAS. */
export function sideslipTables() {
  const out = {};
  for (const [name, file] of [['Cy', 'side'], ['Cn', 'yaw'], ['Cl', 'roll']]) out[file] = PANELS.map((p) => [p.alpha, BETAS.map((b) => Number(bend(name, p, b).toFixed(5)))]);
  out.ratio = ROLL_RATIO.map(([a, r]) => [a, Number(r.toFixed(4))]);
  return out;
}

const fmt = (x, w = 9) => String(x).padStart(w);
export function asXml(t) {
  const lines = [];
  const table2 = (name, rows, what) => {
    lines.push(`  <!-- ${what} -->`, `  <function name="${name}">`, '   <table>', '    <independentVar lookup="row"> aero/alpha-deg </independentVar>',
      '    <independentVar lookup="column"> aero/beta-deg </independentVar>', '    <tableData>', `      ${''.padStart(6)}${BETAS.map((b) => fmt(b)).join('')}`);
    for (const [a, row] of rows) lines.push(`      ${fmt(a, 6)}${row.map((v) => fmt(v)).join('')}`);
    lines.push('    </tableData>', '   </table>', '  </function>', '');
  };
  table2('aero/sideslip/side-bend', t.side, 'Side force: D, the report\'s bend beyond 10 degrees of sideslip (no units).');
  table2('aero/sideslip/yaw-bend', t.yaw, 'Yawing moment about 31% of the chord: D, the report\'s bend beyond 10 degrees of sideslip (no units).');
  table2('aero/sideslip/roll-bend', t.roll, 'Rolling moment: D, the report\'s bend beyond 10 degrees of sideslip (no units).');
  lines.push('  <!-- The rolling moment from sideslip below zero angle of attack, as a share of AFWAL\'s at zero: the report\'s ratio, held below -10. -->',
    '  <function name="aero/sideslip/roll-share-below-zero">', '   <table>', '    <independentVar lookup="row"> aero/alpha-deg </independentVar>', '    <tableData>');
  for (const [a, r] of t.ratio) lines.push(`      ${fmt(a, 6)}${fmt(r)}`);
  lines.push('    </tableData>', '   </table>', '  </function>', '');
  for (const [term, file] of [['side-sideslip', 'side'], ['yaw-sideslip', 'yaw'], ['roll-sideslip', 'roll']]) {
    lines.push(`  <function name="aero/coefficient/${term}-bend">`, '   <product>', `    <property> aero/factor/${term} </property>`, `    <property> aero/flaps/factor/${term} </property>`,
      `    <property> aero/sideslip/${file}-bend </property>`, '   </product>', '  </function>');
  }
  lines.push('  <!-- Below zero angle of attack: (AFWAL\'s value at zero x the share) less what Table 1\'s |alpha| rule gave, times the sideslip. -->',
    '  <function name="aero/coefficient/roll-sideslip-below-zero">', '   <product>', '    <property> aero/factor/roll-sideslip </property>', '    <property> aero/flaps/factor/roll-sideslip </property>',
    '    <property> aero/beta-deg </property>', '    <ifthen>', '     <lt>', '      <property> aero/alpha-deg </property>', '      <value> 0 </value>', '     </lt>', '     <difference>', '      <product>',
    `       <value> ${CRB1_AT_ZERO} </value>`, '       <property> aero/sideslip/roll-share-below-zero </property>', '      </product>', '      <property> aero/table/CRB1 </property>', '     </difference>',
    '     <value> 0 </value>', '    </ifthen>', '   </product>', '  </function>');
  return `${lines.join('\n')}\n`;
}

export const MARKS = ['  <!-- SIDESLIP TABLES: made by tools/f4c-sideslip.mjs from aircraft/f4c/data/tnd6425-f4.json and afwal-f4j.json. Not edited by hand. -->\n', '  <!-- END OF SIDESLIP TABLES -->\n'];
export function inFile(text = readFileSync(FILE, 'utf8')) {
  const from = text.indexOf(MARKS[0]), to = text.indexOf(MARKS[1]);
  if (from < 0 || to < from) throw new Error('aircraft/f4c/f4c.xml has no SIDESLIP TABLES marks');
  return { before: text.slice(0, from + MARKS[0].length), tables: text.slice(from + MARKS[0].length, to), after: text.slice(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = sideslipTables();
  if (process.argv.includes('--write')) {
    const { before, after } = inFile();
    writeFileSync(FILE, before + asXml(t) + after);
    console.log('wrote the sideslip tables into aircraft/f4c/f4c.xml');
  } else process.stdout.write(asXml(t));
}
