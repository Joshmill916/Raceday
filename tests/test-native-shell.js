// Native app shell (native/, Capacitor): the same raceday/index.html runs from
// capacitor://localhost or https://localhost on a phone. Guards the native-only shims:
// links/QRs for OTHER devices must point at the public site (not localhost), the service
// worker stays off, usage rows still send (devHost() would otherwise treat "localhost" as a
// dev copy), and a launch link reloads once with its query, then never loops. On the plain
// web (no window.Capacitor) every shim must be a no-op. Also: files save through the share
// sheet (a cancelled backup isn't counted), print sheets render over the app and print the
// live page, and there are no Buy buttons in the native build.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8851;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

// Stand-in for the Capacitor bridge, injected before the page's own scripts like the real one.
const fakeCapacitor = launchUrl => `
  window.__calls = [];
  window.__shareCancel = false;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: (ev, fn) => { if (ev === 'appUrlOpen') window.__rdOpen = fn; },
        getLaunchUrl: () => Promise.resolve(${launchUrl ? `{ url: ${JSON.stringify(launchUrl)} }` : 'undefined'})
      },
      Filesystem: { writeFile: o => { __calls.push(['writeFile', o]); return Promise.resolve({ uri: 'file:///cache/' + o.path }); } },
      Share: { share: o => { __calls.push(['share', o]); return __shareCancel ? Promise.reject(new Error('Share canceled')) : Promise.resolve({}); } },
      Printer: { printWebView: o => { __calls.push(['print', o]); return new Promise(r => { window.__printDone = r; }); } }
    }
  };`;

