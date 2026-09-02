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
  `tests/test-roles-security.js`, 112/112 checks green. **Fixed during a later audit
  pass:** the original 67-check port predated a real production fix v1 shipped —
  `adminOk()` had no role check at all, so on a track with no admin PIN set, a
  spectator or `tv` device could still archive the live race day or edit
  qualifying times. Ported v1's fix (`adminOk()` refuses `viewer`/`tv` outright,
  and `renderGrid()`/`classGridMarkup()` hide the qualifying-times button and
  toolbar from `tv`) plus its §14/§15 regression tests, verified by mutation
  testing (each layer reverted in turn, confirmed the right checks go red).
- ✅ **Guest Pass** (§8b–§8c) — a `?role=viewer` link opens a read-only *session*
  rather than changing the device's state: `GUEST` is decided before the first
  `load()`, so `S` starts from `defaults()`, the device's own slot is never opened,
  and nothing is written anywhere (`save()`, the four `persistLocal()` bypasses,
  `doFullReset()` and the cross-tab storage listener all no-op). `deviceRole()`
  reports `viewer` for the session without touching the stored role, so a device
  no longer comes home permanently demoted. Leaving is a plain reload — nothing was
  stashed, so nothing can be restored wrong. A room bookmark (`rd_guest_room_v2`,
  code + label only, never track data) means a fan who scans at the gate still
  lands on that track when they reopen the app. Staff-station joins keep the
  "will be REPLACED" confirm, which is now the only place it appears. Ported from
  `raceday/index.html`; supersedes the earlier clean-reset fix.
  **Why it exists:** track operators race and travel. Scanning another track's
  poster used to replace their season *and* demote their device; the visited
  track's Points tab and driver cards also inherited the home track's `S.history`
  (which never syncs), so an operator saw their own standings under the visited
  track's class names.
- ✅ v2 uses its own localStorage key (§8d) — `raceday_v2`, distinct from v1's
  `raceday_v1`. **Fixed during the same audit pass:** v1 and v2 shared the same
  state key while using *different* role keys (`rd_role` vs. `rd_role_v2`), so a
  phone that scanned a v1 spectator QR — synced, `viewer` role, live track data —
  would default to `admin` the moment it opened a v2 link (no `rd_role_v2` set),
  while `S` still held that live-synced track. The viewer write-guard no longer
  applied, so that phone could write to the live race. v2 wasn't live yet, so this
  was the cheapest time to close it structurally rather than patch the default role.

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
| `tests/v2/test-v2-roles-security.js` | role/boot/wizard/sync invariants (the gate), viewer/tv admin lockdown, Guest Pass (a spectator link never touches the device's own track or stored role), v2's own storage key never inherits a v1-synced device | 112 |
| `tests/v2/test-v2-cloud-backup.js` | cloud backup payload scrubbing, restore-by-code, write-only vault rules, blank-track-name restore warning, malformed-backup recovery | 42 |
| `tests/v2/test-v2-points-repair.js` | "Fix season points" full add/edit/duplicate-guard flow (not just section-opens) | 15 |
| `tests/v2/test-v2-qual-mains.js` | qualifying-straight-to-mains format — seeding, B-mains, points, viewer/TV, 2-heat regression guard | 31 |
| `tests/v2/test-v2-main-invert.js` | feature/B-main starting-spot invert | 26 |
| `tests/v2/test-v2-roster-match.js` | sign-up identity-merge — same-name-different-person confirm, explicit-pick zero-friction merge | 22 |
| `tests/v2/test-v2-qual-times.js` | manual qualifying-times entry + set-grid-from-times | 23 |
| `tests/v2/test-v2-shell.js` | the 900px responsive breakpoint (rail vs. tabbar), clean-boot zero-console-error check | 7 |
| **Total** | | **424** |

All counts above were re-run live (not taken on faith) as part of an August 2026
audit pass. The two fixes noted inline above (`adminOk()`/qual-times tv lockdown,
`toggleHist()`) were found by that audit, not present when this document was
first written — everything else in this checklist held up under spot-checking
(engine-parity claims verified via byte-diff against v1).

A second pass ported the six suites this document previously listed as "not yet
ported" (see below), plus a new `test-v2-shell.js` for the responsive breakpoint. Engine
logic in every one of them was confirmed byte-identical to v1 during the port; the real
work was adapting to v2's different DOM — most notably its 3 score-entry modes (tap/pad/
select), where the default tap UI omits information (transfer-origin tags, heat totals)
that only renders in dropdown (`select`) mode, and the single-screen sign-up (no
`step2()`/step-gating at all, unlike v1's 3-step wizard).

Original v1 suites (`tests/test-*.js`) are untouched and still point at `/raceday/`,
which this work never modifies.

## Not yet ported to `tests/v2/`

- `test-viewer-results.js` — covered by `test-v2-outputs.js`'s fan-view section, not a
  1:1 port
- `test-smoke.js` — superseded in spirit by the functional v2 suites together
- `test-profiles.js` — targets `driven/index.html`, which this work does not touch (see
  `tests/test-driven-*.js` for that app's own coverage)

## Scope boundaries (unchanged from the redesign plan)

- `/raceday/`, `/driven/`, the root marketing page, and `timing-import.html` are not
  modified by this work.
- No backend, no new Firebase paths, no auth changes.
- All work on `claude/raceday-app-redesign-v27b43`. No merge to `main`, and no cutover
  of `/raceday/`, without explicit approval.
