"""
fetch_images.py - saves every image the site uses from the Helldivers wiki into docs/img/, so the site
no longer hotlinks them.

    python tools/fetch_images.py              # download whatever is missing, then run build_gear.py yourself
    python tools/fetch_images.py --list       # show what would be fetched / what is already saved (no network)
    python tools/fetch_images.py --from-dir D # take the files from folder D (by their wiki file name) instead of downloading
    python tools/fetch_images.py --force      # re-download and re-process everything

What it collects (the wiki address stays the source of truth; nothing in the CSVs changes):
    hd2gear.csv        img_url          -> docs/img/items/       (resized, WebP)
    docs/app.js        every wiki image the page links (faction emblems, warbond title icons, requisition slip)
                       plus the 13 armor-penetration icons          -> docs/img/icons/ (kept as they are: SVG stays SVG)

It writes docs/img/manifest.json (wiki address -> saved file). `python tools/build_gear.py` reads that file
and copies it into docs/gear-data.js, and the page then uses the saved copy of every image it has one for. An image
that isn't saved yet keeps using its wiki link, so a half-finished run never breaks the site.

Files that already exist are skipped, requests are spaced out, and a request identifies itself, so this is gentle
on the wiki. The images are Arrowhead's / the wiki's; see the credit line in the README.

Needs Pillow for resizing:  pip install pillow
"""

import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
IMG = DOCS / "img"
MANIFEST = IMG / "manifest.json"
GEAR_CSV = ROOT / "hd2gear.csv"
WARBOND_CSV = ROOT / "hd2warbonds.csv"
APP_JS = DOCS / "app.js"

WIKI = "https://helldivers.wiki.gg/images/"
USER_AGENT = "Slopinator-HD2-Loadout-Randomizer image fetch (fan project, https://github.com/GuruDingo/Slopinator-HD2-Loadout-Randomizer)"
DELAY = 0.4  # seconds between downloads
AP_LEVELS = range(-1, 12)  # armor-penetration icons, -1 .. 11

# kind -> (folder, longest side in pixels or None to keep as is)
KINDS = {"items": ("items", 320), "icons": ("icons", None)}
RASTER = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def read_csv_urls(path, column):
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [(r.get(column) or "").strip() for r in csv.DictReader(f) if (r.get(column) or "").strip()]


def app_icon_urls():
    """Every wiki image address written into app.js, plus the armor-penetration icons."""
    text = APP_JS.read_text(encoding="utf-8")
    found = set(re.findall(r'WIKI_IMG \+ "([^"]+)"', text))
    found = {WIKI + f for f in found}
    found |= {u for u in re.findall(r'"(https://helldivers\.wiki\.gg/images/[^"]+)"', text)
              if re.search(r"\.(png|svg|jpe?g|webp|gif)$", u, re.I)}
    found |= {f"{WIKI}Armor_AP{n}_Icon.png" for n in AP_LEVELS}
    return sorted(found)


def wiki_file_name(url):
    """The file name the wiki uses. A /thumb/Name.png/600px-Name.png address is the same picture as Name.png."""
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    path = path.split("/images/", 1)[-1]
    parts = path.split("/")
    if parts[0] == "thumb" and len(parts) >= 3:
        return parts[1]
    return parts[-1]


def safe_name(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "", name.replace(" ", "_"))


def plan():
    """[(url, kind, relative path under docs/)] for everything the site uses, without duplicates."""
    jobs, seen = [], {}
    wanted = (
        [(u, "items") for u in read_csv_urls(GEAR_CSV, "img_url")]
        + [(u, "icons") for u in app_icon_urls()]
    )
    taken = {}
    for url, kind in wanted:
        if url in seen:
            continue
        name = safe_name(wiki_file_name(url))
        ext = Path(name).suffix.lower()
        if kind != "icons" and ext in RASTER:
            name = Path(name).stem + ".webp"
        rel = f"img/{KINDS[kind][0]}/{name}"
        if rel in taken and taken[rel] != url:
            sys.exit(f"ERROR: {url} and {taken[rel]} would both be saved as {rel}")
        taken[rel] = url
        seen[url] = rel
        jobs.append((url, kind, rel))
    return jobs


def download(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 404):  # won't get better by retrying
                break
        except Exception as e:  # network hiccup
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last))


def process(data, kind, rel):
    """Bytes to write for this image: resized WebP for items, the original for icons."""
    ext = Path(rel).suffix.lower()
    limit = KINDS[kind][1]
    if ext == ".svg":
        if b"<svg" not in data[:2000].lower() and b"<svg" not in data.lower():
            raise RuntimeError("not an SVG")
        return data
    from PIL import Image  # imported here so --list works without Pillow

    img = Image.open(io.BytesIO(data))
    img.load()
    if limit is None:  # icons: keep format, only shrink the oversized ones
        if max(img.size) > 256:
            img.thumbnail((256, 256), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="PNG", optimize=True)
        return out.getvalue()
    img = img.convert("RGBA")
    img.thumbnail((limit, limit), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=85, method=6)
    return out.getvalue()


def load_manifest():
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return {}


def write_manifest(manifest):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="show what is saved and what is missing; no downloading")
    ap.add_argument("--force", action="store_true", help="fetch and process everything again")
    ap.add_argument("--from-dir", metavar="DIR", help="read images from this folder (by wiki file name) instead of downloading")
    args = ap.parse_args()

    jobs = plan()
    manifest = load_manifest()
    todo = [j for j in jobs if args.force or not (DOCS / j[2]).exists()]
    print(f"{len(jobs)} images used by the site; {len(jobs) - len(todo)} already saved, {len(todo)} to fetch.")
    if args.list:
        for url, kind, rel in jobs:
            print(("  saved   " if (DOCS / rel).exists() else "  MISSING ") + rel + "   <-  " + url)
        return 0
    if not todo:
        write_manifest({u: r for u, k, r in jobs if (DOCS / r).exists()})
        print("Nothing to do.")
        return 0

    src_dir = Path(args.from_dir) if args.from_dir else None
    failures = []
    for n, (url, kind, rel) in enumerate(todo, start=1):
        try:
            if src_dir:
                f = src_dir / wiki_file_name(url)
                if not f.exists():
                    raise RuntimeError(f"{f.name} not found in {src_dir}")
                data = f.read_bytes()
            else:
                data = download(url)
            out = process(data, kind, rel)
            dest = DOCS / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(out)
            print(f"  [{n}/{len(todo)}] {rel}  ({len(out) / 1024:.0f} KB)")
        except Exception as e:  # keep going; report at the end
            failures.append((url, str(e)))
            print(f"  [{n}/{len(todo)}] FAILED {url}: {e}")
        if not src_dir:
            time.sleep(DELAY)

    write_manifest({u: r for u, k, r in jobs if (DOCS / r).exists()})
    saved = sum(1 for u, k, r in jobs if (DOCS / r).exists())
    print(f"\nDone: {saved}/{len(jobs)} images are saved in docs/img/. Wrote {MANIFEST.relative_to(ROOT)}.")
    if failures:
        print(f"{len(failures)} could not be fetched (the site keeps using their wiki links):")
        for u, why in failures:
            print("  ", u, "-", why)
        return 2
    print("Next: python tools/build_gear.py   (copies the list into docs/gear-data.js)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
