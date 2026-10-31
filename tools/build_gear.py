"""
build_gear.py - turns the three editable CSV files into the data file the website reads.

    hd2gear.csv        one row per item (you edit this in Excel)
    hd2warbonds.csv    warbond keys + display names, in display order
    hd2tags.csv        tag display titles + pill colours (row order = pill order on a card)
    docs/img/manifest.json  (optional) the saved copies of the wiki images, written by tools/fetch_images.py
        ->  docs/gear-data.js

Run it from anywhere after you change either CSV:

    python tools/build_gear.py            # validate + rebuild docs/gear-data.js
    python tools/build_gear.py --bundle   # also write dist/hd2-randomizer.html (everything in one file)

It refuses to write anything if it finds a real problem (unknown category, unknown
warbond key, duplicate names...), so a typo in the CSV can't silently break the site.

Tag consistency is NOT checked here; that is a separate manual procedure (see tools/tag_checks.py).
"""

import argparse
import base64
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEAR_CSV = ROOT / "hd2gear.csv"
WARBOND_CSV = ROOT / "hd2warbonds.csv"
TAGS_CSV = ROOT / "hd2tags.csv"
ID_LOCK = ROOT / "hd2ids.lock.json"
OUT_JS = ROOT / "docs" / "gear-data.js"
DIST_HTML = ROOT / "dist" / "hd2-randomizer.html"
IMG_MANIFEST = ROOT / "docs" / "img" / "manifest.json"  # written by tools/fetch_images.py
MIME = {".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif"}

WEAPON_CATEGORIES = {"primary", "secondary", "throwable"}
STRATAGEM_CATEGORIES = {"support", "backpack", "vehicle", "eagle", "orbital", "sentry", "defensive"}
FACTION_VALUES = {"any", "bug", "bot", "squid", "none"}


def split_list(raw):
    return [part.strip() for part in (raw or "").split(",") if part.strip()]


def load_warbonds():
    with open(WARBOND_CSV, newline="", encoding="utf-8-sig") as f:
        rows = [(r["key"].strip(), r["name"].strip()) for r in csv.DictReader(f) if r["key"].strip()]
    keys = [k for k, _ in rows]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        sys.exit(f"ERROR: duplicate warbond keys in {WARBOND_CSV.name}: {sorted(dupes)}")
    if "base" not in keys:
        sys.exit(f"ERROR: {WARBOND_CSV.name} must contain a 'base' warbond.")
    return rows


def load_tags():
    """hd2tags.csv columns: tag, group (the section it sits in inside the rule builder's dropdowns; sections appear in the
    order they first show up in the file), title (shown in the rule builder and on pills), description (one short line
    shown under the rule builder's dropdown when the tag is picked), pill_color (hex; blank = no
    pill) and pill_order (1, 2, 3... = left to right on a card; required with a pill colour, blank otherwise).
    Returns (rows, errors); rows are {"tag","group","title","description","color","pillOrder"} in file order."""
    rows, errors, seen, orders = [], [], set(), {}
    if not TAGS_CSV.exists():
        return rows, [f"{TAGS_CSV.name} is missing."]
    with open(TAGS_CSV, newline="", encoding="utf-8-sig") as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            tag = (r.get("tag") or "").strip()
            if not tag:
                continue
            where = f"{TAGS_CSV.name} line {n}"
            group = (r.get("group") or "").strip()
            title = (r.get("title") or "").strip()
            description = (r.get("description") or "").strip()
            color = (r.get("pill_color") or "").strip()
            order_raw = (r.get("pill_order") or "").strip()
            if tag in seen:
                errors.append(f"{where}: duplicate tag '{tag}'.")
            seen.add(tag)
            if not title:
                errors.append(f"{where}: tag '{tag}' needs a title.")
            if not description:
                errors.append(f"{where}: tag '{tag}' needs a description (one short line shown under the dropdown).")
            if not group:
                errors.append(f"{where}: tag '{tag}' needs a group (the section it appears under in the rule builder).")
            if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                errors.append(f"{where}: pill_color '{color}' for '{tag}' must look like #1a2b3c (or be blank for no pill).")
            order = None
            if order_raw:
                if not re.fullmatch(r"[1-9]\d*", order_raw):
                    errors.append(f"{where}: pill_order '{order_raw}' for '{tag}' must be a whole number (1, 2, 3...) or blank.")
                else:
                    order = int(order_raw)
                    if order in orders:
                        errors.append(f"{where}: pill_order {order} is used by both '{orders[order]}' and '{tag}'.")
                    orders[order] = tag
            if bool(color) != (order is not None):
                errors.append(f"{where}: '{tag}' needs both a pill_color and a pill_order for a pill, or neither.")
            rows.append({"tag": tag, "group": group, "title": title, "description": description, "color": color, "pillOrder": order})
    return rows, errors


