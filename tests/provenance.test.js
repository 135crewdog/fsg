// Every piece copied in from the older projects is still what provenance.json
// says it is. A copied file can't change by accident: changing one on purpose
// means changing its entry in the same pull request, which puts the change on
// record. (The method is Go's vendor/modules.txt and Cargo's checksum file.)
// tools/from-fdm.mjs writes provenance.json; its --check mode goes further and
// derives every copy again from the originals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, ROOT, SOURCES, TREES, sha256, treeOnDisk } from '../tools/from-fdm.mjs';

const record = JSON.parse(readFileSync(join(ROOT, 'provenance.json'), 'utf8'));

test('provenance.json covers exactly what tools/from-fdm.mjs copies', () => {
  assert.deepEqual(record.sources, SOURCES);
  assert.deepEqual(Object.keys(record.files), FILES.map((f) => f.to));
  assert.deepEqual(Object.keys(record.trees), TREES.map((t) => t.to));
});

test('every copied file is still the copy on record', () => {
  let locked = 0;
  for (const [file, item] of Object.entries(record.files)) {
    assert.ok(existsSync(join(ROOT, file)), `${file} exists`);
    assert.match(item.original, /^[0-9a-f]{64}$/, `${file}: the original's hash is on record`);
    // A file brought up to a later commit of its source than the source's own pin says which, here and at its top.
    if (item.commit) {
      assert.match(item.commit, /^[0-9a-f]{40}$/, `${file}: the commit it was last brought up to is on record`);
      assert.ok(readFileSync(join(ROOT, file), 'utf8').split('\n').slice(0, 6).join('\n').includes(`commit ${item.commit.slice(0, 7)}`) || file.endsWith('.webmanifest'),
        `${file} names commit ${item.commit.slice(0, 7)} at its top (a manifest is JSON and cannot)`);
    }
    if (item.how === 'adapted') continue;   // rewritten for FSG on purpose; it says at its top where it came from
    if (item.how === 'rebuilt') continue;   // a binary rebuilt here from changed sources; jsbsim/tests/build.test.js and the rebuild workflow guard it
    assert.equal(sha256(readFileSync(join(ROOT, file))), item.copy, `${file} (${item.how}, from ${item.from}) has changed`);
    if (item.how === 'byte for byte') assert.equal(item.copy, item.original, `${file} is byte for byte`);
    locked++;
  }
  console.log(`  ${locked} copied files match; ${Object.keys(record.files).length - locked} adapted or rebuilt files on record`);
});

test('every copied folder is still byte for byte the original', () => {
  for (const [folder, item] of Object.entries(record.trees)) {
    assert.equal(treeOnDisk(folder), item.tree, `${folder} (from ${item.from}) has changed`);
    console.log(`  ${folder}: ${item.files} files, git tree ${item.tree}`);
  }
});
