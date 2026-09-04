// Regression suite for the sign-up identity-merge bug — v2 port of
// tests/test-roster-match.js. Two DIFFERENT real people who happen to type the same
// name+car number must never be silently merged into ONE permanent roster record; only
// an explicit suggest()/pickRoster() pick auto-merges. Any other match requires a
// confirm() before merging, and declining creates a distinct new driver instead.
//
// findRosterMatch()/register()/pickRoster() are copied verbatim from v1 — confirmed by
// direct read. The REAL adaptation here (not just a rename): v2's sign-up is a single
// screen, not v1's 3-step wizard — step2()/showStep() don't exist in v2 at all (zero
// matches on grep). Chips render live as you type (#dName→suggest(), #dNum→
// signupTyped(), both call renderChips() directly, no gating step), so every step2()
// call from v1's helper is simply deleted, and the "tap Back to edit" simulation
// (showStep(1)) isn't needed either — refilling #dNum directly fires its own oninput,
// which is all v1's Back-tap was standing in for.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8820;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'text/plain' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));

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
  answer = () => false;
  await signUpTyped('Chris Lee', '7', clsId);
  const afterFirst = await page.evaluate(() => ({ rosterLen: S.roster.length, entries: S.raceDay.entries.length }));
  check('first Chris Lee #7 registers with no prompt (brand-new name)', dlgSeen.length === 0, JSON.stringify(dlgSeen));

  await signUpTyped('Chris Lee', '7', cls2Id);
  const afterSecond = await page.evaluate(() => ({ rosterLen: S.roster.length, entries: S.raceDay.entries.length }));
  check('second identical Chris Lee #7 (different class) triggers the confirm prompt', dlgSeen.some(m => m.includes('Chris Lee') && m.includes('7')), JSON.stringify(dlgSeen));
  check('declining creates a DISTINCT roster record (no silent merge)', afterSecond.rosterLen === afterFirst.rosterLen + 1, JSON.stringify({ afterFirst, afterSecond }));
  check('the two entries (one per class) have different driverIds', await page.evaluate(({ c1, c2 }) => {
    const d1 = S.raceDay.entries.find(e => e.classId === c1);
    const d2 = S.raceDay.entries.find(e => e.classId === c2);
    return !!d1 && !!d2 && d1.driverId !== d2.driverId;
  }, { c1: clsId, c2: cls2Id }));

  console.log('\n— A car number only has to be unique per DRIVER, not per class (customer report, 2026-09-03) —');
  // Bug: two DIFFERENT drivers in the SAME class couldn't share a car number at all — the
  // number-uniqueness guard blocked on the number alone, regardless of name, when it
  // should only ever block a genuine identity conflict (same name AND same number).
  resetDlg();
  await signUpTyped('Robin Diaz', '9', clsId);
  check('first Robin Diaz #9 registers with no prompt', dlgSeen.length === 0, JSON.stringify(dlgSeen));
  const beforeSameNumber = await page.evaluate(() => ({ rosterLen: S.roster.length, entries: S.raceDay.entries.length }));
  await signUpTyped('Morgan Price', '9', clsId);   // different name, SAME number, SAME class
  check('a different-named driver reusing #9 in the SAME class is allowed, no confirm needed',
    dlgSeen.length === 0, JSON.stringify(dlgSeen));
  check('a distinct roster record was created (not merged)', await page.evaluate((n) => S.roster.length === n + 1, beforeSameNumber.rosterLen));
  check('both #9 entries exist in the same class', await page.evaluate(({ cid, before }) => {
    const nines = S.raceDay.entries.filter(e => e.classId === cid && String(driverById(e.driverId).num) === '9');
    return nines.length === 2 && S.raceDay.entries.length === before + 1;
  }, { cid: clsId, before: beforeSameNumber.entries }));

  // An IDENTICAL name+number in the same class is still a genuine conflict — reached by
  // declining "is this the same person?" (a coincidence: a different person, same name
  // AND number). That's the one case still refused.
  resetDlg();
  answer = () => false;
  const beforeIdentical = await page.evaluate(() => S.raceDay.entries.length);
  await signUpTyped('Robin Diaz', '9', clsId);
  check('an identical name+number IS still refused as a genuine conflict',
    /already racing/i.test(await page.evaluate(() => document.getElementById('e2').textContent)));
  check('no entry was created for the refused duplicate', await page.evaluate((n) => S.raceDay.entries.length === n, beforeIdentical));

  console.log('\n— Follow-up bug: the "already entered" chip must stay clickable for an unconfirmed match —');
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
  await page.waitForTimeout(150);
  const chipState = await page.evaluate((cid) => {
    const el = document.getElementById('ch' + cid);
    return { exists: !!el, hasOnclick: !!(el && el.getAttribute('onclick')) };
  }, clsId);
  check('the already-entered class chip still has an id (is clickable), not a dead span', chipState.exists && chipState.hasOnclick, JSON.stringify(chipState));

  if (cls2Id) {
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

  resetDlg();
  await page.evaluate(() => nav('signup'));
  await page.waitForTimeout(150);
  await page.evaluate(() => resetReg());
  await page.fill('#dName', 'Jamie Fox');
  await page.fill('#dNum', '14');
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
  await page.fill('#dName', 'Pat');
  await page.waitForTimeout(150);
  await page.evaluate((id) => pickRoster(id), patId);
  await page.waitForTimeout(150);
  const fieldsAfterPick = await page.evaluate(() => ({ name: document.getElementById('dName').value, num: document.getElementById('dNum').value }));
  check('pickRoster() fills both fields from the roster record', fieldsAfterPick.name === 'Pat Rivera' && fieldsAfterPick.num === '21', JSON.stringify(fieldsAfterPick));
  if (cls2Id) {
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
  await page.fill('#dName', 'Jordan');
  await page.waitForTimeout(150);
  await page.evaluate((id) => pickRoster(id), jordanId);
  await page.waitForTimeout(150);
  // v1 simulated tapping "← Back" here (showStep(1)) to re-edit the number after a pick;
  // v2 has no step to go back to — refilling #dNum directly fires signupTyped(), which
  // is exactly what clears pickedRosterId and re-arms the match gate.
  await page.fill('#dNum', '77');
  await page.waitForTimeout(150);
  answer = () => true;
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

  console.log('\n— Consent is recorded ONCE per driver per day, not once per class entered —');
  if (cls2Id) {
    resetDlg();
    const consentsBefore = await page.evaluate(() => (S.consents || []).length);
    await page.evaluate(() => nav('signup'));
    await page.waitForTimeout(150);
    await page.evaluate(() => resetReg());
    await page.fill('#dName', 'Multi Class Driver');
    await page.fill('#dNum', '88');
    await page.waitForTimeout(150);
    await page.click('#ch' + clsId);
    await page.click('#ch' + cls2Id);
    await page.waitForTimeout(100);
    const consent4 = await page.$('#consentChk');
    if (consent4 && !(await consent4.isChecked())) await consent4.check();
    await page.click('button:has-text("Draw my pills")');
    await page.waitForTimeout(200);
    check('exactly ONE consent record was added, not one per selected class',
      await page.evaluate((n) => (S.consents || []).length === n + 1, consentsBefore));
    check('both classes were still entered', await page.evaluate(() => {
      const d = S.roster.find(r => r.name === 'Multi Class Driver');
      return d && S.raceDay.entries.filter(e => e.driverId === d.id).length === 2;
    }));
  } else {
    console.log('  (skipped — only one class configured)');
  }

  await browser.close();
  server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
