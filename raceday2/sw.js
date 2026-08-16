/* RaceDay v2 service worker — installability + offline app shell.
   Scoped to /raceday2/ via relative paths; its own CACHE name so it never
   collides with the v1 worker at /raceday/.
   Network-first for the page so updates flow when online; cache-first for
   icons/manifest. Firebase / CDN / Apps Script always hit the network.
   The display font is embedded in index.html, so a cold offline load renders
   in the real typeface rather than a fallback. */
const CACHE = 'raceday2-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-rd.png'];

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
  if (url.origin !== self.location.origin) return;   // sync/CDN/telemetry → straight to network

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
