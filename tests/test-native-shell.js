// Native app shell (native/, Capacitor): the same raceday/index.html runs from
// capacitor://localhost or https://localhost on a phone. Guards the native-only shims:
// links/QRs for OTHER devices must point at the public site (not localhost), the service
// worker stays off, usage rows still send (devHost() would otherwise treat "localhost" as a
// dev copy), and a launch link reloads once with its query, then never loops. On the plain
// web (no window.Capacitor) every shim must be a no-op.
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
  window.__rdLinks = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { App: {
      addListener: (ev, fn) => { if (ev === 'appUrlOpen') window.__rdOpen = fn; },
      getLaunchUrl: () => Promise.resolve(${launchUrl ? `{ url: ${JSON.stringify(launchUrl)} }` : 'undefined'})
    } }
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

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n✅ native-shell: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
