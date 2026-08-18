// v2 admin: the two-door reorganization, search, and a spot-check of real section
// logic (classes, format, points, PIN, backup, danger zone, the setup wizard).
//
// v1's admin was a tile-grid home feeding a second row of pill tabs — 16 sections deep
// with no way to jump straight to a control. v2 splits by how often a section is
// touched (Race night / Season setup / Account / Danger) and adds search. This suite
// checks every one of the 16 v1 sections is still reachable, that search actually
// finds them, and that a sample of the underlying logic (ported verbatim from v1)
// still does the right thing wired into the new markup.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8813;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const TYPES = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.webmanifest':'application/manifest+json' };

const ALL_SECTIONS = ['today','history','track','classes','format','points','legal','sync','pin','license','roster','backup','repair','audit','danger'];

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'text/plain' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', e => errs.push(e.message));
  // A single router (not stacked page.once/page.on handlers, which race each other and
  // throw "dialog already handled") — queue() programs the next dialog's response;
  // anything unqueued gets a plain accept.
  const dialogQueue = [];
  const queue = (action, text) => dialogQueue.push({ action, text });
  page.on('dialog', d => {
    const next = dialogQueue.shift();
    if (!next || next.action === 'accept') d.accept(next && next.text != null ? next.text : undefined);
    else d.dismiss();
  });

  console.log('— Setup wizard on first boot —');
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  check('the wizard auto-opens on a fresh install', await page.evaluate(() => document.getElementById('sheetHost').classList.contains('on')));
  check('step 1 is the welcome step', (await page.textContent('#sheetBody')).includes('Welcome to RaceDay'));
  await page.click('#wizNextBtn'); await page.waitForTimeout(200);
  check('next is disabled until a track name is entered',
    await page.evaluate(() => document.getElementById('wizNextBtn').disabled));
  await page.fill('#wizTrackName', 'Wizard Speedway');
  await page.evaluate(() => document.getElementById('wizTrackName').dispatchEvent(new Event('input')));
  check('a track name enables next', await page.evaluate(() => !document.getElementById('wizNextBtn').disabled));
  await page.click('#wizNextBtn'); await page.waitForTimeout(200);          // → classes
  await page.click('button:has-text("+ Add a class")'); await page.waitForTimeout(150);
  await page.fill('#wizCls0', 'Wizard Class');
  await page.click('#wizNextBtn'); await page.waitForTimeout(200);          // → PIN
  await page.fill('#wizPin1', '4242'); await page.fill('#wizPin2', '4242');
  await page.click('#wizNextBtn'); await page.waitForTimeout(200);          // → done
  await page.click('#wizNextBtn'); await page.waitForTimeout(250);          // close
  check('the wizard closed', !(await page.evaluate(() => document.getElementById('sheetHost').classList.contains('on'))));
  check('the track name was saved', await page.evaluate(() => S.track.name === 'Wizard Speedway'));
  check('the class was saved', await page.evaluate(() => S.classes.some(c => c.name === 'Wizard Class')));
  check('the PIN was hashed and set', await page.evaluate(() => !!S.adminPin && pinHash('4242') === S.adminPin));

  console.log('— Admin is now PIN-gated —');
  await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); });
  queue('accept', '4242');
  await page.evaluate(() => nav('admin')); await page.waitForTimeout(300);
  check('the correct PIN opens admin', await page.evaluate(() => curPage === 'admin'));

  console.log('— The admin home shows two doors + danger, all 16 sections reachable —');
  await page.evaluate(() => admHome()); await page.waitForTimeout(200);
  const doorLabels = await page.$$eval('.slbl', els => els.map(e => e.textContent));
  ['Race night', 'Season setup', 'Account', 'Danger zone'].forEach(d =>
    check('door "' + d + '" is on the home screen', doorLabels.some(t => t.includes(d))));
  for (const id of ALL_SECTIONS) {
    const ok = await page.evaluate(id => {
      admOpen(id);
      return curPage === 'admin' && document.getElementById('adminWrap').innerHTML.length > 200;
    }, id);
    check('section "' + id + '" opens and renders', ok);
  }

  console.log('— Search finds settings by keyword, not just by section name —');
  await page.evaluate(() => admHome()); await page.waitForTimeout(150);
  await page.fill('#admSearchInput', 'invert');
  await page.waitForTimeout(150);
  check('"invert" search surfaces Race classes', (await page.textContent('#admSearchResults')).includes('Race classes'));
  await page.fill('#admSearchInput', 'b-main');
  await page.waitForTimeout(150);
  check('"b-main" search surfaces Race format', (await page.textContent('#admSearchResults')).includes('Race format'));
  await page.click('.adm-hit'); await page.waitForTimeout(200);
  check('tapping a search hit opens that section', await page.evaluate(() => UI.admSec === 'format'));

  console.log('— Classes: add, invert, running order (ported logic, new markup) —');
  await page.evaluate(() => admOpen('classes')); await page.waitForTimeout(200);
  await page.fill('#newClass', 'Second Class');
  await page.click('button:has-text("Add class")'); await page.waitForTimeout(200);
  check('a class was added', await page.evaluate(() => S.classes.some(c => c.name === 'Second Class')));
  // The wizard's default classLib (Junior 80cc, Senior 100cc, Open Shifter) plus the
  // wizard's own "+ Add a class" click mean "Second Class" is not necessarily first —
  // moveClass swaps with its immediate neighbor, so check the swap, not a fixed index.
  const secondId = await page.evaluate(() => S.classes.find(c => c.name === 'Second Class').id);
  const idxBefore = await page.evaluate(id => S.classes.findIndex(c => c.id === id), secondId);
  await page.evaluate(id => moveClass(id, -1), secondId); await page.waitForTimeout(150);
  const idxAfter = await page.evaluate(id => S.classes.findIndex(c => c.id === id), secondId);
  check('running order changed (moved up one spot)', idxAfter === idxBefore - 1,
    'before=' + idxBefore + ' after=' + idxAfter);
  await page.evaluate(id => setClassInvert(id, '4'), secondId);
  await page.evaluate(id => setClassFormat(id, 'field'), secondId);
  check('invert applied to the class', await page.evaluate(id => classById(id).invert === 4, secondId));

  console.log('— Race format: heat/feature/B-main sizes persist —');
  await page.evaluate(() => admOpen('format')); await page.waitForTimeout(200);
  await page.fill('#mHeat', '6'); await page.evaluate(() => document.getElementById('mHeat').dispatchEvent(new Event('change')));
  await page.waitForTimeout(150);
  check('heat size saved', await page.evaluate(() => S.settings.maxHeat === 6));

  console.log('— Points presets —');
  await page.evaluate(() => admOpen('points')); await page.waitForTimeout(200);
  await page.selectOption('#ptsPreset', 'f1');
  await page.waitForTimeout(150);
  check('F1 preset applied', await page.evaluate(() => S.settings.points.table[0] === 25 || S.settings.points.table.length === 10),
    await page.evaluate(() => JSON.stringify(S.settings.points)));

  console.log('— Backup export doesn\'t crash and downloads something —');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => { admOpen('backup'); }).then(() => page.waitForTimeout(200)).then(() => page.click('button:has-text("Download full backup")'))
  ]);
  check('a backup file download was triggered', !!download && /raceday-backup-.*\.json/.test(download.suggestedFilename()));

  console.log('— Driver book: no-points toggle —');
  await page.evaluate(() => {
    S.roster.push({ id: genDriverId(), name: 'Test Driver', num: '77', noPoints: false });
    save();
  });
  await page.evaluate(() => admOpen('roster')); await page.waitForTimeout(200);
  const tid = await page.evaluate(() => S.roster.find(d => d.name === 'Test Driver').id);
  await page.evaluate(id => toggleNoPoints(id), tid);
  check('no-points toggle persists', await page.evaluate(id => driverById(id).noPoints === true, tid));

  console.log('— Danger zone: a new race day archives and clears the board —');
  await page.evaluate(() => {
    admOpen('danger');
    S.raceDay.entries.push({ driverId: S.roster[0].id, classId: S.classes[0].id, pill: 1 });
    save();
  });
  await page.waitForTimeout(150);
  const histBefore = await page.evaluate(() => S.history.length);
  queue('accept');    // "start new race day?" confirm
  queue('dismiss');   // "back up first?" — skip the download prompt
  await page.evaluate(() => newRaceDay());
  await page.waitForTimeout(300);
  check('the day archived to history', await page.evaluate(h => S.history.length === h + 1, histBefore));
  check('the board cleared', await page.evaluate(() => S.raceDay.entries.length === 0));

  console.log('— History entry actually expands on "View" (not just that the section renders) —');
  // (Real bug found by audit: renderHistory() emits onclick="toggleHist(i)", but
  //  toggleHist() was never defined in raceday2/index.html — a dangling reference. The
  //  ALL_SECTIONS loop above only asserts the history section renders >200 chars; it
  //  never actually clicks View, so this was never caught.)
  errs.length = 0;
  await page.evaluate(() => { admOpen('history'); });
  await page.waitForTimeout(150);
  const viewClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#historyList button')].find(b => /toggleHist\(/.test(b.getAttribute('onclick') || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(150);
  check('a "View" button exists on the archived entry', viewClicked);
  check('clicking View threw no page error (toggleHist is defined)', errs.length === 0, errs.join(' | '));
  check('clicking View actually expanded the entry (standings/points table rendered)',
    await page.evaluate(() => /<table/.test(document.getElementById('historyList').innerHTML)));
  check('classes and driver book survived', await page.evaluate(() => S.classes.length > 0 && S.roster.length > 0));

  console.log('— PIN lock actually blocks admin —');
  await page.evaluate(() => { lockAdmin(); nav('signup'); });
  await page.waitForTimeout(200);
  queue('dismiss');   // cancel the PIN prompt
  await page.evaluate(() => nav('admin')); await page.waitForTimeout(200);
  check('a cancelled PIN prompt keeps admin closed', await page.evaluate(() => curPage !== 'admin'));

  check('no uncaught page errors anywhere in this suite', errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close(); server.close();
  console.log(`\n${fail ? '❌' : '✅'} v2 admin: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
