# RaceDay v2 — parity checklist

Tracks every renderer, modal, admin section, and helper in `raceday/index.html` (v1)
against its `raceday2/index.html` (v2) equivalent. Cutover of `/raceday/` does not
happen with an unchecked box — see `CLAUDE.md` / the redesign plan for the cutover gate.

Legend: ✅ verified (automated test + manual check) · 🟡 present, lighter than v1 by
deliberate scope cut (noted) · ⬜ not yet built.

## Engine (copied verbatim — see file banners `§1a`–`§1j` in raceday2/index.html)

All race logic, storage, sync, license, governance, backup, timing-import parsing, and
legal text is copied function-for-function from v1, not rewritten. `test-v2-compat.js`
proves v2 computes byte-identical standings/feature-grids/points against the same data
v1 produces, and round-trips `save()` without adding or dropping a single persisted
field. This is the load-bearing guarantee for cutover.

- ✅ Storage/migrate/save/load, `schemaVersion` chain (all 8 migrations)
- ✅ `SYNC_FIELDS`, `syncPush`/`syncPull`/`syncApplySnapshot` — v1 and v2 devices sync live
- ✅ License/trial/PIN hashing, premium-code checking
- ✅ Pills, heat building, inverts (field/heat scope), `single`/`parallel`/`cascade` B-mains
- ✅ Standings, points (fixed/linear presets), season series aggregation
- ✅ Results governance (official/unofficial, lock, override, versions), audit log
- ✅ Cloud backup allowlist, restore (file + cloud code), consent recording
- ✅ Timing-import CSV parsing, vendor/column detection, driver matching, apply gates
- ✅ Driven profile card sanitize/premium-recompute, photo caps

## Shell & navigation (new in v2)

- ✅ Dark token system; light palette reserved for print + daylight sign-up toggle
- ✅ Saira Condensed self-hosted (embedded woff2) — offline-safe, no Google Fonts CDN
- ✅ Left rail (tablet/desktop) / bottom tab bar (phone), replacing the 860px column
- ✅ Race Control phase spine (Sign-up → Heats → B-mains → Features → Archive)
- ✅ One sheet mechanism replacing v1's dozen fixed modal divs
- ✅ Role-boundary invariants — `test-v2-roles-security.js`, ported from
  `tests/test-roles-security.js`, 80/80 checks green. **Fixed during a later audit
  pass:** the original 67-check port predated a real production fix v1 shipped —
  `adminOk()` had no role check at all, so on a track with no admin PIN set, a
  spectator or `tv` device could still archive the live race day or edit
  qualifying times. Ported v1's fix (`adminOk()` refuses `viewer`/`tv` outright,
  and `renderGrid()`/`classGridMarkup()` hide the qualifying-times button and
  toolbar from `tv`) plus its §14/§15 regression tests, verified by mutation
  testing (each layer reverted in turn, confirmed the right checks go red).

## Sign-up

- ✅ One-screen sign-up (name → autocomplete → auto-filled number/classes → draw)
- ✅ `findRosterMatch` identity-merge confirm, per-class number-clash checks
- ✅ Consent checkbox + legal links, Driven link code field
- ✅ `showPillChoice` keep-vs-redraw (sheet-based)
- ✅ Fix: consent recorded once per driver per night, not once per class (was a BACKLOG item)
- ✅ Fix: consent checkbox no longer clears itself while typing
- 🟡 Kiosk mode: `settings.kioskReg` + `body.kiosk` CSS wired; full-screen self-serve
  polish (dedicated kiosk landing chrome) not yet distinct from normal sign-up

## Lineups

