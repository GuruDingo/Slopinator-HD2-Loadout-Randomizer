"""Tests for the armor / passive / booster CSV checks and id lock in tools/build_gear.py.
A scratch copy of the project is built, then edited the way a careless CSV edit could go wrong.
    python tests/extras_test.py
"""
import csv
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failed = 0


def check(label, cond, extra=""):
    global failed
    print(("  ok   " if cond else "  FAIL ") + label + ("" if cond else "  -> " + str(extra)))
    failed += not cond


def build(work):
    return subprocess.run([sys.executable, "tools/build_gear.py"], cwd=work, capture_output=True, text=True)


def edit(path, fn):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    fn(rows)
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)


FILES = ("hd2gear.csv", "hd2warbonds.csv", "hd2tags.csv", "hd2armor.csv", "hd2passives.csv", "hd2boosters.csv")
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp) / "proj"
    (work / "docs").mkdir(parents=True)
    shutil.copytree(ROOT / "tools", work / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    for f in FILES:
        shutil.copy(ROOT / f, work / f)
    originals = {f: (work / f).read_bytes() for f in FILES}

    def reset():
        for f, b in originals.items():
            (work / f).write_bytes(b)

    r = build(work)
    check("the shipped armor/passive/booster files build clean", r.returncode == 0, r.stdout + r.stderr)
    lock = (work / "hd2extras.lock.json").read_text()
    check("...and the extras lock is written", '"armor"' in lock and '"passives"' in lock and '"boosters"' in lock)
    check("building again changes nothing", build(work).returncode == 0 and (work / "hd2extras.lock.json").read_text() == lock)

    # a passive nobody carries (the hidden-count check)
    edit(work / "hd2passives.csv", lambda rows: rows.append([str(len(rows)), "Phantom Passive", "x", "", "any", "", "0"]))
    r = build(work)
    check("a passive with no armor is an error", r.returncode != 0 and "Phantom Passive" in r.stdout and "no armor carries" in r.stdout, r.stdout + r.stderr)
    reset()

    # armor pointing at a passive that doesn't exist
    def badpassive(rows):
        rows[1][rows[0].index("passive")] = "Nope"
    edit(work / "hd2armor.csv", badpassive)
    r = build(work)
    check("armor with an unknown passive is an error", r.returncode != 0 and "'Nope' is not in" in r.stdout, r.stdout + r.stderr)
    reset()

    def badweight(rows):
        rows[1][rows[0].index("weight")] = "huge"
    edit(work / "hd2armor.csv", badweight)
    check("a bad weight class is an error", "must be light, medium or heavy" in build(work).stdout)
    reset()

    def badwb(rows):
        rows[1][rows[0].index("warbond")] = "nope_wb"
    edit(work / "hd2armor.csv", badwb)
    check("an unknown warbond key is an error", "unknown warbond 'nope_wb'" in build(work).stdout)
    reset()

    edit(work / "hd2boosters.csv", lambda rows: rows[1].__setitem__(rows[0].index("release_date"), "8/2/24"))
    check("a badly formatted date is an error", "must look like 2024-02-08" in build(work).stdout)
    reset()

    # ids are permanent
    edit(work / "hd2armor.csv", lambda rows: rows.pop(5))
    r = build(work)
    check("deleting an armor row is refused (ids are permanent)", r.returncode != 0 and "missing from hd2armor.csv" in r.stdout, r.stdout + r.stderr)
    reset()

    edit(work / "hd2armor.csv", lambda rows: rows[1].__setitem__(1, rows[1][1] + " Mk II"))
    r = build(work)
    check("renaming an armor is fine and reported", r.returncode == 0 and "renamed" in r.stdout, r.stdout + r.stderr)
    reset(); build(work)

    def lowid(rows):
        new = list(rows[1]); new[0] = "5"; new[1] = "ZZ-1 Brand New"; rows.append(new)
    edit(work / "hd2armor.csv", lowid)
    check("a new armor must take an unused id", build(work).returncode != 0)
    reset(); build(work)

    def nextid(rows):
        new = list(rows[1]); new[0] = str(len(rows)); new[1] = "ZZ-1 Brand New"; rows.append(new)
    edit(work / "hd2armor.csv", nextid)
    r = build(work)
    check("a new armor with the next id builds and is locked", r.returncode == 0 and "ZZ-1 Brand New" in (work / "hd2extras.lock.json").read_text(), r.stdout + r.stderr)

print("\nAll extras checks passed" if not failed else f"\n{failed} extras check(s) FAILED")
sys.exit(1 if failed else 0)
