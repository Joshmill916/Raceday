// Driven: the optional iRacing member ID. Driven only links to the driver's own iRacing
// profile — it never reads iRacing data — so this suite pins down that the field is
// digits-only everywhere it can enter (Settings, a restored card, the public page) and
// that the database rules allow it (the card rules reject any unlisted key).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8831;
const LINK = 'https://members-ng.iracing.com/web/racing/profile?cust_id=';
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]).slice(1);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': rel.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------------------------------------------------------------- the Driven app
  console.log('\n=== Driven app ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}/driven/index.html`); await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.clear();
      P = newProfile('Robin Park', '', 'Dayton, OH', 15);
      P.profileId = 'prof_iracing000001'; P.driver.number = '9';
      save(); document.getElementById('onboardModal').style.display = 'none';
    });
    check('a new profile starts with no iRacing ID', await page.evaluate(() => P.driver.iracingId === ''));
    check('an older saved profile gets the field on load', await page.evaluate(() => migrate({ profileId: 'prof_old0000001', driver: { name: 'Old' } }).driver.iracingId === ''));

    // Settings: digits only, capped at 9
    const saveId = v => page.evaluate(v => { nav('settings'); document.getElementById('stIracing').value = v; saveProfileFields(); return P.driver.iracingId; }, v);
    check('Settings has an iRacing member ID field', await page.evaluate(() => { nav('settings'); return !!document.getElementById('stIracing'); }));
    check('Settings keeps a plain ID', (await saveId('123456')) === '123456');
    check('Settings strips anything that is not a digit', (await saveId(' #12-34ab56 ')) === '123456');
    check('Settings caps the ID at 9 digits', (await saveId('12345678901234')) === '123456789');
    check('clearing the field removes the ID', (await saveId('')) === '');

    // Published card
    const payload = () => page.evaluate(() => {
      window.firebase = { database: function () { return {}; } };
      window.firebase.database.ServerValue = { TIMESTAMP: 0 };
      return cardPayload();
    });
    await saveId('123456');
    check('the published card carries the ID', (await payload()).iracingId === '123456');
    await page.evaluate(() => { P.driver.iracingId = 'abc'; });
    check('a bad stored value is never published', (await payload()).iracingId === '');
    await page.evaluate(() => { P.driver.iracingId = '1234567890'; });
    check('the size check names the field if it is somehow too long', /iRacing member ID/.test(await page.evaluate(() => cardTooLong() || '')));

    // Home and Card show the chip + link only when set
    const hero = tab => page.evaluate(tab => { nav(tab); const a = [...document.querySelectorAll('#page-' + tab + ' .dp-sim a')][0]; return { chip: !!document.querySelector('#page-' + tab + ' .sim-chip'), href: a ? a.href : null, target: a ? a.target : null, rel: a ? a.rel : null }; }, tab);
    await saveId('123456');
    for (const tab of ['home', 'card']) {
      const h = await hero(tab);
      check(`${tab}: shows the Sim racer badge`, h.chip);
      check(`${tab}: links to the driver's iRacing profile`, h.href === LINK + '123456', h.href);
      check(`${tab}: the link opens in a new tab, safely`, h.target === '_blank' && /noopener/.test(h.rel || ''));
    }
    await saveId('');
    check('no badge or link without an ID', !(await hero('home')).chip && !(await hero('card')).chip);

    // Restore from a published card (restore by link code / a second device)
    const restored = await page.evaluate(() => {
      const apply = card => { const q = newProfile('X', '', '', null); applyCardToProfile(q, card); return q.driver.iracingId; };
      return { good: apply({ name: 'X', num: '1', iracingId: '424242' }), bad: apply({ name: 'X', num: '1', iracingId: '<script>' }), none: apply({ name: 'X', num: '1' }) };
    });
    check('restoring a card brings the iRacing ID back', restored.good === '424242', restored.good);
    check('restoring a card with a tampered ID keeps it empty', restored.bad === '', restored.bad);
    check('restoring a card without the field leaves it empty', restored.none === '', restored.none);
    check('no page errors in the app', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the public page
  console.log('\n=== Public driver page ===');
  const publicPage = async (iracingId) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const card = { name: 'Robin Park', num: '9', hometown: 'Dayton, OH', updatedAt: 1, iracingId };
    const db = { 'profiles_short/ROBIN9': 'prof_iracing000001', 'profiles/prof_iracing000001/card': card };
    await ctx.route(/^https?:\/\/(?!localhost)/, r => {
      const m = r.request().url().match(/firebaseio\.com\/(.+)\.json/);
      if (m) { const k = decodeURIComponent(m[1]); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(k in db ? db[k] : null) }); }
      return r.abort();
    });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://localhost:${PORT}/d/?ROBIN9`); await page.waitForTimeout(900);
    const r = await page.evaluate(() => { const a = document.querySelector('.sim a'); return { name: (document.querySelector('.name') || {}).textContent, chip: !!document.querySelector('.sim-chip'), href: a ? a.href : null, target: a ? a.target : null, rel: a ? a.rel : null }; });
    await ctx.close();
    return { ...r, errs };
  };
  {
    const r = await publicPage('123456');
    check('the public page loads the card', /Robin Park/.test(r.name || ''), r.name);
    check('the public page shows the Sim racer badge', r.chip);
    check('the public page links to the iRacing profile', r.href === LINK + '123456', r.href);
    check('the public link opens in a new tab, safely', r.target === '_blank' && /noopener/.test(r.rel || ''));
    check('no page errors on the public page', r.errs.length === 0, r.errs.join(' | '));
  }
  {
    const r = await publicPage('"><img src=x onerror=alert(1)>');
    check('a tampered (non-digit) ID shows nothing', !r.chip && r.href === null);
    const none = await publicPage(undefined);
    check('a card without an ID shows no badge', !none.chip);
  }

  // ---------------------------------------------------------------- database rules
  console.log('\n=== Database rules ===');
  {
    const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8'));
    const v = (((rules.rules.profiles || {}).$id || {}).card || {}).iracingId;
    check('the card rules allow iracingId (otherwise every publish with it is rejected)', !!v);
    check('the rule only accepts up to 9 digits', !!v && v['.validate'].includes('matches(/^[0-9]{0,9}$/)'), v && v['.validate']);
    const re = /^[0-9]{0,9}$/;
    check('the same pattern accepts a real ID and rejects letters', re.test('123456') && !re.test('12a') && !re.test('1234567890'));
  }

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
