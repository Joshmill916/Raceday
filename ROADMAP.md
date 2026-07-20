# RaceDay — Roadmap

> **History note (2026-07-08):** this file and the Phase 1 code were originally built on
> the never-merged `claude/driver-cards` branch (June 27) and silently fell out of the
> main line. Both were recovered: Phase 1 was ported onto the current app and Phase 2
> built on top of it the same day. The related **Driven companion app**
> (`driven/index.html`) has since shipped as a separate PWA — it grew out of this same
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

**Phase 3 — Payment.** ✅ *Shipped (2026-07-08) as premium codes via the Profiles app.*
Drivers buy a code from the app owner (bound to their profileId, offline-validated with
`PREM_SALT`), unlock premium in Profiles, publish their card, and RaceDay pulls it at
sign-up via the link code. Real checkout (Stripe/Square) remains a future option.
Original options considered: offline + admin
toggle, premium codes (like the license codegen), or real checkout (Stripe/Square — the
first thing that would need a backend).

---

## Profiles app — product roadmap (added 2026-07-08)

**Vision:** one racing identity that follows a driver to every RaceDay track — and the
engine that spreads RaceDay itself. Drivers carry their card, record, and rankings
between tracks; tracks adopt RaceDay partly because traveling Profiles drivers ask for
it. Profiles is the demand side of RaceDay's adoption flywheel.

**End state (once ~20+ tracks run RaceDay):** the social layer for grassroots racing —
**callouts** ("I'll be at Cridersville Saturday. Who thinks you can beat me?") that
auto-resolve from the track's timing data · cross-track rankings per class, region, and
**track surface** ("#3 on dirt ovals in Ohio") · rivalry records ("you vs. #10: 8–6") ·
race-night discovery ("3 tracks near you run your class; Route 9 races Friday") · an
opt-in inter-track series computed automatically from published results · every
driver's shareable broadcast card as grassroots marketing.

**Design principles the vision imposes today:**
1. **Results are published by the TRACK, never self-reported by the driver.** A
   leaderboard drivers can fake is worthless. RaceDay (keyed by track identity) is the
   only writer that counts for rankings and callout resolution; driver-side JSON import
   remains for personal history only.
2. **Class normalization from day one.** "Jr 80" and "Junior 80cc" must be joinable —
   a category/alias layer rides along with every published result. The track registry
   also carries **surface/type metadata** (dirt oval / asphalt sprint / indoor) so
   rankings can slice by track type.
3. **A paid identity must be recoverable.** No selling premium codes while the whole
   profile lives in one phone's localStorage.
4. **All social, no chat.** Much of the audience is kids; a one-person company can't
   moderate a free-text feed. Every social object is structured — a callout is
   driver + track + date + class + a preset taunt; responses are a tap ("🏁 I'm in");
   the published results do the talking. All the trash-talk energy, none of the
   moderation surface.

### Phases

**P0 — Profile backup & recovery.** *(do before selling premium codes)*
Export/import profile file + restore-from-published-card (the published card + results
already live in Firebase; a driver with their profileId or link code can rebuild).
Small, boring, protects paying customers.

**P1 — Close the results loop.** RaceDay-side "Share with Profiles" after archiving a
race day: publish each linked driver's results (`featureFinish` + points + class +
category) to Firebase under the track's identity. Profiles ingests automatically —
profiles grow every race night with zero effort. This is the data substrate for
everything after; build it track-published + category-tagged per the principles above.

**P2 — The share machine.** Card → image export (Instagram/story sizes), race-recap
cards ("P1 tonight at Route 9 🏁"), milestone badges (first win, 50th start, season
champ). Drivers promoting themselves = free acquisition for tracks and RaceDay.

**P3 — Discovery.** Opt-in public track registry (name, location, **surface/type**,
classes, next race night — published from RaceDay admin). Profiles shows "tracks near
you that run your class" and each track's next event. Puts traveling drivers in member
tracks' pits. ("Classes I've run" ships here too — computable from local history.)

**P4 — Callouts.** The social centerpiece: "I'll be at Cridersville Saturday — who
thinks you can beat me?" A callout = driver + track + date + class + preset taunt;
other drivers tap "🏁 I'm in"; when the track publishes results, the callout
**auto-resolves** — the settled card shows who actually won the fight, and the share
graphic is the app's growth engine in local racing Facebook groups. Needs P1 (results)
+ P3 (schedules). Structured objects only, per principle 4.

**P5 — Rankings & rivalries.** Cross-track rankings sliced by class, region, and
track surface ("#3 on dirt ovals in Ohio"); head-to-head records between drivers
who've met ("you vs. #10: 8–6"). First real scale pressure on Firebase (may need
aggregation — first backend code if so).

**P6 — The RaceDay Cup.** Opt-in inter-track series: shared class categories + a
points scheme, standings computed automatically. The moat: a traveling grassroots
series that exists because the software makes it free to run.

**Premium tier grows alongside:** sponsor logos, card themes, printable hero card,
stat deep-dives — sequenced opportunistically, funded by code sales.
