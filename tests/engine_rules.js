// engine_rules.js - checks the behaviours that are NEW in the JS engine (the original hard-coded engine can't be
// compared here because it simply gave up): best-effort builds, flagged unmet rules, lock exemptions.
//
//   node tests/engine_rules.js
const assert = require("assert");
require("../docs/gear-data.js");
const HD2Engine = require("../docs/engine.js");
const engine = HD2Engine.create(globalThis.HD2_DATA);
const pick = (n) => { const i = engine.resolve(n); assert(i, "unknown item " + n); return i; };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}
const ids = (l) => l.unmet.map((u) => u.id);

test("unlocked builds are always strict (no unmet rules)", () => {
  for (let i = 0; i < 300; i++) assert.deepStrictEqual(engine.generateLoadoutRelaxed({ faction: "bot" }).unmet, []);
});

test("locking all 4 stratagem slots with no backpack builds and does NOT flag the backpack rule", () => {
  const locks = { strat1: pick("Eagle Airstrike"), strat2: pick("Orbital Gas Strike"), strat3: pick("Orbital Smoke Strike"), strat4: pick("Eagle Strafing Run") };
  for (let i = 0; i < 200; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "squid", locks });
    assert(!ids(l).includes("backpack"), "backpack flagged: " + ids(l));
    assert(!ids(l).includes("support"), "support flagged: " + ids(l));
    assert.strictEqual(l.strategems.length, 4);
  }
});

test("all 7 slots locked with nothing anti-tank: build completes and the armor rule is flagged", () => {
  const first = (list) => list.find((i) => !HD2Engine.has(i, "armor") && i.factions.indexOf("none") === -1);
  const P = engine.pools;
  const locks = { primary: first(P.primaries), secondary: first(P.secondaries), throwable: first(P.throwables) };
  const strats = [];
  P.strategems.forEach((s) => { if (strats.length < 4 && !HD2Engine.has(s, "armor") && s.factions.indexOf("none") === -1) strats.push(s); });
  strats.forEach((s, i) => { locks["strat" + (i + 1)] = s; });
  for (let i = 0; i < 20; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", locks });
    assert(ids(l).includes("armor"), "armor rule should be flagged, got " + JSON.stringify(ids(l)));
    assert.strictEqual(l.strategems.length, 4);
  }
});

test("free slots are used to satisfy rules the locks don't break (search still finds strict builds)", () => {
  const locks = { primary: pick("AR-23 Liberator"), strat1: pick("Eagle Strafing Run"), strat2: pick("Orbital Gas Strike") };
  for (let i = 0; i < 100; i++) assert.deepStrictEqual(engine.generateLoadoutRelaxed({ faction: "any", locks }).unmet, []);
});

// handheld:3 can never be met without locks: only one backpack-slot item is allowed and only backpacks carry "handheld".
test("unmeetable requirement: completes the build, flags only that requirement (almost always)", () => {
  let onlyRequire = 0;
  for (let i = 0; i < 60; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", requirements: { handheld: 3 } });
    const u = l.unmet.find((x) => x.id === "require");
    assert(u, "requirement should be flagged");
    assert(u.tag === "handheld" && u.min === 3 && u.actual < 3);
    if (ids(l).every((x) => x === "require")) onlyRequire++;
  }
  assert(onlyRequire >= 54, "other rules should still be met; only " + onlyRequire + "/60 were");
});

test("best-effort build gets as close to a hard requirement as it can (demo:7)", () => {
  const actuals = [];
  for (let i = 0; i < 40; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", requirements: { demo: 7 } });
    const u = l.unmet.find((x) => x.id === "require");
    actuals.push(u ? u.actual : 7);
  }
  const avg = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  assert(avg >= 4, "average demo count " + avg.toFixed(1) + " is lower than expected");
});

test("faction relax still preferred over flagging rules (bug with only the starting gear and two small warbonds: relaxed, off-faction flagged)", () => {
  for (let i = 0; i < 20; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "bug", ownedWarbonds: ["base", "cutting_edge", "urban_legends"] });
    assert.deepStrictEqual(l.unmet, []);
    assert.strictEqual(l.factionOverridden, true);
  }
});

test("a build with no eligible items at all throws a GenerationError", () => {
  assert.throws(() => engine.generateLoadoutRelaxed({ faction: "any", ownedWarbonds: [] }), HD2Engine.GenerationError);
});

test("strict generateLoadout() still refuses to return a build that breaks a rule", () => {
  assert.throws(() => engine.generateLoadout({ faction: "any", requirements: { handheld: 3 } }), HD2Engine.GenerationError);
});

test("locked backpack-type stratagems still waive the one-backpack rule without a flag", () => {
  const locks = { strat1: pick("B-1 Supply Pack"), strat2: pick("AC-8 Autocannon") };
  for (let i = 0; i < 100; i++) assert(!ids(engine.generateLoadoutRelaxed({ faction: "any", locks })).includes("backpack"));
});


// ---- rule priority tiers ----
test("tier table: Overwrite (your own) > Core > Preferred", () => {
  const T = HD2Engine.RULE_TIER;
  assert.deepStrictEqual(HD2Engine.TIER_NAMES, ["Overwrite", "Core", "Preferred"]);
  ["require", "custom"].forEach((r) => assert.strictEqual(T[r], 0, r));
  ["backpack", "support", "armor", "chaff", "demo", "capMixed"].forEach((r) => assert.strictEqual(T[r], 1, r));
  ["med", "panic", "demoEscalation", "shield", "supply", "capRegular", "capExpend", "capVehicle", "capEagle", "capMine"].forEach((r) => assert.strictEqual(T[r], 2, r));
  HD2Engine.RULES.filter((r) => r.kind !== "weight").forEach((r) => assert(Object.prototype.hasOwnProperty.call(T, r.id), "no tier for " + r.id));  // odds rules are not ranked
});
test("scoring: one higher-tier miss is worse than any number of lower-tier misses", () => {
  const u = (...ids) => ids.map((id) => ({ id }));
  const S = HD2Engine.scoreUnmet;
  const core = ["backpack", "support", "armor", "chaff", "demo"], pref = ["med", "panic", "demoEscalation", "shield", "supply"];
  assert(S(u("require"), 0) > S(u(...core, ...pref), 0));
  assert(S(u("armor"), 0) > S(u(...pref), 0));
  assert(S(u("armor", "chaff"), 0) > S(u("armor"), 0), "same tier: fewer misses wins");
  assert(S(u("require"), 3) > S(u("require"), 1), "shortfall breaks ties");
  assert.strictEqual(S([], 0), 0);
});
test("best-effort build gives up the PREFERRED rule when it has to choose (backpack kept, medium killer dropped)", () => {
  const mk = (cat, name, tags) => ({ id: name, cat, name, nicknames: [], tags, factions: ["any"], warbond: "base", imgUrl: "" });
  const e = HD2Engine.create({
    warbonds: [{ key: "base", name: "Base" }],
    items: [
      mk("primary", "P", ["chaff", "armor", "demo", "panic"]), mk("secondary", "S", []), mk("throwable", "T", []),
      mk("support", "Sup", []), mk("orbital", "O1", []), mk("orbital", "O2", []),
      mk("backpack", "Pack", ["backpack"]), mk("eagle", "Med eagle", ["med"]),
    ],
  });
  const locks = { strat1: e.resolve("Sup"), strat2: e.resolve("O1"), strat3: e.resolve("O2") };
  for (let i = 0; i < 100; i++) {
    const l = e.generateLoadoutRelaxed({ faction: "any", locks });
    assert.deepStrictEqual(l.strategems.map((s) => s.name).sort(), ["O1", "O2", "Pack", "Sup"], "picked " + l.strategems.map((s) => s.name));
    assert.deepStrictEqual(ids(l), ["med"]);
    assert.strictEqual(l.unmet[0].tier, 2); // Preferred
  }
});

