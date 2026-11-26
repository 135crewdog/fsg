// The app: the flight on screen, the game in its Worker, the screens, the debug overlay, and the update offer.
// After 135crewdog/wings, src/main.js, commit 6d689b7 (first copied at 557a8d0): the screens, the pause and restart logic, the wake
// lock and the update offer are Wings'. The platform rules and the update logic are Rage's
// (135crewdog/rage, src/main.js), by way of Wings. FSG's flight is not on the page: it is JSBSim in a Worker
// (src/fdm.js), which this file starts when the app opens and speaks to with a few messages.
import { APP_VERSION } from './version.js';
import { startGame } from './fdm.js';
import { startFlight } from './flight.js';
import { createHud } from './hud.js';
import { buttonText, buttonsFor, controlsFrom } from './input/pilot.js';
import { createTilt } from './input/tilt.js';
import { createThrottle } from './ui/throttle.js';
import { PARKED } from './sim/game.js';
import { readouts } from './readouts.js';
import { C172P } from './sim/aircraft/c172p.js';

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('.version')) el.textContent = APP_VERSION;

// ---- screens: one at a time, or none in flight ----
const screens = [...document.querySelectorAll('.screen')];
const show = (name) => {
  for (const el of screens) el.hidden = el.id !== `screen-${name}`;
  $('controls').hidden = name !== null;
  $('dev').classList.toggle('flying', name === null);   // in flight it moves clear of the HUD
};

// ---- the flight on screen, and the game in its Worker ----
const AIRCRAFT = C172P;
let mode = 'start';   // start, flying, paused or crashed
// The HUD (Wings', Rage's before it), or with it off just its airspeed and altitude. Altitude reads at the
// wheels, and below 2,000 ft above the ground it is the radar altitude, with an R.
const hud = createHud($('hud'), () => $('safe').getBoundingClientRect());
let hudOn = true;
const flight = startFlight($('view'), AIRCRAFT, undefined, {
  onReadout(reading, project, view) {
    if (mode !== 'flying') return;   // the HUD is in flight only: its canvas is hidden with the controls
    const text = readouts(reading.knots, reading.feet, reading.aboveGround);
    hud.draw({ ...reading, airspeed: text.airspeed, altitude: text.radar || text.altitude }, project, view, hudOn);
  },
});
// The game: JSBSim in its Worker, with the airplane parked on the numbers and held. It is started when the
// app opens, so that Fly has nothing to wait for; held, the Worker rests. `jsbsim` is what the debug
// overlay says about it: null while it starts, then which build (and why, for the fallback), or the error.
let game = null, jsbsim = null;

// ---- the pilot's controls (after Wings) ----
// The throttle and the buttons live here; the stick comes from tilt. They go to the Worker as each sensor
// reading and each touch arrives, not once a frame, so a slow screen adds no delay to the hands.
const pilot = { throttle: 0, gear: true, flaps: true, speedbrake: false, brake: true };
const send = () => { if (mode === 'flying' && game) game.controls(controlsFrom(pilot, tilt.stick)).catch(() => {}); };
const recenterButton = $('recenter');
let recenterTimer = null;
const tilt = createTilt({
  // Recenter happened: the button says so for a second.
  onNeutral() {
    recenterButton.textContent = 'Recentered ✓';
    clearTimeout(recenterTimer);
    recenterTimer = setTimeout(() => { recenterButton.textContent = 'Recenter'; }, 1200);
  },
  onStick: send,
});
const throttle = createThrottle($('throttle'), (value) => { pilot.throttle = value; send(); }, { mil: AIRCRAFT.mil ?? null });
// A button shows only if the airplane has the thing: the Cessna has flaps and brakes.
const buttons = buttonsFor(AIRCRAFT);
for (const el of $('toggles').children) el.hidden = !buttons.some(([control]) => control === el.id);
const showButtons = () => {
  for (const button of buttons) {
    $(button[0]).textContent = buttonText(button, pilot[button[0]]);
    $(button[0]).setAttribute('aria-pressed', String(pilot[button[0]]));
  }
};
for (const [control] of buttons) $(control).addEventListener('click', () => { pilot[control] = !pilot[control]; showButtons(); send(); });
// As every flight starts: throttle closed, gear and flaps down, brakes on.
const parkControls = () => {
  Object.assign(pilot, { gear: PARKED.gear, flaps: PARKED.flaps, speedbrake: PARKED.speedbrake, brake: PARKED.brake });
  throttle.set(PARKED.throttle);
  showButtons();
};
parkControls();
// The last touchdown, for the debug overlay: how hard, how fast, how much g.
let touchdown = null;

