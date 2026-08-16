// v2 race-night core: sign-up in one screen, lineups, and the three scoring modes.
//
// The load-bearing claim of the scoring redesign is that tap-order and number-pad
// entry are just faster front-ends over the SAME saveResult() — so this suite scores
// the identical race three different ways and asserts the stored heatResults are
// byte-identical each time. If they ever diverge, standings, transfers, the feature
// grid and the season points all diverge with them.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8812;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const TYPES = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.webmanifest':'application/manifest+json' };

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
  page.on('dialog', d => d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // A track with one 8-car class, one heat set, no B-main — small enough to score by
  // hand three times, big enough to exercise transfers-free feature entry. A fresh
  // profile auto-opens the setup wizard (empty S.track.name); close it before
  // overwriting the state it was offering to fill in.
  await page.evaluate(() => {
    closeSheet();
    S.track.name = 'Tap Test Speedway';
    S.classes = [{ id: 1, name: 'Junior 80cc', maxPill: 40, heats: 1, invert: 0, invertScope: 'field' }];
    S.settings.maxHeat = 10; S.settings.maxFeature = 20; S.settings.requireConsent = false;
    S.roster = []; S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    save(); renderAll();
  });

  // ------------------------------------------------------------------ sign-up
  console.log('— Sign-up: one screen —');
  await page.evaluate(() => nav('signup')); await page.waitForTimeout(250);
  const drivers = [['Alex Smith','47'],['Sam Jones','12'],['Mike Chen','88'],['Donna Lee','5'],
                   ['Ryan Park','33'],['Tina Fox','21'],['Cal Reyes','9'],['Jo Webb','64']];
  for (const [name, num] of drivers) {
    await page.fill('#dName', name);
    await page.fill('#dNum', num);
    await page.click('#ch1');
    await page.click('#drawBtn');
    await page.waitForTimeout(150);
    await page.click('button:has-text("next driver")');
    await page.waitForTimeout(120);
  }
  check('8 drivers registered from one screen', await page.evaluate(() => S.raceDay.entries.length === 8),
    await page.evaluate(() => String(S.raceDay.entries.length)));
  check('driver book built', await page.evaluate(() => S.roster.length === 8));
  check('pills are unique in the class', await page.evaluate(() => {
    const seen = {}; return S.raceDay.entries.every(e => { if (seen[e.pill]) return false; seen[e.pill] = 1; return true; });
  }));

  console.log('— Returning driver on a later night: tap the name, classes come with it —');
  // Archive tonight and clear the board, so the next sign-up is a genuine returning
  // driver whose class has to be recovered from history, not from the live board.
  await page.evaluate(() => {
    archiveDay();
    S.raceDay = { date: today(), entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    save(); nav('signup');
  });
  await page.waitForTimeout(300);
  check('the night archived to history', await page.evaluate(() => S.history.length === 1));
  await page.fill('#dName', 'Alex');
  await page.waitForTimeout(200);
  await page.click('#suggBox button');
  await page.waitForTimeout(250);
  check('tapping the suggestion fills the number',
    (await page.inputValue('#dNum')) === '47', await page.inputValue('#dNum'));
  check('tapping the suggestion pre-ticks the class they ran last time',
    await page.evaluate(() => document.getElementById('ch1').classList.contains('on')));
  await page.click('#drawBtn'); await page.waitForTimeout(250);
  check('a returning driver signs up without a merge prompt (an explicit pick is trusted)',
    await page.evaluate(() => S.roster.length === 8 && S.raceDay.entries.length === 1),
    await page.evaluate(() => S.roster.length + '/' + S.raceDay.entries.length));
  await page.click('button:has-text("next driver")'); await page.waitForTimeout(150);

  // Put the rest of the field back for the scoring section.
  await page.evaluate(() => {
    S.roster.forEach(d => {
      if (!S.raceDay.entries.some(e => e.driverId === d.id))
        S.raceDay.entries.push({ driverId: d.id, classId: 1, pill: drawPill(1) });
    });
    save(); renderAll();
  });
  await page.waitForTimeout(200);
  check('the full field is back on the board', await page.evaluate(() => S.raceDay.entries.length === 8));

  console.log('— Sign-up guards still hold —');
  await page.fill('#dName', 'Brand New'); await page.fill('#dNum', '47');
  await page.click('#ch1'); await page.click('#drawBtn'); await page.waitForTimeout(200);
  check('a duplicate car number in the same class is refused',
    await page.evaluate(() => S.raceDay.entries.length === 8 && document.getElementById('e2').style.display !== 'none'));
  await page.fill('#dNum', '99!');
  await page.click('#drawBtn'); await page.waitForTimeout(200);
  check('an illegal vehicle number is refused',
    (await page.textContent('#e1')).includes('1–5 letters or numbers'));
  await page.evaluate(() => resetReg()); await page.waitForTimeout(150);

  // ------------------------------------------------------------------ lineups
  console.log('— Lineups —');
  await page.evaluate(() => nav('grid')); await page.waitForTimeout(300);
  check('the class posts its grid', (await page.textContent('#gridWrap')).includes('Junior 80cc'));
  check('8 starting slots are drawn', (await page.$$('#gridWrap .slot')).length >= 8);
  check('the pole slot is marked', (await page.$$('#gridWrap .slot.pole')).length >= 1);
  check('single-file toggle re-renders', await page.evaluate(() => {
    setGridStyle('single'); const n = document.querySelectorAll('#gridWrap .grid1').length;
    setGridStyle('double'); return n >= 1;
  }));
  await page.click('#gridWrap .slot .who'); await page.waitForTimeout(250);
  check('tapping a driver opens their card', await page.evaluate(() => document.getElementById('sheetHost').classList.contains('on')));
  check('the card shows career stats', (await page.textContent('#sheetBody')).includes('Starts'));
  await page.evaluate(() => closeSheet()); await page.waitForTimeout(150);

  // ------------------------------------------------------- three scoring modes
  console.log('— Scoring: three modes, one result —');
  // Score the heat + feature in a fixed finishing order, in each mode, and compare.
  const order = await page.evaluate(() => heatSet(classRacers(1), classById(1))[0].map(r => ({ id: r.id, num: r.num })));

  const scoreWithSelect = async () => {
    await page.evaluate(o => {
      o.forEach((d, i) => saveResult(1, 'h1_' + d.id, String(i + 1)));
      featureData(1); const fd = featureData(1);
      [...fd.locked, ...fd.transferred].forEach((r, i) => saveResult(1, 'ft_' + r.id, String(i + 1)));
    }, order);
  };
  const clearAll = async () => {
    await page.evaluate(() => { S.raceDay.heatResults = {}; save(); renderResults(); });
    await page.waitForTimeout(150);
  };

  await page.evaluate(() => nav('results')); await page.waitForTimeout(300);
  await clearAll();
  await scoreWithSelect();
  await page.waitForTimeout(200);
  const viaSelect = await page.evaluate(() => JSON.stringify(S.raceDay.heatResults));
  check('dropdown mode scored the race', Object.keys(JSON.parse(viaSelect).cls1 || {}).length >= 8);

  // Tap mode: click the cars in finishing order.
  await clearAll();
  await page.evaluate(() => setScoreMode('tap')); await page.waitForTimeout(250);
  check('tap mode renders tap cards', (await page.$$('#resBody .tapcard')).length >= 8);
  for (const d of order) {
    await page.click(`#resBody .tapcard:has-text("${d.num}") >> nth=0`);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);
  // Feature group is the last block; score it in the same order.
  await page.evaluate(o => {
    const fd = featureData(1);
    const field = [...fd.locked, ...fd.transferred];
    // Same finishing order as the heat, expressed over the feature field.
    const rank = {}; o.forEach((d, i) => rank[d.id] = i);
    [...field].sort((a, b) => rank[a.id] - rank[b.id]).forEach((r, i) => saveResult(1, 'ft_' + r.id, String(i + 1)));
  }, order);
  await page.waitForTimeout(200);
  const viaTap = await page.evaluate(() => JSON.stringify(S.raceDay.heatResults));
  check('TAP-ORDER produces byte-identical results to dropdowns', viaTap === viaSelect,
    'tap=' + viaTap.slice(0, 120) + ' sel=' + viaSelect.slice(0, 120));

  // Number-pad mode: type each car number in finishing order.
  await clearAll();
  await page.evaluate(() => setScoreMode('pad')); await page.waitForTimeout(250);
  check('pad mode renders a number input', (await page.$$('#resBody input[id^="pad_"]')).length >= 1);
  const padId = await page.evaluate(() => document.querySelector('#resBody input[id^="pad_"]').id);
  for (const d of order) {
    await page.fill('#' + padId, String(d.num));
    await page.press('#' + padId, 'Enter');
    await page.waitForTimeout(70);
  }
  await page.evaluate(o => {
    const fd = featureData(1);
    const rank = {}; o.forEach((d, i) => rank[d.id] = i);
    [...fd.locked, ...fd.transferred].sort((a, b) => rank[a.id] - rank[b.id]).forEach((r, i) => saveResult(1, 'ft_' + r.id, String(i + 1)));
  }, order);
  await page.waitForTimeout(200);
  const viaPad = await page.evaluate(() => JSON.stringify(S.raceDay.heatResults));
  check('NUMBER-PAD produces byte-identical results to dropdowns', viaPad === viaSelect,
    'pad=' + viaPad.slice(0, 120));

  console.log('— Tap-mode affordances —');
  await page.evaluate(() => setScoreMode('tap')); await page.waitForTimeout(200);
  const before = await page.evaluate(() => Object.keys(getRes(1)).length);
  await page.evaluate(() => scoreUndo('h1_0')); await page.waitForTimeout(200);
  check('undo removes the last-placed car', await page.evaluate(b => Object.keys(getRes(1)).length === b - 1, before));
  await page.evaluate(() => { const g = _scoreGroups['h1_0']; scoreTap('h1_0', g.drivers[0].id); }); await page.waitForTimeout(200);
  check('tapping an already-placed car clears it (one tap to fix a slip)',
    await page.evaluate(() => { const g = _scoreGroups['h1_0']; return getRes(1)[g.prefix(g.drivers[0].id)] == null; }));
  await page.evaluate(() => { const g = _scoreGroups['h1_0']; saveResult(1, g.prefix(g.drivers[0].id), 'DNF'); }); await page.waitForTimeout(200);
  check('DNF is stored as a flag, not a position',
    await page.evaluate(() => { const g = _scoreGroups['h1_0']; return getRes(1)[g.prefix(g.drivers[0].id)] === 'DNF'; }));
  check('a DNF does not consume a finishing position',
    await page.evaluate(() => scoreNextPos(_scoreGroups['h1_0']) === 1));

  console.log('— Locking still blocks every mode —');
  await page.evaluate(() => { S.raceDay.resultGov = {}; setResStatus(1, 'official'); toggleResLock(1); }); await page.waitForTimeout(250);
  const lockedBefore = await page.evaluate(() => JSON.stringify(getRes(1)));
  await page.evaluate(() => { const g = _scoreGroups['ft']; if (g) scoreTap('ft', g.drivers[0].id); }); await page.waitForTimeout(200);
  check('a locked class refuses a tap-mode write',
    await page.evaluate(b => JSON.stringify(getRes(1)) === b, lockedBefore));
  check('the lock is recorded in the audit log',
    await page.evaluate(() => S.audit.some(a => /lock/i.test(a.action))));

  // ------------------------------------------------------------------- points
  console.log('— Points —');
  await page.evaluate(() => { S.raceDay.resultGov = {}; resOverride = {}; S.raceDay.heatResults = {}; save(); });
  await scoreWithSelect();
  await page.evaluate(() => { nav('points'); }); await page.waitForTimeout(300);
  check('the standings table renders', (await page.$$('#pointsWrap table.tbl tbody tr')).length >= 8);
  check('the winner leads the table', await page.evaluate(() => {
    const rows = seriesStandings(UI.ptsTab);
    return rows.length > 1 && rows[0].pts >= rows[1].pts;
  }));
  check('tonight is flagged as counting', (await page.textContent('#pointsWrap')).includes('Tonight'));

  check('no uncaught page errors anywhere in this suite', errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close(); server.close();
  console.log(`\n${fail ? '❌' : '✅'} v2 scoring: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
