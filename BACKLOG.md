# RaceDay — Backlog / revisit later

Parked items. Nothing here is built yet — these are agreed "come back to it" notes.

---

## Operator mode — security hardening (parked 2026-06-30; options 1 & 2 shipped 2026-07-12)

Operator mode shipped to the dev branch (watch read-only → take control with a private
Operator PIN). The current protection is **layered/soft**, not server-enforced.

**Current protections (as built):**
- Real boundary = the per-track **sync code** (secret per track). A track can only reach
  tracks whose code they know — normally just their own. Cross-track isolation is solid.
- On their *own* track, operator mode gives a track nothing beyond the admin access they
  already have — no privilege escalation.
- Operator PIN guards the owner's monitoring device against casual/accidental control.
- **Shipped:** `?role=operator` now requires a build-time `OPERATOR_KEY` passed as
  `?opk=...` — same deterrent model as `LIC_SALT`. A bare/guessed `?role=operator` link
  with no matching key is inert. The owner's own generated "Operator link" embeds it
  automatically.
- **Shipped:** `opPinOk()` no longer auto-creates the Operator PIN on first use — it
  fails closed with an alert until the owner deliberately sets one via the new
  `setOperatorPin()` (Admin → Multi-device sync → Operator link card).

**Still open:**
3. For truly server-enforced access (the only bulletproof option): Firebase security rules
   gating writes to `tracks/<CODE>` so only a *licensed* track can write. Bigger
   architectural piece — see the sync write-gating item below.

---

## Sync write-gating — deferred (explored & reverted 2026-07-12)

`tracks/*` is writable by anyone who knows a track's sync code (path-as-password). Closing
this so only a licensed track can write was explored via **Firebase Anonymous Auth + a
manual per-track grant** (`trackGrants/<code>` set in the Console). The code + rules were
written, then **reverted**: the manual grant is a separate step in a different place from
the code-generation workflow, and a forgotten grant silently breaks a track's race night —
not operationally acceptable.

**Paths to revisit (in `FIREBASE-SYNC.md → Sync write-gating — deferred`):**
- **Fold the grant into `raceday-codegen.html`** — issuing a license also writes the
  grant, so activation can't be forgotten. Zero new infra, but needs a design pass
  (codegen becomes an authenticated owner-writer; grants key off the license, not the
  freely-chosen sync code).
- **A small backend** (Cloud Function on Blaze, or external) — verifies the license and
  grants access automatically on sync activation. Fully hands-off; the "real" fix.

---

## Profiles card pipeline — Firebase rules hardening (parked 2026-07-08; rules authored 2026-07-12)

The Profiles→RaceDay card pipeline writes to unauthenticated RTDB paths
(`profiles/<id>/card`, `profiles_short/<code>`). RaceDay sanitizes everything on read
(type/length caps, anchored photo regex, premium-hash recompute), so injected data can't
XSS or fake premium — but anyone who learns a profileId could overwrite that driver's
card, and unbounded writes are a storage/abuse risk.

**Status:** `.validate` rules **published to the live Console 2026-07-14** (verified
against the official DB emulator loaded with the same rules — valid app writes accepted,
over-cap/off-schema writes rejected, `tracks/*` sync untouched). The Driven app was
updated the same day to cap inputs to match the rules and fail honestly instead of
silently desyncing (see below).

---

## Profiles/Driven — known model-inherent items (audit 2026-07-14)

Adversarial pass over both apps after the rules publish + Driven go-live. The one
**regression** (over-cap fields silently failing to publish) was fixed the same day
(input caps, `cardTooLong()` pre-check, honest error/success messaging, render-time
premium recompute). These remaining items are **pre-existing and inherent to the
open-store / path-as-password model** — none are newly introduced, and closing them
properly needs the deferred backend/auth work:

- **Premium codes are forgeable in principle** — `PREM_SALT` + the whole hash algorithm
  ship client-side (`profiles/index.html`), same accepted tradeoff as `LIC_SALT`. A real
  fix needs a server-side entitlement check. Mitigation shipped: RaceDay now **recomputes**
  `premCheck()` at render for Driven-sourced cards (`cardPremiumOK`), so a forged
  `premium:true` synced onto the roster no longer grants the premium look without a code.
- **Local "Premium broadcast card" checkbox** (`index.html` editDriverCard) sets premium
  on a *locally-managed* card with no code. Left as-is: it's the track styling its own
  local card (cosmetic), not a bypass of the driver's paid Driven tier.
- **Short-code poisoning / card swap** — `resolveProfileId` format-validates but can't
  verify ownership; a write to `profiles_short/<victimShort>` can redirect a genuine code
  to another card. Inherent to the open index; needs auth to close.
- **Minor/latent:** photo cap mismatch (80000 rule vs 60000 upload — storage only);
  `retryPendingProfiles` has no backoff/in-flight guard; short-code claim is a non-atomic
  read-then-write (TOCTOU, collision odds ~2^-62).

---

## Deferred audit findings (from the 2026-06-30 full-app audit)

The High items + a few Mediums were fixed and are on the dev branch. These remain open:

**Medium**
- B-main/feature winner marked DNF doesn't promote the next eligible driver → feature can
  be left a car short (`mainTopIds`).
- A points night silently never counts if the feature wasn't fully entered before "Start a
  new race day" → warn at archive time (`buildSnapshot`/`newRaceDay`).
- Linear feature points use the configured class size, not the actual field size → in a
  short field, 1st gets too many points and last doesn't get 1 (`dayPoints`).
- Same-name drivers get merged under one roster record/number → disambiguate on number
  mismatch (`register`/`findRosterMatch`).
- New class IDs use `Date.now()` → two classes added in the same millisecond collide; use
  `S.nextId++` (`addClass`/`readdClass`).
- `seedDemo` bypasses the trial/license gate (loads a full board with no `canEnter()` /
  `consumeTrialDay()`).
- "Recalculate" button is a no-op that flashes success (`recalcPoints`) — misleading.
- `seedDemo`/`resetAll` skip the `adminOk()` re-check that sibling danger actions have.
- Wizard step 3 can't add classes and silently ignores a blank rename (`wizSaveClasses`).
- Consent re-recorded on every multi-class signup (`register`) — inflates the consent log.

**Low**
- Danger-zone tab bar shows a bare "← All" with no section title (single-item group).
- `lockAdmin()` leaves `_admOpen` set (stale inline state, harmless).
- All-zero imported race inflates everyone's race count.
- Standings tie-break is alphabetical (no countback by wins/best finish).
- `suggest()` re-renders the roster on every keystroke.
- Consent checkbox unticks on Back/Next in sign-up.
