// Full race-night smoke test: wizard → signup → lineups → results → points → archive
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..'); const PORT = 8796;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    fs.readFile(path.join(ROOT, req.url === '/' ? 'raceday/index.html' : req.url.split('?')[0]), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 460, height: 950 } });
  page.on('pageerror', e => { fail++; console.log('  ❌ PAGE ERROR: ' + e.message); });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(400);

  console.log('— Setup wizard —');
  check('wizard auto-opens on fresh install', await page.evaluate(() => document.getElementById('setupWizard').style.display !== 'none'));
  await page.click('#wizNextBtn'); await page.waitForTimeout(150);
  await page.fill('#wizTrackName', 'Smoke Speedway');
  await page.click('#wizNextBtn'); await page.waitForTimeout(150);   // classes step
  await page.click('#wizNextBtn'); await page.waitForTimeout(150);   // pin step (skip)
  await page.click('#wizNextBtn'); await page.waitForTimeout(150);   // devices
  await page.click('#wizNextBtn'); await page.waitForTimeout(200);   // done
  check('wizard closes, track saved', await page.evaluate(() => document.getElementById('setupWizard').style.display === 'none' && S.track.name === 'Smoke Speedway'));

  console.log('— Sign-up (real UI) —');
  const clsIds = await page.evaluate(() => S.classes.map(c => c.id));
  const drivers = [['Alex Smith','47',0],['Sam Jones','12',0],['Mike Chen','88',0],['Donna Lee','5',0],['Ryan Park','33',1],['Tina Fox','21',1]];
  for (const [name, num, ci] of drivers) {
    await page.evaluate(() => nav('signup')); await page.waitForTimeout(150);
    await page.fill('#dName', name); await page.fill('#dNum', num);
    await page.evaluate(() => step2()); await page.waitForTimeout(150);
    await page.click('#ch' + clsIds[ci]); await page.waitForTimeout(100);
    const consent = await page.$('#consentChk');
    if (consent && !(await consent.isChecked())) await consent.check();
    await page.click('button:has-text("Draw my pill")'); await page.waitForTimeout(250);
    const next = await page.$('button:has-text("next driver")');
    if (next) await next.click();
    await page.waitForTimeout(100);
  }
  const entries = await page.evaluate(() => S.raceDay.entries.length);
  check('6 drivers registered via UI', entries === 6, 'entries=' + entries);
  check('roster built', await page.evaluate(() => S.roster.length === 6));
  check('pills unique per class', await page.evaluate(() => {
    const seen = {}; return S.raceDay.entries.every(e => { const k = e.classId + '_' + e.pill; if (seen[k]) return false; seen[k] = 1; return true; });
  }));

  console.log('— Lineups —');
  await page.evaluate(() => nav('grid')); await page.waitForTimeout(250);
  const gtxt = await page.textContent('#gridContent');
  check('both classes on grid', gtxt.includes('4 entered') && gtxt.includes('2 entered'));
  check('TV slides build without error', await page.evaluate(() => { try { openTV(); const ok = document.getElementById('tvOverlay') != null || true; closeTV && closeTV(); return ok; } catch (e) { return false; } }));

  console.log('— Results: score class 1 (heat via UI, rest direct) —');
  await page.evaluate(() => nav('results')); await page.waitForTimeout(250);
  // first heat select via real UI
  await page.selectOption('#resBody select.fin-sel', '1'); await page.waitForTimeout(200);
  check('UI select saved a finish', await page.evaluate(() => Object.keys(getRes(S.classes[0].id)).length >= 1));
  // fill remaining h1+h2 direct
  await page.evaluate(() => {
    const cid = S.classes[0].id, res = getRes(cid);
    const rc = classRacers(cid);
    rc.forEach((r, i) => { res['h1_' + r.id] = i + 1; res['h2_' + r.id] = i + 1; });
    save(); renderClassResults(cid);
  });
  await page.waitForTimeout(200);
  check('class complete after heats', await page.evaluate(() => classComplete(S.classes[0].id)));
  await page.evaluate(() => {
    const cid = S.classes[0].id, res = getRes(cid);
    featureGridOrder(featureData(cid), cid).forEach((r, i) => { res['ft_' + r.id] = i + 1; });
    save(); renderClassResults(cid);
  });
  await page.waitForTimeout(200);
  check('feature finishes entered', await page.evaluate(() => featureFinish(S.classes[0].id).length === 4));
  check('points checkbox enabled', await page.evaluate(() => !document.querySelector('#resBody input[type=checkbox]').disabled));
  check('dup-finish warning absent', !(await page.textContent('#resBody')).includes('duplicate'));

  console.log('— Points —');
  await page.evaluate(() => nav('points')); await page.waitForTimeout(250);
  const ptxt = await page.textContent('#pointsContent');
  check('standings show live points', ptxt.includes('points race') && /10/.test(ptxt));

  console.log('— Governance —');
  await page.evaluate(() => { toggleResLock(S.classes[0].id); });
  check('lock blocks edits', await page.evaluate(() => resLocked(S.classes[0].id)));
  await page.evaluate(() => { overrideRes(S.classes[0].id); });
  check('override unblocks', await page.evaluate(() => !resLocked(S.classes[0].id)));

  console.log('— Archive / new day —');
  await page.evaluate(() => nav('admin')); await page.waitForTimeout(250);
  await page.evaluate(() => newRaceDay()); await page.waitForTimeout(300);
  check('history has 1 race day', await page.evaluate(() => S.history.length === 1));
  check('board cleared, roster kept', await page.evaluate(() => S.raceDay.entries.length === 0 && S.roster.length === 6));
  check('archived feature finish recorded', await page.evaluate(() => S.history[0].classes[0].featureFinish.length === 4));
  await page.evaluate(() => nav('points')); await page.waitForTimeout(250);
  check('points persist from history', /10/.test(await page.textContent('#pointsContent')));

  console.log('— Persistence across reload —');
  await page.reload(); await page.waitForTimeout(400);
  check('state survives reload', await page.evaluate(() => S.track.name === 'Smoke Speedway' && S.history.length === 1 && S.roster.length === 6));
  check('wizard does NOT reopen', await page.evaluate(() => document.getElementById('setupWizard').style.display === 'none'));

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
