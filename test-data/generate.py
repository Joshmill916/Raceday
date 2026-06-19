#!/usr/bin/env python3
"""
Generate MotoSponder-style test fixtures for RaceDay's timing importer.

Deterministic (seeded) so output is stable. Stdlib only.
Emits, into the same folder as this script:

  test-track-backup.json    starter backup: 4 classes, parallel B-main settings
  01-qualifying-all.csv      all classes, ranked by Best Tm time
  02-heats-set1-all.csv      within-heat finishes, set 1
  03-heats-set2-all.csv      within-heat finishes, set 2
  04-feature-all.csv         feature finishing order (incl. DNF/DQ)
  prostock-qualifying.csv    single-class file (Pro Stock, 32 cars)
  edge-cases.csv             dup #, unknown class, new transponder, DNF/DNS/DQ, time formats
  README.md                  how to run the tests

Mirrors the importer's expectations (timing-import.html):
  - MotoSponder columns: Pos, No, First, Last, Class, Transponder, Laps, Best Tm, Total Tm
  - vendor auto-detect fires on First+Last+Transponder (or a Best Tm/Total Tm column)
  - identity match priority transponder -> number -> name (same identities across files)
And the app's lineup math (index.html):
  - buildHeats: n = ceil(size / maxHeat), 'alternate' fill = i % n
  - parallel B-mains: with bmainCount=2 and defaults, any class > maxFeature(20) -> 2 B-mains
"""

import csv
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 2026
MAX_HEAT = 8
MAX_FEATURE = 20
MAX_BMAIN = 12
TRANSFERS = 2
BMAIN_COUNT = 2

# (name, id, size, base_seconds_per_lap) — Pro Stock is the showcase 32-car class.
CLASSES = [
    ("Pro Stock", 1, 32, 22.0),
    ("Junior Sportsman", 2, 16, 28.0),
    ("Open Outlaw", 3, 20, 19.5),
    ("Vintage", 4, 12, 31.0),
]

FIRST = ["Jake", "Emma", "Carlos", "Aisha", "Liam", "Sophia", "Noah", "Mia", "Ethan",
         "Olivia", "Mason", "Ava", "Lucas", "Isabella", "Logan", "Zoe", "Caleb", "Lily",
         "Owen", "Nora", "Wyatt", "Hazel", "Levi", "Ruby", "Gavin", "Stella", "Cole",
         "Piper", "Brody", "Quinn", "Tate", "Sadie", "Jax", "Reese", "Knox", "Wren",
         "Dean", "June", "Cruz", "Faye"]
LAST = ["Miller", "Chen", "Garcia", "Khan", "Reed", "Novak", "Boone", "Park", "Watts",
        "Diaz", "Frost", "Hale", "Cobb", "Suzuki", "Vance", "Lowe", "Pratt", "Ode",
        "Shaw", "Behr", "Tran", "Webb", "Kerr", "Maes", "Pope", "Roth", "Sax", "Iyer",
        "Dunn", "Voss", "Lund", "Cano", "Bird", "Fox", "Hunt", "Rios", "Gold", "Mott",
        "Beck", "Ash"]


