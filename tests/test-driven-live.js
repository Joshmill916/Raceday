// Racing today on Driven (2026-11-17): Driven's side of the RaceDay "liveDriven" rows. Home shows a
// "Racing today" card with each class, every race's starting spot and up next, and a one-tap
// "Open my lineup" link (no QR). Guards: shown only for today, only when the track's own lineup
// data (tracks/<room>/roster) links that card to that driver, for every driver on the phone,
// everything escaped and capped, nothing on a failed read, and the phone layout doesn't overflow.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8883;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const PID = 'prof_driveliv01', KID2 = 'prof_driveliv02';

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u === '/' ? 'driven/index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.html' ? 'text/html' : 'application/octet-stream' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route(/gstatic\.com|firebaseio\.com|cloudflareinsights|script\.google\.com/, r => r.abort());
  await page.goto(`http://localhost:${PORT}/driven/index.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);

  const today = await page.evaluate(() => dvToday());
  const classes = JSON.stringify([
    { c: 'Junior 2', t: '', p: null, r: [
      { l: 'Heat 1', s: 'P2 · Row 1 outside', k: 8, d: 1, f: 3, w: '', now: 0 },
      { l: 'Heat 2', s: 'P5 · Row 3 inside', k: 8, d: 0, f: '', w: 'Up next', now: 0 },
      { l: 'Feature', n: 'Lineup posts once the heats are in' } ] },
    { c: 'Clone Lite', t: '', p: null, r: [{ l: 'Heat 1', s: 'P1 · Row 1 inside', k: 0, d: 0, f: '', w: 'On track now', now: 1 }] }
  ]);
  const row = (o) => Object.assign({ trackName: 'Hogbarn Indoor', date: today, me: 101, name: 'Avery Lane', num: '7', classes, next: 'Clone Lite · Heat 1 — On track now', at: Date.now() - 120000 }, o || {});
  const roster = (pid, id) => JSON.stringify([{ id: id || 101, name: 'Avery Lane', num: '7', profileId: pid }, { id: 102, name: 'Other', num: '1' }]);
  const mock = table => page.evaluate(table => {
    window.__reads = [];
    window.firebase = { apps: [{}], database: () => ({ ref: p => ({ once: () => { __reads.push(p); return Promise.resolve({ val: () => (p in table ? table[p] : null) }); } }) }) };
  }, table);
  const start = (extra) => page.evaluate(([PID, KID2, extra]) => {
    localStorage.clear(); FAM = null; ACCT = null;
    LIVE.rows = []; LIVE.at = 0; LIVE.ok = {}; clearTimeout(LIVE.timer); LIVE.timer = null;
    P = newProfile('Avery Lane', '7', 'Dayton, OH', 12); P.profileId = PID; P.shortCode = 'DRIVELIV'; P.publishedAt = 1;
    localStorage.setItem('profiles_v1', JSON.stringify(P));
    if (extra === 'family') {
      const kid = newProfile('Jordan Lane', '17', 'Dayton, OH', 9); kid.profileId = KID2; kid.publishedAt = 1;
      FAM = { order: [PID, KID2], stash: { [KID2]: { p: kid, acct: null } } };
    }
    if (extra === 'unpublished') P.publishedAt = 0;
    nav('home');
  }, [PID, KID2, extra || '']);
  const pull = () => page.evaluate(() => pullLive().then(() => { nav('home'); return document.getElementById('liveToday').innerText; }));

  console.log('\n=== The driver signed in at the track ===');
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row() }, 'tracks/ROOM1/roster': roster(PID) });
  let t = await pull();
  check('Home shows "Racing today" with the track', /Racing today/i.test(t) && /Hogbarn Indoor/i.test(t), t);
  check('…what\'s next', /Next: Clone Lite · Heat 1 — On track now/.test(t), t);
  check('…every class, with each race\'s starting spot (version 2)', /Junior 2/.test(t) && /Start P5 · Row 3 inside · 8 laps/.test(t) && /Start P1 · Row 1 inside/.test(t), t);
  check('…finished, up next and on track', /Finished P3/.test(t) && /Up next/.test(t) && /On track now/.test(t), t);
  check('…and the feature note until the lineup posts', /Lineup posts once the heats are in/.test(t));
  const href = await page.evaluate(() => (document.querySelector('#liveToday a.live-go') || {}).href);
  check('"Open my lineup" opens their own lineup, no QR (version 1)', href === 'https://victoryraceday.com/raceday2/?sync=ROOM1&role=viewer&me=101', href);
  check('it says when the track last updated it', /updated 2 min ago/.test(t), t);
  check('it keeps itself current while it\'s showing', await page.evaluate(() => !!LIVE.timer));
  check('a one-driver phone doesn\'t repeat the driver\'s name', !/Avery Lane at/i.test(t));
  check('no sideways scrolling on a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

  console.log('\n=== Only real, today, this driver ===');
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row() }, 'tracks/ROOM1/roster': roster('prof_someoneelse') });
  t = await pull();
  check('not shown when the track\'s lineup has that driver on a different card', t.trim() === '', t);
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row({ me: 102 }) }, 'tracks/ROOM1/roster': roster(PID) });
  t = await pull();
  check('not shown when it points at a different driver in that lineup', t.trim() === '', t);
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row({ date: '2026-01-01' }) }, 'tracks/ROOM1/roster': roster(PID) });
  t = await pull();
  check('a race from another day isn\'t shown', t.trim() === '', t);
  check('…and nothing keeps polling', await page.evaluate(() => !LIVE.timer));
  await start();
  await mock({ ['liveDriven/' + PID]: { 'room/../x': row() }, 'tracks/ROOM1/roster': roster(PID) });
  t = await pull();
  check('a malformed room is ignored', t.trim() === '', t);
  await start();
  await page.evaluate(() => { window.firebase = { apps: [{}], database: () => ({ ref: () => ({ once: () => Promise.reject(new Error('offline')) }) }) }; });
  t = await pull();
  check('offline: nothing shown, no error', t.trim() === '');
  await start('unpublished');
  await mock({ ['liveDriven/' + PID]: { ROOM1: row() }, 'tracks/ROOM1/roster': roster(PID) });
  t = await pull();
  check('an unpublished card (can\'t be linked yet) isn\'t looked up', t.trim() === '' && !(await page.evaluate(() => __reads.length)));

  console.log('\n=== Nothing from the track can break the page ===');
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row({ trackName: '<img src=x onerror="window.__xss=1">', next: '<b>bold</b>',
    classes: JSON.stringify([{ c: '<script>window.__xss=2</script>', r: [{ l: 'H', s: '"><img src=x onerror="window.__xss=3">', w: 'x'.repeat(500) }] }]) }) }, 'tracks/ROOM1/roster': roster(PID) });
  t = await pull();
  await page.waitForTimeout(200);
  check('text from the track is shown as text, never run', !(await page.evaluate(() => window.__xss)) && !(await page.evaluate(() => document.querySelector('#liveToday img, #liveToday script, #liveToday b:not(.live-cn b)'))) && /<img src=x/.test(t), t.slice(0, 200));
  check('long text is cut short', !/x{31}/.test(t));
  check('still no sideways scrolling', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

  console.log('\n=== Several drivers on one phone ===');
  await start('family');
  await mock({ ['liveDriven/' + PID]: { ROOM1: row() }, ['liveDriven/' + KID2]: { ROOM1: row({ me: 102, name: 'Jordan Lane', next: 'Junior 1 · Heat 2 — Up next' }) },
    'tracks/ROOM1/roster': JSON.stringify([{ id: 101, name: 'Avery Lane', profileId: PID }, { id: 102, name: 'Jordan Lane', profileId: KID2 }]) });
  t = await pull();
  check('each driver on the phone gets their own card, named', /Avery Lane at Hogbarn/i.test(t) && /Jordan Lane at Hogbarn/i.test(t), t);
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('#liveToday a.live-go')).map(a => a.href));
  check('…each with their own lineup link', hrefs.length === 2 && hrefs.some(h => /me=101$/.test(h)) && hrefs.some(h => /me=102$/.test(h)), JSON.stringify(hrefs));

  console.log('\n=== Refresh ===');
  await start();
  await mock({ ['liveDriven/' + PID]: { ROOM1: row() }, 'tracks/ROOM1/roster': roster(PID) });
  await page.evaluate(() => pullLive());
  const reads1 = await page.evaluate(() => __reads.filter(r => /roster/.test(r)).length);
  await page.evaluate(() => pullLive());
  const reads2 = await page.evaluate(() => __reads.filter(r => /roster/.test(r)).length);
  check('the lineup check is done once, not on every refresh', reads1 === 1 && reads2 === 1, reads1 + ' / ' + reads2);
  await page.evaluate(() => { LIVE.at = Date.now(); window.__reads = []; autoLive(); });
  check('coming back to the app within 20 s doesn\'t read again', await page.evaluate(() => __reads.length === 0));

  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
