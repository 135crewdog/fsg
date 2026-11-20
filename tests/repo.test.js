// The repo's own ground rules, as far as a test can hold them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('package.json has no dependencies: CLAUDE.md says to ask before adding one', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(pkg[kind], undefined, `${kind} in package.json`);
  }
  assert.ok(!existsSync(join(root, 'package-lock.json')), 'no package-lock.json: nothing is installed');
});

test('the files every session reads are where CLAUDE.md says they are', () => {
  for (const file of ['CLAUDE.md', 'README.md', 'docs/ideas.md', 'docs/milestones/0.md', 'docs/milestones/1.md']) {
    assert.ok(existsSync(join(root, file)), file);
  }
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /^# FSG: Flight Sim Game\n/);
});