// ---- requirements override item caps; in-game limits don't budge ----
function countTag(l, tag) { return [l.primary, l.secondary, l.throwable].concat(l.strategems).filter((x) => HD2Engine.has(x, tag)).length; }
function builds(n, opts) { const out = []; for (let i = 0; i < n; i++) out.push(engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, opts))); return out; }

test("without a requirement the caps still hold (max 2 Eagles, 1 mine, 1 vehicle)", () => {
  builds(400, {}).forEach((l) => {
    assert(countTag(l, "eagle") <= 2, "eagles " + countTag(l, "eagle"));
    assert(countTag(l, "mines") <= 1, "mines " + countTag(l, "mines"));
    assert(l.strategems.filter((s) => s.cat === "vehicle").length <= 1);
  });
});
test("Require Eagle >= 3 overrides the 2-Eagle cap and is met", () => {
  builds(100, { requirements: { eagle: 3 } }).forEach((l) => {
    assert(countTag(l, "eagle") >= 3, "eagles " + countTag(l, "eagle"));
    assert(!ids(l).includes("require"), "requirement flagged: " + JSON.stringify(l.unmet));
  });
});
test("Require mines >= 2 overrides the 1-mine cap and is met", () => {
  builds(100, { requirements: { mines: 2 } }).forEach((l) => {
    assert(countTag(l, "mines") >= 2, "mines " + countTag(l, "mines"));
    assert(!ids(l).includes("require"));
  });
});
test("a requirement only overrides ITS OWN cap (Eagle >= 3 does not allow 2 mines or 2 vehicles)", () => {
  builds(200, { requirements: { eagle: 3 } }).forEach((l) => {
    assert(countTag(l, "mines") <= 1);
    assert(l.strategems.filter((s) => s.cat === "vehicle").length <= 1);
  });
  // chaff/demo requirements are not cap tags, so they never allow a 3rd Eagle
  builds(300, { requirements: { chaff: 3, demo: 2 } }).forEach((l) => assert(countTag(l, "eagle") <= 2, "eagles " + countTag(l, "eagle")));
});
test("Require vehicle >= 2 allows two vehicles - but never two of the same kind (FRV / tank / exosuit)", () => {
  let two = 0;
  builds(150, { requirements: { vehicle: 2 } }).forEach((l) => {
    const v = l.strategems.filter((s) => s.cat === "vehicle");
    if (v.length >= 2) two++;
    ["frv", "tank", "mech"].forEach((t) => assert(countTag(l, t) <= 1, "two of " + t));
  });
  assert(two >= 140, "only " + two + " of 150 had two vehicles");
});
test("IN-GAME limits beat requirements: Require frv/tank/mech >= 2 can't be met, and you never get two", () => {
  ["frv", "tank", "mech"].forEach((t) => {
    builds(60, { requirements: { [t]: 2 } }).forEach((l) => {
      assert(countTag(l, t) <= 1, "two of " + t);
      assert(l.unmet.some((u) => u.id === "require" && u.tag === t), t + " requirement should be flagged unmet");
    });
  });
});
test("Require vehicle >= 3 reaches one FRV + one tank + one exosuit and nothing more", () => {
  builds(100, { requirements: { vehicle: 3 } }).forEach((l) => {
    const v = l.strategems.filter((s) => s.cat === "vehicle");
    assert(v.length <= 3);
    ["frv", "tank", "mech"].forEach((t) => assert(countTag(l, t) <= 1));
  });
});
test("Require expendable >= 3 overrides the 2-expendable support cap", () => {
  const l = builds(200, { requirements: { expendable: 3 } }).find((x) => countTag(x, "expendable") >= 3);
  assert(l, "never got 3 expendable supports");
});

// ---- tag counts: at least / at most / exactly, and removable default rules ----
const reqFlag = (l) => l.unmet.filter((u) => u.id === "require");
const flaggedFor = (l, tag) => reqFlag(l).some((u) => u.tag === tag);

