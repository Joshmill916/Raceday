// Season-points repair: the "Fix season points" admin form (import + edit past nights).
//
// This exists because a live track ran a whole season whose points never accumulated —
// they never archived a night, so every week overwrote the last. The repair path is a
// synthetic S.history entry that seriesStandings() sums like any archived night. The
// invariant that matters most here: EDITING a repair entry must REPLACE it, never add a
// second one — a correction that double-counts is worse than the original wrong number.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8799;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

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
  const dlgSeen = [];
  page.on('dialog', async d => {
    dlgSeen.push(d.message());
    let r;
    try { r = answer(d.message(), d.type()); } catch (e) { r = false; }
    if (typeof r === 'string') await d.accept(r);
    else if (r === true) await d.accept();
    else await d.dismiss();
  });
  const resetDlg = () => { dlgSeen.length = 0; answer = () => false; };

  const base = `http://localhost:${PORT}/`;
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await page.evaluate(() => {}).catch(() => {});
  await go(base);
  await page.waitForTimeout(500);

  // Seed a track with one class and three drivers, no admin PIN (so adminOk() passes).
  await page.evaluate(() => {
    localStorage.clear();
  });
  await go(base);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    hideModal('setupWizard');
    S.track.name = 'Test Speedway';
    S.classes = [{ id: 1, name: 'Junior Sprint', maxPill: 20, description: '', ageGroup: '', specs: '' }];
    S.roster = [
      { id: 101, name: 'Ann Ash', num: '1', noPoints: false },
      { id: 102, name: 'Bo Birch', num: '2', noPoints: false },
      { id: 103, name: 'Cal Cedar', num: '3', noPoints: false }
    ];
    S.history = [];
    save();
    nav('admin');
    adminOpen('adm-import');
  });
  await page.waitForTimeout(300);

  const standings = () => page.evaluate(() => {
    const out = {};
    seriesStandings('Junior Sprint').forEach(r => { out[r.name] = r.pts; });
    return out;
  });
  const histLen = () => page.evaluate(() => S.history.length);

  // Fill the form for a given date and set of [driverId, pts] pairs.
  const fillAndSave = (date, rows) => page.evaluate(({ date, rows }) => {
    document.getElementById('impDate').value = date;
    document.getElementById('impClass').value = '1';
    _impRows = rows.map(([id, pts]) => {
      const d = driverById(id);
      return { driverId: id, name: d.name, num: d.num, pts };
    });
    renderImpRows();
    saveImportedRace();
  }, { date, rows });

  // ============================================================================
  console.log('\n=== 1. A repair entry feeds season points ===');
  resetDlg();
  await fillAndSave('2026-05-01', [[101, 10], [102, 8], [103, 6]]);
  await page.waitForTimeout(200);
  let s = await standings();
  check('imported night counts toward standings', s['Ann Ash'] === 10 && s['Bo Birch'] === 8 && s['Cal Cedar'] === 6, JSON.stringify(s));
  check('one history entry exists', (await histLen()) === 1);

  console.log('\n=== 2. A second night ADDS to the season total ===');
  resetDlg();
  await fillAndSave('2026-05-08', [[101, 6], [102, 10]]);
  await page.waitForTimeout(200);
  s = await standings();
  check('two nights sum per driver', s['Ann Ash'] === 16 && s['Bo Birch'] === 18 && s['Cal Cedar'] === 6, JSON.stringify(s));
  check('two history entries exist', (await histLen()) === 2);

  console.log('\n=== 3. THE KEY INVARIANT: editing REPLACES, never double-counts ===');
  resetDlg();
  // Edit the 2026-05-01 night, correcting Ann 10 -> 4.
  const editedOk = await page.evaluate(() => {
    const i = S.history.findIndex(h => h.date === '2026-05-01');
    if (i < 0) return 'no entry';
    editImportedRace(i);
    if (_impEditIdx !== i) return 'edit index not set';
    _impRows[0].pts = 4;      // Ann Ash
    renderImpRows();
    saveImportedRace();
    return 'ok';
  });
  await page.waitForTimeout(200);
  check('edit loaded and saved', editedOk === 'ok', String(editedOk));
  check('still exactly two history entries (no duplicate added)', (await histLen()) === 2);
  s = await standings();
  check('corrected total replaces the old one (Ann 4+6=10, not 20)', s['Ann Ash'] === 10, JSON.stringify(s));
  check('untouched drivers unchanged', s['Bo Birch'] === 18 && s['Cal Cedar'] === 6, JSON.stringify(s));
  check('edit mode cleared after save', await page.evaluate(() => _impEditIdx === null));

  console.log('\n=== 4. Duplicate guard still blocks a genuine duplicate ===');
  resetDlg();
  answer = () => true;
  await fillAndSave('2026-05-08', [[103, 5]]);
  await page.waitForTimeout(200);
  check('same date+class is rejected', (await histLen()) === 2, 'history grew to ' + (await histLen()));
  check('user was told why', dlgSeen.some(m => /already exists/i.test(m)), JSON.stringify(dlgSeen));

  console.log('\n=== 5. Deleting during an edit drops the stale index ===');
  resetDlg();
  answer = () => true;   // accept the delete confirm
  const staleOk = await page.evaluate(() => {
    const i = S.history.findIndex(h => h.date === '2026-05-01');
    editImportedRace(i);
    const armed = _impEditIdx === i;
    delHist(i);
    return armed && _impEditIdx === null;
  });
  await page.waitForTimeout(200);
  check('pending edit index cleared on delete', staleOk === true);

  console.log('\n=== 5b. An all-zero entry warns before saving a likely-forgotten repair ===');
  // Every added row defaults to 0 points until the admin types real values in — a
  // submission where nobody's points ever got filled in is almost certainly that
  // mistake, not a genuine shutout night, and would otherwise silently inflate every
  // driver's race-day count in seriesStandings() with a phantom, zero-value night.
  resetDlg();
  answer = () => false;   // decline the all-zero warning
  const histBeforeZero = await histLen();
  await fillAndSave('2026-05-15', [[101, 0], [102, 0]]);
  await page.waitForTimeout(200);
  check('an all-zero submission triggers a warning', dlgSeen.some(m => /0 points/i.test(m)), JSON.stringify(dlgSeen));
  check('declining it leaves history unchanged', (await histLen()) === histBeforeZero);

  resetDlg();
  answer = () => true;   // accept the all-zero warning this time
  await fillAndSave('2026-05-15', [[101, 0], [102, 0]]);
  await page.waitForTimeout(200);
  check('accepting the warning still saves the entry', (await histLen()) === histBeforeZero + 1);

  resetDlg();
  const histBeforeMixed = await histLen();
  await fillAndSave('2026-05-22', [[101, 5], [102, 0]]);
  await page.waitForTimeout(200);
  check('a MIXED entry (not everyone zero) saves with no warning at all', dlgSeen.length === 0 && (await histLen()) === histBeforeMixed + 1, JSON.stringify(dlgSeen));

  console.log('\n=== 6. Add-whole-class prefill ===');
  resetDlg();
  const whole = await page.evaluate(() => {
    clearImpForm();
    document.getElementById('impClass').value = '1';
    addImpWholeClass();
    return { n: _impRows.length, allZero: _impRows.every(r => r.pts === 0), names: _impRows.map(r => r.name) };
  });
  check('prefills past drivers of that class at 0 points', whole.n >= 2 && whole.allZero, JSON.stringify(whole));
  check('no duplicate rows on a second click', await page.evaluate(() => {
    const before = _impRows.length; addImpWholeClass(); return _impRows.length === before;
  }));

  console.log('\n=== 7. Only hand-entered single-class entries are editable ===');
  resetDlg();
  const btns = await page.evaluate(() => {
    // A real archived night (imported flag absent) must NOT offer Edit.
    S.history.push({ date: '2026-04-01', savedAt: Date.now(), classes: [{ name: 'Junior Sprint', pointsRace: true,
      points: [{ driverId: 101, name: 'Ann Ash', num: '1', pts: 9 }],
      standings: [{ pos: 1, name: 'Ann Ash', num: '1', pill: 1, f1: 1, f2: 1, pts: 9 }], feature: [], featureFinish: [] }] });
    save();
    renderHistory();
    const html = document.getElementById('historyList').innerHTML;
    const editCalls = (html.match(/editImportedRace\(/g) || []).length;
    const imported = S.history.filter(h => h.imported && h.classes.length === 1).length;
    return { editCalls, imported };
  });
  check('one Edit button per repair entry, none for archived nights', btns.editCalls === btns.imported, JSON.stringify(btns));

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` points-repair: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
