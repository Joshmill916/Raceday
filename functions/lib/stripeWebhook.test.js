// Run with: node lib/stripeWebhook.test.js (no deps needed — firebase/stripe are stubbed)
// Exercise functions/index.js stripeWebhook's subscription-checkout path with stubbed
// firebase-functions / firebase-admin / stripe (no network, no real deps installed).
const Module = require('module');
const store = {};
const ref = (p) => ({
  set: async (v) => { store[p] = v; }, remove: async () => { delete store[p]; },
  once: async () => ({ val: () => store[p] === undefined ? null : store[p] }),
  update: async () => {},
});
let stripeBehavior = {};
const stubs = {
  'firebase-functions/v2/https': { onRequest: (opts, fn) => fn },
  'firebase-functions/v2/scheduler': { onSchedule: () => () => {} },
  'firebase-functions/params': { defineSecret: () => ({ value: () => 'x' }) },
  'firebase-functions/logger': { info() {}, warn() {}, error() {} },
  'firebase-admin': { initializeApp() {}, database: Object.assign(() => ({ ref }), { ServerValue: { TIMESTAMP: 'TS' } }) },
  'stripe': function Stripe() {
    return {
      webhooks: { constructEvent: (body) => JSON.parse(body) },
      subscriptions: {
        retrieve: async (id) => { if (stripeBehavior.retrieveFails) throw new Error('Stripe API down'); return { id, status: 'active', customer: 'cus_1', current_period_end: 2000000000 }; },
        update: async () => ({}),
      },
    };
  },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { return stubs[req] || origLoad.apply(this, arguments); };
const fns = require(require('path').join(__dirname, '..', 'index.js'));

const call = async (session) => {
  const res = { code: 0, body: '', status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await fns.stripeWebhook({ rawBody: JSON.stringify({ type: 'checkout.session.completed', data: { object: session } }), headers: {} }, res);
  return res;
};
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + ' — ' + JSON.stringify(x)); } };
const base = { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', customer_details: { email: 'josh@example.com' } };

(async () => {
  // 1. Missing profile ID: acked (no pointless retries) but now leaves a record.
  let r = await call({ ...base, id: 'cs_missing' });
  const e1 = store['subscriptionErrors/cs_missing'];
  check('missing profile id -> 200 ignored', r.code === 200 && r.body === 'ignored', r);
  check('missing profile id -> error record with email + sub id', e1 && e1.reason === 'missing_profile_id' && e1.customerEmail === 'josh@example.com' && e1.subscriptionId === 'sub_1', e1);

  // 2. Transient failure: 500 so Stripe retries, and a record exists meanwhile.
  stripeBehavior.retrieveFails = true;
  r = await call({ ...base, id: 'cs_flaky', client_reference_id: 'prof_abc123xy' });
  check('transient failure -> 500 retry', r.code === 500 && r.body === 'retry', r);
  check('transient failure -> error record', store['subscriptionErrors/cs_flaky'] && store['subscriptionErrors/cs_flaky'].reason === 'transient', store['subscriptionErrors/cs_flaky']);

  // 3. Stripe's retry succeeds: entitlement written, the stale error record cleared.
  stripeBehavior.retrieveFails = false;
  r = await call({ ...base, id: 'cs_flaky', client_reference_id: 'prof_abc123xy' });
  check('retry success -> 200 ok', r.code === 200 && r.body === 'ok', r);
  check('retry success -> entitlement is pro', store['profiles/prof_abc123xy/entitlement'] && store['profiles/prof_abc123xy/entitlement'].tier === 'pro', store['profiles/prof_abc123xy/entitlement']);
  check('retry success -> error record removed', !('subscriptionErrors/cs_flaky' in store), Object.keys(store));

  console.log(`\nwebhook: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
