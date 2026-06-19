# RaceDay — MotoSponder test data

Test fixtures for the timing importer at
`https://joshmill916.github.io/Raceday/timing-import.html`.

They simulate a **MotoSponder** export for a race day with **4 classes** and let you
exercise every import path. One class (**Pro Stock**, 32 cars) is sized to produce
**two B-mains**.

| Class | Cars | Heats | B-mains |
|-------|-----:|------:|--------:|
| Pro Stock | 32 | 4 | **2** |
| Junior Sportsman | 16 | 2 | 0 (straight to feature) |
| Open Outlaw | 20 | 3 | 0 (fills feature exactly) |
| Vintage | 12 | 2 | 0 (straight to feature) |

Two B-mains only appear when the track's **B-main mode is "parallel"** — the included
backup already has that set. (Single mode = one B-main; cascade mode currently has a
bug, so avoid it.)

## Files

| File | Use it as | What it exercises |
|------|-----------|-------------------|
| `test-track-backup.json` | **Load first** in the importer | The 4 classes + parallel B-main settings. Empty roster/race day. |
| `01-qualifying-all.csv` | Qualifying → grid | Ranks by **Best Tm** time (`hh:mm:ss.mmm`), multi-class via the class column, auto-creates all 80 drivers. |
| `02-heats-set1-all.csv` | Heat results · **Set 1** | Within-heat finishes; matches the drivers created at qualifying. |
| `03-heats-set2-all.csv` | Heat results · **Set 2** | Set 2 finishes; standings + B-mains fill in by performance. |
| `04-feature-all.csv` | Feature → points | Feature finishing order for all 4 classes, including a `DNF` and a `DQ` in Pro Stock. |
| `prostock-qualifying.csv` | Qualifying → grid (single class) | The 32-car class on its own — quickest way to see two B-mains. |
| `edge-cases.csv` | Qualifying or Feature | Odd inputs (see below). |

## Recommended test flow (end to end)

1. Open the importer and **Load** `test-track-backup.json`.
2. **Qualifying → grid**, choose **"use the class column"**, load `01-qualifying-all.csv`,
   preview, **Apply & download backup**.
   - Restore that file in RaceDay (**Admin → Restore from backup**) → grids are set
     fastest-first; **Pro Stock** shows two projected B-mains on the Lineups tab.
3. Back in the importer, **Load** the backup you just downloaded. Choose **Heat results**,
   **Set 1**, load `02-heats-set1-all.csv`, Apply & download. Repeat for **Set 2** with
   `03-heats-set2-all.csv`.
   - Restore → heat standings complete; B-mains/feature build from results.
4. **Load** the latest backup, choose **Feature → points**, load `04-feature-all.csv`,
   Apply & download.
   - Restore → the Points tab tallies the series.

Each step round-trips through a downloaded backup, so you can stop, inspect, and re-load
at any point. Because drivers are matched by **transponder → number → name**, the same
people carry through every file (no duplicates).

## Single-class / quick test

Load `test-track-backup.json`, then import `prostock-qualifying.csv` as **Qualifying** with
a single target class of **Pro Stock**. Restore → the Lineups/Results tabs show the two
B-mains immediately.

## edge-cases.csv — what each row checks

| Rows | Expectation |
|------|-------------|
| Two `#50` in Pro Stock | Importer keeps the first, flags the duplicate number. |
| `Nonexistent Class` | Row is reported/skipped (class isn't in the backup). |
| `Brand New` (trans 99992) | New transponder → auto-created when imported as a feature. |
| `DNF` / `DNS` / `DQ` | Parsed as status tokens, not finishing positions. |
| `1:02.500` and `31.875` | The `mm:ss.mmm` and raw-seconds branches of the time parser. |

## Regenerating

`python3 generate.py` (stdlib only, deterministic) rewrites every file. Edit the
`CLASSES` list at the top to change sizes/names; the script asserts that Pro Stock still
yields exactly two B-mains and that IDs stay unique.