test("a bare number still means 'at least' (old form), and { min } is the same thing", () => {
  assert.deepStrictEqual(HD2Engine.normalizeRequirements({ eagle: 3, mines: { min: 2 } }), { eagle: { min: 3 }, mines: { min: 2 } });
  builds(60, { requirements: { eagle: { min: 3 } } }).forEach((l) => assert(countTag(l, "eagle") >= 3 && !flaggedFor(l, "eagle")));
});
test("At most 0 Eagles: never an Eagle", () => {
  builds(300, { requirements: { eagle: { max: 0 } } }).forEach((l) => {
    assert.strictEqual(countTag(l, "eagle"), 0);
    assert(!flaggedFor(l, "eagle"), JSON.stringify(l.unmet));
  });
});
test("At most 1 Eagle / at most 0 mines hold across many builds", () => {
  builds(300, { requirements: { eagle: { max: 1 }, mines: { max: 0 } } }).forEach((l) => {
    assert(countTag(l, "eagle") <= 1 && countTag(l, "mines") === 0, "eagles " + countTag(l, "eagle") + " mines " + countTag(l, "mines"));
  });
});
test("Exactly 3 Eagles: every build has exactly three (overrides the 2-Eagle cap)", () => {
  builds(150, { requirements: { eagle: { min: 3, max: 3 } } }).forEach((l) => {
    assert.strictEqual(countTag(l, "eagle"), 3, "eagles " + countTag(l, "eagle"));
    assert(!flaggedFor(l, "eagle"));
  });
});
test("Exactly 0 backpacks replaces the 'exactly one backpack' rule instead of fighting it", () => {
  builds(200, { requirements: { backpack: { min: 0, max: 0 } } }).forEach((l) => {
    assert.strictEqual(countTag(l, "backpack"), 0);
    assert.deepStrictEqual(ids(l), [], "unexpected flags " + JSON.stringify(l.unmet));
  });
});
test("At most N never loosens the default 'at least one' check for that tag (at most 2 anti-tank still has >= 1)", () => {
  let ok = 0;
  builds(300, { requirements: { armor: { max: 2 } } }).forEach((l) => {
    const n = countTag(l, "armor");
    if (n >= 1 && n <= 2) ok++; else assert(flaggedFor(l, "armor") || ids(l).includes("armor"), "armor " + n + " not flagged");
  });
  assert(ok >= 285, "only " + ok + "/300 met it");
});
test("A range: chaff between 2 and 3", () => {
  let ok = 0;
  builds(300, { requirements: { chaff: { min: 2, max: 3 } } }).forEach((l) => {
    const n = countTag(l, "chaff");
    if (n >= 2 && n <= 3) ok++; else assert(flaggedFor(l, "chaff"), "chaff " + n + " not flagged");
  });
  assert(ok >= 270, "only " + ok + "/300 met it");
});
test("Contradictory rules (at least 3 but at most 1 Eagle) still build, and are flagged", () => {
  builds(40, { requirements: { eagle: { min: 3, max: 1 } } }).forEach((l) => {
    assert.strictEqual(l.strategems.length, 4);
    assert(flaggedFor(l, "eagle"));
  });
});
test("An unmet 'at most' / 'exactly' rule is reported with how it was phrased", () => {
  const l = engine.generateLoadoutRelaxed({ faction: "any", locks: { strat1: pick("Eagle Airstrike"), strat2: pick("Eagle Strafing Run") }, requirements: { eagle: { max: 1 } } });
  const u = l.unmet.find((x) => x.id === "require");
  assert(u && u.tag === "eagle" && u.max === 1 && u.actual >= 2 && /at most 1/.test(u.how), JSON.stringify(u));
});
test("In-game limits still win over 'at least': a tank request never gives two tanks", () => {
  builds(80, { requirements: { tank: { min: 2 } } }).forEach((l) => { assert(countTag(l, "tank") <= 1); assert(flaggedFor(l, "tank")); });
});

test("Rules list: every default rule has an id, a label and a kind", () => {
  assert(HD2Engine.RULES.length === 18 && HD2Engine.RULES.every((r) => r.id && r.label && /^(guarantee|limit|weight)$/.test(r.kind)));
  assert.deepStrictEqual(HD2Engine.RULES.filter((r) => r.kind === "guarantee").map((r) => r.id).sort(), ["armor", "backpack", "chaff", "demo", "demoEscalation", "med", "panic", "shield", "supply", "support"]);
});
test("A rule switched off is never flagged (locks that miss anti-tank, with the armor rule off)", () => {
  const first = (list) => list.find((i) => !HD2Engine.has(i, "armor") && i.factions.indexOf("none") === -1);
  const P = engine.pools;
  const locks = { primary: first(P.primaries), secondary: first(P.secondaries), throwable: first(P.throwables) };
  const strats = [];
  P.strategems.forEach((x) => { if (strats.length < 4 && !HD2Engine.has(x, "armor") && x.factions.indexOf("none") === -1) strats.push(x); });
  strats.forEach((x, i) => { locks["strat" + (i + 1)] = x; });
  for (let i = 0; i < 10; i++) {
    assert(ids(engine.generateLoadoutRelaxed({ faction: "any", locks })).includes("armor"));
    assert(!ids(engine.generateLoadoutRelaxed({ faction: "any", locks, disabledRules: ["armor"] })).includes("armor"));
  }
});
test("Turning a guarantee off lets builds drop it (no panic weapon rule -> builds without one appear)", () => {
  assert(builds(400, { disabledRules: ["panic"] }).some((l) => !l.coversPanic), "never saw a build without a panic weapon");
  builds(200, {}).forEach((l) => assert(l.coversPanic));
});
test("Caps switched off: 3+ Eagles, 2+ mines, 2+ vehicles and 2+ regular supports can appear", () => {
  const off = (rule, test) => assert(builds(3000, { disabledRules: [rule] }).some(test), "never saw it with " + rule + " off");
  // A 3rd Eagle is very rare at random (~1 in 1500), so test it with two Eagles locked in: cap on -> never a 3rd.
  const twoEagles = { strat1: pick("Eagle Airstrike"), strat2: pick("Eagle Strafing Run") };
  const withLocks = (disabledRules) => Array.from({ length: 400 }, () => engine.generateLoadoutRelaxed({ faction: "any", locks: twoEagles, disabledRules }));
  withLocks([]).forEach((l) => assert.strictEqual(countTag(l, "eagle"), 2));
  assert(withLocks(["capEagle"]).some((l) => countTag(l, "eagle") >= 3), "never saw a 3rd Eagle with capEagle off");
  off("capMine", (l) => countTag(l, "mines") >= 2);
  off("capVehicle", (l) => l.strategems.filter((x) => x.cat === "vehicle").length >= 2);
  off("capSupport", (l) => l.strategems.filter((x) => x.cat === "support" && !HD2Engine.has(x, "expendable")).length >= 2);
});
test("...and the in-game limits (one FRV / tank / exosuit) hold even with every cap off", () => {
  const all = HD2Engine.RULES.map((r) => r.id);
  builds(500, { disabledRules: all }).forEach((l) => ["frv", "tank", "mech"].forEach((t) => assert(countTag(l, t) <= 1, t + " " + countTag(l, t))));
});
test("Backpack rule off: a second backpack-slot item can be picked", () => {
  assert(builds(600, { disabledRules: ["backpack"] }).some((l) => countTag(l, "backpack") >= 2), "never saw two backpacks");
});
test("Switching nothing off changes nothing (default behaviour is unchanged)", () => {
  builds(200, { disabledRules: [] }).forEach((l) => assert.deepStrictEqual(l.unmet, []));
});

