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
| `test-profiles.js` | Profiles app (`profiles/index.html`): onboarding, profileId + QR, demo import, career stats, dedupe, edit, unlink, delete, persistence |
| `test-qual-mains.js` | "Qualifying · straight to mains" race format — seeding, B-main transfers, points, viewer/TV/print, 2-heat regression guard |
| `test-roster-match.js` | Sign-up identity-merge fix — typed name+number collisions require confirmation instead of silently merging into an unrelated driver; explicit suggestion picks stay frictionless |
| `test-roles-security.js` | **Role-boundary + boot-sequence invariants** — what each role may see/do, the setup-wizard gating, `?role=` URL promotion, stuck-device recovery, forgotten-PIN recovery, sync write-blocks, and the join-clobber warning |

Each spins up its own HTTP server on a unique port and exits 1 on any failure.
Requires the Playwright Chromium at `/opt/pw-browsers/chromium` (Claude Code cloud env);
edit the `executablePath` if running elsewhere.

**Rule: run all suites after any change to index.html or profiles/index.html.**

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
