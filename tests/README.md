# RaceDay test suites (Playwright)

Run all (from repo root):
```bash
for t in tests/test-*.js; do node "$t" | tail -1; done
```
If a suite times out or hangs when run back-to-back with others, re-run it alone
(`node tests/test-x.js`) — each suite is reliable in isolation; occasional port/timing
contention across suites can wedge one when they're chained.

| Suite | Covers |
|---|---|
| `test-smoke.js` | Full race night: wizard → signup UI → lineups/TV → scoring → points → lock/override → archive → reload persistence |
| `test-viewer-results.js` | Spectator Results tab + "Results updated" toast |
| `test-qual-times.js` | Manual qualifying times + set-grid-from-times |
| `test-main-invert.js` | Feature/B-main starting-spot invert |
| `test-profiles.js` | Driven app (`driven/index.html`): onboarding, profileId + QR, demo import, career stats, dedupe, edit, unlink, delete, persistence, `activatePremium()`'s direct UI path, `migrate()`'s legacy-tier collapse rules, restore error paths (garbage/wrong-shape JSON, unknown code, network failure), the photo pipeline (upload/crop/60KB gate/`photoOK()`/remove), and the QR payload's actual content (not just canvas size) |
| `test-driven-entitlement.js` | Driven's Pro-subscription entitlement system — grace-window expiry checked against an **independent reference model** (not the app's own `entitlementTierKey()`/`currentTier()`), the offline-code/server-entitlement tier union, `refreshEntitlement()`'s Firebase read and malformed-data fallback, `?pro=1` boot idempotency (the flag key is the *whole* query string, not just a boolean), and `pollEntitlement()`'s give-up-and-offer-retry path |
| `test-driven-publish.js` | Driven's publish pipeline — `cardPayload()`'s exact field mapping (including the `firebase.database.ServerValue.TIMESTAMP` static-vs-instance gotcha), `cardTooLong()`/`CARD_CAPS` rejecting over-cap fields client-side before any network call, the short-code claim/collision-extension loop (8→10 chars, confirmed non-atomic), and `deleteProfile()`'s Firebase-cleanup branch |
| `test-qual-mains.js` | "Qualifying · straight to mains" race format — seeding, B-main transfers, points, viewer/TV/print, 2-heat regression guard |
| `test-roster-match.js` | Sign-up identity-merge fix — typed name+number collisions require confirmation instead of silently merging into an unrelated driver; explicit suggestion picks stay frictionless |
| `test-points-repair.js` | "Fix season points" admin form — a repair entry feeds `seriesStandings()`, nights sum, and **editing one replaces it instead of double-counting**; duplicate guard, stale-index-on-delete, whole-class prefill, Edit offered only on hand-entered entries |
| `test-cloud-backup.js` | **Cloud backup payload scrubbing** — the uploaded payload must never carry PIN hashes, the license code, the audit log, or consent records (which hold participant IPs); plus off-by-default + migration never opting a track in, the explicit-consent toggle, restore keeping the device's own license/PIN, the write-only vault rules, and that `backupToCloud()` writes the `backupTracks` prune-index alongside every backup |
| `test-roles-security.js` | **Role-boundary + boot-sequence invariants** — what each role may see/do, the setup-wizard gating, `?role=` URL promotion, stuck-device recovery, forgotten-PIN recovery, sync write-blocks, the join-clobber warning, and (§14/§15) that **viewer and tv devices can never trigger an admin-gated action even with no PIN configured** — `checkDayBanner()`'s day-banner visibility, `adminOk()` refusing viewer/tv outright before any PIN check, and the tv-role qualifying-times UI leak, each verified independently via red/green mutation testing |
| `test-season-points.js` | **Season-long points accuracy** — drives a full multi-night season through the real archive path (`newRaceDay()`) plus a "Fix season points" backfilled night, and checks `seriesStandings()`/the rendered Points tab against an **independently-written reference point calculator** (not the app's own `dayPoints()` logic). Covers a mid-season points-table change (earlier nights must keep their original values), a driver marked `noPoints` partway through (earlier nights still count, later ones don't), a DNF (scores 0, isn't skipped), a driver joining mid-season, and real archived nights summing correctly alongside a backfilled one |

Each spins up its own HTTP server on a unique port and exits 1 on any failure.
Requires the Playwright Chromium at `/opt/pw-browsers/chromium` (Claude Code cloud env);
edit the `executablePath` if running elsewhere.

**Rule: run all suites after any change to raceday/index.html, root index.html, or driven/index.html.**

## Why `test-roles-security.js` exists (and how to keep it useful)

Three separate security bugs reached production during one live race night — a spectator
QR scan opening an editable admin/setup page, an on-screen escape hatch letting a viewer
become admin, and the `?role=` URL param promoting a viewer with no auth — plus a "fix"
that then bricked legit staff devices, and a forgotten PIN that couldn't be recovered.
None were caught, because the feature suites test *race logic* (inverts, results, points)
and nothing pinned **what a device is allowed to do per role, or how boot/sync behaves on
a fresh device**. That's the entire job of this suite.

The discipline that keeps it working:

- **Every role/permission/boot change adds or updates an invariant here.** New role? Add
  its row to the section-4 access matrix. New privileged action? Assert a spectator can't
  reach it. New boot/sync step? Assert what a fresh joining device does.
- **A failure here is a security incident, not a flaky test.** Don't relax an assertion to
  make it pass — a red check means a boundary moved.
- **Verify the guard actually guards.** When you change one of these invariants, briefly
  reintroduce the old (bad) behavior and confirm the suite goes red — a test that can't
  fail protects nothing. (That mutation check is how this suite was validated.)
