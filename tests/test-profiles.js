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

  console.log('— Delete profile —');
  await page.evaluate(() => nav('settings')); await page.waitForTimeout(150);
  await Promise.all([page.waitForNavigation(), page.click('button[onclick="deleteProfile()"]')]);
  await page.waitForSelector('#onboardModal');
  check('profile cleared from storage after delete', await page.evaluate(() => localStorage.getItem('profiles_v1') === null));
  check('onboarding shown again post-delete', await page.evaluate(() => document.getElementById('onboardModal').style.display === 'flex'));

  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
