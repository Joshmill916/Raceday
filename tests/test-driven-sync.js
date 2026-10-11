// Driven multi-copy safety: restore-by-code must bring back EVERY published field, a
// second copy of a profile must pull a newer published card on open instead of later
// republishing stale settings over it, and ?restore=CODE must restore a fresh device.
// Regression for a real report: an http:// bookmark opened an empty Driven, the restored
// copy lacked accent colors/bio/header, and its next save overwrote the real card.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8831;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('photo-bytes').toString('base64');
const HEADER = 'data:image/jpeg;base64,' + Buffer.from('header-bytes').toString('base64');
const PID = 'prof_synctest0001';
const card = (over) => Object.assign({
  name: 'Robin Park', num: '9', age: '15', hometown: 'Dayton, OH', sponsors: 'Apex Racing · Speedy Tires',
  teamColor: '#d62828', teamColor2: '#f6c90e', teamColor3: '#1d6fd6', photo: PHOTO, header: HEADER,
  aliases: 'The Kid', bio: 'Third-generation racer.', highlights: '2025 champion', crew: 'Dan (crew chief), Mia (spotter)',
  premiumCode: '', updatedAt: 2000000000000,
}, over || {});

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath === '/' ? 'driven/index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(urlPath) === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());
  const base = `http://localhost:${PORT}/`;
  await page.goto(base + 'driven/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // Firebase stand-in: once() answers from a path→value table; set() calls are recorded.
  const installMock = (table) => page.evaluate((table) => {
    window.__sets = [];
    window.firebase = {
      apps: [{}],
      database: function () {
        return { ref: function (p) { return {
          set: function (v) { window.__sets.push({ path: p, v }); return Promise.resolve(); },
          once: function () { return Promise.resolve({ val: () => (p in table ? table[p] : null) }); },
          remove: function () { return Promise.resolve(); },
        }; } };
      },
    };
    window.firebase.database.ServerValue = { TIMESTAMP: 'TS' };
  }, table);

  // ============================================================================
  console.log('\n=== 1. restoreFromLinkCode(): every published field comes back ===');
  await page.evaluate(() => { localStorage.clear(); P = null; });
  const proCode = await page.evaluate((pid) => localPremiumCode(pid), PID);
  await installMock({ 'profiles_short/SYNCTEST': PID, ['profiles/' + PID + '/card']: card({ premiumCode: proCode }), ['profileTracks/' + PID]: null });
  await page.evaluate(() => restoreFromLinkCode('SYNCTEST', true));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ d: P.driver, sponsors: P.sponsors.map(s => s.name), crew: P.crew.map(c => c.name), tier: P.tier, id: P.profileId, code: P.shortCode,
    stored: !!localStorage.getItem('profiles_v1') }));
  check('restored onto the published profileId + code', r.id === PID && r.code === 'SYNCTEST', JSON.stringify([r.id, r.code]));
  check('accent colors restored', r.d.teamColor === '#d62828' && r.d.teamColor2 === '#f6c90e' && r.d.teamColor3 === '#1d6fd6', JSON.stringify([r.d.teamColor, r.d.teamColor2, r.d.teamColor3]));
  check('photo and header restored', r.d.photo === PHOTO && r.d.header === HEADER);
  check('bio, highlights, nickname restored', r.d.bio === 'Third-generation racer.' && r.d.highlights === '2025 champion' && r.d.aliases === 'The Kid');
  check('sponsors and crew restored', r.sponsors.join('|') === 'Apex Racing|Speedy Tires' && r.crew.join('|') === 'Dan (crew chief)|Mia (spotter)', JSON.stringify([r.sponsors, r.crew]));
  check('Pro restored from a valid owner code', r.tier === 'pro');
  check('restore did not republish (no card write)', (await page.evaluate(() => window.__sets.length)) === 0);
  check('saved on the device', r.stored);

  // ============================================================================
  console.log('\n=== 2. syncFromPublished(): a newer card updates a stale copy, locally ===');
  await page.evaluate((pid) => {
    localStorage.clear();
    P = newProfile('Robin Park', '', 'Old Town', 15);
    P.profileId = pid; P.shortCode = 'SYNCTEST'; P.publishedAt = 1000000000000;   // published long ago
    P.driver.teamColor = '#000000'; P.driver.bio = 'stale bio';
    localStorage.setItem('profiles_v1', JSON.stringify(P));
  }, PID);
  await installMock({ ['profiles/' + PID + '/card']: card() });
  const synced = await page.evaluate(() => syncFromPublished());
  const s2 = await page.evaluate(() => ({ d: P.driver, pub: P.publishedAt, stored: JSON.parse(localStorage.getItem('profiles_v1')).driver.bio, sets: window.__sets.length }));
  check('newer card was applied', synced === true && s2.d.bio === 'Third-generation racer.' && s2.d.teamColor2 === '#f6c90e' && s2.d.hometown === 'Dayton, OH', JSON.stringify([synced, s2.d.bio]));
  check('publishedAt advanced to the card time (no re-sync loop)', s2.pub === 2000000000000, s2.pub);
  check('persisted to localStorage', s2.stored === 'Third-generation racer.');
  check('sync never republishes', s2.sets === 0, s2.sets);

  console.log('\n=== 3. syncFromPublished(): this device published last → untouched ===');
  await page.evaluate(() => { P.publishedAt = 2000000000000; P.driver.bio = 'my newer local edit'; localStorage.setItem('profiles_v1', JSON.stringify(P)); });
  await installMock({ ['profiles/' + PID + '/card']: card({ bio: 'older card bio', updatedAt: 2000000002000 }) });   // within 5s slack
  const notSynced = await page.evaluate(() => syncFromPublished());
  check('card within the slack window is ignored', notSynced === false && (await page.evaluate(() => P.driver.bio)) === 'my newer local edit');
  await installMock({ ['profiles/' + PID + '/card']: card({ bio: 'way older', updatedAt: 1500000000000 }) });
  check('an older card is ignored', (await page.evaluate(() => syncFromPublished())) === false && (await page.evaluate(() => P.driver.bio)) === 'my newer local edit');
  await page.evaluate(() => { P.publishedAt = 0; });
  check('an unpublished copy never syncs', (await page.evaluate(() => syncFromPublished())) === false);

  console.log('\n=== 4. Older card without the newer fields leaves them alone ===');
  await page.evaluate(() => { P.publishedAt = 1000; P.driver.bio = 'keep me'; P.driver.teamColor2 = '#123456'; });
  const legacy = card({ updatedAt: 2100000000000 }); delete legacy.bio; delete legacy.teamColor2;
  await installMock({ ['profiles/' + PID + '/card']: legacy });
  await page.evaluate(() => syncFromPublished());
  check('missing keys on the card do not wipe local values', (await page.evaluate(() => P.driver.bio)) === 'keep me' && (await page.evaluate(() => P.driver.teamColor2)) === '#123456');

  // ============================================================================
  console.log('\n=== 5. ?restore=CODE on a fresh device ===');
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto(base + 'driven/index.html?restore=SYNCTEST', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  // The page booted with no profile and tried a real Firebase restore; re-run against the mock.
  await installMock({ 'profiles_short/SYNCTEST': PID, ['profiles/' + PID + '/card']: card(), ['profileTracks/' + PID]: null });
  await page.evaluate(() => { P = null; history.replaceState(null, '', location.pathname + '?restore=SYNCTEST'); handleRestoreParam(); });
  await page.waitForTimeout(400);
  const r5 = await page.evaluate(() => ({ id: P && P.profileId, url: location.search, bio: P && P.driver.bio }));
  check('profile restored from the link', r5.id === PID && r5.bio === 'Third-generation racer.', JSON.stringify(r5));
  check('restore param stripped from the URL', r5.url === '', r5.url);

  console.log('\n=== 6. No "move my profile" banner on a secure/local origin ===');
  check('offerSecureMove() is a no-op off http://victoryraceday.com', await page.evaluate(() => { offerSecureMove(); return !document.querySelector('[onclick="moveToSecure()"]'); }));

  console.log(`\n${fail ? '❌' : '✅'} driven-sync: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
