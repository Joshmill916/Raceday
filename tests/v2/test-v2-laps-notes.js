// v2 laps per class, tonight's schedule and the race note — what tracks used to write on paper
// sheets taped to the wall ("8 laps", "Heats 1:00", "red at lap 20"). Shown on the TV and the fan
// view; only an admin can set them; the note clears when a new race day starts.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8852;
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
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await p.route(/^(?!http:\/\/localhost)/, r => r.abort());
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${PORT}/raceday2/?demo=1`); await p.waitForTimeout(900);
  await p.evaluate(() => {
    localStorage.setItem('rd_role_v2', 'admin'); sessionStorage.setItem('rd_admin_ok', '1');
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });

  console.log('— all optional: nothing set = nothing changes —');
  check('a track that sets none of it sees no laps, schedule or note anywhere', await p.evaluate(() => {
    S.classes.forEach(c => delete c.laps); delete S.settings.schedule; delete S.settings.raceNote; save();
    const subs = ['cycle', 'stage', 'now'].flatMap(m => { S.settings.tv = { mode: m }; return tvSlides().map(s => JSON.stringify(s)); });
    openTV(); tvRender(); const noteHidden = document.getElementById('tvNote').style.display === 'none'; closeTV();
    const fan = fanHero();
    const card = S.classes.map(c => { const d = classRacers(c.id)[0]; return d ? myNightClassMarkup(myNight(d.id).classes.find(x => x.cls.id === c.id)) : ''; }).join('');
    return !subs.some(s => /laps|"schedule"/.test(s)) && noteHidden && !/fan-note|fan-sched/.test(fan) && !/laps/.test(card);
  }));
  check('nothing new is required: no laps/schedule/note fields are added by save or migrate', await p.evaluate(() => {
    const st = JSON.parse(localStorage.getItem(activeKey()));
    return !st.settings.schedule && !st.settings.raceNote && st.classes.every(c => !('laps' in c));
  }));

  console.log('— laps per class —');
  check('setClassLaps stores, clamps and clears', await p.evaluate(() => {
    const c = S.classes[0];
    setClassLaps(c.id, 'heat', '8'); setClassLaps(c.id, 'feature', '5000'); setClassLaps(c.id, 'bogus', '3');
    const a = c.laps.heat === 8 && c.laps.feature === 999 && !('bogus' in c.laps);
    setClassLaps(c.id, 'heat', ''); setClassLaps(c.id, 'feature', '0');
    return a && !('laps' in c);
  }));
  check('blank laps leave labels unchanged', await p.evaluate(() => withLaps('Heat 1', S.classes[0], 'heat') === 'Heat 1'));
  check('TV rotate slides carry heat + feature laps', await p.evaluate(() => {
    const c = S.classes[0]; setClassLaps(c.id, 'heat', '8'); setClassLaps(c.id, 'feature', '15');
    S.settings.tv = { mode: 'cycle' };
    const mine = tvSlides().filter(s => s.title === c.name && s.kind === 'grid');
    return mine.some(s => /Set 1 · 8 laps$/.test(s.sub)) && mine.some(s => /Feature lineup · 15 laps$/.test(s.sub));
  }));
  check('TV whole-stage board labels carry laps', await p.evaluate(() => {
    const c = S.classes[0]; S.settings.tv = { mode: 'stage', stage: 'set1' };
    return tvSlides().some(s => s.kind === 'board' && s.races.some(r => r.title === c.name && /8 laps$/.test(r.label)));
  }));
  check("the driver's own heat card (My night) shows laps", await p.evaluate(() => {
    const c = S.classes[0], d = classRacers(c.id)[0];
    return /Start P\d[^<]* · 8 laps/.test(myNightClassMarkup(myNight(d.id).classes.find(x => x.cls.id === c.id)));
  }));
  check('class card has the laps inputs', await p.evaluate(() => {
    admOpen('classes'); return document.querySelectorAll('input[onchange^="setClassLaps(' + S.classes[0].id + '"]').length === 3;
  }));

  console.log('— schedule + race note —');
  check('schedule rows save, blanks drop out', await p.evaluate(() => {
    admOpen('schedule');
    setScheduleRow(0, 'label', 'Practice'); setScheduleRow(0, 'time', '10:30 AM');
    setScheduleRow(1, 'label', 'Heats'); setScheduleRow(1, 'time', '1:00 PM');
    setScheduleRow(2, 'label', ' '); setScheduleRow(0, 'evil', 'x');
    const s = nightSchedule();
    return s.length === 2 && s[0].label === 'Practice' && s[1].time === '1:00 PM' && !('evil' in s[0]);
  }));
  check('schedule is the first TV screen in rotate mode', await p.evaluate(() => {
    S.settings.tv = { mode: 'cycle' }; const s = tvSlides()[0]; return s.kind === 'schedule' && s.rows.length === 2;
  }));
  check('posting a note shows it on the TV header', await p.evaluate(() => {
    admOpen('schedule');
    document.getElementById('raceNoteIn').value = 'Red flag at lap 20 <b>restart</b> single file';
    postRaceNote(); openTV(); tvRender();
    const el = document.getElementById('tvNote');
    const ok = el.style.display !== 'none' && /Red flag at lap 20/.test(el.textContent) && !el.querySelector('b');
    closeTV(); return ok;
  }));
  check('TV schedule screen renders the times', await p.evaluate(() => {
    openTV(); TV.idx = 0; tvRender(); const t = document.getElementById('tvSlide').textContent; closeTV();
    return /Practice/.test(t) && /10:30 AM/.test(t);
  }));
  check('fan view shows the note (escaped) + schedule', await p.evaluate(() => {
    const h = fanHero();
    return /fan-note/.test(h) && /&lt;b&gt;restart/.test(h) && /Heats <b>1:00 PM<\/b>/.test(h);
  }));
  check('note is capped at 140 chars', await p.evaluate(() => {
    admOpen('schedule'); document.getElementById('raceNoteIn').value = 'x'.repeat(300); postRaceNote();
    return raceNote().length === 140;
  }));

  console.log('— permissions + lifecycle —');
  check('a viewer cannot post a note, schedule or laps', await p.evaluate(() => {
    const before = JSON.stringify([S.settings.raceNote, S.settings.schedule, S.classes[0].laps]);
    localStorage.setItem('rd_role_v2', 'viewer');
    let blocked = false;
    try {
      setScheduleRow(0, 'label', 'Hacked'); setClassLaps(S.classes[0].id, 'heat', '99'); clearRaceNote();
      blocked = JSON.stringify([S.settings.raceNote, S.settings.schedule, S.classes[0].laps]) === before;
    } finally { localStorage.setItem('rd_role_v2', 'admin'); }
    return blocked;
  }));
  check('new race day clears the note, keeps schedule + laps', await p.evaluate(() => {
    newRaceDay();
    return !raceNote() && nightSchedule().length === 2 && classLaps(S.classes[0], 'heat') === 8;
  }));
  check('fields live in synced places (settings, classes)', await p.evaluate(() =>
    SYNC_FIELDS.includes('settings') && SYNC_FIELDS.includes('classes')));

  check('no page errors', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
