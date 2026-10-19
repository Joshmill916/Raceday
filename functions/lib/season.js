// Which season a season pass covers. Passes run to Dec 31 of their year, so one bought
// late in the year would last only weeks — from October 1 (UTC) on, a new pass covers the
// NEXT season instead. The pricing page (pricing.html, data-season) uses the same rule.
// A season_year set in Stripe can only push the year later, never back to a past season.
function sellingSeason(now) {
  const d = new Date(now == null ? Date.now() : now);
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}
function seasonExp(metaYear, now) {
  return 'S' + Math.max(parseInt(metaYear, 10) || 0, sellingSeason(now));
}
module.exports = { sellingSeason, seasonExp };
