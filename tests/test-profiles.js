// Profiles app: onboarding, profileId + QR, import/dedupe, stats, edit, unlink, delete, persistence
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '..'); const PORT = 8797;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    fs.readFile(path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', e => { fail++; console.log('  ❌ PAGE ERROR: ' + e.message); });
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/profiles/index.html`); await page.waitForTimeout(300);

  console.log('— Onboarding —');
  check('onboarding modal auto-opens on fresh install', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'flex'));
  await page.click('button.btn-go[onclick="completeOnboarding()"]'); await page.waitForTimeout(150);
  check('blocked with no name entered', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'flex'));
  await page.fill('#obName', 'Alex Smith');
  await page.fill('#obEmail', 'alex@example.com');
  await page.fill('#obHometown', 'Columbus, OH');
  await page.fill('#obAge', '16');
  await page.click('button.btn-go[onclick="completeOnboarding()"]'); await page.waitForTimeout(200);
  check('onboarding closes after valid submit', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'none'));
  check('profile created with driver fields', await page.evaluate(() => P.driver.name === 'Alex Smith' && P.driver.hometown === 'Columbus, OH' && P.driver.age === 16));
  check('profileId generated (prof_ prefix)', await page.evaluate(() => typeof P.profileId === 'string' && P.profileId.indexOf('prof_') === 0));
  check('home page active after onboarding', await page.evaluate(() => document.getElementById('page-home').classList.contains('active')));

  console.log('— Link page / QR —');
  await page.evaluate(() => nav('link')); await page.waitForTimeout(150);
  check('profileId shown on link page', (await page.textContent('#page-link')).includes(await page.evaluate(() => P.profileId)));
  check('QR canvas rendered (has size)', await page.evaluate(() => { const c = document.getElementById('linkQR'); return c && c.width > 0 && c.height > 0; }));
  check('no linked tracks yet', await page.evaluate(() => P.linkedTracks.length === 0));

  console.log('— Demo data / stats —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  await page.click('button[onclick="loadDemoResults()"]'); await page.waitForTimeout(200);
  check('5 demo results imported', await page.evaluate(() => P.raceResults.length === 5));
  check('2 tracks auto-linked from demo import', await page.evaluate(() => P.linkedTracks.length === 2));
  const stats = await page.evaluate(() => computeStats());
  check('total races = 5', stats.total.races === 5, 'got ' + stats.total.races);
  check('total wins = 2', stats.total.wins === 2, 'got ' + stats.total.wins);
  check('total podiums = 4', stats.total.podiums === 4, 'got ' + stats.total.podiums);
  check('Junior 80cc class stats correct', stats.byClass['Junior 80cc'].races === 3 && stats.byClass['Junior 80cc'].wins === 1 && stats.byClass['Junior 80cc'].podiums === 3);
  check('Senior 100cc class stats correct', stats.byClass['Senior 100cc'].races === 2 && stats.byClass['Senior 100cc'].wins === 1 && stats.byClass['Senior 100cc'].podiums === 1);

  await page.evaluate(() => nav('home')); await page.waitForTimeout(150);
  const homeTxt = await page.textContent('#page-home');
  check('home feed shows recent races', homeTxt.includes('Riverside Kart Park') && homeTxt.includes('Lonestar Speedway'));

  await page.evaluate(() => nav('stats')); await page.waitForTimeout(150);
  const statsTxt = await page.textContent('#page-stats');
  check('stats page renders class table', statsTxt.includes('Junior 80cc') && statsTxt.includes('Senior 100cc') && statsTxt.includes('Total'));

  console.log('— Import dedupe —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  const dupAdded = await page.evaluate(() => ingestExport({ trackId: 'raceday_riverside', trackName: 'Riverside Kart Park', date: '2026-06-14', results: [{ class: 'Junior 80cc', position: 1, points: 25 }] }));
  check('duplicate result (same track+date+class) not re-added', dupAdded === 0 && await page.evaluate(() => P.raceResults.length === 5));
  const newAdded = await page.evaluate(() => ingestExport({ trackId: 'raceday_riverside', trackName: 'Riverside Kart Park', date: '2026-07-05', results: [{ class: 'Junior 80cc', position: 4, points: 15 }] }));
  check('new date/class result is added', newAdded === 1 && await page.evaluate(() => P.raceResults.length === 6));

  console.log('— Edit profile —');
  await page.fill('#stBio', 'Racing since I could reach the pedals.');
  await page.fill('#stSponsors', 'Smith Auto, FastKarts');
  await page.click('button[onclick="saveProfileFields()"]'); await page.waitForTimeout(150);
  check('bio saved', await page.evaluate(() => P.driver.bio === 'Racing since I could reach the pedals.'));
  check('sponsors parsed into array', await page.evaluate(() => P.sponsors.length === 2 && P.sponsors[0].name === 'Smith Auto'));
  await page.evaluate(() => nav('card')); await page.waitForTimeout(150);
  const cardTxt = await page.textContent('#page-card');
  check('card page shows bio and sponsors', cardTxt.includes('Racing since I could reach the pedals.') && cardTxt.includes('Smith Auto') && cardTxt.includes('FastKarts'));

  console.log('— Unlink track —');
  await page.evaluate(() => nav('link')); await page.waitForTimeout(150);
  await page.evaluate(() => unlinkTrack('raceday_lonestar')); await page.waitForTimeout(150);
  check('unlinked track removed from linkedTracks', await page.evaluate(() => P.linkedTracks.length === 1 && !P.linkedTracks.some(t => t.trackId === 'raceday_lonestar')));
  check('unlinking a track keeps its historical results', await page.evaluate(() => P.raceResults.some(r => r.trackId === 'raceday_lonestar')));

  console.log('— Persistence across reload —');
  const savedId = await page.evaluate(() => P.profileId);
  await page.reload(); await page.waitForTimeout(300);
  check('profile survives reload', await page.evaluate((id) => P && P.profileId === id, savedId));
  check('onboarding does NOT reopen', await page.evaluate(() => document.getElementById('onboardModal').style.display !== 'flex'));
  check('results survive reload', await page.evaluate(() => P.raceResults.length === 6));

  console.log('— Back up profile (full-fidelity export) —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button[onclick="backupProfile()"]'),
  ]);
  const backupPath = await download.path();
  const backupJson = fs.readFileSync(backupPath, 'utf8');
  const backupParsed = JSON.parse(backupJson);
  check('backup file is valid JSON with the full profile shape', !!(backupParsed && backupParsed.profileId && backupParsed.driver));
  check('backup includes all 6 race results (the part a link code can never recover)', backupParsed.raceResults.length === 6);
  check('backup includes bio and sponsors', backupParsed.driver.bio === 'Racing since I could reach the pedals.' && backupParsed.sponsors.length === 2);
  const savedProfileId = backupParsed.profileId;

  console.log('— Delete profile —');
  await Promise.all([page.waitForNavigation(), page.click('button[onclick="deleteProfile()"]')]);
  await page.waitForSelector('#onboardModal');
  check('profile cleared from storage after delete', await page.evaluate(() => localStorage.getItem('profiles_v1') === null));
  check('onboarding shown again post-delete', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'flex'));

  console.log('— Restore from a full backup file (the bug that prompted this: no way to get an existing profile onto a fresh device) —');
  check('restore box starts hidden', await page.evaluate(() => document.getElementById('restoreBox').style.display === 'none'));
  await page.click('a[onclick="toggleRestore(event)"]'); await page.waitForTimeout(100);
  check('restore box reveals on tap', await page.evaluate(() => document.getElementById('restoreBox').style.display !== 'none'));
  await page.fill('#restoreInput', backupJson);
  await page.click('button[onclick="restoreProfile()"]'); await page.waitForTimeout(200);
  check('onboarding closes after a valid backup restore', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'none'));
  check('restored profile keeps the SAME profileId', await page.evaluate((id) => P.profileId === id, savedProfileId));
  check('restored profile has full race history (6 results) — the whole point of a file backup', await page.evaluate(() => P.raceResults.length === 6));
  check('restored profile keeps bio/sponsors', await page.evaluate(() => P.driver.bio === 'Racing since I could reach the pedals.' && P.sponsors.length === 2));

  console.log('— Restore from a published link code (partial — no history, but works with zero prior backup) —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  await Promise.all([page.waitForNavigation(), page.click('button[onclick="deleteProfile()"]')]);
  await page.waitForSelector('#onboardModal');
  // Stub firebase entirely — this suite has no emulator dependency, and this proves the
  // REAL restoreFromLinkCode() logic (field mapping, cap enforcement, sponsor split,
  // premium recompute) rather than a live network round-trip.
  const mockProfileId = 'prof_mockrestore01';
  const premiumCode = await page.evaluate((pid) => {
    var short = pid.slice(5, 13).toUpperCase();
    return 'PREM-' + short + '-' + pHash(pid + '|PREM|' + PREM_SALT).slice(0, 8);
  }, mockProfileId);
  await page.evaluate(({ pid, code }) => {
    window.firebase = {
      apps: [{}],
      database: function () {
        return {
          ref: function (path) {
            return {
              once: function () {
                if (path === 'profiles_short/RESTORE1') return Promise.resolve({ val: function () { return pid; } });
                if (path === 'profiles/' + pid + '/card') return Promise.resolve({ val: function () {
                  return {
                    name: 'Robin Park', num: '9', hometown: 'Dayton, OH', age: '15',
                    teamColor: '#1f6fd6', photo: '', sponsors: 'Fast Kart Co · Speedy Tires',
                    premiumCode: code, updatedAt: 1752600000000,
                  };
                } });
                return Promise.resolve({ val: function () { return null; } });
              },
            };
          },
        };
      },
    };
  }, { pid: mockProfileId, code: premiumCode });
  await page.click('a[onclick="toggleRestore(event)"]'); await page.waitForTimeout(100);
  await page.fill('#restoreInput', 'RESTORE1');
  await page.click('button[onclick="restoreProfile()"]'); await page.waitForTimeout(300);
  check('onboarding closes after a valid link-code restore', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'none'));
  check('identity restored from the published card', await page.evaluate(() => P.driver.name === 'Robin Park' && P.driver.number === '9' && P.driver.hometown === 'Dayton, OH'));
  check('sponsors reconstructed from the flattened card string', await page.evaluate(() => P.sponsors.length === 2 && P.sponsors[0].name === 'Fast Kart Co' && P.sponsors[1].name === 'Speedy Tires'));
  check('premium status recomputed and honored (valid code)', await page.evaluate(() => P.tier === 'premium'));
  check('race history is explicitly EMPTY — never recoverable from a card alone', await page.evaluate(() => P.raceResults.length === 0));
  check('shortCode recorded so the profile can re-publish under the same link', await page.evaluate(() => P.shortCode === 'RESTORE1'));

  console.log('— Bug: restore must succeed for a real card with no kart number yet (onboarding never asks for one) —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  await Promise.all([page.waitForNavigation(), page.click('button[onclick="deleteProfile()"]')]);
  await page.waitForSelector('#onboardModal');
  const noNumProfileId = 'prof_mocknonum01';
  await page.evaluate((pid) => {
    window.firebase = {
      apps: [{}],
      database: function () {
        return {
          ref: function (path) {
            return {
              once: function () {
                if (path === 'profiles_short/NONUM001') return Promise.resolve({ val: function () { return pid; } });
                if (path === 'profiles/' + pid + '/card') return Promise.resolve({ val: function () {
                  // A driver who published right after onboarding, before ever setting
                  // a kart number in Settings — num is a real, valid, empty string.
                  return { name: 'Casey Nguyen', num: '', hometown: '', age: '', teamColor: '', photo: '', sponsors: '', premiumCode: '', updatedAt: 1752600000000 };
                } });
                return Promise.resolve({ val: function () { return null; } });
              },
            };
          },
        };
      },
    };
  }, noNumProfileId);
  await page.click('a[onclick="toggleRestore(event)"]'); await page.waitForTimeout(100);
  await page.fill('#restoreInput', 'NONUM001');
  await page.click('button[onclick="restoreProfile()"]'); await page.waitForTimeout(300);
  check('a published card with an empty kart number is NOT wrongly rejected', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'none'));
  check('restored profile keeps the name, with an empty kart number (not a lost card)', await page.evaluate(() => P.driver.name === 'Casey Nguyen' && P.driver.number === ''));

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
