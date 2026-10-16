// v2: announcer screen. Running order = every class's set-1 heats, then set 2, then
// B-mains, then features; the first race with a known grid and no full result is "Now".
// Each car shows talking points; the announcer role is read-only.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8837;
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
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20 }, { id: 2, name: 'Stock', maxPill: 20, heats: 1 }];
    S.settings.maxHeat = 4; S.settings.maxFeature = 20;
    S.roster = []; S.history = [];
    S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    for (let i = 1; i <= 8; i++) { S.roster.push({ id: i, name: 'Driver ' + i, num: String(i * 10) }); S.raceDay.entries.push({ driverId: i, classId: 1, pill: i }); }
    for (let i = 11; i <= 14; i++) { S.roster.push({ id: i, name: 'Stock ' + i, num: String(i) }); S.raceDay.entries.push({ driverId: i, classId: 2, pill: i - 10 }); }
    S.roster[0].profile = { hometown: 'Riverside, CA', sponsors: 'Rivera Auto Body · Valley Tire' };
    S.history = [{ date: '2026-05-01', classes: [{ name: 'Late Model', standings: [], feature: [], featureFinish: [{ driverId: 1, name: 'Driver 1', num: '10', fin: 1 }], pointsRace: true, points: [{ driverId: 1, name: 'Driver 1', num: '10', pts: 10 }] }] }];
    save(); setDeviceRole('admin'); applyRole();
  });
  const now = () => page.evaluate(() => { const a = announceNow(); const f = r => r ? r.cls.name + ' · ' + r.label : null; return { now: f(a.now), next: f(a.next), last: f(a.last), grid: a.now ? a.now.grid.map(r => r.id) : [] }; });
  const scoreRace = (n, clsId, heatIdx) => page.evaluate(([n, clsId, heatIdx]) => {
    const cls = classById(clsId), set1 = heatSet(classRacers(clsId), cls), heat = n === 1 ? set1[heatIdx] : [...set1[heatIdx]].reverse(), res = getRes(clsId);
    heat.forEach((r, i) => { res['h' + n + '_' + r.id] = i + 1; }); save();
  }, [n, clsId, heatIdx]);

  console.log('\n— Running order —');
  {
    const a = await now();
    check('before anything is scored, Now is the first class\'s Heat 1 · Set 1', a.now === 'Late Model · Heat 1 · Set 1', a.now);
    check('Up next is that class\'s Heat 2 · Set 1', a.next === 'Late Model · Heat 2 · Set 1', a.next);
    const grid = await page.evaluate(() => heatSet(classRacers(1), classById(1))[0].map(r => r.id));
    check('the Now grid is the real starting order', JSON.stringify(a.grid) === JSON.stringify(grid), JSON.stringify(a.grid));
    await scoreRace(1, 1, 0);
    const b = await now();
    check('scoring a heat moves Now to the next race', b.now === 'Late Model · Heat 2 · Set 1', b.now);
    check('the finished heat becomes "just finished"', b.last === 'Late Model · Heat 1 · Set 1', b.last);
    const odd = await page.evaluate(() => { const r = getRes(2); heatSet(classRacers(2), classById(2))[0].forEach((x, i) => { r['h1_' + x.id] = i + 1; }); save(); const a = announceNow(); const out = a.last ? a.last.cls.name + ' · ' + a.last.label : null; Object.keys(r).forEach(k => delete r[k]); save(); return out; });
    check('a race scored out of order is not called "just finished" before the race on track', odd === 'Late Model · Heat 1 · Set 1', odd);
    await scoreRace(1, 1, 1);
    const c = await now();
    check('after a class\'s set 1, the next class\'s set 1 runs before any set 2', c.now === 'Stock · Heat 1', c.now);
    await scoreRace(1, 2, 0);
    const d = await now();
    check('then set 2 starts', d.now === 'Late Model · Heat 1 · Set 2', d.now);
    const rev = await page.evaluate(() => heatSet(classRacers(1), classById(1))[0].slice().reverse().map(r => r.id));
    check('set 2 runs with the heat grid reversed', JSON.stringify(d.grid) === JSON.stringify(rev), JSON.stringify(d.grid));
    await scoreRace(2, 1, 0); await scoreRace(2, 1, 1);
    const e = await now();
    check('with the heats in, the feature is up', e.now === 'Late Model · Feature', e.now);
    const fg = await page.evaluate(() => featureGridOrder(featureData(1), 1).map(r => r.id));
    check('the feature grid matches the lineup', JSON.stringify(e.grid) === JSON.stringify(fg), JSON.stringify(e.grid));
    check('a 1-heat class still runs its feature next', e.next === 'Stock · Feature', e.next);
    await page.evaluate(() => { const r1 = getRes(1), r2 = getRes(2); featureGridOrder(featureData(1), 1).forEach((r, i) => { r1['ft_' + r.id] = i + 1; }); featureGridOrder(featureData(2), 2).forEach((r, i) => { r2['ft_' + r.id] = i + 1; }); save(); });
    const f = await now();
    check('when every race is in, there is nothing left to call', f.now === null, f.now);
    const txt = await page.evaluate(() => { nav('announce'); return document.getElementById('announceWrap').textContent; });
    check('the screen says every race is in the books', /in the books/.test(txt), txt.slice(0, 80));
  }

  console.log('\n— Talking points —');
  {
    await page.evaluate(() => { S.raceDay.heatResults = {}; save(); });
    await scoreRace(1, 1, 0); await scoreRace(1, 1, 1); await scoreRace(1, 2, 0);
    const shown = await page.evaluate(() => {
      nav('announce');
      const cards = [...document.querySelectorAll('#announceWrap .ann-car')];
      const d1 = cards.find(c => c.querySelector('.ann-who b').textContent === 'Driver 1');
      return { n: cards.length, d1: d1 ? d1.textContent : '', head: document.querySelector('.ann-now').textContent, last: (document.querySelector('.ann-last') || {}).textContent || '' };
    });
    check('Now shows every car in the race', shown.n === 4, shown.n);
    check('the header names the class and race', /Late Model · Heat 1 · Set 2/.test(shown.head), shown.head);
    check('a driver\'s hometown and sponsors show', /Riverside, CA/.test(shown.d1) && /Rivera Auto Body/.test(shown.d1), shown.d1);
    check('career wins and starts show from past nights', /1 win in 1 start/.test(shown.d1), shown.d1);
    check('season points rank shows', /1st in Late Model points \(10\)/.test(shown.d1), shown.d1);
    check('tonight\'s heat finishes show', /Tonight: /.test(shown.d1), shown.d1);
    check('the last finished race shows its top 3', /Just finished/.test(shown.last) && /🥇/.test(shown.last), shown.last);
    const card = await page.evaluate(() => { document.querySelector('#announceWrap .ann-car').click(); const t = document.getElementById('sheetTitle').textContent; closeSheet(); return t; });
    check('tapping a car opens the driver card', /Driver|Stock/.test(card), card);
    const prev = await page.evaluate(() => {
      const chip = document.querySelector('#announceWrap .chips .chip'); chip.click();
      const t = document.querySelector('.ann-now').textContent; document.querySelector('#announceWrap .btn.btn-sm').click();
      return { t, back: /^Now/.test(document.querySelector('.ann-now .ann-tag').textContent) };
    });
    check('an Up next race can be previewed', /Preview/.test(prev.t), prev.t);
    check('"Back to the race on track" returns to Now', prev.back);
    const btn = await page.evaluate(() => { nav('grid'); return /🎙 Announcer/.test(document.getElementById('gridWrap').textContent); });
    check('Lineups has an Announcer button for staff', btn);
  }

  console.log('\n— The announcer role is read-only —');
  {
    const r = await page.evaluate(() => {
      setDeviceRole('announcer'); applyRole();
      const out = { page: curPage, tabs: [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()) };
      out.canWrite = canWrite(); out.adminOk = adminOk();
      out.bar = getComputedStyle(document.getElementById('raceControl')).display;
      nav('results'); out.resultsBlocked = curPage !== 'results';
      nav('admin'); out.adminBlocked = curPage !== 'admin';
      out.pushGuard = /announcer/.test(syncPush.toString()) && /announcer/.test(syncPushFull.toString());
      out.link = /Announcer link/.test(renderSyncCard.toString());
      setDeviceRole('admin'); applyRole();
      out.adminTabs = [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim());
      return out;
    });
    check('an announcer device opens on the Announce page', r.page === 'announce', r.page);
    check('the announcer has Lineups, Announce and Guide tabs', r.tabs.length === 3 && r.tabs.some(t => /Announce/.test(t)), r.tabs.join('|'));
    check('the announcer cannot write or unlock admin', r.canWrite === false && r.adminOk === false);
    check('the announcer never pushes to the shared sync room', r.pushGuard);
    check('the announcer cannot open Score or Admin', r.resultsBlocked && r.adminBlocked);
    check('no Race Control bar on the announcer device', r.bar === 'none', r.bar);
    check('the sync card offers an Announcer link', r.link);
    check('the admin tab bar is unchanged (6 tabs)', r.adminTabs.length === 6 && !r.adminTabs.some(t => /Announce/.test(t)), r.adminTabs.join('|'));
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
