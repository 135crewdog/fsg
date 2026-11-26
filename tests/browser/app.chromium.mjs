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
// Motion access is allowed, as a pilot who taps Allow: this Chromium answers the app's question as an iPhone does.
const MOTION = ['accelerometer', 'gyroscope', 'magnetometer'];
const context = await browser.newContext({ viewport: { width: 852, height: 393 }, permissions: MOTION });   // an iPhone 16 in landscape
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

// An error screen (docs/milestones/2.md, "Wings catch-up"): its heading is not "Crashed", it has one sentence
// of 12 words or fewer that says what to do, and none of the error's own text.
const errorScreen = (said, error) => said.title !== 'Crashed' && said.title.length > 0 && /Restart/.test(said.line)
  && said.line.trim().split(/\s+/).length <= 12 && !(error && (said.line.includes(error) || said.title.includes(error))) && !/Worker|JSBSim|Error/.test(said.title + said.line);

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
const overlaySays = (box, what) => new RegExp(`^FSG [^\n]+\n(browser tab|home-screen app)\noffline ready: [a-z ]+\nJSBSim 1\\.3\\.3 {3}(wasm exceptions|fallback build: [^\n]+)\nc172p {3}${what}\n\\d+ frames/s \\(least \\d+\\) {3}\\d+ draws\n[\\d.]+ steps/s {3}[\\d.]+ s dropped {3}[\\d,]+ states, \\d+ missing\npicture \\d+ ms behind \\(99 in 100 within \\d+, most \\d+\\)\n-?[\\d,]+ ft N, -?[\\d,]+ ft E, -?[\\d,]+ ft up, heading \\d{3}, \\d+ kt, [\\d,]+ RPM\nsensor [^\n]+\nstick [^\n]+\nlast touchdown: [^\n]+$`).test(box);

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

