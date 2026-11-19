// From 135crewdog/FDM, tests/compare-selftest.test.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// The comparator must refuse or fail deliberately bad traces, and pass good ones.
// Developed on synthetic traces only, before any real native-vs-wasm comparison (REPORT.md part 2).
import assert from "node:assert/strict";
import { test } from "node:test";

import { bitEqual, classA, classB, classN, classS, compareTraces, touchesGround } from "./lib/compare.js";

const COLS = ["simulation/sim-time-sec", "position/h-sl-ft", "velocities/u-fps", "velocities/p-rad_sec", "attitude/psi-rad", "forces/fbz-total-lbs", "gear/unit[0]/WOW", "aero/alpha-rad", "position/ecef-x-ft", "attitude/phi-rad", "attitude/theta-rad", "velocities/vtrue-kts"];
const N = COLS.length;

function make(rows = 300, f) {
  const data = new Float64Array(rows * N);
  for (let r = 0; r < rows; r++) {
    const t = r / 120;
    const base = {
      "simulation/sim-time-sec": t, "position/h-sl-ft": 4000 + 3 * t, "velocities/u-fps": 150 + t,
      "velocities/p-rad_sec": 0.01 * Math.sin(t), "attitude/psi-rad": 3.0 + 0.05 * t, "forces/fbz-total-lbs": -2400 + 5 * t,
      "gear/unit[0]/WOW": r < 100 ? 1 : 0, "aero/alpha-rad": 0.05, "position/ecef-x-ft": 2.09e7 + 100 * t,
      "attitude/phi-rad": 0.1 * Math.sin(t), "attitude/theta-rad": 0.03, "velocities/vtrue-kts": 90 + t,
    };
    COLS.forEach((c, i) => { data[r * N + i] = f ? f(r, c, base[c]) : base[c]; });
  }
  return { columns: COLS.slice(), rows, data };
}
const A = { tolerance: classA };

test("identical traces pass and are bit-equal", () => {
  const r = compareTraces(make(), make(), A);
  assert.equal(r.refused, undefined);
  assert.equal(r.pass, true);
  assert.equal(bitEqual(make(), make()).equal, true);
});

test("a difference inside the tolerance passes; bitEqual still sees it", () => {
  const t = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 5e-7 : c === "velocities/u-fps" ? v * (1 + 5e-10) : v));
  assert.equal(compareTraces(make(), t, A).pass, true);
  assert.equal(bitEqual(make(), t).equal, false);
});

for (const [name, col, bump] of [
  ["position over 1e-6 ft", "position/h-sl-ft", 2e-6],
  ["ECEF position over 1e-6 ft", "position/ecef-x-ft", 2e-6],
  ["speed over 1e-9 relative", "velocities/u-fps", 150 * 3e-9],
  ["rate over 1e-9 x floor 1e-3", "velocities/p-rad_sec", 2e-11],
  ["angle over 1e-9 relative", "attitude/psi-rad", 2e-8],
  ["force over 1e-9 relative", "forces/fbz-total-lbs", 1e-5],
  ["WOW differs", "gear/unit[0]/WOW", 1],
]) {
  test(`fails: ${name}`, () => {
    const t = make(300, (r, c, v) => (c === col && r === 200 ? v + bump : v));
    const res = compareTraces(make(), t, A);
    assert.equal(res.refused, undefined);
    assert.equal(res.pass, false);
    const column = res.columns.find((x) => x.column === col);
    assert.equal(column.pass, false);
    assert.equal(column.firstRowOver, 200);
  });
}

test("Class S is 1000 times wider than Class A", () => {
  const t = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 5e-4 : c === "velocities/u-fps" ? v * (1 + 5e-7) : v));
  assert.equal(compareTraces(make(), t, A).pass, false);
  assert.equal(compareTraces(make(), t, { tolerance: classS }).pass, true);
  const worse = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 2e-3 : v));
  assert.equal(compareTraces(make(), worse, { tolerance: classS }).pass, false);
});

test("information-only columns are never judged", () => {
  const t = make(300, (r, c, v) => (c === "aero/alpha-rad" ? v + 1 : v));
  const res = compareTraces(make(), t, A);
  assert.equal(res.pass, true);
  assert.equal(res.columns.find((x) => x.column === "aero/alpha-rad").judged, false);
});