test("armor_pen: every weapon has valid armor-penetration data, and so does every stratagem that attacks", () => {
  // stratagems that do no damage (smoke, shields, supply, mobility) have no value
  const noAttack = new Set(["Eagle Smoke Strike", "Orbital Smoke Strike", "B-1 Supply Pack", "LIFT-850 Jump Pack", "SH-20 Ballistic Shield Backpack", "SH-32 Shield Generator Pack", "SH-51 Directional Shield", "LIFT-860 Hover Pack", "LIFT-182 Warp Pack", "FX-12 Shield Generator Relay"]);
  const weapon = new Set(["primary", "secondary", "throwable", "support"]);
  globalThis.HD2_DATA.items.forEach((i) => {
    if (weapon.has(i.cat)) {
      assert(Array.isArray(i.armorPen) && i.armorPen.length >= 1 && i.armorPen.length <= 2, i.name + " " + JSON.stringify(i.armorPen));
      i.armorPen.forEach((n) => assert(Number.isInteger(n) && n >= -1 && n <= 11, i.name + " " + n));
    } else if (noAttack.has(i.name)) assert.deepStrictEqual(i.armorPen, [], i.name);
    else {
      assert(i.armorPen.length >= 1 && i.armorPen.length <= 2, i.name + " " + JSON.stringify(i.armorPen));
      i.armorPen.forEach((n) => assert(Number.isInteger(n) && n >= 0 && n <= 11, i.name + " " + n));
    }
  });
  const by = (n) => globalThis.HD2_DATA.items.find((i) => i.name === n).armorPen;
  assert.deepStrictEqual([by("AR-23 Liberator"), by("AR-23P Liberator Penetrator"), by("RS-422 Railgun"), by("G-3 Smoke"), by("LAS-17 Double-Edge Sickle"), by("GR-8 Recoilless Rifle"), by("PLAS-45 Epoch"), by("CQC-9 Defoliation Tool")], [[2], [3], [5], [-1], [2, 4], [5, 6], [4, 5], [3, 5]]);
  assert.deepStrictEqual([by("Eagle Airstrike"), by("Eagle Strafing Run"), by("Orbital Railcannon Strike"), by("A/MG-43 Machine Gun Sentry"), by("EXO-45 Patriot Exosuit"), by("B-100 Portable Hellbomb")], [[5], [5], [7], [3], [3, 6], [10]]);
});

test("hand-held shields need a one-handed primary or a melee weapon (a pistol does not count), bubble shields do not", () => {
  const noOneHand = (l) => !HD2Engine.has(l.primary, "onehand") && !HD2Engine.has(l.primary, "melee") && !HD2Engine.has(l.secondary, "melee");
  // lock a two-handed primary and secondary so the shield rule is what is being tested (unlocked, the generator picks a one-hander)
  const run = (name, n) => Array.from({ length: n }, () => engine.generateLoadoutRelaxed({ faction: "any", locks: { primary: pick("AR-23 Liberator"), secondary: pick("P-19 Redeemer"), strat1: pick(name) } }));
  const hand = run("SH-20 Ballistic Shield Backpack", 50);
  assert(hand.every(noOneHand), "the locked weapons should not be one-handed (pick other weapons for this test)");
  hand.forEach((l) => assert(l.unmet.some((u) => u.id === "shield"), "handheld shield without one-hander should be flagged"));
  // the bubble generator pack and the shield relay never trigger it
  ["SH-32 Shield Generator Pack", "FX-12 Shield Generator Relay"].forEach((n) => run(n, 50).forEach((l) => assert(!l.unmet.some((u) => u.id === "shield"), n + " should not need a one-hander")));
});

// ---- Preset rules: the eight default rules that are plain tag counts --------------------------------------------
const PRESETS = HD2Engine.RULES.filter((r) => r.preset);
// What the website does with a preset row: switch the preset off and pass the row as the player's own requirement.
const asRequirements = (over) => {
  const req = {};
  PRESETS.forEach((p) => { req[p.preset.tag] = Object.assign({}, p.preset); delete req[p.preset.tag].tag; });
  return { disabledRules: PRESETS.map((p) => p.id), requirements: Object.assign(req, over || {}) };
};

test("Presets: nine rules carry their system-default tag counts", () => {
  const got = PRESETS.map((p) => p.id + ":" + p.preset.tag + ":" + (p.preset.min ?? "") + ":" + (p.preset.max ?? "")).sort();
  assert.deepStrictEqual(got, ["armor:armor:1:", "backpack:backpack:1:1", "capEagle:eagle::2", "capExpend:expendable::2", "capMine:mines::1", "capVehicle:vehicle::1", "demo:demo:1:", "med:med:1:", "panic:panic:1:"]);
  PRESETS.forEach((p) => assert(HD2Engine.RULES.some((r) => r === p)));
});
test("Presets: the default counts, handed over as the player's own requirements, give builds that follow them", () => {
  const o = asRequirements();
  for (let i = 0; i < 300; i++) {
    const l = engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, o));
    assert.deepStrictEqual(l.unmet, [], "unmet: " + JSON.stringify(l.unmet));
    PRESETS.forEach((p) => {
      const n = countTag(l, p.preset.tag);
      if (p.preset.min !== undefined) assert(n >= p.preset.min, p.id + " too few: " + n);
      if (p.preset.max !== undefined) assert(n <= p.preset.max, p.id + " too many: " + n);
    });
  }
});
test("Presets: an edited cap works (Vehicle <= 2 allows two vehicles, which the default never does)", () => {
  assert(!builds(400, {}).some((l) => countTag(l, "vehicle") > 1), "default allowed two vehicles");
  const o = asRequirements({ vehicle: { max: 2 } });
  const two = Array.from({ length: 1500 }, () => engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, o)));
  assert(two.some((l) => countTag(l, "vehicle") === 2), "never saw two vehicles");
  two.forEach((l) => assert(countTag(l, "vehicle") <= 2));
});
test("Presets: an edited minimum works (Eagle >= 3 replaces 'at most 2 Eagles'; Anti-Tank >= 2 replaces 'at least 1')", () => {
  const o = asRequirements({ eagle: { min: 3 }, armor: { min: 2 } });
  for (let i = 0; i < 100; i++) {
    const l = engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, o));
    assert(countTag(l, "eagle") >= 3 && countTag(l, "armor") >= 2, "eagle " + countTag(l, "eagle") + ", armor " + countTag(l, "armor"));
  }
});
test("Presets: a removed preset is not enforced (no Anti-Tank row -> builds without any appear)", () => {
  const o = asRequirements();
  delete o.requirements.armor;
  assert(Array.from({ length: 1500 }, () => engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, o))).some((l) => countTag(l, "armor") === 0), "never saw a build without anti-tank");
});
test("Presets: Backpack at most 0 (the Backpack row edited to ban backpacks) builds with none", () => {
  const o = asRequirements({ backpack: { max: 0 } });
  for (let i = 0; i < 100; i++) assert.strictEqual(countTag(engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, o)), "backpack"), 0);
});

