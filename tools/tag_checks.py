"""Tag consistency checks for hd2gear.csv. Used by build_gear.py; run on its own with  python tools/tag_checks.py

Everything here only FLAGS problems. Nothing edits the CSV. The rules live in tools/tag_rules.json:
  implications          "if an item has tag A it must also have tag B" (optionally only for one category, with
                        a list of item names that are deliberate exceptions)
  weapon_only_tags      a tag that only items in the listed categories may carry (today: panic is for primaries,
                        secondaries and throwables, never stratagems); it is flagged on any other item
  exactly_one_of        every item in a category must carry exactly one of the listed tags (today: a support weapon is
                        either expendable or nonexp)
  mutually_exclusive    two tags that must never sit on the same item (none configured right now; explosive and fire may share an item)
  min_items_per_tag     a tag used by fewer items than this is flagged, unless it is listed in ...
  acknowledged_rare_tags   tags already reviewed and accepted as rare
Also flagged: a tag listed twice on one item.
"""
import json
from pathlib import Path

RULES_JSON = Path(__file__).resolve().parent / "tag_rules.json"


def load_rules(path=RULES_JSON):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_tags(items, rules):
    """items: dicts with 'name', 'cat' and 'tags' (a list, repeats kept). Returns a list of flag messages."""
    flags = []

    for it in items:
        tags = it["tags"]
        dupes = sorted({t for t in tags if tags.count(t) > 1})
        if dupes:
            flags.append(f"'{it['name']}' lists the same tag twice: {', '.join(dupes)}")

    for rule in rules.get("implications", []):
        for it in items:
            cats = rule.get("category")  # one category name, or a list of them
            if cats and it["cat"] not in ([cats] if isinstance(cats, str) else cats):
                continue
            if rule["if"] in it["tags"] and rule["then"] not in it["tags"]:
                if it["name"] in rule.get("except", []):
                    continue
                scope = f" (for {cats if isinstance(cats, str) else '/'.join(cats)} items)" if cats else ""
                flags.append(f"'{it['name']}' has '{rule['if']}' but not '{rule['then']}'{scope}")

    for rule in rules.get("weapon_only_tags", []):
        for it in items:
            if rule["tag"] in it["tags"] and it["cat"] not in rule["categories"]:
                flags.append(
                    f"'{it['name']}' ({it['cat']}) has '{rule['tag']}', which only "
                    f"{'/'.join(rule['categories'])} items may have - remove it"
                )

    for rule in rules.get("exactly_one_of", []):
        for it in items:
            if it["cat"] != rule["category"]:
                continue
            have = [t for t in rule["tags"] if t in it["tags"]]
            if len(have) != 1:
                flags.append(
                    f"'{it['name']}' ({it['cat']}) must have exactly one of {'/'.join(rule['tags'])}, "
                    f"but has {'both' if have else 'neither'}"
                )

    for rule in rules.get("mutually_exclusive", []):
        a, b = rule["tags"]
        for it in items:
            if a in it["tags"] and b in it["tags"]:
                flags.append(f"'{it['name']}' ({it['cat']}) has both '{a}' and '{b}', which are mutually exclusive")

    counts = {}
    for it in items:
        for t in set(it["tags"]):
            counts[t] = counts.get(t, 0) + 1
    known = set(rules.get("acknowledged_rare_tags", []))
    minimum = rules.get("min_items_per_tag", 3)
    for tag, n in sorted(counts.items()):
        if n < minimum and tag not in known:
            flags.append(
                f"NEW RARE TAG '{tag}' is used by only {n} item{'s' if n != 1 else ''} (fewer than {minimum}). "
                f"Is it intended, or a typo? If intended, add it to acknowledged_rare_tags in tools/tag_rules.json."
            )
    return flags


if __name__ == "__main__":  # python tools/tag_checks.py
    import csv
    root = Path(__file__).resolve().parent.parent
    with open(root / "hd2gear.csv", newline="", encoding="utf-8-sig") as f:
        rows = [
            {"name": r["name"].strip(), "cat": r["category"].strip(),
             "tags": [t.strip() for t in (r["tags"] or "").split(",") if t.strip()]}
            for r in csv.DictReader(f) if (r.get("name") or "").strip()
        ]
    out = check_tags(rows, load_rules())
    print("\n".join("flag: " + m for m in out) if out else "No tag inconsistencies.")
