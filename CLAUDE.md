# RaceDay — Claude Code context

## What this is
Single-file PWA for race-night management (sign-up, lineups, results, points).
The app lives in `raceday/index.html` (~4,840 lines, ~308 KB). No build step, no
package.json, no framework. Hosted on GitHub Pages at https://victoryraceday.com/ —
the bare domain now serves a marketing homepage (root `index.html`), with the app
itself at `/raceday/` and the Driven companion app at `/driven/`.

## CRITICAL CONSTRAINTS — never break these
- `raceday-codegen.html` is gitignored and **MUST NEVER be committed** — it holds
  the secret license salt. If it appears in `git status`, do not stage it.
- **Never push to `main` without explicit user approval.** Dev work goes on
  `claude/track-admin-improvements-d46hxg` (or a feature branch). Ask before merging.
- The owner's license code is `VICTORY-0-4K548V` (unlimited/forever). Never regenerate.

## Architecture
- All HTML, CSS, and JS live in one `<script>` block inside `raceday/index.html`
- State: global `S` object → `localStorage` key `raceday_v1`
- Save pattern: `S.field = value; save();`
  - `save()` writes localStorage then calls `syncPush()` if sync is on
  - Direct `localStorage.setItem()` calls that bypass `save()` have inline comments explaining why
- Firebase Realtime Database for optional multi-device sync (`SYNC_FIELDS` const controls what syncs)
- Service worker: `raceday/sw.js`, cache version in `CACHE` const — bump it when deploying
  cache-breaking changes. Root `sw.js` is a separate, minimal "retiring" worker for the
  marketing page — see "Site structure" below.

## Global namespace objects (added 2026-06-30 cleanup)
These replaced 15 scattered `let` vars — use these, not bare variable names:
- `TV`   — `{ on, idx, locked, timer, ctlTimer }` — TV display state
- `Sync` — `{ db, timer, applying, activating, connected }` — Firebase connection state
- `UI`   — `{ viewClsId, viewStage, ptsTab, ptsNames, histOpen, admOpen, pillChoiceCb, wizStep }`

## Key patterns
- **Render**: query container by ID → build HTML string → set `.innerHTML`
- **Modal helpers**: `showModal(id, display?)` / `hideModal(id)` — always use these, never raw `style.display`
- **Admin guard**: `if (!adminOk()) return;` at top of every admin-only function
- **Migration**: `migrate(s)` in `load()`; guarded by `s.schemaVersion`; new migrations check
  `s.schemaVersion < N`, apply the change, then set `s.schemaVersion = N` before `return s`
- **Naming**: `del*` for deletions, `toggle*` for boolean flips, `render*` for DOM builders, `show*`/`hide*` for visibility

## Syntax check (run after every edit to raceday/index.html)
```bash
python3 -c "
import re; html=open('raceday/index.html').read()
blocks=re.findall(r'<script[^>]*>(.*?)</script>',html,re.DOTALL)
open('/tmp/check.js','w').write(max(blocks,key=len))
" && node --check /tmp/check.js && echo 'SYNTAX OK'
```
Or just use `/syntax`. Editing the root marketing `index.html` or `driven/index.html`?
Point the same script at that file instead.

## Site structure
`victoryraceday.com` serves three things from one repo:
- **`/`** — root `index.html`: a marketing homepage (RaceDay + Driven overview). Its
  `<head>` runs an inline redirect check *before* any content renders: a returning
  device (has `raceday_v1` in localStorage) or an incoming station/sync link
  (`?sync=`/`?role=` in the query string) gets `location.replace()`'d straight to
  `/raceday/`, preserving the query string. New visitors see the marketing page. Root's
  `sw.js` is a **retired, minimal worker** (no manifest, no caching) that exists only to
  take over from the old root-scoped service worker on returning devices and clear its
  cache — do not add caching logic back to it.
- **`/raceday/`** — the actual app (this is what "the app" means everywhere else in this
  doc). Own `manifest.webmanifest` + `sw.js` (scoped to `/raceday/` via relative paths).
- **`/driven/`** — the Driven companion app, see below.
- **`/drivers/`** — the Driven *website* (marketing for drivers): `index.html`, `pricing.html`, `faq.html`,
  `guides/` (hub + 7 step-by-step guides). Static pages sharing `drivers/site.css` (the RaceDay site's
  system in Driven blue); guides reuse `/guides/guides.css` + `drivers/guides/driven.css`. Screenshots in
  `drivers/img/`. All "Driven" links on the RaceDay site point here, not at the app; no auto-redirect.

## Files
| File | Purpose |
|---|---|
| `index.html` | Root marketing homepage — **not** the app, see "Site structure" |
| `sw.js` | Root's retired/minimal service worker — see "Site structure" |
| `raceday/` | **The RaceDay app** — `index.html` is where all app features go, plus its own `manifest.webmanifest`/`sw.js`/icon |
| `drivers/` | **Driven website** — home, pricing, FAQ, guides for drivers (see "Site structure") |
| `driven/` | **Driven companion app** (separate PWA) — driver-owned cross-track racing identity. `driven/index.html` is fully standalone (own manifest/sw/state, `localStorage` key `profiles_v1`). Results move via manual JSON import (`ingestExport()`) or, for a linked profile, a live pull from RaceDay's published results (`shareResultsWithDriven()` → `pullRaceDayResults()`). See "Driven app" below. |
| `BACKLOG.md` | Parked items (operator hardening, deferred audit findings) |
| `ARCHITECTURE.md` | Full technical reference (data model, sync, roles, points system) |
| `timing-import.html` | Companion CSV timing import tool — separate file, don't modify during main app work |
| `raceday-codegen.html` | **GITIGNORED SECRET — never commit, never stage** |
| `test-data/` | CSV + JSON fixtures for manual testing |
| `tests/` | Playwright suites — see `tests/README.md` |