(async () => {
  let docHits = [];
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/raceday/') docHits.push(req.url);
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const open = async (native, launchUrl) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
    if (native) await ctx.addInitScript(fakeCapacitor(launchUrl));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}/raceday/`);
    await page.waitForTimeout(800);
    return { ctx, page };
  };

  console.log('\n=== web (no Capacitor): shims are no-ops ===');
  {
    const { ctx, page } = await open(false);
    const r = await page.evaluate(() => ({ nat: isNativeApp(), base: appBaseUrl(), dev: devHost() }));
    check('isNativeApp() is false', r.nat === false);
    check('appBaseUrl() is this page', r.base === `http://localhost:${PORT}/raceday/`, r.base);
    check('devHost() still true on localhost', r.dev === true);
    await ctx.close();
  }

  console.log('\n=== native: links, telemetry, service worker ===');
  {
    const { ctx, page } = await open(true);
    const r = await page.evaluate(async () => ({
      nat: isNativeApp(), base: appBaseUrl(), dev: devHost(),
      sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0
    }));
    check('isNativeApp() is true', r.nat === true);
    check('appBaseUrl() is the public site', r.base === 'https://victoryraceday.com/raceday/', r.base);
    check('devHost() false so usage rows send', r.dev === false);
    check('no service worker registered', r.sw === 0, 'registrations=' + r.sw);
    // Root-relative site links go to the public site, not into the app bundle.
    const nav = await page.evaluate(() => {
      const a = document.createElement('a'); a.href = '/?home=1'; a.textContent = 'x';
      document.body.appendChild(a);
      let went = null;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      went = ev.defaultPrevented;
      a.remove();
      return went;
    });
    check('site link click is intercepted', nav === true);
    await ctx.close();
  }

  console.log('\n=== native: launch link applies once, no reload loop ===');
  {
    const link = 'https://victoryraceday.com/raceday/?sync=NATIVETEST&role=viewer';
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
    await ctx.addInitScript(fakeCapacitor(link));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    docHits = [];
    await page.goto(`http://localhost:${PORT}/raceday/`);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({
      role: deviceRole(),
      flag: sessionStorage.getItem('rd_link_opened'),
      search: location.search
    }));
    check('launch link applied (device became spectator)', r.role === 'viewer', r.role);
    check('link remembered for this session', r.flag === link);
    check('page reloaded exactly once, with the link query', docHits.length === 2 && docHits[1] === '/raceday/?sync=NATIVETEST&role=viewer', docHits.join(', '));
    check('query cleared after apply', r.search === '', r.search);
    await ctx.close();
  }

  console.log('\n=== native: files go to the share sheet ===');
  {
    const { ctx, page } = await open(true);
    const r = await page.evaluate(async () => {
      S.lastBackupAt = 0;
      __shareCancel = true; exportBackup();
      await new Promise(r => setTimeout(r, 100));
      const afterCancel = S.lastBackupAt;
      __shareCancel = false; __calls.length = 0; exportBackup();
      await new Promise(r => setTimeout(r, 100));
      const w = __calls.find(c => c[0] === 'writeFile'), sh = __calls.find(c => c[0] === 'share');
      __calls.length = 0; exportAuditCSV();
      await new Promise(r => setTimeout(r, 100));
      const csv = __calls.find(c => c[0] === 'writeFile');
      return { afterCancel, after: S.lastBackupAt, w: w && w[1], sh: sh && sh[1], csv: csv && csv[1] };
    });
    check('cancelled backup share is not counted as a backup', r.afterCancel === 0, String(r.afterCancel));
    check('completed backup share is counted', r.after > 0);
    check('backup written to app cache as UTF-8', r.w && r.w.directory === 'CACHE' && r.w.encoding === 'utf8' && /^raceday-backup-.*\.json$/.test(r.w.path), JSON.stringify(r.w && { p: r.w.path, d: r.w.directory }));
    check('backup content is the full state', r.w && JSON.parse(r.w.data).schemaVersion !== undefined);
    check('share sheet gets the written file', r.sh && r.sh.files && r.sh.files[0] === 'file:///cache/' + r.w.path);
    check('CSV exports use the same path', r.csv && /^raceday-audit-.*\.csv$/.test(r.csv.path));
    await ctx.close();
  }

  console.log('\n=== native: printing ===');
  {
    const { ctx, page } = await open(true);
    await page.evaluate(() => printDrivenPoster());
    await page.waitForTimeout(100);
    const during = await page.evaluate(() => {
      const host = document.getElementById('rdPrintSheet');
      const sr = host && host.shadowRoot;
      return {
        host: !!host, printing: document.documentElement.classList.contains('rd-printing'),
        text: sr ? sr.textContent : '', img: !!(sr && sr.querySelector('img[src^="data:image/png"]')),
        css: sr ? sr.querySelector('style').textContent : '',
        call: __calls.filter(c => c[0] === 'print').map(c => c[1].name)
      };
    });
    check('print sheet drawn over the app', during.host && during.printing);
    check('sheet holds the poster with its QR image', /Scan to get the free app/.test(during.text) && during.img);
    check('sheet CSS scoped (body → .rd-print-body)', /\.rd-print-body\{font-family/.test(during.css) && !/(^|})body\{/.test(during.css));
    check('app page printed with the sheet title', during.call.length === 1 && /^Get Driven/.test(during.call[0]), JSON.stringify(during.call));
    await page.emulateMedia({ media: 'print' });
    const vis = await page.evaluate(() => ({
      app: [...document.body.children].filter(e => e.id !== 'rdPrintSheet' && e.tagName !== 'SCRIPT').every(e => getComputedStyle(e).display === 'none'),
      sheet: getComputedStyle(document.getElementById('rdPrintSheet')).display !== 'none'
    }));
    check('print media shows only the sheet', vis.app && vis.sheet, JSON.stringify(vis));
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => __printDone());
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ host: !!document.getElementById('rdPrintSheet'), printing: document.documentElement.classList.contains('rd-printing') }));
    check('sheet removed when the print dialog closes', !after.host && !after.printing);
    await page.evaluate(() => printDrivenPoster());
    await page.waitForTimeout(100);
    const closed = await page.evaluate(() => {
      const btn = document.getElementById('rdPrintSheet').shadowRoot.querySelector('.rd-print-close');
      btn.click();
      return !document.getElementById('rdPrintSheet') && !document.documentElement.classList.contains('rd-printing');
    });
    check('Close button removes a stuck print sheet', closed);
    check('no Buy buttons in the native build', await page.evaluate(() => licBuyLinksHtml() === ''));
    await ctx.close();
  }

  console.log('\n=== web: unchanged ===');
  {
    const { ctx, page } = await open(false);
    const r = await page.evaluate(() => { S.lastBackupAt = 0; exportBackup(); return { bk: S.lastBackupAt, buy: licBuyLinksHtml() }; });
    check('web backup still counted immediately', r.bk > 0);
    check('web still shows Buy buttons', /buy\.stripe\.com/.test(r.buy));
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), page.evaluate(() => printDrivenPoster())]);
    check('web printing still opens a print tab', !!popup && !(await page.evaluate(() => !!document.getElementById('rdPrintSheet'))));
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n✅ native-shell: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
