// ui_smoke.js - loads the bundled page (dist/hd2-randomizer.html) in a fake browser (jsdom) and clicks through the main features.
//
//   npm install jsdom          (once, from the repo root; not needed to run the site itself)
//   python tools/build_gear.py --bundle && node tests/ui_smoke.js
//
// Not a visual test: it checks that the page builds, buttons do what they should, errors show up
// for bad input, and My Gear saves its state.
const FREE_SOURCES = ["base","req_p","req_o","req_h","req_b","req_e","req_r","super_citizen"];
const path = require("path");
const fs = require("fs");
const { JSDOM } = require("jsdom");

// The single-file bundle has every script inlined, so jsdom needs no file loading. Build it first:
//   python tools/build_gear.py --bundle
const indexFile = path.resolve(__dirname, "..", "dist", "hd2-randomizer.html");
// Once images are saved (docs/img), the bundle embeds them and every src would be a data: address. Most checks are about
// which picture goes where, so they run on the bundle with that list emptied (every src is then the wiki address);
// the "Saved images" section below covers the saved-copy behaviour, and the real bundle is checked at the end of it.
const rawBundle = fs.readFileSync(indexFile, "utf8");
const bundleHtml = rawBundle.replace(/"images": \{[\s\S]*?\n \}\n\};/, '"images": {}\n};');
let failed = 0;
function check(label, cond, extra) {
  console.log((cond ? "  ok   " : "  FAIL ") + label + (cond || !extra ? "" : "  -> " + extra));
  if (!cond) failed++;
}