def fmt_time(seconds):
    """Format total seconds as MotoSponder hh:mm:ss.mmm."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return "%02d:%02d:%06.3f" % (h, m, s)


def build_heats(size):
    """Return a list (len=size) giving each grid-rank's heat index. Mirrors buildHeats 'alternate'."""
    n = -(-size // MAX_HEAT)  # ceil
    return [(rank) % n for rank in range(size)], n


def main():
    rng = random.Random(SEED)
    drivers = []           # flat list of all drivers across classes
    next_trans = 30001
    by_class = {}          # class name -> list of driver dicts (in qualifying-rank order)

    for cname, cid, size, base in CLASSES:
        # unique kart numbers within the class
        nums = rng.sample(range(2, 200), size)
        # build drivers with a hidden "pace" so qualifying order is meaningful
        roster = []
        for i in range(size):
            fn = FIRST[(cid * 7 + i) % len(FIRST)]
            ln = LAST[(cid * 13 + i * 3) % len(LAST)]
            pace = base + i * 0.18 + rng.uniform(-0.05, 0.05)   # lower = faster
            roster.append({
                "first": fn, "last": ln, "name": fn + " " + ln,
                "num": str(nums[i]), "trans": str(next_trans),
                "cls": cname, "cid": cid, "pace": pace,
                "laps": 10,
            })
            next_trans += 1
        # qualifying rank = sorted by pace (fastest first); pill = rank (1-based)
        roster.sort(key=lambda d: d["pace"])
        for rank, d in enumerate(roster):
            d["qrank"] = rank            # 0-based
            d["best"] = d["pace"]        # best lap seconds
            d["total"] = d["pace"] * d["laps"] + rng.uniform(0.2, 0.8)
        by_class[cname] = roster
        drivers.extend(roster)

    # ---- heats: each driver gets a within-heat finish for set1 and set2 ----
    for cname, cid, size, base in CLASSES:
        roster = by_class[cname]
        heat_of, n = build_heats(size)
        heats = {h: [] for h in range(n)}
        for d in roster:
            h = heat_of[d["qrank"]]
            d["heat"] = h
            heats[h].append(d)
        for h, members in heats.items():
            # set 1 finish: order by pace + jitter; set 2: different jitter (so totals vary)
            s1 = sorted(members, key=lambda d: d["pace"] + rng.uniform(-0.6, 0.6))
            for pos, d in enumerate(s1, start=1):
                d["set1"] = pos
            s2 = sorted(members, key=lambda d: d["pace"] + rng.uniform(-0.6, 0.6))
            for pos, d in enumerate(s2, start=1):
                d["set2"] = pos

    # ---- feature field: standings by (set1+set2) total, top min(size, maxFeature) ----
    feature_rows = {}  # cname -> list of (driver, finish_value)
    for cname, cid, size, base in CLASSES:
        roster = by_class[cname]
        standings = sorted(roster, key=lambda d: (d["set1"] + d["set2"], d["qrank"]))
        field = standings[: min(size, MAX_FEATURE)]
        rows = []
        for pos, d in enumerate(field, start=1):
            rows.append([d, str(pos)])
        # sprinkle a DNF and a DQ into the Pro Stock feature (still scores everyone else)
        if cname == "Pro Stock" and len(rows) >= 3:
            rows[-1][1] = "DNF"
            rows[-2][1] = "DQ"
        feature_rows[cname] = rows

    # ===================== write files =====================
    def w(name, header, rows):
        with open(os.path.join(HERE, name), "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(rows)

    QUAL_HEADER = ["Pos", "No", "First", "Last", "Class", "Transponder", "Laps", "Best Tm", "Total Tm"]

    # 01 qualifying (Pos blank -> ranks by time)
    qrows = []
    for d in drivers:
        qrows.append(["", d["num"], d["first"], d["last"], d["cls"], d["trans"],
                      d["laps"], fmt_time(d["best"]), fmt_time(d["total"])])
    w("01-qualifying-all.csv", QUAL_HEADER, qrows)

    # prostock single-class qualifying
    prows = [r for r in qrows if r[4] == "Pro Stock"]
    w("prostock-qualifying.csv", QUAL_HEADER, prows)

    HEAT_HEADER = ["Pos", "No", "First", "Last", "Class", "Transponder"]
    for setkey, fname in (("set1", "02-heats-set1-all.csv"), ("set2", "03-heats-set2-all.csv")):
        rows = []
        for d in drivers:
            rows.append([d[setkey], d["num"], d["first"], d["last"], d["cls"], d["trans"]])
        w(fname, HEAT_HEADER, rows)

    FEAT_HEADER = ["Pos", "No", "First", "Last", "Class", "Transponder"]
    frows = []
    for cname, _, _, _ in CLASSES:
        for d, fin in feature_rows[cname]:
            frows.append([fin, d["num"], d["first"], d["last"], d["cls"], d["trans"]])
    w("04-feature-all.csv", FEAT_HEADER, frows)

    # edge cases (documented in README)
    edge_header = ["Pos", "No", "First", "Last", "Class", "Transponder", "Best Tm"]
    edge = [
        # two rows sharing kart #50 in the same class -> importer keeps first, flags the dup
        ["4", "50", "First", "Fifty", "Pro Stock", "99989", "00:00:22.400"],
        ["5", "50", "Second", "Fifty", "Pro Stock", "99990", "00:00:22.500"],
        # unknown class name -> importer should skip/report
        ["1", "404", "Ghost", "Class", "Nonexistent Class", "99991", "00:00:20.000"],
        # brand-new transponder not in roster -> feature auto-create
        ["3", "77", "Brand", "New", "Vintage", "99992", "00:00:31.200"],
        # DNF / DNS / DQ tokens
        ["DNF", "78", "Did", "Notfinish", "Vintage", "99993", "DNF"],
        ["DNS", "79", "Did", "Notstart", "Vintage", "99994", "DNS"],
        ["DQ", "80", "Black", "Flagged", "Vintage", "99995", "DQ"],
        # alternate time formats (mm:ss.mmm and raw seconds) for the qualifying parser
        ["", "81", "Min", "Sec", "Vintage", "99996", "1:02.500"],
        ["", "82", "Raw", "Seconds", "Vintage", "99997", "31.875"],
    ]
    w("edge-cases.csv", edge_header, edge)

    # starter backup JSON (mirrors index.html defaults() shape)
    backup = {
        "track": {"name": "Test Park", "logo": ""},
        "adminPin": "",
        "history": [],
        "license": None,
        "trialDays": [],
        "licUse": {},
        "classLib": [{"name": c[0], "maxPill": 200} for c in CLASSES],
        "roster": [],
        "classes": [{"id": c[1], "name": c[0], "maxPill": 200} for c in CLASSES],
        "settings": {
            "maxHeat": MAX_HEAT, "maxBMain": MAX_BMAIN, "maxFeature": MAX_FEATURE,
            "transfers": TRANSFERS, "gridStyle": "double", "heatFill": "alternate",
            "bmainMode": "parallel", "bmainCount": BMAIN_COUNT, "kioskReg": False,
            "points": {"table": [10, 8, 6, 5, 4, 3, 2, 1], "beyond": 0},
        },
        "raceDay": {"date": "2026-06-16", "entries": [], "heatResults": {}, "pointsRace": {}},
        "nextId": 100,
        "sync": {"enabled": False, "key": ""},
    }
    with open(os.path.join(HERE, "test-track-backup.json"), "w") as f:
        json.dump(backup, f, indent=2)

    # ===================== sanity assertions =====================
    def parallel_bmain_count(size):
        if size <= MAX_FEATURE:
            return 0
        k = max(1, BMAIN_COUNT)
        for _ in range(30):
            lock = max(0, MAX_FEATURE - k * TRANSFERS)
            if (size - lock) <= k * MAX_BMAIN:
                break
            k += 1
        return k

    all_trans = [d["trans"] for d in drivers]
    assert len(all_trans) == len(set(all_trans)), "transponders must be globally unique"
    for cname in by_class:
        nums = [d["num"] for d in by_class[cname]]
        assert len(nums) == len(set(nums)), "kart numbers unique within %s" % cname
    assert parallel_bmain_count(32) == 2, "Pro Stock(32) should yield exactly 2 B-mains"
    assert parallel_bmain_count(20) == 0, "20-car class should yield 0 B-mains"
    assert parallel_bmain_count(16) == 0 and parallel_bmain_count(12) == 0

    print("Generated %d drivers across %d classes." % (len(drivers), len(CLASSES)))
    for cname, cid, size, base in CLASSES:
        _, n = build_heats(size)
        print("  %-18s %2d cars  %d heats  %d B-mains" % (cname, size, n, parallel_bmain_count(size)))
    print("Sanity checks passed (unique IDs, 2 B-mains on Pro Stock).")


if __name__ == "__main__":
    main()
