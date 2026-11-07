// Driven: more than one driver on one phone (a parent signing up their kids). Free.
// Invariants: a one-driver phone is exactly what it always was (no family key); adding a
// driver keeps the first one whole (its own profileId, card, link code, results) and both
// switch back and forth; restoring a driver by link code ADDS it instead of replacing the
// open one, and refuses a driver already on the phone; deleting one driver keeps the others.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8846;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights/, r => r.abort());
  const base = `http://localhost:${PORT}/`;
  await page.goto(base + 'driven/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const settle = () => page.waitForTimeout(250);
  const mock = (table) => page.evaluate((table) => {
    window.__db = Object.assign({}, table);
    window.firebase = { apps: [{}], database: function () { return { ref: function (p) { return {
      set: function (v) { window.__db[p] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
      once: function () { return Promise.resolve({ val: () => (p in window.__db ? window.__db[p] : null) }); },
      remove: function () { delete window.__db[p]; return Promise.resolve(); },
    }; } }; } };
    window.firebase.database.ServerValue = { TIMESTAMP: 1 };
  }, table);

  console.log('\n=== 1. One driver: unchanged ===');
  await page.evaluate(() => {
    localStorage.clear();
    $id('obName').value = 'Kaden Harper'; $id('obHometown').value = 'Delta, OH';
    completeOnboarding();
  });
  await settle();
  const one = await page.evaluate(() => ({ fam: localStorage.getItem('profiles_family_v1'), bar: $id('familyBar').style.display, name: P.driver.name, id: P.profileId }));
  check('first driver created', one.name === 'Kaden Harper');
  check('no family key for one driver', one.fam === null);
  check('no driver bar for one driver', one.bar === 'none');
  await page.evaluate(() => nav('settings'));
  check('settings offers "Add another driver"', await page.evaluate(() => /Add another driver/.test($id('page-settings').innerHTML)));

  console.log('\n=== 2. Add a second driver ===');
  await page.evaluate(() => {
    P.raceResults.push({ date: '2026-11-07', trackId: 't1', trackName: 'T', class: 'Junior', position: 1, points: 10, source: 'raceday' });
    P.shortCode = 'KADEN123'; localStorage.setItem('profiles_v1', JSON.stringify(P));
    openAddDriver();
  });
  const modal = await page.evaluate(() => ({ shown: $id('onboardModal').style.display, title: $id('obTitle').textContent, cancel: $id('obCancel').style.display, name: $id('obName').value }));
  check('add-driver form opens', modal.shown === 'flex' && modal.title === 'Add another driver');
  check('form has Cancel and is empty', modal.cancel === '' && modal.name === '');
  await page.evaluate(() => closeAddDriver());
  check('Cancel keeps the open driver', await page.evaluate(() => P.driver.name === 'Kaden Harper' && $id('onboardModal').style.display === 'none' && !localStorage.getItem('profiles_family_v1')));
  await page.evaluate(() => { openAddDriver(); $id('obName').value = 'Ky Harper'; completeOnboarding(); });
  await settle();
  const two = await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('profiles_family_v1'));
    const first = f.stash[f.order[0]].p;
    return { open: P.driver.name, openId: P.profileId, order: f.order.length, first: first.driver.name, firstId: first.profileId,
      firstRes: first.raceResults.length, firstCode: first.shortCode, openRes: P.raceResults.length,
      bar: $id('familyBar').style.display, pills: $id('familyBar').querySelectorAll('.ride-pill').length };
  });
  check('new driver is open', two.open === 'Ky Harper');
  check('two drivers on the phone', two.order === 2);
  check('first driver kept whole (id, results, link code)', two.first === 'Kaden Harper' && two.firstId === one.id && two.firstRes === 1 && two.firstCode === 'KADEN123');
  check('new driver has its own id and no results', two.openId !== one.id && two.openRes === 0);
  check('driver bar shows both (+ add)', two.bar === '' && two.pills === 3);

  console.log('\n=== 3. Switch back and forth ===');
  await page.evaluate((id) => switchDriver(id), one.id);
  await settle();
  const sw = await page.evaluate(() => ({ open: P.driver.name, res: P.raceResults.length, stored: JSON.parse(localStorage.getItem('profiles_v1')).driver.name,
    stash: Object.values(JSON.parse(localStorage.getItem('profiles_family_v1')).stash).map(m => m.p.driver.name) }));
  check('switched to first driver with results', sw.open === 'Kaden Harper' && sw.res === 1 && sw.stored === 'Kaden Harper');
  check('second driver waits in the stash', sw.stash.length === 1 && sw.stash[0] === 'Ky Harper');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);
  check('survives reopening the app', await page.evaluate(() => P.driver.name === 'Kaden Harper' && familyOn() && familyMembers().length === 2));

  console.log('\n=== 4. Add by link code ===');
  await mock({ 'profiles_short/LILY7777': 'prof_lilytest0001', 'profiles/prof_lilytest0001/card': { name: 'Lily Tater', num: '7', hometown: 'Fremont', updatedAt: 1 } });
  await page.evaluate(() => { openAddDriver(); restoreFromLinkCode('LILY7777'); });
  await page.waitForTimeout(400);
  const lc = await page.evaluate(() => ({ open: P.driver.name, id: P.profileId, n: familyMembers().length }));
  check('link code adds a third driver', lc.open === 'Lily Tater' && lc.id === 'prof_lilytest0001' && lc.n === 3);
  dialogs.length = 0;
  await page.evaluate(() => { openAddDriver(); restoreFromLinkCode('LILY7777'); });
  await page.waitForTimeout(400);
  check('the same driver is not added twice', await page.evaluate(() => familyMembers().length === 3) && dialogs.some(m => /already on this phone/.test(m)));
  await page.evaluate(() => closeAddDriver());

  console.log('\n=== 5. Delete one driver keeps the others ===');
  await page.evaluate(() => deleteProfile());
  await page.waitForTimeout(900);
  const del = await page.evaluate(() => ({ open: P && P.driver.name, n: familyMembers().length, names: familyMembers().map(m => m.p.driver.name).sort().join(',') }));
  check('two drivers left after deleting Lily', del.n === 2 && del.names === 'Kaden Harper,Ky Harper', JSON.stringify(del));
  check('another driver opens after the delete', del.open === 'Kaden Harper' || del.open === 'Ky Harper');
  await page.evaluate(() => deleteProfile());
  await page.waitForTimeout(900);
  const last = await page.evaluate(() => ({ open: P && P.driver.name, fam: localStorage.getItem('profiles_family_v1'), bar: $id('familyBar').style.display }));
  check('down to one driver: family key gone, bar hidden', !!last.open && last.fam === null && last.bar === 'none');

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