// ---- Generic rules: scoped counts, categories, if/then, spread; the seven non-plain defaults ----------------------
const strict = (n, opts) => Array.from({ length: n }, () => engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, opts)));
const catCount = (l, cat) => [l.primary, l.secondary, l.throwable].concat(l.strategems).filter((i) => i.cat === cat).length;
const regularSupports = (l) => l.strategems.filter((i) => i.cat === "support" && !HD2Engine.has(i, "expendable")).length;
const expendables = (l) => l.strategems.filter((i) => HD2Engine.has(i, "expendable")).length;

test("Generic rules: malformed rules are dropped, good ones are copied", () => {
  const good = { when: [{ sel: "cat:eagle", scope: "strats", min: 2 }], must: { sel: "cat:orbital", max: 0 } };
  const bad = [null, 5, {}, { must: { sel: "nope", min: 1 } }, { must: { sel: "tag:armor", scope: "moon", min: 1 } }, { must: { sel: "tag:armor", min: 3, max: 1 } },
    { must: { sel: "tag:armor" } }, { must: { sel: "tag:armor", min: 9 } }, { when: "x", must: { sel: "tag:armor", min: 1 } }, { spread: { tags: ["med", "armor"], max: 1 } }]; // the last one is a saved balance rule from an older version: dropped
  assert.strictEqual(HD2Engine.normalizeRules(bad.concat([good])).length, 1);
  const copy = HD2Engine.normalizeRule(good);
  assert.notStrictEqual(copy, good);
  assert.deepStrictEqual(copy, { when: [{ sel: "cat:eagle", scope: "strats", min: 2 }], must: { sel: "cat:orbital", scope: "all", max: 0 } });
});
test("Generic rules: a category rule (no Orbitals) is kept by every build", () => {
  const rule = { must: { sel: "cat:orbital", max: 0 } };
  const bs = strict(400, { customRules: [rule] });
  bs.forEach((l) => { assert.strictEqual(catCount(l, "orbital"), 0); assert.deepStrictEqual(l.unmet, []); });
});
test("Generic rules: a slot scope counts only that slot (a chaff killer as PRIMARY: every build has one)", () => {
  const bs = strict(300, { customRules: [{ must: { sel: "tag:chaff", scope: "primary", min: 1 } }] });
  bs.forEach((l) => { assert(HD2Engine.has(l.primary, "chaff")); assert.deepStrictEqual(l.unmet, []); });
  assert(strict(300, {}).some((l) => !HD2Engine.has(l.primary, "chaff")), "without the rule a chaff-less primary should appear");
});
test("Generic rules: if / then holds only when the condition does (2+ Eagles -> no Orbitals; fewer Eagles may have Orbitals)", () => {
  const rule = { when: [{ sel: "cat:eagle", scope: "strats", min: 2 }], must: { sel: "cat:orbital", max: 0 } };
  const bs = strict(1200, { customRules: [rule] });
  bs.forEach((l) => { assert.deepStrictEqual(l.unmet, []); if (catCount(l, "eagle") >= 2) assert.strictEqual(catCount(l, "orbital"), 0); });
  assert(bs.some((l) => catCount(l, "eagle") >= 2), "needs builds with two Eagles");
  assert(bs.some((l) => catCount(l, "eagle") < 2 && catCount(l, "orbital") > 0), "builds without two Eagles may still have an Orbital");
});
test("Generic rules: an if/then with two 'if' conditions needs both", () => {
  const rule = { when: [{ sel: "cat:eagle", min: 1 }, { sel: "cat:orbital", min: 1 }], must: { sel: "cat:sentry", max: 0 } };
  strict(800, { customRules: [rule] }).forEach((l) => { if (catCount(l, "eagle") && catCount(l, "orbital")) assert.strictEqual(catCount(l, "sentry"), 0); });
});
test("Generic rules: a rule that cannot hold is reported with its count, and the build still completes", () => {
  // three Eagles AND three Orbitals can't both fit in four stratagem slots
  const rules = [{ must: { sel: "cat:eagle", scope: "strats", min: 3 } }, { must: { sel: "cat:orbital", scope: "strats", min: 3 } }];
  const l = engine.generateLoadoutRelaxed({ faction: "any", customRules: rules });
  const u = l.unmet.find((x) => x.id === "custom");
  assert(u && u.tier === 0 && u.rule.must.min === 3 && u.actual === l.strategems.filter((s) => s.cat === u.rule.must.sel.slice(4)).length && l.strategems.length === 4);
});
test("Locks win: a locked item is never swapped to satisfy a rule; the rule it breaks is reported", () => {
  const locks = { strat1: pick("Eagle Airstrike"), strat2: pick("Eagle Strafing Run") };
  const rule = { must: { sel: "cat:eagle", max: 1 } };
  strict(200, { locks, customRules: [rule] }).forEach((l) => {
    assert(l.strategems[0] === locks.strat1 && l.strategems[1] === locks.strat2);
    assert(l.unmet.some((u) => u.id === "custom"), "the broken rule should be reported");
    assert.strictEqual(catCount(l, "eagle"), 2, "no third Eagle should be added around the locks");
  });
});
test("Locks win (default limits): two locked regular supports are kept, no limit is flagged and no third is added", () => {
  const locks = { strat1: pick("RS-422 Railgun"), strat2: pick("AC-8 Autocannon") };
  strict(200, { locks }).forEach((l) => {
    assert(l.strategems[0] === locks.strat1 && l.strategems[1] === locks.strat2);
    assert(!ids(l).some((x) => /^cap/.test(x)), "limits are never flagged: " + ids(l));
    assert.strictEqual(regularSupports(l), 2);
  });
});
test("Support limits: a regular support is never mixed with an expendable one, and never two regulars; switch off -> both appear", () => {
  strict(600, {}).forEach((l) => { assert(regularSupports(l) <= 1); assert(!(regularSupports(l) && expendables(l)), "mixed"); assert(expendables(l) <= 2); });
  assert(strict(1500, { disabledRules: ["capMixed"] }).some((l) => regularSupports(l) && expendables(l)), "never saw a mixed build with the rule off");
  assert(strict(1500, { disabledRules: ["capRegular"] }).some((l) => regularSupports(l) >= 2), "never saw two regulars with the rule off");
  // two expendables locked, so a third is a plain draw (not a rare one) once the limit is off
  const twoExp = { strat1: pick("EAT-17 Expendable Anti-Tank"), strat2: pick("MLS-4X Commando") };
  assert(strict(1000, { locks: twoExp, disabledRules: ["capExpend"] }).some((l) => expendables(l) >= 3), "never saw three expendables with the rule off");
  strict(300, { locks: twoExp }).forEach((l) => assert(expendables(l) === 2, "the limit let a third expendable in"));
});
test("Support limits: the old single 'capSupport' switch still turns all three off", () => {
  const bs = strict(1500, { disabledRules: ["capSupport"] });
  assert(bs.some((l) => regularSupports(l) && expendables(l)) && bs.some((l) => regularSupports(l) >= 2));
});
test("Default rules written as generic rules still flag what a build misses (shield needs a one-hander; support needs one)", () => {
  const two = ["AR-23 Liberator", "P-19 Redeemer"].map(pick);
  const l = engine.generateLoadoutRelaxed({ faction: "any", locks: { primary: two[0], secondary: two[1], strat1: pick("SH-20 Ballistic Shield Backpack") } });
  assert(ids(l).includes("shield"));
  const noSupport = engine.generateLoadoutRelaxed({ faction: "any", disabledRules: ["support"] });
  assert(!ids(noSupport).includes("support"));
});

