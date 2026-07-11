// Role-boundary + boot-sequence security invariants.
//
// This suite exists because three separate LIVE bugs all landed in the same blind spot —
// the feature suites test race logic (inverts, results, points) but nothing pinned what a
// device is ALLOWED to see/do per role, or how the boot/sync sequence behaves on a fresh
// device. Each invariant below corresponds to a real bug that reached production:
//   • spectator QR reaching an editable admin page (setup wizard on a joining device)
//   • the on-screen role-escape hatch letting a viewer become admin
//   • the ?role= URL param promoting a viewer with no auth
//   • the "fix" that removed the escape hatch bricking legit staff devices (no recovery)
//   • a forgotten admin PIN being an unrecoverable lockout
// If any of these regress, this suite fails. Treat a failure here as a security incident.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8796;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];   // strip query BEFORE the '/'-to-index default
    const f = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
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

  // One dispatching dialog handler; each test sets `answer` to a function (message -> reply).
  // Return a string to accept a prompt with that value, true to accept a confirm, false to
  // dismiss. Default: dismiss everything (the safe/negative path).
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

  const wizardOpen = () => page.evaluate(() => {
    const el = document.getElementById('setupWizard');
    return !!el && getComputedStyle(el).display !== 'none';
  });
  const role = () => page.evaluate(() => deviceRole());
  const navVisible = () => page.evaluate(() => {
    const order = ['signup', 'grid', 'results', 'points', 'admin', 'help'];
    const out = [];
    document.querySelectorAll('#mainNav button').forEach((b, i) => { if (getComputedStyle(b).display !== 'none') out.push(order[i]); });
    return out;
  });
  const base = `http://localhost:${PORT}/`;
  // Boot code (handleUrlParams) can fire prompt()/confirm() during load; waiting for the
  // full 'load' event then hangs on the open dialog. 'domcontentloaded' + our dialog
  // handler is both correct and much faster across the many reloads this suite does.
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await go(base);
  await page.waitForTimeout(400);

  // ============================================================================
  console.log('\n=== 1. SETUP WIZARD only auto-opens for a fresh STANDALONE admin ===');
  // (The live bug: a spectator QR scan opened the full wizard — track name, classes, and a
  //  new admin PIN — because initSync() is async so S.track.name is momentarily empty on
  //  every fresh device regardless of role.)

  // 1a. Fresh, standalone, no track → wizard SHOULD open.
  resetDlg();
  await page.evaluate(() => localStorage.clear());
  await go(base);
  await page.waitForTimeout(500);
  check('fresh standalone admin device opens the wizard', await wizardOpen());

  // 1b. Fresh device joining via spectator link (?role=viewer) → wizard MUST NOT open.
  resetDlg();
  answer = () => true;   // accept any (there shouldn't be a clobber confirm on empty data)
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=LIVEROOM&role=viewer');
  await page.waitForTimeout(500);
  check('spectator QR (fresh + role=viewer) does NOT open the wizard', !(await wizardOpen()));
  check('spectator QR device is the viewer role', (await role()) === 'viewer');
  check('spectator QR device shows only [grid, help]', JSON.stringify(await navVisible()) === JSON.stringify(['grid', 'help']));

  // 1c. Fresh device joining as a staff station (?role=register) → wizard MUST NOT open.
  resetDlg();
  answer = () => true;
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=LIVEROOM&role=register');
  await page.waitForTimeout(500);
  check('staff join (fresh + role=register) does NOT open the wizard', !(await wizardOpen()));

  // 1d. Sync already enabled but no track name yet (any role) → wizard MUST NOT open.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base);
  await page.waitForTimeout(500);
  check('sync-enabled device with no track name does NOT open the wizard', !(await wizardOpen()));

  // 1e. A configured device (track name set) never auto-opens on reload.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'Configured Track'; save(); });
  await go(base);
  await page.waitForTimeout(500);
  check('configured device does NOT re-open the wizard on reload', !(await wizardOpen()));

  // ============================================================================
  console.log('\n=== 2. VIEWER (spectator) is fully locked down ===');
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '1234'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
  await go(base);
  await page.waitForTimeout(400);

  check('viewer nav = [grid, help] only', JSON.stringify(await navVisible()) === JSON.stringify(['grid', 'help']));
  check('viewer roleEscape button is hidden', await page.evaluate(() => { const e = document.getElementById('roleEscape'); return !e || getComputedStyle(e).display === 'none'; }));
  check('viewer changeDeviceRole() is a no-op', await page.evaluate(() => { const b = deviceRole(); try { changeDeviceRole(); } catch (e) {} return deviceRole() === b && b === 'viewer'; }));
  check('viewer forced nav("admin") does not land on admin', await page.evaluate(() => { try { nav('admin'); } catch (e) {} return curPage !== 'admin'; }));
  check('viewer forced nav("signup") does not land on signup', await page.evaluate(() => { try { nav('signup'); } catch (e) {} return curPage !== 'signup'; }));
  check('syncPush() has an explicit viewer guard', await page.evaluate(() => /viewer/.test(syncPush.toString())));
  check('syncPushFull() has an explicit viewer guard', await page.evaluate(() => typeof syncPushFull === 'function' && /viewer/.test(syncPushFull.toString())));
  // Behavioural: stub the Firebase ref and confirm a viewer save() attempt writes nothing.
  check('viewer save() does not write to the shared room', await page.evaluate(() => {
    let wrote = false;
    const realDb = Sync.db;
    Sync.db = { update: () => { wrote = true; return { catch() {} }; } };
    Sync.applying = false;
    try { syncPush(); } catch (e) {}
    Sync.db = realDb;
    return wrote === false;
  }));
  // No mutating control leaks onto the viewer lineups page.
  await page.evaluate(() => nav('grid'));
  await page.waitForTimeout(200);
  check('viewer lineups render no save()/admin onclick handlers', await page.evaluate(() => {
    const html = document.getElementById('page-grid').innerHTML;
    return !/onclick="[^"]*(save\(|del|register\(|archiveDay|setPin|resetAll|syncActivate)/.test(html);
  }));
  check('viewer lineups hide the operator controls (gridOps)', await page.evaluate(() => { const e = document.getElementById('gridOps'); return !e || getComputedStyle(e).display === 'none'; }));

  // ============================================================================
  console.log('\n=== 3. URL ?role= cannot silently promote a spectator ===');
  // Device is currently viewer with a PIN set. Editing the QR link to a privileged role
  // must be PIN-challenged (the escalation bug's sibling that came in via the URL).

  // 3a. viewer + ?role=scoring, wrong PIN → stays viewer.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '1234'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
  answer = (m) => { if (/admin PIN/i.test(m)) return '0000'; return true; };   // wrong PIN, accept other confirms
  await go(base + '?sync=LIVEROOM&role=scoring');
  await page.waitForTimeout(500);
  check('viewer + ?role=scoring + WRONG pin stays viewer', (await role()) === 'viewer', 'got ' + await role());

  // 3b. viewer + ?role=admin, no PIN given (dismiss) → stays viewer.
  resetDlg();
  await page.evaluate(() => { setDeviceRole('viewer'); });
  answer = () => false;   // dismiss the PIN prompt
  await go(base + '?sync=LIVEROOM&role=admin');
  await page.waitForTimeout(500);
  check('viewer + ?role=admin + dismissed pin stays viewer', (await role()) === 'viewer', 'got ' + await role());

  // 3c. viewer + ?role=scoring, CORRECT PIN → promotes (the intended recovery path).
  resetDlg();
  await page.evaluate(() => { setDeviceRole('viewer'); });
  answer = (m) => { if (/admin PIN/i.test(m)) return '1234'; return true; };
  await go(base + '?sync=LIVEROOM&role=scoring');
  await page.waitForTimeout(500);
  check('viewer + ?role=scoring + CORRECT pin recovers to scoring', (await role()) === 'scoring', 'got ' + await role());

  // 3d. Fresh device (default admin role) provisioning a staff link → no challenge.
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
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; save(); });   // no PIN → admin reachable
  for (const r of Object.keys(MATRIX)) {
    await page.evaluate((rr) => { setDeviceRole(rr); applyRole(); }, r);
    await page.waitForTimeout(80);
    const vis = await navVisible();
    check(`role=${r}: nav = [${MATRIX[r].join(',')}]`, JSON.stringify(vis) === JSON.stringify(MATRIX[r]), 'got [' + vis.join(',') + ']');
    // Try to force every DISALLOWED page and confirm we never land there.
    const leaked = await page.evaluate((allowed) => {
      const all = ['signup', 'grid', 'results', 'points', 'admin', 'help'];
      const bad = [];
      all.filter(p => !allowed.includes(p)).forEach(p => { try { nav(p); } catch (e) {} if (curPage === p) bad.push(p); });
      return bad;
    }, MATRIX[r]);
    check(`role=${r}: forced nav to disallowed pages all blocked`, leaked.length === 0, 'leaked: ' + leaked.join(','));
  }

  // admin page is PIN-gated once a PIN exists.
  resetDlg();
  await page.evaluate(() => { S.adminPin = '1234'; save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup'); });
  answer = () => false;   // dismiss/refuse the PIN prompt AND the "forgot it?" offer
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(200);
  check('admin page blocked when PIN prompt refused', await page.evaluate(() => curPage !== 'admin'));

  // ============================================================================
  console.log('\n=== 5. A locked STAFF device is always recoverable (no permanent lock) ===');
  // (The regression: removing the escape hatch bricked staff devices. A role link must
  //  still recover a non-viewer locked station.)
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('tv'); });
  await go(base + '?sync=LIVEROOM&role=register');
  await page.waitForTimeout(500);
  check('a stuck tv device recovers to register via a role link', (await role()) === 'register', 'got ' + await role());

  // ============================================================================
  console.log('\n=== 6. Forgotten admin PIN is recoverable (not a data-wiping dead end) ===');

  // 6a. Correct access code clears the PIN, keeps data.
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '1234';
    S.license = { code: 'TESTTRACK-0-ABCDEF', name: 'TESTTRACK', exp: '0' };
    S.roster = [{ id: 1, name: 'Keep', num: '9', noPoints: false }];
    save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup');
  });
  answer = (m) => {
    if (/Enter the admin PIN/i.test(m)) return '0000';                 // wrong PIN
    if (/Forgot it/i.test(m)) return true;                            // "try recovering"
    if (/access code to reset/i.test(m)) return 'TESTTRACK-0-ABCDEF'; // correct code
    return false;
  };
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(300);
  check('correct access code clears the PIN', await page.evaluate(() => S.adminPin === ''));
  check('PIN recovery keeps the driver book (no data loss)', await page.evaluate(() => (S.roster || []).length === 1));

  // 6b. Wrong code → destructive fallback offered → keeps the license through the wipe.
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '1234';
    S.license = { code: 'TESTTRACK-0-ABCDEF', name: 'TESTTRACK', exp: '0' };
    S.roster = [{ id: 1, name: 'Wipe', num: '9', noPoints: false }];
    save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup');
  });
  answer = (m) => {
    if (/Enter the admin PIN/i.test(m)) return '0000';
    if (/Forgot it/i.test(m)) return true;
    if (/access code to reset/i.test(m)) return 'NOPE-WRONG-CODE';
    if (/other way to recover/i.test(m)) return true;   // confirm the full reset
    return false;
  };
  await page.evaluate(() => { try { nav('admin'); } catch (e) {} });
  await page.waitForTimeout(300);
  check('wrong-code fallback wipes data', await page.evaluate(() => (S.roster || []).length === 0));
  check('wrong-code fallback KEEPS the license', await page.evaluate(() => S.license && S.license.code === 'TESTTRACK-0-ABCDEF'));

  // 6c. Correct PIN never triggers the recovery flow at all.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '1234'; save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup'); });
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
  // (Data-loss guard: broadened from entries-only to also protect a roster/track.)
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

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
