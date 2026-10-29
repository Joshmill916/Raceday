// Analytics plumbing: the "don't count this device" switch (/me/), the short links that make
// a post's source show up in Cloudflare (/fb/, /li/, /qr/ and their /drivers/ versions), and
// APP_VERSION tracking each app's sw.js CACHE number so crash rows name the real release.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8841;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const TOKEN = '07e858325a984890a4f60c1cec1942bc';

(async () => {
  console.log('\n=== 1. Every page loads analytics through the opt-out check ===');
  const htmlFiles = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      if (/^(node_modules|\.git|tests|test-data|reels)$/.test(f)) continue;
      const p = path.join(d, f), st = fs.statSync(p);
      if (st.isDirectory()) walk(p); else if (f.endsWith('.html')) htmlFiles.push(p);
    }
  })(ROOT);
  const withToken = htmlFiles.filter(f => fs.readFileSync(f, 'utf8').includes(TOKEN));
  const rel = f => path.relative(ROOT, f);
  check('analytics is on 39+ pages (33 site pages + 6 short links)', withToken.length >= 39, withToken.length);
  const direct = withToken.filter(f => /<script[^>]+src=['"]https:\/\/static\.cloudflareinsights\.com/.test(fs.readFileSync(f, 'utf8')));
  check('no page loads the beacon directly (every one checks rd_dont_count first)', direct.length === 0, direct.map(rel).join(', '));
  const unchecked = withToken.filter(f => !fs.readFileSync(f, 'utf8').includes("rd_dont_count"));
  check('every page with the beacon reads rd_dont_count', unchecked.length === 0, unchecked.map(rel).join(', '));
  check('/me/ itself never loads analytics', !fs.readFileSync(path.join(ROOT, 'me/index.html'), 'utf8').includes(TOKEN));
  check('short links are noindex', ['fb', 'li', 'qr', 'fb/drivers', 'li/drivers', 'qr/drivers'].every(d => /name="robots" content="noindex"/.test(fs.readFileSync(path.join(ROOT, d, 'index.html'), 'utf8'))));

  console.log('\n=== 2. APP_VERSION follows each app\'s cache number ===');
  for (const [app, prefix] of [['raceday', 'raceday-v'], ['raceday2', 'raceday2-v'], ['driven', 'driven-v']]) {
    const ver = (fs.readFileSync(path.join(ROOT, app, 'index.html'), 'utf8').match(/const APP_VERSION = '([^']+)'/) || [])[1];
    const cache = (fs.readFileSync(path.join(ROOT, app, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/) || [])[1];
    check(app + ': APP_VERSION (' + ver + ') ends with the sw.js CACHE number (' + cache + ')',
      ver && cache && cache.startsWith(prefix) && ver.endsWith('.v' + cache.slice(prefix.length)) && /^\d{4}-\d{2}-\d{2}\.v\d+$/.test(ver));
  }

  // ---------------------------------------------------------------- browser checks
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const base = `http://localhost:${PORT}`;
  // These pages run on localhost, which every page treats as a dev/test copy and keeps silent.
  // rd_count_local='1' switches reporting back on so this suite can check it (local=false: off).
  const fresh = async (flag, local = true) => {
    const ctx = await browser.newContext();
    if (local) await ctx.addInitScript(() => { try { localStorage.setItem('rd_count_local', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const hits = { beacon: 0, usage: [] };
    await page.route(/cloudflareinsights/, r => { hits.beacon++; r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
    await page.route(/script\.google\.com/, r => { try { const b = JSON.parse(r.request().postData() || '{}'); hits.usage.push(b.event); (hits.rows = hits.rows || []).push(b); } catch (e) { hits.usage.push('?'); } r.fulfill({ status: 200, body: '' }); });
    await page.route(/firebaseio\.com|gstatic\.com|fonts\.googleapis/, r => r.abort());
    page.on('dialog', d => d.accept());
    await page.goto(base + '/me/');
    if (flag) await page.evaluate(() => localStorage.setItem('rd_dont_count', '1'));
    return { ctx, page, hits };
  };

  console.log('\n=== 3. The switch on /me/ ===');
  {
    const { ctx, page } = await fresh(false);
    check('starts as "counted"', /is counted/.test(await page.textContent('#state')));
    await page.click('#btn');
    check('tapping turns counting off and saves it', /not counted/.test(await page.textContent('#state')) && (await page.evaluate(() => localStorage.getItem('rd_dont_count'))) === '1');
    await page.click('#btn');
    check('tapping again turns it back on', (await page.evaluate(() => localStorage.getItem('rd_dont_count'))) === null);
    await page.goto(base + '/me/?off');
    check('/me/?off turns it off in one tap', (await page.evaluate(() => localStorage.getItem('rd_dont_count'))) === '1');
    await ctx.close();
  }

  console.log('\n=== 4. Pages and apps skip analytics on an opted-out device ===');
  for (const p of ['/', '/drivers/', '/driven/', '/guides/', '/raceday/', '/raceday2/']) {
    const on = await fresh(false); await on.page.goto(base + p); await on.page.waitForTimeout(700);
    const off = await fresh(true); await off.page.goto(base + p); await off.page.waitForTimeout(700);
    check(p + ': beacon loads normally, not when opted out', on.hits.beacon >= 1 && off.hits.beacon === 0, on.hits.beacon + ' / ' + off.hits.beacon);
    await on.ctx.close(); await off.ctx.close();
  }

  console.log('\n=== 5. Usage rows: opted-out devices still report, labeled OWNER ===');
  for (const app of ['raceday', 'raceday2']) {
    const on = await fresh(false); await on.page.goto(base + '/' + app + '/'); await on.page.waitForTimeout(900);
    const off = await fresh(true); await off.page.goto(base + '/' + app + '/'); await off.page.waitForTimeout(900);
    const tracks = h => (h.rows || []).map(r => r.track);
    check(app + ': a normal device logs its daily open, track not labeled', on.hits.usage.includes('open') && tracks(on.hits).every(t => !/OWNER/.test(t)), JSON.stringify(tracks(on.hits)));
    await off.page.evaluate(() => { sendUsage('night', {}); reportCrash('Test crash', location.href, 1, 1, null); });
    await off.page.waitForTimeout(400);
    check(app + ': an opted-out device sends opens, nights and crashes', ['open', 'night', 'crash'].every(e => off.hits.usage.includes(e)), JSON.stringify(off.hits.usage));
    check(app + ': …every one labeled OWNER in the track column', tracks(off.hits).length >= 3 && tracks(off.hits).every(t => /^OWNER · /.test(t)), JSON.stringify(tracks(off.hits)));
    await on.ctx.close(); await off.ctx.close();
  }

  console.log('\n=== 5a. Driven reports opens, new profiles and crashes, track column DRIVEN ===');
  {
    const on = await fresh(false); await on.page.goto(base + '/driven/'); await on.page.waitForTimeout(900);
    const tracks = h => (h.rows || []).map(r => r.track);
    check('driven: a normal device logs its daily open as DRIVEN', on.hits.usage.includes('driven-open') && tracks(on.hits).every(t => t === 'DRIVEN'), JSON.stringify(on.hits.rows));
    check('driven: a device with no profile yet says so', (on.hits.rows || []).some(r => r.event === 'driven-open' && r.features === 'no-profile'));
    await on.page.reload(); await on.page.waitForTimeout(700);
    check('driven: only one open per device per day', on.hits.usage.filter(e => e === 'driven-open').length === 1, JSON.stringify(on.hits.usage));
    await on.page.fill('#obName', 'Test Driver'); await on.page.fill('#obEmail', 'test@example.com');
    await on.page.evaluate(() => completeOnboarding()); await on.page.waitForTimeout(400);
    check('driven: making a profile logs driven-profile', on.hits.usage.includes('driven-profile'), JSON.stringify(on.hits.usage));
    check('driven: no name or email ever leaves the device', !JSON.stringify(on.hits.rows).includes('Test Driver') && !JSON.stringify(on.hits.rows).includes('example.com'));
    check('driven: same device id as RaceDay (shared rd_device)', (on.hits.rows || []).every(r => r.device === on.hits.rows[0].device) && await on.page.evaluate(() => localStorage.getItem('rd_device')) === on.hits.rows[0].device);
    const off = await fresh(true); await off.page.goto(base + '/driven/'); await off.page.waitForTimeout(900);
    await off.page.evaluate(() => reportCrash('Test crash', location.href, 1, 1, null)); await off.page.waitForTimeout(400);
    check('driven: an opted-out device sends opens and crashes labeled OWNER · DRIVEN', ['driven-open', 'crash'].every(e => off.hits.usage.includes(e)) && tracks(off.hits).every(t => t === 'OWNER · DRIVEN'), JSON.stringify(tracks(off.hits)));
    await on.ctx.close(); await off.ctx.close();
    const t = await fresh(false, false); await t.page.goto(base + '/driven/'); await t.page.waitForTimeout(900);
    await t.page.evaluate(() => { sendUsage('driven-profile'); reportCrash('Test crash', location.href, 1, 1, null); }); await t.page.waitForTimeout(400);
    check('driven on localhost: nothing sent', t.hits.usage.length === 0, JSON.stringify(t.hits.usage));
    await t.ctx.close();
  }

  console.log('\n=== 5b. A copy on this computer (tests, local preview) reports nothing ===');
  // Regression: on 2026-10-17 a full test run on a Mac with internet logged ~40 fake devices and
  // race nights into the usage sheet. Local hosts must stay silent unless rd_count_local is set.
  for (const p of ['/', '/drivers/', '/raceday/', '/raceday2/']) {
    const t = await fresh(false, false); await t.page.goto(base + p); await t.page.waitForTimeout(900);
    check(p + ' on localhost: no beacon', t.hits.beacon === 0, String(t.hits.beacon));
    await t.ctx.close();
  }
  for (const app of ['raceday', 'raceday2']) {
    const t = await fresh(false, false); await t.page.goto(base + '/' + app + '/'); await t.page.waitForTimeout(900);
    await t.page.evaluate(() => { sendUsage('night', {}); reportCrash('Test crash', location.href, 1, 1, null); });
    await t.page.waitForTimeout(400);
    check(app + ' on localhost: no opens, nights or crashes sent', t.hits.usage.length === 0, JSON.stringify(t.hits.usage));
    check(app + ' on localhost: devHost() is true', await t.page.evaluate(() => devHost()) === true);
    await t.ctx.close();
  }
  {
    const t = await fresh(false, false); await t.page.goto(base + '/fb/');
    await t.page.waitForURL(u => new URL(u).pathname === '/', { timeout: 4000 }).catch(() => {});
    check('/fb/ on localhost forwards with no beacon', new URL(t.page.url()).pathname === '/' && t.hits.beacon === 0, String(t.hits.beacon));
    await t.ctx.close();
  }

  console.log('\n=== 6. Short links record the visit, then forward ===');
  for (const [p, to] of [['/fb/', '/'], ['/li/', '/'], ['/qr/', '/'], ['/fb/drivers/', '/drivers/'], ['/li/drivers/', '/drivers/'], ['/qr/drivers/', '/drivers/']]) {
    const t = await fresh(false);
    await t.page.goto(base + p + '?x=1');
    await t.page.waitForURL(u => new URL(u).pathname === to, { timeout: 4000 }).catch(() => {});
    const u = new URL(t.page.url());
    check(p + ' → ' + to + ' (query kept), beacon loaded first', u.pathname === to && u.search === '?x=1' && t.hits.beacon >= 1, t.page.url() + ' beacon=' + t.hits.beacon);
    await t.ctx.close();
  }
  {
    const t = await fresh(true);
    await t.page.goto(base + '/fb/');
    await t.page.waitForURL(u => new URL(u).pathname === '/', { timeout: 4000 }).catch(() => {});
    check('an opted-out device forwards straight away, no beacon', new URL(t.page.url()).pathname === '/' && t.hits.beacon === 0, t.hits.beacon);
    await t.ctx.close();
  }

  console.log(`\n${fail ? '❌' : '✅'} analytics: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
