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
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const SOURCES = {
  FDM: { repo: '135crewdog/FDM', branch: 'baseline/jsbsim', commit: 'e47882503ab765d575a38b5bcd59fd41da76b1ae' },
  wings: { repo: '135crewdog/wings', branch: 'main', commit: '557a8d04e4b443f537e948aa0b79c245dcae7d88' },
};

// ---- what is copied ----
// how: 'byte for byte'  the copy is the original, bit for bit
//      'changed'        the original with the listed replacements, and nothing else
//      'adapted'        rewritten on purpose for FSG; only the original's hash is recorded,
//                       and the file says at its top where it came from
const copy = (source, from, to = from) => ({ source, from, to, how: 'byte for byte' });
const adapted = (source, from, to = from) => ({ source, from, to, how: 'adapted' });

export const FILES = [
  // The app shell, from Wings.
  ...['icons/icon-32.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'].map((f) => copy('wings', f)),
  ...['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', 'src/main.js', 'src/version.js', 'tests/app.test.js',
    '.github/workflows/test.yml', '.github/workflows/pages.yml'].map((f) => adapted('wings', f)),
  adapted('FDM', 'tests/page.chromium.mjs', 'tests/browser/app.chromium.mjs'),

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

/** The bytes a copy must have, made from the original. */
function derive(entry, original) {
  if (entry.how === 'byte for byte') return original;
  if (entry.how === 'changed') {
    let text = original.toString('utf8');
    for (const [find, put] of entry.replace) {
      if (text.split(find).length !== 2) throw new Error(`${entry.from}: expected exactly one "${find.trim()}"`);
      text = text.replace(find, () => put);
    }
    return Buffer.from(text);
  }
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
    if (entry.how === 'adapted') {
      say(existsSync(path), `${entry.to}  (adapted from ${from})`);
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

  const copied = FILES.filter((f) => f.how !== 'adapted').length;
  console.log(`${check ? 'checked' : 'copied'}: ${copied} files and ${TREES.length} folder${TREES.length === 1 ? '' : 's'} derived from the originals, ${FILES.length - copied} adapted files on record; ${bad ? `${bad} FAILED` : 'all match'}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
