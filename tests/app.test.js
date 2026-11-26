// The app's own bookkeeping. After 135crewdog/wings, tests/app.test.js,
// commit 557a8d0 (itself after Rage's): the version is the same in all three
// places, and the service worker's file list matches the app, so an update
// never leaves a phone on old files or a new file uncached.
// Added for FSG: the iPhone platform rules in CLAUDE.md that a test can read
// straight from the source (the shared origin's prefixes, relative paths,
// no skipWaiting on its own, full screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';
import { BUILDS, DATA } from '../src/fdm.js';
import { C172P } from '../src/sim/aircraft/c172p.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

// Source with its comments taken out, so a rule's name in a comment doesn't count as code.
const code = (source) => source.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

// Every file the app loads: src/main.js and whatever it imports, followed to
// the end. A name that is not a path ("three") is looked up in index.html's
// import map, as the browser does (after Wings' tests/app.test.js).
const importMap = JSON.parse(html.match(/<script type="importmap">([^]*?)<\/script>/)[1]).imports;
function resolve(specifier, from) {
  if (specifier.startsWith('.')) return './' + posix.normalize(posix.join(posix.dirname(from), specifier));
  const prefix = Object.keys(importMap).filter((key) => (key.endsWith('/') ? specifier.startsWith(key) : specifier === key)).sort((a, b) => b.length - a.length)[0];
  if (prefix === undefined) throw new Error(`${from} imports ${specifier}, which is neither a relative path nor in the import map`);
  return './' + posix.normalize(importMap[prefix] + specifier.slice(prefix.length));
}
function filesLoaded(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file);
    // import ... from '...', export ... from '...', import '...', import('...'), and the Worker's own file
    const imports = [/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"\n]+)['"]/gm, /^\s*import\s*['"]([^'"\n]+)['"]/gm, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
      /\bnew Worker\(\s*new URL\(\s*['"]([^'"\n]+)['"]/g];
    for (const pattern of imports) for (const m of source.matchAll(pattern)) visit(resolve(m[1], file));
  };
  visit(entry);
  return [...seen];
}
// Every .js file under src/, for the rules that hold for all the app's code.
function sources(dir = 'src') {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const file = `${dir}/${name}`;
    if (statSync(join(root, file)).isDirectory()) return sources(file);
    return file.endsWith('.js') ? [file] : [];
  });
}
const listed = [...sw.matchAll(/['"](\.\/[^'"]*)['"]/g)].map((m) => m[1]);
// What the app fetches that is not code it imports: JSBSim's two builds and the test aircraft's data.
// src/fdm.js names them relative to src/.
const fromSrc = (path) => './' + posix.normalize(posix.join('src', path));
const assets = Object.values(BUILDS).flatMap((build) => [build.module, build.wasm]).map(fromSrc).concat(C172P.files.map((file) => fromSrc(DATA + file)))
  .concat([C172P.glb]);   // and the airplane's model, which the page finds from its own address

// ---- Wings' tests ----

test('the version is the same in src/version.js, sw.js and CHANGELOG.md', () => {
  const inSw = sw.match(/const VERSION = '([^']+)'/);
  assert.ok(inSw, 'VERSION in sw.js');
  assert.equal(inSw[1], APP_VERSION, 'VERSION in sw.js equals APP_VERSION');
  const newest = read('CHANGELOG.md').match(/^## (\S+)/m);
  assert.ok(newest, 'a version heading in CHANGELOG.md');
  assert.equal(newest[1], APP_VERSION, 'the newest CHANGELOG.md entry equals APP_VERSION');
  console.log(`  version ${APP_VERSION}`);
});

test('sw.js caches every file the app loads, and lists only files that exist', () => {
  const files = listed.filter((f) => f !== './');
  assert.ok(listed.includes('./'), 'the app\'s own address is cached');
  assert.deepEqual(files.filter((f) => !existsSync(join(root, f))), [], 'listed but not on disk');
  const modules = filesLoaded('./src/main.js');
  assert.deepEqual(modules.filter((m) => !files.includes(m)), [], 'loaded by the app but not in sw.js');
  assert.ok(modules.includes('./src/sim/worker.js'), 'the Worker\'s own file and what it imports are followed');
  assert.deepEqual(assets.filter((a) => !files.includes(a)), [], 'fetched by the app but not in sw.js');
  // What index.html and the manifest name: the stylesheet, the icons, the manifest itself.
  const named = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).concat(manifest.icons.map((icon) => icon.src));
  assert.deepEqual(named.filter((f) => !files.includes(f)), [], 'named by index.html or the manifest but not in sw.js');
  assert.equal(new Set(files).size, files.length, 'no file listed twice');
  console.log(`  ${files.length} files cached: ${modules.length} loaded by the app's code, ${assets.length} JSBSim files`);
});

test('sw.js lists no code or data the app does not load', () => {
  const loaded = filesLoaded('./src/main.js').concat(assets);
  assert.deepEqual(listed.filter((f) => (f.startsWith('./src/') || f.startsWith('./jsbsim/')) && !loaded.includes(f)), [], 'cached but never loaded');
});

