# RaceDay

**Race-night software for grassroots tracks: sign-up, lineups, results and season points from one screen.**

Live at **[victoryraceday.com](https://victoryraceday.com)**, built by Victory Promotions (Fort Wayne, IN).

RaceDay runs a race night from sign-up to checkered flag. Drivers register and draw pills, the app builds heats, B-mains and features, and it keeps a season-long points championship. It's a static web app with no server to run: everything works offline on the sign-up device, so bad track Wi-Fi doesn't stop the night.

## What's in this repo

| Path | What it is |
|---|---|
| `index.html` | Marketing homepage. Returning app devices are redirected straight to the app. |
| `raceday2/` | **The current RaceDay app** (what the site links to, and where `?demo=1` runs the live demo). |
| `raceday/` | The original app, still served to devices that set up on it. |
| `driven/` | **Driven**, the driver-profile companion app: one profile that follows a driver to every RaceDay track. |
| `timing-import.html` | Stand-alone timing CSV importer (MotoSponder, MYLAPS Orbits, Westhold, any CSV). |
| `pricing.html`, `faq.html`, `field-manual.html`, `guides/` | Public site pages. |
| `tests/` | Playwright suites for both apps (see `tests/README.md`). |

## What the app does

- **Sign-up:** returning drivers tap their name and their number and classes come with them. Pills are drawn on the spot.
- **Lineups:** grids built from the pill draw (single or double file, set 2 inverted), plus a TV display that cycles every class and a printable grid sheet.
- **Results:** tap order, number pad, dropdowns, or a **timing CSV import**. Standings, B-mains and the feature lineup build themselves.
- **Points:** season championship by class, with standard, F1-style or linear scales and a "fix season points" tool for backfilling nights.
- **Fans:** a QR code for live lineups and driver cards, free with no app to install.
- **Multi-device sync (optional):** registration, scoring and TV stations stay in step through Firebase. It's off by default, and a single device works on its own.
- **Admin:** classes, race format, track identity and logo, PIN lock, license, backups and cloud backup.

## Running it

It's a static site with no build step. Serve the repo root with any static server (`python3 -m http.server`) and open `/raceday2/`. Production is GitHub Pages on the `main` branch, behind the `CNAME` domain.

Data lives in the device's browser. Back up from **Admin → Backup**, or turn on cloud backup.

## Docs

- [`CLAUDE.md`](CLAUDE.md): working notes and constraints for this codebase (read first)
- [`ARCHITECTURE.md`](ARCHITECTURE.md): technical reference (data model, sync, roles, points)
- [`SETUP.md`](SETUP.md): owner setup (hosting, plans, access codes, TV)
- [`INSTALL-GUIDE.md`](INSTALL-GUIDE.md): install and setup guide for tracks
- [`FIREBASE-SYNC.md`](FIREBASE-SYNC.md), [`PWA-OFFLINE.md`](PWA-OFFLINE.md): sync and offline mode
- [`ROADMAP.md`](ROADMAP.md), [`BACKLOG.md`](BACKLOG.md): what's next