- ✅ Class filter (v1 stacked every class's every stage in one scroll)
- ✅ Double/single file, qualifying times (sheet), driver card on tap (every role)
- ✅ Same grid math (`gridMarkup`, `heatSet`, invert application) as v1

## Scoring

- ✅ Tap-order, number-pad, and dropdown entry — `test-v2-scoring.js` proves all three
  write byte-identical `heatResults` for the same finishing order
- ✅ Governance bar (official/lock/override/versions), duplicate-finish warnings
- ✅ Points-race toggle, gated on full feature completion (with DNF/DNS/DQ counted as done)

## Points

- ✅ Season standings by class, tonight's live/pending/off status banner

## Admin

- ✅ Two doors (Race night / Season setup) + Account + Danger, replacing the tile-grid
  → pill-tab double hop
- ✅ Settings search (keyword, not just section label) — `test-v2-admin.js`
- ✅ All 15 v1 sections present and mounted: entries, history, track, classes, format,
  points, PIN, license, sync, roster, backup, points-repair, legal, audit, danger
- ✅ Setup wizard as a sheet (same field ids, same step logic), gains nothing removed
- ✅ Fix: `newClassId()` collision guard confirmed present (was flagged in BACKLOG;
  v1 already carries the fix, ported verbatim)
- ✅ Fix (found during a later audit pass): Admin → History → "View" called
  `toggleHist(i)`, which was never defined in `raceday2/index.html` — a dangling
  `onclick` reference that threw a `ReferenceError` and left the entry collapsed.
  Ported `toggleHist()` verbatim from v1; regression-tested in `test-v2-admin.js`
  (click View, assert no page error and the entry actually expands) and verified
  by mutation testing (removed the function again, confirmed the new checks go red).

## Outputs

- ✅ TV broadcast mode — lineup/heat/main/feature slides verbatim from v1, **plus** new
  results and season-points slides once there's something to show
- ✅ Print — sheet of 4 outputs (lineup, pit board, results, points) vs. v1's 1 hardcoded
  button, each self-contained ink-on-white
- ✅ Spectator/fan view — hero, follow-a-driver, Points stage added to the per-class
  tabs, shareable PNG result card; `ROLE_PAGES.viewer` boundary unchanged and re-verified
- ✅ Driver card edit (age/hometown/sponsors/team color/photo) + Driven link/refresh/unlink
- ✅ Timing import — CSV → stepper → match-status preview → apply, same engine as v1
- 🟡 Timing import: v1's folder-watch auto-apply (desktop File System Access API) is
  **dropped by design** — smallest-usage slice of the feature, kept the reviewable
  surface smaller. Manual file-pick per import remains fully functional.
- ✅ Legal docs (Terms/Privacy verbatim text, admin-gated business recommendations)

## Test coverage

| Suite | Target | Checks |
|---|---|---|
| `tests/v2/test-v2-compat.js` | data/engine parity, migrations, boot | 33 |
| `tests/v2/test-v2-scoring.js` | sign-up, lineups, 3 scoring modes, points | 31 |
| `tests/v2/test-v2-admin.js` | wizard, 2-door nav, search, 15 sections, History→View click-through | 46 |
| `tests/v2/test-v2-outputs.js` | TV, print, fan view, driver cards, import, docs | 36 |
| `tests/v2/test-v2-roles-security.js` | role/boot/wizard/sync invariants (the gate), viewer/tv admin lockdown | 80 |
| **Total** | | **226** |

All counts above were re-run live (not taken on faith) as part of an August 2026
audit pass. The two fixes noted inline above (`adminOk()`/qual-times tv lockdown,
`toggleHist()`) were found by that audit, not present when this document was
first written — everything else in this checklist held up under spot-checking
(engine-parity claims verified via byte-diff against v1).

Original v1 suites (`tests/test-*.js`) are untouched and still point at `/raceday/`,
which this work never modifies.

## Not yet ported to `tests/v2/`

These v1 suites cover ground already exercised indirectly (compat's byte-identical
engine proof covers their underlying logic), but have not been ported as dedicated v2
suites yet:

- `test-qual-mains.js` (qualifying-straight-to-mains format) — engine copied verbatim,
  covered indirectly by compat's engine-parity check; no dedicated v2 UI-flow test yet
- `test-main-invert.js` (feature/B-main starting-spot invert) — same
- `test-cloud-backup.js` (cloud backup payload scrubbing) — engine copied verbatim
  (`CLOUD_BACKUP_FIELDS` allowlist unchanged); no dedicated v2 test yet
- `test-points-repair.js` — UI exercised in `test-v2-admin.js`'s "repair" section-open
  check only, not the full add/edit/duplicate-guard flow
- `test-roster-match.js` — the identity-merge path is exercised in `test-v2-scoring.js`'s
  "returning driver" case, not the full same-name-different-person matrix
- `test-qual-times.js` — the sheet opens and renders in manual testing; no dedicated
  automated v2 suite yet
- `test-viewer-results.js` — covered by `test-v2-outputs.js`'s fan-view section, not a
  1:1 port
- `test-smoke.js` — superseded in spirit by the four functional v2 suites together
- `test-profiles.js` — targets `driven/index.html`, which this work does not touch

**Recommendation before cutover:** port `test-cloud-backup.js` and `test-points-repair.js`
next — both guard data-safety properties (no PIN/license/audit leakage in a cloud
payload; no double-counting a repaired night) that are easy to regress silently and
have no other test currently pinning them for v2.

## Scope boundaries (unchanged from the redesign plan)

- `/raceday/`, `/driven/`, the root marketing page, and `timing-import.html` are not
  modified by this work.
- No backend, no new Firebase paths, no auth changes.
- All work on `claude/raceday-app-redesign-v27b43`. No merge to `main`, and no cutover
  of `/raceday/`, without explicit approval.
