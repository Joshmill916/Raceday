// Pre-registrations: a series that took entries on a Google Form imports the responses CSV
// (test-data/prereg-google-form.csv uses that form's real column wording). Columns are
// matched by wording, email/address are never kept, an unclear kart number ("13 in clone,
// 113 in predator") is flagged instead of guessed, a class that isn't set up is reported,
// a driver already in the driver book isn't doubled, re-importing doesn't double anyone,
// and "Check in" on the Sign-up page fills the form so the gate just taps Draw.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8851;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const CSV = fs.readFileSync(path.join(ROOT, 'test-data', 'prereg-google-form.csv'), 'utf8');

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url.split('?')[0] === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('  ⚠️ page error:', e.message); });
  let promptAnswer = '';
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept());
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    S.classes = [{ id: 1, name: 'Predator', maxPill: 200 }, { id: 2, name: 'Stock Appearing', maxPill: 200 },
                 { id: 3, name: 'Clone 360', maxPill: 200 }, { id: 4, name: 'Kid Kart', maxPill: 200 }];
    S.roster = [{ id: 501, name: 'Drew Mason', num: '8D', noPoints: false }];
    S.settings.preReg = [];
    S.raceDay.entries = [];
    save();
  });

  console.log('\n— Reading the form\'s columns —');
  const cols = await page.evaluate(csv => { const t = impParseCSV(csv); return preGuessCols(t[0]); }, CSV);
  check('Driver Name column found', cols.name === 4, JSON.stringify(cols));
  check('classes column found', cols.classes === 7, JSON.stringify(cols));
  check('kart number column found', cols.num === 8, JSON.stringify(cols));
  check('agreement column read as the waiver', cols.waiver === 3, JSON.stringify(cols));
  check('"classes added" column is the requests, not the classes', cols.request === 9, JSON.stringify(cols));
  check('email and address columns are never matched', ![1, 5, 6].some(i => Object.values(cols).includes(i)), JSON.stringify(cols));

  const rows = await page.evaluate(csv => { const t = impParseCSV(csv); return preRows(t, preGuessCols(t[0])); }, CSV);
  const by = n => rows.find(r => r.name === n) || {};
  check('4 drivers read', rows.length === 4, rows.length);
  check('both checked classes matched (comma split)', JSON.stringify(by('Casey Rivera').classIds) === '[1,2]', JSON.stringify(by('Casey Rivera')));
  check('an unclear kart number is flagged, not guessed', by('Riley Banks').num === '' && /13 in clone/.test(by('Riley Banks').numRaw));
  check('"#8D" reads as 8D and extra spaces in a name are tidied', by('Drew Mason').num === '8D');
  check('a class that isn\'t set up is reported', by('Drew Mason').missing.length === 1 && /OPEN/.test(by('Drew Mason').missing[0]));
  check('waiver acceptance carried', rows.every(r => r.waiver));

  console.log('\n— Importing —');
  await page.evaluate(csv => { nav('admin'); admOpen('prereg'); preLoadText(csv, 'Form responses.csv'); }, CSV);
  const preview = await page.evaluate(() => document.getElementById('preregWrap').innerText);
  check('the preview names the file and counts drivers', /Form responses\.csv · 4 drivers found/.test(preview), preview.slice(0, 200));
  check('the preview says the file brings a new class, at the top', /1 new class in this file: OPEN/i.test(preview) && preview.search(/new class in this file/i) < preview.search(/Their columns/i), preview.slice(0, 600));
  await page.evaluate(() => [...document.querySelectorAll('#preregWrap button')].find(b => /^Import/.test(b.textContent)).click());
  const after = await page.evaluate(() => ({ pre: S.settings.preReg.length, roster: S.roster.length, drew: S.roster.filter(d => d.name === 'Drew Mason').length, json: JSON.stringify(S.settings.preReg) }));
  check('4 pre-registered drivers saved', after.pre === 4, after.pre);
  check('the driver already in the book is reused, not doubled', after.drew === 1 && after.roster === 4, JSON.stringify(after));
  check('no email or address is kept', !/@|Main St|43515/.test(after.json));
  await page.evaluate(csv => { preLoadText(csv, 'again.csv'); preImport(); }, CSV);
  const again = await page.evaluate(() => ({ pre: S.settings.preReg.length, roster: S.roster.length }));
  check('re-importing the same file doubles nobody', again.pre === 4 && again.roster === 4, JSON.stringify(again));
  check('pre-registrations sync (kept under settings, no new top-level field)', await page.evaluate(() => SYNC_FIELDS.includes('settings') && !('preReg' in S)));

  console.log('\n— Fixing a flagged number —');
  promptAnswer = '13';
  await page.evaluate(() => preSetNum(S.settings.preReg.findIndex(p => p.name === 'Riley Banks')));
  check('Set number fills the kart number', await page.evaluate(() => S.settings.preReg.find(p => p.name === 'Riley Banks').num === '13'));

  console.log('\n— Race morning check-in —');
  await page.evaluate(() => nav('signup'));
  const card = await page.evaluate(() => { const c = document.getElementById('preCard'); return c ? c.innerText : ''; });
  check('Sign-up lists the pre-registered drivers', /Pre-registered/.test(card) && /0 of 4 checked in/.test(card), card.slice(0, 120));
  console.log('\n— Driven at the gate —');
  await page.evaluate(() => {
    driverById(S.settings.preReg.find(p => p.name === 'Drew Mason').driverId).profileId = 'prof_abc12345xyz';
    S.settings.preReg.find(p => p.name === 'Riley Banks').driven = 'K7Q2M4XN';
    save(); nav('signup');
  });
  const tags = await page.evaluate(() => { const o = {}; document.querySelectorAll('#preList .lrow').forEach(r => { const n = r.querySelector('b').textContent; const b = [...r.querySelectorAll('.badge')].map(x => x.textContent).join('|'); o[n] = b; }); return { o, sum: document.querySelector('#preCard summary').innerText }; });
  check('a driver with a linked card shows Driven', /^Driven$/i.test((tags.o['Drew Mason'] || '').split('|').find(x => /driven/i.test(x)) || ''), JSON.stringify(tags.o));
  check('a driver who gave a link code shows Driven code', /Driven code/i.test(tags.o['Riley Banks'] || ''), JSON.stringify(tags.o));
  check('a driver with no card shows No Driven', /No Driven/i.test(tags.o['Casey Rivera'] || ''), JSON.stringify(tags.o));
  check('the list counts who has no Driven yet', /2 without Driven/i.test(tags.sum), tags.sum);
  await page.evaluate(() => preCheckIn(S.settings.preReg.findIndex(p => p.name === 'Casey Rivera')));
  const form = await page.evaluate(() => ({ name: dName.value, num: dNum.value, on: S.classes.filter(c => document.getElementById('ch' + c.id).classList.contains('on')).map(c => c.name) }));
  check('Check in fills the name and number', form.name === 'Casey Rivera' && form.num === '47', JSON.stringify(form));
  check('checking in a driver with no Driven reminds the gate to offer one', await page.evaluate(() => /No Driven card yet/.test(document.getElementById('scanNote').innerText)));
  check('Check in ticks their classes', JSON.stringify(form.on) === '["Predator","Stock Appearing"]', JSON.stringify(form.on));
  await page.evaluate(() => { const c = document.getElementById('consentChk'); if (c) c.checked = true; register(); });
  const entered = await page.evaluate(() => S.raceDay.entries.filter(e => e.driverId === S.settings.preReg.find(p => p.name === 'Casey Rivera').driverId).length);
  check('Draw enters them in both classes', entered === 2, entered);
  await page.evaluate(() => { signupDone = null; renderSignup(); });
  const card2 = await page.evaluate(() => document.getElementById('preCard').innerText);
  const caseyRow = await page.evaluate(() => { const r = [...document.querySelectorAll('#preList .lrow')]; const i = r.findIndex(x => /Casey Rivera/.test(x.innerText)); return { text: i >= 0 ? r[i].innerText : '', last: i === r.length - 1 }; });
  check('the list now shows them checked in, moved to the bottom', /1 of 4 checked in/.test(card2) && /checked in/i.test(caseyRow.text) && caseyRow.last, JSON.stringify(caseyRow));

  console.log('\n— Who sees it —');
  const viewer = await page.evaluate(() => { const old = localStorage.getItem('rd_role_v2'); localStorage.setItem('rd_role_v2', 'viewer'); const m = preregCheckinMarkup(); localStorage.setItem('rd_role_v2', old || 'admin'); return m; });
  check('spectators never get the check-in list', viewer === '');

  console.log('\n— Adding the file\'s classes in one tap —');
  const csv2 = 'Timestamp,Name,Email address,select classes ,KART #\n'
    + '9/29/2026 7:00:00,Ada Larkin,a@example.com,"HEAVEY 160, PREDATOR",101\n'
    + '9/29/2026 7:01:00,Alex Barker,b@example.com,"heavey 160, JR 3",102\n'
    + '9/29/2026 7:02:00,Avery Everett,c@example.com,Predator,103\n';
  const before2 = await page.evaluate(() => S.classes.length);
  await page.evaluate(csv => { UI.preImp = null; S.settings.preReg = []; save(); preLoadText(csv, 'Entries.csv'); }, csv2);
  const pv2 = await page.evaluate(() => document.getElementById('preregWrap').innerText);
  check('the preview lists the 2 new classes once each (capitals ignored)', /2 new classes in this file: HEAVEY 160, JR 3/i.test(pv2), pv2.slice(0, 600));
  await page.evaluate(() => [...document.querySelectorAll('#preregWrap button')].find(b => /^Import/.test(b.textContent)).click());
  const cls2 = await page.evaluate(() => S.classes.map(c => c.name));
  check('Import added the 2 classes, spelled as in the file, no doubles', cls2.length === before2 + 2 && cls2.includes('HEAVEY 160') && cls2.includes('JR 3')
    && cls2.filter(n => /heavey 160/i.test(n)).length === 1, JSON.stringify(cls2));
  check('an existing class with different capitals is not added again', cls2.filter(n => /^predator$/i.test(n)).length === 1, JSON.stringify(cls2));
  const imp2 = await page.evaluate(() => S.settings.preReg.map(p => ({ n: p.name, c: p.classIds.length, m: p.missing.length })));
  check('every driver imports with all their classes', imp2.length === 3 && imp2.every(p => p.m === 0) && imp2.find(p => p.n === 'Ada Larkin').c === 2, JSON.stringify(imp2));

  console.log('\n— Drivers imported before their classes existed —');
  const fix = await page.evaluate(() => {
    S.settings.preReg.push({ driverId: 0, name: 'Old Import', num: '77', classIds: [], missing: ['SR CAGE', 'jr 3'], at: Date.now() });
    save(); renderPrereg();
    const txt = document.getElementById('preregWrap').innerText;
    const btn = document.getElementById('preAddListCls'); if (!btn) return { txt };
    btn.click();
    const p = S.settings.preReg.find(x => x.name === 'Old Import');
    return { txt, names: p.classIds.map(id => classById(id).name), left: p.missing.length, cage: S.classes.filter(c => c.name === 'SR CAGE').length,
      jr3: S.classes.filter(c => /^jr 3$/i.test(c.name)).length, after: !!document.getElementById('preAddListCls') };
  });
  check('the list offers to add the classes those drivers are missing', /not set up yet: SR CAGE, jr 3/i.test(fix.txt || ''), (fix.txt || '').slice(0, 500));
  check('one tap adds them and gives the driver both classes', fix.cage === 1 && fix.jr3 === 1 && fix.left === 0 && fix.names && fix.names.length === 2 && !fix.after, JSON.stringify(fix));
  const nonAdmin = await page.evaluate(() => { S.settings.preReg.push({ driverId: 0, name: 'Zed', num: '9', classIds: [], missing: ['BRAND NEW'], at: 1 });
    const n = S.classes.length; const r = deviceRole; deviceRole = () => 'viewer';
    try { preAddListClasses(); } finally { deviceRole = r; } return S.classes.length === n; });
  check('a spectator device cannot add classes this way', nonAdmin);

  const goSu = await page.evaluate(() => { nav('admin'); admOpen('prereg'); const b = document.getElementById('preGoSignup'); if (!b) return 'no button'; b.click(); return curPage; });
  check('the admin list sends you to Sign-up to check drivers in', goSu === 'signup', goSu);

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
