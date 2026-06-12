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

## 3. How the trial and access codes work

- A track that opens your link gets a **free trial: 3 race days**. After that,
  new sign-ups and entries stop — but their lineups, results, history, and
  exports keep working, so their data is never held hostage. A banner tells
  them to contact you.
- To unlock a track, you generate an **access code**:
  1. Open the app → **Admin → License**
  2. Type your **owner passphrase** into the code box and tap **Activate** —
     this opens the hidden code generator (the passphrase was given to you
     privately; it is deliberately not written in this file)
  3. Enter the track's name, pick an expiry month (or leave blank = forever),
     tap **Generate**
  4. Text the code to the track — they enter it under **Admin → License → Activate**
- Codes look like `RIVERSIDE-202712-K7Q2` (expires end of Dec 2027) or
  `RIVERSIDE-0-AB12` (never expires). Expired codes re-lock the app to
  read-only the same way the trial does.
- The trial and license live in the track's browser. "Erase everything" in the
  app does **not** reset the trial or remove a license.

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
