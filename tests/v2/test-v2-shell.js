// v2 shell: the 900px responsive breakpoint (left rail vs. bottom tab bar) and a
// clean-boot check with no console errors. New in v2 — v1 has no equivalent (it was a
// fixed 860px column, not a responsive rail/tabbar shell) — flagged as an untested gap
// in an earlier audit this session (PARITY.md frames it as "Left rail (tablet/desktop) /
// bottom tab bar (phone)", but the actual switch is a single 900px cliff: a real tablet
// width like 768px iPad-portrait gets the phone-style tabbar, not the rail — not
// necessarily wrong, just not as clean a tablet/phone split as the framing implies).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8822;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'text/plain' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const base = `http://localhost:${PORT}/`;

  const shellAt = async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.evaluate(() => { S.track.name = 'T'; S.adminPin = ''; save(); });
    await page.reload();
    await page.waitForTimeout(400);
    const shape = await page.evaluate(() => {
      const rail = document.getElementById('rail');
      const tabbar = document.getElementById('tabbar');
      return {
        railVisible: rail && getComputedStyle(rail).display !== 'none',
        tabbarVisible: tabbar && getComputedStyle(tabbar).display !== 'none',
      };
    });
    await page.close();
    return { shape, errs };
  };

  console.log('\n=== The 900px breakpoint: rail vs. bottom tab bar ===');

  const w768 = await shellAt(768);
  check('768px (iPad portrait): NOT the rail layout — gets the phone-style tabbar instead (below the 900px cliff)',
    !w768.shape.railVisible && w768.shape.tabbarVisible, JSON.stringify(w768.shape));

  const w899 = await shellAt(899);
  check('899px (just under the cliff): tabbar layout', !w899.shape.railVisible && w899.shape.tabbarVisible, JSON.stringify(w899.shape));

  const w900 = await shellAt(900);
  check('900px (the cliff itself, inclusive per min-width:900px): rail layout', w900.shape.railVisible && !w900.shape.tabbarVisible, JSON.stringify(w900.shape));

  const w1280 = await shellAt(1280);
  check('1280px (clearly desktop): rail layout', w1280.shape.railVisible && !w1280.shape.tabbarVisible, JSON.stringify(w1280.shape));

  console.log('\n=== Clean boot: no console errors at any width, fresh install ===');
  check('768px fresh boot: zero page errors', w768.errs.length === 0, JSON.stringify(w768.errs));
  check('900px fresh boot: zero page errors', w900.errs.length === 0, JSON.stringify(w900.errs));
  check('1280px fresh boot: zero page errors', w1280.errs.length === 0, JSON.stringify(w1280.errs));

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` v2 shell: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
