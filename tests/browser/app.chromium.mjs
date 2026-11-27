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
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// Where the debug overlay's box is on a page: how far its left and bottom edges are from the screen's, and its rectangle.
// Milestone 3, PR 2: one place on every screen (the owner's advice).
const overlayAt = (p) => p.evaluate(() => { const r = document.getElementById('dev').getBoundingClientRect(); return { left: r.left, fromBottom: innerHeight - r.bottom, top: r.top, right: r.right, bottom: r.bottom }; });
const overlayPlaces = {};

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

// 1b. The picture (milestone 2, pull request 4): the airplane (the F-4C since milestone 3, pull request 8; the Cessna before it) stands on the runway's numbers behind the start
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
  check(p.loaded && p.wheelsIn.every((inches) => Math.abs(inches) <= 1), `${when}: the F-4C's wheels are within 1 in of the runway`, p.wheelsIn?.map((inches) => `${inches.toFixed(2)} in`).join(', '));
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
//    the airplane parked on the numbers and held. Fly lets it go. Since milestone 3, pull request 8, it is the F-4C:
//    "parked" is the plan's PR 8 line: on the numbers, wheels on the runway within 1 in, gear down, flaps at 1/2,
//    boards in, brakes on, engines at idle (until then it was the Cessna's propeller at 700 to 900 RPM).
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
  f.surfaces.gear === 1 && f.surfaces.flaps === 0.5 && f.surfaces.speedbrake === 0 && Math.abs(f.model.gear - 1) < 1e-5 && Math.abs(f.model.flaps - 0.5) < 1e-5 &&
  f.engines?.thrust.every((lb) => lb > 100 && lb < 1000) && f.engines.afterburner.every((x) => x === 0) && f.reading?.power === 0 && f.ended === null;
const where = (f) => `${Math.hypot(f.northFt, f.eastFt).toFixed(2)} ft from the numbers, heading ${f.headingDeg.toFixed(2)}, ${f.wheelsDown} wheels down (${f.wheelsIn.map((x) => x.toFixed(2)).join(', ')} in), ${f.groundKt.toFixed(2)} kt, gear ${f.surfaces.gear}, flaps ${f.surfaces.flaps}, boards ${f.surfaces.speedbrake}, engines ${f.engines?.thrust.map((lb) => lb.toFixed(0)).join(' and ')} lb at power ${f.reading?.power}`;
const overlaySays = (box, what) => new RegExp(`^FSG [^\n]+\n(browser tab|home-screen app)\noffline ready: [a-z ]+\nJSBSim 1\\.3\\.3 {3}(wasm exceptions|fallback build: [^\n]+)\nf4c {3}${what}\n\\d+ frames/s \\(least \\d+\\) {3}\\d+ draws\n[\\d.]+ steps/s {3}[\\d.]+ s dropped {3}[\\d,]+ states, \\d+ missing\npicture \\d+ ms behind \\(99 in 100 within \\d+, most \\d+\\)\n-?[\\d,]+ ft N, -?[\\d,]+ ft E, -?[\\d,]+ ft up, heading \\d{3}, \\d+ kt, [\\d,]+ lb\nsensor [^\n]+\nstick [^\n]+\nlast touchdown: [^\n]+$`).test(box);

