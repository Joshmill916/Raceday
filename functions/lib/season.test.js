// Pins the season-pass year rule (./season.js): a pass bought from October on covers the
// next season, so nobody pays $350 for a pass that expires in ten weeks.
const { sellingSeason, seasonExp } = require('./season');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const at = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h);

console.log('\n— which season is on sale —');
check('January–September: this year', sellingSeason(at(2027, 1, 2)) === 2027 && sellingSeason(at(2027, 9, 30, 23)) === 2027);
check('from October 1: next year', sellingSeason(at(2026, 10, 1, 0)) === 2027 && sellingSeason(at(2026, 10, 18)) === 2027);
check('December 31: next year', sellingSeason(at(2026, 12, 31, 23)) === 2027);

console.log('\n— the code minted after a Stripe purchase —');
check('no Stripe year, bought Oct 18 2026 → S2027', seasonExp(undefined, at(2026, 10, 18)) === 'S2027', seasonExp(undefined, at(2026, 10, 18)));
check('a stale Stripe year (2026) never sells a past/ending season', seasonExp('2026', at(2026, 10, 18)) === 'S2027');
check('a later Stripe year still wins', seasonExp('2028', at(2026, 10, 18)) === 'S2028');
check('bought in June 2027 → S2027', seasonExp('2026', at(2027, 6, 1)) === 'S2027');
check('junk Stripe year is ignored', seasonExp('abc', at(2027, 3, 1)) === 'S2027');

console.log(`\n${fail ? '❌' : '✅'} season: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
