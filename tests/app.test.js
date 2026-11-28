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
import { BUILDS, homeOf } from '../src/fdm.js';
import { AIRCRAFT } from '../src/sim/flight-run.js';
import { BY_MODEL, LIST } from '../src/sim/aircraft/list.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { F4C_SIMPLE } from '../src/sim/aircraft/f4c-simple.js';
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
// What the app fetches that is not code it imports: JSBSim's two builds, and each airplane's files and its model.
// src/fdm.js names them relative to src/. FSG's own airplane, the F-4C, has its files in aircraft/, the Cessna in
// JSBSim's data (src/fdm.js, homeOf). Since milestone 3 re-planned, pull request 2, the airplanes are the picker's
// list (src/sim/aircraft/list.js): the page flies one of it (src/main.js), and the Worker's list of what it can
// fly (src/sim/flight-run.js) is the same one.
const fromSrc = (path) => './' + posix.normalize(posix.join('src', path));
const flown = LIST.map(({ aircraft }) => aircraft);
const assets = Object.values(BUILDS).flatMap((build) => [build.module, build.wasm]).map(fromSrc)
  .concat(flown.flatMap((aircraft) => aircraft.files.map((file) => fromSrc(homeOf(aircraft) + file))))
  .concat(flown.map((aircraft) => aircraft.glb));   // and the airplane's model, which the page finds from its own address

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
  console.log(`  ${files.length} files cached: ${modules.length} loaded by the app's code, ${assets.length} JSBSim files and models`);
});

