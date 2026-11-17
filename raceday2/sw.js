/* /raceday2/ service worker — retired (2026-11-17). RaceDay moved to /raceday/, which
   registers its own worker there. This one only replaces the old /raceday2/ worker on phones
   that installed it, so the forwarding page always loads from the network, then unregisters
   itself. It deletes no caches: the app's own cache name is shared with /raceday/'s worker.
   No fetch handling — every request goes straight to the network. Safe to leave in place. */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim().then(() => self.registration.unregister()));
});
