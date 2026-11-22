// Cards that never went live (2026-11-22): every profile made Nov 15-22 stayed unpublished, so those
// drivers had no link code for the track. Guards: "Create my card" says the card goes live and
// publishes in the same tap; offline, Home says so and it goes live on open / back to the screen;
// a profile made before this (no goLive) is never published on its own, Home asks with one button.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8893;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u === '/' ? 'driven/index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.html' ? 'text/html' : 'application/octet-stream' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const alerts = []; page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com|firebaseio\.com|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);

  // Firebase stand-in: 'ok' stores writes, 'offline' fails every call.
  const mock = mode => page.evaluate(mode => {
    window.__writes = window.__writes || []; window.__mode = mode;
    const fail = () => Promise.reject(new Error('offline'));
    window.firebase = { apps: [{}], database: () => ({ ref: p => ({
      once: () => window.__mode === 'offline' ? fail() : Promise.resolve({ val: () => null }),
      set: v => { if (window.__mode !== 'ok') return fail(); __writes.push([p, v]); return Promise.resolve(); }
    }) }) };
    window.firebase.database.ServerValue = { TIMESTAMP: 'TS' };
  }, mode);
  const cardWrites = () => page.evaluate(() => (window.__writes || []).filter(w => /^profiles\/.*\/card$/.test(w[0])).length);
  const wait = ms => page.waitForTimeout(ms);
  const home = () => page.evaluate(() => document.getElementById('page-home').innerText);
  const create = async (name) => {
    await page.evaluate(() => { localStorage.clear(); P = null; FAM = null; ACCT = null; window.__writes = []; openOnboarding(); });
    check('the form says the card goes live', await page.evaluate(() => /goes live/.test(document.getElementById('onboardModal').innerText) && /Create my card/.test(document.getElementById('obCreate').textContent)));
    await page.fill('#obName', name);
    await page.click('#obCreate');
    await wait(250);
  };

  console.log('\n=== Online: Create my card publishes in the same tap ===');
  await mock('ok');
  await create('Casey Lane');
  check('the card was published', (await cardWrites()) === 1);
  check('…and the phone has its link code', await page.evaluate(() => !!P.publishedAt && /^[A-Z0-9]{8,}$/.test(P.shortCode)));
  let t = await home();
  check('Home shows Share my page, no "not live" notice', /share my page/i.test(t) && !/isn't live yet/.test(t), t.slice(0, 300));
  check('no pop-up interrupts them', alerts.length === 0, alerts.join(' | '));

  console.log('\n=== Offline: it says so and goes live later ===');
  await mock('offline');
  await create('Riley Offline');
  t = await home();
  check('Home says the card isn\'t live yet, and why', /isn't live yet/.test(t) && /couldn't reach the internet/.test(t), t.slice(0, 300));
  check('…with Try again', /try again/i.test(t));
  await mock('ok');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(250);
  t = await home();
  check('back to the screen online: it goes live by itself', (await cardWrites()) === 1 && !/isn't live yet/.test(t) && /share my page/i.test(t), t.slice(0, 300));

  console.log('\n=== A profile from before (never agreed to go live) ===');
  await mock('ok');
  await page.evaluate(() => {
    localStorage.clear(); FAM = null; ACCT = null; window.__writes = [];
    P = newProfile('Old Unpublished', '', 'Fort Wayne', 12); localStorage.setItem('profiles_v1', JSON.stringify(P)); nav('home');
  });
  await page.evaluate(() => { goLiveNow(); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(250);
  check('it is never published on its own', (await cardWrites()) === 0);
  t = await home();
  check('Home explains, and the button says Make my card live', /isn't live yet/.test(t) && /link code/.test(t) && /make my card live/i.test(t), t.slice(0, 300));
  await page.evaluate(() => Array.from(document.querySelectorAll('#page-home .dp-actions button')).find(b => /Make my card live/.test(b.textContent)).click());
  await wait(250);
  check('that button publishes it', (await cardWrites()) === 1 && await page.evaluate(() => !!P.publishedAt));

  check('no sideways scrolling on a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
