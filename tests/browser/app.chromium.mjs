// Runs the app in headless Chromium, served under /fsg/ as on GitHub Pages,
// and prints what it found. Chromium is not Safari: this shows the shell and
// its service worker work in a browser; the iPhone result comes from the owner.
// After 135crewdog/FDM, tests/page.chromium.mjs, commit e478825, adapted to
// drive the app instead of FDM's test page.
//
// It is not part of `npm test`: it needs Playwright, which Claude Code's
// sessions have and the repo does not depend on.
//   node tests/browser/app.chromium.mjs
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const version = readFileSync(join(root, 'src/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.xml': 'application/xml',
};

let next = null;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/fsg/')) { res.writeHead(404).end('not found'); return; }
  const file = normalize(join(root, url.pathname.slice('/fsg/'.length) || 'index.html'));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  let body = readFileSync(file);
  // Once `next` is set, the server plays a newer deploy: the same app with a later version number.
  if (next && (file.endsWith('sw.js') || file.endsWith('version.js'))) body = body.toString().replaceAll(`'${version}'`, `'${next}'`);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/fsg/`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 852, height: 393 } });   // an iPhone 16 in landscape
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failed = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
};
const visible = (selector) => page.locator(selector).isVisible();
const text = (selector) => page.locator(selector).textContent();

// 1. It loads, and shows the start screen with the name and the version.
await page.goto(base);
check(await visible('#screen-start') && !(await visible('#screen-pause')), 'the start screen shows');
check((await text('#screen-start h1')) === 'FSG', 'the name is FSG');
check((await text('#screen-start .version')) === version, 'the version shows', version);
check(!(await visible('#rotate')), 'no rotate screen in landscape');
check(!(await visible('#screen-start .update')), 'no update offered on a first visit');

// 2. The service worker installs and takes control.
await page.waitForFunction(() => window.fsg.offline === 'yes', null, { timeout: 15000 });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
const caches = await page.evaluate(() => caches.keys());
check(caches.length === 1 && caches[0] === `fsg-${version}`, 'one cache, named for the version', caches.join(', '));

// 3. Settings opens the pause screen; the Developer switch shows the overlay.
await page.click('#settings');
check(await visible('#screen-pause') && !(await visible('#screen-start')), 'Settings opens the pause screen');
check(!(await visible('#dev')), 'the overlay is off until it is switched on');
await page.click('#dev-switch');
check(await visible('#dev'), 'Developer on shows the overlay');
// With Developer on, a Worker starts JSBSim, loads c172x and times its step.
const jsbsimRan = () => page.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 60000 }).then(() => page.evaluate(() => window.fsg.jsbsim));
// ... and then measures the physics clock two ways, ten seconds each: two lines for each.
const CLOCK = (name) => `${name}: [\\d.]+ steps\\/s, [\\d.]+ s dropped\\n {2}gaps between states: \\d+ ms typical, \\d+ ms for 99 in 100, \\d+ ms worst`;
const jsbsimLines = (box) => new RegExp(`JSBSim 1\\.3\\.3 {3}(wasm exceptions|fallback build)\\nc172x loaded in \\d+ ms\\n[\\d.]+ µs per step {3}\\(3000 steps at 1\\/120 s\\)\\n${CLOCK("Worker's clock")}\\n${CLOCK('page ticks')}$`).test(box);
const clockSays = (c) => `${c.steps} steps in ${c.seconds.toFixed(2)} s (${c.stepsPerSecond.toFixed(1)} a second), ${c.droppedSeconds.toFixed(2)} s dropped, ${c.states} states, gaps ${Math.round(c.gaps.typical)} ms typical, ${Math.round(c.gaps.most)} for 99 in 100, ${Math.round(c.gaps.worst)} worst`;
let ran = await jsbsimRan();
let box = await text('#dev');
check(box.includes(`FSG ${version}`) && box.includes('browser tab') && box.includes('offline ready: yes'), 'the overlay says what it should', box.replace(/\n/g, ' | '));
check(!ran.error && ran.build === 'weh' && jsbsimLines(box) && box.includes('wasm exceptions'), 'JSBSim runs in its Worker: the fast build, c172x loaded, a step time',
  ran.error ?? `${ran.usPerStep.toFixed(1)} µs per step; c172x loaded in ${Math.round(ran.loadMs)} ms; after the benchmark ${Math.round(ran.endAltitudeFt)} ft, ${Math.round(ran.endAirspeedKt)} kt`);
check(Math.abs(ran.startAltitudeFt - 4000) < 0.1, 'c172x starts where its file says: 4,000 ft', `${ran.startAltitudeFt.toFixed(3)} ft`);
// The Worker's own clock, on a real clock: within 1% of 120 steps a second over ten seconds (docs/milestones/1.md, pull request 3).
check(!ran.error && ran.clocks.worker.steps >= 1188 && ran.clocks.worker.steps <= 1212 && Math.abs(ran.clocks.worker.seconds - 10) < 0.05,
  "the Worker's own clock: 1,188 to 1,212 steps in 10 s", ran.error ?? clockSays(ran.clocks.worker));
check(!ran.error && ran.clocks.page.steps > 0, 'page ticks are measured beside it', ran.error ?? clockSays(ran.clocks.page));
check((await page.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'the starting marker is cleared once JSBSim has started');
check((await page.evaluate(() => localStorage.getItem('fsg.dev'))) === 'on', 'the choice is kept as fsg.dev');
const keys = await page.evaluate(() => Object.keys(localStorage));
check(keys.every((k) => k.startsWith('fsg.')), 'every storage key starts with fsg.', keys.join(', '));
await page.click('#back');
check(await visible('#screen-start'), 'Back returns to the start screen');

// 4. With the network off, a reload still works, and the switch is still on.
await context.setOffline(true);
await page.reload();
check((await text('#screen-start .version')) === version, 'offline: a reload still opens the app');
check(await visible('#dev'), 'the Developer switch is still on after a reload');
ran = await jsbsimRan();
box = await text('#dev');
check(!ran.error && ran.build === 'weh' && jsbsimLines(box), 'offline: JSBSim starts in its Worker all the same', ran.error ?? box.split('\n').slice(3).join(' | '));
check(!ran.error && ran.clocks.worker.steps >= 1188 && ran.clocks.worker.steps <= 1212, "offline: the Worker's own clock keeps time all the same", ran.error ?? clockSays(ran.clocks.worker));
await context.setOffline(false);

// 5. Portrait shows the rotate screen.
await page.setViewportSize({ width: 393, height: 852 });
check(await visible('#rotate'), 'portrait shows the rotate screen');
await page.setViewportSize({ width: 852, height: 393 });
check(!(await visible('#rotate')), 'and landscape takes it away');

// 6. A newer version is offered, not taken; the tap takes it.
next = `${version}-next`;
await page.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 60000 });   // let the run started by the reload finish
await page.click('#settings');   // opening the pause screen asks the server for a new sw.js
await page.waitForFunction(() => !document.querySelector('#screen-pause .update').hidden, null, { timeout: 15000 });
check(true, 'a newer version is offered on the pause screen');
check((await page.evaluate(() => window.fsg.version)) === version, 'and nothing changes until it is tapped', `still ${version}`);
await Promise.all([page.waitForEvent('load'), page.click('#screen-pause .update')]);
await page.waitForFunction(() => window.fsg !== undefined);
check((await text('#screen-start .version')) === next, 'the tap takes the update', next);
const after = await page.evaluate(() => caches.keys());
check(after.length === 1 && after[0] === `fsg-${next}`, 'the old cache is gone, the new one is in', after.join(', '));
check(!(await visible('#screen-start .update')), 'and the offer is gone');

// 7. The fallback. Two fresh visits with no service worker, so the fast build can be made to fail.
{
  // (a) The fast build does not start: the app falls back to the second build by itself.
  const broken = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  await broken.route('**/fdm-weh.wasm', (route) => route.abort());
  const p = await broken.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await p.goto(base);
  await p.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 60000 });
  const r = await p.evaluate(() => window.fsg.jsbsim);
  const b = await p.locator('#dev').textContent();
  check(!r.error && r.build === 'jseh' && b.includes('fallback build') && jsbsimLines(b), 'the fast build fails to start: the fallback build runs', r.error ?? b.split('\n').slice(3).join(' | '));
  check((await p.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the marker is cleared');
  await broken.close();

  // (b) The marker is still set from a launch that died while starting the fast build: straight to the fallback.
  const died = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  const q = await died.newPage();
  const asked = [];
  q.on('request', (request) => { if (request.url().includes('/dist-wasm/')) asked.push(request.url().split('/').pop()); });
  await q.addInitScript(() => {
    if (sessionStorage.getItem('test.once')) return;   // only before the first load
    sessionStorage.setItem('test.once', '1');
    localStorage.setItem('fsg.dev', 'on');
    localStorage.setItem('fsg.fdmStarting', 'weh');
  });
  await q.goto(base);
  await q.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 60000 });
  const r2 = await q.evaluate(() => window.fsg.jsbsim);
  check(!r2.error && r2.build === 'jseh' && !asked.some((name) => name.startsWith('fdm-weh')), 'a marker left by a launch that died: straight to the fallback build', `fetched ${asked.join(', ')}`);
  check((await q.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the next launch will try the fast build again');
  await q.reload();
  await q.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 60000 });
  check((await q.evaluate(() => window.fsg.jsbsim.build)) === 'weh', 'which it does');
  await died.close();

  // (c) The Worker's own file fails to load, and fails while the aircraft files are still on their way.
  //     Neither build can start: the overlay must say so, not sit at "starting", and the switch must retry.
  const noWorker = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  await noWorker.route('**/src/sim/worker.js', (route) => route.abort());
  await noWorker.route('**/jsbsim-data/**', async (route) => { await new Promise((done) => setTimeout(done, 400)); await route.continue(); });
  const w = await noWorker.newPage();
  await w.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await w.goto(base);
  const settled = await w.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 20000 }).then(() => true, () => false);
  const r3 = settled ? await w.evaluate(() => window.fsg.jsbsim) : null;
  const b3 = await w.locator('#dev').textContent();
  check(settled && typeof r3.error === 'string' && b3.includes('JSBSim did not start'), 'the Worker itself fails to load: the overlay says so', settled ? b3.split('\n').slice(3).join(' | ') : `stuck at: ${b3.split('\n').slice(3).join(' | ')}`);
  check((await w.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the marker is cleared');
  if (settled) {
    await noWorker.unroute('**/src/sim/worker.js');
    await w.click('#settings');
    await w.click('#dev-switch');   // off
    await w.click('#dev-switch');   // on again: a fresh try
    await w.waitForFunction(() => window.fsg.jsbsim !== null && !window.fsg.jsbsim.error, null, { timeout: 60000 }).catch(() => {});
    check((await w.evaluate(() => window.fsg.jsbsim?.build)) === 'weh', 'switching Developer off and on tries again, and now it starts');
  }
  await noWorker.close();
}

check(errors.length === 0, 'no console errors', errors.join(' | '));
console.log(`\nChromium ${browser.version()} (headless), FSG ${version}: ${failed ? `${failed} FAILED` : 'all passed'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
