// Driven results lock: results/<trackId>/… is what Driven shows as verified, so only the
// track's own device may publish it. Both apps. Uses an in-page Firebase stand-in whose
// writes follow database.rules.json (resultsKey/, resultsWriter/, results/, profileTracks/)
// with a switchable anonymous user, so each "device" is a different signed-in uid.
// Before this, results/ and profileTracks/ accepted writes from anyone.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8847;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

const MOCK = () => {
  window.__db = window.__db || {};
  window.__uid = window.__uid || null;
  window.__alerts = [];
  window.alert = m => window.__alerts.push(String(m));
  const db = window.__db;
  const get = p => (p in db ? db[p] : null);
  const writer = (tid, uid) => uid && get('resultsWriter/' + tid + '/' + uid) != null;
  const allowed = (p, v, uid) => {
    let m;
    if ((m = p.match(/^resultsKey\/([^/]+)$/))) return !!uid && (get(p) == null || writer(m[1], uid)) && typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
    if ((m = p.match(/^resultsWriter\/([^/]+)\/([^/]+)$/))) return !!uid && m[2] === uid && v != null && v === get('resultsKey/' + m[1]);
    if ((m = p.match(/^results\/([^/]+)\//))) return writer(m[1], uid);
    if ((m = p.match(/^profileTracks\/[^/]+\/([^/]+)$/))) return writer(m[1], uid);
    return true;
  };
  const denied = () => Promise.reject(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
  const ref = p => ({
    set: v => { if (!allowed(p, v, window.__uid)) return denied(); if (v == null) delete db[p]; else db[p] = v; return Promise.resolve(); },
    update: o => Promise.resolve(),
    once: () => Promise.resolve({ val: () => get(p) }),
    on: () => {}, off: () => {},
    transaction: fn => Promise.resolve({ committed: false, snapshot: { val: () => null } }),
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
    const T = 'track_locktest1234';
    // A finished night with one Driven-linked driver, ready to share.
    const setup = (uid, role, key) => page.evaluate(([uid, role, key, T]) => {
      window.__uid = uid; window.__alerts = [];
      S.track.id = T; S.track.name = 'Lock Speedway'; S.demo = false; S.resultsKey = key || undefined;
      if (!S.roster.some(d => d.id === 'drvL')) S.roster.push({ id: 'drvL', name: 'Casey Rivera', num: '47', profileId: 'prof_abc123xyz' });
      S.history = [{ date: '2026-10-18', classes: [{ name: 'Junior 80cc', featureFinish: [{ driverId: 'drvL', name: 'Casey Rivera', num: '47', fin: 1 }], points: [{ driverId: 'drvL', pts: 50 }] }], published: false }];
      setDeviceRole(role); persistLocal();
    }, [uid, role, key, T]);
    const share = async () => { await page.evaluate(() => shareResultsWithDriven(0)); await page.waitForTimeout(300); };
    const rowPath = 'results/' + T + '/2026-10-18/' + 'Junior 80cc' + '/drvL';
    const db = () => page.evaluate(() => Object.assign({}, window.__db));

    // --- the track's admin device shares first: makes the key, registers, publishes
    await setup('adminA', 'admin');
    await share();
    let d = await db();
    const key = await page.evaluate(() => S.resultsKey);
    const rowKey = Object.keys(d).find(k => k.startsWith('results/' + T + '/'));
    check('admin device makes a 32-character results key and keeps it', /^[a-f0-9]{32}$/.test(key || '') && d['resultsKey/' + T] === key, String(key));
    check('…registers itself as the track\'s results device', d['resultsWriter/' + T + '/adminA'] === key);
    check('…and the results reach Driven', !!rowKey && d[rowKey].position === 1, rowKey);
    check('…plus the driver\'s track index', !!d['profileTracks/prof_abc123xyz/' + T]);
    check('…with the success message', await page.evaluate(() => window.__alerts.some(a => /Results shared/.test(a))));
    check('the key never syncs (not in SYNC_FIELDS)', await page.evaluate(() => !SYNC_FIELDS.some(f => /resultsKey/.test(f))));

    // --- another device, same track, no key (a second admin device, or an attacker's copy)
    await page.evaluate(k => { window.__db[k].position = 1; }, rowKey);
    await setup('otherB', 'admin');
    await page.evaluate(() => { S.history[0].classes[0].featureFinish[0].fin = 9; });
    await share();
    d = await db();
    check('a device without the key cannot take over the track', d['resultsKey/' + T] === key && !d['resultsWriter/' + T + '/otherB']);
    check('…its results do not overwrite the real ones', d[rowKey].position === 1, JSON.stringify(d[rowKey]));
    check('…and it says why', await page.evaluate(() => window.__alerts.some(a => /can't publish this track's results/.test(a))), JSON.stringify(await page.evaluate(() => window.__alerts)));

    // --- a direct write from a signed-in but unregistered device
    const direct = await page.evaluate(p => firebase.database().ref(p).set({ profileId: 'prof_abc123xyz', name: 'Fake', num: '1', position: 1 }).then(() => 'written', () => 'denied'), rowPath);
    check('a direct write to results/ is refused', direct === 'denied');

    // --- a replacement device restored from backup (has the key)
    await setup('newC', 'admin', key);
    await page.evaluate(() => { S.history[0].classes[0].featureFinish[0].fin = 9; });
    await share();
    d = await db();
    check('a device with the key (restored backup) registers and publishes', !!d['resultsWriter/' + T + '/newC'] && d[rowKey].position === 9, JSON.stringify(d[rowKey]));

    // --- a non-admin device on a brand-new track never claims it
    await page.evaluate(() => { window.__uid = 'regD'; S.track.id = 'track_brandnew0001'; S.resultsKey = undefined; setDeviceRole('register'); persistLocal(); });
    const claimed = await page.evaluate(() => resultsJoin(deviceRole() === 'admin'));
    d = await db();
    check('a registration device never claims an unclaimed track', claimed === false && !d['resultsKey/track_brandnew0001']);

    // --- demo nights never touch Firebase
    const before = Object.keys(await db()).length;
    await page.evaluate(() => { window.__uid = 'demoE'; S.demo = true; S.track.id = 'track_demo00000001'; S.resultsKey = undefined; setDeviceRole('admin'); });
    await page.evaluate(() => { S.history[0].published = false; shareResultsWithDriven(0); });
    await page.waitForTimeout(300);
    check('a demo night writes nothing', Object.keys(await db()).length === before);
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${fail ? '❌' : '✅'} results-lock: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
