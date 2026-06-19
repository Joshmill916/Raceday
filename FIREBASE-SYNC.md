# Multi-device sync

Turns RaceDay from a single-device app into a **live multi-station setup for one
track**: a registration tablet, a scoring tower, a TV/cast screen, and remote
viewers all see the same race day update in real time.

**Status: live on `main`, off by default.** `FIREBASE_CONFIG` is filled in with the
project's Realtime Database, but sync stays fully off for every track until someone
turns it on in **Admin → Multi-device sync → Start sync** (`syncOn()` also requires
`S.sync.enabled`, which defaults to `false`). Until then no network calls happen, the
Firebase SDK isn't even loaded, and the app behaves exactly like the single-device
version — so existing tracks see no change.

## What it does

- **Live shared state** across devices for one track, via a tiny free Google Firebase
  Realtime Database. One device's change appears on the others within ~1 second.
- **Role-locked stations** so each device only shows its job (and can't fat-finger
  settings):

  | Role | Sees | Can change |
  |------|------|------------|
  | `admin` (default) | Everything — the full app | Everything |
  | `register` | Sign-up only | Roster + entries |
  | `scoring` | Lineups + Results + Points | Results |
  | `tv` | Auto-opens the TV display | Nothing (read-only) |

- **Self-serve kiosk mode** (admin toggle): a `register` device hides its menu so
  racers only see the sign-up flow.

## What syncs vs. what stays private

**Syncs to the cloud** (so every device matches): today's race day (entries, heat
results, points flags, date), classes, the driver book (roster), settings, and track
name/logo. Stored as one JSON string per path so the registration device and scoring
tower never overwrite each other.

**Never leaves the device:** admin PIN, license code + salt, free-trial counts,
packet usage, and race-day history. These are not in `SYNC_FIELDS`.

## How to activate (the "bigger update")

### 1. Create the Firebase project (one-time, free)
1. **firebase.google.com** → *Add project* → name it "RaceDay" → free **Spark** plan
2. Left menu → **Build → Realtime Database** → *Create database* → start in **locked mode**
3. Open the **Rules** tab and paste, then *Publish*:
   ```json
   {
     "rules": {
       "tracks": {
         "$key": { ".read": true, ".write": true }
       }
     }
   }
   ```
   (Path-as-password: a track's data is reachable only if you know its sync code —
   the same deterrent-level security as the license system. Good enough for race
   lineups; not for secrets.)
4. Project **settings** (gear icon) → *Your apps* → **Web app** (`</>`) → register →
   copy the `firebaseConfig` object it shows you.

### 2. Wire it into the app
Paste that object into `index.html`:
```javascript
const FIREBASE_CONFIG = {
  apiKey: "…", authDomain: "…", databaseURL: "…",
  projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…"
};
```
Commit + push. GitHub Pages auto-deploys. The Firebase SDK is loaded lazily from a
CDN only when sync is active, so the dormant build stays zero-weight.

### 3. Use it at a track
1. On the main device: **Admin → Multi-device sync → Start sync for this track** →
   choose a sync code (defaults to the license name).
2. Copy the **Registration / Scoring tower / TV display** links and send each to the
   matching device. Opening a link like `…/?sync=RIVERSIDE&role=scoring` auto-joins
   and locks that device to its role.
3. (Or, on another device: **Join with a sync code** and set its role manually.)

## Known limitations / things to watch

- **Needs internet at the track.** Firebase queues writes during a brief drop and
  re-syncs on reconnect, but a long outage means stations won't see each other until
  the connection returns.
- **Last-write-wins per path.** Two devices editing the *same* field within the same
  second: the later write wins. Stations normally write different paths (registration
  → entries, tower → results), so this rarely bites.
- **Free-tier ceilings** (Spark): 100 simultaneous connections, 1 GB stored, 10 GB/mo
  download. Comfortable for many tracks; revisit if you scale to dozens of busy venues.
- **Names are in the cloud.** Driver names + kart numbers live in your Firebase
  project (they have to — the TV shows them). No contact or payment data is collected
  by the app, so none of that is exposed.

## Test status

The sync **logic** is covered by an automated harness (35 scenarios, all passing):
empty-room seeding, late/​mid-race joiners, registration-vs-scoring non-clobbering,
board clears, deleted result keys, three-device convergence, echo-loop prevention,
concurrent same-field edits, nested-result round-trips, corrupt-cloud-data handling,
the "no private field can sync" guarantee, and role gating.

Still needs a **manual browser pass** (can't be automated here — needs a real browser
+ Firebase): see the checklist in `ARCHITECTURE.md → Verification`.
