// JSBSim's data files are upstream's, byte for byte: the folders have the git
// tree ids of JSBSim v1.3.3 that jsbsim/pins.env records. New in FSG; in FDM
// the check ran from scripts/run-all-tests.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-data.sh', import.meta.url));

test('jsbsim-data is JSBSim v1.3.3\'s data, byte for byte (the files on disk)', () => {
  const run = spawnSync('bash', [script], { encoding: 'utf8' });
  console.log(run.stdout.trim().split('\n').map((line) => `  ${line}`).join('\n'));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.trim().split('\n').filter((line) => line.startsWith('ok ')).length, 7, 'five folders, COPYING and REF');
});
