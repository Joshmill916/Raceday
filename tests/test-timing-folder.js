// Timing folder (v2, /raceday2/): setting up timing software must be easy. Regression for a
// real report: v1 let a track point RaceDay at MotoSponder's export folder and new results
// loaded on their own; v2 dropped that, so every session meant hunting for the file.
// Guards: the first class set to a qualifying format asks where times come from (once);
// picking timing software saves the folder (per computer) and the choice (track-wide);
// the import sheet then offers "Start watching <folder>"; a new export in that folder is
// read on its own, imported when every driver matches cleanly, and held for review when
// not; files already in the folder are ignored; closing the sheet stops the watch; devices
// without folder access get the choose-a-file path; "we type them in" is remembered too.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8871;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

// A stand-in for Chrome's folder picker: window.__fs holds the folder's files, and tests add
// files to it the way timing software would save an export.
const fakeFolderApi = () => {
  window.__fs = { 'old-results.csv': { text: 'Pos,Name\n1,Old Driver\n', mtime: Date.now() - 600000 } };
  window.__perm = 'granted';
  const handle = {
    kind: 'directory', name: 'MotoSponder Exports',
    requestPermission: async () => window.__perm,
    queryPermission: async () => window.__perm,
    entries: async function* () {
      for (const [n, f] of Object.entries(window.__fs)) {
        yield [n, { kind: 'file', getFile: async () => ({ lastModified: f.mtime, text: async () => f.text }) }];
      }
    }
  };
  window.showDirectoryPicker = async () => { window.__picked = (window.__picked || 0) + 1; return handle; };
};

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    fs.readFile(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  const open = async (withFolders) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route(/^(?!http:\/\/localhost)/, r => r.abort());
    if (withFolders) await ctx.addInitScript(fakeFolderApi);
    else await ctx.addInitScript(() => { delete window.showDirectoryPicker; });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`http://localhost:${PORT}/raceday2/`);
    await page.waitForTimeout(700);
    // A set-up track: two classes on pill draw, three drivers in the book (with transponders).
    await page.evaluate(() => {
      closeSheet && closeSheet();
      S.track.name = 'Test Track';
      S.classes = [{ id: 1, name: 'Junior', maxPill: 200, heats: 2 }, { id: 2, name: 'Senior', maxPill: 200, heats: 2 }];
      S.roster = [
        { id: 101, name: 'Ava Brooks', num: '7', trans: '1001' },
        { id: 102, name: 'Ben Carter', num: '12', trans: '1002' },
        { id: 103, name: 'Cody Diaz', num: '3', trans: '1003' }
      ];
      S.raceDay.entries = [];
      delete S.settings.timingSource;
      save();
    });
    return { ctx, page, dialogs };
  };
  const sheetTitle = page => page.evaluate(() => { const h = document.getElementById('sheetHost'); const t = document.getElementById('sheetTitle'); return h && getComputedStyle(h).display !== 'none' && !h.hidden ? t.textContent : ''; });

  console.log('\n=== Setting a class to qualifying asks where times come from ===');
  {
    const { ctx, page } = await open(true);
    await page.evaluate(() => { document.getElementById('sheetTitle').textContent = ''; setClassHeats(1, '2'); });
    await page.waitForTimeout(200);
    check('staying on pill draw asks nothing', !/qualifying times/i.test(await page.evaluate(() => document.getElementById('sheetTitle').textContent)));
    await page.evaluate(() => setClassHeats(1, '1'));
    await page.waitForTimeout(200);
    check('switching to qualifying opens the question', /Where do your qualifying times come from/.test(await page.evaluate(() => document.getElementById('sheetTitle').textContent)));
    check('…with timing software and type-them-in options', await page.evaluate(() => /Timing software/.test(sheetBody.textContent) && /We type them in/.test(sheetBody.textContent)));
    await page.evaluate(() => timingSourceStep2());
    check('timing software asks for the export folder, mentioning MotoSponder', await page.evaluate(() => /Pick the folder/.test(sheetBody.textContent) && /MotoSponder/.test(sheetBody.textContent)));
    await page.evaluate(() => setTimingSource('folder'));
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ src: S.settings.timingSource, name: TimingDir.handle && TimingDir.handle.name, picked: window.__picked }));
    check('choice saved track-wide as folder', st.src === 'folder', st.src);
    check('folder remembered on this computer', st.name === 'MotoSponder Exports', st.name);
    await page.evaluate(() => { closeSheet(); document.getElementById('sheetTitle').textContent = ''; setClassHeats(2, '0'); });
    await page.waitForTimeout(200);
    check('a second qualifying class does not ask again', !/qualifying times/i.test(await page.evaluate(() => document.getElementById('sheetTitle').textContent)));
    const card = await page.evaluate(() => timingSourceCard());
    check('Admin → Race format shows the folder being used', /watching <b>MotoSponder Exports<\/b>/.test(card));

    console.log('\n=== Race night: watch the folder ===');
    await page.evaluate(() => { closeSheet(); openImport('qual'); });
    await page.waitForTimeout(200);
    check('import sheet offers "Start watching <folder>"', await page.evaluate(() => /Start watching MotoSponder Exports/.test(document.getElementById('impWatchBtn').textContent)));
    await page.evaluate(() => impStartWatch());
    await page.waitForTimeout(400);
    check('watching starts (status shows folder → Qualifying)', await page.evaluate(() => /Watching MotoSponder Exports → Qualifying/.test(document.getElementById('impWatchStatus').textContent)));
    await page.waitForTimeout(3500);
    check('a file already in the folder is ignored', await page.evaluate(() => S.raceDay.entries.length === 0 && !Imp.lastFile));
    // MotoSponder-style export: Pos, First/Last, Number, Transponder, best lap
    await page.evaluate(() => { window.__fs['junior-qualifying.csv'] = { mtime: Date.now() - 2000, text:
      'Pos,First Name,Last Name,Number,Transponder,Best Lap\n1,Ben,Carter,12,1002,00:00:18.112\n2,Ava,Brooks,7,1001,00:00:18.540\n3,Cody,Diaz,3,1003,00:00:19.004\n' }; });
    await page.waitForFunction(() => S.raceDay.entries.length === 3, null, { timeout: 8000 }).catch(() => {});
    const q = await page.evaluate(() => S.raceDay.entries.filter(e => e.classId === 1).sort((a, b) => a.pill - b.pill).map(e => e.driverId));
    check('a new clean export imports on its own, in qualifying order', JSON.stringify(q) === '[102,101,103]', JSON.stringify(q));
    check('sheet stays open and keeps watching', await page.evaluate(() => !!(Imp && Imp.watchDir && Imp.watchInterval) && /Still watching/.test(document.getElementById('impWatchStatus').textContent)));
    // An export with a driver who isn't in the book: hold for review, don't import.
    await page.evaluate(() => { S.raceDay.entries = []; save(); window.__fs['senior-qualifying.csv'] = { mtime: Date.now() - 2000, text:
      'Pos,First Name,Last Name,Number,Transponder,Best Lap\n1,Zed,Unknown,99,9999,00:00:17.900\n2,Ava,Brooks,7,1001,00:00:18.540\n' }; });
    await page.waitForFunction(() => Imp && Imp.lastFile === 'senior-qualifying.csv', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const held = await page.evaluate(() => ({ n: S.raceDay.entries.length, status: document.getElementById('impWatchStatus').textContent }));
    check('an export with an unmatched driver is held, not imported', held.n === 0, String(held.n));
    check('…and the status says it needs a look', /needs a look/.test(held.status), held.status);
    await page.evaluate(() => closeSheet());
    await page.waitForTimeout(200);
    const timers = await page.evaluate(() => Imp === null);
    check('closing the sheet stops the watch', timers);
    await ctx.close();
  }

  console.log('\n=== Permission refused ===');
  {
    const { ctx, page } = await open(true);
    await page.evaluate(async () => { await setTimingSource('folder'); closeSheet(); window.__perm = 'denied'; openImport('qual'); await impStartWatch(); });
    check('refused permission: not watching, explains why', await page.evaluate(() => !Imp.watchDir && /needs permission/.test(document.getElementById('impWatchStatus').textContent)));
    await ctx.close();
  }

  console.log('\n=== Devices that cannot watch a folder (Safari, iPad, phones) ===');
  {
    const { ctx, page, dialogs } = await open(false);
    await page.evaluate(() => setClassHeats(1, '1'));
    await page.waitForTimeout(200);
    await page.evaluate(() => timingSourceStep2());
    await page.waitForTimeout(200);
    check('timing software → choose-a-file path, saved', await page.evaluate(() => S.settings.timingSource === 'file'));
    check('…with directions to set it up on the timing computer', dialogs.some(m => /Chrome or Edge on the computer that runs your timing software/.test(m)), JSON.stringify(dialogs));
    await page.evaluate(() => openImport('qual'));
    check('import sheet has no watch button there', await page.evaluate(() => !document.getElementById('impWatchBtn') && !!document.getElementById('impFile')));
    await ctx.close();
  }

  console.log('\n=== "We type them in" ===');
  {
    const { ctx, page } = await open(true);
    await page.evaluate(() => setClassHeats(1, '0'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setTimingSource('hand'));
    check('hand timing remembered', await page.evaluate(() => S.settings.timingSource === 'hand' && /Typed in by hand/.test(timingSourceCard())));
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n✅ timing-folder: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
