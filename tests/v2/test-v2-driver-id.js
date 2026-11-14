// Driver identity across RaceDay, Race Manager and Driven (2026-11-14). Each system knows a driver by
// something different (Race Manager: transponder + number; RaceDay: its driver record; Driven: the
// linked card), so a wrong link quietly credits the wrong driver everywhere. Guards:
// 1. a transponder saved on two drivers tonight is a Conflict on import (never auto-imported), is left
//    out of Race Manager's lineup file with a warning, and warns at sign-up;
// 2. a transponder is learned from a file only when the file's number AND name both agree with the
//    driver and nobody else has it (a wrong one would be sent to Race Manager and repeat all night);
// 3. a lineup file changed in Race Manager since RaceDay wrote it is not overwritten until a person
//    chooses "Use RaceDay's lineup";
// 4. linking a Driven card whose name doesn't match, or that's already on another driver, needs a yes;
//    refreshes and offline retries of an existing link don't ask.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8878;
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
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await ctx.addInitScript(() => {
    window.__assign = {}; window.__writes = [];
    const assign = { kind: 'directory', name: 'Assign', requestPermission: async () => 'granted', queryPermission: async () => 'granted',
      getFileHandle: async (name, opt) => {
        if (!(opt && opt.create) && !(name in window.__assign)) throw new DOMException('not found', 'NotFoundError');
        return { getFile: async () => ({ text: async () => window.__assign[name] }),
          createWritable: async () => { let buf = ''; return { write: async t => { buf += t; }, close: async () => { window.__assign[name] = buf; window.__writes.push(name); } }; } };
      } };
    window.showDirectoryPicker = async () => assign;
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; let answer = true;
  p.on('dialog', d => { dialogs.push(d.message()); if (d.type() === 'confirm' && !answer) d.dismiss(); else d.accept(); });
  await p.goto(`http://localhost:${PORT}/raceday2/`); await p.waitForTimeout(800);
  const setup = () => p.evaluate(() => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    S.track.name = 'ID Speedway'; S.classes = [{ id: 1, name: 'Junior', maxPill: 200, heats: 2 }];
    S.roster = [
      { id: 1, name: 'Ava Brooks', num: '7', trans: '1001' },
      { id: 2, name: 'Ben Carter', num: '12', trans: '1002' },
      { id: 3, name: 'Cody Diaz', num: '3', trans: '1001' },   // same tag as Ava: last week's rental
      { id: 4, name: 'Dana Evans', num: '4', trans: '' }
    ];
    S.raceDay = { date: today(), entries: [1, 2, 3, 4].map((id, i) => ({ driverId: id, classId: 1, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    localStorage.removeItem('rd_imp_done'); localStorage.removeItem('rd_rm_last'); save();
  });

  console.log('\n=== 1. One transponder, two drivers ===');
  await setup();
  const dup = await p.evaluate(() => ({ d: dupTransTonight(), rows: rmLineupRows(1) }));
  check('tonight\'s duplicate is found', JSON.stringify(dup.d['1001'] || []) === '["Ava Brooks","Cody Diaz"]', JSON.stringify(dup.d));
  check('both are left out of Race Manager\'s lineup file', dup.rows.lines.length === 1 && dup.rows.dup.length === 2, JSON.stringify(dup.rows));
  check('…and the lineup screen says why', await p.evaluate(() => { openRmLineups(); return /same transponder on two drivers/.test(document.getElementById('sheetBody').textContent); }));
  const imp = await p.evaluate(() => {
    closeSheet(); openImport('heat');
    impIngestText('Pos,Number,Name,Transponder\n1,7,Ava Brooks,1001\n2,12,Ben Carter,1002\n', 'Junior Heat 1.csv', true);
    return { st: impPreview.map(r => r.status), note: impPreview[0].note, entries: JSON.stringify(S.raceDay.heatResults) };
  });
  check('a file row on that transponder is a Conflict, not a quiet pick', imp.st[0] === 'conflict' && /saved on two drivers/.test(imp.note), JSON.stringify(imp));
  check('…so nothing auto-imports', imp.entries === '{}', imp.entries);
  await p.evaluate(() => closeSheet());
  dialogs.length = 0;
  const signupToast = await p.evaluate(() => {
    S.roster.push({ id: 5, name: 'Eli Ford', num: '5', trans: '1002' }); save();
    const before = document.querySelectorAll('.toast').length;
    // what register() does at the end, for a driver whose tag Ben already has tonight
    S.raceDay.entries.push({ driverId: 5, classId: 1, pill: 5 }); save();
    const tx = impNormTrans('1002'), dups = dupTransTonight();
    return !!dups[tx] && dups[tx].includes('Ben Carter') && dups[tx].includes('Eli Ford');
  });
  check('sign-up sees the clash the moment the second driver is entered', signupToast);
  check('register() warns at sign-up (code path present)', await p.evaluate(() => /also on/.test(register.toString()) && /dupTransTonight/.test(register.toString())));

  console.log('\n=== 2. Learning a transponder ===');
  await setup();
  const learn = await p.evaluate(() => {
    S.roster.find(d => d.id === 3).trans = ''; save();
    openImport('heat'); Imp.watchAuto = false;
    // Dana: number + name agree → learned. Cody: number only (name differs) → not learned.
    impIngestText('Pos,Number,Name,Transponder\n1,4,Dana Evans,2004\n2,3,Cody Dee,2003\n', 'Junior Heat 1.csv', false);
    impApplyClick();
    return { dana: driverById(4).trans, cody: driverById(3).trans };
  });
  check('number and name agree: transponder learned', learn.dana === '2004', JSON.stringify(learn));
  check('only the number agrees: not learned', !learn.cody, JSON.stringify(learn));
  check('…and the summary says which weren\'t saved', dialogs.some(m => /Transponders not saved/.test(m) && /Cody Diaz/.test(m)), JSON.stringify(dialogs.slice(-2)));
  const taken = await p.evaluate(() => {
    S.roster.find(d => d.id === 4).trans = ''; save();
    openImport('heat'); Imp.watchAuto = false;
    impIngestText('Pos,Number,Name,Transponder\n1,4,Dana Evans,1002\n', 'Junior Heat 2.csv', false);   // Ben's tag
    impApplyClick();
    return driverById(4).trans;
  });
  check('a tag someone else already has is never learned', !taken, taken);

  console.log('\n=== 3. A lineup file fixed in Race Manager ===');
  await setup();
  await p.evaluate(async () => { S.roster.find(d => d.id === 3).trans = '1003'; save(); await rmPickAssign(); closeSheet(); });
  const first = await p.evaluate(() => window.__assign['JUNIOR.CSV'] || '');
  check('RaceDay writes the lineup file', /1001,7,Brooks,Ava/.test(first), first);
  // the scorer fixes Ava's name at the timing stand; Race Manager saves the file
  await p.evaluate(() => { window.__assign['JUNIOR.CSV'] = window.__assign['JUNIOR.CSV'].replace('Brooks,Ava', 'Brooks,Avery'); });
  await p.evaluate(() => { S.roster.push({ id: 6, name: 'Late Entry', num: '77', trans: '7777' }); S.raceDay.entries.push({ driverId: 6, classId: 1, pill: 6 }); save(); });
  await p.waitForTimeout(2200);
  const held = await p.evaluate(() => ({ file: window.__assign['JUNIOR.CSV'], held: Object.keys(RmSync.held) }));
  check('a file changed in Race Manager is not overwritten', /Brooks,Avery/.test(held.file) && !/7777/.test(held.file), held.file);
  check('…the class is held, and the screen offers a choice', held.held.includes('JUNIOR.CSV') && await p.evaluate(() => { openRmLineups(); return /Use RaceDay's lineup/.test(document.getElementById('sheetBody').textContent); }));
  await p.evaluate(() => rmUseRaceDay('JUNIOR.CSV')); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ file: window.__assign['JUNIOR.CSV'], held: Object.keys(RmSync.held) }));
  check('choosing RaceDay\'s lineup writes it and clears the hold', /7777,77,Entry,Late/.test(after.file) && /Brooks,Ava/.test(after.file) && !after.held.length, JSON.stringify(after));
  const writes0 = await p.evaluate(() => window.__writes.length);
  await p.evaluate(() => { S.raceDay.entries.forEach((e, i) => { e.pill = 10 - i; }); save(); }); await p.waitForTimeout(2000);
  check('normal syncing carries on afterwards (no rewrite for a new pill order)', await p.evaluate(n => window.__writes.length === n && !Object.keys(RmSync.held).length, writes0));
  await p.evaluate(() => rmStopAssign());

  console.log('\n=== 4. Linking a Driven card ===');
  await setup();
  await p.evaluate(() => {
    window.__cards = { prof_jake0001: { name: 'Jake Smith', num: '7', updatedAt: 1 }, prof_ava00001: { name: 'Ava Brooks', num: '7', updatedAt: 1 } };
    ensureFirebase = () => Promise.resolve(); resolveProfileId = c => Promise.resolve(String(c).toLowerCase()); resultsJoin = () => Promise.resolve(false);
    window.firebase = { apps: [1], database: () => ({ ref: path => ({ once: async () => ({ val: () => window.__cards[path.split('/')[1]] || null }), set: async () => {} }) }) };
  });
  check('same-name rules: exact, Mike/Michael, Jake/Jacob; not a different person', await p.evaluate(() =>
    sameDriverName('Ava Brooks', 'ava  brooks') && sameDriverName('Mike Smith', 'Michael Smith') && sameDriverName('Jake Smith', 'Jacob Smith')
    && !sameDriverName('Jake Smith', 'Ava Brooks') && !sameDriverName('Jake Smith', 'Jake Brown')));
  answer = false; dialogs.length = 0;
  const no = await p.evaluate(() => linkProfile(1, 'prof_jake0001').then(() => 'linked', e => e.declined ? 'declined' : 'error ' + e.message));
  check('a card for someone else asks first, and "no" means no link', no === 'declined' && !(await p.evaluate(() => driverById(1).profileId)) && dialogs.some(m => /This Driven card is for Jake Smith #7/.test(m)), no + ' ' + dialogs.join(' | '));
  answer = true;
  const ok = await p.evaluate(() => linkProfile(1, 'prof_ava00001').then(() => driverById(1).profileId, e => 'error ' + e.message));
  check('a card that matches links without a question', ok === 'prof_ava00001', ok);
  dialogs.length = 0;
  const moved = await p.evaluate(() => linkProfile(2, 'prof_ava00001').then(() => [driverById(1).profileId || '', driverById(2).profileId], e => 'error ' + e.message));
  check('a card already on another driver asks before moving it', dialogs.some(m => /already linked to Ava Brooks/.test(m)), dialogs.join(' | '));
  check('…and moving it unlinks the first driver', Array.isArray(moved) && moved[0] === '' && moved[1] === 'prof_ava00001', JSON.stringify(moved));
  dialogs.length = 0;
  await p.evaluate(() => linkProfile(2, 'prof_ava00001', true));
  check('refreshing an existing link never asks', dialogs.length === 0, dialogs.join(' | '));

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
