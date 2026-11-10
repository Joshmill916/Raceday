// v2 "Build a race": a format per class (a named bundle of the class settings the engine already
// reads — no new race logic), format files that are checked before anything changes, and
// cancelling an entry carefully (two steps, Undo for the night, audit log, pill goes back).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8867;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [], alerts = [];
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { alerts.push(d.message()); d.accept(d.type() === 'prompt' ? (globalThis.NEXT_PROMPT || '') : undefined); });
  await p.goto(`http://localhost:${PORT}/raceday2/?demo=1`); await p.waitForTimeout(900);
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); });

  console.log('— the screen —');
  check('Build a race is the first Race night section and opens', await p.evaluate(() => {
    const first = ADMIN_SECTIONS.filter(s => s.door === 'night')[0].id === 'race';
    admOpen('race');
    const w = document.getElementById('raceWrap');
    return first && !!w && /Classes &amp; formats|Classes & formats/.test(w.innerHTML) && w.querySelectorAll('button[onclick^="fmtPick("]').length === S.classes.length;
  }));
  check('race name + day are the pre-registration fields; gates open is a schedule row', await p.evaluate(() => {
    setRaceField('title', 'Fall Classic'); setRaceField('date', 'Sat, Nov 22'); setRaceField('gates', '4:00 PM');
    const a = S.settings.preOnline.title === 'Fall Classic' && S.settings.preOnline.date === 'Sat, Nov 22' && nightSchedule()[0].label === 'Gates open' && raceGates() === '4:00 PM';
    setRaceField('gates', '5:00 PM');
    const b = nightSchedule().filter(r => r.label === 'Gates open').length === 1 && raceGates() === '5:00 PM';
    setRaceField('gates', '');
    return a && b && !raceGates();
  }));
  check('no new top-level state', await p.evaluate(() => {
    const st = JSON.parse(localStorage.getItem(activeKey()));
    return !('formats' in st) && !('race' in st) && !('cancelled' in st);
  }));

  console.log('— formats = existing class settings —');
  check('built-in formats set heats/inverts and leave sizes + laps alone', await p.evaluate(() => {
    const c = S.classes[0]; c.maxHeat = 7; c.laps = { heat: 8, feature: 15 }; c.invert = 4; c.invertScope = 'heat';
    fmtApply(c, fmtById('qual1').rules);
    const a = classHeats(c) === 1 && classInvertN(c) === 0 && c.maxHeat === 7 && c.laps.heat === 8;
    fmtApply(c, fmtById('qual0').rules); const b = classHeats(c) === 0;
    fmtApply(c, fmtById('pill2').rules);
    return a && b && classHeats(c) === 2 && fmtOf(c).id === 'pill2';
  }));
  check('picking a format in the sheet applies it, names it, logs it', await p.evaluate(() => {
    const c = S.classes[1]; fmtApply(c, fmtById('pill2').rules); const n = S.audit.length;
    fmtPick(c.id, 'qual0'); const sheet = /What this format sets/.test(document.getElementById('sheetBody').innerHTML) && /Use for/.test(document.getElementById('sheetFoot').innerHTML);
    fmtUse();
    return sheet && classHeats(c) === 0 && c.fmt === 'qual0' && fmtOf(c).name === 'Qualify to feature'
      && S.audit.length === n + 1 && S.audit[n].action === 'Class format' && S.audit[n].newValue === 'Qualify to feature';
  }));
  check('editing the class afterwards shows it as custom, not the old name', await p.evaluate(() => {
    const c = S.classes[1]; c.invert = 6; c.invertScope = 'field';
    return fmtOf(c) === null;
  }));
  check('save a class as a format, then use it on another class (everything copies)', await p.evaluate(() => {
    const a = S.classes[0], b = S.classes[1];
    a.heats = 2; a.invert = 4; a.invertScope = 'heat'; a.invertFeature = 6; a.maxHeat = 9; a.maxFeature = 16; a.laps = { heat: 8, bmain: 10, feature: 15 };
    window.prompt = () => 'Winter Series rules';
    fmtSaveFrom(a.id);
    const f = S.settings.formats.find(x => x.name === 'Winter Series rules');
    fmtPick(b.id, f.id); fmtUse();
    const same = JSON.stringify(fmtFromClass(a)) === JSON.stringify(fmtFromClass(b));
    return !!f && same && b.fmt === f.id && fmtOf(b).id === f.id && closeSheet() === undefined;
  }));
  check('formats are kept in S.settings (they sync like the rest of settings)', await p.evaluate(() =>
    SYNC_FIELDS.includes('settings') && JSON.parse(localStorage.getItem(activeKey())).settings.formats.length === 1));

  console.log('— format files —');
  check('download → import round-trips', await p.evaluate(() => {
    const txt = fmtFileText(fmtSaved());
    S.settings.formats = [];
    const ok = fmtImportText(txt, 'winter.json');
    const f = fmtSaved()[0];
    return ok && f.name === 'Winter Series rules' && f.from === 'file' && f.rules.invert === 4 && f.rules.laps.feature === 15 && JSON.parse(txt).raceday === 'format';
  }));
  const bad = await p.evaluate(() => {
    const before = JSON.stringify(S.settings.formats);
    const files = [
      '{nope',
      JSON.stringify({ formats: [{ name: 'Two qualis', rules: { heats: 3 } }] }),
      JSON.stringify({ formats: [{ name: 'Ok', rules: { heats: 2 } }, { name: 'Weird', rules: { heats: 2, qualifyingSessions: 2 } }] }),
      JSON.stringify({ formats: [{ name: 'Big', rules: { maxFeature: 400 } }] }),
      JSON.stringify({ formats: [{ name: 'Laps', rules: { laps: { warmup: 3 } } }] }),
      JSON.stringify({ formats: [{ rules: { heats: 1 } }] }),
      JSON.stringify({ formats: [] })
    ];
    const res = files.map(t => fmtImportText(t, 'x.json'));
    return { res, same: JSON.stringify(S.settings.formats) === before };
  });
  check('every bad file is refused and nothing changes (a good format in a bad file is not half-imported)', bad.res.every(x => x === false) && bad.same, JSON.stringify(bad));
  check('the refusal says what RaceDay can\'t run', alerts.some(a => /qualifyingSessions/.test(a) && /Nothing changed/.test(a)) && alerts.some(a => /3/.test(a) && /RaceDay runs 2/.test(a)));
  check('a single {name, rules} file imports too, and same-name replaces after asking', await p.evaluate(() => {
    const ok = fmtImportText(JSON.stringify({ name: 'Winter Series rules', rules: { heats: 1 } }), 'one.json');
    return ok && fmtSaved().length === 1 && fmtSaved()[0].rules.heats === 1;
  }));
  check('delete a format; classes keep their settings', await p.evaluate(() => {
    const b = S.classes[1], before = JSON.stringify(fmtFromClass(b));
    fmtDelete(fmtSaved()[0].id);
    return fmtSaved().length === 0 && JSON.stringify(fmtFromClass(b)) === before;
  }));
  check('import / delete need admin', await p.evaluate(() => {
    const real = adminOk; window.adminOk = () => false;
    const r = fmtImportText(JSON.stringify({ name: 'X', rules: { heats: 1 } }), 'x.json');
    window.adminOk = real; return r === false && fmtSaved().length === 0;
  }));

  console.log('— cancel an entry, carefully —');
  const c1 = await p.evaluate(() => {
    admOpen('today');
    const byDriver = {}; S.raceDay.entries.forEach(e => { (byDriver[e.driverId] = byDriver[e.driverId] || []).push(e); });
    const did = Object.keys(byDriver).find(k => byDriver[k].length >= 2) || S.raceDay.entries[0].driverId;
    const e = S.raceDay.entries.find(x => String(x.driverId) === String(did));
    const i = S.raceDay.entries.indexOf(e);
    const n = S.raceDay.entries.length;
    delEntry(i);
    const body = document.getElementById('sheetBody').innerHTML, foot = document.getElementById('sheetFoot').innerHTML;
    const stillThere = S.raceDay.entries.length === n;
    return { body, foot, stillThere, n, pill: e.pill, classId: e.classId, driverId: e.driverId, name: driverById(e.driverId).name, i };
  });
  check('step 1 only opens a sheet naming driver, class and pill — nothing removed yet', c1.stillThere && c1.body.includes(c1.name.replace(/&/g, '&amp;')) && /goes back in the draw/.test(c1.body) && /Keep the entry/.test(c1.foot) && /Cancel .* from /.test(c1.foot));
  check('"Keep the entry" changes nothing', await p.evaluate(n => { closeSheet(); return S.raceDay.entries.length === n && cancelledList().length === 0; }, c1.n));
  const c2 = await p.evaluate(c => {
    delEntry(c.i); const nAudit = S.audit.length; cancelEntryNow(c.i);
    const gone = !S.raceDay.entries.some(e => e.driverId === c.driverId && e.classId === c.classId);
    const rec = cancelledList()[0];
    const ui = document.getElementById('cancelledWrap').innerHTML;
    return { gone, rec, logged: S.audit[nAudit] && S.audit[nAudit].action === 'Entry cancelled', ui, synced: SYNC_FIELDS.includes('raceDay/cancelled'), n: S.raceDay.entries.length };
  }, c1);
  check('step 2 cancels just that class, keeps the record, logs it', c2.gone && c2.rec && c2.rec.entry.pill === c1.pill && c2.logged && c2.n === c1.n - 1);
  check('cancelled list shows with Undo, and syncs', /Cancelled tonight · 1/.test(c2.ui) && /undoCancel\(/.test(c2.ui) && c2.synced);
  check('the freed pill can be drawn by someone else', await p.evaluate(c => !S.raceDay.entries.some(e => e.classId === c.classId && e.pill === c.pill), c1));
  check('Undo puts the entry back with its pill and logs it', await p.evaluate(c => {
    const n = S.audit.length; undoCancel(cancelledList()[0].id);
    const e = S.raceDay.entries.find(x => x.driverId === c.driverId && x.classId === c.classId);
    return !!e && e.pill === c.pill && cancelledList().length === 0 && S.audit[n].action === 'Entry restored';
  }, c1));
  check('"Also cancel" takes the driver\'s other classes in one go', await p.evaluate(c => {
    const mine = S.raceDay.entries.filter(e => e.driverId === c.driverId);
    if (mine.length < 2) return 'skip';
    const i = S.raceDay.entries.indexOf(mine[0]);
    delEntry(i); document.querySelectorAll('.cxAlso').forEach(x => { x.checked = true; }); cancelEntryNow(i);
    const ok = !S.raceDay.entries.some(e => e.driverId === c.driverId) && cancelledList().length === mine.length;
    undoCancelAt(cancelledList()[0].at);
    return ok && S.raceDay.entries.filter(e => e.driverId === c.driverId).length === mine.length;
  }, c1) !== false);
  check('Undo when the pill was re-drawn asks for a new free pill', await p.evaluate(c => {
    const i = S.raceDay.entries.findIndex(x => x.driverId === c.driverId && x.classId === c.classId);
    delEntry(i); cancelEntryNow(i);
    const other = S.raceDay.entries.find(x => x.classId === c.classId);
    const oldPill = other.pill; other.pill = c.pill;      // someone else drew that pill
    const used = new Set(S.raceDay.entries.filter(x => x.classId === c.classId).map(x => +x.pill));
    let free = 1; while (used.has(free)) free++;
    window.prompt = () => String(free);
    undoCancel(cancelledList()[0].id);
    const back = S.raceDay.entries.find(x => x.driverId === c.driverId && x.classId === c.classId);
    other.pill = oldPill;
    return !!back && back.pill === free;
  }, c1));
  check('cancel/undo need admin', await p.evaluate(() => {
    const real = adminOk; window.adminOk = () => false;
    const n = S.raceDay.entries.length; cancelEntryNow(0);
    window.adminOk = real; return S.raceDay.entries.length === n;
  }));
  check('a new race day starts with an empty cancelled list', await p.evaluate(() => {
    S.raceDay.cancelled = [{ id: 'x', entry: {}, name: 'a', cls: 'b', at: 1 }];
    S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    return cancelledList().length === 0 && cancelledMarkup() === '';
  }));

  console.log('— pre-registered list cancel —');
  check('cancel a pre-registration → Cancelled list → Undo brings it back', await p.evaluate(() => {
    const d = S.roster[0];
    S.settings.preReg = [{ driverId: d.id, name: d.name, num: d.num, classIds: [S.classes[0].id], missing: [], at: Date.now() }];
    admOpen('prereg'); preRemove(0);
    const mid = preList().length === 0 && /Cancelled · 1/.test(document.getElementById('preregWrap').innerHTML);
    preUndo(0);
    return mid && preList().length === 1 && (S.settings.preGone || []).length === 0;
  }));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
