// FSG's service worker: caches the whole app so it works offline.
// After 135crewdog/wings, sw.js, commit 557a8d0 (itself after Rage's), with
// FSG's prefix and file list and without the Hawaii store.
//
// Every app on this origin shares storage, so every cache here starts with
// "fsg-" and only caches that start with "fsg-" are ever deleted. It never
// skips waiting on its own; the app offers the update and posts
// "skip-waiting" when the pilot accepts.

const VERSION = '0.0.14';   // the same value as APP_VERSION in src/version.js
const CACHE = `fsg-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js',
  './src/version.js',
  './src/fdm.js',
  './src/flight.js',
  './src/hud.js',
  './src/instruments.js',
  './src/readouts.js',
  './src/input/look.js',
  './src/render/aircraft.js',
  './src/render/between.js',
  './src/render/camera.js',
  './src/render/frames.js',
  './src/render/surfaces.js',
  './src/render/world.js',
  './src/sim/aircraft/c172p.js',
  './src/sim/aircraft/c172x.js',
  './src/sim/assists.js',
  './src/sim/bench.js',
  './src/sim/clock.js',
  './src/sim/codes.js',
  './src/sim/core.js',
  './src/sim/files.js',
  './src/sim/flight-run.js',
  './src/sim/game.js',
  './src/sim/ground.js',
  './src/sim/loop.js',
  './src/sim/rules.js',
  './src/sim/world.js',
  './src/sim/worker-handler.js',
  './src/sim/worker.js',
  // Three.js, and the loader for the airplane's model with the two files it imports.
  './vendor/three/build/three.module.js',
  './vendor/three/build/three.core.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
  // The Cessna's model (models/CREDITS.md).
  './models/c172p.glb',
  // JSBSim: two builds of it, each an Emscripten file and the .wasm it loads from beside itself.
  './jsbsim/dist-wasm/fdm-weh.mjs',
  './jsbsim/dist-wasm/fdm-weh.wasm',
  './jsbsim/dist-wasm/fdm-jseh.mjs',
  './jsbsim/dist-wasm/fdm-jseh.wasm',
  // The three files JSBSim reads to load the Cessna the game flies (src/sim/aircraft/c172p.js).
  './jsbsim/jsbsim-data/aircraft/c172p/c172p.xml',
  './jsbsim/jsbsim-data/engine/eng_io320.xml',
  './jsbsim/jsbsim-data/engine/prop_75in2f.xml',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own HTTP cache, so a new version
  // never stores a stale copy of a file.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('fsg-') && k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Cache first, network as the fallback; the app is static and versioned.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request, { ignoreSearch: true })).then((hit) => hit || fetch(event.request)),
  );
});
