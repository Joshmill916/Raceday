// Regression suite for seriesStandings()'s tie-break countback (BACKLOG.md Low item):
// tied points used to fall straight to an alphabetical sort. Now it's points, then wins,
// then best-ever feature finish, THEN alphabetical — sourced from feature finish
// position (never points), and gracefully degrading to alphabetical when neither tied
// driver has any real finish data to compare (e.g. both only ever appear via a
// hand-entered "Fix season points" repair night, which carries no finish info at all).
//
// History entries are constructed directly (not raced through the live UI) — the exact
// shape buildSnapshot() writes — so each scenario can hit an exact points tie without
// fighting the real scoring pipeline across several nights.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8827;
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

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // One archived-night class entry: {date, points:[{driverId,name,num,pts}], finish:[{driverId,name,num,fin}]}
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
  // Driver 1's only appearance is a real archived night (a genuine 2nd place finish).
  // Driver 2's only appearance is a hand-entered repair night with the SAME points but
  // no finish data at all (featureFinish: []) — Driver 1's real, if modest, finish must
  // still beat Driver 2's total absence of countback data.
  await seedHistory([
    { date: '2026-01-01', points: [{ id: 1, pts: 8 }], finish: [{ id: 1, fin: 2 }] },
    { date: '2026-01-08', points: [{ id: 2, pts: 8 }], finish: [] },   // repair entry: no featureFinish at all
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
