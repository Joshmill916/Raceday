// The Results tab: every class's feature on one page (finish, start, spots gained, points)
// and the Hard Charger — the finisher who gained the most spots from their feature start
// (ties: started farther back, then better finish; DNF/DNS/DQ never win; must gain ≥1).
// Past nights read the archived snapshot. Spectators get the tab (tonight only).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8847;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

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
  page.on('dialog', d => d.accept());
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  console.log('\n— The Hard Charger rule —');
  const hc = (rows) => page.evaluate(r => { const b = hardCharger(r); return b ? b.name + ':' + b.gain : null; }, rows);
  check('most spots gained wins', await hc([{ name: 'A', start: 1, fin: 1 }, { name: 'B', start: 6, fin: 2 }, { name: 'C', start: 8, fin: 5 }]) === 'B:4');
  check('a tie goes to who started farther back', await hc([{ name: 'B', start: 5, fin: 2 }, { name: 'C', start: 8, fin: 5 }]) === 'C:3');
  check('a DNF never wins', await hc([{ name: 'D', start: 9, fin: 'DNF' }, { name: 'B', start: 3, fin: 2 }]) === 'B:1');
  check('nobody gained a spot = no Hard Charger', await hc([{ name: 'A', start: 1, fin: 1 }, { name: 'B', start: 2, fin: 3 }]) === null);

  console.log('\n— Tonight, on the Results tab —');
  await page.evaluate(() => {
    closeSheet();
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Junior', maxPill: 20 }, { id: 2, name: 'Senior', maxPill: 20 }];
    S.settings.maxFeature = 20;
    S.roster = []; S.history = [];
    S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 6; i++) { S.roster.push({ id: i, name: 'Driver ' + i, num: String(10 + i) }); S.raceDay.entries.push({ driverId: i, classId: 1, pill: i }); }
    for (let i = 7; i <= 8; i++) { S.roster.push({ id: i, name: 'Senior ' + i, num: String(10 + i) }); S.raceDay.entries.push({ driverId: i, classId: 2, pill: i }); }
    const res = getRes(1);
    for (let i = 1; i <= 6; i++) { res['h1_' + i] = i; res['h2_' + i] = i; }
    save();
    // Feature: the car starting last wins, one DNF.
    const grid = featureGridOrder(featureData(1), 1);
    const fins = [3, 4, 5, 'DNF', 2, 1];
    grid.forEach((r, i) => { res['ft_' + r.id] = fins[i]; });
    window.__last = grid[grid.length - 1];
    save();
    nav('finals');
  });
  const t = await page.evaluate(() => {
    const w = document.getElementById('finalsWrap');
    const card = w.querySelectorAll('.finals-cls')[0];
    return { tab: !!document.querySelector('#tabbar button') && [...document.querySelectorAll('#tabbar button')].some(b => /Results/.test(b.textContent)),
      text: w.textContent, rows: card ? [...card.querySelectorAll('tbody tr')].map(tr => tr.textContent) : [], last: window.__last.name,
      senior: w.querySelectorAll('.finals-cls')[1] ? w.querySelectorAll('.finals-cls')[1].textContent : '' };
  });
  check('a Results tab is in the nav', t.tab);
  check('the Hard Charger is the car that started last and won', new RegExp('Hard Charger.*' + t.last + '.*started P6, finished P1 — gained 5 spots').test(t.text), t.text.slice(0, 300));
  check('finishing order lists the winner first', /^1/.test(t.rows[0]) && t.rows[0].indexOf(t.last) >= 0, t.rows[0]);
  check('each row shows the start and spots gained', /P6\+5/.test(t.rows[0]), t.rows[0]);
  check('the DNF is listed last', /^DNF/.test(t.rows[t.rows.length - 1]) && t.rows.length === 6, t.rows.join(' | '));
  check('a class without a scored feature says so', /Results post once the feature is scored/.test(t.senior), t.senior);

  console.log('\n— Past nights —');
  await page.evaluate(() => { archiveDay(); S.raceDay = { date: '2099-01-01', entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} }; save(); nav('finals'); });
  const past = await page.evaluate(() => {
    const before = document.getElementById('finalsWrap').textContent;
    setFinalsNight('0');
    return { before, after: document.getElementById('finalsWrap').textContent, opts: document.querySelectorAll('#finalsWrap select option').length };
  });
  check('tonight is empty after archiving', /No drivers are entered tonight/.test(past.before), past.before.slice(0, 200));
  check('the night picker lists the archived night', past.opts === 2, past.opts);
  check('the archived night shows its Hard Charger', /Hard Charger.*started P6, finished P1/.test(past.after), past.after.slice(0, 300));
  check('…and keeps the DNF', /DNF/.test(past.after));

  console.log('\n— Spectators —');
  check('a spectator phone gets the Results tab', await page.evaluate(() => ROLE_PAGES.viewer.indexOf('finals') >= 0 && ROLE_PAGES.tv.indexOf('finals') < 0));

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
