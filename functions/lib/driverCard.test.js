// node lib/driverCard.test.js: checks the Driven link-preview builder with a fake database.
const assert = require('assert');
const dc = require('./driverCard');

let pass = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ✅ ' + name); },
  e => { console.log('  ❌ ' + name + ': ' + e.message); process.exitCode = 1; });

const PID = 'prof_abc123xyz';
const DATA = {
  'profiles_short/K7Q2M9XA': PID,
  ['profiles/' + PID + '/card']: { name: 'Jake <b>Miller</b>', num: '16', hometown: 'Spencerville, IN', teamColor: '#ba453c',
    photo: 'javascript:alert(1)', premiumCode: 'x' },
  ['profileTracks/' + PID]: { trk1: { trackName: 'Test Track' } },
  'results/trk1': {
    '2026-10-01': { kid: { a: { profileId: PID, position: 1 }, b: { profileId: 'prof_other0001', position: 2 } } },
    '2026-10-08': { kid: { a: { profileId: PID, position: 3 } }, open: { a: { profileId: PID, position: 5 } } },
  },
};
const fakeFetch = async url => {
  const key = decodeURIComponent(url.replace(/^https:\/\/[^/]+\//, '').replace(/\.json$/, ''));
  return { ok: true, json: async () => (key in DATA ? DATA[key] : null) };
};

(async () => {
  await ok('parseRequest reads /d/CODE and /d/CODE.png', () => {
    assert.deepStrictEqual(dc.parseRequest('/d/k7q2m9xa', {}), { code: 'K7Q2M9XA', image: false });
    assert.deepStrictEqual(dc.parseRequest('/d/K7Q2M9XA.png', {}), { code: 'K7Q2M9XA', image: true });
    assert.deepStrictEqual(dc.parseRequest('/d/', { c: 'ab-12' }), { code: 'AB12', image: false });
  });
  await ok('computeStats counts starts, wins, top 3 and best finish', () => {
    assert.deepStrictEqual(dc.computeStats([{ pos: 3 }, { pos: 1 }, { pos: 7 }]), { starts: 3, wins: 1, top3: 2, best: 1 });
    assert.deepStrictEqual(dc.computeStats([]), { starts: 0, wins: 0, top3: 0, best: 0 });
  });
  let d;
  await ok('loadDriver reads only this driver\'s rows and drops a bad photo', async () => {
    d = await dc.loadDriver('K7Q2M9XA', fakeFetch);
    assert.strictEqual(d.profileId, PID);
    assert.deepStrictEqual(d.stats, { starts: 3, wins: 1, top3: 2, best: 1 });
    assert.strictEqual(d.photo, '');
    assert.strictEqual(d.color, '#ba453c');
  });
  await ok('unknown or malformed codes return null', async () => {
    assert.strictEqual(await dc.loadDriver('NOPE1234', fakeFetch), null);
    assert.strictEqual(await dc.loadDriver('', fakeFetch), null);
  });
  await ok('page HTML escapes the name and points people at the real page', () => {
    const html = dc.pageHtml(d, 'https://raceday-d32dd.web.app');
    assert.ok(!html.includes('<b>Miller'), 'name must be escaped');
    assert.ok(html.includes('og:image" content="https://raceday-d32dd.web.app/d/K7Q2M9XA.png'));
    assert.ok(html.includes('https://victoryraceday.com/d/?K7Q2M9XA'));
    assert.ok(!/og:url/.test(html), 'og:url would make Facebook re-read the generic page');
    assert.ok(html.includes('3 starts · 1 win · 2 top 3'));
  });
  await ok('renders a 1200x630 PNG', async () => {
    const png = Buffer.from(await dc.renderPng(Object.assign({}, d, { name: 'A Very Long Driver Name Here' })));
    assert.strictEqual(png.slice(1, 4).toString(), 'PNG');
    assert.strictEqual(png.readUInt32BE(16), 1200);
    assert.strictEqual(png.readUInt32BE(20), 630);
  });
  console.log(pass + ' passed' + (process.exitCode ? ', some FAILED' : ''));
})();
