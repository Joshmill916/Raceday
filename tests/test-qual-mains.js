// Straight-to-mains format (cls.heats === 0): qualifying seeds the mains directly —
// top seeds lock into the feature, the rest split into B-mains, no heats raced.
// Covers: the format dropdown, immediate main posting, seeding order, results entry
// without heat blocks, B-main transfers, feature points, viewer tabs, TV slides,
// print sheet, and a 2-heat regression guard.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8794;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, req.url === '/' ? 'raceday/index.html' : req.url.split('?')[0]);
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Seed: 10 drivers, pills 1..10 = qualifying seeds (P1 fastest). Feature capped at 6
  // with 2 transfers → top 4 seeds lock in, seeds 5-10 run the B-main for the last 2 spots.
  await page.evaluate(() => {
    S.track.name = 'Test Track';
    S.adminPin = '';
    const cls = S.classes[0];
    cls.maxFeature = 6;
    for (let i = 1; i <= 10; i++) {
      S.roster.push({ id: 8000 + i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: 8000 + i, classId: cls.id, pill: i, qualTime: (14 + i / 10).toFixed(2) });
    }
    save();
    setDeviceRole('admin');
    sessionStorage.setItem('rd_admin_ok', '1');
  });
  await page.reload();
  await page.waitForTimeout(300);
  const clsId = await page.evaluate(() => S.classes[0].id);

  console.log('\n— Format setting —');
  const dd = await page.evaluate((id) => {
    nav('admin'); renderClsList();
    return document.getElementById('clsList').innerHTML;
  }, clsId);
  check('classes list offers "Qualifying · straight to mains"', dd.includes('Qualifying · straight to mains'));
  const fmt = await page.evaluate((id) => { setClassHeats(id, '0'); return classHeats(classById(id)); }, clsId);
  check('setClassHeats(id, "0") → classHeats() === 0', fmt === 0);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('raceday_v1')).classes[0].heats);
  check('format persists to localStorage as 0', persisted === 0);

  console.log('\n— drawPill: qualifying classes skip the random draw (sequential placeholder) —');
  const pillTest = await page.evaluate(() => {
    // Two fresh, empty classes: one qualifying (heats 0), one pill-draw (heats 2).
    const qCls = { id: 901, name: 'Qual Test', maxPill: 200, heats: 0 };
    const pCls = { id: 902, name: 'Pill Test', maxPill: 200, heats: 2 };
    S.classes.push(qCls, pCls);
    // Qualifying: four sign-ups should land in sign-up order 1,2,3,4 — no random spin.
    const qPills = [];
    for (let i = 0; i < 4; i++) {
      const p = drawPill(901);
      S.raceDay.entries.push({ driverId: 90000 + i, classId: 901, pill: p });
      qPills.push(p);
    }
    // Qualifying never dead-ends: fill past maxPill, still returns the next slot (not null).
    const qClsRef = classById(901);
    qClsRef.maxPill = 4;                 // pretend the ceiling is already reached
    const overflow = drawPill(901);      // 1..4 used → next free is 5, ignoring the cap
    // Pill-draw class: with 1..(max-1) used, the only free slot must be returned.
    const pClsRef = classById(902);
    pClsRef.maxPill = 5;
    for (let p = 1; p <= 4; p++) S.raceDay.entries.push({ driverId: 91000 + p, classId: 902, pill: p });
    const pDraw = drawPill(902);         // only 5 is free
    const pExhausted = (() => {          // fully full → null (unchanged behavior)
      S.raceDay.entries.push({ driverId: 91099, classId: 902, pill: 5 });
      return drawPill(902);
    })();
    // cleanup so later sections see the original class list only
    S.classes = S.classes.filter(c => c.id !== 901 && c.id !== 902);
    S.raceDay.entries = S.raceDay.entries.filter(e => e.classId !== 901 && e.classId !== 902);
    return { qPills, overflow, pDraw, pExhausted };
  });
  check('qualifying class assigns sequential pills 1,2,3,4', JSON.stringify(pillTest.qPills) === JSON.stringify([1, 2, 3, 4]), 'got ' + JSON.stringify(pillTest.qPills));
  check('qualifying class never returns null (ignores maxPill cap)', pillTest.overflow === 5, 'got ' + pillTest.overflow);
  check('pill-draw class still returns the one free pill', pillTest.pDraw === 5, 'got ' + pillTest.pDraw);
  check('pill-draw class still returns null when full', pillTest.pExhausted === null, 'got ' + pillTest.pExhausted);

  console.log('\n— Seeding & main structure (no results entered) —');
  const fd = await page.evaluate((id) => {
    const f = featureData(id);
    return {
      complete: classComplete(id),
      lockedIds: f.locked.map(r => r.id),
      mains: f.mains.map(m => ({ label: m.label, ids: m.drivers.map(r => r.id) })),
      toFeatureSpots: f.toFeatureSpots,
    };
  }, clsId);
  check('class is complete immediately (no heats to score)', fd.complete);
  check('top 4 seeds locked into the feature (6 spots − 2 transfers)',
    fd.lockedIds.join(',') === '8001,8002,8003,8004', fd.lockedIds.join(','));
  check('one B-main with seeds 5–10', fd.mains.length === 1 && fd.mains[0].ids.join(',') === '8005,8006,8007,8008,8009,8010',
    JSON.stringify(fd.mains));
  check('2 transfer spots into the feature', fd.toFeatureSpots === 2);

  console.log('\n— Lineups page —');
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(200);
  let grid = await page.evaluate(() => document.getElementById('gridContent').innerHTML);
  check('grid shows the qualifying-order seeding label', grid.includes('Qualifying order — seeds the mains directly'));
  check('grid shows no heat sections', !grid.includes('Set 1 heats') && !grid.includes('Qualifying heats'));
  check('B-main lineup posts immediately', grid.includes('B-main'));
  check('B-main rows tag the qual time, not a heat total', grid.includes('⏱ 14.50') && !grid.includes('Heat total'));
  check('feature grid waits for the B-main finishes', grid.includes('The feature grid posts here once the main finishes are entered'));

  console.log('\n— Results page: no heat entry, straight to mains —');
  await page.evaluate((id) => { nav('results'); resTab = id; renderResults(); }, clsId);
  await page.waitForTimeout(200);
  let res = await page.evaluate(() => document.getElementById('resBody').innerHTML);
  check('no heat entry blocks', !res.includes("'h1_") && !res.includes('Set 1 heats') && !res.includes('Qualifying heat'));
  check('seeding table replaces heat totals', res.includes('Seeding — qualifying order') && !res.includes('Heat totals'));
  check('B-main finish entry is present', res.includes("'bm_"));
  check('feature block labeled from qualifying', res.includes(' on qualifying'));

  console.log('\n— B-main transfers → feature —');
  await page.evaluate((id) => {
    saveResult(id, 'bm_8007', 1);   // seed 7 wins the B-main
    saveResult(id, 'bm_8005', 2);   // seed 5 second
    saveResult(id, 'bm_8006', 3);
  }, clsId);
  const feat = await page.evaluate((id) => {
    const f = featureData(id);
    return { transferred: f.transferred.map(r => r.id), grid: featureGridOrder(f, id).map(r => r.id) };
  }, clsId);
  check('B-main top 2 transfer in finish order', feat.transferred.join(',') === '8007,8005', feat.transferred.join(','));
  check('feature grid = 4 locked seeds + 2 transfers', feat.grid.join(',') === '8001,8002,8003,8004,8007,8005', feat.grid.join(','));

  console.log('\n— Feature finish → points —');
  const pts = await page.evaluate((id) => {
    [8002, 8001, 8007, 8003, 8004, 8005].forEach((d, i) => saveResult(id, 'ft_' + d, i + 1));
    const dp = dayPoints(id);
    return { winner: dp && dp[8002], second: dp && dp[8001], fin: featureFinish(id).map(r => r.id) };
  }, clsId);
  check('feature finish recorded for all 6', pts.fin.length === 6, JSON.stringify(pts.fin));
  check('points from the fixed table (winner 10, P2 8)', pts.winner === 10 && pts.second === 8, JSON.stringify(pts));

  console.log('\n— TV slides —');
  const tv = await page.evaluate(() => tvSlides().map(s => s.sub));
  check('TV shows a single qualifying-order slide, no heat slides',
    tv.includes('Qualifying order — straight to mains') && !tv.some(s => /Heat \d+ — Set/.test(s)), JSON.stringify(tv));
  check('TV still shows the mains', tv.some(s => s.includes('B-main')) && tv.some(s => s.includes('Feature lineup')), JSON.stringify(tv));

  console.log('\n— Viewer (spectator) —');
  await page.evaluate(() => { setDeviceRole('viewer'); UI.viewStage = 'heats'; nav('grid'); });
  await page.waitForTimeout(200);
  let vw = await page.evaluate(() => document.getElementById('gridContent').innerHTML);
  check('no Heats tab for a straight-to-mains class', !vw.includes('>Heats<'));
  check('stale Heats selection falls back to Qualifying', vw.includes('Qualifying order — seeds the mains directly'));
  await page.evaluate(() => setViewStage('bmain'));
  vw = await page.evaluate(() => document.getElementById('gridContent').innerHTML);
  check('B-main posts for spectators without heat scoring', vw.includes('B-main') && !vw.includes('post once the heats are scored'));

  console.log('\n— Regression: 2-heat class unaffected —');
  await page.evaluate(() => {
    setDeviceRole('admin');
    S.classes.push({ id: 777, name: 'Stock', maxPill: 200 });
    for (let i = 1; i <= 4; i++) {
      S.roster.push({ id: 8100 + i, name: 'Stock ' + i, num: 'S' + i });
      S.raceDay.entries.push({ driverId: 8100 + i, classId: 777, pill: i });
    }
    save(); nav('grid');
  });
  await page.waitForTimeout(200);
  grid = await page.evaluate(() => document.getElementById('gridContent').innerHTML);
  check('default class still renders both heat sets', grid.includes('Set 2') && grid.includes('inverted'));
  const twoHeat = await page.evaluate(() => ({ n: classHeats(classById(777)), complete: classComplete(777) }));
  check('default class still needs 2 heats and is not complete', twoHeat.n === 2 && !twoHeat.complete, JSON.stringify(twoHeat));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
