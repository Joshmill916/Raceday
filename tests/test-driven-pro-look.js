// Driven Pro look (2026-11-10). Pro must look clearly different from free at a glance, from the
// first race, and a free driver can try it on before paying:
// 1. Pro hero (Driven Card + /d/): photo or three-color banner with the name, number plate and
//    PRO DRIVER badge on it; sponsors as plates under it; "The ride" (kart + helmet photos, kart,
//    racing since). Free keeps the original look, untouched.
// 2. "Preview Pro" on a free driver's own Card page: only on that phone, nothing published,
//    gold "Keep this look" goes to checkout, and it resets when they leave the page.
// 3. The new card fields go out only for Pro, have caps that match database.rules.json, and come
//    back on restore.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8875;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const TYPES = { '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(u)] || 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    localStorage.clear();
    P = newProfile('Casey Rivera', '', 'Riverside, CA', null);
    P.profileId = 'prof_caseyriv47ab'; P.driver.number = '47'; P.driver.teamColor = '#d62828';
    P.sponsors = [{ name: 'Smith Auto' }, { name: 'Apex Racing' }];
    P.raceResults = [{ date: '2026-11-07', class: 'Predator', position: 2, points: 8, trackName: 'Sample Speedway', source: 'raceday' }];
    window.firebase = { database: { ServerValue: { TIMESTAMP: 1 } } };
    window.__img = (() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 40, 30); return c.toDataURL('image/jpeg', 0.6); })();
    save();
    document.getElementById('onboardModal').style.display = 'none';
  });

  console.log('\n=== 1. Free card is unchanged, and can preview Pro ===');
  const free = await page.evaluate(() => { nav('card'); const el = $id('page-card'); return {
    banner: !!el.querySelector('.dp-banner'), ph: !!el.querySelector('.ph'), seg: !!el.querySelector('.pv-seg'),
    sponsorsAtBottom: !!el.querySelector('.dp-sponsors'), ride: /The ride/i.test(el.innerText), cta: !!el.querySelector('.pv-cta') }; });
  check('free card keeps the original banner, no Pro hero, no ride section', free.banner && !free.ph && !free.ride && free.sponsorsAtBottom, JSON.stringify(free));
  check('free card has the My card / Preview Pro switch', free.seg && !free.cta);
  const pv = await page.evaluate(() => { setPreviewPro(true); const el = $id('page-card'); return {
    ph: !!el.querySelector('.ph'), badge: (el.querySelector('.ph-badge') || {}).textContent, plate: (el.querySelector('.ph-plate') || {}).textContent,
    tip: !!el.querySelector('.ph-tip'), spons: el.querySelectorAll('.ph-spons .s').length, ride: !!el.querySelector('.ph-ride .ph-photo.empty'),
    cta: (el.querySelector('.pv-cta .go') || {}).textContent, ctaCall: (el.querySelector('.pv-cta .go') || { getAttribute: () => '' }).getAttribute('onclick'),
    note: /Only you see this preview/.test(el.innerText), publishBtn: /Publish my card|Update published card/.test(el.innerText),
    tc2: el.style.getPropertyValue('--tc2') }; });
  check('Preview Pro shows the Pro hero: PRO DRIVER badge, number plate, sponsor plates', pv.ph && pv.badge === 'PRO DRIVER' && pv.plate === '47' && pv.spons === 2, JSON.stringify(pv));
  check('…with empty kart/helmet slots and a "header photo goes here" tip', pv.ride && pv.tip);
  check('…says only they see it, and hides publishing while previewing', pv.note && !pv.publishBtn);
  check('…shows the three-color look even before accents are picked', pv.tc2 === '#ffc400');
  check('"Keep this look" goes to Pro checkout', /Keep this look/i.test(pv.cta || '') && /proBuy\('monthly'\)/.test(pv.ctaCall || ''));
  check('previewing never puts Pro fields on the published card (free cards carry no new keys at all)', await page.evaluate(() => {
    P.driver.kart = 'Coyote'; P.driver.since = '2019'; P.driver.kartPhoto = __img; P.driver.header = __img;
    const c = cardPayload(), s = cardStrings();
    return !('kart' in c) && !('since' in c) && !('kartPhoto' in c) && !('helmetPhoto' in c) && c.header === '' && s.kart === '' && s.kartPhoto === '';
  }));
  check('leaving the Card page turns the preview off', await page.evaluate(() => { nav('stats'); nav('card'); return !dvPreviewPro && !$id('page-card').querySelector('.ph'); }));
  check('the upgrade card links to the preview', await page.evaluate(() => /setPreviewPro\(true\)/.test($id('page-card').innerHTML)));

  console.log('\n=== 2. Pro card ===');
  const pro = await page.evaluate(() => {
    P.tier = 'pro'; P.premiumCode = localPremiumCode(P.profileId);
    P.driver.helmetPhoto = __img; P.driver.teamColor2 = '#ffd23f'; P.driver.teamColor3 = '#2f7be0'; save();
    nav('card'); const el = $id('page-card');
    return { ph: !!el.querySelector('.ph'), photoBg: /background-image/.test(el.querySelector('.ph').getAttribute('style')), seg: !!el.querySelector('.pv-seg'),
      photos: el.querySelectorAll('.ph-ride img').length, kv: el.querySelector('.ph-kv') && el.querySelector('.ph-kv').innerText,
      bottomSponsors: !!el.querySelector('.dp-sponsors'), tip: !!el.querySelector('.ph-tip'), home: (nav('home'), !!$id('page-home').querySelector('.ph')) };
  });
  check('Pro card: Pro hero with their header photo, no preview switch or tip', pro.ph && pro.photoBg && !pro.seg && !pro.tip, JSON.stringify(pro));
  check('Pro card: "The ride" with kart + helmet photos, kart and racing since', pro.photos === 2 && /Coyote/.test(pro.kv) && /2019/.test(pro.kv));
  check('Pro card: sponsors move up to plates (not repeated at the bottom)', !pro.bottomSponsors);
  check('Home shows the Pro hero too', pro.home);
  check('number plate text is dark on a light team color, white on a dark one', await page.evaluate(() => inkOn('#ffd23f') === '#14161b' && inkOn('#d62828') === '#fff' && inkOn('bad') === '#fff'));
  const pay = await page.evaluate(() => { const c = cardPayload(); return { kart: c.kart, since: c.since, kp: c.kartPhoto === __img, hp: c.helmetPhoto === __img }; });
  check('Pro publishes kart, racing since and both photos', pay.kart === 'Coyote' && pay.since === '2019' && pay.kp && pay.hp, JSON.stringify(pay));
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules.profiles.$id.card;
  const caps = await page.evaluate(() => CARD_CAPS);
  check('caps match the database rules (kart 60, photos 70000) and since must be a year',
    caps.kart === 60 && caps.kartPhoto === 70000 && caps.helmetPhoto === 70000 && /<= 60/.test(rules.kart['.validate']) && /<= 70000/.test(rules.kartPhoto['.validate'])
    && /<= 70000/.test(rules.helmetPhoto['.validate']) && /19\|20/.test(rules.since['.validate']));
  check('an over-cap ride photo is caught before publishing', await page.evaluate(() => { const k = P.driver.kartPhoto; P.driver.kartPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(70001); const t = cardTooLong(); P.driver.kartPhoto = k; return /Kart photo/.test(t || ''); }));
  check('Settings: Pro gets ride photo buttons + kart + racing since; a bad year is refused', await page.evaluate(() => {
    nav('settings'); const ok = !!$id('stKart') && !!$id('stSince') && !!$id('st_kartPhoto') && !!$id('st_helmetPhoto');
    $id('stSince').value = '1850'; saveProfileFields(); const kept = P.driver.since === '2019';
    $id('stKart').value = 'OTK · LO206'; $id('stSince').value = '2021'; saveProfileFields();
    return ok && kept && P.driver.kart === 'OTK · LO206' && P.driver.since === '2021';
  }));
  check('restore brings the ride back from the published card', await page.evaluate(() => {
    const p = newProfile('X', '', '', null); p.profileId = P.profileId;
    applyCardToProfile(p, { name: 'Casey Rivera', num: '47', kart: 'OTK', since: '2021', kartPhoto: __img, helmetPhoto: 'javascript:bad', updatedAt: 1 });
    return p.driver.kart === 'OTK' && p.driver.since === '2021' && p.driver.kartPhoto === __img && p.driver.helmetPhoto === null;
  }));
  check('Settings (free) offers the preview instead of the ride fields', await page.evaluate(() => {
    P.tier = 'free'; P.premiumCode = ''; save(); nav('settings');
    const r = !$id('stKart') && /See your card with Pro/.test($id('page-settings').innerHTML); return r;
  }));

  console.log('\n=== 3. Public page (/d/) ===');
  const img = await page.evaluate(() => __img);
  let CARD = { name: 'Casey Rivera', num: '47', hometown: 'Riverside, CA', teamColor: '#d62828', teamColor2: '#ffd23f', teamColor3: '#2f7be0',
    sponsors: 'Smith Auto · Apex Racing', kart: 'Coyote · Predator 212', since: '2019', kartPhoto: img, helmetPhoto: img, updatedAt: 1 };
  let ENT = { tier: 'pro', status: 'active' };
  const pub = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pub.on('pageerror', e => errors.push(e.message));
  await pub.route(/^(?!http:\/\/localhost)/, r => {
    const url = r.request().url(); if (!/firebaseio/.test(url)) return r.abort();
    const u = new URL(url).pathname; const j = v => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (u === '/profiles_short/CASEY047.json') return j('prof_casey047abc');
    if (u.endsWith('/card.json')) return j(CARD);
    if (u.endsWith('/entitlement.json')) return j(ENT);
    return j(null);
  });
  const load = async () => { await pub.goto(`http://localhost:${PORT}/d/?CASEY047`, { waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.actions button'); };
  await load();
  const dp = await pub.evaluate(() => ({ ph: !!document.querySelector('.ph'), badge: (document.querySelector('.ph-badge') || {}).textContent,
    plate: (document.querySelector('.ph-plate') || {}).textContent, h1: (document.querySelector('h1.ph-name') || {}).textContent,
    spons: document.querySelectorAll('.ph-spons .s').length, bottom: !!document.querySelector('.sponsors'),
    ridePhotos: document.querySelectorAll('.ph-ride img').length, kv: (document.querySelector('.ph-kv') || {}).innerText || '',
    scroll: document.documentElement.scrollWidth > innerWidth }));
  check('Pro public page: PRO DRIVER hero with plate and the name as the page heading', dp.ph && dp.badge === 'PRO DRIVER' && dp.plate === '47' && dp.h1 === 'Casey Rivera', JSON.stringify(dp));
  check('Pro public page: sponsor plates up top, not repeated at the bottom', dp.spons === 2 && !dp.bottom);
  check('Pro public page: The ride with both photos, kart and racing since', dp.ridePhotos === 2 && /Coyote/.test(dp.kv) && /2019/.test(dp.kv));
  check('no sideways scroll on a phone', !dp.scroll);
  CARD = Object.assign({}, CARD, { kartPhoto: 'javascript:alert(1)', helmetPhoto: '', since: '19x9', kart: '' });
  await load();
  check('bad photos and a bad year are dropped, and an empty ride section is left out', await pub.evaluate(() => !document.querySelector('.ph-ride') && !/The ride/i.test(document.body.innerText)));
  ENT = null;
  await load();
  check('free public page keeps the original look (no Pro hero, no ride, sponsors at the bottom)', await pub.evaluate(() =>
    !document.querySelector('.ph') && !!document.querySelector('.banner') && !!document.querySelector('.sponsors')));

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