def load_items(warbond_keys):
    errors, warnings, items = [], [], []
    orders_seen = {}
    with open(GEAR_CSV, newline="", encoding="utf-8-sig") as f:
        for line_no, row in enumerate(csv.DictReader(f), start=2):  # line 1 is the header
            name = (row.get("name") or "").strip()
            where = f"{GEAR_CSV.name} line {line_no} ({name or 'no name'})"
            cat = (row.get("category") or "").strip()
            factions = split_list(row.get("factions"))
            warbond = (row.get("warbond") or "").strip() or "base"
            released = (row.get("release_date") or "").strip()
            if not released:
                warnings.append(f"{where}: no release_date")
            elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", released):
                errors.append(f"{where}: release_date '{released}' must look like 2024-02-08")
                released = ""

            # menu_order: position inside its warbond / requisition block on the My Gear list (blank = after the numbered
            # ones, in file order). always_owned: "yes" = counts as owned whatever the warbond (the two base-game
            # stratagems that now sit in a requisition block).
            order_raw = (row.get("menu_order") or "").strip()
            menu_order = None
            if order_raw:
                if re.fullmatch(r"[1-9]\d*", order_raw):
                    menu_order = int(order_raw)
                else:
                    errors.append(f"{where}: menu_order '{order_raw}' must be a whole number (1, 2, 3...) or blank")
            always_raw = (row.get("always_owned") or "").strip().lower()
            if always_raw not in ("", "yes"):
                errors.append(f"{where}: always_owned '{always_raw}' must be 'yes' or blank")

            if not name:
                errors.append(f"{where}: missing name")
                continue
            if cat not in WEAPON_CATEGORIES | STRATAGEM_CATEGORIES:
                errors.append(f"{where}: unknown category '{cat}'")
            if warbond not in warbond_keys:
                errors.append(f"{where}: warbond '{warbond}' is not listed in {WARBOND_CSV.name}")
            if not factions:
                errors.append(f"{where}: factions is empty (use 'any' for everything, 'none' to disable)")
            bad = [x for x in factions if x not in FACTION_VALUES]
            if bad:
                errors.append(f"{where}: unknown faction value(s) {bad}")
            if "any" in factions and len(factions) > 1:
                warnings.append(f"{where}: 'any' mixed with other factions is NOT treated as universal")
            if not (row.get("img_url") or "").strip():
                warnings.append(f"{where}: no img_url")

            # armor_pen: the main attack's armor-penetration level(s) as the wiki icons number them (-1 = no hitbox,
            # 0 = unarmored, 2 = light, 3 = medium, 4 = heavy, 5-10 = anti-tank I-VI, 11 = indestructible). Weapons with
            # two modes list both, "2/4". Blank is fine for stratagems that aren't weapons.
            armor_raw = (row.get("armor_pen") or "").strip()
            armor_pen = []
            if armor_raw:
                for part in armor_raw.split("/"):
                    try:
                        level = int(part.strip())
                    except ValueError:
                        level = None
                    if level is None or not -1 <= level <= 11:
                        errors.append(f"{where}: armor_pen '{armor_raw}' must be whole numbers from -1 to 11, joined by '/' (e.g. 3 or 2/4)")
                        armor_pen = []
                        break
                    armor_pen.append(level)
            elif cat in WEAPON_CATEGORIES or cat == "support":
                warnings.append(f"{where}: no armor_pen")

            items.append({
                "id": (row.get("id") or "").strip(),
                "cat": cat,
                "name": name,
                "nicknames": [n.lower() for n in split_list(row.get("nicknames"))],
                "tags": split_list(row.get("tags")),
                "factions": factions,
                "warbond": warbond,
                "released": released,
                "imgUrl": (row.get("img_url") or "").strip(),
                "armorPen": armor_pen,
                "menuOrder": menu_order,
                "alwaysOwned": always_raw == "yes",
            })
            if menu_order is not None:
                key = (warbond, menu_order)
                if key in orders_seen:
                    errors.append(f"{where}: menu_order {menu_order} in '{warbond}' is also used by {orders_seen[key]}")
                orders_seen[key] = name

    # ids are permanent: a whole number that is never renumbered or reused, because people's saved
    # settings in their browsers (owned / blocked / faction edits) are keyed by it. Row position does not matter and
    # release order is the release_date column. The build also checks hd2ids.lock.json (see check_id_lock).
    seen_ids = {}
    for it in items:
        if not re.fullmatch(r"[1-9]\d*", it["id"]):
            errors.append(f"{it['name']}: id '{it['id']}' must be a whole number (1, 2, 3...)")
        elif it["id"] in seen_ids:
            errors.append(f"id {it['id']} is used by both '{seen_ids[it['id']]}' and '{it['name']}'")
        seen_ids[it["id"]] = it["name"]

    # duplicate names / nicknames (the lock + exclude boxes resolve by either one)
    seen_names = {}
    for it in items:
        key = it["name"].lower()
        if key in seen_names:
            errors.append(f"duplicate item name '{it['name']}'")
        seen_names[key] = it
    seen_nick = {}
    for it in items:
        for nick in it["nicknames"]:
            owner = seen_nick.get(nick)
            if owner and owner != it["name"]:
                errors.append(f"nickname '{nick}' is used by both '{owner}' and '{it['name']}'")
            elif nick in seen_names and seen_names[nick]["name"] != it["name"]:
                errors.append(f"nickname '{nick}' of '{it['name']}' is also the full name of '{seen_names[nick]['name']}'")
            seen_nick[nick] = it["name"]
    return items, errors, warnings


