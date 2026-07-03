// Thorough test: main-event invert (feature + B-main starting order)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..'); const PORT = 8795;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 480, height: 950 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Seed: 12 drivers (D01 fastest .. D12 slowest by heat finish), one heat, feature of 8,
  // single B-main with 2 transfers. Invert: feature top 4, B-main top 3.
  await page.evaluate(() => {
    S.track.name = 'T'; S.adminPin = '';
    const cls = S.classes[0];
    cls.heats = 1; cls.maxHeat = 12; cls.maxFeature = 8; cls.maxBMain = 12;
    cls.invertFeature = 4; cls.invertBMain = 3;
    S.settings.transfers = 2; S.settings.bmainMode = 'single';
    for (let i = 1; i <= 12; i++) {
      const id = 8000 + i;
      S.roster.push({ id, name: 'D' + String(i).padStart(2, '0'), num: String(i) });
      S.raceDay.entries.push({ driverId: id, classId: cls.id, pill: i });
    }
    const res = getRes(cls.id);
    for (let i = 1; i <= 12; i++) res['h1_' + (8000 + i)] = i;   // finish = rank
    save();
    setDeviceRole('admin');
    sessionStorage.setItem('rd_admin_ok', '1');
  });
  await page.reload(); await page.waitForTimeout(300);
  const clsId = await page.evaluate(() => S.classes[0].id);

  console.log('\n— featureData: B-main lineup inverted, transfers untouched —');
  let fd = await page.evaluate((cid) => {
    const f = featureData(cid);
    return { locked: f.locked.map(r => r.name), bmain: f.mains[0].drivers.map(r => r.name), spots: f.toFeatureSpots };
  }, clsId);
  check('locked = heat-total top 6 straight', fd.locked.join(',') === 'D01,D02,D03,D04,D05,D06', fd.locked.join(','));
  check('B-main start order top 3 inverted (D09,D08,D07,…)', fd.bmain.join(',') === 'D09,D08,D07,D10,D11,D12', fd.bmain.join(','));

  console.log('\n— Results page: feature stays straight while transfer spots are open —');
  await page.evaluate(() => { nav('results'); });
  await page.waitForTimeout(300);
  let rows = await page.$$eval('#resBody .hb', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  const featBlockTxt = rows.find(t => t.includes('🏁 Feature')) || '';
  check('feature header notes invert', featBlockTxt.includes('top 4 start inverted'), featBlockTxt.slice(0, 120));
  let ftNames = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#resBody .hb')];
    const fb = blocks.find(b => b.textContent.includes('🏁 Feature'));
    return [...fb.querySelectorAll('.hr .nm b')].map(b => b.textContent);
  });
  check('P1 = D01 (no invert yet — placeholders open)', ftNames[0] === 'D01', ftNames.join(','));
  const bmHeader = rows.find(t => t.includes('B-main lineup')) || '';
  check('B-main header notes invert', bmHeader.includes('top 3 start inverted'), bmHeader.slice(0, 120));
  let bmNames = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#resBody .hb')];
    const bb = blocks.find(b => b.textContent.includes('B-main lineup'));
    return [...bb.querySelectorAll('.hr .nm b')].map(b => b.textContent);
  });
  check('B-main rows listed in inverted start order', bmNames.join(',') === 'D09,D08,D07,D10,D11,D12', bmNames.join(','));

  console.log('\n— Score the B-main: D10 wins, D12 second → they transfer —');
  await page.evaluate((cid) => {
    const res = getRes(cid);
    res['bm_8010'] = 1; res['bm_8012'] = 2;
    save(); renderClassResults(cid);
  }, clsId);
  await page.waitForTimeout(250);
  fd = await page.evaluate((cid) => {
    const f = featureData(cid);
    return { transferred: f.transferred.map(r => r.name), order: featureGridOrder(f, cid).map(r => r.name) };
  }, clsId);
  check('transfers by FINISH not start spot (D10,D12)', fd.transferred.join(',') === 'D10,D12', fd.transferred.join(','));
  check('feature order = top 4 flipped (D04,D03,D02,D01,D05,D06,D10,D12)',
    fd.order.join(',') === 'D04,D03,D02,D01,D05,D06,D10,D12', fd.order.join(','));

  console.log('\n— Results feature rows now inverted, tags follow their drivers —');
  ftNames = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#resBody .hb')];
    const fb = blocks.find(b => b.textContent.includes('🏁 Feature'));
    return [...fb.querySelectorAll('.hr .nm b')].map(b => b.textContent);
  });
  check('results feature P1 = D04', ftNames[0] === 'D04', ftNames.join(','));
  check('results feature P4 = D01', ftNames[3] === 'D01', ftNames.join(','));
  check('transferees at back (P7=D10, P8=D12)', ftNames[6] === 'D10' && ftNames[7] === 'D12', ftNames.join(','));
  const p7tag = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#resBody .hb')];
    const fb = blocks.find(b => b.textContent.includes('🏁 Feature'));
    return fb.querySelectorAll('.hr')[6].textContent;
  });
  check('D10 keeps B-main origin tag', p7tag.includes('B-main P1'), p7tag.replace(/\s+/g, ' '));

  console.log('\n— Lineups page: feature grid inverted + labeled —');
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(300);
  const gridTxt = await page.textContent('#gridContent');
  check('grid label notes feature invert', gridTxt.includes('top 4 start inverted'));
  check('grid label notes B-main invert', gridTxt.includes('top 3 start inverted'));
  const gridFeatFirst = await page.evaluate(() => {
    const lbls = [...document.querySelectorAll('#gridContent .slbl')];
    const fl = lbls.find(l => l.textContent.includes('🏁 Feature'));
    let el = fl.nextElementSibling;
    while (el && !el.querySelector('.who b, .nm b')) el = el.nextElementSibling;
    return el.querySelector('.who b, .nm b').textContent;
  });
  check('grid feature pole = D04', gridFeatFirst === 'D04', gridFeatFirst);

  console.log('\n— Viewer feature stage inverted too —');
  await page.evaluate(() => setDeviceRole('viewer'));
  await page.reload(); await page.waitForTimeout(300);
  await page.evaluate((cid) => { UI.viewClsId = cid; UI.viewStage = 'feat'; renderGrid(); }, clsId);
  await page.waitForTimeout(200);
  const vFirst = await page.evaluate(() => document.querySelector('.vw-body .who b, .vw-body .nm b').textContent);
  const vTxt = await page.textContent('.vw-body');
  check('viewer feature pole = D04', vFirst === 'D04', vFirst);
  check('viewer label notes invert', vTxt.includes('top 4 start inverted'));
  await page.screenshot({ path: '/tmp/test-invert-viewer.png' });

  console.log('\n— Points & finishes unaffected by invert —');
  await page.evaluate(() => setDeviceRole('admin'));
  await page.reload(); await page.waitForTimeout(300);
  await page.evaluate((cid) => {
    const res = getRes(cid);
    // D06 wins the feature from P6; D04 (pole) finishes 8th
    ['8006','8001','8002','8003','8005','8010','8012','8004'].forEach((id, i) => res['ft_' + id] = i + 1);
    save();
  }, clsId);
  const ptsCheck = await page.evaluate((cid) => {
    const ff = featureFinish(cid);
    const dp = dayPoints(cid);
    return { winner: ff[0].name, winnerPts: dp[8006], polePts: dp[8004] };
  }, clsId);
  check('feature winner = D06 (finish decides, not grid spot)', ptsCheck.winner === 'D06', ptsCheck.winner);
  check('winner takes top points (10)', ptsCheck.winnerPts === 10, String(ptsCheck.winnerPts));
  check('pole-sitter who finished 8th gets P8 points (1)', ptsCheck.polePts === 1, String(ptsCheck.polePts));

  console.log('\n— No-mains class: small field feature invert —');
  const res2 = await page.evaluate(() => {
    const c2 = S.classes[1];
    c2.heats = 1; c2.maxHeat = 8; c2.invertFeature = 2;
    for (let i = 1; i <= 4; i++) {
      const id = 8100 + i;
      S.roster.push({ id, name: 'E' + i, num: '10' + i });
      S.raceDay.entries.push({ driverId: id, classId: c2.id, pill: i });
    }
    const res = getRes(c2.id);
    for (let i = 1; i <= 4; i++) res['h1_' + (8100 + i)] = i;
    save();
    const f = featureData(c2.id);
    return featureGridOrder(f, c2.id).map(r => r.name);
  });
  check('4-kart class, invert 2 → E2,E1,E3,E4', res2.join(',') === 'E2,E1,E3,E4', res2.join(','));

  console.log('\n— Admin UI + setter —');
  const admHtml = await page.evaluate(() => { renderClsList(); return document.getElementById('clsList').innerHTML; });
  check('class row shows Main invert inputs', admHtml.includes('Main invert') && admHtml.includes('invertFeature'));
  const toggled = await page.evaluate((cid) => {
    setClassMainInvert(cid, 'invertFeature', '');    // blank clears
    const off = clsFeatInvert(cid);
    setClassMainInvert(cid, 'invertFeature', '6');
    return { off, on: clsFeatInvert(cid) };
  }, clsId);
  check('blank clears invert', toggled.off === 0, String(toggled.off));
  check('setter stores new N', toggled.on === 6, String(toggled.on));

  console.log('\n— Invert off = straight order (regression) —');
  const straight = await page.evaluate((cid) => {
    setClassMainInvert(cid, 'invertFeature', '');
    setClassMainInvert(cid, 'invertBMain', '');
    const f = featureData(cid);
    return { order: featureGridOrder(f, cid).map(r => r.name), bmain: f.mains[0].drivers.map(r => r.name) };
  }, clsId);
  check('feature straight again (D01 first)', straight.order[0] === 'D01', straight.order.join(','));
  check('B-main straight again (D07 first)', straight.bmain[0] === 'D07', straight.bmain.join(','));

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
