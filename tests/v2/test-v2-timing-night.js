// A whole race night through the timing import, once per timing system's file layout, in RaceDay 2:
// MYLAPS Orbits (tab-separated, title lines, First/Last Name, Transponder, "… Results.txt" names),
// Westhold Race Manager (Place/No./Name/Trns ID, no class column: class from the file name) and a
// plain spreadsheet export (BOM, Windows line endings, "Last, First" names, no transponders).
// MotoSponder has its own real-night test (tests/test-motosponder-night.js).
//
// Each night: Late Model (14 cars, feature of 10 → a B-main) and Pro Stock (6 cars) with the SAME
// kart numbers 1–6 on different drivers. Practice tag check → qualifying → heat (with one planted
// missed tag read) → B-main → feature. Every finish must land on the right driver.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8875;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

// Made-up drivers. Late Model #1–14, Pro Stock #1–6 (different people wearing the same numbers).
const FIRST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jordan', 'Kai', 'Lane', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Tate'];
const LAST = ['Ashford', 'Brightwater', 'Calloway', 'Dunmore', 'Ellsworth', 'Fairbanks', 'Garrison', 'Hartwell', 'Ingram', 'Jessup', 'Kingsley', 'Langford', 'Merriweather', 'Northcott', 'Oakhurst', 'Pemberton', 'Quarry', 'Redfield', 'Stanhope', 'Thornbury'];
const LM = Array.from({ length: 14 }, (_, i) => ({ cls: 'Late Model', num: String(i + 1), first: FIRST[i], last: LAST[i], trans: String(5100000 + i) }));
const PS = Array.from({ length: 6 }, (_, i) => ({ cls: 'Pro Stock', num: String(i + 1), first: FIRST[14 + i], last: LAST[14 + i], trans: String(5200000 + i) }));
const ALL = [...LM, ...PS];
const full = d => d.first + ' ' + d.last;
const sec = s => (s < 60 ? s.toFixed(3) : Math.floor(s / 60) + ':' + (s % 60).toFixed(3).padStart(6, '0'));
// deterministic shuffles
const order = (list, seed) => list.map((d, i) => [d, ((i + 1) * seed) % 97]).sort((a, b) => a[1] - b[1]).map(x => x[0]);