test("Every support weapon carries the 'support' tag, so it works as a tag in rules", () => {
  const sup = globalThis.HD2_DATA.items.filter((i) => i.cat === "support");
  assert(sup.length > 0 && sup.every((i) => (i.tags || []).includes("support")), "a support weapon lacks the tag");
  assert(!globalThis.HD2_DATA.items.some((i) => i.cat !== "support" && (i.tags || []).includes("support")), "a non-support item has it");
  const bs = strict(300, { requirements: { support: { min: 0, max: 0 } }, disabledRules: ["support"] });
  const byName = (n) => globalThis.HD2_DATA.items.find((i) => i.name === n);
  bs.forEach((l) => assert(!l.strategems.some((n) => (byName(n.name || n) || {}).cat === "support"), "a support weapon was picked despite 'support = 0'"));
  assert(strict(300, { requirements: { support: { min: 1, max: 1 } } }).every((l) => l.strategems.filter((n) => (byName(n.name || n) || {}).cat === "support").length === 1));
});

test("Shield rule: a one-handed primary or a melee weapon satisfies it, a pistol does not", () => {
  const has = HD2Engine.has;
  const items = globalThis.HD2_DATA.items;
  assert(items.filter((i) => i.cat === "secondary").every((i) => has(i, "onehand")), "every secondary (pistols and melee) is tagged one-handed");
  const run = (locks) => Array.from({ length: 40 }, () => engine.generateLoadoutRelaxed({ faction: "any", locks: Object.assign({ strat1: pick("SH-20 Ballistic Shield Backpack") }, locks) }));
  const flagged = (l) => l.unmet.some((u) => u.id === "shield");
  run({ primary: pick("AR-23 Liberator"), secondary: pick("P-4 Senator") }).forEach((l) => assert(flagged(l), "a pistol alone must not satisfy the shield"));
  run({ primary: pick("AR-23 Liberator"), secondary: pick("CQC-2 Saber") }).forEach((l) => assert(!flagged(l), "a melee secondary satisfies it"));
  run({ primary: pick("SMG-37 Defender"), secondary: pick("P-4 Senator") }).forEach((l) => assert(!flagged(l), "a one-handed primary satisfies it"));
  run({ primary: pick("CB-9 Exploding Crossbow"), secondary: pick("P-4 Senator") }).forEach((l) => assert(!flagged(l), "a one-handed non-SMG primary satisfies it"));
  // the other half of the condition: no hand-held shield, nothing to check
  Array.from({ length: 40 }, () => engine.generateLoadoutRelaxed({ faction: "any", locks: { primary: pick("AR-23 Liberator"), secondary: pick("P-4 Senator"), strat1: pick("SH-32 Shield Generator Pack") } })).forEach((l) => assert(!flagged(l)));
});

test("Groups are tags now: noammo drives the supply rule, nonexp the support caps; old grp: selectors are read as the tags", () => {
  const items = HD2Engine.create(HD2_DATA).pools;
  const all = items.primaries.concat(items.secondaries, items.throwables, items.strategems);
  const noammo = all.filter((i) => HD2Engine.has(i, "noammo"));
  assert.strictEqual(noammo.length, 20);
  assert(noammo.every((i) => (HD2Engine.has(i, "charge") || HD2Engine.has(i, "expendable")) && (["primary", "secondary", "support"].includes(i.cat) || HD2Engine.has(i, "rover"))), "noammo only on charge / expendable weapons and Rovers");
  assert(HD2Engine.SELECTOR_GROUPS === undefined, "there are no selector groups any more");
  const old = HD2Engine.normalizeRule({ when: [{ sel: "grp:noAmmo", scope: "all", min: 2 }], must: { sel: "tag:supply", scope: "strats", max: 0 } });
  assert(old && old.when[0].sel === "tag:noammo", "old saved selector is translated");
  const oldReg = HD2Engine.normalizeRule({ must: { sel: "grp:regularSupport", scope: "strats", max: 1 } });
  assert(oldReg && oldReg.must.sel === "tag:nonexp", "old grp:regularSupport is read as tag:nonexp");
  const sup = all.filter((i) => i.cat === "support");
  assert.strictEqual(sup.filter((i) => HD2Engine.has(i, "nonexp")).length, 29);
  assert(sup.every((i) => HD2Engine.has(i, "nonexp") !== HD2Engine.has(i, "expendable")), "every support weapon is exactly one of expendable / non-expendable");
  assert(all.filter((i) => i.cat !== "support").every((i) => !HD2Engine.has(i, "nonexp")), "nonexp only on support weapons");
  const engine = HD2Engine.create(HD2_DATA);
  const pick = (n) => all.find((i) => i.name === n);
  for (let k = 0; k < 40; k++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", locks: { strat1: pick("AX/ARC-3 K-9"), strat2: pick("ARC-3 Arc Thrower") } });
    assert(l.strategems.every((i) => !HD2Engine.has(i, "supply")) || l.unmet.some((u) => u.id === "supply"), "K-9 + Arc Thrower count as two no-ammo items, so no supply pack");
  }
});

test("alwaysOwned: an item stays in the pool when its warbond is not owned (MG-43 and Orbital Precision Strike now sit in shops)", () => {
  const items = globalThis.HD2_DATA.items;
  const always = items.filter((i) => i.alwaysOwned).map((i) => i.name).sort();
  assert.deepStrictEqual(always, ["MG-43 Machine Gun", "Orbital Precision Strike"]);
  const e = HD2Engine.create(globalThis.HD2_DATA);
  const locks = { strat1: e.resolve("MG-43 Machine Gun"), strat2: e.resolve("Orbital Precision Strike") };
  for (let i = 0; i < 20; i++) {
    const l = e.generateLoadoutRelaxed({ faction: "any", ownedWarbonds: ["base", "req_e", "req_h", "req_o", "req_r"], locks });
    const names = l.strategems.map((s) => s.name);
    assert(names.includes("MG-43 Machine Gun") && names.includes("Orbital Precision Strike"));
  }
  const free = HD2Engine.create(globalThis.HD2_DATA);
  let seen = 0;
  for (let i = 0; i < 300; i++) {
    const l = free.generateLoadoutRelaxed({ faction: "any", ownedWarbonds: ["base", "req_e", "req_h", "req_o", "req_r"] });
    l.strategems.forEach((s) => { assert(["base", "req_e", "req_h", "req_o", "req_r"].includes(s.warbond) || s.alwaysOwned, s.name + " from " + s.warbond); if (s.alwaysOwned) seen++; });
  }
  assert(seen > 0, "an always-owned item is rolled even though its shop is not owned");
});

