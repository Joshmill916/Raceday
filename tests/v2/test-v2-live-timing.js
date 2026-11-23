// Live running order from Westhold Race Manager (2026-11-22). Race Manager rewrites racedata.xml
// (Setup → Web Data) on every crossing. The staff computer watching the timing folder sends the
// running order to liveTiming/<room>; following phones show it on the fan view and Results.
// Guards: the rule (public read, only the room's staff write, capped fields); a running file is
// sent, an unchanged one is not sent again, a half-written one is skipped; a running racedata.xml
// never starves the results file saved beside it; never sent from a viewer or a demo; phones show
// LIVE with the flag, lap and order, FINAL after Stop, nothing once it goes quiet; what arrives is
// escaped and size-capped; nothing is imported from a running file.
// Fixtures: test-data/westhold-xml/ (Westhold's Demo-mode files, made-up racers).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8896;
const FIX = path.join(ROOT, 'test-data', 'westhold-xml');
const read = f => fs.readFileSync(path.join(FIX, f), 'latin1');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const RACERS = read('DEMO.CSV').trim().split(/\r?\n/).map(l => { const c = l.split(','); return { trans: c[0], num: c[1], last: c[2], first: c[3] }; });

(async () => {
  console.log('\n=== Database rule ===');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  const L = rules.liveTiming && rules.liveTiming.$room;
  check('liveTiming exists and anyone can read it', !!L && L['.read'] === true);
  check('only staff registered in that room can write it', L && L['.write'] === "auth != null && root.child('trackStaff').child($room).child(auth.uid).exists()");
  check('every field is capped and nothing else can be stored', L && L.$other['.validate'] === false && /<= 9000/.test(L.rows['.validate'])
    && /<= 60/.test(L.cls['.validate']) && /<= 20/.test(L.flag['.validate']) && /isNumber/.test(L.at['.validate']));

  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await ctx.addInitScript(() => {
    window.__fs = {};
    const dir = { kind: 'directory', name: 'UploadXML', requestPermission: async () => 'granted', queryPermission: async () => 'granted',
      entries: async function* () {
        for (const [n, f] of Object.entries(window.__fs)) yield [n, { kind: 'file', getFile: async () => ({ lastModified: f.mtime, text: async () => f.text }) }];
      } };
    window.showDirectoryPicker = async () => dir;
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/raceday2/`); await p.waitForTimeout(800);

  await p.evaluate(racers => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    S.track.name = 'Live Speedway'; S.classes = [{ id: 1, name: 'Demo', maxPill: 200, heats: 1 }];
    S.roster = racers.map((r, i) => ({ id: 100 + i, name: r.first + ' ' + r.last, num: r.num, trans: r.trans }));
    S.raceDay = { date: today(), entries: racers.map((r, i) => ({ driverId: 100 + i, classId: 1, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    S.settings.timingSource = 'folder'; S.sync = { enabled: true, key: 'ROOM1', staffKey: '' }; S.demo = false;
    localStorage.removeItem('rd_imp_done'); save();
    // Firebase stand-in: liveTiming writes follow the rule (staff of that room only).
    window.__db = { 'trackStaff/ROOM1/uidStaff': 'k' }; window.__uid = 'uidStaff'; window.__writes = [];
    const allowed = pth => { const m = pth.match(/^liveTiming\/([A-Z0-9]+)$/); return !!m && ('trackStaff/' + m[1] + '/' + window.__uid) in window.__db; };
    window.firebase = { apps: [1], database: () => ({ ref: pth => ({
      set: v => { if (!allowed(pth)) return Promise.reject(Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })); __writes.push([pth, JSON.parse(JSON.stringify(v))]); return Promise.resolve(); },
      update: () => Promise.resolve(), once: () => Promise.resolve({ val: () => null }), on: () => {}, off: () => {}
    }) }) };
    Staff.ok = true;
  }, RACERS);

  const drop = (name, text, ago) => p.evaluate(([n, t, a]) => { window.__fs[n] = { text: t, mtime: Date.now() - a }; }, [name, text, ago || 0]);
  const writes = () => p.evaluate(() => __writes.filter(w => w[0] === 'liveTiming/ROOM1'));
  const scan = () => p.evaluate(async () => { await impScanFolder(); });

  console.log('\n=== The timing computer sends the running order ===');
  await p.evaluate(async () => { TimingDir.handle = await window.showDirectoryPicker(); openImport('heat'); await impStartWatch(); });
  await p.waitForTimeout(300);
  check('the watch card tells Westhold users how to turn it on', await p.evaluate(() => /Web Data/.test(document.getElementById('impWatchCard').textContent)));
  await drop('racedata.xml', read('racedata - lap 5.xml'), 200);   // rewritten 0.2 s ago: no settle wait for the live file
  await scan();
  let w = await writes();
  check('a running race is sent straight away', w.length === 1, JSON.stringify(w).slice(0, 200));
  const v = w[0] ? w[0][1] : {};
  const rows = JSON.parse(v.rows || '[]');
  check('it carries the flag, the lap and the class', v.flag === 'Green' && v.lap === '5' && v.cls === 'DEMO' && v.mode === 'RACE' && typeof v.at === 'number', JSON.stringify(v).slice(0, 200));
  check('…and every car in running order: spot, number, name, laps, last, best', rows.length === 10 && JSON.stringify(rows[0].slice(0, 6)) === '["1","3","Cathy Three","5","05.279","05.279"]', JSON.stringify(rows[0]));
  check('the payload fits the rule', v.rows.length <= 9000 && v.cls.length <= 60);
  check('nothing was imported from a running race', await p.evaluate(() => !Object.keys(S.raceDay.heatResults).length || !Object.keys(S.raceDay.heatResults[resKey(1)] || {}).length));
  await scan();
  check('the same file is not sent again', (await writes()).length === 1);
  await drop('racedata.xml', read('racedata - lap 5.xml').replace('<LAP>5</LAP>', '<LAP>6</LAP>'), 100);
  await scan();
  check('the next lap is sent', (await writes()).length === 2 && (await writes())[1][1].lap === '6');
  await drop('racedata.xml', read('racedata - lap 5.xml').replace('<LAP>5</LAP>', '<LAP>7</LAP>').replace(/<\/RACEDATA>\s*$/, ''), 50);
  await scan();
  check('a file caught half-written is skipped', (await writes()).length === 2);

  console.log('\n=== A results file saved beside a live race still imports ===');
  await drop('racedata.xml', read('racedata - lap 5.xml').replace('<LAP>5</LAP>', '<LAP>8</LAP>'), 0);
  await drop('DEMO.xml', read('DEMO.xml'), 2000);
  await scan();
  await p.waitForTimeout(300);
  check('the results file loads even though racedata.xml is newer', await p.evaluate(() => Imp && /DEMO/.test(Imp.lastFile || '')), await p.evaluate(() => Imp && Imp.lastFile));

  console.log('\n=== Stop ===');
  await drop('racedata.xml', read('racedata - stopped.xml'), 2000);
  await scan();
  w = await writes();
  check('the stopped order is sent with flag Stop', /^stop/i.test(w[w.length - 1][1].flag), w[w.length - 1][1].flag);

  console.log('\n=== Never sent from the wrong device ===');
  for (const [label, fn] of [['a spectator', () => { localStorage.setItem('rd_role_v2', 'viewer'); }], ['the demo', () => { S.demo = true; }]]) {
    await p.evaluate(fn);
    const before = (await writes()).length;
    await p.evaluate(() => { LiveTiming.sent = ''; liveTimingPush(impXmlToCsv(window.__fs['racedata.xml'].text.replace('<LAP>', '<LAP>9'))); });
    check(label + ' sends nothing', (await writes()).length === before);
    await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); S.demo = false; });
  }

  console.log('\n=== A phone following the track ===');
  const f = await browser.newPage({ viewport: { width: 375, height: 800 } });
  f.on('pageerror', e => errs.push(e.message));
  await f.route(/^(?!http:\/\/localhost)/, r => r.abort());
  await f.goto(`http://localhost:${PORT}/raceday2/`); await f.waitForTimeout(800);
  const live = (await writes())[1][1];
  await f.evaluate(() => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'viewer'); setDeviceRole('viewer'); applyRole();
    S.classes = [{ id: 1, name: 'Demo', maxPill: 200, heats: 1 }]; S.roster = [{ id: 100, name: 'Adam One', num: '1' }];
    S.raceDay = { date: today(), entries: [{ driverId: 100, classId: 1, pill: 1 }], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    S.sync = { enabled: true, key: 'ROOM1' }; nav('grid');
  });
  const show = (data) => f.evaluate(d => { LiveTiming.data = liveClean(d); liveTimingRefresh(); return (document.getElementById('liveTiming') || {}).innerText || ''; }, data);
  let t = await show(Object.assign({}, live, { at: Date.now() }));
  check('Lineups shows LIVE, the class, the flag and the lap', /LIVE/.test(t) && /DEMO/.test(t) && /Green/i.test(t) && /Lap 6/.test(t), t.slice(0, 200));
  check('…and the running order', /Cathy Three/.test(t) && t.indexOf('Cathy Three') < t.indexOf('Denny Four'));
  check('…marked not official', /Not official until posted/.test(t));
  check('the fastest lap is marked', await f.evaluate(() => !!document.querySelector('#liveTiming .live-best')));
  check('no sideways scrolling on a phone', !(await f.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  t = await show(Object.assign({}, live, { at: Date.now() - 3 * 60000 }));
  check('a race that went quiet for 3 minutes is hidden', t.trim() === '', t.slice(0, 80));
  t = await show(Object.assign({}, live, { flag: 'Stop', at: Date.now() - 60000 }));
  check('after Stop it says FINAL, results coming', /FINAL/.test(t) && /official results coming/.test(t), t.slice(0, 120));
  t = await show(Object.assign({}, live, { flag: 'Stop', at: Date.now() - 11 * 60000 }));
  check('…and is gone 10 minutes later', t.trim() === '');
  await show({ at: Date.now(), flag: 'Green<img src=x onerror=window.__x=1>', cls: '<b>x</b>', rows: JSON.stringify([['1', '<script>', '<img src=x onerror=window.__x=1>', '1', '1', '1', '0']]) });
  check('what arrives is escaped, never run', await f.evaluate(() => !window.__x && !document.querySelector('#liveTiming img, #liveTiming script')));
  t = await show({ at: Date.now(), flag: 'Green', rows: JSON.stringify(Array.from({ length: 500 }, (_, i) => [String(i + 1), '1', 'x'.repeat(200), '1', '1', '1', '0'])) });
  check('a huge or bad payload is capped', await f.evaluate(() => document.querySelectorAll('#liveTiming .live-row').length === 61 && LiveTiming.data.rows[0][2].length <= 40));
  check('junk is ignored', await f.evaluate(() => liveClean('nope') === null && liveClean({ at: 'x' }) === null && liveClean({ at: 1, rows: '{bad' }).rows.length === 0));
  await f.evaluate(() => nav('results'));
  await show(Object.assign({}, live, { at: Date.now() }));
  check('the viewer Results page shows it too', /LIVE/.test(await f.evaluate(() => (document.getElementById('liveTiming') || {}).innerText || '')));

  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
