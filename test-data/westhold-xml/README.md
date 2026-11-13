# Westhold Race Manager sample files

Sent by Westhold (2026-11-13), made in Race Manager's Demo mode. The racers are made-up names (Adam One ... Jeff Ten).

- `DEMO.xml` / `DEMO-Q.xml`: written to the `XMLExport` folder when a session is stopped (race / qualifying).
- `racedata - *.xml`: snapshots of the live `racedata.xml` (lap 5, checkered, stopped; qualifying running and stopped).
  RaceDay only imports a live file once its `<FLAG>` is `Stop`.
- `DEMO.CSV`: the assignment (lineup) file Race Manager reads, with no header:
  `Transponder,Racer Number,Last Name,First Name,Misc,Backup Transponder,Qualify Time`
- `DEMO.DAT`: optional session settings, one per line (`Laps,5`, `Length`, `Duration` in minutes, `Breakout` in seconds).

Guard: `tests/v2/test-v2-westhold-xml.js`
