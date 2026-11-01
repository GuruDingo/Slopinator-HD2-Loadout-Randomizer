/*
 * Helldivers 2 Slopinator - frozen copy of the original hard-coded generation engine (test oracle only)
 *
 * Pure logic: no DOM, no file access, so it runs the same in a browser and in Node
 * (which is how tests/ checks the live engine against these original hard-coded rules).
 *
 * Guarantees per loadout (the original hard-coded rules):
 *   - at least one of: anti-tank, medium killer, chaff killer (primary/secondary only),
 *     panic weapon (primary/secondary/throwable only), base breaker (2 if no weapon has it)
 *   - chaff / med / armor counts may differ by at most 3
 *   - support: max 1 non-expendable, max 2 expendable, never mixed, at least 1 total
 *   - exactly 1 backpack-slot item; shield backpacks need a one-handed weapon
 *   - max 1 vehicle, max 2 eagle, max 1 mine stratagem - but a "Require N+ <tag>" request for that same tag
 *     (eagle, mines, vehicle/frv/tank/mech, backpack, expendable) overrides the cap, so "Eagle >= 3" can be met
 *   - IN-GAME LIMITS that nothing overrides: at most one FRV, one tank and one exosuit (mech)
 *   - supply stratagems are blocked once 2+ "no-ammo" factors are present
 *   - the player's own "additional rules" (requirements) say how many items with a tag the build must have:
 *     at least N, at most N, or exactly N (a count of 0 is allowed for "at most" / "exactly")
 *   - every default rule below can be switched off with the `disabledRules` option (see RULES); the in-game
 *     limits can't be
 *   - LOCKS override the slot rules above (deliberately); locking all four
 *     stratagem slots also waives the "exactly one backpack" and "at least one support" rules
 *   - if the rules can't all be met (locks, warbonds, exclusions...), the build is completed anyway
 *     and loadout.unmet lists the rules it missed. Among imperfect builds, the one that misses the
 *     lowest-priority rules wins (see RULE_TIER below), then the one that misses fewer rules.
 *
 * Usage:
 *   const engine = HD2Engine.create(HD2_DATA);
 *   const loadout = engine.generateLoadoutRelaxed({ faction: "bug", ownedWarbonds: [...], ... });
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2Engine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var WEAPON_CATEGORIES = ["primary", "secondary", "throwable"];
  var STRATAGEM_CATEGORIES = ["support", "backpack", "vehicle", "eagle", "orbital", "sentry", "defensive"];

  // Thrown when no valid loadout can be built (the error carries a message).
  function GenerationError(message) {
    this.name = "GenerationError";
    this.message = message;
    this.stack = new Error(message).stack;
  }
  GenerationError.prototype = Object.create(Error.prototype);
  GenerationError.prototype.constructor = GenerationError;

  // -- The default rules (what the website's Rules menu lists) ---------------------
  // kind "guarantee" = checked on the finished build; "limit" = enforced while the stratagems are being picked.
  // `disabledRules: ["armor", "capEagle", ...]` switches any of them off. The in-game limits are not listed
  // here on purpose: nothing can turn those off.
  // A rule with `preset: { tag, min?, max? }` is a plain count of one tag over the whole build ("Anti-Tank >= 1",
  // "Vehicle <= 1"). The website shows those as editable rows next to the player's own rules rather than as a switch;
  // an edited row is handed to the engine as a requirement for that tag with the preset's rule id in disabledRules,
  // which behaves exactly like the preset did (tests/engine_rules.js checks that). The numbers in `preset` are the
  // system defaults and must match what the engine enforces below.
  var RULES = [
    { id: "backpack", kind: "guarantee", label: "Exactly one backpack-slot item", note: "Also stops a second backpack being picked.", preset: { tag: "backpack", min: 1, max: 1 } },
    { id: "support", kind: "guarantee", label: "At least one support weapon" },
    { id: "armor", kind: "guarantee", label: "At least one anti-tank item", preset: { tag: "armor", min: 1 } },
    { id: "med", kind: "guarantee", label: "At least one medium-enemy killer", preset: { tag: "med", min: 1 } },
    { id: "chaff", kind: "guarantee", label: "A chaff killer in primary or secondary" },
    { id: "demo", kind: "guarantee", label: "At least one base breaker", preset: { tag: "demo", min: 1 } },
    { id: "panic", kind: "guarantee", label: "A panic weapon in primary, secondary or throwable", preset: { tag: "panic", min: 1 } },
    { id: "balance", kind: "guarantee", label: "Chaff / medium / anti-tank counts within 3 of each other" },
    { id: "demoEscalation", kind: "guarantee", label: "Two base breakers when no weapon is one" },
    { id: "shield", kind: "guarantee", label: "A shield backpack needs a one-handed weapon" },
    { id: "supply", kind: "guarantee", label: "No supply pack alongside 2+ no-ammo items" },
    { id: "capSupport", kind: "limit", label: "One regular support weapon, or up to two expendable ones (never mixed)" },
    { id: "capVehicle", kind: "limit", label: "At most 1 vehicle", preset: { tag: "vehicle", max: 1 } },
    { id: "capEagle", kind: "limit", label: "At most 2 Eagles", preset: { tag: "eagle", max: 2 } },
    { id: "capMine", kind: "limit", label: "At most 1 mine", preset: { tag: "mines", max: 1 } },
  ];

  // -- Rule priority --------------------------------------------------------
  // When a build can't meet every rule, imperfect builds are ranked by which rules they miss. 0 = most
  // important. A build that misses only lower tiers always beats one that misses a higher tier, however
  // many low-tier rules it misses.
  var RULE_TIER = {
    // (tier table updated to the live three tiers on 2026-10-31 so the parity test compares rule logic, not ranking;
    // the balance rule is switched off by the test because the live engine no longer has it)
    require: 0,
    backpack: 1, support: 1, armor: 1, chaff: 1, demo: 1,
    med: 2, panic: 2, demoEscalation: 2, shield: 2, supply: 2, balance: 2,
  };
  var TIER_COUNT = 3;
  function tierOf(id) { return Object.prototype.hasOwnProperty.call(RULE_TIER, id) ? RULE_TIER[id] : 1; }

  // Lower is better. Misses are compared tier by tier from the top; "shortfall" (how far short the numeric
  // rules fell) only breaks ties. Fewer than 100 misses per tier is guaranteed, so base 100 is safe.
  function scoreUnmet(unmet, shortfall) {
    var total = 0;
    unmet.forEach(function (u) { total += Math.pow(100, TIER_COUNT - 1 - tierOf(u.id)); });
    return total * 1000 + Math.min(shortfall || 0, 999);
  }

  // -- Item helpers -------------------------------------------------------
  function has(item, tag) {
    return item.tags.indexOf(tag) !== -1;
  }

  // Mirrors Item.works_for(): "none" disables an item everywhere; only a factions list that is
  // exactly ["any"] is universal ("any" mixed into a longer list does NOT make an item universal).
  function worksFor(item, faction) {
    if (item.factions.indexOf("none") !== -1) return false;
    return (
      faction === "any" ||
      (item.factions.length === 1 && item.factions[0] === "any") ||
      item.factions.indexOf(faction) !== -1
    );
  }

  // A requirement is { min, max } (either may be missing). A bare number is the old "at least N" form.
  function normalizeRequirements(req) {
    var out = {};
    Object.keys(req || {}).forEach(function (tag) {
      var v = req[tag];
      if (typeof v === "number") { out[tag] = { min: v }; return; }
      if (!v || typeof v !== "object") return;
      var r = {};
      if (typeof v.min === "number") r.min = v.min;
      if (typeof v.max === "number") r.max = v.max;
      if (r.min !== undefined || r.max !== undefined) out[tag] = r;
    });
    return out;
  }
  var NO_RULES_OFF = new Set();

  function create(data, options) {
    options = options || {};
    var rng = options.rng || Math.random; // injectable so tests can use a seeded generator
    // The original engine had a quirk in the stratagem fill loop: it updated its running counters
    // (support slot used, backpack taken, ...) BEFORE the later checks that could still reject the
    // pick, so a rejected stratagem could block later, perfectly legal ones. That is fixed here: a
    // pick only changes the counters if it is actually accepted. Pass { legacyCounterLeak: true } to
    // get the old behaviour back (only tests/ does, to compare against the original engine).
    var legacyCounterLeak = !!options.legacyCounterLeak;

    var items = data.items;
    var primaries = items.filter(function (i) { return i.cat === "primary"; });
    var secondaries = items.filter(function (i) { return i.cat === "secondary"; });
    var throwables = items.filter(function (i) { return i.cat === "throwable"; });
    var strategems = items.filter(function (i) { return STRATAGEM_CATEGORIES.indexOf(i.cat) !== -1; });
    var allWarbondKeys = data.warbonds.map(function (w) { return w.key; });

    // name / nickname lookup (case-insensitive)
    var byName = {};
    var byNickname = {};
    items.forEach(function (i) {
      byName[i.name.toLowerCase()] = i;
      i.nicknames.forEach(function (n) { byNickname[n.toLowerCase()] = i; });
    });
    function resolve(text) {
      var key = String(text || "").trim().toLowerCase();
      return byName[key] || byNickname[key] || null;
    }

    // -- Random helpers ---------------------------------------------------
    function randomChoice(list) {
      return list[Math.floor(rng() * list.length)];
    }

    // reducedTags = {melee: 0.333} -> melee items are a third as likely to be picked
    function weightedChoice(list, reducedTags) {
      var weights = list.map(function (item) {
        var w = 1;
        Object.keys(reducedTags).forEach(function (tag) {
          if (has(item, tag)) w *= reducedTags[tag];
        });
        return w;
      });
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var r = rng() * total;
      for (var k = 0; k < list.length; k++) {
        r -= weights[k];
        if (r < 0) return list[k];
      }
      return list[list.length - 1];
    }

    function shuffle(list) {
      var a = list.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      }
      return a;
    }

    // -- One build attempt ----------------------------
    function tryBuild(faction, ownedSet, locks, requirementsIn, excluded, disabledIn) {
      var requirements = normalizeRequirements(requirementsIn); // tag -> { min?, max? }
      var disabled = disabledIn instanceof Set ? disabledIn : new Set(disabledIn || NO_RULES_OFF);
      function ruleOn(id) { return !disabled.has(id); }
      function reqMin(t) { return Object.prototype.hasOwnProperty.call(requirements, t) ? requirements[t].min : undefined; }
      function reqMax(t) { return Object.prototype.hasOwnProperty.call(requirements, t) ? requirements[t].max : undefined; }
      function inPool(x) {
        return worksFor(x, faction) && ownedSet.has(x.warbond) && !excluded.has(x.name);
      }
      function pool(list) { return list.filter(inPool); }

      // Weapons
      var primary = locks.primary || null;
      if (!primary) { var pp = pool(primaries); primary = pp.length ? randomChoice(pp) : null; }
      var secondary = locks.secondary || null;
      if (!secondary) { var sp = pool(secondaries); secondary = sp.length ? weightedChoice(sp, { melee: 0.333 }) : null; }
      var throwable = locks.throwable || null;
      if (!throwable) { var tp = pool(throwables); throwable = tp.length ? randomChoice(tp) : null; }
      if (!primary || !secondary || !throwable) return null;

      // Stratagems
      var lockedStrats = [1, 2, 3, 4].map(function (n) { return locks["strat" + n] || null; });

      // Running state, seeded from locked stratagems. Locked stratagems themselves are never
      // rejected for breaking a cap - locks are the player's deliberate override.
      var st = {
        supportRegular: lockedStrats.some(function (s) { return s && s.cat === "support" && !has(s, "expendable"); }),
        supportExpend: lockedStrats.filter(function (s) { return s && s.cat === "support" && has(s, "expendable"); }).length,
        backpack: lockedStrats.some(function (s) { return s && has(s, "backpack"); }),
        vehicle: lockedStrats.some(function (s) { return s && s.cat === "vehicle"; }),
        eagle: lockedStrats.filter(function (s) { return s && has(s, "eagle"); }).length,
        mine: lockedStrats.filter(function (s) { return s && has(s, "mines"); }).length,
        frv: lockedStrats.filter(function (s) { return s && has(s, "frv"); }).length,
        tank: lockedStrats.filter(function (s) { return s && has(s, "tank"); }).length,
        mech: lockedStrats.filter(function (s) { return s && has(s, "mech"); }).length,
      };

      // A cap ("max 2 Eagles") is relaxed for a stratagem when the player has asked for MORE of that very
      // tag than the build has so far ("Require Eagle >= 3"). soFar = everything already in the build.
      var CAP_TAGS = {
        eagle: ["eagle"], mine: ["mines"], backpack: ["backpack"], expend: ["expendable"],
        vehicle: ["vehicle", "frv", "tank", "mech"],
      };
      function neededFor(cap, s, soFar) {
        if (legacyCounterLeak) return false; // the original engine had no such override
        return CAP_TAGS[cap].some(function (t) {
          var want = reqMin(t);
          return has(s, t) && want !== undefined &&
            soFar.filter(function (i) { return has(i, t); }).length < want;
        });
      }
      // The game itself only lets you bring one FRV, one tank and one exosuit: never overridden.
      var IN_GAME_LIMITS = ["frv", "tank", "mech"];

      // Returns false if the stratagem breaks a cap. It updates `state` as it goes, so the caller
      // passes a scratch copy and only keeps it when the pick is accepted (see legacyCounterLeak).
      var maxTags = legacyCounterLeak ? [] : Object.keys(requirements).filter(function (t) { return requirements[t].max !== undefined; });
      function admit(s, state, soFar) {
        if (!legacyCounterLeak) {
          for (var h = 0; h < IN_GAME_LIMITS.length; h++) {
            if (has(s, IN_GAME_LIMITS[h]) && state[IN_GAME_LIMITS[h]] >= 1) return false;
          }
        }
        // "At most N" / "exactly N" requirements: never pick a stratagem that would go over.
        for (var mx = 0; mx < maxTags.length; mx++) {
          var mt = maxTags[mx];
          if (has(s, mt) && soFar.filter(function (i) { return has(i, mt); }).length >= requirements[mt].max) return false;
        }
        if (s.cat === "support" && !has(s, "expendable")) {
          if (ruleOn("capSupport") && (state.supportRegular || state.supportExpend > 0)) return false;
          state.supportRegular = true;
        } else if (s.cat === "support" && has(s, "expendable")) {
          var moreExpend = neededFor("expend", s, soFar);
          if (ruleOn("capSupport")) {
            if (state.supportRegular && !moreExpend) return false;
            if (state.supportExpend >= 2 && !moreExpend) return false;
          }
          state.supportExpend += 1;
        }
        if (has(s, "backpack")) {
          if (ruleOn("backpack") && state.backpack && !neededFor("backpack", s, soFar)) return false;
          state.backpack = true;
        }
        if (s.cat === "vehicle") {
          if (ruleOn("capVehicle") && state.vehicle && !neededFor("vehicle", s, soFar)) return false;
          state.vehicle = true;
        }
        if (has(s, "eagle")) {
          if (ruleOn("capEagle") && state.eagle >= 2 && !neededFor("eagle", s, soFar)) return false;
          state.eagle += 1;
        }
        if (has(s, "mines")) {
          if (ruleOn("capMine") && state.mine >= 1 && !neededFor("mine", s, soFar)) return false;
          state.mine += 1;
        }
        if (!legacyCounterLeak) {
          IN_GAME_LIMITS.forEach(function (t) { if (has(s, t)) state[t] += 1; });
        }
        return true;
      }

      var lockedNames = {};
      lockedStrats.forEach(function (s) { if (s) lockedNames[s.name] = true; });
      var freeSlots = [];
      lockedStrats.forEach(function (s, i) { if (!s) freeSlots.push(i); });
      var stratPool = shuffle(pool(strategems).filter(function (s) { return !lockedNames[s.name]; }));
      var chosen = lockedStrats.slice();

      // A request for MORE of a capped tag than the cap normally allows (Eagle >= 3, mines >= 2, ...) would almost
      // never come out of a purely random fill, so those tags are filled first, picking randomly among the matching
      // stratagems; the remaining slots are then filled as usual. Other requirements are left to the random fill
      // (the build is re-rolled until it fits), exactly as before.
      var DEFAULT_CAPS = { eagle: 2, mines: 1, vehicle: 1, backpack: 1, expendable: 2 };
      if (!legacyCounterLeak) {
        Object.keys(DEFAULT_CAPS).forEach(function (tag) {
          var wantMin = reqMin(tag);
          if (wantMin === undefined || wantMin <= DEFAULT_CAPS[tag]) return;
          for (var m = 0; m < stratPool.length && freeSlots.length; m++) {
            var cand = stratPool[m];
            if (!has(cand, tag) || chosen.indexOf(cand) !== -1) continue;
            var soFarNow = [primary, secondary, throwable].concat(chosen.filter(Boolean));
            if (soFarNow.filter(function (i) { return has(i, tag); }).length >= wantMin) break;
            var attemptState = Object.assign({}, st);
            if (!admit(cand, attemptState, soFarNow)) continue;
            st = attemptState;
            chosen[freeSlots.shift()] = cand;
          }
        });
      }

      for (var k = 0; k < stratPool.length; k++) {
        if (!freeSlots.length) break;
        var s = stratPool[k];
        if (chosen.indexOf(s) !== -1) continue; // already placed by the requirement pass above
        var soFar = [primary, secondary, throwable].concat(chosen.filter(Boolean));
        if (legacyCounterLeak) {
          if (!admit(s, st, soFar)) continue;     // may have changed st even though it rejected s
        } else {
          var trial = Object.assign({}, st);
          if (!admit(s, trial, soFar)) continue;  // rejected: st is untouched
          st = trial;
        }
        chosen[freeSlots.shift()] = s;
      }
      if (chosen.some(function (s) { return !s; })) return null; // couldn't fill every slot at all

      // ---- Rule checks --------------------------------------------------------------------
      // Every rule is evaluated and every failure is collected (instead of stopping at the first),
      // so a build that can't meet all the rules can still be completed and report exactly which
      // ones it missed. A build with no failures is a "strict" build - the only kind the original
      // hard-coded engine would ever return.
      var unmet = [];
      var shortfall = 0; // tie-breaker between imperfect builds: how far short the numeric rules fell
      function fail(id, label, extra) {
        if (id !== "require" && !ruleOn(id)) return; // switched off in the Rules menu
        var entry = { id: id, label: label, tier: tierOf(id) };
        if (extra) Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
        unmet.push(entry);
      }

      var weapons = [primary, secondary, throwable];
      var allItems = weapons.concat(chosen);
      function anyHas(list, tag) { return list.some(function (i) { return has(i, tag); }); }
      function countHas(list, tag) { return list.filter(function (i) { return has(i, tag); }).length; }

      var allLocked = lockedStrats.every(function (s) { return !!s; });

      // Exactly one backpack-slot item - unless the player locked a backpack-type stratagem, or
      // locked all four stratagem slots (then the loadout is entirely their choice).
      var actualBackpacks = chosen.filter(function (s) { return has(s, "backpack"); }).length;
      var lockedBackpacks = lockedStrats.filter(function (s) { return s && has(s, "backpack"); }).length;
      var wantsNoBackpack = reqMax("backpack") === 0; // "backpack: at most / exactly 0" replaces this rule
      if (lockedBackpacks === 0 && !allLocked && !wantsNoBackpack && actualBackpacks !== 1) {
        fail("backpack", "Exactly one backpack-slot item");
      }

      // At least one support weapon - unless all 4 stratagem slots were locked.
      var supportCount = chosen.filter(function (s) { return s.cat === "support"; }).length;
      if (!allLocked && supportCount < 1) fail("support", "At least one support weapon");

      var coversArmor = anyHas(allItems, "armor");
      var coversMed = anyHas(allItems, "med");
      var coversChaff = anyHas([primary, secondary], "chaff");
      var coversDemo = anyHas(allItems, "demo");
      var coversPanic = anyHas(weapons, "panic");

      // Standard coverage checks - skipped for a tag the player has set their own count for: any "at least" /
      // "exactly" replaces the single-item check, and "at most 0" means they want none at all. A plain
      // "at most 1+" leaves the default check in place.
      var hasReq = function (t) { return reqMin(t) !== undefined || reqMax(t) === 0; };
      if (!hasReq("armor") && !coversArmor) fail("armor", "At least one anti-tank item");
      if (!hasReq("med") && !coversMed) fail("med", "At least one medium-enemy killer");
      if (!hasReq("chaff") && !coversChaff) fail("chaff", "A chaff killer in primary or secondary");
      if (!hasReq("demo") && !coversDemo) fail("demo", "At least one base breaker");
      if (!hasReq("panic") && !coversPanic) fail("panic", "A panic weapon in primary, secondary or throwable");

      // The player's own counts: at least / at most / exactly.
      Object.keys(requirements).forEach(function (tag) {
        var r = requirements[tag], actual = countHas(allItems, tag);
        var short = (r.min !== undefined && actual < r.min) ? r.min - actual : 0;
        var over = (r.max !== undefined && actual > r.max) ? actual - r.max : 0;
        if (short || over) {
          shortfall += short + over;
          var how = r.min !== undefined && r.min === r.max ? "exactly " + r.min
            : short ? "at least " + r.min : "at most " + r.max;
          fail("require", "Require " + how + " " + tag, { tag: tag, min: r.min, max: r.max, actual: actual, how: how });
        }
      });

      // Tag balance: chaff / med / armor counts may differ by at most 3.
      var chaffN = countHas(allItems, "chaff");
      var medN = countHas(allItems, "med");
      var armorN = countHas(allItems, "armor");
      var spread = Math.max(chaffN, medN, armorN) - Math.min(chaffN, medN, armorN);
      if (ruleOn("balance") && (Math.abs(chaffN - medN) > 3 || Math.abs(chaffN - armorN) > 3 || Math.abs(medN - armorN) > 3)) {
        shortfall += spread - 3;
        fail("balance", "Chaff / medium / anti-tank counts within 3 of each other");
      }

      // Demo escalation: if only stratagems provide demo, require at least 2 of them.
      var demoItems = allItems.filter(function (i) { return has(i, "demo"); });
      var demoFromWeapons = weapons.filter(function (i) { return has(i, "demo"); });
      if (!demoFromWeapons.length && demoItems.length < 2) {   // 2026-11-01: no longer needs one to start with
        fail("demoEscalation", "Two base breakers when no weapon is one");
      }

      // A hand-held shield backpack (tag "handheld": the ballistic and directional shields, not the bubble generators)
      // needs a one-handed primary or secondary.
      if (chosen.some(function (s) { return has(s, "handheld"); })) {
        // 2026-10-30: pistols are tagged one-handed now but do not count; a one-handed primary or a melee weapon does.
        // 2026-11-01: a one-handed melee support weapon counts too.
        if (!(has(primary, "onehand") || has(primary, "melee") || has(secondary, "melee") || chosen.some(function (s) { return has(s, "melee") && has(s, "onehand"); }))) {
          fail("shield", "Shield backpack needs a one-handed weapon");
        }
      }

      // Supply stratagems are blocked at 2+ "no-ammo" factors (charge weapons + expendable supports).
      var chargeCount = countHas([primary, secondary].concat(chosen), "charge");
      if (chargeCount + st.supportExpend >= 2) {
        if (chosen.some(function (s) { return has(s, "supply"); })) {
          fail("supply", "No supply pack alongside 2+ no-ammo items");
        }
      }

      return {
        primary: primary, secondary: secondary, throwable: throwable, strategems: chosen,
        coversArmor: coversArmor, coversMed: coversMed, coversChaff: coversChaff,
        coversDemo: coversDemo, coversPanic: coversPanic,
        unmet: unmet,                                  // [] for a build that follows every rule
        score: scoreUnmet(unmet, shortfall),           // lower is better; only used to rank imperfect builds
      };
    }

    // -- Public generators ------------------------------------------------
    function normalize(opts) {
      opts = opts || {};
      return {
        faction: opts.faction || "any",
        owned: new Set(opts.ownedWarbonds || allWarbondKeys),
        locks: opts.locks || {},
        requirements: normalizeRequirements(opts.requirements),
        disabled: new Set(opts.disabledRules || []),
        excluded: opts.excluded instanceof Set ? opts.excluded : new Set(opts.excluded || []),
        maxAttempts: opts.maxAttempts || 1000,
      };
    }

    // Runs up to maxAttempts builds for one faction pool. Returns the first build that follows every
    // rule (unmet is empty), otherwise the least-bad build it saw (fewest unmet rules), or null if
    // not a single build could even be completed (e.g. nothing eligible for a slot).
    function attempt(faction, o) {
      var best = null;
      for (var n = 0; n < o.maxAttempts; n++) {
        var c = tryBuild(faction, o.owned, o.locks, o.requirements, o.excluded, o.disabled);
        if (!c) continue;
        if (!c.unmet.length) return c;
        if (!best || c.score < best.score) best = c;
      }
      return best;
    }

    function noBuildError(o) {
      return new GenerationError(
        "Couldn't fill every slot: there aren't enough eligible items. Check what you own and have set to " +
        "never roll in My Gear, and your locks."
      );
    }

    // Strict version: returns only a build that follows every rule, otherwise throws.
    function generateLoadout(opts) {
      var o = normalize(opts);
      var r = attempt(o.faction, o);
      if (r && !r.unmet.length) return r;
      throw new GenerationError(
        "Could not build a valid loadout for faction '" + o.faction + "' with the given constraints after " +
        o.maxAttempts + " attempts."
      );
    }

    // The one the website uses. In order of preference:
    //   1. a build that follows every rule for the requested faction;
    //   2. one that follows every rule if the faction is relaxed to "any" (off-faction picks flagged);
    //   3. otherwise the build that misses the fewest rules (unmet rules flagged), completed anyway.
    // It only throws if no build could be completed at all.
    function generateLoadoutRelaxed(opts) {
      var o = normalize(opts);
      var r1 = attempt(o.faction, o);
      var r2 = null;
      var pick = r1;
      if (!(r1 && !r1.unmet.length) && o.faction !== "any") {
        r2 = attempt("any", o);
        if (r2 && !r2.unmet.length) pick = r2;
        else if (!r1 || (r2 && r2.score < r1.score)) pick = r2; // only switch pools if it misses fewer rules
      }
      if (!pick) throw noBuildError(o);

      pick.factionOverridden = pick === r2;
      if (pick.factionOverridden) {
        var all = [pick.primary, pick.secondary, pick.throwable].concat(pick.strategems);
        pick.suboptimalNames = new Set(
          all.filter(function (i) { return !worksFor(i, o.faction); }).map(function (i) { return i.name; })
        );
      } else {
        pick.suboptimalNames = new Set();
      }
      return pick;
    }

    return {
      pools: { primaries: primaries, secondaries: secondaries, throwables: throwables, strategems: strategems },
      allWarbondKeys: allWarbondKeys,
      resolve: resolve,
      tryBuild: tryBuild,
      generateLoadout: generateLoadout,
      generateLoadoutRelaxed: generateLoadoutRelaxed,
    };
  }

  return {
    create: create,
    GenerationError: GenerationError,
    has: has,
    worksFor: worksFor,
    RULE_TIER: RULE_TIER,
    RULES: RULES,
    normalizeRequirements: normalizeRequirements,
    scoreUnmet: scoreUnmet,
    WEAPON_CATEGORIES: WEAPON_CATEGORIES,
    STRATAGEM_CATEGORIES: STRATAGEM_CATEGORIES,
  };
});
