// Two owner-reported regressions, checked in BOTH apps (raceday/ and raceday2/):
//  1. "Load a demo race day" is a showcase: it must never use a free-trial day, must work
//     even after the trial is used up, and the demo night is discarded on archive (no race
//     history, no season points) instead of being saved like a real night.
//  2. A driver card linked to a Driven profile shows the driver's Driven team color (and the
//     Pro accent) — v2 used to read d.profile.card, which never exists, so every card fell
//     back to the stock yellow/black.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8833;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(urlPath) === '.js' ? 'application/javascript' : 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const app of ['raceday', 'raceday2']) {
    console.log('\n=== ' + app + ' ===');
    const ctx = await browser.newContext();
    await ctx.route(/script\.google\.com|firebaseio\.com|gstatic\.com|cloudflareinsights/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  ⚠️ page error:', e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}/${app}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // ---- 1. demo race day ----
    const demo = await page.evaluate(() => {
      S.track.name = 'Demo Test'; save();
      const before = S.trialDays.length;
      seedDemo();
      const afterSeed = S.trialDays.length, entries = S.raceDay.entries.length, flagged = !!S.raceDay.demo;
      consumeTrialDay();                                  // e.g. a sign-up typed in during the demo
      const afterSignup = S.trialDays.length;
      const histBefore = S.history.length;
      const archived = archiveDay();
      return { before, afterSeed, afterSignup, entries, flagged, archived, histBefore, histAfter: S.history.length };
    });
    check('demo loads 25 sample drivers', demo.entries >= 25, demo.entries);
    check('loading the demo uses no trial day', demo.afterSeed === demo.before, JSON.stringify(demo));
    check('a sign-up during the demo uses no trial day', demo.afterSignup === demo.before, JSON.stringify(demo));
    check('archiving the demo night keeps it out of race history', demo.archived === true && demo.histAfter === demo.histBefore, JSON.stringify(demo));

    const exhausted = await page.evaluate(() => {
      S.raceDay = { date: '2026-01-01', entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
      S.trialDays = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04']; S.license = null; save();
      const blocked = !canEnter();
      seedDemo();
      return { blocked, loaded: S.raceDay.entries.length, trial: S.trialDays.length };
    });
    check('demo still loads after the free trial is used up', exhausted.blocked && exhausted.loaded >= 25 && exhausted.trial === 4, JSON.stringify(exhausted));

    const realDay = await page.evaluate(() => {
      S.raceDay = { date: '2026-02-02', entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
      S.trialDays = []; save();
      consumeTrialDay();
      return S.trialDays.length;
    });
    check('a real race day still uses a trial day', realDay === 1, realDay);

    // ---- 2. driver card colors from Driven ----
    const card = await page.evaluate((app) => {
      const pid = 'prof_cardtest00001';
      const d = { id: genDriverId(), name: 'Color Test', num: '18' }; S.roster.push(d);
      d.profileId = pid;
      d.profile = sanitizeProfileCard(pid, { name: 'Color Test', num: '18', teamColor: '#1a00e0', teamColor2: '#ffffff', teamColor3: '#010713',
        premiumCode: '', sponsors: 'Victory Promotions' });
      save();
      if (typeof hideModal === 'function') hideModal('setupWizard');
      openDriverCard(d.id);
      if (app === 'raceday2') {
        const hero = document.querySelector('.sheet.dc .dc-hero') || document.querySelector('.dc-hero');
        const sheet = document.querySelector('.sheet.dc');
        return { team: hero && hero.style.getPropertyValue('--dc-team'), cls: sheet && sheet.className, kept2: d.profile.teamColor2 };
      }
      const panel = document.getElementById('dcPanel');
      return { team: panel.style.getPropertyValue('--dc-team'), cls: panel.className, kept2: d.profile.teamColor2 };
    }, app);
    check('linked card uses the Driven team color', card.team === '#1a00e0', JSON.stringify(card));
    check('linked card gets the team-color style (not stock yellow/black)', /\bteam\b/.test(card.cls || ''), card.cls);
    check('sanitizer keeps the Pro accent color', card.kept2 === '#ffffff', card.kept2);

    const unlinked = await page.evaluate((app) => {
      const d = { id: genDriverId(), name: 'Plain Driver', num: '7' }; S.roster.push(d); save();
      openDriverCard(d.id);
      if (app === 'raceday2') { const s = document.querySelector('.sheet.dc'); return s && s.className; }
      return document.getElementById('dcPanel').className;
    }, app);
    check('an unlinked driver keeps the stock card', !/\bteam\b/.test(unlinked || ''), unlinked);
    await ctx.close();
  }

  console.log(`\n${fail ? '❌' : '✅'} demo-and-card: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
