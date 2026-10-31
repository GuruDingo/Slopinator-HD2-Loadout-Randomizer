# Helldivers 2 Slopinator

A loadout randomizer fan project.

**Use it online: https://gurudingo.github.io/Slopinator-HD2-Loadout-Randomizer/**

## Preface: A Note from the "Author"

What was once an experimental attempt at learning how to use AI to utilize some small amount of Python coding in an otherwise low-coding work environment has now become an absolute failure on nearly all fronts. I learned no Python, my co-workers proved AI's applications elsewhere without my input, and this project ended up pivoting out of any professionally usable coding language entirely. 

...but hey, the tool ended up working.

**The Slopinator** is a vibe-coded nonsense project that creates customizable, randomized loadouts for Helldivers 2. It allows you to specify rules to create well rounded, effective loadouts, randomly generated based on your pool of unlocked weapons. It runs in a static website, entirely in the visitor's browser. No server, no accounts, nothing to host except the files in `docs/`.

Is it too good to be true? Hell no, I participated in the boiling of oceans and poisoning of communities in making this thing. It is our AI nightmares made true, regurgitating a half-baked vision into JavaScript nightmares. Its internal logic is barely known to me, its end result is hardly worth the trouble. By the time I had come to regret its creation, I had already gone too far to stop. The road to damnation is paved with good intentions, and while I stand by the idea I set out to make real, I feel shame at the road's end, for I earned my reward and learned nothing for it.

It deserves no praise or love, but may it amuse you, my fellow divers. May the fun it brings you make it worth it some day.

 - GuruDingo

## Feedback and contributing

