# RaceDay — Backlog / revisit later

Parked items. Nothing here is built yet — these are agreed "come back to it" notes.

---

## Operator mode — security hardening (parked 2026-06-30)

Operator mode shipped to the dev branch (watch read-only → take control with a private
Operator PIN). The current protection is **layered/soft**, not server-enforced. Revisit if
we want tracks genuinely locked out of control mode.

**Current protections (as built):**
- Real boundary = the per-track **sync code** (secret per track). A track can only reach
  tracks whose code they know — normally just their own. Cross-track isolation is solid.
- On their *own* track, operator mode gives a track nothing beyond the admin access they
  already have — no privilege escalation.
- Operator PIN guards the owner's monitoring device against casual/accidental control.

**Known soft spots:**
- `?role=operator` is just a URL parameter (guessable pattern). It only works on a track
  whose code the person already has, but the role itself isn't a secret.
- `opPinOk()` **auto-creates** the Operator PIN on first use, so a fresh device isn't
  proving it knows the owner's PIN — it just makes one. The PIN deters casual use; it is
  not a hard "only the owner" lock.

**Hardening options to revisit:**
1. Gate *entering* operator role behind a secret baked into the build (same model as the
   license salt, `LIC_SALT`) — then `?role=operator` alone does nothing; you must know the
   operator passphrase. Tracks can't enter operator mode at all.
2. Stop auto-creating the Operator PIN — require the real one.
3. For truly server-enforced access (the only bulletproof option): Firebase security rules
   gating writes to `tracks/<CODE>` behind an auth token / secret. Bigger architectural
   piece — scope separately.

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
