// Staff-only rooms: the spectator QR can watch, never change the race. Both apps.
// Uses an in-page Firebase stand-in whose writes follow the same rules as
// database.rules.json (tracks/, trackOwner/, trackStaff/, trackInvite/, trackPin/), with a
// switchable anonymous user, so each "device" is a different signed-in uid.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8844;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

// The rules, as a function of (path, newValue, uid, db). Mirrors database.rules.json.
const MOCK = () => {
  window.__db = window.__db || {};
  window.__uid = window.__uid || null;
  window.__alerts = [];
  window.alert = m => window.__alerts.push(String(m));
  const db = window.__db;
  const get = p => (p in db ? db[p] : null);
  const staff = (key, uid) => uid && get('trackStaff/' + key + '/' + uid) != null;
  const allowed = (p, v, uid) => {
    let m;
    if ((m = p.match(/^tracks\/([^/]+)/))) return !!uid && staff(m[1], uid);
    if ((m = p.match(/^trackOwner\/([^/]+)$/))) return !!uid && get(p) == null && v === uid;
    if ((m = p.match(/^trackStaff\/([^/]+)\/([^/]+)$/))) {
      if (!uid) return false;
      if (v == null) return staff(m[1], uid);
      return m[2] === uid && /^[a-f0-9]{32}$/.test(v) && (get('trackOwner/' + m[1]) === uid || v === get('trackInvite/' + m[1]));
    }
    if ((m = p.match(/^trackInvite\/([^/]+)$/))) return !!uid && staff(m[1], uid) && /^[a-f0-9]{32}$/.test(v);
    if ((m = p.match(/^trackPin\/([^/]+)$/))) return !!uid && staff(m[1], uid) && typeof v === 'string';
    return true;
  };
  const listeners = {};
  const fire = p => Object.keys(listeners).forEach(k => { if (p === k || p.startsWith(k + '/')) listeners[k].forEach(cb => cb({ val: () => snapVal(k) })); });
  const snapVal = k => {
    if (k in db) return db[k];
    const kids = Object.keys(db).filter(x => x.startsWith(k + '/'));
    if (!kids.length) return null;
    const o = {}; kids.forEach(x => { o[x.slice(k.length + 1)] = db[x]; }); return o;
  };
  const denied = () => Promise.reject(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
  const ref = p => ({
    set: v => { if (!allowed(p, v, window.__uid)) return denied(); if (v == null) delete db[p]; else db[p] = v; fire(p); return Promise.resolve(); },
    update: o => {
      for (const k of Object.keys(o)) if (!allowed(p + '/' + k, o[k], window.__uid)) return denied();
      Object.keys(o).forEach(k => { db[p + '/' + k] = o[k]; }); fire(p); return Promise.resolve();
    },
    once: () => Promise.resolve({ val: () => snapVal(p) }),
    on: (ev, cb) => { (listeners[p] = listeners[p] || []).push(cb); cb({ val: () => snapVal(p) }); },
    off: () => { delete listeners[p]; },
    transaction: fn => {
      const cur = get(p), next = fn(cur);
      if (next === undefined) return Promise.resolve({ committed: false, snapshot: { val: () => cur } });
      if (!allowed(p, next, window.__uid)) return denied();
      db[p] = next; fire(p); return Promise.resolve({ committed: true, snapshot: { val: () => next } });
    },
  });
  const auth = { get currentUser() { return window.__uid ? { uid: window.__uid } : null; },
    signInAnonymously: () => { window.__uid = window.__uid || ('uid' + Math.random().toString(36).slice(2, 8)); return Promise.resolve({ user: { uid: window.__uid } }); } };
  window.firebase = { apps: [{}], initializeApp: () => {}, database: () => ({ ref }), auth: () => auth };
  window.firebase.database.ServerValue = { TIMESTAMP: 1 };
};

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  for (const app of ['raceday2', 'raceday']) {
    console.log('\n=== ' + app + ' ===');
    const ctx = await browser.newContext({ viewport: { width: 420, height: 850 } });
    await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
    await ctx.addInitScript(MOCK);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(app + ': ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}/${app}/`);
    await page.waitForTimeout(600);
    const as = (uid) => page.evaluate(u => { window.__uid = u; }, uid);
    const wait = () => page.waitForTimeout(300);

    // --- the admin device turns on sync and claims the room
    await as('adminA');
    await page.evaluate(() => {
      S.track.name = 'Lock Test'; S.sync = { enabled: true, key: 'LOCKROOM' }; setDeviceRole('admin'); persistLocal();
      Sync.activating = true; initSync();
    });
    await wait();
    const a = await page.evaluate(() => ({ key: S.sync.staffKey, ok: Staff.ok, owner: window.__db['trackOwner/LOCKROOM'], staff: window.__db['trackStaff/LOCKROOM/adminA'], invite: window.__db['trackInvite/LOCKROOM'], wrote: !!window.__db['tracks/LOCKROOM/track'] }));
    check('admin device claims the empty room (owner = its sign-in id)', a.ok && a.owner === 'adminA', JSON.stringify(a));
    check('…makes a 32-character staff key and keeps it on the device', /^[a-f0-9]{32}$/.test(a.key || '') && a.staff === a.key && a.invite === a.key);
    check('…and can write the race', a.wrote);
    const key = a.key;

    const links = await page.evaluate(() => ({ scoring: staffLinkParams('scoring'), viewer: staffLinkParams('viewer'), tv: staffLinkParams('tv') }));
    check('staff links carry the staff key', links.scoring.includes('&st=' + key) && links.tv.includes('&st=' + key), links.scoring);
    check('the spectator link never does', !/st=/.test(links.viewer), links.viewer);

    // --- the admin sets a PIN: shared for staff devices
    await page.evaluate(() => { S.adminPin = pinHash('2468'); save(); staffSharePin(); });
    await wait();
    check('the admin PIN is shared to the staff-only spot', await page.evaluate(() => window.__db['trackPin/LOCKROOM'] === pinHash('2468')));

    // --- a different device with the staff key (a scoring tablet)
    await as('scoringB');
    await page.evaluate(k => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.adminPin = ''; S.sync = { enabled: true, key: 'LOCKROOM', staffKey: k }; setDeviceRole('scoring'); persistLocal(); initSync();
    }, key);
    await wait();
    const b = await page.evaluate(() => ({ ok: Staff.ok, staff: window.__db['trackStaff/LOCKROOM/scoringB'], pin: S.adminPin, pinExpected: pinHash('2468') }));
    check('a staff link device registers as staff', b.ok && !!b.staff, JSON.stringify(b));
    check('…and picks up the track\'s PIN', b.pin === b.pinExpected);
    await page.evaluate(() => { S.raceDay.date = '2026-10-16'; save(); });
    await page.waitForTimeout(700);
    check('…and its changes reach the room', await page.evaluate(() => /2026-10-16/.test(window.__db['tracks/LOCKROOM/raceDay/date'] || '')));

    // --- a device with the room code but no key (an edited spectator link)
    await as('fanC');
    await page.evaluate(() => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.adminPin = ''; S.sync = { enabled: true, key: 'LOCKROOM', staffKey: '' }; setDeviceRole('scoring'); persistLocal(); window.__alerts = []; initSync();
    });
    await wait();
    const c = await page.evaluate(() => ({ ok: Staff.ok, staff: window.__db['trackStaff/LOCKROOM/fanC'] }));
    check('a device without the key is NOT registered', !c.ok && !c.staff, JSON.stringify(c));
    const before = await page.evaluate(() => window.__db['tracks/LOCKROOM/raceDay/date']);
    await page.evaluate(() => { S.raceDay.date = '1999-01-01'; save(); });
    await page.waitForTimeout(700);
    check('…its changes are refused by the database', (await page.evaluate(() => window.__db['tracks/LOCKROOM/raceDay/date'])) === before);
    check('…and it is told why', await page.evaluate(() => window.__alerts.some(m => /isn't approved/.test(m))), JSON.stringify(await page.evaluate(() => window.__alerts)));

    // --- a wrong key
    await as('guessD');
    await page.evaluate(() => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.sync = { enabled: true, key: 'LOCKROOM', staffKey: 'ffffffffffffffffffffffffffffffff' }; setDeviceRole('scoring'); persistLocal(); initSync();
    });
    await wait();
    check('a guessed key is refused', await page.evaluate(() => !Staff.ok && !window.__db['trackStaff/LOCKROOM/guessD']));

    // --- a second admin device can't take over the room
    await as('adminE');
    await page.evaluate(() => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.sync = { enabled: true, key: 'LOCKROOM', staffKey: '' }; setDeviceRole('admin'); persistLocal(); initSync();
    });
    await wait();
    check('another admin device without the key cannot claim the room', await page.evaluate(() => !Staff.ok && window.__db['trackOwner/LOCKROOM'] === 'adminA' && window.__db['trackInvite/LOCKROOM'] !== S.sync.staffKey));

    // --- the owner lost its saved key: it re-keys its own room
    await as('adminA');
    await page.evaluate(() => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.sync = { enabled: true, key: 'LOCKROOM', staffKey: '' }; setDeviceRole('admin'); persistLocal(); initSync();
    });
    await wait();
    const r = await page.evaluate(() => ({ ok: Staff.ok, key: S.sync.staffKey, invite: window.__db['trackInvite/LOCKROOM'] }));
    check('the owning admin device that lost its key makes a new one', r.ok && /^[a-f0-9]{32}$/.test(r.key || '') && r.key !== key && r.invite === r.key, JSON.stringify(r));

    // --- spectators never sign in
    await as(null);
    await page.evaluate(() => {
      if (Sync.db) { try { Sync.db.off(); } catch (e) {} Sync.db = null; } staffStop();
      S.sync = { enabled: true, key: 'LOCKROOM', staffKey: '' }; setDeviceRole('viewer'); persistLocal(); initSync();
    });
    await wait();
    check('a spectator device never signs in or registers', await page.evaluate(() => window.__uid === null && !Staff.ok));
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${fail ? '❌' : '✅'} staff-lock: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
