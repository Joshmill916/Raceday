// Driven: "Finish your card". Most cards were only a name (Nov 2026: 5 of 42 had a photo), so Home
// shows a checklist of the free fields fans, sponsors and tracks see (photo, kart number, hometown,
// a line about you, sponsors), each jumping to its field in Settings. "Not now" hides it on Home for
// 7 days; the Card page keeps a one-line reminder. Age is never asked for; a hidden hometown counts.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8857;
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
      res.writeHead(200, { 'Content-Type': u.endsWith('.js') ? 'application/javascript' : 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
  page.on('dialog', d => d.accept());
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { localStorage.clear(); $id('obName').value = 'Casey Rivera'; completeOnboarding(); nav('home'); });
  await page.waitForTimeout(200);

  const home = () => page.evaluate(() => { const c = document.querySelector('#page-home .dv-finish'); return c ? c.innerText : ''; });
  const mini = () => page.evaluate(() => { const c = document.querySelector('#page-card .fc-mini'); return c ? c.innerText : ''; });
  const counts = () => page.evaluate(() => { const l = cardChecklist(); return { done: l.filter(i => i.done).length, total: l.length, keys: l.map(i => i.key) }; });

  console.log('\n=== A new driver with only a name ===');
  let t = await home();
  check('Home shows "Finish your card"', /Finish your card/i.test(t), t.slice(0, 80));
  const c0 = await counts();
  check('the checklist is photo, kart number, hometown, bio, sponsors (never age)', JSON.stringify(c0.keys) === '["photo","number","hometown","bio","sponsors"]', JSON.stringify(c0.keys));
  check('…and says how many are done', t.includes(c0.done + ' of 5 done'), t.slice(0, 120));
  check('no sideways scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  console.log('\n=== "Add" jumps to the field ===');
  await page.evaluate(() => [...document.querySelectorAll('#page-home .dv-finish .fc-row')].find(r => /Kart number/.test(r.innerText)).querySelector('button').click());
  await page.waitForTimeout(150);
  check('Kart number → Settings, with the number box focused', await page.evaluate(() => $id('page-settings').classList.contains('active') && document.activeElement && document.activeElement.id === 'stNumber'));
  await page.evaluate(() => nav('home'));
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 2000 }).catch(() => null),
    page.evaluate(() => [...document.querySelectorAll('#page-home .dv-finish .fc-row')].find(r => /Your photo/.test(r.innerText)).querySelector('button').click()),
  ]);
  check('Your photo → the photo picker opens in the same tap', !!chooser);

  console.log('\n=== Filling things in moves it forward ===');
  await page.evaluate(() => nav('settings'));
  await page.fill('#stNumber', '47'); await page.fill('#stBio', 'Racing since I was eight.');
  await page.evaluate(() => saveProfileFields()); await page.waitForTimeout(200);
  await page.evaluate(() => nav('home'));
  const c1 = await counts();
  check('number + bio count as done', c1.done === c0.done + 2, JSON.stringify(c1));
  t = await home();
  check('Home shows the new count', t.includes(c1.done + ' of 5 done'), t.slice(0, 120));

  console.log('\n=== A hidden hometown counts as done (privacy) ===');
  await page.evaluate(() => { P.driver.hometown = ''; P.driver.showHome = false; save(); nav('home'); });
  check('hometown is done when the driver chose to hide it', (await page.evaluate(() => cardChecklist().find(i => i.key === 'hometown').done)) === true);
  await page.evaluate(() => { P.driver.showHome = true; save(); nav('home'); });
  check('…and missing again when it is shown but empty', (await page.evaluate(() => cardChecklist().find(i => i.key === 'hometown').done)) === false);

  console.log('\n=== "Not now" and the Card page reminder ===');
  await page.evaluate(() => [...document.querySelectorAll('#page-home .dv-finish button')].find(b => /Not now/.test(b.textContent)).click());
  check('"Not now" hides it on Home', (await home()) === '');
  await page.evaluate(() => nav('card'));
  const m = await mini();
  check('the Card page still lists what is missing', /Your card is missing:/.test(m) && /photo/.test(m) && /sponsors/.test(m), m);
  await page.evaluate(() => setPreviewPro(true));
  check('…but not on the Preview Pro view', (await mini()) === '');
  await page.evaluate(() => { setPreviewPro(false); });
  await page.evaluate(() => { localStorage.setItem('dv_finish_hide', '2020-01-01'); nav('home'); });
  check('it comes back on Home after a week', /Finish your card/i.test(await home()));

  console.log('\n=== A finished card is left alone ===');
  await page.evaluate(() => {
    P.driver.photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    P.driver.hometown = 'Fort Wayne, IN'; P.sponsors = [{ name: 'Smith Auto' }]; save(); nav('home');
  });
  check('no checklist on Home when all five are done', (await home()) === '');
  await page.evaluate(() => nav('card'));
  check('no reminder on the Card page either', (await mini()) === '');

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
