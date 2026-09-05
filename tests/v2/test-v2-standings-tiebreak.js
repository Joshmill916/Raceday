// Regression suite for seriesStandings()'s tie-break countback — v2 port of
// tests/test-standings-tiebreak.js. seriesStandings() is copied verbatim from v1
// (confirmed by direct read) — only the server root differs.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8828;
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

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  const seedHistory = (nights) => page.evaluate((nights) => {
    S.classes = [{ id: 1, name: 'Test Class', maxPill: 20 }];
    S.roster = [];
    S.history = nights.map(n => ({
      date: n.date, savedAt: Date.now(), classes: [{
        name: 'Test Class', pointsRace: true,
        points: n.points.map(p => ({ driverId: p.id, name: 'Driver ' + p.id, num: String(p.id), pts: p.pts })),
        standings: [], feature: [],
        featureFinish: (n.finish || []).map(f => ({ driverId: f.id, name: 'Driver ' + f.id, num: String(f.id), fin: f.fin })),
      }]
    }));
    save();
  }, nights);

  console.log('\n— Tied points, more wins ranks first —');
  await page.evaluate(() => { localStorage.clear(); S = load(); save(); });
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 1, pts: 10 }, { id: 2, pts: 10 }], finish: [{ id: 1, fin: 1 }, { id: 2, fin: 3 }] },
  ]);
  let s = await page.evaluate(() => seriesStandings('Test Class'));
  check('same points, driver with the win ranks first', s[0].name === 'Driver 1' && s[1].name === 'Driver 2', JSON.stringify(s));

  console.log('\n— Tied points AND wins, better best-finish ranks first —');
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 1, pts: 10 }, { id: 2, pts: 10 }], finish: [{ id: 1, fin: 1 }, { id: 2, fin: 1 }] },
    { date: '2026-01-08', points: [{ id: 1, pts: 0 }, { id: 2, pts: 0 }], finish: [{ id: 1, fin: 3 }, { id: 2, fin: 5 }] },
  ]);
  s = await page.evaluate(() => seriesStandings('Test Class'));
  check('same points and wins, better best-ever finish (3rd beats 5th) ranks first',
    s[0].name === 'Driver 1' && s[1].name === 'Driver 2', JSON.stringify(s));

  console.log('\n— Fully tied (points, wins, best finish): falls back to alphabetical —');
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 2, pts: 10 }, { id: 1, pts: 10 }], finish: [{ id: 2, fin: 1 }, { id: 1, fin: 1 }] },
  ]);
  s = await page.evaluate(() => seriesStandings('Test Class'));
  check('identical in every countback field, Driver 1 sorts before Driver 2 alphabetically',
    s[0].name === 'Driver 1' && s[1].name === 'Driver 2', JSON.stringify(s));

  console.log('\n— A "Fix season points" repair night (no finish data) never wins the countback unfairly —');
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 1, pts: 8 }], finish: [{ id: 1, fin: 2 }] },
    { date: '2026-01-08', points: [{ id: 2, pts: 8 }], finish: [] },
  ]);
  s = await page.evaluate(() => seriesStandings('Test Class'));
  check('a driver with real finish data outranks one with none, at equal points',
    s[0].name === 'Driver 1' && s[1].name === 'Driver 2', JSON.stringify(s));

  console.log('\n— Two drivers who ONLY ever appear via repair nights: no finish data for either, alphabetical holds —');
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 2, pts: 8 }], finish: [] },
    { date: '2026-01-08', points: [{ id: 1, pts: 8 }], finish: [] },
  ]);
  s = await page.evaluate(() => seriesStandings('Test Class'));
  check('neither has any countback data, falls back to alphabetical (Driver 1 first)',
    s[0].name === 'Driver 1' && s[1].name === 'Driver 2', JSON.stringify(s));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
