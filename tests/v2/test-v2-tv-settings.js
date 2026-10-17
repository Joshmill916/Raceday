// v2 TV display settings (Admin → TV display, S.settings.tv): rotate / whole-stage / now modes,
// stage auto-advance (Set 1 → Set 2 → B-mains → features → results), seconds per screen,
// text size, clock, grid file. Requested by the owner: "show all the heats at one time, just
// the first set, then second set after first set finishes, then B mains then features".
// The fitting check guards a real bug: at Large text the last driver in each card was clipped.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8846;
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
    // Snapshot the fully-scored demo night so each stage can be rebuilt from it.
    window.__full = JSON.stringify(S.classes.map(c => [c.id, getRes(c.id)]));
    window.__keep = (re) => {
      JSON.parse(window.__full).forEach(([id, res]) => {
        const cur = getRes(id); Object.keys(cur).forEach(k => delete cur[k]);
        Object.keys(res).forEach(k => { if (re.test(k)) cur[k] = res[k]; });
      });
      save();
    };
  });

  console.log('— settings defaults + cleaning —');
  check('defaults: rotate, auto, normal, clock on', await p.evaluate(() => {
    S.settings.tv = undefined; const c = tvCfg();
    return c.mode === 'cycle' && c.stage === 'auto' && c.size === 'normal' && c.clock === true && c.file === '' && c.secs === TV_SECS;
  }));
  check('junk values fall back to defaults', await p.evaluate(() => {
    S.settings.tv = { mode: 'x', stage: 'y', size: 'huge', secs: 999, file: 'triple' }; const c = tvCfg();
    return c.mode === 'cycle' && c.stage === 'auto' && c.size === 'normal' && c.secs === TV_SECS && c.file === '';
  }));
  check('seconds 5–60 honored', await p.evaluate(() => { S.settings.tv = { secs: 20 }; return tvCfg().secs === 20; }));
  check('text size scales: large 1.3, xl 1.65', await p.evaluate(() => {
    S.settings.tv = { size: 'large' }; const a = tvK(); S.settings.tv = { size: 'xl' }; return a === 1.3 && tvK() === 1.65;
  }));
  check('grid file overrides Lineups setting', await p.evaluate(() => {
    S.settings.gridStyle = 'double'; S.settings.tv = { file: 'single' }; const a = tvSingle();
    S.settings.tv = {}; const b = tvSingle(); return a === true && b === false;
  }));

  console.log('— stage follows the night —');
  const stage = () => p.evaluate(() => tvStageNow());
  await p.evaluate(() => __keep(/^$/));
  check('nothing scored → Set 1', (await stage()) === 'set1', await stage());
  await p.evaluate(() => __keep(/^h1_/));
  const hasSet2 = await p.evaluate(() => raceOrder().some(r => r.stage === 'set2'));
  check('Set 1 scored → Set 2', !hasSet2 || (await stage()) === 'set2', await stage());
  await p.evaluate(() => __keep(/^h[12]_/));
  const hasB = await p.evaluate(() => raceOrder().some(r => r.stage === 'bmain' && r.ready));
  check('heats scored → B-mains (or features if no B-mains)', (await stage()) === (hasB ? 'bmain' : 'feature'), await stage());
  await p.evaluate(() => __keep(/^(h[12]|bm\d*)_/));
  check('B-mains scored → features', (await stage()) === 'feature', await stage());
  await p.evaluate(() => __keep(/./));
  check('everything scored → done (results + points)', (await stage()) === 'done');
  check('done stage shows result slides', await p.evaluate(() => { S.settings.tv = { mode: 'stage' }; const s = tvSlides(); return s.length > 0 && s.every(x => x.kind === 'results' || x.kind === 'points'); }));
  check('a pinned stage overrides auto', await p.evaluate(() => {
    S.settings.tv = { mode: 'stage', stage: 'set1' }; const s = tvSlides();
    return s[0].kind === 'board' && /Set 1/.test(s[0].title) && s[0].races.every(r => r.status === 'done');
  }));

  console.log('— whole-stage board —');
  await p.evaluate(() => {
    // Mid Set 1: only the first heat scored.
    __keep(/^$/); const first = raceOrder()[0];
    const full = new Map(JSON.parse(__full)); const res = getRes(first.cls.id);
    first.grid.forEach(r => { res['h1_' + r.id] = full.get(first.cls.id)['h1_' + r.id]; }); save();
  });
  const b = await p.evaluate(() => { S.settings.tv = { mode: 'stage' }; const s = tvSlides(); const n = raceOrder().filter(r => r.stage === 'set1').length;
    return { kind: s[0].kind, title: s[0].title, shown: s.reduce((a, x) => a + x.races.length, 0), n, st: s[0].races.map(r => r.status) }; });
  check('every Set 1 heat is on the board', b.kind === 'board' && b.shown === b.n, JSON.stringify(b));
  check('first heat Finished, second On Track, rest Next', b.st[0] === 'done' && b.st[1] === 'now' && b.st.slice(2).every(x => x === 'next'), b.st.join(','));
  check('labels drop the " · Set N" suffix', await p.evaluate(() => tvSlides()[0].races.every(r => !/Set \d/.test(r.label))));
  check('cards per screen: 6 / 4 / 2 by text size', await p.evaluate(() => ['normal', 'large', 'xl'].map(sz => { S.settings.tv = { mode: 'stage', size: sz }; return tvSlides()[0].per; }).join() === '6,4,2'));

  for (const size of ['normal', 'large', 'xl']) {
    const fit = await p.evaluate(sz => {
      S.settings.tv = { mode: 'stage', size: sz }; save(); if (TV.on) closeTV(); openTV();
      const cards = [...document.querySelectorAll('.tv-bd-card')];
      const clipped = cards.filter(c => { const last = c.querySelector('.tv-bd-row:last-child'); return last && last.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom + 1; });
      const boardOut = cards.some(c => c.getBoundingClientRect().bottom > innerHeight);
      return { cards: cards.length, clipped: clipped.length, boardOut };
    }, size);
    check(size + ' text: every driver fits inside its card', fit.cards > 0 && fit.clipped === 0 && !fit.boardOut, JSON.stringify(fit));
  }

  console.log('— now mode + clock + timing —');
  check('now mode: one big grid of the race on track', await p.evaluate(() => {
    S.settings.tv = { mode: 'now' }; const s = tvSlides(); const a = announceNow();
    return s.length === 1 && s[0].kind === 'grid' && s[0].title === a.now.cls.name && /Up next/.test(s[0].sub);
  }));
  check('clock can be hidden', await p.evaluate(() => {
    S.settings.tv = { mode: 'now', clock: false }; save(); if (TV.on) closeTV(); openTV();
    const el = document.querySelector('#tvClock, .tv-clock'); return !el || getComputedStyle(el).display === 'none' || el.style.visibility === 'hidden';
  }));
  check('setTv saves and is admin-only', await p.evaluate(() => {
    closeTV(); setTv('secs', 25); const ok = S.settings.tv.secs === 25;
    setDeviceRole('viewer'); setTv('secs', 7); const blocked = S.settings.tv.secs === 25; setDeviceRole('admin'); return ok && blocked;
  }));
  check('settings live in S.settings (synced to the TV)', await p.evaluate(() => SYNC_FIELDS.includes('settings')));

  console.log('— admin section —');
  const adm = await p.evaluate(() => {
    S.settings.tv = { mode: 'stage' }; save(); nav('admin'); admOpen('tv');
    return { mode: !!document.getElementById('tvMode'), stage: !!document.getElementById('tvStage'), secs: !!document.getElementById('tvSecs'),
      size: !!document.getElementById('tvSize'), file: !!document.getElementById('tvFile'), clock: !!document.getElementById('tvClockOn') };
  });
  check('TV display section has every control', Object.values(adm).every(Boolean), JSON.stringify(adm));
  check('stage picker hidden outside whole-stage mode', await p.evaluate(() => { S.settings.tv = { mode: 'cycle' }; save(); admOpen('tv'); return !document.getElementById('tvStage'); }));
  check('changing the mode select saves it', await p.evaluate(() => {
    const s = document.getElementById('tvMode'); s.value = 'now'; s.dispatchEvent(new Event('change')); return tvCfg().mode === 'now';
  }));

  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${fail ? '❌' : '✅'} v2-tv-settings: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
