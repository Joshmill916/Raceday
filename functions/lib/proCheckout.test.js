// Run with: node lib/proCheckout.test.js (no deps needed — firebase/stripe are stubbed)
// Exercises functions/index.js proCheckout: it must refuse to start a Pro checkout unless
// the profile is real (well-formed id + a published card), send an already-subscribed
// profile to the billing portal, and bake the profileId into the Checkout Session.
const Module = require('module');
const store = {};
const ref = (p) => ({
  set: async (v) => { store[p] = v; }, remove: async () => { delete store[p]; },
  once: async () => ({ val: () => store[p] === undefined ? null : store[p] }),
  update: async () => {},
});
let created = [];
const stubs = {
  'firebase-functions/v2/https': { onRequest: (opts, fn) => fn },
  'firebase-functions/v2/scheduler': { onSchedule: () => () => {} },
  'firebase-functions/params': { defineSecret: () => ({ value: () => 'x' }) },
  'firebase-functions/logger': { info() {}, warn() {}, error() {} },
  'firebase-admin': { initializeApp() {}, database: Object.assign(() => ({ ref }), { ServerValue: { TIMESTAMP: 'TS' } }) },
  'stripe': function Stripe() {
    return {
      paymentLinks: {
        list: () => (async function* () {
          yield { id: 'plink_m', url: 'https://buy.stripe.com/00w3cxdwm3Nk1ATedIaMU04', managed_payments: { enabled: true } };
          yield { id: 'plink_y', url: 'https://buy.stripe.com/aFa8wRfEu83A1DTglQaMU03' };
          yield { id: 'plink_other', url: 'https://buy.stripe.com/other' };
        })(),
        listLineItems: async (id) => ({ data: [{ price: { id: id === 'plink_m' ? 'price_month' : 'price_year' } }] }),
      },
      checkout: { sessions: { create: async (p) => { created.push(p); return { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }; } } },
    };
  },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { return stubs[req] || origLoad.apply(this, arguments); };
const fns = require(require('path').join(__dirname, '..', 'index.js'));

const call = async (query) => {
  const res = { code: 0, body: '', loc: '', status(c) { this.code = c; return this; }, set() { return this; },
    send(b) { this.body = b; return this; }, redirect(c, u) { this.code = c; this.loc = u; return this; } };
  await fns.proCheckout({ query }, res);
  return res;
};
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + ' — ' + JSON.stringify(x)); } };

(async () => {
  let r = await call({ period: 'yearly' });
  check('no profileId -> 400, no session', r.code === 400 && !created.length, r);
  r = await call({ profileId: 'prof_abc123xy', period: 'lifetime' });
  check('unknown period -> 400', r.code === 400 && !created.length, r);
  r = await call({ profileId: 'prof_abc123xy', period: 'yearly' });
  check('unpublished profile -> 404, no session', r.code === 404 && !created.length, r);

  store['profiles/prof_abc123xy/card/name'] = 'Casey Rivera';
  r = await call({ profileId: 'prof_abc123xy', period: 'yearly' });
  const s = created[0] || {};
  check('published profile -> 303 to Stripe checkout', r.code === 303 && r.loc === 'https://checkout.stripe.com/c/cs_1', r);
  check('session uses the yearly price', s.line_items && s.line_items[0].price === 'price_year', s);
  check('session carries the profileId (client_reference_id + metadata)', s.client_reference_id === 'prof_abc123xy' && s.subscription_data.metadata.profileId === 'prof_abc123xy', s);
  check('yearly link without managed payments -> none on session', !s.managed_payments, s);

  r = await call({ profileId: 'prof_abc123xy', period: 'monthly' });
  check('monthly mirrors managed payments', created[1] && created[1].line_items[0].price === 'price_month' && created[1].managed_payments.enabled === true, created[1]);

  store['profiles/prof_abc123xy/entitlement'] = { tier: 'pro', status: 'active' };
  const before = created.length;
  r = await call({ profileId: 'prof_abc123xy', period: 'yearly' });
  check('already Pro -> billing portal, no second subscription', r.code === 303 && /billingPortal\?profileId=prof_abc123xy/.test(r.loc) && created.length === before, r);

  console.log(`\nproCheckout: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