test('each JSBSim build is an Emscripten file with its .wasm beside it, and both are cached', () => {
  for (const [key, build] of Object.entries(BUILDS)) {
    assert.equal(build.wasm, build.module.replace(/\.mjs$/, '.wasm'), `${key}: the .wasm has the .mjs's name`);
    // The Emscripten file fetches the .wasm itself, by this name, from its own folder.
    const name = posix.basename(build.wasm);
    assert.ok(read(fromSrc(build.module)).includes(`new URL("${name}",import.meta.url)`), `${key}: the .mjs loads ${name} from beside itself`);
    for (const file of [build.module, build.wasm]) assert.ok(listed.includes(fromSrc(file)), `${fromSrc(file)} is in sw.js`);
  }
  assert.deepEqual(Object.keys(BUILDS), ['weh', 'jseh'], 'the fast build and the fallback');
});

test('the credit on the pause screen names the JSBSim that is pinned', () => {
  const tag = read('jsbsim/pins.env').match(/^JSBSIM_TAG=v(.+)$/m)[1];
  // The credits are the small print at the pause screen's foot (they left its menu so the menu fits a phone's screen).
  const pause = html.slice(html.indexOf('id="screen-pause"'), html.indexOf('id="screen-crashed"'));
  assert.ok(pause.includes(`<p class="about credits">Flight model: JSBSim ${tag}, LGPL 2.1<br>Cessna 172P model: FlightGear's c172p team, GPL 2</p>`), `JSBSim ${tag}, and the Cessna's model`);
  assert.match(read('jsbsim/jsbsim-data/COPYING'), /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/, 'and its licence is in the repo');
});

test('the simulation code has no DOM or Three.js code, so it runs headless in Node', () => {
  const files = sources('src/sim');
  for (const file of files) {
    assert.doesNotMatch(code(read(file)), /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|THREE)\b\s*[.(]/, `${file} uses nothing from the page`);
  }
  assert.ok(files.length >= 7, 'the wrapper, the loop and the Worker are there');
  console.log(`  ${files.length} headless files`);
});

// ---- added for FSG: the platform rules a test can read from the source ----

