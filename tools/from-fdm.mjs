// Copies the pieces FSG takes from the older projects, and checks the copies.
// This file is the record of exactly what was copied and how: the list below
// is the whole of it. Nothing is copied or converted by hand.
//
//   node tools/from-fdm.mjs --fdm <FDM repo> --wings <wings repo>           copy, and write provenance.json
//   node tools/from-fdm.mjs --fdm <FDM repo> --wings <wings repo> --check   derive every copy again and compare
//
// The repos can be on any branch: files are read from the commits named
// below, straight out of git.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const SOURCES = {
  FDM: { repo: '135crewdog/FDM', branch: 'baseline/jsbsim', commit: 'e47882503ab765d575a38b5bcd59fd41da76b1ae' },
  wings: { repo: '135crewdog/wings', branch: 'main', commit: '557a8d04e4b443f537e948aa0b79c245dcae7d88' },
};

// ---- what is copied ----
// how: 'byte for byte'  the copy is the original, bit for bit
//      'changed'        the original with the listed replacements, and nothing else
//      'types removed'  TypeScript made into plain JavaScript by removeTypes() below, then the
//                       listed replacements if any, and nothing else
//      'adapted'        rewritten on purpose for FSG; only the original's hash is recorded,
//                       and the file says at its top where it came from
//      'rebuilt'        a build product FDM committed and FSG has since rebuilt from changed sources; only
//                       the original's hash is recorded here. What guards the bytes now is
//                       jsbsim/dist-wasm/build-info.json, jsbsim/tests/build.test.js and the rebuild workflow
const copy = (source, from, to = from) => ({ source, from, to, how: 'byte for byte' });
const adapted = (source, from, to = from) => ({ source, from, to, how: 'adapted' });
const rebuilt = (source, from, to = from) => ({ source, from, to, how: 'rebuilt' });
const typesRemoved = (from, to, extra = {}) => ({ source: 'FDM', from, to, how: 'types removed', ...extra });

