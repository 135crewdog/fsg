// From 135crewdog/FDM, tests/lib/compare.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Trace comparison, exactly as frozen in REPORT.md part 2 ("How traces are compared").
// A trace is rows x columns of 64-bit floats; row 0 is the state after RunIC.

// export interface Trace {
//   columns: string[];
//   rows: number;
//   data: Float64Array;
// }

// export type Tolerance =
//   | { kind: "abs"; tol: number } // |d| <= tol
//   | { kind: "rel"; factor: number; floor: number; angle?: boolean } // |d| <= factor * max(peak, floor)
//   | { kind: "equal" } // d == 0
  // reported, never judged

export const TIME_COLUMN = "simulation/sim-time-sec";
const TIME_TOL = 1e-12;

const POSITION = /^position\/(ecef-[xyz]-ft|h-sl-ft|h-agl-ft)$/;
const SPEED = /^velocities\/([uvw]-fps|vtrue-kts)$/;
const RATE = /^velocities\/[pqr]-rad_sec$/;
const ANGLE = /^attitude\/(phi|theta|psi)-rad$/;
const FORCE = /^(forces\/fb[xyz]-(total|external)-lbs|moments\/[lmn]-(total|external)-lbsft)$/;
const CONTACT = /\/WOW$/;

/** Class A (rounding level). `widen` = 1000 gives Class S (script sweep). */
export function classTolerance(column, widen = 1) {
  if (POSITION.test(column)) return { kind: "abs", tol: 1e-6 * widen };
  if (SPEED.test(column)) return { kind: "rel", factor: 1e-9 * widen, floor: 1 };
  if (RATE.test(column)) return { kind: "rel", factor: 1e-9 * widen, floor: 1e-3 };
  if (ANGLE.test(column)) return { kind: "rel", factor: 1e-9 * widen, floor: 1e-3, angle: true };
  if (FORCE.test(column)) return { kind: "rel", factor: 1e-9 * widen, floor: 1 };
  if (CONTACT.test(column)) return { kind: "equal" };
  return { kind: "info" };
}
export const classA = (column) => classTolerance(column, 1);
export const classS = (column) => classTolerance(column, 1000);

export function isAngle(column) {
  return ANGLE.test(column);
}

/** Wraps an angle difference into (-pi, pi]. */
export function wrapAngle(d) {
  const twoPi = 2 * Math.PI;
  let w = d % twoPi;
  if (w > Math.PI) w -= twoPi;
  if (w <= -Math.PI) w += twoPi;
  return w;
}

// export interface ColumnResult {
//   column: string;
//   judged: boolean;
//   maxAbs: number; // largest |wasm - native| in the window
//   rowOfMax: number;
//   peak: number; // largest |native| in the window
//   allowed: number; // NaN when not judged
//   pass: boolean;
//   firstRowOver: number; // first row above the allowance, -1 if none
// }

// export interface CompareResult {
//   /** Set when the comparison was refused; a refusal is a failure. */
//   refused?: string;
//   pass: boolean;
//   rowsJudged: number;
//   columns: ColumnResult[];
// }

// export interface CompareOptions {
//   tolerance: (column: string) => Tolerance;
//   /** Judge only rows whose sim time minus the first row's sim time is <= this many seconds. */
//   windowSeconds?: number;
//   /** Judge only rows whose sim time is <= this many seconds. */
//   untilSimTime?: number;
// }

function refuse(reason) {
  return { refused: reason, pass: false, rowsJudged: 0, columns: [] };
}

/** Number of leading rows inside the judged window. */
export function windowRows(t, opt) {
  const tc = t.columns.indexOf(TIME_COLUMN);
  if (tc < 0 || (opt.windowSeconds === undefined && opt.untilSimTime === undefined)) return t.rows;
  const n = t.columns.length;
  const t0 = t.rows > 0 ? t.data[tc] : 0;
  let rows = 0;
  for (let r = 0; r < t.rows; r++) {
    const time = t.data[r * n + tc];
    if (opt.windowSeconds !== undefined && time - t0 > opt.windowSeconds + 1e-9) break;
    if (opt.untilSimTime !== undefined && time > opt.untilSimTime + 1e-9) break;
    rows = r + 1;
  }
  return rows;
}

