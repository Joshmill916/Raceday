// Driven public page + privacy switches.
// 1. The public page's share button says "Share this driver" to visitors and "Share my page"
//    to the driver (a code this phone's Driven holds); both share the picture link
//    (raceday-d32dd.web.app/d/CODE), never anything that edits the card.
// 3. A gifted Pro (owner-written entitlement, gift:true) ends on its date on the public page.
// 2. "Show my hometown" / "Show my age" in Settings take those off the PUBLISHED card
//    (cardPayload + cardStrings) — on by default so existing cards don't change.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8853;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
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
  const base = `http://localhost:${PORT}/`;

  console.log('\n=== 1. Public page share button ===');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pub = await ctx.newPage();
  pub.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
  let ENT = null;
  await pub.route(/firebaseio\.com/, r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/profiles/prof_casey047abc/entitlement.json') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ENT) });
    const json = v => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (p === '/profiles_short/CASEY047.json') return json('prof_casey047abc');
    if (p === '/profiles/prof_casey047abc/card.json') return json({ name: 'Casey Rivera', num: '47', hometown: 'Delta, OH', updatedAt: 1 });
    return json(null);
  });
  await pub.route(/gstatic\.com|cloudflareinsights/, r => r.abort());
  await pub.addInitScript(() => { navigator.share = d => { window.__shared = d; return Promise.resolve(); }; });
  await pub.goto(base + 'd/?CASEY047', { waitUntil: 'domcontentloaded' });
  await pub.waitForSelector('.actions button');
  const visitor = await pub.innerText('.actions button');
  check('a visitor sees "Share this driver"', /^Share this driver$/i.test(visitor.trim()), visitor);
  await pub.click('.actions button'); await pub.waitForTimeout(100);
  const shared = await pub.evaluate(() => window.__shared && window.__shared.url);
  check('sharing sends the picture link for this driver', shared === 'https://raceday-d32dd.web.app/d/CASEY047', shared);
  check('nothing on the page offers to edit the card', !/edit|change|publish/i.test(await pub.innerText('.actions')));
  await pub.evaluate(() => localStorage.setItem('profiles_v1', JSON.stringify({ profileId: 'prof_casey047abc', shortCode: 'CASEY047', driver: { name: 'Casey Rivera' } })));
  await pub.reload({ waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.actions button');
  check('the driver sees "Share my page" on their own card', /^Share my page$/i.test((await pub.innerText('.actions button')).trim()));
  await pub.evaluate(() => { localStorage.setItem('profiles_v1', JSON.stringify({ shortCode: 'SOMEONE1' })); localStorage.setItem('profiles_family_v1', JSON.stringify({ order: [], stash: { a: { p: { shortCode: 'CASEY047' } } } })); });
  await pub.reload({ waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.actions button');
  check('a parent with that driver on their phone also sees "Share my page"', /^Share my page$/i.test((await pub.innerText('.actions button')).trim()));
  ENT = { tier: 'pro', status: 'active', gift: true, currentPeriodEnd: Date.now() + 864e5 };
  await pub.reload({ waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.actions button');
  check('a gifted Pro shows the Pro look before its end date', await pub.evaluate(() => !!document.querySelector('.name .badge')));
  ENT.currentPeriodEnd = Date.now() - 1000;
  await pub.reload({ waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.actions button');
  check('…and not after it', await pub.evaluate(() => !document.querySelector('.name .badge')));
  await ctx.close();

  console.log('\n=== 2. Hide hometown / age ===');
  const dctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const page = await dctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
  page.on('dialog', d => d.accept());
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(base + 'driven/index.html', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300);
  await page.evaluate(() => { localStorage.clear(); $id('obName').value = 'Kaden Harper'; $id('obHometown').value = 'Delta, OH'; if ($id('obAge')) $id('obAge').value = '12'; completeOnboarding(); P.driver.age = 12; save();
    window.firebase = { apps: [{}], database: function () { return { ref: function () { return { set: () => Promise.resolve(), once: () => Promise.resolve({ val: () => null }), remove: () => Promise.resolve() }; } }; } };
    window.firebase.database.ServerValue = { TIMESTAMP: 1 }; });
  let c = await page.evaluate(() => ({ s: cardStrings(), p: cardPayload() }));
  check('by default hometown and age are on the card (existing cards unchanged)', c.s.hometown === 'Delta, OH' && c.s.age === '12' && c.p.hometown === 'Delta, OH' && c.p.age === '12', JSON.stringify({ h: c.p.hometown, a: c.p.age }));
  await page.evaluate(() => nav('settings'));
  check('Settings has both switches, on', await page.evaluate(() => $id('stShowHome').checked && $id('stShowAge').checked));
  await page.evaluate(() => { $id('stShowHome').checked = false; $id('stShowAge').checked = false; saveProfileFields(); });
  c = await page.evaluate(() => ({ s: cardStrings(), p: cardPayload(), d: P.driver }));
  check('switched off: no hometown or age on the published card', c.s.hometown === '' && c.s.age === '' && c.p.hometown === '' && c.p.age === '', JSON.stringify({ h: c.p.hometown, a: c.p.age }));
  check('…but still kept in the app', c.d.hometown === 'Delta, OH' && c.d.age === 12);
  await page.evaluate(() => nav('settings'));
  check('the switches stay off', await page.evaluate(() => !$id('stShowHome').checked && !$id('stShowAge').checked));
  await dctx.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
