// stripeWebhook — the sole automated minter for RaceDay license codes and Driven
// premium codes, and (since the Pro-subscription build) the sole writer of Driven's
// server-side entitlement record. Everything the one-time-payment path produces must
// validate against the EXISTING client checks (activateLic() in ../raceday/index.html,
// activatePremium() in ../driven/index.html) unchanged — this function only adds a
// paid, automatic path to the same code formats that raceday-codegen.html has always
// minted by hand. See BACKLOG.md / ROADMAP.md for why this exists and what stays
// explicitly out of scope (tracks/* write-gating).
//
// billingPortal — a small companion endpoint that redirects a Driven profile owner into
// Stripe's Customer Portal so they can switch Pro plans or cancel, all on the SAME
// subscription object. That matters beyond convenience: a Payment Link can only ever
// START a new subscription, never modify an existing one, so routing plan changes
// through the portal instead of "buy the other link" is what keeps a profile down to
// one subscription at a time — which handleSubscriptionEvent's race guard assumes.
//
// pruneOldBackups — bounds the storage cost of the opt-in cloud backup feature
// (raceday/index.html's backupToCloud()). Every backup writes a dated entry under
// trackBackups/<trackId>/daily/<date> that is never deleted client-side — the vault is
// deliberately write-only (.read: false) so no client can read, let alone prune, its own
// or anyone else's history. See the comment on the function itself for why this reads
// backupTracks (a tiny index) rather than trackBackups directly.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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

// The plan metadata (plan_kind/season_year/packet_days) can sit on either the Price or
// its Product. The Stripe dashboard only reliably offers a metadata editor on the
// Product, and a Price becomes read-only once it has been charged — so in practice the
// values land on whichever object the UI allowed at the time. Read both: the Price wins
// where it has a value, since one Product can carry several Prices with different plans.
function planMeta(price) {
  const product = price.product && typeof price.product === 'object' ? price.product : null;
  return Object.assign({}, product && product.metadata, price.metadata);
}

// Builds the code for one purchased line item. Throws on anything it can't confidently
// mint — callers must catch and record the failure rather than silently skip it.
function mintForLineItem(session, price, codegen) {
  const meta = planMeta(price);
  const kind = meta.plan_kind || '';
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
    else if (kind === 'season') exp = 'S' + (parseInt(meta.season_year, 10) || currentYear());
    else exp = 'R' + (parseInt(meta.packet_days, 10) || 0);
    if (kind === 'packet' && !/^R[1-9]\d{0,3}$/.test(exp)) throw new Error('Price is missing a valid packet_days metadata value');
    return { plan_kind: kind, code: codegen.mintLicenseCode(name, exp) };
  }
  throw new Error('Price ' + price.id + ' has no recognized plan_kind metadata: ' + JSON.stringify(meta));
}

// Driven Pro subscription status -> tier. active/trialing counts as paid; everything
// else (past_due, canceled, unpaid, incomplete_expired) reverts to free. This mapping
// lives only here — the Cloud Function is the sole source of truth for entitlement,
// unlike the deterministic offline premium code the client can verify on its own.
function deriveTier(status) {
  return (status === 'active' || status === 'trialing') ? 'pro' : 'free';
}

function entitlementFromSub(sub) {
  return {
    tier: deriveTier(sub.status),
    status: sub.status,
    subId: sub.id,
    customerId: sub.customer,
    // Newer Stripe API versions moved current_period_end onto the subscription items.
    currentPeriodEnd: (sub.current_period_end
      || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || 0) * 1000,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };
}

// Initial subscription checkout — mirrors mintForLineItem's one-time-payment path but
// writes an entitlement record instead of a redeemable code. There's nothing to claim:
// Driven polls profiles/<id>/entitlement directly after the checkout redirect.
async function handleSubscriptionCheckout(session, stripe, db) {
  const profileId = session.client_reference_id;
  if (!profileId || !/^prof_[a-z0-9]{6,20}$/i.test(profileId)) {
    throw new Error('Missing or malformed profileId (client_reference_id): ' + profileId);
  }
  const sub = await stripe.subscriptions.retrieve(session.subscription);
  // Primary routing for future customer.subscription.* events, which carry the
  // Subscription object but not the originating Checkout Session — client_reference_id
  // is unreachable from them otherwise. Stored on the subscription itself so it's also
  // visible from the Stripe Dashboard for debugging.
  await stripe.subscriptions.update(sub.id, { metadata: { profileId } });
  await db.ref('profiles/' + profileId + '/entitlement').set(entitlementFromSub(sub));
  // Fallback index only, in case a future event ever arrives without the metadata above.
  await db.ref('subscriptions/' + sub.id).set(profileId);
  logger.info('Subscription entitlement set for profile ' + profileId + ' (sub ' + sub.id + ')');
}

