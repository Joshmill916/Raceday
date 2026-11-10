// Online pre-registration: drivers enter from home at victoryraceday.com/enter/?ROOM (no account,
// no email/address asked), entries land at preRegIn/<room> (staff-read only, refused once
// closed — database.rules.json), and the track's staff devices pull them into the same
// pre-registered list the Google Form import fills. A changed entry replaces the old one, a
// transponder number goes on the driver (the timing import matches by it), a Driven code
// links their card at check-in, a removed driver doesn't come back on the next pull.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8853;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const CLASSES = [{ id: 1, name: 'Predator', maxPill: 200 }, { id: 2, name: 'Stock Appearing', maxPill: 200 }, { id: 3, name: 'Kid Kart', maxPill: 200 }];

(async () => {
  const server = http.createServer((req, res) => {
    let rel = req.url.split('?')[0];
    if (rel === '/') rel = '/raceday2/index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  /* ---------------- The public entry page ---------------- */
  console.log('\n— The driver\'s entry page —');
  let cfg = { open: true, title: 'Winter Indoor Series · Race #1', date: 'Sunday, Nov 22', tx: true, waiver: 'I accept the risks of racing.', note: '$25 per class at the gate', updatedAt: 1 };
  const posts = [], outs = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('  ⚠️ page error:', e.message); });
  await page.route(/cloudflareinsights|fonts\.googleapis/, r => r.abort());
  await page.route(/firebaseio\.com/, r => {
    const u = new URL(r.request().url()); const p = u.pathname;
    const json = v => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (r.request().method() === 'POST' && p === '/preRegIn/ROOM1.json') {
      if (!cfg.open) return r.fulfill({ status: 401, body: '{"error":"Permission denied"}' });
      posts.push(JSON.parse(r.request().postData())); return json({ name: '-Entry' + posts.length });
    }
    if (r.request().method() === 'PUT' && /^\/preRegOut\/ROOM1\/[^/]+\.json$/.test(p)) { outs.push({ p, body: JSON.parse(r.request().postData()) }); return json({}); }
    if (p === '/preRegOpen/ROOM1.json') return json(cfg);
    if (p === '/preRegOpen/NOPE.json') return json(null);
    if (p.endsWith('/classes.json')) return json(JSON.stringify(CLASSES));
    if (p.endsWith('/track.json')) return json(JSON.stringify({ name: 'Test Indoor' }));
    if (p === '/profiles_short/ABCD1234.json') return json('prof_abcd1234xyz');
    if (p === '/profiles/prof_abcd1234xyz/card.json') return json({ name: 'Casey Rivera', num: '47', updatedAt: 1 });
    return json(null);
  });
  await page.goto(`http://localhost:${PORT}/enter/?ROOM1`);
  await page.waitForSelector('#nm');
  const top = await page.innerText('#app');
  check('shows the race, date, closing note and the track', /Winter Indoor Series/.test(top) && /Sunday, Nov 22/.test(top) && /\$25 per class/.test(top) && /Test Indoor/i.test(top), top.slice(0, 160));
  check('asks for a transponder when the track wants it', !!(await page.$('#tx')));
  check('never asks for email, phone or address', !/e-?mail|phone|address/i.test(await page.evaluate(() => [...document.querySelectorAll('label')].map(l => l.textContent).join(' '))));
  await page.fill('#dv', 'abcd1234'); await page.click('text=Fill in'); await page.waitForTimeout(200);
  check('a Driven link code fills the name and number', await page.inputValue('#nm') === 'Casey Rivera' && await page.inputValue('#nu') === '47');
  await page.fill('#tx', '44 17382');
  await page.click('#go'); await page.waitForTimeout(100);
  check('no class picked: says so, sends nothing', /Pick at least one class/.test(await page.innerText('#err')) && posts.length === 0);
  await page.click('text=Predator'); await page.click('text=Stock Appearing');
  await page.click('#go'); await page.waitForTimeout(100);
  check('agreement not ticked: says so, sends nothing', /accept the entry agreement/.test(await page.innerText('#err')) && posts.length === 0);
  await page.check('#ok'); await page.click('#go'); await page.waitForSelector('text=You\'re pre-entered');
  const b = posts[0] || {};
  check('the entry is sent: name, number, transponder, class ids, Driven code, waiver, server time',
    b.name === 'Casey Rivera' && b.num === '47' && b.tx === '4417382' && b.classes === '1,2' && b.driven === 'ABCD1234' && b.waiver === true && b.at && b.at['.sv'] === 'timestamp', JSON.stringify(b));
  check('only fields the database rules allow', Object.keys(b).every(k => ['name', 'num', 'tx', 'classes', 'want', 'driven', 'waiver', 'at', 'replaces', 'tok'].includes(k)), Object.keys(b).join(','));
  const conf = await page.innerText('#app');
  check('confirmation shows their number, name and classes', /47/.test(conf) && /Casey Rivera/.test(conf) && /Predator · Stock Appearing/.test(conf), conf.slice(0, 200));
  await page.reload(); await page.waitForSelector('text=You\'re pre-entered');
  check('coming back to the link shows their entry, not a blank form', true);
  await page.click('text=Change my entry'); await page.waitForSelector('#nm');
  check('Change my entry opens it filled in', await page.inputValue('#nm') === 'Casey Rivera' && await page.evaluate(() => document.querySelectorAll('.chip.on').length) === 2);
  await page.click('text=Kid Kart'); await page.check('#ok'); await page.click('#go'); await page.waitForSelector('text=You\'re pre-entered');
  check('the change replaces the first entry', posts.length === 2 && posts[1].replaces === '-Entry1' && posts[1].classes === '1,2,3', JSON.stringify(posts[1]));

  console.log('\n— A driver withdraws from home —');
  check('every entry carries its own random withdraw token', /^[a-f0-9]{24}$/.test(posts[0].tok || '') && /^[a-f0-9]{24}$/.test(posts[1].tok || '') && posts[0].tok !== posts[1].tok);
  await page.click('text=Withdraw my entry'); await page.waitForSelector('#wd');
  check('step 1 only asks, naming the driver and classes', outs.length === 0 && /Withdraw Casey Rivera\?/.test(await page.innerText('#wdBox')) && /Kid Kart/.test(await page.innerText('#wdBox')));
  await page.click('text=Keep my entry'); await page.waitForTimeout(100);
  check('"Keep my entry" sends nothing', outs.length === 0 && /You're pre-entered/i.test(await page.innerText('#app')));
  await page.click('text=Withdraw my entry'); await page.waitForSelector('#wd'); await page.click('#wd'); await page.waitForSelector('text=Your entry is withdrawn');
  check('step 2 sends the withdrawal for the newest entry with its token', outs.length === 1 && outs[0].p === '/preRegOut/ROOM1/-Entry2.json' && outs[0].body.tok === posts[1].tok && outs[0].body.at['.sv'] === 'timestamp' && Object.keys(outs[0].body).length === 2, JSON.stringify(outs));
  await page.reload(); await page.waitForSelector('text=Your entry is withdrawn');
  check('coming back still shows it withdrawn', true);
  await page.click('button:has-text("Enter again")'); await page.waitForSelector('#nm');
  check('Enter again opens a fresh form with their name and number', await page.inputValue('#nm') === 'Casey Rivera' && await page.inputValue('#nu') === '47');

  cfg = Object.assign({}, cfg, { open: true, closes: Date.now() - 1000 });
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(300);
  check('past the closing time: closed, no form', /Pre-registration is closed/.test(await page.innerText('#app')) && !(await page.$('#nm')));
  cfg = Object.assign({}, cfg, { open: false, closes: 0 });
  await page.reload(); await page.waitForTimeout(300);
  check('closed by the track: closed, no form', /Pre-registration is closed/.test(await page.innerText('#app')) && !(await page.$('#nm')));
  await page.goto(`http://localhost:${PORT}/enter/?NOPE`); await page.waitForTimeout(300);
  check('a room that never opened it says so', /hasn't opened pre-registration/.test(await page.innerText('#app')));
  check('no horizontal scroll on a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

  /* ---------------- Database rules ---------------- */
  console.log('\n— Database rules —');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  const staff = "auth != null && root.child('trackStaff').child($key).child(auth.uid).exists()";
  check('entries are readable only by the track\'s staff', rules.preRegIn.$key['.read'] === staff);
  const w = rules.preRegIn.$key.$id['.write'];
  check('anyone can add an entry only while open and before the closing time, never overwrite one',
    /!data\.exists\(\) && newData\.exists\(\)/.test(w) && /child\('open'\)\.val\(\) === true/.test(w) && /closes'\)\.val\(\) > now/.test(w));
  check('entries hold no extra fields (no contact info can be stored)', rules.preRegIn.$key.$id.$other['.validate'] === false && !('email' in rules.preRegIn.$key.$id));
  check('only staff open/close it', rules.preRegOpen.$key['.write'] === staff && rules.preRegOpen.$key['.read'] === true);
  const ow = rules.preRegOut.$key.$id['.write'];
  check('a withdrawal is accepted only with the entry\'s own token, create-only (or from staff)',
    /!data\.exists\(\) && newData\.exists\(\)/.test(ow) && /child\('preRegIn'\)\.child\(\$key\)\.child\(\$id\)\.child\('tok'\)\.val\(\) === newData\.child\('tok'\)\.val\(\)/.test(ow) && /child\('tok'\)\.exists\(\)/.test(ow));
  check('withdrawals are staff-read only and hold only {tok, at}', rules.preRegOut.$key['.read'] === staff && rules.preRegOut.$key.$id.$other['.validate'] === false && !!rules.preRegIn.$key.$id.tok);

  /* ---------------- The track's side (RaceDay 2) ---------------- */
  console.log('\n— The track pulls entries in —');
  const app = await browser.newPage({ viewport: { width: 900, height: 900 } });
  app.on('pageerror', e => { errs.push(e.message); console.log('  ⚠️ page error:', e.message); });
  app.on('dialog', d => d.accept());
  await app.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await app.goto(`http://localhost:${PORT}/`);
  await app.waitForTimeout(400);
  await app.evaluate(classes => {
    S.classes = classes; S.roster = [{ id: 501, name: 'Drew Mason', num: '8D', noPoints: false }];
    S.settings.preReg = []; S.raceDay.entries = []; S.track.name = 'Test Indoor';
    S.sync = { enabled: true, key: 'ROOM1', staffKey: '' };
    save();
    // Stand-in for the Firebase SDK: records writes, serves preRegIn/ROOM1.
    window.__fb = { writes: {}, updates: {}, entries: {} };
    loadFirebase = () => Promise.resolve();
    Staff.ok = true;
    window.firebase = { apps: [1], database: () => ({ ref: p => ({
      set: v => { __fb.writes[p] = v; return Promise.resolve(); },
      update: v => { __fb.updates[p] = v; Object.keys(v).forEach(k => { if (v[k] === null) delete __fb.entries[k]; }); return Promise.resolve(); },
      once: () => Promise.resolve({ val: () => (p === 'preRegIn/ROOM1' ? JSON.parse(JSON.stringify(__fb.entries)) : null) })
    }) }) };
    downloadFile = (name, content) => { window.__csv = { name, content }; };
  }, CLASSES);
  await app.evaluate(() => { nav('admin'); admOpen('prereg'); });
  const card = await app.evaluate(() => document.getElementById('preregWrap').innerText);
  check('admin sees "Pre-registration from home" with the entry link', /Pre-registration from home/.test(card) && /victoryraceday\.com\/enter\/\?ROOM1/.test(card), card.slice(0, 300));
  await app.fill('#poTitle', 'Winter Indoor Series · Race #1'); await app.dispatchEvent('#poTitle', 'change');
  await app.evaluate(() => preOnlineOpen(true)); await app.waitForTimeout(100);
  const pub = await app.evaluate(() => __fb.writes['preRegOpen/ROOM1']);
  check('Open publishes it (open, title, transponder ask, track name)', pub && pub.open === true && pub.title === 'Winter Indoor Series · Race #1' && pub.tx === true && pub.track === 'Test Indoor', JSON.stringify(pub));
  check('it now shows OPEN', /OPEN/.test(await app.evaluate(() => document.getElementById('preregWrap').innerText)));

  await app.evaluate(() => {
    __fb.entries = {
      '-A1': { name: 'Casey Rivera', num: '47', tx: '4417382', classes: '1,2', driven: 'ABCD1234', waiver: true, at: 1000 },
      '-A2': { name: 'Casey Rivera', num: '47', tx: '4417382', classes: '1,2,3', driven: 'ABCD1234', waiver: true, at: 2000, replaces: '-A1' },
      '-B1': { name: 'Drew  Mason', num: '8D', classes: '3', waiver: true, at: 1500, want: 'Senior Animal' },
      '-C1': { name: 'Riley Banks', num: '', classes: '99,1', waiver: true, at: 1600, want: 'senior animal' }
    };
  });
  const got = await app.evaluate(() => { UI.prePulled = 0; return preOnlinePull(false); });
  const st = await app.evaluate(() => ({ list: JSON.parse(JSON.stringify(S.settings.preReg)), roster: JSON.parse(JSON.stringify(S.roster)) }));
  const casey = st.list.find(p => p.name === 'Casey Rivera') || {};
  check('online entries land in the pre-registered list', st.list.length === 3, st.list.map(p => p.name).join(', '));
  check('the changed entry wins (newest per driver)', JSON.stringify(casey.classIds) === '[1,2,3]' && casey.rid === '-A2', JSON.stringify(casey));
  check('transponder goes on the driver for timing imports', (st.roster.find(d => d.name === 'Casey Rivera') || {}).trans === '4417382');
  check('a driver already in the book is reused, not doubled', st.roster.filter(d => /Drew/.test(d.name)).length === 1);
  check('an unknown class id is dropped, not guessed', JSON.stringify((st.list.find(p => p.name === 'Riley Banks') || {}).classIds) === '[1]');
  const again = await app.evaluate(() => { UI.prePulled = 0; return preOnlinePull(false).then(n => ({ n, len: S.settings.preReg.length })); });
  check('pulling again adds nobody twice', again.n === 0 && again.len === 3, JSON.stringify(again));
  const counts = await app.evaluate(() => document.getElementById('preregWrap').innerText);
  check('class counts and class requests show', /Predator · 2/i.test(counts) && /Kid Kart · 2/i.test(counts) && /Senior Animal \(2\)/i.test(counts), counts.slice(counts.indexOf('pre-registered driver'), counts.indexOf('pre-registered driver') + 300));
  await app.evaluate(() => preCsv());
  const csv = await app.evaluate(() => window.__csv);
  check('entry list downloads as CSV with transponders', csv && /Transponder/.test(csv.content) && /Casey Rivera,47,Predator \/ Stock Appearing \/ Kid Kart,4417382/.test(csv.content), csv && csv.content.slice(0, 300));

  await app.evaluate(() => preRemove(S.settings.preReg.findIndex(p => p.name === 'Riley Banks')));
  await app.waitForTimeout(100);
  const gone = await app.evaluate(() => { UI.prePulled = 0; return preOnlinePull(false).then(() => ({ riley: S.settings.preReg.some(p => p.name === 'Riley Banks'), cloud: '-C1' in __fb.entries })); });
  check('a removed driver stays removed (deleted online too)', !gone.riley && !gone.cloud, JSON.stringify(gone));

  console.log('\n— The track gets the withdrawal —');
  await app.evaluate(() => {
    const orig = firebase.database;
    __fb.outs = { '-A2': { tok: 'abc', at: 3000 } };
    window.firebase.database = () => ({ ref: p => {
      const r = orig().ref(p);
      return Object.assign({}, r, { once: () => p === 'preRegOut/ROOM1' ? Promise.resolve({ val: () => JSON.parse(JSON.stringify(__fb.outs)) }) : r.once(),
        update: v => { if (!p) { Object.keys(v).forEach(k => { const m = k.match(/^preRegIn\/ROOM1\/(.+)$/); if (m) delete __fb.entries[m[1]]; const o = k.match(/^preRegOut\/ROOM1\/(.+)$/); if (o) delete __fb.outs[o[1]]; }); return Promise.resolve(); } return r.update(v); } });
    } });
  });
  const wd = await app.evaluate(() => { UI.prePulled = 0; return preOnlinePull(false).then(() => ({
    casey: S.settings.preReg.some(p => p.name === 'Casey Rivera'),
    gone: (S.settings.preGone || []).find(g => g.p.name === 'Casey Rivera'),
    skip: S.settings.preOnline.skip.slice(), cloud: Object.keys(__fb.entries), outs: Object.keys(__fb.outs),
    audit: S.audit.some(a => a.action === 'Pre-registration withdrawn by driver' && a.target === '' && a.oldValue === 'Casey Rivera'),
    ui: document.getElementById('preregWrap').innerText })); });
  check('the driver comes off the pre-registered list, into Cancelled with "withdrew online"', !wd.casey && wd.gone && wd.gone.why === 'withdrew online' && /withdrew online/.test(wd.ui), JSON.stringify(wd.gone));
  check('both versions of the changed entry are skipped and deleted online, withdrawal cleared', wd.skip.includes('-A1') && wd.skip.includes('-A2') && !wd.cloud.includes('-A1') && !wd.cloud.includes('-A2') && wd.outs.length === 0, JSON.stringify(wd));
  check('it goes in the audit log', wd.audit);
  const back = await app.evaluate(() => { UI.prePulled = 0; return preOnlinePull(false).then(() => S.settings.preReg.some(p => p.name === 'Casey Rivera')); });
  check('pulling again doesn\'t bring them back', !back);
  const undo = await app.evaluate(() => { preUndo(S.settings.preGone.findIndex(g => g.p.name === 'Casey Rivera')); return S.settings.preReg.some(p => p.name === 'Casey Rivera'); });
  check('the track can still Undo it (driver changed their mind at the gate)', undo);

  console.log('\n— Gate check-in —');
  await app.evaluate(() => nav('signup')); await app.waitForTimeout(100);
  const pre = await app.evaluate(() => document.getElementById('preCard').innerText);
  check('Sign-up lists them with their transponder', /Casey Rivera/.test(pre) && /transponder 4417382/.test(pre), pre.slice(0, 200));
  await app.evaluate(() => preCheckIn(S.settings.preReg.findIndex(p => p.name === 'Casey Rivera')));
  const form = await app.evaluate(() => ({ name: dName.value, num: dNum.value, code: (document.getElementById('dProfCode') || {}).value }));
  check('Check in fills name, number and their Driven code', form.name === 'Casey Rivera' && form.num === '47' && form.code === 'ABCD1234', JSON.stringify(form));

  console.log('\n— Google Form import reads a transponder column —');
  const tx = await app.evaluate(() => { const t = impParseCSV('Driver Name,Kart Number,Transponder Number,Classes\nSam Lee,22,3376021,Predator'); const m = preGuessCols(t[0]); return { m, rows: preRows(t, m) }; });
  check('transponder column matched, not mistaken for the kart number', tx.m.tx === 2 && tx.m.num === 1 && tx.rows[0].tx === '3376021', JSON.stringify(tx));

  console.log('\n— Who can pull —');
  const viewer = await app.evaluate(() => { const old = localStorage.getItem('rd_role_v2'); localStorage.setItem('rd_role_v2', 'viewer'); UI.prePulled = 0; const before = Object.keys(__fb.writes).length; return preOnlinePull(false).then(n => { localStorage.setItem('rd_role_v2', old || 'admin'); return n === 0 && Object.keys(__fb.writes).length === before; }); });
  check('a spectator device never reads entries', viewer);
  check('nothing new at the top level of saved state', await app.evaluate(() => !('preOnline' in S) && !!S.settings.preOnline));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
