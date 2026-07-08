# RaceDay — Roadmap

> **History note (2026-07-08):** this file and the Phase 1 code were originally built on
> the never-merged `claude/driver-cards` branch (June 27) and silently fell out of the
> main line. Both were recovered: Phase 1 was ported onto the current app and Phase 2
> built on top of it the same day. The related **Profiles companion app**
> (`profiles/index.html`) has since shipped as a separate PWA — it grew out of this same
> vision (driver-owned cross-track identity) and isn't wired to RaceDay yet.

## Driver cards (spectator profiles + premium tier)

**Vision:** spectators tap a driver's name in the lineup and see a profile card —
record, kart number, age, hometown, sponsors. A paid premium tier lets a driver pay
to upgrade their card to a broadcast-style, NASCAR/Indy-looking animated graphic.

**Decisions made**
- **Stats:** auto-tallied from this track's saved race history (wins, top-5s, podiums,
  starts, season points), **plus** optional manual fields for career / other-track
  numbers a driver wants to add.
- **Payment:** deferred — design the cards first, decide the money mechanics later
  (offline+admin toggle vs. premium codes vs. real checkout). Nothing here needs a
  backend yet.
- **Photos / sponsor logos:** the one storage-heavy part (images sync through Firebase) —
  kept for the premium phase, where they're the headline feature and can be size-limited.

**Why it fits the app**
- Race history (`S.history`) already stores each archived day's `featureFinish[]` per
  class with each driver's `driverId` + finishing position → career stats compute for
  free, no data entry.
- The spectator viewer (read-only `viewer` role, synced lineups) is the natural home —
  tap a name → card.
- Driver profiles extend the existing driver book (`S.roster`), so they sync and persist
  like everything else.

### Phases

**Phase 1 — Basic card (no payment, no photos).** ✅ *Done (ported 2026-07-08).*
- Extend each driver with optional text profile: age, hometown, sponsors.
- `driverStats(driverId)` — tally starts / wins / podiums / top-5s / best finish /
  season points from history + today.
- Tap a name in any lineup → a card overlay with kart #, class, auto-stats, and the
  manual profile text. Read-only for spectators; admin can edit the profile inline.

**Phase 2 — Premium look.** ✅ *Done (2026-07-08).* The broadcast-style animated card: driver photo, team
colors, sponsor logos, sweep-in / shine animation. Pure CSS/SVG, no backend. Gated by a
simple `premium` flag on the driver.

**Phase 3 — Payment.** *Open.* Decide and wire how a driver unlocks premium: offline + admin
toggle, premium codes (like the license codegen), or real checkout (Stripe/Square — the
first thing that would need a backend).