// customer.subscription.updated / .deleted — renewals, cancellations, and payment
// failures (a failed renewal surfaces as status:'past_due' on an .updated event, not a
// separate event type, so both are handled identically here).
async function handleSubscriptionEvent(eventSub, db, stripe) {
  // Never trust the event's snapshot: Stripe retries failed deliveries for days, so an
  // OLD "active" event can arrive after a cancellation (this happened — a retried 4pm
  // update re-activated a subscription cancelled at 4:35). Re-read the subscription so
  // the entitlement always reflects Stripe's current state, whatever order events land in.
  let sub = eventSub;
  if (stripe) {
    try { sub = await stripe.subscriptions.retrieve(eventSub.id); }
    catch (err) { if (!(err && err.statusCode === 404)) throw err; }   // 404: deleted — keep the event's (canceled) snapshot
  }
  let profileId = sub.metadata && sub.metadata.profileId;
  if (!profileId) {
    const idxSnap = await db.ref('subscriptions/' + sub.id).once('value');
    profileId = idxSnap.val();
  }
  if (!profileId || !/^prof_[a-z0-9]{6,20}$/i.test(profileId)) {
    logger.warn('Subscription event for unroutable subscription ' + sub.id);
    return;
  }
  const entRef = db.ref('profiles/' + profileId + '/entitlement');
  const current = (await entRef.once('value')).val();
  // A profile should only ever have one CURRENT subscription (plan switches go through
  // the Billing Portal on the same subscription object) — but Stripe doesn't guarantee
  // webhook delivery order, so guard against an event for an already-superseded
  // subscription silently overwriting a newer one's entitlement.
  if (current && current.subId && current.subId !== sub.id) {
    logger.info('Ignoring ' + sub.id + ' event — profile ' + profileId + ' entitlement now owned by ' + current.subId);
    return;
  }
  await entRef.set(entitlementFromSub(sub));
  logger.info('Subscription entitlement updated for profile ' + profileId + ' (sub ' + sub.id + ', status ' + sub.status + ')');
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

    const db = admin.database();

    // Subscription lifecycle events — separate from the one-time-payment path below.
    // Unlike that path, a transient failure here returns non-200 so Stripe's built-in
    // retry (up to 3 days) self-heals it: there's no codeGrants-style record a client
    // can poll to notice a silent failure and complain, so retrying is the only safety net.
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      try {
        await handleSubscriptionEvent(event.data.object, db, stripe);
        res.status(200).send('ok');
      } catch (err) {
        logger.error('Subscription event handling failed for ' + event.data.object.id, err.message);
        res.status(500).send('retry');
      }
      return;
    }

    // Ack everything else immediately so Stripe stops retrying; only checkout.session.completed
    // (below) and the two subscription events above are acted on.
    if (event.type !== 'checkout.session.completed') {
      res.status(200).send('ignored');
      return;
    }

    const session = event.data.object;

    if (session.mode === 'subscription') {
      const errRef = db.ref('subscriptionErrors/' + session.id);
      try {
        await handleSubscriptionCheckout(session, stripe, db);
        // A retry that finally succeeded clears the failure it left behind.
        await errRef.remove().catch(() => {});
        res.status(200).send('ok');
      } catch (err) {
        // A malformed client_reference_id is unrecoverable — retrying changes nothing.
        // Everything else (a DB write or Stripe API call failing) is transient, so let
        // Stripe retry instead of losing the entitlement write silently.
        const unrecoverable = /Missing or malformed profileId/.test(err.message);
        const email = (session.customer_details && session.customer_details.email) || '';
        logger.error('Subscription checkout handling failed for session ' + session.id + ' (' + email + ')', err.message);
        // A paid customer with no entitlement used to leave no trace outside Stripe. Record
        // enough here (admin-only path — no client rule grants it) to match the payment to a
        // Driven profile by hand: Stripe Dashboard → the subscription → metadata profileId.
        await errRef.set({
          reason: unrecoverable ? 'missing_profile_id' : 'transient',
          message: String(err.message || '').slice(0, 300),
          clientReferenceId: session.client_reference_id || '',
          subscriptionId: session.subscription || '',
          customerId: session.customer || '',
          customerEmail: email,
          createdAt: admin.database.ServerValue.TIMESTAMP,
        }).catch(e => logger.error('Could not record subscription error for ' + session.id, e.message));
        res.status(unrecoverable ? 200 : 500).send(unrecoverable ? 'ignored' : 'retry');
      }
      return;
    }

    // ---- existing one-time-payment path (license codes, one-time Driven premium) ----
    const sessionId = session.id;
    const grantRef = db.ref('codeGrants/' + sessionId);

    try {
      // process.env is how defineSecret's value() also reaches plain functions —
      // codegen.js reads LIC_SALT/PREM_SALT off process.env at call time.
      process.env.LIC_SALT = LIC_SALT.value();
      process.env.PREM_SALT = PREM_SALT.value();
      const codegen = require('./lib/codegen');

      const fullSession = await stripe.checkout.sessions.retrieve(sessionId, {
        // ...price.product so planMeta() can fall back to the Product's metadata.
        expand: ['line_items', 'line_items.data.price', 'line_items.data.price.product'],
      });
      const items = fullSession.line_items && fullSession.line_items.data || [];
      if (!items.length) throw new Error('Session has no line items');
      if (items.length > 1) throw new Error('Session has more than one line item — one purchase, one code, by design');

      const result = mintForLineItem(fullSession, items[0].price, codegen);
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

exports.billingPortal = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: false },
  async (req, res) => {
    const profileId = String(req.query.profileId || '');
    if (!/^prof_[a-z0-9]{6,20}$/i.test(profileId)) {
      res.status(400).send('Missing or malformed profileId');
      return;
    }
    const db = admin.database();
    const customerId = (await db.ref('profiles/' + profileId + '/entitlement/customerId').once('value')).val();
    if (!customerId) {
      res.status(404).send('No subscription found for this profile');
      return;
    }
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://victoryraceday.com/driven/?pro=1',
    });
    res.redirect(303, portal.url);
  }
);

