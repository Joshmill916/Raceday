# RaceDay — Claude Code context

## What this is
Single-file PWA for race-night management (sign-up, lineups, results, points).
Entire app lives in `index.html` (~4,840 lines, ~308 KB). No build step, no
package.json, no framework. Hosted on GitHub Pages at
https://joshmill916.github.io/Raceday/

## CRITICAL CONSTRAINTS — never break these
- `raceday-codegen.html` is gitignored and **MUST NEVER be committed** — it holds
  the secret license salt. If it appears in `git status`, do not stage it.
- **Never push to `main` without explicit user approval.** Dev work goes on
  `claude/track-admin-improvements-d46hxg` (or a feature branch). Ask before merging.
- The owner's license code is `VICTORY-0-4K548V` (unlimited/forever). Never regenerate.

## Architecture
- All HTML, CSS, and JS live in one `<script>` block inside `index.html`
- State: global `S` object → `localStorage` key `raceday_v1`
- Save pattern: `S.field = value; save();`
  - `save()` writes localStorage then calls `syncPush()` if sync is on
  - Direct `localStorage.setItem()` calls that bypass `save()` have inline comments explaining why
- Firebase Realtime Database for optional multi-device sync (`SYNC_FIELDS` const controls what syncs)
- Service worker: `sw.js`, cache version in `CACHE` const — bump it when deploying cache-breaking changes

## Global namespace objects (added 2026-06-30 cleanup)
These replaced 15 scattered `let` vars — use these, not bare variable names:
- `TV`   — `{ on, idx, locked, timer, ctlTimer }` — TV display state
- `Sync` — `{ db, timer, applying, activating, connected }` — Firebase connection state
- `UI`   — `{ viewClsId, viewStage, ptsTab, ptsNames, histOpen, admOpen, pillChoiceCb, wizStep }`

## Key patterns
- **Render**: query container by ID → build HTML string → set `.innerHTML`
- **Modal helpers**: `showModal(id, display?)` / `hideModal(id)` — always use these, never raw `style.display`
- **Admin guard**: `if (!adminOk()) return;` at top of every admin-only function
- **Migration**: `migrate(s)` in `load()`; guarded by `s.schemaVersion`; new migrations check
  `s.schemaVersion < N`, apply the change, then set `s.schemaVersion = N` before `return s`
- **Naming**: `del*` for deletions, `toggle*` for boolean flips, `render*` for DOM builders, `show*`/`hide*` for visibility

## Syntax check (run after every edit to index.html)
```bash
python3 -c "
import re; html=open('index.html').read()
blocks=re.findall(r'<script[^>]*>(.*?)</script>',html,re.DOTALL)
open('/tmp/check.js','w').write(max(blocks,key=len))
" && node --check /tmp/check.js && echo 'SYNTAX OK'
```
Or just use `/syntax`.

## Files
| File | Purpose |
|---|---|
| `index.html` | **The entire app** — all features go here |
| `sw.js` | Service worker — bump `CACHE` const when deploying cache-breaking changes |
| `BACKLOG.md` | Parked items (operator hardening, deferred audit findings) |
| `ARCHITECTURE.md` | Full technical reference (data model, sync, roles, points system) |
| `timing-import.html` | Companion CSV timing import tool — separate file, don't modify during main app work |
| `raceday-codegen.html` | **GITIGNORED SECRET — never commit, never stage** |
| `test-data/` | CSV + JSON fixtures for manual testing |
| `tests/` | Playwright suites — see `tests/README.md` |

## Dev workflow
- Active dev branch: `claude/track-admin-improvements-d46hxg`
- Syntax check: `/syntax`
- After ANY index.html change: run all Playwright suites — `for t in tests/test-*.js; do node "$t" | tail -1; done`
- Commit + push current branch: `/push <message>`
- See branch state: `/check`
- Merge to main: only with explicit user approval — always ask first
- After merging to main: VERIFY the GitHub Pages build succeeds (a deploy can fail transiently) before telling the user it's live; bump `sw.js` CACHE on cache-breaking changes
