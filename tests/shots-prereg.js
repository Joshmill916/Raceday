// Regenerates the pre-registration guide screenshots (guides/img/prereg-*.jpg, drivers/img/prereg-*.jpg).
// Run: PW=<path to playwright> CH=<path to Chromium> node tests/shots-prereg.js
const { chromium } = require(process.env.PW);
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8861;
const CLASSES = [{ id: 1, name: 'Predator', maxPill: 200 }, { id: 2, name: 'Stock Appearing', maxPill: 200 }, { id: 3, name: 'Clone 360', maxPill: 200 }, { id: 4, name: 'Kid Kart', maxPill: 200 }];
const G = path.join(ROOT, 'guides/img'), D = path.join(ROOT, 'drivers/img');
(async () => {
  const server = http.createServer((req, res) => {
    let rel = req.url.split('?')[0]; if (rel === '/') rel = '/raceday2/index.html'; if (rel.endsWith('/')) rel += 'index.html';
    fs.readFile(path.join(ROOT, rel), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': rel.endsWith('.svg') ? 'image/svg+xml' : rel.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(data); });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: process.env.CH });
  const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' };
  const shot = async (page, file, sel, pad) => {
    if (sel) await page.evaluate(([s, p]) => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - (p || 12)); }, [sel, pad]);
    await page.evaluate(() => { try { if (typeof closeSheet === 'function' && document.querySelector('.sheet')) closeSheet(); } catch (e) {} const t = document.getElementById('toastHost'); if (t) t.innerHTML = ''; });
    await page.waitForTimeout(350);
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    console.log('saved', path.basename(file));
  };

  /* Driver: entry page */
  const cfg = { open: true, title: 'Winter Indoor Series · Race #1', date: 'Sunday, Nov 22 · gates 8 AM', tx: true, waiver: 'I understand karting has risks and I accept the series rules. Entry fees are paid at the gate.', note: '$25 per class, paid at the gate', closes: Date.now() + 5 * 864e5, updatedAt: 1 };
  const dctx = await browser.newContext(ctxOpts); const ep = await dctx.newPage();
  await ep.route(/cloudflareinsights/, r => r.abort());
  await ep.route(/firebaseio\.com/, r => {
    const p = new URL(r.request().url()).pathname;
    const json = v => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (r.request().method() === 'POST') return json({ name: '-Entry1' });
    if (p === '/preRegOpen/ROOM1.json') return json(cfg);
    if (p.endsWith('/classes.json')) return json(JSON.stringify(CLASSES));
    if (p.endsWith('/track.json')) return json(JSON.stringify({ name: 'Winter Indoor' }));
    if (p === '/profiles_short/ABCD1234.json') return json('prof_abcd1234xyz');
    if (p === '/profiles/prof_abcd1234xyz/card.json') return json({ name: 'Casey Rivera', num: '47', updatedAt: 1 });
    return json(null);
  });
  await ep.goto(`http://localhost:${PORT}/enter/?ROOM1`); await ep.waitForSelector('#nm'); await ep.waitForTimeout(500);
  await shot(ep, path.join(D, 'prereg-open.jpg'));
  await ep.fill('#dv', 'abcd1234'); await ep.click('text=Fill in'); await ep.waitForTimeout(300);
  await ep.fill('#tx', '4417382');
  await shot(ep, path.join(D, 'prereg-driven.jpg'), '#dv', 120);
  await ep.click('text=Predator'); await ep.click('text=Stock Appearing'); await ep.check('#ok');
  await shot(ep, path.join(D, 'prereg-classes.jpg'), '#go', 560);
  await ep.click('#go'); await ep.waitForSelector('text=You\'re pre-entered'); await ep.evaluate(() => scrollTo(0, 0));
  await shot(ep, path.join(D, 'prereg-done.jpg'));
  await dctx.close();

  /* Track: RaceDay 2 */
  const tctx = await browser.newContext(ctxOpts); const app = await tctx.newPage();
  app.on('dialog', d => d.accept()); app.on('pageerror', e => console.log('ERR', e.message));
  await app.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await app.goto(`http://localhost:${PORT}/`); await app.waitForTimeout(500);
  await app.evaluate(classes => {
    localStorage.setItem('rd_role_v2', 'admin');
    S.classes = classes; S.roster = [{ id: 501, name: 'Drew Mason', num: '8D', noPoints: false, profileId: 'prof_dm12345678' }];
    S.settings.preReg = []; S.raceDay.entries = []; S.track.name = 'Winter Indoor';
    S.sync = { enabled: true, key: 'ROOM1', staffKey: '' }; save();
    window.__fb = { entries: {} }; loadFirebase = () => Promise.resolve(); Staff.ok = true;
    window.firebase = { apps: [1], database: () => ({ ref: p => ({ set: () => Promise.resolve(), update: () => Promise.resolve(),
      once: () => Promise.resolve({ val: () => (p === 'preRegIn/ROOM1' ? JSON.parse(JSON.stringify(__fb.entries)) : null) }) }) }) };
    const o = preOnline(); Object.assign(o, { title: 'Winter Indoor Series · Race #1', date: 'Sunday, Nov 22 · gates 8 AM', note: '$25 per class, paid at the gate', waiver: 'I understand karting has risks and I accept the series rules. Entry fees are paid at the gate.', tx: true, closes: Date.now() + 5 * 864e5 });
    save(); Sync.connected = true; try { renderHeader(); } catch (e) {} nav('admin'); admOpen('prereg');
  }, CLASSES);
  await app.waitForTimeout(400);
  await shot(app, path.join(G, 'prereg-setup.jpg'), '#preregWrap', 110);
  await app.evaluate(() => { preOnlineOpen(true); }); await app.waitForTimeout(300);
  await app.evaluate(() => { UI.preQROn = true; renderPrereg(); }); await app.waitForTimeout(400);
  await shot(app, path.join(G, 'prereg-open.jpg'), '#preQR', 420);
  await app.evaluate(() => {
    const t = Date.now();
    __fb.entries = {
      e1: { name: 'Casey Rivera', num: '47', tx: '4417382', classes: '1,2', driven: 'ABCD1234', waiver: true, at: t - 9e6 },
      e2: { name: 'Drew Mason', num: '8D', tx: '', classes: '1', waiver: true, at: t - 8e6 },
      e3: { name: 'Riley Banks', num: '13', tx: '3302291', classes: '3', want: 'Senior Animal', waiver: true, at: t - 7e6 },
      e4: { name: 'Sam Ortega', num: '22', tx: '', classes: '4', waiver: true, at: t - 6e6 },
      e5: { name: 'Jordan Pike', num: '5', tx: '2210874', classes: '2,3', waiver: true, at: t - 5e6 }
    };
    UI.preQROn = false; UI.prePulled = 0; preOnlinePull(false);
  });
  await app.waitForTimeout(600);
  await app.evaluate(() => renderPrereg()); await app.waitForTimeout(300);
  await shot(app, path.join(G, 'prereg-entries.jpg'), '#preregWrap .card:last-child', 110);
  await app.evaluate(() => { nav('signup'); }); await app.waitForTimeout(500);
  await shot(app, path.join(G, 'prereg-checkin-list.jpg'), '#preCard', 110);
  await app.evaluate(() => preCheckIn(S.settings.preReg.findIndex(p => p.name === 'Jordan Pike'))); await app.waitForTimeout(300);
  await shot(app, path.join(G, 'prereg-checkin.jpg'), '#scanNote', 140);
  await browser.close(); server.close();
})();
