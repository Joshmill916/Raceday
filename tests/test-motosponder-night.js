// MotoSponder timing import, end to end, in BOTH apps (/raceday/ and /raceday2/).
//
// A. A real night's MotoSponder files, anonymized (test-data/motosponder-night/): drivers sign up in
//    RaceDay, then every heat (Live Race … DIV n) and main (Results … MAIN) is imported. Every finish
//    must land on the right driver in the right class. Bugs this guards (found 2026-11-11):
//    - kart numbers reused across classes (6 numbers, 13 drivers) matched the first driver in the
//      whole book with that number, not the one in the class;
//    - "JR1 +60 MAIN 1" made a new class "JR1"; "SMALL BLOCK OPEN DIV 1" a class "Small Block Open Div";
//    - heat files write names "Last- First".
// B. Class-from-file-name and name-format checks.
// C. B-mains (test-data/ fixtures, Pro Stock = 2 parallel B-mains): the import has a B-main step,
//    a feature file flags drivers who aren't in the lineup yet, and B-main files fill the transfers.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8861;
const NIGHT = path.join(ROOT, 'test-data', 'motosponder-night'), TD = path.join(ROOT, 'test-data');
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const rows = f => fs.readFileSync(f, 'utf8').replace(/\r/g, '').trim().split('\n').map(l => l.split(','));
const files = fs.readdirSync(NIGHT).filter(f => f.endsWith('.csv'));
const heatFiles = files.filter(f => / Live Race /.test(f));
const mainFiles = files.filter(f => / Results .*MAIN/.test(f));
const clsOf = f => f.replace(/^.* Results /, '').replace(/\s+(MAIN|DIV)\s.*$/, '').trim();
// Sign-ups the gate would have taken: one per class + number, named "First Last" from the results.
const signups = [];
mainFiles.forEach(f => rows(path.join(NIGHT, f)).forEach(r => {
  if (r.length === 5 && r[0] !== 'Pos' && !/Results/.test(r[0])) signups.push({ cls: clsOf(f), num: r[1].trim(), name: (r[2] + ' ' + r[3]).trim() });
}));
const classNames = [...new Set(signups.map(s => s.cls))];