def load_id_lock():
    if not ID_LOCK.exists():
        return {}
    try:
        return json.loads(ID_LOCK.read_text(encoding="utf-8")).get("ids", {})
    except ValueError:
        sys.exit(f"ERROR: {ID_LOCK.name} is not valid JSON.")


def check_id_lock(items):
    """Item ids are permanent. hd2ids.lock.json remembers every id that has shipped (with the item's name and category).
    Returns (errors, notices, new_lock). An id may never disappear, change category (that would mean the id now points
    at a different kind of item), or be reused; a new id must be higher than every locked id. A renamed item is fine:
    saved settings follow the id."""
    errors, notices = [], []
    lock = load_id_lock()
    by_id = {it["id"]: it for it in items if re.fullmatch(r"[1-9]\d*", it["id"])}
    top = max((int(k) for k in lock), default=0)
    for k, v in lock.items():
        it = by_id.get(k)
        if it is None:
            errors.append(f"id {k} ('{v['name']}') is in {ID_LOCK.name} but missing from {GEAR_CSV.name}. Ids are permanent: "
                          f"never delete or renumber an item - set its factions to 'none' to retire it.")
        elif it["cat"] != v["cat"]:
            errors.append(f"id {k} was '{v['name']}' ({v['cat']}) and is now '{it['name']}' ({it['cat']}): ids must keep pointing at the same item "
                          f"(did the rows get renumbered?). Renames are fine, a different kind of item is not.")
        elif it["name"] != v["name"]:
            notices.append(f"id {k} renamed: '{v['name']}' -> '{it['name']}' (saved settings follow the id)")
    for k, it in by_id.items():
        if k not in lock and lock and int(k) <= top:
            errors.append(f"new item '{it['name']}' has id {k}, which is not above the highest id that has shipped ({top}). "
                          f"New items get the next free number (highest id + 1); ids are never reused.")
    new_lock = {k: {"name": by_id[k]["name"], "cat": by_id[k]["cat"]} if k in by_id else v for k, v in lock.items()}
    for k, it in by_id.items():
        if k not in new_lock:
            new_lock[k] = {"name": it["name"], "cat": it["cat"]}
    return errors, notices, dict(sorted(new_lock.items(), key=lambda kv: int(kv[0])))


def write_id_lock(new_lock):
    lines = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in new_lock.items())
    text = ('{\n "_about": "Every item id that has shipped. Ids are permanent: saved settings in players\' browsers are keyed by them. '
            'Maintained by tools/build_gear.py; do not edit by hand.",\n "ids": {\n' + lines + "\n }\n}\n")
    if not ID_LOCK.exists() or ID_LOCK.read_text(encoding="utf-8") != text:
        ID_LOCK.write_text(text, encoding="utf-8")


