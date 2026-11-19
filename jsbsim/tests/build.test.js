// The committed WebAssembly binaries and C++ host sources are the ones
// dist-wasm/build-info.json describes. New in FSG; in FDM the first check ran
// from scripts/run-all-tests.sh and the second was done by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');   // jsbsim/
const info = JSON.parse(readFileSync(join(root, 'dist-wasm/build-info.json'), 'utf8'));

test('the four binaries have the sizes and hashes build-info.json records', () => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/check-binaries.mjs')], { encoding: 'utf8' });
  console.log(run.stdout.trim().split('\n').map((line) => `  ${line}`).join('\n'));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.split('\n').filter((line) => line.startsWith('ok  ')).length, 4);
});

test('the C++ host sources here are the ones the binaries were built from', () => {
  // The same hash scripts/write-build-info.mjs writes at build time: every file under host/ and
  // tests/native/, then CMakeLists.txt and pins.env, each as its path, a zero byte, its bytes, a zero byte.
  const listFiles = (dir) => readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
  const files = [...listFiles(join(root, 'host')), ...listFiles(join(root, 'tests/native')), join(root, 'CMakeLists.txt'), join(root, 'pins.env')];
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.slice(root.length + 1)).update('\0').update(readFileSync(file)).update('\0');
  assert.equal(hash.digest('hex'), info.host_sources_sha256);
  console.log(`  ${files.length} files, sha256 ${info.host_sources_sha256}`);
});

test('build-info.json names the pins: JSBSim, Emscripten, memory', () => {
  const pins = Object.fromEntries(readFileSync(join(root, 'pins.env'), 'utf8').split('\n').filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  assert.equal(info.jsbsim.commit, pins.JSBSIM_COMMIT);
  assert.deepEqual(info.jsbsim.patches, [], 'JSBSim is unmodified');
  assert.equal(info.emscripten.version, pins.EMSDK_VERSION);
  assert.equal(info.memory.fixed_bytes, Number(pins.WASM_MEMORY_MB) * 1024 * 1024);
  assert.equal(info.memory.growth, false);
  console.log(`  JSBSim ${info.jsbsim.tag}, Emscripten ${info.emscripten.version}, ${info.memory.fixed_bytes / 1048576} MiB fixed`);
});