// Each layout: how a session file looks. rows = [{d, pos, laps, best, last}]
const LAYOUTS = {
  'MYLAPS Orbits': {
    trans: true,
    name: (cls, sess) => 'Orbits export ' + cls + ' ' + sess + ' Results.txt',
    file: (cls, sess, rows) => ['Sample Speedway - Saturday Night', cls + ' ' + sess, ['Pos', 'No.', 'First Name', 'Last Name', 'Class', 'Laps', 'Total Time', 'Diff', 'Best Tm', 'Last Tm', 'Transponder'].join('\t')]
      .concat(rows.map(r => [r.pos, r.d.num, r.d.first, r.d.last, r.d.cls, r.laps, '', '', '00:' + r.best.toFixed(3).padStart(6, '0'), '00:' + (r.last < 60 ? r.last.toFixed(3).padStart(6, '0') : sec(r.last)), r.d.trans].join('\t'))).join('\n'),
  },
  'Westhold': {
    trans: true,
    name: (cls, sess) => cls + ' ' + sess + '.csv',
    file: (cls, sess, rows) => [sess === 'Qualifying' || sess === 'Practice' ? 'Place,No.,Name,Trns ID,Laps,Fast Lap,Fast Time,Last Time' : 'Place,No.,Name,Trns ID,Laps,Lag,Scored Time,Last Time']
      .concat(rows.map(r => [r.pos, r.d.num, full(r.d), r.d.trans, r.laps, sess === 'Qualifying' || sess === 'Practice' ? 3 : '0.000', r.best.toFixed(3), sec(r.last)].join(','))).join('\n'),
  },
  'Spreadsheet export': {
    trans: false,
    name: (cls, sess) => '2026-11-15 ' + cls + ' ' + sess + ' (Official).csv',
    file: (cls, sess, rows) => '﻿' + ['Pos,Car #,Driver,Class,Laps,Best Lap,Last Lap']
      .concat(rows.map(r => [r.pos, r.d.num, '"' + r.d.last + ', ' + r.d.first + '"', r.d.cls, r.laps, r.best.toFixed(3), sec(r.last)].join(','))).join('\r\n') + '\r\n',
  },
};

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [vendor, L] of Object.entries(LAYOUTS)) {
    console.log(`\n=== ${vendor} ===`);
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
    await p.goto(`http://localhost:${PORT}/raceday2/index.html`); await p.waitForTimeout(600);
    await p.evaluate((all) => {
      S.track.name = 'Sample Speedway';
      S.classes = [{ id: 1, name: 'Late Model', maxPill: 200, heats: 1, maxFeature: 10, maxBMain: 12 }, { id: 2, name: 'Pro Stock', maxPill: 200, heats: 1 }];
      S.settings.bmainMode = 'single'; S.settings.transfers = 2;
      S.roster = all.map((d, i) => ({ id: 100 + i, name: d.first + ' ' + d.last, num: d.num, trans: '' }));
      S.raceDay = { date: today(), entries: all.map((d, i) => ({ driverId: 100 + i, classId: d.cls === 'Late Model' ? 1 : 2, pill: (i % 14) + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
      save(); setDeviceRole('admin'); applyRole();
    }, ALL);
    const idOf = d => 100 + ALL.indexOf(d);
    const load = async (step, cls, sess, rows, opts = {}) => p.evaluate(([step, text, name, auto]) => {
      openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === step));
      Imp.watchAuto = !!auto;
      const before = JSON.stringify(S.raceDay.heatResults);
      impIngestText(text, name, !!auto);
      const live = !!(window.Imp && Imp.rows);
      const out = live ? { target: Imp.target, cls: (classById(Imp.clsId) || {}).name, newCls: !!Imp.newCls, useCol: !!Imp.useClsCol, vendor: Imp.vendor && Imp.vendor.name,
        st: impPreview.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}),
        chk: impPreview.filter(r => r.chk).map(r => r.chk.map(c => c.kind).join('+')), mi: [...new Set(impPreview.filter(r => r.status !== 'skip').map(r => r.mi))] } : { closed: true };
      out.autoApplied = JSON.stringify(S.raceDay.heatResults) !== before;
      return out;
    }, [step, L.file(cls, sess, rows), L.name(cls, sess), opts.auto]);
    const apply = () => p.evaluate(() => { if (window.Imp && Imp.rows) impApplyClick(); try { closeImport(); } catch (e) {} });
    const res = (d, key) => p.evaluate(([id, cid, key]) => getRes(cid)[key + '_' + id] ?? null, [idOf(d), d.cls === 'Late Model' ? 1 : 2, key]);

    // 1. Practice: Late Model, one car (#14) never goes out
    const prac = await load('qual', 'Late Model', 'Practice', LM.slice(0, 13).map((d, i) => ({ d, pos: i + 1, laps: 3 + (i % 4), best: 47 + i * 0.1, last: 48 })));
    const rep = await p.evaluate(() => { const r = impPracReport(); return r && r.missing.map(m => m.num); });
    check('practice file goes to the tag check, which names the one car never read', prac.target === 'practice' && JSON.stringify(rep) === '["14"]', JSON.stringify({ target: prac.target, rep }));
    const pracSaved = await p.evaluate(() => { try { impApplyClick(); } catch (e) {} try { closeImport(); } catch (e) {} return Object.keys(getRes(1)).length; });
    check('practice saves nothing', pracSaved === 0, pracSaved);

    // 2. Qualifying, both classes (Pro Stock first: numbers 1–6 exist in both classes)
    for (const [cls, list] of [['Pro Stock', PS], ['Late Model', LM]]) {
      const q = order(list, 7).map((d, i) => ({ d, pos: '', laps: 2 + (i % 5), best: 46 + i * 0.137, last: 47 }));
      const pv = await load('qual', cls, 'Qualifying', q);
      check(cls + ' qualifying: class ' + (pv.useCol ? 'column' : 'from the file name') + ', every car matched, no new class, no laps-down noise', (pv.useCol || pv.cls === cls) && !pv.newCls && pv.st.match === list.length && !pv.chk.some(c => /down/.test(c)), JSON.stringify(pv));
      await apply();
      const grid = await p.evaluate(cid => S.raceDay.entries.filter(e => e.classId === cid).sort((a, b) => a.pill - b.pill).map(e => e.driverId), cls === 'Late Model' ? 1 : 2);
      check(cls + ' grid follows the best laps', JSON.stringify(grid) === JSON.stringify(q.map(r => idOf(r.d))), JSON.stringify(grid.slice(0, 5)));
    }
    if (L.trans) check('transponders learned for all 20 drivers', await p.evaluate(() => S.roster.filter(d => d.trans).length) === 20);

    // 3. Heat: Late Model, one planted missed read (#9: a lap 4x the normal lap, 2 laps down)
    const heat = order(LM, 11).map((d, i) => ({ d, pos: i + 1, laps: d.num === '9' ? 6 : 8, best: 46.5 + i * 0.05, last: d.num === '9' ? 47 * 4 : 47.2 }));
    const auto = await load('h1', 'Late Model', 'Heat 1', heat, { auto: true });
    check('heat with a missed read: flagged, and NOT auto-imported from the folder', !auto.autoApplied && auto.chk.some(c => /read/.test(c)), JSON.stringify({ applied: auto.autoApplied, chk: auto.chk }));
    await p.evaluate(() => { try { closeImport(); } catch (e) {} });
    const hv = await load('h1', 'Late Model', 'Heat 1', heat);
    check('heat: every car matched (shared numbers stay in Late Model)', hv.st.match === 14 && !hv.st.new && !hv.st.conflict, JSON.stringify(hv.st));
    await apply();
    let ok = 0; for (const r of heat) if (await res(r.d, 'h1') === r.pos) ok++;
    check('heat: all 14 finishes on the right driver', ok === 14, ok + '/14');
    const ph = order(PS, 5).map((d, i) => ({ d, pos: i + 1, laps: 8, best: 47 + i * 0.1, last: 47.3 }));
    const phv = await load('h1', 'Pro Stock', 'Heat 1', ph);
    check('a clean heat gets no warnings (no false missed reads)', !phv.chk.length, JSON.stringify(phv.chk));
    await apply();
    ok = 0; for (const r of ph) if (await res(r.d, 'h1') === r.pos) ok++;
    check('Pro Stock heat: all 6 on the right driver (same numbers as Late Model)', ok === 6, ok + '/6');
    const lmUntouched = await p.evaluate(() => [1, 2, 3, 4, 5, 6].every(n => { const d = S.roster.find(x => x.num === String(n) && S.raceDay.entries.some(e => e.driverId === x.id && e.classId === 1)); return getRes(1)['h1_' + d.id] != null; }));
    check('the Pro Stock heat did not touch Late Model #1–6', lmUntouched);

    // 4. B-main: Late Model 14 > feature 10 → one B-main, top 2 transfer
    const mains = await p.evaluate(() => featureData(1).mains.map(m => m.drivers.map(d => d.id)));
    check('Late Model has a B-main and the import offers it', mains.length === 1 && await p.evaluate(() => impPipeline().some(s => s.key === 'bm')), JSON.stringify(mains.map(m => m.length)));
    const bmDrivers = mains[0].map(id => ALL[id - 100]);
    const bm = order(bmDrivers, 13).map((d, i) => ({ d, pos: i + 1, laps: 6, best: 47 + i * 0.1, last: 47.4 }));
    const bv = await load('bm', 'Late Model', 'B Main', bm);
    check('B-main file: class Late Model, all matched into the B-main', (bv.useCol || bv.cls === 'Late Model') && bv.st.match === bm.length && bv.mi.length === 1, JSON.stringify(bv));
    await apply();
    const lineup = await p.evaluate(() => featureGridOrder(featureData(1), 1).map(r => r.id));
    check('the B-main top 2 are in the 10-car feature', lineup.length === 10 && lineup.includes(idOf(bm[0].d)) && lineup.includes(idOf(bm[1].d)), lineup.length + ' cars');

    // 5. Feature: the 10-car lineup finishes, one DNF
    const ft = order(lineup.map(id => ALL[id - 100]), 17).map((d, i, a) => ({ d, pos: i === a.length - 1 ? 'DNF' : i + 1, laps: 15, best: 46.8 + i * 0.05, last: 47.1 }));
    const fv = await load('ft', 'Late Model', 'Feature', ft);
    check('feature: all 10 matched, nobody flagged as outside the lineup', fv.st.match === 10 && !fv.st.conflict && !fv.st.new, JSON.stringify(fv.st));
    await apply();
    ok = 0; for (const r of ft) if (await res(r.d, 'ft') === r.pos) ok++;
    check('feature: all 10 finishes (DNF included) on the right driver', ok === 10, ok + '/10');
    const classes = await p.evaluate(() => S.classes.map(c => c.name));
    check('no class was created from a file name', classes.length === 2, JSON.stringify(classes));
    check('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  console.log('\n=== Class from the file name (every system\'s naming) ===');
  {
    const p = await browser.newPage();
    await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
    await p.goto(`http://localhost:${PORT}/raceday2/index.html`); await p.waitForTimeout(500);
    const cases = [
      ['Junior 80cc Feature Results.csv', 'Junior 80cc'], ['Results - Junior 80cc - Heat 2.csv', 'Junior 80cc'],
      ['2026-11-07 Junior 80cc Qualifying.csv', 'Junior 80cc'], ['Junior 80cc_B-Main_11-07-2026.txt', 'Junior 80cc'],
      ['Race 5 - Pro Stock A Main.csv', 'Pro Stock'], ['Pro Stock LCQ.csv', 'Pro Stock'], ['westhold-race.csv', ''],
      ['Orbits export Late Model Heat 1 Results.txt', 'Late Model'], ['Session 12 Late Model Practice.csv', 'Late Model'],
      ['Late Model - Semi 1.csv', 'Late Model'], ['Late Model Feature (Official).csv', 'Late Model'], ['Late Model Feature 11.07.26.csv', 'Late Model'],
      ['Riverside Speedway Results Late Model Heat 1.csv', 'Late Model'], ['late_model_heat_1.csv', 'Late Model'],
      ['Junior 2 Heat 1.csv', 'Junior 2'], ['Kid Kart Practice Session 2.csv', 'Kid Kart'], ['Late Model Consolation.csv', 'Late Model'],
      ['Pro Stock Dash.csv', 'Pro Stock'], ['Sample night Results JR1 +60 MAIN  1  MOTO 1.csv', 'JR1 +60'],
      ['Sample night Results SMALL BLOCK OPEN DIV  1  MOTO 1.csv', 'SMALL BLOCK OPEN'], ['Clone Heavy Feature.csv', 'Clone Heavy'],
    ];
    const got = await p.evaluate(cases => {
      S.classes = ['Junior 80cc', 'Pro Stock', 'Late Model', 'Junior 2', 'Kid Kart', 'JR1 +60', 'SMALL BLOCK OPEN', 'Heavy'].map((n, i) => ({ id: i + 1, name: n }));
      return cases.map(([f]) => impClassFromFilename(f));
    }, cases);
    const wrong = cases.map((c, i) => [c[0], c[1], got[i]]).filter(x => x[1] !== x[2]);
    check('all ' + cases.length + ' file names give the right class (dates, "Results" either side, LCQ/semi/dash, "Junior 2", "JR1 +60"; "Heavy" never swallows "Clone Heavy")', !wrong.length, JSON.stringify(wrong));
    await p.close();
  }

  console.log(`\n==== v2-timing-night: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
