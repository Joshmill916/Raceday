# Offline / installable mode (staged — not live yet)

These files turn RaceDay into an **installable, offline-capable app** (a PWA): it can
be added to a phone/tablet/desktop home screen and launches with **no internet** —
which removes the race-day failure mode of "the track wifi was down and we couldn't
open it."

**Status: built but dormant.** None of this affects the live app yet. A service worker
that is never registered and a manifest that is never linked do nothing. Activation is
the two-line edit below, saved for a bigger update.

## Files

| File | Purpose |
|------|---------|
| `sw.js` | Service worker — caches the app shell so it loads offline. Network-first for pages (always latest when online), cache-first for icons. |
| `manifest.webmanifest` | App metadata for "Add to Home Screen" (name, colors, icons). |
| `icon-192.png`, `icon-512.png` | Home-screen / install icons (checkered-flag brand mark). |

## How to activate (the bigger update)

1. Add these two lines inside `<head>` in `index.html`:

   ```html
   <link rel="manifest" href="manifest.webmanifest">
   <script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('sw.js'))}</script>
   ```

2. Optionally add a theme color (nice on mobile):

   ```html
   <meta name="theme-color" content="#17181c">
   ```

3. Deploy. On the first online visit the app caches itself; after that it opens with no
   internet, and users get an "Install" / "Add to Home Screen" option.

## Notes

- **Requires HTTPS** (the Netlify URL works; `file://` does not — service workers are
  disabled on local files by browsers).
- **Updates still flow:** pages are fetched network-first, so an online device always
  loads the newest build. Bump `CACHE_VERSION` in `sw.js` when the shell changes to
  evict old caches.
- **Data is untouched:** the service worker only caches app *code*. Race-day data lives
  in `localStorage` and is never cached, cleared, or synced by this.
- To also make `timing-import.html` installable, give it its own `<link rel="manifest">`
  + registration, or rely on it being precached by `sw.js` (already listed in `SHELL`).
