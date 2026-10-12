// A scanned Driven QR fills the sign-up name and kart number from the driver's published
// card, then asks them to check both — they stay editable, because a driver can run a
// different number (or spelling) tonight and that must only change tonight's entry.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8834;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const PID = 'prof_qrfilltest001';

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(urlPath) === '.js' ? 'application/javascript' : 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  await ctx.route(/script\.google\.com|firebaseio\.com|gstatic\.com|cloudflareinsights/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/raceday2/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Firebase stand-in answering profiles_short/<code> and profiles/<id>/card
  const mock = (table) => page.evaluate((table) => {
    window.firebase = { apps: [{}], database: () => ({ ref: (p) => ({
      once: () => (table.__offline ? Promise.reject(new Error('offline')) : Promise.resolve({ val: () => (p in table ? table[p] : null) })),
      set: () => Promise.resolve(),
    }) }) };
    window.ensureFirebase = () => Promise.resolve();
  }, table);
  const fresh = () => page.evaluate(() => {
    S.track.name = 'QR Test'; save();
    if (typeof closeSheet === 'function') closeSheet();
    nav('signup');
  });
  const fields = () => page.evaluate(() => ({
    name: document.getElementById('dName').value, num: document.getElementById('dNum').value,
    code: document.getElementById('dProfCode').value, note: (document.getElementById('scanNote') || {}).textContent || '',
    noteShown: (document.getElementById('scanNote') || {}).style ? document.getElementById('scanNote').style.display !== 'none' : false,
  }));

  console.log('\n=== 1. A new driver: name and number filled from their Driven card ===');
  await fresh();
  await mock({ ['profiles/' + PID + '/card']: { name: 'Joshua Miller', num: '18', updatedAt: 1 } });
  await page.evaluate((pid) => applyScannedDriven(pid), PID);
  await page.waitForTimeout(150);
  let f = await fields();
  check('name filled from the card', f.name === 'Joshua Miller', f.name);
  check('kart number filled from the card', f.num === '18', f.num);
  check('the Driven link code is filled too', f.code === PID, f.code);
  check('a note asks them to check name and kart number', f.noteShown && /check the name and kart number/i.test(f.note) && /Joshua Miller #18/.test(f.note), f.note);

  console.log('\n=== 2. They change the number for tonight ===');
  await page.fill('#dNum', '18X');
  f = await fields();
  check('the number stays editable', f.num === '18X', f.num);
  check('the Driven link stays attached after editing', f.code === PID, f.code);

  console.log('\n=== 3. A printed short code resolves to the profile first ===');
  await fresh();
  await mock({ 'profiles_short/QRFILL01': PID, ['profiles/' + PID + '/card']: { name: 'Casey Rivera', num: '47A', updatedAt: 1 } });
  await page.evaluate(() => applyScannedDriven('QRFILL01'));
  await page.waitForTimeout(150);
  f = await fields();
  check('short code fills name and number', f.name === 'Casey Rivera' && f.num === '47A', JSON.stringify(f));

  console.log('\n=== 4. A long Driven number is trimmed to what sign-up accepts ===');
  await fresh();
  await mock({ ['profiles/' + PID + '/card']: { name: 'Long Number', num: '12-34567', updatedAt: 1 } });
  await page.evaluate((pid) => applyScannedDriven(pid), PID);
  await page.waitForTimeout(150);
  f = await fields();
  check('number cleaned to letters/digits, 5 max', f.num === '12345', f.num);

  console.log('\n=== 5. A returning driver already linked here is picked from the driver book ===');
  await fresh();
  await page.evaluate((pid) => { const d = { id: genDriverId(), name: 'Book Driver', num: '9', profileId: pid }; S.roster.push(d); save(); }, PID);
  await mock({ ['profiles/' + PID + '/card']: { name: 'Card Name', num: '77', updatedAt: 1 } });
  await page.evaluate((pid) => applyScannedDriven(pid), PID);
  await page.waitForTimeout(150);
  f = await fields();
  check('driver-book record wins (their usual name/number at this track)', f.name === 'Book Driver' && f.num === '9', JSON.stringify(f));

  console.log('\n=== 6. Offline, or no published card ===');
  await fresh();
  await mock({ __offline: true });
  await page.evaluate((pid) => applyScannedDriven(pid), PID);
  await page.waitForTimeout(150);
  f = await fields();
  check('offline: code kept, fields left for typing, clear note', f.code === PID && f.name === '' && /type the name and kart number/i.test(f.note), JSON.stringify(f));
  await fresh();
  await mock({});
  await page.evaluate((pid) => applyScannedDriven(pid), PID);
  await page.waitForTimeout(150);
  f = await fields();
  check('no published card: says so and leaves fields for typing', f.name === '' && /hasn't published/i.test(f.note), f.note);

  console.log(`\n${fail ? '❌' : '✅'} v2 qr-fill: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
