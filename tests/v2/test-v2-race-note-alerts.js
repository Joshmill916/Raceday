// Race notes reach drivers (2026-11-13): a note posted in Admin → Schedule & notes must get a
// driver's attention on their "My lineup" phone, not silently swap text at the top of a page.
// Guards: posting keeps tonight's notes (newest first, max 5, cleared by a new race day); a
// following phone (viewer) pops a banner + vibrates the FIRST time synced data brings a new
// note, never again for the same note; the note shows with its time (+ NEW) on the Lineups
// view AND the Results tab, with earlier notes under it; text stays escaped; staff screens
// don't pop alerts.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8874;
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.addInitScript(() => { window.__buzz = []; navigator.vibrate = p => { window.__buzz.push(p); return true; }; });
  const p = await ctx.newPage();
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/raceday2/?demo=1`); await p.waitForTimeout(900);
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1'); });

  console.log('— posting keeps tonight\'s notes —');
  const posted = await p.evaluate(() => {
    delete S.settings.raceNote; delete S.settings.raceNotes; save();
    admOpen('schedule');
    for (let i = 1; i <= 7; i++) { document.getElementById('raceNoteIn').value = 'Note ' + i; postRaceNote(); S.settings.raceNote.at = S.settings.raceNotes[0].at = Date.now() - (8 - i) * 60000; }
    return { cur: raceNote(), list: raceNotes().map(n => n.text) };
  });
  check('newest note is current', posted.cur === 'Note 7');
  check("tonight's list is newest first, max 5", JSON.stringify(posted.list) === JSON.stringify(['Note 7', 'Note 6', 'Note 5', 'Note 4', 'Note 3']), JSON.stringify(posted.list));
  check('admin card lists what was posted tonight', await p.evaluate(() => { admOpen('schedule'); return /Posted tonight/.test(document.body.textContent) && /Note 3/.test(document.body.textContent); }));

  console.log('— a driver\'s phone —');
  // Become a following phone and receive the track's settings the way sync delivers them.
  const deliver = async (settings) => p.evaluate(st => {
    syncApplySnapshot({ settings: JSON.stringify(st) });
  }, settings);
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'viewer'); localStorage.removeItem('rd_note_seen'); applyRole && applyRole(); nav('grid'); });
  const now = Date.now();
  const st1 = await p.evaluate(() => JSON.parse(JSON.stringify(S.settings)));
  st1.raceNote = { text: 'Kid Karts to the grid <b>now</b>', at: now };
  st1.raceNotes = [st1.raceNote, { text: 'Drivers meeting at 12:45', at: now - 3600000 }];
  await deliver(st1);
  const a1 = await p.evaluate(() => {
    const el = document.getElementById('noteAlert');
    return { shown: !!el && el.style.display !== 'none', text: el ? el.textContent : '', html: el ? el.innerHTML : '', buzz: window.__buzz.length };
  });
  check('a new note pops an alert on the phone', a1.shown && /Kid Karts to the grid/.test(a1.text), a1.text);
  check('…and vibrates', a1.buzz === 1, String(a1.buzz));
  check('…with the text escaped', /&lt;b&gt;now/.test(a1.html) && !/<b>now<\/b>/.test(a1.html));
  const lineups = await p.evaluate(() => document.getElementById('gridWrap').innerHTML);
  check('Lineups view shows the note with its time and NEW', /Kid Karts to the grid/.test(lineups) && /note-time/.test(lineups) && /note-new/.test(lineups));
  check('…and earlier notes under it', /Earlier tonight \(1\)/.test(lineups) && /Drivers meeting at 12:45/.test(lineups));
  await p.evaluate(() => hideNoteAlert());
  await deliver(st1);   // the same note arrives again (any later sync)
  check('the same note never pops twice', await p.evaluate(() => document.getElementById('noteAlert').style.display === 'none' && window.__buzz.length === 1));
  await p.evaluate(() => nav('finals'));
  const fin = await p.evaluate(() => document.getElementById('finalsWrap').innerHTML);
  check('Results tab shows the note too', /Kid Karts to the grid/.test(fin) && /Earlier tonight/.test(fin));
  const st2 = Object.assign({}, st1, { raceNote: { text: 'Red flag — single file restart', at: now + 1000 } });
  st2.raceNotes = [st2.raceNote].concat(st1.raceNotes);
  await deliver(st2);
  check('a newer note pops again, wherever the driver is', await p.evaluate(() => /Red flag/.test(document.getElementById('noteAlert').textContent) && document.getElementById('noteAlert').style.display !== 'none' && window.__buzz.length === 2));
  const old = Object.assign({}, st1, { raceNote: { text: 'Stale', at: now - 7200000 }, raceNotes: [] });
  await p.evaluate(() => localStorage.setItem('rd_note_seen', String(Date.now())));
  await p.evaluate(() => hideNoteAlert());
  await deliver(old);
  check('a note older than one already seen does not pop', await p.evaluate(() => document.getElementById('noteAlert').style.display === 'none'));
  const oldBanner = await p.evaluate(() => { S.settings.raceNote.at = Date.now() - 30 * 60000; return raceNoteBanner(); });
  check('NEW tag drops after 10 minutes', !/note-new/.test(oldBanner) && /Stale/.test(oldBanner));

  console.log('— staff screens + new race day —');
  await p.evaluate(() => { localStorage.setItem('rd_role_v2', 'admin'); localStorage.removeItem('rd_note_seen'); hideNoteAlert(); });
  const st3 = Object.assign({}, st1, { raceNote: { text: 'Staff should not get a pop-up', at: Date.now() + 5000 } });
  await deliver(st3);
  check('admin / staff devices do not pop alerts', await p.evaluate(() => { const el = document.getElementById('noteAlert'); return !el || el.style.display === 'none'; }));
  check('Results tab on staff screens has no fan banner', await p.evaluate(() => { nav('finals'); return !/fan-note/.test(document.getElementById('finalsWrap').innerHTML); }));
  const cleared = await p.evaluate(() => { newRaceDay(); return { note: S.settings.raceNote, list: S.settings.raceNotes }; });
  check('a new race day clears the note and tonight\'s list', !cleared.note && !cleared.list, JSON.stringify(cleared));
  check('notes live in synced settings', await p.evaluate(() => SYNC_FIELDS.includes('settings')));

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