// proCheckout — the ONLY way to start a Driven Pro subscription. Driven's "Get Pro"
// buttons land here instead of on the raw Payment Links, because a Payment Link can be
// opened (and paid) by anyone with the URL, with no profile attached — which is how a
// real payment once ended up with no Pro to show for it. This endpoint refuses to start
// a checkout unless the profileId is well-formed AND that profile has a published card,
// sends an already-subscribed profile to the billing portal instead of a second
// subscription, and creates the Checkout Session server-side with the profile baked in
// (client_reference_id + subscription metadata). The old Payment Links are kept only as
// the source of the Pro prices; deactivate them in Stripe so they can't be paid directly.
const PRO_LINK_URLS = {
  monthly: 'https://buy.stripe.com/00w3cxdwm3Nk1ATedIaMU04',
  yearly: 'https://buy.stripe.com/aFa8wRfEu83A1DTglQaMU03',
};
let proPriceCache = null;
async function proPriceId(stripe, period) {
  if (!proPriceCache) {
    const found = {};
    for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
      for (const k of Object.keys(PRO_LINK_URLS)) {
        if (link.url !== PRO_LINK_URLS[k]) continue;
        const items = await stripe.paymentLinks.listLineItems(link.id, { limit: 1 });
        const item = items.data[0];
        if (item && item.price) found[k] = { price: item.price.id, managed: !!(link.managed_payments && link.managed_payments.enabled) };
      }
    }
    proPriceCache = found;
  }
  return proPriceCache[period] || null;
}
function checkoutError(res, status, msg) {
  res.status(status).set('Content-Type', 'text/html').send(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="font-family:-apple-system,sans-serif;background:#0b0c10;color:#f5f6f8;padding:40px 20px;text-align:center">'
    + '<h2>Can\'t start checkout</h2><p style="color:#8f939d">' + msg + '</p>'
    + '<p><a style="color:#6aa5f0" href="https://victoryraceday.com/driven/">Back to Driven</a></p></body>');
}
exports.proCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: false },
  async (req, res) => {
    const profileId = String(req.query.profileId || '');
    const period = String(req.query.period || '');
    if (!/^prof_[a-z0-9]{6,20}$/i.test(profileId) || !PRO_LINK_URLS[period]) {
      checkoutError(res, 400, 'Open Driven and tap Get Pro from your Card page.');
      return;
    }
    const db = admin.database();
    const [card, ent] = await Promise.all([
      db.ref('profiles/' + profileId + '/card/name').once('value'),
      db.ref('profiles/' + profileId + '/entitlement').once('value'),
    ]);
    if (!card.val()) {
      checkoutError(res, 404, 'Publish your Driven card first (Card page → Publish my card), then try again.');
      return;
    }
    const e = ent.val();
    if (e && e.tier === 'pro' && (e.status === 'active' || e.status === 'trialing' || e.status === 'past_due')) {
      res.redirect(303, 'https://us-central1-raceday-d32dd.cloudfunctions.net/billingPortal?profileId=' + encodeURIComponent(profileId));
      return;
    }
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const plan = await proPriceId(stripe, period);
    if (!plan) {
      logger.error('proCheckout: no price found for ' + period);
      checkoutError(res, 503, 'Pro checkout is temporarily unavailable. Please try again later.');
      return;
    }
    const params = {
      mode: 'subscription',
      line_items: [{ price: plan.price, quantity: 1 }],
      client_reference_id: profileId,
      subscription_data: { metadata: { profileId } },
      success_url: 'https://victoryraceday.com/driven/?pro=1',
      cancel_url: 'https://victoryraceday.com/driven/',
    };
    // Mirror the Payment Link's Managed Payments setting so tax/merchant handling matches.
    if (plan.managed) params.managed_payments = { enabled: true };
    const session = await stripe.checkout.sessions.create(params);
    logger.info('proCheckout: session ' + session.id + ' for ' + profileId + ' (' + period + ')');
    res.redirect(303, session.url);
  }
);