(async function main() {
  const dom = new JSDOM(bundleHtml, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  const win = dom.window, doc = win.document;
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.confirm = () => true;
  const $ = (id) => doc.getElementById(id);
  const ACTIVE = win.HD2_DATA.items.filter((i) => i.factions.indexOf("none") === -1).length; // every item that can roll (the tests used to hard-code this number)
  const idOf = (name) => win.HD2_DATA.items.find((i) => i.name === name).id;
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const generate = () => $("controls").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  const setFaction = (v) => {
    doc.querySelector('input[name="faction"][value="' + v + '"]').checked = true;
    doc.querySelector('input[name="faction"][value="' + v + '"]').dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const change = () => new win.Event("change", { bubbles: true });
  const gearBox = (name) => doc.querySelector('#gear-list input[data-item="' + name + '"]');
  const blockBtn = (name) => doc.querySelector('#gear-list .block-btn[data-block="' + name + '"]');
  const rowOf = (name) => gearBox(name).closest(".gear-row");
  const nameStyle = (name) => win.getComputedStyle(rowOf(name).querySelector(".tr-name"));
  const blockBlock = (label) => Array.from(doc.querySelectorAll("#gear-list .wb-block")).find((b) => b.querySelector(".wb-name").textContent === label);
  // what a person sees: skips the red part while it is hidden
  const countText = (block) => Array.from(block.querySelector(".wb-count").childNodes)
    .filter((n) => !n.hidden).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
  const setOwnedItem = (name, on) => { const b = gearBox(name); b.checked = on; b.dispatchEvent(change()); };
  const poolText = () => $("pool-text").textContent;
  const ownOnly = (keys) => { click($("gear-clear")); keys.filter((k) => k !== "base").forEach((k) => click(doc.querySelector('[data-all="' + k + '"]'))); };
  const cards = () => doc.querySelectorAll("#results .item-card, #results .item-card2").length;
  const errors = () => Array.from(doc.querySelectorAll("#messages .msg.error")).map((e) => e.textContent);

  console.log("Page build");
  check("no script errors / HD2Engine loaded", typeof win.HD2Engine === "object");
  check("My Gear: 35 warbonds, the six Requisition shops grouped under one header (30 top-level blocks)", doc.querySelectorAll("#gear-list .wb-block:not(.wb-group)").length === 35 && doc.querySelectorAll("#gear-list .wb-group").length === 1 && doc.querySelectorAll("#gear-list > .wb-block").length === 30, doc.querySelectorAll("#gear-list .wb-block").length);
  check(ACTIVE + " gear rows (every active item)", doc.querySelectorAll("#gear-list .gear-row").length === ACTIVE);
  check("every gear row has a lazy thumbnail from the item's image link", Array.from(doc.querySelectorAll("#gear-list .gear-row")).every((r) => { const i = r.querySelector("img.gear-thumb"); return i && i.getAttribute("loading") === "lazy" && /^https:\/\//.test(i.getAttribute("src")); }));
  { const t = rowOf("AR-23 Liberator").querySelector("img.gear-thumb"); t.dispatchEvent(new win.Event("error"));
    check("a thumbnail that can't load becomes a blank square of the same size", !rowOf("AR-23 Liberator").querySelector("img.gear-thumb") && !!rowOf("AR-23 Liberator").querySelector(".gear-thumb-blank")); }
  check("new browser starts with everything owned", $("grand-total").textContent === ACTIVE + " / " + ACTIVE + " items owned", $("grand-total").textContent);
  check("pool line on the Randomizer tab", new RegExp("Rolling from " + ACTIVE + " of " + ACTIVE + " items\\.").test(poolText()), poolText());
  check("old Warbonds / Exclude sections are gone", !$("warbond-grid") && !$("exclude-input"));
  check("Base Game rows: checked and locked", (() => { const b = Array.from(doc.querySelectorAll("#gear-list .wb-block")).find((x) => /Base Game/.test(x.textContent)); const boxes = Array.from(b.querySelectorAll("input[data-item]")); return boxes.length === 4 && boxes.every((c) => c.checked && c.disabled) && !b.querySelector("[data-all]"); })());
  const DEFAULTS = {}; win.HD2_DATA.items.forEach((i) => { DEFAULTS[i.name] = i.factions.join(","); });
  const defaultOf = (name) => DEFAULTS[name];
  const customCount = () => doc.querySelectorAll("#gear-list .gear-row.fac-custom").length;
  check("first visit wrote the owned list to localStorage", Object.keys(JSON.parse(win.localStorage.getItem("hd2_tracker"))).length === ACTIVE - win.HD2_DATA.items.filter((i) => (i.warbond === "base" || i.alwaysOwned) && i.factions.indexOf("none") === -1).length); // everything except the always-owned Base Game items
  check("7 lock inputs", doc.querySelectorAll("#lock-grid input").length === 7);
  check("datalists filled", $("dl-primary").children.length > 40 && $("dl-strat").children.length > 60);
  check("the rule builder lists the 44 titled tags, in sections from hd2tags.csv, in file order inside each", (() => {
    const tagGroups = Array.from(doc.querySelectorAll('#builder-body .b-row[data-role="must"] optgroup')).filter((g) => g.label !== "Categories");
    const opts = tagGroups.flatMap((g) => Array.from(g.children));
    const t = opts.map((x) => x.textContent);
    const csv = win.HD2_DATA.tags;
    const expectedSections = []; csv.forEach((r) => { if (expectedSections.indexOf(r.group) === -1) expectedSections.push(r.group); });
    return opts.length === 44 && tagGroups.map((g) => g.label).join("|") === expectedSections.join("|")
      && tagGroups.every((g) => Array.from(g.children).every((o, k, a) => csv.find((r) => "tag:" + r.tag === o.value).group === g.label && (k === 0 || csv.findIndex((r) => "tag:" + r.tag === a[k - 1].value) < csv.findIndex((r) => "tag:" + r.tag === o.value))))
      && ["Team Assist", "Fire", "Laser", "Plasma", "Hand-Held Shield", "Explosive", "One-Handed", "Supply", "Support Weapon", "Cooldown", "Shotgun", "SMG", "Special", "Stun", "Smoke", "Jump", "Mech", "FRV", "Tank", "Rover", "Mortar", "Emplacement", "Impact", "No Ammo", "Non-Expendable Support"].every((n) => t.includes(n))
      && !opts.some((x) => ["tag:heal", "tag:taunt", "tag:beam"].includes(x.value)) && opts.some((x) => x.value === "tag:assist");
  })(), Array.from(doc.querySelectorAll('#builder-body .b-row[data-role="must"] optgroup')).map((g) => g.label + ": " + Array.from(g.children).map((x) => x.textContent).join(", ")).join(" | "));
  check("...Expendable and Non-Expendable Support come right after Support Weapon; Hand-Held Shield right after Shield; Charge is titled Cooldown", (() => {
    const t = Array.from(doc.querySelectorAll('#builder-body .b-row[data-role="must"] optgroup option')).map((o) => o.textContent);
    const at = (n) => t.indexOf(n);
    return at("Expendable") === at("Support Weapon") + 1 && at("Non-Expendable Support") === at("Expendable") + 1 && at("Hand-Held Shield") === at("Shield") + 1 && at("Cooldown") >= 0 && at("Charge") === -1;
  })(), "");
  check("autocomplete options carry names only (no category labels)",
    Array.from(doc.querySelectorAll("#dl-strat option")).every((o) => !o.hasAttribute("label")) &&
    $("dl-strat").querySelector("option[value='AC-8 Autocannon']") !== null);
  check("strike-through exists only on blocked rows", (doc.querySelector("style").textContent.match(/[^{}]+\{[^}]*line-through/g) || []).every((r) => /is-blocked/.test(r)));

  const css = doc.querySelector("style").textContent;
  check("tagline under the title", /A Loadout Randomizer Fan-Project/.test(doc.querySelector(".site-header .tagline").textContent));
  check("title is Helldiver Yellow; accent is Super Credit Blue", /color: #FFE900/i.test(css.match(/h1 \{[^}]*\}/)[0]) && /--accent: #70F5FF/.test(css));
  check("only the warning banner still uses the old yellow", (css.match(/[^{}]+\{[^}]*#f0c040/g) || []).every((r) => /rules-warning/.test(r)), (css.match(/[^{}]+\{[^}]*#f0c040/g) || []).join(" | "));
  check("faction colours defined", ["bug: #FF8D1F", "bot: #FF6161", "squid: #CD8AEA"].every((x) => new RegExp('data-faction="' + x.split(":")[0] + '"\\][^}]*' + x.split(" ")[1], "i").test(css)));
  check("My Gear view is always Helldiver Yellow, independent of faction", /#view-gear\s*\{[^}]*--accent:\s*#FFE900/i.test(css));
  check("Terminid Yellow is #FF8D1F", /data-faction="bug"\][^}]*#FF8D1F/i.test(css) && !/FFB901/i.test(css));
  check("theme starts at 'any'", doc.documentElement.getAttribute("data-faction") === "any");

  console.log("Generate");
  generate();
  check("default generate -> 7 cards", cards() === 7, cards());
  check("primary card is the wide one", doc.querySelectorAll("#results .item-card2").length === 1);
  check("no error banner", errors().length === 0, errors());
  $("count").value = "3"; generate();
  check("3 loadouts -> 21 cards + 3 headings", cards() === 21 && doc.querySelectorAll("#results h2").length === 3, cards());
  check("pills follow hd2tags.csv: titles from the CSV, left to right by pill_order", (() => {
    const order = win.HD2_DATA.tags.filter((t) => t.color && t.pillOrder).sort((x, y) => x.pillOrder - y.pillOrder).map((t) => t.title);
    return Array.from(doc.querySelectorAll("#results .tag-row")).every((row) => {
      const names = Array.from(row.querySelectorAll(".tag-pill")).map((p) => p.textContent);
      const idx = names.map((n) => order.indexOf(n));
      return idx.every((v, i) => v >= 0 && (i === 0 || idx[i - 1] < v));
    });
  })(), "");
  setFaction("bot"); $("count").value = "1"; generate();
  check("faction bot generates", cards() === 7);
  check("picking Automatons switches the page theme", doc.documentElement.getAttribute("data-faction") === "bot");
  check("results carry the faction's accent colour", $("results").style.getPropertyValue("--accent").toLowerCase() === "#ff6161", $("results").style.getPropertyValue("--accent"));
  setFaction("squid");
  check("switching faction later leaves existing results in their own colour", $("results").style.getPropertyValue("--accent").toLowerCase() === "#ff6161" && doc.documentElement.getAttribute("data-faction") === "squid");
  setFaction("any");

  console.log("Armor penetration icons");
  $("lock-primary").value = "SMG/FLAM-34 Stoker"; $("lock-strat1").value = "Eagle Airstrike"; $("lock-strat2").value = "AC-8 Autocannon";
  generate();
  const cardOf = (name) => Array.from(doc.querySelectorAll("#results .item-card, #results .item-card2")).find((c) => c.querySelector(".item-name").textContent === name);
  const apSrc = (name) => Array.from(cardOf(name).querySelectorAll(".ap-icon")).map((i) => i.getAttribute("src").replace(/^.*\//, ""));
  check("a two-mode weapon shows both icons, in order, with a separator", apSrc("SMG/FLAM-34 Stoker").join() === "Armor_AP2_Icon.png,Armor_AP4_Icon.png" && cardOf("SMG/FLAM-34 Stoker").querySelectorAll(".ap-sep").length === 1, apSrc("SMG/FLAM-34 Stoker").join());
  check("a single-mode weapon shows one icon (Autocannon = Heavy)", apSrc("AC-8 Autocannon").join() === "Armor_AP4_Icon.png" && cardOf("AC-8 Autocannon").querySelectorAll(".ap-sep").length === 0, apSrc("AC-8 Autocannon").join());
  check("icons come from the wiki and have a readable name", /^https:\/\/helldivers\.wiki\.gg\/images\/Armor_AP4_Icon\.png$/.test(cardOf("AC-8 Autocannon").querySelector(".ap-icon").getAttribute("src")) && /Heavy/.test(cardOf("AC-8 Autocannon").querySelector(".ap-icon").getAttribute("alt")));
  check("an attacking stratagem shows its icon too (Eagle Airstrike = Anti-Tank I)", apSrc("Eagle Airstrike").join() === "Armor_AP5_Icon.png");
  const ic = cardOf("SMG/FLAM-34 Stoker").querySelector(".ap-icon");
  ic.dispatchEvent(new win.Event("error"));
  check("an icon that fails to load is replaced by its name", cardOf("SMG/FLAM-34 Stoker").querySelector(".ap-text") && cardOf("SMG/FLAM-34 Stoker").querySelector(".ap-text").textContent === "Light", (cardOf("SMG/FLAM-34 Stoker").querySelector(".ap-row") || {}).textContent);
  // every weapon in the data produces an icon row on its card
  check("every weapon category has armor data to show", win.HD2_DATA.items.filter((i) => ["primary", "secondary", "throwable", "support"].includes(i.cat)).every((i) => i.armorPen.length >= 1));
  $("lock-primary").value = ""; $("lock-strat1").value = ""; $("lock-strat2").value = "";

  console.log("Pool line follows the faction");
  const validFor = (f) => win.HD2_DATA.items.filter((i) => win.HD2Engine.worksFor(i, f)).length;
  check("any -> 'of N items' with N = every active item", new RegExp("of " + validFor("any") + " items").test(poolText()) && validFor("any") === ACTIVE, poolText());
  for (const [f, adj] of [["bug", "Terminid"], ["bot", "Automaton"], ["squid", "Illuminate"]]) {
    setFaction(f);
    check(f + " -> denominator is the " + validFor(f) + " items valid for that faction", poolText().indexOf("of " + validFor(f) + " " + adj + "-compatible items") !== -1 && validFor(f) < ACTIVE, poolText());
  }
  setFaction("bug");
  click(blockBtn(win.HD2_DATA.items.find((i) => win.HD2Engine.worksFor(i, "bug") && i.warbond !== "base").name));
  check("a blocked bug-valid item shows in the faction line", /1 blocked/.test(poolText()), poolText());
  click($("gear-unblock-all"));
  const botOnly = win.HD2_DATA.items.find((i) => !win.HD2Engine.worksFor(i, "bug") && win.HD2Engine.worksFor(i, "bot") && i.warbond !== "base").name;
  click(blockBtn(botOnly));
  check("blocking an item the faction can't use doesn't change that faction's line", !/blocked/.test(poolText()), poolText());
  click($("gear-unblock-all"));
  check("My Gear's own totals ignore the faction", $("grand-total").textContent === ACTIVE + " / " + ACTIVE + " items owned");
  setFaction("any");

  console.log("Validation");
  $("count").value = "0"; generate();
  check("count 0 -> error", errors().some((e) => /Loadouts must be/.test(e)), errors());
  $("count").value = "1";
  click($("gear-clear"));
  check("own nothing -> only the 6 Base Game items left in the pool", new RegExp("Rolling from 6 of " + ACTIVE).test(poolText()), poolText());
  generate();
  check("only the starting gear -> it still builds (two stratagems, two empty slots), no error", errors().length === 0 && cards() === 7 && doc.querySelectorAll("#results .is-empty").length === 2, errors());
  doc.querySelectorAll('#gear-list .gear-row').forEach((row) => { if (row.querySelector("input").disabled) click(row.querySelector(".block-btn")); });
  generate();
  check("empty pool -> clear error", errors().some((e) => /gear pool is empty/.test(e)), errors());
  click($("gear-unblock-all")); click($("gear-select-all"));
  check("Unblock all + Own everything -> back to everything", new RegExp("Rolling from " + ACTIVE + " of " + ACTIVE).test(poolText()), poolText());
  $("lock-primary").value = "definitely not a gun"; generate();
  check("unknown lock -> error", errors().some((e) => /unknown item/.test(e)), errors());
  $("lock-primary").value = "AC-8 Autocannon"; generate();
  check("wrong-slot lock -> error", errors().some((e) => /can't go in this slot/.test(e)), errors());
  $("lock-primary").value = "";
  $("lock-strat1").value = "Eagle Airstrike"; $("lock-strat2").value = "eagle airstrike"; generate();
  check("duplicate strat lock -> error", errors().some((e) => /more than one stratagem slot/.test(e)), errors());
  $("lock-strat2").value = "";
  $("lock-strat1").value = "M-102 Gunner FRV"; $("lock-strat2").value = "M-103 Supply FRV"; generate();
  check("two locked FRVs -> in-game limit error", errors().some((e) => /only bring one FRV/.test(e)), errors());
  $("lock-strat1").value = "EXO-45 Patriot Exosuit"; $("lock-strat2").value = "EXO-55 Breakthrough Exosuit"; generate();
  check("two locked exosuits -> in-game limit error", errors().some((e) => /only bring one exosuit/.test(e)), errors());
  $("lock-strat1").value = "M-102 Gunner FRV"; $("lock-strat2").value = "EXO-45 Patriot Exosuit"; generate();
  check("one FRV + one exosuit lock is fine", !errors().some((e) => /only bring one/.test(e)), errors());
  $("lock-strat1").value = ""; $("lock-strat2").value = "";

  console.log("Locks, exclusions, requirements");
  $("lock-primary").value = "liberator"; // nickname, lower case
  $("lock-strat1").value = "AC-8 Autocannon";
  generate();
  const names = Array.from(doc.querySelectorAll("#results .item-name")).map((e) => e.textContent);
  check("nickname lock resolved to AR-23 Liberator", names[0] === "AR-23 Liberator", names[0]);
  check("strat 1 locked to Autocannon", names[3] === "AC-8 Autocannon", names[3]);
  check("two slots show as locked", doc.querySelectorAll("#results .lock-btn[aria-pressed=\"true\"]").length === 2);
  $("lock-primary").value = ""; $("lock-strat1").value = "";

  console.log("Slot locks and rerolls");
  const loadoutEls = () => Array.from(doc.querySelectorAll("#results .loadout"));
  const slotNames = (i) => Array.from(loadoutEls()[i].querySelectorAll(".item-name")).map((e) => e.textContent);
  const slotCard = (i, n) => loadoutEls()[i].querySelectorAll(".item-card, .item-card2")[n];
  const lockBtnAt = (i, n) => slotCard(i, n).querySelector(".lock-btn");
  const rerollBtnAt = (i, n) => slotCard(i, n).querySelector(".reroll-btn");
  const rerollAll = (i) => loadoutEls()[i].querySelector(".reroll-all-btn");
  check("form locks come through as locked cards", lockBtnAt(0, 0).getAttribute("aria-pressed") === "true" && lockBtnAt(0, 3).getAttribute("aria-pressed") === "true");
  check("a locked card's reroll button is disabled", rerollBtnAt(0, 0).disabled === true && rerollBtnAt(0, 1).disabled === false);
  check("reroll-unlocked button counts the 5 free slots", /\(5\)/.test(rerollAll(0).textContent), rerollAll(0).textContent);
  let before = slotNames(0);
  click(rerollBtnAt(0, 1)); // secondary
  let after = slotNames(0);
  check("rerolling one slot changes only that slot", after[1] !== before[1] && after.every((n, i) => i === 1 || n === before[i]), before.join("|") + " -> " + after.join("|"));
  check("rerolled slot keeps the locks", lockBtnAt(0, 0).getAttribute("aria-pressed") === "true" && after[0] === "AR-23 Liberator" && after[3] === "AC-8 Autocannon");
  let changedAlways = true;
  for (let n = 0; n < 15; n++) { const b = slotNames(0)[6]; click(rerollBtnAt(0, 6)); if (slotNames(0)[6] === b) changedAlways = false; }
  check("rerolling a slot always picks a different item when others exist (15 rerolls)", changedAlways);
  check("a single-slot reroll still gives 7 distinct slots", new Set(slotNames(0).slice(3)).size === 4 && cards() === 7);
  click(lockBtnAt(0, 2)); // lock the throwable
  check("clicking the lock locks the card", lockBtnAt(0, 2).getAttribute("aria-pressed") === "true" && rerollBtnAt(0, 2).disabled);
  check("...and the free count drops to 4", /\(4\)/.test(rerollAll(0).textContent), rerollAll(0).textContent);
  before = slotNames(0);
  let lockedStayed = true, somethingMoved = false;
  for (let n = 0; n < 10; n++) {
    click(rerollAll(0));
    const now = slotNames(0);
    if ([0, 2, 3].some((i) => now[i] !== before[i])) lockedStayed = false;
    if ([1, 4, 5, 6].some((i) => now[i] !== before[i])) somethingMoved = true;
    before = now;
  }
  check("reroll all unlocked keeps every locked slot (10 rerolls)", lockedStayed);
  check("...and does reroll the free ones", somethingMoved);
  click(lockBtnAt(0, 2));
  check("clicking again unlocks", lockBtnAt(0, 2).getAttribute("aria-pressed") === "false" && rerollBtnAt(0, 2).disabled === false);
  [1, 2, 4, 5, 6].forEach((n) => { if (lockBtnAt(0, n).getAttribute("aria-pressed") !== "true") click(lockBtnAt(0, n)); });
  check("all 7 locked -> reroll all unlocked is disabled", rerollAll(0).disabled === true && /\(0\)/.test(rerollAll(0).textContent));
  before = slotNames(0); click(rerollAll(0));
  check("...and does nothing when clicked", slotNames(0).join("|") === before.join("|"));
  $("lock-primary").value = ""; $("lock-strat1").value = "";
  $("count").value = "3"; generate();
  check("3 loadouts each get their own reroll button", doc.querySelectorAll("#results .reroll-all-btn").length === 3);
  const l1 = loadoutEls()[0], l3 = loadoutEls()[2], ra = slotNames(0), rb = slotNames(1), rc = slotNames(2);
  click(lockBtnAt(1, 0));
  for (let n = 0; n < 5; n++) click(rerollAll(1));
  check("rerolling loadout 2 leaves loadouts 1 and 3 alone", slotNames(0).join("|") === ra.join("|") && slotNames(2).join("|") === rc.join("|") && loadoutEls()[0] === l1 && loadoutEls()[2] === l3);
  check("...and keeps loadout 2's locked slot", slotNames(1)[0] === rb[0]);
  check("...and it moved something", slotNames(1).join("|") !== rb.join("|"));
  check("locks on one loadout don't appear on the others", lockBtnAt(0, 0).getAttribute("aria-pressed") === "false");
  $("count").value = "1"; generate();
  check("generating again starts with nothing locked", doc.querySelectorAll("#results .lock-btn[aria-pressed=\"true\"]").length === 0);
  // the faction a loadout was made for travels with its rerolls, even if you switch faction afterwards
  setFaction("bot"); generate();
  setFaction("squid");
  const botOk = (name) => win.HD2_DATA.items.find((i) => i.name === name).factions.some((f) => f === "bot" || f === "any");
  let allBot = true;
  for (let n = 0; n < 8; n++) { click(rerollAll(0)); click(rerollBtnAt(0, 4)); if (!slotNames(0).every(botOk)) allBot = false; }
  check("rerolls keep the faction the loadout was generated for", allBot);
  check("...and its colour", $("results").style.getPropertyValue("--accent").toLowerCase() === "#ff6161");
  setFaction("any");

  click(blockBtn("AR-23 Liberator"));
  check("Block button pressed", blockBtn("AR-23 Liberator").getAttribute("aria-pressed") === "true");
  check("pool line counts it", new RegExp("Rolling from " + (ACTIVE - 1) + " of " + ACTIVE + ".*1 blocked").test(poolText()), poolText());
  check("block saved (by the item's permanent id, not its name)", JSON.parse(win.localStorage.getItem("hd2_blocked")).includes(idOf("AR-23 Liberator")) && !JSON.parse(win.localStorage.getItem("hd2_blocked")).includes("AR-23 Liberator"));
  $("lock-primary").value = "AR-23 Liberator"; generate();
  check("locking a blocked item -> error", errors().some((e) => /isn't in your gear pool \(blocked\)/.test(e)), errors());
  $("lock-primary").value = "";
  let sawExcluded = false;
  for (let i = 0; i < 25; i++) {
    generate();
    if (Array.from(doc.querySelectorAll("#results .item-name")).some((e) => e.textContent === "AR-23 Liberator")) sawExcluded = true;
  }
  check("blocked item never rolls (25 tries)", !sawExcluded);
  click(blockBtn("AR-23 Liberator"));
  check("Block toggles back off", blockBtn("AR-23 Liberator").getAttribute("aria-pressed") === "false" && new RegExp("Rolling from " + ACTIVE + " of " + ACTIVE).test(poolText()));
  setOwnedItem("AC-8 Autocannon", false);
  $("lock-strat1").value = "AC-8 Autocannon"; generate();
  check("locking an item you don't own -> error", errors().some((e) => /not owned/.test(e)), errors());
  $("lock-strat1").value = "";
  setOwnedItem("AC-8 Autocannon", true);

  // A plain "tag, whole loadout, at least / at most / exactly N" rule through the builder (it edits the tag's row).
  const addRule = (tag, op, n) => {
    const m = doc.querySelector('#builder-body .b-row[data-role="must"]'), fire = (el) => el.dispatchEvent(new win.Event("change", { bubbles: true }));
    m.querySelector(".b-sel").value = "tag:" + tag; fire(m.querySelector(".b-sel"));
    m.querySelector(".b-scope").value = "all"; fire(m.querySelector(".b-scope"));
    m.querySelector(".b-op").value = op; fire(m.querySelector(".b-op"));
    m.querySelector(".b-n").value = String(n); click($("b-add"));
  };
  const chips = () => Array.from(doc.querySelectorAll("#require-chips .chip"));
  const chipTexts = () => chips().map((c) => c.firstChild.textContent);
  const chipFor = (tag) => doc.querySelector('#require-chips .chip[data-tag="' + tag + '"]');
  const removeChip = (tag) => click(chipFor(tag).querySelector("button"));
  // Every default rule is a row, listed from the highest priority tier to the lowest, the limits last.
  const DEFAULT_ROWS = ["Backpack = 1", "At least one support weapon", "Anti-Tank ≥ 1", "A chaff killer in primary or secondary", "Base Breaker ≥ 1",
    "Never a regular and an expendable support weapon together",
    "Medium Killer ≥ 1", "Panic Weapon ≥ 1", "Two base breakers when no weapon is one",
    "A hand-held shield needs a one-handed primary or a melee weapon", "No supply pack alongside 2+ no-ammo items",
    "At most 1 regular (non-expendable) support weapon", "Expendable ≤ 2", "Vehicle ≤ 1", "Eagle ≤ 2", "Mines ≤ 1",
    "Melee secondaries are rolled at a third of the usual odds"];
  const ruleChip = (id) => doc.querySelector('#require-chips .chip[data-rule="' + id + '"]');
  check("every default rule starts as a dim row (no switches), highest priority first", chipTexts().join("|") === DEFAULT_ROWS.join("|") && chips().every((c) => c.classList.contains("preset")) && !doc.querySelector("#rules-default") && !doc.querySelector('#rules-section input[role="switch"]'), chipTexts().join("|"));
  check("...with no reset buttons yet, and nothing counted in the summary", $("presets-reset").hidden && $("custom-clear").hidden && $("rules-summary").textContent === "");
  check("a default row's tooltip names its priority", /preferred/.test(ruleChip("shield").title) && /core/.test(chipFor("armor").title) && /preferred/.test(chipFor("vehicle").title), ruleChip("shield").title + " / " + chipFor("armor").title);
  addRule("demo", "min", 3);
  check("adding a rule for a default row's tag edits that row (not a second chip)", chips().length === 17 && chipTexts().includes("Base Breaker ≥ 3") && !chipFor("demo").classList.contains("preset"), chipTexts().join("|"));
  check("...shows the reset button and counts one edited rule", !$("presets-reset").hidden && /1 edited/.test($("rules-summary").textContent), $("rules-summary").textContent);
  $("count").value = "4"; generate();
  check("require demo>=3 still generates", cards() === 28, cards() + " " + errors());
  $("count").value = "1";
  addRule("vehicle", "min", 4); // only one FRV, tank and exosuit exist -> max 3
  generate();
  check("unmeetable requirement still builds 7 cards (no error)", cards() === 28 || cards() === 7, cards() + " " + errors());
  check("...and lists the unmet requirement in a banner", /Rule: at least 4 Vehicle/.test((doc.querySelector("#results .rules-warning") || {}).textContent || ""),
    (doc.querySelector("#results .rules-warning") || {}).textContent);
  check("...with a Why? detail and the rule's priority shown", !!doc.querySelector("#results .rules-warning details.why") && /\[Overwrite\]/.test((doc.querySelector("#results .rules-warning") || {}).textContent || ""), (doc.querySelector("#results .rules-warning") || {}).textContent);
  check("...with no red error message", errors().length === 0, errors());
  check("'at least 4 vehicles' replaced the default 'at most 1' (the default's side of the clash is dropped)", chipTexts().includes("Vehicle ≥ 4") && !chipTexts().includes("Vehicle ≤ 1"), chipTexts().join("|"));
  chips().forEach((c) => click(c.querySelector("button")));
  check("every row is removable, defaults included", chips().length === 0 && /17 off/.test($("rules-summary").textContent), $("rules-summary").textContent);
  generate();
  check("with every rule removed a build still generates", cards() === 7 && errors().length === 0 && !doc.querySelector("#results .rules-warning"), cards() + " " + errors());
  click($("presets-reset"));
  check("'Reset to system defaults' brings every default row back", chipTexts().join("|") === DEFAULT_ROWS.join("|") && chips().every((c) => c.classList.contains("preset")) && $("presets-reset").hidden && $("rules-summary").textContent === "", chipTexts().join("|"));

  console.log("Rules panel");
  check("rules panel is one list: no 'Require tags', no separate default switches", !/Require tags/.test(doc.body.textContent) && /Rules/.test($("rules-section").textContent) && !/Additional rules/.test($("rules-section").textContent) && !doc.querySelector("#rules-default"));
  check("operator offers at least / at most / exactly", Array.from(doc.querySelectorAll('#builder-body .b-row[data-role="must"] .b-op option')).map((o) => o.textContent).join("|") === "at least|at most|exactly");
  check("in-game limits row is shown and has no switch", /1 FRV, 1 tank and 1 exosuit/.test($("rules-section").textContent) && doc.querySelectorAll("#rules-section .rule-row.locked input").length === 0);
  addRule("eagle", "max", 1); addRule("sentry", "eq", 0); addRule("chaff", "min", 2); addRule("chaff", "max", 3);
  check("chips: at most / exactly / range (Eagle edits its default row; the others are added after the defaults)", chipTexts().join("|") === DEFAULT_ROWS.join("|").replace("Eagle ≤ 2", "Eagle ≤ 1") + "|Sentry = 0|Chaff Killer 2–3", chipTexts().join("|"));
  check("summary counts added and edited rules", /2 added, 1 edited/.test($("rules-summary").textContent), $("rules-summary").textContent);
  addRule("chaff", "min", 5);
  check("a contradictory range is refused with a message", errors().some((e) => /can't both hold/.test(e)) && chipTexts().includes("Chaff Killer 2–3"), errors());
  addRule("chaff", "min", 0);
  check("'at least 0' is refused", errors().some((e) => /1 to 7/.test(e)), errors());
  addRule("chaff", "eq", 2);
  check("exactly replaces the range", chipTexts().includes("Chaff Killer = 2"), chipTexts().join("|"));
  $("count").value = "3"; generate();
  check("builds with added rules; no unmet rule banner for the ones that can be met", cards() === 21 && !/Rule: at most 1 Eagle|Rule: exactly 0 Sentry/.test((doc.querySelector("#results") || {}).textContent), cards() + " " + errors());
  $("count").value = "1";
  addRule("eagle", "min", 3);
  check("'at least 3' against the player's own 'at most 1' is refused (only a DEFAULT number gives way)", errors().some((e) => /can't both hold/.test(e)) && chipTexts().includes("Eagle ≤ 1"), errors().concat(chipTexts()).join("|"));
  addRule("eagle", "eq", 2); addRule("eagle", "max", 1);
  check("a clash with the player's own earlier rule is refused", errors().some((e) => /can't both hold/.test(e)) && chipTexts().includes("Eagle = 2"), errors().concat(chipTexts()).join("|"));
  addRule("armor", "max", 2);
  check("'at most 2' on a default 'at least 1' row makes the range 1–2", chipTexts().includes("Anti-Tank 1–2"), chipTexts().join("|"));
  addRule("vehicle", "max", 2); addRule("vehicle", "max", 1);
  check("editing a row back to its default makes it a dim default row again", chipFor("vehicle").classList.contains("preset") && chipTexts().includes("Vehicle ≤ 1"), chipTexts().join("|"));
  chips().forEach((c) => click(c.querySelector("button")));
  check("rule chips removable", chips().length === 0);
  addRule("armor", "min", 2); addRule("sentry", "min", 1);
  click($("presets-reset"));
  check("'Reset to system defaults' restores the defaults but keeps rules added for other tags", chipTexts().join("|") === DEFAULT_ROWS.join("|") + "|Sentry ≥ 1", chipTexts().join("|"));
  check("'Clear custom rules' shows once a rule is added for a tag with no default row", !$("custom-clear").hidden);
  addRule("armor", "min", 2); addRule("shield", "min", 1); addRule("laser", "max", 1);
  click($("custom-clear"));
  check("'Clear custom rules' removes only the added rules, not the default rows (edited ones included)", chipTexts().join("|") === DEFAULT_ROWS.join("|").replace("Anti-Tank ≥ 1", "Anti-Tank ≥ 2") && $("custom-clear").hidden && !$("presets-reset").hidden && /1 edited/.test($("rules-summary").textContent), chipTexts().join("|"));
  click($("presets-reset"));
  addRule("sentry", "min", 1);
  removeChip("sentry");
  check("...and removing the last extra rule leaves just the defaults, nothing counted", chipTexts().join("|") === DEFAULT_ROWS.join("|") && $("rules-summary").textContent === "");

  click(ruleChip("capMixed").querySelector("button"));
  check("removing a generic default row (never mix support types) drops it, shows reset and counts it as off", !ruleChip("capMixed") && chips().length === 16 && !$("presets-reset").hidden && /1 off/.test($("rules-summary").textContent), $("rules-summary").textContent);
  check("...and saves it", JSON.stringify(JSON.parse(win.localStorage.getItem("hd2_settings")).disabledRules) === '["capMixed"]', win.localStorage.getItem("hd2_settings"));
  click(ruleChip("demoEscalation").querySelector("button"));
  generate();
  check("builds still generate with rules removed", cards() === 7 && errors().length === 0, cards() + " " + errors());
  click($("presets-reset"));
  check("'Reset to system defaults' brings those back too, and saves that", chipTexts().join("|") === DEFAULT_ROWS.join("|") && $("rules-summary").textContent === "" && JSON.parse(win.localStorage.getItem("hd2_settings")).disabledRules.length === 0);

  console.log("Rule builder");
  const setv = (el, v) => { el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const bRow = (role) => doc.querySelector('#builder-body .b-row[data-role="' + role + '"]');
  check("each rule-builder row explains its pick: description, item count and a few examples", (() => {
    setv(bRow("must").querySelector(".b-sel"), "tag:fire");
    const t = bRow("must").querySelector(".b-hint").textContent;
    const n = win.HD2_DATA.items.filter((i) => i.factions.indexOf("none") === -1 && i.tags.indexOf("fire") !== -1).length;
    return t.indexOf("Sets enemies on fire") === 0 && t.indexOf(n + " items (e.g. ") !== -1;
  })(), bRow("must").querySelector(".b-hint").textContent);
  check("...hovering shows every item (tooltip); clicking swaps the line for the full list and back", (() => {
    const d = bRow("must").querySelector(".b-hint"); const short = d.textContent;
    const n = Number(/(\d+) items/.exec(short)[1]);
    if (d.title.split(", ").length !== n) return false;
    d.dispatchEvent(new win.Event("click", { bubbles: true }));
    const open = d.textContent.split(", ").length === n && d.classList.contains("open");
    d.dispatchEvent(new win.Event("click", { bubbles: true }));
    return open && d.textContent === short;
  })());
  check("...a category gets one too, and retired items are not counted", (() => {
    setv(bRow("must").querySelector(".b-sel"), "cat:vehicle");
    const t = bRow("must").querySelector(".b-hint").textContent;
    const n = win.HD2_DATA.items.filter((i) => i.factions.indexOf("none") === -1 && i.cat === "vehicle").length;
    return t.indexOf("Vehicles") === 0 && t.indexOf(" " + n + " items") !== -1;
  })(), bRow("must").querySelector(".b-hint").textContent);
  check("...every titled tag has a description in the data", win.HD2_DATA.tags.every((r) => r.description && r.description.length > 3));
  setv(bRow("must").querySelector(".b-sel"), bRow("must").querySelector(".b-sel").options[0].value);
  const build = (when, must) => {
    doc.querySelectorAll("#builder-body #b-when .chip-x").forEach((b) => click(b));
    when.forEach((w) => { click($("b-add-if")); const rows = doc.querySelectorAll('#builder-body .b-row[data-role="when"]'); const r = rows[rows.length - 1]; setv(r.querySelector(".b-sel"), w[0]); setv(r.querySelector(".b-scope"), w[1]); setv(r.querySelector(".b-op"), w[2]); r.querySelector(".b-n").value = String(w[3]); });
    const m = bRow("must"); setv(m.querySelector(".b-sel"), must[0]); setv(m.querySelector(".b-scope"), must[1]); setv(m.querySelector(".b-op"), must[2]); m.querySelector(".b-n").value = String(must[3]);
    click($("b-add"));
  };
  check("the builder offers tags and categories (no groups any more), and every scope", Array.from(bRow("must").querySelectorAll("optgroup")).map((g) => g.label).join("|") === win.HD2_DATA.tags.map((r) => r.group).filter((g, k, a) => a.indexOf(g) === k).concat("Categories").join("|") && bRow("must").querySelectorAll(".b-scope option").length === 7 && !!bRow("must").querySelector('option[value="cat:orbital"]') && !bRow("must").querySelector('option[value^="grp:"]') && !!bRow("must").querySelector('option[value="tag:nonexp"]'));
  build([], ["cat:orbital", "all", "max", 0]);
  check("a category rule becomes a row (and 'Clear custom rules' appears)", chipTexts().includes("Orbital ≤ 0") && !$("custom-clear").hidden && /1 added/.test($("rules-summary").textContent), chipTexts().join("|"));
  check("...and is saved with the other settings", JSON.stringify(JSON.parse(win.localStorage.getItem("hd2_settings")).customRules) === '[{"must":{"sel":"cat:orbital","scope":"all","max":0}}]', win.localStorage.getItem("hd2_settings"));
  build([], ["cat:orbital", "all", "max", 0]);
  check("the same rule twice is refused", errors().some((e) => /already have that rule/.test(e)) && chipTexts().filter((t) => t === "Orbital ≤ 0").length === 1, errors());
  build([], ["tag:armor", "all", "min", 0]);
  check("'at least 0' is refused in the builder", errors().some((e) => /Check the numbers/.test(e)));
  build([["cat:eagle", "strats", "min", 2]], ["cat:sentry", "all", "max", 0]);
  check("an if / then rule reads as a sentence, and the ‘if’ rows clear after adding", chipTexts().includes("If Eagle ≥ 2 (stratagems), then Sentry ≤ 0") && doc.querySelectorAll('#builder-body .b-row[data-role="when"]').length === 0, chipTexts().join("|"));
  build([["cat:eagle", "all", "min", 1], ["cat:orbital", "all", "min", 1]], ["tag:supply", "strats", "max", 0]);
  check("two ‘if’ conditions are joined with 'and'", chipTexts().includes("If Eagle ≥ 1 and Orbital ≥ 1, then Supply ≤ 0 (stratagems)"), chipTexts().join("|"));
  click($("b-add-if")); click($("b-add-if")); if (!$("b-add-if").hidden) click($("b-add-if"));
  check("at most two ‘if’ conditions can be added", doc.querySelectorAll('#builder-body .b-row[data-role="when"]').length === 2 && $("b-add-if").hidden);
  doc.querySelectorAll("#builder-body #b-when .chip-x").forEach((b) => click(b));
  check("...and each can be removed again", doc.querySelectorAll('#builder-body .b-row[data-role="when"]').length === 0 && !$("b-add-if").hidden);
  // odds rules (start from the plain defaults)
  if (!$("custom-clear").hidden) click($("custom-clear"));
  if (!$("presets-reset").hidden) click($("presets-reset"));
  const oddsRow = () => bRow("odds");
  const addOdds = (sel, scope, n) => { setv(oddsRow().querySelector(".b-sel"), sel); setv(oddsRow().querySelector(".b-scope"), scope); oddsRow().querySelector(".b-n").value = String(n); click($("odds-add")); };
  check("the builder has an odds row (selector, where, multiplier)", !!oddsRow() && !!$("odds-add"));
  addOdds("tag:melee", "secondary", 3);
  check("an odds rule for the default melee rule edits that row: it becomes ×3 and the default text goes", chipTexts().includes("Melee ×3 odds (secondary)") && !chipTexts().some((t) => /a third of the usual/.test(t)) && chips().length === 17 && /1 edited/.test($("rules-summary").textContent), chipTexts().join("|") + " " + $("rules-summary").textContent);
  check("...and it is saved", (JSON.parse(win.localStorage.getItem("hd2_settings")).weights || []).some((w) => w.sel === "tag:melee" && w.scope === "secondary" && w.factor === 3), win.localStorage.getItem("hd2_settings"));
  addOdds("tag:melee", "secondary", 0.333);
  check("giving it the default number again puts the default row back", chipTexts().some((t) => /a third of the usual/.test(t)) && !chipTexts().includes("Melee ×3 odds (secondary)") && $("rules-summary").textContent === "", chipTexts().join("|"));
  addOdds("cat:eagle", "strats", 0.5);
  check("another odds rule is added as its own row", chipTexts().includes("Eagle ×0.5 odds (stratagems)") && chips().length === 18 && /1 added/.test($("rules-summary").textContent), chipTexts().join("|"));
  addOdds("cat:eagle", "strats", 2);
  check("one odds rule per selector and place: a second replaces the first", chipTexts().includes("Eagle ×2 odds (stratagems)") && !chipTexts().includes("Eagle ×0.5 odds (stratagems)") && chips().length === 18);
  $("count").value = "3"; generate();
  check("builds generate with odds rules in play", cards() === 21 && errors().length === 0, cards() + " " + errors());
  addOdds("tag:fire", "all", 99);
  check("an odds number outside 0.05 to 20 is refused", errors().some((e) => /odds rule can't be built/.test(e)) && chips().length === 18, errors());
  click(doc.querySelector('#require-chips .chip[title^="Your odds rule"] button'));
  check("an odds rule can be removed", chips().length === 17, chipTexts().join("|"));
  click(ruleChip("meleeWeight").querySelector("button"));
  check("the default odds row can be removed and counts as off", !ruleChip("meleeWeight") && chips().length === 16 && /1 off/.test($("rules-summary").textContent), $("rules-summary").textContent);
  click($("presets-reset"));
  check("'Reset to system defaults' brings the odds row back", !!ruleChip("meleeWeight") && chips().length === 17, chipTexts().join("|"));
  addOdds("cat:eagle", "strats", 2); click($("custom-clear"));
  check("'Clear custom rules' removes the added odds rules too", chips().length === 17 && !chipTexts().some((t) => /Eagle ×/.test(t)), chipTexts().join("|"));
  build([], ["cat:sentry", "all", "min", 7]);
  $("count").value = "2"; generate();
  check("custom rules are used when generating (no red error), builds still complete", cards() === 14 && errors().length === 0, cards() + " " + errors());
  check("...and a custom rule the build can't meet is listed by its sentence", /Rule: Sentry ≥ 7 \(this build has \d\)/.test((doc.querySelector("#results .rules-warning") || {}).textContent || ""), (doc.querySelector("#results .rules-warning") || {}).textContent);
  $("count").value = "1";
  click($("custom-clear"));
  check("'Clear custom rules' removes every custom rule, and saves that", chipTexts().join("|") === DEFAULT_ROWS.join("|") && JSON.parse(win.localStorage.getItem("hd2_settings")).customRules.length === 0 && $("custom-clear").hidden && $("rules-summary").textContent === "");
  removeChip("panic");   // the Panic Weapon default row is removed; it must be saved as a switched-off rule

  console.log("Locks that break rules");
  $("lock-strat1").value = "Eagle Airstrike"; $("lock-strat2").value = "Orbital Gas Strike";
  $("lock-strat3").value = "Orbital Smoke Strike"; $("lock-strat4").value = "Eagle Strafing Run";
  generate();
  check("all 4 stratagems locked, no backpack -> builds", cards() === 7 && errors().length === 0, cards() + " " + errors());
  check("...and the backpack rule is not flagged", !/backpack/i.test((doc.querySelector("#results .rules-warning") || {}).textContent || ""));
  ["strat1", "strat2", "strat3", "strat4"].forEach((k) => ($("lock-" + k).value = ""));

  console.log("Faction fallback");
  setFaction("bug");
  ownOnly(["base", "cutting_edge", "urban_legends"]);
  check("a small collection -> small pool, most warbonds not owned", (() => { const m = /Rolling from (\d+) of (\d+)/.exec(poolText()); return m && Number(m[1]) > 6 && Number(m[1]) < Number(m[2]) / 2; })(), poolText());
  generate();
  check("bug + a small collection with too little for bugs -> off-faction banner shown", !!doc.querySelector("#results .faction-warning"));
  check("...with a Why? detail that names the reason", /Why\?/.test((doc.querySelector("#results .faction-warning details.why") || {}).textContent || ""), (doc.querySelector("#results .faction-warning") || {}).textContent);
  check("...and each OFF-FACTION badge on a card explains itself", Array.from(doc.querySelectorAll("#results .item-card .suboptimal-badge, #results .item-card2 .suboptimal-badge")).every((b) => /meant for/.test(b.title)), "");

  console.log("Warbond pills");
  setFaction("any");
  $("count").value = "5"; generate();
  const pills = Array.from(doc.querySelectorAll("#results .warbond-row .tag-pill")).map((p) => p.textContent);
  check("Requisition sources show the short pill label", pills.length > 0 && pills.includes("Requisition") && pills.every((t) => !/^Requisition: /.test(t)), JSON.stringify(Array.from(new Set(pills))) + " errors=" + JSON.stringify(errors()) + " cards=" + cards());
  {
    // the merged Super Citizen/Event Rewards warbond keeps two pill labels: the MP-98 Knight is the Super Citizen Edition, the rest are Event Rewards
    click($("gear-select-all"));
    $("count").value = "1";
    $("lock-primary").value = "MP-98 Knight"; $("lock-strat1").value = "TD-110 Maelstrom";
    generate();
    const pillsOf = (card) => Array.from(card.querySelectorAll(".warbond-row .tag-pill")).map((p) => p.textContent);
    const cardNamed = (n) => Array.from(doc.querySelectorAll("#results .item-card, #results .item-card2")).find((c) => c.querySelector(".item-name").textContent === n);
    check("the MP-98 Knight's warbond pill says Super Citizen Edition", cardNamed("MP-98 Knight") && pillsOf(cardNamed("MP-98 Knight")).join() === "Super Citizen Edition", cardNamed("MP-98 Knight") && pillsOf(cardNamed("MP-98 Knight")).join());
    check("...and the other items of that warbond say Event Reward", cardNamed("TD-110 Maelstrom") && pillsOf(cardNamed("TD-110 Maelstrom")).join() === "Event Reward", cardNamed("TD-110 Maelstrom") && pillsOf(cardNamed("TD-110 Maelstrom")).join());
    $("lock-primary").value = ""; $("lock-strat1").value = "";
    ownOnly(["base", "cutting_edge", "urban_legends"]);
  }
  const reqGroup = doc.querySelector("#gear-list .wb-group");
  const reqSubNames = Array.from(reqGroup.querySelectorAll(".wb-group-body .wb-block .wb-name")).map((n) => n.textContent);
  check("the Requisition group lists the six shops by short name, in order", reqSubNames.join("|") === "Patriotic Administration Center|Orbital Cannons|Hangar|Bridge|Engineering Bay|Robotics Workshop", reqSubNames.join("|"));
  check("...and the group header is just 'Requisition'", reqGroup.querySelector(":scope > .wb-header .wb-name").textContent === "Requisition");
  check("...its count covers all the shops' items", (() => { const t = Number(reqGroup.querySelector(":scope > .wb-header .wb-count").getAttribute("data-total")); return t === reqGroup.querySelectorAll(".gear-row").length && t > 30; })());
  check("...the full 'Requisition: ...' names still drive search", Array.from(reqGroup.querySelectorAll(".gear-row")).every((r) => /requisition: /.test(r.getAttribute("data-search"))));
  const shopNames = (n) => Array.from(reqGroup.querySelectorAll(".wb-group-body .wb-block")[n].querySelectorAll(".tr-name")).map((x) => x.textContent);
  check("a requisition shop lists its items in the game's menu order (menu_order column)",
    shopNames(0).slice(0, 4).join("|") === "MG-43 Machine Gun|APW-1 Anti-Materiel Rifle|M-105 Stalwart|EAT-17 Expendable Anti-Tank" && shopNames(2)[4] === "LIFT-850 Jump Pack" && shopNames(3)[0] === "Orbital Precision Strike" && shopNames(5).join("|").startsWith("A/MG-43 Machine Gun Sentry|A/G-16 Gatling Sentry|A/M-12 Mortar Sentry|AX/AR-23 Guard Dog"), shopNames(0).join("|"));
  check("...the two base-game stratagems moved into shops are still always owned (checked and locked)",
    ["MG-43 Machine Gun", "Orbital Precision Strike"].every((n) => gearBox(n).checked && gearBox(n).disabled));
  $("count").value = "1";
  click($("gear-select-all"));
  setFaction("bug");

  console.log("Persistence");
  const saved = JSON.parse(win.localStorage.getItem("hd2_settings"));
  check("faction saved", saved && saved.faction === "bug", JSON.stringify(saved));
  check("a switched-off default rule is saved with the settings", saved && Array.isArray(saved.disabledRules) && saved.disabledRules.join() === "panic", JSON.stringify(saved));

  console.log("My Gear tab");
  click(doc.querySelector('.tab[data-view="gear"]'));
  check("gear view visible", !$("view-gear").hidden && $("view-randomizer").hidden);
  const firstBlock = blockBlock("Superstore");   // a plain warbond with owned / blocked buttons and only active items
  click(firstBlock.querySelector(".wb-header"));
  check("clicking a header opens that section", firstBlock.querySelector(".wb-items").classList.contains("open"));
  click($("gear-clear"));
  check("Own nothing -> 6 / everything (Base Game stays) and saves {}", $("grand-total").textContent === "6 / " + ACTIVE + " items owned" && win.localStorage.getItem("hd2_tracker") === "{}", $("grand-total").textContent + " " + win.localStorage.getItem("hd2_tracker"));
  const firstBox = firstBlock.querySelector("input[data-item]");
  firstBox.checked = true; firstBox.dispatchEvent(change());
  check("tick saves to localStorage", !!JSON.parse(win.localStorage.getItem("hd2_tracker"))[idOf(firstBox.getAttribute("data-item"))]);
  click(firstBlock.querySelector("[data-none]"));
  click(firstBlock.querySelector("[data-all]"));
  const n1 = Number(firstBlock.querySelector(".pool-count").textContent);
  check("per-warbond All owns just that warbond", n1 === firstBlock.querySelectorAll("input[data-item]").length && $("grand-total").textContent === (6 + n1) + " / " + ACTIVE + " items owned", n1 + " / " + $("grand-total").textContent);
  click(firstBlock.querySelector("[data-none]"));
  check("per-warbond None clears it", firstBlock.querySelector(".pool-count").textContent === "0" && $("grand-total").textContent === "6 / " + ACTIVE + " items owned");
  click($("gear-select-all"));
  check("Own everything -> all owned", $("grand-total").textContent === ACTIVE + " / " + ACTIVE + " items owned");
  click(blockBtn("AC-8 Autocannon"));
  check("blocked item shown in the summary", /1 blocked/.test($("gear-detail").textContent), $("gear-detail").textContent);
  // Blocked-but-owned styling and the per-warbond counts
  const baseBlock = blockBlock("Base Game");
  click(blockBtn("AC-8 Autocannon")); // unblock it again so counts start clean
  check("Base Game starts at 4 / 4 (no red number)", countText(baseBlock) === "4 / 4" && baseBlock.querySelector(".blocked-part").hidden, countText(baseBlock));
  const baseName = baseBlock.querySelector("input[data-item]").getAttribute("data-item");
  click(blockBtn(baseName));
  check("blocking one Base Game item -> 1 / 3 / 4 with the red number", countText(baseBlock) === "1 / 3 / 4" && !baseBlock.querySelector(".blocked-part").hidden, countText(baseBlock));
  check("...and the red number really is red", baseBlock.querySelector(".blocked-count").textContent === "1");
  check("blocked + owned row is red and struck through", rowOf(baseName).classList.contains("is-blocked") && /line-through/.test(nameStyle(baseName).textDecoration || nameStyle(baseName).getPropertyValue("text-decoration")) , nameStyle(baseName).textDecoration);
  const otherBase = baseBlock.querySelectorAll("input[data-item]")[1].getAttribute("data-item");
  check("owned, unblocked rows are not struck through", !/line-through/.test(nameStyle(otherBase).textDecoration || ""), nameStyle(otherBase).textDecoration);
  click(baseBlock.querySelector("[data-block-all]"));
  check("Block All on Base Game -> 4 / 0 / 4", countText(baseBlock) === "4 / 0 / 4", countText(baseBlock));
  click(baseBlock.querySelector("[data-block-none]"));
  check("Block None -> back to 4 / 4", countText(baseBlock) === "4 / 4", countText(baseBlock));
  check("Base Game has Block All/None but no Own All/None", !baseBlock.querySelector("[data-all]") && !baseBlock.querySelector("[data-none]"));
  check("buttons are labelled Own All / Own None / Block All / Block None", (() => { const l = Array.from(firstBlock.querySelectorAll(".wb-tools button")).map((b) => b.textContent); return l.join("|") === "Own All|Own None|Block All|Block None"; })(), Array.from(firstBlock.querySelectorAll(".wb-tools button")).map((b) => b.textContent).join("|"));
  // an unowned, blocked item: pressed button, but no red strike-through and not counted in the red number
  click(firstBlock.querySelector("[data-none]"));
  const fbItem = firstBlock.querySelector("input[data-item]").getAttribute("data-item");
  click(blockBtn(fbItem));
  check("unowned + blocked: no strike-through, no red number", !rowOf(fbItem).classList.contains("is-blocked") && firstBlock.querySelector(".blocked-part").hidden && blockBtn(fbItem).getAttribute("aria-pressed") === "true");
  click(firstBlock.querySelector("[data-all]"));
  check("owning it now shows 1 red / rest / total", /^1 \/ \d+ \/ \d+$/.test(countText(firstBlock)), countText(firstBlock));
  click(firstBlock.querySelector("[data-block-none]"));
  click(blockBtn("AC-8 Autocannon"));
  const search = (q) => { $("gear-search").value = q; $("gear-search").dispatchEvent(new win.Event("input", { bubbles: true })); };
  const shownNames = () => Array.from(doc.querySelectorAll("#gear-list .gear-row")).filter((r) => !r.hidden).map((r) => r.querySelector("input[data-item]").getAttribute("data-item"));
  search("scope of authority");
  const soa = shownNames();
  check("searching a warbond name lists that warbond's items", soa.includes("R-40 Sightliner") && soa.includes("G-11 Caltrops") && soa.length === 5 && Array.from(doc.querySelectorAll("#gear-list .wb-block")).filter((b) => !b.hidden).length === 1, soa.join(", "));
  search("hangar eagle");
  check("words combine: 'hangar eagle' -> the Hangar's Eagles only", shownNames().length === 7 && shownNames().every((n) => /^Eagle/.test(n)), shownNames().join(", "));
  check("a filter note appears", !$("gear-filter-note").hidden && /7 items shown/.test($("gear-filter-note").textContent), $("gear-filter-note").textContent);
  search("eagle");
  const hangar = blockBlock("Hangar");
  click(hangar.querySelector("[data-block-all]"));
  check("Block All with a search active blocks only the shown Hangar items", blockBtn("Eagle Airstrike").getAttribute("aria-pressed") === "true" && blockBtn("LIFT-850 Jump Pack").getAttribute("aria-pressed") === "false" && blockBtn("M-102 Gunner FRV").getAttribute("aria-pressed") === "false");
  click(hangar.querySelector("[data-none]"));
  check("Own None with a search active unowns only the shown Hangar items", !gearBox("Eagle Airstrike").checked && gearBox("LIFT-850 Jump Pack").checked);
  click(hangar.querySelector("[data-all]"));
  click(blockBtn("LIFT-850 Jump Pack"));
  click($("gear-unblock-all"));
  check("Unblock all with a search active only clears the shown items", blockBtn("Eagle Airstrike").getAttribute("aria-pressed") === "false" && blockBtn("LIFT-850 Jump Pack").getAttribute("aria-pressed") === "true");
  click(blockBtn("LIFT-850 Jump Pack"));
  click($("gear-clear"));
  check("Own nothing with a search active only touches the shown items", !gearBox("Eagle Airstrike").checked && gearBox("LIFT-850 Jump Pack").checked);
  click($("gear-select-all"));
  search("");
  check("filter note hidden again when the search is cleared", $("gear-filter-note").hidden);
  click(hangar.querySelector("[data-block-all]"));
  check("Block All with no search blocks the whole warbond", hangar.querySelectorAll(".gear-row.is-blocked").length === 11);
  click(hangar.querySelector("[data-block-none]"));
  check("Block None with no search clears the whole warbond", hangar.querySelectorAll(".gear-row.is-blocked").length === 0);
  $("gear-search").value = "autocannon"; $("gear-search").dispatchEvent(new win.Event("input", { bubbles: true }));
  const shown = Array.from(doc.querySelectorAll("#gear-list .gear-row")).filter((r) => !r.hidden);
  check("search narrows to matching rows", shown.length >= 1 && shown.length < 10 && shown.every((r) => /autocannon/.test(r.getAttribute("data-search"))), shown.length);
  check("...and hides empty warbond blocks", Array.from(doc.querySelectorAll("#gear-list .wb-block")).filter((b) => !b.hidden).length < 5);
  $("gear-search").value = ""; $("gear-search").dispatchEvent(new win.Event("input", { bubbles: true }));
  check("clearing search shows everything again", doc.querySelectorAll("#gear-list .gear-row[hidden]").length === 0 && doc.querySelectorAll("#gear-list .wb-block[hidden]").length === 0);
  click(doc.querySelector('.tab[data-view="randomizer"]'));

  check("Super Citizen/Event Rewards: MP-98 first, then the event items in release order; the retired FRV is not listed", (() => {
    const names = Array.from(blockBlock("Super Citizen/Event Rewards").querySelectorAll("input[data-item]")).map((i) => i.getAttribute("data-item"));
    return names.join("|") === "MP-98 Knight|R-4 Hyena|Eagle Gas Airstrike|TD-110 Maelstrom|AR-23L Liberator Legacy";
  })());
  check("the merged warbond sits directly below Superstore", (() => {
    const labels = Array.from(doc.querySelectorAll("#gear-list > .wb-block .wb-name")).map((e) => e.textContent);
    return labels[labels.indexOf("Superstore") + 1] === "Super Citizen/Event Rewards";
  })());
  console.log("Requisition group");
  click(doc.querySelector('.tab[data-view="gear"]'));
  const grp = () => doc.querySelector("#gear-list .wb-group");
  const grpBtn = (attr) => grp().querySelector(':scope > .wb-header [' + attr + ']');
  // "pool/total", or "blocked/pool/total" when the red part is showing (hidden text still counts in textContent, so skip it)
  const grpCount = () => { const c = grp().querySelector(":scope > .wb-header .wb-count"); const bp = c.querySelector(".blocked-part"); return (bp.hidden ? "" : c.querySelector(".blocked-count").textContent + "/") + c.querySelector(".pool-count").textContent + "/" + c.getAttribute("data-total"); };
  const subCount = (b) => { const c = b.querySelector(".wb-count"); return c.querySelector(".pool-count").textContent; };
  const acWasBlocked = blockBtn("AC-8 Autocannon").getAttribute("aria-pressed") === "true"; // it lives in a Requisition shop; put it back at the end
  // earlier sections leave things blocked and open: start from a known state
  click(grpBtn("data-block-none")); click(grpBtn("data-all")); // (group only: later tests rely on other blocks staying as they are)
  grp().querySelectorAll(".wb-items.open").forEach((el) => el.classList.remove("open")); grp().querySelector(":scope > .wb-items").classList.remove("open");
  const grpOwned = () => Array.from(grp().querySelectorAll(".gear-row input[data-item]")).filter((c) => c.checked).length;
  const grpTotal = grp().querySelectorAll(".gear-row").length;
  check("group starts closed and everything is owned", !grp().querySelector(":scope > .wb-items").classList.contains("open") && grpOwned() === grpTotal && grpCount() === grpTotal + "/" + grpTotal, grpCount());
  click(grp().querySelector(":scope > .wb-header"));
  check("clicking the group header opens it", grp().querySelector(":scope > .wb-items").classList.contains("open"));
  check("...and the shops inside open on their own", (() => { const sub = grp().querySelector(".wb-group-body .wb-block"); click(sub.querySelector(".wb-header")); return sub.querySelector(".wb-items").classList.contains("open"); })());
  click(grpBtn("data-none"));
  check("group Own None clears every Requisition shop except the two always-owned base-game stratagems", grpOwned() === 2 && grpCount() === "2/" + grpTotal, grpOwned() + " " + grpCount());
  check("...and each shop's own count follows (1 in the PAC and the Bridge, 0 elsewhere)", Array.from(grp().querySelectorAll(".wb-group-body .wb-block")).map(subCount).join("|") === "1|0|0|1|0|0");
  click(grpBtn("data-all"));
  check("group Own All owns them all again", grpOwned() === grpTotal && grpCount() === grpTotal + "/" + grpTotal);
  click(grpBtn("data-block-all"));
  check("group Block All blocks every item (red count shown)", grp().querySelectorAll(".gear-row.is-blocked").length === grpTotal && /^\d+\/0\/\d+$/.test(grpCount()), grpCount());
  click(grpBtn("data-block-none"));
  check("group Block None unblocks them", grp().querySelectorAll(".gear-row.is-blocked").length === 0);
  search("hangar eagle");
  check("with a search, the group shows only the matching rows", Array.from(grp().querySelectorAll(".gear-row:not([hidden])")).length > 0 && Array.from(grp().querySelectorAll(".gear-row:not([hidden])")).every((r) => /hangar/.test(r.getAttribute("data-search")) && /eagle/.test(r.getAttribute("data-search"))) && grp().hidden === false);
  check("...and opens itself", grp().querySelector(":scope > .wb-items").classList.contains("open"));
  const shownN = grp().querySelectorAll(".gear-row:not([hidden])").length;
  click(grpBtn("data-block-all"));
  check("group Block All with a search only blocks the rows shown", grp().querySelectorAll(".gear-row.is-blocked").length === shownN && shownN < grpTotal, grp().querySelectorAll(".gear-row.is-blocked").length + " of " + shownN);
  click(grpBtn("data-block-none"));
  search("scope of authority");
  check("a search with no Requisition match hides the whole group", grp().hidden === true);
  search("requisition");
  check("searching 'requisition' shows all the shops' items", grp().hidden === false && grp().querySelectorAll(".gear-row:not([hidden])").length === grpTotal);
  search("");
  check("clearing the search brings it all back", grp().hidden === false && grp().querySelectorAll(".gear-row[hidden]").length === 0);
  if (acWasBlocked && blockBtn("AC-8 Autocannon").getAttribute("aria-pressed") !== "true") click(blockBtn("AC-8 Autocannon"));
  click(doc.querySelector('.tab[data-view="randomizer"]'));

  console.log("Edit factions");
  const facBox = (name, f) => doc.querySelector('input[data-fac-item="' + name + '"][data-fac="' + f + '"]');
  const facTicks = (name) => ["bug", "bot", "squid"].filter((f) => facBox(name, f).checked).join(",");
  const itemFactions = (name) => win.HD2_DATA.items.find((i) => i.name === name).factions.join(",");
  const tick = (box, on) => { box.checked = on; box.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const denom = (f) => { setFaction(f); return Number(/of (\d+)/.exec(poolText())[1]); };
  const LIB = "AR-23 Liberator", CONC = "AR-23C Liberator Concussive";
  click(doc.querySelector('.tab[data-view="gear"]'));
  check("Edit factions switch exists and starts off", $("edit-factions").checked === false && $("fac-tools").hidden === true && !$("view-gear").classList.contains("edit-factions"));
  $("edit-factions").checked = true; $("edit-factions").dispatchEvent(new win.Event("change", { bubbles: true }));
  check("switching it on shows the faction ticks and tools", $("view-gear").classList.contains("edit-factions") && $("fac-tools").hidden === false);
  check("an 'any' item starts with all three ticked", facTicks(LIB) === "bug,bot,squid", facTicks(LIB));
  check("a Terminid-only item starts with just Terminid", facTicks(CONC) === "bug", facTicks(CONC));
  check("nothing is edited yet: reset is disabled and says so", $("fac-reset").disabled === true && /No edits/.test($("fac-count").textContent), $("fac-count").textContent);
  check("no row is marked as edited", doc.querySelectorAll("#gear-list .gear-row.fac-custom").length === 0);
  const botBefore = denom("bot");
  tick(facBox(CONC, "bot"), true);
  check("ticking Automaton on the Concussive Liberator changes its factions", itemFactions(CONC) === "bug,bot", itemFactions(CONC));
  check("...the row is marked edited with a revert button", rowOf(CONC).classList.contains("fac-custom") && rowOf(CONC).querySelector(".fac-revert").hidden === false);
  check("...the count says 1 item edited", /^1 item edited/.test($("fac-count").textContent), $("fac-count").textContent);
  check("...the Automaton pool grew by one", denom("bot") === botBefore + 1, botBefore + " -> " + denom("bot"));
  check("...and the Randomizer line mentions the edits", /Using your edited faction lists \(1 item\)/.test(poolText()), poolText());
  check("the edit is saved to localStorage", JSON.stringify(JSON.parse(win.localStorage.getItem("hd2_factions"))[idOf(CONC)]) === '["bug","bot"]', win.localStorage.getItem("hd2_factions"));
  tick(facBox(CONC, "squid"), true);
  check("ticking all three stores 'any'", itemFactions(CONC) === "any" && rowOf(CONC).classList.contains("fac-custom"), itemFactions(CONC));
  tick(facBox(CONC, "bot"), false); tick(facBox(CONC, "squid"), false);
  check("ticking back to the defaults clears the edit", itemFactions(CONC) === "bug" && !rowOf(CONC).classList.contains("fac-custom") && win.localStorage.getItem("hd2_factions") === "{}", win.localStorage.getItem("hd2_factions"));
  check("...and the Randomizer line drops the note", !/edited faction/.test(poolText()));
  // unticking everything: the item only rolls when the faction is Any
  const anyBefore = denom("any"), botB2 = denom("bot");
  ["bug", "bot", "squid"].forEach((f) => tick(facBox(LIB, f), false));
  check("no ticks -> item has an empty faction list", itemFactions(LIB) === "", JSON.stringify(itemFactions(LIB)));
  check("...Any still counts every item, Automatons lose one", denom("any") === anyBefore && denom("bot") === botB2 - 1, anyBefore + " " + botB2);
  setFaction("bot"); $("count").value = "1";
  let libSeen = false;
  for (let n = 0; n < 40; n++) { generate(); if (Array.from(doc.querySelectorAll("#results .item-name")).some((e) => e.textContent === LIB)) libSeen = true; }
  check("...so it never rolls for Automatons (40 builds)", !libSeen);
  tick(facBox(LIB, "squid"), true);
  check("an item ticked for only one faction leaves the other pools", itemFactions(LIB) === "squid" && denom("bug") === Object.values(DEFAULTS).filter((f) => f !== "none" && (f === "any" || f.split(",").includes("bug"))).length - 1);
  click(rowOf(LIB).querySelector(".fac-revert"));
  check("the per-item revert button restores the default", itemFactions(LIB) === "any" && facTicks(LIB) === "bug,bot,squid" && !rowOf(LIB).classList.contains("fac-custom"));
  setFaction("any");
  // reset, with the search filter limiting what it touches
  tick(facBox(LIB, "bug"), false); tick(facBox("Eagle Airstrike", "bot"), false);
  check("two edits counted", /^2 items edited/.test($("fac-count").textContent), $("fac-count").textContent);
  search("eagle airstrike");
  check("with a search active the button says 'shown' and counts only those", /Reset shown to defaults \(1\)/.test($("fac-reset").textContent), $("fac-reset").textContent);
  click($("fac-reset"));
  check("first click only asks for confirmation", /Click again to reset 1/.test($("fac-reset").textContent) && itemFactions("Eagle Airstrike") !== defaultOf("Eagle Airstrike"), $("fac-reset").textContent);
  click($("fac-reset"));
  check("second click resets only the item on screen", itemFactions("Eagle Airstrike") === defaultOf("Eagle Airstrike") && itemFactions(LIB) !== "any", itemFactions(LIB));
  search("");
  click($("fac-reset"));
  check("with no search the button resets everything", /Click again to reset 1/.test($("fac-reset").textContent), $("fac-reset").textContent);
  click($("fac-reset"));
  check("...and everything is back on the defaults", customCount() === 0 && /No edits/.test($("fac-count").textContent) && itemFactions(LIB) === "any", $("fac-count").textContent);
  // Bulk faction ticks on the warbond headers
  const ddBlock = blockBlock("Dust Devils");
  const bulkBox = (b, f) => b.querySelector(':scope > .wb-header input[data-fac-bulk$=":' + f + '"]');
  const ddNames = Array.from(ddBlock.querySelectorAll("input[data-item]")).map((c) => c.getAttribute("data-item"));
  check("every warbond header has three faction ticks (hidden unless Edit factions is on)", ["bug", "bot", "squid"].every((f) => !!bulkBox(ddBlock, f)) && doc.querySelectorAll("#gear-list .wb-header .fac-bulk").length === doc.querySelectorAll("#gear-list .wb-header").length);
  check("...and they start ticked / dashed to match the items", ["bug", "bot", "squid"].every((f, k) => { const n = ddNames.filter((nm) => itemFactions(nm) === "any" || itemFactions(nm).split(",").includes(f)).length; const b = bulkBox(ddBlock, f); return b.checked === (n === ddNames.length) && b.indeterminate === (n > 0 && n < ddNames.length); }));
  tick(bulkBox(ddBlock, "bug"), false);
  check("unticking Terminid on the header clears it for every item in the warbond", ddNames.every((nm) => !facTicks(nm).split(",").includes("bug")) && bulkBox(ddBlock, "bug").checked === false && bulkBox(ddBlock, "bug").indeterminate === false, ddNames.map(facTicks).join(" | "));
  check("...other warbonds are untouched", facTicks(LIB) === "bug,bot,squid");
  check("...it is saved as faction edits", Object.keys(JSON.parse(win.localStorage.getItem("hd2_factions"))).length > 0);
  tick(bulkBox(ddBlock, "bug"), true);
  check("ticking it again sets Terminid on every item in the warbond", ddNames.every((nm) => facTicks(nm).split(",").includes("bug")) && bulkBox(ddBlock, "bug").checked === true);
  click($("fac-reset")); click($("fac-reset"));
  search(ddNames[0].toLowerCase());
  tick(bulkBox(ddBlock, "squid"), true);
  check("with a search active it only touches the items shown", facTicks(ddNames[0]).split(",").includes("squid") && ddNames.slice(1).filter((nm) => itemFactions(nm) !== "any" && !itemFactions(nm).split(",").includes("squid")).every((nm) => !facTicks(nm).split(",").includes("squid")));
  search("");
  click($("fac-reset")); click($("fac-reset"));
  check("reset to defaults clears bulk edits too", customCount() === 0, customCount());
  // "Enable for all factions": all three ticked for the items on screen, with the same two-click guard
  const narrow = Object.keys(DEFAULTS).filter((n) => DEFAULTS[n] !== "any" && DEFAULTS[n] !== "none" && DEFAULTS[n] !== "");
  const NARROW = narrow[0], NARROW2 = narrow[1];
  check("test items exist that aren't already for every faction", !!NARROW && !!NARROW2 && rowOf(NARROW) && rowOf(NARROW2));
  const allCount = () => Object.keys(DEFAULTS).filter((n) => DEFAULTS[n] !== "none" && itemFactions(n) !== "any").length;
  check("'Enable for all factions' is shown next to reset, counts the items that aren't already all-factions", /^Enable for all factions \(\d+\)$/.test($("fac-all").textContent) && !$("fac-all").disabled && $("fac-all").textContent === "Enable for all factions (" + allCount() + ")", $("fac-all").textContent);
  search(NARROW.toLowerCase());
  check("with a search active it says 'shown'", /^Enable shown for all factions \(\d+\)$/.test($("fac-all").textContent), $("fac-all").textContent);
  click($("fac-all"));
  check("first click only asks for confirmation", /^Click again to enable \d+$/.test($("fac-all").textContent) && itemFactions(NARROW) === DEFAULTS[NARROW] && itemFactions(NARROW2) === DEFAULTS[NARROW2], $("fac-all").textContent);
  click($("fac-all"));
  check("second click ticks all three for the item shown only", itemFactions(NARROW) === "any" && facTicks(NARROW) === "bug,bot,squid" && rowOf(NARROW).classList.contains("fac-custom") && rowOf(NARROW2).hidden && itemFactions(NARROW2) === DEFAULTS[NARROW2], itemFactions(NARROW) + " / " + itemFactions(NARROW2) + " hidden=" + rowOf(NARROW2).hidden);
  check("...saved as an edit, and the edit survives a reload of the saved data", JSON.parse(win.localStorage.getItem("hd2_factions"))[idOf(NARROW)].join() === "any");
  check("...and the per-item revert puts it back", (click(rowOf(NARROW).querySelector(".fac-revert")), itemFactions(NARROW) === DEFAULTS[NARROW]));
  search("");
  click($("fac-all")); click($("fac-all"));
  check("with no search it enables every item", allCount() === 0 && $("fac-all").disabled && /^Enable for all factions$/.test($("fac-all").textContent), $("fac-all").textContent);
  check("...and every enabled item now counts as edited", customCount() > 0 && /items edited/.test($("fac-count").textContent), $("fac-count").textContent);
  click($("fac-reset"));
  check("reset to defaults still undoes it (after its own confirmation)", /Click again to reset/.test($("fac-reset").textContent));
  click($("fac-reset"));
  check("...everything back on the CSV defaults", customCount() === 0 && itemFactions(NARROW) === DEFAULTS[NARROW] && allCount() > 0, $("fac-count").textContent);
  tick(facBox(LIB, "bug"), false);   // gives Reset something to do
  click($("fac-all"));
  click($("fac-reset"));
  check("arming one button cancels the other's confirmation", /^Enable for all factions \(\d+\)$/.test($("fac-all").textContent) && /^Click again to reset 1$/.test($("fac-reset").textContent), $("fac-all").textContent + " | " + $("fac-reset").textContent);
  click($("fac-reset"));
  check("(cleanup) back on the defaults", customCount() === 0);
  check("faction emblems are tinted per faction (unselected buttons + ticks + legend), dark when selected", (() => {
    const c = css; return ["bug", "bot", "squid"].every((f) => new RegExp('input\\[value="' + f + '"\\]:not\\(:checked\\) \\+ span \\.fac-icon[^{]*\\.fac-' + f + ' \\.fac-icon\\s*\\{[^}]*hue-rotate').test(c)) && /input:checked \+ span \.fac-icon\s*\{\s*filter: brightness\(0\)/.test(c);
  })());
  // faction emblems (linked from the wiki), with a letter / plain-text fallback if one fails to load
  const ICON = { bug: "Terminid_Icon.svg", bot: "Automaton_Icon.svg", squid: "Illuminate_Icon.svg" };
  const btnSpan = (f) => doc.querySelector('input[name="faction"][value="' + f + '"]').nextElementSibling;
  check("Terminid / Automaton / Illuminate buttons show their emblems", ["bug", "bot", "squid"].every((f) => { const im = btnSpan(f).querySelector("img.fac-icon"); return im && im.getAttribute("src") === "https://helldivers.wiki.gg/images/" + ICON[f]; }));
  check("the Any button shows the Super Earth emblem and keeps its text", (() => { const im = btnSpan("any").querySelector("img.fac-icon"); return im && im.getAttribute("src") === "https://helldivers.wiki.gg/images/Super_Earth_Icon.svg" && btnSpan("any").textContent === "Any" && /Terminids/.test(btnSpan("bug").textContent); })());
  check("the Any emblem is plain white when unselected (no tint rule) and dark when selected", !/value="any"\]:not/.test(css) && /input:checked \+ span \.fac-icon\s*\{\s*filter: brightness\(0\)/.test(css));
  const IMG = "https://helldivers.wiki.gg/images/";
  const wbIcons = () => { const o = {}; doc.querySelectorAll("#gear-list .wb-block").forEach((b) => { const im = b.querySelector(".wb-name img.wb-icon"); o[b.querySelector(".wb-name").textContent] = im ? im.getAttribute("src").replace(IMG, "") + (im.classList.contains("wb-icon-white") ? " (white)" : "") : null; }); return o; };
  const wi = wbIcons();
  check("Base Game gets the Super Earth emblem in white", wi["Base Game"] === "Super_Earth_Icon.svg (white)", wi["Base Game"]);
  check("the Requisition group header gets the Requisition Slip, in its own colours", wi["Requisition"] === "Requisition_Slip.svg", JSON.stringify(wi));
  check("...and the shops inside it carry no icon of their own", ["Patriotic Administration Center", "Orbital Cannons", "Hangar", "Bridge", "Engineering Bay", "Robotics Workshop"].every((n) => wi[n] === null), JSON.stringify(wi));
  check("Super Citizen/Event Rewards (one merged warbond) and Superstore get their icons", wi["Super Citizen/Event Rewards"] === "Super_Citizen_Title_Icon.svg" && wi["Superstore"] === "Super_Credit.svg" && wi["Super Citizen Edition"] === undefined && wi["Campaign/Event Rewards"] === undefined, JSON.stringify(wi));
  check("on phones the warbond header puts the title first and the buttons on their own line", /@media \(max-width: 640px\)[\s\S]*\.wb-header \.wb-tools\s*\{[^}]*grid-column:\s*1 \/ -1/.test(css));
  check("the first six premium warbonds get their rank / title icons", wi["Helldivers Mobilize"] === "Level_50_Skull_Admiral_Rank_Icon.svg" && wi["Steeled Veterans"] === "Level_70_Admirable_Admiral_Rank_Icon.svg" && wi["Cutting Edge"] === "Level_90_Galactic_Commander_Rank_Icon.svg" && wi["Democratic Detonation"] === "Level_120_5-Star_General_Rank_Icon.svg" && wi["Polar Patriots"] === "Level_150_Super_Private_Rank_Icon.svg" && wi["Viper Commandos"] === "Viper_Commando_Title_Icon.svg", JSON.stringify(wi));
  check("the shop titles inside Requisition are Super Credit Blue and the Requisition header stays yellow", /\.wb-group-body \.wb-header \.wb-name\s*\{[^}]*color:\s*#70F5FF/i.test(css) && !/\.wb-group > \.wb-header \.wb-name[^}]*#70F5FF/i.test(css));
  check("Freedom's Flame, Chemical Agents and Truth Enforcers get their title icons", wi["Freedom's Flame"] === "Fire_Safety_Officer_Title_Icon.svg" && wi["Chemical Agents"] === "Expert_Exterminator_Title_Icon.svg" && wi["Truth Enforcers"] === "Free_of_Thought_Title_Icon.svg", JSON.stringify(wi));
  check("the next ten warbonds get their title icons", (() => { const want = { "Urban Legends": "Super_Pedestrian", "Servants of Freedom": "Servant_of_Freedom", "Borderline Justice": "Super_Sheriff", "Masters of Ceremony": "Decorated_Hero", "Force of Law": "Extra_Judicial", "Control Group": "Exemplary_Subject", "Halo: ODST": "Rookie", "Dust Devils": "Burier_of_Heads", "Python Commandos": "Python_Commando", "Killzone": "Assault_Infantry" }; return Object.keys(want).every((n) => wi[n] === want[n] + "_Title_Icon.svg"); })(), JSON.stringify(wi));
  check("Redacted Regiment, Siege Breakers, Entrenched Division and Exo Experts get their title icons", wi["Redacted Regiment"] === "Redacted_Title_Icon.svg" && wi["Siege Breakers"] === "Bunker_Buster_Title_Icon.svg" && wi["Entrenched Division"] === "Mudskipper_Title_Icon.svg" && wi["Exo Experts"] === "Exosuit_Certified_Title_Icon.svg", JSON.stringify(wi));
  check("Warhammer 40k, Ironclad Democracy and Scope of Authority get their (PNG) title icons", wi["Warhammer 40k"] === "Still_Standing_Title_Icon.png" && wi["Ironclad Democracy"] === "Treadhead_Title_Icon.png" && wi["Scope of Authority"] === "thumb/Longshot_Title_Icon.png/600px-Longshot_Title_Icon.png", JSON.stringify(wi));
  check("every warbond (and the Requisition group) now has an icon; only the shops inside Requisition don't", Object.keys(wi).filter((n) => !wi[n]).sort().join("|") === "Bridge|Engineering Bay|Hangar|Orbital Cannons|Patriotic Administration Center|Robotics Workshop", Object.keys(wi).filter((n) => !wi[n]).join("|"));
  check("PNG and SVG icons share one size rule (same height)", /\.wb-icon\s*\{[^}]*height:\s*1\.15em/.test(css));
  check("no other warbond has an icon", Object.keys(wi).filter((n) => wi[n] && !/^Requisition$|^Base Game$|^Super Citizen\/Event Rewards$|^Superstore$|^Helldivers Mobilize$|^Steeled Veterans$|^Cutting Edge$|^Democratic Detonation$|^Polar Patriots$|^Viper Commandos$|^Freedom's Flame$|^Chemical Agents$|^Truth Enforcers$|^Urban Legends$|^Servants of Freedom$|^Borderline Justice$|^Masters of Ceremony$|^Force of Law$|^Control Group$|^Halo: ODST$|^Dust Devils$|^Python Commandos$|^Killzone$|^Redacted Regiment$|^Siege Breakers$|^Entrenched Division$|^Exo Experts$|^Warhammer 40k$|^Ironclad Democracy$|^Scope of Authority$/.test(n)).length === 0);
  check("...and only Base Game's icon is recoloured", Object.keys(wi).filter((n) => /\(white\)/.test(wi[n] || "")).join() === "Base Game");
  check("if an icon fails to load the title is just the name", (() => { const n = Array.from(doc.querySelectorAll("#gear-list .wb-name")).find((x) => x.textContent === "Superstore"); n.querySelector("img").dispatchEvent(new win.Event("error")); return !n.querySelector("img") && n.textContent === "Superstore"; })());
  check("every item's T/A/I ticks use the emblems", Array.from(doc.querySelectorAll("#gear-list .fac-chk")).every((c) => { const im = c.querySelector("img.fac-icon"); return im && im.getAttribute("src").endsWith(ICON[["bug", "bot", "squid"].find((f) => c.classList.contains("fac-" + f))]); }));
  check("the legend shows the emblems too", doc.querySelectorAll("#fac-tools .fac-legend img.fac-icon").length === 3);
  const chipImg = doc.querySelector("#gear-list .fac-chk.fac-bot img.fac-icon");
  const chipLabel = chipImg.closest(".fac-chk");
  chipImg.dispatchEvent(new win.Event("error"));
  check("if an emblem can't load, the tick falls back to its letter", chipLabel.textContent.trim() === "A" && !chipLabel.querySelector("img"), chipLabel.textContent);
  const btnImg = btnSpan("squid").querySelector("img.fac-icon");
  btnImg.dispatchEvent(new win.Event("error"));
  check("...and a faction button falls back to plain text", !btnSpan("squid").querySelector("img") && btnSpan("squid").textContent === "Illuminate", btnSpan("squid").textContent);
  check("the fallback doesn't break the checkbox", (() => { const b = chipLabel.querySelector("input"); const was = b.checked; tick(b, !was); const ok = b.checked === !was; tick(b, was); return ok; })());
  $("edit-factions").checked = false; $("edit-factions").dispatchEvent(new win.Event("change", { bubbles: true }));
  check("switching it off hides the tools again", $("fac-tools").hidden === true && !$("view-gear").classList.contains("edit-factions"));
  // edits survive a reload and are applied when the page starts
  const dom2 = new JSDOM(bundleHtml, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) { w.localStorage.setItem("hd2_factions", JSON.stringify({ [CONC]: ["bot"], [LIB]: [], "No Such Item": ["bug"], "Eagle Airstrike": ["nonsense"], "M-102 Fast Recon Vehicle": ["squid"] })); },
  });
  await new Promise((resolve) => dom2.window.addEventListener("load", resolve));
  const d2 = dom2.window.document, items2 = dom2.window.HD2_DATA.items;
  const f2 = (n) => items2.find((i) => i.name === n).factions.join(",");
  check("a reloaded page applies the saved edits", f2(CONC) === "bot" && f2(LIB) === "", f2(CONC) + " / " + f2(LIB));
  check("...ignores unknown items and invalid values", f2("Eagle Airstrike") === defaultOf("Eagle Airstrike"));
  check("...an entry saved under a name that has since changed still finds its item", f2("M-102 Gunner FRV") === "squid", f2("M-102 Gunner FRV"));
  const id2 = (n) => items2.find((i) => i.name === n).id;
  check("...and the old name-keyed save is rewritten with ids", (() => { const sv = JSON.parse(dom2.window.localStorage.getItem("hd2_factions")); return Object.keys(sv).every((k) => /^\d+$/.test(k)) && sv[id2(CONC)].join() === "bot" && sv[id2("M-102 Gunner FRV")].join() === "squid"; })(), dom2.window.localStorage.getItem("hd2_factions"));
  check("...and notes the 3 edits on the Randomizer tab", /edited faction lists \(3 items\)/.test(d2.getElementById("pool-text").textContent), d2.getElementById("pool-text").textContent);
  dom2.window.close();
  // an older save keyed by item names (owned + blocked) is read, then rewritten with ids
  const domM = new JSDOM(bundleHtml, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.localStorage.setItem("hd2_tracker", JSON.stringify({ "AR-23P Liberator Penetrator": true, "G-16 Impact": true, "M-102 Fast Recon Vehicle": true }));
      w.localStorage.setItem("hd2_blocked", JSON.stringify(["G-16 Impact"]));
    },
  });
  await new Promise((resolve) => domM.window.addEventListener("load", resolve));
  const idM = (n) => domM.window.HD2_DATA.items.find((i) => i.name === n).id;
  const trM = JSON.parse(domM.window.localStorage.getItem("hd2_tracker")), blM = JSON.parse(domM.window.localStorage.getItem("hd2_blocked"));
  check("an old name-keyed owned / blocked save is rewritten with ids", Object.keys(trM).every((k) => /^\d+$/.test(k)) && trM[idM("AR-23P Liberator Penetrator")] && trM[idM("G-16 Impact")] && trM[idM("M-102 Gunner FRV")] && blM.length === 1 && blM[0] === idM("G-16 Impact"), JSON.stringify(trM) + " " + JSON.stringify(blM));
  domM.window.close();
  // edited rules survive a reload too; damaged saved rules are skipped
  const dom4 = new JSDOM(bundleHtml, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.localStorage.setItem("hd2_settings", JSON.stringify({ faction: "any", disabledRules: ["capMine", "demoEscalation", "nonsense"],
        requirements: { eagle: { min: 3 }, sentry: { min: 0, max: 0 }, "no such tag": { min: 1 }, chaff: { min: 5, max: 2 }, med: { min: "x" }, armor: { min: 99 } } }));
    },
  });
  await new Promise((resolve) => dom4.window.addEventListener("load", resolve));
  const d4 = dom4.window.document;
  const texts4 = Array.from(d4.querySelectorAll("#require-chips .chip")).map((c) => c.firstChild.textContent);
  check("a reloaded page restores edited rows, the removed default and the added rules", texts4.join("|") === DEFAULT_ROWS.filter((t) => t !== "Mines ≤ 1" && t !== "Two base breakers when no weapon is one").map((t) => (t === "Eagle ≤ 2" ? "Eagle ≥ 3" : t)).concat("Sentry = 0").join("|"), texts4.join("|"));
  check("...and skips damaged saved rules (unknown tag, min above max, not a number, too big)", !texts4.some((t) => /no such|Chaff|99/.test(t)) && texts4.filter((t) => /Medium/.test(t)).length === 1);
  check("...with the reset buttons and the summary showing what differs", !d4.getElementById("presets-reset").hidden && !d4.getElementById("custom-clear").hidden && /1 added, 1 edited, 2 off/.test(d4.getElementById("rules-summary").textContent), d4.getElementById("rules-summary").textContent);
  dom4.window.close();
  // custom rules survive a reload; a damaged one is skipped; the old combined support switch splits into its three rows
  const dom5 = new JSDOM(bundleHtml, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
    beforeParse(w) {
      w.localStorage.setItem("hd2_settings", JSON.stringify({ faction: "any", disabledRules: ["capSupport"],
        customRules: [{ must: { sel: "cat:orbital", scope: "all", max: 0 } }, { must: { sel: "cat:nonsense", scope: "all", max: 0 } }, { when: [{ sel: "cat:eagle", scope: "strats", min: 2 }], must: { sel: "cat:sentry", scope: "all", max: 0 } }, "junk"] }));
    },
  });
  await new Promise((resolve) => dom5.window.addEventListener("load", resolve));
  const d5 = dom5.window.document;
  const texts5 = Array.from(d5.querySelectorAll("#require-chips .chip")).map((c) => c.firstChild.textContent);
  check("a saved ‘capSupport’ switch-off removes the three support-limit rows", !texts5.some((t) => /regular|Expendable ≤|Never a regular/.test(t)) && texts5.filter((t) => t === "Vehicle ≤ 1").length === 1, texts5.join("|"));
  check("...and saved custom rules come back as rows, damaged ones skipped", texts5.includes("Orbital ≤ 0") && texts5.includes("If Eagle ≥ 2 (stratagems), then Sentry ≤ 0") && !texts5.some((t) => /nonsense|junk/.test(t)) && /2 added, 3 off/.test(d5.getElementById("rules-summary").textContent), texts5.join("|") + " :: " + d5.getElementById("rules-summary").textContent);
  dom5.window.close();
  click(doc.querySelector('.tab[data-view="randomizer"]'));

  console.log("Export / import");
  {
    let captured = null, downloads = 0;
    win.URL.createObjectURL = (blob) => { captured = blob; return "blob:test"; };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute("download")) downloads++; };
    const readBlob = (blob) => new Promise((resolve) => { const r = new win.FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob); });
    const importText = async (text) => {
      const input = $("data-file");
      Object.defineProperty(input, "files", { configurable: true, value: [new win.File([text], "data.json")] });
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    };
    const AA = "AC-8 Autocannon";
    // make some data worth exporting: an unowned item, a blocked item, a faction edit, an odds rule
    if (gearBox("Eagle Airstrike").checked) click(gearBox("Eagle Airstrike"));
    if (!blockBtn(AA).getAttribute("aria-pressed") || blockBtn(AA).getAttribute("aria-pressed") === "false") click(blockBtn(AA));
    tick(facBox(CONC, "bot"), true);
    click(doc.querySelector('.tab[data-view="randomizer"]'));
    setv(bRow("odds").querySelector(".b-sel"), "cat:eagle"); setv(bRow("odds").querySelector(".b-scope"), "strats"); bRow("odds").querySelector(".b-n").value = "2"; click($("odds-add"));
    click(doc.querySelector('.tab[data-view="gear"]'));
    click($("data-export"));
    check("Export my data makes a download", downloads === 1 && !!captured && /Exported/.test($("data-msg").textContent), $("data-msg").textContent);
    const text = await readBlob(captured);
    const data = JSON.parse(text);
    check("the file has the app marker, a version and the four sections", data.app === "hd2-slopinator" && data.version === 1 && !!data.owned && Array.isArray(data.blocked) && !!data.factions && !!data.settings, Object.keys(data).join());
    check("...items are saved by permanent id: the unowned item is missing, the blocked one is listed, the edit is there", !data.owned[idOf("Eagle Airstrike")] && data.owned[idOf("EAT-17 Expendable Anti-Tank")] === true && data.blocked.includes(idOf(AA)) && JSON.stringify(data.factions[idOf(CONC)]) === '["bug","bot"]', JSON.stringify(data.blocked) + JSON.stringify(data.factions));
    check("...and the rules (an odds rule here) travel with it", (data.settings.weights || []).some((w) => w.sel === "cat:eagle" && w.factor === 2), JSON.stringify(data.settings));
    // change everything, then bring it back
    click(gearBox("Eagle Airstrike")); click(blockBtn(AA)); click(rowOf(CONC).querySelector(".fac-revert"));
    click(doc.querySelector('.tab[data-view="randomizer"]')); click($("custom-clear")); click(doc.querySelector('.tab[data-view="gear"]'));
    check("(the data really was changed first)", gearBox("Eagle Airstrike").checked && itemFactions(CONC) === "bug" && !JSON.parse(win.localStorage.getItem("hd2_settings")).weights.length);
    await importText(text);
    check("importing the file restores owned, blocked, faction edit and rules", !gearBox("Eagle Airstrike").checked && blockBtn(AA).getAttribute("aria-pressed") === "true" && itemFactions(CONC) === "bug,bot" && chipTexts().includes("Eagle ×2 odds (stratagems)"), $("data-msg").textContent);
    check("...the page says what came in", /Imported: \d+ owned items, \d+ blocked, 1 faction edit/.test($("data-msg").textContent), $("data-msg").textContent);
    check("...and it is saved in this browser", JSON.parse(win.localStorage.getItem("hd2_blocked")).includes(idOf(AA)) && JSON.parse(win.localStorage.getItem("hd2_settings")).weights.length === 1);
    // bad files change nothing
    const before = win.localStorage.getItem("hd2_tracker") + win.localStorage.getItem("hd2_settings");
    await importText("not json at all");
    check("a file that is not JSON is refused with a message", /isn't valid JSON/.test($("data-msg").textContent) && $("data-msg").classList.contains("bad"));
    await importText(JSON.stringify({ app: "something-else", version: 1 }));
    check("a JSON file from something else is refused", /doesn't look like a file exported from this tool/.test($("data-msg").textContent));
    await importText(JSON.stringify({ app: "hd2-slopinator", version: 99 }));
    check("a file from a newer version is refused", /newer version/.test($("data-msg").textContent));
    check("...none of the refused files changed anything", win.localStorage.getItem("hd2_tracker") + win.localStorage.getItem("hd2_settings") === before);
    // junk inside a good file is skipped by the loaders
    await importText(JSON.stringify({ app: "hd2-slopinator", version: 1, owned: { "99999": true, [idOf(AA)]: true, "x": 5 }, blocked: [99999, "junk", {}], factions: { "99999": ["bug"], [idOf(CONC)]: ["nonsense"] },
      settings: { faction: "nope", disabledRules: ["nonsense"], requirements: { "no such tag": { min: 1 } }, customRules: [{ bad: true }], weights: [{ sel: "tag:x", factor: 0 }] } }));
    check("unknown ids, bad factions and malformed rules inside a good file are skipped", /Imported/.test($("data-msg").textContent) && itemFactions(CONC) === "bug" && doc.querySelectorAll("#require-chips .chip").length === 17 && errors().length === 0, $("data-msg").textContent + " " + doc.querySelectorAll("#require-chips .chip").length);
    // a file with only some sections changes only those
    await importText(JSON.stringify({ app: "hd2-slopinator", version: 1, blocked: [] }));
    check("a file with only some sections leaves the other parts alone (blocked cleared, owned list kept)", blockBtn(AA).getAttribute("aria-pressed") === "false" && gearBox(AA).checked && JSON.parse(win.localStorage.getItem("hd2_tracker"))[idOf(AA)] === true);
    // put the test state back the way the later tests expect it
    click($("gear-select-all"));
    if (blockBtn(AA).getAttribute("aria-pressed") !== "true") click(blockBtn(AA));
  }
  console.log("Empty stratagem slots");
  {
    // Owning only the starting gear leaves fewer than four stratagems to bring; the empty slots are allowed.
    click($("gear-clear"));
    setFaction("any");
    generate();
    const stratCards = () => Array.from(doc.querySelectorAll("#results .loadout .card-row")[1].querySelectorAll(".item-card, .item-card2"));
    const empties = () => stratCards().filter((c) => c.classList.contains("is-empty"));
    check("owning fewer than 4 stratagems builds a loadout (no error)", errors().length === 0 && cards() === 7, errors().join(" | ") + " cards=" + cards());
    check("...the slots it can't fill are Empty Slot cards", empties().length === 2 && empties().every((c) => c.querySelector(".item-name").textContent === "Empty Slot"), empties().length);
    check("...with no pills, no lock button and the Super Earth emblem", empties().every((c) => !c.querySelector(".tag-pill") && !c.querySelector(".lock-btn") && /Super_Earth_Icon/.test(c.querySelector("img.item-img").getAttribute("src"))));
    check("...and a note says why", /2 stratagem slots are empty: you only have 2 stratagems/.test(doc.querySelector("#results .empty-note").textContent), doc.querySelector("#results .empty-note") && doc.querySelector("#results .empty-note").textContent);
    // rerolling a real stratagem must not trade it for an empty slot
    const real = stratCards().filter((c) => !c.classList.contains("is-empty"));
    const realNames = real.map((c) => c.querySelector(".item-name").textContent).sort().join();
    click(real[0].querySelector(".reroll-btn"));
    const after = stratCards().filter((c) => !c.classList.contains("is-empty")).map((c) => c.querySelector(".item-name").textContent).sort().join();
    check("rerolling a stratagem with nothing else to roll keeps it (never swaps it for an empty slot)", after === realNames && empties().length === 2, realNames + " -> " + after);
    check("...and tells you there is no other item", /no other/i.test($("messages").textContent), $("messages").textContent);
    // owning four or more fills every slot again
    click($("gear-select-all"));
    if (blockBtn("AC-8 Autocannon").getAttribute("aria-pressed") !== "true") click(blockBtn("AC-8 Autocannon"));
    generate();
    check("owning plenty of stratagems never leaves an empty slot", doc.querySelectorAll("#results .is-empty").length === 0 && !doc.querySelector("#results .empty-note"));
    // a weapon slot with nothing left to roll is an Empty Slot too, with its own note
    win.HD2_DATA.items.filter((i) => i.cat === "secondary" && i.factions.indexOf("none") === -1).forEach((i) => {
      const b = blockBtn(i.name); if (b && b.getAttribute("aria-pressed") !== "true") click(b);
    });
    generate();
    const weaponRow = () => Array.from(doc.querySelectorAll("#results .loadout .card-row")[0].querySelectorAll(".item-card, .item-card2"));
    check("with every secondary blocked the build still succeeds and the secondary slot is empty",
      errors().length === 0 && weaponRow()[1].classList.contains("is-empty"), errors().join(" | "));
    check("...and a note says a weapon slot is empty", /1 weapon slot is empty/.test(doc.querySelector("#results .empty-note").textContent));
    win.HD2_DATA.items.filter((i) => i.cat === "secondary" && i.factions.indexOf("none") === -1).forEach((i) => {
      const b = blockBtn(i.name); if (b && b.getAttribute("aria-pressed") === "true") click(b);
    });
  }
  console.log("Block from the results");
  {
    click($("gear-select-all"));
    setFaction("any");
    $("count").value = "1";
    generate();
    const slotCard = (i) => Array.from(doc.querySelectorAll("#results .loadout .item-card, #results .loadout .item-card2"))[i];
    const nameAt = (i) => slotCard(i).querySelector(".item-name").textContent;
    const before = nameAt(1);   // the secondary
    check("every real card has a Block button", Array.from(doc.querySelectorAll("#results .loadout .item-card, #results .loadout .item-card2")).every((c) => c.querySelector(".block-slot-btn")));
    click(slotCard(1).querySelector(".block-slot-btn"));
    check("Block replaces the item in that slot", nameAt(1) !== before && errors().length === 0, before + " -> " + nameAt(1));
    check("...marks it blocked in My Gear", blockBtn(before).getAttribute("aria-pressed") === "true");
    check("...and says so", new RegExp("Blocked " + before.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + " in My Gear").test($("messages").textContent), $("messages").textContent);
    check("...and it is saved (survives in the stored block list)", JSON.parse(win.localStorage.getItem("hd2_blocked")).includes(String(idOf(before))) || JSON.parse(win.localStorage.getItem("hd2_blocked")).includes(idOf(before)));
    for (let i = 0; i < 40; i++) { click($("reroll-all") || doc.querySelector("#results .reroll-all-btn")); if (nameAt(1) === before) break; }
    check("the blocked item never comes back on later rerolls", nameAt(1) !== before);
    // a locked slot can't be blocked
    click(slotCard(0).querySelector(".lock-btn"));
    check("a locked slot's Block button is disabled", slotCard(0).querySelector(".block-slot-btn").disabled === true);
    click(slotCard(0).querySelector(".lock-btn"));
    click(blockBtn(before));   // unblock again for the later tests
    check("unblocking in My Gear works as before", blockBtn(before).getAttribute("aria-pressed") === "false");
  }
  console.log("Saved images");
  {
    // a page whose data lists saved copies: those are used for every kind of picture; anything not listed keeps its wiki link
    const WIKI = "https://helldivers.wiki.gg/images/";
    const libUrl = win.HD2_DATA.items.find((i) => i.name === "AR-23 Liberator").imgUrl;
    const map = { [libUrl]: "img/items/lib.webp", [WIKI + "Armor_AP2_Icon.png"]: "img/icons/Armor_AP2_Icon.png", [WIKI + "Terminid_Icon.svg"]: "img/icons/Terminid_Icon.svg", [WIKI + "Super_Earth_Icon.svg"]: "img/icons/Super_Earth_Icon.svg" };
    const html = bundleHtml;
    check("(the bundle has an empty image list to swap)", html.includes('"images": {}'));
    const dom3 = new JSDOM(html.replace('"images": {}', '"images": ' + JSON.stringify(map)), { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
    await new Promise((resolve) => dom3.window.addEventListener("load", resolve));
    const w3 = dom3.window, d3 = w3.document;
    w3.HTMLElement.prototype.scrollIntoView = function () {};
    const srcs = (sel) => Array.from(d3.querySelectorAll(sel)).map((i) => i.getAttribute("src"));
    check("My Gear thumbnails use the saved copy when there is one", d3.querySelector('#gear-list input[data-item="AR-23 Liberator"]').closest(".gear-row").querySelector("img.gear-thumb").getAttribute("src") === "img/items/lib.webp");
    check("...and keep the wiki link for an item that isn't saved", d3.querySelector('#gear-list input[data-item="AR-23P Liberator Penetrator"]').closest(".gear-row").querySelector("img.gear-thumb").getAttribute("src").startsWith(WIKI));
    check("faction emblems and the Base Game icon use the saved copies", srcs(".fac-icon").some((x) => x === "img/icons/Terminid_Icon.svg") && srcs(".wb-icon").some((x) => x === "img/icons/Super_Earth_Icon.svg"), srcs(".fac-icon").join());
    w3.document.querySelector("#lock-primary").value = "SMG/FLAM-34 Stoker";
    w3.document.getElementById("controls").dispatchEvent(new w3.Event("submit", { bubbles: true, cancelable: true }));
    check("loadout cards use the saved armor-penetration icon", srcs("#results .ap-icon").includes("img/icons/Armor_AP2_Icon.png") && srcs("#results .ap-icon").some((x) => x.startsWith(WIKI)), srcs("#results .ap-icon").join());
    dom3.window.close();
    // the real bundle (nothing swapped): if images are saved, it carries them inside the file
    if (/"images": \{\n/.test(rawBundle)) {
      const domR = new JSDOM(rawBundle, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
      await new Promise((resolve) => domR.window.addEventListener("load", resolve));
      const dr = domR.window.document;
      const thumbs = Array.from(dr.querySelectorAll("#gear-list img.gear-thumb")).map((i) => i.getAttribute("src"));
      const saved = Object.keys(domR.window.HD2_DATA.images).length;
      check("the single-file build shows every saved picture from inside the file (no network needed)", saved > 0 && thumbs.length === ACTIVE && thumbs.filter((t) => t.startsWith("data:image/")).length >= 150, thumbs.filter((t) => t.startsWith("data:image/")).length + " of " + thumbs.length + " thumbnails are embedded");
      domR.window.close();
    }
  }

  console.log("Reset");
  click($("reset-all"));
  check("reset restores faction any + 1 loadout", doc.querySelector('input[name="faction"]:checked').value === "any" && $("count").value === "1");
  check("reset restores the default rows and clears added rules", chipTexts().join("|") === DEFAULT_ROWS.join("|") && JSON.parse(win.localStorage.getItem("hd2_settings")).disabledRules.length === 0);
  check("...but leaves My Gear alone", blockBtn("AC-8 Autocannon").getAttribute("aria-pressed") === "true" && $("grand-total").textContent === ACTIVE + " / " + ACTIVE + " items owned");

  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nAll UI checks passed");
  process.exit(failed ? 1 : 0);
})();
