// v2 sign-up: scan a driver's Driven QR with the camera.
// The camera is simulated (a canvas stream showing a real QR image), so the decoder, the
// overlay, the permission-denied path and the stop-the-camera behaviour are all exercised.
// Real phones/tablets still need a hands-on check (see the plan's verification list).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8824;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
const qrDataUrl = f => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'tests/fixtures', f)).toString('base64');

// Runs in the page before any app script: a stand-in camera that shows the given QR.
const fakeCamera = ({ src, deny }) => {
  window.__qrSrc = src;
  window.__camDeny = deny;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__camDeny) { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; }
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const ctx = cv.getContext('2d'); const img = new Image(); img.src = window.__qrSrc; await img.decode();
    const paint = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); ctx.drawImage(img, 120, 40, 400, 400); };
    paint(); setInterval(paint, 80);
    window.__camStream = cv.captureStream(12);
    return window.__camStream;
  };
};

(async () => {
  const server = http.createServer((req, res) => {
    let rel = req.url === '/' ? 'raceday2/index.html' : decodeURIComponent(req.url.split('?')[0]).slice(1);
    if (rel.endsWith('/')) rel += 'index.html';
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const url = `http://localhost:${PORT}/raceday2/?demo=1`;

  // Opens sign-up with the Driven link box expanded and returns the page.
  const openSignup = async (src, deny = false) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());
    await ctx.addInitScript(fakeCamera, { src, deny });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(url); await page.waitForTimeout(800);
    await page.evaluate(() => { nav('signup'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const d = [...document.querySelectorAll('details')].find(x => /Driven link code/.test(x.textContent)); if (d) d.open = true; });
    return { ctx, page, errs };
  };
  const scanBtnIn = page => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Scan Driven QR/.test(x.textContent)); return !!b; });
  const trackEnded = page => page.evaluate(() => !!window.__camStream && window.__camStream.getTracks().every(t => t.readyState === 'ended'));

  // ---- 1. a Driven QR fills the link box and closes the scanner
  console.log('— Scan a Driven QR —');
  {
    const { ctx, page, errs } = await openSignup(qrDataUrl('qr-driven.png'));
    check('the sign-up Driven link box has a Scan button', await scanBtnIn(page));
    // Read the overlay straight after the tap: a clean scan closes it within a second.
    await page.evaluate(() => { window.__openSeen = false; const h = document.getElementById('scanHost');
      new MutationObserver(() => { if (h.classList.contains('on')) window.__openSeen = true; }).observe(h, { attributes: true, attributeFilter: ['class'] });
      if (h.classList.contains('on')) window.__openSeen = true; });
    await page.click('button:has-text("Scan Driven QR")');
    check('tapping Scan opens the camera overlay', await page.evaluate(() => window.__openSeen || document.getElementById('scanHost').classList.contains('on')));
    await page.waitForFunction(() => document.getElementById('dProfCode').value === 'prof_oz0yws5pjmal', null, { timeout: 15000 }).catch(() => {});
    const val = await page.evaluate(() => document.getElementById('dProfCode').value);
    check('the scanned id fills the Driven link box', val === 'prof_oz0yws5pjmal', 'got "' + val + '"');
    check('the overlay closes after a successful scan', await page.evaluate(() => !document.getElementById('scanHost').classList.contains('on')));
    check('the link box is opened so the staff member can see it', await page.evaluate(() => { const el = document.getElementById('dProfCode'); return !!el.closest('details').open; }));
    check('the camera is switched off after a scan', await trackEnded(page));
    check('no page errors during the scan', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---- 2. a QR that isn't a Driven code keeps scanning, then Cancel stops the camera
  console.log('— Other QR codes and cancelling —');
  {
    const { ctx, page } = await openSignup(qrDataUrl('qr-other.png'));
    await page.click('button:has-text("Scan Driven QR")');
    await page.waitForFunction(() => /isn't a Driven code/.test(document.getElementById('scanMsg').textContent), null, { timeout: 15000 }).catch(() => {});
    check('a non-Driven QR shows a clear message', await page.evaluate(() => /isn't a Driven code/.test(document.getElementById('scanMsg').textContent)));
    check('a non-Driven QR leaves the link box empty', await page.evaluate(() => document.getElementById('dProfCode').value === ''));
    check('the scanner stays open after a wrong code', await page.evaluate(() => document.getElementById('scanHost').classList.contains('on')));
    await page.click('#scanHost button:has-text("Cancel")');
    await page.waitForTimeout(200);
    check('Cancel closes the overlay', await page.evaluate(() => !document.getElementById('scanHost').classList.contains('on')));
    check('Cancel switches the camera off', await trackEnded(page));
    check('Cancel leaves the link box empty', await page.evaluate(() => document.getElementById('dProfCode').value === ''));
    await ctx.close();
  }

  // ---- 3. camera permission refused: explained, nothing stuck
  console.log('— Camera refused —');
  {
    const { ctx, page } = await openSignup(qrDataUrl('qr-driven.png'), true);
    await page.click('button:has-text("Scan Driven QR")');
    await page.waitForFunction(() => /permission was blocked/.test(document.getElementById('scanMsg').textContent), null, { timeout: 5000 }).catch(() => {});
    check('a refused camera explains how to fix it', await page.evaluate(() => /permission was blocked/.test(document.getElementById('scanMsg').textContent)));
    check('the typed link box still works after a refusal', await page.evaluate(() => { const el = document.getElementById('dProfCode'); el.value = 'K7Q2M4XN'; return el.value === 'K7Q2M4XN'; }));
    await ctx.close();
  }

  // ---- 4. the decoder is local (no external script) and cached for offline use
  console.log('— Offline and bundling —');
  {
    const html = fs.readFileSync(path.join(ROOT, 'raceday2/index.html'), 'utf8');
    check('the scanner is loaded from the same site, not a CDN', !/src=["']https?:\/\/[^"']*jsqr/i.test(html));
    const sw = fs.readFileSync(path.join(ROOT, 'raceday2/sw.js'), 'utf8');
    check('the service worker precaches the scanner file', sw.includes("'./vendor/jsqr.min.js'"));
    check('the scanner file is present in the repo', fs.existsSync(path.join(ROOT, 'raceday2/vendor/jsqr.min.js')));
  }

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
