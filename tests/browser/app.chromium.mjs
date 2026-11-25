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
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.xml': 'application/xml', '.glb': 'model/gltf-binary',
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

// 1b. The picture (milestone 2, pull request 4): the Cessna stands on the runway's numbers behind the start
// screen, and once it has been drawn the app rests. `node tests/browser/app.chromium.mjs <folder>` also saves
// what it looks like there, for the pull request.
const shots = process.argv[2];
const pictureIs = async (when) => {
  // Drawn: the model has arrived and a frame has been drawn with it. (Headless Chromium draws in software, a
  // frame every 60 ms or more, so the 30 frames it draws before it rests take longer than they do on a phone.)
  const drawn = await page.waitForFunction(() => window.fsg.picture.loaded && window.fsg.picture.withModel > 0, null, { timeout: 3000 }).then(() => true, () => false);
  check(drawn, `${when}: the picture is drawn behind the start screen within 3 s`);
  const rested = await page.waitForFunction(() => window.fsg.picture.resting, null, { timeout: 15000 }).then(() => true, () => false);
  const p = await page.evaluate(() => window.fsg.picture);
  check(rested, `${when}: and then the app rests`, `${p.frames} frames, ${p.triangles} triangles`);
  check(p.loaded && p.wheelsIn.every((inches) => Math.abs(inches) <= 1), `${when}: the Cessna's wheels are within 1 in of the runway`, p.wheelsIn?.map((inches) => `${inches.toFixed(2)} in`).join(', '));
  check(p.loaded && p.nose[0] > 0.99 && Math.abs(p.nose[2]) < 0.01, `${when}: its nose points down the runway, to the east`, p.nose?.map((x) => x.toFixed(3)).join(', '));
  await page.waitForTimeout(1000);
  const later = await page.evaluate(() => window.fsg.picture);
  check(later.resting && later.frames === p.frames, `${when}: once it has settled no more frames are drawn`, `${later.frames} frames a second later`);
  return p;
};
await pictureIs('first visit');
if (shots) await page.screenshot({ path: join(shots, 'start.png') });
if (shots) {
  await page.evaluate(() => { document.getElementById('screen-start').hidden = true; });
  await page.screenshot({ path: join(shots, 'picture.png') });
  await page.evaluate(() => { document.getElementById('screen-start').hidden = false; });
}
// A new size is a change: it draws again for a moment, then rests again.
{
  const before = (await page.evaluate(() => window.fsg.picture)).frames;
  await page.setViewportSize({ width: 800, height: 380 });
  await page.waitForFunction((n) => window.fsg.picture.frames > n && window.fsg.picture.resting, before, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => window.fsg.picture);
  check(after.frames > before && after.resting, 'a new size draws it again for a moment, then it rests', `${after.frames - before} frames`);
  await page.setViewportSize({ width: 852, height: 393 });
}

// 2. The service worker installs and takes control.
await page.waitForFunction(() => window.fsg.offline === 'yes', null, { timeout: 15000 });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
const caches = await page.evaluate(() => caches.keys());
check(caches.length === 1 && caches[0] === `fsg-${version}`, 'one cache, named for the version', caches.join(', '));

// 3. The game (milestone 2, pull request 5). JSBSim starts in its Worker when the app opens: the fast build,
//    the Cessna parked on the numbers and held. Fly lets it go.
const KT = 1.6878;
const on = (p) => ({
  ready: () => p.waitForFunction(() => !document.getElementById('fly').disabled, null, { timeout: 60000 }).then(() => true, () => false),
  flight: () => p.evaluate(() => window.fsg.picture),
  jsbsim: () => p.evaluate(() => window.fsg.jsbsim),
  mode: () => p.evaluate(() => window.fsg.mode),
  /** Fly, and wait for the flight to be running on screen. */
  async fly(button = '#fly') {
    await p.click(button);
    return p.waitForFunction(() => window.fsg.picture.flying && window.fsg.picture.states > 0 && window.fsg.picture.withModel > 0, null, { timeout: 3000 }).then(() => true, () => false);
  },
});
const app = on(page);
const parked = (f) => f.wheelsDown === 3 && f.groundKt < 0.1 && Math.hypot(f.northFt, f.eastFt) < 1 && Math.abs(f.headingDeg - 90) < 0.1 && f.wheelsIn.every((inches) => Math.abs(inches) <= 1) &&
  f.propellerRpm >= 700 && f.propellerRpm <= 900 && f.ended === null;