export const FILES = [
  // The app shell, from Wings.
  ...['icons/icon-32.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'].map((f) => copy('wings', f)),
  ...['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', 'src/main.js', 'src/version.js', 'tests/app.test.js',
    '.github/workflows/test.yml', '.github/workflows/pages.yml'].map((f) => adapted('wings', f)),
  adapted('FDM', 'tests/page.chromium.mjs', 'tests/browser/app.chromium.mjs'),
  adapted('FDM', 'web/page.ts', 'src/fdm.js'),   // how the page starts the Worker, and the fallback marker

  // JSBSim's pins and data, from FDM.
  copy('FDM', 'pins.env', 'jsbsim/pins.env'),
  copy('FDM', 'scripts/fetch-jsbsim-data.sh', 'jsbsim/scripts/fetch-jsbsim-data.sh'),
  {
    source: 'FDM', from: 'scripts/check-data.sh', to: 'jsbsim/scripts/check-data.sh', how: 'changed',
    why: 'In FDM the data sat at the repo\'s root; here it sits one folder down, in jsbsim/.',
    replace: [
      ['#!/usr/bin/env bash\n', '#!/usr/bin/env bash\n# From 135crewdog/FDM, scripts/check-data.sh, commit e478825. Changed for FSG: the data sits one folder\n# down from the repo\'s root (jsbsim/jsbsim-data), so git is asked where its folder is and what the path\n# from the root is. Nothing else is changed.\n'],
      ['cd "$ROOT"\n', 'cd "$ROOT"\nGIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"   # FSG: the repo\'s .git is not in this folder\nPREFIX="$(git rev-parse --show-prefix)"            # FSG: "jsbsim/", the path from the repo\'s root to here\n'],
      ['GIT_INDEX_FILE="$tmp" git --git-dir="$ROOT/.git" --work-tree=. add -f -A .', 'GIT_INDEX_FILE="$tmp" git --git-dir="$GIT_DIR_ABS" --work-tree=. add -f -A .'],
      ['GIT_INDEX_FILE="$tmp" git --git-dir="$ROOT/.git" write-tree', 'GIT_INDEX_FILE="$tmp" git --git-dir="$GIT_DIR_ABS" write-tree'],
      ['git rev-parse "HEAD:jsbsim-data/$d"', 'git rev-parse "HEAD:${PREFIX}jsbsim-data/$d"'],
      ['git rev-parse HEAD:jsbsim-data/COPYING', 'git rev-parse "HEAD:${PREFIX}jsbsim-data/COPYING"'],
    ],
  },

  // The build: the C++ host layer, the build description and scripts, and the binaries they made.
  copy('FDM', 'CMakeLists.txt', 'jsbsim/CMakeLists.txt'),
  ...['c_api.cpp', 'fdm_codes.h', 'grid_ground.cpp', 'grid_ground.h', 'host_logger.cpp', 'host_logger.h',
    'native_main.cpp', 'scenario_runner.cpp', 'scenario_runner.h'].map((f) => copy('FDM', `host/${f}`, `jsbsim/host/${f}`)),
  // Milestone 1, pull request 2: the one change to the C++ host layer. The ground grid may be replaced after
  // load and between steps, so the game can move the patch of ground with the airplane.
  {
    source: 'FDM', from: 'host/fdm_host.cpp', to: 'jsbsim/host/fdm_host.cpp', how: 'changed',
    why: 'Milestone 1: SetGroundGrid is also allowed after load and between steps (it was "only before load"), so the height patch can follow the airplane.',
    replace: [
      ['#include "fdm_host.h"\n', '// From 135crewdog/FDM, host/fdm_host.cpp, commit e478825. Changed for FSG (milestone 1): SetGroundGrid is also\n// allowed after load and between steps. Nothing else is changed; tools/from-fdm.mjs lists the change.\n#include "fdm_host.h"\n'],
      ['  if (state_ != FDM_NEW) return Fail("SetGroundGrid: only before load");\n', '  // FSG: also after load and between steps, so the game can replace the patch of ground under the\n  // airplane as it flies (FlightGear keeps a ground cache behind its callback the same way). A refused\n  // grid leaves the one in place.\n  if (state_ != FDM_NEW && state_ != FDM_LOADED && state_ != FDM_RUNNING)\n    return Fail("SetGroundGrid: this instance has ended or is dead");\n'],
    ],
  },
  {
    source: 'FDM', from: 'host/fdm_host.h', to: 'jsbsim/host/fdm_host.h', how: 'changed',
    why: 'Milestone 1: one comment line saying SetGroundGrid may be called again after load and between steps.',
    replace: [
      ['// Host layer (not physics): a thin wrapper around one JSBSim::FGFDMExec.\n', '// From 135crewdog/FDM, host/fdm_host.h, commit e478825. Changed for FSG (milestone 1): one comment line on\n// SetGroundGrid. Nothing else is changed; tools/from-fdm.mjs lists the change.\n// Host layer (not physics): a thin wrapper around one JSBSim::FGFDMExec.\n'],
      ['  bool SetGroundGrid(std::shared_ptr<const HeightGrid> grid);\n', '  // FSG: may be called again after load and between steps; the new grid replaces the old one.\n  bool SetGroundGrid(std::shared_ptr<const HeightGrid> grid);\n'],
    ],
  },
  copy('FDM', 'tests/native/ground_oracle.cpp', 'jsbsim/tests/native/ground_oracle.cpp'),
  {
    source: 'FDM', from: 'tests/native/host_selftest.cpp', to: 'jsbsim/tests/native/host_selftest.cpp', how: 'changed',
    why: 'Milestone 1: the native self-test also runs FSG\'s checks of replacing the ground grid (jsbsim/tests/native/ground_swap_selftest.h, new in FSG).',
    replace: [
      ['// Native self-test of the host wrapper (criterion 3, "natively where it applies").\n', '// From 135crewdog/FDM, tests/native/host_selftest.cpp, commit e478825. Changed for FSG (milestone 1): it also runs\n// the checks in ground_swap_selftest.h. Nothing else is changed; tools/from-fdm.mjs lists the change.\n// Native self-test of the host wrapper (criterion 3, "natively where it applies").\n'],
      ['#include "input_output/FGPropertyManager.h"\n', '#include "input_output/FGPropertyManager.h"\n\n#include "ground_swap_selftest.h"  // FSG\n'],
      ['  std::printf("%s: %d failed\\n", g_failed ? "FAILED" : "all ok", g_failed);\n', '  // FSG: replacing the ground grid after load and between steps (ground_swap_selftest.h).\n  GroundSwapSelfTest(data, out, [](bool ok, const std::string& name, const std::string& detail) { Check(ok, name, detail); });\n  std::printf("%s: %d failed\\n", g_failed ? "FAILED" : "all ok", g_failed);\n'],
    ],
  },
  ...['build.sh', 'setup-toolchain.sh', 'check-flags.mjs', 'write-build-info.mjs', 'check-binaries.mjs', 'selftest-build.sh']
    .map((f) => copy('FDM', `scripts/${f}`, `jsbsim/scripts/${f}`)),
  // The binaries were FDM's until milestone 1, pull request 2, which changed the host sources above and rebuilt them.
  ...['fdm-weh.mjs', 'fdm-weh.wasm', 'fdm-jseh.mjs', 'fdm-jseh.wasm', 'build-info.json'].map((f) => rebuilt('FDM', `dist-wasm/${f}`, `jsbsim/dist-wasm/${f}`)),

  // The JavaScript side: FDM's wrapper, fixed-step loop and Worker (TypeScript there), now the app's simulation code.
  ...['core', 'codes', 'files', 'loop', 'bench', 'worker-handler', 'worker'].map((f) => typesRemoved(`ts/${f}.ts`, `src/sim/${f}.js`)),

  // FDM's tests, with the data they need. They stay in FDM's layout, under jsbsim/.
  typesRemoved('ts/node.ts', 'jsbsim/tests/lib/node.js', {
    why: 'This file moved two folders down (FDM: ts/; FSG: jsbsim/tests/lib/), so the root of the build, jsbsim/, is two folders up.',
    replace: [['export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");', 'export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");']],
  }),
  typesRemoved('tests/lib/harness.ts', 'jsbsim/tests/lib/harness.js', {
    why: 'FDM committed its result files in results/. FSG writes them to build/results/, which is not committed: FDM\'s evidence stays in FDM.',
    replace: [
      ['export const RESULTS_DIR = join(REPO_ROOT, "results");', 'export const RESULTS_DIR = join(REPO_ROOT, "build", "results");'],
      ['writes them to results/<name>.txt;', 'writes them to build/results/<name>.txt;'],
    ],
  }),
  ...['compare', 'fixtures', 'grids', 'node-worker', 'scenario'].map((f) => typesRemoved(`tests/lib/${f}.ts`, `jsbsim/tests/lib/${f}.js`)),
  ...['compare-selftest', 'wrapper', 'loop', 'load', 'ground', 'forces', 'parity'].map((f) => typesRemoved(`tests/${f}.test.ts`, `jsbsim/tests/${f}.test.js`)),
  ...['aircraft/broken_xml/broken_xml.xml', 'nasa/aircraft/brick_damped/brick_damped.xml', 'nasa/aircraft/brick_damped/reset_Atmos_03.xml',
    'nasa/aircraft/sphere/reset_Atmos_01.xml', 'nasa/aircraft/sphere/sphere.xml', 'nasa/scripts/Atmos_01.xml', 'nasa/scripts/Atmos_03.xml',
    'scripts/t_integrators.xml', 'scripts/t_short.xml', 'scripts/t_terminate.xml'].map((f) => copy('FDM', `tests/fixtures/${f}`, `jsbsim/tests/fixtures/${f}`)),
  ...['01_sim_01', '01_sim_02', '01_sim_03', '01_sim_04', '01_sim_06', '02_sim_01', '02_sim_02', '02_sim_04', '02_sim_06', '03_sim_01', '03_sim_02', '03_sim_04', '03_sim_06']
    .map((f) => copy('FDM', `tests/reference/nasa/Atmos_${f}.csv`, `jsbsim/tests/reference/nasa/Atmos_${f}.csv`)),
  copy('FDM', 'tests/reference/nasa/README.md', 'jsbsim/tests/reference/nasa/README.md'),
  copy('FDM', 'tests/rng-elements.md', 'jsbsim/tests/rng-elements.md'),
];

