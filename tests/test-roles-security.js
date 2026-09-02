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
    const f = path.join(ROOT, urlPath === '/' ? 'raceday/index.html' : urlPath);
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

  // Keep this suite hermetic. It drives ~40 navigations through one page, and every load
  // also kicks off Chromium's own background chatter (fonts, autofill, connectivity
  // checks). On a sandboxed/offline runner those are rejected rather than simply failing,
  // and after enough of them the renderer dies — the whole suite then aborts mid-run with
  // "Target page, context or browser has been closed", which reads like a product bug and
  // is not one. Nothing here needs the network: serve localhost, refuse everything else.
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });

  // Stub Firebase before any page script runs. Several sections here enable sync, which
  // makes initSync() inject the real SDK from gstatic.com. Nothing in this suite is
  // testing Firebase itself, only local role/boot logic, so an empty-room stub keeps it
  // deterministic. Same pattern as test-cloud-backup.js / the Driven suites.
  await page.addInitScript(() => {
    window.firebase = {
      apps: [{}],
      database: () => ({
        ref: (p) => ({
          on: (ev, cb) => { cb({ val: () => (String(p).indexOf('tracks/') === 0 ? null : true) }); },
          off: () => {}, once: () => Promise.resolve({ val: () => null }),
          update: () => Promise.resolve(), set: () => Promise.resolve(), remove: () => Promise.resolve(),
        }),
      }),
    };
  });

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
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
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
  // A stuck spectator can get OUT to the marketing site — but that exit is pure
  // navigation, NEVER a role switch. It must not re-open the viewer→admin escalation
  // surface the app deliberately removed, so it carries no role-changing handler and
  // leaves rd_role untouched.
  check('viewer lineups show a "Leave spectator view" exit link to /?home=1', await page.evaluate(() => {
    const a = [...document.querySelectorAll('#page-grid a')].find(x => /home=1/.test(x.getAttribute('href') || ''));
    return !!a && /leave spectator/i.test(a.textContent);
  }));
  check('the spectator exit link is plain navigation, not a role switch', await page.evaluate(() => {
    const a = [...document.querySelectorAll('#page-grid a')].find(x => /home=1/.test(x.getAttribute('href') || ''));
    if (!a) return false;
    const oc = a.getAttribute('onclick') || '';
    return !/setDeviceRole|changeDeviceRole|rd_role/.test(oc) && deviceRole() === 'viewer';
  }));

  // ============================================================================
  console.log('\n=== 3. URL ?role= cannot silently promote a spectator ===');
  // Device is currently viewer with a PIN set. Editing the QR link to a privileged role
  // must be PIN-challenged (the escalation bug's sibling that came in via the URL).

  // 3a. viewer + ?role=scoring, wrong PIN → stays viewer.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); S.sync = { enabled: true, key: 'LIVEROOM' }; save(); setDeviceRole('viewer'); });
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
  await page.evaluate(() => { S.adminPin = pinHash('1234'); save(); setDeviceRole('admin'); sessionStorage.removeItem('rd_admin_ok'); nav('signup'); });
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
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234');
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
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234');
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

  // ============================================================================
  console.log('\n=== 8b. GUEST PASS: a spectator link is a session, not a state change ===');
  // (Live bug: a fan's phone that had ever seen ANY track kept re-showing that track's race
  //  after scanning a different track's QR poster. The first fix cleared the stale state
  //  before syncing; this is the real one — a ?role=viewer link now opens a GUEST session
  //  that starts from defaults(), lives only in memory, and is never written anywhere.
  //  Track operators race and travel: the device that runs their own track has to be able
  //  to look at somebody else's lineups with nothing at stake.)
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load();
    S.track.name = 'Old Track Speedway'; S.track.logo = 'data:image/png;base64,OLDLOGO';
    S.classes = [{ id: 1, name: 'Old Class', maxPill: 200 }];
    S.roster = [{ id: 1, name: 'Old Driver', num: '1', noPoints: false }];
    S.raceDay.entries = [{ driverId: 1, classId: 1, pill: 5 }];
    S.sync = { enabled: true, key: 'OLDTRACK' }; save(); setDeviceRole('viewer');
  });
  answer = () => false;   // dismiss anything shown — a guest join must never need a dialog at all
  await go(base + '?sync=NEWTRACK&role=viewer');
  await page.waitForTimeout(500);
  check('no confirm dialog is shown for a spectator link', dlgSeen.length === 0, JSON.stringify(dlgSeen));
  check('guest mode is active', await page.evaluate(() => GUEST === true));
  check('the old track name is gone', await page.evaluate(() => S.track.name === ''));
  check('the old class is gone', await page.evaluate(() => !S.classes.some(c => c.name === 'Old Class')));
  check('the old roster is gone', await page.evaluate(() => S.roster.length === 0));
  check('the old race-day entries are gone', await page.evaluate(() => S.raceDay.entries.length === 0));
  check('the device is now attached to the NEW track code', await page.evaluate(() => normKey(S.sync.key) === 'NEWTRACK'));
  check('the room is bookmarked so a fan lands back here', await page.evaluate(() => {
    try { const g = JSON.parse(localStorage.getItem('rd_guest_room') || 'null'); return !!(g && g.code === 'NEWTRACK'); } catch (e) { return false; }
  }));

  console.log('\n=== 8b′. A track\'s OWN device is untouched by looking at another track ===');
  // (The regression the earlier clean-reset fix could have introduced, and the reason
  //  guest mode exists at all: every printed spectator poster encodes role=viewer, so a
  //  track owner's own admin device scanning ANOTHER track's poster while visiting looked
  //  exactly like a random fan's phone. It must neither be wiped nor demoted — and with
  //  guest mode there is nothing to warn about, because its slot is never even opened.)
  resetDlg();
  // Seed from a NON-guest page: the previous section left this tab in a guest session,
  // where save() is correctly a no-op — seeding there would persist nothing and every
  // "your track survived" check below would pass vacuously against an empty slot.
  // Clearing also drops §8b's guest bookmark, so the reload lands as a normal device.
  await page.evaluate(() => localStorage.clear());
  await go(base);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    S = load();
    S.track.name = 'My Real Track'; S.roster = [{ id: 1, name: 'My Driver', num: '1', noPoints: false }];
    S.raceDay.entries = [{ driverId: 1, classId: 1, pill: 1 }];
    S.history = [{ date: '2026-08-01', savedAt: 1, classes: [{ name: 'Sport Mod', pointsRace: true, points: [{ driverId: 1, name: 'My Driver', num: '1', pts: 99 }] }] }];
    S.sync = { enabled: true, key: 'MYOWNROOM' }; save(); setDeviceRole('admin');
  });
  const homeBefore = await page.evaluate(() => localStorage.getItem('raceday_v1'));
  check('(guard) the home track really is persisted before we go visiting',
    !!homeBefore && homeBefore.indexOf('My Real Track') !== -1);
  const homeRoleBefore = await page.evaluate(() => localStorage.getItem('rd_role'));
  answer = () => false;
  await go(base + '?sync=SOMEONEELSESTRACK&role=viewer');
  await page.waitForTimeout(500);
  check('no dialog: an operator can just look, with nothing at stake', dlgSeen.length === 0, JSON.stringify(dlgSeen));
  check('the operator is a guest, viewing the other track', await page.evaluate(() => GUEST === true && normKey(S.sync.key) === 'SOMEONEELSESTRACK'));
  check("the operator's OWN stored track is byte-identical", await page.evaluate(() => localStorage.getItem('raceday_v1')) === homeBefore);
  check('the stored role key is untouched — no permanent demotion', await page.evaluate(() => localStorage.getItem('rd_role')) === homeRoleBefore);
  check("the guest does NOT inherit the home track's season history",
    await page.evaluate(() => S.history.length === 0), 'history leaked into the visited track');
  // Exercise save() directly. Nothing a guest can *reach* calls it (the sync path uses
  // persistLocal(), and every save() caller is admin-gated), so without this the guard
  // in save() has no coverage at all and a later refactor could drop it unnoticed.
  check('even calling save() outright during a guest session writes nothing',
    await page.evaluate((k) => { const b = localStorage.getItem(k); save(); return localStorage.getItem(k) === b; }, 'raceday_v1'));
  // Leaving is a plain reload with no params — nothing was stashed, so nothing can be
  // restored wrong; load() simply reads the untouched slot again.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.evaluate(() => leaveGuest()),
  ]);
  await page.waitForTimeout(400);
  check('leaving guest view brings the operator\'s own track back', await page.evaluate(() => S.track.name === 'My Real Track'), await page.evaluate(() => S.track.name));
  check('their roster survived', await page.evaluate(() => S.roster.length === 1));
  check('their entries survived', await page.evaluate(() => S.raceDay.entries.length === 1));
  check('their season history survived', await page.evaluate(() => S.history.length === 1));
  check('they are admin again, not a viewer', await page.evaluate(() => deviceRole() === 'admin'));
  check('guest mode is off', await page.evaluate(() => GUEST === false));

  console.log('\n=== 8b″. Provisioning a real staff station still warns before replacing ===');
  // (Guest mode must not swallow the warning where it belongs: a register/scoring/tv link
  //  genuinely does replace this device's race, and that is the intent.)
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load();
    S.track.name = 'My Real Track'; S.roster = [{ id: 1, name: 'My Driver', num: '1', noPoints: false }];
    S.sync = { enabled: true, key: 'MYOWNROOM' }; save(); setDeviceRole('admin');
  });
  let sawClobberWarning = false;
  answer = (m) => { if (/REPLACED by the cloud copy/i.test(m)) { sawClobberWarning = true; } return false; };
  await go(base + '?sync=SOMEONEELSESTRACK&role=scoring');
  await page.waitForTimeout(500);
  check('a scoring-station link still shows the replace warning', sawClobberWarning, JSON.stringify(dlgSeen));
  check('declining it keeps the device on its own room', await page.evaluate(() => normKey(S.sync.key) === 'MYOWNROOM'));
  check('declining it keeps the track name', await page.evaluate(() => S.track.name === 'My Real Track'));

  console.log('\n=== 8c. An empty/misconfigured room tells a spectator, instead of staying silently blank ===');
  // (Live bug: a poster printed before a code change, or a pruned room, left a viewer's
  //  screen either blank or — worse — on whatever the last track was, with zero indication
  //  anything was wrong. syncPushFull() is correctly a no-op for a viewer, but nothing used
  //  to tell the FAN that.)
  // Self-contained: scan a poster whose room is empty (the suite-wide Firebase stub
  // resolves every tracks/* room to null), which is exactly what a fan gets from a
  // poster printed before the track changed its sync code, or after a room is pruned.
  resetDlg();
  await page.evaluate(() => localStorage.clear());
  await go(base + '?sync=EMPTYROOM&role=viewer');
  await page.waitForTimeout(500);
  check('the spectator is a guest on the empty room', await page.evaluate(() => GUEST === true));
  check('Sync.joinFailed is set on an empty room for a viewer', await page.evaluate(() => Sync.joinFailed === true));
  const gridTxt = await page.textContent('#gridContent').catch(() => '');
  check('the grid shows a "couldn\'t connect" message instead of a silent blank', /couldn.t connect/i.test(gridTxt), gridTxt.slice(0, 120));
  check('a stranded fan still gets a way out', /leave (guest|spectator) view/i.test(gridTxt), gridTxt.slice(0, 160));

  // ============================================================================
  console.log('\n=== 9. Driver ids are collision-free across devices (multi-device sign-up) ===');
  // (The live bug: S.nextId was a PER-DEVICE counter, not synced, while roster IS synced —
  //  so two devices signing up at once minted the SAME id for different drivers, and
  //  driverById()'s first-match made entries resolve to the WRONG person, i.e. a name that
  //  "changed" mid-race. genDriverId() must draw from a wide random space, not a counter.)
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
  // A sequential counter would produce a span of ~2000; a wide random space spans decades
  // of orders of magnitude. This is what stops two independent devices from colliding.
  check('ids span a wide random space, NOT a sequential counter', (idStats.max - idStats.min) > 1e12, 'span=' + (idStats.max - idStats.min));
  // genDriverId never returns an id already on THIS device's roster.
  check('genDriverId() avoids ids already in the roster', await page.evaluate(() => {
    S.roster = [];
    const first = genDriverId();
    S.roster.push({ id: first, name: 'A', num: '1', noPoints: false });
    for (let i = 0; i < 500; i++) { const n = genDriverId(); if (n === first) return false; }
    return true;
  }));

  // ============================================================================
  console.log('\n=== 10. Operator PIN fails closed; ?role=operator requires OPERATOR_KEY ===');
  // (Phase 2 hardening: the Operator PIN used to auto-create itself on first use, so a
  //  fresh device wasn't proving it knew the owner's PIN — it just minted one. And
  //  ?role=operator was a bare, guessable URL param with no gate at all.)

  // 10a. No operator PIN set → opPinOk() denies and does NOT auto-create one.
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.operatorPin = ''; save(); setDeviceRole('operator'); });
  const opCheck1 = await page.evaluate(() => {
    const before = S.operatorPin;
    const ok = opPinOk('take control');
    return { before, after: S.operatorPin, ok };
  });
  check('opPinOk() with no PIN set returns false (fails closed)', opCheck1.ok === false);
  check('opPinOk() with no PIN set does NOT auto-create a PIN', opCheck1.before === '' && opCheck1.after === '');

  // 10b. setOperatorPin() sets one deliberately; opPinOk() then works with the right PIN.
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

  // 10c. ?role=operator with NO opk param does not grant operator role.
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base + '?sync=LIVEROOM&role=operator');
  await page.waitForTimeout(500);
  check('?role=operator with no opk stays off operator role', (await role()) === 'admin', 'got ' + await role());

  // 10d. ?role=operator with the WRONG opk does not grant operator role either.
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  await go(base + '?sync=LIVEROOM&role=operator&opk=wrong-key');
  await page.waitForTimeout(500);
  check('?role=operator with WRONG opk stays off operator role', (await role()) === 'admin', 'got ' + await role());

  // 10e. ?role=operator WITH the correct opk still grants operator role (regression check).
  resetDlg();
  answer = () => true;
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.sync = { enabled: true, key: 'LIVEROOM' }; save(); });
  const correctOpk = await page.evaluate(() => OPERATOR_KEY);
  await go(base + '?sync=LIVEROOM&role=operator&opk=' + encodeURIComponent(correctOpk));
  await page.waitForTimeout(500);
  check('?role=operator WITH correct opk grants operator role', (await role()) === 'operator', 'got ' + await role());

  // ============================================================================
  console.log('\n=== 11. Setup wizard stores a HASHED admin PIN (wizard-set PIN must unlock admin) ===');
  // (Live bug: Phase 1 moved adminOk() to hash comparison but the wizard's step 4 kept
  //  writing the PLAINTEXT pin — so a PIN set through first-run setup never validated
  //  and locked the owner out of their own admin tab immediately after setup.)
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
    hideModal('setupWizard');
    return { stored: S.adminPin, hashed: S.adminPin === pinHash('4321'), plain: S.adminPin === '4321' };
  });
  check('wizard-set PIN is stored hashed, not plaintext', wizPin.hashed && !wizPin.plain, 'stored=' + JSON.stringify(wizPin.stored));
  resetDlg();
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '4321'; return false; };
  check('adminOk() accepts a wizard-set PIN (no lockout)', await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); return adminOk(); }));
  check('no recovery prompt fired for the correct wizard-set PIN', !dlgSeen.some(m => /Forgot it|recovering/i.test(m)), dlgSeen.join(' | '));

  // ============================================================================
  console.log('\n=== 12. A hashed PIN SURVIVES a reload (migration must not re-hash it) ===');
  // (Live bug: defaults() was left at schemaVersion 2 when migration 3 — "hash plaintext
  //  PINs" — shipped. Every FRESH install therefore re-ran migration 3 on its next load
  //  and hashed the already-hashed PIN, locking the owner out with the CORRECT PIN.
  //  The guard: set a PIN on a fresh-defaults device, reload, correct PIN must unlock.)
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = pinHash('1234'); save(); });
  await go(base);   // reload → load() → migrate() runs against the freshly-defaulted state
  await page.waitForTimeout(300);
  check('stored PIN unchanged by the reload (no double-hash)', await page.evaluate(() => S.adminPin === pinHash('1234')), await page.evaluate(() => 'stored=' + S.adminPin + ' expected=' + pinHash('1234')));
  resetDlg();
  answer = (m) => { if (/Enter the admin PIN/i.test(m)) return '1234'; return false; };
  check('correct PIN still unlocks admin after a reload', await page.evaluate(() => { sessionStorage.removeItem('rd_admin_ok'); return adminOk(); }));
  check('defaults() schemaVersion matches the latest migration', await page.evaluate(() => { const d = defaults(); const m = migrate(JSON.parse(JSON.stringify(d))); return d.schemaVersion === m.schemaVersion; }));

  console.log('\n=== 13. A RESTORE must not strip this device\'s admin PIN ===');
  // (Caught in development: a cloud backup payload deliberately carries no PIN, and
  //  migrate() backfills a missing adminPin to ''. '' means "Admin is open to everyone"
  //  (adminOk), so a `== null` guard in the restore path silently unprotected the Admin
  //  tab on every cloud restore. The guard: restore a PIN-less payload, PIN must survive.)
  resetDlg();
  answer = () => true;   // accept the restore confirm
  const pinKept = await page.evaluate(() => {
    localStorage.clear(); S = load();
    S.track.name = 'T'; S.adminPin = pinHash('4321'); S.classes = [{ id: 1, name: 'X', maxPill: 20 }];
    S.license = { code: 'MY-LIC' }; save();
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));   // no adminPin by design
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
  // (Live bug: checkDayBanner() was the one banner missing the viewer self-guard its three
  //  siblings have, so the "Start a new race day" mutation button rendered for viewer. On a
  //  track with NO admin PIN configured, adminOk() had no role check at all and returned
  //  true unconditionally — so a spectator could tap it and archive/wipe the live race day.
  //  No existing test combined "viewer role" + "no PIN set" + an adminOk()-gated call.)

  // 14a. viewer, NO PIN set, real data sitting unarchived → dayBanner must stay hidden.
  resetDlg();
  await page.evaluate(() => {
    localStorage.clear(); S = load(); S.track.name = 'T'; S.adminPin = '';   // explicitly NO PIN
    S.raceDay = { date: '2020-01-01', entries: [{ driverId: 1, classId: 1, pill: 1 }], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    save(); setDeviceRole('viewer');
  });
  await go(base);
  await page.waitForTimeout(400);
  check('viewer + no PIN + stale race day: #dayBanner is hidden', await page.evaluate(() => {
    const b = document.getElementById('dayBanner');
    return !b || getComputedStyle(b).display === 'none';
  }));

  // 14b. Same state, but forcing checkDayBanner() to run again — still hidden.
  await page.evaluate(() => { checkDayBanner(); });
  check('viewer + no PIN: re-running checkDayBanner() keeps #dayBanner hidden', await page.evaluate(() => {
    const b = document.getElementById('dayBanner');
    return !b || getComputedStyle(b).display === 'none';
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
  // isolates adminOk() specifically: if adminOk() incorrectly let a viewer through, the
  // archive confirm would be accepted and archiveDay() would actually run.
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
  // (Secondary finding: renderGrid() only special-cased viewer; a tv-role device landing on
  //  the same grid page fell through to the full operator-style render, including the
  //  admin-gated "⏱ Qualifying times" button/openQualTimes/saveQualTimes/applyQualGrid.)
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
    return !document.getElementById('gridContent').innerHTML.includes('openQualTimes');
  }));
  check('tv role: gridOps toolbar (TV/print/import) is hidden', await page.evaluate(() => {
    const e = document.getElementById('gridOps'); return !e || getComputedStyle(e).display === 'none';
  }));
  resetDlg();
  answer = () => { throw new Error('should not prompt'); };
  check('tv role: openQualTimes() is a no-op with no PIN set (no prompt, no modal)', await page.evaluate(() => {
    openQualTimes(1);
    const m = document.getElementById('qualTimesModal');
    return !m || getComputedStyle(m).display === 'none';
  }));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
