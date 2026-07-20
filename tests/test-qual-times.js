// Thorough test: manual qualifying-times entry + set-grid-from-times
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8792;
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
  page.on('dialog', d => d.accept());   // auto-accept the confirm() on Set grid

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Seed: 4 drivers in class[0], pills 1..4 (Alex pole by draw), admin role, no PIN.
  await page.evaluate(() => {
    S.track.name = 'Test Track';
    S.adminPin = '';
    const cls = S.classes[0];
    const drivers = [
      { id: 7001, name: 'Alex Smith', num: '47' },
      { id: 7002, name: 'Sam Jones',  num: '12' },
      { id: 7003, name: 'Mike Chen',  num: '88' },
      { id: 7004, name: 'Donna Lee',  num: '5'  },
    ];
    drivers.forEach(d => S.roster.push(d));
    drivers.forEach((d, i) => S.raceDay.entries.push({ driverId: d.id, classId: cls.id, pill: i + 1 }));
    save();
    setDeviceRole('admin');
    sessionStorage.setItem('rd_admin_ok', '1');
  });
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(300);

  const clsId = await page.evaluate(() => S.classes[0].id);

  console.log('\n— Button on Lineups page —');
  const btn = await page.$('button:has-text("⏱ Qualifying times")');
  check('Qualifying-times button renders per class', !!btn);

  console.log('\n— Open modal —');
  await btn.click();
  await page.waitForTimeout(250);
  let modalOpen = await page.evaluate(() => document.getElementById('qualTimesModal').style.display !== 'none');
  check('modal opens', modalOpen);
  const inputCount = await page.$$eval('#qtBody input[data-id]', els => els.length);
  check('4 driver input rows', inputCount === 4, 'got ' + inputCount);
  const initialRanks = await page.$$eval('#qtBody .qt-rank', els => els.map(e => e.textContent));
  check('initial badges show current grid order P1..P4', initialRanks.join(',') === 'P1,P2,P3,P4', initialRanks.join(','));

  console.log('\n— Enter times, live provisional order —');
  // Donna fastest (14.1), Mike (15.0), Alex (16.5), Sam slowest (1:02.0 = 62s)
  const byId = async (id) => (await page.$(`#qtBody input[data-id="${id}"]`));
  await (await byId(7001)).fill('16.5');
  await (await byId(7002)).fill('1:02.0');
  await (await byId(7003)).fill('15.0');
  await (await byId(7004)).fill('14.1');
  await page.waitForTimeout(200);
  // Read badge per driver id
  const badgeFor = async (id) => page.evaluate((id) => {
    const inp = document.querySelector(`#qtBody input[data-id="${id}"]`);
    return inp.closest('.qt-row').querySelector('.qt-rank').textContent;
  }, id);
  check('Donna (fastest) → P1', (await badgeFor(7004)) === 'P1', await badgeFor(7004));
  check('Mike → P2', (await badgeFor(7003)) === 'P2', await badgeFor(7003));
  check('Alex → P3', (await badgeFor(7001)) === 'P3', await badgeFor(7001));
  check('Sam (1:02) → P4', (await badgeFor(7002)) === 'P4', await badgeFor(7002));

  console.log('\n— colon time parses via impParseLapTime —');
  const parsed = await page.evaluate(() => impParseLapTime('1:02.0'));
  check('1:02.0 → 62 s', parsed === 62, 'got ' + parsed);

  console.log('\n— invalid time flags red border —');
  await (await byId(7001)).fill('abc');
  await page.waitForTimeout(150);
  const borderBad = await page.evaluate(() => document.querySelector('#qtBody input[data-id="7001"]').style.borderColor);
  check('bad input gets red border', borderBad && borderBad !== '', 'border=' + borderBad);
  await (await byId(7001)).fill('16.5');   // restore
  await page.waitForTimeout(120);

  console.log('\n— Save times: persists, grid order unchanged —');
  await page.click('#qualTimesModal button:has-text("Save times")');
  await page.waitForTimeout(200);
  let entries = await page.evaluate((cid) => S.raceDay.entries.filter(e => e.classId === cid).map(e => ({ id: e.driverId, pill: e.pill, t: e.qualTime })), clsId);
  const alex = entries.find(e => e.id === 7001);
  check('qualTime saved on entry', alex && alex.t === '16.5', JSON.stringify(alex));
  check('grid order NOT changed by Save (Alex still pill 1)', alex && alex.pill === 1, 'pill=' + (alex && alex.pill));
  modalOpen = await page.evaluate(() => document.getElementById('qualTimesModal').style.display !== 'none');
  check('modal stays open after Save', modalOpen);

  console.log('\n— Time shows on the grid —');
  await page.evaluate(() => closeQualTimes());
  await page.waitForTimeout(200);
  let gridText = await page.textContent('#gridContent');
  check('grid shows a ⏱ time label', gridText.includes('⏱ 16.5'), gridText.match(/⏱[^<]{0,8}/g) ? gridText.match(/⏱[^<]{0,8}/g).join(' ') : 'none');

  console.log('\n— Set grid from times: reorders pills —');
  await page.click('button:has-text("⏱ Qualifying times")');
  await page.waitForTimeout(200);
  await page.click('#qualTimesModal button:has-text("Set grid from times")');
  await page.waitForTimeout(300);
  entries = await page.evaluate((cid) => S.raceDay.entries.filter(e => e.classId === cid).map(e => ({ id: e.driverId, pill: e.pill })), clsId);
  const pillOf = id => (entries.find(e => e.id === id) || {}).pill;
  check('Donna now pill 1 (pole)', pillOf(7004) === 1, 'pill=' + pillOf(7004));
  check('Mike pill 2', pillOf(7003) === 2, 'pill=' + pillOf(7003));
  check('Alex pill 3', pillOf(7001) === 3, 'pill=' + pillOf(7001));
  check('Sam pill 4', pillOf(7002) === 4, 'pill=' + pillOf(7002));
  modalOpen = await page.evaluate(() => document.getElementById('qualTimesModal').style.display !== 'none');
  check('modal closes after Set grid', !modalOpen);
  // Grid P1 driver is now Donna
  await page.waitForTimeout(150);
  const firstSlot = await page.evaluate(() => {
    const el = document.querySelector('#gridContent .slot, #gridContent .hr');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  check('grid P1 slot shows Donna Lee', firstSlot.includes('Donna Lee'), firstSlot);
  await page.screenshot({ path: '/tmp/test-qual-grid.png' });

  console.log('\n— Untimed drivers sink to back —');
  // Reopen, clear Sam's time, add a 5th untimed driver, set grid → untimed last.
  await page.evaluate((cid) => {
    S.roster.push({ id: 7005, name: 'Pat Quick', num: '99' });
    S.raceDay.entries.push({ driverId: 7005, classId: cid, pill: 5 });
    save();
  }, clsId);
  await page.evaluate(() => renderGrid());
  await page.waitForTimeout(150);
  await page.click('button:has-text("⏱ Qualifying times")');
  await page.waitForTimeout(200);
  // Pat has no time; everyone else does. Set grid → Pat should be pill 5 (last).
  await page.click('#qualTimesModal button:has-text("Set grid from times")');
  await page.waitForTimeout(300);
  const patPill = await page.evaluate((cid) => (S.raceDay.entries.find(e => e.classId === cid && e.driverId === 7005) || {}).pill, clsId);
  check('untimed Pat sinks to back (pill 5)', patPill === 5, 'pill=' + patPill);

  console.log('\n— Viewer qualifying stage shows times —');
  await page.evaluate(() => { setDeviceRole('viewer'); });
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate((cid) => { UI.viewClsId = cid; UI.viewStage = 'qual'; renderGrid(); }, clsId);
  await page.waitForTimeout(200);
  const vBody = await page.textContent('.vw-body');
  check('viewer qualifying view shows a ⏱ time', vBody.includes('⏱'), (vBody.match(/⏱[^ ]* [0-9:.]+/g) || []).join(' ') || 'none');

  console.log('\n— Empty-class safety —');
  const noErr = await page.evaluate(() => {
    try { _qtClsId = 999999; renderQtBody(); return true; } catch (e) { return 'threw: ' + e.message; }
  });
  check('renderQtBody on empty/unknown class does not throw', noErr === true, String(noErr));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
