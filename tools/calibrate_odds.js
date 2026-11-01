#!/usr/bin/env node
// Works out the per-item odds multipliers (the "calibration") that make the default rules roll every item about equally often.
//
// The generator re-rolls until a build meets the rules, so items that cover several needs (chaff + base breaker + ...) pass more
// often than single-purpose ones. This script rolls many builds, compares how often each item showed up with how often it would
// with fair dice, and nudges each item's odds against the difference, round after round.
//
//   node tools/calibrate_odds.js            -> prints the before / after report, writes nothing
//   node tools/calibrate_odds.js --write    -> also writes odds_calibration.json
//   options: --builds N (per round, default 30000)  --rounds N (default 14)
const fs = require("fs");
const path = require("path");
require("../docs/gear-data.js");
const HD2Engine = require("../docs/engine.js");
const DATA = globalThis.HD2_DATA;

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i === -1 ? d : (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith("--") ? true : process.argv[i + 1]); };
const BUILDS = Number(arg("builds", 30000)), ROUNDS = Number(arg("rounds", 14)), WRITE = !!arg("write", false);
const CLAMP = [0.25, 4];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const SLOT_OF = (it) => (it.cat === "primary" || it.cat === "secondary" || it.cat === "throwable") ? it.cat : "strat";
const rollable = DATA.items.filter((i) => i.factions.indexOf("none") === -1);

// Items are compared with the other items that play by the same limits. Each class gets whatever share of the rolls the rules give
// it (the support-weapon limit, "exactly one backpack", and so on decide that, and calibration leaves it alone); inside a class every
// item should be rolled equally often, which is what multi-role items (chaff + base breaker + ...) skew.
function classOf(it) {
  const has = (t) => it.tags.indexOf(t) !== -1;
  if (it.cat === "primary" || it.cat === "throwable") return it.cat;
  if (it.cat === "secondary") return has("melee") ? "secondary:melee" : "secondary";
  if (has("backpack")) return "strat:backpack";
  if (it.cat === "support") return has("expendable") ? "strat:support-expendable" : "strat:support";
  return "strat:" + it.cat;
}
function eligible(faction) { return rollable.filter((i) => faction === "any" || HD2Engine.worksFor(i, faction)); }

function measure(calibration, faction, builds, seed) {
  const eng = HD2Engine.create(DATA, { calibration, rng: mulberry32(seed) });
  const cnt = {};
  let unmet = 0;
  for (let b = 0; b < builds; b++) {
    const l = eng.generateLoadoutRelaxed({ faction });
    if (l.unmet.length) unmet++;
    [l.primary, l.secondary, l.throwable].concat(l.strategems).forEach((x) => { if (!x.empty) cnt[x.id] = (cnt[x.id] || 0) + 1; });
  }
  return { cnt, unmet, builds };
}

// Each item's count as a multiple of its class's average count (1.00 = rolled as often as its classmates).
function ratios(m, faction) {
  const sums = {}, ns = {}, r = {};
  const els = eligible(faction);
  els.forEach((i) => { const c = classOf(i); sums[c] = (sums[c] || 0) + (m.cnt[i.id] || 0); ns[c] = (ns[c] || 0) + 1; });
  els.forEach((i) => { const c = classOf(i); const mean = sums[c] / ns[c]; r[i.id] = mean ? (m.cnt[i.id] || 0) / mean : 1; });
  return r;
}
function summary(r) {
  const v = Object.values(r).sort((a, b) => a - b);
  const dev = v.map((x) => Math.abs(x - 1));
  return { min: v[0], max: v[v.length - 1], mean: v.reduce((a, b) => a + b) / v.length, maxDev: Math.max.apply(null, dev), within15: v.filter((x) => Math.abs(x - 1) <= 0.15).length / v.length, n: v.length };
}
const fmt = (s) => "min " + s.min.toFixed(2) + "x  max " + s.max.toFixed(2) + "x  within ±15%: " + Math.round(s.within15 * 100) + "% of " + s.n + " items";

const FACTIONS = ["any", "bug", "bot", "squid"];

