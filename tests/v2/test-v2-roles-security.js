// Role-boundary + boot-sequence security invariants — v2 port of tests/test-roles-security.js.
//
// Per CLAUDE.md this suite is the gate for anything touching roles, permissions, the
// setup wizard, sync, or the boot sequence: three separate security bugs reached
// production because the feature suites test race logic and nothing pinned what a
// device is ALLOWED to see/do per role, or how boot/sync behaves on a fresh device.
// A failure here is a security incident, not a flaky test — do not relax an assertion
// to make it pass.
//
// Every invariant from the v1 suite is preserved. Only the DOM probes changed to match
// v2's markup: the setup wizard is a sheet (not a fixed #setupWizard modal), the nav is
// a dynamic tab bar (not fixed #mainNav buttons), and the viewer's escape link lives in
// the fan-view render target (#gridWrap) rather than a static #page-grid.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8815;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const f = path.join(ROOT, urlPath === '/' ? 'raceday2/index.html' : urlPath);
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));

  let answer = () => false;
  const dlgSeen = [];
  page.on('dialog', async d => {
    dlgSeen.push(d.message());
    let r;
    try { r = answer(d.message(), d.type()); } catch (e) { r = false; }
    if (typeof r === 'string') await d.accept(r);
    else if (r === true) await d.accept();
    else await d.dismiss();
  });
  const resetDlg = () => { dlgSeen.length = 0; answer = () => false; };

  /* v2's wizard is a sheet with a fixed title, not a fixed #setupWizard modal. */
  const wizardOpen = () => page.evaluate(() => {
    const host = document.getElementById('sheetHost');
    return !!host && host.classList.contains('on') && /Set up RaceDay/i.test(document.getElementById('sheetTitle').textContent || '');
  });
  const role = () => page.evaluate(() => deviceRole());
  /* v2's tabbar is built from NAV+ROLE_PAGES at render time, not fixed buttons in a
     fixed order — read it back as page ids the same way the app itself derives them. */
  const navVisible = () => page.evaluate(() => {
    // Tab labels are an icon span glued directly to a text node with no space between
    // (".rail-ico" + label), so strip everything but letters/spaces before matching.
    const LABEL_TO_ID = { 'sign up':'signup', 'lineups':'grid', 'score':'results', 'points':'points', 'admin':'admin', 'guide':'help' };
    return [...document.querySelectorAll('#tabbar button')].map(b => {
      const t = b.textContent.replace(/[^A-Za-z ]/g, '').trim().toLowerCase();
      return LABEL_TO_ID[t] || t;
    });
  });
  const base = `http://localhost:${PORT}/`;
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await go(base);
  await page.waitForTimeout(400);

  // ============================================================================
  console.log('\n=== 1. SETUP WIZARD only auto-opens for a fresh STANDALONE admin ===');

  resetDlg();
  await page.evaluate(() => localStorage.clear());
  await go(base);
  await page.waitForTimeout(500);
  check('fresh standalone admin device opens the wizard', await wizardOpen());

  resetDlg();
  answer = () => true;
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=LIVEROOM&role=viewer');
  await page.waitForTimeout(500);
  check('spectator QR (fresh + role=viewer) does NOT open the wizard', !(await wizardOpen()));
  check('spectator QR device is the viewer role', (await role()) === 'viewer');
  check('spectator QR device shows only [grid, help]', JSON.stringify(await navVisible()) === JSON.stringify(['grid', 'help']));

  resetDlg();
  answer = () => true;
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=LIVEROOM&role=register');
  await page.waitForTimeout(500);
  check('staff join (fresh + role=register) does NOT open the wizard', !(await wizardOpen()));

  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base);
  await page.waitForTimeout(500);
  check('sync-enabled device with no track name does NOT open the wizard', !(await wizardOpen()));

  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'Configured Track'; save(); });
  await go(base);
  await page.waitForTimeout(500);
  check('configured device does NOT re-open the wizard on reload', !(await wizardOpen()));

  // ============================================================================
  console.log('\n=== 2. VIEWER (spectator) is fully locked down ===');
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
  await go(base);
  await page.waitForTimeout(400);

  check('viewer nav = [grid, help] only', JSON.stringify(await navVisible()) === JSON.stringify(['grid', 'help']));
  check('viewer changeDeviceRole() is a no-op', await page.evaluate(() => { const b = deviceRole(); try { changeDeviceRole(); } catch (e) {} return deviceRole() === b && b === 'viewer'; }));
  check('viewer forced nav("admin") does not land on admin', await page.evaluate(() => { try { nav('admin'); } catch (e) {} return curPage !== 'admin'; }));
  check('viewer forced nav("signup") does not land on signup', await page.evaluate(() => { try { nav('signup'); } catch (e) {} return curPage !== 'signup'; }));
  check('syncPush() has an explicit viewer guard', await page.evaluate(() => /viewer/.test(syncPush.toString())));
  check('syncPushFull() has an explicit viewer guard', await page.evaluate(() => typeof syncPushFull === 'function' && /viewer/.test(syncPushFull.toString())));
  check('viewer save() does not write to the shared room', await page.evaluate(() => {
    let wrote = false;
    const realDb = Sync.db;
    Sync.db = { update: () => { wrote = true; return { catch() {} }; } };
    Sync.applying = false;
    try { syncPush(); } catch (e) {}
    Sync.db = realDb;
    return wrote === false;
  }));
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(200);
  check('viewer lineups render no save()/admin onclick handlers', await page.evaluate(() => {
    const html = document.getElementById('gridWrap').innerHTML;
    return !/onclick="[^"]*(save\(|del|register\(|archiveDay|setPin|resetAll|syncActivate)/.test(html);
  }));
  check('viewer lineups never render the TV/print/import operator controls', await page.evaluate(() => {
    const html = document.getElementById('gridWrap').innerHTML;
    return !/openTV\(|openPrint\(|openImport\(/.test(html);
  }));
  check('viewer lineups show a "Leave spectator view" exit link to /?home=1', await page.evaluate(() => {
    const a = [...document.querySelectorAll('#gridWrap a')].find(x => /home=1/.test(x.getAttribute('href') || ''));
    return !!a && /leave spectator/i.test(a.textContent);
  }));
  check('the spectator exit link is plain navigation, not a role switch', await page.evaluate(() => {
    const a = [...document.querySelectorAll('#gridWrap a')].find(x => /home=1/.test(x.getAttribute('href') || ''));
    if (!a) return false;
    const oc = a.getAttribute('onclick') || '';
    return !/setDeviceRole|changeDeviceRole|rd_role/.test(oc) && deviceRole() === 'viewer';
  }));

  // ============================================================================
  console.log('\n=== 3. URL ?role= cannot silently promote a spectator ===');

  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
  answer = (m) => { if (/admin PIN/i.test(m)) return '0000'; return true; };
  await go(base + '?sync=LIVEROOM&role=scoring');
  await page.waitForTimeout(500);
  check('viewer + ?role=scoring + WRONG pin stays viewer', (await role()) === 'viewer', 'got ' + await role());

  resetDlg();
  await page.evaluate(() => { setDeviceRole('viewer'); });
  answer = () => false;
  await go(base + '?sync=LIVEROOM&role=admin');
  await page.waitForTimeout(500);
  check('viewer + ?role=admin + dismissed pin stays viewer', (await role()) === 'viewer', 'got ' + await role());

  resetDlg();
  await page.evaluate(() => { setDeviceRole('viewer'); });
  answer = (m) => { if (/admin PIN/i.test(m)) return '1234'; return true; };
  await go(base + '?sync=LIVEROOM&role=scoring');
  await page.waitForTimeout(500);
  check('viewer + ?role=scoring + CORRECT pin recovers to scoring', (await role()) === 'scoring', 'got ' + await role());

  resetDlg();
  answer = (m) => { if (/admin PIN/i.test(m)) return '__SHOULD_NOT_BE_ASKED__'; return true; };
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=NEWROOM&role=scoring');
  await page.waitForTimeout(500);
  check('fresh device + staff link provisions with no PIN challenge', (await role()) === 'scoring' && !dlgSeen.some(m => /admin PIN/i.test(m)), 'role=' + await role());

  // ============================================================================
  console.log('\n=== 4. Role→page access is ENFORCED, not just visually hidden ===');
  const MATRIX = {
    admin:    ['signup', 'grid', 'results', 'points', 'admin', 'help'],
    register: ['signup', 'help'],
    scoring:  ['grid', 'results', 'points', 'help'],
    tv:       ['grid', 'help'],
    viewer:   ['grid', 'help'],
    operator: ['signup', 'grid', 'results', 'points', 'admin', 'help'],
  };
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; save(); });
  for (const r of Object.keys(MATRIX)) {
    await page.evaluate((rr) => { setDeviceRole(rr); applyRole(); }, r);
    await page.waitForTimeout(80);
    const vis = await navVisible();
    check(`role=${r}: nav = [${MATRIX[r].join(',')}]`, JSON.stringify(vis) === JSON.stringify(MATRIX[r]), 'got [' + vis.join(',') + ']');
    const leaked = await page.evaluate((allowed) => {
      const all = ['signup', 'grid', 'results', 'points', 'admin', 'help'];
      const bad = [];
      all.filter(p => !allowed.includes(p)).forEach(p => { try { nav(p); } catch (e) {} if (curPage === p) bad.push(p); });
      return bad;
    }, MATRIX[r]);
    check(`role=${r}: forced nav to disallowed pages all blocked`, leaked.length === 0, 'leaked: ' + leaked.join(','));
  }

  resetDlg();
  await page.evaluate(() => { S.adminPin = pinHash('1234'); save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup'); });
  answer = () => false;
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(200);
  check('admin page blocked when PIN prompt refused', await page.evaluate(() => curPage !== 'admin'));

  // ============================================================================
  console.log('\n=== 5. A locked STAFF device is always recoverable (no permanent lock) ===');
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('tv'); });
  await go(base + '?sync=LIVEROOM&role=register');
  await page.waitForTimeout(500);
  check('a stuck tv device recovers to register via a role link', (await role()) === 'register', 'got ' + await role());

  // ============================================================================
  console.log('\n=== 6. Forgotten admin PIN is recoverable (not a data-wiping dead end) ===');

  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234');
    S.license = { code: 'TESTTRACK-0-ABCDEF', name: 'TESTTRACK', exp: '0' };
    S.roster = [{ id: 1, name: 'Keep', num: '9', noPoints: false }];
    save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup');
  });
  answer = (m) => {
    if (/Enter the admin PIN/i.test(m)) return '0000';
    if (/Forgot it/i.test(m)) return true;
    if (/access code to reset/i.test(m)) return 'TESTTRACK-0-ABCDEF';
    return false;
  };
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(300);
  check('correct access code clears the PIN', await page.evaluate(() => S.adminPin === ''));
  check('PIN recovery keeps the driver book (no data loss)', await page.evaluate(() => (S.roster || []).length === 1));

  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234');
    S.license = { code: 'TESTTRACK-0-ABCDEF', name: 'TESTTRACK', exp: '0' };
    S.roster = [{ id: 1, name: 'Wipe', num: '9', noPoints: false }];
    save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup');
  });
  answer = (m) => {
    if (/Enter the admin PIN/i.test(m)) return '0000';
    if (/Forgot it/i.test(m)) return true;
    if (/access code to reset/i.test(m)) return 'NOPE-WRONG-CODE';
    if (/other way to recover/i.test(m)) return true;
    return false;
  };
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(300);
  check('wrong-code fallback wipes data', await page.evaluate(() => (S.roster || []).length === 0));
  check('wrong-code fallback KEEPS the license', await page.evaluate(() => S.license && S.license.code === 'TESTTRACK-0-ABCDEF'));

  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup'); });
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '1234'; return false; };
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(200);
  check('correct PIN reaches admin with no recovery prompt', await page.evaluate(() => curPage === 'admin') && !dlgSeen.some(m => /Forgot it|access code/i.test(m)));

  // ============================================================================
  console.log('\n=== 7. A watching operator never writes to the shared room ===');
  resetDlg();
  check('syncPush() guards against a watching operator', await page.evaluate(() => /operatorWatching\(\)/.test(syncPush.toString())));
  check('syncPushFull() guards against a watching operator', await page.evaluate(() => typeof syncPushFull === 'function' && /operatorWatching\(\)/.test(syncPushFull.toString())));

  // ============================================================================
  console.log('\n=== 8. Joining a DIFFERENT room warns before wiping local setup ===');
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'My Track';
    S.roster = [{ id: 1, name: 'X', num: '1', noPoints: false }]; S.raceDay.entries = [];
    S.sync = { enabled: true, key: 'OLDCODE' }; save(); setDeviceRole('admin');
  });
  let warned = false;
  answer = (m) => { if (/REPLACED by the cloud copy/i.test(m)) { warned = true; return false; } return true; };
  await go(base + '?sync=NEWCODE&role=admin');
  await page.waitForTimeout(500);
  check('roster-but-no-entries device warns before a clobber', warned);
  check('cancelling the clobber keeps the original sync code', await page.evaluate(() => normKey(S.sync.key) === 'OLDCODE'), await page.evaluate(() => S.sync.key));

  // ============================================================================
  console.log('\n=== 9. Driver ids are collision-free across devices (multi-device sign-up) ===');
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); save(); });
  check('genDriverId() exists', await page.evaluate(() => typeof genDriverId === 'function'));
  const idStats = await page.evaluate(() => {
    const ids = [];
    for (let i = 0; i < 2000; i++) ids.push(genDriverId());
    const uniq = new Set(ids).size;
    const min = Math.min(...ids), max = Math.max(...ids);
    return { count: ids.length, uniq, min, max, allSafe: ids.every(n => Number.isSafeInteger(n)) };
  });
  check('2000 generated ids are all unique', idStats.uniq === 2000, 'uniq=' + idStats.uniq);
  check('ids are all safe integers (usable in onclick handlers)', idStats.allSafe);
  check('ids span a wide random space, NOT a sequential counter', (idStats.max - idStats.min) > 1e12, 'span=' + (idStats.max - idStats.min));
  check('genDriverId() avoids ids already in the roster', await page.evaluate(() => {
    S.roster = [];
    const first = genDriverId();
    S.roster.push({ id: first, name: 'A', num: '1', noPoints: false });
    for (let i = 0; i < 500; i++) { const n = genDriverId(); if (n === first) return false; }
    return true;
  }));

  // ============================================================================
  console.log('\n=== 10. Operator PIN fails closed; ?role=operator requires OPERATOR_KEY ===');

  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.operatorPin = ''; save(); setDeviceRole('operator'); });
  const opCheck1 = await page.evaluate(() => {
    const before = S.operatorPin;
    const ok = opPinOk('take control');
    return { before, after: S.operatorPin, ok };
  });
  check('opPinOk() with no PIN set returns false (fails closed)', opCheck1.ok === false);
  check('opPinOk() with no PIN set does NOT auto-create a PIN', opCheck1.before === '' && opCheck1.after === '');

  resetDlg();
  answer = (m) => {
    if (/Create a private Operator PIN|Choose a new Operator PIN/i.test(m)) return '5678';
    if (/Type it again/i.test(m)) return '5678';
    return true;
  };
  await page.evaluate(() => setOperatorPin());
  await page.waitForTimeout(100);
  check('setOperatorPin() stores a hashed PIN (not the raw digits)', await page.evaluate(() => !!S.operatorPin && S.operatorPin !== '5678'));
  answer = (m) => { if (/Enter your Operator PIN/i.test(m)) return '5678'; return true; };
  check('opPinOk() succeeds with the correct PIN once one is set', await page.evaluate(() => opPinOk('take control')));

  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base + '?sync=LIVEROOM&role=operator');
  await page.waitForTimeout(500);
  check('?role=operator with no opk stays off operator role', (await role()) === 'admin', 'got ' + await role());

  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base + '?sync=LIVEROOM&role=operator&opk=wrong-key');
  await page.waitForTimeout(500);
  check('?role=operator with WRONG opk stays off operator role', (await role()) === 'admin', 'got ' + await role());

  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  const correctOpk = await page.evaluate(() => OPERATOR_KEY);
  await go(base + '?sync=LIVEROOM&role=operator&opk=' + encodeURIComponent(correctOpk));
  await page.waitForTimeout(500);
  check('?role=operator WITH correct opk grants operator role', (await role()) === 'operator', 'got ' + await role());

  // ============================================================================
  console.log('\n=== 11. Setup wizard stores a HASHED admin PIN ===');
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); save(); sessionStorage.removeItem('rd_admin_ok'); });
  const wizPin = await page.evaluate(() => {
    S.adminPin = ''; save();
    openSetupWizard();
    UI.wizStep = 4; wizShow(4);
    document.getElementById('wizPin1').value = '4321';
    document.getElementById('wizPin2').value = '4321';
    wizNext();
    closeSheet();
    return { stored: S.adminPin, hashed: S.adminPin === pinHash('4321'), plain: S.adminPin === '4321' };
  });
  check('wizard-set PIN is stored hashed, not plaintext', wizPin.hashed && !wizPin.plain, 'stored=' + JSON.stringify(wizPin.stored));
  resetDlg();
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '4321'; return false; };
  check('adminOk() accepts a wizard-set PIN (no lockout)', await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); return adminOk(); }));
  check('no recovery prompt fired for the correct wizard-set PIN', !dlgSeen.some(m => /Forgot it|recovering/i.test(m)), dlgSeen.join(' | '));

  // ============================================================================
  console.log('\n=== 12. A hashed PIN SURVIVES a reload (migration must not re-hash it) ===');
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); save(); });
  await go(base);
  await page.waitForTimeout(300);
  check('stored PIN unchanged by the reload (no double-hash)', await page.evaluate(() => S.adminPin === pinHash('1234')), await page.evaluate(() => 'stored=' + S.adminPin + ' expected=' + pinHash('1234')));
  resetDlg();
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '1234'; return false; };
  check('correct PIN still unlocks admin after a reload', await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); return adminOk(); }));
  check('defaults() schemaVersion matches the latest migration', await page.evaluate(() => { const d = defaults(); const m = migrate(JSON.parse(JSON.stringify(d))); return d.schemaVersion === m.schemaVersion; }));

  console.log('\n=== 13. A RESTORE must not strip this device\'s admin PIN ===');
  resetDlg();
  answer = () => true;
  const pinKept = await page.evaluate(() => {
    localStorage.clear(); S = load();
    S.track.name = 'T'; S.adminPin = pinHash('4321'); S.classes = [{ id: 1, name: 'X', maxPill: 20 }];
    S.license = { code: 'MY-LIC' }; save();
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));
    applyRestoredState(incoming, 'a test backup');
    return { pin: S.adminPin, expected: pinHash('4321'), lic: S.license && S.license.code };
  });
  check('admin PIN survives a PIN-less (cloud) restore', pinKept.pin === pinKept.expected, JSON.stringify(pinKept));
  check('Admin is NOT left open to everyone after a restore', await page.evaluate(() => !!S.adminPin));
  check('license still stays with the device across a restore', pinKept.lic === 'MY-LIC', String(pinKept.lic));
  resetDlg();
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '4321'; return false; };
  check('the kept PIN still unlocks admin', await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); return adminOk(); }));

  console.log('\n=== 14. dayBanner + adminOk() stay locked for viewer/tv with NO PIN set ===');
  // (v1 (raceday/index.html) shipped this fix in the same session v2's security suite was
  //  ported — v2 never received it. checkDayBanner() here is just an alias for
  //  renderBanners(), which correctly hides dayBannerHtml() from viewer, but adminOk() had
  //  no role check at all: on a track with no PIN configured, a spectator OR tv device
  //  tapping the leaked banner — or calling newRaceDay() directly — could archive/wipe the
  //  live race day. No existing check combined "viewer/tv role" + "no PIN set".)

  // 14a. viewer, NO PIN set, real data sitting unarchived → the day banner must stay hidden.
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '';   // explicitly NO PIN
    S.classes = [{ id: 1, name: 'X', maxPill: 20 }];
    S.raceDay = { date: '2020-01-01', entries: [{ driverId: 1, classId: 1, pill: 1 }], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    save(); setDeviceRole('viewer');
  });
  await go(base);
  await page.waitForTimeout(400);
  check('viewer + no PIN + stale race day: day banner is NOT in #banners', await page.evaluate(() => {
    const el = document.getElementById('banners');
    return !el || !el.innerHTML.includes('newRaceDay()');
  }));

  // 14b. Same state, re-running checkDayBanner() (renderBanners() alias) — still hidden.
  await page.evaluate(() => { checkDayBanner(); });
  check('viewer + no PIN: re-running checkDayBanner() keeps the day banner out of #banners', await page.evaluate(() => {
    const el = document.getElementById('banners');
    return !el || !el.innerHTML.includes('newRaceDay()');
  }));

  // 14c. adminOk() itself refuses outright for viewer, with NO PIN set — no prompt at all.
  resetDlg();
  answer = () => { throw new Error('adminOk() should not prompt for viewer'); };
  check('adminOk() returns false for viewer with no PIN set (no prompt)', await page.evaluate(() => {
    setDeviceRole('viewer'); sessionStorage.removeItem('rd_admin_ok');
    return adminOk() === false;
  }));
  check('no PIN prompt was shown to the viewer', dlgSeen.length === 0, dlgSeen.join(' | '));

  // 14d. newRaceDay() is a true no-op for viewer with no PIN set — S.raceDay is untouched.
  // Accept every confirm here (rather than resetDlg()'s default dismiss-all) so this
  // isolates adminOk() specifically: if it incorrectly let a viewer through, the archive
  // confirm would be accepted and archiveDay() would actually run.
  resetDlg();
  answer = () => true;
  const beforeAfter = await page.evaluate(() => {
    setDeviceRole('viewer');
    const before = JSON.parse(JSON.stringify(S.raceDay));
    newRaceDay();
    return { before, after: S.raceDay };
  });
  check('newRaceDay() does not archive/clear S.raceDay for viewer', JSON.stringify(beforeAfter.before) === JSON.stringify(beforeAfter.after));

  // 14e. adminOk() also refuses outright for tv, with NO PIN set.
  resetDlg();
  answer = () => { throw new Error('adminOk() should not prompt for tv'); };
  check('adminOk() returns false for tv with no PIN set (no prompt)', await page.evaluate(() => {
    setDeviceRole('tv'); sessionStorage.removeItem('rd_admin_ok');
    return adminOk() === false;
  }));

  // 14f. Sanity: admin/scoring/operator/register are UNCHANGED by the adminOk() hardening —
  // still succeed with no PIN set (this is what would catch an over-broad fix).
  resetDlg();
  for (const r of ['admin', 'scoring', 'operator', 'register']) {
    check('adminOk() still returns true for role=' + r + ' with no PIN set', await page.evaluate((rr) => {
      setDeviceRole(rr); sessionStorage.removeItem('rd_admin_ok');
      return adminOk() === true;
    }, r));
  }

  // ============================================================================
  console.log('\n=== 15. TV role cannot reach qualifying-time controls ===');
  // (Related gap: renderGrid() only special-cased viewer; a tv-role device landing on the
  //  same grid page fell through to the full render, including the admin-gated
  //  "⏱ Qualifying times" button and the TV/Print/Import toolbar.)
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '';
    S.classes = [{ id: 1, name: 'Stocks', maxPill: 20 }];
    S.roster = [{ id: 1, name: 'Driver A', num: '9', noPoints: false }];
    S.raceDay.entries = [{ driverId: 1, classId: 1, pill: 1 }];
    save(); setDeviceRole('tv');
  });
  await go(base);
  await page.waitForTimeout(400);
  await page.evaluate(() => { if (typeof closeTV === 'function') closeTV(); nav('grid'); });
  await page.waitForTimeout(200);
  check('tv role: no "Qualifying times" button rendered on the grid page', await page.evaluate(() => {
    const el = document.getElementById('gridWrap');
    return !el || !el.innerHTML.includes('openQualTimes');
  }));
  check('tv role: TV/Print/Import toolbar is hidden', await page.evaluate(() => {
    const el = document.getElementById('gridWrap');
    return !el || (!el.innerHTML.includes('openTV()') && !el.innerHTML.includes('openPrint()'));
  }));
  resetDlg();
  answer = () => { throw new Error('should not prompt'); };
  check('tv role: openQualTimes() is a no-op with no PIN set (no prompt, no sheet)', await page.evaluate(() => {
    openQualTimes(1);
    const host = document.getElementById('sheetHost');
    return !host || !host.classList.contains('on');
  }));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