const where = (f) => `${Math.hypot(f.northFt, f.eastFt).toFixed(2)} ft from the numbers, heading ${f.headingDeg.toFixed(2)}, ${f.wheelsDown} wheels down (${f.wheelsIn.map((x) => x.toFixed(2)).join(', ')} in), ${f.groundKt.toFixed(2)} kt, ${f.propellerRpm.toFixed(0)} RPM`;
const overlaySays = (box, what) => new RegExp(`^FSG [^\n]+\n(browser tab|home-screen app)\noffline ready: [a-z ]+\nJSBSim 1\\.3\\.3 {3}(wasm exceptions|fallback build: [^\n]+)\nc172p {3}${what}\n\\d+ frames/s \\(least \\d+\\) {3}\\d+ draws\n[\\d.]+ steps/s {3}[\\d.]+ s dropped {3}[\\d,]+ states, \\d+ missing\npicture \\d+ ms behind \\(99 in 100 within \\d+, most \\d+\\)\n-?[\\d,]+ ft N, -?[\\d,]+ ft E, -?[\\d,]+ ft up, heading \\d{3}, \\d+ kt, [\\d,]+ RPM$`).test(box);

check(await app.ready(), 'Fly is ready: the model has loaded and JSBSim has started');
let js = await app.jsbsim();
check(!js.error && js.build === 'weh' && js.says === 'JSBSim 1.3.3   wasm exceptions', 'JSBSim starts in its Worker when the app opens: the fast build', js.error ?? js.says);
check((await page.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'the starting marker is cleared once JSBSim has started');
let f = await app.flight();
const rests = await page.waitForFunction(() => window.fsg.picture.resting, null, { timeout: 15000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
let later = await app.flight();
check(parked(f) && !f.flying && f.states === 0 && later.states === 0 && later.time === f.time, 'the Cessna is parked on the numbers and held: no state is posted and no time passes', where(f));
check(rests && later.resting, 'held, the picture rests');

// Settings before the first flight: the pause screen, with Fly at its top and no Restart; the Developer switch.
await page.click('#settings');
check(await visible('#screen-pause') && !(await visible('#screen-start')), 'Settings opens the pause screen');
check((await text('#resume')) === 'Fly' && !(await visible('#restart')), 'before the first flight its top button is Fly, and there is no Restart');
check(!(await visible('#dev')), 'the overlay is off until it is switched on');
await page.click('#dev-switch');
check(await visible('#dev'), 'Developer on shows the overlay');
let box = await text('#dev');
check(box.includes(`FSG ${version}`) && box.includes('browser tab') && box.includes('offline ready: yes') && overlaySays(box, 'parked'), 'the overlay says what it should', box.replace(/\n/g, ' | '));
check((await page.evaluate(() => localStorage.getItem('fsg.dev'))) === 'on', 'the choice is kept as fsg.dev');
const keys = await page.evaluate(() => Object.keys(localStorage));
check(keys.every((k) => k.startsWith('fsg.')), 'every storage key starts with fsg.', keys.join(', '));

// Fly, from that screen.
check(await app.fly('#resume'), 'Fly shows the flight within 3 s');
check((await app.mode()) === 'flying' && !(await visible('#screen-pause')) && !(await visible('#screen-start')) && (await visible('#pause')), 'in flight there is no screen, only the pause button');
f = await app.flight();
await page.waitForTimeout(500);
later = await app.flight();
check(parked(later), 'the Cessna is within 1 ft of the numbers on heading 090, wheels on the ground, propeller 700 to 900 RPM', where(later));
check(later.discShown && later.propellerTurn !== f.propellerTurn && later.surfaces.flaps === 1, 'and its propeller is turning on screen, its flaps down', `turned from ${f.propellerTurn.toFixed(3)} to ${later.propellerTurn.toFixed(3)}`);
if (shots) await page.screenshot({ path: join(shots, 'flying.png') });
// Ten seconds by the Worker's own clock.
{
  const from = await app.flight();
  await page.waitForTimeout(10000);
  const to = await app.flight();
  const seconds = to.seconds - from.seconds, steps = to.steps - from.steps, inTen = (steps / seconds) * 10;
  check(seconds > 9 && inTen >= 1188 && inTen <= 1212 && to.missing === 0 && to.outOfOrder === 0 && to.droppedSeconds === 0, '1,188 to 1,212 steps in 10 s; every state in order and none missing',
    `${steps} steps in ${seconds.toFixed(3)} s (${inTen.toFixed(1)} in ten), ${to.states} states, ${to.missing} missing, ${to.outOfOrder} out of order, ${to.droppedSeconds.toFixed(2)} s dropped`);
  check(to.behindWithinMs > 0 && to.behindWithinMs <= 40, 'the picture trails the newest state (in this browser, drawing in software)', `99 frames in 100 within ${to.behindWithinMs} ms, most ${to.behindMostMs.toFixed(0)}; ${to.fps.toFixed(0)} frames a second`);
  box = await text('#dev');
  check(overlaySays(box, 'flying'), 'in flight the overlay shows how it is running', box.replace(/\n/g, ' | '));
}
// A finger dragged across the picture looks around; let go and the view comes back.
{
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(600, 210, { steps: 8 });
  await page.waitForTimeout(300);
  const dragged = (await app.flight()).look;
  if (shots) await page.screenshot({ path: join(shots, 'look.png') });
  await page.mouse.up();
  const back = await page.waitForFunction(() => window.fsg.picture.look.yaw === 0 && window.fsg.picture.look.pitch === 0, null, { timeout: 5000 }).then(() => true, () => false);
  check(Math.abs(dragged.yaw - 75) < 1 && Math.abs(dragged.pitch + 10) < 1 && back, 'a drag across the picture looks around the airplane; let go and the view comes back', `dragged to yaw ${dragged.yaw}, pitch ${dragged.pitch}`);
}
// Pause: the picture stops, the Worker rests. Resume catches nothing up.
{
  // The tap and the count of frames at that moment, in one go: this browser draws slowly, and a count read a moment before the tap would be stale.
  const atTap = await page.evaluate(() => { document.getElementById('pause').click(); return window.fsg.picture.frames; });
  check((await app.mode()) === 'paused' && (await visible('#screen-pause')) && (await text('#resume')) === 'Resume' && (await visible('#restart')), 'the pause button opens the pause screen: Resume and Restart');
  await page.waitForFunction(() => window.fsg.picture.resting, null, { timeout: 15000 }).catch(() => {});
  const stopped = await app.flight();
  check(stopped.resting && stopped.frames - atTap <= 30, 'paused, the picture stops within 30 frames', `${stopped.frames - atTap} frames after the tap`);
  box = await text('#dev');
  check(overlaySays(box, 'paused') && /\(least [1-9]/.test(box), 'on the pause screen the overlay keeps the flight\'s numbers, for a screenshot', box.replace(/\n/g, ' | '));
  if (shots) await page.screenshot({ path: join(shots, 'paused.png') });
  await page.waitForTimeout(3000);
  const held = await app.flight();
  check(held.states === stopped.states && held.time === stopped.time && held.frames === stopped.frames, 'for three seconds the Worker posts nothing and no frame is drawn', `${held.states} states`);
  await page.click('#resume');
  await page.waitForTimeout(1000);
  const resumed = await app.flight();
  const moved = resumed.time - held.time;
  check((await app.mode()) === 'flying' && moved > 0.3 && moved < 1.8, 'Resume carries on from where it stopped: the three seconds are not caught up', `${moved.toFixed(2)} s of the flight's own time in the second after Resume`);
}
// Restart: a new flight, parked on the numbers again, and straight into it.
{
  const before = await app.flight();
  await page.click('#pause');
  await page.click('#restart');
  await page.waitForFunction((n) => window.fsg.picture.flight > n && window.fsg.picture.flying && window.fsg.picture.states > 0, before.flight, { timeout: 5000 }).catch(() => {});
  const again = await app.flight();
  check((await app.mode()) === 'flying' && again.flight === before.flight + 1 && parked(again) && again.time < before.time && again.pictureTime <= again.time && again.pictureTime >= 10,
    'Restart parks it on the numbers again, in a new flight, and no moment of the old one is shown', `flight ${again.flight}: ${where(again)}; its own time ${again.time.toFixed(2)} s`);
}
// The app is hidden while a restart is being made: the new flight waits on the pause screen, held.
{
  const before = await app.flight();
  await page.click('#pause');
  await page.evaluate(() => {
    document.getElementById('restart').click();   // the tap; the new flight is asked for, and is not there yet
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction((n) => window.fsg.picture.flight > n, before.flight, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const waiting = await app.flight();
  check((await app.mode()) === 'paused' && waiting.flight === before.flight + 1 && !waiting.flying && waiting.states === 0 && (await visible('#screen-pause')),
    'hidden while Restart makes the new flight: it waits on the pause screen, held', `flight ${waiting.flight}, ${waiting.states} states, mode ${await app.mode()}`);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.click('#resume');
  check((await app.mode()) === 'flying', 'and Resume flies it');
}
// A hidden page pauses the flight, and it stays paused when the page comes back.
{
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await app.mode();
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check(hidden === 'paused' && (await app.mode()) === 'paused' && (await visible('#screen-pause')), 'a hidden page pauses the flight; it resumes only from the pause screen');
  await page.click('#resume');
}
await page.click('#pause');
await page.click('#settings').catch(() => {});   // nothing: the start screen is behind us

// 4. With the network off, a reload still works, the switch is still on, and the game starts and flies.
await context.setOffline(true);
await page.reload();
check((await text('#screen-start .version')) === version, 'offline: a reload still opens the app');
await pictureIs('offline');
check(await visible('#dev'), 'the Developer switch is still on after a reload');
check(await app.ready(), 'offline: Fly is ready');
js = await app.jsbsim();
check(!js.error && js.build === 'weh', 'offline: JSBSim starts in its Worker all the same', js.error ?? js.says);
check(await app.fly(), 'offline: Fly shows the flight within 3 s');
await page.waitForTimeout(2000);
f = await app.flight();
check(parked(f) && f.missing === 0 && Math.abs(f.stepsPerSecond - 120) < 1.2, 'offline: the game runs in the Worker all the same', `${where(f)}; ${f.stepsPerSecond.toFixed(1)} steps a second`);
await context.setOffline(false);

// 5. Portrait shows the rotate screen, and pauses the flight.
await page.setViewportSize({ width: 393, height: 852 });
check(await visible('#rotate'), 'portrait shows the rotate screen');
check((await app.mode()) === 'paused', 'and pauses the flight');
await page.setViewportSize({ width: 852, height: 393 });
check(!(await visible('#rotate')) && (await app.mode()) === 'paused' && (await visible('#screen-pause')), 'landscape takes it away, and the flight waits on the pause screen');

// 6. A newer version is offered, not taken; the tap takes it. (The pause screen asks the server for a new sw.js when it opens.)
next = `${version}-next`;
await page.click('#resume');
await page.click('#pause');
await page.waitForFunction(() => !document.querySelector('#screen-pause .update').hidden, null, { timeout: 15000 });
check(true, 'a newer version is offered on the pause screen');
check((await page.evaluate(() => window.fsg.version)) === version, 'and nothing changes until it is tapped', `still ${version}`);
await Promise.all([page.waitForEvent('load'), page.click('#screen-pause .update')]);
await page.waitForFunction(() => window.fsg !== undefined);
check((await text('#screen-start .version')) === next, 'the tap takes the update', next);
const after = await page.evaluate(() => caches.keys());
check(after.length === 1 && after[0] === `fsg-${next}`, 'the old cache is gone, the new one is in', after.join(', '));
check(!(await visible('#screen-start .update')), 'and the offer is gone');
// That update was taken in the middle of a flight (paused, the Worker holding it): the fast build had started
// long before, so the launch after it starts the fast build, as any launch does. (On the owner's phone the
// launch after each of two updates once said "fallback build"; docs/milestones/1.md has what was found.)
await app.ready();
js = await app.jsbsim();
check(!js.error && js.build === 'weh' && (await text('#dev')).includes('wasm exceptions'), 'after an update taken in mid-flight, JSBSim starts on the fast build', js.error ?? js.says);

// 7. The fallback. Fresh visits with no service worker, so the fast build can be made to fail.
{
  // (a) The fast build does not start: the app falls back to the second build by itself, and says why.
  const broken = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  await broken.route('**/fdm-weh.wasm', (route) => route.abort());
  const p = await broken.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await p.goto(base);
  await on(p).ready();
  const r = await on(p).jsbsim();
  const b = await p.locator('#dev').textContent();
  check(!r.error && r.build === 'jseh' && overlaySays(b, 'parked'), 'the fast build fails to start: the fallback build runs', r.error ?? r.says);
  check(/fallback build: the fast build did not start \(.+\)\n/.test(b), 'and its line says why: the fast build did not start', b.split('\n').find((line) => line.includes('fallback build')));
  check((await p.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the marker is cleared');
  check((await on(p).fly()) && parked(await on(p).flight()), 'and it flies on the fallback build', where(await on(p).flight()));
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
  await on(q).ready();
  const r2 = await on(q).jsbsim();
  check(!r2.error && r2.build === 'jseh' && !asked.some((name) => name.startsWith('fdm-weh')), 'a marker left by a launch that died: straight to the fallback build', `fetched ${asked.join(', ')}`);
  const b2 = await q.locator('#dev').textContent();
  check(b2.includes('fallback build: the launch before this stopped while the fast build was starting\n'), 'and its line says why: the launch before stopped while the fast build was starting', b2.split('\n').find((line) => line.includes('fallback build')));
  check((await q.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the next launch will try the fast build again');
  await q.reload();
  await on(q).ready();
  check((await on(q).jsbsim()).build === 'weh', 'which it does');
  await died.close();

  // (c) The Worker's own file fails to load, and fails while the aircraft files are still on their way.
  //     Neither build can start: the app must say so, not sit waiting, and Restart must try again.
  const noWorker = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  await noWorker.route('**/src/sim/worker.js', (route) => route.abort());
  await noWorker.route('**/jsbsim-data/**', async (route) => { await new Promise((done) => setTimeout(done, 400)); await route.continue(); });
  const w = await noWorker.newPage();
  await w.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await w.goto(base);
  const settled = await w.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 20000 }).then(() => true, () => false);
  const r3 = settled ? await on(w).jsbsim() : null;
  const b3 = await w.locator('#dev').textContent();
  check(settled && typeof r3.error === 'string' && b3.includes('JSBSim did not start') && (await w.locator('#screen-crashed').isVisible()) && (await w.locator('#crash-why').textContent()).includes('JSBSim did not start'),
    'the Worker itself fails to load: the app says so, on the crashed screen and the overlay', settled ? b3.split('\n').slice(3).join(' | ') : `stuck at: ${b3.split('\n').slice(3).join(' | ')}`);
  check((await w.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the marker is cleared');
  if (settled) {
    await noWorker.unroute('**/src/sim/worker.js');
    await w.click('#crash-restart');
    await w.waitForFunction(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, { timeout: 60000 }).catch(() => {});
    check((await on(w).jsbsim())?.build === 'weh' && parked(await on(w).flight()), 'Restart tries again, and now it starts and flies');
  }
  await noWorker.close();
}

// 8. A Worker made to fail in mid-flight: the crashed screen, and Restart gives a parked airplane in a fresh
//    Worker. Its own page, so that the error it makes is not counted above.
{
  const failing = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  const g = await failing.newPage();
  await g.goto(base);
  await on(g).ready();
  await on(g).fly();
  await g.waitForTimeout(1000);
  const first = g.workers()[0];
  check(g.workers().length === 1 && (await on(g).mode()) === 'flying', 'a Worker is running the flight');
  await first.evaluate(() => { setTimeout(() => { throw new Error('made to fail'); }, 0); });
  const shown = await g.waitForFunction(() => window.fsg.mode === 'crashed', null, { timeout: 10000 }).then(() => true, () => false);
  check(shown && (await g.locator('#screen-crashed').isVisible()) && (await g.locator('#crash-why').textContent()).includes('the Worker failed: Uncaught Error: made to fail'), 'the Worker is made to fail: the crashed screen says so, with the Worker\'s own error', await g.locator('#crash-why').textContent());
  await g.click('#crash-restart');
  await g.waitForFunction(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, { timeout: 60000 }).catch(() => {});
  const again = await on(g).flight();
  check((await on(g).mode()) === 'flying' && parked(again) && g.workers().length === 1 && g.workers()[0] !== first && (await on(g).jsbsim()).build === 'weh',
    'Restart: a fresh Worker on the fast build, and a parked airplane again', where(again));
  await failing.close();
}

// 9. The app goes away in mid-flight, with time running (the pilot closes the app): the fast build had started
//    long before, so the next launch must use it again, not the fallback. Found on the owner's phone at 0.0.5.
{
  const leaving = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  const g = await leaving.newPage();
  await g.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await g.goto(base);
  await on(g).ready();
  await on(g).fly();
  await g.waitForTimeout(1500);
  check((await on(g).mode()) === 'flying' && (await on(g).flight()).states > 60, 'the flight is running in the Worker when the app goes away');
  await g.reload();
  await on(g).ready();
  const r = await on(g).jsbsim();
  const b = await g.locator('#dev').textContent();
  check(!r.error && r.build === 'weh' && b.includes('JSBSim 1.3.3   wasm exceptions\n'), 'the launch after a reload in mid-flight says "wasm exceptions"', r.error ?? r.says);
  await leaving.close();
}

check(errors.length === 0, 'no console errors', errors.join(' | '));
console.log(`\nChromium ${browser.version()} (headless), FSG ${version}: ${failed ? `${failed} FAILED` : 'all passed'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
