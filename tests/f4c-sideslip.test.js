// The F-4C's large-sideslip bend (milestone 3, pull request 10, round 3): the aircraft file's tables between its
// SIDESLIP TABLES marks are tools/f4c-sideslip.mjs's, cell for cell, made from the record of NASA TN D-6425
// (aircraft/f4c/data/tnd6425-f4.json); the bend is nothing within 10 degrees of sideslip; the record's own
// numbers (its two readings' agreement, its cross-check against AFWAL) are what its points give; and in a flight
// the new terms read what the tables say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BETAS, PANELS, RECORD, afwalSlope, asXml, inFile, sideslipTables } from '../tools/f4c-sideslip.mjs';
import { Report } from '../jsbsim/tests/lib/harness.js';

const report = new Report('checkride-f4c-sideslip');
test.after(() => report.save());

test('f4c sideslip: the aircraft file\'s sideslip tables are what tools/f4c-sideslip.mjs works out from the record, cell for cell', () => {
  assert.equal(inFile().tables, asXml(sideslipTables()));
  const xml = readFileSync(new URL('../aircraft/f4c/f4c.xml', import.meta.url), 'utf8');
  for (const term of ['side-sideslip-bend', 'roll-sideslip-bend', 'roll-sideslip-below-zero', 'yaw-sideslip-bend']) {
    assert.equal((xml.match(new RegExp(`<property> aero/coefficient/${term} </property>`, 'g')) ?? []).length, 1, `${term} is in its sum once`);
  }
});

test('f4c sideslip: the bend is nothing within 10 degrees of sideslip, at every angle of attack; past the report\'s last sideslip the total is held', () => {
  const t = sideslipTables();
  for (const [file, name] of [['side', 'Cy'], ['yaw', 'Cn'], ['roll', 'Cl']]) {
    for (const [alpha, row] of t[file]) {
      assert.equal(row[BETAS.indexOf(-10)], 0, `${file} at ${alpha}, -10`);
      assert.equal(row[BETAS.indexOf(10)], 0, `${file} at ${alpha}, 10`);
      const panel = PANELS.find((p) => p.alpha === alpha), last = panel.last[name], s = afwalSlope(name, alpha);
      const total = (b) => s * b + row[BETAS.indexOf(b)];
      assert.ok(Math.abs(total(180) - total(last)) < 1e-4, `${file} at ${alpha}: the total at 180 is the total at ${last}`);
    }
  }
  report.line(`f4c sideslip: the bend tables: ${PANELS.length} angles of attack (${PANELS[0].alpha} to ${PANELS.at(-1).alpha}), 0 within 10 degrees of sideslip, the total held past ${[...new Set(PANELS.map((p) => p.last.Cn))].join(' and ')} degrees`);
});

test('f4c sideslip: the record\'s numbers are its points\': the two readings\' agreement, and the cross-check against AFWAL as printed in it', () => {
  const diffs = { Cy: [], Cn: [], Cl: [] };
  for (const p of RECORD.panels) for (const [name, c] of Object.entries(p.coefficients)) for (const q of c.points) if (q.reading_A !== null && q.reading_B !== null) diffs[name].push(q.reading_A - q.reading_B);
  for (const [name, d] of Object.entries(diffs)) {
    const rms = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    assert.equal(d.length, RECORD.how_read.agreement[name].pairs, `${name} pairs`);
    assert.ok(Math.abs(rms - RECORD.how_read.agreement[name].rms) < 6e-5, `${name} rms ${rms}`);
  }
  report.line('f4c sideslip: the record\'s cross-check, the report\'s slope over plus and minus 10 degrees (AFWAL\'s reference) beside AFWAL\'s, per degree:');
  for (const row of RECORD.cross_check_within_10_degrees.table) {
    const panel = PANELS.find((p) => p.alpha === row.alpha_deg);
    for (const name of ['Cy', 'Cn', 'Cl']) assert.ok(Math.abs(panel.slope[name] - row[name].report_per_deg) < 2e-6, `${row.alpha_deg} ${name}`);
    report.line(`  ${String(row.alpha_deg).padStart(5)} deg: side force ${row.Cy.report_per_deg.toFixed(5)} against ${row.Cy.afwal_per_deg.toFixed(5)}; yaw ${row.Cn.report_per_deg.toFixed(5)} against ${row.Cn.afwal_per_deg.toFixed(5)}; roll ${row.Cl.report_per_deg.toFixed(5)} against ${row.Cl.afwal_per_deg.toFixed(5)}`);
  }
});
