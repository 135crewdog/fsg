// How a simple airplane's engine's thrust changes with speed and height: the three tables of its engine file
// between the two "THRUST TABLES" marks, worked out here and nowhere by hand. New in FSG, milestone 3
// re-planned (docs/milestones/3-replan.md, pull request 3), after tools/f4c-thrust.mjs, which does the same for
// the data-built F-4C from NASA's drag.
//
//   node tools/simple-thrust.mjs            print the tables
//   node tools/simple-thrust.mjs --write    write them into the engine files
// tests/simple-f4c.test.js works them out again and holds the engine file to them, character for character.
//
// The plan (docs/milestones/3-replan.md, section 1): "Thrust is JSBSim's turbine and `direct` thruster for
// every airplane, jet or propeller: a table shaped like that engine's thrust, times the throttle." And for the
// simple F-4C: "Thrust falls off with speed and height by a plain rule, borrowing the data-built table where
// the top speeds need it." The plain rule alone meets both top speeds (tests/simple-f4c.test.js flies them), so
// nothing is borrowed.
//
// The rule for a jet is Wings' (135crewdog/wings, src/sim/engine.js, thrust, commit 6d689b7), which the owner
// flew: "Thrust thins with the air. With speed, a turbojet's MIL thrust sags a little and then recovers as ram
// air packs the intake; afterburner thrust climbs steeply with it."
//   with height   the air's density over its sea-level density, to the power 0.7
//   MIL           times 1 - 0.2 M + 0.25 M squared
//   afterburner   times 1 + 0.35 M squared
//   idle          5% of MIL
//   the Mach number counts up to 2.5, and no further
//
// How it goes into JSBSim's turbine (src/models/propulsion/FGTurbine.cpp, Run, v1.3.3): its three tables are
// fractions, by Mach number and density height. Idle thrust is the MIL rating times the idle table. Thrust at
// MIL is that plus (the rating less the idle thrust) times the MIL table; so the MIL table here is written as
// (m - i) / (1 - i), where m is the rule's MIL fraction and i its idle fraction, and the thrust at MIL comes
// out as the rule's. Full afterburner is the afterburner rating times its table. Between the tables' heights
// (every 10,000 ft, as JSBSim's own engines have them) JSBSim reads straight lines.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const inRepo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** The standard atmosphere's density over its sea-level density at a height, ft (the troposphere, then the even-temperature layer above 36,089 ft). */
export function densityRatio(heightFt) {
  const h = heightFt * 0.3048, T0 = 288.15;
  if (h <= 11000) { const T = T0 - 0.0065 * h; return (T / T0) ** (5.25588 - 1); }
  return (216.65 / T0) ** (5.25588 - 1) * Math.exp((-9.80665 * (h - 11000)) / (287.053 * 216.65));
}

/** Wings' rule: the fractions of the two ratings at a Mach number and a height. */
export function wingsJet(mach, heightFt) {
  const m = Math.min(Math.max(mach, 0), 2.5), lapse = densityRatio(heightFt) ** 0.7;
  const mil = lapse * (1 - 0.2 * m + 0.25 * m * m);
  return { idle: 0.05 * mil, mil, afterburner: lapse * (1 + 0.35 * m * m) };
}

/** The tables' Mach numbers (the last is where Wings' rule stops counting: JSBSim holds a table's last row) and density heights, ft. */
export const MACHS = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.5];
export const HEIGHTS = [-10000, 0, 10000, 20000, 30000, 40000, 50000, 60000];

/** Every simple airplane's engine: its file, its rule, and what its tables are fractions of. */
export const ENGINES = {
  'aircraft/f4c-simple/Engines/J79.xml': { rule: wingsJet, says: { mil: '10,900 lb', afterburner: '17,000 lb' } },
};

/** Four decimals, as JSBSim's own tables are written. */
export const DIGITS = 4;

/** The three tables of an engine, as { columns, rows: [[mach, ...cells]] }, rounded as they are written. */
export function thrustTables(rule) {
  const table = (cell) => ({ columns: HEIGHTS, rows: MACHS.map((mach) => [mach, ...HEIGHTS.map((h) => Number(cell(rule(mach, h)).toFixed(DIGITS)))]) });
  return {
    IdleThrust: table((f) => f.idle),
    MilThrust: table((f) => (f.mil - f.idle) / (1 - f.idle)),
    AugThrust: table((f) => f.afterburner),
  };
}

export function asXml(tables, says) {
  const SAY = {
    IdleThrust: `idle thrust, a fraction of the MIL rating (${says.mil}): 5% of the rule's MIL thrust`,
    MilThrust: `MIL thrust: the rule's fraction of ${says.mil}, written as JSBSim adds it to the idle thrust (tools/simple-thrust.mjs)`,
    AugThrust: `full afterburner thrust, a fraction of ${says.afterburner}`,
  };
  const lines = [];
  for (const name of ['IdleThrust', 'MilThrust', 'AugThrust']) {
    const { columns, rows } = tables[name];
    lines.push(`  <!-- ${SAY[name]}. Rows: Mach. Columns: density height, ft. -->`);
    lines.push(`  <function name="${name}">`, '   <table>', '    <independentVar lookup="row">velocities/mach</independentVar>', '    <independentVar lookup="column">atmosphere/density-altitude</independentVar>', '    <tableData>');
    lines.push(`         ${columns.map((h) => String(h).padStart(8)).join('')}`);
    for (const [mach, ...v] of rows) lines.push(`     ${mach.toFixed(1)} ${v.map((x) => x.toFixed(DIGITS).padStart(8)).join('')}`);
    lines.push('    </tableData>', '   </table>', '  </function>', '');
  }
  return lines.join('\n');
}

export const MARKS = ['  <!-- THRUST TABLES: made by tools/simple-thrust.mjs. Not edited by hand. -->\n', '  <!-- END OF THRUST TABLES -->\n'];
/** The part of an engine file between the two marks. */
export function inFile(path) {
  const text = readFileSync(inRepo(path), 'utf8'), from = text.indexOf(MARKS[0]), to = text.indexOf(MARKS[1]);
  if (from < 0 || to < from) throw new Error(`${path} has no THRUST TABLES marks`);
  return { before: text.slice(0, from + MARKS[0].length), tables: text.slice(from + MARKS[0].length, to), after: text.slice(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, { rule, says }] of Object.entries(ENGINES)) {
    const xml = asXml(thrustTables(rule), says);
    if (process.argv.includes('--write')) {
      const { before, after } = inFile(path);
      writeFileSync(inRepo(path), before + xml + after);
      console.log(`wrote the idle, MIL and afterburner tables into ${path}`);
    } else process.stdout.write(`${path}\n${xml}`);
  }
}
