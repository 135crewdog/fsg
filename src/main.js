// The app: the screens, the developer overlay, and the update offer.
// After 135crewdog/wings, src/main.js, commit 557a8d0, cut down to what
// milestone 0 needs. The platform rules and the update logic are Rage's
// (135crewdog/rage, src/main.js), by way of Wings.
import { APP_VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('.version')) el.textContent = APP_VERSION;

// ---- screens: one at a time ----
const screens = [...document.querySelectorAll('.screen')];
const show = (name) => { for (const el of screens) el.hidden = el.id !== `screen-${name}`; };

// ---- the developer overlay ----
// A small box of plain facts, for troubleshooting and for screenshots sent to
// Claude Code. Switched on and off on the pause screen, off until the pilot
// turns it on, and the choice is kept between visits. It is written only when
// something changes: nothing here runs every frame.
const DEV_KEY = 'fsg.dev';
const devSwitch = $('dev-switch');
let devOn = false;
let offline = 'not yet';   // yes once the service worker has every file cached
// Opened from the home screen, or in a browser tab? iOS says with navigator.standalone.
const installed = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const showDev = () => {
  if (!devOn) return;
  $('dev').textContent = [
    `FSG ${APP_VERSION}`,
    installed() ? 'home-screen app' : 'browser tab',
    `offline ready: ${offline}`,
  ].join('\n');
};
const setDev = (on) => {
  devOn = on;
  devSwitch.setAttribute('aria-checked', String(on));
  $('dev').hidden = !on;
  showDev();
  try { localStorage.setItem(DEV_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let savedDev = null;
try { savedDev = localStorage.getItem(DEV_KEY); } catch { /* storage may be blocked */ }
setDev(savedDev === 'on');
devSwitch.addEventListener('click', () => setDev(devSwitch.getAttribute('aria-checked') !== 'true'));

// A read-only hook for browser tests and troubleshooting (after Wings' window.wings).
window.fsg = Object.freeze({
  version: APP_VERSION,
  get offline() { return offline; },
});

$('settings').addEventListener('click', () => { show('pause'); checkForUpdate(); });
$('back').addEventListener('click', () => show('start'));

document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

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
