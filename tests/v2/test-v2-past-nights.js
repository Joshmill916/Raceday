// Past nights on Driven (2026-11-18): a track that starts RaceDay a few races into the season backfills
// the earlier nights (Admin -> Fix or backfill) with FINISHING POSITIONS, typed in or loaded from that
// night's timing file, and can then share them to drivers' Driven cards like a night run live.
// Guards: a MotoSponder feature file and a Westhold Race Manager XML load in finish order, the class is
// picked from the file name, points fill from the class table; a kart number alone never matches a
// different-named driver (numbers get reused); duplicate finishes are refused; the saved night carries
// featureFinish and counts in driver stats; Share with Driven appears only for backfilled nights WITH
// finishes and writes only linked drivers at the real date; editing keeps finishes; points-only
// backfills behave as before.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8891;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const MOTO = path.join(ROOT, 'test-data/motosponder-night/Sample night Results JR2 MAIN  1  MOTO 1.csv');
const XML = path.join(ROOT, 'test-data/westhold-xml/DEMO.xml');

(async () => {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
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
  await p.goto(`http://localhost:${PORT}/raceday2/`); await p.waitForTimeout(800);
  await p.evaluate(() => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    S.track.name = 'Midseason Raceway'; S.track.id = 'trk_midseason1';
    S.classes = [{ id: 1, name: 'JR2', maxPill: 200, heats: 2 }, { id: 2, name: 'Clone Heavy', maxPill: 200, heats: 2 }, { id: 3, name: 'DEMO', maxPill: 200, heats: 2 }];
    S.roster = [
      { id: 1, name: 'Finley Garrison', num: '14', profileId: 'prof_finleyg0001' },   // linked to Driven
      { id: 2, name: 'Zed Zane', num: '11' }                                          // wears 11 in another class
    ];
    S.history = [];
    window.__db = {};
    ensureFirebase = () => Promise.resolve(); resultsJoin = () => Promise.resolve(true);
    window.firebase = { apps: [1], database: () => ({ ref: path => ({
      set: async v => { window.__db[path] = v; }, remove: async () => { delete window.__db[path]; },
      once: async () => ({ val: () => window.__db[path] || null }) }) }) };
    save(); admOpen('repair'); renderImpForm();
  });

  console.log('\n=== 1. Load a past feature from a MotoSponder file ===');
  check('the backfill form offers loading a results file', await p.evaluate(() => !!document.getElementById('impPastFile') && /Started RaceDay mid-season/.test(document.body.textContent)));
  await p.evaluate(() => { document.getElementById('impClass').value = '2'; });   // wrong class picked: the file name fixes it
  await p.setInputFiles('#impPastFile', MOTO); await p.waitForTimeout(300);
  const a = await p.evaluate(() => ({ cls: document.getElementById('impClass').value, rows: _impRows.map(r => [r.name, r.num, r.fin, r.pts, r.driverId]), msg: document.getElementById('impMsg').textContent }));
  check('the class comes from the file name (JR2)', a.cls === '1', a.cls);
  check('three drivers in finish order', a.rows.length === 3 && a.rows.map(r => r[2]).join() === '1,2,3', JSON.stringify(a.rows));
  check('the linked driver is matched (number + name)', a.rows[0][0] === 'Finley Garrison' && a.rows[0][4] === 1, JSON.stringify(a.rows[0]));
  check('a number someone else wears is NOT matched to them', a.rows[1][0] === 'Noel Upshaw' && a.rows[1][4] !== 2, JSON.stringify(a.rows[1]));
  check('points filled from the points table (10, 8, 6)', a.rows.map(r => r[3]).join() === '10,8,6', JSON.stringify(a.rows.map(r => r[3])));
  check('the form shows Finish and Points for each driver', await p.evaluate(() => document.querySelectorAll('#impDriverRows input[aria-label="Finish"]').length === 3));
  check('new drivers were added to the driver book', await p.evaluate(() => S.roster.some(d => d.name === 'Noel Upshaw') && S.roster.some(d => d.name === 'Arlo Crestwood')));

  console.log('\n=== 2. Save, then share with Driven ===');
  await p.evaluate(() => { _impRows[2].fin = 2; });
  dialogs.length = 0;
  await p.evaluate(() => { document.getElementById('impDate').value = '2026-10-24'; saveImportedRace(); });
  check('two drivers with the same finish are refused', await p.evaluate(() => !S.history.length && /Two drivers have finish 2/.test(document.getElementById('impMsg').textContent)));
  await p.evaluate(() => { _impRows[2].fin = 3; document.getElementById('impDate').value = '2026-10-24'; saveImportedRace(); });
  const h = await p.evaluate(() => S.history[0]);
  check('the night is saved with its finishes', h && h.imported && h.date === '2026-10-24' && h.classes[0].featureFinish.length === 3 && h.classes[0].featureFinish[0].driverId === 1, JSON.stringify(h && h.classes[0].featureFinish));
  check('…and its points', h.classes[0].points.map(x => x.pts).join() === '10,8,6');
  check('the saved message says how to put it on Driven', await p.evaluate(() => /Share with Driven/.test(document.getElementById('impMsg').textContent)));
  check('the win counts in the driver\'s stats', await p.evaluate(() => { const s = driverStats(1); return s.wins === 1 && s.starts === 1; }));
  check('only drivers with a finish are in the night\'s order', await p.evaluate(() => nightFinishOrder(S.history[0], S.history[0].classes[0]).length === 3));
  await p.evaluate(() => { admOpen('history'); renderHistory(); });
  check('Race day history offers Share with Driven for it', await p.evaluate(() => /Share with Driven/.test(document.getElementById('historyList').innerHTML)));
  check('…and shows the finishes', await p.evaluate(() => { UI.histOpen = 0; renderHistory(); return /<th>Fin<\/th>/.test(document.getElementById('historyList').innerHTML); }));
  await p.evaluate(() => shareResultsWithDriven(0)); await p.waitForTimeout(250);
  const db = await p.evaluate(() => window.__db);
  const rows = Object.keys(db).filter(k => /^results\//.test(k));
  check('sharing writes the linked driver only, at the real date', rows.length === 1 && rows[0] === 'results/trk_midseason1/2026-10-24/' + (await p.evaluate(() => fbKey('JR2'))) + '/1', JSON.stringify(rows));
  check('…as 1st, with points and the track name', db[rows[0]] && db[rows[0]].position === 1 && db[rows[0]].points === 10 && db[rows[0]].trackName === 'Midseason Raceway', JSON.stringify(db[rows[0]]));
  check('…and the track is on the driver\'s Driven list', !!db['profileTracks/prof_finleyg0001/trk_midseason1']);
  check('the night is marked shared (Take back is offered)', await p.evaluate(() => { renderHistory(); return S.history[0].published && /Take back from Driven/.test(document.getElementById('historyList').innerHTML); }));

  console.log('\n=== 3. Edit keeps finishes; points-only backfill unchanged ===');
  const ed = await p.evaluate(() => { editImportedRace(0); return _impRows.map(r => r.name + ':' + r.fin); });
  check('editing loads the finishes back', ed.join('|') === 'Finley Garrison:1|Noel Upshaw:2|Arlo Crestwood:3', ed.join('|'));
  await p.evaluate(() => { saveImportedRace(); });
  check('saving an edit keeps it marked shared, so Share again sends the fix', await p.evaluate(() => S.history[0].published === true && S.history[0].classes[0].featureFinish.length === 3));
  await p.evaluate(() => { clearImpForm(); document.getElementById('impClass').value = '2'; addImpRowDriver(2); _impRows[0].pts = 7; document.getElementById('impDate').value = '2026-10-17'; saveImportedRace(); admOpen('history'); renderHistory(); });
  const po = await p.evaluate(() => { const i = S.history.findIndex(x => x.date === '2026-10-17'); const row = document.getElementById('historyList').innerHTML.split('<div class="lrow"')[i + 1] || ''; return { i, ff: S.history[i].classes[0].featureFinish.length, share: /Share with Driven/.test(row) }; });
  check('a points-only backfill still saves', po.i >= 0 && po.ff === 0, JSON.stringify(po));
  check('…and has no Share with Driven (no finishing positions)', po.share === false, JSON.stringify(po));

  console.log('\n=== 4. Westhold Race Manager XML, and typing a finish order ===');
  await p.evaluate(() => { admOpen('repair'); renderImpForm(); clearImpForm(); });
  await p.setInputFiles('#impPastFile', XML); await p.waitForTimeout(300);
  const x = await p.evaluate(() => ({ cls: document.getElementById('impClass').value, n: _impRows.length, fins: _impRows.map(r => r.fin) }));
  check('a Race Manager results XML loads into its class', x.cls === '3' && x.n >= 5 && x.fins.every((f, i) => f === i + 1), JSON.stringify(x));
  await p.evaluate(() => { clearImpForm(); document.getElementById('impClass').value = '1'; addImpRowDriver(2); addImpRowDriver(1); impNumberInOrder(); });
  check('"Finish = list order" numbers typed-in drivers top to bottom', await p.evaluate(() => _impRows.map(r => r.driverId + ':' + r.fin).join() === '2:1,1:2'));
  check('"Points from finish" uses the class table', await p.evaluate(() => { impPointsFromFinish(); return _impRows.map(r => r.pts).join() === '10,8'; }));

  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
