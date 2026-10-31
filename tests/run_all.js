// run_all.js - the one command: rebuild the data/bundle, then run every test. Stops at the first red step.
//
//   node tests/run_all.js
//
// The UI test needs jsdom (npm install jsdom, once); it is skipped with a notice if it isn't installed.
const { spawnSync } = require("child_process");
const path = require("path");
const root = path.join(__dirname, "..");
const hasJsdom = (() => { try { require.resolve("jsdom", { paths: [root, process.cwd()].concat(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []) }); return true; } catch (e) { return false; } })();

const steps = [
  ["Build data + bundle", "python3", ["tools/build_gear.py", "--bundle"]],
  ["Image tool tests", "python3", ["tests/fetch_images_test.py"]],
  ["Permanent item id tests", "python3", ["tests/id_lock_test.py"]],
  ["Tag check tests", "python3", ["tests/tag_checks_test.py"]],
  ["Tags CSV tests", "python3", ["tests/tags_csv_test.py"]],
  ["Rule tests", "node", ["tests/engine_rules.js"]],
  ["Engine parity (generic rules vs hand-written)", "node", ["tests/engine_parity.js"]],
  ["Regression (invariants + odds)", "node", ["tests/regression.js"]],
];
if (hasJsdom) steps.push(["UI smoke test", "node", ["tests/ui_smoke.js"]]);
else console.log("(skipping UI smoke test: jsdom not installed - run `npm install jsdom`)\n");

const t0 = Date.now();
for (const [label, cmd, args] of steps) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { console.log(`\nFAILED at: ${label}`); process.exit(1); }
}
console.log(`\nAll green in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
