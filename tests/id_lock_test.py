"""Tests for the permanent-id lock (hd2ids.lock.json) in tools/build_gear.py.
A scratch copy of the project is built, then edited the way a careless CSV edit could go wrong.
    python tests/id_lock_test.py
"""
import csv
import io
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


def edit(work, fn):
    path = work / "hd2gear.csv"
    rows = list(csv.reader(io.StringIO(path.read_bytes().decode("utf-8-sig"), newline="")))
    fn(rows)
    out = io.StringIO()
    csv.writer(out, lineterminator="\r\n").writerows(rows)
    path.write_bytes(out.getvalue().encode("utf-8"))


with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp) / "proj"
    (work / "docs").mkdir(parents=True)
    shutil.copytree(ROOT / "tools", work / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    for f in ("hd2gear.csv", "hd2warbonds.csv", "hd2tags.csv"):
        shutil.copy(ROOT / f, work / f)
    original = (work / "hd2gear.csv").read_bytes()

    r = build(work)
    check("a first build creates the lock", r.returncode == 0 and (work / "hd2ids.lock.json").exists(), r.stdout + r.stderr)
    lock1 = (work / "hd2ids.lock.json").read_text()
    check("...and building again changes nothing", build(work).returncode == 0 and (work / "hd2ids.lock.json").read_text() == lock1)

    def rename(rows):
        rows[1][2] = rows[1][2] + " Mk II"
    edit(work, rename)
    r = build(work)
    check("renaming an item is fine and reported", r.returncode == 0 and "renamed" in r.stdout, r.stdout + r.stderr)
    check("...the lock follows the new name", "Mk II" in (work / "hd2ids.lock.json").read_text())

    (work / "hd2gear.csv").write_bytes(original); build(work)

    def delete(rows):
        del rows[5]
    edit(work, delete)
    r = build(work)
    check("deleting an item is refused", r.returncode != 0 and "permanent" in r.stdout, r.stdout + r.stderr)

    (work / "hd2gear.csv").write_bytes(original)

    def renumber(rows):  # shift every id by one: ids now point at different items
        for row in rows[1:]:
            row[0] = str(int(row[0]) + 1)
    edit(work, renumber)
    r = build(work)
    check("renumbering the rows is refused", r.returncode != 0, r.stdout + r.stderr)

    (work / "hd2gear.csv").write_bytes(original)

    top = max(int(r[0]) for r in csv.reader(io.StringIO(original.decode("utf-8-sig"), newline="")) if r[0].isdigit())

    def too_low(rows):
        new = list(rows[1]); new[0] = str(top - 1); new[2] = "Brand New Thing"; new[3] = "brand new thing"
        rows.append(new)
    (work / "hd2gear.csv").write_bytes(original)
    edit(work, too_low)
    r = build(work)
    check("a duplicate id is refused", r.returncode != 0 and "used by both" in r.stdout, r.stdout + r.stderr)

    (work / "hd2gear.csv").write_bytes(original)

    def append_ok(rows):
        new = list(rows[1]); new[0] = str(top + 1); new[2] = "Brand New Thing"; new[3] = "brand new thing"
        rows.insert(3, new)  # row position does not matter
    edit(work, append_ok)
    r = build(work)
    check("a new item with the next id is accepted anywhere in the file", r.returncode == 0, r.stdout + r.stderr)
    check("...and joins the lock", f'"{top + 1}"' in (work / "hd2ids.lock.json").read_text())

    (work / "hd2gear.csv").write_bytes(original)

    def gap_low(rows):
        for row in rows[1:]:
            if row[0] == str(top):
                row[0] = str(top + 5)
    edit(work, gap_low)
    r = build(work)
    check("moving the highest item to a new id is refused", r.returncode != 0, r.stdout + r.stderr)

print(f"\n{failed} check(s) FAILED" if failed else "\nAll id-lock tests passed")
sys.exit(1 if failed else 0)
