# RaceDay — Owner Setup Guide

How to hand RaceDay to tracks for testing while keeping control of the app.

## 1. Make the repo private

GitHub → your `Raceday` repo → **Settings** → **General** → scroll to **Danger Zone** → **Change visibility** → Private.

This stops anyone from grabbing the code off GitHub. Note: free GitHub Pages
only works on public repos, so hosting moves to Netlify (below). Any old
public links stop working — that's the point.

## 2. Host it free on Netlify

1. Go to **app.netlify.com** and sign up with your GitHub account
2. **Add new site → Import an existing project → GitHub** → pick `Raceday`
3. Leave build command **empty**, publish directory **`/`** (the repo root) → **Deploy**
4. You get a link like `your-name-raceday.netlify.app` — that's what you send to tracks
5. Every time you merge a pull request, the site updates itself automatically

(Cloudflare Pages works the same way if you prefer it.)

## 3. Plans, the free trial, and access codes

Every track starts on a **free trial: 3 race days**. After that, new sign-ups
and entries stop — but lineups, results, history, and exports keep working, so
their data is never held hostage. A banner tells them to contact you. To unlock
a track you send them an **access code**, which they enter under **Admin →
License → Activate**.

### The four plans

| Plan | What it does | Code looks like |
|------|--------------|-----------------|
| **Season pass** | Valid Jan 1 – Dec 31 of one year, then re-locks until renewed | `RIVERSIDE-S2026-AB12CD` |
| **Race packet** | A bucket of race days (10 / 50 / 100, or any number), used as they go | `RIVERSIDE-R50-AB12CD` |
| **Forever** | Never expires | `RIVERSIDE-0-AB12CD` |
| **Month** *(legacy)* | Expires end of a month | `RIVERSIDE-202712-AB12CD` |

A **race day** is counted the first time an entry is added that day. The packet
banner warns at 3 days left and re-locks (read-only) when it hits 0. Season
passes re-lock the same way once the year ends. Codes you already issued keep
working.

### Generating codes (owner only)

Codes are **made in a separate private generator**, `raceday-codegen.html` —
**never** inside the app. The app can only *check* codes, it can't create them,
so it's safe to host publicly.

1. Open `raceday-codegen.html` on your own device (keep it off the public
   site/repo — it holds the secret salt)
2. Type the track name, pick the plan (season / packet / forever / month)
3. Tap **Generate** and text the code to the track

The generator and the app share the same secret salt, so the codes match. If
you ever change the salt, change it in **both** files.

**Topping up a packet:** re-entering the *same* code never resets the count
(by design — so a track can't reset their own packet). To give more days,
issue a **new** code: a bigger packet (`R100`), or a fresh one with a slightly
different name (e.g. `RIVERSIDE2`).

The trial, license, and packet count all live in the track's browser.
"Erase everything" in the app does **not** reset them.

Honest limit: this is a deterrent, not bank-vault security — someone technical
who digs through the page source could work around it. For real-world track
operators it does the job.

## 4. Putting lineups on a TV

In the app: **Lineups → 📺 TV display**. The screen goes full-screen dark with
huge rotating lineups (12 seconds per screen), in whatever grid style is
selected. Tap the screen for controls: previous / lock screen / next / exit.
**Lock** holds the current screen — handy while a heat is staging.

Ways to get it on the TV, cheapest first:

- **HDMI cable**: plug the laptop/tablet straight into the TV, open TV display.
- **Chromecast / built-in casting**: open the app in Chrome → menu (⋮) →
  **Cast…** → pick the TV → cast the tab, then open TV display.
- **AirPlay** (iPad/Mac with Apple TV or AirPlay TV): Screen Mirroring, then
  open TV display.

Important: the TV must mirror **the device that's running the race day**.
Opening the link on the TV's own browser would show an empty app — the data
lives on the sign-up device, not on a server.
