// Driven: "Add to home screen". Android/Chrome gives an install prompt — the button fires it.
// iPhone has no prompt — the button shows the Share → Add to Home Screen steps. The card is
// gone once Driven runs from the home screen, "Not now" hides it on Home (Settings keeps it).
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8852;
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
  const open = async (opts) => {
    const ctx = await browser.newContext(opts || { viewport: { width: 400, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
    page.on('dialog', d => d.accept());
    await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
    await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(() => { localStorage.clear(); $id('obName').value = 'Kaden Harper'; completeOnboarding(); nav('home'); });
    await page.waitForTimeout(200);
    return { ctx, page };
  };
  const cardText = page => page.evaluate(() => { const c = document.querySelector('#page-home .dv-install'); return c ? c.innerText : ''; });

  console.log('\n=== Android / Chrome: real install prompt ===');
  let { ctx, page } = await open();
  check('Home shows the add-to-home-screen card', /Put Driven on your home screen/i.test(await cardText(page)));
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(e);
  });
  await page.evaluate(() => [...document.querySelectorAll('#page-home .dv-install button')].find(b => /Add to home screen/.test(b.textContent)).click());
  await page.waitForTimeout(100);
  check('the button opens the phone\'s install prompt', await page.evaluate(() => window.__prompted === true));
  await page.evaluate(() => nav('settings'));
  check('Settings also offers it', await page.evaluate(() => !!document.querySelector('#page-settings .dv-install')));
  await ctx.close();

  console.log('\n=== Browser with no prompt: shows the steps ===');
  ({ ctx, page } = await open());
  await page.evaluate(() => installDriven());
  check('menu steps shown', /Add to Home screen|Install app/.test(await cardText(page)), await cardText(page));
  await page.evaluate(() => hideInstallCard());
  check('"Not now" hides it on Home', (await cardText(page)) === '');
  await page.evaluate(() => nav('settings'));
  check('…but Settings still has it', await page.evaluate(() => !!document.querySelector('#page-settings .dv-install')));
  await ctx.close();

  console.log('\n=== iPhone: Share → Add to Home Screen ===');
  ({ ctx, page } = await open(Object.assign({}, devices['iPhone 13'], { defaultBrowserType: undefined })));
  await page.evaluate(() => installDriven());
  const ios = await cardText(page);
  check('iPhone gets the Share steps', /Share/.test(ios) && /Add to Home Screen/.test(ios), ios);
  check('no sideways scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();

  console.log('\n=== Opened from the home screen ===');
  ({ ctx, page } = await open());
  await page.evaluate(() => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); renderHome(); nav('settings'); });
  check('no card once it\'s on the home screen', await page.evaluate(() => !document.querySelector('.dv-install')));
  await ctx.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
