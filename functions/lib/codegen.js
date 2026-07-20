// Node port of the code-minting half of the client-side check functions in
// ../../raceday/index.html (licHash/licCheck) and ../../driven/index.html (pHash/premCheck).
// Must produce byte-identical output to those — this is the server-side "issue" half
// of a scheme the client only ever "checks". Do not change the algorithms here without
// changing both client copies to match, and vice versa.

const LIC_SALT = process.env.LIC_SALT;
const PREM_SALT = process.env.PREM_SALT;

function licHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}
function licCheck(name, exp) {
  if (!LIC_SALT) throw new Error('LIC_SALT is not set');
  return licHash(name + '|' + exp + '|' + LIC_SALT).slice(0, 6);
}
// activateLic() (index.html) requires the name segment to match /^[A-Z0-9]+$/ — it
// splits the whole code on '-', so spaces/punctuation/hyphens in a free-typed track
// name would either break the split or fail that regex. Strip anything else out
// before it ever reaches licCheck, so what we mint is guaranteed to activate.
function sanitizeLicenseName(raw) {
  const cleaned = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) throw new Error('Track name has no letters/digits left after sanitizing');
  return cleaned;
}
// Assembles a full NAME-EXP-CHECKSUM license code, exactly the shape activateLic()
// (index.html) expects to split on '-' and verify.
function mintLicenseCode(rawName, exp) {
  const name = sanitizeLicenseName(rawName);
  return name + '-' + exp + '-' + licCheck(name, exp);
}

function pHash(str) {
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('0000000' + h.toString(36).toUpperCase()).slice(-7);
  }
  return fnv(str, 2166136261) + fnv(str + '#2', 2166136261);
}
function premShort(profileId) { return profileId.slice(5, 13).toUpperCase(); }
// Assembles a full PREM-SHORT8-HASH8 code, exactly the shape activatePremium()
// (driven/index.html) expects to split on '-' and verify via premCheck().
function mintPremiumCode(profileId) {
  if (!PREM_SALT) throw new Error('PREM_SALT is not set');
  const hash8 = pHash(profileId + '|PREM|' + PREM_SALT).slice(0, 8);
  return 'PREM-' + premShort(profileId) + '-' + hash8;
}

module.exports = { licHash, licCheck, mintLicenseCode, pHash, premShort, mintPremiumCode };
