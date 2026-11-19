// FSG's service worker: caches the whole app so it works offline.
// After 135crewdog/wings, sw.js, commit 557a8d0 (itself after Rage's), with
// FSG's prefix and file list and without the Hawaii store.
//
// Every app on this origin shares storage, so every cache here starts with
// "fsg-" and only caches that start with "fsg-" are ever deleted. It never
// skips waiting on its own; the app offers the update and posts
// "skip-waiting" when the pilot accepts.

const VERSION = '0.0.1';   // the same value as APP_VERSION in src/version.js
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