def load_image_map():
    """wiki image address -> saved file (relative to docs/), only for files that really exist in docs/img/."""
    if not IMG_MANIFEST.exists():
        return {}
    try:
        raw = json.loads(IMG_MANIFEST.read_text(encoding="utf-8"))
    except ValueError:
        sys.exit(f"ERROR: {IMG_MANIFEST.relative_to(ROOT)} is not valid JSON (run tools/fetch_images.py again).")
    return {url: rel for url, rel in sorted(raw.items()) if (ROOT / "docs" / rel).is_file()}


def data_js_text(warbonds, items, images, tags=()):
    # One warbond / one item / one image per line: compact, but still readable in a git diff.
    def lines(rows):
        return ",\n".join("  " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)

    img_lines = ",\n".join("  " + json.dumps(u) + ":" + json.dumps(r) for u, r in images.items())
    body = (
        "{\n"
        ' "warbonds": [\n' + lines([{"key": k, "name": n} for k, n in warbonds]) + "\n ],\n"
        ' "items": [\n' + lines(items) + "\n ],\n"
        ' "tags": [\n' + lines(tags) + "\n ],\n"
        # Saved copies of the wiki images (see tools/fetch_images.py); the page uses these instead of the wiki links.
        + (' "images": {\n' + img_lines + "\n }\n" if img_lines else ' "images": {}\n') +
        "}"
    )
    return (
        "// AUTO-GENERATED by tools/build_gear.py from hd2gear.csv + hd2warbonds.csv + hd2tags.csv - do not edit by hand.\n"
        f"globalThis.HD2_DATA = {body};\n"
    )


def write_data_js(warbonds, items, images, tags=()):
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(data_js_text(warbonds, items, images, tags), encoding="utf-8")


def write_bundle(warbonds, items, images, tags=()):
    """Inline style.css, gear-data.js, engine.js and app.js into one self-contained HTML file.
    The saved images are embedded too (as data: addresses), so the single file works offline."""
    docs = ROOT / "docs"
    embedded = {u: "data:" + MIME.get(Path(r).suffix.lower(), "application/octet-stream") + ";base64,"
                + base64.b64encode((docs / r).read_bytes()).decode("ascii") for u, r in images.items()}
    html = (docs / "index.html").read_text(encoding="utf-8")

    def inline_css(match):
        return "<style>\n" + (docs / match.group(1)).read_text(encoding="utf-8") + "\n</style>"

    def inline_js(match):
        if match.group(1) == "gear-data.js":
            code = data_js_text(warbonds, items, embedded, tags)
        else:
            code = (docs / match.group(1)).read_text(encoding="utf-8")
        code = code.replace("</script", "<\\/script")
        return "<script>\n" + code + "\n</script>"

    html, n_css = re.subn(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html, n_js = re.subn(r'<script src="([^"]+)"></script>', inline_js, html)
    DIST_HTML.parent.mkdir(parents=True, exist_ok=True)
    DIST_HTML.write_text(html, encoding="utf-8")
    size = DIST_HTML.stat().st_size / 1024 / 1024
    print(f"Bundled {n_css} stylesheet(s) + {n_js} script(s) + {len(images)} image(s) -> {DIST_HTML.relative_to(ROOT)} ({size:.1f} MB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", action="store_true", help="also write dist/hd2-randomizer.html")
    args = ap.parse_args()

    warbonds = load_warbonds()
    items, errors, warnings = load_items({k for k, _ in warbonds})

    tags, tag_errors = load_tags()
    errors += tag_errors
    used = {t for it in items for t in it["tags"]}
    for t in tags:
        if t["tag"] not in used:
            warnings.append(f"{TAGS_CSV.name}: tag '{t['tag']}' isn't on any item in hd2gear.csv.")

    id_errors, id_notices, new_lock = check_id_lock(items)
    errors += id_errors
    for n in id_notices:
        print("note:", n)
    for w in warnings:
        print("warning:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        sys.exit(f"\n{len(errors)} problem(s) found - nothing was written.")

    write_id_lock(new_lock)
    images = load_image_map()
    write_data_js(warbonds, items, images, tags)
    live = sum(1 for i in items if "none" not in i["factions"])
    print(f"Wrote {OUT_JS.relative_to(ROOT)}: {len(items)} items ({live} active), {len(warbonds)} warbonds, {len(images)} saved images.")
    if args.bundle:
        write_bundle(warbonds, items, images, tags)


if __name__ == "__main__":
    main()