test('the app flies the airplane picked from the one list, and the Worker\'s list is that list', () => {
  // Milestone 3 re-planned, pull request 2: the pause screen's Airplane picker. The page's airplane is the saved
  // choice (fsg.aircraft) from the one list, and its picker is filled from that list; the Worker's list is that
  // list. (From milestone 3's pull request 8 until then the app flew the F-4C alone: "const AIRCRAFT = F4C".)
  const main = code(read('src/main.js'));
  assert.match(main, /^import \{ LIST, aircraftFor \} from '\.\/sim\/aircraft\/list\.js';$/m, 'the page takes its airplanes from the list');
  assert.deepEqual([...main.matchAll(/from '\.\/sim\/aircraft\/([^']+)'/g)].map((m) => m[1]), ['list.js'], 'and from nowhere else');
  assert.match(main, /const AIRCRAFT_KEY = 'fsg\.aircraft';/);
  assert.match(main, /try \{ savedAircraft = localStorage\.getItem\(AIRCRAFT_KEY\); \} catch/);
  assert.match(main, /const AIRCRAFT = aircraftFor\(savedAircraft\);/, 'the saved choice, or the first in the list');
  assert.match(main, /for \(const \{ aircraft, name \} of LIST\) picker\.add\(new Option\(name, aircraft\.model\)\);/, 'the picker shows the list');
  assert.match(code(read('src/sim/flight-run.js')), /^import \{ BY_MODEL \} from "\.\/aircraft\/list\.js";$/m);
  assert.equal(AIRCRAFT, BY_MODEL, 'the Worker\'s list is the list');
  assert.deepEqual(Object.keys(AIRCRAFT), LIST.map(({ aircraft }) => aircraft.model));
  // Pull request 4 (docs/milestones/3-replan.md): the simple F-4C is first in the list. (It was ['f4c', 'c172p'].)
  assert.deepEqual(Object.keys(AIRCRAFT), ['f4c-simple', 'f4c', 'c172p']);
  assert.equal(AIRCRAFT['f4c-simple'], F4C_SIMPLE);
  assert.equal(F4C_SIMPLE.glb, './models/f4c.glb', 'the simple F-4C wears the owner\'s model too');
  // Its own file and engine, and both shared files: with the shared physics missing JSBSim does not fail the load cleanly, it dies (tests/simple-f4c.test.js).
  assert.deepEqual(F4C_SIMPLE.files.map((file) => fromSrc(homeOf(F4C_SIMPLE) + file)),
    ['./aircraft/f4c-simple/f4c-simple.xml', './aircraft/f4c-simple/Engines/J79.xml', './aircraft/f4c-simple/Engines/direct.xml', './aircraft/simple/aero.xml', './aircraft/simple/controls.xml']);
  assert.equal(AIRCRAFT.f4c, F4C);
  assert.equal(AIRCRAFT.c172p, C172P);
  assert.equal(F4C.glb, './models/f4c.glb');
  assert.deepEqual(F4C.files.map((file) => fromSrc(homeOf(F4C) + file)), ['./aircraft/f4c/f4c.xml', './aircraft/f4c/Engines/J79-GE-15.xml', './aircraft/f4c/Engines/direct.xml']);
  assert.equal(C172P.glb, './models/c172p.glb');
  assert.deepEqual(C172P.files.map((file) => fromSrc(homeOf(C172P) + file)), ['./jsbsim/jsbsim-data/aircraft/c172p/c172p.xml', './jsbsim/jsbsim-data/engine/eng_io320.xml', './jsbsim/jsbsim-data/engine/prop_75in2f.xml']);
});

test('sw.js lists exactly what the app loads: every airplane in the list, its files and model, and nothing it does not load', () => {
  // Since milestone 3's pull request 8 this holds for every file listed, not only the code and JSBSim: the
  // airplanes' own folder and the models too. What the page and the manifest name are loaded by the browser.
  // Since milestone 3 re-planned, pull request 2, that is every airplane in the picker's list (the F-4C alone
  // before it, when nothing of the Cessna was downloaded).
  const named = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).concat(manifest.icons.map((icon) => icon.src));
  const loaded = filesLoaded('./src/main.js').concat(assets, named, ['./', './index.html']);
  assert.deepEqual(listed.filter((f) => !loaded.includes(f)), [], 'cached but never loaded');
  const airplanes = LIST.flatMap(({ aircraft }) => aircraft.files.map((file) => fromSrc(homeOf(aircraft) + file)).concat([aircraft.glb]));
  // (Each once: since pull request 4 two airplanes in the list, the two F-4Cs, wear one model.)
  assert.deepEqual(listed.filter((f) => /^\.\/(aircraft|models|jsbsim\/jsbsim-data)\//.test(f)).sort(), [...new Set(airplanes)].sort(), 'the airplanes\' files and models in sw.js are exactly the list\'s');
  assert.ok(LIST.every(({ aircraft }) => listed.includes(`./src/sim/aircraft/${aircraft.model}.js`)), 'and each airplane\'s settings are cached');
  const bytes = listed.filter((f) => f !== './').reduce((sum, f) => sum + statSync(join(root, f)).size, 0);
  console.log(`  the app's download: ${listed.length - 1} files, ${bytes.toLocaleString('en-US')} bytes`);
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

test('the credit on the pause screen names the JSBSim that is pinned, and the Cessna\'s model', () => {
  const tag = read('jsbsim/pins.env').match(/^JSBSIM_TAG=v(.+)$/m)[1];
  // The credits are the small print at the pause screen's foot (they left its menu so the menu fits a phone's screen).
  // The Cessna's model and its credit left the app with the Cessna (milestone 3, pull request 8) and came back with it
  // in the picker (milestone 3 re-planned, pull request 2): on JSBSim's line, since two lines of small print would run
  // into the menu (tests/browser/app.chromium.mjs measures it).
  const pause = html.slice(html.indexOf('id="screen-pause"'), html.indexOf('id="screen-crashed"'));
  assert.ok(pause.includes(`<p class="about credits">Flight model: JSBSim ${tag}, LGPL 2.1 · Cessna 172P model: FlightGear's c172p team, GPL 2</p>`), `JSBSim ${tag}, and the Cessna's model, on one line`);
  assert.equal([...html.matchAll(/class="about credits"/g)].length, 1, 'one line of credits');
  assert.match(read('models/CREDITS.md'), /FlightGear's Cessna 172P[^]*GNU General Public License, version 2/, 'its credit is also with its model in the repo');
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
