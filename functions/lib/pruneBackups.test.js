// Verifies the date-boundary math pruneOldBackups (../index.js) relies on. The one
// thing worth pinning here: daily/ backup keys are YYYY-MM-DD strings, and the whole
// point of that format is that a plain string comparison ("is this key < cutoff?") is
// equivalent to a real chronological comparison — which is what lets the Cloud
// Function use a cheap .orderByKey().endBefore(cutoff) range query instead of parsing
// dates server-side. If cutoffDateStr ever produced a string that didn't sort the same
// way it dates, the prune job would silently keep or delete the wrong entries.
const { cutoffDateStr } = require('./pruneBackups');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

console.log('\n— cutoffDateStr basic shape —');
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);   // 2026-08-05 12:00 UTC — an arbitrary fixed "now"
check('0 days ago is today', cutoffDateStr(0, NOW) === '2026-08-05', cutoffDateStr(0, NOW));
check('1 day ago', cutoffDateStr(1, NOW) === '2026-08-04', cutoffDateStr(1, NOW));
check('180 days ago (the real retention window)', cutoffDateStr(180, NOW) === '2026-02-06', cutoffDateStr(180, NOW));

console.log('\n— month/year boundaries (the part that\'s easy to get wrong) —');
const JAN1 = Date.UTC(2026, 0, 1, 12, 0, 0);   // 2026-01-01
check('1 day before Jan 1 rolls back to the prior year', cutoffDateStr(1, JAN1) === '2025-12-31', cutoffDateStr(1, JAN1));
const MAR1_LEAP = Date.UTC(2028, 2, 1, 12, 0, 0);   // 2028-03-01, 2028 is a leap year
check('1 day before Mar 1 in a leap year lands on Feb 29', cutoffDateStr(1, MAR1_LEAP) === '2028-02-29', cutoffDateStr(1, MAR1_LEAP));
const MAR1 = Date.UTC(2026, 2, 1, 12, 0, 0);   // 2026-03-01, 2026 is NOT a leap year
check('1 day before Mar 1 in a non-leap year lands on Feb 28', cutoffDateStr(1, MAR1) === '2026-02-28', cutoffDateStr(1, MAR1));

console.log('\n— zero-padding (single-digit month/day must still sort correctly) —');
const SEP5 = Date.UTC(2026, 8, 5, 12, 0, 0);   // 2026-09-05
check('single-digit month is zero-padded', cutoffDateStr(0, SEP5) === '2026-09-05', cutoffDateStr(0, SEP5));
check('"2026-09-05" > "2026-02-06" lexically, matching chronological order',
  cutoffDateStr(0, SEP5) > cutoffDateStr(180, NOW));
check('"2026-02-06" > "2025-12-31" lexically, matching chronological order',
  cutoffDateStr(180, NOW) > cutoffDateStr(1, JAN1));

console.log('\n— what the prune job actually decides —');
// Simulates the real query: given a set of daily/ keys, which are "older than cutoff"
// under plain string comparison — exactly what .orderByKey().endBefore(cutoff) does.
const dailyKeys = ['2025-11-01', '2026-01-15', '2026-02-05', '2026-02-06', '2026-02-07', '2026-08-01', '2026-08-05'];
const cutoff = cutoffDateStr(180, NOW);   // '2026-02-06'
const stale = dailyKeys.filter(k => k < cutoff);
const kept = dailyKeys.filter(k => k >= cutoff);
check('entries strictly before the cutoff are pruned', stale.join(',') === '2025-11-01,2026-01-15,2026-02-05', stale.join(','));
check('the cutoff date itself is KEPT (endBefore is exclusive)', kept.includes('2026-02-06'), kept.join(','));
check('recent entries are kept', kept.includes('2026-08-01') && kept.includes('2026-08-05'), kept.join(','));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
