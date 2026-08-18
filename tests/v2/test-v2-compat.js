// v2 data compatibility + boot invariants.
//
// The whole cutover story rests on one claim: a track can open RaceDay v2 and its
// season is still there, and a v1 device and a v2 device can run the same race night.
// That claim is only worth anything if it is tested against a payload v1 actually
// wrote — so this suite boots the REAL v1 app, has it seed a full demo race night,
// lifts the resulting localStorage verbatim, and hands it to v2.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8811;
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
  const newPage = async (w, h) => {
    const p = await browser.newPage({ viewport: { width: w || 900, height: h || 1000 } });
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    return p;
  };

  // ---------------------------------------------------------------- 1. v1 payload
  console.log('— Capture a real v1 payload —');
  let v1Payload = null;
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/raceday/index.html`);
    await p.waitForTimeout(500);
    await p.evaluate(() => { hideModal('setupWizard'); seedFullDemoNight(); });
    await p.waitForTimeout(400);
    v1Payload = await p.evaluate(() => localStorage.getItem('raceday_v1'));
    const summary = await p.evaluate(() => ({
      classes: S.classes.length, roster: S.roster.length,
      entries: S.raceDay.entries.length, history: S.history.length, ver: S.schemaVersion
    }));
    check('v1 seeded a full demo night', summary.classes > 0 && summary.roster > 0 && summary.entries > 0, JSON.stringify(summary));
    check('v1 payload captured', !!v1Payload && v1Payload.length > 1000, 'len=' + (v1Payload || '').length);
    await p.close();
  }
  const v1State = JSON.parse(v1Payload);

  // ---------------------------------------------------------------- 2. v2 opens it
  console.log('— v2 opens the v1 payload —');
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/`);
    await p.evaluate(pl => localStorage.setItem('raceday_v1', pl), v1Payload);
    await p.reload(); await p.waitForTimeout(500);

    const got = await p.evaluate(() => ({
      track: S.track.name, classes: S.classes.length, roster: S.roster.length,
      entries: S.raceDay.entries.length, history: S.history.length, ver: S.schemaVersion
    }));
    check('track name survives',  got.track === v1State.track.name, got.track);
    check('classes survive',      got.classes === v1State.classes.length);
    check('driver book survives', got.roster === v1State.roster.length);
    check('entries survive',      got.entries === v1State.raceDay.entries.length);
    check('history survives',     got.history === (v1State.history || []).length);
    check('schemaVersion unchanged (no spurious migration)', got.ver === v1State.schemaVersion, got.ver + ' vs ' + v1State.schemaVersion);

    check('track name renders in the top bar',
      (await p.textContent('#topTrack')).includes(v1State.track.name));

    // Round-trip: v2 writing must not corrupt or drop fields v1 depends on.
    await p.evaluate(() => save());
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('raceday_v1')));
    const v1Keys = Object.keys(v1State).sort();
    const v2Keys = Object.keys(after).sort();
    check('v2 save() keeps every top-level field v1 wrote',
      v1Keys.every(k => v2Keys.includes(k)), 'missing: ' + v1Keys.filter(k => !v2Keys.includes(k)).join(','));
    check('v2 save() invents no new persisted top-level fields',
      v2Keys.every(k => v1Keys.includes(k)), 'extra: ' + v2Keys.filter(k => !v1Keys.includes(k)).join(','));

    // The race engine must agree with v1 on the same data — that is the whole point
    // of copying it across rather than rewriting it.
    const v2Calc = await p.evaluate(() => S.classes.map(c => ({
      id: c.id,
      standings: calcStandings(c.id).map(s => s.id),
      feature: featureGridOrder(featureData(c.id), c.id).map(r => r.id),
      points: dayPoints(c.id)
    })));
    const p1 = await newPage();
    await p1.goto(`http://localhost:${PORT}/raceday/index.html`);
    await p1.evaluate(pl => localStorage.setItem('raceday_v1', pl), v1Payload);
    await p1.reload(); await p1.waitForTimeout(400);
    const v1Calc = await p1.evaluate(() => S.classes.map(c => ({
      id: c.id,
      standings: calcStandings(c.id).map(s => s.id),
      feature: featureGridOrder(featureData(c.id), c.id).map(r => r.id),
      points: dayPoints(c.id)
    })));
    check('v2 computes identical standings, feature grids and points to v1',
      JSON.stringify(v2Calc) === JSON.stringify(v1Calc));
    await p1.close();
    await p.close();
  }

  // ---------------------------------------------------------------- 3. migrations
  console.log('— Old payloads still migrate —');
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/`);
    // A v1 payload from before the heat-key migration: h1_<heatIdx>_<driverId>.
    // schemaVersion 0 so the whole migration chain has to run, not just its tail.
    const old = JSON.parse(v1Payload);
    old.schemaVersion = 0;
    const clsKey = Object.keys(old.raceDay.heatResults)[0];
    if (clsKey) {
      const src = old.raceDay.heatResults[clsKey], moved = {};
      Object.keys(src).forEach(k => {
        const m = k.match(/^h([12])_(\d+)$/);
        moved[m ? 'h' + m[1] + '_0_' + m[2] : k] = src[k];
      });
      old.raceDay.heatResults[clsKey] = moved;
    }
    old.adminPin = '1234';   // pre-migration plaintext PIN
    await p.evaluate(pl => localStorage.setItem('raceday_v1', pl), JSON.stringify(old));
    await p.reload(); await p.waitForTimeout(400);
    const m = await p.evaluate(() => ({
      ver: S.schemaVersion,
      pinHashed: S.adminPin !== '1234' && !!S.adminPin,
      pinWorks: pinHash('1234') === S.adminPin,
      oldKeys: JSON.stringify(S.raceDay.heatResults).includes('h1_0_')
    }));
    check('schemaVersion migrated forward', m.ver === 8, 'ver=' + m.ver);
    check('plaintext PIN was hashed, and still accepts the same PIN', m.pinHashed && m.pinWorks);
    check('legacy heat keys rewritten', !m.oldKeys);
    await p.close();
  }

  // ---------------------------------------------------------------- 4. roles
  console.log('— Role boundaries on the new shell —');
  {
    const p = await newPage(460, 950);
    await p.goto(`http://localhost:${PORT}/`);
    await p.evaluate(pl => localStorage.setItem('raceday_v1', pl), v1Payload);
    await p.evaluate(() => localStorage.setItem('rd_role_v2', 'viewer'));
    await p.reload(); await p.waitForTimeout(400);
    const tabs = await p.$$eval('#tabbar button', bs => bs.map(b => b.textContent.trim()));
    check('spectator sees only Lineups + Guide', tabs.length === 2, JSON.stringify(tabs));
    check('spectator gets no Admin tab', !tabs.some(t => /admin/i.test(t)));
    check('spectator gets no Sign up tab', !tabs.some(t => /sign/i.test(t)));
    check('spectator cannot reach admin by asking for it',
      await p.evaluate(() => { nav('admin'); return curPage !== 'admin'; }));
    check('Race Control is hidden from spectators',
      await p.evaluate(() => document.getElementById('raceControl').style.display === 'none'));
    check('canWrite() is false for a spectator', await p.evaluate(() => canWrite() === false));

    await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'scoring'); });
    await p.reload(); await p.waitForTimeout(400);
    const stabs = await p.$$eval('#tabbar button', bs => bs.map(b => b.textContent.trim()));
    check('scoring station sees Lineups/Score/Points/Guide', stabs.length === 4, JSON.stringify(stabs));
    check('scoring station gets no Sign up tab', !stabs.some(t => /sign/i.test(t)));
    await p.close();
  }

  // ---------------------------------------------------------------- 5. race control
  console.log('— Race Control derives the night phase —');
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/`);
    await p.evaluate(pl => localStorage.setItem('raceday_v1', pl), v1Payload);
    await p.reload(); await p.waitForTimeout(400);
    check('a fully-scored demo night reads as complete',
      await p.evaluate(() => nightPhase().key === 'archive'), await p.evaluate(() => nightPhase().key));

    await p.evaluate(() => { S.raceDay.heatResults = {}; save(); renderAll(); });
    await p.waitForTimeout(200);
    check('wiping results drops the phase back to Heats',
      await p.evaluate(() => nightPhase().key === 'heats'), await p.evaluate(() => nightPhase().key));
    check('the phase bar names the next action',
      (await p.textContent('#rcNext')).toLowerCase().includes('heat'));

    await p.evaluate(() => { S.raceDay.entries = []; save(); renderAll(); });
    await p.waitForTimeout(200);
    check('an empty board reads as Sign-up',
      await p.evaluate(() => nightPhase().key === 'signup'));
    await p.close();
  }

  // ---------------------------------------------------------------- 6. recovery
  console.log('— Unreadable data is never silently overwritten —');
  {
    const p = await newPage();
    await p.goto(`http://localhost:${PORT}/`);
    await p.evaluate(() => localStorage.setItem('raceday_v1', '{"classes":[ this is not json'));
    await p.reload(); await p.waitForTimeout(400);
    check('recovery sheet opens', await p.evaluate(() => document.getElementById('sheetHost').classList.contains('on')));
    check('the corrupt bytes are still on the device',
      await p.evaluate(() => localStorage.getItem('raceday_v1').includes('not json')));
    check('the setup wizard does NOT hijack a recovery device',
      await p.evaluate(() => (document.getElementById('sheetTitle').textContent || '').toLowerCase().includes('could not be read')));
    await p.close();
  }

  // ---------------------------------------------------------------- 7. offline shell
  console.log('— Offline / no-network assets —');
  {
    const html = fs.readFileSync(path.join(ROOT, 'raceday2/index.html'), 'utf8');
    check('no external font/stylesheet/script link in the shell',
      !/<link[^>]+href=["']https?:/i.test(html) && !/<script[^>]+src=["']https?:/i.test(html));
    check('the display face is embedded, not fetched',
      html.includes("font-family:'Saira Condensed'") && html.includes('data:font/woff2;base64,'));
  }

  check('no uncaught page errors anywhere in this suite', errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close(); server.close();
  console.log(`\n${fail ? '❌' : '✅'} v2 compat: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