/** Compares `test` against the reference `native`. */
export function compareTraces(native, test, opt) {
  const n = native.columns.length;
  if (n !== test.columns.length || native.columns.some((c, i) => c !== test.columns[i])) return refuse("column lists differ");
  if (native.rows !== test.rows) return refuse(`row counts differ: ${native.rows} vs ${test.rows}`);
  if (native.data.length !== native.rows * n || test.data.length !== test.rows * n) return refuse("data length does not match rows x columns");
  if (native.rows === 0) return refuse("empty trace");
  for (let i = 0; i < native.data.length; i++) {
    if (!Number.isFinite(native.data[i]) || !Number.isFinite(test.data[i])) {
      return refuse(`NaN or Inf at row ${Math.floor(i / n)}, column ${native.columns[i % n]}`);
    }
  }
  const tc = native.columns.indexOf(TIME_COLUMN);
  if (tc < 0) return refuse(`no ${TIME_COLUMN} column`);
  for (let r = 0; r < native.rows; r++) {
    if (Math.abs(native.data[r * n + tc] - test.data[r * n + tc]) > TIME_TOL) return refuse(`sim time differs at row ${r}`);
  }
  const rows = windowRows(native, opt);
  if (rows === 0) return refuse("no rows inside the judged window");

  const columns = [];
  let pass = true;
  for (let c = 0; c < n; c++) {
    const name = native.columns[c];
    if (c === tc) continue;
    const tol = opt.tolerance(name);
    const angle = isAngle(name);
    let peak = 0;
    for (let r = 0; r < rows; r++) peak = Math.max(peak, Math.abs(native.data[r * n + c]));
    let allowed = NaN;
    if (tol.kind === "abs") allowed = tol.tol;
    else if (tol.kind === "rel") allowed = tol.factor * Math.max(peak, tol.floor);
    else if (tol.kind === "equal") allowed = 0;
    let maxAbs = 0, rowOfMax = 0, firstRowOver = -1;
    for (let r = 0; r < rows; r++) {
      let d = test.data[r * n + c] - native.data[r * n + c];
      if (angle) d = wrapAngle(d);
      const a = Math.abs(d);
      if (a > maxAbs) { maxAbs = a; rowOfMax = r; }
      if (tol.kind !== "info" && a > allowed && firstRowOver < 0) firstRowOver = r;
    }
    const judged = tol.kind !== "info";
    const ok = !judged || firstRowOver < 0;
    if (!ok) pass = false;
    columns.push({ column: name, judged, maxAbs, rowOfMax, peak, allowed, pass: ok, firstRowOver });
  }
  return { pass, rowsJudged: rows, columns };
}

/** True when both traces have the same shape and every value has the same 64 bits. */
export function bitEqual(a, b) {
  if (a.columns.length !== b.columns.length || a.columns.some((c, i) => c !== b.columns[i])) return { equal: false, reason: "column lists differ" };
  if (a.rows !== b.rows) return { equal: false, reason: `row counts differ: ${a.rows} vs ${b.rows}` };
  if (a.data.length !== b.data.length) return { equal: false, reason: "data lengths differ" };
  const x = new BigUint64Array(a.data.buffer, a.data.byteOffset, a.data.length);
  const y = new BigUint64Array(b.data.buffer, b.data.byteOffset, b.data.length);
  const n = a.columns.length;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return { equal: false, reason: `first difference at row ${Math.floor(i / n)}, column ${a.columns[i % n]}: ${a.data[i]} vs ${b.data[i]}` };
  }
  return { equal: true, reason: "" };
}

// --- Class B: sensitive scripts, whole run -----------------------------------------------------------------

// export interface ClassBColumn {
//   column: string;
//   cap: number;
//   spread: number; // S: largest |member - native| over all rows and members
//   allowed: number; // max(cap, 3 * S)
//   maxAbs: number; // largest |wasm - native|
//   rowOfMax: number;
//   pass: boolean;
// }

export const CLASS_B_CAPS = [
  ["position/h-sl-ft", 1],
  ["attitude/phi-rad", 0.05],
  ["attitude/theta-rad", 0.05],
  ["attitude/psi-rad", 0.05],
  ["velocities/vtrue-kts", 1],
];

