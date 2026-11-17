// "Change RaceDay 2 to just RaceDay" (2026-11-17): the app moved from /raceday2/ to /raceday/, the
// classic app from /raceday/ to /raceday-classic/. Guards: every old /raceday2/ link (sync room,
// role, staff key, &me=, hash) lands on /raceday/ intact; the old /raceday2/ worker retires itself;
// a phone still running a track on the classic app goes to /raceday-classic/ (and only then); the
// homepage sends each kind of returning device to the right place; no page on the site still
// links to /raceday2/.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8885;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async () => {
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (u.endsWith('/')) u += 'index.html';
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': /\.js$/.test(u) ? 'text/javascript' : /\.html$/.test(u) ? 'text/html' : /\.txt$/.test(u) ? 'text/plain' : 'application/octet-stream' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  await ctx.route(/firebaseio\.com|gstatic\.com|cloudfunctions\.net|cloudflareinsights|script\.google\.com/, r => r.abort());
  const page = await ctx.newPage();
  const B = `http://localhost:${PORT}`;
  // Fresh storage, then optional data, then open a URL and report where the phone ended up.
  const land = async (store, url) => {
    await page.goto(B + '/robots.txt');
    await page.evaluate(st => { localStorage.clear(); Object.keys(st || {}).forEach(k => localStorage.setItem(k, typeof st[k] === 'string' ? st[k] : JSON.stringify(st[k]))); }, store);
    // Every address the tab showed, in order (the app tidies link params out of the address bar
    // once it has read them, so the landing address is the first one on the final page).
    const seen = []; const rec = f => { if (f === page.mainFrame()) { const u = new URL(f.url()); seen.push(u.pathname + u.search + u.hash); } };
    page.on('framenavigated', rec);
    await page.goto(B + url); await page.waitForTimeout(700);
    page.off('framenavigated', rec);
    const endPath = new URL(page.url()).pathname;
    return seen.find(x => x.split(/[?#]/)[0] === endPath) || endPath;
  };
  const CLASSIC = { raceday_v1: { raceDay: { date: '2026-11-01', entries: [] }, classes: [{ id: 1, name: 'Junior' }], roster: [{ id: 1, name: 'A' }], track: { name: 'Old Oval' }, sync: { enabled: true, key: 'OLDROOM' } } };

  console.log('\n— Old /raceday2/ links forward —');
  check('a spectator lineup link keeps its room, role and driver', (await land({}, '/raceday2/?sync=ROOM1&role=viewer&me=5')) === '/raceday/?sync=ROOM1&role=viewer&me=5');
  check('a staff link keeps its staff key, and a #hash survives', (await land({}, '/raceday2/?sync=ROOM1&role=register&st=abc#x')) === '/raceday/?sync=ROOM1&role=register&st=abc#x');
  check('the plain old address opens the app', (await land({}, '/raceday2/')) === '/raceday/');
  check('the live demo link still works', (await land({}, '/raceday2/?demo=1')).startsWith('/raceday/?demo=1'));
  const sw2 = read('raceday2/sw.js');
  check('the old /raceday2/ worker steps aside: no fetch handling, unregisters itself', !/addEventListener\('fetch'/.test(sw2) && /registration\.unregister\(\)/.test(sw2) && /skipWaiting/.test(sw2));
  check('the app itself is at /raceday/ (its own data key and worker)', /const KEY = 'raceday_v2'/.test(read('raceday/index.html')) && /raceday2-v\d+/.test(read('raceday/sw.js')));
  check('the classic app is at /raceday-classic/', /raceday_v1/.test(read('raceday-classic/index.html')) && !/const KEY = 'raceday_v2'/.test(read('raceday-classic/index.html')));

  console.log('\n— A phone still on the classic app —');
  check('a classic track device opening /raceday/ goes to /raceday-classic/', (await land(CLASSIC, '/raceday/')) === '/raceday-classic/');
  check('…its own classic room link goes there too, intact', (await land(CLASSIC, '/raceday/?sync=oldroom&role=admin')) === '/raceday-classic/?sync=oldroom&role=admin');
  check('…but another track\'s link stays here', (await land(CLASSIC, '/raceday/?sync=NEWROOM&role=viewer')) === '/raceday/?sync=NEWROOM&role=viewer');
  check('"Open the new version" (?new=1) stays here', (await land(CLASSIC, '/raceday/?new=1')).startsWith('/raceday/'));
  const both = Object.assign({}, CLASSIC, { raceday_v2: { track: { name: 'Moved Over' }, demo: false } });
  check('a track that moved over (has a track in this app) stays here', (await land(both, '/raceday/')).startsWith('/raceday/'));
  check('a Garage device stays here', (await land(Object.assign({}, CLASSIC, { rd_garage_v2: { a: {} } }), '/raceday/')).startsWith('/raceday/'));
  check('someone who only tried the classic demo stays here', (await land({ raceday_v1: Object.assign({}, CLASSIC.raceday_v1, { demo: true }) }, '/raceday/')).startsWith('/raceday/'));
  check('an empty classic leftover (no drivers, no history) stays here', (await land({ raceday_v1: { raceDay: {}, classes: [], roster: [], history: [] } }, '/raceday/')).startsWith('/raceday/'));
  check('a brand-new phone stays here', (await land({}, '/raceday/')).startsWith('/raceday/'));
  const cl = read('raceday-classic/index.html');
  check('the classic app\'s "Open the new version" link skips the guard', /href="\/raceday\/\?new=1"/.test(cl) && !/\/raceday2\//.test(cl));

  console.log('\n— The homepage sends returning devices to the right place —');
  check('a track on the app → /raceday/', (await land({ raceday_v2: { track: { name: 'Hogbarn' } } }, '/')) === '/raceday/');
  check('a track on the classic app → /raceday-classic/', (await land(CLASSIC, '/')) === '/raceday-classic/');
  check('a fan phone that followed a track → /raceday/', (await land({ rd_guest_room_v2: { code: 'ROOM1' } }, '/')) === '/raceday/');
  check('a station link → /raceday/ with its query', (await land({}, '/?sync=ROOM1&role=tv')) === '/raceday/?sync=ROOM1&role=tv');
  check('a new visitor sees the homepage', (await land({}, '/')) === '/');

  console.log('\n— The site —');
  const pages = ['index.html', 'pricing.html', 'faq.html', 'field-manual.html', 'enter/index.html', 'driven/index.html', 'guides/guides.css']
    .concat(fs.readdirSync(path.join(ROOT, 'guides')).filter(f => f.endsWith('.html')).map(f => 'guides/' + f));
  const stale = pages.filter(f => /\/raceday2\//.test(read(f)));
  check('no page links to /raceday2/ anymore', !stale.length, stale.join(', '));
  check('Driven\'s "Open my lineup" uses /raceday/', /LINEUP_BASE = 'https:\/\/victoryraceday\.com\/raceday\/'/.test(read('driven/index.html')));
  const faqTxt = read('faq.html').replace(/<[^>]+>/g, ' ');
  check('the FAQ no longer calls it "the new version" (except the classic app\'s own notice)', !/the new version|new version\)|in the new version/i.test(faqTxt.replace(/"new version available"|\\"new version available\\"/g, '')));
  const robots = read('robots.txt');
  check('search engines skip all three app addresses', /Disallow: \/raceday\/\n/.test(robots) && /Disallow: \/raceday-classic\//.test(robots) && /Disallow: \/raceday2\//.test(robots));

  await browser.close(); server.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
