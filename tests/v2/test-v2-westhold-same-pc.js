// RaceDay + Westhold Race Manager on the same night, often the same Windows computer (2026-11-14).
// Guards five things a track would hit: a qualifying file that lists only some of the class keeps the
// rest (at the back) instead of dropping them; a file the timing software has locked for a moment
// never stops the folder watch; a session that already went in never auto-imports again (same
// results skipped, changed results wait for a person, since they'd replace hand fixes like a DQ);
// coming back into view checks the folder at once (hidden pages' timers are slowed); and lineups
// save straight into Race Manager's Assign folder, sorted by number so a pill draw never rewrites them.
// Fixtures: test-data/westhold-xml/ (Westhold's Demo-mode files, made-up racers).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8877;
const FIX = path.join(ROOT, 'test-data', 'westhold-xml');
const read = f => fs.readFileSync(path.join(FIX, f), 'latin1');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const RACERS = read('DEMO.CSV').trim().split(/\r?\n/).map(l => { const c = l.split(','); return { trans: c[0], num: c[1], last: c[2], first: c[3] }; });

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
  // Two stand-in folders: the results folder RaceDay reads, and Race Manager's Assign folder it writes.
  await ctx.addInitScript(() => {
    window.__fs = { 'old.xml': { text: '<RACEDATA></RACEDATA>', mtime: Date.now() - 900000 } };
    window.__locked = {};          // name -> times getFile() should still fail (file held by the timing software)
    window.__assign = {}; window.__writes = []; window.__assignFail = false;
    const results = { kind: 'directory', name: 'UploadXML', requestPermission: async () => 'granted', queryPermission: async () => 'granted',
      entries: async function* () {
        for (const [n, f] of Object.entries(window.__fs)) yield [n, { kind: 'file', getFile: async () => {
          if (window.__locked[n] > 0) { window.__locked[n]--; throw new DOMException('The file is in use', 'NotReadableError'); }
          return { lastModified: f.mtime, text: async () => f.text };
        } }];
      } };
    const assign = { kind: 'directory', name: 'Assign', requestPermission: async () => 'granted', queryPermission: async () => 'granted',
      getFileHandle: async (name, opt) => {
        if (!(opt && opt.create) && !(name in window.__assign)) throw new DOMException('not found', 'NotFoundError');
        return { getFile: async () => ({ text: async () => window.__assign[name] }), createWritable: async () => {
        if (window.__assignFail) throw new DOMException('denied', 'NotAllowedError');
        let buf = ''; return { write: async t => { buf += t; }, close: async () => { window.__assign[name] = buf; window.__writes.push(name); } };
      } }; } };
    window.showDirectoryPicker = async (o) => (o && o.mode === 'readwrite' ? assign : results);
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/raceday/`); await p.waitForTimeout(800);
  // Coming back to the page before the import sheet was ever opened must not throw (Imp undeclared, crash 11/14-11/16)
  await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  check('focus / visibility before any import: no error', !errs.length, errs.join('; '));
  const setup = () => p.evaluate(racers => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    S.track.name = 'Same PC Speedway'; S.classes = [{ id: 1, name: 'Demo', maxPill: 200, heats: 1 }];
    S.roster = racers.map((r, i) => ({ id: 100 + i, name: r.first + ' ' + r.last, num: r.num, trans: r.trans }));
    // signed up in pill order 10..1 so "old order" is distinguishable from car number order
    S.raceDay = { date: today(), entries: racers.map((r, i) => ({ driverId: 100 + i, classId: 1, pill: 10 - i })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    S.settings.timingSource = 'folder'; localStorage.removeItem('rd_imp_done'); save();
  }, RACERS);
  const drop = (name, text) => p.evaluate(([n, t]) => { window.__fs[n] = { text: t, mtime: Date.now() - 2000 }; }, [name, text]);
  const startWatch = async step => {
    await p.evaluate(async step => { closeSheet(); TimingDir.handle = await window.showDirectoryPicker({ mode: 'read' }); openImport(step); await impStartWatch(); }, step);
    await p.waitForTimeout(400);
  };
  const status = () => p.evaluate(() => (document.getElementById('impWatchStatus') || {}).textContent || '');

  console.log('\n=== 1. A qualifying file that lists only part of the class ===');
  await setup(); await startWatch('qual');
  await drop('DEMO-Q.xml', read('DEMO-Q.xml'));
  await p.waitForFunction(() => /placed on the grid/.test((document.getElementById('impWatchStatus') || {}).textContent || ''), null, { timeout: 9000 }).catch(() => {});
  const q = await p.evaluate(() => S.raceDay.entries.filter(e => e.classId === 1).sort((a, b) => a.pill - b.pill).map(e => driverById(e.driverId).num));
  check('all 10 drivers are still in the class', q.length === 10, JSON.stringify(q));
  check('the 5 in the file are on the grid in Race Manager order', JSON.stringify(q.slice(0, 5)) === '["1","3","2","4","5"]', JSON.stringify(q));
  check('the 5 not in the file start at the back, in their old order', JSON.stringify(q.slice(5)) === JSON.stringify([9, 8, 7, 6, 5].map(i => RACERS[i].num)), JSON.stringify(q));
  check('the status says who was kept', /5 drivers not in the file kept at the back/.test(await status()), await status());

  console.log('\n=== 2. A file the timing software has locked for a moment ===');
  await setup(); await startWatch('heat');
  await p.evaluate(() => { window.__locked['DEMO.xml'] = 2; });
  await drop('DEMO.xml', read('DEMO.xml'));
  await p.waitForTimeout(3500);
  check('a locked file does not stop the watch', await p.evaluate(() => !!(Imp && Imp.watchDir && Imp.watchInterval)), await status());
  await p.waitForFunction(() => /imported 10 heat finishes/.test((document.getElementById('impWatchStatus') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
  check('…and it loads once the timing software lets go', /imported 10 heat finishes/.test(await status()), await status());

  console.log('\n=== 3. A session saved again ===');
  const firstHeat = await p.evaluate(() => JSON.stringify(S.raceDay.heatResults));
  await drop('DEMO.xml', read('DEMO.xml'));   // same results, saved again
  await p.waitForFunction(() => /already in/.test((document.getElementById('impWatchStatus') || {}).textContent || ''), null, { timeout: 9000 }).catch(() => {});
  check('same results again: skipped quietly', /already in — no changes/.test(await status()), await status());
  // the race director DQs someone by hand, then the scorer re-saves the session with a change
  await p.evaluate(() => { const k = resKey(1); const key = Object.keys(S.raceDay.heatResults[k])[0]; S.raceDay.heatResults[k][key] = 'DQ'; save(); window.__dqKey = key; });
  const changed = read('DEMO.xml').replace('<POSITION>1</POSITION>', '<POSITION>1</POSITION><!-- corrected -->').replace(/<LAPS>(\d+)<\/LAPS>/, (m, n) => '<LAPS>' + (Number(n) + 1) + '</LAPS>');
  await drop('DEMO.xml', changed);
  await p.waitForFunction(() => /saved again with changes/.test((document.getElementById('impWatchStatus') || {}).textContent || ''), null, { timeout: 9000 }).catch(() => {});
  check('changed results of a session already in: wait for a person', /saved again with changes/.test(await status()), await status());
  check('…and the hand-entered DQ is untouched', await p.evaluate(() => S.raceDay.heatResults[resKey(1)][window.__dqKey] === 'DQ'));
  check('…until someone taps Import ✓ to replace it', await p.evaluate(() => { impApplyClick(); return S.raceDay.heatResults[resKey(1)][window.__dqKey] !== 'DQ'; }));
  check('the memory is per race day (a new day starts clean)', await p.evaluate(() => { S.raceDay.date = '2099-01-01'; const k = impDoneGet(impDoneKey()); S.raceDay.date = today(); return k === null; }));
  void firstHeat;

  console.log('\n=== 4. Coming back into view ===');
  await setup(); await startWatch('heat');
  await p.waitForTimeout(3500);
  await p.evaluate(() => { clearInterval(Imp.watchInterval); });   // what a hidden page's slowed timer feels like
  await drop('DEMO.xml', read('DEMO.xml'));
  await p.waitForTimeout(500);
  check('while hidden, nothing has loaded yet', !/imported/.test(await status()));
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => /imported 10 heat finishes/.test((document.getElementById('impWatchStatus') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('back in view: the folder is checked at once', /imported 10 heat finishes/.test(await status()), await status());

  console.log('\n=== 5. Lineups straight into the Assign folder ===');
  await setup();
  await p.evaluate(() => { closeSheet(); localStorage.removeItem('rd_rm_last'); openRmLineups(); });
  check('the lineup sheet offers to pick the Assign folder', await p.evaluate(() => /Pick the Assign folder/.test(document.getElementById('sheetBody').textContent)));
  await p.evaluate(() => rmPickAssign()); await p.waitForTimeout(300);
  const file = await p.evaluate(() => window.__assign['DEMO.CSV'] || '');
  const want = RACERS.map(r => [r.trans, r.num, r.last, r.first].join(','));
  const lines = file.trim().split(/\r?\n/);
  check('DEMO.CSV written straight into Assign', lines.length === 10, file.slice(0, 80));
  check('…in Race Manager\'s layout, sorted by car number, CRLF', lines.every((l, i) => l.startsWith(want[i] + ',Demo')) && /\r\n$/.test(file), lines.slice(0, 2).join(' | '));
  check('the sheet now says it is saving there', await p.evaluate(() => /Saving straight to Race Manager/.test(document.getElementById('sheetBody').textContent)));
  const writes0 = await p.evaluate(() => window.__writes.length);
  await p.evaluate(() => { S.raceDay.entries.forEach((e, i) => { e.pill = i + 1; }); save(); }); await p.waitForTimeout(2000);
  check('a pill draw / new grid does not rewrite the file', await p.evaluate(n => window.__writes.length === n, writes0));
  await p.evaluate(() => { S.roster.push({ id: 200, name: 'Late Entry', num: '77', trans: '7777' }); S.raceDay.entries.push({ driverId: 200, classId: 1, pill: 11 }); save(); });
  await p.waitForTimeout(2000);
  check('a late entry is added to Race Manager\'s file by itself', await p.evaluate(() => /7777,77,Entry,Late/.test(window.__assign['DEMO.CSV'])));
  const st = await p.evaluate(() => { const s = JSON.parse(JSON.stringify({ roster: S.roster, entries: S.raceDay.entries })); s.roster.push({ id: 201, name: 'Tablet Signup', num: '88', trans: '8888' }); s.entries.push({ driverId: 201, classId: 1, pill: 12 }); return s; });
  await p.evaluate(s => syncApplySnapshot({ roster: JSON.stringify(s.roster), raceDay: { entries: JSON.stringify(s.entries) } }), st);
  await p.waitForTimeout(2000);
  check('a sign-up arriving from the registration tablet reaches Race Manager too', await p.evaluate(() => /8888,88,Signup,Tablet/.test(window.__assign['DEMO.CSV'] || '')));
  await p.evaluate(() => { window.__assignFail = true; S.roster.push({ id: 202, name: 'One More', num: '99', trans: '9999' }); S.raceDay.entries.push({ driverId: 202, classId: 1, pill: 13 }); save(); });
  await p.waitForTimeout(2000);
  check('if writing fails, it pauses and says so', await p.evaluate(() => !RmSync.ok && /stopped saving/i.test(document.body.textContent)));
  await p.evaluate(() => { window.__assignFail = false; openRmLineups(); });
  check('…and the sheet offers Resume', await p.evaluate(() => /Resume saving to Assign/.test(document.getElementById('sheetBody').textContent)));
  await p.evaluate(() => rmResumeAssign()); await p.waitForTimeout(300);
  check('Resume catches Race Manager up', await p.evaluate(() => RmSync.ok && /9999,99,More,One/.test(window.__assign['DEMO.CSV'])));
  await p.evaluate(() => rmStopAssign()); await p.waitForTimeout(200);
  check('Stop turns it off', await p.evaluate(() => !RmSync.dir && /Pick the Assign folder/.test(document.getElementById('sheetBody').textContent)));
  const noPicker = await browser.newContext(); await noPicker.addInitScript(() => { delete window.showDirectoryPicker; });
  const p2 = await noPicker.newPage(); await p2.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await p2.goto(`http://localhost:${PORT}/raceday/`); await p2.waitForTimeout(600);
  check('no folder access (Safari, iPad, phones): no Assign card, download still works', await p2.evaluate(() => rmAssignCard() === '' && typeof rmLineupDownload === 'function'));
  await noPicker.close();

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
