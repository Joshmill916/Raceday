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
   gating writes to `tracks/<CODE>` behind an auth token / secret. Bigger architectural
   piece, needs a backend (Cloud Functions or similar) — scoped separately, deferred.

---

## Profiles card pipeline — Firebase rules hardening (parked 2026-07-08; rules authored 2026-07-12)

The Profiles→RaceDay card pipeline writes to unauthenticated RTDB paths
(`profiles/<id>/card`, `profiles_short/<code>`). RaceDay sanitizes everything on read
(type/length caps, anchored photo regex, premium-hash recompute), so injected data can't
XSS or fake premium — but anyone who learns a profileId could overwrite that driver's
card, and unbounded writes are a storage/abuse risk.

**Status:** `.validate` rules capping `profiles/*` node size and shape are written and
documented in `FIREBASE-SYNC.md → Rules hardening → Step B1` — ready to paste into the
Firebase Console's Rules tab any time (no app code changes needed, safe to publish
independently). **Not yet published** — publishing live rules requires Console access,
which is outside what this repo/session can do; the owner needs to do that step manually.

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
