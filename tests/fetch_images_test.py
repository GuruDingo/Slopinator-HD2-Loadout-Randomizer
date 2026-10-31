"""Tests for tools/fetch_images.py + the image handling in tools/build_gear.py.
No network: a scratch copy of the project is filled from a folder of made-up pictures (--from-dir).
    python tests/fetch_images_test.py        (needs Pillow: pip install pillow)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("(skipping image tool tests: Pillow not installed - run `pip install pillow`)")
    sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
failed = 0


def check(label, cond, extra=""):
    global failed
    print(("  ok   " if cond else "  FAIL ") + label + ("" if cond else "  -> " + str(extra)))
    failed += not cond


def run(cwd, *args):
    return subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True, text=True)


with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp) / "proj"
    (work / "docs").mkdir(parents=True)
    (work / "tools").mkdir()
    for f in ("hd2gear.csv", "hd2warbonds.csv", "hd2tags.csv"):
        shutil.copy(ROOT / f, work / f)
    for f in ("app.js", "engine.js", "index.html", "style.css"):
        shutil.copy(ROOT / "docs" / f, work / "docs" / f)
    for f in ("build_gear.py", "fetch_images.py"):
        shutil.copy(ROOT / "tools" / f, work / "tools" / f)

    sys.path.insert(0, str(ROOT / "tools"))
    import fetch_images as fi  # noqa: E402

    jobs = fi.plan()
    check("every image the site uses is planned, once each", len({u for u, _, _ in jobs}) == len(jobs) and len(jobs) > 220, len(jobs))
    check("all 13 armor-penetration icons are planned", sum(1 for u, _, _ in jobs if "Armor_AP" in u) == 13)
    check("a /thumb/ address is saved under the plain file name", any(r == "img/icons/Longshot_Title_Icon.png" for _, _, r in jobs))
    check("raster pictures become .webp, SVGs (the stratagem icons) and icons keep their format",
          all(r.endswith(".webp") for u, k, r in jobs if k != "icons" and not u.endswith(".svg"))
          and all(r.endswith(".svg") for u, k, r in jobs if u.endswith(".svg"))
          and any(r.endswith(".png") for u, k, r in jobs if k == "icons"))

    # made-up source pictures, named like the wiki files
    src = Path(tmp) / "src"
    src.mkdir()
    for url, kind, rel in jobs:
        name = fi.wiki_file_name(url)
        if name.endswith(".svg"):
            (src / name).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
        else:
            Image.new("RGBA", (800, 400), (200, 30, 30, 255)).save(src / name, "PNG")
    (src / "Armor_AP4_Icon.png").unlink()  # one picture is "missing"

    r = run(work, "tools/fetch_images.py", "--from-dir", str(src))
    check("a missing source is reported and gives exit code 2, the rest are saved", r.returncode == 2 and "Armor_AP4_Icon.png" in r.stdout, r.stdout[-400:])
    man = json.loads((work / "docs/img/manifest.json").read_text())
    check("the manifest lists everything that was saved, and not the failure", len(man) == len(jobs) - 1 and not any("Armor_AP4_Icon" in u for u in man), len(man))
    item = next(rel for u, k, rel in jobs if k == "items" and rel.endswith(".webp"))
    im = Image.open(work / "docs" / item)
    check("item pictures are shrunk to at most 320px", im.format == "WEBP" and max(im.size) <= 320, im.size)

    r = run(work, "tools/fetch_images.py", "--from-dir", str(src))
    check("a second run only fetches what is still missing (1 file)", "1 to fetch" in r.stdout, r.stdout[:200])
    shutil.copy(next(src.glob("Armor_AP5_Icon.png")), src / "Armor_AP4_Icon.png")
    r = run(work, "tools/fetch_images.py", "--from-dir", str(src))
    check("...and then everything is saved and it exits cleanly", r.returncode == 0 and len(json.loads((work / "docs/img/manifest.json").read_text())) == len(jobs), r.stdout[-300:])

    r = run(work, "tools/build_gear.py", "--bundle")
    check("the build copies the saved images into gear-data.js", r.returncode == 0 and f"{len(jobs)} saved images" in r.stdout, r.stdout[-300:])
    js = (work / "docs/gear-data.js").read_text()
    check("gear-data.js maps wiki addresses to saved files", '"https://helldivers.wiki.gg/images/Armor_AP5_Icon.png":"img/icons/Armor_AP5_Icon.png"' in js)
    bundle = (work / "dist/hd2-randomizer.html").read_text()
    check("the single-file build embeds the pictures, so it works offline", "data:image/webp;base64," in bundle and "data:image/svg+xml;base64," in bundle and '"img/items/' not in bundle)

    (work / "docs/img/icons/Armor_AP5_Icon.png").unlink()
    r = run(work, "tools/build_gear.py")
    check("a manifest entry whose file has gone is ignored by the build", r.returncode == 0 and "Armor_AP5_Icon.png\":\"img" not in (work / "docs/gear-data.js").read_text())

print("\n" + ("image tool tests FAILED" if failed else "image tool tests passed"))
sys.exit(1 if failed else 0)
