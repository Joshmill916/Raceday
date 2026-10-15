// Driven "Other results": races a driver adds from other apps (Speedhive, MyRacePass…).
// Invariants: they live apart from verified results and never count toward stats; every one
// is labeled with its app; a CSV file can fill the form; they reach the published card and
// the public page (/d/) ONLY for Pro drivers who leave "show on my page" on; the card field
// stays under the rules cap; and anything malformed or hostile is dropped or escaped.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8836;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const PID = 'prof_othertest001';

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
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('  ⚠️ page error:', e.message); });
  let dialogs = [], confirmYes = true;
  page.on('dialog', d => { dialogs.push(d.message()); if (d.type() === 'confirm' && !confirmYes) d.dismiss(); else d.accept(); });
  await page.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights/, r => r.abort());
  const base = `http://localhost:${PORT}/`;
  await page.goto(base + 'driven/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const fresh = (pro) => page.evaluate(({ pid, pro }) => {
    localStorage.clear();
    P = newProfile('Joshua Miller', '', 'Fort Wayne', 45);
    P.profileId = pid; P.driver.number = '18';
    P.raceResults.push({ date: '2026-08-01', trackId: 'rd_t1', trackName: 'RaceDay Park', class: 'Senior', position: 2, points: 20, source: 'raceday', verifiedBy: null });
    if (pro) { P.tier = 'pro'; P.premiumCode = localPremiumCode(pid); }
    localStorage.setItem('profiles_v1', JSON.stringify(P));
    document.getElementById('onboardModal').style.display = 'none';
    nav('stats');
  }, { pid: PID, pro });
  const fill = (v) => page.evaluate((v) => {
    Object.keys(v).forEach(function (id) { document.getElementById(id).value = v[id]; });
    document.getElementById('orApp').dispatchEvent(new Event('change'));
  }, v);

  // ============================================================================
  console.log('\n=== 1. Adding a result (free driver) ===');
  await fresh(false);
  await page.click('#orAddBtn');
  check('the form opens', await page.isVisible('#otherModal'));
  await fill({ orApp: 'myracepass', orDate: '2026-09-12', orSession: 'Feature', orTrack: 'Some Oval', orCls: 'Late Model', orPos: '3', orStarters: '22', orUrl: 'https://www.myracepass.com/results/123' });
  await page.click('#orSave');
  let st = await page.evaluate(() => ({ other: P.otherResults, race: P.raceResults.length, stats: computeStats().total, html: document.getElementById('page-stats').innerHTML, modal: !!document.getElementById('otherModal') }));
  check('saved to the separate otherResults list', st.other.length === 1 && st.other[0].app === 'myracepass' && st.other[0].pos === 3 && st.other[0].starters === 22, JSON.stringify(st.other));
  check('verified results untouched', st.race === 1);
  check('career stats ignore it (still 1 race, 0 wins)', st.stats.races === 1 && st.stats.wins === 0, JSON.stringify(st.stats));
  check('form closed after saving', !st.modal);
  check('the list labels it with the app', /from MyRacePass/.test(st.html) && /Late Model · Feature/.test(st.html) && /22 starters/.test(st.html));
  check('free drivers are told only they can see it', /Only you can see these/.test(st.html) && !/id="orShow"/.test(st.html));
  check('free card carries no other-results field', await page.evaluate(() => !('other' in cardStrings() && cardStrings().other) && !Object.prototype.hasOwnProperty.call(otherCardField(), 'other')));
  check('saved to the device', await page.evaluate(() => JSON.parse(localStorage.getItem('profiles_v1')).otherResults.length === 1));

  console.log('\n=== 2. The form checks what was typed ===');
  const tryAdd = async (v) => {
    dialogs = [];
    await page.evaluate(() => openOtherResult());
    await fill(Object.assign({ orApp: 'speedhive', orDate: '2026-09-19', orSession: 'Heat', orTrack: 'Club Circuit', orCls: 'Shifter', orPos: '1', orStarters: '', orUrl: '', orAppName: '' }, v));
    await page.click('#orSave');
    const out = { dialogs: dialogs.slice(), count: await page.evaluate(() => P.otherResults.length), open: await page.isVisible('#otherModal') };
    await page.evaluate(() => closeOtherResult());
    return out;
  };
  let t = await tryAdd({ orTrack: '' });
  check('track is required', t.count === 1 && /track/.test(t.dialogs[0] || ''), JSON.stringify(t));
  t = await tryAdd({ orPos: 'abc' });
  check('finish must be a number or DNF/DNS/DQ', t.count === 1 && /Finish should be/.test(t.dialogs[0] || ''));
  t = await tryAdd({ orPos: '9', orStarters: '6' });
  check('finish can\'t be past the number of starters', t.count === 1 && /higher than the number of starters/.test(t.dialogs[0] || ''));
  t = await tryAdd({ orUrl: 'javascript:alert(1)' });
  check('only http(s) links are accepted', t.count === 1 && /https:\/\//.test(t.dialogs[0] || ''));
  t = await tryAdd({ orApp: 'other', orAppName: '' });
  check('"another app" needs its name', t.count === 1 && /name of the app/.test(t.dialogs[0] || ''));
  t = await tryAdd({ orPos: 'dnf' });
  check('DNF is accepted (any case)', t.count === 2 && (await page.evaluate(() => P.otherResults.some(r => r.pos === 'DNF'))));
  t = await tryAdd({ orApp: 'other', orAppName: 'Track Facebook page', orDate: '2026-09-26', orPos: '4' });
  check('"another app" shows its own name', t.count === 3 && /from Track Facebook page/.test(await page.evaluate(() => document.getElementById('page-stats').innerHTML)));

  console.log('\n=== 3. Duplicates, editing, deleting ===');
  confirmYes = false;
  t = await tryAdd({ orPos: '2' });   // same date/track/class/session as the DNF
  check('a duplicate asks first; "cancel" keeps it out', t.count === 3 && /already have/.test(t.dialogs[0] || ''), JSON.stringify(t.dialogs));
  confirmYes = true;
  const id = await page.evaluate(() => P.otherResults.filter(r => r.app === 'myracepass')[0].id);
  await page.evaluate((id) => openOtherResult(id), id);
  check('edit opens with the saved values', await page.evaluate(() => document.getElementById('orTrack').value === 'Some Oval' && document.getElementById('orPos').value === '3' && document.getElementById('orApp').value === 'myracepass'));
  await fill({ orPos: '1' });
  await page.click('#orSave');
  st = await page.evaluate((id) => ({ n: P.otherResults.length, r: P.otherResults.filter(r => r.id === id)[0] }), id);
  check('editing updates in place (no copy added)', st.n === 3 && st.r && st.r.pos === 1, JSON.stringify(st));
  check('a win there still isn\'t a career win', await page.evaluate(() => computeStats().total.wins === 0));
  await page.evaluate((id) => delOtherResult(id), id);
  check('delete removes it', await page.evaluate((id) => !P.otherResults.some(r => r.id === id) && P.otherResults.length === 2, id));

  console.log('\n=== 4. Fill from a results CSV ===');
  const csv = async (text) => {
    await page.evaluate(() => { closeOtherResult(); openOtherResult(); });
    await page.evaluate((text) => otherCsvLoaded(text), text);
    return page.evaluate(() => ({ pos: document.getElementById('orPos').value, cls: document.getElementById('orCls').value, starters: document.getElementById('orStarters').value,
      note: document.getElementById('orCsv').textContent, picks: document.querySelectorAll('#orCsv .csv-pick').length }));
  };
  let c = await csv('Pos,No.,Name,Class,Best Lap\n1,7,Alex Smith,Senior,0:45.1\n2,18,"Miller, Joshua",Senior,0:45.3\n3,22,Sam Lee,Senior,0:45.9\n1,4,Kid Rocket,Junior,0:48.0\n');
  check('finds the driver by name ("Miller, Joshua") and fills the form', c.pos === '2' && c.cls === 'Senior' && c.starters === '3', JSON.stringify(c));
  check('says what it filled', /P?2nd of 3 Senior/.test(c.note) || /2nd of 3 Senior/.test(c.note), c.note);
  c = await csv('Results — Club Race Night\n\nPosition;Kart;Driver\n1;9;Pat Jones\n2;18;Chris Day\n3;5;Lee Fox\n');
  check('title rows + semicolons: falls back to the kart number', c.pos === '2' && c.starters === '3', JSON.stringify(c));
  check('no class column: keeps the class already in the form', c.cls === 'Shifter', c.cls);
  c = await csv('Pos,Name\n1,Pat Jones\n2,Lee Fox\nDSQ,Chris Day\n');
  check('no match: lists the rows to pick from', c.picks === 3 && /Which row is you/.test(c.note), JSON.stringify(c));
  await page.evaluate(() => otherPickRow(2));
  check('picking a row fills it (DSQ → DQ)', await page.evaluate(() => document.getElementById('orPos').value === 'DQ'));
  c = await csv('just,some,words\nwith,no,results\n');
  check('a file without results says so', /Couldn't find finish positions/.test(c.note), c.note);
  await page.evaluate(() => closeOtherResult());

  // ============================================================================
  console.log('\n=== 5. Pro: on the card, Home page, and the show/hide switch ===');
  await fresh(true);
  await page.evaluate(() => {
    P.otherResults = [cleanOther({ app: 'speedhive', date: '2026-09-05', track: 'Club Circuit', cls: 'Shifter', pos: 2, starters: 14, session: 'Feature', url: 'https://speedhive.mylaps.com/sessions/1' }),
                      cleanOther({ app: 'racemonitor', date: '2026-08-20', track: 'Other Park', cls: 'Senior', pos: 'DNF' })];
    nav('stats');
  });
  const card = await page.evaluate(() => { var c = cardStrings(); return { other: c.other, payload: otherCardField(), tooLong: cardTooLong() }; });
  const parsed = JSON.parse(card.payload.other || '{}');
  check('Pro card carries the list (newest first)', parsed.r && parsed.r.length === 2 && parsed.r[0].a === 'speedhive' && parsed.r[0].p === 2 && parsed.more === 0, card.payload.other);
  check('cardTooLong() is happy', card.tooLong === null, card.tooLong);
  check('Pro sees the "show on my public page" switch, on by default', await page.evaluate(() => document.getElementById('orShow') && document.getElementById('orShow').checked));
  await page.evaluate(() => nav('home'));
  let home = await page.evaluate(() => document.getElementById('page-home').innerHTML);
  check('Home (the public-page preview) shows them, labeled', /Other results · added by the driver/.test(home) && /from Speedhive/.test(home) && /of 14/.test(home));
  check('Home stats still count only the verified race', /<b>1<\/b><span class="dp-cap">Starts<\/span>/.test(home));
  await page.evaluate(() => { nav('stats'); document.getElementById('orShow').click(); });
  check('switching it off takes the field off the card', await page.evaluate(() => P.showOtherOnPage === false && !Object.prototype.hasOwnProperty.call(otherCardField(), 'other') && cardStrings().other === ''));
  await page.evaluate(() => nav('home'));
  check('…and off the Home preview', !/Other results/.test(await page.evaluate(() => document.getElementById('page-home').innerHTML)));
  await page.evaluate(() => { P.showOtherOnPage = true; });

  console.log('\n=== 6. Card size cap and restoring on another device ===');
  await page.evaluate(() => {
    var list = [];
    for (var i = 0; i < 120; i++) {
      var d = new Date(2026, 0, 1 + i), ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      list.push(cleanOther({ app: 'speedhive', date: ds, track: 'A Very Long Track Name Raceway Park #' + i, cls: 'Senior Shifter Masters', pos: (i % 9) + 1, starters: 20, session: 'Feature', url: 'https://speedhive.mylaps.com/sessions/' + (100000 + i) }));
    }
    P.otherResults = list;
  });
  const big = await page.evaluate(() => { var s = otherPayload(); var o = JSON.parse(s); return { len: s.length, kept: o.r.length, more: o.more, newest: o.r[0].d, cap: CARD_CAPS.other, tooLong: cardTooLong() }; });
  check('payload is trimmed under the 8000-character rule cap', big.len <= 8000 && big.kept > 20 && big.more === 120 - big.kept && big.tooLong === null, JSON.stringify(big));
  check('trimming drops the oldest, keeps the newest', big.newest === '2026-04-30', big.newest);
  const merged = await page.evaluate(() => { var list = parseOtherPayload(otherPayload()); return { n: list.length, all: P.otherResults.length }; });
  check('restoring a trimmed card keeps this device\'s older results', merged.n === merged.all, JSON.stringify(merged));
  const restored = await page.evaluate(() => {
    var mine = P.otherResults; P.otherResults = [cleanOther({ app: 'westhold', date: '2026-01-01', track: 'Gone', cls: 'X', pos: 1 })];
    var card = { name: 'Joshua Miller', num: '18', other: JSON.stringify({ r: [{ i: 'abc123', a: 'myracepass', d: '2026-09-01', t: 'Card Track', c: 'Late Model', p: 5 }], more: 0 }) };
    applyCardToProfile(P, card);
    var a = P.otherResults.map(r => r.track);
    P.otherResults = mine;
    var before = P.otherResults.length; applyCardToProfile(P, { name: 'Joshua Miller', num: '18' });
    return { a: a, keptWithoutKey: P.otherResults.length === before };
  });
  check('a full (untrimmed) Pro card replaces the list — deletes carry over', restored.a.join('|') === 'Card Track', JSON.stringify(restored.a));
  check('a card without the field leaves the device\'s list alone', restored.keptWithoutKey);

  console.log('\n=== 7. Hostile values are dropped or escaped ===');
  const bad = await page.evaluate(() => ({
    js: cleanOther({ app: 'speedhive', date: '2026-01-01', track: 'T', cls: 'C', pos: 1, url: 'javascript:alert(1)' }).url,
    app: cleanOther({ app: '__proto__', date: '2026-01-01', track: 'T', cls: 'C', pos: 1 }).app,
    id: cleanOther({ id: "x');alert(1);//", app: 'speedhive', date: '2026-01-01', track: 'T', cls: 'C', pos: 1 }).id,
    noDate: cleanOther({ app: 'speedhive', date: 'yesterday', track: 'T', cls: 'C', pos: 1 }),
    garbage: parseOtherPayload('not json'),
  }));
  check('javascript: links are removed', bad.js === '');
  check('unknown app keys become "another app"', bad.app === 'other');
  check('ids are regenerated unless plain letters/numbers', /^[a-z0-9]+$/i.test(bad.id) && bad.id !== "x');alert(1);//");
  check('results without a real date are dropped', bad.noDate === null);
  check('a garbage card field is ignored', bad.garbage === null);
  await page.evaluate(() => { P.otherResults = [cleanOther({ app: 'speedhive', date: '2026-02-02', track: '<img src=x onerror=window.__xss=1>', cls: '<b>bold</b>', pos: 1 })]; nav('stats'); nav('home'); });
  await page.waitForTimeout(100);
  check('HTML in a track or class name is shown as text', await page.evaluate(() => !window.__xss && !document.querySelector('#page-stats img, #page-home .dp-res img') && /&lt;b&gt;bold/.test(document.getElementById('page-stats').innerHTML)));

  // ============================================================================
  console.log('\n=== 8. Public page (/d/) ===');
  const pub = await browser.newPage({ viewport: { width: 400, height: 900 } });
  pub.on('pageerror', e => { errors.push('d/: ' + e.message); console.log('  ⚠️ d/ page error:', e.message); });
  const code = await page.evaluate((pid) => localPremiumCode(pid), PID);
  const otherJson = JSON.stringify({ r: [
    { i: 'a1', a: 'speedhive', d: '2026-09-05', t: 'Club Circuit', c: 'Shifter', p: 2, s: 14, e: 'Feature', u: 'https://speedhive.mylaps.com/sessions/1' },
    { i: 'a2', a: 'constructor', n: '', d: '2026-08-01', t: 'Mystery', c: 'Senior', p: 'DNF' },
    { i: 'a3', a: 'other', n: 'Track Facebook page', d: '2026-07-01', t: 'Paper Oval', c: 'Stock', p: 7, u: 'javascript:alert(1)' },
    { i: 'a4', a: 'speedhive', d: 'bad', t: 'Dropped', c: 'X', p: 1 },
    { i: 'a5', a: 'speedhive', d: '2026-06-01', t: '<img src=x onerror=window.__xss=1>', c: 'Junior', p: 1 }
  ], more: 0 });
  const serve = async (card, ent) => {
    await pub.unroute('**/*').catch(() => {});
    await pub.route(/firebaseio\.com/, r => {
      const u = new URL(r.request().url()).pathname.replace(/\.json$/, '').replace(/^\//, '');
      const body = u === 'profiles_short/OTHERTES' ? PID : u === 'profiles/' + PID + '/card' ? card : u === 'profiles/' + PID + '/entitlement' ? (ent || null) : null;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await pub.route(/gstatic\.com|cloudflareinsights/, r => r.abort());
    await pub.goto(base + 'd/?OTHERTES', { waitUntil: 'domcontentloaded' });
    await pub.waitForFunction(() => /Share profile|not found/i.test(document.body.textContent), null, { timeout: 5000 }).catch(() => {});
    return pub.evaluate(() => document.getElementById('app').innerHTML);
  };
  let d = await serve({ name: 'Joshua Miller', num: '18', premiumCode: code, other: otherJson, updatedAt: 1 });
  check('Pro page shows the "Other results" section', /Other results · added by the driver/.test(d));
  check('each one is labeled with its app', /from Speedhive/.test(d) && /from Track Facebook page/.test(d));
  check('an unknown app key shows as "another app"', /from another app/.test(d) && !/function/.test(d));
  check('the real link is kept, javascript: is not', /href="https:\/\/speedhive\.mylaps\.com\/sessions\/1"/.test(d) && !/javascript:/.test(d));
  check('a result without a real date is dropped', !/Dropped/.test(d));
  check('HTML in a track name is shown as text', !(await pub.evaluate(() => window.__xss || !!document.querySelector('#app .res img'))) && /&lt;img/.test(d));
  check('says they\'re not counted in the stats', /Not counted in the stats above/.test(d));
  check('the stats tiles still show 0 starts (no verified results here)', /<b>0<\/b><span class="cap">Starts<\/span>/.test(d));
  d = await serve({ name: 'Joshua Miller', num: '18', premiumCode: '', other: otherJson, updatedAt: 1 });
  check('without Pro the section never shows, even if the field is there', !/Other results/.test(d) && /Joshua Miller/.test(d));
  d = await serve({ name: 'Joshua Miller', num: '18', premiumCode: '', other: otherJson, updatedAt: 1 }, { tier: 'pro', status: 'active' });
  check('a subscription Pro also shows it', /Other results · added by the driver/.test(d));
  d = await serve({ name: 'Joshua Miller', num: '18', premiumCode: code, updatedAt: 1 });
  check('a Pro card without the field renders normally', /Joshua Miller/.test(d) && !/Other results/.test(d));
  await pub.close();

  console.log('\n=== 9. Rules and tracks ===');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  const otherRule = rules.profiles.$id.card.other && rules.profiles.$id.card.other['.validate'];
  check('rules allow the card field, capped at CARD_CAPS.other', /length <= 8000/.test(otherRule || '') && (await page.evaluate(() => CARD_CAPS.other)) === 8000, otherRule);
  for (const f of ['raceday/index.html', 'raceday2/index.html']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = src.match(/function sanitizeProfileCard[\s\S]*?\n}/);
    check(f + ': tracks never receive other results (card whitelist)', m && !/card\.other\b/.test(m[0]));
  }
  check('no page errors', errors.length === 0, errors.join(' | '));

  console.log(`\n${fail ? '❌' : '✅'} driven-other-results: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
