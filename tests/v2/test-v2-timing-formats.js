// v2 timing import: MYLAPS Orbits (tab-separated, title lines, First/Last name), Westhold Race
// Manager (Place/No./Name/Trns ID/Laps/Lag/Scored Time; qualifying Fast Lap = a lap NUMBER, Fast
// Time = the time) and a semicolon file with comma decimals — parsed, mapped and imported through
// the real import sheet. Fixtures in test-data/ follow each system's documented column names.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8839;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const fx = f => fs.readFileSync(path.join(ROOT, 'test-data', f), 'utf8');

(async () => {
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'raceday2/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  // Six cars, including two different cars numbered 07 and 7.
  const seed = () => page.evaluate(() => {
    closeSheet(); localStorage.removeItem('rd_role_v2');
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20 }];
    S.settings.maxHeat = 8; S.settings.maxFeature = 20;
    const cars = [['23', 'Casey Rivera'], ['07', 'Jax King'], ['7', 'Mia Nash'], ['88', 'Gia Hall'], ['45', 'Ava Brooks'], ['12', 'Quinn Reed']];
    S.roster = cars.map(([num, name], i) => ({ id: i + 1, name, num, trans: '' }));
    S.raceDay = { date: today(), entries: cars.map((c, i) => ({ driverId: i + 1, classId: 1, pill: i + 1 })), heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {}, tech: {} };
    save(); setDeviceRole('admin'); applyRole();
  });
  const byNum = (map) => page.evaluate(map => { const out = {}; Object.entries(map).forEach(([num, v]) => { out[num] = v; }); return out; }, map);
  const ingest = (target, text, file) => page.evaluate(([target, text, file]) => {
    openImport(target); impIngestText(text, file);
    return { delim: Imp.delim, preamble: Imp.preamble, cols: Imp.cols, vendor: Imp.vendor && Imp.vendor.name, rows: Imp.rows.length,
      statuses: impPreview.map(r => r.status), info: (document.getElementById('impCsvInfo') || {}).textContent || '' };
  }, [target, text, file]);
  const apply = async () => { await page.click('button:has-text("Import ✓")'); await page.waitForTimeout(300); };
  const resultsByNum = (prefix) => page.evaluate(prefix => {
    const res = S.raceDay.heatResults.cls1 || {}, out = {};
    S.roster.forEach(d => { if (res[prefix + d.id] != null) out[d.num] = res[prefix + d.id]; });
    return out;
  }, prefix);
  const gridByNum = () => page.evaluate(() => S.raceDay.entries.filter(e => e.classId === 1).sort((a, b) => a.pill - b.pill).map(e => driverById(e.driverId).num));

  console.log('\n— Delimiter detection —');
  {
    await seed();
    const d = await page.evaluate(f => f.map(t => impDetectDelim(t)), [fx('westhold-race.csv'), fx('mylaps-orbits.tsv'), fx('semicolon.csv'), fx('04-feature-all.csv')]);
    check('Westhold CSV → comma', d[0] === ',', JSON.stringify(d[0]));
    check('MYLAPS Orbits export → tab', d[1] === '\t', JSON.stringify(d[1]));
    check('semicolon export → semicolon (with comma decimals)', d[2] === ';', JSON.stringify(d[2]));
    check('MotoSponder files still read as comma', d[3] === ',', JSON.stringify(d[3]));
    const q = await page.evaluate(() => impParseCSV('Pos,Name,Note\n1,"King, Jax","a; b\tc"\n', ',').slice(-1)[0]);
    check('quoted commas, semicolons and tabs stay inside one cell', q.length === 3 && q[1] === 'King, Jax', JSON.stringify(q));
  }

  console.log('\n— Westhold race results → feature —');
  {
    await seed();
    const r = await ingest('feat', fx('westhold-race.csv'), 'westhold-race.csv');
    check('Westhold format is recognized', r.vendor === 'Westhold', r.vendor);
    check('Place, No., Name and Trns ID columns are found', r.cols.pos === 0 && r.cols.num === 1 && r.cols.name === 2 && r.cols.trans === 3, JSON.stringify(r.cols));
    check('every car matches a driver', r.statuses.length === 6 && r.statuses.every(s => s === 'match'), r.statuses.join());
    await apply();
    const ft = await resultsByNum('ft_');
    check('feature finishes import in order', ft['23'] === 1 && ft['07'] === 2 && ft['7'] === 3 && ft['88'] === 4 && ft['45'] === 5 && ft['12'] === 6, JSON.stringify(ft));
    check('car 07 and car 7 stay separate drivers', ft['07'] === 2 && ft['7'] === 3);
  }

  console.log('\n— Westhold qualifying → grid —');
  {
    await seed();
    const r = await ingest('qual', fx('westhold-qualifying.csv'), 'westhold-qualifying.csv');
    check('the time comes from Fast Time, not Fast Lap (a lap number)', r.cols.time === 6, 'time col=' + r.cols.time);
    await apply();
    const grid = await gridByNum();
    check('fastest qualifier on pole, in Fast Time order', grid.join() === '88,23,07,12,7,45', grid.join());
  }

  console.log('\n— MYLAPS Orbits heat results (tab-separated) —');
  {
    await seed();
    const r = await ingest('heat', fx('mylaps-orbits.tsv'), 'mylaps-orbits.tsv');
    check('MYLAPS Orbits format is recognized', r.vendor === 'MYLAPS Orbits', r.vendor);
    check('the two title lines are skipped', r.preamble === 2 && r.rows === 6, 'preamble=' + r.preamble + ' rows=' + r.rows);
    check('First Name + Last Name, No., Pos, Class and Transponder are found', r.cols.name === 2 && r.cols.name2 === 3 && r.cols.num === 1 && r.cols.pos === 0 && r.cols.cls === 4 && r.cols.trans === 9, JSON.stringify(r.cols));
    check('Best Tm is the time column', r.cols.time === 8, 'time col=' + r.cols.time);
    check('every car matches a driver', r.statuses.every(s => s === 'match'), r.statuses.join());
    await apply();
    const h1 = await resultsByNum('h1_');
    check('heat finishes import, including a DNF', h1['07'] === 1 && h1['23'] === 2 && h1['88'] === 3 && h1['7'] === 4 && h1['12'] === 5 && h1['45'] === 'DNF', JSON.stringify(h1));
  }

  console.log('\n— Semicolon export with comma decimals —');
  {
    await seed();
    const r = await ingest('qual', fx('semicolon.csv'), 'semicolon.csv');
    check('columns are found in a semicolon file', r.cols.pos === 0 && r.cols.num === 1 && r.cols.name === 2 && r.cols.time === 4, JSON.stringify(r.cols));
    await apply();
    const grid = await gridByNum();
    check('times like 48,110 sort correctly into the grid', grid.join() === '12,45,7,88,23,07', grid.join());
  }

  // Orbits 5 manual (pp. 72-73, 96-97): results export as txt (tab) or csv (comma), header on the
  // first line, columns picked by the operator. A DNF/DQ can keep its position number; the mark is
  // in the Status column.
  console.log('\n— MYLAPS Orbits comma CSV with a Status column —');
  {
    await seed();
    const r = await ingest('heat', fx('mylaps-orbits-status.csv'), 'Late Model Heat 1.csv');
    check('a comma-separated Orbits file says MYLAPS Orbits (not MotoSponder)', r.vendor === 'MYLAPS Orbits', r.vendor);
    check('the Status column is found', r.cols.status === 10, JSON.stringify(r.cols));
    await apply();
    const h1 = await resultsByNum('h1_');
    check('a DQ left at its position imports as DQ, a DNF as DNF', h1['88'] === 'DQ' && h1['45'] === 'DNF', JSON.stringify(h1));
    check('everyone else keeps their finish', h1['07'] === 1 && h1['23'] === 2 && h1['7'] === 4 && h1['12'] === 5, JSON.stringify(h1));
    const past = await page.evaluate(t => impPastRows(t, 'Late Model Feature.csv', S.classes[0]), fx('mylaps-orbits-status.csv'));
    const pf = {}; (past.rows || []).forEach(x => { pf[x.num] = x.out || x.fin; });
    check('a past night loaded from the file also reads the Status column', !past.err && pf['88'] === 'DQ' && pf['45'] === 'DNF' && pf['07'] === 1 && pf['12'] === 4, JSON.stringify(past.err || pf));
  }

  console.log('\n— Orbits exports RaceDay cannot score from say so —');
  {
    await seed();
    const tryFile = (text, file) => page.evaluate(([text, file]) => {
      openImport('heat'); const said = []; const ot = window.toast; window.toast = m => said.push(m);
      const ok = impIngestText(text, file); window.toast = ot;
      return { ok, said: said.join(' '), rows: Imp.rows.length };
    }, [text, file]);
    const html = await tryFile('<html><body><table><tr><th>Pos</th><th>No.</th><th>Name</th></tr><tr><td>1</td><td>07</td><td>Jax King</td></tr></table></body></html>', 'Late Model Heat 1.html');
    check('an HTML export is refused with what to export instead', !html.ok && /HTML/.test(html.said) && /txt or csv/.test(html.said), html.said);
    const xml = await tryFile('<?xml version="1.0"?><Results><Competitor Pos="1" No="07" Name="Jax King"/></Results>', 'Late Model Heat 1.xml');
    check('a non-Race Manager XML is refused with what to export instead', !xml.ok && /XML/.test(xml.said) && /txt or csv/.test(xml.said), xml.said);
    const laps = await tryFile(['No.\tName\tLap\tLap Tm\tTime of Day', '07\tJax King\t1\t00:48.100\t19:02:11', '07\tJax King\t2\t00:47.811\t19:02:59', '23\tCasey Rivera\t1\t00:48.300\t19:02:11'].join('\r\n'), 'Late Model Heat 1 laps.txt');
    check('a lap-times export is refused, not shown as results', !laps.ok && /lap-times/.test(laps.said) && laps.rows === 0, JSON.stringify(laps));
    const pastHtml = await page.evaluate(() => impPastRows('<html><table><tr><td>1</td></tr></table></html>', 'x.html', S.classes[0]));
    check('Fix or backfill gives the same message for an HTML file', /HTML/.test(pastHtml.err || ''), JSON.stringify(pastHtml));
    const ws = await ingest('feat', fx('westhold-race.csv'), 'westhold-race.csv');
    check('ordinary results files are not affected', ws.rows === 6 && ws.vendor === 'Westhold', JSON.stringify(ws.vendor));
  }

  console.log('\n— MotoSponder still works the same —');
  {
    await seed();
    const v = await page.evaluate(t => { const rows = impParseCSV(t); const h = rows[impPickHeader(rows)]; return impDetectVendor(h, impDetectDelim(t)); }, fx('01-qualifying-all.csv'));
    check('MotoSponder files are still recognized', v && v.name === 'MotoSponder', JSON.stringify(v));
    const hint = await page.evaluate(() => { openImport('heat'); const t = document.getElementById('sheetBody').textContent; closeSheet(); return t; });
    check('the import sheet says which systems it reads', /MYLAPS Orbits/.test(hint) && /Westhold/.test(hint) && /tab-separated/.test(hint));
    const acc = await page.evaluate(() => { openImport('heat'); const a = document.getElementById('impFile').getAttribute('accept'); closeSheet(); return a; });
    check('the file picker accepts .csv, .txt and .tsv', /\.csv/.test(acc) && /\.txt/.test(acc) && /\.tsv/.test(acc), acc);
  }

  console.log('\n— Class guessed from the file name —');
  {
    const g = await page.evaluate(() => ['westhold-race.csv', 'MYLAPS export.tsv', 'Late Model Feature.csv', 'Pro_Stock-Heat_2.csv', 'Mini-Sprint Qualifying.csv', 'Results - Junior Sportsman Qualifying.csv'].map(impClassFromFilename));
    check('a file named after the timing system guesses no class', g[0] === '' && g[1] === '', JSON.stringify(g.slice(0, 2)));
    check('a class in the file name is still found', g[2] === 'Late Model' && g[3] === 'Pro Stock' && g[5] === 'Junior Sportsman', JSON.stringify(g));
    check('a hyphenated class name keeps its hyphen', g[4] === 'Mini-Sprint', g[4]);
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
