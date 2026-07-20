/* Root service worker — retired. The app moved to /raceday/, which registers
   its own service worker there. This one exists only to take over from the
   old root-scoped worker already installed on returning devices, clear its
   app-shell cache, and then get out of the way (no fetch handling — every
   request goes straight to the network). Safe to leave in place indefinitely. */
self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('raceday-')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