Found a bug or wrong data? Use the **Report a bug / wrong data** link at the bottom of the page, or open an issue in this repository (a GitHub account is needed; please don't include personal information). This is a personal fan project: the code and data are maintained by the repository owner, and pull requests are not being accepted. Suggestions are welcome as issues.

## Layout

```
hd2gear.csv            gear database - you edit this (Excel is fine)
hd2warbonds.csv        warbond keys + display names, in display order
hd2tags.csv            tag display titles, short descriptions, rule-builder sections (group) + pill colours and order
hd2ids.lock.json       every item id that has shipped (kept by the build; see "Permanent ids")
tools/build_gear.py    validates both CSVs and writes docs/gear-data.js
tools/fetch_images.py  saves the wiki images into docs/img/ (see "Saved images")
docs/                  the website (this folder is what gets published)
  index.html  style.css  app.js        page + UI
  engine.js                            generation rules
  gear-data.js                         GENERATED - don't edit by hand
  img/                                 saved copies of the wiki images + manifest.json (made by fetch_images.py)
tests/                 rule tests, seeded regression test, UI smoke test (run_all.js runs them all)
```

## Updating the gear (new content from the wiki)

**Game version note.** The line under the page title ("Updated for Helldivers 2 version ...") is the `game-version` paragraph in `docs/index.html`. Change its text by hand whenever the gear is brought up to date with a new game patch (the wiki's Game Version page lists the current number).

Do this when a release adds weapons, stratagems or a warbond. The wiki's page for each item has what you need.

1. **Collect the data for each new item**: name, category (`primary`, `secondary`, `throwable`, `support`, `backpack`, `vehicle`, `eagle`, `orbital`, `sentry`, `defensive`), the warbond it belongs to, its picture address (the weapon's "Render" image, or the stratagem icon image), and its armor penetration (below).
2. **Add a row to `hd2gear.csv`** (Excel is fine; keep the file's line endings). Columns: `id` (permanent: the highest id so far + 1, see "Permanent ids"), `category`, `name`, `nicknames` (lower case, comma separated, each unique across the game), `tags`, `factions` (`any`, or a list of `bug`, `bot`, `squid`), `warbond` (a key from `hd2warbonds.csv`, or `base`), `img_url` (the wiki address), `armor_pen`, `release_date` (YYYY-MM-DD, the day it was added to the game), `menu_order` (optional: the item's place inside its warbond block on the My Gear list, 1, 2, 3..., unique per warbond; blank items follow in file order; filled in for the six Requisition shops, in the game's own menu order, and for Super Citizen/Event Rewards; a retired item keeps its slot, so it returns to the same place if it comes back) and `always_owned` (`yes` or blank: counts as owned whatever the warbond, used for MG-43 and Orbital Precision Strike, which sit in the Patriotic Administration Center and Bridge shops but are free from the start). Tags and factions are judgment calls; copy a similar item. A new item gets the next free id (highest + 1) and can go anywhere in the file (the end is easiest); the order of the rows doesn't matter, because release order is the `release_date` column.
   - `armor_pen` is the main attack's armor-penetration icon number (-1 no hitbox, 0 unarmored, 2 light, 3 medium, 4 heavy, 5-10 anti-tank I-VI, 11 indestructible), two numbers joined by `/` for a two-mode weapon (`2/4`), blank for something that does no damage. For stratagems, use the AP icon the wiki page leads with, not the structure's own armor (`AV`) icons.
3. **If there is a new warbond**: add a row to `hd2warbonds.csv` (key, display name; the key is what the items' `warbond` column uses), and add its title icon to `WARBOND_ICONS` in `docs/app.js`. Only a new Requisition shop needs more: add its key to `warbondPillName` and `WARBOND_GROUPS` in `docs/app.js` (follow the existing entries as a pattern). The UI tests work out the item count from the data, but they still hard-code the number of warbonds (35) and top-level My Gear blocks (30), so those two numbers need updating when a warbond is added.
4. **Rebuild**: `python tools/build_gear.py`. It checks for typos (unknown category or warbond, duplicate names or nicknames, bad `armor_pen`) and rebuilds `docs/gear-data.js`; it writes nothing if it finds an error. Warnings about a missing picture or `armor_pen` are only reminders.
5. **Save the new pictures**: GitHub's Actions tab -> "Fetch images" -> Run workflow (or `python tools/fetch_images.py`), then merge the `images-fetched` branch it creates. Only missing files are downloaded. Until that is done the new items show their wiki pictures, so nothing breaks. See "Saved images".
6. **Check the tags** (this is a manual step, not part of the build): run `python tools/tag_checks.py`. It flags missing implied tags and tags used by fewer than three items; nothing is changed automatically.
   - A new **meme tag** (an elemental or themed build tag such as fire, arc, gas, stealth, explosive, laser or plasma) also needs a row in `hd2tags.csv` with a `group` (the section it sits under in the rule builder's dropdowns, e.g. Damage type), a title, a one-line `description` (shown under the dropdown with the item count and a few examples), a `pill_color` (like `#c8541a`) and a `pill_order` (the next free number; the lowest is leftmost on a card); all meme tags get pills. Any other new tag only needs a row with a group, a title and a description (leave `pill_color` and `pill_order` blank for no pill) if it should appear in the Rules dropdown. Sections appear in the order they first show up in the file, and tags appear in file order inside each section (so you decide the order). The build checks for duplicate tags, missing titles, descriptions or groups, malformed colours and clashing pill orders.
7. **Re-save the odds baseline and run every test**: `node tests/regression.js --update-baseline`, then `node tests/run_all.js`. New items change the odds, so the regression test's baseline needs refreshing after an intentional change like this.
8. **Publish**: commit the CSVs, `docs/gear-data.js`, `docs/img/` and `tests/baseline.json` on a branch, open a pull request (the test run attaches a downloadable build so you can try it first), merge it, and hard-refresh the live site.

Renaming an item changes the name your saved My Gear ticks and faction edits are keyed by, so those items will show as new (unticked) in a browser that had saved settings.

## Trying it locally

Open `docs/index.html` in a browser (double-click works - no server needed), or run
`python tools/build_gear.py --bundle` to get one self-contained file, `dist/hd2-randomizer.html`,
that you can send to a friend as-is.

## My Gear: warbond groups

The six Requisition shops are shown under one collapsible **Requisition** header (with the Requisition Slip icon and its own Own / Block buttons and count), and inside it each shop appears by its short name (Hangar, Bridge, ...). The data is unchanged: the CSV still calls them `Requisition: Hangar` etc., which is what search and the loadout-card pill use, so typing "requisition" still finds all of them. Which warbonds group together is the `WARBOND_GROUPS` list in `docs/app.js`. The merged Super Citizen/Event Rewards warbond has two pill labels: the MP-98 Knight reads **Super Citizen Edition** and the other items read **Event Reward** (`itemPillName` and `warbondPillName` in `docs/app.js`).

## What the page stores

Everything stays in the visitor's browser (localStorage): `hd2_tracker` (items owned), `hd2_blocked` (items you have
blocked), `hd2_factions` (your edits to which factions each item is recommended against; only items that differ from the CSV) and `hd2_settings` (faction, removed default rows, edited rows, your own rules and odds rules). The randomizer rolls from owned items that are not blocked.
Base Game gear is always owned. A browser with no saved data starts with everything owned.

**Export / import.** On the My Gear tab, **Export my data** downloads one JSON file (`hd2-slopinator-YYYY-MM-DD.json`) with the owned and blocked items, faction edits and the Rules settings. **Import my data** reads such a file back (after a confirmation, since it replaces what is saved here), so you can move to another browser or share a setup. It only replaces the sections that are in the file, everything is keyed by permanent item id, and files over 2 MB or from a newer format version are refused.

## Publishing on GitHub Pages

Repository -> Settings -> Pages -> Source: "Deploy from a branch" -> Branch `main`, folder `/docs` -> Save.
The site appears at `https://<your-user>.github.io/<repo-name>/` after a minute or so.

## Saved images

The page shows pictures from the Helldivers wiki: item art (about 200), the faction emblems, the warbond title icons, the Requisition slip and the 13 armor-penetration icons. `tools/fetch_images.py` saves them all into `docs/img/` so the published site serves its own copies and keeps working if the wiki changes a file or blocks hotlinking.

```
pip install pillow                       # once, for resizing
python tools/fetch_images.py             # download what is missing (about 250 files, a few minutes; polite rate limit)
python tools/build_gear.py               # copies the list into docs/gear-data.js
python tools/fetch_images.py --list      # what is saved / still missing, no downloading
python tools/fetch_images.py --from-dir D   # use pictures you downloaded yourself into folder D (by wiki file name)
```

- The wiki address stays in the CSVs as the source. The fetch writes `docs/img/manifest.json` (wiki address -> saved file); the build copies it into `docs/gear-data.js` as `HD2_DATA.images`, and the page uses the saved copy of any picture that has one, otherwise the wiki link. So a half-finished run never breaks the site.
- Item art is shrunk (320 px longest side) and saved as WebP; SVGs (all the stratagem icons) and the small icons are kept as they are. Files that already exist are skipped (`--force` redoes them).
- If a download fails (the script says which), the site keeps using that wiki link; run it again later.
- **No computer needed:** Actions tab -> "Fetch images" -> Run workflow. It runs the same script on GitHub, saves the pictures to a branch called `images-fetched` and attaches them to the run as a download; then open a pull request from that branch.
- The single-file build (`dist/hd2-randomizer.html`) embeds the saved pictures, so it works offline (several MB).
- When you add an item with a new `img_url`, or a new wiki image in `app.js`, run the fetch again.
- The pictures belong to Arrowhead Game Studios and come from the community-run [Helldivers Wiki](https://helldivers.wiki.gg/); this is an unofficial fan project.

## Tests

```
npm install jsdom                 # once, for the UI test (not needed to run the site)
node tests/run_all.js             # rebuild + every test, about a minute
```

`run_all.js` runs, in order: the build (`tools/build_gear.py --bundle`), `fetch_images_test.py` (the image tool, offline; needs Pillow, skipped without it), `engine_rules.js` (best-effort builds, lock
exemptions, flagged rules), `regression.js` and `ui_smoke.js` (clicks through the page in jsdom).

`regression.js` draws 2000 seeded builds for each scenario in `tests/scenarios.json` and checks (1) invariants on
every build (4 distinct stratagems, locks kept, exclusions and unticked warbonds respected, no unmet rules on
plain unlocked builds, every scenario still feasible) and (2) per-item appearance rates against
`tests/baseline.json`. It catches rule-sized changes (loosening one rule moved some items by |z| ~ 15) but not
tiny tilts of a couple of percent. **After an intentional rule change, or after editing the CSVs**, re-save the baseline:
`node tests/regression.js --update-baseline` (if the CSVs changed the odds check is skipped with a notice until you do).


## Editing faction recommendations

On the My Gear tab, the **Edit factions** switch (top right) shows three ticks on every item: **T**erminid, **A**utomaton, **I**lluminate. They show the faction emblems (the same emblems are on the faction buttons on the Randomizer tab; Any uses the Super Earth emblem, white) and start from the CSV's `factions` column (`any` = all three ticked). The emblems are linked from the Helldivers wiki like the item images and are flattened and tinted with CSS filters in the faction colours (dark on the selected faction button) - if you ever change a faction colour, regenerate its filter in `style.css`; if one can't load, the tick shows T / A / I and the button just shows its name. Change them and the randomizer, the pool counts and the Randomizer-tab pool line use your version. Details:
- All three ticked is the same as `any`. With none ticked an item only rolls when the faction is Any.
- Edited items get a coloured edge and a ↺ button that puts that one item back; **Reset to defaults** (only shown in this mode) resets everything, needs a second click to confirm, and while the search box is filtering it only resets the items shown.
- Each warbond header has its own three ticks (shown in this mode): ticking one sets that faction for every item of the warbond (respecting the search box, so "tick Automaton for everything shown" works too). A tick shows as partly filled when only some of the items have it.
- **Enable for all factions** (next to Reset) ticks all three for every item that isn't already for all factions, with the same second-click confirmation and the same "shown only" behaviour while searching. It counts as an edit for any item whose CSV default was narrower, and Reset to defaults undoes it.
- Only differences from the CSV are saved (`hd2_factions`), so when the CSV changes its defaults, items you haven't edited follow the new CSV. Edits are keyed by the item's permanent id, so renaming an item keeps its edit (older saves keyed by name are converted the first time the page loads).
- Results already on screen are not changed; the next Generate or reroll uses the new lists.

## Locking and rerolling slots in the results

Each card in a generated loadout has a lock toggle (🔒/🔓) and a reroll button (🎲); each loadout has a **Reroll all unlocked** button.
- Locked slots are kept; the Locks panel's entries start out locked.
- 🎲 rerolls just that slot (always a different item when another choice exists) and keeps the other six exactly as they are, so the other six slots count as locked for that build. The usual rules still apply as far as the slot allows, and anything it can't meet is flagged.
- **Reroll all unlocked** keeps the locked slots and rebuilds the rest as a whole, so the rules can be met again.
- Locks on cards belong to that loadout only (they are not copied into the Locks panel, and Generate starts fresh). Rerolls use the faction, rules (default rows, edits and your own) the loadout was generated with, but your current My Gear pool.

## Rules panel

The **Rules** section of the randomizer page is one list. Every rule the engine checks is a row, and you can add your own.

**Default rows.** All 17 default rows start as dim rows (16 rules plus one odds row, below), listed by priority tier (the same ranking used when a build can't meet everything). **Core**: backpack, support weapon, anti-tank, chaff killer, base breaker, never a regular and an expendable support weapon together. **Preferred**: medium killer, panic weapon, two base breakers, the hand-held shield rule, no supply pack with 2+ no-ammo items, at most one regular support weapon, expendable support weapons at most 2, Vehicle <= 1, Eagle <= 2, Mines <= 1. The list comes from `Engine.RULES`, so the panel can't drift from the engine. The **in-game limits** (one FRV, one tank, one exosuit) are shown with a lock and can't be removed.

Eight of the rows are plain tag counts (`Anti-Tank >= 1`, `Vehicle <= 1`, ...; the `Engine.RULES` entries with a `preset`). Those can be **edited in place**: add a rule for the same tag with the same form and it builds on the row, so "at most 2" on `Anti-Tank >= 1` gives `Anti-Tank 1-2`, and "at most 2" on `Vehicle <= 1` makes `Vehicle <= 2`. A clash with a default number (Eagle "at least 3" against the default "at most 2") makes the default give way; a clash with your own earlier rule is refused. An edited row counts as one of your own requirements (Overwrite, the top tier) and editing it back to the default number makes it a default row again. The other eight rows (shield, supply, chaff in primary / secondary, support weapon, two base breakers, and the three support limits) can be removed but not edited; to change one, remove it and build your own version in Add your own rule.

The **x** on a row removes it (a removed default stays removed). **Reset to system defaults** (shown once a default row was changed or removed) puts every default row back; rules you added stay. **Clear custom rules** (shown while you have added rules) does the opposite: it removes everything you added and leaves the default rows as they are, edited or not. The summary line counts what differs ("2 added, 1 edited, 3 off").

**Your own rules** all come from one form, the collapsible **Add your own rule** at the top of the panel, above the rows. Pick what to count (a tag, a category or a group), where (the whole loadout or a slot), and **at least**, **at most** or **exactly** N (0 to 7; "at least 0" is refused). A plain count of one tag over the whole loadout (say Anti-Tank at most 2) edits that tag's row instead of adding a separate rule: "at least" and "at most" on the same tag make a range (`Chaff Killer 2-3`), a default row's number is replaced (and its cap lifted when you ask for more), and "exactly 0" bans the tag - for the backpack tag it also replaces "exactly one backpack". Everything else becomes a rule of its own:

- A **selector** says what is counted: a tag, a category (primary, secondary, throwable, support, backpack, vehicle, eagle, orbital, sentry, defensive); there are no named groups, only tags: `noammo` (charge or expendable primaries, secondaries, support weapons and Rovers) and `nonexp` ("Non-Expendable Support": support weapons that aren't expendable, no pill). The tag check makes sure every support weapon has exactly one of `expendable` / `nonexp`.
- A **scope** says where: the whole loadout, weapons, primary + secondary, stratagems, or one weapon slot.
- A rule is a count that must hold (at least / at most / exactly), optionally preceded by up to two **if** conditions ("if Eagle >= 2 (stratagems), then Sentry <= 0"). If the "if" part doesn't hold, the rule isn't checked.

**Locks win.** A locked item is never swapped out for a rule. Default rows the locks break stay silent (a hand-held shield locked with no one-handed primary or melee weapon is not nagged about; locking an all-stratagem build waives the support rule). A rule of your own that the locks make impossible is built as well as possible and listed in the banner above the loadout ("Rule: Anti-Tank >= 7 (this build has 2)"). Rules that can't all hold are treated the same way.

Rows, edits, removals and your own rules are saved in this browser in `hd2_settings` (`disabledRules`, `requirements`, `customRules` and `weights`, validated on load; damaged entries are skipped) and cleared by Reset options. Rerolls use the rules the loadout was generated with. In code: `generateLoadout(..., { disabledRules, requirements, customRules, weights })`.

## Armor penetration (`armor_pen` column)

`hd2gear.csv` has an `armor_pen` column for every weapon (primaries, secondaries, throwables and support weapons) and for every stratagem that attacks (sentries, Eagles, orbitals, vehicles, mines, emplacements, the Hellbomb and the attacking Guard Dogs); stratagems that do no damage (smoke strikes, shields, supply, jump, hover and warp packs) are blank. It holds the main attack's armor-penetration level as the wiki's icons number it, and an item with two attacks lists both, e.g. `2/4`. For stratagems the value is the AP icon the wiki's page leads with (the strike's main projectile or the mounted weapon's direct hit), not the separate explosion or fire entries, and never the structure's own armor value (the wiki's `AV` icons). Where a strike's projectile and its explosion differ, the value follows what matters in play. Explosion-based strikes use the explosion's core AP (Eagle Airstrike 5, not the projectile's 7; Orbital EMS Strike 6, its EMS effect); the projectile-based ones keep the projectile (Eagle 110mm Rocket Pods 7, Orbital Precision Strike 8, Orbital Railcannon Strike 7), and a few items list two (Maelstrom `4/5`, EMS Mortar Sentry `3/6`). Exosuits and vehicles with two weapons list both (Patriot `3/6`, Lumberer `4/6`, Bastion `4/8`). On the card the icons sit at the right of the item name. `tools/build_gear.py` checks the format (whole numbers from -1 to 11 joined by `/`), warns about a weapon with no value, and writes it to `docs/gear-data.js` as `armorPen: [n, ...]`. Each weapon card on the Randomizer tab shows the icon for each level, side by side with a `/` between them for a two-mode weapon (hover for the name). If an icon can't load, the level's name is shown as text instead.

Values came from the wiki's Weapons page (primaries, secondaries, throwables) and each support weapon's own page, with a few single-attack support weapons taken from the wiki's Damage Comparison table (MGX-42, MG-206, LAS-98, CQC-1, TX-41, B/MD C4, CQC-9, B/FLAM-80, AMW-20). Where a weapon has several attacks (a rocket plus its explosion, a rifle plus an underbarrel launcher) the value is the weapon's main/highest attack as the wiki lists it, so a few explosive weapons are rated by the explosion. The three support weapons the wiki's Weapons page shows with two icons were set by hand from it: Recoilless Rifle `5/6`, Epoch `4/5` and Defoliation Tool `3/5`. Re-check a number against the wiki whenever it looks wrong; the game changes these in patches.

Icons come from the wiki (saved locally once `tools/fetch_images.py` has been run; see "Saved images"):

| n | Name | Icon |
|---|---|---|
| -1 | No Hitbox | `https://helldivers.wiki.gg/images/Armor_AP-1_Icon.png` |
| 0 | Unarmored | `https://helldivers.wiki.gg/images/Armor_AP0_Icon.png` |
| 1 | Very Light | `https://helldivers.wiki.gg/images/Armor_AP1_Icon.png` |
| 2 | Light | `https://helldivers.wiki.gg/images/Armor_AP2_Icon.png` |
| 3 | Medium | `https://helldivers.wiki.gg/images/Armor_AP3_Icon.png` |
| 4 | Heavy | `https://helldivers.wiki.gg/images/Armor_AP4_Icon.png` |
| 5 | Anti-Tank I | `https://helldivers.wiki.gg/images/Armor_AP5_Icon.png` |
| 6 | Anti-Tank II | `https://helldivers.wiki.gg/images/Armor_AP6_Icon.png` |
| 7 | Anti-Tank III | `https://helldivers.wiki.gg/images/Armor_AP7_Icon.png` |
| 8 | Anti-Tank IV | `https://helldivers.wiki.gg/images/Armor_AP8_Icon.png` |
| 9 | Anti-Tank V | `https://helldivers.wiki.gg/images/Armor_AP9_Icon.png` |
| 10 | Anti-Tank VI | `https://helldivers.wiki.gg/images/Armor_AP10_Icon.png` |
| 11 | Indestructible | `https://helldivers.wiki.gg/images/Armor_AP11_Icon.png` |

## Item caps and in-game limits

While filling stratagem slots the engine keeps a few item caps: one non-expendable support weapon, two expendable ones (never mixed with a regular one), one backpack-slot item, one vehicle, two Eagles, one mine. A **required tag overrides the cap for its own tag** - e.g. `Eagle 3` allows three Eagles, `mines 2` allows two mines, `vehicle 3` allows several vehicles. Requiring one tag never loosens a different cap, and locks still bypass the caps.

The exception is the **in-game limits**: only one FRV, one tank and one exosuit can be brought, and the same stratagem can never sit in two slots. These always win, so `vehicle 4` is unmeetable (it is built as well as possible and flagged), and locking two FRVs/tanks/exosuits (or the same stratagem twice) is rejected with an error. Note that `backpack 2` also relaxes the backpack cap (it is not treated as an in-game limit), which can give a build the game would not allow; it is flagged as an unmet backpack rule.

## Tag consistency checks

Not part of the build. Run `python tools/tag_checks.py` after you change `hd2gear.csv`; it only flags problems and never edits the CSV. See `tools/tag_checks.py` and `tools/tag_rules.json`.

## When the rules can't all be met

**Empty slots and best-effort builds.** The generator always gives you the best loadout it can from what you own, and tells you which rules it could not follow, rather than refusing. Only the game's own limits are never broken: one FRV, one tank, one exosuit, and no stratagem twice. Everything else (the default support-weapon and vehicle limits, your own Rules) gives way when you do not own enough gear, and the rules that gave way are listed in the warning above the loadout. A player who owns (and hasn't blocked) fewer than four stratagems can still bring a loadout in the game, so a slot that cannot be filled shows an **Empty Slot** card (a grey Super Earth emblem, no pills, no lock); the same goes for a weapon slot with nothing owned for it. A stratagem that is merely off-faction is still used (the faction is relaxed first), and rerolling never swaps an item for an empty slot.

Locks, warbond choices, exclusions or requirements can make some guarantees impossible. The engine then
tries, in order: (1) a build that follows every rule, (2) the same with the faction relaxed to "any"
(off-faction picks are flagged), (3) the build that misses the least important rules (priority tiers: **Overwrite** - your own rules > **Core** - one backpack, a support weapon, anti-tank, chaff, base breaker, never mixing regular and expendable supports > **Preferred** - medium killer, panic weapon, two base breakers, the hand-held shield rule, no supply with 2+ no-ammo, the item limits), fewer misses breaking ties. Case 3 is completed anyway and
the missed rules are listed above the loadout. Locking all four stratagem slots waives the "exactly one
backpack" and "at least one support weapon" rules. Only a build with *no* eligible items for a slot is an error.

**Odds rules.** Besides pass / fail rules there are odds rules (Rules > Add your own rule > Odds): pick a tag or category, where it is rolled (every slot, or one slot / group of slots) and a multiplier from 0.05 to 20. 1 is normal, 0.5 is half as likely, 2 is twice as likely. They only change the random rolls (locks, requirements and the repair step ignore them), and there is one per selector and place (a new one replaces the old). The default odds row, **melee secondaries at a third of the usual odds** (`meleeWeight`, `x0.333`), is an ordinary row: remove it for normal odds, or add an odds rule for Melee in Secondary to change the number (giving it 0.333 again puts the default row back). Odds rules are not ranked in the priority tiers. In the engine they are `Engine.RULES` entries with `kind: "weight"` and the `weights` option.

**Repair step.** Before falling back to 2 or 3, a build that failed all 1000 random attempts is *repaired*: the engine takes the best attempt and tries every other eligible item in each slot you have not locked, keeps the single swap that helps most, and repeats (up to 12 rounds) until every rule holds or no swap helps. Swapped-in stratagems still obey the item caps and the in-game limits, locked slots are never touched, and it only runs when random rolling has already failed. This is what makes requests like "Fire = 4 stratagems" work: they are nearly impossible to roll but take a handful of swaps to fix. `generateLoadoutRelaxed({ repair: false })` turns it off (the parity test does that).

## Permanent ids

Every item's `id` in `hd2gear.csv` is permanent (2026-10-31). Players' browsers save their owned / blocked items and faction edits by id (`hd2_tracker`, `hd2_blocked`, `hd2_factions`), so an id must never be renumbered, reused or deleted; renaming an item is fine and keeps everyone's settings. The rules:

- A new item gets the next free number (highest id + 1). Row order is free; release order is the `release_date` column.
- To retire an item, set its `factions` to `none` rather than deleting the row.
- `tools/build_gear.py` keeps `hd2ids.lock.json` (every id that has shipped, with the item's name and category) and refuses to build if an id disappears, changes category (a sign the rows were renumbered), is duplicated, or a new id is not above the highest one that has shipped. It prints a note when an item was renamed. Commit the lock file with the CSV.
- Two names that were changed before ids existed (M-102 Fast Recon Vehicle -> Gunner FRV, G/40-K Meltamine -> Melta Mine) are mapped in `LEGACY_NAMES` in `docs/app.js` so old saves still find them.