test('the shared origin: every cache is fsg-, only fsg- caches are deleted, every storage key is fsg.', () => {
  const worker = code(sw);
  assert.match(worker, /const CACHE = `fsg-\$\{VERSION\}`;/, 'the cache is named fsg-<version>');
  const opened = [...worker.matchAll(/caches\.open\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(opened.length > 0 && opened.every((name) => name === 'CACHE'), `caches opened: ${opened}`);
  const deletes = [...worker.matchAll(/caches\.delete\(/g)];
  assert.equal(deletes.length, 1, 'one place deletes caches');
  assert.match(worker, /keys\.filter\(\(k\) => k\.startsWith\('fsg-'\) && k !== CACHE\)\.map\(\(k\) => caches\.delete\(k\)\)/, 'and it deletes only caches that start with fsg-');
  for (const file of sources()) {
    const source = code(read(file));
    assert.doesNotMatch(source, /\bcaches\./, `${file} leaves the caches to sw.js`);
    // Storage is reached only through named keys, and every key starts with "fsg.".
    for (const m of source.matchAll(/(?:local|session)Storage\.\w+\(([^,)]*)/g)) assert.match(m[1], /^[A-Z_]+_KEY$/, `${file}: storage key ${m[1]}`);
    for (const m of source.matchAll(/\b[A-Z_]+_KEY = ([^;]+);/g)) assert.match(m[1], /^'fsg\.[A-Za-z]+'$/, `${file}: ${m[0]}`);
  }
});

test('every path is relative', () => {
  const paths = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    .concat([manifest.id, manifest.start_url, manifest.scope], manifest.icons.map((icon) => icon.src), listed);
  assert.ok(paths.length > 10);
  assert.deepEqual(paths.filter((p) => !p.startsWith('./')), [], 'not relative');
  for (const file of sources()) {
    const source = code(read(file));
    for (const m of source.matchAll(/(?:register|fetch|new URL|new Worker)\(\s*['"`]([^'"`]+)['"`]/g)) assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${file}: ${m[1]}`);
  }
});

test('the service worker skips waiting only when the app posts the pilot\'s tap', () => {
  const worker = code(sw);
  assert.equal([...worker.matchAll(/skipWaiting/g)].length, 1, 'skipWaiting appears once');
  assert.match(worker, /addEventListener\('message', \(event\) => \{\s*if \(event\.data === 'skip-waiting'\) self\.skipWaiting\(\);\s*\}\);/);
  // And the app posts it only from the update button's tap.
  const main = code(read('src/main.js'));
  assert.equal([...main.matchAll(/'skip-waiting'/g)].length, 1);
  assert.match(main, /button\.addEventListener\('click', \(\) => \{[^}]*postMessage\('skip-waiting'\);\s*\}\);/);
});

test('full screen: standalone, viewport-fit=cover, no zooming, a rotate screen in portrait', () => {
  assert.equal(manifest.display, 'standalone');
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  for (const part of ['viewport-fit=cover', 'user-scalable=no', 'maximum-scale=1']) assert.ok(viewport.includes(part), part);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const css = read('style.css');
  assert.match(css, /@media \(orientation: portrait\) \{[^}]*\{[^}]*\} #rotate \{ display: flex; \} \}/, 'portrait shows the rotate screen');
  for (const rule of ['overflow: hidden', 'user-select: none', 'touch-action: none', 'overscroll-behavior: none']) assert.ok(css.includes(rule), rule);
});

// ---- added for FSG: the owner's icon (icons/make-icons.py) ----

test('every icon is a square, opaque PNG of the size its page names', () => {
  // A PNG's header holds its width, height and colour type: 2 is RGB, with no transparency for iOS to fill with black.
  const png = (file) => {
    const bytes = readFileSync(join(root, file));
    assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colour: bytes[25] };
  };
  const named = [
    [html.match(/<link rel="icon" href="([^"]+)">/)[1], '32x32'],
    [html.match(/<link rel="apple-touch-icon" href="([^"]+)">/)[1], '180x180'],   // the home screen: 60 points at 3x
    ...manifest.icons.map((icon) => [icon.src, icon.sizes]),
  ];
  assert.deepEqual(named.map(([, sizes]) => sizes), ['32x32', '180x180', '192x192', '512x512']);
  for (const [file, sizes] of [...named, ['./icons/icon-1024.png', '1024x1024']]) {
    const { width, height, colour } = png(file);
    assert.equal(`${width}x${height}`, sizes, `${file} is ${sizes}`);
    assert.equal(colour, 2, `${file} is opaque RGB`);
    if (file !== './icons/icon-1024.png') assert.equal(file, `./icons/icon-${width}.png`, `${file} is named for its size`);
  }
  for (const icon of manifest.icons) assert.equal(icon.type, 'image/png');
});

// ---- caught up with Wings (docs/milestones/2.md, "Wings catch-up"; Wings commits 1ced0e8, c9ded4f, 4e7745b, 2eb7b98, 6542a06, b0485bc, 3fdad59) ----
const main = read('src/main.js');
// What a player reads: the page's own text, the manifest's description, and every string the app's page code writes.
const pageText = html.replace(/<!--[^]*?-->/g, '').replace(/<script[^]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
const written = ['src/main.js', 'src/flight.js', 'src/fdm.js'].map((f) => code(read(f))).join('\n');

test('the debug overlay: its switch says so, and nothing a player reads says "Developer"', () => {
  assert.match(html, /<span id="dev-label">Debug overlay<\/span>/);
  assert.doesNotMatch(pageText, /developer/i);
  for (const file of ['CLAUDE.md', 'README.md', 'src/main.js', 'src/flight.js', 'src/fdm.js', 'style.css', 'index.html']) assert.doesNotMatch(read(file), /developer overlay/i, file);
  assert.match(main, /const DEV_KEY = 'fsg\.dev';/, 'the choice is kept where it was, so an overlay that was on stays on');
});

test('device wording: nothing a player reads says "phone" or "iPhone"', () => {
  assert.doesNotMatch(pageText, /phone/i, 'index.html');
  assert.doesNotMatch(manifest.description, /phone/i, 'the manifest');
  assert.doesNotMatch(written, /phone/i, 'what the app writes on a screen');
});

test('the rotate screen says it in few words', () => {
  assert.match(html, /<section id="rotate">\s*<h1>Rotate your device<\/h1>\s*<p>If it won't turn, turn off rotation lock\.<\/p>\s*<\/section>/);
});

test('losing focus pauses, as leaving the app does', () => {
  assert.match(code(main), /window\.addEventListener\('blur', pause\);/);
  assert.match(code(main), /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.hidden\) pause\(\);/);
});

test('Dependabot keeps the workflow tools current, and they are at least where Wings has them', () => {
  const dependabot = read('.github/dependabot.yml').replace(/^#.*\n/gm, '');
  assert.equal(dependabot, 'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: monthly\n    groups:\n      workflow-tools:\n        patterns: ["*"]\n    commit-message:\n      prefix: "Workflow tools"\n');
  const wings = { checkout: 7, 'setup-node': 7, 'configure-pages': 6, 'upload-pages-artifact': 5, 'deploy-pages': 5 };   // Wings at 3fdad59
  const used = readdirSync(join(root, '.github/workflows')).flatMap((f) => [...read(`.github/workflows/${f}`).matchAll(/uses: actions\/([\w-]+)@v(\d+)/g)].map((m) => [f, m[1], Number(m[2])]));
  for (const [name, least] of Object.entries(wings)) assert.ok(used.some(([, n]) => n === name), `${name} is used`);
  for (const [file, name, version] of used) if (name in wings) assert.ok(version >= wings[name], `${file}: ${name} v${version}, Wings has v${wings[name]}`);
});
