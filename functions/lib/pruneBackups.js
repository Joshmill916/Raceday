// Pure date-boundary logic for pruneOldBackups (../index.js) — kept separate so it's
// directly testable without a Firebase Admin credential, the same split codegen.js/
// codegen.test.js uses for the license/premium code minting logic.
//
// YYYY-MM-DD, matching today() in raceday/index.html: daily/ backup keys are written
// in that same format, which sorts lexically in the same order it sorts
// chronologically — that's what lets pruneOldBackups use a plain string-keyed range
// query (.orderByKey().endBefore(cutoff)) instead of parsing dates on the server.
function cutoffDateStr(daysAgo, now) {
  const base = now == null ? Date.now() : now;
  const d = new Date(base - daysAgo * 24 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

module.exports = { cutoffDateStr };
