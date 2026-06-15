// RaceDay offline service worker.
//
// DORMANT until registered from index.html — this file has zero effect on the
// app until the registration snippet (see PWA-OFFLINE.md) is added. Bump
// CACHE_VERSION whenever the app shell changes so installed users pick up the
// new build on their next online load.

const CACHE_VERSION = 'raceday-v1';

// App shell: everything needed to launch with no internet. localStorage data
// (the actual race-day state) is never touched by the service worker.
const SHELL = [
  './',
  './index.html',
  './timing-import.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Pages: network-first so an online track always gets the latest build,
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Assets (icons, manifest): cache-first for instant offline loads.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
