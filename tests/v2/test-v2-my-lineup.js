// v2: "My lineup" — every driver gets their own lineup on their phone. The sign-up screen (and
// the driver card, for staff) shows a QR / link: the spectator link plus &me=<driverId>. It opens
// the read-only guest view already following that driver, with a "My night" card built from the
// running order: each race's starting spot, and On track now / Up next / N races away / Finished.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8842;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url.split('?')[0] === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const base = `http://localhost:${PORT}/`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  // Hermetic: localhost only, and a fake Firebase whose room snapshot the test controls.
  // The snapshot arrives 600 ms late, like a real guest's first sync.
  const newPage = async (room) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await page.addInitScript((room) => {
      window.__room = room; window.__cbs = [];
      window.__push = v => { window.__room = v; window.__cbs.forEach(cb => cb({ val: () => v })); };
      window.firebase = {
        apps: [{}],
        database: () => ({
          ref: (p) => ({
            on: (ev, cb) => {
              if (String(p).indexOf('tracks/') !== 0) { cb({ val: () => true }); return; }
              window.__cbs.push(cb);
              setTimeout(() => cb({ val: () => window.__room }), 600);
            },
            off: () => {}, once: () => Promise.resolve({ val: () => null }),
            update: () => Promise.resolve(), set: () => Promise.resolve(), remove: () => Promise.resolve(),
          }),
        }),
      };
    }, room);
    return { ctx, page };
  };

  // ---------------------------------------------------------------- the track's own device
  const { ctx: adminCtx, page: admin } = await newPage(null);
  await admin.goto(base); await admin.waitForTimeout(400);
  await admin.evaluate(() => {
    closeSheet(); localStorage.removeItem('rd_role_v2');
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20 }, { id: 2, name: 'Stock', maxPill: 20, heats: 1 }];
    S.settings.maxHeat = 4; S.settings.maxFeature = 20; S.settings.gridStyle = 'double';
    S.roster = []; S.history = [];
    S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    for (let i = 1; i <= 8; i++) { S.roster.push({ id: 1000 + i, name: 'Driver ' + i, num: String(i * 10) }); S.raceDay.entries.push({ driverId: 1000 + i, classId: 1, pill: i }); }
    for (let i = 1; i <= 3; i++) { S.roster.push({ id: 2000 + i, name: 'Stock ' + i, num: String(100 + i) }); S.raceDay.entries.push({ driverId: 2000 + i, classId: 2, pill: i }); }
    S.raceDay.entries.push({ driverId: 1003, classId: 2, pill: 4 });   // Driver 3 races two classes
    S.sync = { enabled: false, key: '' };
    save(); setDeviceRole('admin'); applyRole();
  });

  console.log('\n— Sign-up screen —');
  const showDone = () => admin.evaluate(() => {
    const d = driverById(1003);
    signupDone = { driver: d, drawn: [{ cls: classById(1), pill: 3 }, { cls: classById(2), pill: 4 }] };
    nav('signup');
    const cv = document.getElementById('myLineupQR');
    let inked = false;
    if (cv) { const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < px.length; i += 4) if (px[i] < 100) { inked = true; break; } }
    return { qr: !!cv, inked, text: document.getElementById('signupWrap') ? document.getElementById('signupWrap').textContent : document.body.textContent };
  });
  {
    const off = await showDone();
    check('with sync off, there is no QR code', !off.qr);
    check('…and the admin is told to turn on sync so drivers get one', /Turn on Multi-device sync/.test(off.text));
    await admin.evaluate(() => { S.sync = { enabled: true, key: 'MYROOM', staffKey: 'SECRETSTAFF' }; save(); });
    const on = await showDone();
    check('with sync on, the "You\'re on the grid" screen shows a lineup QR code', on.qr && on.inked);
    check('…with the "Your lineup on your phone" card', /Your lineup on your phone/.test(on.text));
    const link = await admin.evaluate(() => myLineupLink(1003));
    const u = new URL(link);
    check('the link is the spectator link for this room + the driver', u.searchParams.get('sync') === 'MYROOM' && u.searchParams.get('role') === 'viewer' && u.searchParams.get('me') === '1003', link);
    check('the link never carries the staff key', !/st=|SECRETSTAFF/.test(link), link);
    await admin.evaluate(() => { signupDone = null; });
  }

  console.log('\n— Driver card (staff) —');
  {
    const card = await admin.evaluate(() => { openDriverCard(1003); const f = document.getElementById('sheetFoot').textContent; return f; });
    check('a staff device gets a "Lineup link" button on the driver card', /Lineup link/.test(card), card);
    const sheet = await admin.evaluate(() => { showMyLineup(1003); const t = document.getElementById('sheetBody').textContent; const qr = !!document.getElementById('myLineupQR'); closeSheet(); return { t, qr }; });
    check('it opens the QR code to show the driver again later', sheet.qr && /Your lineup on your phone/.test(sheet.t));
    const notEntered = await admin.evaluate(() => { S.roster.push({ id: 3001, name: 'Not Here', num: '99' }); openDriverCard(3001); const f = document.getElementById('sheetFoot').textContent; closeSheet(); S.roster.pop(); return f; });
    check('a driver not entered tonight gets no lineup link', !/Lineup link/.test(notEntered));
  }

  // The room as Firebase would hold it: one JSON string per synced field.
  const roomOf = () => admin.evaluate(() => {
    const v = {};
    SYNC_FIELDS.forEach(f => { const ks = f.split('/'); let o = v; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = JSON.stringify(syncGet(f) === undefined ? null : syncGet(f)); });
    return v;
  });
  const order = await admin.evaluate(() => {
    const lm = heatSet(classRacers(1), classById(1)), st = heatSet(classRacers(2), classById(2));
    const hi = lm.findIndex(h => h.some(r => r.id === 1003));
    return { hi, s1: lm[hi].findIndex(r => r.id === 1003) + 1, s2: [...lm[hi]].reverse().findIndex(r => r.id === 1003) + 1, stock: st[0].findIndex(r => r.id === 1003) + 1, heats: lm.length };
  });

  // ---------------------------------------------------------------- the driver's phone
  console.log('\n— The driver\'s phone opens their lineup —');
  const { ctx: phoneCtx, page: phone } = await newPage(await roomOf());
  await phone.goto(base + '?sync=MYROOM&role=viewer&me=1003');
  await phone.waitForTimeout(150);
  const early = await phone.evaluate(() => ({ guest: GUEST, role: deviceRole(), follow: UI.followId, text: document.getElementById('gridWrap').textContent }));
  check('the link opens the read-only guest view', early.guest && early.role === 'viewer', JSON.stringify(early));
  check('it is already following the driver before the roster arrives', early.follow === 1003, early.follow);
  await phone.waitForTimeout(900);
  const card = () => phone.evaluate(() => {
    const el = document.querySelector('#gridWrap .my-night');
    return { has: !!el, text: el ? el.textContent : '', cls: el ? el.querySelectorAll('.mn-cls').length : 0, url: location.search, follow: UI.followId };
  });
  let c = await card();
  check('once the roster lands, the "My night" card shows the driver', c.has && /Driver 3/.test(c.text), c.text.slice(0, 120));
  check('the link params are cleared from the address bar', c.url === '', c.url);
  check('a driver in two classes gets a section for each', c.cls === 2, c.cls);
  check('each heat shows the starting spot (set 1 as drawn)', new RegExp('Heat ' + (order.hi + 1) + ' · Set 1Start P' + order.s1 + ' ').test(c.text), c.text);
  check('…and set 2 reversed', new RegExp('Heat ' + (order.hi + 1) + ' · Set 2Start P' + order.s2 + ' ').test(c.text), c.text);
  check('row and inside/outside are shown', /Row \d (inside|outside)/.test(c.text));
  check('the Stock heat is listed too', new RegExp('Heat 1Start P' + order.stock + ' ').test(c.text), c.text);
  check('the feature says its lineup posts once the heats are in', /Lineup posts once the heats are in/.test(c.text));
  const firstRace = order.hi === 0;
  check('the first race of the night says "On track now" or a count of races away', firstRace ? /On track now/.test(c.text) : /Up next|races away/.test(c.text), c.text);
  check('nothing is writable', await phone.evaluate(() => canWrite() === false && adminOk() === false));

  console.log('\n— Live as the night runs —');
  // Score races on the tower and push the room after each, like sync does.
  const scoreUntil = (stopAtDriverRace) => admin.evaluate((stop) => {
    const open = raceOrder().filter(r => r.ready && !r.done);
    for (const r of open) {
      if (stop && r.grid.some(g => g.id === 1003)) break;
      const res = getRes(r.cls.id); r.grid.forEach((g, i) => { res[r.key(g)] = i + 1; });
    }
    save();
  }, stopAtDriverRace);
  await scoreUntil(true);
  await phone.evaluate(v => window.__push(v), await roomOf()); await phone.waitForTimeout(200);
  c = await card();
  check('when every race before theirs is in, their race is "On track now"', /On track now/.test(c.text), c.text);
  check('the header line names their next race', /Next: .*On track now/.test(c.text), c.text);
  await admin.evaluate(() => { const r = raceOrder().filter(r => r.ready && !r.done)[0]; const res = getRes(r.cls.id); r.grid.forEach((g, i) => { res[r.key(g)] = i + 1; }); save(); });
  await phone.evaluate(v => window.__push(v), await roomOf()); await phone.waitForTimeout(200);
  c = await card();
  check('a scored race shows their finish', /Finished P\d/.test(c.text), c.text);
  check('the class shows its heat total once a heat is scored', /Heat total \d+/.test(c.text), c.text);
  await scoreUntil(false);   // every heat in → features line up
  await phone.evaluate(v => window.__push(v), await roomOf()); await phone.waitForTimeout(200);
  c = await card();
  const featSpot = await admin.evaluate(() => featureGridOrder(featureData(1), 1).findIndex(r => r.id === 1003) + 1);
  check('once the heats are in, the feature shows their starting spot', new RegExp('FeatureStart P' + featSpot + ' ').test(c.text), c.text);
  await scoreUntil(false);   // features scored
  await phone.evaluate(v => window.__push(v), await roomOf()); await phone.waitForTimeout(200);
  c = await card();
  check('after the feature, tonight\'s points show', /\d+ pts tonight/.test(c.text), c.text);
  check('with everything in, no race says it is coming up', !/On track now|Up next|races away/.test(c.text), c.text);

  console.log('\n— Remembered on the phone —');
  await phone.goto(base + '?sync=MYROOM&role=viewer'); await phone.waitForTimeout(900);
  c = await card();
  check('scanning the plain fan QR later still follows the same driver at this track', c.follow === 1003 && c.has, JSON.stringify(c.follow));
  await phone.evaluate(() => unfollowDriver());
  await phone.goto(base + '?sync=MYROOM&role=viewer'); await phone.waitForTimeout(900);
  check('unfollowing is remembered too', (await card()).follow === null);
  const other = await phone.evaluate(() => localStorage.getItem('rd_follow'));
  check('a guest never writes the device-wide follow key', other === null, other);
  await phone.goto(base + '?sync=MYROOM&role=viewer&me=99999'); await phone.waitForTimeout(900);
  c = await card();
  check('a link for a driver not on the roster is dropped once the roster is in', c.follow === null && !c.has, JSON.stringify(c.follow));

  console.log('\n— A me= link cannot change what a device does —');
  await phone.goto(base + '?sync=MYROOM&role=admin&me=1003'); await phone.waitForTimeout(700);
  const esc = await phone.evaluate(() => ({ role: deviceRole(), write: canWrite(), admin: adminOk() }));
  check('me= on a non-viewer link grants nothing (no staff key, no admin)', esc.admin === false && esc.write === false, JSON.stringify(esc));

  check('no page errors', errs.length === 0, errs.join(' | '));
  await adminCtx.close(); await phoneCtx.close();
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
