# RaceDay

**Registration & live starting lineups for grassroots racing.**

RaceDay runs a race night from sign-up to checkered flag: drivers register, draw
random pills for fair grids, and the app builds heats, B-mains, and features
automatically — then keeps a season-long points championship. It's a single web
page with no server: everything lives in one device's browser, so it works at
tracks with no wifi.

## What it does

- **Sign up** — drivers enter their name and vehicle number (returning drivers
  tap their name, no retyping), pick their classes, and draw a pill. Lowest pill
  starts up front.
- **Lineups** — every class is gridded by pill and split into heats, in single-
  or double-file. A full-screen **TV display** shows big rotating lineups for the
  crowd, and you can print or save a PDF grid sheet.
- **Results** — enter heat finishes and the B-main and feature lineups build
  themselves, with tags showing who's locked in and who has to race their way up.
- **Points** — a running championship by class, counting today's finishes live
  plus past race days from history.
- **Admin** — set up classes, race settings, track identity and logo, backups,
  and your license, all in one place (lockable with a PIN).

## Run it

RaceDay is a static site — open `index.html` in a browser, or host the repo root
on any static host (Netlify, Cloudflare Pages, GitHub Pages). HTTPS hosting is
recommended so the installable / offline mode can be enabled later.

## How it's run best

All data is saved in **one device's browser** — there's no cloud sync. Pick the
phone, tablet, or laptop that runs the night and use it all season; run sign-ups,
results, and the TV from that same device. When casting to a TV, mirror that
device — don't open the link on the TV itself, or you'll see a blank app.

Back up regularly from **Admin → Backup**: it downloads a file you can restore on
any device or keep as a safety net.

## More docs

- [`SETUP.md`](SETUP.md) — owner setup: hosting, plans, access codes, and TV.
- [`PWA-OFFLINE.md`](PWA-OFFLINE.md) — the staged installable / offline mode.
