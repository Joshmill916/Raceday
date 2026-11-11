// v2 "try to break it" guards (found 2026-11-11 by a hostile-input sweep of every screen):
// - a 300-character driver name was saved and made Lineups 2,300px wide on a phone; long names
//   also widened Points tabs, Tech, Announcer and Admin → Race classes
// - Admin → Race classes accepted a blank class and a second "Junior 80cc"
// - a second tap on "Draw my pills" after the screen moved on threw a page error
// - the DEMO watermark covered the Admin/Guide labels in the phone tab bar
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8873;
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' }); res.end(d);
    });
  }).listen(PORT);
  const browser = await browser_();
  async function browser_() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const errs = [];
  const p = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/raceday2/?demo=1`); await p.waitForTimeout(900);
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); });
  await p.reload(); await p.waitForTimeout(900);
  await p.evaluate(() => newRaceDay()); await p.waitForTimeout(400);

  const signup = (name, num) => p.evaluate(([name, num]) => {
    nav('signup'); if (!document.getElementById('dName')) resetReg();
    const n = document.getElementById('dName'), v = document.getElementById('dNum');
    n.value = name; v.value = num; n.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('input'));
    renderChips();
    const c = S.classes[0], e = document.getElementById('ch' + c.id); if (e && !e.classList.contains('on')) e.click();
    const chk = document.getElementById('consentChk'); if (chk) chk.checked = true;
    register();
    return S.roster[S.roster.length - 1].name;
  }, [name, num]);

  console.log('— names —');
  check('the name box allows 40 characters', await p.evaluate(() => { nav('signup'); if (!document.getElementById('dName')) resetReg(); return document.getElementById('dName').maxLength === 40; }));
  const long = await signup('Q'.repeat(300), '71');
  check('a 300-character name is saved as 40', long.length === 40, long.length);
  const spaced = await signup('  Spacey \t  McName   ', '72');
  check('runs of spaces/tabs collapse to one', spaced === 'Spacey McName', JSON.stringify(spaced));
  await p.evaluate(() => { const c = S.classes[0]; for (let i = 0; i < 3; i++) { const d = { id: 8800 + i, name: 'Christopher Alexander Montgomery-Vanderb', num: String(80 + i) }; S.roster.push(d); S.raceDay.entries.push({ driverId: d.id, classId: c.id, pill: 50 + i }); } save(); });

  console.log('— classes —');
  const cls = await p.evaluate(() => {
    nav('admin'); admOpen('classes');
    const n0 = S.classes.length, el = document.getElementById('newClass');
    el.value = '   '; addClass();
    const blank = S.classes.length - n0;
    el.value = S.classes[0].name.toUpperCase(); addClass();
    const dup = S.classes.length - n0;
    el.value = 'W'.repeat(90); addClass();
    return { blank, dup, longLen: S.classes[S.classes.length - 1].name.length, maxlength: el.maxLength };
  });
  check('a blank class is refused', cls.blank === 0, JSON.stringify(cls));
  check('a class with an existing name (any case) is refused', cls.dup === 0, JSON.stringify(cls));
  check('class names stop at 60 characters', cls.longLen === 60 && cls.maxlength === 60, JSON.stringify(cls));

  console.log('— nothing wider than a phone —');
  for (const [pg, sec] of [['grid'], ['points'], ['tech'], ['announce'], ['finals'], ['signup'], ['admin', 'classes'], ['admin', 'tech']]) {
    const wide = await p.evaluate(([pg, sec]) => { nav(pg); if (sec) admOpen(sec); return document.documentElement.scrollWidth - innerWidth; }, [pg, sec]);
    check((sec ? 'admin/' + sec : pg) + ' fits a 375px phone with long names', wide <= 1, wide + 'px wider');
  }

  console.log('— taps —');
  const dbl = await p.evaluate(() => {
    nav('signup'); if (!document.getElementById('dName')) resetReg();
    const n = document.getElementById('dName'), v = document.getElementById('dNum');
    n.value = 'Double Tap'; v.value = '44'; n.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('input')); renderChips();
    const c = S.classes[0], e = document.getElementById('ch' + c.id); if (e && !e.classList.contains('on')) e.click();
    const chk = document.getElementById('consentChk'); if (chk) chk.checked = true;
    const before = S.raceDay.entries.length;
    const btn = [...document.querySelectorAll('button')].find(x => /draw my pills/i.test(x.textContent));
    btn.click(); btn.click(); btn.click();
    return S.raceDay.entries.length - before;
  });
  check('tapping "Draw my pills" three times enters the driver once, no error', dbl === 1 && !errs.length, dbl + ' entries · ' + errs.join(' | '));

  console.log('— demo watermark —');
  const wm = await p.evaluate(() => {
    const tb = document.querySelector('.tabbar'); if (!tb || getComputedStyle(tb).display === 'none') return 'no tabbar';
    const after = getComputedStyle(document.body, '::after');
    const bottom = parseFloat(after.bottom), h = parseFloat(after.height) || 26;
    return { clear: innerHeight - bottom > tb.getBoundingClientRect().top - 0 ? false : true, wmTop: innerHeight - bottom - h, tabTop: tb.getBoundingClientRect().top, bottom };
  });
  check('on a phone the DEMO tag sits above the tab bar', typeof wm === 'object' && wm.bottom >= 60, JSON.stringify(wm));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n==== v2-breakit: ${pass} passed, ${fail} failed ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
