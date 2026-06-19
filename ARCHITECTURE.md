# RaceDay — Complete Project Documentation

Everything that's in the project, how the program works, and how to rebuild it from
scratch. Written so that a developer (or future-you) could recreate RaceDay from a
blank folder.

---

## 1. What RaceDay is

A browser app for running a **race day** at a karting / drag / oval track: drivers
sign up, get a random **pill** (starting-position draw), the app builds **heats**,
**B-mains**, and a **feature**, tracks **points/series standings**, archives **history**,
and shows live **lineups on a TV**. It is sold to tracks as a licensed product.

**Design philosophy:**
- **One self-contained HTML file** per app — no build step, no framework, no server.
- **Vanilla JavaScript**, one global state object `S`, persisted to `localStorage`.
- **Works offline** once loaded; everything lives in the browser.
- New capabilities are added as **dormant features** (telemetry, PWA, sync) that stay
  inert until configured, so the live app is never destabilized.

---

## 2. File inventory

| File | Status | Purpose |
|------|--------|---------|
| `index.html` | **Live (main)** | The entire RaceDay app — UI, logic, state, styling. ~2000 lines. |
| `timing-import.html` | **Live (main)** | Standalone companion: imports MYLAPS/Westhold/RaceHero/**MotoSponder** timing CSVs into RaceDay via the backup round-trip. |
| `SETUP.md` | Live | Owner guide: hosting, plans, access codes, TV casting. |
| `sw.js` | Staged (dormant) | PWA service worker — offline/installable. Not registered yet. |
| `manifest.webmanifest` | Staged | PWA metadata for "Add to Home Screen". |
| `icon-192.png`, `icon-512.png` | Staged | PWA / install icons (checkered-flag mark). |
| `PWA-OFFLINE.md` | Staged | How to activate offline/installable mode. |
| `FIREBASE-SYNC.md` | **Branch only** | How to activate multi-device sync. |
| `ARCHITECTURE.md` | This file | Full technical documentation. |
| `raceday-codegen.html` | **Private, gitignored** | Owner-only license code generator + sales ledger. Holds the secret salt — never committed. |

**Two integrations that live outside the repo:**
- **Usage telemetry** → a Google Apps Script web app writing to a Google Sheet (the
  `TELEMETRY_URL` in `index.html`).
- **Multi-device sync** (live, off by default) → a Google Firebase Realtime Database (`FIREBASE_CONFIG`).

---

## 3. Tech stack & conventions

- **HTML/CSS/JS in one file.** All CSS in a `<style>` block in `<head>`; all JS in one
  `<script>` block before `</body>`.
- **No dependencies** except a Google Fonts link (`Saira Condensed`) and, when sync is
  on, a lazily-loaded Firebase CDN script.
- **State:** a single global object `S`. Every mutation is followed by `save()`.
- **Rendering:** plain `innerHTML` string-building. Each tab has a `renderX()` function.
  `esc()` HTML-escapes all user text.
- **IDs over classes for hooks:** elements the JS reads/writes have `id`s.

---

## 4. The state object `S`

Defined by `defaults()`; upgraded by `migrate()`; loaded by `load()`; saved by `save()`.
Persisted as JSON under `localStorage['raceday_v1']`.

```javascript
{
  track:    { name, logo },          // identity; logo is a data: URL
  adminPin: '',                       // '' = Admin open to all; else 4–8 digits
  history:  [],                       // archived race days, newest first (max 60)
  license:  null,                     // { code, name, exp } once activated
  trialDays:[],                       // dates that used a free-trial race day
  licUse:   {},                       // { code: [dates] } packet usage
  classLib: [{ name, maxPill }],       // every class ever used (re-add menu)
  roster:   [{ id, name, num, trans? }], // persistent driver book
  classes:  [{ id, name, maxPill }],   // today's active classes
  settings: {
    maxHeat, maxBMain, maxFeature, transfers,
    gridStyle: 'double'|'single',
    heatFill:  'alternate'|'block',
    bmainMode: 'single'|'parallel'|'cascade',
    bmainCount,
    kioskReg:  false,                  // self-serve registration kiosk
    points:    { table: [10,8,6,…], beyond: 0 }
  },
  raceDay: {
    date,                              // 'YYYY-MM-DD'
    entries:  [{ driverId, classId, pill }],
    heatResults: { ['cls'+id]: { '<key>': finish } },
    pointsRace:  { [classId]: bool }   // does today count toward series
  },
  nextId: 100,                         // id counter for new drivers/classes
  sync:   { enabled: false, key: '' }  // multi-device sync (dormant unless configured)
}
```

**Result-key formats** inside `heatResults['cls'+id]`:
- Heat set 1: `h1_<heatIndex>_<driverId>`
- Heat set 2 (inverted): `h2_<heatIndex>_<driverId>`
- B-main: `bm_<driverId>` (single) or `bm<mainIndex>_<driverId>` (multi)
- Feature: `ft_<driverId>`
- Value is a finishing position (`1..N`) or `'DNF'` / `'DNS'` / `'DQ'`.

---

## 5. Persistence

- `const KEY = 'raceday_v1'`
- `load()` — reads `localStorage[KEY]`, `JSON.parse`, validates `raceDay && classes`,
  runs `migrate()`. Falls back to `defaults()`.
- `save()` — `localStorage.setItem(KEY, JSON.stringify(S))`, then `syncPush()` if sync is on.
- `migrate(s)` — adds any fields missing from older saves (this is how new features stay
  backward-compatible). **Add a line here whenever you add a field to `defaults()`.**
- **Cross-tab sync (always on):** a `window.addEventListener('storage', …)` reloads `S`
  and re-renders when another tab in the *same browser* writes the key. Multi-device sync
  (below) generalizes this across devices.
- **Backup round-trip:** `exportBackup()` downloads all of `S` as JSON;
  `importBackup()` validates + `migrate()`s + replaces `S`. This is also the bridge the
  timing importer uses.

---

## 6. Feature walkthrough (how the program works)

### 6.1 Sign-up & pill draw
- 3 steps (`showStep`): name+number (`#s1`) → pick classes (`#s2`, `.chip` toggles) →
  reveal (`#s3`). `cur = {name, num}` holds the in-progress driver.
- `suggest()` autocompletes from `S.roster`; returning drivers are matched by
  `findRosterMatch()` (case-insensitive name).
- `register()` validates (a class picked, license/trial OK via `canEnter()`, unique kart
  number per class, pills available), adds/updates the driver in `roster`, then for each
  class calls `drawPill()` and pushes `{driverId, classId, pill}` to `raceDay.entries`.
- `drawPill(clsId)` picks a random unused pill in `1..maxPill` (`pillsUsed()` = taken set).
  **Lowest pill = pole.**
- `consumeTrialDay()` marks the date against the trial or packet (once per day).

### 6.2 Lineups / grid (`renderGrid`)
- `classRacers(clsId)` → entered drivers sorted by pill. `buildHeats(racers, maxHeat)`
  splits them: **alternate** fill (pills spread across heats — `i % n`) or **block** fill
  (`i / per`). Set 2 is each heat reversed (inverted start).
- `gridMarkup()` renders single- or double-file; `posText(pos)` → `{row, side}`
  (P1=Row1 Inside = pole, marked with a checkered tag). `discNum()` draws the kart number
  on a yellow plate, font shrinking for longer numbers.

### 6.3 Results (`renderResults` → `renderClassResults`)
- Per class: a points-race toggle, Set 1 & Set 2 heat-entry blocks (`heatEntryBlock` →
  `finSelect` dropdowns calling `saveResult`), a heat-totals standings table
  (`calcStandings`), B-main block(s), and the feature entry.
- `finPoints(v, heatSize)` scores low-wins; DNF/DNS/DQ map to `heatSize+1/+2/+3`.
- `featureData(clsId)` computes who's **locked** into the feature vs. who runs the
  **B-main(s)**, honoring `bmainMode`:
  - **single** — one B-main, top `transfers` advance, rest cut.
  - **parallel** — split into *k* mains, top `transfers` from each advance, nobody cut.
  - **cascade** — tiered mains, climbers move up tier by tier.
- `classComplete()` is true when all heat finishes are in; `featureFinish()` reads `ft_*`.

### 6.4 Points & series (`renderPoints`)
- `dayPoints(clsId)` awards today's feature finishers per `settings.points.table`
  (everyone else gets `beyond`). `seriesStandings(className)` aggregates `history` + today
  by class name (case-insensitive), summing points and counting days. `savePoints()` edits
  the table from comma/space-separated input.

### 6.5 History & CSV
- Starting a new day calls `archiveDay()` → `buildSnapshot()` (an immutable per-class
  record: standings, feature, feature finish, points) prepended to `history` (max 60).
- Exports via `downloadFile()` + `csvCell()`/`csvRows()`: `snapCSV`/`histCSV`/
  `exportResultsCSV` (results), `exportEntriesCSV` (entries), `exportBackup` (full JSON).

### 6.6 Admin (`renderAdmin`)
- Track name/logo (`saveTrack`, `uploadLogo` scales to ≤256px PNG, ≤400KB), class
  management (add/reorder/delete, pill counts, re-add from `classLib`), race-format
  settings (`saveSett`), points table, quick-add, entry/roster lists, history, PIN,
  license, **sync card**, danger zone (new day / demo / erase).
- **PIN:** `adminOk()` gates the Admin tab; approval cached in `sessionStorage`.

### 6.7 License system
- Codes look like `NAME-EXP-CHECKSUM` (e.g. `RIVERSIDE-S2026-AB12CD`). `licHash()` is an
  FNV-1a hash; `licCheck(name, exp)` = first 6 chars of `hash(name|exp|LIC_SALT)`.
- `exp` token: `0`=forever, `SYYYY`=season (year), `Rn`=packet of n race days,
  `YYYYMM`=month (legacy). `licStatus()` derives plan/expiry; `canEnter()` enforces the
  3-day free trial or packet/season limits. Read-only stays available when expired.
- **`LIC_SALT = 'rd-grid-9f3k27xq-2026'` must match `raceday-codegen.html` exactly** —
  changing it invalidates every issued code.

### 6.8 TV display (`openTV`)
- Full-screen overlay, auto-rotating slides every `TV_SECS` (12s). `tvSlides()` builds
  one slide per heat (both sets) + B-mains + feature per class. Scales font to fit; splits
  >16 cars into two columns. Re-renders on data change (storage/sync). Controls:
  prev / lock / next / exit; Esc closes.

### 6.9 Usage telemetry (LIVE, anonymous)
- `sendUsage(event, extra)` fire-and-forget beacon to `TELEMETRY_URL` (a Google Apps
  Script). Sends only `{event, version, date, track, …}` — **no names/numbers/contacts.**
  - `registration` event: debounced 30s after sign-ups (`scheduleUsageBeacon`,
    `currentCounts` = per-class totals).
  - `crash` event: from `window.onerror` and `unhandledrejection` (message + line).
- Disabled if `TELEMETRY_URL` is blank.

### 6.10 Multi-device sync (STAGED — see FIREBASE-SYNC.md)
- Mirrors `SYNC_FIELDS` (race day split into date/entries/heatResults/pointsRace, plus
  classes/roster/settings/track) to a Firebase Realtime DB under `tracks/<syncKey>`, one
  JSON string per path. `save()` → debounced `syncPush()` writes only changed paths;
  `initSync()` listens and applies remote changes (with an echo guard). Role-locked
  stations (`localStorage.rd_role` + `ROLE_PAGES`), `?sync=&role=` join links, kiosk mode.
  **Dormant unless `FIREBASE_CONFIG` is filled in.**

---

## 7. CSS design system

CSS custom properties in `:root` drive a motorsports look:
`--asphalt #17181c` (dark), `--paper #f4f4f1`, `--plate #ffd449` (race-plate yellow),
`--flag-green`, `--pit-red`, fonts `--display 'Saira Condensed'` / `--body` system stack.
Key components: `.btn`/`.btn-primary`/`.btn-go`/`.btn-sm`/`.btn-danger`, `.card`, `.slbl`
(section label), `.chip`/`.chip.on`/`.chip.off`, `.disc` (number plate, `.sm`/`.big`/
`.pillc`), `.slot`/`.slot.pole` (grid cells), `.hb`/`.hh`/`.hr` (result blocks),
`.tab`/`.tab.on`, and the `tv-*` family for the display. Responsive tweaks under 560px.

---

## 8. How to rebuild from scratch

Build in this order; each step is testable on its own.

1. **Shell.** `index.html` with `<head>` (meta, fonts, `<style>`), a `.container`, the
   header (`#hdrLogo/#hdrBrand/#hdrTag`), `#mainNav` with 6 tabs, six `.page` divs, the
   TV overlay, and a `<script>` block.
2. **State core.** `KEY`, `today()`, `defaults()`, `migrate()`, `load()`, `save()`,
   `let S = load()`. Add the cross-tab `storage` listener.
3. **Helpers.** `esc`, `driverById`, `classById`, `classRacers`, `pillsUsed`,
   `drawPill`, `posText`, `downloadFile`, `csvCell`, `csvRows`.
4. **Navigation.** `nav(p)` + `render(p)` dispatch to per-tab renderers.
5. **Sign-up.** `#s1/#s2/#s3`, `showStep`, `suggest`, `findRosterMatch`, `step2`,
   `renderChips`, `register`, `drawPill`, `renderDone`, `resetReg`.
6. **Lineups.** `renderGrid`, `buildHeats`, `gridMarkup`, `discNum`, `setGridStyle`.
7. **Results.** `renderResults`, `renderClassResults`, `heatEntryBlock`, `finSelect`,
   `saveResult`, `calcStandings`, `finPoints`, `featureData` (3 modes), `featureFinish`,
   `classComplete`.
8. **Points.** `renderPoints`, `renderPointsInputs`, `savePoints`, `dayPoints`,
   `seriesStandings`, `seriesClassNames`, `isPointsRace`, `togglePointsRace`.
9. **Admin.** `renderAdmin` + sub-renderers (classes, roster, entries, quick-add,
   history, PIN, license), `saveSett`, track/logo, danger zone, `seedDemo`.
10. **History/CSV.** `archiveDay`, `buildSnapshot`, `renderHistory`, the CSV exporters,
    `exportBackup`/`importBackup`.
11. **License.** `LIC_SALT`, `licHash`, `licCheck`, `licStatus`, `canEnter`,
    `consumeTrialDay`, `activateLic`, `removeLic`, banners. (Mirror salt in the codegen.)
12. **TV.** `openTV`/`closeTV`, `tvSlides`, `tvRender`, `tvGridMarkup`, `tvPanelMarkup`,
    `tvTick`, controls.
13. **Telemetry (optional).** `APP_VERSION`, `TELEMETRY_URL`, `currentCounts`,
    `sendUsage`, `scheduleUsageBeacon`, crash hooks.
14. **Sync (optional).** `FIREBASE_CONFIG`, `SYNC_FIELDS`, `ROLE_PAGES`, `syncOn`,
    `deviceRole`, the `syncGet/syncGetIn/syncSet` helpers, `initSync`, `syncPush`,
    `syncPushFull`, `loadFirebase`, the admin sync card, `applyRole`, `handleUrlParams`.
15. **Init order (bottom of script):** `handleUrlParams(); renderHeader(); applyRole();
    renderRosterPick(); checkDayBanner(); renderLicBanner(); renderGrid(); initSync();`

**Companion tools (separate files):**
- `timing-import.html` — own HTML/CSS/JS. Reads a RaceDay backup JSON, parses a timing
  CSV (column auto-map + MotoSponder vendor detection), matches drivers by
  transponder→number→name, writes pills/results back into the backup, re-downloads it.
- `raceday-codegen.html` — owner-only. Same `LIC_SALT`/`licHash`/`licCheck` as the app so
  generated codes validate. Plus a localStorage sales/customer ledger. **Keep gitignored.**

---

## 9. Deployment

- Hosted on **GitHub Pages** from the public repo `Joshmill916/Raceday`, served at
  `https://joshmill916.github.io/Raceday/`. Merging to `main` auto-deploys (~1 min).
- Making the repo private on the free plan **disables Pages** — move hosting first
  (Cloudflare Pages / Netlify) if you ever go private. (See the chat history / SETUP.md.)
- HTTPS is required for the PWA service worker (Pages provides it); telemetry and sync
  work from any origin.

---

## 10. Verification

### Automated (run locally)
- **Syntax:** extract the `<script>` from `index.html` and `node --check` it.
- **Sync logic:** `/tmp/sync_full_test.js`-style harness — 35 scenarios, all passing:
  empty-room seed, late/mid-race join, registration-vs-scoring non-clobber, board clear,
  deleted result key, 3-device convergence, echo-loop prevention, concurrent same-field
  edits, nested-result round-trip, corrupt-cloud-data skip, "no private field syncs"
  guarantee, role gating, key normalization, dormant-mode off-switch, posText/drawPill.

### Manual browser pass (needed for DOM/Firebase — can't be automated headlessly here)
- [ ] Dormant check: with `FIREBASE_CONFIG = {}`, open DevTools Network — **zero**
      Firebase requests; sync card hidden; app works exactly as today.
- [ ] Two browsers, real Firebase config: register on one → TV lineups update on the
      other within ~1s.
- [ ] `?sync=KEY&role=scoring` link → nav shows only Lineups/Results/Points; Admin hidden.
- [ ] `role=tv` link → TV display auto-opens.
- [ ] Kiosk toggle on → a `register` device hides its menu bar.
- [ ] Offline: pull wifi mid-edit, restore → changes reconcile.
- [ ] Realtime DB console shows only `SYNC_FIELDS` paths — **no** `adminPin`, `license`,
      or `history`.
- [ ] Core app regression: sign up → pills draw → heats build → enter results →
      feature/B-main build → points tally → archive day → CSV exports open cleanly →
      backup/restore round-trips.
