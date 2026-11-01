// odds_calibration.js - the per-item odds multipliers (odds_calibration.json, made by tools/calibrate_odds.js) still do their job.
//
// Rolls many builds with a fixed random seed and checks that every item comes up about as often as the other items of its group
// (Engine.oddsClass). If this fails after an item or rule change, run `node tools/calibrate_odds.js --write` and rebuild.
const assert = require("assert");
require("../docs/gear-data.js");
const HD2Engine = require("../docs/engine.js");
const DATA = globalThis.HD2_DATA;
const BUILDS = 20000;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let failures = 0, run = 0;
function test(name, fn) { run++; try { fn(); console.log("  ok   " + name); } catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); } }

const rollable = DATA.items.filter((i) => i.factions.indexOf("none") === -1);
const eligible = (f) => rollable.filter((i) => f === "any" || HD2Engine.worksFor(i, f));
const FACTIONS = ["any", "bug", "bot", "squid"];

test("odds_calibration.json is in the data, with a multiplier for every item that can roll in each faction", () => {
  assert(DATA.calibration, "no calibration in gear-data.js (run tools/build_gear.py)");
  FACTIONS.forEach((f) => {
    assert(DATA.calibration[f], "no table for " + f);
    const missing = eligible(f).filter((i) => !(DATA.calibration[f][i.id] > 0)).map((i) => i.name);
    assert.strictEqual(missing.length, 0, f + ": no multiplier for " + missing.slice(0, 5).join(", ") + " (run tools/calibrate_odds.js --write)");
  });
});

function measure(faction, opts, seed) {
  const eng = HD2Engine.create(DATA, Object.assign({ rng: mulberry32(seed) }, opts || {}));
  const cnt = {};
  for (let b = 0; b < BUILDS; b++) {
    const l = eng.generateLoadoutRelaxed({ faction });
    [l.primary, l.secondary, l.throwable].concat(l.strategems).forEach((x) => { if (!x.empty) cnt[x.id] = (cnt[x.id] || 0) + 1; });
  }
  return cnt;
}
function ratios(cnt, faction) {
  const sum = {}, n = {}, r = {};
  eligible(faction).forEach((i) => { const c = HD2Engine.oddsClass(i); sum[c] = (sum[c] || 0) + (cnt[i.id] || 0); n[c] = (n[c] || 0) + 1; });
  eligible(faction).forEach((i) => { const c = HD2Engine.oddsClass(i); r[i.id] = (cnt[i.id] || 0) / (sum[c] / n[c]); });
  return r;
}

FACTIONS.forEach((f, k) => {
  test("calibrated odds (" + f + "): every item is rolled about as often as the others of its group", () => {
    const r = ratios(measure(f, {}, 500 + k), f);
    const v = Object.keys(r).map((id) => ({ id, r: r[id] }));
    const worst = v.slice().sort((a, b) => Math.abs(b.r - 1) - Math.abs(a.r - 1))[0];
    const name = DATA.items.find((i) => String(i.id) === String(worst.id)).name;
    const within = v.filter((x) => Math.abs(x.r - 1) <= 0.2).length / v.length;
    assert(within >= 0.95, Math.round(within * 100) + "% of items within ±20% of their group (worst: " + name + " " + worst.r.toFixed(2) + "x)");
    assert(Math.abs(worst.r - 1) <= 0.4, "worst item " + name + " is at " + worst.r.toFixed(2) + "x");
  });
});

test("without calibration the same rolls are visibly uneven (so the check above means something)", () => {
  const r = ratios(measure("any", { calibration: null }, 777), "any");
  const v = Object.values(r);
  assert(Math.max.apply(null, v) > 1.4 && Math.min.apply(null, v) < 0.6, "min " + Math.min.apply(null, v).toFixed(2) + " max " + Math.max.apply(null, v).toFixed(2));
});

test("the 'evenOdds' rule is the off switch: with it removed the rolls are exactly the uncalibrated ones", () => {
  const roll = (opts, extra) => {
    const eng = HD2Engine.create(DATA, Object.assign({ rng: mulberry32(31) }, opts));
    const out = [];
    for (let i = 0; i < 300; i++) { const l = eng.generateLoadoutRelaxed(Object.assign({ faction: "any" }, extra)); out.push([l.primary.id, l.secondary.id, l.throwable.id].concat(l.strategems.map((s) => s.id)).join(".")); }
    return out.join("|");
  };
  assert.strictEqual(roll({}, { disabledRules: ["evenOdds"] }), roll({ calibration: null }, {}), "removing evenOdds should equal no calibration");
  assert.notStrictEqual(roll({}, {}), roll({ calibration: null }, {}), "calibration should change the rolls");
});

test("the AR/GL-21 One-Two is no longer favoured over other primaries", () => {
  const one = DATA.items.find((i) => /One-Two/.test(i.name));
  const r = ratios(measure("any", {}, 1234), "any");
  assert(r[one.id] > 0.8 && r[one.id] < 1.2, "One-Two at " + r[one.id].toFixed(2) + "x");
});

console.log("\n" + (run - failures) + " odds calibration tests passed" + (failures ? " (" + failures + " failed)" : ""));
process.exit(failures ? 1 : 0);
