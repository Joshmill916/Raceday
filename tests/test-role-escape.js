// Staff-device escape: a device opened from a Registration / Scoring / TV / Tech / Announcer
// link must have a way back to admin (⚙ Device job in v2, ⚙ Role in v1), gated by the admin
// PIN when one is set. Regression for a real report: a v2 announcer device had no way out at
// all, and a TV/announcer device with a PIN rejected even the correct PIN (adminOk() refuses
// those roles outright). Spectators must still get NO escape control and no role change.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8842;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': path.extname(u) === '.js' ? 'application/javascript' : 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  // answers: queue of replies for prompt()/confirm(), in order. Returns the dialogs seen.
  const open = async (app) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(app + ': ' + e.message));
    const st = { answers: [], seen: [] };
    page.on('dialog', d => {
      st.seen.push(d.type() + ':' + d.message().slice(0, 60));
      const a = st.answers.length ? st.answers.shift() : null;
      if (d.type() === 'prompt') { if (a === null) d.dismiss(); else d.accept(String(a)); }
      else if (d.type() === 'confirm') { if (a === false) d.dismiss(); else d.accept(); }
      else d.accept();
    });
    await page.goto(`http://localhost:${PORT}/${app}/`);
    await page.waitForTimeout(600);
    return { ctx, page, st };
  };
  const setRole = (page, role, pin) => page.evaluate(({ role, pin }) => {
    S.track.name = S.track.name || 'Test Track';
    S.adminPin = pin ? pinHash(pin) : '';
    try { sessionStorage.removeItem('rd_admin_ok'); } catch (e) {}
    setDeviceRole(role); save(); applyRole();
  }, { role, pin });
  const role = (page) => page.evaluate(() => deviceRole());

  // ============================================================================
  console.log('\n=== v2: the Device job button ===');
  for (const r of ['announcer', 'scoring', 'register', 'tech', 'tv']) {
    const { ctx, page } = await open('raceday2');
    await setRole(page, r, '');
    check(r + ' device shows ⚙ Device job', await page.evaluate(() => { renderHeader(); return !!document.getElementById('roleEscape'); }));
    await ctx.close();
  }
  for (const r of ['admin', 'viewer']) {
    const { ctx, page } = await open('raceday2');
    await setRole(page, r, '');
    check(r + ' device has no escape button', await page.evaluate(() => { renderHeader(); return !document.getElementById('roleEscape'); }));
    await ctx.close();
  }

  console.log('\n=== v2: announcer gets back to admin ===');
  {
    const { ctx, page, st } = await open('raceday2');
    await setRole(page, 'announcer', '');
    st.answers = [true, 'admin'];   // "no PIN set" warning, then the job prompt
    await page.evaluate(() => changeDeviceRole());
    check('no PIN: warns, then switches to admin', (await role(page)) === 'admin' && st.seen.some(s => /hasn't set an admin PIN/.test(s)), JSON.stringify(st.seen));
    await ctx.close();
  }
  {
    const { ctx, page, st } = await open('raceday2');
    await setRole(page, 'announcer', '4321');
    st.answers = ['1111'];
    await page.evaluate(() => changeDeviceRole());
    check('with a PIN: the wrong PIN keeps it an announcer', (await role(page)) === 'announcer', await role(page));
    st.answers = ['4321', 'admin'];
    await page.evaluate(() => changeDeviceRole());
    check('with a PIN: the right PIN switches it back to admin', (await role(page)) === 'admin', JSON.stringify(st.seen));
    check('…and the admin tabs come back', await page.evaluate(() => /ADMIN/i.test(document.getElementById('tabbar').innerText)));
    await ctx.close();
  }
  {
    const { ctx, page, st } = await open('raceday2');
    await setRole(page, 'tv', '4321');
    st.answers = ['4321', 'admin'];
    await page.evaluate(() => { if (typeof closeTV === 'function') try { closeTV(); } catch (e) {} changeDeviceRole(); });
    check('TV device with the right PIN switches back', (await role(page)) === 'admin', await role(page));
    check('adminOk() still refuses a TV device (escape does not open admin actions)', await page.evaluate(() => { setDeviceRole('tv'); return adminOk() === false; }));
    await ctx.close();
  }

  console.log('\n=== v2: spectators can never switch ===');
  {
    const { ctx, page, st } = await open('raceday2');
    await setRole(page, 'viewer', '');
    st.answers = [true, 'admin'];
    await page.evaluate(() => changeDeviceRole());
    check('viewer changeDeviceRole() does nothing, asks nothing', (await role(page)) === 'viewer' && st.seen.length === 0, JSON.stringify(st.seen));
    await ctx.close();
  }

  console.log('\n=== v1: TV device with a PIN ===');
  {
    const { ctx, page, st } = await open('raceday');
    await setRole(page, 'tv', '4321');
    check('v1 shows ⚙ Role on a TV device', await page.evaluate(() => getComputedStyle(document.getElementById('roleEscape')).display !== 'none'));
    st.answers = ['1111'];
    await page.evaluate(() => changeDeviceRole());
    check('v1: wrong PIN keeps it a TV', (await role(page)) === 'tv');
    st.answers = ['4321', 'admin'];
    await page.evaluate(() => changeDeviceRole());
    check('v1: right PIN switches it back to admin (was refused before)', (await role(page)) === 'admin', JSON.stringify(st.seen));
    await ctx.close();
  }
  {
    const { ctx, page, st } = await open('raceday');
    await setRole(page, 'viewer', '');
    st.answers = [true, 'admin'];
    await page.evaluate(() => changeDeviceRole());
    check('v1 viewer still cannot switch', (await role(page)) === 'viewer' && st.seen.length === 0);
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${fail ? '❌' : '✅'} role-escape: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
