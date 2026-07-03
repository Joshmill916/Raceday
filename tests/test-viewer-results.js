// Thorough test: viewer Results tab + "Results updated" toast
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8791;
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
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
  page.on('dialog', d => d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // ---- Seed: track name, 4 drivers in class[0] (1-heat class), viewer role ----
  await page.evaluate(() => {
    S.track.name = 'Test Track';
    const cls = S.classes[0];
    cls.heats = 1;                       // single heat set → only h1_ needed
    const drivers = [
      { id: 9001, name: 'Alex Smith', num: '47' },
      { id: 9002, name: 'Sam Jones',  num: '12' },
      { id: 9003, name: 'Mike Chen',  num: '88' },
      { id: 9004, name: 'Donna Lee',  num: '5'  },
    ];
    drivers.forEach(d => S.roster.push(d));
    drivers.forEach((d, i) => S.raceDay.entries.push({ driverId: d.id, classId: cls.id, pill: i + 1 }));
    save();
    setDeviceRole('viewer');
  });
  await page.reload();
  await page.waitForTimeout(400);

  console.log('\n— Viewer tabs —');
  const tabs = await page.$$eval('.vw-tabs button', els => els.map(e => e.textContent));
  check('5 stage tabs render', tabs.length === 5, 'got: ' + tabs.join(','));
  check('Results tab present', tabs.includes('Results'));

  console.log('\n— Results tab: empty state (nothing scored) —');
  await page.click('.vw-tabs button:has-text("Results")');
  await page.waitForTimeout(200);
  let body = await page.textContent('.vw-body');
  check('empty state message', body.includes('Results will appear here once the feature is scored'), body.trim().slice(0, 80));

  console.log('\n— Score the class (heat + feature), re-render —');
  await page.evaluate(() => {
    const cls = S.classes[0];
    const res = getRes(cls.id);
    // heat finishes (pill order): 9001..9004 finish 1..4
    res['h1_9001'] = 2; res['h1_9002'] = 1; res['h1_9003'] = 4; res['h1_9004'] = 3;
    // feature finishes: Donna wins, Mike 2nd, Alex 3rd, Sam 4th
    res['ft_9004'] = 1; res['ft_9003'] = 2; res['ft_9001'] = 3; res['ft_9002'] = 4;
    save();
    renderGrid();
  });
  await page.waitForTimeout(200);
  body = await page.textContent('.vw-body');
  check('results header shows', body.includes('results'));
  const rows = await page.$$eval('.vw-body .hr', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('4 finish rows', rows.length === 4, 'got ' + rows.length);
  check('P1 = Donna Lee', rows[0] && rows[0].includes('P1') && rows[0].includes('Donna Lee'), rows[0]);
  check('P2 = Mike Chen', rows[1] && rows[1].includes('Mike Chen'), rows[1]);
  check('P3 = Alex Smith', rows[2] && rows[2].includes('Alex Smith'), rows[2]);
  check('P4 = Sam Jones', rows[3] && rows[3].includes('Sam Jones'), rows[3]);
  await page.screenshot({ path: '/tmp/test-results-tab.png' });

  console.log('\n— Driver card opens from a results row —');
  await page.click('.vw-body .hr:first-child .nm');
  await page.waitForTimeout(200);
  let cardVisible = await page.evaluate(() => document.getElementById('viewerDriverCard').style.display !== 'none');
  let cardText = await page.textContent('#vdcContent');
  check('card opens', cardVisible);
  check('card shows winner', cardText.includes('Donna Lee'), cardText.trim().slice(0, 60));
  await page.evaluate(() => hideViewerCard());

  console.log('\n— Toast: fires when a sync snapshot changes feature finishes —');
  // Simulate an incoming Firebase snapshot where Sam moves from P4 to DNF-style change:
  // swap ft_9001 and ft_9002 (Alex 4th, Sam 3rd) — finishes changed → toast.
  await page.evaluate(() => {
    const hr = JSON.parse(JSON.stringify(S.raceDay.heatResults));
    const k = 'cls' + S.classes[0].id;
    hr[k]['ft_9001'] = 4; hr[k]['ft_9002'] = 3;
    syncApplySnapshot({ raceDay: { heatResults: JSON.stringify(hr) } });
  });
  await page.waitForTimeout(200);
  let toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('toast appears on finish change', toastVisible);
  await page.screenshot({ path: '/tmp/test-toast.png' });

  console.log('\n— Toast: View → button jumps to Results tab and dismisses —');
  await page.evaluate(() => { UI.viewStage = 'qual'; renderGrid(); });   // move away first
  await page.click('#viewerToast button');
  await page.waitForTimeout(200);
  const stage = await page.evaluate(() => UI.viewStage);
  toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('switches to results stage', stage === 'results', 'stage=' + stage);
  check('toast dismissed', !toastVisible);
  body = await page.textContent('.vw-body');
  check('updated order shown (P3 = Sam Jones)', (await page.$$eval('.vw-body .hr', els => els.map(e => e.textContent)))[2].includes('Sam Jones'));

  console.log('\n— Toast: does NOT fire when snapshot has no finish change —');
  await page.evaluate(() => {
    syncApplySnapshot({ raceDay: { entries: JSON.stringify(S.raceDay.entries) } });   // entries only, same finishes
  });
  await page.waitForTimeout(200);
  toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('toast stays hidden', !toastVisible);

  console.log('\n— Toast: auto-hides after 5 s —');
  await page.evaluate(() => {
    const hr = JSON.parse(JSON.stringify(S.raceDay.heatResults));
    const k = 'cls' + S.classes[0].id;
    hr[k]['ft_9001'] = 3; hr[k]['ft_9002'] = 4;   // swap back → change again
    syncApplySnapshot({ raceDay: { heatResults: JSON.stringify(hr) } });
  });
  await page.waitForTimeout(300);
  toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('toast visible immediately', toastVisible);
  await page.waitForTimeout(5200);
  toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('toast auto-hidden after 5 s', !toastVisible);

  console.log('\n— Regression: other 4 viewer tabs still render —');
  for (const t of ['Qualifying', 'Heats', 'B-Mains', 'Feature']) {
    await page.click(`.vw-tabs button:has-text("${t}")`);
    await page.waitForTimeout(150);
    const b = await page.textContent('.vw-body');
    const err = await page.evaluate(() => window.__err || null);
    check(t + ' tab renders', b.trim().length > 0 && !err, (b || '').trim().slice(0, 50));
  }

  console.log('\n— Admin role: unaffected —');
  await page.evaluate(() => setDeviceRole('admin'));
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(200);
  const adminHasViewerTabs = await page.$('.vw-tabs');
  check('admin grid has no viewer tabs', !adminHasViewerTabs);
  // finish change arriving on an admin device must NOT toast
  await page.evaluate(() => {
    const hr = JSON.parse(JSON.stringify(S.raceDay.heatResults));
    const k = 'cls' + S.classes[0].id;
    hr[k]['ft_9001'] = 4; hr[k]['ft_9002'] = 3;
    syncApplySnapshot({ raceDay: { heatResults: JSON.stringify(hr) } });
  });
  await page.waitForTimeout(200);
  toastVisible = await page.evaluate(() => document.getElementById('viewerToast').style.display !== 'none');
  check('no toast on admin device', !toastVisible);

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
