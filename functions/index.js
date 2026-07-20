// stripeWebhook — the sole automated minter for RaceDay license codes and Driven
// premium codes. Everything it produces must validate against the EXISTING client
// checks (activateLic() in ../raceday/index.html, activatePremium() in ../driven/index.html)
// unchanged — this function only adds a paid, automatic path to the same code formats
// that raceday-codegen.html has always minted by hand. See BACKLOG.md / ROADMAP.md for
// why this exists and what stays explicitly out of scope (tracks/* write-gating).
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const LIC_SALT = defineSecret('LIC_SALT');
const PREM_SALT = defineSecret('PREM_SALT');

admin.initializeApp();

function currentYear() { return new Date().getUTCFullYear(); }

// Reads a Checkout Session custom field by key. Payment Links let the customer fill
// these in at checkout (e.g. the track/customer name for a license purchase).
function customField(session, key) {
  const f = (session.custom_fields || []).find(x => x.key === key);
  return f && f.text && f.text.value ? f.text.value.trim() : '';
}

// Builds the code for one purchased line item. Throws on anything it can't confidently
// mint — callers must catch and record the failure rather than silently skip it.
function mintForLineItem(session, price, codegen) {
  const kind = (price.metadata && price.metadata.plan_kind) || '';
  if (kind === 'premium') {
    // Driven premium is bound to a specific profileId — carried via the Payment
    // Link's ?client_reference_id= passthrough (set by the "Unlock Premium" link in
    // driven/index.html), never typed by the customer.
    const profileId = session.client_reference_id;
    if (!profileId || !/^prof_[a-z0-9]{6,20}$/i.test(profileId)) {
      throw new Error('Missing or malformed profileId (client_reference_id): ' + profileId);
    }
    return { plan_kind: 'premium', code: codegen.mintPremiumCode(profileId) };
  }
  if (kind === 'forever' || kind === 'season' || kind === 'packet') {
    const name = customField(session, 'track_name') || (session.customer_details && session.customer_details.name) || '';
    if (!name) throw new Error('No track/customer name on the session (custom field or billing name)');
    let exp;
    if (kind === 'forever') exp = '0';
    else if (kind === 'season') exp = 'S' + (parseInt(price.metadata.season_year, 10) || currentYear());
    else exp = 'R' + (parseInt(price.metadata.packet_days, 10) || 0);
    if (kind === 'packet' && !/^R[1-9]\d{0,3}$/.test(exp)) throw new Error('Price is missing a valid packet_days metadata value');
    return { plan_kind: kind, code: codegen.mintLicenseCode(name, exp) };
  }
  throw new Error('Price ' + price.id + ' has no recognized plan_kind metadata: ' + JSON.stringify(price.metadata));
}

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, LIC_SALT, PREM_SALT], cors: false },
  async (req, res) => {
    // firebase-functions v2 exposes the raw, unparsed body on req.rawBody — required
    // for Stripe's signature check, which hashes the exact bytes Stripe sent.
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
    } catch (err) {
      logger.warn('Signature verification failed', err.message);
      res.status(400).send('Signature verification failed');
      return;
    }

    // Ack everything else immediately so Stripe stops retrying; we only act on this one.
    if (event.type !== 'checkout.session.completed') {
      res.status(200).send('ignored');
      return;
    }

    const sessionId = event.data.object.id;
    const db = admin.database();
    const grantRef = db.ref('codeGrants/' + sessionId);

    try {
      // process.env is how defineSecret's value() also reaches plain functions —
      // codegen.js reads LIC_SALT/PREM_SALT off process.env at call time.
      process.env.LIC_SALT = LIC_SALT.value();
      process.env.PREM_SALT = PREM_SALT.value();
      const codegen = require('./lib/codegen');

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items', 'line_items.data.price'],
      });
      const items = session.line_items && session.line_items.data || [];
      if (!items.length) throw new Error('Session has no line items');
      if (items.length > 1) throw new Error('Session has more than one line item — one purchase, one code, by design');

      const result = mintForLineItem(session, items[0].price, codegen);
      await grantRef.set({ code: result.code, plan_kind: result.plan_kind, createdAt: admin.database.ServerValue.TIMESTAMP });
      logger.info('Minted ' + result.plan_kind + ' code for session ' + sessionId);
    } catch (err) {
      logger.error('Mint failed for session ' + sessionId, err.message);
      // Record the failure (not the raw error — no internals leak to the client) so
      // claim.html can show "contact the owner" instead of spinning forever.
      await grantRef.set({ error: 'mint_failed', createdAt: admin.database.ServerValue.TIMESTAMP });
    }

    res.status(200).send('ok');
  }
);
