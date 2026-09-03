// Cloud backup + restore-by-code.
//
// The invariant this suite exists for: the uploaded payload must NEVER carry credentials
// (PIN hashes, license code), the admin audit log, or the participant consent records —
// consents store public IP addresses, and driver records include minors in junior classes.
// cloudBackupPayload() is an allowlist so new state fields don't leak by default; the
// sentinel checks below fail loudly if someone turns it back into a denylist or adds a
// secret to one of the allowed branches.
//
// Second invariant: the feature is OFF until a track turns it on, including for every
// track that existed before it shipped.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8801;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
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

  const base = `http://localhost:${PORT}/`;
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await go(base);
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.clear());
  await go(base);
  await page.waitForTimeout(500);

  // ============================================================================
  console.log('\n=== 1. Off by default, and off for tracks that predate the feature ===');
  check('fresh install has cloud backup off', await page.evaluate(() => S.settings.cloudBackup === false));
  check('cloudBackupOn() false on a fresh install', await page.evaluate(() => cloudBackupOn() === false));

  const migrated = await page.evaluate(() => {
    // A v7 state — the version right before cloud backup shipped.
    const old = JSON.parse(JSON.stringify(S));
    old.schemaVersion = 7;
    delete old.settings.cloudBackup;
    delete old.lastCloudBackupAt;
    const m = migrate(old);
    return { v: m.schemaVersion, flag: m.settings.cloudBackup, stamp: m.lastCloudBackupAt };
  });
  check('migration bumps to schemaVersion 8', migrated.v === 8, JSON.stringify(migrated));
  check('migration leaves cloud backup OFF (never opts a track in)', migrated.flag === false, JSON.stringify(migrated));
  check('migration backfills lastCloudBackupAt', migrated.stamp === 0, JSON.stringify(migrated));

  // ============================================================================
  console.log('\n=== 2. THE KEY INVARIANT: the payload carries no secrets ===');
  resetDlg();
  // Seed every sensitive field with a sentinel we can search for in the serialized payload.
  await page.evaluate(() => {
    S.track.name = 'Test Speedway';
    S.classes = [{ id: 1, name: 'Junior Sprint', maxPill: 20 }];
    S.roster = [{ id: 101, name: 'Ann Ash', num: '1', noPoints: false }];
    S.adminPin = 'SENTINEL_ADMIN_PIN_HASH';
    S.operatorPin = 'SENTINEL_OPERATOR_PIN_HASH';
    // Skip the PIN prompt so dialog assertions below see the feature's own dialogs.
    sessionStorage.setItem('rd_admin_ok', '1');
    S.license = { code: 'SENTINEL-LICENSE-CODE', name: 'Test', tier: 'season' };
    S.trialDays = 42;
    S.licUse = { packets: 7 };
    S.consents = [{ ts: 1, driver: 'Ann Ash', num: '1', ip: 'SENTINEL_IP_1_2_3_4', accepted: true }];
    S.audit = [{ ts: 1, action: 'SENTINEL_AUDIT_ACTION', user: 'admin' }];
    S.sync = { enabled: true, key: 'SENTINEL_SYNC_KEY' };
    S.settings.cloudBackup = true;
    save();
  });

  const scrub = await page.evaluate(() => {
    const p = cloudBackupPayload();
    const json = JSON.stringify(p);
    const sentinels = ['SENTINEL_ADMIN_PIN_HASH', 'SENTINEL_OPERATOR_PIN_HASH', 'SENTINEL-LICENSE-CODE',
                       'SENTINEL_IP_1_2_3_4', 'SENTINEL_AUDIT_ACTION', 'SENTINEL_SYNC_KEY'];
    return {
      leaked: sentinels.filter(x => json.indexOf(x) !== -1),
      keys: Object.keys(p),
      hasRaceData: !!(p.raceDay && p.classes && p.roster && p.history !== undefined),
      rosterName: p.roster && p.roster[0] && p.roster[0].name,
      settingsHasFlag: p.settings ? ('cloudBackup' in p.settings) : 'no settings',
      trialDays: p.trialDays, licUse: p.licUse
    };
  });
  check('no sentinel secret appears anywhere in the payload', scrub.leaked.length === 0, 'LEAKED: ' + JSON.stringify(scrub.leaked));
  check('payload has no adminPin/operatorPin/license/consents/audit/sync keys',
    !['adminPin', 'operatorPin', 'license', 'consents', 'audit', 'sync', 'trialDays', 'licUse'].some(k => scrub.keys.includes(k)),
    JSON.stringify(scrub.keys));
  check('payload still carries the race data worth restoring', scrub.hasRaceData && scrub.rosterName === 'Ann Ash', JSON.stringify(scrub));
  check('the cloudBackup flag itself is stripped (a restore cannot silently re-enable uploads)',
    scrub.settingsHasFlag === false, String(scrub.settingsHasFlag));

  // ============================================================================
  console.log('\n=== 3. Nothing uploads unless the track opted in ===');
  resetDlg();
  const gated = await page.evaluate(async () => {
    const out = {};
    S.settings.cloudBackup = false;
    out.whenOff = await backupToCloud('test');
    S.settings.cloudBackup = true;
    S.demo = true;
    out.whenDemo = await backupToCloud('test');
    S.demo = false;
    return out;
  });
  check('backupToCloud() is a no-op when the toggle is off', gated.whenOff === false, String(gated.whenOff));
  check('backupToCloud() is a no-op in demo mode', gated.whenDemo === false, String(gated.whenDemo));

  console.log('\n=== 4. Turning it on requires an explicit yes ===');
  resetDlg();
  answer = () => false;   // dismiss the confirm
  const declined = await page.evaluate(() => {
    S.settings.cloudBackup = false;
    const el = { checked: true };
    toggleCloudBackup(el);
    return { flag: S.settings.cloudBackup, box: el.checked };
  });
  check('declining the confirm leaves it off', declined.flag === false, JSON.stringify(declined));
  check('declining unticks the checkbox', declined.box === false, JSON.stringify(declined));
  check('the confirm says what is and is not sent',
    dlgSeen.some(m => /never sent/i.test(m) && /admin PIN/i.test(m)), JSON.stringify(dlgSeen));

  resetDlg();
  answer = () => true;
  const accepted = await page.evaluate(() => {
    const el = { checked: true };
    toggleCloudBackup(el);
    return S.settings.cloudBackup;
  });
  check('accepting the confirm turns it on', accepted === true);

  // ============================================================================
  console.log('\n=== 5. Restore keeps this device\'s own license and PIN ===');
  resetDlg();
  answer = () => true;
  const restored = await page.evaluate(() => {
    S.adminPin = 'MY_OWN_PIN';
    S.license = { code: 'MY-OWN-LICENSE', name: 'Mine', tier: 'season' };
    S.trialDays = 3;
    save();
    // A cloud payload: race data only, no license/PIN — exactly what the vault holds.
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));
    incoming.roster = [{ id: 202, name: 'Restored Racer', num: '9', noPoints: false }];
    const ok = applyRestoredState(incoming, 'a test backup');
    return { ok, pin: S.adminPin, lic: S.license && S.license.code, trial: S.trialDays,
             roster: S.roster.map(r => r.name) };
  });
  check('restore applied', restored.ok === true, JSON.stringify(restored));
  check('race data was replaced by the backup', restored.roster.join() === 'Restored Racer', JSON.stringify(restored));
  check('device keeps its own admin PIN', restored.pin === 'MY_OWN_PIN', String(restored.pin));
  check('device keeps its own license', restored.lic === 'MY-OWN-LICENSE', String(restored.lic));
  check('device keeps its own trial days', restored.trial === 3, String(restored.trial));

  console.log('\n=== 5b. A backup with a blank track name warns specifically, before erasing a real one ===');
  // (Live bug: a track restored a backup — from an earlier test/reset iteration on the same
  //  device — that had a blank track.name, and lost their real track's name with zero
  //  warning that this was about to happen. The generic "race data will be replaced" confirm
  //  never mentions track identity at all.)
  resetDlg();
  let sawBlankWarning = false;
  answer = (m) => { if (/no track name saved in it/i.test(m)) { sawBlankWarning = true; return false; } return true; };
  const declinedBlank = await page.evaluate(() => {
    S.track.name = 'Thunder Ridge Speedway'; save();
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));
    incoming.track.name = '';   // exactly what an early/test backup looks like
    const ok = applyRestoredState(incoming, 'a blank-track backup');
    return { ok, trackName: S.track.name };
  });
  check('the blank-track-name warning fires (not the generic one)', sawBlankWarning, JSON.stringify(dlgSeen));
  check('declining it leaves the restore unapplied', declinedBlank.ok === false, JSON.stringify(declinedBlank));
  check('the real track name survives a declined blank-name restore', declinedBlank.trackName === 'Thunder Ridge Speedway', declinedBlank.trackName);

  resetDlg();
  answer = () => true;   // this time accept the blank-name warning — the owner's call to make
  const acceptedBlank = await page.evaluate(() => {
    S.track.name = 'Thunder Ridge Speedway'; save();
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));
    incoming.track.name = '';
    const ok = applyRestoredState(incoming, 'a blank-track backup');
    return { ok, trackName: S.track.name };
  });
  check('accepting the blank-name warning still applies the restore', acceptedBlank.ok === true, JSON.stringify(acceptedBlank));

  console.log('\n=== 5c. A malformed backup fails cleanly instead of half-applying ===');
  resetDlg();
  answer = () => true;
  const malformed = await page.evaluate(() => {
    S.track.name = 'Thunder Ridge Speedway'; save();
    // Missing settings entirely — migrate() dereferences s.settings.points and throws.
    const incoming = JSON.parse(JSON.stringify(cloudBackupPayload()));
    delete incoming.settings;
    const ok = applyRestoredState(incoming, 'a corrupted backup');
    return { ok, trackName: S.track.name };
  });
  check('a backup missing settings is rejected, not thrown', malformed.ok === false, JSON.stringify(malformed));
  check('user is told the backup looks corrupted', dlgSeen.some(m => /corrupted or incomplete/i.test(m)), JSON.stringify(dlgSeen));
  check('the device state survives a failed restore intact', malformed.trackName === 'Thunder Ridge Speedway', malformed.trackName);

  console.log('\n=== 6. A junk payload is refused ===');
  resetDlg();
  answer = () => true;
  const junk = await page.evaluate(() => applyRestoredState({ hello: 'world' }, 'junk'));
  check('a payload with no raceDay/classes is rejected', junk === false);
  check('user is told why', dlgSeen.some(m => /isn't a RaceDay backup/i.test(m)), JSON.stringify(dlgSeen));

  console.log('\n=== 7. Restore code input is validated before any network call ===');
  resetDlg();
  answer = () => true;
  const codeChecks = await page.evaluate(() => {
    const inp = document.getElementById('cloudRestoreCode');
    const out = {};
    inp.value = '';       restoreFromCloudCode(); out.empty = true;
    inp.value = 'a b!!';  restoreFromCloudCode(); out.bad = true;
    inp.value = '';
    return out;
  });
  check('empty code is caught', codeChecks.empty && dlgSeen.some(m => /Enter the restore code/i.test(m)), JSON.stringify(dlgSeen));
  check('malformed code is caught', codeChecks.bad && dlgSeen.some(m => /doesn't look like a restore code/i.test(m)), JSON.stringify(dlgSeen));

  // ============================================================================
  console.log('\n=== 8. Database rules keep the vault write-only ===');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  const tb = rules.trackBackups && rules.trackBackups.$trackId;
  check('trackBackups exists', !!tb);
  check('trackBackups is NOT publicly readable', tb && tb['.read'] === false, JSON.stringify(tb && tb['.read']));
  check('latest slot is writable', tb && tb.latest && tb.latest['.write'] === true);
  check('daily slot is writable', tb && tb.daily && tb.daily.$date && tb.daily.$date['.write'] === true);
  check('unknown fields are rejected by validation', tb && tb.latest && tb.latest.$other && tb.latest.$other['.validate'] === false);
  check('restores node is read-only to clients',
    rules.restores && rules.restores.$code['.read'] === true && rules.restores.$code['.write'] === false,
    JSON.stringify(rules.restores));
  // backupTracks is the tiny index pruneOldBackups (functions/index.js) reads to
  // enumerate tracks without downloading every track's actual backup payload.
  const bt = rules.backupTracks && rules.backupTracks.$trackId;
  check('backupTracks exists', !!bt);
  check('backupTracks is NOT publicly readable', bt && bt['.read'] === false, JSON.stringify(bt && bt['.read']));
  check('backupTracks is writable (clients set their own flag)', bt && bt['.write'] === true);
  check('backupTracks only accepts booleans', bt && /isBoolean/.test(bt['.validate'] || ''), JSON.stringify(bt && bt['.validate']));

  console.log('\n=== 9. backupToCloud() writes the prune index alongside the backup ===');
  resetDlg();
  const writes = await page.evaluate(() => {
    // Stub window.firebase so backupToCloud()'s own ensureFirebase() call short-circuits
    // (loadFirebase() resolves immediately once window.firebase.database already exists)
    // and every .set() call is recorded instead of hitting the network.
    const calls = [];
    const fakeRef = (path) => ({ set: (v) => { calls.push({ path, v }); return Promise.resolve(); } });
    const realFirebase = window.firebase;
    window.firebase = { database: () => ({ ref: fakeRef }), apps: [{}] };
    S.settings.cloudBackup = true;
    S.demo = false;
    return backupToCloud('test').then(() => {
      window.firebase = realFirebase;
      return calls.map(c => c.path);
    }).catch(e => { window.firebase = realFirebase; return 'ERROR: ' + e.message; });
  });
  check('writes latest, a dated daily entry, and the backupTracks index',
    Array.isArray(writes) && writes.some(p => /\/latest$/.test(p)) && writes.some(p => /\/daily\//.test(p)) && writes.some(p => /^backupTracks\//.test(p)),
    JSON.stringify(writes));

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` cloud-backup: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