export function classB(native, test, ensemble, untilSimTime) {
  const base = compareTraces(native, test, { tolerance: () => ({ kind: "info" }), untilSimTime });
  if (base.refused) return { refused: `wasm vs native: ${base.refused}`, pass: false, rowsJudged: 0, columns: [] };
  const rows = base.rowsJudged;
  const n = native.columns.length;
  for (const [i, m] of ensemble.entries()) {
    // Members may end at a slightly different row count only if the script ends differently; require the window.
    if (m.columns.length !== n || m.rows < rows) return { refused: `ensemble member ${i} has a different shape`, pass: false, rowsJudged: 0, columns: [] };
    for (let k = 0; k < rows * n; k++) if (!Number.isFinite(m.data[k])) return { refused: `ensemble member ${i} has NaN or Inf`, pass: false, rowsJudged: 0, columns: [] };
  }
  const out = [];
  let pass = true;
  for (const [column, cap] of CLASS_B_CAPS) {
    const c = native.columns.indexOf(column);
    if (c < 0) return { refused: `column ${column} missing`, pass: false, rowsJudged: 0, columns: [] };
    const angle = isAngle(column);
    let spread = 0;
    for (const m of ensemble) {
      for (let r = 0; r < rows; r++) {
        let d = m.data[r * n + c] - native.data[r * n + c];
        if (angle) d = wrapAngle(d);
        spread = Math.max(spread, Math.abs(d));
      }
    }
    const res = base.columns.find((x) => x.column === column);
    const allowed = Math.max(cap, 3 * spread);
    const ok = res.maxAbs <= allowed;
    if (!ok) pass = false;
    out.push({ column, cap, spread, allowed, maxAbs: res.maxAbs, rowOfMax: res.rowOfMax, pass: ok });
  }
  return { pass, rowsJudged: rows, columns: out };
}

// --- Class N: noise-relative, for runs that touch the ground (REPORT.md part 2, "Added lines") --------------

const POSITION_OR_CONTACT = (column) => POSITION.test(column) || CONTACT.test(column);

/** True when any wheel or contact flag is 1 on any judged row. */
export function touchesGround(t, rows) {
  const n = t.columns.length;
  const idx = t.columns.map((c, i) => (CONTACT.test(c) ? i : -1)).filter((i) => i >= 0);
  for (let r = 0; r < rows; r++) for (const i of idx) if (t.data[r * n + i] !== 0) return true;
  return false;
}

// export interface ClassNColumn extends ColumnResult {
//   frozenAllowed: number; // F
//   spread: number; // S
// }

// export interface ClassNResult {
//   refused?: string;
//   pass: boolean;
//   rowsJudged: number;
//   membersWithEffect: number;
//   columns: ClassNColumn[];
// }

/**
 * Class N. `frozen` is the run's frozen class (classA or classS). The ensemble members are native runs with
 * the start altitude moved by k * 2^-28 ft. Pass per column: max |test - native| <= max(F, 3 S); positions
 * and contact flags keep F only.
 */
export function classN(native, test, ensemble, opt) {
  const none = (refused) => ({ refused, pass: false, rowsJudged: 0, membersWithEffect: 0, columns: [] });
  const base = compareTraces(native, test, opt);
  if (base.refused) return none(`wasm vs native: ${base.refused}`);
  const rows = base.rowsJudged;
  const n = native.columns.length;
  // Each member is checked like any trace: same shape, finite, same sim time. (Info tolerance: nothing is judged.)
  let membersWithEffect = 0;
  for (const [i, m] of ensemble.entries()) {
    const check = compareTraces(native, m, { ...opt, tolerance: () => ({ kind: "info" }) });
    if (check.refused) return none(`ensemble member ${i}: ${check.refused}`);
    let differs = false;
    for (let c = 0; c < n && !differs; c++) if (m.data[c] !== native.data[c]) differs = true;
    if (differs) membersWithEffect++;
  }
  if (membersWithEffect < 4) return none(`only ${membersWithEffect} of ${ensemble.length} ensemble members differ from native at row 0`);

  const tc = native.columns.indexOf(TIME_COLUMN);
  const columns = [];
  let pass = true;
  for (const col of base.columns) {
    const c = native.columns.indexOf(col.column);
    if (c === tc) continue;
    const angle = isAngle(col.column);
    let spread = 0;
    for (const m of ensemble) {
      for (let r = 0; r < rows; r++) {
        let d = m.data[r * n + c] - native.data[r * n + c];
        if (angle) d = wrapAngle(d);
        spread = Math.max(spread, Math.abs(d));
      }
    }
    const frozenAllowed = col.allowed;
    const allowed = !col.judged ? NaN : POSITION_OR_CONTACT(col.column) ? frozenAllowed : Math.max(frozenAllowed, 3 * spread);
    let firstRowOver = -1;
    if (col.judged) {
      for (let r = 0; r < rows && firstRowOver < 0; r++) {
        let d = test.data[r * n + c] - native.data[r * n + c];
        if (angle) d = wrapAngle(d);
        if (Math.abs(d) > allowed) firstRowOver = r;
      }
    }
    const ok = !col.judged || firstRowOver < 0;
    if (!ok) pass = false;
    columns.push({ ...col, allowed, pass: ok, firstRowOver, frozenAllowed, spread });
  }
  return { pass, rowsJudged: rows, membersWithEffect, columns };
}

