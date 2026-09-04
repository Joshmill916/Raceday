// Regression suite for mainTopIds()'s DNF-promotion fallback (BACKLOG.md item, confirmed
// already fixed in the codebase but previously untested): when fewer drivers get a real
// numeric finish in a B-main than there are transfer spots, a car that started and broke
// down (DNF) is still eligible to fill the remaining spot(s) — the feature must never be
// left short a car just because the leader didn't finish. A driver who never started (DNS)
// or was disqualified (DQ) must NEVER be promoted this way.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8823;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, req.url === '/' ? 'raceday/index.html' : req.url.split('?')[0]);
    fs.readFile(f, (err, data) => {
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

  const seed = async () => page.evaluate(() => {
    hideModal('setupWizard');
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Test Class', maxPill: 20 }];
    S.settings.maxFeature = 4; S.settings.transfers = 2; S.settings.bmainMode = 'single';
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 6; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
    }
    save();
    const res = getRes(1);
    for (let i = 1; i <= 6; i++) res['h1_' + i] = i;   // heat finish order 1..6
    save();
    // maxFeature=4, transfers=2 -> drivers 1,2 lock in directly; 3,4,5,6 race the B-main.
  });

  console.log('\n— A DNF fills a remaining transfer spot when there aren\'t enough real finishers —');
  await seed();
  await page.evaluate(() => {
    const res = getRes(1);
    res['bm_3'] = 'DNF';   // the B-main leader breaks down
    res['bm_4'] = 2;       // only one other car gets a real finish
    save();
  });
  let fd = await page.evaluate(() => featureData(1));
  check('the feature is NOT left short a car', fd.transferred.length === 2, JSON.stringify(fd.transferred));
  check('the DNF driver (started, broke down) IS promoted to fill the gap',
    fd.transferred.map(d => d.id).includes(3), JSON.stringify(fd.transferred));
  check('the real finisher also transfers', fd.transferred.map(d => d.id).includes(4));

  console.log('\n— DNS (never started) is never promoted, even with an open spot —');
  await seed();
  await page.evaluate(() => {
    const res = getRes(1);
    res['bm_3'] = 'DNS';
    res['bm_4'] = 2;
    save();
  });
  fd = await page.evaluate(() => featureData(1));
  check('a DNS driver is NOT promoted (feature legitimately runs one car short)',
    !fd.transferred.map(d => d.id).includes(3), JSON.stringify(fd.transferred));
  check('only the real finisher transfers', fd.transferred.length === 1 && fd.transferred[0].id === 4, JSON.stringify(fd.transferred));

  console.log('\n— DQ (disqualified) is never promoted, even with an open spot —');
  await seed();
  await page.evaluate(() => {
    const res = getRes(1);
    res['bm_3'] = 'DQ';
    res['bm_4'] = 2;
    save();
  });
  fd = await page.evaluate(() => featureData(1));
  check('a DQ driver is NOT promoted', !fd.transferred.map(d => d.id).includes(3), JSON.stringify(fd.transferred));
  check('only the real finisher transfers', fd.transferred.length === 1 && fd.transferred[0].id === 4, JSON.stringify(fd.transferred));

  console.log('\n— Enough real finishers already: a DNF is correctly NOT promoted ahead of them —');
  await seed();
  await page.evaluate(() => {
    const res = getRes(1);
    res['bm_3'] = 'DNF';   // broke down, running order unknown/irrelevant once classified finishers fill both spots
    res['bm_4'] = 1;
    res['bm_5'] = 2;
    save();
  });
  fd = await page.evaluate(() => featureData(1));
  check('the two classified finishers transfer, not the DNF', JSON.stringify(fd.transferred.map(d => d.id).sort()) === JSON.stringify([4, 5]), JSON.stringify(fd.transferred));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