const openGame = () => {
  game = null;
  jsbsim = null;
  stopped = null;
  showDev();
  return startGame(AIRCRAFT, {
    onState(message) {
      flight.state(message);
      for (const event of message.events ?? []) if (event.type === 'touchdown') touchdown = event;
      if (message.ended && mode === 'flying') crashed(message.ended);
    },
    // The Worker has failed: whatever was going on is over. Restart opens a fresh one.
    onFailure(error) { crashed({ reason: String(error?.message ?? error) }); },
  }).then((opened) => {
    game = opened;
    jsbsim = { build: opened.build, why: opened.why, version: opened.version, says: opened.says };
    flight.began(opened.first);
    touchdown = null;
    if (!overrideOn) game.override(false).catch(() => {});   // a new Worker starts with the override on
    showDev();
  }, (error) => {
    jsbsim = { error: String(error?.message ?? error) };
    crashed({ reason: 'JSBSim did not start' });
  });
};

// ---- the debug overlay ----
// A small box of plain facts, for troubleshooting and for screenshots sent to
// Claude Code. Switched on and off on the pause screen, off until the pilot
// turns it on, and the choice is kept between visits. It is written when
// something changes, and four times a second in flight: nothing here runs every frame.
// In flight it shows how the flight is running, with the worst of each number since
// Fly (or Restart); on the pause screen those numbers stay, for a screenshot.
const DEV_KEY = 'fsg.dev';
const devSwitch = $('dev-switch');
let devOn = false, devTimer = null;
let offline = 'not yet';   // yes once the service worker has every file cached
let stopped = null;        // the error's own words, when the flight model or its Worker has failed: read here, not on the screen
// Opened from the home screen, or in a browser tab? iOS says with navigator.standalone.
const installed = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const fixed = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : '-');
const whole = (x) => (Math.round(x) || 0).toLocaleString('en-US');   // never "-0"
function showDev() {
  if (!devOn) return;
  const lines = [
    `FSG ${APP_VERSION}`,
    installed() ? 'home-screen app' : 'browser tab',
    `offline ready: ${offline}`,
    jsbsim === null ? 'JSBSim: starting' : jsbsim.error ? `JSBSim did not start: ${jsbsim.error}` : jsbsim.says,
  ];
  if (stopped && !jsbsim?.error) lines.push(`stopped: ${stopped}`);
  const s = flight.status();
  if (s.time !== undefined) {
    lines.push(
      `${AIRCRAFT.model}   ${mode === 'start' ? 'parked' : mode}`,
      `${s.fps.toFixed(0)} frames/s (least ${s.leastFps.toFixed(0)})   ${s.draws} draws`,
      `${s.stepsPerSecond.toFixed(1)} steps/s   ${s.droppedSeconds.toFixed(2)} s dropped   ${whole(s.states)} states, ${s.missing} missing`,
      `picture ${s.behindMs.toFixed(0)} ms behind (99 in 100 within ${s.behindWithinMs}, most ${s.behindMostMs.toFixed(0)})`,
      `${whole(s.northFt)} ft N, ${whole(s.eastFt)} ft E, ${whole(s.aboveGroundFt - AIRCRAFT.standingFt)} ft up, heading ${String(Math.round(s.headingDeg) % 360).padStart(3, '0')}, ${s.knots.toFixed(0)} kt` +
        (s.propellerRpm === null ? '' : `, ${whole(s.propellerRpm)} RPM`),
      `sensor β ${fixed(tilt.raw.beta)} γ ${fixed(tilt.raw.gamma)} screen ${tilt.raw.screen}   tilt ${fixed(tilt.raw.pitch)}/${fixed(tilt.raw.roll)}`,
      `stick ${fixed(tilt.stick.pitch, 2)} back, ${fixed(tilt.stick.roll, 2)} right   throttle ${fixed(pilot.throttle, 2)}`,
      touchdown ? `last touchdown: ${whole(touchdown.sinkFpm)} ft/min, ${whole(touchdown.knots)} kt, ${fixed(touchdown.g)} g` : 'last touchdown: none yet',
    );
  }
  $('dev').textContent = lines.join('\n');
}
// The overlay's clock: only with the debug overlay on, and only in flight.
const devClock = () => {
  const wanted = devOn && mode === 'flying';
  if (wanted && devTimer === null) devTimer = setInterval(showDev, 250);
  if (!wanted && devTimer !== null) { clearInterval(devTimer); devTimer = null; }
};
const setDev = (on) => {
  devOn = on;
  devSwitch.setAttribute('aria-checked', String(on));
  $('dev').hidden = !on;
  showDev();
  devClock();
  try { localStorage.setItem(DEV_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let savedDev = null;
try { savedDev = localStorage.getItem(DEV_KEY); } catch { /* storage may be blocked */ }
setDev(savedDev === 'on');
devSwitch.addEventListener('click', () => setDev(devSwitch.getAttribute('aria-checked') !== 'true'));

// The crash override: on, nothing ends a flight but the pilot. It is on until the pilot turns it off, and the
// choice is kept between visits.
const OVERRIDE_KEY = 'fsg.crashOverride';
const overrideSwitch = $('override');
let overrideOn = true;
const setOverride = (on) => {
  overrideOn = on;
  overrideSwitch.setAttribute('aria-checked', String(on));
  game?.override(on).catch(() => {});
  try { localStorage.setItem(OVERRIDE_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let savedOverride = null;
try { savedOverride = localStorage.getItem(OVERRIDE_KEY); } catch { /* storage may be blocked */ }
setOverride(savedOverride !== 'off');
overrideSwitch.addEventListener('click', () => setOverride(overrideSwitch.getAttribute('aria-checked') !== 'true'));

// The HUD's switch: on until the pilot turns it off, kept between visits. Off, only its airspeed and altitude
// show, in their places.
const HUD_KEY = 'fsg.hud';
const hudSwitch = $('hud-switch');
const setHud = (on) => {
  hudOn = on;
  hudSwitch.setAttribute('aria-checked', String(on));
  flight.redraw();
  try { localStorage.setItem(HUD_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let savedHud = null;
try { savedHud = localStorage.getItem(HUD_KEY); } catch { /* storage may be blocked */ }
setHud(savedHud !== 'off');
hudSwitch.addEventListener('click', () => setHud(hudSwitch.getAttribute('aria-checked') !== 'true'));

// Fly waits for the two things a flight needs: the airplane's model, and the game in its Worker.
const opened = openGame();
Promise.all([flight.ready, opened]).then(() => { if (game) $('fly').disabled = false; });

// A read-only hook for browser tests and troubleshooting (after Wings' window.wings).
window.fsg = Object.freeze({
  version: APP_VERSION,
  get offline() { return offline; },
  get mode() { return mode; },
  get jsbsim() { return jsbsim; },   // null while JSBSim starts; then { build, why, version, says }, or { error }
  get picture() { return flight.status(); },   // what is on screen and how the flight is running
  get stick() { return { ...tilt.stick }; },
  get pilot() { return { ...pilot }; },
  get touchdown() { return touchdown; },
});

// ---- flying, pausing, restarting (after Wings) ----
let motionAllowed = false;   // the pilot has allowed motion access on this visit
let restarting = false, interrupted = false;   // a Restart being made, and whether the app was left or lost focus meanwhile
const isPortrait = () => window.innerHeight > window.innerWidth;   // read directly: the media query's answer can be stale
// The screen is kept awake only in flight. On the start, pause and crashed
// screens it is let go, so a phone put down with the app open can sleep.
let lock = null, awake = false;
const keepAwake = () => {
  awake = true;
  navigator.wakeLock?.request('screen').then((held) => {
    // The pilot may have paused before iOS answered: then let it straight go.
    if (awake) { lock?.release().catch(() => {}); lock = held; } else held.release().catch(() => {});
  }).catch(() => {});
};
const letSleep = () => {
  awake = false;
  lock?.release().catch(() => {});
  lock = null;
};
// Time runs: the Worker is let go, and the picture with it.
const takeOff = () => {
  mode = 'flying';
  stopped = null;
  show(null);
  game.hold(false).catch(() => {});   // a Worker that has failed says so itself (onFailure)
  send();   // the controls as they stand now
  flight.fly();
  devClock();
};
// The pause screen before the first flight (opened with Settings on the start
// screen): its top button is Fly, and Restart and Recenter wait for a flight.
const menu = (beforeFlight) => {
  $('resume').textContent = beforeFlight ? 'Fly' : 'Resume';
  $('restart').hidden = beforeFlight;
  recenterButton.hidden = beforeFlight;
};
const pause = () => {
  if (restarting) interrupted = true;
  if (mode !== 'flying') return;
  mode = 'paused';
  menu(false);
  letSleep();
  game?.hold(true).catch(() => {});
  flight.hold();
  show('pause');
  devClock();
  showDev();
  checkForUpdate();
};
// The flight is over. A crash (a hard arrival or water, with the crash override off) says which, in a line.
// Anything else is the flight model or its Worker failing: the screen says so in a few words and what to do
// (after Wings' motion-access screen, commits c9ded4f, 4e7745b and 2eb7b98: fewer words, no reasons), and the
// error's own words go to the debug overlay.
const CRASHES = { 'hard impact': (e) => `Hard impact: ${whole(e.closingFpm)} ft/min`, water: () => 'Water' };
function crashed(ended) {
  mode = 'crashed';
  letSleep();
  flight.hold();
  const crash = CRASHES[ended.reason];
  stopped = crash ? null : ended.reason;
  $('crash-title').textContent = crash ? 'Crashed' : 'Something went wrong';
  $('crash-why').textContent = crash ? crash(ended) : 'Tap Restart. If it happens again, reopen FSG.';
  show('crashed');
  devClock();
  showDev();
  checkForUpdate();
}

// The first flight, from Fly on the start screen or on the pause screen opened with Settings.
const fly = () => {
  if (mode !== 'start' || !game || $('fly').disabled) return;
  // Asking for motion access must be the first thing in the tap, or iOS refuses it.
  const allowed = tilt.request();
  keepAwake();
  allowed.then((yes) => {
    if (!yes) { letSleep(); show('denied'); return; }
    motionAllowed = true;
    tilt.recenter();
    // While iOS was asking, the app may have been left or the device turned upright; pause() could do nothing
    // then, with no flight running. So look again: if so, the flight waits on the pause screen, held, for
    // Resume. (The prompt itself takes focus from the app; that alone is not a reason to wait.)
    if (document.hidden || isPortrait()) {
      mode = 'paused';
      menu(false);
      letSleep();
      show('pause');
      showDev();
    } else takeOff();
  });
};
$('fly').addEventListener('click', fly);
$('settings').addEventListener('click', () => { menu(true); show('pause'); checkForUpdate(); });
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', () => {
  if (mode === 'start') { fly(); return; }
  if (mode !== 'paused' || isPortrait()) return;
  keepAwake();
  takeOff();
});
recenterButton.addEventListener('click', () => tilt.recenter());
// Restart: a new flight, parked on the numbers, and straight into it. After a Worker has failed, a fresh Worker first.
for (const id of ['restart', 'crash-restart']) {
  $(id).addEventListener('click', async () => {
    if (restarting || isPortrait() || (mode !== 'paused' && mode !== 'crashed')) return;
    restarting = true;
    interrupted = false;
    // If JSBSim failed before the first Fly, this tap is the first to fly: motion access is asked for here,
    // first thing in the tap, as in Fly.
    const allowed = motionAllowed ? Promise.resolve(true) : tilt.request();
    keepAwake();
    try {
      if (!(await allowed)) { mode = 'start'; letSleep(); show('denied'); return; }
      motionAllowed = true;
      if (!game || game.failed) await openGame();
      else { flight.began(await game.fly({ held: true, crashOverride: overrideOn })); touchdown = null; }
      if (!game) return;   // it did not start: the crashed screen says so
      parkControls();
      tilt.recenter();
      // The new flight is there, held. While it was being made the app may have been hidden, lost focus, or
      // the phone been turned upright; pause() could only note it then, with no flight running. So look
      // again: if so, the new flight waits on the pause screen, held, for Resume.
      if (interrupted || document.hidden || isPortrait()) {
        mode = 'paused';
        menu(false);
        letSleep();
        show('pause');
        showDev();
      } else takeOff();
    } catch (error) {
      crashed({ reason: String(error?.message ?? error) });
    } finally {
      restarting = false;
    }
  });
}

// Leaving the app, anything that takes focus from it, or turning the phone to portrait pauses the flight. It
// resumes only from the pause screen. Control Center and its screen-recording menu can't pause it: iOS tells
// a home-screen app nothing when they cover it (no blur, no visibility change; tested on the owner's phone in
// Wings, 22 Nov 2026), so there the pilot pauses by hand.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else checkForUpdate();   // iOS drops the wake lock when the app is hidden; Resume asks again
});
window.addEventListener('blur', pause);   // anything that takes focus from the app
window.addEventListener('resize', () => { if (isPortrait()) pause(); });
window.addEventListener('orientationchange', pause);
screen.orientation?.addEventListener('change', pause);

// iOS ignores user-scalable=no for pinch and double-tap in some versions.
for (const type of ['gesturestart', 'dblclick']) {
  document.addEventListener(type, (event) => event.preventDefault());
}

// ---- service worker and updates ----
// A new version is offered on the start and pause screens; it is taken only when the pilot taps.
let waiting = null, registration = null, updateAccepted = false;
const offerUpdate = () => { for (const el of document.querySelectorAll('.update')) el.hidden = false; };

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    // A new worker that has installed while an old one still runs the app is
    // an update waiting to be taken. (With no old one, it's the first install.)
    const watch = (w) => {
      if (!w) return;
      const check = () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; offerUpdate(); }
      };
      check();
      w.addEventListener('statechange', check);
    };
    watch(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => { offline = 'no'; showDev(); });
  // A worker is active only after it has cached every file in its list.
  navigator.serviceWorker.ready.then(() => { offline = 'yes'; showDev(); });
  // Reload only for an update the pilot accepted: the first install also
  // takes control (clients.claim) and must not interrupt anything.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateAccepted) location.reload(); });
} else {
  offline = 'no';
  showDev();
}

// The browser looks for a new sw.js only on a navigation, and a home-screen
// app resumed from the background makes none; so ask whenever the app comes
// back to the screen or the pause screen opens. Nothing activates until the offer is taken.
function checkForUpdate() { registration?.update().catch(() => {}); }

for (const button of document.querySelectorAll('.update')) {
  button.addEventListener('click', () => {
    if (!waiting) return;
    updateAccepted = true;
    waiting.postMessage('skip-waiting');
  });
}
