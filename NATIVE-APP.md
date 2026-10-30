# RaceDay as an iPhone + Android app

_Written 2026-10-30. Store rules and prices change, so re-check the starred (★) items before you rely on them._

## Recommendation

**Wrap the existing web app with Capacitor. Don't rewrite it.** RaceDay is about 7,250 lines in
one HTML file, plus Firebase sync, roles, points and staff locks, all backed by 27 test
suites. A React Native, Flutter or Swift/Kotlin rewrite would mean rebuilding and re-testing
all of that, which would take months. Capacitor runs the same `raceday/index.html` in a native
shell, adds native features where they help, and lets one code base ship to the web, iPhone
and Android.

Keep the **website as the main product**. The apps are an extra way in that gives you store
presence, push notifications, the camera and storage that doesn't get wiped. The scaffold is in `native/`
(see `native/README.md`).

## Compatibility check (what happens to each web feature inside the app)

| Feature | In the native app | Status |
|---|---|---|
| All race logic, rendering, roles, points | Same code, works as-is | ✅ |
| Saved data (`localStorage` `raceday_v1`) | Works and lasts longer: no Safari 7-day wipe of site data | ✅ (but see *Moving data*) |
| Firebase live sync + anonymous staff sign-in | Should work. Loaded from gstatic CDN, which sync needs anyway | ⚠️ Test on a real iPhone; check API-key referrer limits |
| Station links / spectator QR / QR poster | Would have pointed at `capacitor://localhost` | ✅ **Fixed:** `appBaseUrl()` |
| Opening `?sync=&role=` links | Needs Universal Links / App Links | ✅ Code done, ⚠️ site files + Xcode step left |
| Service worker / offline | Not needed: files ship inside the app | ✅ Turned off in native |
| Usage analytics | Would have been dropped (`devHost()` reads "localhost" as a dev copy) | ✅ **Fixed** |
| Site links (`/?home=1`, `/raceday2/`) | Would have broken | ✅ Open the website |
| **Backup download, CSV export** (`<a download>`) | Doesn't save on iOS | ❌ **Must fix:** Filesystem + Share plugins |
| **Print** (QR poster, lineup sheets) | `window.open('')` + `document.write` opens nothing | ❌ **Must fix:** iframe print or plugin |
| CSV / backup import (`<input type=file>`) | Works (Files app picker) | ✅ |
| Copy to clipboard | Works | ✅ |
| TV mode fullscreen | No `requestFullscreen` on iPhone | ⚠️ Fine: TV mode belongs on a laptop/TV browser |
| Google Fonts | First launch with no internet uses the system font | ⚠️ Optional: bundle the font |
| License **Buy** buttons (Stripe Payment Links) | Opens fine, but store rules apply | ⚠️ See *Payments* |
| http→https "Move this track" banner | Doesn't run in native (origin check) | ✅ |
| Driven (`driven/`) | Separate app; same recipe later, under its own app id | ⏸ Not wrapped yet |

## Pros

- **App Store / Google Play listing.** Tracks and promoters trust a store app more, and some will search the store first.
- **Easier install.** On iPhone, "Add to Home Screen" is buried in the Share menu, so staff miss it. "Download RaceDay" is easy.
- **Data that lasts.** Safari can wipe a website's saved data after 7 days of no use. That's real risk for a track
  between seasons when RaceDay keeps the whole night in `localStorage`. App storage isn't subject to that rule.
- **Native features worth building:** push notifications ("Heat 3 lineup posted", "Results are up"), camera
  QR scanning (the `RDPROFILE:` payload is already reserved for this), keep-screen-awake for scoring/TV
  stations, haptics, the native share sheet, and later Bluetooth timing hardware.
- **One code base.** Every fix to `raceday/index.html` still ships to all three.

## Cons

- **Updates aren't instant.** The web updates the moment you push. Apps need a rebuild and a store review
  (usually under 1–2 days), and some phones won't update for weeks. Devices on different versions can then share
  a sync room, so changes to synced data must stay backward-compatible (`migrate()` / `schemaVersion`
  helps). Mitigation: a live-update service (below) pushes web-code changes without review.
