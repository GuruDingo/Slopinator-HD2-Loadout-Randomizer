"""Tests for tools/tag_checks.py (the tag consistency flags).   python tests/tag_checks_test.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from tag_checks import check_tags, load_rules  # noqa: E402

RULES = {
    "implications": [
        {"if": "beam", "then": "fire", "except": ["Deliberate"]},
        {"if": "demo", "then": "explosive", "category": "secondary"},
        {"if": "laser", "then": "charge", "category": ["primary", "support"]},
    ],
    "weapon_only_tags": [{"tag": "panic", "categories": ["primary", "secondary", "throwable"]}],
    "exactly_one_of": [{"category": "support", "tags": ["expendable", "nonexp"]}],
    "mutually_exclusive": [{"tags": ["explosive", "fire"]}],
    "min_items_per_tag": 3,
    "acknowledged_rare_tags": ["known", "expendable", "nonexp"],
}
failed = 0


def it(name, cat, tags):
    return {"name": name, "cat": cat, "tags": tags.split(",")}


def check(label, cond, extra=""):
    global failed
    print(("  ok   " if cond else "  FAIL ") + label + ("" if cond else "  -> " + str(extra)))
    failed += not cond


filler = [it(f"F{i}", "primary", "beam,fire,demo,known,common") for i in range(3)]
filler += [it(f"E{i}", "primary", "explosive,known,common") for i in range(3)]  # (explosive and fire never share an item)

flags = check_tags(filler + [it("Bad", "primary", "beam,common")], RULES)
check("missing implied tag is flagged", any("'Bad' has 'beam' but not 'fire'" in f for f in flags), flags)

flags = check_tags(filler + [it("Deliberate", "primary", "beam,common")], RULES)
check("listed exception is NOT flagged", not any("Deliberate" in f for f in flags), flags)

flags = check_tags(filler + [it("Sec", "secondary", "demo,common"), it("Prim", "primary", "demo,common")], RULES)
check("category-limited rule flags the secondary", any("'Sec' has 'demo' but not 'explosive'" in f for f in flags), flags)
check("...and leaves the primary alone", not any("'Prim'" in f for f in flags), flags)

flags = check_tags(filler + [it("LasP", "primary", "laser,common"), it("LasS", "support", "laser,common"), it("LasO", "orbital", "laser,common")], RULES)
check("a rule limited to a list of categories flags each listed one", all(f"'{n}' has 'laser' but not 'charge'" in "\n".join(flags) for n in ("LasP", "LasS")), flags)
check("...and leaves the other categories alone", not any("'LasO'" in f for f in flags), flags)

flags = check_tags(filler + [it("SupA", "support", "common,support,expendable"), it("SupB", "support", "common,support,nonexp"),
                             it("SupNone", "support", "common,support"), it("SupBoth", "support", "common,support,expendable,nonexp"),
                             it("Prim", "primary", "common")], RULES)
check("a support weapon must have exactly one of expendable / nonexp",
      any("SupNone" in f for f in flags) and any("SupBoth" in f for f in flags) and not any("'SupA'" in f or "'SupB'" in f or "'Prim'" in f for f in flags), flags)
flags = check_tags(filler + [it("Twice", "primary", "common,demo,explosive,demo")], RULES)
check("a tag listed twice is flagged", any("'Twice' lists the same tag twice: demo" in f for f in flags), flags)

flags = check_tags(filler + [it("New", "primary", "brandnew")], RULES)
check("new tag used by fewer than 3 items is flagged", any("NEW RARE TAG 'brandnew'" in f for f in flags), flags)

flags = check_tags(filler + [it("Strat", "orbital", "common,panic"), it("Gun", "primary", "common,panic"), it("Nade", "throwable", "common,panic")], RULES)
check("a weapon-only tag on a stratagem is flagged", any("'Strat' (orbital) has 'panic'" in f for f in flags), flags)
check("...but not on a primary or a throwable", not any("'Gun'" in f or "'Nade'" in f for f in flags), flags)

flags = check_tags(filler[:1], RULES)
check("acknowledged rare tag is not flagged", not any("'known'" in f for f in flags), flags)

flags = check_tags(filler + [it("A", "primary", "common"), it("B", "primary", "common")], RULES)
check("a clean file gives no flags", flags == [], flags)

flags = check_tags(filler + [it("Both", "throwable", "explosive,fire,common"), it("OnlyFire", "throwable", "fire,common"), it("OnlyBoom", "throwable", "explosive,common")], RULES)
check("explosive and fire on one item are flagged, either alone is not",
      any("'Both'" in f and "mutually exclusive" in f for f in flags) and not any("OnlyFire" in f or "OnlyBoom" in f for f in flags), flags)

# the real rules file + the real data
import csv  # noqa: E402
root = Path(__file__).resolve().parent.parent
with open(root / "hd2gear.csv", newline="", encoding="utf-8-sig") as f:
    rows = [{"name": r["name"].strip(), "cat": r["category"].strip(),
             "tags": [t.strip() for t in (r["tags"] or "").split(",") if t.strip()]}
            for r in csv.DictReader(f) if (r.get("name") or "").strip()]
flags = check_tags(rows, load_rules())
check("hd2gear.csv has no tag inconsistencies", flags == [], flags)

print(f"\n{failed} check(s) FAILED" if failed else "\nAll tag-check tests passed")
sys.exit(1 if failed else 0)
