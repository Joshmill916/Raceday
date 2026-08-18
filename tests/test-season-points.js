// Season-long points-accuracy verification.
//
// Built because a track's actual season points didn't add up (they'd never archived a
// race day, and later needed real vs. backfilled nights combined). This test exists to
// answer, mechanically, "are the season totals RaceDay shows actually correct?" — not by
// re-running the app's own dayPoints()/seriesStandings() math against itself (that would
// just prove the code agrees with itself), but by computing every night's expected points
// with a SEPARATE, independently-written reference model, driving a full multi-week season
// through the real app (real newRaceDay() archiving + the "Fix season points" repair path),
// and diffing the app's actual output against the reference — driver by driver, class by
// class, for the whole season.
//
// Covers, in one continuous season: two classes scored independently, a mid-season points
// TABLE change (earlier nights must keep their original point values, not get recalculated
// under the new table), a driver marked noPoints partway through (earlier nights they
// legitimately scored must still count; later nights must not), a DNF (no recorded finish
// scores 0/"beyond", not skipped), a driver joining mid-season (only scores from when they
// join), and a real archived night sitting alongside a "Fix season points" backfilled night
// in the same series.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8804;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

// ---------- Independent reference model (deliberately NOT calling the app's own code) ----------
// Mirrors dayPoints()'s fixed-mode table lookup, written from scratch: position 1 gets
// table[0], etc.; anything outside the table (or no recorded finish at all) gets `beyond`.
function refPointsForFinish(table, beyond, pos) {
  if (pos == null) return beyond;
  return (pos >= 1 && pos <= table.length) ? table[pos - 1] : beyond;
}

const TABLE_A = [10, 8, 6, 5, 4, 3, 2, 1];   // "Standard"
const TABLE_B = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];   // "F1-style" — the mid-season switch

// The season, as data. Each entry is one calendar race day. `junior`/`senior` list driver
// ids in FINISHING ORDER for that class that night (a driver entered-but-DNF'd is listed
// separately in `dnf` and must still show up in the field with 0/"beyond" points, not be
// silently dropped). `noPointsFrom` marks a roster-level exclusion taking effect starting
// that night (inclusive). `newDriver` marks a driver who only starts existing from that night.
const SEASON = [
  { date: '2026-04-06', table: TABLE_A, junior: [101, 102, 103, 104, 105, 106], senior: [201, 202, 203, 204, 205] },
  { date: '2026-04-13', table: TABLE_A, junior: [106, 101, 105, 102, 104, 103], senior: [205, 201, 204, 202, 203] },
  { date: '2026-04-20', table: TABLE_A, junior: [102, 104, 101, 106, 103], juniorDnf: [105], senior: [203, 205, 202, 201, 204] },
  // --- table switches to TABLE_B here; driver 104 marked noPoints starting this night ---
  { date: '2026-04-27', table: TABLE_B, junior: [101, 103, 105, 106, 102, 104], noPointsFrom: 104, senior: [201, 203, 202, 205, 204] },
  { date: '2026-05-04', table: TABLE_B, junior: [103, 101, 106, 105, 102], senior: [204, 201, 205, 203, 202] },   // 104 stops attending entirely
  { date: '2026-05-11', table: TABLE_B, junior: [107, 101, 103, 105, 106, 102], newDriver: 107, senior: [202, 204, 201, 203, 205] },
];
// A night the track never ran through the app, backfilled afterward via "Fix season points"
// — direct point entry, no finish positions. Dated before the season above (matches the
// real-world case: a night that predates when the track started using RaceDay).
const IMPORTED_NIGHT = { date: '2026-04-01', class: 'Junior Sprint', points: { 101: 10, 102: 8, 103: 6, 106: 5 } };

const ROSTER = [
  { id: 101, name: 'J1 Adams', num: '1' }, { id: 102, name: 'J2 Brooks', num: '2' },
  { id: 103, name: 'J3 Chen', num: '3' }, { id: 104, name: 'J4 Diaz', num: '4' },
  { id: 105, name: 'J5 Evans', num: '5' }, { id: 106, name: 'J6 Foster', num: '6' },
  { id: 107, name: 'J7 Grant', num: '7' },
  { id: 201, name: 'S1 Hale', num: '11' }, { id: 202, name: 'S2 Ibarra', num: '12' },
  { id: 203, name: 'S3 Jones', num: '13' }, { id: 204, name: 'S4 Kim', num: '14' },
  { id: 205, name: 'S5 Lopez', num: '15' },
].map(d => Object.assign({ noPoints: false }, d));

