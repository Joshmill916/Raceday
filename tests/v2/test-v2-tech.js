// v2: tech inspection. One record per car per class tonight (S.raceDay.tech), synced so a
// tech tablet and the tower share it. Admin, a controlling operator and the tech role can
// record Pass / Fail / Recheck with checklist, weight and notes; everyone else only reads.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8836;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    closeSheet(); localStorage.removeItem('rd_role_v2');
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20 }, { id: 2, name: 'Stock', maxPill: 20 }];
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    for (let i = 1; i <= 4; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i * 10) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
    }
    S.raceDay.entries.push({ driverId: 1, classId: 2, pill: 1 });
    save(); setDeviceRole('admin'); applyRole();
  });

  console.log('\n— Admin → Tech inspection —');
  const list = await page.evaluate(() => { nav('admin'); admOpen('tech'); const t = document.getElementById('techAdminWrap').textContent; return { rows: document.querySelectorAll('#techAdminWrapList .tech-row').length, five: /5 cars tonight/.test(t), none: /5 not checked/.test(t) }; });
  check('every car in every class is listed (5 cars, one driver in two classes)', list.rows === 5 && list.five, JSON.stringify(list));
  check('everyone starts as not checked', list.none);

  const sheet = await page.evaluate(() => { openTech(1, 1); return { items: document.querySelectorAll('[data-tech-item]').length, pass: /Pass/.test(document.getElementById('sheetFoot').textContent) }; });
  check('the car sheet shows the default 6-item checklist', sheet.items === 6, sheet.items);
  check('the admin gets Pass / Fail / Recheck buttons', sheet.pass);
  const saved = await page.evaluate(() => {
    const cbs = document.querySelectorAll('[data-tech-item]'); cbs[0].checked = true; cbs[1].checked = true;
    document.getElementById('techWeight').value = '412.55'; document.getElementById('techNotes').value = 'Tires checked, weight good';
    saveTech(1, 1, 'pass');
    return S.raceDay.tech['1|1'];
  });
  check('Pass saves the status', saved && saved.status === 'pass');
  check('the weight saves (rounded to 0.1 lb)', saved && saved.weight === 412.6, saved && saved.weight);
  check('ticked checklist items save', saved && Object.keys(saved.items).join() === 'Weight,Tires', saved && Object.keys(saved.items).join());
  check('notes and a timestamp save', saved && /weight good/.test(saved.notes) && saved.at > 0);
  const st = await page.evaluate(() => {
    openTech(2, 1); saveTech(2, 1, 'fail');
    openTech(3, 1); saveTech(3, 1, 'recheck');
    openTech(4, 1); saveTech(4, 1, 'pass'); openTech(4, 1); saveTech(4, 1, '');
    return { f: S.raceDay.tech['2|1'].status, r: S.raceDay.tech['3|1'].status, cleared: !S.raceDay.tech['4|1'], other: !S.raceDay.tech['1|2'] };
  });
  check('Fail and Recheck save', st.f === 'fail' && st.r === 'recheck');
  check('Clear removes a car\'s record', st.cleared);
  check('the same driver in another class is tracked separately', st.other);
  const counts = await page.evaluate(() => document.getElementById('techAdminWrap').textContent);
  check('the counts update (1 passed, 1 failed, 1 recheck, 2 not checked)', /1 passed/.test(counts) && /1 failed/.test(counts) && /1 recheck/.test(counts) && /2 not checked/.test(counts));
  const filt = await page.evaluate(() => { UI.techFilter = 'fail'; renderTech('techAdminWrap'); const n = document.querySelectorAll('#techAdminWrapList .tech-row').length; UI.techFilter = 'all'; UI.techQ = '30'; renderTech('techAdminWrap'); const m = document.querySelectorAll('#techAdminWrapList .tech-row').length; UI.techQ = ''; renderTech('techAdminWrap'); return { n, m }; });
  check('the Failed filter shows only failed cars', filt.n === 1, filt.n);
  check('search finds a car by number', filt.m === 1, filt.m);
  const today = await page.evaluate(() => { admOpen('today'); return document.getElementById('entryList').innerHTML; });
  check('Today\'s entries shows the tech result next to the driver', /title="Tech: Passed"/.test(today) && /title="Tech: Failed"/.test(today));
  const cl = await page.evaluate(() => {
    admOpen('tech'); document.getElementById('techListEdit').value = 'Weight\nTires\nweight\n\nTransponder'; saveTechChecklist();
    const a = techChecklist().join();
    document.getElementById('techListEdit').value = '   '; saveTechChecklist();
    return { a, b: techChecklist().join() };
  });
  check('the checklist can be edited (blank lines and duplicates dropped)', cl.a === 'Weight,Tires,Transponder', cl.a);
  check('an empty checklist falls back to the defaults', cl.b === 'Weight,Tires,Safety gear,Fuel,Engine seal / claim,Body & bumpers', cl.b);

  console.log('\n— Sync, archive and new race day —');
  const sync = await page.evaluate(() => ({ field: SYNC_FIELDS.includes('raceDay/tech'), link: /Tech inspection link/.test(renderSyncCard.toString()) }));
  check('tech results sync between devices', sync.field);
  check('the sync card offers a Tech inspection link', sync.link);
  const snap = await page.evaluate(() => buildSnapshot().classes.find(c => c.name === 'Late Model').tech);
  check('the archived night keeps a tech summary per class', snap && snap.length === 3 && snap.some(t => t.driverId === 1 && t.status === 'pass' && t.weight === 412.6), JSON.stringify(snap));
  const mig = await page.evaluate(() => { const o = JSON.parse(JSON.stringify(S)); delete o.raceDay.tech; delete o.settings.techChecklist; const m = migrate(o); return !!m.raceDay.tech && m.settings.techChecklist.length === 6; });
  check('older saved data gets an empty tech list and the default checklist', mig);
  const fresh = await page.evaluate(() => {
    const keep = JSON.stringify({ e: S.raceDay.entries, t: S.raceDay.tech, h: S.history });
    const origDl = downloadFile; downloadFile = () => {};
    newRaceDay();
    downloadFile = origDl;
    const out = { empty: Object.keys(S.raceDay.tech || {}).length === 0, archived: (S.history[0].classes.find(c => c.name === 'Late Model') || {}).tech };
    const k = JSON.parse(keep); S.raceDay.entries = k.e; S.raceDay.tech = k.t; S.history = k.h; save();
    return out;
  });
  check('starting a new race day clears tonight\'s tech list', fresh.empty);
  check('…after saving it with the archived night', Array.isArray(fresh.archived) && fresh.archived.length === 3, JSON.stringify(fresh.archived));

  console.log('\n— Roles —');
  const techRole = await page.evaluate(() => {
    setDeviceRole('tech'); applyRole();
    const tabs = [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim());
    const out = { page: curPage, tabs, can: canTech() };
    openTech(3, 1); saveTech(3, 1, 'pass'); out.saved = S.raceDay.tech['3|1'].status;
    nav('admin'); out.adminBlocked = curPage !== 'admin';
    out.bar = getComputedStyle(document.getElementById('raceControl')).display;
    return out;
  });
  check('a tech tablet opens straight to the Tech page', techRole.page === 'tech', techRole.page);
  check('a tech tablet only has Tech and Guide tabs', techRole.tabs.length === 2 && /Tech/.test(techRole.tabs[0]), techRole.tabs.join('|'));
  check('the tech role can record results', techRole.can && techRole.saved === 'pass');
  check('the tech role cannot open Admin', techRole.adminBlocked);
  check('a tech tablet does not show the Race Control bar (no Archive button)', techRole.bar === 'none', techRole.bar);
  const adminTabs = await page.evaluate(() => { setDeviceRole('admin'); applyRole(); return [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()); });
  check('the admin tab bar stays the same (Tech lives under Admin)', !adminTabs.some(t => /Tech/.test(t)) && adminTabs.length === 6, adminTabs.join('|'));
  const ro = await page.evaluate(() => {
    const out = {};
    for (const r of ['viewer', 'tv', 'scoring', 'register']) {
      setDeviceRole(r); applyRole();
      const before = JSON.stringify(S.raceDay.tech);
      saveTech(2, 1, 'pass');
      out[r] = { can: canTech(), unchanged: JSON.stringify(S.raceDay.tech) === before, page: (nav('tech'), curPage) };
    }
    setDeviceRole('operator'); _operatorControl = false; applyRole();
    out.watching = canTech();
    setDeviceRole('admin'); applyRole();
    return out;
  });
  for (const r of ['viewer', 'tv', 'scoring', 'register']) check(`${r} cannot change tech results or open the Tech page`, !ro[r].can && ro[r].unchanged && ro[r].page !== 'tech', JSON.stringify(ro[r]));
  check('an operator in watch mode cannot change tech results', ro.watching === false);

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
