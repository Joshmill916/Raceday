// Driven rides: one account, a separate card per kind of racing (karts, a late model…).
// Invariants: a one-ride account is exactly what it always was (no new storage key, no new
// card fields); rides need Pro (up to 3) and Pro on the first ride covers every ride; each
// ride has its own profileId, link code, card, results and stats; name/email/hometown/age
// are shared; every ride's card lists all of them; restore (backup or link code) brings
// every ride back; and /d/ shows ride tabs only when the cards list each other.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8838;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const PID = 'prof_ridestest01';
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('photo-bytes').toString('base64');

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
  let dialogs = [], confirmYes = true, promptAnswer = null;
  page.on('dialog', d => {
    dialogs.push(d.message());
    if (d.type() === 'prompt') { if (promptAnswer == null) d.dismiss(); else d.accept(promptAnswer); }
    else if (d.type() === 'confirm' && !confirmYes) d.dismiss(); else d.accept();
  });
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights/, r => r.abort());
  const base = `http://localhost:${PORT}/`;
  await page.goto(base + 'driven/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // Firebase stand-in: once() reads from a path→value table that set()/remove() also update.
  const installMock = (table) => page.evaluate((table) => {
    window.__db = Object.assign({}, table); window.__sets = []; window.__removes = [];
    window.firebase = {
      apps: [{}],
      database: function () {
        return { ref: function (p) { return {
          set: function (v) { window.__sets.push({ path: p, v: JSON.parse(JSON.stringify(v)) }); window.__db[p] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
          once: function () { return Promise.resolve({ val: () => (p in window.__db ? window.__db[p] : null) }); },
          remove: function () {
            window.__removes.push(p); delete window.__db[p];
            sessionStorage.setItem('removes', JSON.stringify(window.__removes));   // survives deleteProfile()'s reload
            return Promise.resolve();
          },
        }; } };
      },
    };
    window.firebase.database.ServerValue = { TIMESTAMP: 1 };
  }, table);
  const settle = () => page.waitForTimeout(250);

  const fresh = (pro) => page.evaluate(({ pid, pro, photo }) => {
    localStorage.clear();
    P = newProfile('Joshua Miller', 'josh@example.com', 'Fort Wayne', 45);
    P.profileId = pid; P.driver.number = '18'; P.driver.photo = photo; P.driver.teamColor = '#b51a00';
    P.raceResults.push({ date: '2026-08-01', trackId: 'rd_t1', trackName: 'RaceDay Park', class: 'Junior', position: 1, points: 25, source: 'raceday', verifiedBy: null });
    if (pro) { P.tier = 'pro'; P.premiumCode = localPremiumCode(pid); }
    ACCT = null;
    localStorage.setItem('profiles_v1', JSON.stringify(P));
    document.getElementById('onboardModal').style.display = 'none';
    nav('settings');
  }, { pid: PID, pro, photo: PHOTO });

  // ============================================================================
  console.log('\n=== 1. A one-ride account is unchanged ===');
  await fresh(false);
  let s1 = await page.evaluate(() => ({ key: localStorage.getItem(RIDES_KEY), bar: document.getElementById('rideBar').style.display, card: cardStrings(), field: ridesCardField(), html: document.getElementById('page-settings').innerHTML }));
  check('no rides storage key', s1.key === null);
  check('no ride switcher', s1.bar === 'none');
  check('no rides/rideLabel on the card', !Object.keys(s1.field).length && s1.card.rides === '' && s1.card.rideLabel === '');
  check('Settings explains rides and that they come with Pro', /Give each one its own ride/.test(s1.html) && /Rides come with <b>Pro<\/b>/.test(s1.html) && !/id="addRideBtn"/.test(s1.html));
  dialogs = [];
  await page.evaluate(() => openAddRide());
  check('free accounts can\'t add a ride', /Rides come with Pro/.test(dialogs[0] || '') && !(await page.isVisible('#rideModal')));

  // ============================================================================
  console.log('\n=== 2. Pro adds a ride ===');
  await fresh(true);
  await installMock({});
  await page.evaluate(() => publishCard(true));
  await settle();
  const code1 = await page.evaluate(() => P.shortCode);
  await page.evaluate(() => nav('settings'));
  await page.click('#addRideBtn');
  check('the add-ride form asks for a name for the current ride too', await page.isVisible('#rideCur') && await page.isVisible('#rideNew'));
  dialogs = [];
  await page.fill('#rideCur', 'Karts');
  await page.fill('#rideNew', 'karts');
  await page.click('#rideSave');
  check('two rides can\'t share a name', /already have a ride called/.test(dialogs[0] || ''), dialogs.join('|'));
  await page.fill('#rideNew', 'Late Model');
  await page.fill('#rideNum', '7');
  await page.click('#rideSave');
  await settle();
  let s2 = await page.evaluate(() => ({ n: rideList().length, active: P.rideLabel, num: P.driver.number, name: P.driver.name, home: P.driver.hometown, email: P.driver.email, photo: !!P.driver.photo, color: P.driver.teamColor,
    results: P.raceResults.length, id: P.profileId, code: P.shortCode, primary: ACCT.primaryId, stored: JSON.parse(localStorage.getItem(RIDES_KEY)), bar: document.getElementById('rideBar').textContent }));
  check('the account now has 2 rides and the new one is open', s2.n === 2 && s2.active === 'Late Model' && s2.num === '7', JSON.stringify(s2));
  check('the new ride is its own profile with its own link code', s2.id !== 'prof_ridestest01' && /^prof_/.test(s2.id) && s2.code && s2.code !== code1, s2.code);
  check('name, email, hometown and age carry over; photo too', s2.name === 'Joshua Miller' && s2.home === 'Fort Wayne' && s2.email === 'josh@example.com' && s2.photo);
  check('colors and results start fresh on the new ride', s2.color === '' && s2.results === 0);
  check('the first ride stays primary (it holds Pro)', s2.primary === PID);
  check('rides saved: active ride is not duplicated in the stash', s2.stored && s2.stored.order.length === 2 && !s2.stored.stash[s2.id] && s2.stored.stash[PID] && s2.stored.stash[PID].rideLabel === 'Karts');
  check('ride switcher shows both', /Karts/.test(s2.bar) && /Late Model/.test(s2.bar) && /#7/.test(s2.bar), s2.bar);
  const db2 = await page.evaluate(() => window.__db);
  const newCard = db2['profiles/' + s2.id + '/card'], oldCard = db2['profiles/' + PID + '/card'];
  check('the new ride was published under its own id', newCard && newCard.name === 'Joshua Miller' && newCard.num === '7' && db2['profiles_short/' + s2.code] === s2.id);
  check('its card lists both rides, first ride first', newCard && newCard.rides === code1 + ':Karts|' + s2.code + ':Late Model' && newCard.rideLabel === 'Late Model', newCard && newCard.rides);
  check('the first ride\'s card was updated to list the new one', oldCard && oldCard.rides === newCard.rides && oldCard.rideLabel === 'Karts', oldCard && oldCard.rides);
  check('Pro covers the new ride (valid code for ITS id)', newCard && newCard.premiumCode && (await page.evaluate((c) => premCheck(P.profileId, c), newCard.premiumCode)));

  console.log('\n=== 3. Switching rides ===');
  await page.evaluate(() => { P.raceResults.push({ date: '2026-09-01', trackId: 'rd_t2', trackName: 'Oval', class: 'Late Model', position: 4, points: 10, source: 'raceday', verifiedBy: null }); save(); });
  await page.evaluate((id) => switchRide(id), PID);
  let s3 = await page.evaluate(() => ({ id: P.profileId, label: P.rideLabel, stats: computeStats().byClass, stored: JSON.parse(localStorage.getItem('profiles_v1')).profileId, stash: Object.keys(ACCT.stash), on: document.querySelector('.ride-pill.on').textContent }));
  check('switching opens the other ride', s3.id === PID && s3.label === 'Karts' && s3.stored === PID && s3.on.indexOf('Karts') === 0, JSON.stringify(s3));
  check('stats stay apart (karts have no Late Model results)', s3.stats.Junior && !s3.stats['Late Model'], JSON.stringify(s3.stats));
  check('the other ride waits in the stash', s3.stash.length === 1 && s3.stash[0] === s2.id);
  await page.evaluate(() => nav('link'));
  check('Link page says which ride the code is for', /code for your <b>Karts<\/b> ride/.test(await page.evaluate(() => document.getElementById('page-link').innerHTML)));
  await page.evaluate((id) => switchRide(id), s2.id);
  check('…and back, with its own results', await page.evaluate(() => P.rideLabel === 'Late Model' && computeStats().byClass['Late Model'].races === 1 && !computeStats().byClass.Junior));
  await page.evaluate(() => nav('home'));
  check('Home shows the ride name', /Late Model · #7/.test(await page.evaluate(() => document.getElementById('page-home').innerHTML)));

  console.log('\n=== 4. Pro belongs to the account ===');
  const tier = await page.evaluate(() => ({ pro: tierAtLeast('pro'), buy: proBuyUrl('monthly'), portal: billingPortalUrl() }));
  check('the second ride is Pro through the first', tier.pro);
  check('checkout and billing use the first ride\'s id', /profileId=prof_ridestest01/.test(tier.buy) && /profileId=prof_ridestest01/.test(tier.portal), tier.buy);
  await page.evaluate(() => { var m = primaryProfile(); m.tier = 'free'; m.premiumCode = ''; m.entitlement = null; P.tier = 'free'; });
  check('no code and no subscription → not Pro', !(await page.evaluate(() => tierAtLeast('pro'))));
  await installMock({ 'profiles/prof_ridestest01/entitlement': { tier: 'pro', status: 'active', currentPeriodEnd: 0 } });
  await page.evaluate(() => refreshEntitlement());
  const ent = await page.evaluate(() => ({ pro: tierAtLeast('pro'), main: primaryProfile().entitlement && primaryProfile().entitlement.tier, own: P.entitlement, stored: JSON.parse(localStorage.getItem(RIDES_KEY)).stash.prof_ridestest01.entitlement }));
  check('a subscription on the first ride makes the open ride Pro', ent.pro && ent.main === 'pro' && !ent.own && ent.stored && ent.stored.tier === 'pro', JSON.stringify(ent));
  await page.evaluate(() => { var m = primaryProfile(); m.tier = 'pro'; m.premiumCode = localPremiumCode(m.profileId); m.entitlement = null; saveAcct(); });

  console.log('\n=== 5. Shared fields, rename, limit, remove ===');
  await installMock(await page.evaluate(() => window.__db || {}));
  await page.evaluate(() => nav('settings'));
  await page.fill('#stHometown', 'Auburn');
  await page.fill('#stNumber', '77');
  dialogs = [];
  await page.click('button[onclick="saveProfileFields()"]');
  await settle();
  const s5 = await page.evaluate(() => { var k = ACCT.stash.prof_ridestest01; return { home: k.driver.hometown, num: k.driver.number, mine: P.driver.number, kartCard: window.__db['profiles/prof_ridestest01/card'] }; });
  check('hometown is shared by every ride', s5.home === 'Auburn' && s5.kartCard && s5.kartCard.hometown === 'Auburn', JSON.stringify(s5.kartCard && s5.kartCard.hometown));
  check('the number stays per ride', s5.num === '18' && s5.mine === '77');
  promptAnswer = 'Super Late Model';
  await page.evaluate(() => renameRide(P.profileId));
  promptAnswer = null;
  check('rename updates every ride\'s card', await page.evaluate((c) => window.__db['profiles/prof_ridestest01/card'].rides.indexOf(':Super Late Model') > 0 && P.rideLabel === 'Super Late Model', code1));
  await page.evaluate(() => { openAddRide(); document.getElementById('rideNew').value = 'Sprint Car'; saveNewRide(); });
  await settle();
  check('a third ride can be added', await page.evaluate(() => rideList().length === 3 && P.rideLabel === 'Sprint Car'));
  await page.evaluate(() => nav('settings'));
  check('no more than 3', await page.evaluate(() => !document.getElementById('addRideBtn') && /most rides Pro allows/.test(document.getElementById('page-settings').innerHTML)));
  const sprint = await page.evaluate(() => ({ id: P.profileId, code: P.shortCode }));
  await page.evaluate((id) => removeRide(id), sprint.id);
  await settle();
  const s5b = await page.evaluate((sp) => ({ n: rideList().length, open: P.profileId, gone: !(('profiles/' + sp.id) in window.__db), short: !(('profiles_short/' + sp.code) in window.__db), removes: window.__removes, kart: window.__db['profiles/prof_ridestest01/card'].rides }), sprint);
  check('removing a ride deletes its card and link code', s5b.n === 2 && s5b.removes.indexOf('profiles/' + sprint.id) >= 0 && s5b.removes.indexOf('profiles_short/' + sprint.code) >= 0, JSON.stringify(s5b.removes));
  check('removing the open ride opens the first one', s5b.open === PID);
  check('the other cards stop listing it', s5b.kart.indexOf(sprint.code) < 0, s5b.kart);
  check('the first ride can\'t be removed', await page.evaluate(() => { removeRide(ACCT.primaryId); return rideList().length === 2; }) && !/onclick="removeRide\('prof_ridestest01'\)"/.test(await page.evaluate(() => document.getElementById('page-settings').innerHTML)));

  console.log('\n=== 6. Reload keeps the rides ===');
  const lateId = await page.evaluate(() => ACCT.order[1]);
  await page.evaluate((id) => switchRide(id), lateId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  check('reopens on the last ride, with the switcher', await page.evaluate((id) => P.profileId === id && rideList().length === 2 && document.getElementById('rideBar').style.display === '', lateId));
  check('the first ride is still primary', await page.evaluate(() => ACCT.primaryId === 'prof_ridestest01'));

  console.log('\n=== 7. Backup and restore every ride ===');
  const backup = await page.evaluate(() => JSON.stringify({ drivenBackup: 2, primaryId: ACCT.primaryId, activeId: P.profileId, rides: rideList() }));
  await page.evaluate(() => { localStorage.clear(); P = null; ACCT = null; });
  await page.evaluate((raw) => restoreFromBackupJson(raw), backup);
  const s7 = await page.evaluate(() => ({ n: rideList().length, open: P.profileId, primary: ACCT.primaryId, labels: rideList().map(p => p.rideLabel), kartResults: ACCT.stash.prof_ridestest01 && ACCT.stash.prof_ridestest01.raceResults.length }));
  check('a backup brings every ride back, same one open', s7.n === 2 && s7.open === lateId && s7.primary === PID && s7.labels.join('|') === 'Karts|Super Late Model' && s7.kartResults === 1, JSON.stringify(s7));
  const single = await page.evaluate(() => JSON.stringify(rideList()[0]));
  await page.evaluate((raw) => restoreFromBackupJson(raw), single);
  check('an old one-profile backup still restores (and clears rides)', await page.evaluate(() => !multiRide() && !localStorage.getItem(RIDES_KEY) && P.driver.name === 'Joshua Miller'));

  console.log('\n=== 8. Restore by link code brings the other rides ===');
  const kartCard = { name: 'Joshua Miller', num: '18', rides: 'KARTCODE:Karts|LATECODE:Late Model', rideLabel: 'Karts', updatedAt: 2000000000000 };
  const lateCard = { name: 'Joshua Miller', num: '7', rides: 'KARTCODE:Karts|LATECODE:Late Model', rideLabel: 'Late Model', teamColor: '#123456', updatedAt: 2000000000000 };
  const fakeCard = { name: 'Someone Else', num: '1', rides: 'OTHER:Theirs', updatedAt: 2000000000000 };
  await page.evaluate(() => { localStorage.clear(); P = null; ACCT = null; });
  await installMock({ 'profiles_short/LATECODE': 'prof_latecode001', 'profiles/prof_latecode001/card': lateCard,
    'profiles_short/KARTCODE': 'prof_kartcode001', 'profiles/prof_kartcode001/card': kartCard, 'profileTracks/prof_latecode001': null });
  await page.evaluate(() => restoreFromLinkCode('LATECODE', true));
  await page.waitForTimeout(500);
  const s8 = await page.evaluate(() => ({ n: rideList().length, open: P.profileId, primary: ACCT && ACCT.primaryId, labels: rideList().map(p => p.rideLabel + ':' + p.driver.number), pull: ACCT && ACCT.stash.prof_kartcode001 && ACCT.stash.prof_kartcode001.needsResultsPull, sets: window.__sets.length }));
  check('restoring one ride\'s code brings back both', s8.n === 2 && s8.open === 'prof_latecode001', JSON.stringify(s8));
  check('order and primary follow the card (Karts first)', s8.primary === 'prof_kartcode001' && s8.labels.join('|') === 'Karts:18|Late Model:7', JSON.stringify(s8.labels));
  check('the other ride pulls its results when opened', s8.pull === true);
  check('restoring writes nothing to Firebase', s8.sets === 0, s8.sets);
  await page.evaluate(() => { localStorage.clear(); P = null; ACCT = null; });
  await installMock({ 'profiles_short/LATECODE': 'prof_latecode001', 'profiles/prof_latecode001/card': Object.assign({}, lateCard, { rides: 'LATECODE:Late Model|FAKECODE:Theirs' }),
    'profiles_short/FAKECODE': 'prof_fakecode001', 'profiles/prof_fakecode001/card': fakeCard });
  await page.evaluate(() => restoreFromLinkCode('LATECODE', true));
  await page.waitForTimeout(500);
  check('a ride whose card doesn\'t list this one back is ignored', await page.evaluate(() => !multiRide() && P.profileId === 'prof_latecode001'));

  console.log('\n=== 9. Delete everything removes every ride ===');
  await page.evaluate(() => { localStorage.clear(); P = null; ACCT = null; });
  await installMock({ 'profiles_short/LATECODE': 'prof_latecode001', 'profiles/prof_latecode001/card': lateCard,
    'profiles_short/KARTCODE': 'prof_kartcode001', 'profiles/prof_kartcode001/card': kartCard });
  await page.evaluate(() => restoreFromLinkCode('LATECODE', true));
  await page.waitForTimeout(500);
  dialogs = [];
  await page.evaluate(() => { sessionStorage.removeItem('removes'); window.__removes = []; deleteProfile(); });
  await page.waitForTimeout(800);   // deleteProfile() reloads the page when it's done
  const s9 = await page.evaluate(() => ({ removes: JSON.parse(sessionStorage.getItem('removes') || '[]'), keys: [localStorage.getItem('profiles_v1'), localStorage.getItem('profiles_rides_v1')] }));
  check('the warning says how many rides', /all 2 rides/.test(dialogs[0] || ''), dialogs[0]);
  check('both cards and both link codes are removed', ['profiles/prof_latecode001', 'profiles/prof_kartcode001', 'profiles_short/LATECODE', 'profiles_short/KARTCODE'].every(p => s9.removes.indexOf(p) >= 0), JSON.stringify(s9.removes));
  check('nothing left on the device', s9.keys[0] === null && s9.keys[1] === null);

  // ============================================================================
  console.log('\n=== 10. Public page ride tabs ===');
  const pub = await browser.newPage({ viewport: { width: 400, height: 900 } });
  pub.on('pageerror', e => { errors.push('d/: ' + e.message); console.log('  ⚠️ d/ error:', e.message); });
  let table = {};
  await pub.route(/firebaseio\.com/, r => {
    const u = new URL(r.request().url()).pathname.replace(/\.json$/, '').replace(/^\//, '');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(u in table ? table[u] : null) });
  });
  await pub.route(/gstatic\.com|cloudflareinsights/, r => r.abort());
  const serve = async (code, t) => {
    table = t;
    await pub.goto(base + 'd/?' + code, { waitUntil: 'domcontentloaded' });
    await pub.waitForSelector('#app .actions, #app .msg h1', { timeout: 10000 }).catch(() => {});
    return pub.evaluate(() => document.getElementById('app').innerHTML);
  };
  const T = { 'profiles_short/KARTCODE': 'prof_kartcode001', 'profiles/prof_kartcode001/card': kartCard, 'profiles_short/LATECODE': 'prof_latecode001', 'profiles/prof_latecode001/card': lateCard };
  let d = await serve('LATECODE', T);
  check('a ride page shows tabs for every ride', /class="rides"/.test(d) && /href="\?KARTCODE"[^>]*>Karts #18</.test(d) && /href="\?LATECODE" class="on"[^>]*>Late Model #7</.test(d), d.slice(0, 600));
  d = await serve('LATECODE', Object.assign({}, T, { 'profiles/prof_kartcode001/card': Object.assign({}, kartCard, { rides: 'KARTCODE:Karts' }) }));
  check('no tabs when the other card doesn\'t list this ride back', !/class="rides"/.test(d) && /Joshua Miller/.test(d));
  d = await serve('LATECODE', Object.assign({}, T, { 'profiles/prof_latecode001/card': Object.assign({}, lateCard, { rides: '' }) }));
  check('no tabs for a one-ride card', !/class="rides"/.test(d));
  d = await serve('LATECODE', Object.assign({}, T, {
    'profiles/prof_latecode001/card': Object.assign({}, lateCard, { rides: 'KARTCODE:<img src=x onerror=window.__xss=1>|LATECODE:Late Model' }),
    'profiles/prof_kartcode001/card': Object.assign({}, kartCard, { rides: 'KARTCODE:x|LATECODE:y' }) }));
  check('ride names are shown as text', !(await pub.evaluate(() => window.__xss || !!document.querySelector('.rides img'))) && /&lt;img/.test(d));
  await pub.close();

  console.log('\n=== 11. Rules ===');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules.profiles.$id.card;
  const caps = await page.evaluate(() => ({ rides: CARD_CAPS.rides, rideLabel: CARD_CAPS.rideLabel }));
  check('rules allow rides (200) and rideLabel (30), matching CARD_CAPS', /length <= 200/.test(rules.rides && rules.rides['.validate']) && /length <= 30/.test(rules.rideLabel && rules.rideLabel['.validate']) && caps.rides === 200 && caps.rideLabel === 30);
  check('no page errors', errors.length === 0, errors.join(' | '));

  console.log(`\n${fail ? '❌' : '✅'} driven-rides: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
