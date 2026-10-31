/*
 * Helldivers 2 Slopinator - generation engine
 *
 * Pure logic: no DOM, no file access, so it runs the same in a browser and in Node
 * (which is how tests/ checks it against a frozen copy of the earlier hard-coded rules).
 *
 * Guarantees per loadout (the original hard-coded rules):
 *   - at least one of: anti-tank, medium killer, chaff killer (primary/secondary only),
 *     panic weapon (primary/secondary/throwable only), base breaker (2 if no weapon has it)
 *   - chaff / med / armor counts may differ by at most 3
 *   - support: max 1 non-expendable, max 2 expendable, never mixed, at least 1 total
 *   - exactly 1 backpack-slot item; hand-held shields need a one-handed primary or a melee weapon
 *   - max 1 vehicle, max 2 eagle, max 1 mine stratagem - but a "Require N+ <tag>" request for that same tag
 *     (eagle, mines, vehicle/frv/tank/mech, backpack, expendable) overrides the cap, so "Eagle >= 3" can be met
 *   - IN-GAME LIMITS that nothing overrides: at most one FRV, one tank and one exosuit (mech)
 *   - supply stratagems are blocked once 2+ "no-ammo" items (the noammo tag) are present
 *   - the player's own tag counts (requirements) say how many items with a tag the build must have:
 *     at least N, at most N, or exactly N (a count of 0 is allowed for "at most" / "exactly")
 *   - every default rule below can be removed with the `disabledRules` option (see RULES); the in-game
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

  // -- The default rules (what the website's Rules list shows) ---------------------
  // kind "guarantee" = checked on the finished build; "limit" = enforced while the stratagems are being picked.
  // `disabledRules: ["armor", "capEagle", ...]` removes any of them. The in-game limits are not listed
  // here on purpose: nothing can turn those off.
  // The website shows every default rule as a row next to the player's own rules; the x on a row adds its id to disabledRules.
  //  - `preset: { tag, min?, max? }` is a plain count of one tag over the whole build ("Anti-Tank >= 1", "Vehicle <= 1").
  //    The player edits such a row by handing the engine a requirement for that tag with the rule's id in disabledRules,
  //    which behaves exactly like the preset did (tests/engine_rules.js checks that). The numbers in `preset` are the
  //    system defaults and must match what the engine enforces below.
  //  - `rules: [...]` are generic rules (see "Generic rules" below): a count of the items a selector picks, in one
  //    scope, optionally only `when` other counts hold. `fill: true` means the rule is
  //    enforced while the stratagems are picked and never flagged afterwards (a limit that locks may break silently);
  //    `waive: "allStratLocked"` skips the check when all four stratagem slots are locked.
  var RULES = [
    { id: "backpack", kind: "guarantee", label: "Exactly one backpack-slot item", note: "Also stops a second backpack being picked.", preset: { tag: "backpack", min: 1, max: 1 } },
    { id: "support", kind: "guarantee", label: "At least one support weapon", waive: "allStratLocked",
      rules: [{ must: { sel: "cat:support", scope: "strats", min: 1 } }] },
    { id: "armor", kind: "guarantee", label: "At least one anti-tank item", preset: { tag: "armor", min: 1 } },
    { id: "med", kind: "guarantee", label: "At least one medium-enemy killer", preset: { tag: "med", min: 1 } },
    { id: "chaff", kind: "guarantee", label: "A chaff killer in primary or secondary",
      rules: [{ must: { sel: "tag:chaff", scope: "ps", min: 1 } }] },
    { id: "demo", kind: "guarantee", label: "At least one base breaker", preset: { tag: "demo", min: 1 } },
    { id: "panic", kind: "guarantee", label: "A panic weapon in primary, secondary or throwable", preset: { tag: "panic", min: 1 } },
    { id: "demoEscalation", kind: "guarantee", label: "Two base breakers when no weapon is one",
      rules: [{ when: [{ sel: "tag:demo", scope: "weapons", max: 0 }, { sel: "tag:demo", scope: "all", min: 1 }], must: { sel: "tag:demo", scope: "all", min: 2 } }] },
    // Pistols are one-handed too, but they do not count here: the shield needs a one-handed PRIMARY or a (one-handed) melee weapon.
    // Written as "if there is no one-handed primary, then a melee weapon in primary / secondary".
    { id: "shield", kind: "guarantee", label: "A hand-held shield needs a one-handed primary or a melee weapon",
      rules: [{ when: [{ sel: "tag:handheld", scope: "strats", min: 1 }, { sel: "tag:onehand", scope: "primary", max: 0 }], must: { sel: "tag:melee", scope: "ps", min: 1 } }] },
    { id: "supply", kind: "guarantee", label: "No supply pack alongside 2+ no-ammo items",
      rules: [{ when: [{ sel: "tag:noammo", scope: "all", min: 2 }], must: { sel: "tag:supply", scope: "strats", max: 0 } }] },
    { id: "capRegular", kind: "limit", label: "At most 1 regular (non-expendable) support weapon", fill: true,
      rules: [{ must: { sel: "tag:nonexp", scope: "strats", max: 1 } }] },
    { id: "capExpend", kind: "limit", label: "At most 2 expendable support weapons", preset: { tag: "expendable", max: 2 } },
    { id: "capMixed", kind: "limit", label: "Never a regular and an expendable support weapon together", fill: true,
      rules: [{ when: [{ sel: "tag:nonexp", scope: "strats", min: 1 }], must: { sel: "tag:expendable", scope: "strats", max: 0 } }] },
    { id: "capVehicle", kind: "limit", label: "At most 1 vehicle", preset: { tag: "vehicle", max: 1 } },
    { id: "capEagle", kind: "limit", label: "At most 2 Eagles", preset: { tag: "eagle", max: 2 } },
    // An odds rule, not a pass / fail rule: items the selector picks are rolled `factor` times as often as usual (1 = normal), when
    // the slot being rolled is in `scope`. The player's own odds rules are passed as `weights`; one with the same selector and scope
    // replaces this one (that is how the page lets it be edited).
    { id: "meleeWeight", kind: "weight", label: "Melee secondaries are rolled at a third of the usual odds",
      weight: { sel: "tag:melee", scope: "secondary", factor: 0.333 } },
    { id: "capMine", kind: "limit", label: "At most 1 mine", preset: { tag: "mines", max: 1 } },
  ];

  // -- Rule priority --------------------------------------------------------
  // When a build can't meet every rule, imperfect builds are ranked by which rules they miss. 0 = most
  // important. A build that misses only lower tiers always beats one that misses a higher tier, however
  // many low-tier rules it misses (a deliberate ranking). Three tiers:
  //   Overwrite - the player's own rules; they trump a "good build"
  //   Core      - the rules that make a build good
  //   Preferred - nice to have
  // Above all of these sit the in-game limits (one FRV, one tank, one exosuit), which nothing can break or turn off.
  var RULE_TIER = {
    require: 0,                                   // Overwrite: the player's own "Require N+ of a tag" requirements
    custom: 0,                                    // Overwrite: the player's own scoped / if-then rules (same level)
    backpack: 1, support: 1, armor: 1, chaff: 1, demo: 1,   // Core
    capMixed: 1,
    med: 2, panic: 2, demoEscalation: 2, shield: 2, supply: 2,   // Preferred
    capRegular: 2, capExpend: 2, capVehicle: 2, capEagle: 2, capMine: 2,
  };
  var TIER_COUNT = 3;
  var TIER_NAMES = ["Overwrite", "Core", "Preferred"];
  // "capSupport" was one switch for the three support limits; a saved or hand-written disabledRules list may still use it.
  var RULE_ALIASES = { capRegular: ["capSupport"], capExpend: ["capSupport"], capMixed: ["capSupport"] };
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

  // An empty slot. A player with fewer than four stratagems can still bring a loadout in the game, and a player with nothing
  // owned for a weapon slot has nothing to put there, so the slots that cannot be filled hold this placeholder: no tags (it counts
  // toward nothing), works for every faction, and a fresh object per slot so two empty slots are never mistaken for the same
  // item twice. `cat` is the slot's own category ("primary", "secondary", "throwable") or "empty" for a stratagem slot.
  function makeEmptySlot(cat) {
    return { id: "empty", cat: cat || "empty", name: "Empty Slot", nicknames: [], tags: [], factions: ["any"], warbond: "base",
      released: "", imgUrl: "https://helldivers.wiki.gg/images/Super_Earth_Icon.svg", armorPen: [], menuOrder: null, alwaysOwned: true, empty: true };
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
  // -- Generic rules ------------------------------------------------------------------
  // A rule counts the items a SELECTOR picks inside a SCOPE and says how many there may be:
  //   condition  { sel, scope?, min?, max? }       e.g. { sel: "tag:armor", scope: "all", min: 1 }
  //   rule       { must: condition }                       -> must hold
  //              { when: [condition, ...], must: condition } -> must hold whenever every `when` condition holds
  // Selectors: "tag:<tag>" or "cat:<category>". Scopes: SCOPES.
  // Rules are plain data so the page can save them and show them as sentences.
  // Selectors that were renamed: a saved or hand-written rule may still use the old name. There used to be two named groups;
  // they are ordinary tags now (noAmmo -> noammo, regularSupport -> nonexp).
  var SELECTOR_ALIASES = { "grp:noAmmo": "tag:noammo", "grp:regularSupport": "tag:nonexp" };
  var SCOPES = ["all", "weapons", "ps", "strats", "primary", "secondary", "throwable"];
  var selectorCache = {};
  function makeSelector(id) {
    if (Object.prototype.hasOwnProperty.call(selectorCache, id)) return selectorCache[id];
    var m = /^(tag|cat):(.+)$/.exec(String(id));
    var fn = null;
    if (m && m[1] === "tag") fn = function (i) { return has(i, m[2]); };
    else if (m && m[1] === "cat") fn = function (i) { return i.cat === m[2]; };
    selectorCache[id] = fn;
    return fn;
  }
  // ctx = { primary, secondary, throwable, strats: [stratagems chosen so far] }
  function scopeItems(scope, ctx) {
    switch (scope || "all") {
      case "primary": return [ctx.primary];
      case "secondary": return [ctx.secondary];
      case "throwable": return [ctx.throwable];
      case "ps": return [ctx.primary, ctx.secondary];
      case "weapons": return [ctx.primary, ctx.secondary, ctx.throwable];
      case "strats": return ctx.strats;
      default: return [ctx.primary, ctx.secondary, ctx.throwable].concat(ctx.strats);
    }
  }
  function condCount(cond, ctx) {
    var pick = makeSelector(cond.sel);
    return scopeItems(cond.scope, ctx).filter(function (i) { return i && pick(i); }).length;
  }
  function condGap(cond, n) {
    if (cond.min !== undefined && n < cond.min) return cond.min - n;
    if (cond.max !== undefined && n > cond.max) return n - cond.max;
    return 0;
  }
  // null when the rule holds, otherwise { actual, gap } (actual = the count that broke it).
  function evalRule(rule, ctx) {
    var when = rule.when || [];
    for (var w = 0; w < when.length; w++) {
      if (condGap(when[w], condCount(when[w], ctx))) return null;   // the "if" part doesn't hold: nothing to check
    }
    var n = condCount(rule.must, ctx);
    var gap = condGap(rule.must, n);
    return gap ? { actual: n, gap: gap } : null;
  }
  // A limit that can be enforced while stratagems are picked: only an upper bound, no lower bound.
  function isUpperOnly(rule) {
    return !!rule.must && rule.must.max !== undefined && rule.must.min === undefined;
  }
  // Does a stratagem count towards this rule at all? (Used so a rule the locks already break doesn't block unrelated picks.)
  function touchesStrat(rule, s) {
    var conds = (rule.when || []).concat(rule.must ? [rule.must] : []);
    return conds.some(function (c) {
      return (c.scope === undefined || c.scope === "all" || c.scope === "strats") && makeSelector(c.sel)(s);
    });
  }

  function cleanCond(c) {
    if (!c || typeof c !== "object" || typeof c.sel !== "string" || !makeSelector(SELECTOR_ALIASES[c.sel] || c.sel)) return null;
    var scope = c.scope === undefined ? "all" : c.scope;
    if (SCOPES.indexOf(scope) === -1) return null;
    if (c.sel.indexOf("cat:") === 0 && WEAPON_CATEGORIES.concat(STRATAGEM_CATEGORIES).indexOf(c.sel.slice(4)) === -1) return null;
    var out = { sel: SELECTOR_ALIASES[c.sel] || c.sel, scope: scope };
    var num = function (v) { return typeof v === "number" && v >= 0 && v <= 7 && Math.floor(v) === v; };
    if (c.min !== undefined) { if (!num(c.min)) return null; out.min = c.min; }
    if (c.max !== undefined) { if (!num(c.max)) return null; out.max = c.max; }
    if (out.min === undefined && out.max === undefined) return null;
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) return null;
    return out;
  }
  // Checks and copies a rule; returns null for anything malformed (saved settings are never trusted).
  function normalizeRule(r) {
    if (!r || typeof r !== "object") return null;
    // (a saved "balance" / spread rule from an older version has no `must`, so it is dropped here)
    var must = cleanCond(r.must);
    if (!must) return null;
    var out = { must: must };
    if (r.when !== undefined) {
      if (!Array.isArray(r.when) || r.when.length > 3) return null;
      var when = r.when.map(cleanCond);
      if (when.some(function (c) { return !c; })) return null;
      if (when.length) out.when = when;
    }
    return out;
  }
  // An odds rule: { sel, scope, factor }. Anything malformed gives null (saved settings are never trusted).
  var MIN_WEIGHT = 0.05, MAX_WEIGHT = 20;
  function normalizeWeight(w) {
    if (!w || typeof w !== "object" || typeof w.sel !== "string") return null;
    var sel = SELECTOR_ALIASES[w.sel] || w.sel;
    if (!makeSelector(sel)) return null;
    if (sel.indexOf("cat:") === 0 && WEAPON_CATEGORIES.concat(STRATAGEM_CATEGORIES).indexOf(sel.slice(4)) === -1) return null;
    var scope = w.scope === undefined ? "all" : w.scope;
    if (SCOPES.indexOf(scope) === -1) return null;
    if (typeof w.factor !== "number" || !isFinite(w.factor) || w.factor < MIN_WEIGHT || w.factor > MAX_WEIGHT) return null;
    return { sel: sel, scope: scope, factor: Math.round(w.factor * 1000) / 1000 };
  }
  // One odds rule per selector + scope (a later one replaces an earlier one).
  function normalizeWeights(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (w) {
      var n = normalizeWeight(w);
      if (!n) return;
      out = out.filter(function (x) { return x.sel !== n.sel || x.scope !== n.scope; });
      out.push(n);
    });
    return out;
  }
  function normalizeRules(list) {
    return (Array.isArray(list) ? list : []).map(normalizeRule).filter(function (r) { return r; });
  }

  var NO_RULES_OFF = new Set();

  function create(data, options) {
    options = options || {};
    var rng = options.rng || Math.random; // injectable so tests can use a seeded generator
    // In the stratagem fill loop a pick only changes the running counters (backpack taken, Eagles so far, ...) if it is
    // actually accepted, so a rejected stratagem can never block later, perfectly legal ones.

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

    // weightOf(item) -> how many times as likely as usual that item is to be picked (1 = normal)
    function weightedChoice(list, weightOf) {
      var weights = list.map(weightOf);
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var r = rng() * total;
      for (var k = 0; k < list.length; k++) {
        r -= weights[k];
        if (r < 0) return list[k];
      }
      return list[list.length - 1];
    }

    // Like shuffle, but items with a weight above / below 1 tend to come earlier / later (each gets the key rng^(1/weight), highest first).
    // With no odds rule in play (every weight 1) it is exactly shuffle, so builds without odds rules are unchanged.
    function weightedShuffle(list, weightOf) {
      var ws = list.map(weightOf);
      if (ws.every(function (w) { return w === 1; })) return shuffle(list);
      return list.map(function (item, i) { return { item: item, key: Math.pow(rng(), 1 / ws[i]) }; })
        .sort(function (a, b) { return b.key - a.key; }).map(function (x) { return x.item; });
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
    // `seed` (optional) = { primary, secondary, throwable, strats: [4] }: instead of rolling the unlocked slots, use these items and
    // only check them (the stratagems must still pass the fill-time caps, in slot order). Used by the repair step below.
    function tryBuild(faction, ownedSet, locks, requirementsIn, excluded, disabledIn, customIn, seed, weightsIn) {
      var requirements = normalizeRequirements(requirementsIn); // tag -> { min?, max? }
      var customRules = normalizeRules(customIn);                // the player's own generic rules (scoped counts, if/then)
      var disabled = disabledIn instanceof Set ? disabledIn : new Set(disabledIn || NO_RULES_OFF);
      function ruleOn(id) {
        if (disabled.has(id)) return false;
        var also = RULE_ALIASES[id];
        return !(also && also.some(function (a) { return disabled.has(a); }));
      }
      function reqMin(t) { return Object.prototype.hasOwnProperty.call(requirements, t) ? requirements[t].min : undefined; }
      function reqMax(t) { return Object.prototype.hasOwnProperty.call(requirements, t) ? requirements[t].max : undefined; }
      function inPool(x) {
        return worksFor(x, faction) && (ownedSet.has(x.warbond) || x.alwaysOwned) && !excluded.has(x.name);
      }
      function pool(list) { return list.filter(inPool); }

      // Odds rules in play: the default ones (unless removed or replaced by one of the player's own with the same selector and
      // scope) followed by the player's own. weightFor(slot) gives the function the random picks use for that slot.
      var userWeights = normalizeWeights(weightsIn);
      var oddsRules = [];
      RULES.forEach(function (r) {
        if (!r.weight || !ruleOn(r.id)) return;
        if (userWeights.some(function (u) { return u.sel === r.weight.sel && u.scope === r.weight.scope; })) return;
        oddsRules.push(r.weight);
      });
      oddsRules = oddsRules.concat(userWeights).map(function (w) { return { test: makeSelector(w.sel), scope: w.scope, factor: w.factor }; });
      function scopeCovers(scope, slot) {
        return scope === "all" || scope === slot || (scope === "weapons" && slot !== "strats") || (scope === "ps" && (slot === "primary" || slot === "secondary"));
      }
      function weightFor(slot) {
        var rules = oddsRules.filter(function (o) { return scopeCovers(o.scope, slot); });
        return function (item) {
          var w = 1;
          rules.forEach(function (o) { if (o.test(item)) w *= o.factor; });
          return w;
        };
      }
      // A random pick from `list` for a weapon slot (plain random when no odds rule touches anything in it).
      function pickFor(list, slot) {
        var wf = weightFor(slot);
        return list.every(function (i) { return wf(i) === 1; }) ? randomChoice(list) : weightedChoice(list, wf);
      }

      // Weapons
      var primary = seed ? seed.primary : (locks.primary || null);
      // A weapon slot with nothing owned for it (in any faction) is left empty. If something is owned but only for another faction,
      // the build is incomplete and the caller relaxes the faction instead.
      function ownedAny(list) {
        return list.some(function (x) { return (ownedSet.has(x.warbond) || x.alwaysOwned) && !excluded.has(x.name) && x.factions.indexOf("none") === -1; });
      }
      function weaponFor(list, slot) {
        var wp = pool(list);
        if (wp.length) return pickFor(wp, slot);
        return ownedAny(list) ? null : makeEmptySlot(slot);
      }
      if (!primary) primary = weaponFor(primaries, "primary");
      var secondary = seed ? seed.secondary : (locks.secondary || null);
      if (!secondary) secondary = weaponFor(secondaries, "secondary");
      var throwable = seed ? seed.throwable : (locks.throwable || null);
      if (!throwable) throwable = weaponFor(throwables, "throwable");
      if (!primary || !secondary || !throwable) return null;
      // Nothing owned at all is not a loadout; that is an error rather than a screen of empty slots.
      if (primary.empty && secondary.empty && throwable.empty) return null;

      // Stratagems
      var lockedStrats = [1, 2, 3, 4].map(function (n) { return locks["strat" + n] || null; });

      // Running state, seeded from locked stratagems. Locked stratagems themselves are never
      // rejected for breaking a cap - locks are the player's deliberate override.
      var st = {
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
        return CAP_TAGS[cap].some(function (t) {
          var want = reqMin(t);
          return has(s, t) && want !== undefined &&
            soFar.filter(function (i) { return has(i, t); }).length < want;
        });
      }
      // The game itself only lets you bring one FRV, one tank and one exosuit: never overridden.
      var IN_GAME_LIMITS = ["frv", "tank", "mech"];

      // Returns false if the stratagem breaks a cap. It updates `state` as it goes, so the caller
      // passes a scratch copy and only keeps it when the pick is accepted.
      var maxTags = Object.keys(requirements).filter(function (t) { return requirements[t].max !== undefined; });
      // Generic limits enforced while picking: the default support limits, plus any of the player's own rules that only
      // cap a count.
      var fillRules = [];
      RULES.forEach(function (r) { if (r.fill && r.rules && ruleOn(r.id)) fillRules = fillRules.concat(r.rules); });
      customRules.forEach(function (r) { if (isUpperOnly(r)) fillRules.push(r); });
      function admit(s, state, soFar) {
        for (var h = 0; h < IN_GAME_LIMITS.length; h++) {
          if (has(s, IN_GAME_LIMITS[h]) && state[IN_GAME_LIMITS[h]] >= 1) return false;
        }
        // "At most N" / "exactly N" requirements: never pick a stratagem that would go over.
        for (var mx = 0; mx < maxTags.length; mx++) {
          var mt = maxTags[mx];
          if (has(s, mt) && soFar.filter(function (i) { return has(i, mt); }).length >= requirements[mt].max) return false;
        }
        if (fillRules.length) {
          // would this pick break one of them? A rule the locks already break only stops picks that count towards it.
          var ctxAfter = { primary: primary, secondary: secondary, throwable: throwable, strats: soFar.slice(3).concat([s]) };
          for (var fr = 0; fr < fillRules.length; fr++) {
            if (touchesStrat(fillRules[fr], s) && evalRule(fillRules[fr], ctxAfter)) return false;
          }
        }
        if (s.cat === "support" && has(s, "expendable")) {
          if (ruleOn("capExpend") && state.supportExpend >= 2 && !neededFor("expend", s, soFar)) return false;
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
        IN_GAME_LIMITS.forEach(function (t) { if (has(s, t)) state[t] += 1; });
        return true;
      }

      var lockedNames = {};
      lockedStrats.forEach(function (s) { if (s) lockedNames[s.name] = true; });
      var freeSlots = [];
      lockedStrats.forEach(function (s, i) { if (!s) freeSlots.push(i); });
      var stratPool = seed ? [] : weightedShuffle(pool(strategems).filter(function (s) { return !lockedNames[s.name]; }), weightFor("strats"));
      var chosen = lockedStrats.slice();

      // A request for MORE of a capped tag than the cap normally allows (Eagle >= 3, mines >= 2, ...) would almost
      // never come out of a purely random fill, so those tags are filled first, picking randomly among the matching
      // stratagems; the remaining slots are then filled as usual. Other requirements are left to the random fill
      // (the build is re-rolled until it fits), exactly as before.
      var DEFAULT_CAPS = { eagle: 2, mines: 1, vehicle: 1, backpack: 1, expendable: 2 };
      if (seed) {
        // Repair check: every free slot gets the seeded item, which has to pass the same caps a rolled one would.
        for (var fi = 0; fi < freeSlots.length; fi++) {
          var si = freeSlots[fi], cs = seed.strats[si];
          if (!cs) return null;
          if (cs.empty) { chosen[si] = cs; continue; }
          var soFarSeed = [primary, secondary, throwable].concat(chosen.filter(Boolean));
          if (soFarSeed.indexOf(cs) !== -1) return null;   // the same stratagem twice
          var trialSeed = Object.assign({}, st);
          if (!admit(cs, trialSeed, soFarSeed)) return null;
          st = trialSeed;
          chosen[si] = cs;
        }
        freeSlots = [];
      }
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

      for (var k = 0; k < stratPool.length; k++) {
        if (!freeSlots.length) break;
        var s = stratPool[k];
        if (chosen.indexOf(s) !== -1) continue; // already placed by the requirement pass above
        var soFar = [primary, secondary, throwable].concat(chosen.filter(Boolean));
        var trial = Object.assign({}, st);
        if (!admit(s, trial, soFar)) continue;    // rejected: st is untouched
        st = trial;
        chosen[freeSlots.shift()] = s;
      }
      // Slots the rules left open. Rules are not allowed to leave a slot empty while an owned stratagem is available: the only things
      // that still hold are the in-game limits (one FRV, one tank, one exosuit; no stratagem twice). Everything else (the item caps,
      // the player's own "at most" rules) gives way, and the rule checks below flag whatever ended up broken. A slot that no owned
      // stratagem can fill is simply empty, which is allowed in the game.
      var forced = false;
      if (chosen.some(function (s) { return !s; })) {
        var owned = strategems.filter(function (x) {
          return (ownedSet.has(x.warbond) || x.alwaysOwned) && !excluded.has(x.name) && x.factions.indexOf("none") === -1;
        });
        var mayAdd = function (x) {
          for (var g = 0; g < IN_GAME_LIMITS.length; g++) if (has(x, IN_GAME_LIMITS[g]) && st[IN_GAME_LIMITS[g]] >= 1) return false;
          return true;
        };
        // An owned stratagem that is only missing because of the faction filter: the build is incomplete, the caller relaxes the faction.
        var offFaction = owned.some(function (x) { return chosen.indexOf(x) === -1 && !worksFor(x, faction) && mayAdd(x); });
        if (offFaction) return null;
        for (var q = 0; q < stratPool.length && freeSlots.length; q++) {
          var extra = stratPool[q];
          if (chosen.indexOf(extra) !== -1 || !mayAdd(extra)) continue;
          chosen[freeSlots.shift()] = extra;
          IN_GAME_LIMITS.forEach(function (t) { if (has(extra, t)) st[t] += 1; });
          forced = true;
        }
        chosen = chosen.map(function (c) { return c || makeEmptySlot(); });
      }

      // ---- Rule checks --------------------------------------------------------------------
      // Every rule is evaluated and every failure is collected (instead of stopping at the first),
      // so a build that can't meet all the rules can still be completed and report exactly which
      // ones it missed. A build with no failures is a "strict" build.
      var unmet = [];
      var shortfall = 0; // tie-breaker between imperfect builds: how far short the numeric rules fell
      function fail(id, label, extra) {
        if (id !== "require" && !ruleOn(id)) return; // removed from the Rules list
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

      // The default rules that are written as generic rules (support, chaff, base-breaker escalation, shield,
      // supply; see RULES). The support limits are `fill` rules: enforced while picking, never flagged here.
      var ctx = { primary: primary, secondary: secondary, throwable: throwable, strats: chosen };
      RULES.forEach(function (r) {
        if (!r.rules || r.fill || !ruleOn(r.id)) return;
        if (r.waive === "allStratLocked" && allLocked) return;   // the loadout is entirely the player's choice
        r.rules.forEach(function (rule) {
          var bad = evalRule(rule, ctx);
          if (!bad) return;
          fail(r.id, r.label);
        });
      });

      // A build that had to be completed past the item caps: the support limits (enforced while picking, so never flagged otherwise)
      // are checked here, so a broken one is reported.
      if (forced) {
        RULES.forEach(function (r) {
          if (!r.rules || !r.fill || !ruleOn(r.id)) return;
          r.rules.forEach(function (rule) { if (evalRule(rule, ctx)) fail(r.id, r.label); });
        });
      }

      // The player's own generic rules (scoped counts, if/then). Locks are never changed to satisfy them: a lock that
      // breaks one just gets it reported, like any other rule.
      customRules.forEach(function (rule) {
        var bad = evalRule(rule, ctx);
        if (!bad) return;
        shortfall += bad.gap;
        unmet.push({ id: "custom", label: "Custom rule", tier: tierOf("custom"), rule: rule, actual: bad.actual });
      });

      return {
        primary: primary, secondary: secondary, throwable: throwable, strategems: chosen,
        emptySlots: chosen.filter(function (c) { return c.empty; }).length,
        emptyWeapons: [primary, secondary, throwable].filter(function (c) { return c.empty; }).length,
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
        customRules: normalizeRules(opts.customRules),
        weights: normalizeWeights(opts.weights),
        disabled: new Set(opts.disabledRules || []),
        excluded: opts.excluded instanceof Set ? opts.excluded : new Set(opts.excluded || []),
        maxAttempts: opts.maxAttempts || 1000,
        repair: opts.repair !== false,
      };
    }

    // Runs up to maxAttempts builds for one faction pool. Returns the first build that follows every
    // rule (unmet is empty), otherwise the least-bad build it saw (fewest unmet rules), or null if
    // not a single build could even be completed (e.g. nothing eligible for a slot).
    function attempt(faction, o) {
      var best = null;
      for (var n = 0; n < o.maxAttempts; n++) {
        var c = tryBuild(faction, o.owned, o.locks, o.requirements, o.excluded, o.disabled, o.customRules, null, o.weights);
        if (!c) continue;
        if (!c.unmet.length) return c;
        if (!best || c.score < best.score) best = c;
      }
      return best && o.repair ? repair(best, faction, o) : best;
    }

    // Repair step. When no build followed every rule after all the attempts, the best one is fixed up one item at a time:
    // each slot the player has not locked is tried with every other eligible item, the single swap that improves the build the
    // most is kept, and this repeats until the build follows every rule or no swap helps. Many "impossible" requests (say
    // "Fire = 4") are only unlucky for random rolling, and a handful of single swaps solves them. A swapped-in stratagem has to
    // pass the same caps as a rolled one, and locked slots are never touched.
    var REPAIR_ROUNDS = 12;
    function repair(start, faction, o) {
      function eligible(list) {
        return list.filter(function (x) {
          return worksFor(x, faction) && (o.owned.has(x.warbond) || x.alwaysOwned) && !o.excluded.has(x.name);
        });
      }
      var pools = { primary: eligible(primaries), secondary: eligible(secondaries), throwable: eligible(throwables), strat: eligible(strategems) };
      var cur = start, changed = false;
      for (var round = 0; round < REPAIR_ROUNDS && cur.unmet.length; round++) {
        var bestC = null, ties = 0;
        var consider = function (seed) {
          var c = tryBuild(faction, o.owned, o.locks, o.requirements, o.excluded, o.disabled, o.customRules, seed, o.weights);
          if (!c || c.score >= cur.score) return;
          if (!bestC || c.score < bestC.score) { bestC = c; ties = 1; }
          else if (c.score === bestC.score) { ties++; if (rng() * ties < 1) bestC = c; }   // keep a random one of the equally good swaps
        };
        var seedOf = function (over) {
          return { primary: over.primary || cur.primary, secondary: over.secondary || cur.secondary,
                   throwable: over.throwable || cur.throwable, strats: over.strats || cur.strategems };
        };
        ["primary", "secondary", "throwable"].forEach(function (slot) {
          if (o.locks[slot]) return;
          pools[slot].forEach(function (cand) {
            if (cand === cur[slot]) return;
            var over = {}; over[slot] = cand;
            consider(seedOf(over));
          });
        });
        for (var i = 0; i < 4; i++) {
          if (o.locks["strat" + (i + 1)]) continue;
          for (var k = 0; k < pools.strat.length; k++) {
            var cand = pools.strat[k];
            if (cur.strategems.indexOf(cand) !== -1) continue;
            var strats = cur.strategems.slice(); strats[i] = cand;
            consider(seedOf({ strats: strats }));
          }
        }
        if (!bestC) break;
        cur = bestC; changed = true;
      }
      if (changed) cur.repaired = true;
      return cur;
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
      // Why the faction had to be relaxed: the rules the best faction-only build still missed (null = no faction-only
      // build could even be completed). Shown by the page's "Why?" detail.
      pick.strictUnmet = pick.factionOverridden ? (r1 ? r1.unmet : null) : [];
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
    makeEmptySlot: makeEmptySlot,
    RULE_TIER: RULE_TIER,
    TIER_NAMES: TIER_NAMES,
    RULES: RULES,
    normalizeRequirements: normalizeRequirements,
    normalizeRule: normalizeRule,
    normalizeRules: normalizeRules,
    normalizeWeight: normalizeWeight,
    normalizeWeights: normalizeWeights,
    scoreUnmet: scoreUnmet,
    STRATAGEM_CATEGORIES: STRATAGEM_CATEGORIES,
  };
});