const { cutoffDateStr } = require('./lib/pruneBackups');

// Roughly two seasons of weekly backups. A starting default — no data is lost by
// pruning more slowly than a track's actual usage; only tune this if storage still
// grows faster than expected.
const BACKUP_RETENTION_DAYS = 180;

exports.pruneOldBackups = onSchedule('every monday 06:00', async () => {
  const db = admin.database();
  // backupTracks/<trackId>:true is a tiny index (booleans only) written alongside every
  // backup specifically so this job can enumerate tracks without reading trackBackups
  // itself — that node holds the actual backup payloads, and reading it in full on every
  // run just to find keys would re-download every track's current backup on a schedule,
  // the same unbounded-cost problem this job exists to prevent.
  const tracks = (await db.ref('backupTracks').once('value')).val() || {};
  const trackIds = Object.keys(tracks);
  const cutoff = cutoffDateStr(BACKUP_RETENTION_DAYS);
  let prunedTracks = 0, prunedEntries = 0;
  for (const trackId of trackIds) {
    // A range query bounded by the cutoff returns ONLY the already-expired entries —
    // i.e. exactly what's about to be deleted. Nothing within the retention window is
    // ever read, on any run, so this job's own cost doesn't scale with retained data.
    const stale = await db.ref('trackBackups/' + trackId + '/daily').orderByKey().endBefore(cutoff).once('value');
    const updates = {};
    stale.forEach(child => { updates[child.key] = null; });
    const n = Object.keys(updates).length;
    if (n) {
      await db.ref('trackBackups/' + trackId + '/daily').update(updates);
      prunedTracks++;
      prunedEntries += n;
    }
  }
  logger.info('pruneOldBackups: checked ' + trackIds.length + ' tracks, removed ' + prunedEntries + ' backups older than ' + cutoff + ' across ' + prunedTracks + ' tracks');
});
