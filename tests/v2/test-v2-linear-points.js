// Regression suite for dayPoints()'s "linear" scoring mode — v2 port of
// tests/test-linear-points.js. dayPoints() is copied verbatim from v1 (confirmed by
// direct read) — only the seed/hideModal boilerplate differs.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8826;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  console.log('\n— A short field (well under the configured max) scores by ACTUAL field size —');
  const short = await page.evaluate(() => {
    closeSheet();
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Test Class', maxPill: 20 }];
    S.settings.maxFeature = 20;
    S.settings.points = { mode: 'linear', table: [], beyond: 0 };
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 5; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
    }
    save();
    const res = getRes(1);
    for (let i = 1; i <= 5; i++) { res['h1_' + i] = i; }
    save();
    for (let i = 1; i <= 5; i++) res['ft_' + i] = i;
    save();
    return dayPoints(1);
  });
  check('1st scores the ACTUAL field size (5), not the configured max (20)', short[1] === 5, JSON.stringify(short));
  check('last place scores exactly 1', short[5] === 1, JSON.stringify(short));
  check('every position in between steps down by 1', short[2] === 4 && short[3] === 3 && short[4] === 2, JSON.stringify(short));

  console.log('\n— A field that fills the configured max scores the same either way (sanity check) —');
  const full = await page.evaluate(() => {
    S.classes = [{ id: 1, name: 'Test Class', maxPill: 20 }];
    S.settings.maxFeature = 5;
    S.settings.points = { mode: 'linear', table: [], beyond: 0 };
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 5; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
    }
    save();
    const res = getRes(1);
    for (let i = 1; i <= 5; i++) { res['h1_' + i] = i; }
    save();
    for (let i = 1; i <= 5; i++) res['ft_' + i] = i;
    save();
    return dayPoints(1);
  });
  check('a field that matches the configured max scores identically to the short-field case',
    full[1] === 5 && full[5] === 1, JSON.stringify(full));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
