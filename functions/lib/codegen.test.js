// Confirms the Node minting port produces byte-identical output to the client-side
// check functions it must stay compatible with (index.html licHash/licCheck,
// profiles/index.html pHash/premCheck). Run with `npm test` inside functions/, or
// directly: LIC_SALT=... PREM_SALT=... node lib/codegen.test.js
process.env.LIC_SALT = process.env.LIC_SALT || 'rd-grid-9f3k27xq-2026';
process.env.PREM_SALT = process.env.PREM_SALT || 'rd-prem-7t4mq2xz-2026';
const { licCheck, mintLicenseCode, pHash, premShort, mintPremiumCode } = require('./codegen');

// Reference copies transcribed verbatim from index.html / profiles/index.html — kept
// duplicated on purpose so a future edit to codegen.js that silently drifts from the
// client algorithm gets caught here, not by a customer with a rejected code.
function refLicHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}
function refLicCheck(name, exp) { return refLicHash(name + '|' + exp + '|' + process.env.LIC_SALT).slice(0, 6); }
function refPHash(str) {
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('0000000' + h.toString(36).toUpperCase()).slice(-7);
  }
  return fnv(str, 2166136261) + fnv(str + '#2', 2166136261);
}
function refPremShort(profileId) { return profileId.slice(5, 13).toUpperCase(); }

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

console.log('\n— License code minting matches the client checksum —');
[['RIVERSIDE', '0'], ['RIVERSIDE', 'S2026'], ['RIVERSIDE', 'R5'], ['ROUTE9', 'S2027']].forEach(([n, e]) => {
  check('licCheck(' + n + ',' + e + ')', licCheck(n, e) === refLicCheck(n, e));
});
const code = mintLicenseCode("O'Brien Raceway", 'R10');
const parts = code.split('-');
check('mintLicenseCode sanitizes non-alnum out of the name', parts[0] === 'OBRIENRACEWAY', code);
check('mintLicenseCode name matches client activateLic() regex /^[A-Z0-9]+$/', /^[A-Z0-9]+$/.test(parts[0]));
check('mintLicenseCode exp matches client activateLic() regex', /^(0|\d{6}|S\d{4}|R\d{1,4})$/.test(parts[1]), parts[1]);
check('mintLicenseCode checksum verifies against refLicCheck', refLicCheck(parts[0], parts[1]) === parts[2], code);

console.log('\n— Premium code minting matches the client checksum —');
['prof_ab12cd34ef', 'prof_zz99xx88yy00'].forEach(pid => {
  check('pHash(' + pid + ') matches ref', pHash(pid + '|PREM|' + process.env.PREM_SALT) === refPHash(pid + '|PREM|' + process.env.PREM_SALT));
  check('premShort(' + pid + ') matches ref', premShort(pid) === refPremShort(pid));
  const pcode = mintPremiumCode(pid);
  const pparts = pcode.split('-');
  check('mintPremiumCode(' + pid + ') format PREM-SHORT8-HASH8', pparts.length === 3 && pparts[0] === 'PREM', pcode);
  check('mintPremiumCode(' + pid + ') short segment matches', pparts[1] === refPremShort(pid), pcode);
  check('mintPremiumCode(' + pid + ') hash segment matches', pparts[2] === refPHash(pid + '|PREM|' + process.env.PREM_SALT).slice(0, 8), pcode);
});

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
