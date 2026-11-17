// Racing today on Driven (2026-11-17): a driver whose Driven card is linked and who is entered
// tonight gets their own night on Driven (classes, starting spots, up next) without scanning the
// lineup QR. RaceDay 2's side: drivenLivePush() writes liveDriven/<profileId>/<room> from a
// registered staff device. Guards: only linked + entered drivers; nothing unchanged is rewritten;
// a driver who leaves tonight is removed; never from a demo, a spectator or an unregistered
// device; the rules only let the room's own staff write, with capped fields; save() never throws
// at boot. Uses an in-page Firebase stand-in that follows the liveDriven rule (trackStaff/<room>/<uid>).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8879;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const PA = 'prof_livea0001', PB = 'prof_liveb0002';

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'text/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  /* ---------------- Database rules ---------------- */
  console.log('\n— Database rules —');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  const L = rules.liveDriven && rules.liveDriven.$profileId;
  check('liveDriven exists and Driven can read it', !!L && L['.read'] === true);
  check('only staff registered in that room can write it',
    L && L.$room['.write'] === "auth != null && root.child('trackStaff').child($room).child(auth.uid).exists()");
  check('the key must be a real profile id and the row needs track, date, driver and time',
    L && /\$profileId\.matches\(/.test(L.$room['.validate']) && /hasChildren\(\['trackName','date','me','at'\]\)/.test(L.$room['.validate']));
  check('every field is capped and nothing else can be stored',
    L && L.$room.$other['.validate'] === false && /<= 4000/.test(L.$room.classes['.validate']) && /<= 60/.test(L.$room.trackName['.validate'])
      && /<= 120/.test(L.$room.next['.validate']) && /<= 40/.test(L.$room.name['.validate']) && /matches/.test(L.$room.date['.validate']));

  /* ---------------- RaceDay 2 posts tonight ---------------- */
  console.log('\n— The track posts each linked driver\'s night —');
  const p = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await p.goto(`http://localhost:${PORT}/raceday2/`); await p.waitForTimeout(600);
  await p.evaluate(([PA, PB]) => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); setDeviceRole('admin'); applyRole();
    localStorage.removeItem('rd_driven_live');
    S.track.name = 'Hogbarn Indoor';
    S.classes = [{ id: 1, name: 'Junior', maxPill: 200, heats: 1 }, { id: 2, name: 'Clone', maxPill: 200, heats: 1 }];
    S.roster = [
      { id: 101, name: 'Avery Lane', num: '7', profileId: PA, profile: { source: 'profiles' } },
      { id: 102, name: 'Blake Ruiz', num: '22', profileId: PB, profile: { source: 'profiles' } },
      { id: 103, name: 'Casey Fox', num: '9' }
    ];
    S.raceDay = { date: today(), entries: [
      { driverId: 101, classId: 1, pill: 1 }, { driverId: 103, classId: 1, pill: 2 }, { driverId: 102, classId: 1, pill: 3 },
      { driverId: 101, classId: 2, pill: 1 }
    ], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    S.sync = { enabled: true, key: 'ROOM1', staffKey: '' };
    S.demo = false;
    // Firebase stand-in: liveDriven writes follow the rule (staff of that room only).
    window.__db = { 'trackStaff/ROOM1/uidStaff': 'k' }; window.__uid = 'uidStaff'; window.__writes = [];
    const allowed = pth => { const m = pth.match(/^liveDriven\/prof_[a-z0-9]{4,40}\/([A-Z0-9]+)$/); return !!m && !!window.__uid && ('trackStaff/' + m[1] + '/' + window.__uid) in window.__db; };
    const denied = () => Promise.reject(Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' }));
    window.firebase = { apps: [1], database: () => ({ ref: pth => ({
      set: v => { if (!allowed(pth)) return denied(); __writes.push(['set', pth, JSON.parse(JSON.stringify(v))]); __db[pth] = v; return Promise.resolve(); },
      remove: () => { if (!allowed(pth)) return denied(); __writes.push(['remove', pth]); delete __db[pth]; return Promise.resolve(); },
      update: () => Promise.resolve(), once: () => Promise.resolve({ val: () => null }), on: () => {}, off: () => {}
    }) }) };
    Staff.ok = true;
  }, [PA, PB]);
  const push = () => p.evaluate(() => { __writes = []; drivenLivePush(); return new Promise(r => setTimeout(r, 50)).then(() => __writes); });

  let w = await push();
  const setA = w.find(x => x[0] === 'set' && x[1] === 'liveDriven/' + PA + '/ROOM1');
  const setB = w.find(x => x[0] === 'set' && x[1] === 'liveDriven/' + PB + '/ROOM1');
  check('both linked drivers entered tonight are posted', !!setA && !!setB, JSON.stringify(w.map(x => x[1])));
  check('a driver without a Driven card is not posted', w.length === 2, JSON.stringify(w.map(x => x[1])));
  const a = setA ? setA[2] : {};
  const today = await p.evaluate(() => today());
  check('the row says which track, which date and which driver', a.trackName === 'Hogbarn Indoor' && a.date === today && a.me === 101 && a.name === 'Avery Lane' && a.num === '7' && typeof a.at === 'number', JSON.stringify(a).slice(0, 200));
  let cls = []; try { cls = JSON.parse(a.classes); } catch (e) {}
  check('every class they entered is there', cls.length === 2 && cls[0].c === 'Junior' && cls[1].c === 'Clone', a.classes);
  const heat = (cls[0] && cls[0].r || []).find(r => /Heat/.test(r.l)) || {};
  check('…with their heat and starting spot (version 2: shown right on Driven)', /^P\d/.test(heat.s || ''), JSON.stringify(cls[0]));
  check('…and on track / up next for races not run yet', typeof heat.w === 'string' && heat.d === 0, JSON.stringify(heat));
  check('the "next" line names their next race', /Junior|Clone/.test(a.next || ''), a.next);
  check('the lineup data that Driven checks against has the same driver and card',
    await p.evaluate(([PA]) => S.roster.some(d => d.id === 101 && d.profileId === PA), [PA]));

  w = await push();
  check('nothing unchanged is written again', w.length === 0, JSON.stringify(w.map(x => x[1])));

  await p.evaluate(() => { S.raceDay.entries.push({ driverId: 102, classId: 2, pill: 2 }); });
  w = await push();
  check('a new entry rewrites only that driver', w.length === 1 && w[0][1] === 'liveDriven/' + PB + '/ROOM1' && /Clone/.test(w[0][2].classes), JSON.stringify(w.map(x => x[1])));

  await p.evaluate(() => { S.raceDay.entries = S.raceDay.entries.filter(e => e.driverId !== 102); });
  w = await push();
  check('a driver who leaves tonight (cancelled) is removed', w.length === 1 && w[0][0] === 'remove' && w[0][1] === 'liveDriven/' + PB + '/ROOM1', JSON.stringify(w));

  await p.evaluate(() => { delete S.roster[0].profileId; });
  w = await push();
  check('unlinking a card removes it too', w.some(x => x[0] === 'remove' && x[1] === 'liveDriven/' + PA + '/ROOM1'), JSON.stringify(w));
  await p.evaluate(([PA]) => { S.roster[0].profileId = PA; S.raceDay.entries.push({ driverId: 102, classId: 1, pill: 3 }); }, [PA]);
  await push();

  console.log('\n— Never from the wrong device —');
  await p.evaluate(() => { localStorage.removeItem('rd_driven_live'); });
  await p.evaluate(() => { Staff.ok = false; });
  w = await push();
  check('a device not signed in as staff posts nothing', w.length === 0);
  await p.evaluate(() => { Staff.ok = true; S.demo = true; });
  w = await push();
  check('the demo posts nothing', w.length === 0);
  await p.evaluate(() => { S.demo = false; setDeviceRole('viewer'); });
  w = await push();
  check('a spectator phone posts nothing', w.length === 0);
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); setDeviceRole('admin'); S.sync.enabled = false; });
  w = await push();
  check('with sync off nothing is posted', w.length === 0);
  await p.evaluate(() => { S.sync.enabled = true; delete __db['trackStaff/ROOM1/uidStaff']; });
  w = await push();
  check('the rules refuse a device that isn\'t this room\'s staff', w.length === 0);
  check('…and it tries again later instead of forgetting', await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('rd_driven_live') || 'null'); return !m || !Object.keys(m.rows || {}).length; }));
  await p.evaluate(() => { __db['trackStaff/ROOM1/uidStaff'] = 'k'; });
  w = await push();
  check('once it is staff, the rows go out', w.length === 2, JSON.stringify(w.map(x => x[1])));

  console.log('\n— Hooked into the night —');
  await p.evaluate(() => { __writes = []; S.raceDay.entries.push({ driverId: 103, classId: 2, pill: 5 }, { driverId: 102, classId: 2, pill: 4 }); save(); });
  await p.waitForTimeout(1900);
  const auto = await p.evaluate(() => __writes.map(x => x[1]));
  check('a sign-up (save) posts on its own a moment later', auto.includes('liveDriven/' + PB + '/ROOM1'), JSON.stringify(auto));

  console.log('\n— Track announcements ride along —');
  await p.evaluate(() => { S.settings.raceNote = { text: 'Rain delay: heats start at 2:00', at: Date.now() }; S.settings.raceNotes = [S.settings.raceNote, { text: 'Drivers meeting at noon', at: Date.now() - 3600000 }]; });
  w = await push();
  const nrow = (w.find(x => x[0] === 'set' && x[1] === 'liveDriven/' + PA + '/ROOM1') || [])[2] || {};
  let nts = {}; try { nts = JSON.parse(nrow.notes); } catch (e) {}
  check('posting a race note rewrites every linked driver\'s row', w.filter(x => x[0] === 'set').length === 2, JSON.stringify(w.map(x => x[1])));
  check('…with the current note and the earlier ones', nts.c && nts.c.t === 'Rain delay: heats start at 2:00' && typeof nts.c.at === 'number' && nts.e.length === 1 && nts.e[0].t === 'Drivers meeting at noon', nrow.notes);
  await p.evaluate(() => { delete S.settings.raceNote; });
  w = await push();
  try { nts = JSON.parse(((w.find(x => x[1] === 'liveDriven/' + PA + '/ROOM1') || [])[2] || {}).notes); } catch (e) { nts = {}; }
  check('clearing the note keeps tonight\'s list, with no current note', nts.c === null && nts.e.length === 2, JSON.stringify(nts));
  await p.evaluate(() => { delete S.settings.raceNotes; });
  w = await push();
  check('no notes, no notes field', w.length === 2 && w.every(x => !('notes' in x[2])), JSON.stringify(w.map(x => Object.keys(x[2]))));
  check('the rule caps the notes field', /<= 1500/.test(L.$room.notes['.validate']));

  const p2 = await browser.newPage();
  const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
  await p2.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  await p2.addInitScript(() => { try { localStorage.setItem('raceday_v1', JSON.stringify({ sync: { enabled: true, key: 'BOOTRM', staffKey: '' }, schemaVersion: 1 })); } catch (e) {} });
  await p2.goto(`http://localhost:${PORT}/raceday2/`); await p2.waitForTimeout(2200);
  check('a synced device starts up without errors', !errs2.length, errs2.join('; '));
  await p2.close();

  check('no page errors', !errs.length, errs.join('; '));
  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
