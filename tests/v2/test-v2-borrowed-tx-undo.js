// Borrowed transponders + taking results back from Driven (2026-11-14).
// 1. "Running Jake's transponder tonight" (entry.tx, tonight only): results on that transponder go to
//    the borrower (not a conflict, not the owner), Race Manager's lineup lists it under the borrower,
//    the owner counts as having lent it, staff only, and a new race day clears it.
// 2. A night shared to Driven can be taken back (every driver row removed), sharing again removes rows
//    for drivers who were unlinked, and moving/unlinking a card says to share again.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8882;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`http://localhost:${PORT}/raceday/`); await p.waitForTimeout(800);
  await p.evaluate(() => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    S.track.name = 'Borrow Speedway'; S.track.id = S.track.id || 'trk_borrow1';
    S.classes = [{ id: 1, name: 'Junior', maxPill: 200, heats: 2 }];
    S.roster = [
      { id: 1, name: 'Jake Smith', num: '7', trans: '1001' },     // owns 1001, lends it tonight
      { id: 2, name: 'Ava Brooks', num: '12', trans: '1002' },    // her own is broken: runs Jake's
      { id: 3, name: 'Ben Carter', num: '3', trans: '1003' }
    ];
    S.raceDay = { date: today(), entries: [2, 3].map((id, i) => ({ driverId: id, classId: 1, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    localStorage.removeItem('rd_imp_done'); save();
  });

  console.log('\n=== 1. Running someone else\'s transponder tonight ===');
  check('the driver card offers it for a driver entered tonight', await p.evaluate(() => /Transponder tonight/.test(txTonightMarkup(driverById(2))) && txTonightMarkup(driverById(1)) === ''));
  await p.evaluate(() => setTxTonight(2, '1001'));
  const st = await p.evaluate(() => ({ ava: effTrans(driverById(2)), jake: effTrans(driverById(1)), ben: effTrans(driverById(3)), saved: driverById(2).trans, card: txTonightMarkup(driverById(2)), audit: JSON.stringify((S.audit || []).slice(-1)) }));
  check('tonight, 1001 is Ava\'s', st.ava === '1001', JSON.stringify(st));
  check('…Jake counts as having lent it', st.jake === '', st.jake);
  check('…her saved transponder is unchanged', st.saved === '1002');
  check('…the card says whose it is', /Running <b>1001<\/b> \(Jake Smith's\)/.test(st.card), st.card.slice(0, 160));
  check('…and it is in the audit log', /Borrowed transponder tonight/.test(st.audit), st.audit);
  check('no duplicate warning (it was lent, not doubled)', await p.evaluate(() => Object.keys(dupTransTonight()).length === 0));
  const rm = await p.evaluate(() => rmLineupRows(1).lines.join(' | '));
  check('Race Manager\'s lineup lists 1001 under Ava', /1001,12,Brooks,Ava/.test(rm) && !/1002/.test(rm), rm);
  const imp = await p.evaluate(() => {
    openImport('heat'); Imp.watchAuto = false;
    impIngestText('Pos,Number,Name,Transponder\n1,12,Ava Brooks,1001\n2,3,Ben Carter,1003\n', 'Junior Heat 1.csv', true);
    const st = impPreview.map(r => r.status + ':' + (r.driver && r.driver.name));
    Imp.watchAuto = true; impAutoApply();   // what the folder watch does with a clean file
    return { st, res: S.raceDay.heatResults[resKey(1)] || {} };
  });
  check('a results file with 1001 is credited to Ava, cleanly', imp.st[0] === 'match:Ava Brooks', JSON.stringify(imp.st));
  check('…and imports on its own, Ava 1st', Object.keys(imp.res).length === 2 && Object.entries(imp.res).some(([k, v]) => /_2$/.test(k) && v === 1), JSON.stringify(imp.res));
  await p.evaluate(() => closeSheet());
  check('nothing was learned onto anyone from the borrowed tag', await p.evaluate(() => driverById(2).trans === '1002' && driverById(1).trans === '1001'));
  await p.evaluate(() => setTxTonight(2, ''));
  check('"Back to their own" clears it', await p.evaluate(() => effTrans(driverById(2)) === '1002' && effTrans(driverById(1)) === '1001'));
  await p.evaluate(() => setTxTonight(2, '1001'));
  const viewerBlocked = await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'viewer'); setTxTonight(2, '9999'); const v = effTrans(driverById(2)); localStorage.setItem('rd_role_v2', 'admin'); return v; });
  check('a spectator phone can\'t change it', viewerBlocked === '1001', viewerBlocked);
  check('a new race day clears it', await p.evaluate(() => { newRaceDay(); return effTrans(driverById(1)) === '1001' && !S.raceDay.entries.some(e => e.tx); }));

  console.log('\n=== 2. Taking a night back from Driven ===');
  await p.evaluate(() => {
    window.__db = {}; window.__removed = [];
    ensureFirebase = () => Promise.resolve(); resultsJoin = () => Promise.resolve(true);
    window.firebase = { apps: [1], database: () => ({ ref: path => ({
      set: async v => { window.__db[path] = v; }, remove: async () => { window.__removed.push(path); delete window.__db[path]; },
      once: async () => ({ val: () => window.__db[path] || null }) }) }) };
    driverById(2).profileId = 'prof_avabrooks1'; driverById(3).profileId = 'prof_bencarter1'; save();
    // a scored night in history
    S.history.unshift({ date: '2026-11-07', classes: [{ name: 'Junior', standings: [], featureFinish: [{ driverId: 2, name: 'Ava Brooks', num: '12', fin: 1 }, { driverId: 3, name: 'Ben Carter', num: '3', fin: 2 }] }] });
    save();
  });
  await p.evaluate(() => shareResultsWithDriven(0)); await p.waitForTimeout(200);
  const shared = await p.evaluate(() => Object.keys(window.__db).filter(k => /^results/.test(k)).sort());
  check('sharing writes one row per linked driver', shared.length === 2, JSON.stringify(shared));
  dialogs.length = 0;
  await p.evaluate(() => { driverCardId = 3; unlinkProfile(); });
  check('unlinking a driver with shared results says to share again', await p.evaluate(() => /shared night/.test(document.body.textContent)));
  await p.evaluate(() => shareResultsWithDriven(0)); await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ rows: Object.keys(window.__db).filter(k => /^results/.test(k)), removed: window.__removed.slice() }));
  check('sharing again removes the unlinked driver\'s row', after.rows.length === 1 && after.removed.some(r => /\/3$/.test(r)), JSON.stringify(after));
  check('history shows a Take back button once shared', await p.evaluate(() => typeof unshareResultsWithDriven === 'function' && S.history[0].published === true));
  await p.evaluate(() => unshareResultsWithDriven(0)); await p.waitForTimeout(200);
  const back = await p.evaluate(() => ({ rows: Object.keys(window.__db).filter(k => /^results/.test(k)), pub: !!S.history[0].published }));
  check('Take back removes every row for that night', back.rows.length === 0, JSON.stringify(back.rows));
  check('…and the night shows as not shared', back.pub === false);
  check('…after asking first', dialogs.some(m => /Take 2026-11-07 back from Driven/.test(m)), dialogs.join(' | '));

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
