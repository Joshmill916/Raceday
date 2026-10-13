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
- What the driver sees:
  - In their own profile, imported results count toward **career** stats, and each one is labeled
    with its app.
  - Verified (RaceDay) results keep the "verified by the track" badge. Imported ones show
    "from Speedhive" in muted text.
  - A filter lets the driver show verified results only.

### Phase 2 — Speedhive link import (only if MYLAPS agrees)

- Email MYLAPS and ask for API access or written permission. Speedhive is the one most worth it,
  because so many karting and club tracks use it.
- If they say yes: the driver pastes a Speedhive results link, a small Cloud Function fetches the
  session and finds the driver, and the result arrives labeled "from Speedhive" with the link.
  It runs on the server because a browser page can't read another site's data directly.
- If they say no: phase 1's CSV upload already covers Speedhive (Speedhive results download as
  CSV).

### Phase 3 — MyRacePass (optional)

- The driver pastes their own MRP API key in Driven Settings and we pull *their* results with it.
  This only helps MRP Plus users, so treat it as low priority.

## Public page decision (needs your call)

Right now the public page (`/d/?CODE`) only shows results posted by RaceDay tracks. That's what
makes "nobody can type it in" true.

- **Recommended:** keep it that way. Imported results stay in the driver's own app. If you want
  them public later, show them in a separate "Other results (driver-added)" list below the verified
  stats, never mixed into them.
- Showing them publicly needs the Firebase rules updated first. Cards reject any new field until
  the rules allow it.

## How it stays "not the focus"

- The marketing doesn't change: RaceDay runs race night, and Driven is your record verified by the
  track.
- Import is mentioned once in the FAQ: "Racing somewhere that doesn't use RaceDay yet? Add those
  results too — they're labeled with the app they came from."
- Possible bonus: an import labeled "from MyRacePass at [a track]" shows us which tracks our drivers
  race at that aren't on RaceDay yet. Those are good outreach leads. This is internal only and is
  never shown publicly with track names.

## Decisions for Josh

1. Approve phase 1 (manual + CSV, labeled by app, kept off the public page)?
2. Should I draft the email to MYLAPS asking about Speedhive access? (I'd show it to you before
   sending.)
3. Should imported results count in the driver's own career totals, or only show as a separate
   list?

## Sources

- MyRacePass API (Plus plans, key required): https://www.myracepass.com/developers/api
- MyRacePass results import formats (Orbits CSV, Race Manager CSV, Speednet TXT):
  https://support.myracepass.com (Results import articles)
- Community Speedhive client (token-based, unofficial): https://pypi.org/project/speedhive-tools/
- Black Box Timing CSV export: https://docs.blackboxtiming.com/software/importexport/exporttootherosoftware
- RaceDay's existing timing import: `timing-import.html` and RaceDay v2 "Import from timing"
