/* RaceDay Profiles service worker — installability + offline app shell.
   Network-first for the page so updates always flow when online;
   cache-first for icons/manifest. Mirrors /sw.js at repo root. */
const CACHE = 'raceday-profiles-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', '../icon-rd.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isDoc) {
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; })
                .catch(() => caches.match('./index.html').then(m => m || caches.match('./')))
    );
  } else {
    e.respondWith(
      caches.match(req).then(m => m || fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; }))
    );
  }
});
