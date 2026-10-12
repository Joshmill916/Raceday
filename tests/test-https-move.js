// http:// vs https://victoryraceday.com are separate origins with separate localStorage. Checks,
// in a real browser with the site's hostname mapped to a local server:
//  - content pages and apps with no data on http forward to https
//  - an app WITH data on http stays put and offers "Move this track"; the move carries the data
//    to https (origin-checked postMessage) and the secure page opens with it
//  - if the secure side already holds a different track, declining keeps it untouched
// https:// requests are answered from the repo files by request interception (a real https
// origin to the browser), http:// is served by a local server via --host-resolver-rules.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8835;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const fileFor = (urlPath) => path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
const typeFor = (p) => ({ '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' }[path.extname(p)] || 'text/html');

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(fileFor(urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': typeFor(urlPath) }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--host-resolver-rules=MAP victoryraceday.com:80 127.0.0.1:' + PORT] });
  const newCtx = async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/victoryraceday\.com\//, async r => {
      const u = new URL(r.request().url());
      try { r.fulfill({ status: 200, contentType: typeFor(u.pathname), body: fs.readFileSync(fileFor(u.pathname)) }); }
      catch (e) { r.fulfill({ status: 404, body: '' }); }
    });
    await ctx.route(/script\.google\.com|firebaseio\.com|gstatic\.com|cloudflareinsights/, r => r.abort());
    return ctx;
  };

  // A real, loadable saved track built from the app's own defaults() on the secure origin.
  const realTrack = async (ctx, app, name, withDriver) => {
    const p = await ctx.newPage(); p.on('dialog', d => d.accept());
    await p.goto('https://victoryraceday.com/' + app + '/'); await p.waitForTimeout(600);
    const json = await p.evaluate(({ name, withDriver }) => {
      const s = defaults(); s.track.name = name;
      if (withDriver) s.roster.push({ id: 'drv_kept1', name: 'Kept Driver', num: '7' });
      return JSON.stringify(s);
    }, { name, withDriver });
    await p.evaluate(() => localStorage.clear());
    await p.close();
    return json;
  };

  // ---------------------------------------------------------------- content pages
  console.log('\n=== Content pages ===');
  {
    const ctx = await newCtx(); const p = await ctx.newPage();
    for (const pg of ['/pricing.html', '/guides/', '/drivers/', '/field-manual.html']) {
      await p.goto('http://victoryraceday.com' + pg + '?x=1'); await p.waitForTimeout(300);
      check(pg + ' forwards to https (no data on http)', p.url() === 'https://victoryraceday.com' + pg + '?x=1', p.url());
    }
    await ctx.close();
  }

  for (const app of ['raceday', 'raceday2']) {
    const KEY = app === 'raceday' ? 'raceday_v1' : 'raceday_v2';
    console.log('\n=== ' + app + ' ===');
    // ---- no data on http → forward
    {
      const ctx = await newCtx(); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
      await p.goto('http://victoryraceday.com/' + app + '/'); await p.waitForTimeout(500);
      check('app with no data on http forwards to https', p.url().startsWith('https://victoryraceday.com/' + app + '/'), p.url());
      await ctx.close();
    }
    // ---- data on http → banner, then move
    {
      const ctx = await newCtx(); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
      await p.goto('http://victoryraceday.com/' + app + '/sw.js');   // any page on the http origin to seed storage
      const oldTrack = await realTrack(ctx, app, 'Old Address Speedway', true);
      await p.evaluate(({ KEY, oldTrack }) => {
        localStorage.setItem(KEY, oldTrack);
        localStorage.setItem('rd_url_applied', '?role=scoring&sync=OLDROOM');   // station setup that must follow the track
      }, { KEY, oldTrack });
      await p.goto('http://victoryraceday.com/' + app + '/'); await p.waitForTimeout(900);
      check('app with data on http stays on http', p.url().startsWith('http://victoryraceday.com/'), p.url());
      check('"Move this track" banner is offered', await p.evaluate(() => !!document.getElementById('secureMoveBtn')));
      const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#secureMoveBtn')]);
      pop.on('dialog', d => d.accept());
      await pop.waitForLoadState('domcontentloaded');
      await p.waitForFunction(() => /Moved/.test((document.getElementById('secureMoveText') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      await pop.waitForTimeout(900);
      const moved = await pop.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return { name: s && s.track && s.track.name, driver: s && s.roster && s.roster[0] && s.roster[0].name, station: localStorage.getItem('rd_url_applied'), url: location.href }; }, KEY);
      check('track data arrived on https', moved.name === 'Old Address Speedway' && moved.driver === 'Kept Driver', JSON.stringify(moved));
      check('station setup came across with the track', moved.station === '?role=scoring&sync=OLDROOM', moved.station);
      check('secure page reloaded without ?receive', /\/$/.test(moved.url) && !/receive/.test(moved.url), moved.url);
      check('old tab confirms the move', /Moved/.test(await p.evaluate(() => document.getElementById('secureMoveText').textContent)));
      check('old tab keeps its copy (nothing deleted)', await p.evaluate((KEY) => !!localStorage.getItem(KEY), KEY));
      await ctx.close();
    }
    // ---- secure side already has a different track → decline keeps it
    {
      const ctx = await newCtx();
      const secureTrack = await realTrack(ctx, app, 'Secure Side Raceway', false);
      const oldTrack = await realTrack(ctx, app, 'Old Address Speedway', false);
      const p = await ctx.newPage();
      await p.goto('https://victoryraceday.com/' + app + '/sw.js');
      await p.evaluate(({ KEY, secureTrack }) => localStorage.setItem(KEY, secureTrack), { KEY, secureTrack });
      await p.goto('http://victoryraceday.com/' + app + '/sw.js');
      await p.evaluate(({ KEY, oldTrack }) => localStorage.setItem(KEY, oldTrack), { KEY, oldTrack });
      p.on('dialog', d => d.accept());
      await p.goto('http://victoryraceday.com/' + app + '/'); await p.waitForTimeout(900);
      const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#secureMoveBtn')]);
      let asked = '';
      pop.on('dialog', d => { if (d.type() === 'confirm') { asked = d.message(); d.dismiss(); } else d.accept(); });
      await p.waitForFunction(() => /Not moved/.test((document.getElementById('secureMoveText') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      await pop.waitForTimeout(400);
      check('asked before replacing a different secure-side track', /Secure Side Raceway/.test(asked) && /Old Address Speedway/.test(asked), asked);
      const kept = await pop.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).track.name, KEY);
      check('declining keeps the secure-side track', kept === 'Secure Side Raceway', kept);
      check('old tab reports nothing was changed', /Not moved/.test(await p.evaluate(() => document.getElementById('secureMoveText').textContent)));
      await ctx.close();
    }
    // ---- the secure page ignores a move from anywhere but the old site
    {
      const ctx = await newCtx(); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
      await p.goto('https://victoryraceday.com/' + app + '/'); await p.waitForTimeout(600);
      const ignored = await p.evaluate((KEY) => new Promise(res => {
        const before = localStorage.getItem(KEY);
        window.postMessage({ type: 'rd-move', key: KEY, payload: { [KEY]: '{"track":{"name":"Injected"}}' } }, '*');
        setTimeout(() => res(localStorage.getItem(KEY) === before), 400);
      }), KEY);
      check('a move message from the wrong origin is ignored', ignored);
      await ctx.close();
    }
  }

  console.log(`\n${fail ? '❌' : '✅'} https-move: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
