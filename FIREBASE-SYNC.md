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
3. Open the **Rules** tab and paste, then *Publish* (Step A below — see "Rules hardening"
   further down for the fuller Step B ruleset once sync write-gating ships):
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
   lineups; not for secrets. Superseded by Step B below.)
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

## Rules hardening (interim, zero-infrastructure)

The Step A rules above are wide open: anyone who knows (or guesses) a track's sync
code has full read+write to that track's live data, and the `profiles/*` paths used
by the Profiles companion app (driver card publishing) are open too. Real automatic
enforcement needs a backend (Cloud Functions or an external service) — deferred, not
part of this. Two things *are* achievable with rules + a small anonymous-auth code
change, no new infrastructure or billing:

### Step B1 — Profiles `.validate` caps (safe to publish any time)

Closes an unbounded-write storage/abuse risk: `profiles/<id>/card` and
`profiles_short/<code>` accept arbitrary shape/size today. This just adds size/shape
caps matching what the app itself already sends (`cardPayload()` in
`profiles/index.html`) and already trusts on read (`sanitizeProfileCard()` in
`index.html`) — no XSS/premium-forgery risk either way (that's handled by
sanitization on read), this is purely an abuse/storage-quota guard:

**Note:** the snippet below spells out explicit `.read`/`.write: true` for
`profiles`/`profiles_short` rather than relying on whatever broader rule currently
makes them work (not fully captured in this doc's history) — paste this as a
complete replacement of your rules tree, not a merge, so nothing is accidentally
left open elsewhere.

```json
{
  "rules": {
    "tracks": {
      "$key": { ".read": true, ".write": true }
    },
    "profiles": {
      "$id": {
        "card": {
          ".read": true,
          ".write": true,
          ".validate": "newData.hasChildren(['name','num','updatedAt'])",
          "name": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "num": { ".validate": "newData.isString() && newData.val().length <= 8" },
          "age": { ".validate": "newData.isString() && newData.val().length <= 8" },
          "hometown": { ".validate": "newData.isString() && newData.val().length <= 60" },
          "sponsors": { ".validate": "newData.isString() && newData.val().length <= 160" },
          "teamColor": { ".validate": "newData.isString() && newData.val().length <= 7" },
          "photo": { ".validate": "newData.isString() && newData.val().length <= 80000" },
          "premiumCode": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "updatedAt": { ".validate": "newData.isNumber()" },
          "$other": { ".validate": false }
        }
      }
    },
    "profiles_short": {
      "$code": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isString() && newData.val().matches(/^prof_[a-z0-9]{6,20}$/i)"
      }
    }
  }
}
```

Publish this any time — it only tightens what's already accepted; no app code
depends on it.

### Step B2 — Sync write-gating (publish AFTER the anonymous-auth code is live)

Adds Firebase Anonymous Authentication (an invisible, automatic client-side sign-in
— no login screen) and requires a track to be **manually granted** before any device
can write to it. Read access (needed for the public spectator QR view) only requires
being signed in, which happens automatically for every visitor — no UX change there.
This is a complete replacement of Step B1 above (it includes the same `profiles`/
`profiles_short` block unchanged, plus the new `tracks`/`trackGrants` rules):

```json
{
  "rules": {
    "tracks": {
      "$key": {
        ".read": "auth != null",
        ".write": "auth != null && root.child('trackGrants').child($key).child('granted').val() === true"
      }
    },
    "trackGrants": {
      ".read": false,
      ".write": false
    },
    "profiles": {
      "$id": {
        "card": {
          ".read": true,
          ".write": true,
          ".validate": "newData.hasChildren(['name','num','updatedAt'])",
          "name": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "num": { ".validate": "newData.isString() && newData.val().length <= 8" },
          "age": { ".validate": "newData.isString() && newData.val().length <= 8" },
          "hometown": { ".validate": "newData.isString() && newData.val().length <= 60" },
          "sponsors": { ".validate": "newData.isString() && newData.val().length <= 160" },
          "teamColor": { ".validate": "newData.isString() && newData.val().length <= 7" },
          "photo": { ".validate": "newData.isString() && newData.val().length <= 80000" },
          "premiumCode": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "updatedAt": { ".validate": "newData.isNumber()" },
          "$other": { ".validate": false }
        }
      }
    },
    "profiles_short": {
      "$code": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isString() && newData.val().matches(/^prof_[a-z0-9]{6,20}$/i)"
      }
    }
  }
}
```

**Before publishing, enable Anonymous sign-in** (one-time, separate from the rules
above): Firebase Console → **Build → Authentication** → **Sign-in method** tab →
enable **Anonymous**. Without this, `signInAnonymously()` calls fail and sync stops
working entirely for every device — do this BEFORE publishing the Step B2 rules.

**Do not publish this until the `index.html` anonymous-auth code has shipped and the
GitHub Pages deploy is confirmed live** — publishing these rules first would lock
every currently-active track out of writing (no device would be authenticated yet).

**Granting a track access** (manual, one-time per track, done by the app owner):
after verifying a track's license, open the Realtime Database **Data** tab in the
Firebase Console (this bypasses the rules above — it's your own Console/IAM access,
not a client SDK call) and add:
```
trackGrants
  └─ <TRACKCODE>
       ├─ granted: true
       ├─ licensedTo: "Track name" (optional, for your own records)
       └─ grantedAt: "2026-07-12" (optional)
```
`<TRACKCODE>` is the same sync code the track uses in **Admin → Multi-device sync**
(case-sensitive — matches `normKey()`'s uppercased, alphanumeric-only form). Every
device that track adds — registration, scoring, TV, admin — inherits write access
automatically once the track's key is granted; there's no per-device step.

**What this does and doesn't fix:** a brand-new or never-granted track can read
(spectator QR still works) but can't write — closing free-storage abuse and making
the license check a real gate on sync usage, not just a client-side nag. It does
**not** stop someone who already knows an *active, granted* track's code from
writing to it — that's the same "path-as-password" exposure as today, and needs the
deferred token/backend work to close fully.

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
