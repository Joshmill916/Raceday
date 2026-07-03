# RaceDay test suites (Playwright)

Run all (from repo root):
```bash
for t in tests/test-*.js; do node "$t" | tail -1; done
```

| Suite | Covers |
|---|---|
| `test-smoke.js` | Full race night: wizard → signup UI → lineups/TV → scoring → points → lock/override → archive → reload persistence |
| `test-viewer-results.js` | Spectator Results tab + "Results updated" toast |
| `test-qual-times.js` | Manual qualifying times + set-grid-from-times |
| `test-main-invert.js` | Feature/B-main starting-spot invert |

Each spins up its own HTTP server on a unique port and exits 1 on any failure.
Requires the Playwright Chromium at `/opt/pw-browsers/chromium` (Claude Code cloud env);
edit the `executablePath` if running elsewhere.

**Rule: run all four after any change to index.html.**
