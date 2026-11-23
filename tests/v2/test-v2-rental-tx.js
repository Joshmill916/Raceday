// Rental transponders (2026-11-23). Some tracks hand out their own tags every night, so last week's
// tag is on someone else this week. Before this, the importer matched transponder-first and put every
// result on last week's renter as a clean match. Uses the real Race Manager feature file in
// test-data/westhold-xml/ (names replaced), with its nameless 9th car taken out.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8893;
const FILE = 'Session 360 CLONE Feature.xml';
const XML = fs.readFileSync(path.join(ROOT, 'test-data', 'westhold-xml', FILE), 'latin1')
  .replace(/<CAR>\s*<POSITION>9<\/POSITION>[\s\S]*?<\/CAR>/, '');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
// name, number, tag in tonight's file
const CARS = [['Adam One', '21', '79703'], ['Bob Two', '11', '9622'], ['Carl Three', '1', '9049'], ['Dan Four', '121', '16280'],
  ['Eric Five', '85L', '62164'], ['Fred Six', '2e', '29464'], ['Greg Seven', '17D', '79864'], ['Hank Eight', '2m', '31437']];

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await p.goto(`http://localhost:${PORT}/raceday2/index.html`); await p.waitForTimeout(600);

  // Last week everyone rented a different tag: the book holds each driver's tag rotated by one.
  const setup = rented => p.evaluate(([cars, rented]) => {
    S.classes = [{ id: 3, name: '360 Clone', maxPill: 200, heats: 1 }];
    S.roster = cars.map((c, i) => ({ id: 300 + i, name: c[0], num: c[1], trans: cars[(i + 1) % cars.length][2] }));
    S.raceDay = { date: today(), entries: cars.map((c, i) => ({ driverId: 300 + i, classId: 3, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    S.settings.txRented = rented; save(); setDeviceRole('admin'); applyRole();
    try { localStorage.removeItem('rd_imp_done'); } catch (e) {}
  }, [CARS, rented]);
  const load = (text, auto) => p.evaluate(([text, auto, file]) => {
    try { closeImport(); } catch (e) {}
    openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === 'h1')); Imp.watchAuto = !!auto;
    impIngestText(text, file, !!auto);
    return impPreview.map(r => ({ file: r.name, to: r.driver && r.driver.name, st: r.status, note: r.note || '' }));
  }, [text, auto, FILE]);
  const finishes = () => p.evaluate(() => { const r = getRes(3); return S.roster.map(d => [d.name, r['h1_' + d.id]]); });
  const allRight = rows => rows.length === 8 && rows.every(r => r.file === r.to);

  console.log('\n=== Track owns tags (setting off), tags shuffled ===');
  await setup(false);
  let rows = await load(XML, true);
  check('every row goes to the driver the file names (number + name), not last week\'s renter', allRight(rows), JSON.stringify(rows));
  check('each is flagged to check, naming whose tag it was and pointing at the setting', rows.every(r => r.st === 'conflict' && /is saved on/.test(r.note) && /Race format/.test(r.note)), JSON.stringify(rows.map(r => r.note)));
  check('the watched folder does not auto-import them', (await finishes()).every(([, f]) => f == null));
  await p.evaluate(() => impApplyClick());
  const f1 = await finishes();
  check('Import ✓ puts every finish on the right driver (Adam 1st … Hank 8th)', f1.every(([n, f]) => f === CARS.findIndex(c => c[0] === n) + 1), JSON.stringify(f1));

  console.log('\n=== Same, but only the number changed (new kart) ===');
  await setup(false);
  const one = await p.evaluate(t => { S.roster.forEach((d, i) => { d.trans = ['79703', '9622', '9049', '16280', '62164', '29464', '79864', '31437'][i]; }); S.roster[0].num = '99'; save(); return t; }, XML);
  rows = await load(one, false);
  check('a tag whose driver still has the file\'s name stays a transponder match', rows[0].to === 'Adam One' && !/is saved on/.test(rows[0].note), JSON.stringify(rows[0]));

  console.log('\n=== Track rents tags (setting on), tags shuffled ===');
  await setup(true);
  rows = await load(XML, false);
  check('every row matches the right driver, clean, no conflicts', allRight(rows) && rows.every(r => r.st === 'match'), JSON.stringify(rows));
  await load(XML, true);
  const f2 = await finishes();
  check('the watched folder auto-imports it, every finish right', f2.every(([n, f]) => f === CARS.findIndex(c => c[0] === n) + 1), JSON.stringify(f2));
  const tx = await p.evaluate(() => S.raceDay.entries.map(e => [driverById(e.driverId).name, e.tx]));
  check('tonight\'s tag is kept on tonight\'s entries', tx.every(([n, t]) => t === CARS.find(c => c[0] === n)[2]), JSON.stringify(tx));
  check('the driver book is not changed by tonight\'s tags', await p.evaluate(() => S.roster.every((d, i, a) => d.trans === ['9622', '9049', '16280', '62164', '29464', '79864', '31437', '79703'][i])));
  const byTag = await load(XML.replace(/<FIRSTNAME>.*?<\/FIRSTNAME>|<LASTNAME>.*?<\/LASTNAME>|<CARNO>.*?<\/CARNO>/g, ''), false);
  check('a later file tonight with tags only still finds everyone by tonight\'s tag', allRight(byTag.map((r, i) => ({ file: CARS[i][0], to: r.to }))), JSON.stringify(byTag));
  check('last week\'s saved tags raise no "tag on two drivers" warning', await p.evaluate(() => { S.raceDay.entries.forEach(e => delete e.tx); return Object.keys(dupTransTonight()).length === 0; }));
  check('a new driver from a file gets no saved tag', await p.evaluate(t => {
    S.roster = S.roster.filter(d => d.name !== 'Hank Eight'); S.raceDay.entries = S.raceDay.entries.filter(e => driverById(e.driverId)); save();
    try { localStorage.removeItem('rd_imp_done'); } catch (e) {}
    closeImport(); openImport('heat'); impSetStep(impPipeline().findIndex(s => s.key === 'ft')); impIngestText(t, 'x.xml', false); impApplyClick();
    const h = S.roster.find(d => d.name === 'Hank Eight'); return !!h && !h.trans;
  }, XML));

  console.log('\n=== The setting ===');
  await p.evaluate(() => { try { closeImport(); } catch (e) {} S.settings.txRented = false; save(); });
  const ui = await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = timingSourceCard(); document.body.appendChild(box);
    const c = box.querySelector('#txRentedChk'); const had = !!c; c.checked = true; c.dispatchEvent(new Event('change')); box.remove(); return { had, on: S.settings.txRented }; });
  check('Admin → Race format has "The track rents out transponders", and it saves', ui.had && ui.on === true, JSON.stringify(ui));
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== v2-rental-tx: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