// ---- repair step: a build that failed every random attempt is fixed up one item at a time ----
test("Repair: 'Fire = 4 stratagems' is nearly impossible to roll but always fixable by single swaps", () => {
  const rule = { must: { sel: "tag:fire", scope: "strats", min: 4, max: 4 } };
  let plainClean = 0;
  for (let i = 0; i < 15; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "bug", customRules: [rule] });
    assert.strictEqual(l.unmet.length, 0, "left unmet: " + JSON.stringify(l.unmet.map((u) => u.id)));
    assert.strictEqual(l.strategems.filter((s) => HD2Engine.has(s, "fire")).length, 4);
    const plain = engine.generateLoadoutRelaxed({ faction: "bug", customRules: [rule], repair: false });
    if (!plain.unmet.length) plainClean++;
  }
  assert(plainClean < 15, "without the repair step this is expected to fail most of the time");
});
test("Repair: locked items are never touched and the caps still hold", () => {
  const rule = { must: { sel: "tag:fire", scope: "strats", min: 4, max: 4 } };
  const locks = { primary: pick("AR-23 Liberator"), strat1: pick("Eagle Airstrike") };
  for (let i = 0; i < 15; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", customRules: [rule], locks });
    assert.strictEqual(l.primary.name, "AR-23 Liberator");
    assert.strictEqual(l.strategems[0].name, "Eagle Airstrike");
    assert(l.strategems.filter((s) => HD2Engine.has(s, "eagle")).length <= 2 || l.unmet.length > 0);
    assert.strictEqual(new Set(l.strategems.map((s) => s.name)).size, 4, "no stratagem twice");
    assert(l.strategems.filter((s) => s.cat === "vehicle").length <= 1);
  }
});
test("Repair: an impossible request still ends with a completed, flagged build (never worse than the unrepaired best)", () => {
  const rules = [{ must: { sel: "cat:eagle", scope: "strats", min: 3 } }, { must: { sel: "cat:orbital", scope: "strats", min: 3 } }];
  for (let i = 0; i < 5; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", customRules: rules });
    assert(l.unmet.some((u) => u.id === "custom") && l.strategems.length === 4 && l.strategems.every(Boolean));
  }
});

// ---- odds (weight) rules ----
function rollShare(opts, n, pickFn) {
  const hits = { yes: 0, total: 0 };
  for (let i = 0; i < n; i++) { const l = engine.generateLoadoutRelaxed(Object.assign({ faction: "any" }, opts)); hits.total++; if (pickFn(l)) hits.yes++; }
  return hits.yes / hits.total;
}
test("Odds: the default melee rule is an odds rule (a third as likely) and can be removed", () => {
  const r = HD2Engine.RULES.find((x) => x.id === "meleeWeight");
  assert(r && r.kind === "weight" && r.weight.sel === "tag:melee" && r.weight.scope === "secondary");
  const isMelee = (l) => HD2Engine.has(l.secondary, "melee");
  const withDefault = rollShare({}, 3000, isMelee), without = rollShare({ disabledRules: ["meleeWeight"] }, 3000, isMelee);
  assert(without > withDefault * 2, "removing it should roughly triple melee: " + withDefault + " vs " + without);
});
test("Odds: a player's rule with the same selector and scope replaces the default (melee x3 gives far more melee than the default)", () => {
  const isMelee = (l) => HD2Engine.has(l.secondary, "melee");
  const dflt = rollShare({}, 3000, isMelee);
  const boosted = rollShare({ weights: [{ sel: "tag:melee", scope: "secondary", factor: 3 }] }, 3000, isMelee);
  assert(boosted > dflt * 4, dflt + " vs " + boosted);
});
test("Odds: a stratagem odds rule changes how often that kind shows up, and 1 changes nothing", () => {
  const eagles = (l) => l.strategems.some((s) => s.cat === "eagle");
  const base = rollShare({}, 2000, eagles);
  const more = rollShare({ weights: [{ sel: "cat:eagle", scope: "strats", factor: 5 }] }, 2000, eagles);
  const less = rollShare({ weights: [{ sel: "cat:eagle", scope: "strats", factor: 0.2 }] }, 2000, eagles);
  assert(more > base + 0.1 && less < base - 0.1, base + " " + more + " " + less);
});
test("Odds: a weapon odds rule applies to the slot in its scope only", () => {
  const rule = { sel: "tag:assault rifle", scope: "primary", factor: 10 };
  const primArmor = rollShare({ weights: [rule] }, 1500, (l) => HD2Engine.has(l.primary, "assault rifle"));
  const primArmorBase = rollShare({}, 1500, (l) => HD2Engine.has(l.primary, "assault rifle"));
  const secArmor = rollShare({ weights: [rule] }, 1500, (l) => HD2Engine.has(l.secondary, "assault rifle"));
  const secArmorBase = rollShare({}, 1500, (l) => HD2Engine.has(l.secondary, "assault rifle"));
  assert(primArmor > primArmorBase + 0.15, primArmorBase + " -> " + primArmor);
  assert(Math.abs(secArmor - secArmorBase) < 0.06, "secondary should not move: " + secArmorBase + " -> " + secArmor);
});
test("Odds: malformed odds rules are dropped, the last one per selector + scope wins", () => {
  const N = HD2Engine.normalizeWeights;
  assert.strictEqual(N([null, 5, {}, { sel: "nope", factor: 2 }, { sel: "tag:fire", factor: 0 }, { sel: "tag:fire", factor: 99 }, { sel: "tag:fire", scope: "moon", factor: 2 }, { sel: "cat:nothing", factor: 2 }]).length, 0);
  assert.deepStrictEqual(N([{ sel: "tag:fire", factor: 2 }, { sel: "tag:fire", scope: "all", factor: 0.5 }, { sel: "tag:arc", scope: "strats", factor: 1.5 }]),
    [{ sel: "tag:fire", scope: "all", factor: 0.5 }, { sel: "tag:arc", scope: "strats", factor: 1.5 }]);
});