// Settings before the first flight: the pause screen, with Fly at its top and no Restart; the Debug overlay switch.
await page.click('#settings');
check(await visible('#screen-pause') && !(await visible('#screen-start')), 'Settings opens the pause screen');
check((await text('#resume')) === 'Fly' && !(await visible('#restart')), 'before the first flight its top button is Fly, and there is no Restart');
check(!(await visible('#dev')), 'the overlay is off until it is switched on');
await page.click('#dev-switch');
check((await text('#dev-label')) === 'Debug overlay' && await visible('#dev'), 'the switch reads "Debug overlay", and on, it shows the overlay');
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
// The HUD (pull request 6): drawn in green over the flight; its tape follows the view; switched off, only the
// airspeed and altitude are left. What is on its canvas is read back and held against src/hud.js's own places.
{
  // Green at a place on the HUD's canvas (CSS px, within 2 px), and how much green there is in a band of rows.
  const hudRead = (swungBy) => page.evaluate(async (wantYaw) => {
    const hud = await import('./src/hud.js');
    const canvas = document.getElementById('hud'), scale = canvas.width / canvas.clientWidth;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const green = (x, y) => { const i = (Math.round(y * scale) * canvas.width + Math.round(x * scale)) * 4; return data[i + 3] > 128 && data[i + 1] > 180 && data[i] < 190 && data[i + 2] < 160; };
    const near = (x, y) => { for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) if (green(x + dx, y + dy)) return true; return false; };
    const count = (y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < canvas.clientWidth; x++) if (green(x, y)) n++; return n; };
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w / 2, cy = h / 2, top = document.getElementById('safe').getBoundingClientRect().top + 8;
    const { reading, look } = window.fsg.picture;
    const focal = hud.focalLength(55, h), reach = w * 0.22;
    const swing = hud.viewHeading(reading.pitch, reading.roll, look.yaw, look.pitch), pointer = hud.tapeX(-swing, focal);
    const centre = hud.magnetic(reading.heading) + swing, marks = hud.tapeMarks(centre, focal, reach, pointer);
    const gaps = marks.slice(1).map((m, k) => (m.x + marks[k].x) / 2).filter((x) => Math.abs(x - pointer) > 12);
    return {
      yaw: look.yaw, wantYaw, swing, pointer, centre, marks: marks.length,
      ticksDrawn: marks.filter((m) => near(cx + m.x, top + 6)).length, gapsClear: gaps.filter((x) => !near(cx + x, top + 6)).length, gaps: gaps.length,
      pointerDrawn: near(cx + pointer - 3, top + 6) && near(cx + pointer + 3, top + 6), middleClear: !near(cx - 3, top + 5) || !near(cx + 3, top + 5),
      topGreen: count(0, 45), middleGreen: count(cy - 12, cy + 12), lowGreen: count(h - 80, h),
    };
  }, swungBy);
  const plain = await hudRead(0);
  check(await visible('#hud') && plain.topGreen > 200 && plain.middleGreen > 200 && plain.lowGreen > 200 && plain.pointerDrawn && plain.ticksDrawn === plain.marks && plain.marks >= 6,
    'the HUD is drawn: the heading tape with its pointer in the middle, the numbers, the rows lower left', `${plain.ticksDrawn} of ${plain.marks} tape marks where src/hud.js puts them; tape centred on ${plain.centre.toFixed(1)} magnetic`);
  if (shots) await page.screenshot({ path: join(shots, 'hud.png') });
  // The view swung 15 degrees left: the tape's middle is the heading the view looks along, and the pointer has gone right with the nose.
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(360, 250, { steps: 6 });
  await page.waitForTimeout(300);
  const swung = await hudRead(15);
  if (shots) await page.screenshot({ path: join(shots, 'hud-swung.png') });
  await page.mouse.up();
  await page.waitForFunction(() => window.fsg.picture.look.yaw === 0, null, { timeout: 5000 }).catch(() => {});
  check(Math.abs(swung.yaw - 15) < 1 && Math.abs(swung.centre - (plain.centre - 15)) < 2 && swung.ticksDrawn === swung.marks && swung.gapsClear === swung.gaps && swung.gaps >= 4,
    'with the view swung, the tape\'s middle reads the heading the view looks along, within 2 degrees', `swung ${swung.yaw} deg left: the tape is centred on ${swung.centre.toFixed(1)} (${plain.centre.toFixed(1)} not swung); ${swung.ticksDrawn} of ${swung.marks} marks in place, ${swung.gapsClear} of ${swung.gaps} gaps between them clear`);
  check(swung.pointer > 90 && swung.pointer < 115 && swung.pointerDrawn && swung.middleClear, 'and the pointer has moved with the nose', `${swung.pointer.toFixed(0)} px right of the middle`);
  // Off: only the airspeed and altitude, in the same places. The choice is kept as fsg.hud.
  await page.click('#pause');
  await page.click('#hud-switch');
  await page.click('#resume');
  await page.waitForTimeout(400);
  const off = await hudRead(0);
  if (shots) await page.screenshot({ path: join(shots, 'hud-off.png') });
  check(off.topGreen === 0 && off.lowGreen === 0 && off.middleGreen > 100 && off.middleGreen < plain.middleGreen && (await page.evaluate(() => localStorage.getItem('fsg.hud'))) === 'off',
    'HUD off: only the airspeed and altitude are drawn, and the choice is kept as fsg.hud', `green: ${off.topGreen} at the top, ${off.middleGreen} across the middle (${plain.middleGreen} with it on), ${off.lowGreen} at the bottom`);
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
  // The overlay's numbers are the whole flight's: they carry on across the pause, the worst of each kept.
  check(resumed.steps > held.steps && resumed.seconds > held.seconds && resumed.seconds - held.seconds < 1.8 && resumed.behindMostMs >= held.behindMostMs && resumed.leastFps <= held.leastFps && resumed.leastFps > 0,
    'the flight\'s numbers carry on across the pause, and the pause itself is not counted', `${held.steps} steps in ${held.seconds.toFixed(2)} s before, ${resumed.steps} in ${resumed.seconds.toFixed(2)} s after; least ${held.leastFps.toFixed(1)} then ${resumed.leastFps.toFixed(1)} frames a second`);
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
// Losing focus pauses the flight, as leaving the app does (Wings 6542a06): the Worker rests, and only Resume flies on.
{
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(500);
  const stopped = await app.flight();
  await page.waitForTimeout(1000);
  const held = await app.flight();
  check((await app.mode()) === 'paused' && (await visible('#screen-pause')) && held.states === stopped.states && held.time === stopped.time,
    'the app loses focus: the pause screen within half a second, and the Worker posts nothing more', `${held.states} states`);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  check((await app.mode()) === 'paused', 'focus coming back does not fly it on');
  // Losing focus while a restart is being made: the new flight waits on the pause screen, held.
  const before = await app.flight();
  await page.evaluate(() => {
    document.getElementById('restart').click();   // the tap; the new flight is asked for, and is not there yet
    window.dispatchEvent(new Event('blur'));
  });
  await page.waitForFunction((n) => window.fsg.picture.flight > n, before.flight, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const waiting = await app.flight();
  check((await app.mode()) === 'paused' && waiting.flight === before.flight + 1 && !waiting.flying && waiting.states === 0 && (await visible('#screen-pause')),
    'focus lost while Restart makes the new flight: it waits on the pause screen, held', `flight ${waiting.flight}, ${waiting.states} states, mode ${await app.mode()}`);
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
check(await visible('#dev'), 'the Debug overlay switch is still on after a reload');
check((await page.getAttribute('#hud-switch', 'aria-checked')) === 'false', 'and the HUD switch is still off after a reload');
await page.evaluate(() => document.getElementById('hud-switch').click());
check((await page.getAttribute('#hud-switch', 'aria-checked')) === 'true' && (await page.evaluate(() => localStorage.getItem('fsg.hud'))) === 'on', 'switched on again, it says so');
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
check(await visible('#rotate') && (await text('#rotate h1')) === 'Rotate your device' && (await text('#rotate p')) === 'If it won\'t turn, turn off rotation lock.', 'portrait shows the rotate screen, in its few words');
if (shots) await page.screenshot({ path: join(shots, 'rotate.png') });
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
  const broken = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
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
  const died = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
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
  const noWorker = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
  await noWorker.route('**/src/sim/worker.js', (route) => route.abort());
  await noWorker.route('**/jsbsim-data/**', async (route) => { await new Promise((done) => setTimeout(done, 400)); await route.continue(); });
  const w = await noWorker.newPage();
  await w.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  // Motion access has not been given on this visit: the page counts how often it is asked for, and allows it.
  await w.addInitScript(() => { window.asked = 0; DeviceOrientationEvent.requestPermission = () => { window.asked++; return Promise.resolve('granted'); }; });
  await w.goto(base);
  const settled = await w.waitForFunction(() => window.fsg.jsbsim !== null, null, { timeout: 20000 }).then(() => true, () => false);
  const r3 = settled ? await on(w).jsbsim() : null;
  const b3 = await w.locator('#dev').textContent();
  const said3 = { title: await w.locator('#crash-title').textContent(), line: await w.locator('#crash-why').textContent() };
  check(settled && typeof r3.error === 'string' && b3.includes(`JSBSim did not start: ${r3?.error}`) && (await w.locator('#screen-crashed').isVisible()) && errorScreen(said3, r3?.error) && (await w.locator('#crash-restart').isVisible()),
    'the Worker itself fails to load: the screen says so in a few words and what to do, and the error\'s own words are on the overlay', settled ? b3.split('\n').slice(3).join(' | ') : `stuck at: ${b3.split('\n').slice(3).join(' | ')}`);
  if (shots) await w.screenshot({ path: join(shots, 'error-start.png') });
  check((await w.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'and the marker is cleared');
  if (settled) {
    await noWorker.unroute('**/src/sim/worker.js');
    await w.click('#crash-restart');
    await w.waitForFunction(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, { timeout: 60000 }).catch(() => {});
    check((await on(w).jsbsim())?.build === 'weh' && parked(await on(w).flight()), 'Restart tries again, and now it starts and flies');
    check((await w.evaluate(() => window.asked)) === 1, 'and that Restart, the first tap to fly, asked for motion access', `asked ${await w.evaluate(() => window.asked)} time(s)`);
    await w.click('#pause');
    await w.click('#restart');
    await w.waitForFunction(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, { timeout: 10000 }).catch(() => {});
    check((await w.evaluate(() => window.asked)) === 1 && (await on(w).mode()) === 'flying', 'a later Restart does not ask again');
  }
  await noWorker.close();
}

// 8. A Worker made to fail in mid-flight: the crashed screen, and Restart gives a parked airplane in a fresh
//    Worker. Its own page, so that the error it makes is not counted above.
{
  const failing = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
  const g = await failing.newPage();
  await g.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await g.goto(base);
  await on(g).ready();
  await on(g).fly();
  await g.waitForTimeout(1000);
  const first = g.workers()[0];
  check(g.workers().length === 1 && (await on(g).mode()) === 'flying', 'a Worker is running the flight');
  await first.evaluate(() => { setTimeout(() => { throw new Error('made to fail'); }, 0); });
  const shown = await g.waitForFunction(() => window.fsg.mode === 'crashed', null, { timeout: 10000 }).then(() => true, () => false);
  const said = { title: await g.locator('#crash-title').textContent(), line: await g.locator('#crash-why').textContent() };
  const box8 = await g.locator('#dev').textContent();
  check(shown && (await g.locator('#screen-crashed').isVisible()) && errorScreen(said, 'made to fail') && box8.includes('stopped: the Worker failed: Uncaught Error: made to fail'),
    'the Worker is made to fail: the screen says so in a few words and what to do, and the Worker\'s own error is on the overlay', `"${said.title}" "${said.line}" | ${box8.split('\n').find((l) => l.startsWith('stopped'))}`);
  if (shots) await g.screenshot({ path: join(shots, 'error-flight.png') });
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
  const leaving = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
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

// 10. The controls (pull request 7): flown on the screen's own controls with a made-up tilt. Chromium has no
//     tilt sensor, so the page is sent the same orientation events a device sends, sixty a second.
{
  const flown = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
  const c = await flown.newPage();
  const errs = [];
  c.on('pageerror', (error) => errs.push(String(error)));
  await c.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  await c.goto(base);
  // The made-up device: held in landscape, leaning back 15 degrees, then tipped `back` (top edge toward the
  // pilot) and turned `clockwise`, in degrees. The sums are tests/tilt.test.js's, from the sensor's definition.
  await c.evaluate(() => {
    const D = Math.PI / 180;
    window.held = { back: 0, clockwise: 0 };
    const sensor = ([x, y, z]) => {
      for (const beta of [Math.asin(y), Math.PI - Math.asin(y)]) {
        const cb = Math.cos(beta);
        if (Math.abs(cb) < 1e-9) return { beta: beta / D, gamma: 0 };
        if (z / cb >= -1e-12) return { beta: beta / D, gamma: Math.atan2(-x / cb, z / cb) / D };
      }
      return { beta: 0, gamma: 0 };
    };
    // With `level` set, the made-up pilot holds the wings level with the tilt, as a pilot does in the climb:
    // at full power and low speed this Cessna rolls left by itself.
    let tick = 0, bias = 0;
    setInterval(() => {
      if (window.held.level && tick++ % 6 === 0) {
        const roll = window.fsg.picture.reading?.roll ?? 0;
        bias = Math.max(-15, Math.min(15, bias - roll * 0.04));
        window.held.clockwise = Math.max(-25, Math.min(25, bias - roll * 0.5));
      }
      const { back, clockwise } = window.held, lean = (back - 15) * D, turn = clockwise * D;
      const u = [-Math.sin(turn) * Math.cos(lean), Math.cos(turn) * Math.cos(lean), -Math.sin(lean)];
      const angle = (((screen.orientation?.angle ?? 0) % 360) + 360) % 360, a = -angle * D, ca = Math.cos(a), sa = Math.sin(a);
      const { beta, gamma } = sensor([ca * u[0] - sa * u[1], sa * u[0] + ca * u[1], u[2]]);
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma }));
    }, 1000 / 60);
  });
  const hold = (back, clockwise) => c.evaluate(([b, cw]) => { window.held = cw === 'level' ? { back: b, clockwise: window.held.clockwise, level: true } : { back: b, clockwise: cw }; }, [back, clockwise]);
  const now = () => c.evaluate(() => ({ ...window.fsg.picture, stick: window.fsg.stick, pilot: window.fsg.pilot, touchdown: window.fsg.touchdown, mode: window.fsg.mode }));
  const until = (test, arg, timeout = 90000) => c.waitForFunction(test, arg, { timeout, polling: 50 }).then(() => true, () => false);
  const shown = (selector) => c.locator(selector).isVisible();
  await on(c).ready();

  // What is on the screen: only the buttons the Cessna has, in title case; the throttle's groove and knob.
  check(await on(c).fly(), 'Fly: motion is allowed (Chromium does not ask), and the flight is on screen');
  const buttons = await c.evaluate(() => [...document.getElementById('toggles').children].filter((b) => !b.hidden).map((b) => b.textContent));
  check(buttons.join(', ') === 'Flaps Down, Brakes On', 'the Cessna shows two buttons, in title case', buttons.join(', '));
  const groove = async () => c.evaluate(() => {
    const box = (q) => document.querySelector(q).getBoundingClientRect();
    const track = box('#throttle .track'), thumb = box('#throttle .thumb'), stripes = document.querySelector('#throttle .ab');
    return { width: track.width, top: track.top, bottom: track.bottom, knob: thumb.top + thumb.height / 2, knobHeight: thumb.height, stripes: !stripes.hidden && stripes.getBoundingClientRect().height > 0 };
  });
  const idle = await groove();
  check(idle.width === 14 && Math.abs(idle.knob - idle.bottom) <= 1 && idle.knobHeight > idle.width && !idle.stripes,
    'the throttle: a 14 px groove, the knob over its end at idle, no caution stripes on an airplane with no afterburner', `groove ${idle.width} px wide; the knob's middle ${Math.abs(idle.knob - idle.bottom).toFixed(1)} px from its foot`);

  // A takeoff: Brakes off, the throttle slid full, and from 50 knots the device tipped back 10 degrees.
  // Returns the liftoff speed. Tipped back the whole climb the Cessna rears up, as any airplane held at takeoff stick would: so it is eased.
  const takeOff = async () => {
    await c.click('#brake');
    const knob = await c.locator('#throttle .thumb').boundingBox();
    await c.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await c.mouse.down();
    await c.mouse.move(knob.x + knob.width / 2, 2, { steps: 10 });
    await c.mouse.up();
    const rolling = await until(() => window.fsg.picture.groundKt > 5, null, 20000);
    await until(() => window.fsg.picture.knots >= 50, null, 60000);
    await hold(10, 0);
    const off = await until(() => window.fsg.picture.wheelsDown === 0 && window.fsg.picture.aboveGroundFt - 4.356 > 1, null, 30000);
    const pulling = await now();
    await hold(4, 'level');
    return { rolling, off, liftoff: pulling.knots, pulling };
  };
  const first = await takeOff();
  const full = await groove(), rolled = await now();
  check((await c.locator('#brake').textContent()) === 'Brakes Off' && rolled.pilot.throttle === 1 && Math.abs(full.knob - full.top) <= 1 && first.rolling, 'Brakes off and the throttle slid full: the knob covers the groove\'s top, and the Cessna rolls',
    `throttle ${rolled.pilot.throttle}; the knob's middle ${Math.abs(full.knob - full.top).toFixed(1)} px from the groove's top`);
  check(first.off && first.liftoff >= 45 && first.liftoff <= 70, 'flaps down, tipped back 10 degrees from 50 knots, it lifts off between 45 and 70 knots', `${first.liftoff.toFixed(1)} kt`);
  if (shots) await c.screenshot({ path: join(shots, 'airborne.png') });
  // Stick back shows the elevator up; the flaps are down; the HUD's flight path is above the horizon in the climb.
  const pulling = first.pulling;
  await until(() => window.fsg.picture.aboveGroundFt > 50, null, 60000);
  const climbing = await now();
  check(pulling.stick.pitch > 0.3 && pulling.surfaces.elevator > 0.52 && pulling.surfaces.flaps === 1 && climbing.reading.velocity[2] < 0 && climbing.reading.pitch > 0,
    'stick back: the elevator\'s trailing edge is up, the flaps are down, and the HUD\'s flight path marker is above the horizon in the climb', `stick ${pulling.stick.pitch.toFixed(2)} back; elevator motion ${pulling.surfaces.elevator.toFixed(2)} (0.5 is neutral); climbing ${(-climbing.reading.velocity[2] * 100).toFixed(0)} in 100`);
  await until(() => window.fsg.picture.aboveGroundFt > 200, null, 60000);
  // Turned 15 degrees clockwise for one second: a right bank.
  // The wings are being held level, with the device turned a little to do it; from there, 15 degrees more.
  await hold(3, 'level');
  await c.waitForTimeout(3000);
  const level = await now(), holding = await c.evaluate(() => window.held.clockwise);
  await hold(3, holding + 15);
  await c.waitForTimeout(500);
  const rolling = await now();
  await c.waitForTimeout(500);
  const banked = await now();
  await hold(3, 'level');
  check(Math.abs(level.reading.roll) < 5 && banked.reading.roll >= 10 && banked.reading.roll <= 50, 'turned 15 degrees right for one second, it is banked 10 to 50 degrees right',
    `from ${level.reading.roll.toFixed(1)} to ${banked.reading.roll.toFixed(1)} deg, at ${banked.knots.toFixed(0)} kt (the wings were being held level with the device ${holding.toFixed(1)} deg right)`);
  check(rolling.stick.roll > 0.3 && rolling.surfaces.aileron > 0.6, 'stick right: the ailerons are over for a right roll (left one down, right one up)', `stick ${rolling.stick.roll.toFixed(2)} right; aileron motion ${rolling.surfaces.aileron.toFixed(2)} (0.5 is neutral)`);
  check(banked.behindWithinMs > 0 && banked.behindWithinMs <= 40 && banked.missing === 0, 'in the air the picture still trails the newest state as it did on the ground', `99 frames in 100 within ${banked.behindWithinMs} ms`);
  if (shots) await c.screenshot({ path: join(shots, 'banked.png') });
  // Flaps up: both flaps come up.
  await c.click('#flaps');
  await c.waitForTimeout(4000);
  const clean = await now();
  check((await c.locator('#flaps').textContent()) === 'Flaps Up' && clean.surfaces.flaps < 0.05, 'Flaps Up: the flaps come up', `flap motion ${clean.surfaces.flaps.toFixed(2)}`);
  // Recenter: however the device is held then is neutral.
  await c.evaluate(() => { window.held = { back: 8, clockwise: window.held.clockwise - 14 }; });
  await c.waitForTimeout(400);
  const offCentre = await now();
  await c.click('#pause');
  const heldAt = (await now()).time;
  await c.waitForTimeout(800);
  check((await now()).time === heldAt && await shown('#screen-pause'), 'Pause holds it');
  await c.click('#recenter');
  await c.waitForTimeout(300);
  const centred = await c.evaluate(() => ({ stick: window.fsg.stick, says: document.getElementById('recenter').textContent }));
  check(Math.hypot(offCentre.stick.pitch, offCentre.stick.roll) > 0.3 && Math.abs(centred.stick.pitch) <= 0.02 && Math.abs(centred.stick.roll) <= 0.02 && centred.says === 'Recentered ✓',
    'Recenter makes the present tilt neutral: the stick within 0.02 of zero', `from ${offCentre.stick.pitch.toFixed(2)} back, ${offCentre.stick.roll.toFixed(2)} right to ${centred.stick.pitch.toFixed(3)}, ${centred.stick.roll.toFixed(3)}`);
  await hold(0, 0);
  await c.click('#resume');
  const after = await now();
  // Restart parks it, with the throttle closed and the brakes on.
  await hold(0, 0);
  await c.click('#pause');
  await c.click('#restart');
  await until((n) => window.fsg.picture.flight > n && window.fsg.picture.flying, after.flight, 10000);
  await c.waitForTimeout(1500);
  const again = await now(), knobAgain = await groove();
  check(again.mode === 'flying' && parked(again) && again.pilot.throttle === 0 && again.pilot.brake === true && again.pilot.flaps === true && Math.abs(knobAgain.knob - knobAgain.bottom) <= 1 && (await c.locator('#brake').textContent()) === 'Brakes On' && Math.abs(again.stick.pitch) < 0.05,
    'Restart parks it with the throttle closed, the flaps down and the brakes on', `${where(again)}; throttle ${again.pilot.throttle}`);
  // With the crash override off, flown into the ground at more than 1,575 ft/min: the crashed screen.
  await c.click('#pause');
  await c.click('#override');
  check((await c.getAttribute('#override', 'aria-checked')) === 'false' && (await c.evaluate(() => localStorage.getItem('fsg.crashOverride'))) === 'off', 'the crash override switch goes off, kept as fsg.crashOverride');
  await c.click('#resume');
  const second = await takeOff();
  await until(() => window.fsg.picture.aboveGroundFt > 250, null, 60000);
  await hold(-55, 'level');
  const crashed = await until(() => window.fsg.mode === 'crashed', null, 60000);
  const said = crashed ? { title: await c.locator('#crash-title').textContent(), line: await c.locator('#crash-why').textContent() } : {};
  const fpm = Number((said.line ?? '').replace(/[^\d]/g, ''));
  check(second.off && crashed && said.title === 'Crashed' && /^Hard impact: [\d,]+ ft\/min$/.test(said.line) && fpm > 1575 && await shown('#screen-crashed'), 'crash override off: flown into the ground hard, the crashed screen shows', `"${said.title}" "${said.line}"`);
  if (shots) await c.screenshot({ path: join(shots, 'crashed.png') });
  // The same again with the crash override on: the same dive into the ground, and the flight carries on.
  await c.click('#crash-restart');
  await until(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, 10000);
  await hold(0, 0);
  await c.click('#pause');
  await c.click('#override');
  await c.click('#resume');
  const third = await takeOff();
  await until(() => window.fsg.picture.aboveGroundFt > 250, null, 60000);
  await hold(-55, 'level');
  // Its centre of gravity stands 4.4 ft up: under 8 ft it is at the ground. The fastest sink on the way down is kept, read every 50 ms.
  await c.evaluate(() => { window.sink = 0; });
  const down = await until(() => { const p = window.fsg.picture; window.sink = Math.min(window.sink, p.reading.climb); return p.aboveGroundFt < 8; }, null, 60000);
  const sinking = await c.evaluate(() => window.sink);
  await c.waitForTimeout(2000);
  const survived = await now();
  check(third.off && down && sinking < -1575 && survived.mode === 'flying' && !(await shown('#screen-crashed')) && (await c.getAttribute('#override', 'aria-checked')) === 'true',
    'crash override on: the same dive into the ground, and the flight carries on', `arriving at ${Math.round(-sinking).toLocaleString('en-US')} ft/min; mode ${survived.mode} two seconds later`);
  const box10 = await c.locator('#dev').textContent();
  check(/\nsensor β .+ screen \d+ +tilt .+\nstick -?[\d.]+ back, -?[\d.]+ right +throttle [\d.]+\nlast touchdown: /.test(box10), 'the overlay shows the tilt, the stick and the last touchdown', box10.split('\n').slice(-3).join(' | '));
  check(errs.length === 0, 'no page errors in the flight', errs.join(' | '));
  await flown.close();

  // Motion refused: the motion-access screen, and no flight.
  const refused = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  const r = await refused.newPage();
  // Not allowed here: the browser's own answer to the app's question is not "granted".
  await r.goto(base);
  await on(r).ready();
  await r.click('#fly');
  await r.waitForTimeout(500);
  check((await r.locator('#screen-denied').isVisible()) && (await on(r).mode()) === 'start' && (await r.locator('#screen-denied p').textContent()) === 'Reopen FSG, tap Fly and allow motion. If it doesn\'t ask, allow motion in your browser\'s settings.' && !(await on(r).flight()).flying,
    'motion refused: the motion-access screen shows, in its few words, and nothing flies');
  if (shots) await r.screenshot({ path: join(shots, 'denied.png') });
  await refused.close();

  // The prompt takes focus from the app while it is up; then Allow: the flight flies.
  const asked = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
  const a = await asked.newPage();
  await a.addInitScript(() => {
    DeviceOrientationEvent.requestPermission = () => new Promise((allow) => { window.dispatchEvent(new Event('blur')); setTimeout(() => { window.dispatchEvent(new Event('focus')); allow('granted'); }, 600); });
  });
  await a.goto(base);
  await on(a).ready();
  check(await on(a).fly(), 'focus lost to the motion prompt, then Allow: the flight flies');
  check((await on(a).mode()) === 'flying' && !(await a.locator('#screen-pause').isVisible()), 'and it is not left on the pause screen');
  await asked.close();

  // The device is turned upright while the prompt is up, then Allow: no flight starts behind the rotate screen.
  // It waits on the pause screen, held, for Resume.
  const turned = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  const t = await turned.newPage();
  await t.addInitScript(() => { DeviceOrientationEvent.requestPermission = () => new Promise((allow) => { window.allow = () => allow('granted'); }); });
  await t.goto(base);
  await on(t).ready();
  await t.click('#fly');
  await t.setViewportSize({ width: 393, height: 852 });
  await t.evaluate(() => window.allow());
  await t.waitForTimeout(800);
  const upright = await on(t).flight();
  check((await on(t).mode()) === 'paused' && !upright.flying && upright.states === 0 && (await t.locator('#rotate').isVisible()), 'turned upright while the motion prompt is up, then Allow: nothing flies behind the rotate screen', `mode ${await on(t).mode()}, ${upright.states} states`);
  await t.setViewportSize({ width: 852, height: 393 });
  await t.waitForTimeout(300);
  check((await t.locator('#screen-pause').isVisible()) && (await t.locator('#resume').textContent()) === 'Resume' && (await t.locator('#restart').isVisible()), 'back in landscape it is on the pause screen, with Resume');
  // The pause menu, with an update offered, is inside an iPhone's landscape safe area: 348 points under the top margin.
  const menu = await t.evaluate(() => {
    for (const b of document.querySelectorAll('#screen-pause .update')) b.hidden = false;
    const box = (q) => document.querySelector(q).getBoundingClientRect();
    return { card: box('#screen-pause .card').bottom, update: box('#screen-pause .update').bottom, credits: box('.credits'), height: innerHeight };
  });
  check(menu.card <= 12 + 348 && menu.update < menu.card && menu.credits.bottom <= menu.height && menu.credits.top >= menu.card - 1,
    'the pause menu with an update offered fits an iPhone\'s landscape safe area, and the credits are on screen under it', `the menu ends ${Math.round(menu.card)} px down of ${menu.height}; the credits ${Math.round(menu.credits.top)} to ${Math.round(menu.credits.bottom)}`);
  if (shots) await t.screenshot({ path: join(shots, 'pause-menu.png') });
  await t.evaluate(() => { for (const b of document.querySelectorAll('#screen-pause .update')) b.hidden = true; });
  await t.click('#resume');
  check(await t.waitForFunction(() => window.fsg.picture.flying && window.fsg.picture.states > 0, null, { timeout: 3000 }).then(() => true, () => false), 'and Resume flies it');
  await turned.close();
}

check(errors.length === 0, 'no console errors', errors.join(' | '));
console.log(`\nChromium ${browser.version()} (headless), FSG ${version}: ${failed ? `${failed} FAILED` : 'all passed'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
