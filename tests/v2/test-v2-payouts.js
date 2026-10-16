// v2: payout ledger. A class purse pays by feature finish; finishers past the table and DNF
// cars get start money; DNS and DQ are not paid. Archiving stores the payouts on that night's
// history record, which never syncs to other devices but is part of both backups.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8835;
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

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
  page.on('popup', p => p.close().catch(() => {}));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(400);

  const seed = () => page.evaluate(() => {
    closeSheet();
    S.track.name = 'Test Track';
    S.classes = [{ id: 1, name: 'Late Model', maxPill: 20, purse: { table: [500, 300, 200], start: 50 } }, { id: 2, name: 'Stock', maxPill: 20 }];
    S.settings.maxHeat = 8; S.settings.maxFeature = 20;
    S.history = [];
    S.roster = []; S.raceDay = { date: '2026-06-06', entries: [], heatResults: {}, pointsRace: {}, resultGov: {}, resultVersions: {} };
    for (let i = 1; i <= 7; i++) {
      S.roster.push({ id: i, name: 'Driver ' + i, num: String(i) });
      S.raceDay.entries.push({ driverId: i, classId: 1, pill: i });
      S.roster.push({ id: 100 + i, name: 'Stock ' + i, num: String(100 + i) });
      S.raceDay.entries.push({ driverId: 100 + i, classId: 2, pill: i });
    }
    S.roster.find(d => d.id === 2).owner = 'Smith Racing';
    S.roster.find(d => d.id === 2).payTo = 'owner';
    const r1 = getRes(1), r2 = getRes(2);
    for (let i = 1; i <= 7; i++) { r1['h1_' + i] = i; r1['h2_' + i] = i; r2['h1_' + (100 + i)] = i; r2['h2_' + (100 + i)] = i; }
    [1, 2, 3, 4].forEach(i => { r1['ft_' + i] = i; });
    r1.ft_5 = 'DNF'; r1.ft_6 = 'DNS'; r1.ft_7 = 'DQ';
    for (let i = 1; i <= 7; i++) r2['ft_' + (100 + i)] = i;
    save();
  });

  console.log('\n— Purse math —');
  await seed();
  const rows = await page.evaluate(() => nightPayouts());
  const by = Object.fromEntries(rows.map(r => [r.driverId, r]));
  check('1st, 2nd and 3rd are paid from the purse table', by[1].amount === 500 && by[2].amount === 300 && by[3].amount === 200, JSON.stringify(rows.map(r => [r.driverId, r.amount])));
  check('a finisher past the table gets start money', by[4] && by[4].amount === 50);
  check('a DNF started, so it gets start money', by[5] && by[5].amount === 50);
  check('DNS and DQ are not paid', !by[6] && !by[7]);
  check('a class with no purse pays nothing', !rows.some(r => r.classId === 2));
  check('the night totals $1,100', rows.reduce((t, r) => t + r.amount, 0) === 1100);
  check('a driver set to pay the owner is paid to the owner', by[2].payee === 'Smith Racing' && by[2].payTo === 'owner', JSON.stringify(by[2]));
  check('everyone else is paid to the driver', by[1].payee === 'Driver 1' && by[1].payTo === 'driver');

  console.log('\n— Archiving records the ledger —');
  const arch = await page.evaluate(() => { archiveDay(); return allPayouts().map(p => ({ d: p.date, a: p.amount, paid: p.paid, m: p.method })); });
  check('archiving the night writes 5 payouts', arch.length === 5, arch.length);
  check('each payout is dated, unpaid, with no method yet', arch.every(p => p.d === '2026-06-06' && p.paid === false && p.m === ''));
  const again = await page.evaluate(() => { archiveDay(); return allPayouts().length; });
  check('archiving the same night again does not pay twice', again === 5, again);
  const demo = await page.evaluate(() => { S.raceDay.demo = true; const n = recordPayouts({ date: 'x' }); S.raceDay.demo = false; return n; });
  check('a demo night never records payouts', demo === 0);

  console.log('\n— Paid / method and season totals —');
  const marks = await page.evaluate(() => {
    const all = allPayouts(), p = all.find(x => x.driverId === 2);
    setPayoutPaid(p.id, true); setPayoutMethod(p.id, 'check'); setPayoutMethod(all[0].id, 'bitcoin');
    return { paid: p.paid, at: p.paidAt > 0, method: p.method, bad: all[0].method, audit: (S.audit || []).some(a => /Payout marked paid/.test(a.action)) };
  });
  check('a payout can be marked paid (with a time)', marks.paid && marks.at);
  check('a payment method can be recorded', marks.method === 'check');
  check('an unknown method is ignored', marks.bad === '');
  check('marking paid is written to the admin action log', marks.audit);
  const totals = await page.evaluate(() => payeeTotals('2026').map(t => ({ p: t.payee, t: t.total, paid: t.paid, n: t.nights.size })));
  check('season totals group by payee', totals.find(t => t.p === 'Smith Racing').t === 300 && totals.find(t => t.p === 'Driver 1').t === 500, JSON.stringify(totals));
  check('season totals show what has been paid', totals.find(t => t.p === 'Smith Racing').paid === 300);

  console.log('\n— CSV exports —');
  const csv = await page.evaluate(() => {
    const out = {}; const orig = downloadFile;
    downloadFile = (name, content) => { out[name] = content; };
    exportPayeeTotalsCSV('2026'); exportPayoutsCSV('2026');
    downloadFile = orig; return out;
  });
  const totCsv = csv['raceday-payout-totals-2026.csv'] || '', allCsv = csv['raceday-payouts-2026.csv'] || '';
  check('season totals CSV has a header and one row per payee', /^Payee,Paid to,Driver\(s\),Nights,Total,Paid,Unpaid/.test(totCsv) && totCsv.split('\n').length === 6, totCsv.split('\n')[0]);
  check('season totals CSV shows the owner payee', /Smith Racing,owner,Driver 2,1,300\.00,300\.00,0\.00/.test(totCsv), totCsv);
  check('every-payout CSV lists all 5 payouts', allCsv.split('\n').length === 6);
  check('no CSV contains a tax ID column', !/SSN|TIN|tax id/i.test(totCsv + allCsv));

  console.log('\n— Settings, payee and screens —');
  const purse = await page.evaluate(() => {
    setClassPurse(2, 'table', '$1000, 500 250'); const a = classById(2).purse.table.join();
    setClassPurse(2, 'start', '25.5'); const b = classById(2).purse.start;
    setClassPurse(2, 'table', ''); setClassPurse(2, 'start', '0'); const gone = classById(2).purse === undefined;
    return { a, b, gone };
  });
  check('purse amounts accept $ signs, commas and spaces', purse.a === '1000,500,250', purse.a);
  check('start money saves', purse.b === 25.5, purse.b);
  check('clearing the purse removes it', purse.gone);
  const payee = await page.evaluate(() => {
    openDriverCard(3); editPayee();
    document.getElementById('poOwner').value = 'Jones Bros'; document.getElementById('poPayTo').value = 'owner'; savePayee();
    const d = driverById(3); const r = nightPayouts().find(x => x.driverId === 3);
    closeSheet(); return { owner: d.owner, payTo: d.payTo, payee: r && r.payee };
  });
  check('Payout info on the driver card sets the owner and pay-to', payee.owner === 'Jones Bros' && payee.payTo === 'owner');
  check('tonight\'s payouts follow the new payee', payee.payee === 'Jones Bros');
  const screen = await page.evaluate(() => { nav('admin'); admOpen('payouts'); const t = document.getElementById('payoutsWrap').textContent; return { tonight: /Tonight/.test(t), total: /\$1,100/.test(t), ledger: /Ledger/.test(t), season: /Season totals/.test(t), noTax: /never stores Social Security/.test(t) }; });
  check('Admin → Payouts shows tonight, the ledger and season totals', screen.tonight && screen.ledger && screen.season, JSON.stringify(screen));
  check('tonight\'s total is shown', screen.total);
  check('the screen says no tax IDs are stored', screen.noTax);
  const print = await page.evaluate(() => { openPrint(); const t = document.getElementById('sheetBody').textContent; closeSheet(); return /Payout sheet/.test(t); });
  check('the Print menu offers a Payout sheet to the admin', print);

  console.log('\n— Privacy and backups —');
  const priv = await page.evaluate(() => ({
    stored: !!(S.history[0].payouts && S.history[0].payouts.length),
    notSynced: SYNC_FIELDS.every(f => !/payout|history/i.test(f)),
    cloud: CLOUD_BACKUP_FIELDS.includes('history'),
    noTop: !('payouts' in S),
    survives: (() => { const o = JSON.parse(JSON.stringify(S)); return (migrate(o).history[0].payouts || []).length === S.history[0].payouts.length; })()
  }));
  check('payouts are stored on the archived night', priv.stored);
  check('payouts never sync to other devices (history does not sync)', priv.notSynced);
  check('payouts are included in cloud backup (with history)', priv.cloud);
  check('no new top-level saved field (v1 can still read the data)', priv.noTop);
  check('payouts survive a reload/migration', priv.survives);
  const del = await page.evaluate(() => { let msg = ''; const orig = window.confirm; window.confirm = m => { msg = m; return false; }; nav('admin'); admOpen('history'); delHist(0); window.confirm = orig; return msg; });
  check('deleting a night warns that its payouts go too', /payout record/.test(del), del);

  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