test("Empty slots: owning fewer than 4 stratagems leaves the rest empty (allowed), without an error", () => {
  const real = engine.pools.strategems.filter((s) => s.warbond === "base" || s.alwaysOwned);
  assert.strictEqual(real.length, 2);
  for (let i = 0; i < 100; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", ownedWarbonds: ["base"] });
    assert.strictEqual(l.strategems.length, 4);
    assert.strictEqual(l.emptySlots, 2);
    const empties = l.strategems.filter((s) => s.empty);
    assert.strictEqual(empties.length, 2);
    assert(empties[0] !== empties[1], "empty slots must be separate objects");
    assert(empties.every((e) => e.name === "Empty Slot" && e.tags.length === 0));
    real.forEach((r) => assert(l.strategems.includes(r), r.name + " should be in the build"));
  }
});
test("Empty slots: blocked stratagems count as not owned; locks count as owned", () => {
  const allNames = engine.pools.strategems.map((s) => s.name);
  const keep = ["Eagle Airstrike", "Orbital Gas Strike", "Orbital Smoke Strike"];
  const excluded = new Set(allNames.filter((n) => !keep.includes(n)));
  const l = engine.generateLoadoutRelaxed({ faction: "any", excluded });
  assert.strictEqual(l.emptySlots, 1);
  keep.forEach((n) => assert(l.strategems.some((s) => s.name === n), n));
  const locked = engine.generateLoadoutRelaxed({ faction: "any", excluded, locks: { strat1: pick("Eagle Cluster Bomb") } });
  assert.strictEqual(locked.emptySlots, 0, "a locked stratagem fills the fourth slot");
});
test("Empty slots: a stratagem that only misses because of the faction filter is used (faction relaxed), not left empty", () => {
  // Own only one stratagem that does not work against bots plus Orbital Precision Strike: against bots it is off-faction but still better than a hole.
  const offFaction = engine.pools.strategems.find((x) => !HD2Engine.worksFor(x, "bot") && x.factions.indexOf("none") === -1);
  const keep = ["Orbital Precision Strike", offFaction.name];
  const excluded = new Set(engine.pools.strategems.filter((x) => !keep.includes(x.name)).map((x) => x.name));
  for (let i = 0; i < 50; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "bot", excluded });
    assert(l.strategems.some((x) => x.name === offFaction.name), offFaction.name + " should be kept");
    assert.strictEqual(l.emptySlots, 2);
    assert(l.factionOverridden);
  }
});
test("Empty slots: item caps never leave a slot empty while an owned stratagem is available", () => {
  // MG-43 and Orbital Precision Strike (always owned) + the AC-8 Autocannon: two regular support weapons break a preference
  // (at most one), but the third stratagem is still brought; only one slot is empty.
  const keep = ["MG-43 Machine Gun", "Orbital Precision Strike", "AC-8 Autocannon"];
  const excluded = new Set(engine.pools.strategems.filter((s) => !keep.includes(s.name)).map((s) => s.name));
  for (let i = 0; i < 40; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", excluded });
    assert.strictEqual(l.emptySlots, 1, l.strategems.map((s) => s.name).join());
    keep.forEach((n) => assert(l.strategems.some((s) => s.name === n), n));
  }
});
test("Empty slots: only the in-game limits hold when stratagems are few; the player's own max rules are flagged instead", () => {
  const two = ["M-102 Gunner FRV", "M-103 Supply FRV"].map(pick);
  const keep = ["Orbital Precision Strike", "MG-43 Machine Gun"].concat(two.map((x) => x.name));
  const excluded = new Set(engine.pools.strategems.filter((s) => !keep.includes(s.name)).map((s) => s.name));
  for (let i = 0; i < 30; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", excluded });
    assert.strictEqual(l.strategems.filter((s) => HD2Engine.has(s, "frv")).length, 1, "never two FRVs");
    assert.strictEqual(l.emptySlots, 1);
  }
  // the player's own "at most" rule gives way rather than leave an owned stratagem unused, and the build says so
  const keep3 = ["MG-43 Machine Gun", "Orbital Precision Strike", "AC-8 Autocannon"];
  const ex3 = new Set(engine.pools.strategems.filter((s) => !keep3.includes(s.name)).map((s) => s.name));
  const noPack = engine.generateLoadoutRelaxed({ faction: "any", excluded: ex3, requirements: { backpack: { max: 0 } } });
  assert(noPack.strategems.some((s) => s.name === "AC-8 Autocannon"));
  assert.strictEqual(noPack.emptySlots, 1);
  assert(noPack.unmet.some((u) => u.id === "require"), JSON.stringify(noPack.unmet));
});
test("Best effort: owning only support weapons fills all four slots and flags the support-weapon limit", () => {
  const keep = ["MG-43 Machine Gun", "M-105 Stalwart", "RS-422 Railgun", "FLAM-40 Flamethrower"];
  const excluded = new Set(engine.pools.strategems.filter((s) => !keep.includes(s.name)).map((s) => s.name));
  for (let i = 0; i < 20; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: "any", excluded });
    assert.strictEqual(l.emptySlots, 0);
    keep.forEach((n) => assert(l.strategems.some((s) => s.name === n), n));
    assert(l.unmet.some((u) => u.id === "capRegular"), JSON.stringify(l.unmet));
  }
});
test("Best effort: a weapon slot with nothing owned for it is left empty instead of failing the build", () => {
  const sec = engine.pools.secondaries.map((x) => x.name);
  const excluded = new Set(sec);
  const l = engine.generateLoadoutRelaxed({ faction: "any", excluded });
  assert(l.secondary.empty && l.secondary.name === "Empty Slot");
  assert.strictEqual(l.emptyWeapons, 1);
  assert(l.primary && !l.primary.empty);
});
test("Empty slots: owning enough stratagems never produces one", () => {
  for (let i = 0; i < 300; i++) {
    const l = engine.generateLoadoutRelaxed({ faction: i % 2 ? "bug" : "squid" });
    assert.strictEqual(l.emptySlots, 0);
    assert(l.strategems.every((s) => !s.empty));
  }
});
test("Empty slots: the repair step and seeded builds accept empty slots", () => {
  // an unmeetable request (Vehicle >= 2 with so few stratagems) is still built and flagged
  const l = engine.generateLoadoutRelaxed({ faction: "any", ownedWarbonds: ["base"], requirements: { vehicle: { min: 1 } } });
  assert.strictEqual(l.strategems.length, 4);
  assert(ids(l).includes("require"), ids(l));
  assert.strictEqual(l.emptySlots, 2);
});

console.log("\n" + passed + " engine rule tests passed" + (process.exitCode ? " (with failures)" : ""));
