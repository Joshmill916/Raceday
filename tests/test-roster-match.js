// Regression suite for the sign-up identity-merge bug (customer complaint, 2026-07-15):
// two DIFFERENT real people who happen to type the same name+kart number were being
// silently merged into ONE permanent roster record (findRosterMatch's exact-match
// branch had no safety check at all). The fix: only auto-merge on an explicit
// suggest()/pickRoster() pick — any other match requires a confirm() before merging,
// and declining creates a distinct new driver instead. See BACKLOG.md / the fix commit
// for the full root-cause writeup.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8797;
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
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));

  // Dispatching dialog handler (same pattern as test-roles-security.js): each test sets
  // `answer` to control accept ('OK'/true) vs. decline (false) per confirm() prompt.
  let answer = () => false;
  const dlgSeen = [];
  page.on('dialog', async d => {
    dlgSeen.push(d.message());
    let r;
    try { r = answer(d.message(), d.type()); } catch (e) { r = false; }
    if (r === true) await d.accept();
    else await d.dismiss();
  });
  const resetDlg = () => { dlgSeen.length = 0; answer = () => false; };

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Seed: skip the wizard, one class, admin role, no PIN.
  await page.evaluate(() => {
    S.track.name = 'Test Track';
    S.adminPin = '';
    save();
    setDeviceRole('admin');
    sessionStorage.setItem('rd_admin_ok', '1');
  });
  await page.reload();
  await page.waitForTimeout(300);
  const clsId = await page.evaluate(() => S.classes[0].id);
  const cls2Id = await page.evaluate(() => S.classes[1] ? S.classes[1].id : null);

  const signUpTyped = async (name, num, targetClsId) => {
    await page.evaluate(() => nav('signup'));
    await page.waitForTimeout(150);
    await page.evaluate(() => resetReg());
    await page.fill('#dName', name);
    await page.fill('#dNum', num);
    await page.evaluate(() => step2());
    await page.waitForTimeout(150);
    await page.click('#ch' + targetClsId);
    await page.waitForTimeout(100);
    const consent = await page.$('#consentChk');
    if (consent && !(await consent.isChecked())) await consent.check();
    await page.click('button:has-text("Draw my pills")');
    await page.waitForTimeout(200);
  };

  console.log('\n— Core regression: two different people, same name+number, in different classes, neither picks a suggestion —');
  resetDlg();
  answer = () => false;   // "no, different person" both times
  await signUpTyped('Chris Lee', '7', clsId);
  const afterFirst = await page.evaluate(() => ({ rosterLen: S.roster.length, entries: S.raceDay.entries.length }));
  check('first Chris Lee #7 registers with no prompt (brand-new name)', dlgSeen.length === 0, JSON.stringify(dlgSeen));

  // A second, genuinely different "Chris Lee #7" signs up for a DIFFERENT class — the
  // realistic collision (same name/number recur across classes at a busy race night).
  // Using the same class would additionally collide on the separate per-class
  // number-uniqueness rule, which isn't what this test is isolating.
  await signUpTyped('Chris Lee', '7', cls2Id);
  const afterSecond = await page.evaluate(() => ({ rosterLen: S.roster.length, entries: S.raceDay.entries.length }));
  check('second identical Chris Lee #7 (different class) triggers the confirm prompt', dlgSeen.some(m => m.includes('Chris Lee') && m.includes('7')), JSON.stringify(dlgSeen));
  check('declining creates a DISTINCT roster record (no silent merge)', afterSecond.rosterLen === afterFirst.rosterLen + 1, JSON.stringify({ afterFirst, afterSecond }));
  check('the two entries (one per class) have different driverIds', await page.evaluate(({ c1, c2 }) => {
    const d1 = S.raceDay.entries.find(e => e.classId === c1);
    const d2 = S.raceDay.entries.find(e => e.classId === c2);
    return !!d1 && !!d2 && d1.driverId !== d2.driverId;
  }, { c1: clsId, c2: cls2Id }));

  console.log('\n— Follow-up bug (found 2026-07-16): the "already entered" chip must stay clickable for an unconfirmed match —');
  // Customer report: a colliding name+number made a class chip permanently dead (no
  // id/onclick at all) even for someone who turned out to be a genuinely different
  // person — they couldn't even reach the confirm() prompt to say so. Jamie Fox #14
  // signs up for clsId; a second, different "Jamie Fox #14" must still be able to TAP
  // that same class chip (not just other classes) and get resolved via confirm().
  resetDlg();
  await signUpTyped('Jamie Fox', '14', clsId);
  check('first Jamie Fox #14 registers with no prompt', dlgSeen.length === 0, JSON.stringify(dlgSeen));
  const jamieId = await page.evaluate(() => S.roster.find(d => d.name === 'Jamie Fox').id);
  const rosterLenAfterJamie = await page.evaluate(() => S.roster.length);

  resetDlg();
  await page.evaluate(() => nav('signup'));
  await page.waitForTimeout(150);
  await page.evaluate(() => resetReg());
  await page.fill('#dName', 'Jamie Fox');
  await page.fill('#dNum', '14');
  await page.evaluate(() => step2());
  await page.waitForTimeout(150);
  const chipState = await page.evaluate((cid) => {
    const el = document.getElementById('ch' + cid);
    return { exists: !!el, hasOnclick: !!(el && el.getAttribute('onclick')) };
  }, clsId);
  check('the already-entered class chip still has an id (is clickable), not a dead span', chipState.exists && chipState.hasOnclick, JSON.stringify(chipState));

  if (cls2Id) {
    // Confirm "yes, same person" while selecting BOTH the already-entered class AND a
    // fresh one — the fresh class should register; the already-entered one must be
    // silently dropped, not duplicated.
    answer = () => true;
    await page.click('#ch' + clsId);
    await page.click('#ch' + cls2Id);
    await page.waitForTimeout(100);
    const consent = await page.$('#consentChk');
    if (consent && !(await consent.isChecked())) await consent.check();
    const entriesBeforeJamie2 = await page.evaluate(() => S.raceDay.entries.length);
    await page.click('button:has-text("Draw my pills")');
    await page.waitForTimeout(200);
    check('exactly one confirm prompt fired', dlgSeen.length === 1, JSON.stringify(dlgSeen));
    check('no new roster record (merged into the same Jamie Fox)', await page.evaluate((n) => S.roster.length === n, rosterLenAfterJamie));
    check('entries grew by exactly 1 (the new class only, no duplicate in clsId)', await page.evaluate((n) => S.raceDay.entries.length === n + 1, entriesBeforeJamie2));
    check('Jamie Fox has exactly one entry in the already-entered class', await page.evaluate(({ jid, cid }) => S.raceDay.entries.filter(e => e.driverId === jid && e.classId === cid).length === 1, { jid: jamieId, cid: clsId }));
    check('Jamie Fox now also has an entry in the new class', await page.evaluate(({ jid, cid }) => S.raceDay.entries.some(e => e.driverId === jid && e.classId === cid), { jid: jamieId, cid: cls2Id }));
  }

  // Confirming "yes" while selecting ONLY the already-entered class must show a clean
  // error, not a silent no-op and not a duplicate entry.
  resetDlg();
  await page.evaluate(() => nav('signup'));
  await page.waitForTimeout(150);
  await page.evaluate(() => resetReg());
  await page.fill('#dName', 'Jamie Fox');
  await page.fill('#dNum', '14');
  await page.evaluate(() => step2());
  await page.waitForTimeout(150);
  answer = () => true;
  await page.click('#ch' + clsId);
  await page.waitForTimeout(100);
  const consent3 = await page.$('#consentChk');
  if (consent3 && !(await consent3.isChecked())) await consent3.check();
  const entriesBeforeDupOnly = await page.evaluate(() => S.raceDay.entries.length);
  await page.click('button:has-text("Draw my pills")');
  await page.waitForTimeout(200);
  const errText = await page.evaluate(() => document.getElementById('e2').textContent);
  check('selecting only the already-entered class shows a clear error', /already entered/i.test(errText), errText);
  check('no duplicate entry was created', await page.evaluate((n) => S.raceDay.entries.length === n, entriesBeforeDupOnly));

  console.log('\n— Explicit pick still merges with zero friction —');
  resetDlg();
  await signUpTyped('Pat Rivera', '21', clsId);
  check('brand-new Pat Rivera registers with no prompt', dlgSeen.length === 0, JSON.stringify(dlgSeen));
  const patId = await page.evaluate(() => S.roster.find(d => d.name === 'Pat Rivera').id);
  const rosterLenAfterPat = await page.evaluate(() => S.roster.length);

  resetDlg();
  await page.evaluate(() => nav('signup'));
  await page.waitForTimeout(150);
  await page.evaluate(() => resetReg());
  await page.fill('#dName', 'Pat');   // triggers suggest()
  await page.waitForTimeout(150);
  await page.evaluate((id) => pickRoster(id), patId);
  await page.waitForTimeout(150);
  const fieldsAfterPick = await page.evaluate(() => ({ name: document.getElementById('dName').value, num: document.getElementById('dNum').value }));
  check('pickRoster() fills both fields from the roster record', fieldsAfterPick.name === 'Pat Rivera' && fieldsAfterPick.num === '21', JSON.stringify(fieldsAfterPick));
  if (cls2Id) {
    // Pick a class Pat isn't in yet, same as the earlier real fix — signing into a
    // SECOND class via an explicit pick must stay frictionless (no confirm at all).
    await page.click('#ch' + cls2Id);
    await page.waitForTimeout(100);
    const consent = await page.$('#consentChk');
    if (consent && !(await consent.isChecked())) await consent.check();
    await page.click('button:has-text("Draw my pills")');
    await page.waitForTimeout(200);
    check('explicit pick registers with NO confirm prompt', dlgSeen.length === 0, JSON.stringify(dlgSeen));
    const afterPickReg = await page.evaluate(() => S.roster.length);
    check('no new roster record created (merged into the same driver)', afterPickReg === rosterLenAfterPat, 'roster length ' + afterPickReg);
    check('new entry uses the SAME driverId as the original Pat Rivera', await page.evaluate((pid) => S.raceDay.entries.some(e => e.driverId === pid), patId));
  } else {
    console.log('  (skipped — only one class configured)');
  }

  console.log('\n— Changed number for a driver NOT yet racing today, via explicit pick — one confirm, no duplicate —');
  // findRosterMatch only returns a name-match-with-a-different-number as the SAME
  // record when that record has no entries yet today (its "racingToday" guard) — so
  // this scenario needs a roster record that exists (e.g. from a prior day) but hasn't
  // signed in yet today, not a driver who already raced earlier in this same test run.
  const jordanId = await page.evaluate(() => {
    const id = 900001;
    S.roster.push({ id, name: 'Jordan Kim', num: '15', noPoints: false });
    save();
    return id;
  });
  resetDlg();
  await page.evaluate(() => nav('signup'));
  await page.waitForTimeout(150);
  await page.evaluate(() => resetReg());
  await page.fill('#dName', 'Jordan');   // triggers suggest(), should surface Jordan Kim #15
  await page.waitForTimeout(150);
  await page.evaluate((id) => pickRoster(id), jordanId);
  await page.waitForTimeout(150);
  await page.evaluate(() => showStep(1));   // simulate tapping "← Back" to correct the number
  await page.fill('#dNum', '77');   // fires the new oninput, clears pickedRosterId — re-arms the gate
  await page.evaluate(() => step2());
  await page.waitForTimeout(150);
  answer = () => true;   // "yes, that's me"
  const rosterLenBeforeJordan = await page.evaluate(() => S.roster.length);
  const entriesBefore = await page.evaluate(() => S.raceDay.entries.length);
  await page.click('#ch' + clsId);
  await page.waitForTimeout(100);
  const consent2 = await page.$('#consentChk');
  if (consent2 && !(await consent2.isChecked())) await consent2.check();
  await page.click('button:has-text("Draw my pills")');
  await page.waitForTimeout(200);
  check('exactly one confirm prompt fired after editing the number post-pick', dlgSeen.length === 1, JSON.stringify(dlgSeen));
  check('no new roster record — merged into the existing Jordan Kim, number updated', await page.evaluate(({ jid, before }) => {
    const d = S.roster.find(x => x.id === jid);
    return S.roster.length === before && d && d.num === '77';
  }, { jid: jordanId, before: rosterLenBeforeJordan }));
  check('entries grew by exactly 1 (merge, not duplicate)', await page.evaluate((n) => S.raceDay.entries.length === n + 1, entriesBefore));
  check('the new entry points at the ORIGINAL Jordan Kim driverId', await page.evaluate((jid) => S.raceDay.entries.some(e => e.driverId === jid), jordanId));

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