- **Saved data doesn't carry over.** The app's storage is separate from Safari's, so an existing track
  opening the app starts empty. They restore with a backup file or cloud restore, which both already
  exist. Write a one-screen "Moving to the app" guide.
- **Apple rejection risk (guideline 4.2, "minimum functionality").** Apple rejects apps that only wrap a website.
  Bundled files plus at least one or two native features (camera scan, push, file share) is the usual
  way through. Plan for push or camera scanning before the first submission.
- **Payments rules ★.** See below.
- **More paperwork:** a privacy policy URL (both stores require one, and I didn't find one on the site), Apple's
  privacy labels, Google's Data safety form, screenshots, a support URL, and a demo login for the reviewer
  (`?demo=` mode is perfect for this).
- **Yearly upkeep.** Apple requires building with the newest Xcode each spring. Google requires a recent Android
  target each year. Budget a few hours a year.

## Payments ★

RaceDay licenses are bought through Stripe Payment Links, and the app then accepts a code.
- **Safest option:** in the native build, hide the Buy buttons and keep code entry. Tracks buy on the website.
  Stores generally allow this "bought elsewhere, unlock here" pattern. You pay **0% commission**.
- **US iPhone:** since an April 2025 court order, US apps may link out to web checkout. Apple can't charge a fee
  on that right now, but in Aug 2026 it asked the court to approve a 15% fee. That isn't decided.
- **Apple / Google in-app purchase:** 15% under each store's small-business rate. Only worth it if store
  checkout boosts sales.
- **Driven Pro** (a consumer subscription) is under much more store-payment pressure than a B2B track license.
  That's one more reason to wrap RaceDay first.

## Cost breakdown

### Required

| Item | Cost |
|---|---|
| Apple Developer Program | **$99 / year** |
| Google Play developer account | **$25 one-time** |
| D-U-N-S number (needed for an *organization* account) | Free (takes days to weeks) |
| **Year-1 minimum, if you already have a Mac and phones** | **≈ $124** |

**Account type matters on Google ★.** A *personal* Play account (created after Nov 2023) must run a
closed test with **12 testers for 14 days** before it can publish. An *organization* account (with a D-U-N-S
number) skips that rule and shows "Victory RaceDay" as the seller. Apple works the same way for the seller
name. **Recommendation: organization accounts on both.**

### Only if you don't already have them

| Item | Cost |
|---|---|
| Mac to build the iPhone app | Mac mini ≈ $600 new / ≈ $300–400 used, **or** cloud build (Codemagic or GitHub Actions macOS have free tiers, then pay per minute) |
| Test iPhone | ≈ $150–300 used (any iPhone on a current iOS) |
| Test Android phone | ≈ $100–150 |

### Optional, ongoing

| Item | Cost |
|---|---|
| Live updates without store review (e.g. Capgo) | ≈ $10–20 / month |
| Push notifications (Firebase Cloud Messaging) | Free |
| Store commission | 0% if licenses stay on the web; 15% if you use in-app purchase |

### Build time

Estimates for the work in each phase below. If you hire a freelancer instead, common rates are about
$75–150/hour. A full native rewrite is commonly quoted at $40k–150k+, which is why it isn't recommended here.

| Phase | Work | Rough effort | If hired out |
|---|---|---|---|
| 1. Shell ✅ | Capacitor project, link/QR/analytics/SW fixes, deep-link code, test | Done on this branch | — |
| 2. Must-fixes | Backup/CSV via Share sheet, printing, hide Buy buttons, icons/splash, real-device Firebase test | 3–5 days | $2k–5k |
| 3. Native value | Push notifications, camera QR scan, keep-awake | 1–2 weeks | $4k–10k |
| 4. Store launch | Accounts, privacy policy page, screenshots, store listings, review back-and-forth | 2–4 days + review wait | $1k–3k |

## Phase plan

1. **Now:** review this branch. The web app behaves exactly as before (all suites pass, plus the new
   `tests/test-native-shell.js`).
2. Open the developer accounts early. D-U-N-S and Apple's organization checks can take weeks.
3. Do Phase 2 on a feature branch. Test on a real iPhone and a real Android phone at a practice night.
4. Add push or camera scan (Phase 3), then submit to both stores.
5. Later: wrap Driven the same way (`com.victoryraceday.driven`), once its Pro payments plan is settled.
