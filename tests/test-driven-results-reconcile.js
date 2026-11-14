// Driven keeps what the track says (2026-11-14). It used to only ADD RaceDay results, so a night
// shared to the wrong driver's card stayed on that phone forever, and a corrected finish never
// updated. Guards: pullRaceDayResults() updates a changed position/points, removes a 'raceday'
// result the track took back (row now on another card, or the night removed), never touches
// results from other sources, and never removes anything when the track's results read back empty.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8881;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const PID = 'prof_reconcile01', OTHER = 'prof_someoneelse1', T = 'trk_test01';

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u === '/' ? 'driven/index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.html' ? 'text/html' : 'application/octet-stream' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await browser0();
  async function browser0() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);
  const mock = table => page.evaluate(table => {
    window.firebase = { apps: [{}], database: () => ({ ref: p => ({ once: () => Promise.resolve({ val: () => (p in table ? table[p] : null) }), set: () => Promise.resolve(), remove: () => Promise.resolve() }) }) };
    window.firebase.database.ServerValue = { TIMESTAMP: 'TS' };
  }, table);
  const start = () => page.evaluate(([pid, T]) => {
    localStorage.clear();
    P = newProfile('Robin Park', '', 'Dayton, OH', 15); P.profileId = pid; P.shortCode = 'RECONCIL'; P.publishedAt = 1;
    P.raceResults = [
      { date: '2026-11-01', trackId: T, trackName: 'Test Track', class: 'Junior', position: 3, points: 8, source: 'raceday', verifiedBy: null },
      { date: '2026-11-08', trackId: T, trackName: 'Test Track', class: 'Junior', position: 1, points: 10, source: 'raceday', verifiedBy: null },
      { date: '2026-10-01', trackId: T, trackName: 'Test Track', class: 'Junior', position: 2, points: null, source: 'manual' }
    ];
    localStorage.setItem('profiles_v1', JSON.stringify(P));
  }, [PID, T]);
  const row = (pid, pos, pts) => ({ profileId: pid, name: 'x', num: '9', position: pos, points: pts, trackName: 'Test Track' });
  const res = () => page.evaluate(() => P.raceResults.map(x => x.date + ':' + x.source + ':' + x.position + ':' + x.points).sort());

  console.log('\n=== Corrections from the track ===');
  await start();
  await mock({ ['profileTracks/' + PID]: { [T]: { trackName: 'Test Track' } }, ['results/' + T]: {
    '2026-11-01': { Junior: { d1: row(PID, 2, 9) } },              // finish corrected 3 → 2
    '2026-11-08': { Junior: { d1: row(OTHER, 1, 10) } }            // shared to the wrong card, now moved to the right one
  } });
  await page.evaluate(() => pullRaceDayResults());
  let r = await res();
  check('a corrected finish and points update on the phone', r.includes('2026-11-01:raceday:2:9'), JSON.stringify(r));
  check('a result moved to another driver\'s card is removed', !r.some(x => x.startsWith('2026-11-08')), JSON.stringify(r));
  check('results from other sources are never touched', r.includes('2026-10-01:manual:2:null'), JSON.stringify(r));
  check('…and the change is saved on the phone', await page.evaluate(() => JSON.parse(localStorage.getItem('profiles_v1')).raceResults.length === 2));

  console.log('\n=== A night taken back ===');
  await start();
  await mock({ ['profileTracks/' + PID]: { [T]: { trackName: 'Test Track' } }, ['results/' + T]: {
    '2026-11-01': { Junior: { d1: row(PID, 3, 8) } }               // 11-08 removed by the track
  } });
  await page.evaluate(() => pullRaceDayResults());
  r = await res();
  check('a night the track took back is removed', !r.some(x => x.startsWith('2026-11-08')) && r.includes('2026-11-01:raceday:3:8'), JSON.stringify(r));

  console.log('\n=== Never remove on an empty or failed read ===');
  await start();
  await mock({ ['profileTracks/' + PID]: { [T]: { trackName: 'Test Track' } }, ['results/' + T]: null });
  await page.evaluate(() => pullRaceDayResults());
  r = await res();
  check('an empty read removes nothing', r.length === 3, JSON.stringify(r));
  await start();
  await page.evaluate(() => { window.firebase = { apps: [{}], database: () => ({ ref: p => ({ once: () => /^results/.test(p) ? Promise.reject(new Error('offline')) : Promise.resolve({ val: () => ({ trk_test01: { trackName: 'T' } }) }) }) }) }; });
  await page.evaluate(() => pullRaceDayResults().catch(() => {}));
  check('a failed read removes nothing', (await res()).length === 3);

  console.log('\n=== New results still arrive ===');
  await start();
  await mock({ ['profileTracks/' + PID]: { [T]: { trackName: 'Test Track' } }, ['results/' + T]: {
    '2026-11-01': { Junior: { d1: row(PID, 3, 8) } }, '2026-11-08': { Junior: { d1: row(PID, 1, 10) } }, '2026-11-15': { Junior: { d1: row(PID, 4, 7) } }
  } });
  const added = await page.evaluate(() => pullRaceDayResults());
  r = await res();
  check('a new night is added, the others unchanged', added === 1 && r.length === 4 && r.includes('2026-11-15:raceday:4:7') && r.includes('2026-11-08:raceday:1:10'), JSON.stringify([added, r]));

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n✅ driven-results-reconcile: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
