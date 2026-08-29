#!/usr/bin/env python3
"""Turn schedule.txt into the hardcoded departure arrays used by guts.html.

Run this after re-copying the timetable from
https://transportation.georgetown.edu/guts/dupont/ (worth doing when the
semester starts -- GUTS revises the timetable and posts service changes as
news items, none of which a static page can know about).

It prints the three arrays plus a report of every correction it applied, so
the source's errors stay visible instead of being silently swallowed.

Times are stored as minutes from midnight of the *service day*, so a value
of 1450 means 12:10 AM on the following calendar morning -- still part of
the service day that began at 6:00 AM.
"""
import re
import sys

DAY = 1440
COLUMNS = ["BTA", "Lombardi", "Dupont", "Arrive BTA", "Arrive Lombardi"]
BOARDS = [2, 0, 1]  # Dupont first: it is the stop you catch, not the campus end.
DASHES = {"-", "–", "—", ""}

notes = []


def candidates(tok, row, col):
    """Minute-of-day readings for one cell, best guess first."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?", tok)
    if m:
        h, mi, ap = int(m.group(1)) % 12, int(m.group(2)), m.group(3).lower()
        base = h * 60 + mi + (720 if ap == "p" else 0)
        # "12:25 AM" mid-afternoon is the classic 12-o'clock meridiem typo, so
        # offer the flipped reading as an alternative and let the caller pick
        # whichever lands sensibly in the run of times around it.
        if int(m.group(1)) == 12:
            return [base, (base + 720) % DAY]
        return [base]
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", tok)
    if m:  # a stray 24-hour cell such as "16:20" in a 12-hour column
        h, mi = int(m.group(1)), int(m.group(2))
        notes.append(f"row {row:>3} {COLUMNS[col]:<15} 24-hour cell {tok!r} -> {fmt(h * 60 + mi)}")
        return [h * 60 + mi]
    sys.exit(f"row {row} {COLUMNS[col]}: cannot parse {tok!r}")


def fmt(v):
    v %= DAY
    h, mi = divmod(v, 60)
    ap = "AM" if h < 12 else "PM"
    return f"{(h % 12) or 12}:{mi:02d} {ap}"


def parse(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) != 5 or cells[0] == "BTA":
            continue
        rows.append(cells)

    cols = []
    for col in range(5):
        prev, times = 0, []
        for row, cells in enumerate(rows, 1):
            tok = cells[col]
            if tok in DASHES:
                continue
            # Each column runs forward through the service day, so resolve every
            # cell to the next time at or after the previous one. Where a cell has
            # two readings, keep the one that makes the smallest forward step --
            # that turns "12:25 AM" between 11:45 AM and 1:05 PM into 12:25 PM,
            # and the closing "12:10 AM" into 1450 (past midnight), by the same rule.
            reads = candidates(tok, row, col)
            best = None
            for cand in reads:
                v = cand + DAY * -(-(prev - cand) // DAY) if cand < prev else cand
                if best is None or v - prev < best[0] - prev:
                    best = (v, cand)
            v, cand = best
            if v % DAY != reads[0]:
                notes.append(f"row {row:>3} {COLUMNS[col]:<15} {tok!r} -> {fmt(v)} (meridiem corrected)")
            elif v >= DAY:
                notes.append(f"row {row:>3} {COLUMNS[col]:<15} {tok!r} -> {fmt(v)} next day (offset {v})")
            times.append(v)
            prev = v
        cols.append(times)
    return cols


cols = parse("schedule.txt")
for i, c in enumerate(cols):
    gaps = [b - a for a, b in zip(c, c[1:])]
    assert all(g > 0 for g in gaps), f"{COLUMNS[i]} not strictly increasing"
    print(f"// {COLUMNS[i]}: {len(c)} times, {fmt(c[0])}-{fmt(c[-1])}, max gap {max(gaps)} min",
          file=sys.stderr)

print("\n".join("// " + n for n in notes), file=sys.stderr)
for name, idx in zip(["DUPONT", "BTA", "LOMBARDI"], BOARDS):
    body = ", ".join(str(v) for v in cols[idx])
    print(f"const {name} = [{body}];\n")