export function describeN(r) {
  if (r.refused) return `REFUSED: ${r.refused}`;
  let worst;
  let worstRatio = -1;
  for (const c of r.columns) {
    if (!c.judged) continue;
    const ratio = c.allowed > 0 ? c.maxAbs / c.allowed : c.maxAbs > 0 ? Infinity : 0;
    if (ratio > worstRatio) { worstRatio = ratio; worst = c; }
  }
  if (!worst) return `${r.pass ? "pass" : "FAIL"} (no judged columns)`;
  return `${r.pass ? "pass" : "FAIL"} rows ${r.rowsJudged}, ${r.membersWithEffect} members with effect; closest to its limit: ${worst.column}: |d| ${fmt(worst.maxAbs)}, ` +
    `allowed ${fmt(worst.allowed)} (frozen ${fmt(worst.frozenAllowed)}, 3 x spread ${fmt(3 * worst.spread)}), ratio ${worstRatio.toFixed(3)}` +
    (worst.firstRowOver >= 0 ? `, first over at row ${worst.firstRowOver}` : "");
}

export function tableN(r) {
  if (r.refused) return `REFUSED: ${r.refused}\n`;
  let s = "column | judged | max |d| wasm-native | frozen allowance F | ensemble spread S | allowed max(F, 3S) | result\n";
  for (const c of r.columns) {
    s += `${c.column} | ${c.judged ? "yes" : "info"} | ${fmt(c.maxAbs)} | ${fmt(c.frozenAllowed)} | ${fmt(c.spread)} | ${fmt(c.allowed)} | ${c.judged ? (c.pass ? "pass" : `FAIL from row ${c.firstRowOver}`) : "-"}\n`;
  }
  return s;
}

// --- reporting ---------------------------------------------------------------------------------------------

export function fmt(x) {
  if (Number.isNaN(x)) return "-";
  if (x === 0) return "0";
  return x.toExponential(2);
}

/** One line per judged column that is the worst relative to its allowance, plus a summary. */
export function worstColumn(r) {
  let worst;
  let worstRatio = -1;
  for (const c of r.columns) {
    if (!c.judged) continue;
    const ratio = c.allowed > 0 ? c.maxAbs / c.allowed : c.maxAbs > 0 ? Infinity : 0;
    if (ratio > worstRatio) { worstRatio = ratio; worst = c; }
  }
  return worst;
}

export function describe(r) {
  if (r.refused) return `REFUSED: ${r.refused}`;
  const w = worstColumn(r);
  if (!w) return `${r.pass ? "pass" : "FAIL"} (no judged columns)`;
  return `${r.pass ? "pass" : "FAIL"} rows ${r.rowsJudged}; worst ${w.column}: |d| ${fmt(w.maxAbs)} at row ${w.rowOfMax}, allowed ${fmt(w.allowed)}` +
    (w.firstRowOver >= 0 ? `, first over at row ${w.firstRowOver}` : "");
}

export function table(r) {
  if (r.refused) return `REFUSED: ${r.refused}\n`;
  let s = "column | judged | max |d| | row | peak |native| | allowed | result\n";
  for (const c of r.columns) {
    s += `${c.column} | ${c.judged ? "yes" : "info"} | ${fmt(c.maxAbs)} | ${c.rowOfMax} | ${fmt(c.peak)} | ${fmt(c.allowed)} | ${c.judged ? (c.pass ? "pass" : `FAIL from row ${c.firstRowOver}`) : "-"}\n`;
  }
  return s;
}
