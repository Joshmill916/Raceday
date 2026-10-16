// v2: passing-points heat scoring and per-class points tables.
// Passing points = finish points + points for every spot gained from the heat's starting
// grid (set 1 as drawn, set 2 reversed); most points wins, ties go to the pill draw.
// A class can also carry its own feature points table instead of the track's series table.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8834;
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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Six cars, one heat (heat size 8), pills 1-6 → set 1 starts in pill order, set 2 reversed.
  // Heat 1: finishes run in reverse pill order. Heat 2: pill order, #6 DNF.
  const seed = (scoring) => page.evaluate((scoring) => {
    closeSheet();
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20 }, { id: 2, name: 'Stock', maxPill: 20 }];
    if (scoring) Object.assign(S.classes[0], scoring);
    S.settings.maxHeat = 8; S.settings.maxFeature = 20; S.settings.invert = 0;
    S.settings.points = { mode: 'fixed', table: [10, 8, 6, 5, 4, 3, 2, 1], beyond: 0 };
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 6; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
      S.roster.push({ id: 100 + i, name: 'Stock ' + i, num: String(100 + i) });
      S.raceDay.entries.push({ driverId: 100 + i, classId: 2, pill: i });
    }
    const res = getRes(1);
    [6, 5, 4, 3, 2, 1].forEach((id, i) => { res['h1_' + id] = i + 1; });
    [1, 2, 3, 4, 5].forEach((id, i) => { res['h2_' + id] = i + 1; });
    res['h2_6'] = 'DNF';
    save();
    return calcStandings(1).map(s => ({ id: s.id, pts: s.pts }));
  }, scoring);

  console.log('\n— Heat totals (the default) are unchanged —');
  {
    const st = await seed(null);
    check('default scoring keeps low-total-wins order', st.map(s => s.id).join() === '1,2,3,4,5,6', JSON.stringify(st));
    check('default heat totals are summed finishes (DNF = heat size + 1)', st[0].pts === 7 && st[5].pts === 8, JSON.stringify(st));
  }

  console.log('\n— Passing points —');
  {
    const st = await seed({ heatScoring: 'passing', passing: { finish: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], perSpot: 1 } });
    const pts = Object.fromEntries(st.map(s => [s.id, s.pts]));
    check('#6 gets 10 finish + 5 gained in heat 1 (started 6th, won) and 0 for a DNF', pts[6] === 15, JSON.stringify(pts));
    check('#1 gets 15 in heat 2 (started 6th after the reverse, won) + 5 in heat 1', pts[1] === 20, JSON.stringify(pts));
    check('losing spots never goes negative (#3: 7 + 9)', pts[3] === 16, JSON.stringify(pts));
    check('most points wins; ties go to the pill draw', st.map(s => s.id).join() === '1,2,5,3,4,6', st.map(s => s.id).join());
    const feat = await page.evaluate(() => featureGridOrder(featureData(1), 1).map(r => r.id).join());
    check('the feature lines up from passing-points standings', feat === '1,2,5,3,4,6', feat);
    const other = await page.evaluate(() => calcStandings(2).every(s => s.pts === 0));
    check('another class in the same night is unaffected', other);
  }
  {
    const st = await seed({ heatScoring: 'passing', passing: { finish: [10, 9, 8, 7, 6, 5], perSpot: 2 } });
    const pts = Object.fromEntries(st.map(s => [s.id, s.pts]));
    check('points per spot gained is configurable (#6: 10 + 5×2)', pts[6] === 20, JSON.stringify(pts));
  }
  {
    const zero = await page.evaluate(() => { const c = classById(1); c.heats = 0; return isPassing(c); });
    check('a qualifying-only class (no heats) never uses passing points', zero === false);
  }

  console.log('\n— Score page and lineups say how the class is scored —');
  {
    await seed({ heatScoring: 'passing', passing: { finish: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], perSpot: 1 } });
    const txt = await page.evaluate(() => { resTab = 1; nav('results'); return document.getElementById('resultsWrap') ? document.getElementById('resultsWrap').textContent : document.body.textContent; });
    check('the Score page header says passing points, most wins', /Passing points/.test(txt) && /most wins/.test(txt));
    const grid = await page.evaluate(() => { nav('grid'); return document.body.textContent; });
    check('the lineup tags cars with passing points', /Passing pts/.test(grid));
    const snap = await page.evaluate(() => buildSnapshot().classes.find(c => c.name === 'Late Model').heatScoring);
    check('the archived night records how heats were scored', snap === 'passing', snap);
  }

  console.log('\n— Per-class points table —');
  {
    await seed(null);
    const dp = await page.evaluate(() => {
      const r1 = getRes(1), r2 = getRes(2);
      for (let i = 1; i <= 6; i++) { r1['ft_' + i] = i; r2['ft_' + (100 + i)] = i; }
      classById(1).points = { mode: 'fixed', table: [5, 3, 1], beyond: 0 };
      save();
      return { a: dayPoints(1), b: dayPoints(2) };
    });
    check('a class with its own table scores on it (podium 5-3-1)', dp.a[1] === 5 && dp.a[2] === 3 && dp.a[3] === 1 && dp.a[4] === 0, JSON.stringify(dp.a));
    check('a class without one keeps the track table (10-8-6…)', dp.b[101] === 10 && dp.b[102] === 8, JSON.stringify(dp.b));
    const series = await page.evaluate(() => seriesStandings('Late Model')[0].pts);
    check('season standings use the class table', series === 5, series);
    const lin = await page.evaluate(() => { classById(1).points = { mode: 'linear', table: [], beyond: 0 }; return dayPoints(1)[1]; });
    check('a class can use full-field linear while the track uses fixed', lin === 6, lin);
  }

  console.log('\n— Race classes settings —');
  {
    await seed(null);
    const ui = await page.evaluate(() => {
      nav('admin'); admOpen('classes');
      const out = {};
      out.hasScoring = /Heat scoring/.test(document.getElementById('clsList').textContent);
      out.hasTable = /Points table/.test(document.getElementById('clsList').textContent);
      setClassScoring(1, 'passing'); out.passOn = classById(1).heatScoring === 'passing' && passingCfg(classById(1)).perSpot === 1;
      setClassPassing(1, 'finish', '20 15, 10'); out.finish = classById(1).passing.finish.join();
      setClassPassing(1, 'perSpot', '2'); out.perSpot = classById(1).passing.perSpot;
      setClassPassing(1, 'perSpot', '-3'); out.perSpotBad = classById(1).passing.perSpot;
      setClassScoring(1, 'finish'); out.passOff = classById(1).heatScoring === undefined;
      setClassPointsPreset(1, 'podium'); out.podium = classPointsCfg(1).table.join();
      setClassPointsPreset(1, 'custom'); setClassPointsTable(1, '12,9,7,abc,5'); out.custom = classPointsCfg(1).table.join();
      setClassPointsBeyond(1, '2'); out.beyond = classPointsCfg(1).beyond;
      out.customUi = /Custom for this class/.test(document.getElementById('clsList').textContent);
      setClassPointsPreset(1, ''); out.back = classById(1).points === undefined && classPointsCfg(1) === S.settings.points;
      return out;
    });
    check('Race classes shows Heat scoring and Points table options', ui.hasScoring && ui.hasTable);
    check('switching a class to passing points sets sensible defaults', ui.passOn);
    check('finish points accept spaces or commas', ui.finish === '20,15,10', ui.finish);
    check('points per spot gained saves', ui.perSpot === 2, ui.perSpot);
    check('a negative per-spot value falls back to the default', ui.perSpotBad === 1, ui.perSpotBad);
    check('switching back removes passing points', ui.passOff);
    check('picking a preset gives the class that table', ui.podium === '5,3,1', ui.podium);
    check('a custom table drops anything that is not a number', ui.custom === '12,9,7,5', ui.custom);
    check('the custom "everyone else" value saves', ui.beyond === 2, ui.beyond);
    check('choosing Track default removes the class table', ui.back);
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
