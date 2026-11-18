// A public page that quietly fell behind (2026-11-17): Josh's Driven card kept week-old colors because
// every silent republish was refused and swallowed. Guards: a failed publish is kept and shown on Home
// and Card with Try again (refused / offline / too long each say why); the next success clears it; on
// open, a card whose online copy differs from this phone's is republished (Josh's exact case: online
// accent white, phone blue, this phone published last); nothing is written when it already matches;
// and a card another device published later is never overwritten.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8887;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const PID = 'prof_retry000001';

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
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route(/gstatic\.com|firebaseio\.com|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);

  // Firebase stand-in: mode 'ok' stores writes, 'denied' refuses them, 'offline' fails every call.
  const mock = (mode, online) => page.evaluate(([mode, online, PID]) => {
    window.__writes = []; window.__mode = mode; window.__online = online;
    const fail = () => Promise.reject(window.__mode === 'denied' ? Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' }) : new Error('offline'));
    window.firebase = { apps: [{}], database: () => ({ ref: p => ({
      once: () => window.__mode === 'offline' ? fail() : Promise.resolve({ val: () => (p === 'profiles/' + PID + '/card' ? window.__online : p === 'profiles_short/RETRY000' ? PID : null) }),
      set: v => { if (window.__mode !== 'ok') return fail(); __writes.push([p, JSON.parse(JSON.stringify(v))]); if (p === 'profiles/' + PID + '/card') window.__online = Object.assign({}, v, { updatedAt: Date.now() }); return Promise.resolve(); }
    }) }) };
    window.firebase.database.ServerValue = { TIMESTAMP: 'TS' };
  }, [mode, online, PID]);
  const start = (publishedAt) => page.evaluate(([PID, publishedAt]) => {
    localStorage.clear(); FAM = null; ACCT = null; _freshAt = 0;
    P = newProfile('Joshua Miller', '18', 'Fort Wayne', 30); P.profileId = PID; P.shortCode = 'RETRY000'; P.publishedAt = publishedAt;
    P.driver.teamColor = '#b51a00'; P.driver.teamColor2 = '#1f4fd6'; P.driver.teamColor3 = '#0b0c10';
    localStorage.setItem('profiles_v1', JSON.stringify(P));
    nav('home');
  }, [PID, publishedAt]);
  const home = () => page.evaluate(() => { nav('home'); return document.getElementById('page-home').innerText; });
  const cardWrites = () => page.evaluate(PID => __writes.filter(w => w[0] === 'profiles/' + PID + '/card').length, PID);

  console.log('\n=== A refused update is no longer silent ===');
  await start(1000);
  await mock('denied', null);
  await page.evaluate(() => { save(); return new Promise(r => setTimeout(r, 150)); });
  let t = await home();
  check('Home says the public page isn\'t up to date', /Your public page isn't up to date/.test(t), t.slice(0, 300));
  check('…why, and how to get help', /turned down/.test(t) && /text Josh/i.test(t));
  check('…with a Try again button', await page.evaluate(() => !!Array.from(document.querySelectorAll('#page-home .pub-fail button')).find(b => /Try again/.test(b.textContent))));
  check('the Card page shows it too', await page.evaluate(() => { nav('card'); return /Your public page isn't up to date/.test(document.getElementById('page-card').innerText); }));
  check('it\'s remembered on the phone', await page.evaluate(() => JSON.parse(localStorage.getItem('profiles_v1')).publishFail.why === 'denied'));
  await mock('ok', null);
  await page.evaluate(() => { publishNow(); return new Promise(r => setTimeout(r, 150)); });
  t = await home();
  check('Try again publishes and the notice goes away', !/isn't up to date/.test(t) && (await cardWrites()) === 1, t.slice(0, 200));
  check('…and it\'s cleared on the phone', await page.evaluate(() => !JSON.parse(localStorage.getItem('profiles_v1')).publishFail));

  console.log('\n=== Offline, too long ===');
  await start(1000);
  await mock('offline', null);
  await page.evaluate(() => { save(); return new Promise(r => setTimeout(r, 150)); });
  check('offline: it says it will try again', /couldn't reach the internet/.test(await home()));
  await start(1000);
  await mock('ok', null);
  await page.evaluate(() => { P.driver.bio = 'x'.repeat(400); save(); return new Promise(r => setTimeout(r, 150)); });
  t = await home();
  check('too long: it says which field', /isn't up to date/.test(t) && /bio|Bio|long/i.test(t) && (await cardWrites()) === 0, t.slice(0, 300));

  console.log('\n=== On open: a page that fell behind is fixed ===');
  await start(5000);
  const stale = await page.evaluate(() => { const c = (window.firebase = window.firebase || {}) && null; return null; });
  await mock('ok', null);
  const onlineOld = await page.evaluate(() => { const c = cardPayload(); c.teamColor2 = '#ffffff'; c.teamColor3 = '#010713'; c.updatedAt = P.publishedAt; return c; });
  await mock('ok', onlineOld);
  await page.evaluate(() => { _freshAt = 0; return checkPublishedFresh(); });
  const w = await page.evaluate(PID => __writes.find(x => x[0] === 'profiles/' + PID + '/card'), PID);
  check('online copy has old colors, this phone published last: republished with the phone\'s colors', !!w && w[1].teamColor2 === (await page.evaluate(() => P.driver.teamColor2 && cardPayload().teamColor2)), JSON.stringify(w && [w[1].teamColor2, w[1].teamColor3]));
  await page.evaluate(() => { _freshAt = 0; __writes = []; return checkPublishedFresh(); });
  check('once it matches, opening again writes nothing', (await cardWrites()) === 0);
  await page.evaluate(() => { __online = Object.assign({}, __online, { teamColor: '#00aa00', updatedAt: P.publishedAt + 600000 }); _freshAt = 0; __writes = []; return checkPublishedFresh(); });
  check('a card another device published later is never overwritten', (await cardWrites()) === 0);
  await start(5000);
  await mock('denied', await page.evaluate(() => { const c = cardPayload(); c.teamColor2 = '#ffffff'; c.updatedAt = P.publishedAt; return c; }));
  await page.evaluate(() => { _freshAt = 0; return checkPublishedFresh(); });
  check('if the fix on open is refused, the notice shows', /isn't up to date/.test(await home()));
  await mock('ok', await page.evaluate(() => window.__online));
  await page.evaluate(() => { _freshAt = 0; Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); return new Promise(r => setTimeout(r, 250)); });
  check('coming back to the app retries, and it clears', !/isn't up to date/.test(await home()) && (await cardWrites()) === 1);
  await start(0);
  await mock('ok', null);
  await page.evaluate(() => { _freshAt = 0; return checkPublishedFresh(); });
  check('a card that was never published isn\'t published on its own', (await cardWrites()) === 0 && !/isn't up to date/.test(await home()));

  check('no sideways scrolling on a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
