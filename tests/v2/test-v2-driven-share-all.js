// Sharing a night with Driven sends EVERY linked driver who raced, not only the feature
// finishers (11/7: a 19-car class with a B-main sent 5 drivers). Feature finishers keep
// their spot, feature DNF/DNS/DQ follow, then heats/B-main-only drivers in heat-standings
// order — each with a numeric position (the database rules require one). A past night can
// be shared again from Admin → Race day history.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8849;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url.split('?')[0] === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('  ⚠️ page error:', e.message); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // A night: 6 entered. Feature: A P1, B P2, C DNF. D and E only ran heats (E ahead of D
  // in the standings). F entered but isn't linked to Driven.
  const snap = {
    date: '2026-11-07', classes: [{
      name: 'Stock',
      standings: [{ name: 'A', num: '1' }, { name: 'B', num: '2' }, { name: 'C', num: '3' }, { name: 'E', num: '5' }, { name: 'D', num: '4' }, { name: 'F', num: '6' }],
      feature: [{ driverId: 1, name: 'A', num: '1' }, { driverId: 2, name: 'B', num: '2' }, { driverId: 3, name: 'C', num: '3' }],
      featureResults: [{ driverId: 1, name: 'A', num: '1', fin: 1 }, { driverId: 2, name: 'B', num: '2', fin: 2 }, { driverId: 3, name: 'C', num: '3', fin: 'DNF' }],
      featureFinish: [{ driverId: 1, name: 'A', num: '1', fin: 1 }, { driverId: 2, name: 'B', num: '2', fin: 2 }],
      points: [1, 2, 3, 4, 5, 6].map(i => ({ driverId: i, name: 'ABCDEF'[i - 1], num: String(i), pts: 10 - i }))
    }],
    pairs: [1, 2, 3, 4, 5, 6].map(i => ({ driverId: i, classId: 9, className: 'Stock' }))
  };

  console.log('\n— Overall finishing order —');
  const order = await page.evaluate(s => nightFinishOrder(s, s.classes[0]).map(r => r.name + ':' + r.fin).join(' '), snap);
  check('feature finishers, then the DNF, then heat-only drivers in standings order', order === 'A:1 B:2 C:3 E:4 D:5 F:6', order);
  const oldSnap = await page.evaluate(s => { const c = JSON.parse(JSON.stringify(s.classes[0])); delete c.featureResults; const t = Object.assign({}, s); delete t.pairs; return nightFinishOrder(t, c).map(r => r.name + ':' + r.fin).join(' '); }, snap);
  check('an older night (no featureResults / pairs) still includes everyone from its points', oldSnap === 'A:1 B:2 C:3 E:4 D:5 F:6', oldSnap);

  console.log('\n— Sharing sends every linked driver —');
  const shared = await page.evaluate(s => {
    S.demo = true;
    S.roster = [1, 2, 3, 4, 5, 6].map(i => ({ id: i, name: 'ABCDEF'[i - 1], num: String(i), profileId: i === 6 ? undefined : 'prof_test0000' + i }));
    S.history = [s];
    shareResultsWithDriven(0);
    return S.history[0].published;
  }, snap);
  check('5 linked drivers shared (the unlinked one is skipped)', dialogs.some(m => /5 drivers/.test(m)), dialogs.join(' | '));
  check('the night is marked shared', shared === true);

  console.log('\n— Share again from Race day history —');
  const btn = await page.evaluate(() => { nav('admin'); admOpen('history'); renderHistory(); const b = [...document.querySelectorAll('#historyList button')].find(x => /Share/.test(x.textContent)); return b ? b.textContent : null; });
  check('history shows "Share again" on a shared night', btn === 'Share again', String(btn));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