## Driven app (`driven/index.html`)
A separate, self-contained PWA — not part of `raceday/index.html`, has its own manifest/
service worker/localStorage key (`profiles_v1` — unchanged by the `profiles/`→`driven/`
directory rename; it's app-local storage, not a URL path). Lets a driver create one
profile that follows them across every RaceDay track they race at.
- State var is `P` (not `S`), object shape: `{ profileId, driver, linkedTracks, raceResults,
  sponsors, tier, premiumCode, shortCode, publishedAt }`
- **Card pipeline (wired 2026-07-08)**: the driver "publishes" their card to the shared
  Firebase RTDB (`profiles/<profileId>/card` + `profiles_short/<SHORTCODE>` lookup index;
  short code = `profileId.slice(5,13)` uppercased, collision-extended). At the track the
  driver gives their link code at sign-up (optional `#dProfCode` input) or the admin links
  from the driver card (`linkProfilePrompt`). RaceDay pulls + sanitizes (`linkProfile` /
  `sanitizeProfileCard` — type/length caps, anchored photo regex, premium hash recompute),
  stores it on the roster record with `source:'profiles'` (locally read-only, Refresh /
  Unlink). Offline links pend (`profile.pendingFetch`) and retry on reconnect. The
  `RDPROFILE:<id>` QR payload exists for future camera scanning.
- **Premium**: unlocked in Driven with an offline-checked code `PREM-<SHORT>-<HASH8>`
  (`PREM_SALT` + `pHash` — constants are duplicated in BOTH apps and must stay identical;
  RaceDay recomputes the hash before honoring premium, never trusts a boolean)
- Results enter via `ingestExport(data)` — accepts `{trackId, trackName, date, results:[...]}`
  (or an array of those), dedupes by `trackId+date+class`, auto-populates `linkedTracks`
- Manual JSON import (`ingestExport()`) is no longer the only path: `shareResultsWithDriven()`
  (RaceDay-side, `raceday/index.html`) publishes an archived night to Firebase
  (`profileTracks/`+`results/`), and Driven pulls it live via `pullRaceDayResults()`/
  `checkRaceDayResults()` (a "Check for new results" Settings button), source-tagged
  `'raceday'` as verified — corrected here after an audit found this doc stale
- Career stats computed live from `raceResults` via `computeStats()` — no stored cache
- **Other results** (`P.otherResults`, added 2026-10-15): races a driver adds from other apps
  (Speedhive, MyRacePass…), each labeled with its app (`cleanOther()` normalizes). A separate list
  on purpose — never in `raceResults`, never counted in stats/milestones/points. On the card
  (`other`, JSON `{r,more}`, ≤8000 chars, trimmed oldest-first) ONLY for Pro with
  `showOtherOnPage` on; `/d/` re-checks Pro and sanitizes. Guard: `tests/test-driven-other-results.js`
- **Rides** (added 2026-10-15): one account, a card per kind of racing (Pro: up to 3). Every ride is a
  full profile with its OWN profileId/card/link code/results — RaceDay, the results pipeline and `/d/`
  need no ride logic. `profiles_v1` = the ACTIVE ride (unchanged shape); the others live in
  `profiles_rides_v1` = `{primaryId, order, stash}` (stash never holds the active ride; absent for a
  one-ride account). Pro is account-level: `currentTier()` also reads `primaryProfile()`; checkout,
  billing portal, entitlement and redeem codes use the primary ride's id. Name/email/hometown/age are
  shared (`saveProfileFields` copies them + `republishSiblings()`). Cards carry `rides`
  (`CODE:Name|…`, primary first) + `rideLabel` only when multi-ride; `adoptRidesFromCard()` restores
  siblings (reciprocal listing required); `/d/` shows tabs only for reciprocal rides.
  Guard: `tests/test-driven-rides.js`
- Same design language as `raceday/index.html` (CSS vars, `.card`/`.btn`/`.hr` patterns) and
  the same embedded QR generator, copied verbatim — kept intentionally separate rather than
  shared, to preserve the single-file-per-app model

## Dev workflow
- Active dev branch: `claude/track-admin-improvements-d46hxg`
- Syntax check: `/syntax`
- After ANY `raceday/index.html` change: run all Playwright suites — `for t in tests/test-*.js; do node "$t" | tail -1; done`
- Touching roles, permissions, the setup wizard, sync, or the boot sequence? `tests/test-roles-security.js` is the guard for those invariants — add/update a check there for the new behavior, and confirm it would catch a regression (see that file's header + `tests/README.md`). Three live security bugs came from this area with no test coverage; this suite is how it stays fixed.
- Commit + push current branch: `/push <message>`
- See branch state: `/check`
- Merge to main: only with explicit user approval — always ask first
- After merging to main: VERIFY the GitHub Pages build succeeds (a deploy can fail transiently) before telling the user it's live; bump `raceday/sw.js` CACHE on cache-breaking changes
- **Bumping an app's sw.js CACHE? Bump its `APP_VERSION` too** (`YYYY-MM-DD.vN`, N = the CACHE
  number) — `tests/test-analytics.js` fails if they drift. It's what usage/crash rows report.
- Analytics: every page loads the Cloudflare beacon through an inline loader that skips devices
  with `localStorage.rd_dont_count === '1'` (set at `/me/`); both apps' `sendUsage()` then sends
  crash rows only. Never add a direct `<script src=…cloudflareinsights…>` tag. Short links
  `/fb/`, `/li/`, `/qr/` (+ `/drivers/` versions) record a visit, then forward — use them in posts.