test("angles are compared wrapped", () => {
  const a = make(300, (r, c, v) => (c === "attitude/psi-rad" ? Math.PI - 1e-13 : v));
  const b = make(300, (r, c, v) => (c === "attitude/psi-rad" ? -Math.PI + 1e-13 : v));
  assert.equal(compareTraces(a, b, A).pass, true);
});

test("refuses: NaN, Inf, row count, columns, sim time, empty", () => {
  const nan = make(300, (r, c, v) => (c === "velocities/u-fps" && r === 250 ? NaN : v));
  assert.match(compareTraces(make(), nan, A).refused ?? "", /NaN or Inf/);
  assert.match(compareTraces(nan, make(), A).refused ?? "", /NaN or Inf/);
  assert.match(compareTraces(nan, nan, A).refused ?? "", /NaN or Inf/);
  const inf = make(300, (r, c, v) => (c === "aero/alpha-rad" && r === 3 ? Infinity : v));
  assert.match(compareTraces(make(), inf, A).refused ?? "", /NaN or Inf/);
  assert.match(compareTraces(make(300), make(299), A).refused ?? "", /row counts differ/);
  const cols = make();
  cols.columns[2] = "velocities/v-fps";
  assert.match(compareTraces(make(), cols, A).refused ?? "", /column lists differ/);
  const time = make(300, (r, c, v) => (c === "simulation/sim-time-sec" && r === 10 ? v + 1e-9 : v));
  assert.match(compareTraces(make(), time, A).refused ?? "", /sim time differs/);
  assert.match(compareTraces(make(0), make(0), A).refused ?? "", /empty/);
  const short = make();
  short.data = short.data.subarray(0, short.data.length - 5);
  assert.match(compareTraces(make(), short, A).refused ?? "", /data length/);
  assert.equal(compareTraces(make(), nan, A).pass, false);
});

test("NaN outside the judged window is still refused", () => {
  const nan = make(300, (r, c, v) => (c === "velocities/u-fps" && r === 290 ? NaN : v));
  assert.match(compareTraces(make(), nan, { tolerance: classA, windowSeconds: 1 }).refused ?? "", /NaN or Inf/);
});

test("the window limits what is judged", () => {
  const late = make(300, (r, c, v) => (c === "position/h-sl-ft" && r >= 200 ? v + 1 : v));
  assert.equal(compareTraces(make(), late, { tolerance: classA, windowSeconds: 1 }).pass, true);
  assert.equal(compareTraces(make(), late, { tolerance: classA, windowSeconds: 1 }).rowsJudged, 121);
  assert.equal(compareTraces(make(), late, { tolerance: classA, untilSimTime: 1.5 }).rowsJudged, 181);
  assert.equal(compareTraces(make(), late, A).pass, false);
  const early = make(300, (r, c, v) => (c === "position/h-sl-ft" && r === 120 ? v + 1 : v));
  assert.equal(compareTraces(make(), early, { tolerance: classA, windowSeconds: 1 }).pass, false);
});

test("Class B: caps, ensemble spread, refusals", () => {
  const native = make();
  const within = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 0.5 : c === "attitude/phi-rad" ? v + 0.04 : v));
  assert.equal(classB(native, within, []).pass, true);
  const over = make(300, (r, c, v) => (c === "position/h-sl-ft" && r === 299 ? v + 2 : v));
  assert.equal(classB(native, over, []).pass, false);
  // An ensemble that itself spreads by 1 ft allows 3 ft.
  const member = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 1 : v));
  const b = classB(native, over, [member]);
  assert.equal(b.pass, true);
  assert.equal(b.columns.find((x) => x.column === "position/h-sl-ft").allowed, 3);
  const wayOver = make(300, (r, c, v) => (c === "position/h-sl-ft" && r === 299 ? v + 4 : v));
  assert.equal(classB(native, wayOver, [member]).pass, false);
  const nan = make(300, (r, c, v) => (c === "velocities/u-fps" && r === 5 ? NaN : v));
  assert.ok(classB(native, nan, []).refused);
  assert.ok(classB(native, within, [nan]).refused);
  // The window: a late difference is not judged when the run is cut at 1.5 s.
  assert.equal(classB(native, over, [], 1.5).pass, true);
});

