// Westhold Race Manager XML import + lineup (assignment file) export, using the sample files
// Westhold sent (test-data/westhold-xml/, Demo mode, made-up racers Adam One … Jeff Ten).
// The whole-night run through the XML layout lives in test-v2-timing-night.js ("Westhold XML").
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8879;
const FIX = path.join(ROOT, 'test-data', 'westhold-xml');
const read = f => fs.readFileSync(path.join(FIX, f), 'latin1');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

// The ten demo racers, as in DEMO.CSV: transponder 1001… = number 1…
const RACERS = read('DEMO.CSV').trim().split(/\r?\n/).map(l => { const c = l.split(','); return { trans: c[0], num: c[1], last: c[2], first: c[3] }; });

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await p.goto(`http://localhost:${PORT}/raceday2/index.html`); await p.waitForTimeout(600);
  await p.evaluate((racers) => {
    S.classes = [{ id: 1, name: 'Demo', maxPill: 200, heats: 1 }, { id: 2, name: 'Clone, Heavy', maxPill: 200, heats: 1 }];
    // Drivers known by name + number only (no transponders yet), except one with a stored tag.
    S.roster = racers.map((r, i) => ({ id: 100 + i, name: r.first + ' ' + r.last, num: r.num, trans: '' }));
    S.raceDay = { date: today(), entries: racers.map((r, i) => ({ driverId: 100 + i, classId: 1, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    save(); setDeviceRole('admin'); applyRole();
    window.__dl = []; downloadFile = (name, content) => window.__dl.push({ name, content });
  }, RACERS);

  console.log('\n=== Reading the XML ===');
  const parsed = await p.evaluate(files => files.map(([n, t]) => { const x = impXmlToCsv(t); return x && { n, cls: x.cls, mode: x.mode, flag: x.flag, live: x.live, running: x.running, started: x.started, cars: x.cars, file: x.fileName }; }),
    ['DEMO.xml', 'DEMO-Q.xml', 'racedata - lap 5.xml', 'racedata - checkered.xml', 'racedata - stopped.xml', 'racedata - qualify.xml', 'racedata - qualify stopped.xml'].map(f => [f, read(f)]));
  const by = Object.fromEntries(parsed.map(x => [x.n, x]));
  check('XMLExport race file: class DEMO, RACE, 10 cars, not live', by['DEMO.xml'].cls === 'DEMO' && by['DEMO.xml'].mode === 'RACE' && by['DEMO.xml'].cars === 10 && !by['DEMO.xml'].live, JSON.stringify(by['DEMO.xml']));
  check('XMLExport qualifying file: QUALIFY, 5 cars, stand-in name says Qualifying', by['DEMO-Q.xml'].mode === 'QUALIFY' && by['DEMO-Q.xml'].cars === 5 && /Qualifying/.test(by['DEMO-Q.xml'].file), JSON.stringify(by['DEMO-Q.xml']));
  check('live files at lap 5, checkered and qualifying-in-progress count as still running', by['racedata - lap 5.xml'].running && by['racedata - checkered.xml'].running && by['racedata - qualify.xml'].running);
  check('live files with flag Stop are finished', !by['racedata - stopped.xml'].running && !by['racedata - qualify stopped.xml'].running && by['racedata - stopped.xml'].live);
  check('finished files count as started (someone has a lap)', parsed.every(x => x.started === true), JSON.stringify(parsed.map(x => [x.n, x.started])));
  check('a CSV is not mistaken for XML', await p.evaluate(t => impXmlToCsv(t) === null, read('DEMO.CSV')));
  check('XML entities and CDATA come through as text', await p.evaluate(() => {
    const x = impXmlToCsv('<RACEDATA><SESSION><CLASS>A &amp; B</CLASS><MODE>RACE</MODE></SESSION><CAR><POSITION>1</POSITION><NAME><![CDATA[Zoë O\'Neil]]></NAME><CARNO>7</CARNO><TXID>9</TXID></CAR></RACEDATA>');
    return x.cls === 'A & B' && /Zoë O'Neil/.test(x.csv);
  }));

  const load = (file, text, step, auto) => p.evaluate(([file, text, step, auto]) => {
    openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === step));
    Imp.watchAuto = !!auto;
    const ok = impIngestText(text, file, !!auto);
    return { ok, rows: Imp && Imp.rows.length, vendor: Imp && Imp.vendor && Imp.vendor.name, cls: Imp && (classById(Imp.clsId) || {}).name,
      info: (document.getElementById('impCsvInfo') || {}).textContent || '',
      st: impPreview.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}) };
  }, [file, text, step, auto]);
  const close = () => p.evaluate(() => { try { closeImport(); } catch (e) {} });

  console.log('\n=== Importing ===');
  const startFile = read('DEMO.xml').replace(/<LAPS>\d+<\/LAPS>/g, '<LAPS>0</LAPS>');
  const st0 = await load('DEMO.xml', startFile, 'h1', true);
  const st0saved = await p.evaluate(() => Object.keys(getRes(1)).length);
  check('a start-of-session file (UploadXML, nobody has a lap) is skipped, nothing saved', st0.ok === false && st0saved === 0, JSON.stringify(st0));
  await close();
  const h = await load('DEMO.xml', read('DEMO.xml'), 'h1');
  check('race XML: all 10 matched in the Demo class', h.ok && h.cls === 'Demo' && h.st.match === 10 && !h.st.new && !h.st.conflict, JSON.stringify(h));
  await p.evaluate(() => impApplyClick()); await close();
  const fin = await p.evaluate(() => { const r = getRes(1); return S.roster.map(d => [d.num, r['h1_' + d.id]]); });
  const want = { 7: 1, 8: 2, '09': 3, 10: 4, 1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10 };
  check('race XML: every finish on the right driver (Ginny Seven 1st … Fred Six 10th)', fin.every(([n, pos]) => want[n] === pos), JSON.stringify(fin));
  check('all 10 transponders learned', await p.evaluate(() => S.roster.filter(d => d.trans).length) === 10);

  const running = await load('racedata.xml', read('racedata - lap 5.xml'), 'h1');
  check('a live file from a race still running is refused', running.ok === false, JSON.stringify(running));
  await close();
  const beforeRunning = await p.evaluate(() => JSON.stringify(S.raceDay.heatResults));
  const runningWatch = await load('racedata.xml', read('racedata - checkered.xml'), 'h2', true);
  const afterRunning = await p.evaluate(b => JSON.stringify(S.raceDay.heatResults) === b, beforeRunning);
  check('…and from a watched folder it is skipped quietly, nothing saved (checkered is not Stop)', runningWatch.ok === false && afterRunning, JSON.stringify(runningWatch));
  await close();

  // RaceDay calls the class "Demo"; the file says DEMO — capitals don't matter.
  const q = await load('DEMO-Q.xml', read('DEMO-Q.xml'), 'qual');
  check('qualifying XML: Westhold detected, class Demo, all 5 matched', q.ok && q.vendor === 'Westhold' && q.cls === 'Demo' && q.st.match === 5, JSON.stringify(q));
  check('the file info names the Race Manager file and session', /DEMO-Q\.xml/.test(q.info) && /qualifying file/.test(q.info) && /Heat 1/.test(q.info), q.info);
  await p.evaluate(() => impApplyClick()); await close();
  const grid = await p.evaluate(() => S.raceDay.entries.filter(e => e.classId === 1 && e.pill > 0).sort((a, b) => a.pill - b.pill).slice(0, 5).map(e => driverById(e.driverId).num));
  check('qualifying XML sets the grid by fast time (1, 3, 2, 4, 5)', JSON.stringify(grid) === '["1","3","2","4","5"]', JSON.stringify(grid));

  const ls = await load('racedata.xml', read('racedata - stopped.xml'), 'h2');
  check('a live racedata.xml at Stop imports too (NAME field, class from INFO)', ls.ok && ls.cls === 'Demo' && ls.st.match === 10, JSON.stringify(ls));
  await close();

  console.log('\n=== Lineups for Race Manager ===');
  await p.evaluate(() => {
    // The full 10-car field again (the 5-car demo qualifying cut it), every transponder learned.
    S.raceDay.entries = S.roster.slice(0, 10).map((d, i) => ({ driverId: d.id, classId: 1, pill: i + 1 }));
    // Driver #6 has no transponder, a comma in a name must not break the columns, a second class.
    const d6 = S.roster.find(d => d.num === '6'); d6.trans = '';
    S.roster.find(d => d.num === '2').name = 'Ben "Benny", Two';
    S.roster.push({ id: 200, name: 'Solo', num: '44', trans: 'ab-12 34' });
    S.raceDay.entries.push({ driverId: 200, classId: 2, pill: 1 });
    save(); nav('admin'); admOpen('format');
  });
  check('Admin → Race format shows the Race Manager lineups button', await p.evaluate(() => !!document.getElementById('rmLineupBtn')));
  await p.evaluate(() => openRmLineups());
  const sheet = await p.evaluate(() => (document.getElementById('rmLineupList') || {}).textContent || '');
  check('the sheet lists each class and names the driver with no transponder', /Demo/.test(sheet) && /9 drivers/.test(sheet) && /1 with no transponder/.test(sheet) && /Fred Six/.test(sheet), sheet);
  await p.evaluate(() => { rmLineupDownload(1); rmLineupDownload(2); closeSheet(); });
  const dl = await p.evaluate(() => window.__dl);
  const demo = dl.find(f => f.name === 'DEMO.CSV');
  const lines = demo ? demo.content.split('\r\n') : [];
  check('one assignment file per class, named after the class (DEMO.CSV, CLONE-HEAVY.CSV), no .DAT', demo && dl.some(f => f.name === 'CLONE-HEAVY.CSV') && dl.length === 2, JSON.stringify(dl.map(f => f.name)));
  check('Windows line ends, no header, one line per driver with a transponder', demo && demo.content.endsWith('\r\n') && lines.filter(Boolean).length === 9 && /^\d/.test(lines[0]), JSON.stringify(lines.slice(0, 2)));
  check('Race Manager\'s column order: Transponder,Number,Last,First,Misc,Backup,Qualify', lines.includes('1003,3,Three,Cathy,Demo,,') && lines.includes('1009,09,Nine,Indira,Demo,,'), JSON.stringify(lines));
  check('every line has exactly 7 fields (a comma in a name is taken out)', lines.filter(Boolean).every(l => l.split(',').length === 7) && lines.some(l => /^1002,2,Two,Ben "Benny"/.test(l)), JSON.stringify(lines.filter(l => l.startsWith('1002'))));
  check('the driver with no transponder is left out', !lines.some(l => /,Six,Fred,/.test(l)));
  const clone = dl.find(f => f.name === 'CLONE-HEAVY.CSV');
  check('transponders are written tidy (spaces/dashes out, capitals) and Misc has no comma', clone && clone.content === 'AB1234,44,,Solo,Clone Heavy,,\r\n', JSON.stringify(clone && clone.content));
  // Round trip: Race Manager's own sample assignment file uses the same shape.
  check('our lines have the same shape as Westhold\'s own DEMO.CSV', read('DEMO.CSV').trim().split(/\r?\n/).every(l => l.split(',').length === 7));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== v2-westhold-xml: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
