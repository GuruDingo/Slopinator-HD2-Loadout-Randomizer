// engine_parity.js - the engine now evaluates its default rules as generic rules (selectors / scopes / if-then).
// tests/fixtures/engine_hardcoded.js is the engine as it was BEFORE that change (every default rule written out by
// hand). With the same random seed the two must build exactly the same loadouts and report the same unmet rules,
// whatever the faction, locks, switched-off rules and plain tag requirements.
//
// Left out on purpose, because the new engine behaves differently there (the rules are all visible rows now):
//   * a plain requirement on "chaff" no longer replaces the default "chaff killer in primary or secondary" check;
//   * "Expendable >= N" no longer lets a regular and an expendable support weapon be mixed.
//
//   node tests/engine_parity.js
const assert = require("assert");
require("../docs/gear-data.js");
const Old = require("./fixtures/engine_hardcoded.js");
const New = require("../docs/engine.js");
const DATA = globalThis.HD2_DATA;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TRIALS = Number(process.env.PARITY_TRIALS || 1500);
const factions = ["any", "bug", "bot", "squid"];
const oldIds = ["backpack", "support", "armor", "med", "chaff", "demo", "panic", "demoEscalation", "shield", "supply", "capSupport", "capVehicle", "capEagle", "capMine"];
const tags = Array.from(new Set(DATA.items.flatMap((i) => i.tags))).filter((t) => t !== "chaff" && t !== "expendable");
const active = DATA.items.filter((i) => i.factions.indexOf("none") === -1);
const byCat = (c) => active.filter((i) => i.cat === c);
const STRAT = ["support", "backpack", "vehicle", "eagle", "orbital", "sentry", "defensive"];

const r = mulberry32(12345);
const rnd = (n) => Math.floor(r() * n);
const pickOf = (list) => list[rnd(list.length)];

let failures = 0, flagged = 0, withLocks = 0;
for (let t = 0; t < TRIALS; t++) {
  const seed = 1000 + t;
  const opts = { faction: pickOf(factions) };
  const locks = {};
  if (r() < 0.5) {
    withLocks++;
    if (r() < 0.4) locks.primary = pickOf(byCat("primary"));
    if (r() < 0.4) locks.secondary = pickOf(byCat("secondary"));
    if (r() < 0.2) locks.throwable = pickOf(byCat("throwable"));
    const strats = active.filter((i) => STRAT.indexOf(i.cat) !== -1);
    const nLock = rnd(5);
    const used = new Set();
    for (let k = 1; k <= nLock; k++) { const s = pickOf(strats); if (!used.has(s.name)) { used.add(s.name); locks["strat" + k] = s; } }
  }
  opts.locks = locks;
  if (r() < 0.4) opts.disabledRules = oldIds.filter(() => r() < 0.25);
  if (r() < 0.35) {
    opts.requirements = {};
    for (let k = rnd(3) + 1; k > 0; k--) {
      const tag = pickOf(tags), op = rnd(3), n = rnd(3) + (op === 0 ? 1 : 0);
      opts.requirements[tag] = op === 0 ? { min: n } : op === 1 ? { max: n } : { min: n, max: n };
    }
  }
  const a = Old.create(DATA, { rng: mulberry32(seed) }), b = New.create(DATA, { rng: mulberry32(seed) });
  let ra, rb;
  // the balance rule was dropped from the live engine, so it is switched off in the frozen one
  const oldOpts = Object.assign({}, opts, { disabledRules: (opts.disabledRules || []).concat("balance") });
  try { ra = a.generateLoadoutRelaxed(oldOpts); } catch (e) { ra = "error:" + e.name; }
  // (the frozen engine has no repair step, so the live one is compared without it)
  try { rb = b.generateLoadoutRelaxed(Object.assign({}, opts, { repair: false })); } catch (e) { rb = "error:" + e.name; }
  const show = (l) => typeof l === "string" ? l : JSON.stringify({
    build: [l.primary, l.secondary, l.throwable].concat(l.strategems).map((i) => i.name),
    unmet: l.unmet.map((u) => u.id + (u.tag ? ":" + u.tag : "")).sort(), score: l.score, off: l.factionOverridden,
  });
  if (show(ra) !== show(rb)) {
    if (failures < 5) console.log("  DIFF seed " + seed + " " + JSON.stringify({ faction: opts.faction, off: opts.disabledRules, req: opts.requirements, locks: Object.keys(locks).map((k) => k + "=" + locks[k].name) }) + "\n    old " + show(ra) + "\n    new " + show(rb));
    failures++;
  }
  if (typeof ra !== "string" && ra.unmet.length) flagged++;
}
console.log("  " + TRIALS + " seeded builds (" + withLocks + " with locks, " + flagged + " with flagged rules) compared with the hand-written engine: " + failures + " difference(s)");
assert.strictEqual(failures, 0);
console.log("engine parity ok");