test("Class N: allowance is max(frozen, 3 x ensemble spread); positions and contact are not widened", () => {
  const native = make();
  // Members differ from native at row 0 (they had an effect) and spread forces by 1e-4 lb, speeds by 1e-8.
  const member = (scale) => make(300, (r, c, v) =>
    c === "position/ecef-x-ft" ? v + 3.7e-9 * scale : c === "forces/fbz-total-lbs" ? v + 1e-4 * scale : c === "velocities/u-fps" ? v + 1e-8 * scale : v);
  const ensemble = [1, -1, 0.5, -0.5, 0.25, -0.25, 0.75, -0.75].map(member);
  const A = { tolerance: classA };
  assert.equal(touchesGround(native, native.rows), true);
  assert.equal(touchesGround(make(300, (r, c, v) => (c.endsWith("/WOW") ? 0 : v)), 300), false);

  // A wasm trace off by 2e-4 lb fails Class A but is inside 3 x 1e-4.
  const noisy = make(300, (r, c, v) => (c === "forces/fbz-total-lbs" ? v + 2e-4 : c === "velocities/u-fps" ? v + 2.5e-8 : v));
  assert.equal(compareTraces(native, noisy, A).pass, false);
  const ok = classN(native, noisy, ensemble, A);
  assert.equal(ok.refused, undefined);
  assert.equal(ok.pass, true);
  assert.equal(ok.membersWithEffect, 8);
  const fz = ok.columns.find((x) => x.column === "forces/fbz-total-lbs");
  assert.ok(Math.abs(fz.spread - 1e-4) < 1e-9 && Math.abs(fz.allowed - 3e-4) < 1e-9);

  // Beyond 3 x spread: fails.
  const tooFar = make(300, (r, c, v) => (c === "forces/fbz-total-lbs" && r === 150 ? v + 4e-4 : v));
  const bad = classN(native, tooFar, ensemble, A);
  assert.equal(bad.pass, false);
  assert.equal(bad.columns.find((x) => x.column === "forces/fbz-total-lbs").firstRowOver, 150);

  // A column the ensemble does not spread keeps the frozen allowance.
  const rate = make(300, (r, c, v) => (c === "velocities/p-rad_sec" && r === 10 ? v + 1e-9 : v));
  assert.equal(classN(native, rate, ensemble, A).pass, false);

  // Positions are never widened, however much the ensemble spreads them.
  const wide = ensemble.map((m, i) => make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 1e-3 : m.data[r * N + COLS.indexOf(c)])));
  const pos = make(300, (r, c, v) => (c === "position/h-sl-ft" ? v + 2e-6 : v));
  assert.equal(classN(native, pos, wide, A).pass, false);
  // Contact flags must be equal even if a member's flag differs.
  const wowMembers = ensemble.map((m) => make(300, (r, c, v) => (c === "gear/unit[0]/WOW" && r === 100 ? 1 : m.data[r * N + COLS.indexOf(c)])));
  const wow = make(300, (r, c, v) => (c === "gear/unit[0]/WOW" && r === 100 ? 1 : v));
  assert.equal(classN(native, wow, wowMembers, A).pass, false);

  // Refusals: members with no effect, NaN in a member, wrong shape, NaN in the tested trace.
  assert.match(classN(native, noisy, Array.from({ length: 8 }, () => make()), A).refused ?? "", /only 0 of 8/);
  assert.match(classN(native, noisy, [...ensemble.slice(0, 3), make(), make(), make(), make(), make()], A).refused ?? "", /only 3 of 8/);
  const nanMember = make(300, (r, c, v) => (c === "velocities/u-fps" && r === 7 ? NaN : v));
  assert.match(classN(native, noisy, [...ensemble.slice(0, 7), nanMember], A).refused ?? "", /ensemble member 7: NaN/);
  assert.match(classN(native, noisy, [...ensemble.slice(0, 7), make(299)], A).refused ?? "", /ensemble member 7: row counts/);
  assert.match(classN(native, nanMember, ensemble, A).refused ?? "", /wasm vs native: NaN/);

  // The window is respected: a late excess is not judged in the first second.
  assert.equal(classN(native, tooFar, ensemble, { tolerance: classA, windowSeconds: 1 }).pass, true);
  // With the Class S allowance as the frozen class, a larger frozen floor applies.
  const s = classN(native, rate, ensemble, { tolerance: classS });
  assert.equal(s.pass, true);
});