(async () => {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': u.endsWith('.js') ? 'application/javascript' : 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const APP of ['raceday', 'raceday2']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errors = [], dialogs = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await p.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
    await p.goto(`http://localhost:${PORT}/${APP}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    const backup = JSON.parse(fs.readFileSync(path.join(TD, 'test-track-backup.json'), 'utf8'));
    const restore = (classes) => p.evaluate(([s, cl]) => { s.track = { name: 'Sample Speedway' }; s.classes = cl; return applyRestoredState(s, 'test'); }, [JSON.parse(JSON.stringify(backup)), classes]);
    // Opens the import on a step, loads a file, optionally applies; returns the preview.
    const imp = async (stepKey, file, apply, useCol) => {
      await p.evaluate(k => { if (!window.Imp || !Imp.rows) openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === k)); }, stepKey);
      await p.locator('#impFile').setInputFiles(file); await p.waitForTimeout(250);
      if (useCol) { await p.evaluate(() => impSetClsMode(true, true)); await p.waitForTimeout(150); }
      const pv = await p.evaluate(() => ({ cls: (classById(Imp.clsId) || {}).name, newCls: !!Imp.newCls, newName: Imp.newClsName || '', div: Imp.div,
        steps: impPipeline().map(s => s.key), st: impPreview.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}),
        notes: impPreview.filter(r => r.note).map(r => r.note), mi: [...new Set(impPreview.filter(r => r.status !== 'skip').map(r => r.mi))] }));
      if (apply) { await p.evaluate(() => (typeof impApplyClick === 'function' ? impApplyClick() : impApply())); await p.waitForTimeout(300); }
      await p.evaluate(() => { try { closeImport(); } catch (e) {} });
      return pv;
    };
    // The exact driver who signed up in that class with that number and name. Another driver
    // wrongly entered into the class with the same number does not count.
    const resOf = (cls, num, key, name) => p.evaluate(([cls, num, key, name]) => {
      const c = S.classes.find(k => k.name === cls); if (!c) return 'no class';
      const ids = new Set(S.raceDay.entries.filter(e => e.classId === c.id).map(e => e.driverId));
      const d = S.roster.find(x => ids.has(x.id) && String(x.num).toLowerCase() === num.toLowerCase() && x.name === name); if (!d) return 'no driver';
      const r = getRes(c.id); return key === 'ft' ? (r['ft_' + d.id] ?? null) : (r['h1_' + d.id] ?? r['h2_' + d.id] ?? null);
    }, [cls, num, key, name]);

    console.log(`\n=== ${APP} · A. A real MotoSponder night (anonymized) ===`);
    await restore(classNames.map((n, i) => ({ id: i + 1, name: n, maxPill: 200, heats: 1 })));
    const su = await p.evaluate(list => {
      let id = 5000;
      list.forEach((s, i) => {
        const c = S.classes.find(k => k.name === s.cls);
        let d = S.roster.find(r => r.num === s.num && r.name === s.name);
        if (!d) { d = { id: id++, name: s.name, num: s.num }; S.roster.push(d); }
        S.raceDay.entries.push({ driverId: d.id, classId: c.id, pill: i + 1 });
      });
      save(); return { roster: S.roster.length, entries: S.raceDay.entries.length };
    }, signups);
    check('57 sign-ups across 10 classes', su.entries === 57 && classNames.length === 10, JSON.stringify(su));
    for (const f of heatFiles) await imp('h1', path.join(NIGHT, f), true, false);
    let ok = 0, wrong = [];
    for (const f of heatFiles) for (const r of rows(path.join(NIGHT, f))) {
      if (r.length < 13 || r[0] === 'Pos') continue;
      const lf = r[3].match(/^\s*([^-]+?)\s*-\s*(.+?)\s*$/), nm = lf ? lf[2] + ' ' + lf[1] : r[3].trim();
      const want = /^\d+$/.test(r[0]) ? +r[0] : r[0], got = await resOf(r[1], r[2].trim(), 'h', nm);
      if (got === want) ok++; else wrong.push(r[1] + ' #' + r[2] + ': ' + want + '→' + got);
    }
    check('all 57 heat finishes on the right driver (shared kart numbers stay in their class)', ok === 57 && !wrong.length, ok + ' ok, ' + JSON.stringify(wrong.slice(0, 5)));
    const div = await imp('h1', path.join(NIGHT, files.find(f => / Results .*DIV/.test(f))), false, false);
    check('"Results SMALL BLOCK OPEN DIV 1" as a heat: class SMALL BLOCK OPEN, Heat 1, no new class', div.cls === 'SMALL BLOCK OPEN' && !div.newCls && div.div === 0 && !div.st.skip, JSON.stringify(div));
    for (const f of mainFiles) await imp('ft', path.join(NIGHT, f), true, false);
    ok = 0; wrong = [];
    for (const f of mainFiles) for (const r of rows(path.join(NIGHT, f))) {
      if (r.length !== 5 || r[0] === 'Pos' || /Results/.test(r[0])) continue;
      const want = /^\d+$/.test(r[0]) ? +r[0] : r[0], got = await resOf(clsOf(f), r[1].trim(), 'ft', (r[2] + ' ' + r[3]).trim());
      if (got === want) ok++; else wrong.push(clsOf(f) + ' #' + r[1] + ': ' + want + '→' + got);
    }
    check('all 57 main finishes on the right driver (JR1 +60 included, DNF/DNS kept)', ok === 57 && !wrong.length, ok + ' ok, ' + JSON.stringify(wrong.slice(0, 5)));
    const after = await p.evaluate(() => ({ classes: S.classes.map(c => c.name), roster: S.roster.length, entries: S.raceDay.entries.length }));
    check('no class was made from a file name, no driver doubled, nobody entered in a wrong class', after.classes.length === 10 && after.roster === su.roster && after.entries === 57, JSON.stringify({ classes: after.classes.length, roster: after.roster, entries: after.entries }));
    const lineups = await p.evaluate(() => S.classes.map(c => featureGridOrder(featureData(c.id), c.id).length + '/' + Object.keys(getRes(c.id)).filter(k => k.startsWith('ft_')).length));
    check('every feature lineup holds exactly the drivers who ran the main', lineups.every(x => x.split('/')[0] === x.split('/')[1]), JSON.stringify(lineups));

    console.log(`\n=== ${APP} · B. Class from the file name, "Last- First" ===`);
    const cf = await p.evaluate(() => [
      impClassFromFilename('Sample night Results JR1 +60 MAIN  1  MOTO 1.csv'),
      impClassFromFilename('Sample night Results SMALL BLOCK OPEN DIV  1  MOTO 1.csv'),
      impClassFromFilename('Sample night Results Pro Stock B MAIN  2  MOTO 1.csv'),
      impClassFromFilename('Junior 80cc Qualifying.txt'),
      impClassFromFilename('Sample night Results Mini Cup +40 MAIN  1  MOTO 1.csv'),
    ]);
    check('existing classes win: "JR1 +60", "SMALL BLOCK OPEN"', cf[0] === 'JR1 +60' && cf[1] === 'SMALL BLOCK OPEN', JSON.stringify(cf));
    check('a new class keeps its own numbers and drops session words ("Pro Stock", "Junior 80cc", "Mini Cup +40")', cf[2] === 'Pro Stock' && cf[3] === 'Junior 80cc' && cf[4] === 'Mini Cup +40', JSON.stringify(cf));
    const nm = await p.evaluate(() => {
      Imp = Imp || {}; Imp.cols = { trans: -1, num: -1, name: 0, name2: -1, cls: -1, pos: -1, time: -1 };
      return [impMatchDriver(['Ashford- Avery'], 0).name, impMatchDriver(['Mary-Kate Smith'], 0).name, impMatchDriver(['Smith, John'], 0).name];
    });
    check('"Last- First" reads as "First Last"; a hyphenated name is left alone', nm[0] === 'Avery Ashford' && nm[1] === 'Mary-Kate Smith' && nm[2] === 'John Smith', JSON.stringify(nm));
    const nm2 = await p.evaluate(() => [impMatchDriver(['Joe Smith - Rookie'], 0).name, impMatchDriver(['Van Dyke- Jo'], 0).name]);
    check('a name with a spaced dash ("Joe Smith - Rookie") is not flipped; "Van Dyke- Jo" is', nm2[0] === 'Joe Smith - Rookie' && nm2[1] === 'Jo Van Dyke', JSON.stringify(nm2));
    const sub = await p.evaluate(() => { const keep = S.classes; S.classes = [{ id: 1, name: 'Heavy' }, { id: 2, name: 'jr1 +60' }]; const r = [impClassFromFilename('Sample night Results Clone Heavy MAIN  1  MOTO 1.csv'), impClassFromFilename('Sample night Results JR1 +60 MAIN  1  MOTO 1.csv')]; S.classes = keep; return r; });
    check('a short class name never swallows a longer one; the track\'s own spelling is used', sub[0] === 'Clone Heavy' && sub[1] === 'jr1 +60', JSON.stringify(sub));

    console.log(`\n=== ${APP} · C. B-mains (Pro Stock, two parallel B-mains) ===`);
    await restore(backup.classes);
    await imp('qual', path.join(TD, '01-qualifying-all.csv'), true, true);
    await imp('h1', path.join(TD, '02-heats-set1-all.csv'), true, true);
    await imp('h2', path.join(TD, '03-heats-set2-all.csv'), true, true);
    const pre = await imp('ft', path.join(TD, '04-feature-all.csv'), false, true);
    check('the import has a B-main step', pre.steps.includes('bm'), JSON.stringify(pre.steps));
    const flagged = pre.notes.filter(n => /import the B-main first/.test(n)).length;
    check('a feature file before the B-mains flags the 4 drivers not in the lineup', flagged === 4 && pre.st.conflict === 4, JSON.stringify(pre.st));
    const featTrans = new Set(rows(path.join(TD, '04-feature-all.csv')).filter(c => c[4] === 'Pro Stock').map(c => c[5].trim()));
    const mains = await p.evaluate(() => { const c = S.classes.find(k => k.name === 'Pro Stock'); return featureData(c.id).mains.map(m => m.drivers.map(d => { const r = S.roster.find(x => x.id === d.id); return { num: r.num, name: r.name, trans: r.trans }; })); });
    check('Pro Stock has two B-mains', mains.length === 2);
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rd-bmain-'));
    for (let i = 0; i < mains.length; i++) {
      const order = [...mains[i].filter(d => featTrans.has(d.trans)), ...mains[i].filter(d => !featTrans.has(d.trans))];
      const f = path.join(tmp, 'Sample night Results Pro Stock B MAIN  ' + (i + 1) + '  MOTO 1.csv');
      fs.writeFileSync(f, ['Sample night Results Pro Stock B MAIN  ' + (i + 1) + '  MOTO 1', 'Pos,Number,First,Last,Make']
        .concat(order.map((d, k) => [k + 1, d.num, d.name.split(' ')[0], d.name.split(' ').slice(1).join(' '), 'COB- '].join(','))).join('\r\n') + '\r\n');
      const bp = await imp('bm', f, true, false);
      check('B-main ' + (i + 1) + ' file: Pro Stock, every driver matched, all in one main', bp.cls === 'Pro Stock' && !bp.newCls && !bp.st.skip && !bp.st.new && bp.mi.length === 1 && bp.mi[0] === i, JSON.stringify(bp.st) + ' mi ' + JSON.stringify(bp.mi));
    }
    const grid = await p.evaluate(() => { const c = S.classes.find(k => k.name === 'Pro Stock'); return featureGridOrder(featureData(c.id), c.id).map(r => String(S.roster.find(x => x.id === r.id).trans)); });
    check('the B-main transfers are in the feature lineup (20 cars)', grid.length === 20 && [...featTrans].every(t => grid.includes(t)), grid.length + ' cars');
    const ft = await imp('ft', path.join(TD, '04-feature-all.csv'), true, true);
    check('the feature file now imports with no conflicts', ft.st.match === 68 && !ft.st.conflict && !ft.st.new, JSON.stringify(ft.st));
    const gone = await p.evaluate(() => { const c = S.classes.find(k => k.name === 'Pro Stock'); const res = getRes(c.id); const ids = featureGridOrder(featureData(c.id), c.id).map(r => r.id); return ids.filter(id => res['ft_' + id] == null).length; });
    check('every Pro Stock feature car has its finish (DNF and DQ included)', gone === 0, gone + ' without a finish');
    const shared = await p.evaluate(() => {
      // Two drivers with the same number, neither entered in the class: say so instead of guessing.
      S.roster.push({ id: 9901, name: 'Avery Ashford', num: '777' }, { id: 9902, name: 'Blake Brightwater', num: '777' });
      Imp = Imp || {}; Imp.cols = { trans: -1, num: 0, name: -1, name2: -1, cls: -1, pos: -1, time: -1 };
      return impMatchDriver(['777'], S.classes[0].id).numShared;
    });
    check('two drivers wearing the same number with no other clue is flagged, not guessed', shared === true);


    console.log(`\n=== ${APP} · D. RFID read checks in the import preview ===`);
    await restore(classNames.map((n, i) => ({ id: i + 1, name: n, maxPill: 200, heats: 1 })));
    await p.evaluate(list => { let id = 5000; list.forEach((s, i) => { const c = S.classes.find(k => k.name === s.cls); let d = S.roster.find(r => r.num === s.num && r.name === s.name); if (!d) { d = { id: id++, name: s.name, num: s.num }; S.roster.push(d); } S.raceDay.entries.push({ driverId: d.id, classId: c.id, pill: i + 1 }); }); save(); }, signups);
    // The same rule, worked out from the files here: a last lap over 3x the file's median best lap, not DNF/DNS.
    const secs = v => { const x = String(v || '').replace(/\*+$/, '').trim().split('.'); return x.length === 3 ? +x[0] * 60 + +x[1] + +x[2] / 1000 : NaN; };
    let wantHard = 0, wantStar = 0, gotHard = 0, gotStar = 0, blockedOk = true;
    for (const f of heatFiles) {
      const rs = rows(path.join(NIGHT, f)).filter(r => r.length >= 13 && r[0] !== 'Pos');
      const bests = rs.map(r => secs(r[8])).filter(x => x > 0).sort((a, b) => a - b);
      const typ = bests[Math.floor(bests.length / 2)] || 0;
      const hardHere = rs.filter(r => !/^(DNF|DNS|DQ)$/.test(r[0]) && secs(r[6]) > 3 * typ).length;
      wantHard += hardHere; wantStar += rs.filter(r => r.some(c => /\d\*+\s*$/.test(c))).length;
      // 1) What the scorer sees (auto-import off).
      const pv = await p.evaluate(([text, name]) => {
        openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === 'h1'));
        Imp.watchAuto = false;
        impIngestText(text, name);
        const p = impPreview.filter(r => r.status !== 'skip');
        const out = { hard: p.filter(r => r.chk && r.chk.some(c => c.hard)).length, star: p.filter(r => r.chk && r.chk.some(c => /\*/.test(c.t))).length,
          shown: !!document.querySelector('.imp-chk') && /missed tag read|look off/.test(document.body.innerText) };
        try { closeImport(); } catch (e) {}
        return out;
      }, [fs.readFileSync(path.join(NIGHT, f), 'utf8'), f]);
      // 2) The same file landing in the watched folder: imported on its own only when nothing looks off.
      pv.applied = await p.evaluate(([text, name]) => {
        openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === 'h1'));
        Imp.watchAuto = true;
        const before = JSON.stringify(S.raceDay.heatResults);
        impIngestText(text, name, true);
        const changed = JSON.stringify(S.raceDay.heatResults) !== before;
        try { if (window.Imp) closeImport(); } catch (e) {}
        return changed;
      }, [fs.readFileSync(path.join(NIGHT, f), 'utf8'), f]);
      gotHard += pv.hard; gotStar += pv.star;
      if (hardHere && pv.applied) blockedOk = false;
      if (hardHere && !pv.shown) blockedOk = false;
    }
    check('likely missed tag reads are flagged on the right rows (' + wantHard + ' in these heats)', wantHard > 0 && gotHard === wantHard, 'flagged ' + gotHard + ' of ' + wantHard);
    check('times MotoSponder marked * are pointed out (' + wantStar + ')', gotStar === wantStar, gotStar + ' of ' + wantStar);
    check('a heat with a likely missed read is shown to the scorer and NOT auto-imported from the folder', blockedOk);

    console.log(`\n=== ${APP} · E. Practice tag check ===`);
    const pracFiles = files.filter(f => / Live Practice /.test(f));
    // One more sign-up whose tag never reads (made-up driver): the check must name them.
    await p.evaluate(() => { const c = S.classes.find(k => k.name === 'SMALL BLOCK OPEN'); S.roster.push({ id: 7777, name: 'Dead Tag', num: '999' }); S.raceDay.entries.push({ driverId: 7777, classId: c.id, pill: 777 }); save(); });
    const resBefore = await p.evaluate(() => JSON.stringify(S.raceDay.heatResults));
    for (const f of pracFiles) await imp('h1', path.join(NIGHT, f), false, false);   // picked while the Heat step is open
    // Fresh importer for the report: load all practice files into one tag check.
    const rep = await p.evaluate(async (texts) => {
      openImport('heat');
      texts.forEach(([t, n]) => impIngestText(t, n));
      const r = impPracReport();
      return { step: Imp.target, rep: r && { files: r.files, total: r.total, read: r.read, missing: r.missing.map(m => m.cls + '|' + m.num) }, shown: /Tag check/.test(document.body.innerText) };
    }, pracFiles.map(f => [fs.readFileSync(path.join(NIGHT, f), 'utf8'), f]));
    const seen = new Set();
    pracFiles.forEach(f => rows(path.join(NIGHT, f)).forEach(r => { if (r.length >= 13 && r[0] !== 'Pos') seen.add(r[1].toLowerCase() + '|' + r[2].trim().toLowerCase()); }));
    const pracCls = new Set(pracFiles.flatMap(f => rows(path.join(NIGHT, f)).filter(r => r.length >= 13 && r[0] !== 'Pos').map(r => r[1])));
    const wantMissing = signups.filter(s => pracCls.has(s.cls) && !seen.has(s.cls.toLowerCase() + '|' + s.num.toLowerCase())).map(s => s.cls + '|' + s.num).concat(['SMALL BLOCK OPEN|999']).sort();
    check('a practice file switches the import to the Practice step', rep.step === 'practice', rep.step);
    check('the tag check lists exactly the signed-up drivers never read in practice (' + wantMissing.length + ')', JSON.stringify(rep.rep.missing.sort()) === JSON.stringify(wantMissing) && rep.rep.files === pracFiles.length, JSON.stringify(rep.rep));
    check('the tag check is shown in the import', rep.shown);
    const pracAfter = await p.evaluate(() => { try { impApply({ silent: true }); } catch (e) {} return JSON.stringify(S.raceDay.heatResults); });
    check('practice saves nothing (no results changed)', pracAfter === resBefore);
    const back = await p.evaluate(async ([t, n]) => { Imp.watchAuto = false; impIngestText(t, n, true); return { step: Imp ? Imp.target : 'closed' }; }, [fs.readFileSync(path.join(NIGHT, heatFiles[0]), 'utf8'), heatFiles[0]]);
    check('the next race file from the folder goes back to the step that was open', back.step === 'heat', back.step);
    check(APP + ': no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log(`\n==== motosponder-night: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