// Compute the whole season's expected totals independently of the app.
function computeExpected() {
  const junior = {}, senior = {};   // driverId -> { pts, days }
  const bump = (agg, id, pts) => { if (!agg[id]) agg[id] = { pts: 0, days: 0 }; agg[id].pts += pts; agg[id].days++; };
  const noPoints = new Set();
  SEASON.forEach(night => {
    if (night.noPointsFrom != null) noPoints.add(night.noPointsFrom);
    night.junior.forEach((id, i) => {
      if (noPoints.has(id)) return;   // excluded entirely from this and later nights
      bump(junior, id, refPointsForFinish(night.table, 0, i + 1));
    });
    (night.juniorDnf || []).forEach(id => { if (!noPoints.has(id)) bump(junior, id, refPointsForFinish(night.table, 0, null)); });
    night.senior.forEach((id, i) => bump(senior, id, refPointsForFinish(night.table, 0, i + 1)));
  });
  Object.entries(IMPORTED_NIGHT.points).forEach(([id, pts]) => bump(junior, Number(id), pts));
  return { junior, senior };
}

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const f = path.join(ROOT, urlPath === '/' ? 'raceday/index.html' : urlPath);
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));

  let answer = () => false;
  page.on('dialog', async d => {
    let r;
    try { r = answer(d.message(), d.type()); } catch (e) { r = false; }
    if (typeof r === 'string') await d.accept(r);
    else if (r === true) await d.accept();
    else await d.dismiss();
  });

  const base = `http://localhost:${PORT}/`;
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await go(base);
  await page.waitForTimeout(400);

  // ============================================================================
  console.log('\n=== Seeding a fresh track: 2 classes, 12 drivers, no PIN (admin role) ===');
  await page.evaluate((roster) => {
    localStorage.clear();
    S = load();
    S.track.name = 'Test Speedway';
    S.classes = [{ id: 1, name: 'Junior Sprint', maxPill: 30, maxFeature: 30 }, { id: 2, name: 'Senior Stock', maxPill: 30, maxFeature: 30 }];
    S.roster = roster;
    S.settings.points = { mode: 'fixed', table: [10, 8, 6, 5, 4, 3, 2, 1], beyond: 0 };
    S.history = [];
    S.raceDay = { date: '2026-04-06', entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    save();
  }, ROSTER);
  await page.waitForTimeout(200);

  console.log('\n=== Running the season through the real archive path (newRaceDay) ===');
  answer = (m) => {
    if (/Start a new race day/i.test(m)) return true;    // confirm the archive
    if (/Back up first/i.test(m)) return false;          // skip the download-a-file prompt
    // The DNF night (105 entered, no feature finish) trips archiveDay()'s incomplete-
    // points warning — real admin behavior is to archive anyway, so the DNF still lands
    // in history at 0/"beyond" rather than the whole night silently failing to archive.
    if (/Feature not fully entered/i.test(m)) return true;
    return false;
  };
  for (const night of SEASON) {
    const result = await page.evaluate((n) => {
      const entries = [];
      let pill = 1;
      n.junior.forEach(id => entries.push({ driverId: id, classId: 1, pill: pill++ }));
      (n.juniorDnf || []).forEach(id => entries.push({ driverId: id, classId: 1, pill: pill++ }));
      n.senior.forEach(id => entries.push({ driverId: id, classId: 2, pill: pill++ }));
      S.raceDay = { date: n.date, entries, heatResults: {}, pointsRace: { 1: true, 2: true }, resultGov: {}, resultVersions: {} };
      S.settings.points.table = n.table;   // the mid-season table switch actually has to be applied, not just recorded in the season data
      n.junior.forEach((id, i) => { getRes(1)['ft_' + id] = i + 1; });
      n.senior.forEach((id, i) => { getRes(2)['ft_' + id] = i + 1; });
      // juniorDnf drivers deliberately get NO ft_ key — that's what "DNF, no recorded finish" is.
      if (n.noPointsFrom != null) { const d = driverById(n.noPointsFrom); if (d) d.noPoints = true; }
      save();
      const histBefore = S.history.length;
      newRaceDay();
      return { archived: S.history.length > histBefore, historyLen: S.history.length };
    }, night);
    check('night ' + night.date + ' archived (real newRaceDay path)', result.archived, JSON.stringify(result));
  }

  console.log('\n=== Backfilling the pre-season night via "Fix season points" ===');
  await page.evaluate(() => { nav('admin'); adminOpen('adm-import'); });   // populates #impClass's options
  await page.evaluate((n) => {
    document.getElementById('impDate').value = n.date;
    document.getElementById('impClass').value = '1';
    _impRows = Object.entries(n.points).map(([id, pts]) => {
      const d = driverById(Number(id));
      return { driverId: Number(id), name: d.name, num: d.num, pts };
    });
    renderImpRows();
    saveImportedRace();
  }, IMPORTED_NIGHT);
  const importedOk = await page.evaluate((date) => S.history.some(h => h.date === date && h.imported), IMPORTED_NIGHT.date);
  check('backfilled night landed in history', importedOk);

  // ============================================================================
  console.log('\n=== Comparing seriesStandings() against the independent reference model ===');
  const expected = computeExpected();
  const nameOf = (id) => ROSTER.find(d => d.id === id).name;

  const actualJunior = await page.evaluate(() => seriesStandings('Junior Sprint').map(r => ({ name: r.name, pts: r.pts, days: r.days })));
  const actualSenior = await page.evaluate(() => seriesStandings('Senior Stock').map(r => ({ name: r.name, pts: r.pts, days: r.days })));
  const actualJuniorByName = Object.fromEntries(actualJunior.map(r => [r.name, r]));
  const actualSeniorByName = Object.fromEntries(actualSenior.map(r => [r.name, r]));

  Object.entries(expected.junior).forEach(([id, exp]) => {
    const name = nameOf(Number(id));
    const act = actualJuniorByName[name];
    check('Junior Sprint — ' + name + ' total points = ' + exp.pts,
      !!act && act.pts === exp.pts, act ? ('got ' + act.pts) : 'driver missing from standings entirely');
    check('Junior Sprint — ' + name + ' race-day count = ' + exp.days,
      !!act && act.days === exp.days, act ? ('got ' + act.days) : 'driver missing');
  });
  check('Junior Sprint — driver 104 (noPoints from night 4) does NOT appear with post-exclusion points bleeding in',
    actualJuniorByName['J4 Diaz'] && actualJuniorByName['J4 Diaz'].pts === expected.junior[104].pts);
  check('Junior Sprint — no extra/unexpected drivers in standings',
    actualJunior.length === Object.keys(expected.junior).length, 'got ' + actualJunior.length + ' expected ' + Object.keys(expected.junior).length);

  Object.entries(expected.senior).forEach(([id, exp]) => {
    const name = nameOf(Number(id));
    const act = actualSeniorByName[name];
    check('Senior Stock — ' + name + ' total points = ' + exp.pts,
      !!act && act.pts === exp.pts, act ? ('got ' + act.pts) : 'driver missing from standings entirely');
  });
  check('Senior Stock — untouched by Junior\'s noPoints/DNF/import (independent aggregation)',
    actualSenior.length === Object.keys(expected.senior).length, 'got ' + actualSenior.length);

  console.log('\n=== Specific edge cases, called out explicitly ===');
  check('DNF driver (J5 Evans, night 3) scored 0 that night, not skipped — still ' + expected.junior[105].days + ' race days',
    actualJuniorByName['J5 Evans'] && actualJuniorByName['J5 Evans'].days === expected.junior[105].days,
    JSON.stringify(actualJuniorByName['J5 Evans']));
  check('Mid-season table switch: early nights keep their ORIGINAL point values (not recalculated under the new table)',
    expected.junior[101].pts === actualJuniorByName['J1 Adams'].pts);
  check('New mid-season driver (J7 Grant) only scores from the night they joined (' + expected.junior[107].days + ' day)',
    actualJuniorByName['J7 Grant'] && actualJuniorByName['J7 Grant'].days === expected.junior[107].days,
    JSON.stringify(actualJuniorByName['J7 Grant']));
  check('Real archived nights + a "Fix season points" backfilled night sum together correctly (J1 Adams includes the imported night\'s 10 pts)',
    actualJuniorByName['J1 Adams'].pts === expected.junior[101].pts);

  // ============================================================================
  console.log('\n=== The rendered Points tab shows the same totals as seriesStandings() ===');
  await page.evaluate(() => { UI.ptsTab = 'Junior Sprint'; renderPoints(); });
  const rendered = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pointsContent tbody tr')];
    return rows.map(tr => {
      const cells = tr.querySelectorAll('td');
      return { name: cells[1].textContent.trim(), pts: parseInt(cells[3].textContent.trim(), 10) };
    });
  });
  const renderedByName = Object.fromEntries(rendered.map(r => [r.name, r.pts]));
  let uiMatches = true, uiMismatch = '';
  for (const [id, exp] of Object.entries(expected.junior)) {
    const name = nameOf(Number(id));
    if (renderedByName[name] !== exp.pts) { uiMatches = false; uiMismatch += name + ': UI=' + renderedByName[name] + ' expected=' + exp.pts + '; '; }
  }
  check('Points tab table renders the exact same totals as seriesStandings()', uiMatches, uiMismatch);

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` season-points: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