const before = {};
FACTIONS.forEach((f) => { before[f] = summary(ratios(measure(null, f, BUILDS, 1), f)); });

function calibrate(faction) {
  const els = eligible(faction);
  const table = {};
  els.forEach((i) => { table[i.id] = 1; });
  for (let round = 0; round < ROUNDS; round++) {
    const cal = {}; cal[faction] = table;
    const m = measure(cal, faction, BUILDS, 100 + round);
    const r = ratios(m, faction);
    process.stderr.write(faction + " round " + (round + 1) + ": " + fmt(summary(r)) + "\n");
    const classSum = {}, classN = {};
    els.forEach((i) => { const c = classOf(i); classSum[c] = (classSum[c] || 0) + (m.cnt[i.id] || 0); classN[c] = (classN[c] || 0) + 1; });
    els.forEach((i) => {
      const mean = classSum[classOf(i)] / classN[classOf(i)];
      if (!mean) return;
      const ratio = Math.max(m.cnt[i.id] || 0, 1) / mean;
      const damp = mean < 100 ? 0.35 : 0.6;     // few expected hits = noisy ratio, so a smaller step
      table[i.id] = Math.min(CLAMP[1], Math.max(CLAMP[0], table[i.id] * Math.pow(1 / ratio, damp)));
    });
    // keep each class centred on 1 (only the differences inside a class matter)
    const logSum = {};
    els.forEach((i) => { const c = classOf(i); logSum[c] = (logSum[c] || 0) + Math.log(table[i.id]); });
    els.forEach((i) => { const c = classOf(i); table[i.id] = Math.min(CLAMP[1], Math.max(CLAMP[0], table[i.id] / Math.exp(logSum[c] / classN[c]))); });
  }
  Object.keys(table).forEach((id) => { table[id] = Math.round(table[id] * 100) / 100; });
  return table;
}
const calib = {};
FACTIONS.forEach((f) => { calib[f] = calibrate(f); });

console.log("\nBEFORE (no calibration)");
FACTIONS.forEach((f) => console.log("  " + f.padEnd(6) + fmt(before[f])));
console.log("AFTER (one table per faction, checked with fresh rolls)");
FACTIONS.forEach((f) => { const m = measure(calib, f, BUILDS, 9000); const r = ratios(m, f); console.log("  " + f.padEnd(6) + fmt(summary(r)) + "   builds still missing a rule: " + (100 * m.unmet / m.builds).toFixed(1) + "%"); });
const byId = {}; DATA.items.forEach((i) => { byId[i.id] = i; });
const one = DATA.items.find((i) => /One-Two/.test(i.name));
console.log("One-Two multiplier (any):", calib.any[one.id]);
const clamped = FACTIONS.map((f) => f + ": " + Object.keys(calib[f]).filter((id) => calib[f][id] <= CLAMP[0] + 0.001 || calib[f][id] >= CLAMP[1] - 0.001).map((id) => byId[id].name).join(", ")).join("\n  ");
console.log("items at the clamp (could not be fully corrected):\n  " + clamped);

if (arg("outliers", false)) {
  FACTIONS.forEach((f) => {
    const m = measure(calib, f, BUILDS, 4242);
    const r = ratios(m, f);
    const rows = Object.keys(r).map((id) => ({ n: byId[id].name, r: r[id], c: calib[f][id] })).sort((a, b) => a.r - b.r);
    console.log("\n" + f + " still low:", rows.slice(0, 5).map((x) => x.n + " " + x.r.toFixed(2) + "x(m" + x.c + ")").join(" | "));
    console.log(f + " still high:", rows.slice(-5).map((x) => x.n + " " + x.r.toFixed(2) + "x(m" + x.c + ")").join(" | "));
  });
}

if (WRITE) {
  fs.writeFileSync(path.join(__dirname, "..", "odds_calibration.json"), JSON.stringify({ note: "Generated by tools/calibrate_odds.js; do not edit by hand.", factors: calib }) + "\n");
  console.log("wrote odds_calibration.json");
}
