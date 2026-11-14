// Live demo room (2026-11-12): the owner shows RaceDay to a track live.
// - Admin → The Garage → Start live demo opens a DEMO… room in its own Garage slot (the real
//   track is never touched) with last week's scored night and tonight's board
// - a prospect's phone joins from the join QR as a second admin screen
// - every device in the room skips the license/trial count, never publishes to Driven,
//   and reports usage as DEMO ROOM
// - the host gets a step-by-step script; every step opens without an error
// - End demo puts the host back on its own track, and every joined phone clears itself
// Two browser contexts share one fake Firebase kept in this file.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8891;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + x : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const base = `http://localhost:${PORT}/raceday2/`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];

  // ---- one fake Realtime Database shared by every page ----
  let tree = {}; const pages = [];
  const setPath = (p, v) => {
    const ks = p.split('/').filter(Boolean); let o = tree;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const getPath = p => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), tree);
  const notify = () => Promise.all(pages.map(pg => pg.evaluate(t => window.__fbNotify && window.__fbNotify(t), tree).catch(() => {})));
  const fakeFb = () => {
    window.__tree = {}; window.__subs = [];
    const get = p => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), window.__tree);
    const snap = p => { const v = get(p); return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) }; };
    window.__fbNotify = t => { window.__tree = t; window.__subs.slice().forEach(s => s.cb(snap(s.p))); };
    const write = pairs => window.__fbWrite(JSON.stringify(pairs));
    const ref = p => ({
      on: (ev, cb) => {
        if (p === '.info/connected') { cb({ val: () => true }); return; }
        window.__subs.push({ p, cb }); setTimeout(() => cb(snap(p)), 80);
      },
      off: () => { window.__subs = window.__subs.filter(s => s.p !== p); },
      once: (ev, cb) => { const s = snap(p); if (cb) cb(s); return Promise.resolve(s); },
      update: obj => write(Object.keys(obj).map(k => [p + '/' + k, obj[k]])),
      set: v => write([[p, v]]),
      remove: () => write([[p, null]]),
      transaction: fn => {
        const cur = get(p), nv = fn(cur === undefined ? null : cur);
        if (nv === undefined) return Promise.resolve({ committed: false, snapshot: { val: () => cur } });
        return write([[p, nv]]).then(() => ({ committed: true, snapshot: { val: () => nv } }));
      }
    });
    let uid = null;
    const auth = { get currentUser() { return uid ? { uid } : null; }, signInAnonymously: () => { uid = 'u' + Math.random().toString(36).slice(2, 9); return Promise.resolve({ user: { uid } }); } };
    window.firebase = { apps: [{}], initializeApp: () => {}, database: () => ({ ref }), auth: () => auth };
  };
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Test Prospect' : undefined));
    await pg.route('**/*', r => r.request().url().startsWith(`http://localhost:${PORT}/`) ? r.continue() : r.abort());
    await pg.exposeFunction('__fbWrite', async json => { JSON.parse(json).forEach(([p, v]) => setPath(p, v)); notify(); return true; });
    await pg.addInitScript(fakeFb);
    pages.push(pg);
    return { ctx, pg };
  };

  // ---------------------------------------------------------------- the owner's device
  const { pg: host } = await newPage();
  await host.goto(base); await wait(500);
  await host.evaluate(() => {
    closeSheet(); localStorage.setItem('rd_role_v2', 'admin');
    S.license = { code: 'OWNER-0-TEST', name: 'OWNER', exp: '0' };   // the unlimited license
    S.track.name = 'Home Track';
    S.roster = [{ id: 501, name: 'Real Racer', num: '9' }];
    S.raceDay.entries = [{ driverId: 501, classId: 1, pill: 1 }];
    save();
  });
  await host.reload(); await wait(500);

  console.log('— starting a demo —');
  const card = await host.evaluate(() => { nav('admin'); admOpen('garage'); return document.getElementById('garageCard').textContent; });
  check('Admin → The Garage offers "Start live demo" with the unlimited license', /Start live demo/.test(card));
  const notOwner = await host.evaluate(() => {
    const keep = S.license, out = [];
    localStorage.setItem('rd_dont_count', '1'); S.license = null; out.push(demoRoomAllowed());   // the public /me/ mark is not enough
    S.license = { code: 'T-S2026-X', name: 'T', exp: 'S2026' }; out.push(demoRoomAllowed());     // nor a season pass
    localStorage.removeItem('rd_dont_count'); S.license = keep; return out;
  });
  check('…and not on a track\'s device (the public /me/ mark, a season pass)', notOwner.every(a => a === false), notOwner.join());
  await Promise.all([host.waitForNavigation(), host.evaluate(() => demoRoomStart())]);
  await wait(1200);
  const st = await host.evaluate(() => ({
    code: syncKey(), on: !!demoRoom(), host: demoRoomHost(), track: S.track.name, demo: S.demo,
    entries: S.raceDay.entries.length, today: S.raceDay.date === today(), hist: S.history.length,
    histDate: S.history[0] && S.history[0].date, staff: validStaffKey(S.sync.staffKey),
    primary: JSON.parse(localStorage.getItem(KEY)), slot: activeKey(), banner: document.getElementById('banners').textContent,
    badge: document.getElementById('topTrack').parentNode.textContent, label: demoRoomLabel(), canEnter: canEnter()
  }));
  check('the device is now in a DEMO… room', /^DEMO[A-Z0-9]{5}$/.test(st.code) && st.on && st.host, st.code);
  check('…in its own Garage slot, not the real track', st.slot !== 'raceday_v2' && st.slot.indexOf(st.code) >= 0, st.slot);
  check('the real track is untouched (name, driver, entry)', st.primary && st.primary.track.name === 'Home Track' && st.primary.roster.length === 1 && st.primary.raceDay.entries.length === 1 && !st.primary.sync.enabled);
  check('a sample track with last week\'s scored night in history', st.track === 'Sample Speedway' && st.hist === 1 && st.histDate !== null && st.histDate < (new Date().toISOString().slice(0, 10)), st.histDate);
  check('tonight\'s board has 15 drivers checked in, ready to score', st.entries === 15 && st.today, st.entries);
  check('it is a live room, not demo mode (sync stays on)', st.demo === false);
  check('the room got its staff key, so the join QR works', st.staff);
  check('every feature is open (no license on this slot, entry still allowed)', st.canEnter);
  check('the script bar shows step 1', /step 1 of 19/.test(st.banner) && /Join on their phone/.test(st.banner), st.banner.slice(0, 120));
  check('usage rows say DEMO ROOM with who it was for', st.label === 'DEMO ROOM · Test Prospect', st.label);
  check('the room is in the cloud with its demo mark', getPath('tracks/' + st.code + '/settings') && /demoRoom/.test(getPath('tracks/' + st.code + '/settings')));

  console.log('— the prospect joins —');
  const joinUrl = await host.evaluate(() => { demoJoinQr(); const cv = document.getElementById('demoJoinQR'); const u = demoJoinUrl(); closeSheet(); return { u, qr: !!cv }; });
  check('the join QR is drawn', joinUrl.qr);
  check('the join link makes an admin screen with the staff key', /role=admin/.test(joinUrl.u) && /&st=[a-z0-9]{32}/.test(joinUrl.u));
  const { pg: guest } = await newPage();
  await guest.goto(joinUrl.u.replace(/^https?:\/\/[^/]+\/raceday2\//, base)); await wait(1500);
  const g = await guest.evaluate(() => ({ code: syncKey(), role: deviceRole(), track: S.track.name, entries: S.raceDay.entries.length, on: !!demoRoom(), host: demoRoomHost(), banner: document.getElementById('banners').textContent, wizard: sheetOpen() }));
  check('the prospect\'s phone is in the same room as an admin screen', g.code === st.code && g.role === 'admin', JSON.stringify(g).slice(0, 160));
  check('…with the sample night on it', g.track === 'Sample Speedway' && g.entries === 15, g.entries);
  check('…and a plain "Live demo" note, not the presenter script', g.on && !g.host && /Live demo: a sample track/.test(g.banner) && !/step 1 of/.test(g.banner));
  check('no setup wizard pops up on their phone', !g.wizard);
  const signup = await guest.evaluate(() => {
    S.trialDays = ['2000-01-01'];   // their own free night already used
    nav('signup'); if (!document.getElementById('dName')) resetReg();
    const n = document.getElementById('dName'), v = document.getElementById('dNum');
    n.value = 'Prospect Kid'; v.value = '77'; n.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('input'));
    renderChips();
    const e = document.getElementById('ch' + S.classes[0].id); if (e && !e.classList.contains('on')) e.click();
    const chk = document.getElementById('consentChk'); if (chk) chk.checked = true;
    const before = S.raceDay.entries.length; register();
    return { added: S.raceDay.entries.length - before, trial: S.trialDays.slice(), canEnter: canEnter() };
  });
  check('they can sign a driver up even with their trial used up', signup.added === 1 && signup.canEnter, JSON.stringify(signup));
  check('…and it does not use a trial day on their phone', signup.trial.length === 1 && signup.trial[0] === '2000-01-01', signup.trial.join());
  await wait(1200);
  check('the new driver shows up on the host, live', await host.evaluate(() => S.raceDay.entries.length === 16 && S.roster.some(r => r.name === 'Prospect Kid')));
  const expired = await guest.evaluate(() => { const d = S.settings.demoRoom, at = d.at; d.at = Date.now() - 13 * 3600000; const r = [!!demoRoom(), canEnter()]; d.at = at; return r; });
  check('after 12 hours the room stops being free (trial rules come back)', expired[0] === false && expired[1] === false, expired.join());
  check('nothing is published to Driven from a demo room', await guest.evaluate(() => resultsJoin(true)) === false);
  setPath('profiles/prof_realcard01/card', { name: 'Prospect Kid', hometown: 'Their Town', age: '12', sponsors: 'Mom', teamColor: '#123456' });
  await notify();
  const link = await guest.evaluate(async () => {
    const d = S.roster.find(r => r.name === 'Prospect Kid');
    try { await linkProfile(d.id, 'prof_realcard01'); } catch (e) { return 'ERR ' + e.message; }
    await new Promise(r => setTimeout(r, 400));
    return { src: d.profile && d.profile.source, town: d.profile && d.profile.hometown };
  });
  check('they can link their own Driven card at sign-up', link && link.src === 'profiles' && link.town === 'Their Town', JSON.stringify(link));
  check('…and the sample track is NOT added to their real Driven profile', getPath('profileTracks') === undefined, JSON.stringify(getPath('profileTracks')));
  const me = await guest.evaluate(() => myLineupLink(S.roster.find(r => r.name === 'Prospect Kid').id));
  check('their "follow my lineup" link points at the demo room', me.indexOf('sync=' + st.code) >= 0 && /role=viewer&me=/.test(me), me);

  console.log('— the walkthrough —');
  const steps = await host.evaluate(async () => {
    const out = [];
    for (let i = 0; i < DEMO_STEPS.length; i++) {
      let err = '';
      try { demoJump(i); await new Promise(r => setTimeout(r, 120)); } catch (e) { err = e.message; }
      const sheet = sheetOpen() ? document.getElementById('sheetTitle').textContent : '';
      out.push({ i, t: DEMO_STEPS[i].t, page: curPage, tv: TV.on, sheet, err, prev: DEMO_STEPS[i].t === 'Timing import' ? document.getElementById('impPrevList') && document.getElementById('impPrevList').children.length : null,
        info: DEMO_STEPS[i].t === 'Timing import' ? (document.getElementById('impCsvInfo') || {}).textContent : null,
        rm: DEMO_STEPS[i].t === 'Lineups to the timing computer' ? (document.getElementById('rmLineupList') || {}).textContent : null,
        banner: (document.getElementById('banners').textContent.match(/step (\d+) of/) || [])[1] });
      if (TV.on) closeTV();
      if (sheetOpen()) closeSheet();
    }
    return out;
  });
  check('all 19 steps open without an error', steps.length === 19 && steps.every(s => !s.err), steps.filter(s => s.err).map(s => s.t + ': ' + s.err).join(' | '));
  check('the script bar follows along', steps.every(s => s.banner === String(s.i + 1)), steps.map(s => s.banner).join(','));
  const by = t => steps.find(s => s.t === t) || {};
  check('Sign-up step opens Sign up', by('Sign-up at the gate').page === 'signup');
  check('Driven card and lineup-spot steps open Sign up and Lineups', by('Their own Driven card').page === 'signup' && by('Their spot in the lineup').page === 'grid');
  check('Driver cards step opens a driver card', !!by('Driver cards').sheet, by('Driver cards').sheet);
  check('Timing import step loads a sample file with rows to import', by('Timing import').sheet === 'Import from timing' && by('Timing import').prev > 0, JSON.stringify(by('Timing import')));
  check('…and it is a Westhold Race Manager file', /Westhold format detected/.test(by('Timing import').info || '') && /Race Manager race file/.test(by('Timing import').info || ''), by('Timing import').info);
  const rmStep = by('Lineups to the timing computer');
  check('Lineups step opens the Race Manager download in Admin, every class ready (sample transponders)', rmStep.page === 'admin' && rmStep.sheet === 'Lineups for Race Manager' && /Download/.test(rmStep.rm || '') && !/no transponder/.test(rmStep.rm || ''), JSON.stringify(rmStep));
  check('TV step opens the TV display', by('TV display').tv === true);
  check('A job for every device opens Admin → Multi-device sync', by('A job for every device').page === 'admin');
  check('Wrap up shows the steps list with End demo', by('Wrap up').sheet === 'Live demo');
  const late = await host.evaluate(() => { const d = S.settings.demoRoom, at = d.at; d.at = Date.now() - 13 * 3600000; nav('admin'); admOpen('garage'); const t = document.getElementById('garageCard').textContent; d.at = at; return t; });
  check('the host keeps its End demo button after the 12 hours', /End demo/.test(late) && /hours are up/.test(late));
  const nextBack = await host.evaluate(() => { demoJump(4); demoStep(1); const a = demoStepIdx(); demoStep(-1); const b = demoStepIdx(); if (sheetOpen()) closeSheet(); return [a, b, curPage]; });
  check('Next and Back move one step and open that screen', nextBack[0] === 5 && nextBack[1] === 4 && nextBack[2] === 'admin', nextBack.join());

  console.log('— ending the demo —');
  await Promise.all([host.waitForNavigation(), guest.waitForNavigation(), host.evaluate(() => demoRoomEnd())]);
  await wait(1200);
  const h2 = await host.evaluate(() => ({ track: S.track.name, roster: S.roster.length, slot: activeKey(), idx: garageIndex().length, hostKey: localStorage.getItem('rd_demo_host'), slots: Object.keys(localStorage).filter(k => /DEMO/.test(k)), sync: S.sync.enabled }));
  check('the host is back on its own track', h2.track === 'Home Track' && h2.roster === 1 && h2.slot === 'raceday_v2' && !h2.sync, JSON.stringify(h2));
  check('…and the demo slot is gone from this device', h2.idx === 0 && !h2.hostKey && h2.slots.length === 0, JSON.stringify(h2));
  const g2 = await guest.evaluate(() => ({ track: S.track.name, roster: S.roster.length, sync: S.sync.enabled, key: S.sync.key, trial: S.trialDays, role: deviceRole() }));
  check('the prospect\'s phone cleared the sample race and left the room', !g2.track && g2.roster === 0 && !g2.sync, JSON.stringify(g2));
  check('…kept its own trial record, and is ready to set up as an admin', g2.trial.length === 1 && g2.role === 'admin');
  check('the cloud room is marked ended', /"ended":\d+/.test(getPath('tracks/' + st.code + '/settings') || ''));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== v2-demo-room: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