// Whole folders, byte for byte. Checked by git's own id for the folder (a hash of every name, mode and byte in it).
export const TREES = [
  { source: 'FDM', from: 'jsbsim-data', to: 'jsbsim/jsbsim-data' },
];

// ---- helpers ----
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (repo, args, options = {}) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 28, ...options });

/** Git's id for a folder on disk, whether or not it is committed (after FDM's scripts/check-data.sh). */
export function treeOnDisk(folder) {
  const dir = mkdtempSync(join(tmpdir(), 'fsg-tree-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  const gitDir = git(ROOT, ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  try {
    const at = ['--git-dir', gitDir, '--work-tree', join(ROOT, folder)];
    execFileSync('git', [...at, 'add', '-f', '-A', '.'], { cwd: join(ROOT, folder), env });
    return execFileSync('git', [...at, 'write-tree'], { cwd: join(ROOT, folder), env, encoding: 'utf8' }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * TypeScript to plain JavaScript, by removing the types and nothing else.
 * Node's own stripper blanks every type out with spaces and leaves all other characters where they were.
 * On top of that, so the result reads as source:
 *  - lines that were nothing but types are kept as // comments, where they were (they describe the
 *    Worker's messages and the options); `import type` lines are dropped;
 *  - the blanks left inside a line are closed up.
 */
export function removeTypes(source) {
  const blanked = stripTypeScriptTypes(source);
  if (blanked.length !== source.length) throw new Error('the stripper changed the length');
  const was = source.split('\n'), now = blanked.split('\n');
  const out = [];
  let run = [];   // consecutive lines that were only types
  const flush = () => {
    const indent = Math.min(...run.map((line) => line.match(/^\s*/)[0].length));
    for (const line of run) out.push(`${line.slice(0, indent)}// ${line.slice(indent)}`);
    run = [];
  };
  let inImportType = false;
  for (let i = 0; i < was.length; i++) {
    const a = was[i], b = now[i];
    if (a !== b && b.trim() === '') {
      const ends = /from\s+["'][^"']+["'];?\s*$/.test(a);
      if (inImportType) { if (ends) inImportType = false; } else if (/^\s*import type\b/.test(a)) inImportType = !ends; else run.push(a);
      continue;
    }
    if (run.length) flush();
    if (a === b) { out.push(a); continue; }
    // Part of the line was types: take the blanked characters out, and the one space each leaves over.
    let line = '';
    for (let j = 0; j < a.length;) {
      if (a[j] === b[j]) { line += a[j++]; continue; }
      let k = j;
      while (k < a.length && (a[k] !== b[k] || (a[k] === ' ' && k + 1 < a.length && a[k + 1] !== b[k + 1]))) k++;   // one blanked span, with the single spaces inside it
      const after = a[k] ?? '';
      if (line.endsWith(' ') && (after === '' || /[;,)\]} ]/.test(after))) line = line.slice(0, -1);   // "x as T;" becomes "x;"
      else if (after === ' ' && (line === '' || /[\s({\[]$/.test(line))) k++;                          // "private x" becomes "x"
      j = k;
    }
    if (/^\s*(import|export)\b/.test(line)) line = line.replace(/,\s*}/, ' }');   // "{ a, type B }" becomes "{ a }"
    out.push(line.replace(/\s+$/, ''));
  }
  if (run.length) flush();
  return out.join('\n');
}

// Where each converted file went: its old path in FDM to its new path here.
const MOVED = new Map(FILES.filter((f) => f.how === 'types removed').map((f) => [f.from, f.to]));

/** ".ts" becomes ".js": in every relative path the code names, and in the file names its comments mention. */
function renameTs(text, entry) {
  // "./x.ts" and "../ts/x.ts" in import lines, import() and new URL(): the same file, at its new place.
  text = text.replace(/(["'])(\.{1,2}\/[^"'\n]*\.ts)\1/g, (all, quote, path) => {
    const to = MOVED.get(posix.normalize(posix.join(posix.dirname(entry.from), path)));
    if (!to) throw new Error(`${entry.from} names ${path}, which is not copied`);
    const relative = posix.relative(posix.dirname(entry.to), to);
    return quote + (relative.startsWith('.') ? relative : `./${relative}`) + quote;
  });
  // In whole-line comments: "ts/worker.ts" is now src/sim/worker.js, and a bare "codes.ts" is codes.js.
  return text.split('\n').map((line) => {
    if (!/^\s*(\/\/|\/?\*)/.test(line)) return line;
    return line.replace(/\b(ts\/)?([a-z-]+)\.ts\b/g, (all, folder, name) => {
      const to = MOVED.get(`ts/${name}.ts`);
      if (!to) return all;
      return folder ? to : `${name}.js`;
    });
  }).join('\n');
}

const header = (entry) => `// From 135crewdog/FDM, ${entry.from}, commit ${SOURCES.FDM.commit.slice(0, 7)}. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders.${entry.why ? ` Also changed: ${entry.replace.length === 1 ? 'one line' : `${entry.replace.length} lines`}, listed in tools/from-fdm.mjs.` : ' Nothing else is changed.'}
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
`;

function replaceOnce(text, entry) {
  for (const [find, put] of entry.replace ?? []) {
    if (text.split(find).length !== 2) throw new Error(`${entry.from}: expected exactly one "${find.trim()}"`);
    text = text.replace(find, () => put);
  }
  return text;
}

/** The bytes a copy must have, made from the original. */
function derive(entry, original) {
  if (entry.how === 'byte for byte') return original;
  if (entry.how === 'changed') return Buffer.from(replaceOnce(original.toString('utf8'), entry));
  if (entry.how === 'types removed') return Buffer.from(header(entry) + replaceOnce(renameTs(removeTypes(original.toString('utf8')), entry), entry));
  throw new Error(`${entry.to}: ${entry.how} files are not derived`);
}

// ---- the work ----
function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const repos = {};
  for (const name of Object.keys(SOURCES)) {
    const i = args.indexOf(`--${name.toLowerCase()}`);
    if (i < 0 || !args[i + 1]) throw new Error(`give --${name.toLowerCase()} <path to a clone of ${SOURCES[name].repo}>`);
    repos[name] = args[i + 1];
  }
  const original = (entry) => git(repos[entry.source], ['show', `${SOURCES[entry.source].commit}:${entry.from}`]);
  const mode = (entry) => git(repos[entry.source], ['ls-tree', SOURCES[entry.source].commit, entry.from], { encoding: 'utf8' }).split(' ')[0];

  const record = { sources: SOURCES, files: {}, trees: {} };
  let bad = 0;
  const say = (ok, what) => { if (!ok) bad++; if (!ok || !check) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

  for (const entry of FILES) {
    const from = `${entry.source}:${entry.from}`;
    const bytes = original(entry);
    const item = { from, how: entry.how, original: sha256(bytes) };
    if (entry.why) item.why = entry.why;
    const path = join(ROOT, entry.to);
    if (entry.how === 'adapted' || entry.how === 'rebuilt') {
      say(existsSync(path), `${entry.to}  (${entry.how === 'adapted' ? 'adapted from' : 'rebuilt; was'} ${from})`);
    } else {
      const want = derive(entry, bytes);
      item.copy = sha256(want);
      if (check) {
        say(existsSync(path) && readFileSync(path).equals(want), `${entry.to}  (${entry.how}, from ${from})`);
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, want);
        chmodSync(path, mode(entry) === '100755' ? 0o755 : 0o644);
        say(true, `${entry.to}  (${entry.how}, from ${from})`);
      }
    }
    record.files[entry.to] = item;
  }

  for (const tree of TREES) {
    const { commit } = SOURCES[tree.source];
    const id = git(repos[tree.source], ['rev-parse', `${commit}:${tree.from}`], { encoding: 'utf8' }).trim();
    const files = git(repos[tree.source], ['ls-tree', '-r', '--name-only', commit, '--', tree.from], { encoding: 'utf8' }).trim().split('\n').length;
    if (!check) {
      rmSync(join(ROOT, tree.to), { recursive: true, force: true });
      mkdirSync(join(ROOT, tree.to), { recursive: true });
      // git archive hands over exactly the committed files, with their modes.
      const tar = git(repos[tree.source], ['archive', commit, tree.from]);
      execFileSync('tar', ['-x', `--strip-components=${tree.from.split('/').length}`, '-C', join(ROOT, tree.to)], { input: tar });
    }
    const onDisk = existsSync(join(ROOT, tree.to)) ? treeOnDisk(tree.to) : 'missing';
    say(onDisk === id, `${tree.to}/  (${files} files, byte for byte, from ${tree.source}:${tree.from}; git tree ${id})`);
    record.trees[tree.to] = { from: `${tree.source}:${tree.from}`, how: 'byte for byte', files, tree: id };
  }

  const text = `${JSON.stringify(record, null, 2)}\n`;
  const recordPath = join(ROOT, 'provenance.json');
  if (check) say(existsSync(recordPath) && readFileSync(recordPath, 'utf8') === text, 'provenance.json says the same');
  else writeFileSync(recordPath, text);

  const copied = FILES.filter((f) => f.how !== 'adapted' && f.how !== 'rebuilt').length;
  console.log(`${check ? 'checked' : 'copied'}: ${copied} files and ${TREES.length} folder${TREES.length === 1 ? '' : 's'} derived from the originals, ${FILES.length - copied} adapted or rebuilt files on record; ${bad ? `${bad} FAILED` : 'all match'}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
