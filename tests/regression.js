// regression.js - fast, JS-only safety net for the generation engine (~10 s).
//
//   node tests/regression.js                      check
//   node tests/regression.js --update-baseline    after an INTENTIONAL rule change, re-save tests/baseline.json
//
// Two kinds of check, both over the scenarios in scenarios.json with a seeded RNG (repeatable):
//  1. Invariants on every build: 3 weapons + 4 distinct stratagems, locks kept, exclusions respected, items
//     inside the ticked warbonds, items valid for the faction unless the build was flagged factionOverridden,
//     and no unmet rules on builds with no locks/requirements that were not forced to fall back.
//  2. Odds: per-item appearance rates vs tests/baseline.json (two-proportion z-test, |z| < 5). This catches
//     an accidental shift in how often an item shows up. If hd2gear.csv / hd2warbonds.csv changed (tag titles in hd2tags.csv don't count) since the
//     baseline was saved, the odds check is skipped with a notice (invariants still run); re-save the baseline.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("../docs/gear-data.js");
const HD2Engine = require("../docs/engine.js");

const N_PER_SCENARIO = 2000;
const Z_LIMIT = 5;
const BASELINE = path.join(__dirname, "baseline.json");
const update = process.argv.includes("--update-baseline");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dataHash = crypto.createHash("sha256").update(JSON.stringify({ warbonds: globalThis.HD2_DATA.warbonds.map((w) => w.key), items: globalThis.HD2_DATA.items })).digest("hex").slice(0, 16);
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, "scenarios.json"), "utf8"));
const problems = [];
const problem = (sc, msg) => { if (problems.length < 40) problems.push(`[${sc.name}] ${msg}`); };

function run(sc, idx) {
  const tStart = Date.now();
  const engine = HD2Engine.create(globalThis.HD2_DATA, { rng: mulberry32(1000 + idx) });
  const locks = {};
  for (const [slot, name] of Object.entries(sc.locks || {})) {
    const it = engine.resolve(name);
    if (!it) throw new Error("Unknown lock item: " + name);
    locks[slot] = it;
  }
  const excluded = new Set((sc.exclude || []).map((n) => engine.resolve(n).name));
  const owned = new Set(sc.warbonds || engine.allWarbondKeys);
  const hasLocks = Object.keys(locks).length > 0;
  const hasReq = Object.keys(sc.require || {}).length > 0;
  const counts = {};
  let failures = 0, overridden = 0, unmet = 0;
  for (let i = 0; i < N_PER_SCENARIO; i++) {
    let l;
    try {
      l = engine.generateLoadoutRelaxed({ faction: sc.faction, ownedWarbonds: sc.warbonds || undefined, locks, requirements: sc.require || {}, excluded });
    } catch (e) {
      if (!(e instanceof HD2Engine.GenerationError)) throw e;
      failures++; continue;
    }
    const all = [l.primary, l.secondary, l.throwable].concat(l.strategems);
    if (l.strategems.length !== 4 || all.some((x) => !x)) problem(sc, "incomplete build");
    if (new Set(l.strategems.map((s) => s.name)).size !== l.strategems.length) problem(sc, "duplicate stratagem: " + l.strategems.map((s) => s.name));
    const lockedNames = new Set(Object.values(locks).map((x) => x.name));
    for (const ln of lockedNames) if (!all.some((x) => x.name === ln)) problem(sc, "lock missing from build: " + ln);
    for (const x of all) {
      if (excluded.has(x.name)) problem(sc, "excluded item appeared: " + x.name);
      if (!lockedNames.has(x.name)) {
        if (!owned.has(x.warbond)) problem(sc, `${x.name} from unticked warbond ${x.warbond}`);
        if (!l.factionOverridden && !HD2Engine.worksFor(x, sc.faction)) problem(sc, `${x.name} not valid for ${sc.faction}`);
      }
    }
    if (!hasLocks && !hasReq && !l.factionOverridden && l.unmet.length) problem(sc, "unlocked strict-pool build has unmet rules: " + l.unmet.map((u) => u.id));
    if (l.factionOverridden) overridden++;
    if (l.unmet.length) unmet++;
    for (const x of all) counts[x.name] = (counts[x.name] || 0) + 1;
  }
  if (process.env.HD2_TIMING) console.error(sc.name, ((Date.now() - tStart) / 1000).toFixed(1) + "s");
  if (failures) problem(sc, `${failures} of ${N_PER_SCENARIO} builds could not be completed (scenario no longer feasible with the current data?)`);
  return { name: sc.name, n: N_PER_SCENARIO, counts, failures, overridden, unmet };
}

const t0 = Date.now();
const results = scenarios.map(run);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (update) {
  fs.writeFileSync(BASELINE, JSON.stringify({ dataHash, n: N_PER_SCENARIO, results }, null, 1));
  console.log(`Baseline saved (${results.length} scenarios, data ${dataHash}) in ${secs}s.`);
  process.exit(problems.length ? 1 : 0);
}

console.log(`Invariants: ${problems.length ? "FAIL" : "ok"} (${results.length} scenarios x ${N_PER_SCENARIO} builds, ${secs}s)`);
problems.forEach((p) => console.log("  " + p));

let oddsFail = 0;
if (!fs.existsSync(BASELINE)) {
  console.log("Odds: no baseline yet - run with --update-baseline");
  oddsFail = 1;
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  if (base.dataHash !== dataHash) {
    console.log(`Odds: SKIPPED - the gear CSVs changed since the baseline was saved. Re-save it: node tests/regression.js --update-baseline`);
  } else {
    for (const cur of results) {
      const old = base.results.find((r) => r.name === cur.name);
      if (!old) { console.log(`Odds: scenario "${cur.name}" not in baseline - re-save it`); oddsFail++; continue; }
      let worst = 0, worstName = "";
      const names = new Set(Object.keys(cur.counts).concat(Object.keys(old.counts)));
      for (const name of names) {
        const a = cur.counts[name] || 0, b = old.counts[name] || 0;
        const n1 = cur.n - cur.failures, n2 = old.n - old.failures;
        const p = (a + b) / (n1 + n2);
        const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
        const z = se ? Math.abs(a / n1 - b / n2) / se : 0;
        if (z > worst) { worst = z; worstName = name; }
      }
      const fb = Math.abs(cur.overridden / cur.n - old.overridden / old.n) > 0.03;
      const um = Math.abs(cur.unmet / cur.n - old.unmet / old.n) > 0.03;
      const bad = worst > Z_LIMIT || fb || um || cur.failures !== old.failures;
      if (bad) oddsFail++;
      console.log(`Odds: ${bad ? "FAIL" : "ok  "} ${cur.name} (worst |z| ${worst.toFixed(1)}${worst > Z_LIMIT ? " " + worstName : ""}${fb ? ", fallback rate moved" : ""}${um ? ", unmet-rule rate moved" : ""}${cur.failures !== old.failures ? ", failures changed" : ""})`);
    }
  }
}
process.exit(problems.length || oddsFail ? 1 : 0);