check(await app.ready(), 'Fly is ready: the model has loaded and JSBSim has started');
let js = await app.jsbsim();
check(!js.error && js.build === 'weh' && js.says === 'JSBSim 1.3.3   wasm exceptions', 'JSBSim starts in its Worker when the app opens: the fast build', js.error ?? js.says);
check((await page.evaluate(() => localStorage.getItem('fsg.fdmStarting'))) === null, 'the starting marker is cleared once JSBSim has started');
let f = await app.flight();
const rests = await page.waitForFunction(() => window.fsg.picture.resting, null, { timeout: 15000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
let later = await app.flight();
check(parked(f) && !f.flying && f.states === 0 && later.states === 0 && later.time === f.time, 'the F-4C is parked on the numbers and held: no state is posted and no time passes', where(f));
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
f = await app.flight();
check((await app.mode()) === 'flying' && !(await visible('#screen-pause')) && !(await visible('#screen-start')) && (await visible('#pause')), 'in flight there is no screen, only the pause button');
await page.waitForTimeout(500);
later = await app.flight();
// Milestone 3, PR 8: the F-4C (until 0.0.19 the Cessna, its propeller turning at 700 to 900 RPM and its flaps at 10 degrees, PR F's takeoff setting).
const brakesOn = (await page.evaluate(() => window.fsg.pilot.brake)) === true && (await text('#brake')) === 'Brakes On';
check(parked(f) && parked(later) && brakesOn, 'Fly shows the F-4C on the numbers within 3 s, and half a second later it is still there: within 1 ft of the numbers on heading 090, wheels on the runway within 1 in, gear down, flaps at 1/2, boards in, brakes on, engines at idle',
  `at once: ${where(f)}; half a second later: ${where(later)}; brakes ${brakesOn ? 'on' : 'NOT ON'}`);
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
  // In flight: the overlay's box against the throttle, the buttons and the pause button, and against what the HUD has drawn.
  overlayPlaces.flying = await overlayAt(page);
  const under = await page.evaluate(() => {
    const dev = document.getElementById('dev').getBoundingClientRect();
    const hits = ['throttle', 'toggles', 'pause'].filter((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.left < dev.right && r.right > dev.left && r.top < dev.bottom && r.bottom > dev.top; });
    // The HUD's canvas under the box: how many of its pixels carry any drawing.
    const hud = document.getElementById('hud'), box = hud.getBoundingClientRect(), k = hud.width / box.width;
    const x = Math.max(0, Math.round((dev.left - box.left) * k)), y = Math.max(0, Math.round((dev.top - box.top) * k));
    const w = Math.max(1, Math.round(dev.width * k)), h = Math.max(1, Math.round(dev.height * k));
    const px = hud.getContext('2d').getImageData(x, y, w, h).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
    return { hits, ink, of: w * h, box: `${Math.round(dev.width)} x ${Math.round(dev.height)} px at ${Math.round(dev.left)}, ${Math.round(dev.top)} of ${innerWidth} x ${innerHeight}` };
  });
  check(under.hits.length === 0, 'in flight the overlay covers none of the throttle, the buttons or the pause button', under.hits.join(', ') || under.box);
  // The plan's line "it covers none of the HUD's numbers" failed (docs/milestones/3.md, PR 2): a twelve-line box does not fit
  // anywhere on a phone's screen clear of the HUD. What is true is checked: it sits wholly below the airspeed and altitude,
  // which are on the screen's middle line. What it does cover is reported.
  const middle = await page.evaluate(() => { const r = document.getElementById('safe').getBoundingClientRect(); return (r.top + r.bottom) / 2; });
  check(overlayPlaces.flying.top > middle, 'it sits wholly below the HUD\'s airspeed and altitude', `its top is at ${Math.round(overlayPlaces.flying.top)} px, the airspeed's line at ${Math.round(middle)}`);
  console.log(`     reported: ${under.ink} of ${under.of} HUD pixels under it carry drawing (g, angle of attack, Mach and power, and the lower left of the pitch ladder)`);
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
  overlayPlaces.paused = await overlayAt(page);
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
overlayPlaces.start = await overlayAt(page);
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
  await noWorker.route('**/aircraft/f4c/**', async (route) => { await new Promise((done) => setTimeout(done, 400)); await route.continue(); });   // the F-4C's files (the Cessna's were in jsbsim-data/ until 0.0.19)
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
  overlayPlaces.crashed = await overlayAt(w);
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
//     Since milestone 3, pull request 8, the airplane is the F-4C, and these are that pull request's lines
//     (docs/milestones/3.md, PR 8): until 0.0.19 they were flown on the Cessna, with its own numbers.
{
  const F4C_STANDING_FT = 6.403;   // src/sim/aircraft/f4c.js, standingFt: its centre of gravity above the runway, parked
  const flown = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
  const c = await flown.newPage();
  const errs = [];
  c.on('pageerror', (error) => errs.push(String(error)));
  c.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await c.addInitScript(() => { try { localStorage.setItem('fsg.dev', 'on'); } catch { /* not yet on the page's origin */ } });
  // What the HUD writes: every text it draws on its canvas in a frame, kept for the last whole frame (it clears the canvas to start each).
  await c.addInitScript(() => {
    window.hudSays = [];
    let drawing = [];
    const { clearRect, fillText } = CanvasRenderingContext2D.prototype;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.id === 'hud') { window.hudSays = drawing; drawing = []; } return clearRect.apply(this, args); };
    CanvasRenderingContext2D.prototype.fillText = function (words, ...args) { if (this.canvas.id === 'hud') drawing.push(String(words)); return fillText.call(this, words, ...args); };
  });
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
    // With `level` set, the made-up pilot holds the wings level with the tilt, as a pilot does in the climb.
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
  const now = () => c.evaluate(() => ({ ...window.fsg.picture, stick: window.fsg.stick, pilot: window.fsg.pilot, touchdown: window.fsg.touchdown, mode: window.fsg.mode, hudSays: window.hudSays }));
  const until = (test, arg, timeout = 90000) => c.waitForFunction(test, arg, { timeout, polling: 50 }).then(() => true, () => false);
  const shown = (selector) => c.locator(selector).isVisible();
  const says = (selector) => c.locator(selector).textContent();
  // The owner's pictures: taken with the debug overlay's box out of the way for the moment, so the airplane shows.
  const shot = async (name) => {
    if (!shots) return;
    await c.evaluate(() => { document.getElementById('dev').style.visibility = 'hidden'; });
    await c.screenshot({ path: join(shots, name) });
    await c.evaluate(() => { document.getElementById('dev').style.visibility = ''; });
  };
  // The plumes' pictures (milestone 3, PR 9), at an iPhone's own sharpness: the page is shown at two pixels a point for the
  // moment (the app draws at up to 2, src/flight.js), and put back at one, at which this script's other lines are run.
  const cdp = await flown.newCDPSession(c);
  const sharpShot = async (name) => {
    if (!shots) return;
    await c.evaluate(() => { document.getElementById('dev').style.visibility = 'hidden'; });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, deviceScaleFactor: 2, mobile: false });
    await c.waitForTimeout(800);
    writeFileSync(join(shots, name), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, deviceScaleFactor: 1, mobile: false });
    await c.evaluate(() => { document.getElementById('dev').style.visibility = ''; });
  };
  await on(c).ready();

  // What is on the screen: Gear, the two Flaps buttons with the indicator between them, Boards and Brakes, in title case; the throttle's groove and knob.
  check(await on(c).fly(), 'Fly: motion is allowed (Chromium does not ask), and the flight is on screen');
  const buttons = await c.evaluate(() => [...document.querySelectorAll('#toggles button')].filter((b) => b.getClientRects().length > 0).map((b) => b.textContent));
  const reads = () => says('#flaps-reads');
  check(buttons.join(', ') === 'Gear Down, Flaps Up, Flaps Down, Boards In, Brakes On' && (await reads()) === '1/2' && !(await shown('#flaps')) && buttons.every((b) => /^([A-Z][a-z]+ )+[A-Z][a-z]+$/.test(b)),
    'the F-4C shows Gear, the flap lever (Flaps Up and Flaps Down, and between them "1/2", its takeoff setting), Boards and Brakes, in title case, each because it has the thing', `${buttons.join(', ')}; the indicator reads "${await reads()}"`);
  const insideSafe = await c.evaluate(() => {
    const safe = document.getElementById('safe').getBoundingClientRect();
    return [...document.querySelectorAll('#toggles button, #flaps-reads, #throttle, #pause')].filter((b) => b.getClientRects().length > 0).every((b) => { const r = b.getBoundingClientRect(); return r.left >= safe.left && r.right <= safe.right && r.top >= safe.top && r.bottom <= safe.bottom; });
  });
  check(insideSafe, 'every button, the indicator, the throttle and the pause button are inside the safe area');
  const groove = async () => c.evaluate(() => {
    const box = (q) => document.querySelector(q).getBoundingClientRect();
    const track = box('#throttle .track'), thumb = box('#throttle .thumb'), rail = box('#throttle .rail'), stripes = document.querySelector('#throttle .ab');
    return { width: track.width, top: track.top, bottom: track.bottom, rail: { top: rail.top, height: rail.height }, knob: thumb.top + thumb.height / 2, knobHeight: thumb.height,
      stripes: !stripes.hidden && stripes.getBoundingClientRect().height > 0, colour: getComputedStyle(document.querySelector('#throttle .thumb')).backgroundColor, burner: document.getElementById('throttle').classList.contains('burner') };
  });
  // The model's part is exactly where JSBSim had it in the state the frame was drawn from (within the clip's last millionth). And
  // that state is recent: JSBSim's part has moved on since then by no more than 0.05 of its whole travel, which is the boards'
  // travel (the quickest of the slow parts, 1.5 s end to end) in this browser's two frames at about 20 a second (headless
  // Chromium draws in software). (First written as 0.02, a frame at 60 a second: wrong for this browser; it failed once at 0.022.)
  const follows = (p, part) => Math.abs(p.model[part] - p.drawn[part]) < 1e-5 && Math.abs(p.drawn[part] - p.surfaces[part]) <= 0.05;
  const ORANGE = 'rgb(255, 159, 10)';   // Wings' afterburner knob (style.css, .throttle.burner .thumb)
  const idle = await groove();
  check(idle.width === 14 && Math.abs(idle.knob - idle.bottom) <= 1 && idle.knobHeight > idle.width && idle.stripes && !idle.burner && idle.colour !== ORANGE,
    'the throttle: a 14 px groove, the knob over its end at idle and white, and the caution stripes of an airplane with an afterburner', `groove ${idle.width} px wide; the knob's middle ${Math.abs(idle.knob - idle.bottom).toFixed(1)} px from its foot, ${idle.colour}; stripes ${idle.stripes}`);
  const parkedNow = await now();
  check(parked(parkedNow) && parkedNow.hudSays.includes('IDLE'), 'on the numbers: gear down, flaps at 1/2, boards in, brakes on, engines at idle, and the HUD reads IDLE', `${where(parkedNow)}; the HUD writes ${parkedNow.hudSays.filter((w) => /IDLE|MIL|AB|%/.test(w)).join(', ')}`);
  await shot('f4c-start.png');

  // A takeoff (the plan's PR 8 line): Brakes off, the throttle slid to the top, and from 100 knots the device tipped back 20 degrees.
  // At liftoff (every wheel off the runway) the pilot eases the tilt to 3.5 degrees back and holds the wings level, and raises the gear.
  // Returns what it found.
  const takeOff = async ({ gearUp = false, afterburnerShot = false } = {}) => {
    await c.click('#brake');
    const knob = await c.locator('#throttle .thumb').boundingBox();
    await c.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await c.mouse.down();
    await c.mouse.move(knob.x + knob.width / 2, 2, { steps: 10 });
    await c.mouse.up();
    const rolling = await until(() => window.fsg.picture.groundKt > 5, null, 20000);
    // The afterburner lights once the engines are at MIL speed (the aircraft file waits for 97%): then the HUD reads AB.
    const lit = await until(() => { const p = window.fsg.picture; return p.engines.afterburner.every((x) => x === 1) && window.hudSays.some((w) => w.startsWith('AB ')); }, null, 20000);
    const inBurner = { ...(await groove()), ...(await now()) };
    if (afterburnerShot) await shot('f4c-afterburner.png');
    await until(() => window.fsg.picture.knots >= 100, null, 60000);
    await hold(20, 0);
    const from = await now();
    const off = await until(() => window.fsg.picture.wheelsDown === 0, null, 30000);
    const liftoff = await now();
    await hold(3.5, 'level');
    let gear = null;
    if (gearUp) {
      const clicked = Date.now();
      await c.click('#gear');
      await c.waitForTimeout(1000);
      const moving = await now();
      await shot('f4c-airborne.png');
      const up = await until(() => window.fsg.picture.model.gear < 1e-5 && window.fsg.picture.surfaces.gear === 0, null, 6000);
      gear = { moving, up, seconds: (Date.now() - clicked) / 1000, says: await says('#gear') };
    }
    return { rolling, lit, inBurner, from, off, liftoff, gear };
  };
  const first = await takeOff({ gearUp: true, afterburnerShot: true });
  // In the air in full afterburner, the plumes as they are drawn.
  {
    const air = await now();
    check(air.wheelsDown === 0 && air.engines.afterburner.every((x) => x === 1) && air.plumes.length === 2 && air.plumes.every((p) => p.lit && p.lengthM === 4.5),
      'in the air in full afterburner both plumes show, at full length', air.plumes.map((p) => (p.lit ? `lit, ${p.lengthM} m` : 'out')).join(' and '));
  }
  const b = first.inBurner;
  check((await says('#brake')) === 'Brakes Off' && b.pilot.throttle === 1 && Math.abs(b.knob - b.top) <= 1 && b.burner && b.colour === ORANGE && first.lit && first.rolling,
    'Brakes off and the throttle slid to the top: the knob covers the groove\'s top and is orange above MIL, the HUD reads AB, and it rolls',
    `throttle ${b.pilot.throttle}; the knob's middle ${Math.abs(b.knob - b.top).toFixed(1)} px from the groove's top, ${b.colour}; the HUD writes "${b.hudSays.find((w) => w.startsWith('AB')) ?? b.hudSays.filter((w) => /IDLE|MIL|%/.test(w)).join(', ')}"; afterburners ${b.engines.afterburner.join(', ')}; ${b.groundKt.toFixed(0)} kt over the ground`);
  const liftoffKt = first.liftoff.knots;
  check(first.off && first.from.surfaces.flaps === 0.5 && first.from.pilot.throttle === 1 && liftoffKt >= 150 && liftoffKt <= 190,
    'flaps at 1/2, full afterburner, tipped back 20 degrees from 100 knots: it lifts off between 150 and 190 knots',
    `tipped back at ${first.from.knots.toFixed(1)} kt (stick ${first.from.stick.pitch.toFixed(2)} back as held); every wheel off at ${liftoffKt.toFixed(1)} kt, ${(first.liftoff.aboveGroundFt - F4C_STANDING_FT).toFixed(1)} ft up, nose ${first.liftoff.reading.pitch.toFixed(1)} degrees up, flaps ${first.liftoff.surfaces.flaps}`);
  const g = first.gear;
  check(g.up && g.says === 'Gear Up' && g.moving.model.gear > 0 && g.moving.model.gear < 1 && follows(g.moving, 'gear'),
    'Gear Up: the gear on the model travels as JSBSim\'s does, and is up within 6 s', `a second after the tap the model's gear is at ${g.moving.model.gear.toFixed(3)}, JSBSim's at ${g.moving.surfaces.gear.toFixed(3)}; up ${g.seconds.toFixed(1)} s after the tap`);
  // Stick back shows the stabilator's trailing edge up; the HUD's flight path is above the horizon in the climb.
  await until(() => window.fsg.picture.aboveGroundFt > 300, null, 60000);
  const climbing = await now();
  check(first.liftoff.stick.pitch > 0.3 && first.liftoff.surfaces.elevator > 0.6 && follows(first.liftoff, 'elevator') && climbing.reading.velocity[2] < 0 && climbing.reading.pitch > 0,
    'stick back: the stabilator\'s trailing edge is up on the model as in JSBSim, and the HUD\'s flight path marker is above the horizon in the climb', `stick ${first.liftoff.stick.pitch.toFixed(2)} back; stabilator motion ${first.liftoff.surfaces.elevator.toFixed(2)} (0.5 is neutral); climbing ${(-climbing.reading.velocity[2] * 100).toFixed(0)} in 100`);
  // The picture's clock in the air: milestone 2's lines, flown on the ground above, again here.
  {
    const from = await now();
    await c.waitForTimeout(10000);
    const to = await now();
    const seconds = to.seconds - from.seconds, steps = to.steps - from.steps, inTen = (steps / seconds) * 10;
    check(to.wheelsDown === 0 && seconds > 9 && inTen >= 1188 && inTen <= 1212 && to.missing === 0 && to.outOfOrder === 0 && to.droppedSeconds === 0, 'in the air: 1,188 to 1,212 steps in 10 s; every state in order and none missing',
      `${steps} steps in ${seconds.toFixed(3)} s (${inTen.toFixed(1)} in ten), ${to.missing} missing, ${to.outOfOrder} out of order, ${to.droppedSeconds.toFixed(2)} s dropped; ${to.knots.toFixed(0)} kt, ${(to.aboveGroundFt - F4C_STANDING_FT).toFixed(0)} ft up`);
  }
  // Turned 20 degrees clockwise for one second, from wings held level: a right roll.
  await hold(3.5, 'level');
  await c.waitForTimeout(3000);
  const level = await now(), holding = await c.evaluate(() => window.held.clockwise);
  await hold(3.5, holding + 20);
  await c.waitForTimeout(500);
  const rolling = await now();
  await c.waitForTimeout(500);
  const banked = await now();
  await hold(3.5, 'level');
  // Milestone 2's line, unchanged from the Cessna: banked 10 to 50 degrees. The F-4C, which rolls faster, banks 33 to 42.
  check(Math.abs(level.reading.roll) < 5 && banked.reading.roll >= 10 && banked.reading.roll <= 50, 'turned 20 degrees right for one second, it is banked 10 to 50 degrees right',
    `from ${level.reading.roll.toFixed(1)} to ${banked.reading.roll.toFixed(1)} deg, at ${banked.knots.toFixed(0)} kt (the wings were being held level with the device ${holding.toFixed(1)} deg right)`);
  check(rolling.stick.roll > 0.3 && rolling.surfaces.aileron > 0.6 && follows(rolling, 'aileron'), 'stick right: the left aileron is down and the right spoiler up, on the model as in JSBSim', `stick ${rolling.stick.roll.toFixed(2)} right; aileron motion ${rolling.surfaces.aileron.toFixed(2)} (0.5 is neutral), the model's ${rolling.model.aileron.toFixed(2)}`);
  check(banked.behindWithinMs > 0 && banked.behindWithinMs <= 40 && banked.missing === 0, 'in the air the picture still trails the newest state as it did on the ground', `99 frames in 100 within ${banked.behindWithinMs} ms`);
  await c.waitForTimeout(3000);
  // Boards Out: the speedbrakes open on the model as JSBSim opens them (1.5 s), and Boards In closes them.
  {
    await c.click('#speedbrake');
    await c.waitForTimeout(500);
    const opening = await now();
    const open = await until(() => window.fsg.picture.model.speedbrake > 0.99999 && window.fsg.picture.surfaces.speedbrake === 1, null, 3000);
    await c.waitForTimeout(300);
    await shot('f4c-boards.png');
    const out = await now(), outSays = await says('#speedbrake');
    await c.click('#speedbrake');
    const closed = await until(() => window.fsg.picture.model.speedbrake < 1e-5 && window.fsg.picture.surfaces.speedbrake === 0, null, 3000);
    check(outSays === 'Boards Out' && (await says('#speedbrake')) === 'Boards In' && open && closed && opening.model.speedbrake > 0 && opening.model.speedbrake < 1 && follows(opening, 'speedbrake'),
      'Boards Out: the speedbrakes open on the model as JSBSim opens them; Boards In closes them', `half a second after the tap the model's at ${opening.model.speedbrake.toFixed(3)}, JSBSim's at ${opening.drawn.speedbrake.toFixed(3)} in the state it was drawn from and ${opening.surfaces.speedbrake.toFixed(3)} in the newest; out ${out.model.speedbrake.toFixed(3)}; then in`);
  }
  // A finger in the detent band gives exactly MIL: three places in it, from its foot to its top (src/ui/throttle.js: 0.66 to 0.80 of the knob's travel).
  {
    const g0 = await groove(), x = (await c.locator('#throttle .thumb').boundingBox()).x + 15, got = [];
    for (const place of [0.665, 0.72, 0.795]) {
      await c.mouse.move(x, g0.rail.top + (1 - place) * g0.rail.height);
      await c.mouse.down();
      await c.mouse.up();
      await c.waitForTimeout(400);
      const at = { ...(await groove()), ...(await now()) };
      got.push({ place, throttle: at.pilot.throttle, burner: at.burner, colour: at.colour, hud: at.hudSays.filter((w) => /IDLE|MIL|AB|%/.test(w)).join(' '), knobAt: 1 - (at.knob - at.rail.top) / at.rail.height });
    }
    check(got.every((p) => p.throttle === 0.8 && !p.burner && p.colour !== ORANGE && p.hud === 'MIL'), 'a finger anywhere in the detent band gives exactly MIL: the knob white, on the mark, and the HUD reads MIL',
      got.map((p) => `at ${p.place} of the way up: throttle ${p.throttle}, knob at ${p.knobAt.toFixed(3)}, ${p.colour}, the HUD "${p.hud}"`).join('; '));
  }
  // Gear down and flaps Full in the air, at MIL: the model's gear and flaps follow JSBSim's.
  {
    await c.click('#gear');
    await c.click('#flaps-down');
    const there = await until(() => { const p = window.fsg.picture; return p.model.gear > 0.99999 && p.surfaces.gear === 1 && p.model.flaps > 0.99999 && p.surfaces.flaps === 1; }, null, 8000);
    await c.waitForTimeout(300);
    const dirty = await now();
    await shot('f4c-flaps-full.png');
    check(there && (await reads()) === 'Full' && (await says('#gear')) === 'Gear Down' && dirty.wheelsDown === 0, 'in the air, Gear Down and Flaps Down: the indicator reads "Full", and the model\'s gear and flaps are down as JSBSim\'s are',
      `flaps ${dirty.surfaces.flaps} (model ${dirty.model.flaps.toFixed(3)}), gear ${dirty.surfaces.gear} (model ${dirty.model.gear.toFixed(3)}), at ${dirty.knots.toFixed(0)} kt, ${(dirty.aboveGroundFt - F4C_STANDING_FT).toFixed(0)} ft up, nose ${dirty.reading.pitch.toFixed(1)} degrees`);
  }
  // Recenter: however the device is held then is neutral.
  await c.evaluate(() => { window.held = { back: 8, clockwise: window.held.clockwise - 14 }; });
  await c.waitForTimeout(400);
  const offCentre = await now();
  await c.click('#pause');
  const heldAt = (await now()).time;
  await c.waitForTimeout(800);
  check((await now()).time === heldAt && await shown('#screen-pause'), 'Pause holds it');
  await c.waitForTimeout(300);
  await shot('f4c-pause.png');
  await c.click('#recenter');
  await c.waitForTimeout(300);
  const centred = await c.evaluate(() => ({ stick: window.fsg.stick, says: document.getElementById('recenter').textContent }));
  check(Math.hypot(offCentre.stick.pitch, offCentre.stick.roll) > 0.3 && Math.abs(centred.stick.pitch) <= 0.02 && Math.abs(centred.stick.roll) <= 0.02 && centred.says === 'Recentered ✓',
    'Recenter makes the present tilt neutral: the stick within 0.02 of zero', `from ${offCentre.stick.pitch.toFixed(2)} back, ${offCentre.stick.roll.toFixed(2)} right to ${centred.stick.pitch.toFixed(3)}, ${centred.stick.roll.toFixed(3)}`);
  await hold(0, 0);
  await c.click('#resume');
  const after = await now();
  // Restart parks it, with the throttle closed, the gear down, the flaps back at 1/2 and the brakes on.
  await hold(0, 0);
  await c.click('#pause');
  await c.click('#restart');
  await until((n) => window.fsg.picture.flight > n && window.fsg.picture.flying, after.flight, 10000);
  await c.waitForTimeout(1500);
  const again = await now(), knobAgain = await groove();
  check(again.mode === 'flying' && parked(again) && again.pilot.throttle === 0 && again.pilot.brake === true && again.pilot.gear === true && again.pilot.speedbrake === false && again.pilot.flaps === 0.5 && (await reads()) === '1/2' &&
    Math.abs(knobAgain.knob - knobAgain.bottom) <= 1 && !knobAgain.burner && (await says('#brake')) === 'Brakes On' && (await says('#gear')) === 'Gear Down' && Math.abs(again.stick.pitch) < 0.05,
    'Restart parks it with the throttle closed, the gear down, the flaps back at 1/2 (from "Full") and the brakes on', `${where(again)}; throttle ${again.pilot.throttle}; the indicator "${await reads()}"`);
  // The plumes (docs/milestones/3.md, PR 9), on the runway with the brakes on: none at any dry power (idle, 50%, MIL), both at full
  // afterburner, and gone within 1 s of the throttle chopped to idle. What is drawn is read from the scene (src/render/plume.js,
  // shown()) every 50 ms; the frame rate is the overlay's, at idle and in full afterburner.
  {
    const watch = (ms) => c.evaluate((ms) => new Promise((done) => {
      const seen = [], from = performance.now();
      const id = setInterval(() => {
        const p = window.fsg.picture;
        seen.push({ t: performance.now() - from, lit: p.plumes.map((x) => x.lit), lengthM: p.plumes.map((x) => x.lengthM), afterburner: p.engines.afterburner, fps: p.fps, throttle: window.fsg.pilot.throttle, knots: p.groundKt });
        if (performance.now() - from >= ms) { clearInterval(id); done(seen); }
      }, 50);
    }), ms);
    const none = (seen) => seen.every((x) => x.lit.every((lit) => !lit));
    const fps = (seen) => seen.reduce((sum, x) => sum + x.fps, 0) / seen.length;
    const knob = async () => { const k = await c.locator('#throttle .thumb').boundingBox(); return [k.x + k.width / 2, k.y + k.height / 2]; };
    const slide = async (y) => { const [x, from] = await knob(); await c.mouse.move(x, from); await c.mouse.down(); await c.mouse.move(x, y, { steps: 10 }); await c.mouse.up(); };
    const tap = async (place) => { const g0 = await groove(), [x] = await knob(); await c.mouse.move(x, g0.rail.top + (1 - place) * g0.rail.height); await c.mouse.down(); await c.mouse.up(); };
    const idleSeen = await watch(3000);
    await tap(0.4125);   // 50%: half of MIL, src/ui/throttle.js's place for it
    const halfSeen = await watch(8000);
    await tap(0.72);     // MIL: in the detent band
    const milSeen = await watch(8000);
    await sharpShot('plumes-mil.png');
    check(none(idleSeen) && none(halfSeen) && none(milSeen) && halfSeen.at(-1).throttle > 0.45 && halfSeen.at(-1).throttle < 0.55 && milSeen.at(-1).throttle === 0.8,
      'no plume at any dry power: idle, 50% and MIL, each held on the runway',
      `${idleSeen.length + halfSeen.length + milSeen.length} looks; throttle ${idleSeen.at(-1).throttle}, ${halfSeen.at(-1).throttle.toFixed(3)} and ${milSeen.at(-1).throttle}; afterburners at MIL ${milSeen.at(-1).afterburner.join(', ')}`);
    await slide(2);      // full afterburner
    const lit = await until(() => window.fsg.picture.plumes.every((p) => p.lit), null, 20000);
    const abSeen = await watch(3000);
    await sharpShot('plumes-runway-ab.png');
    check(lit && abSeen.every((x) => x.lit.every(Boolean) && x.lengthM.every((m) => m === 4.5)) && abSeen.at(-1).throttle === 1,
      'at full afterburner both plumes show, at full length', `throttle ${abSeen.at(-1).throttle}; afterburners ${abSeen.at(-1).afterburner.join(', ')}; plumes ${abSeen.at(-1).lengthM.join(' and ')} m; ${abSeen.at(-1).knots.toFixed(1)} kt over the ground on the brakes`);
    await tap(0);        // chopped to idle, at a tap
    const chopSeen = await watch(2500);
    const outAt = chopSeen.find((x) => x.lit.every((lit) => !lit))?.t ?? null;
    check(outAt !== null && outAt <= 1000 && none(chopSeen.filter((x) => x.t >= 1000)) && chopSeen.at(-1).throttle === 0,
      'chopped to idle, both plumes are gone within 1 s, and stay gone', `out ${outAt === null ? 'never' : `${outAt.toFixed(0)} ms`} after the chop (read every 50 ms); throttle ${chopSeen.at(-1).throttle}`);
    console.log(`     reported: the frame rate on the runway (the overlay's, this browser drawing in software): ${fps(idleSeen).toFixed(1)} a second at idle, ${fps(milSeen).toFixed(1)} at MIL, ${fps(abSeen).toFixed(1)} in full afterburner with both plumes lit`);
    // Parked again, for what follows.
    const n = (await now()).flight;
    await c.click('#pause');
    await c.click('#restart');
    await until((m) => window.fsg.picture.flight > m && window.fsg.picture.flying, n, 10000);
    await c.waitForTimeout(1500);
  }
  // With the crash override off, flown into the ground at more than 1,575 ft/min: the crashed screen.
  await c.click('#pause');
  await c.click('#override');
  check((await c.getAttribute('#override', 'aria-checked')) === 'false' && (await c.evaluate(() => localStorage.getItem('fsg.crashOverride'))) === 'off', 'the crash override switch goes off, kept as fsg.crashOverride');
  await c.click('#resume');
  const second = await takeOff();
  await until(() => window.fsg.picture.aboveGroundFt > 300, null, 60000);
  await hold(-55, 'level');
  const crashed = await until(() => window.fsg.mode === 'crashed', null, 60000);
  const said = crashed ? { title: await c.locator('#crash-title').textContent(), line: await c.locator('#crash-why').textContent() } : {};
  const fpm = Number((said.line ?? '').replace(/[^\d]/g, ''));
  check(second.off && crashed && said.title === 'Crashed' && /^Hard impact: [\d,]+ ft\/min$/.test(said.line) && fpm > 1575 && await shown('#screen-crashed'), 'crash override off: flown into the ground hard, the crashed screen shows', `"${said.title}" "${said.line}"`);
  await shot('f4c-crashed.png');
  // The same again with the crash override on: the same dive into the ground, and the flight carries on.
  await c.click('#crash-restart');
  await until(() => window.fsg.mode === 'flying' && window.fsg.picture.states > 0, null, 10000);
  await hold(0, 0);
  await c.click('#pause');
  await c.click('#override');
  await c.click('#resume');
  const third = await takeOff();
  // For the owner, the plumes just after liftoff in full afterburner (PR 9), the view dragged round: from the side, and from behind and to one side.
  // Taken here, in a flight whose picture timing is not one of the lines: the sharper pictures slow this browser's frames for the moment.
  for (const [name, dx] of [['plumes-air-side.png', 360], ['plumes-air-quarter.png', 150]]) {
    if (!shots) break;
    await c.mouse.move(250, 250);
    await c.mouse.down();
    await c.mouse.move(250 + dx, 240, { steps: 8 });
    await sharpShot(name);
    await c.mouse.up();
    await c.waitForTimeout(1000);
  }
  await until(() => window.fsg.picture.aboveGroundFt > 300, null, 60000);
  await hold(-55, 'level');
  // Its centre of gravity stands 6.4 ft up: under 10 ft it is at the ground. The fastest sink on the way down is kept, read every 50 ms.
  await c.evaluate(() => { window.sink = 0; });
  const down = await until(() => { const p = window.fsg.picture; window.sink = Math.min(window.sink, p.reading.climb); return p.aboveGroundFt < 10; }, null, 60000);
  const sinking = await c.evaluate(() => window.sink);
  await c.waitForTimeout(2000);
  const survived = await now();
  check(third.off && down && sinking < -1575 && survived.mode === 'flying' && !(await shown('#screen-crashed')) && (await c.getAttribute('#override', 'aria-checked')) === 'true',
    'crash override on: the same dive into the ground, and the flight carries on', `arriving at ${Math.round(-sinking).toLocaleString('en-US')} ft/min; mode ${survived.mode} two seconds later`);
  const box10 = await c.locator('#dev').textContent();
  check(/\nsensor β .+ screen \d+ +tilt .+\nstick -?[\d.]+ back, -?[\d.]+ right +throttle [\d.]+\nlast touchdown: /.test(box10), 'the overlay shows the tilt, the stick and the last touchdown', box10.split('\n').slice(-3).join(' | '));
  console.log(`     reported: the three takeoffs lifted off at ${[first, second, third].map((t) => t.liftoff.knots.toFixed(1)).join(', ')} kt`);
  check(errs.length === 0, 'no page errors or console errors in the flight', errs.join(' | '));
  await flown.close();

  // The flap lever (docs/milestones/3.md, PR F and PR 8), parked on the numbers with the brakes on, in a flight of its own.
  // (This script's mouse taps each put a frame of headless Chromium's picture about 50 ms behind: PR F found it on the
  // Cessna. So the lever is pressed here, in a flight whose picture timing is not one of the lines.)
  {
    const levered = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block', permissions: MOTION });
    const v = await levered.newPage();
    const leverErrs = [];
    v.on('pageerror', (error) => leverErrs.push(String(error)));
    v.on('console', (m) => { if (m.type() === 'error') leverErrs.push(m.text()); });
    // A tap on the messages between the page and its Worker, to time the flaps by JSBSim's own clock.
    // The Worker answers in order, so the last state before its reply to a press is
    // JSBSim's time when the press reached it; the first state after with the flaps at the setting
    // asked for is its time when they got there. `flapWire.press` holds the last press that changed the setting:
    // { to, sent, from, there, seen } (the setting; the page's clock when it was sent, ms; JSBSim's time when it
    // arrived and when the flaps were there, s; the page's clock when the page was told, ms).
    await v.addInitScript(() => {
      const wire = window.flapWire = { press: null, sentFlaps: null };
      let time = -1, flaps = -1, newest = null, waiting = null;
      const Real = window.Worker;
      window.Worker = class extends Real {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({ data }) => {
            if (data?.stateNames) { time = data.stateNames.indexOf('simulation/sim-time-sec'); flaps = data.stateNames.indexOf('fcs/flap-pos-norm'); newest = data.state[time]; }
            if (data?.type === 'state') {
              newest = data.state[time];
              const press = wire.press;
              if (press && press.from !== null && press.there === null && Math.abs(data.state[flaps] - press.to) < 1e-6) Object.assign(press, { there: newest, seen: performance.now() });
            } else if (waiting && data?.id === waiting.id) { waiting.press.from = newest; waiting = null; }
          });
        }
        postMessage(message, ...rest) {
          if (message?.type === 'controls') {
            if (wire.sentFlaps !== null && message.controls.flaps !== wire.sentFlaps) waiting = { id: message.id, press: wire.press = { to: Number(message.controls.flaps), sent: performance.now(), from: null, there: null, seen: null } };
            wire.sentFlaps = message.controls.flaps;
          }
          return super.postMessage(message, ...rest);
        }
      };
    });
    await v.goto(base);
    await on(v).ready();
    const now = () => v.evaluate(() => ({ ...window.fsg.picture, pilot: window.fsg.pilot }));
    const until = (test, arg, timeout) => v.waitForFunction(test, arg, { timeout, polling: 50 }).then(() => true, () => false);
    const reads = () => v.locator('#flaps-reads').textContent();
    check(await on(v).fly(), 'the flap lever: a flight of its own, parked');
    // Where it is: inside the safe area; over none of the throttle, the pause button or the other buttons; and no part of the HUD under it.
    const placed = await v.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const safe = box('safe'), lever = box('flap-lever'), parts = ['flaps-up', 'flaps-down', 'flaps-reads'].map(box), below = box('speedbrake');
      const inside = (r) => r.width > 0 && r.left >= safe.left && r.right <= safe.right && r.top >= safe.top && r.bottom <= safe.bottom;
      const others = ['throttle', 'pause', 'gear', 'flaps', 'speedbrake', 'brake'].filter((id) => { const r = box(id); return r.width > 0 && r.left < lever.right && r.right > lever.left && r.top < lever.bottom && r.bottom > lever.top; });
      // The HUD's canvas: its drawn pixels under the lever, and how far right its drawing goes in the airspeed and altitude's row (the VSI over the altitude with it).
      const hud = document.getElementById('hud'), at = hud.getBoundingClientRect(), k = hud.width / at.width, px = hud.getContext('2d').getImageData(0, 0, hud.width, hud.height).data;
      const ink = (x, y) => px[(Math.round(y * k) * hud.width + Math.round(x * k)) * 4 + 3] > 0;
      let under = 0, rowRight = 0, rowInk = 0;
      for (let y = Math.ceil(lever.top); y < lever.bottom; y++) for (let x = Math.ceil(lever.left); x < lever.right; x++) if (ink(x - at.left, y - at.top)) under++;
      const row = (safe.top + safe.bottom) / 2;
      for (let y = Math.round(row - 34); y <= row + 14; y++) for (let x = Math.round(innerWidth / 2); x < innerWidth; x++) if (ink(x - at.left, y - at.top)) { rowInk++; rowRight = Math.max(rowRight, x); }
      // Every button and the HUD's numbers: is any of the HUD drawn under any button?
      let underButtons = 0;
      for (const b of document.querySelectorAll('#toggles button, #pause')) {
        if (b.getClientRects().length === 0) continue;
        const r = b.getBoundingClientRect();
        for (let y = Math.ceil(r.top); y < r.bottom; y++) for (let x = Math.ceil(r.left); x < r.right; x++) if (ink(x - at.left, y - at.top)) underButtons++;
      }
      const up = getComputedStyle(document.getElementById('flaps-up')), down = getComputedStyle(document.getElementById('flaps-down'));
      return {
        inside: parts.every(inside) && inside(lever), within: parts.every((r) => r.left >= lever.left && r.right <= lever.right && r.top >= lever.top && r.bottom <= lever.bottom), others, under, rowRight, rowInk, underButtons,
        lever: { left: lever.left, right: lever.right, top: lever.top, bottom: lever.bottom, width: lever.width, height: lever.height }, below: { left: below.left, right: below.right, top: below.top },
        seam: parts[1].top - parts[0].bottom, safe: { right: safe.right, bottom: safe.bottom },
        cut: [up.maskImage || up.webkitMaskImage, down.maskImage || down.webkitMaskImage].map((m) => String(m).startsWith('url(')),
        corners: [up.borderTopLeftRadius, up.borderBottomLeftRadius, down.borderTopLeftRadius, down.borderBottomLeftRadius].join(' '),
      };
    });
    check(placed.inside && placed.within, 'the flap lever: both buttons and the indicator are inside the safe area', `the lever is ${placed.lever.width} x ${placed.lever.height} px at ${placed.lever.left}, ${placed.lever.top}; the safe area ends at ${placed.safe.right}, ${placed.safe.bottom}`);
    // On the F-4C the lever stands between Gear and Boards (on the Cessna it stood over Brakes, its only other button).
    check(placed.others.length === 0 && placed.lever.left === placed.below.left && placed.lever.right === placed.below.right && placed.below.top - placed.lever.bottom === 10,
      'it is over none of the throttle, the pause button or the other buttons: it stands in the buttons\' column, as wide as they are, 10 px above Boards', placed.others.join(', ') || `${placed.lever.left} to ${placed.lever.right} px across, as Boards; ${placed.below.top - placed.lever.bottom} px above it`);
    check(placed.under === 0 && placed.underButtons === 0 && placed.rowInk > 0 && placed.rowRight < placed.lever.left, 'no button covers any of the HUD: nothing of the HUD is drawn under the lever or any other button, and the altitude\'s row ends to the lever\'s left',
      `${placed.under} HUD pixels under the lever, ${placed.underButtons} under the buttons; the altitude and the VSI over it end ${placed.lever.left - placed.rowRight} px left of it`);
    check(placed.seam === 2 && placed.cut.every(Boolean) && placed.corners === '10px 0px 0px 10px', 'the two buttons are pushed together, 2 px apart, rounded only on the outside, and each is cut away round the indicator', `seam ${placed.seam} px; corners ${placed.corners}`);
    // The words fit the indicator: at least 4 px to spare each side of each of the F-4C's, "Up", "1/2" and "Full".
    const SAYS = ['Up', '1/2', 'Full'];
    const spare = await v.evaluate((all) => {
      const pill = document.getElementById('flaps-reads'), was = pill.textContent, box = pill.getBoundingClientRect(), out = {};
      for (const word of all) {
        pill.textContent = word;
        const range = document.createRange();
        range.selectNodeContents(pill);
        const words = range.getBoundingClientRect();
        out[word] = { wide: words.width, spare: Math.min(words.left - box.left, box.right - words.right) };
      }
      pill.textContent = was;
      return out;
    }, SAYS);
    check(SAYS.every((word) => spare[word].wide > 0 && spare[word].spare >= 4), 'the indicator\'s words fit inside it with at least 4 px to spare each side: "Up", "1/2" and "Full"',
      SAYS.map((word) => `"${word}" ${spare[word].wide.toFixed(1)} px wide, ${spare[word].spare.toFixed(1)} to spare`).join('; '));
    // A press, as a finger makes it: a tap in the middle of the button. Then how long until JSBSim's flaps are at the setting
    // the indicator reads, and the model's flaps on screen with them. The time is JSBSim's own, read off the Worker's messages
    // (`flapWire`, above): from the press reaching JSBSim to the first state with the flaps there.
    const AT = { Up: 0, '1/2': 0.5, Full: 1 };
    const middle = async (id) => { const r = await v.locator(id).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    const dim = (id) => v.evaluate((q) => { const b = document.querySelector(q); return b.disabled && Number(getComputedStyle(b).opacity) <= 0.45; }, id);
    const press = async (id) => {
      const before = await now(), dimmed = await dim(id);
      await v.evaluate(() => { window.flapWire.press = null; window.flapWire.sentFlaps ??= window.fsg.pilot.flaps; });
      await v.mouse.click(...await middle(id));
      const says = await reads(), want = AT[says];
      // A dim button changes nothing: no new setting is sent, and the flaps stay where they were.
      if (dimmed) await v.waitForTimeout(500);
      else await until(() => window.flapWire.press !== null && window.flapWire.press.there !== null, null, 12000);
      const modelThere = await until((to) => Math.abs(window.fsg.picture.model.flaps - to) < 1e-5, want, 2000);
      const after = await now(), wire = await v.evaluate(() => window.flapWire.press);
      const arrived = wire !== null && wire.there !== null;
      return {
        says, want, dimmed, nothingSent: wire === null, there: (dimmed ? wire === null : arrived) && modelThere && after.surfaces.flaps === want && Math.abs(after.model.flaps - want) < 1e-5,
        seconds: arrived ? wire.there - wire.from : null, jsbsim: after.surfaces.flaps, model: after.model.flaps, moved: after.model.flaps - before.model.flaps, sent: after.pilot.flaps,
      };
    };
    const told = (p) => (p.dimmed ? `"${p.says}" (the button dim): ${p.nothingSent ? 'nothing sent' : 'A SETTING WAS SENT'}; JSBSim's flaps stay at ${p.jsbsim} and the model's at ${p.model.toFixed(3)}`
      : `"${p.says}": JSBSim's flaps ${p.jsbsim} and the model's ${p.model.toFixed(3)}; there ${p.seconds?.toFixed(2)} s after the press by JSBSim's clock`);
    const start = await now();
    check(start.surfaces.flaps === 0.5 && Math.abs(start.model.flaps - 0.5) < 1e-5 && start.pilot.flaps === 0.5 && (await reads()) === '1/2' && !(await dim('#flaps-up')) && !(await dim('#flaps-down')),
      'parked, the indicator reads "1/2", JSBSim\'s flaps and the model\'s are at half, and neither button is dim', `JSBSim's ${start.surfaces.flaps}, the model's ${start.model.flaps.toFixed(3)}`);
    // A tap on the indicator does nothing: it is not a button.
    await v.mouse.click(...await middle('#flaps-reads'));
    await v.waitForTimeout(300);
    check((await reads()) === '1/2' && (await now()).pilot.flaps === 0.5, 'a tap on the indicator does nothing');
    // Down gives "Full"; there Flaps Down is dim and does nothing. The flight manual: 8 s for the whole travel down, so 4 s from 1/2.
    const down = await press('#flaps-down'), downAgain = await press('#flaps-down');
    check(down.says === 'Full' && down.there && down.moved > 0.49 && down.seconds <= 5 && downAgain.dimmed && downAgain.says === 'Full' && downAgain.there && downAgain.nothingSent,
      'Flaps Down from "1/2" reads "Full", and JSBSim\'s flaps and the model\'s are fully down; there Flaps Down is dim and a press of it changes nothing', `${told(down)}; ${told(downAgain)}`);
    // Up twice gives "Up". The flight manual: 6 s for the whole travel up, so 3 s each half.
    const ups = [await press('#flaps-up'), await press('#flaps-up')], upAgain = await press('#flaps-up');
    check(ups.map((p) => p.says).join(', ') === '1/2, Up' && ups.every((p) => p.there && p.moved < -0.49 && p.seconds <= 4) && [0.5, 0].every((at, k) => ups[k].sent === at) && upAgain.dimmed && upAgain.nothingSent && upAgain.there,
      'Flaps Up twice from "Full" reads "1/2", then "Up", and the model\'s flaps follow JSBSim\'s; there Flaps Up is dim and a press changes nothing', `${ups.map(told).join('; ')}; ${told(upAgain)}`);
    check(leverErrs.length === 0, 'no page errors with the lever', leverErrs.join(' | '));
    await levered.close();
  }

  // The flap lever's pictures, on a screen as sharp as a phone's (two device pixels to the point; the flight above is
  // drawn at one): the F-4C on the numbers at "1/2", as every flight starts, and at "Full".
  {
    const sharp = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: MOTION });
    const s = await sharp.newPage();
    await s.goto(base);
    await on(s).ready();
    const flew = await on(s).fly();
    const flapsAt = (want) => s.waitForFunction((to) => { const p = window.fsg.picture; return p.surfaces.flaps === to && Math.abs(p.model.flaps - to) < 1e-5; }, want, { timeout: 8000, polling: 50 }).then(() => true, () => false);
    const atHalf = await flapsAt(0.5), readsHalf = await s.locator('#flaps-reads').textContent();
    await s.waitForTimeout(300);
    if (shots) await s.screenshot({ path: join(shots, 'f4c-start-sharp.png') });
    await s.click('#flaps-down');
    const atFull = await flapsAt(1), readsFull = await s.locator('#flaps-reads').textContent();
    await s.waitForTimeout(300);
    if (shots) await s.screenshot({ path: join(shots, 'f4c-flaps-full-parked-sharp.png') });
    check(flew && atHalf && readsHalf === '1/2' && atFull && readsFull === 'Full' && (await s.locator('#flaps-down').isDisabled()), 'on a screen with two device pixels to the point, the lever reads "1/2" at the start and "Full" a press of Flaps Down later, with the flaps there', `"${readsHalf}", then "${readsFull}"`);
    await sharp.close();
  }

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

{
  const places = Object.entries(overlayPlaces), [, first] = places[0];
  check(places.length === 4 && places.every(([, at]) => Math.abs(at.left - first.left) < 1 && Math.abs(at.fromBottom - first.fromBottom) < 1), 'the debug overlay is in one place on the start, flight, pause and crashed screens',
    places.map(([name, at]) => `${name}: ${at.left.toFixed(0)} px from the left, ${at.fromBottom.toFixed(0)} from the bottom`).join('; '));
}
check(errors.length === 0, 'no console errors', errors.join(' | '));
console.log(`\nChromium ${browser.version()} (headless), FSG ${version}: ${failed ? `${failed} FAILED` : 'all passed'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
