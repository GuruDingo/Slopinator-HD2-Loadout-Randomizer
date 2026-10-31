"""Tests for the checks on hd2tags.csv in tools/build_gear.py (a scratch copy of the project is edited and rebuilt).
    python tests/tags_csv_test.py
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


with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp) / "proj"
    (work / "docs").mkdir(parents=True)
    shutil.copytree(ROOT / "tools", work / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    for f in ("hd2gear.csv", "hd2warbonds.csv", "hd2tags.csv", "hd2ids.lock.json"):
        shutil.copy(ROOT / f, work / f)
    original = (work / "hd2tags.csv").read_bytes()

    def build():
        return subprocess.run([sys.executable, "tools/build_gear.py"], cwd=work, capture_output=True, text=True)

    def edit(fn):
        rows = list(csv.reader(io.StringIO(original.decode("utf-8-sig"), newline="")))
        fn(rows)
        out = io.StringIO()
        csv.writer(out, lineterminator="\r\n").writerows(rows)
        (work / "hd2tags.csv").write_bytes(out.getvalue().encode("utf-8"))

    H = {n: i for i, n in enumerate(next(csv.reader(io.StringIO(original.decode("utf-8-sig")))))}
    r = build()
    check("the real file builds", r.returncode == 0, r.stdout + r.stderr)

    def blank_description(rows): rows[1][H["description"]] = ""
    edit(blank_description); r = build()
    check("a tag without a description is refused", r.returncode != 0 and "needs a description" in r.stdout, r.stdout)

    def blank_group(rows): rows[1][H["group"]] = ""
    edit(blank_group); r = build()
    check("a tag without a group is refused", r.returncode != 0 and "needs a group" in r.stdout, r.stdout)

    def bad_color(rows):
        row = next(x for x in rows[1:] if x[H["pill_color"]])
        row[H["pill_color"]] = "red"
    edit(bad_color); r = build()
    check("a malformed pill colour is refused", r.returncode != 0 and "pill_color" in r.stdout, r.stdout)

    def clash(rows):
        pills = [x for x in rows[1:] if x[H["pill_order"]]]
        pills[1][H["pill_order"]] = pills[0][H["pill_order"]]
    edit(clash); r = build()
    check("two tags with the same pill_order are refused", r.returncode != 0 and "pill_order" in r.stdout, r.stdout)

    def half_pill(rows):
        row = next(x for x in rows[1:] if x[H["pill_color"]])
        row[H["pill_order"]] = ""
    edit(half_pill); r = build()
    check("a pill colour without a pill_order is refused", r.returncode != 0 and "both" in r.stdout, r.stdout)

    def dupe(rows): rows.append(list(rows[1]))
    edit(dupe); r = build()
    check("a duplicate tag is refused", r.returncode != 0 and "duplicate tag" in r.stdout, r.stdout)

print(f"\n{failed} check(s) FAILED" if failed else "\nAll tags-csv tests passed")
sys.exit(1 if failed else 0)
