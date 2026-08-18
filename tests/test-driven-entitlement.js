// Driven Pro subscription entitlement system — built after tests/test-profiles.js was
// last touched, so it had zero automated coverage until now. Manually verified correct
// by hand in an earlier audit this session; this suite pins that down for real.
//
// Written with an INDEPENDENT reference model for the grace-window math (the same
// approach test-season-points.js used for points) — refTier() below reimplements
// entitlementTierKey()/currentTier()'s logic from scratch, so this can actually catch a
// regression in the real functions rather than just confirming the code agrees with
// itself.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8823;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
// Independent reimplementation of entitlementTierKey() + currentTier()'s union logic —
// deliberately not calling the app's own functions to compute the expected answer.
function refTier(offlineTier, entitlement, nowMs) {
  const rank = t => (t === 'pro' ? 10 : 0);
  const offlineRank = rank(offlineTier === 'pro' ? 'pro' : 'free');
  let entTier = 'free';
  if (entitlement) {
    const age = nowMs - (entitlement.checkedAt || 0);
    if (age <= GRACE_MS && (entitlement.tier === 'free' || entitlement.tier === 'pro')) entTier = entitlement.tier;
  }
  const entRank = rank(entTier);
  return entRank > offlineRank ? entTier : (offlineTier === 'pro' ? 'pro' : 'free');
}

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath === '/' ? 'driven/index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(urlPath);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
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

  const base = `http://localhost:${PORT}/`;
  const go = (u) => page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await go(base + 'driven/index.html');
  await page.waitForTimeout(400);

  // Seed a profile directly (skip onboarding UI — not what this suite is testing).
  await page.evaluate(() => {
    localStorage.clear();
    P = newProfile('Test Driver', '', '', null);
    P.profileId = 'prof_entitlementtest01';
    save();
  });
  await page.waitForTimeout(200);

  // ============================================================================
  console.log('\n=== 1. Grace-window boundary, checked against an INDEPENDENT reference model ===');

  const seedAndCheck = async (offlineTier, entTier, ageMs, label) => {
    const result = await page.evaluate(({ offlineTier, entTier, ageMs }) => {
      const now = Date.now();
      P.tier = offlineTier;
      P.entitlement = entTier == null ? null : { tier: entTier, status: 'active', currentPeriodEnd: 0, checkedAt: now - ageMs };
      save();
      return { actual: currentTier().key, now };
    }, { offlineTier, entTier, ageMs });
    const expected = refTier(offlineTier, entTier == null ? null : { tier: entTier, checkedAt: result.now - ageMs }, result.now);
    check(label, result.actual === expected, `got ${result.actual}, expected ${expected}`);
  };

  await seedAndCheck('free', 'pro', 0, 'entitlement checked just now (age 0): pro, fresh');
  await seedAndCheck('free', 'pro', GRACE_MS, 'entitlement at EXACTLY the grace boundary: still valid (comparison is strict >)');
  await seedAndCheck('free', 'pro', GRACE_MS + 2000, 'entitlement 2s past the grace boundary: expired, falls back to free');
  await seedAndCheck('free', 'pro', GRACE_MS * 3, 'entitlement long expired: free');
  await seedAndCheck('free', null, 0, 'no entitlement at all (never checked): free');

  console.log('\n=== 2. Tier union: offline code and server entitlement are independent unlock paths ===');
  await seedAndCheck('pro', null, 0, 'offline pro code, no server entitlement: still pro (offline trusted permanently)');
  await seedAndCheck('pro', 'free', 0, 'offline pro code, fresh entitlement says free: pro wins (higher rank)');
  await seedAndCheck('free', 'pro', GRACE_MS + 2000, 'offline free, entitlement pro but EXPIRED: free (expired entitlement contributes nothing)');
  await seedAndCheck('pro', 'pro', GRACE_MS + 2000, 'offline pro, entitlement pro but expired: still pro (offline path unaffected by entitlement expiry)');

  const garbageTier = await page.evaluate(() => {
    P.tier = 'free';
    P.entitlement = { tier: 'ultra-mega-tier', status: 'active', currentPeriodEnd: 0, checkedAt: Date.now() };
    save();
    return currentTier().key;
  });
  check('an unrecognized entitlement tier string falls back to free (not honored blindly)', garbageTier === 'free', garbageTier);

  // ============================================================================
  console.log('\n=== 3. refreshEntitlement(): the Firebase read and its fallbacks ===');

  const mockFirebase = (val) => page.evaluate((val) => {
    window.firebase = {
      apps: [{}],
      database: function () {
        return { ref: function (path) { return { once: function () { return Promise.resolve({ val: function () { return val; } }); } }; } };
      },
    };
  }, val);

  await mockFirebase({ tier: 'pro', status: 'active', currentPeriodEnd: 1999999999000 });
  const validRefresh = await page.evaluate(() => refreshEntitlement().then(() => ({ tier: P.entitlement.tier, status: P.entitlement.status, cpe: P.entitlement.currentPeriodEnd, fresh: (Date.now() - P.entitlement.checkedAt) < 2000 })));
  check('a valid pro entitlement is written to P.entitlement with a fresh checkedAt', validRefresh.tier === 'pro' && validRefresh.status === 'active' && validRefresh.cpe === 1999999999000 && validRefresh.fresh, JSON.stringify(validRefresh));

  await mockFirebase(null);
  const noneRefresh = await page.evaluate(() => refreshEntitlement().then(() => ({ tier: P.entitlement.tier, status: P.entitlement.status })));
  check('no entitlement record (null) is coerced to a valid free/none shape, not left null', noneRefresh.tier === 'free' && noneRefresh.status === 'none', JSON.stringify(noneRefresh));

  await mockFirebase({ tier: 'super-deluxe', status: 'active', currentPeriodEnd: 123 });
  const garbageRefresh = await page.evaluate(() => refreshEntitlement().then(() => ({ tier: P.entitlement.tier, status: P.entitlement.status })));
  check('malformed server data (unknown tier) is NOT trusted — falls back to free/none', garbageRefresh.tier === 'free' && garbageRefresh.status === 'none', JSON.stringify(garbageRefresh));

  const noProfile = await page.evaluate(() => {
    const saved = P.profileId;
    P.profileId = null;
    return refreshEntitlement().then(r => { P.profileId = saved; return r; });
  });
  check('refreshEntitlement() with no profileId resolves to null without touching Firebase', noProfile === null, String(noProfile));

  // ============================================================================
  console.log('\n=== 4. handleBootParams(): ?pro=1 idempotency ===');
  // A real page.goto() here would reload the document and wipe out the window.firebase
  // mock before pollEntitlement() ever runs. Use history.pushState (changes location.search
  // without a navigation) + call handleBootParams() directly instead — the mock survives.
  resetDlg();
  await mockFirebase({ tier: 'pro', status: 'active', currentPeriodEnd: 1999999999000 });
  await page.evaluate(() => {
    P = newProfile('Test Driver 3', '', '', null);
    P.profileId = 'prof_entitlementtest03';
    P.tier = 'free'; P.entitlement = null;
    save();
    history.pushState(null, '', '/driven/index.html?pro=1');
    handleBootParams();
  });
  await page.waitForTimeout(2500);   // pollEntitlement's first attempt should resolve pro immediately
  check('the query string is stripped from the URL bar', await page.evaluate(() => location.search === ''));
  check('the idempotency flag is set under the exact key "rd_pro_applied_?pro=1"',
    await page.evaluate(() => localStorage.getItem('rd_pro_applied_?pro=1') === '1'));
  check('P.entitlement reflects pro after the boot-time poll', await page.evaluate(() => P.entitlement && P.entitlement.tier === 'pro'));
  check('the "Pro is active" alert fired on first application', dlgSeen.some(m => /Pro is active/i.test(m)), JSON.stringify(dlgSeen));

  resetDlg();
  await page.evaluate(() => { history.pushState(null, '', '/driven/index.html?pro=1'); handleBootParams(); });
  await page.waitForTimeout(600);
  check('revisiting the same ?pro=1 URL does NOT re-show the "Pro is active" alert (idempotent)',
    !dlgSeen.some(m => /Pro is active/i.test(m)), JSON.stringify(dlgSeen));

  // A DIFFERENT query string (e.g. a second, distinct checkout) is treated as a fresh
  // event — the flag key is the whole location.search, not just "pro=1" as a boolean.
  resetDlg();
  await page.evaluate(() => { history.pushState(null, '', '/driven/index.html?pro=1&x=2'); handleBootParams(); });
  await page.waitForTimeout(2500);
  check('a different query string (still containing pro=1) is NOT suppressed by the earlier flag — distinct flag key',
    dlgSeen.some(m => /Pro is active/i.test(m)), JSON.stringify(dlgSeen));

  console.log('\n=== 5. handleBootParams(): no profile on this device yet ===');
  resetDlg();
  await page.evaluate(() => { localStorage.clear(); });
  await go(base + 'driven/index.html?pro=1');
  await page.waitForTimeout(400);
  check('no local profile: a clear message, not a silent failure or a crash',
    dlgSeen.some(m => /no matching Driven profile/i.test(m)), JSON.stringify(dlgSeen));

  // ============================================================================
  console.log('\n=== 6. pollEntitlement(): gives up after 10 attempts and offers a retry ===');
  await page.evaluate(() => {
    localStorage.clear();
    P = newProfile('Test Driver 2', '', '', null);
    P.profileId = 'prof_entitlementtest02';
    save();
  });
  await mockFirebase({ tier: 'free', status: 'none', currentPeriodEnd: 0 });   // never becomes pro
  resetDlg();
  answer = () => false;   // decline the "check again?" retry offer
  await page.evaluate(() => pollEntitlement(9));   // last attempt (0..9 = 10 total)
  await page.waitForTimeout(300);
  check('at the last attempt with no pro entitlement, offerEntitlementRetry() fires (not an infinite/silent loop)',
    dlgSeen.some(m => /Still confirming your payment/i.test(m)), JSON.stringify(dlgSeen));
  check('declining the retry does not throw or hang', true);   // reaching this line at all is the assertion

  console.log('\n' + (fail === 0 ? '✅' : '❌') + ` driven-entitlement: ${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
