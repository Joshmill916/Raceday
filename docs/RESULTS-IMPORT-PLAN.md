# Importing results from other race apps — plan

*Researched Oct 12, 2026. Nothing is built yet; this is the recommendation to decide on.*

## The short version

Let a driver bring results from other apps into **Driven**, and label each one with the app it came
from ("from MYLAPS Speedhive", "from MyRacePass", …). Keep it a **side feature**:

- Results posted by a RaceDay track stay the headline: "verified by the track", the public page
  stats, and the season points.
- Imported results show in their own smaller section, "Other results", with the app's name on each.
  They never get the verified badge.
- On the track side, RaceDay already works alongside timing systems. The timing import accepts
  CSV files from MYLAPS Orbits, Westhold and MotoSponder, so a track keeps its transponders and
  RaceDay runs the night around them. Nothing new is needed there for this.

## What each app allows (what I found)

| App | Can we pull results automatically? | Practical way in |
|---|---|---|
| **MYLAPS Speedhive** (most club racing and karting timing) | No documented public API. A community tool uses the same API the Speedhive website uses, and it needs a token. Not something to build on without MYLAPS saying yes. | The driver downloads the CSV, or pastes a results link (phase 2, only if MYLAPS gives access) |
| **MyRacePass** (dirt oval / short track) | Read-only API, but only for **MRP Plus** promoters and drivers using **their own key** (sometimes paid). | The driver enters it by hand, or uses their own MRP key (phase 3) |
| **Race Monitor** | Live timing only; no public results API found. | Manual entry |
| **Orbits / Westhold / MotoSponder / Black Box Timing** | They export CSV | CSV upload (RaceDay already reads these) |
| **Anything else** (paper sheets, Facebook posts, PDFs) | — | Manual entry, choosing "Other" for the app |

**Bottom line:** none of the big apps offer an open, free results API we can rely on. Things that
always work: **CSV upload** and **manual entry**. Automatic link import is a maybe-later, and only
with the vendor's OK.

## Recommended build

### Phase 1 — "Add a result from another app" (Driven, about a day of work)

- In Driven, a new **Add result** button under Results. It opens a small form:
  - **App:** Speedhive · MyRacePass · Race Monitor · Orbits/Westhold CSV · Other
  - **Date** and **track name** (typed in; we don't keep a list of tracks)
  - **Class**
  - **Finish**, plus optional **starters**
  - **Heat or feature**
  - **Link** to the results page (optional, so fans can check it)
- **Upload CSV**: reuse RaceDay's timing parser, which already recognizes Orbits, Westhold and
  MotoSponder columns. Driven finds the driver's row by name or kart number. The driver confirms
  it, and it's added.
- Each result is saved with `source: 'import'`, `sourceApp: 'speedhive'` (etc.), the optional
  `sourceUrl`, and `importedAt`. Duplicates are caught the same way as today (track + date +
  class).
- What the driver sees (**decided Oct 15**):
  - Imported results are kept **completely separate**: they never count toward career stats, wins,
    or points, which come only from RaceDay tracks.
  - They appear only if the driver adds them, in their own "Other results" list. Each result is
    labeled with its app ("from Speedhive").
  - Verified (RaceDay) results keep the "verified by the track" badge.

### Phase 2 — Speedhive link import (parked — not contacting MYLAPS for now)

- Would need MYLAPS to agree, through API access or written permission. Speedhive is the one most worth it,
  because so many karting and club tracks use it.
- If they say yes: the driver pastes a Speedhive results link, a small Cloud Function fetches the
  session and finds the driver, and the result arrives labeled "from Speedhive" with the link.
  It runs on the server because a browser page can't read another site's data directly.
- If they say no: phase 1's CSV upload already covers Speedhive (Speedhive results download as
  CSV).

### Phase 3 — MyRacePass (optional)

- The driver pastes their own MRP API key in Driven Settings and we pull *their* results with it.
  This only helps MRP Plus users, so treat it as low priority.

## Public page (decided Oct 15)

- **Free:** imported results stay in the driver's own app and never appear on their card or public
  page.
- **Pro:** the driver can choose to show them on the public page, in a separate "Other results"
  list below the verified stats. Each one is labeled with its app and is never mixed into the
  verified numbers. This is one more reason to upgrade.
- Before the code ships, the Firebase rules must be updated to allow the new card field (needs
  Josh's OK to deploy). Cards reject any new field until the rules allow it.

## How it stays "not the focus"

- The marketing doesn't change: RaceDay runs race night, and Driven is your record verified by the
  track.
- Import is mentioned once in the FAQ: "Racing somewhere that doesn't use RaceDay yet? Add those
  results too — they're labeled with the app they came from."
- Possible bonus: an import labeled "from MyRacePass at [a track]" shows us which tracks our drivers
  race at that aren't on RaceDay yet. Those are good outreach leads. This is internal only and is
  never shown publicly with track names.

## Decisions (Oct 15)

1. Phase 1: **yes**.
2. Email MYLAPS: **no**, not for now.
3. Imported results: **kept separate**. They never count in totals, show up only if the driver
   adds them, and appear on the card or public page **only for Pro**.

## Next idea: different cards for different kinds of racing

Josh asked: a driver who races karts *and* cars (or different types of cars) — different cards,
or separate accounts?

**Recommendation: one account, with a "ride" for each kind of racing. Not separate accounts.**

| | One account, several rides (recommended) | Separate accounts |
|---|---|---|
| Sign-in | One | One per account; easy to lose track of |
| Pro | Pays once and covers every ride | Pays again for each account |
| Number, colors, photo, sponsors | Each ride has its own (kart #18, late model #7) | Each account has its own |
| Stats | Kept apart per ride, so kart wins don't mix with car wins | Apart, but with no single view of everything |
| Public page | One link, with a tab for each ride; each ride can also have its own link and QR | Several unrelated links |
| At the track | The driver shows that ride's QR code, so the track links the right one | Same |

How it would work:

- **Free:** 1 ride. **Pro:** up to 3 rides. That gives drivers another reason to upgrade.
- Each ride keeps its own number, classes, colors, photo, header, sponsors, QR code and short code.
  Name, hometown and bio are shared, and the driver can override them per ride.
- Results stay with the ride they were raced under. Results from RaceDay go to whichever ride's QR
  code or link code the driver used at sign-up.
- An existing profile simply becomes ride #1, so nothing changes for anyone today.
- **Smaller first step:** before building full rides, the stats on the card could be split by
  class (the app already groups results by class), with a number for each class. That covers
  "same me, different classes" cheaply. Full rides are for different colors, sponsors or a
  separate public page.

Not decided yet; this needs Josh's go-ahead before any work starts. Build it **after** phase 1, so
imported results can be assigned to a ride from the start.

## Sources

- MyRacePass API (Plus plans, key required): https://www.myracepass.com/developers/api
- MyRacePass results import formats (Orbits CSV, Race Manager CSV, Speednet TXT):
  https://support.myracepass.com (Results import articles)
- Community Speedhive client (token-based, unofficial): https://pypi.org/project/speedhive-tools/
- Black Box Timing CSV export: https://docs.blackboxtiming.com/software/importexport/exporttootherosoftware
- RaceDay's existing timing import: `timing-import.html` and RaceDay v2 "Import from timing"
