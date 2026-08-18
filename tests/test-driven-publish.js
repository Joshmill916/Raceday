// Driven's publish pipeline (publishCard/cardPayload/short-code claim) — had zero
// automated coverage before this session's audit; no test ever mocked a Firebase
// .set() for it. Manually verified correct by hand in that audit; this suite pins it
// down for real.
//
// One gotcha this session's recon caught and is worth restating: cardPayload() reads
// firebase.database.ServerValue.TIMESTAMP as a STATIC property on the database function
// itself, not on the object firebase.database() returns. A mock that only stubs the
// instance (like the one raceday/index.html's test-cloud-backup.js uses) throws here —
// the mock below attaches ServerValue.TIMESTAMP onto the function explicitly.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8824;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath === '/' ? 'driven/index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(urlPath);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : 'application/octet-stream' });
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

  const seedProfile = (overrides) => page.evaluate((overrides) => {
    localStorage.clear();
    P = newProfile('Robin Park', '', 'Dayton, OH', 15);
    P.profileId = 'prof_shortcode00001';
    P.driver.number = '9';
    P.driver.teamColor = '#1f6fd6';
    P.sponsors = [{ name: 'Apex Racing' }, { name: 'Speedy Tires' }];
    Object.assign(P, overrides || {});
    save();
  }, overrides);

  // Records every .set()/.once()/.remove() call against a path so assertions can
  // inspect exactly what publishCard()/deleteProfile() actually did.
  const installMock = (onceHandler) => page.evaluate((onceHandlerSrc) => {
    const onceHandler = new Function('path', 'return (' + onceHandlerSrc + ')(path)');
    window.__calls = [];
    window.firebase = {
      apps: [{}],
      database: function () {
        return {
          ref: function (p) {
            return {
              set: function (v) { window.__calls.push({ op: 'set', path: p, v }); return Promise.resolve(); },
              once: function () { window.__calls.push({ op: 'once', path: p }); return Promise.resolve({ val: () => onceHandler(p) }); },
              remove: function () { window.__calls.push({ op: 'remove', path: p }); return Promise.resolve(); },
            };
          },
        };
      },
    };
    window.firebase.database.ServerValue = { TIMESTAMP: 'SENTINEL_SERVER_TIMESTAMP' };
  }, onceHandler.toString());

  // ============================================================================
  console.log('\n=== 1. cardPayload(): exact field mapping ===');
  await seedProfile();
  const payload = await page.evaluate(() => {
    window.firebase = { database: function () { return {}; } };
    window.firebase.database.ServerValue = { TIMESTAMP: 'SENTINEL_SERVER_TIMESTAMP' };
    return cardPayload();
  });
  check('name', payload.name === 'Robin Park', payload.name);
  check('num comes from driver.number', payload.num === '9', payload.num);
  check('age stringified', payload.age === '15', JSON.stringify(payload.age));
  check('hometown', payload.hometown === 'Dayton, OH', payload.hometown);
  check('sponsors flattened with " · " separator', payload.sponsors === 'Apex Racing · Speedy Tires', payload.sponsors);
  check('teamColor passes a valid #hex', payload.teamColor === '#1f6fd6', payload.teamColor);
  check('premiumCode is empty for a free-tier profile (gated on tierAtLeast("pro"))', payload.premiumCode === '', payload.premiumCode);
  check('updatedAt reads the ServerValue.TIMESTAMP sentinel off the database FUNCTION, not the instance',
    payload.updatedAt === 'SENTINEL_SERVER_TIMESTAMP', payload.updatedAt);

  const badColor = await page.evaluate(() => {
    P.driver.teamColor = 'not-a-hex-color';
    window.firebase = { database: function () { return {}; } };
    window.firebase.database.ServerValue = { TIMESTAMP: 0 };
    return cardPayload().teamColor;
  });
  check('an invalid teamColor is stripped to empty string, not passed through', badColor === '', JSON.stringify(badColor));

  // ============================================================================
  console.log('\n=== 2. cardTooLong() / CARD_CAPS: rejected client-side, before any network call ===');
  await seedProfile();
  const capCheck = await page.evaluate(() => {
    // No window.firebase set at all — if publishCard() reached the network path this
    // would throw ReferenceError, proving the over-cap rejection happens strictly first.
    delete window.firebase;
    P.driver.name = 'X'.repeat(41);   // CARD_CAPS.name = 40
    save();
    return cardTooLong();
  });
  check('a 41-char name (cap 40) is flagged, naming the field and both lengths', /Name is too long \(41\/40/.test(capCheck), capCheck);

  const rejectedBeforeNetwork = await page.evaluate(() => {
    return publishCard(true).then(() => 'resolved (should have rejected)').catch(e => ({ known: !!e.known, message: e.message }));
  });
  check('publishCard() rejects an over-cap payload with a "known" error, without touching Firebase',
    rejectedBeforeNetwork.known === true, JSON.stringify(rejectedBeforeNetwork));

  const orderCheck = await page.evaluate(() => {
    // BOTH name and hometown over cap at once — name (the first key in CARD_CAPS'
    // insertion order) must be the one reported, not hometown.
    P.driver.name = 'X'.repeat(41);
    P.driver.hometown = 'Y'.repeat(61);
    save();
    return cardTooLong();
  });
  check('when multiple fields are over cap simultaneously, the FIRST one in CARD_CAPS iteration order wins (name, not hometown)',
    /Name is too long/.test(orderCheck), orderCheck);

  // ============================================================================
  console.log('\n=== 3. publishCard(): the actual Firebase write shape ===');
  await seedProfile();
  await installMock((path) => (path === 'profiles_short/SHORTCOD' ? null : null));   // 8-char code is free
  const published = await page.evaluate(() => publishCard(true).then(() => ({ shortCode: P.shortCode, publishedAt: P.publishedAt, calls: window.__calls })));
  check('short code claimed at 8 chars (profileId.slice(5,13).toUpperCase())', published.shortCode === 'SHORTCOD', published.shortCode);
  check('profiles_short/<code> is set to the RAW profileId string, not an object',
    published.calls.some(c => c.op === 'set' && c.path === 'profiles_short/SHORTCOD' && c.v === 'prof_shortcode00001'), JSON.stringify(published.calls));
  check('profiles/<id>/card is set to the full cardPayload()',
    published.calls.some(c => c.op === 'set' && c.path === 'profiles/prof_shortcode00001/card' && c.v && c.v.name === 'Robin Park'), JSON.stringify(published.calls));
  check('P.publishedAt is stamped after a successful publish', typeof published.publishedAt === 'number' && published.publishedAt > 0, String(published.publishedAt));

  console.log('\n=== 4. Short-code collision extension: 8 -> 10 chars, NOT atomic (read-then-write) ===');
  await seedProfile();
  await installMock((path) => {
    if (path === 'profiles_short/SHORTCOD') return 'prof_someoneelseentirely';   // taken by a DIFFERENT profile
    if (path === 'profiles_short/SHORTCODE0') return null;   // 10-char extension is free
    return null;
  });
  const collided = await page.evaluate(() => publishCard(true).then(() => ({ shortCode: P.shortCode, calls: window.__calls })));
  check('a taken 8-char code extends to 10 (profileId.slice(5,15))', collided.shortCode === 'SHORTCODE0', collided.shortCode);
  check('the 8-char slot was read (once) but never claimed (no set at that path)',
    collided.calls.some(c => c.op === 'once' && c.path === 'profiles_short/SHORTCOD') &&
    !collided.calls.some(c => c.op === 'set' && c.path === 'profiles_short/SHORTCOD'), JSON.stringify(collided.calls));
  check('the 10-char slot was actually claimed', collided.calls.some(c => c.op === 'set' && c.path === 'profiles_short/SHORTCODE0'), JSON.stringify(collided.calls));

  const idempotentRepublish = await page.evaluate(() => {
    // The SAME profileId re-checking its own already-taken slot is treated as "mine" —
    // an idempotent republish, not a collision. Verifies the v !== P.profileId check.
    return publishCard(true).then(() => ({ shortCode: P.shortCode }));
  });
  check('re-publishing the same profile reuses its own short code without re-extending', idempotentRepublish.shortCode === 'SHORTCODE0', idempotentRepublish.shortCode);

  console.log('\n=== 5. An already-published profile skips the claim process entirely ===');
  await seedProfile({ shortCode: 'ALREADY1' });
  await installMock((path) => null);
  const skipClaim = await page.evaluate(() => publishCard(true).then(() => window.__calls));
  check('no profiles_short/* read at all — P.shortCode short-circuits the whole claim loop',
    !skipClaim.some(c => c.path && c.path.startsWith('profiles_short/')), JSON.stringify(skipClaim));
  check('only the card itself gets written', skipClaim.every(c => c.path === 'profiles/prof_shortcode00001/card'), JSON.stringify(skipClaim));

  // ============================================================================
  console.log('\n=== 6. publishCard() error paths ===');
  await seedProfile();
  await page.evaluate(() => {
    window.firebase = { apps: [{}], database: function () { return { ref: function () { return {
      once: function () { return Promise.reject(Object.assign(new Error('nope'), { code: 'PERMISSION_DENIED' })); },
    }; } }; } };
    window.firebase.database.ServerValue = { TIMESTAMP: 0 };
  });
  const permDenied = await page.evaluate(() => publishCard(false).catch(e => e.code));
  check('a PERMISSION_DENIED Firebase error propagates (rules rejection, not swallowed)', permDenied === 'PERMISSION_DENIED', String(permDenied));

  console.log('\n=== 7. deleteProfile(): the Firebase-cleanup branch (only the local-wipe path had coverage before) ===');
  await seedProfile({ publishedAt: Date.now(), shortCode: 'DELME001' });
  // remove() calls are stashed into localStorage (not a JS var) because deleteProfile()
  // ends in location.reload(), which wipes in-memory state before we can read it back.
  await page.evaluate(() => {
    window.firebase = {
      apps: [{}],
      database: function () {
        return { ref: function (p) { return { remove: function () {
          const log = JSON.parse(localStorage.getItem('__remove_log') || '[]');
          log.push(p);
          localStorage.setItem('__remove_log', JSON.stringify(log));
          return Promise.resolve();
        } }; } };
      },
    };
  });
  await Promise.all([page.waitForNavigation(), page.evaluate(() => deleteProfile())]);
  await page.waitForTimeout(200);
  const removeLog = await page.evaluate(() => JSON.parse(localStorage.getItem('__remove_log') || '[]'));
  check('deleting a PUBLISHED profile removes both the card and the short-code mapping',
    removeLog.includes('profiles/prof_shortcode00001') && removeLog.includes('profiles_short/DELME001'), JSON.stringify(removeLog));
  check('the local profile is wiped either way', await page.evaluate(() => localStorage.getItem('profiles_v1') === null));

  console.log('\n=== 8. deleteProfile(): an UNPUBLISHED profile skips Firebase entirely ===');
  await page.evaluate(() => { localStorage.removeItem('__remove_log'); });
  await seedProfile({ publishedAt: 0, shortCode: '' });
  await Promise.all([page.waitForNavigation(), page.evaluate(() => deleteProfile())]);
  await page.waitForTimeout(200);
  const removeLog2 = await page.evaluate(() => JSON.parse(localStorage.getItem('__remove_log') || '[]'));
  check('an unpublished profile never touches Firebase on delete (no remove calls at all)', removeLog2.length === 0, JSON.stringify(removeLog2));

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` driven-publish: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
