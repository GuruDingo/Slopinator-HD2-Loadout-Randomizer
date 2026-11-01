#!/usr/bin/env node
// presend.js - everything to run once, right before a pull request is marked ready ("send it").
//
//   node tools/presend.js               quick tests, re-calibrate the odds, rebuild, full tests, repo checks
//   node tools/presend.js --no-calibrate   the same without the (slow) odds calibration
//
// During normal work use `node tests/run_all.js --quick` instead (no calibration check). The calibration only needs
// redoing here, once, however many items / rules changed since the last pull request.
//
// What it does, stopping at the first red step:
//   1. branch + pull request check (the pull request must still be open)
//   2. quick test run (so a broken build doesn't waste the calibration time)
//   3. tools/calibrate_odds.js --write   (~6 minutes)
//   4. rebuild docs/gear-data.js + dist bundle; refresh tests/baseline.json if the calibration changed
//   5. the full test run, including the odds-calibration check (what CI runs)
//   6. repo checks: generated files up to date, nothing private in tracked files or commit messages
// It does not commit or push: look at `git status`, then commit.
const { spawnSync } = require("child_process");
const path = require("path");
const root = path.join(__dirname, "..");
const noCalibrate = process.argv.includes("--no-calibrate");
const run = (cmd, args, opts) => spawnSync(cmd, args, Object.assign({ cwd: root, encoding: "utf8" }, opts || {}));
const stream = (label, cmd, args) => {
  console.log("\n=== " + label + " ===");
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { console.log("\nPRESEND FAILED at: " + label); process.exit(1); }
};
const fail = (msg) => { console.log("\nPRESEND FAILED: " + msg); process.exit(1); };
const t0 = Date.now();

// 1. branch + pull request
console.log("=== Branch and pull request ===");
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
console.log("branch: " + branch);
if (branch === "main") fail("on main; send-ready work lives on the pending branch");
let repoSlug = "";
const remote = run("git", ["remote", "get-url", "origin"]).stdout.trim();
const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(remote);
if (m) repoSlug = m[1];
if (repoSlug) {
  const pr = run("gh", ["api", "repos/" + repoSlug + "/pulls?head=" + repoSlug.split("/")[0] + ":" + branch + "&state=all", "--jq", ".[0] | [.number,.state,.merged_at,.draft] | @tsv"]);
  if (pr.status === 0 && pr.stdout.trim()) {
    const [num, state, mergedAt, draft] = pr.stdout.trim().split("\t");
    console.log("PR #" + num + ": " + state + (mergedAt ? " (merged)" : "") + (draft === "true" ? ", draft" : ""));
    if (state !== "open") fail("PR #" + num + " is not open; start a fresh pending branch first");
  } else console.log("(could not look up the pull request; skipped)");
}

// 2. quick tests
stream("Quick tests", "node", ["tests/run_all.js", "--quick"]);

// 3-4. calibration
if (noCalibrate) console.log("\n(odds calibration skipped)");
else {
  stream("Re-calibrate the odds (about 6 minutes)", "node", ["tools/calibrate_odds.js", "--write", "--builds", "30000", "--rounds", "10"]);
  stream("Rebuild data + bundle", "python3", ["tools/build_gear.py", "--bundle"]);
  const changed = run("git", ["diff", "--quiet", "--", "odds_calibration.json"]).status !== 0;
  console.log(changed ? "odds_calibration.json changed: refreshing the regression baseline" : "odds_calibration.json unchanged");
  if (changed) stream("Refresh regression baseline", "node", ["tests/regression.js", "--update-baseline"]);
}

// 5. full tests
stream("Full tests (what CI runs)", "node", ["tests/run_all.js"]);

// 6. repo checks
console.log("\n=== Repo checks ===");
const problems = [];
if (run("git", ["diff", "--quiet", "--", "docs/gear-data.js"]).status !== 0) {
  // the build above may have just rewritten it: that's fine as long as it gets committed
  console.log("note: docs/gear-data.js has uncommitted changes (commit them)");
}
const banned = ["Boss", "hd2loadout", "claude.ai/code", "Claude-Session", "sdixonword"];
for (const word of banned) {
  const g = run("git", ["grep", "-n", "-I", "-F", word, "--", ".", ":!tests/baseline.json", ":!tools/presend.js"]);
  if (g.stdout.trim()) problems.push('tracked files mention "' + word + '":\n' + g.stdout.trim().split("\n").slice(0, 5).join("\n"));
}
const base = run("git", ["rev-parse", "--verify", "-q", "origin/main"]).status === 0 ? "origin/main" : "main";
const msgs = run("git", ["log", base + "..HEAD", "--format=%an <%ae>%n%B"]).stdout;
for (const word of banned.concat(["users.noreply.github.com"])) {
  if (msgs.indexOf(word) !== -1) problems.push('a commit on this branch mentions "' + word + '"');
}
if (/^Claude-Session:/m.test(msgs)) problems.push("a commit message has a Claude-Session line");
if (problems.length) { console.log(problems.join("\n\n")); fail("repo checks"); }
console.log("no private words in tracked files or commit messages");
const st = run("git", ["status", "--short"]).stdout.trim();
console.log(st ? "uncommitted changes:\n" + st : "working tree clean");
console.log("\nPresend OK in " + ((Date.now() - t0) / 60000).toFixed(1) + " min. Commit anything listed above, push, then mark the PR ready.");
