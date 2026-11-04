// Demo visits must be provable in the usage sheet. Regression for a real case: a prospect
// used the demo and nothing in the sheet showed it — their rows read track 'unknown' (same
// as any unlicensed track), the demo's seeded sample night reported as a real 'night', a
// second visit the same day sent nothing, and nothing said what they looked at.
// Now: demo rows say DEMO (or 'DEMO · <label>' from a personal ?demo=1&for= link), seeding
// sends 'demo-start' and no 'night', and every visit sends a 'demo-use' row (tabs opened +
// seconds) when the page is hidden. Both app versions (/raceday/ and /raceday2/).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8862;
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
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  // One browser profile = one visitor's phone. rows collects every usage row it sends.
  const visitor = async (ownerDevice) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(o => { try { localStorage.setItem('rd_count_local', '1'); if (o) localStorage.setItem('rd_dont_count', '1'); } catch (e) {} }, !!ownerDevice);
    const rows = [];
    await ctx.route(/script\.google\.com/, r => { try { rows.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} r.fulfill({ status: 200, body: '' }); });
    await ctx.route(/cloudflareinsights|firebaseio\.com|gstatic\.com|fonts\.googleapis/, r => r.abort());
    return { ctx, rows };
  };
  const open = async (v, url) => {
    const page = await v.ctx.newPage();
    page.on('pageerror', e => errors.push(url + ': ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}${url}`);
    await page.waitForTimeout(900);
    return page;
  };
  const leave = async page => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);
  };
  const tabs = page => page.evaluate(() => {
    // the tabs this app version's current role can open, minus the current one
    const ids = typeof allowedPages === 'function' ? allowedPages().map(n => n.id) : (ROLE_PAGES[deviceRole()] || []);
    return ids.filter(p => p !== curPage && p !== 'admin').slice(0, 2);
  });

  for (const app of ['raceday', 'raceday2']) {
    console.log(`\n=== /${app}/: personal demo link ===`);
    const v = await visitor(false);
    let page = await open(v, `/${app}/?demo=1&for=Riverside%20Speedway`);
    const visited = await tabs(page);
    for (const t of visited) await page.evaluate(t => nav(t), t);
    await leave(page);
    const ev = v.rows.map(r => r.event);
    check('seeding sends demo-start', ev.includes('demo-start'), JSON.stringify(ev));
    check('the sample night is NOT reported as a race night', !ev.includes('night'), JSON.stringify(ev));
    check('every row labeled DEMO · Riverside Speedway', v.rows.length >= 3 && v.rows.every(r => r.track === 'DEMO · Riverside Speedway'), JSON.stringify(v.rows.map(r => r.track)));
    const use = v.rows.filter(r => r.event === 'demo-use');
    check('leaving sends one demo-use row', use.length === 1, String(use.length));
    check('demo-use lists the tabs they opened', use[0] && visited.every(t => use[0].features.split(',').includes(t)), use[0] && use[0].features + ' vs ' + visited);
    check('demo-use has time on page', use[0] && typeof use[0].secs === 'number' && use[0].secs >= 0);
    await leave(page);
    check('hiding again with nothing new sends nothing more', v.rows.filter(r => r.event === 'demo-use').length === 1);
    await page.close();

    console.log(`=== /${app}/: same visitor comes back later that day ===`);
    v.rows.length = 0;
    page = await open(v, `/${app}/?demo=1&for=Riverside%20Speedway`);
    await leave(page);
    check('return visit still reports (demo-use)', v.rows.some(r => r.event === 'demo-use' && r.track === 'DEMO · Riverside Speedway'), JSON.stringify(v.rows.map(r => r.event + '/' + r.track)));
    check('return visit does not re-seed', !v.rows.some(r => r.event === 'demo-start'));
    await page.close();
    await v.ctx.close();

    console.log(`=== /${app}/: plain demo link, owner device, exit demo ===`);
    const plain = await visitor(false);
    page = await open(plain, `/${app}/?demo=1`);
    await leave(page);
    check('plain demo link labels rows DEMO', plain.rows.length && plain.rows.every(r => r.track === 'DEMO'), JSON.stringify(plain.rows.map(r => r.track)));
    check('junk in for= is stripped', await page.evaluate(() => { noteDemoFor('<b>x</b>"\''); return demoLabel(); }) === 'DEMO · bxb');
    const exited = await page.evaluate(() => { clearDemoResidue(); save(); return { demo: S.demo, label: localStorage.getItem('rd_demo_for') }; });
    check('exiting demo clears the label', exited.demo === false && exited.label === null);
    plain.rows.length = 0;
    await page.evaluate(() => sendUsage('open', {}));
    await page.waitForTimeout(200);
    check('after exit, rows are a normal track again', plain.rows[0] && plain.rows[0].track === 'unknown' && plain.rows[0].demo === false, JSON.stringify(plain.rows[0]));
    await page.close(); await plain.ctx.close();
    const own = await visitor(true);
    page = await open(own, `/${app}/?demo=1&for=Test`);
    await leave(page);
    check('owner testing the demo still labeled OWNER first', own.rows.length && own.rows.every(r => r.track === 'OWNER · DEMO · Test'), JSON.stringify(own.rows.map(r => r.track)));
    await page.close(); await own.ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n✅ demo-tracking: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
