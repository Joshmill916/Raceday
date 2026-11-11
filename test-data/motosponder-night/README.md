# A real MotoSponder night, anonymized

These are the practice, heat and main files from one real race night's MotoSponder export, kept exactly as
MotoSponder wrote them (title lines, Windows line endings, `DIV 1` / `DIV 2` heat groups, the
`Pos,Class,Number,Rider` heat layout with names as `Last- First`, and the `Pos,Number,First,Last,Make`
results layout with the class only in the file name), except that **every driver's name has been
replaced with a made-up one** and the event is renamed "Sample night".

What makes it a hard test:
- 10 classes, 57 heat finishes, 57 main finishes.
- **6 kart numbers are worn by 13 different drivers** in different classes, so matching has to stay
  inside the class.
- A class named `JR1 +60` (the `+60` is part of the name).
- `Results SMALL BLOCK OPEN DIV 1` is a heat result in the results layout.

Used by `tests/test-motosponder-night.js`.
