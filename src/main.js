// The app: the flight on screen, the game in its Worker, the screens, the developer overlay, and the update offer.
// After 135crewdog/wings, src/main.js, commit 557a8d0: the screens, the pause and restart logic, the wake
// lock and the update offer are Wings'. The platform rules and the update logic are Rage's
// (135crewdog/rage, src/main.js), by way of Wings. FSG's flight is not on the page: it is JSBSim in a Worker
// (src/fdm.js), which this file starts when the app opens and speaks to with a few messages.
import { APP_VERSION } from './version.js';
import { startGame } from './fdm.js';
import { startFlight } from './flight.js';
import { C172P } from './sim/aircraft/c172p.js';

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('.version')) el.textContent = APP_VERSION;

// ---- screens: one at a time, or none in flight ----
const screens = [...document.querySelectorAll('.screen')];
const show = (name) => {
  for (const el of screens) el.hidden = el.id !== `screen-${name}`;
  $('controls').hidden = name !== null;
};

// ---- the flight on screen, and the game in its Worker ----
const AIRCRAFT = C172P;
let mode = 'start';   // start, flying, paused or crashed
const flight = startFlight($('view'), AIRCRAFT);
// The game: JSBSim in its Worker, with the airplane parked on the numbers and held. It is started when the
// app opens, so that Fly has nothing to wait for; held, the Worker rests. `jsbsim` is what the developer
// overlay says about it: null while it starts, then which build (and why, for the fallback), or the error.
let game = null, jsbsim = null;
const openGame = () => {
  game = null;
  jsbsim = null;
  showDev();
  return startGame(AIRCRAFT, {
    onState(message) {
      flight.state(message);
      if (message.ended && mode === 'flying') crashed(message.ended);
    },
    // The Worker has failed: whatever was going on is over. Restart opens a fresh one.
    onFailure(error) { crashed({ reason: String(error?.message ?? error) }); },
  }).then((opened) => {
    game = opened;
    jsbsim = { build: opened.build, why: opened.why, version: opened.version, says: opened.says };
    flight.began(opened.first);
    showDev();
  }, (error) => {
    jsbsim = { error: String(error?.message ?? error) };
    crashed({ reason: `JSBSim did not start: ${jsbsim.error}` });
  });
};

// ---- the developer overlay ----
// A small box of plain facts, for troubleshooting and for screenshots sent to
// Claude Code. Switched on and off on the pause screen, off until the pilot
// turns it on, and the choice is kept between visits. It is written when
// something changes, and four times a second in flight: nothing here runs every frame.
// In flight it shows how the flight is running, with the worst of each number since
// it was last let go; on the pause screen those numbers stay, for a screenshot.
const DEV_KEY = 'fsg.dev';
const devSwitch = $('dev-switch');
let devOn = false, devTimer = null;
let offline = 'not yet';   // yes once the service worker has every file cached
// Opened from the home screen, or in a browser tab? iOS says with navigator.standalone.
const installed = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const whole = (x) => (Math.round(x) || 0).toLocaleString('en-US');   // never "-0"
function showDev() {
  if (!devOn) return;
  const lines = [
    `FSG ${APP_VERSION}`,
    installed() ? 'home-screen app' : 'browser tab',
    `offline ready: ${offline}`,
    jsbsim === null ? 'JSBSim: starting' : jsbsim.error ? `JSBSim did not start: ${jsbsim.error}` : jsbsim.says,
  ];
  const s = flight.status();
  if (s.time !== undefined) {
    lines.push(
      `${AIRCRAFT.model}   ${mode === 'start' ? 'parked' : mode}`,
      `${s.fps.toFixed(0)} frames/s (least ${s.leastFps.toFixed(0)})   ${s.draws} draws`,
      `${s.stepsPerSecond.toFixed(1)} steps/s   ${s.droppedSeconds.toFixed(2)} s dropped   ${whole(s.states)} states, ${s.missing} missing`,
      `picture ${s.behindMs.toFixed(0)} ms behind (99 in 100 within ${s.behindWithinMs}, most ${s.behindMostMs.toFixed(0)})`,
      `${whole(s.northFt)} ft N, ${whole(s.eastFt)} ft E, ${whole(s.aboveGroundFt - AIRCRAFT.standingFt)} ft up, heading ${String(Math.round(s.headingDeg) % 360).padStart(3, '0')}, ${s.knots.toFixed(0)} kt` +
        (s.propellerRpm === null ? '' : `, ${whole(s.propellerRpm)} RPM`),
    );
  }
  $('dev').textContent = lines.join('\n');
}
// The overlay's clock: only with Developer on, and only in flight.
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
});

// ---- flying, pausing, restarting (after Wings) ----
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
  show(null);
  game.hold(false).catch(() => {});   // a Worker that has failed says so itself (onFailure)
  flight.fly();
  devClock();
};
// The pause screen before the first flight (opened with Settings on the start
// screen): its top button is Fly, and Restart waits for a flight.
const menu = (beforeFlight) => {
  $('resume').textContent = beforeFlight ? 'Fly' : 'Resume';
  $('restart').hidden = beforeFlight;
};
const pause = () => {
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
// The flight is over: a hard arrival or water with the crash override off, a broken state, or a Worker that failed.
const WHY = { 'hard impact': (e) => `Hard impact: ${whole(e.closingFpm)} ft/min`, water: () => 'Water', 'broken state': () => 'The flight model stopped' };
function crashed(ended) {
  mode = 'crashed';
  letSleep();
  flight.hold();
  $('crash-why').textContent = WHY[ended.reason]?.(ended) ?? ended.reason;
  show('crashed');
  devClock();
  showDev();
  checkForUpdate();
}

// The first flight, from Fly on the start screen or on the pause screen opened with Settings.
const fly = () => {
  if (mode !== 'start' || !game || $('fly').disabled) return;
  keepAwake();
  takeOff();
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
// Restart: a new flight, parked on the numbers, and straight into it. After a Worker has failed, a fresh Worker first.
let restarting = false;
for (const id of ['restart', 'crash-restart']) {
  $(id).addEventListener('click', async () => {
    if (restarting || isPortrait() || (mode !== 'paused' && mode !== 'crashed')) return;
    restarting = true;
    keepAwake();
    try {
      if (!game || game.failed) await openGame();
      else flight.began(await game.fly({ held: true }));
      if (game) takeOff();
    } catch (error) {
      crashed({ reason: String(error?.message ?? error) });
    } finally {
      restarting = false;
    }
  });
}

// Leaving the app or turning the phone to portrait pauses the flight. It resumes only from the pause screen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else checkForUpdate();   // iOS drops the wake lock when the app is hidden; Resume asks again
});
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
