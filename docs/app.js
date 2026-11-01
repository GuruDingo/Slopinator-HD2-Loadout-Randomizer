/*
 * Helldivers 2 Slopinator - browser UI.
 * Reads the gear (gear-data.js), asks the engine (engine.js) for loadouts, and draws them.
 * Everything runs in the visitor's browser; nothing is sent anywhere.
 */
(function () {
  "use strict";

  var DATA = globalThis.HD2_DATA;
  var Engine = globalThis.HD2Engine;
  var engine = Engine.create(DATA);

  // ---------------------------------------------------------------------------
  // Display configuration (labels and colours)
  // ---------------------------------------------------------------------------
  var FACTION_NAMES = { bug: "Terminids", bot: "Automatons", squid: "Illuminate", any: "Any" };
  var FACTION_ADJECTIVE = { bug: "Terminid", bot: "Automaton", squid: "Illuminate" };
  var TYPE_LABELS = {
    support: "Support Weapon", backpack: "Backpack", vehicle: "Vehicle", eagle: "Eagle",
    orbital: "Orbital", sentry: "Sentry", defensive: "Defensive",
  };
  var WEAPON_CAT_LABELS = { primary: "Primary", secondary: "Secondary", throwable: "Throwable" };
  // Tag display titles, dropdown sections and pill colours come from hd2tags.csv (built into HD2_DATA.tags), not from this file.
  // A tag with a title is offered in the rule builder, under its group; one with a colour and a pill_order also gets a pill on
  // cards (left to right by pill_order). A tag with no row still works in the data and the rules, it just isn't offered.
  // (The three "crayon" pills follow the enemy-level colours: Chaff green, Medium blue, Anti-Tank red.)
  var TAG_NAMES = {}, TAG_COLORS = {}, TAG_DESC = {}, TAG_GROUPS = [], PILL_ORDER = [];
  (DATA.tags || []).forEach(function (t) {
    TAG_NAMES[t.tag] = t.title;
    TAG_DESC[t.tag] = t.description || "";
    var g = TAG_GROUPS.filter(function (x) { return x.name === t.group; })[0];
    if (!g) { g = { name: t.group, tags: [] }; TAG_GROUPS.push(g); }
    g.tags.push(t.tag);
    if (t.color && t.pillOrder) { TAG_COLORS[t.tag] = t.color; PILL_ORDER.push(t); }
  });
  PILL_ORDER.sort(function (a, b) { return a.pillOrder - b.pillOrder; });
  PILL_ORDER = PILL_ORDER.map(function (t) { return t.tag; });
  var TYPE_COLORS = {
    support: "#011419", backpack: "#011419", vehicle: "#011419",
    eagle: "#190301", orbital: "#190301", sentry: "#081901", defensive: "#081901",
  };
  // Accent colour per faction (the page's accent follows the selected faction; "any" is Super Credit Blue).
  var FACTION_COLORS = { any: "#70F5FF", bug: "#FF8D1F", bot: "#FF6161", squid: "#CD8AEA" };
  var MAX_COUNT = 20;
  var MAX_CUSTOM_RULES = 30;
  var MAX_WEIGHT_RULES = 10;
  var MAX_RULE_COUNT = 7;   // largest count a rule can ask for (a loadout has 7 slots)

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  // h("div", {class: "x"}, child, "text") -> element. Text is always added as text (never HTML),
  // so item names from the CSV can't inject markup.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  // localStorage can be missing or blocked (private windows, strict settings): never let that break the page.
  var store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
    remove: function (key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
  var SETTINGS_KEY = "hd2_settings";   // randomizer settings: { faction, disabledRules, requirements }
  // Saved per-item data is keyed by the item's permanent id (hd2gear.csv `id`), so renaming an item never loses it.
  // Older versions keyed it by name; those entries are still read (see itemFromKey) and rewritten with ids.
  var TRACKER_KEY = "hd2_tracker";     // items you own: { "12": true }. Missing key = new browser = own everything.
  var FACTIONS_KEY = "hd2_factions";   // your faction edits: { "12": ["bug","bot"] } (only items that differ from the CSV)
  var BLOCK_KEY = "hd2_blocked";       // items you have blocked: ["12", ...]
  // Names that were changed before ids were used for saving; a saved entry under the old name still finds its item.
  var LEGACY_NAMES = { "M-102 Fast Recon Vehicle": "M-102 Gunner FRV", "G/40-K Meltamine": "G/40-K Melta Mine" };

  var warbondName = {};
  DATA.warbonds.forEach(function (w) { warbondName[w.key] = w.name; });
  // Shorter label for the pill on a loadout card (the warbond lists and the tracker keep the full names).
  var warbondPillName = {
    req_p: "Requisition", req_o: "Requisition", req_h: "Requisition",
    req_b: "Requisition", req_e: "Requisition", req_r: "Requisition",
    super_citizen: "Event Reward"
  };
  // Items whose pill differs from the rest of their warbond: the MP-98 Knight was the Super Citizen Edition bonus.
  var itemPillName = { "MP-98 Knight": "Super Citizen Edition" };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function showView(name) {
    ["randomizer", "gear"].forEach(function (v) { $("view-" + v).hidden = v !== name; });
    document.querySelectorAll(".tab").forEach(function (t) {
      var on = t.getAttribute("data-view") === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { showView(t.getAttribute("data-view")); });
  });

  // ---------------------------------------------------------------------------
  // Loadout cards
  // ---------------------------------------------------------------------------
  // Every picture goes through here: the saved copy in docs/img/ (listed in HD2_DATA.images by
  // tools/fetch_images.py + build_gear.py) when there is one, otherwise the wiki address it was given.
  function imgSrc(url) {
    var saved = globalThis.HD2_DATA && HD2_DATA.images;
    return (saved && saved[url]) || url;
  }

  function imageNode(item) {
    if (!item.imgUrl) return h("div", { class: "img-placeholder" }, "No image");
    var img = h("img", {
      src: imgSrc(item.imgUrl), alt: item.name, class: "item-img", loading: "lazy", referrerpolicy: "no-referrer",
    });
    img.addEventListener("error", function () { img.replaceWith(h("div", { class: "img-placeholder" }, "No image")); });
    return img;
  }

  // Small picture for a My Gear row: lazy-loaded (rows inside a closed warbond don't fetch anything), and a blank
  // square of the same size if there is no image or it can't load, so the names stay lined up.
  function gearThumb(item) {
    if (!item.imgUrl) return h("span", { class: "gear-thumb gear-thumb-blank", "aria-hidden": "true" });
    var img = h("img", { src: imgSrc(item.imgUrl), alt: "", class: "gear-thumb", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", function () { img.replaceWith(h("span", { class: "gear-thumb gear-thumb-blank", "aria-hidden": "true" })); });
    return img;
  }

  function tagPills(item) {
    return PILL_ORDER
      .filter(function (tag) { return Engine.has(item, tag); })
      .map(function (tag) {
        return h("span", { class: "tag-pill", style: "background:" + TAG_COLORS[tag] }, TAG_NAMES[tag] || tag.toUpperCase());
      });
  }

  // Armor penetration: the wiki's own icon for each level a weapon has, side by side when it has two (e.g. a
  // rifle and its underbarrel launcher). Linked from the wiki like the other images; if one can't load, the level's
  // name is shown as text instead.
  var AP_NAMES = {
    "-1": "No hitbox", 0: "Unarmored", 1: "Very light", 2: "Light", 3: "Medium", 4: "Heavy", 5: "Anti-tank I",
    6: "Anti-tank II", 7: "Anti-tank III", 8: "Anti-tank IV", 9: "Anti-tank V", 10: "Anti-tank VI", 11: "Indestructible",
  };
  function apIconUrl(n) { return "https://helldivers.wiki.gg/images/Armor_AP" + n + "_Icon.png"; }
  function apRow(item) {
    var levels = item.armorPen || [];
    if (!levels.length) return null;
    var row = h("div", { class: "ap-row", title: "Armor penetration: " + levels.map(function (n) { return AP_NAMES[n] || ("AP" + n); }).join(" / ") });
    levels.forEach(function (n, i) {
      var name = AP_NAMES[n] || ("AP" + n);
      if (i) row.appendChild(h("span", { class: "ap-sep", "aria-hidden": "true" }, "/"));
      var img = h("img", { src: imgSrc(apIconUrl(n)), alt: "Armor penetration: " + name, class: "ap-icon", loading: "lazy", referrerpolicy: "no-referrer" });
      img.addEventListener("error", function () { img.replaceWith(h("span", { class: "ap-text" }, name)); });
      row.appendChild(img);
    });
    return row;
  }

  function itemCard(item, slotLabel, opts) {
    var locked = opts.locked, suboptimal = opts.suboptimal;
    var cls = (opts.wide ? "item-card2" : "item-card") + (suboptimal ? " suboptimal" : "") + (locked ? " is-locked" : "") + (item.empty ? " is-empty" : "");
    var warbondRow = item.warbond !== "base"
      ? h("div", { class: "warbond-row" },
          h("span", { class: "tag-pill", style: "background:#2a2a2a;border:1px solid #555" }, itemPillName[item.name] || warbondPillName[item.warbond] || warbondName[item.warbond] || item.warbond))
      : null;
    // Lock and reroll controls only exist on cards that belong to a generated loadout (opts.onLock / opts.onReroll).
    var lockBtn = opts.onLock && !item.empty   // an empty slot has nothing to keep
      ? h("button", {
          type: "button", class: "slot-btn lock-btn", "aria-pressed": locked ? "true" : "false",
          title: locked ? "Unlock this slot" : "Lock this slot (kept when you reroll)",
          "aria-label": (locked ? "Unlock " : "Lock ") + slotLabel + ": " + item.name,
          onclick: opts.onLock,
        }, locked ? "\uD83D\uDD12" : "\uD83D\uDD13")
      : null;
    var rerollBtn = opts.onReroll
      ? h("button", {
          type: "button", class: "slot-btn reroll-btn", disabled: locked ? true : null,
          title: locked ? "Unlock this slot to reroll it" : "Reroll just this slot",
          "aria-label": "Reroll " + slotLabel + ": " + item.name,
          onclick: opts.onReroll,
        }, "\uD83C\uDFB2")
      : null;
    // Markers: gear you don't own (a shared loadout can have any item) or have blocked since it was rolled.
    var statusBadges = [];
    if (!item.empty && !isOwned(item)) statusBadges.push(h("span", { class: "status-badge not-owned", title: "You don't own this item (My Gear)" }, "NOT OWNED"));
    if (!item.empty && blocked[item.name]) statusBadges.push(h("span", { class: "status-badge is-blocked-badge", title: "You have blocked this item in My Gear" }, "BLOCKED"));
    var statusRow = statusBadges.length ? h("div", { class: "status-row" }, statusBadges) : null;
    // Block: marks the item blocked in My Gear (never rolled again) and rerolls this slot. Not on an empty slot, and not while locked.
    var blockBtn = opts.onBlock && !item.empty
      ? h("button", {
          type: "button", class: "slot-btn block-slot-btn", disabled: locked ? true : null,
          title: locked ? "Unlock this slot to block its item" : "Block this item in My Gear and reroll this slot",
          "aria-label": "Block " + slotLabel + ": " + item.name,
          onclick: opts.onBlock,
        }, "\uD83D\uDEAB")
      : null;
    return h("div", { class: cls },
      h("div", { class: "card-header", style: "background:" + (TYPE_COLORS[item.cat] || "#363426") },
        h("span", { class: "slot-label" }, slotLabel),
        suboptimal ? h("span", { class: "suboptimal-badge", title: "Not a good pick against " + (FACTION_NAMES[opts.faction] || "this faction") + " \u2014 it\u2019s meant for: " + factionsText(item) }, "\u26A0 OFF-FACTION") : null,
        h("span", { class: "slot-btns" }, rerollBtn, blockBtn, lockBtn)),
      item.empty ? h("div", { class: "empty-img" }, imageNode(item)) : imageNode(item),
      h("div", { class: "card-body" },
        h("div", { class: "name-row" }, h("div", { class: "item-name" }, item.name), apRow(item)),
        warbondRow,
        statusRow,
        h("div", { class: "tag-row" }, tagPills(item))));
  }

  // "Why" text for the results banners. Tier names come from the engine ("Overwrite", "Core", "Preferred").
  function tierText(u) {
    var names = Engine.TIER_NAMES || [];
    return names[u.tier] ? " [" + names[u.tier] + "]" : "";
  }
  // Which factions an item is meant for, in words (for the OFF-FACTION tooltip).
  function factionsText(item) {
    var f = item.factions || [];
    if (f.indexOf("none") !== -1) return "no faction (disabled)";
    if (f.length === 1 && f[0] === "any") return "any faction";
    return f.map(function (x) { return FACTION_NAMES[x] || x; }).join(", ");
  }

  // Plain-language text for a rule the engine reported as unmet.
  function ruleText(u) {
    if (u.id === "require") {
      return "Rule: " + u.how + " " + (TAG_NAMES[u.tag] || u.tag) + " (this build has " + u.actual + ")";
    }
    if (u.id === "custom") {
      return "Rule: " + describeRule(u.rule) + " (this build has " + u.actual + ")";
    }
    return u.label;
  }

  // ---- Generated results: each loadout keeps its own per-slot locks ----
  // lastRun = { faction, requirements, disabledRules, entries: [{ lo, locks, node }] }. Locks start as whatever was typed into the
  // Locks panel; lock/unlock on a card only affects that loadout. Rerolls reuse the faction and requirements the
  // loadouts were generated with, but read your gear pool (My Gear) as it is now.
  var SLOT_KEYS = ["primary", "secondary", "throwable", "strat1", "strat2", "strat3", "strat4"];
  var lastRun = null;

  function itemAt(lo, key) {
    if (key.indexOf("strat") === 0) return lo.strategems[parseInt(key.slice(5), 10) - 1];
    return lo[key];
  }

  function loadoutNode(entry, idx, total) {
    var lo = entry.lo, locks = entry.locks, faction = lastRun.faction;
    var label = FACTION_NAMES[faction] || faction;
    function isOff(item) { return lo.suboptimalNames.has(item.name); }
    function card(key, slotLabel, extra) {
      var item = itemAt(lo, key);
      var opts = { locked: !!locks[key], suboptimal: isOff(item), faction: faction, wide: !!(extra && extra.wide),
        onLock: function () { toggleLock(entry, key); },
        onReroll: function () { rerollSlot(entry, key); },
        onBlock: function () { blockSlot(entry, key); } };
      return itemCard(item, slotLabel, opts);
    }
    var unlockedCount = SLOT_KEYS.filter(function (k) { return !locks[k]; }).length;

    var box = h("div", { class: "loadout", "data-idx": String(idx) });
    var title = total > 1 ? "Loadout " + (idx + 1) : "Loadout";
    box.appendChild(h("div", { class: "loadout-bar" },
      total > 1 ? h("h2", null, title) : h("span", { class: "loadout-bar-title" }, title),
      h("button", {
        type: "button", class: "ctrl-btn reroll-all-btn", disabled: unlockedCount ? null : true,
        title: unlockedCount ? "Keep the locked slots, reroll all the others" : "Every slot is locked",
        onclick: function () { rerollUnlocked(entry); },
      }, "\uD83C\uDFB2 Reroll all unlocked (" + unlockedCount + ")"),
      h("button", {
        type: "button", class: "ctrl-btn share-btn", title: "Copy a link to this loadout",
        onclick: function () { shareLoadout(entry); },
      }, "\uD83D\uDD17 Share")));
    if (entry.shared) {
      box.appendChild(h("div", { class: "shared-banner" },
        "Shared loadout. It is shown as it was sent (Any faction, none of your rules applied). Items marked ",
        h("span", { class: "status-badge not-owned" }, "NOT OWNED"),
        " aren\u2019t in your gear; Generate makes a loadout of your own."));
    }
    var lockedKeys = SLOT_KEYS.filter(function (k) { return locks[k]; });
    function lockNote() {
      return lockedKeys.length
        ? h("p", { class: "why-line" }, "You have " + lockedKeys.length + " locked slot" + (lockedKeys.length === 1 ? "" : "s") +
            ". Locked items are never swapped out, so they can be what blocks a rule \u2014 try unlocking one.")
        : null;
    }
    if (lo.factionOverridden) {
      var strict = lo.strictUnmet;
      box.appendChild(h("div", { class: "faction-warning" },
        "\u26A0 Couldn\u2019t build a valid " + label + " loadout with the current warbonds/locks, so the faction " +
        "restriction was relaxed to fill this one out. Items marked ",
        h("span", { class: "suboptimal-badge" }, "\u26A0 OFF-FACTION"),
        " below aren\u2019t ideal picks against " + label + ".",
        h("details", { class: "why" },
          h("summary", null, "Why?"),
          strict && strict.length
            ? h("div", null,
                h("p", { class: "why-line" }, "The best " + label + "-only build still broke:"),
                h("ul", null, strict.map(function (u) { return h("li", null, ruleText(u) + tierText(u)); })),
                h("p", { class: "why-line" }, "Relaxing the faction let it follow every rule, so that\u2019s what you got."))
            : h("p", { class: "why-line" }, "There weren\u2019t enough " + label + "-eligible items among your owned warbonds, unlocked slots and never-roll choices to fill every slot."),
          lockNote())));
    }
    if (lo.unmet && lo.unmet.length) {
      box.appendChild(h("div", { class: "rules-warning" },
        "\u26A0 This loadout couldn\u2019t meet every guarantee with the current locks and filters, so it was completed " +
        "without these (everything else still applies):",
        h("ul", null, lo.unmet.map(function (u) { return h("li", null, ruleText(u) + tierText(u)); })),
        h("details", { class: "why" },
          h("summary", null, "Why?"),
          h("p", { class: "why-line" }, "The generator tries up to " + 1000 + " builds and keeps the one that breaks the least important rules " +
            "(your own rules first, then high, medium and low priority). None of them could follow everything at once."),
          (lo.emptySlots || lo.emptyWeapons)
            ? h("p", { class: "why-line" }, "You don\u2019t own enough gear to follow every rule: filling the slots took priority, and only the game\u2019s own limits " +
                "(one FRV, one tank, one exosuit, no stratagem twice) were kept. The rules above are the ones that gave way.")
            : null,
          lockNote(),
          h("p", { class: "why-line" }, "To fix it: loosen or remove a rule in Rules, tick more warbonds in My Gear, or unlock a slot."))));
    }
    box.appendChild(h("h3", { class: "section-title" }, "Weapons"));
    if (lo.emptyWeapons) {
      box.appendChild(h("p", { class: "hint empty-note" },
        lo.emptyWeapons + " weapon slot" + (lo.emptyWeapons === 1 ? " is" : "s are") + " empty: nothing you own (and have not blocked in My Gear) fits " +
        (lo.emptyWeapons === 1 ? "it." : "them.")));
    }
    box.appendChild(h("div", { class: "card-row" },
      card("primary", "Primary", { wide: true }),
      card("secondary", "Secondary"),
      card("throwable", "Throwable")));
    box.appendChild(h("h3", { class: "section-title" }, "Stratagems"));
    if (lo.emptySlots) {
      box.appendChild(h("p", { class: "hint empty-note" },
        lo.emptySlots + " stratagem slot" + (lo.emptySlots === 1 ? " is" : "s are") + " empty: you only have " + (4 - lo.emptySlots) +
        " stratagem" + (4 - lo.emptySlots === 1 ? "" : "s") + " to bring (owned and not blocked in My Gear). That is allowed in the game."));
    }
    box.appendChild(h("div", { class: "card-row" },
      lo.strategems.map(function (st, i) { return card("strat" + (i + 1), st.empty ? "Stratagem" : (TYPE_LABELS[st.cat] || st.cat)); })));
    box.appendChild(h("hr", { class: "divider" }));
    return box;
  }

  function renderLoadouts(loadouts, faction, locks, requirements, disabledRules, customRules, weights, shared) {
    var results = $("results");
    results.textContent = "";
    // Results keep the colour of the faction they were generated for, even if you switch faction afterwards.
    results.style.setProperty("--accent", FACTION_COLORS[faction] || FACTION_COLORS.any);
    lastRun = { faction: faction, requirements: JSON.parse(JSON.stringify(requirements)), disabledRules: (disabledRules || []).slice(), customRules: JSON.parse(JSON.stringify(customRules || [])), weights: JSON.parse(JSON.stringify(weights || [])), entries: [] };
    loadouts.forEach(function (lo, idx) {
      var entry = { lo: lo, locks: Object.assign({}, locks), node: null, shared: !!shared };
      lastRun.entries.push(entry);
      entry.node = loadoutNode(entry, idx, loadouts.length);
      results.appendChild(entry.node);
    });
  }

  // Redraws one loadout in place (the page doesn't jump to the top).
  function redraw(entry) {
    var idx = lastRun.entries.indexOf(entry);
    var node = loadoutNode(entry, idx, lastRun.entries.length);
    entry.node.replaceWith(node);
    entry.node = node;
  }

  function toggleLock(entry, key) {
    if (entry.locks[key]) delete entry.locks[key]; else entry.locks[key] = itemAt(entry.lo, key);
    redraw(entry);
  }

  // `callLocks` = the slots to hold fixed for this one build; `avoid` = the item being replaced (so a reroll
  // actually changes it when another choice exists).
  function rebuild(entry, callLocks, avoid, what, firstNote, quiet) {
    var excluded = excludedNames();
    // Anything held fixed stays even if you blocked it since (it's already on screen).
    Object.keys(callLocks).forEach(function (k) { excluded.delete(callLocks[k].name); });
    var base = { faction: lastRun.faction, locks: callLocks, requirements: lastRun.requirements, disabledRules: lastRun.disabledRules, customRules: lastRun.customRules, weights: lastRun.weights };
    var lo = null, note = null;
    try {
      var ex = new Set(excluded);
      if (avoid) ex.add(avoid.name);
      base.excluded = ex;
      lo = engine.generateLoadoutRelaxed(base);
      // Taking the item out must not leave the slot empty when it could have kept the old item.
      if (avoid && (lo.emptySlots || 0) + (lo.emptyWeapons || 0) > (entry.lo.emptySlots || 0) + (entry.lo.emptyWeapons || 0)) throw new Engine.GenerationError("no other item");
    } catch (e) {
      if (!(e instanceof Engine.GenerationError)) throw e;
      if (!avoid) { if (!quiet) showMessages([e.message]); return false; }
      try {
        base.excluded = excluded;
        lo = engine.generateLoadoutRelaxed(base);
        note = "There is no other " + what + " available with your current gear, locks and requirements.";
      } catch (e2) {
        if (!(e2 instanceof Engine.GenerationError)) throw e2;
        if (!quiet) showMessages([e2.message]);
        return false;
      }
    }
    entry.lo = lo;
    if (!quiet) showMessages([firstNote, note].filter(Boolean), "info");
    redraw(entry);
    return true;
  }

  function rerollSlot(entry, key) {
    if (entry.locks[key]) return;
    var callLocks = {};
    SLOT_KEYS.forEach(function (k) { if (k !== key) callLocks[k] = itemAt(entry.lo, k); });
    rebuild(entry, callLocks, itemAt(entry.lo, key), "item for this slot");
  }

  // Block the item in this slot in My Gear (the same as the Block button there), then reroll the slot.
  function blockSlot(entry, key) {
    if (entry.locks[key]) return;
    var item = itemAt(entry.lo, key);
    if (!item || item.empty) return;
    blocked[item.name] = true;
    onGearChange();
    // The same item in any other loadout on screen is replaced too (unless that slot is locked).
    var others = 0, kept = 0;
    lastRun.entries.forEach(function (other) {
      if (other === entry) return;
      SLOT_KEYS.forEach(function (k) {
        if ((itemAt(other.lo, k) || {}).name !== item.name) return;
        if (other.locks[k]) { kept++; return; }
        var cl = {};
        SLOT_KEYS.forEach(function (j) { if (j !== k) cl[j] = itemAt(other.lo, j); });
        if (rebuild(other, cl, item, "item for this slot", null, true)) others++;
      });
    });
    var cl = {};
    SLOT_KEYS.forEach(function (k) { if (k !== key) cl[k] = itemAt(entry.lo, k); });
    var msg = "Blocked " + item.name + " in My Gear. Unblock it there to roll it again.";
    if (others) msg += " Also replaced in " + others + " other loadout" + (others === 1 ? "" : "s") + ".";
    if (kept) msg += " Kept in " + kept + " locked slot" + (kept === 1 ? "" : "s") + ".";
    rebuild(entry, cl, item, "item for this slot", msg);
  }

  function rerollUnlocked(entry) {
    var callLocks = Object.assign({}, entry.locks);
    if (Object.keys(callLocks).length === SLOT_KEYS.length) return;
    rebuild(entry, callLocks, null, "");
  }

  // ---------------------------------------------------------------------------
  // Shared loadouts
  // ---------------------------------------------------------------------------
  // A link carries one loadout as its 7 permanent item ids in slot order (primary, secondary, throwable, four stratagems), 0 for an
  // empty slot: ".../#l1=6.21.50.12.30.41.77". "l1" is the format version. The part after # never reaches a server.
  var SHARE_KEY = "l1";
  function shareHash(lo) {
    var items = [lo.primary, lo.secondary, lo.throwable].concat(lo.strategems);
    return "#" + SHARE_KEY + "=" + items.map(function (i) { return i.empty ? 0 : i.id; }).join(".");
  }
  // The 7 slot items for a hash, or { error } when the link is damaged or names an item this version doesn't have.
  function parseShareHash(hash) {
    var m = /^#?l1=([0-9.]*)$/.exec(String(hash || ""));
    if (!m) return null;                                   // not a share link at all
    var parts = m[1].split(".");
    if (parts.length !== 7 || parts.some(function (p) { return !/^\d{1,6}$/.test(p); })) return { error: "That shared link is damaged, so it can\u2019t be shown." };
    var items = [], missing = false;
    parts.forEach(function (p, i) {
      if (p === "0") { items.push(makeEmptyFor(i)); return; }
      var it = ITEM_BY_ID[String(parseInt(p, 10))];
      if (!it) { missing = true; return; }
      items.push(it);
    });
    if (missing) return { error: "That shared link has items this version doesn\u2019t know about, so it can\u2019t be shown." };
    var cats = ["primary", "secondary", "throwable"];
    for (var k = 0; k < 7; k++) {
      var it2 = items[k];
      if (it2.empty) continue;
      if (k < 3 ? it2.cat !== cats[k] : (it2.cat === "primary" || it2.cat === "secondary" || it2.cat === "throwable")) {
        return { error: "That shared link has an item in the wrong slot, so it can\u2019t be shown." };
      }
    }
    return { items: items };
  }
  function makeEmptyFor(slot) { return Engine.makeEmptySlot(slot < 3 ? ["primary", "secondary", "throwable"][slot] : undefined); }

  function shareLoadout(entry) {
    var url = location.href.replace(/#.*$/, "") + shareHash(entry.lo);
    function manual() { showMessages(["Copy this link to share the loadout: " + url], "info"); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { showMessages(["Link to this loadout copied."], "info"); }, manual);
        return;
      }
    } catch (e) { /* fall through */ }
    manual();
  }

  // Shows the loadout a share link describes (or says why it can't). Returns true when the hash was a share link.
  function showSharedFromHash() {
    var parsed = parseShareHash(location.hash);
    if (!parsed) return false;
    try { history.replaceState(null, "", location.href.replace(/#.*$/, "")); } catch (e) { /* ignore */ }
    if (parsed.error) { showMessages([parsed.error]); return true; }
    var it = parsed.items, locks = { primary: it[0], secondary: it[1], throwable: it[2], strat1: it[3], strat2: it[4], strat3: it[5], strat4: it[6] };
    var lo;
    try {
      // Every slot locked: the engine builds nothing, it only checks the loadout against the default rules.
      lo = engine.generateLoadoutRelaxed({ faction: "any", locks: locks, excluded: new Set(), requirements: {}, disabledRules: [], customRules: [], weights: [] });
    } catch (e) {
      if (!(e instanceof Engine.GenerationError)) throw e;
      showMessages([e.message]); return true;
    }
    showMessages([]);
    showView("randomizer");
    renderLoadouts([lo], "any", {}, {}, [], [], [], true);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  function showMessages(list, kind) {
    var box = $("messages");
    box.textContent = "";
    list.forEach(function (text) { box.appendChild(h("div", { class: "msg " + (kind || "error") }, text)); });
  }

  // ---------------------------------------------------------------------------
  // Control panel state
  // ---------------------------------------------------------------------------
  var state = {
    requirements: {},    // tag -> { min?, max? }  (the player's plain tag counts, edited default rows included)
    disabledRules: {},   // default rule id -> true when removed from the rules list
    customRules: [],     // the player's own generic rules: scoped counts, categories, if/then (see Engine.normalizeRule)
    weights: [],         // the player's odds rules { sel, scope, factor } (see Engine.normalizeWeight); one that matches a default odds rule edits it
  };

  // ---- My Gear model: what you own (item level) and what you have blocked ----
  // The randomizer's pool = owned and not blocked. Base Game gear is always owned.
  var ALL_ITEMS = [].concat(engine.pools.primaries, engine.pools.secondaries, engine.pools.throwables, engine.pools.strategems)
    .filter(function (i) { return i.factions.indexOf("none") === -1; });
  var owned = {};   // name -> true (doesn't hold Base Game items; they are always owned)
  var blocked = {}; // name -> true: never rolled, even if owned
  var gearRows = {}; // item name -> its row in the My Gear list (filled by buildGear)

  // ---- Editable faction lists ----
  // Each item's CSV "factions" are the defaults. "Edit factions" (My Gear tab) lets you tick which of Terminid /
  // Automaton / Illuminate an item is recommended against. We write the result straight into item.factions, which
  // the engine reads live. All three ticked is stored as ["any"]; none ticked is [] (the item then only rolls when
  // the faction is Any). Only items that differ from the defaults are saved.
  var FAC_KEYS = ["bug", "bot", "squid"];
  var FAC_LETTER = { bug: "T", bot: "A", squid: "I" };
  // Faction emblems, linked from the Helldivers wiki like the item images (same hotlinking decision). If one
  // can't load (offline, blocked), the chip falls back to a letter and the faction button to plain text.
  var FAC_ICON_URL = {
    bug: "https://helldivers.wiki.gg/images/Terminid_Icon.svg",
    bot: "https://helldivers.wiki.gg/images/Automaton_Icon.svg",
    squid: "https://helldivers.wiki.gg/images/Illuminate_Icon.svg",
    any: "https://helldivers.wiki.gg/images/Super_Earth_Icon.svg",
  };
  // Small icons beside warbond titles in My Gear (hotlinked from the wiki). They keep their own colours, except
  // Base Game, which uses the Super Earth emblem drawn flat white. A warbond not listed here has no icon.
  var WIKI_IMG = "https://helldivers.wiki.gg/images/";
  var REQ_ICON = WIKI_IMG + "Requisition_Slip.svg";
  var WARBOND_ICONS = {
    base:          { url: WIKI_IMG + "Super_Earth_Icon.svg", white: true },
    super_citizen: { url: WIKI_IMG + "Super_Citizen_Title_Icon.svg" },
    req_p: { url: REQ_ICON }, req_o: { url: REQ_ICON }, req_h: { url: REQ_ICON },
    req_b: { url: REQ_ICON }, req_e: { url: REQ_ICON }, req_r: { url: REQ_ICON },
    superstore:    { url: WIKI_IMG + "Super_Credit.svg" },
    helldivers_mobilize:   { url: WIKI_IMG + "Level_50_Skull_Admiral_Rank_Icon.svg" },
    steeled_veterans:      { url: WIKI_IMG + "Level_70_Admirable_Admiral_Rank_Icon.svg" },
    cutting_edge:          { url: WIKI_IMG + "Level_90_Galactic_Commander_Rank_Icon.svg" },
    democratic_detonation: { url: WIKI_IMG + "Level_120_5-Star_General_Rank_Icon.svg" },
    polar_patriots:        { url: WIKI_IMG + "Level_150_Super_Private_Rank_Icon.svg" },
    viper_commandos:       { url: WIKI_IMG + "Viper_Commando_Title_Icon.svg" },
    freedoms_flame:        { url: WIKI_IMG + "Fire_Safety_Officer_Title_Icon.svg" },
    chemical_agents:       { url: WIKI_IMG + "Expert_Exterminator_Title_Icon.svg" },
    truth_enforcers:       { url: WIKI_IMG + "Free_of_Thought_Title_Icon.svg" },
    urban_legends:         { url: WIKI_IMG + "Super_Pedestrian_Title_Icon.svg" },
    servants_of_freedom:   { url: WIKI_IMG + "Servant_of_Freedom_Title_Icon.svg" },
    borderline_justice:    { url: WIKI_IMG + "Super_Sheriff_Title_Icon.svg" },
    masters_of_ceremony:   { url: WIKI_IMG + "Decorated_Hero_Title_Icon.svg" },
    force_of_law:          { url: WIKI_IMG + "Extra_Judicial_Title_Icon.svg" },
    control_group:         { url: WIKI_IMG + "Exemplary_Subject_Title_Icon.svg" },
    odst:                  { url: WIKI_IMG + "Rookie_Title_Icon.svg" },
    dust_devils:           { url: WIKI_IMG + "Burier_of_Heads_Title_Icon.svg" },
    python_commandos:      { url: WIKI_IMG + "Python_Commando_Title_Icon.svg" },
    redacted_regiment:     { url: WIKI_IMG + "Redacted_Title_Icon.svg" },
    siege_breakers:        { url: WIKI_IMG + "Bunker_Buster_Title_Icon.svg" },
    entrenched_division:   { url: WIKI_IMG + "Mudskipper_Title_Icon.svg" },
    exo_experts:           { url: WIKI_IMG + "Exosuit_Certified_Title_Icon.svg" },
    "40k":                 { url: WIKI_IMG + "Still_Standing_Title_Icon.png" },
    ironclad_democracy:    { url: WIKI_IMG + "Treadhead_Title_Icon.png" },
    scope_of_authority:    { url: WIKI_IMG + "thumb/Longshot_Title_Icon.png/600px-Longshot_Title_Icon.png" },
    killzone:              { url: WIKI_IMG + "Assault_Infantry_Title_Icon.svg" }, // the Killzone collab warbond is the wiki's "Righteous Revenants"
  };
  function warbondIcon(key) {
    var def = WARBOND_ICONS[key];
    if (!def) return null;
    var img = h("img", { src: imgSrc(def.url), alt: "", class: "wb-icon" + (def.white ? " wb-icon-white" : ""), referrerpolicy: "no-referrer", "aria-hidden": "true" });
    img.addEventListener("error", function () { img.remove(); }); // can't load: the title is just its name
    return img;
  }
  function facIcon(f, fallbackText) {
    var img = h("img", { src: imgSrc(FAC_ICON_URL[f]), alt: "", class: "fac-icon", referrerpolicy: "no-referrer", "aria-hidden": "true" });
    img.addEventListener("error", function () {
      img.replaceWith(fallbackText ? h("span", { class: "fac-icon-fallback" }, fallbackText) : document.createTextNode(""));
    });
    return img;
  }
  var defaultFactions = {};  // name -> the CSV's factions list
  var facOverrides = {};     // name -> factions list that replaces the default
  // Saved key -> item. A key made only of digits is an id; anything else is an old name-keyed entry.
  var ITEM_BY_ID = {}, ITEM_BY_NAME = {};
  ALL_ITEMS.forEach(function (i) { ITEM_BY_ID[i.id] = i; ITEM_BY_NAME[i.name] = i; });
  function itemFromKey(key) {
    if (/^\d+$/.test(String(key))) return ITEM_BY_ID[String(key)] || null;
    return ITEM_BY_NAME[LEGACY_NAMES[key] || key] || null;
  }
  function isLegacyKey(key) { return !/^\d+$/.test(String(key)); }
  // Reads a saved { key: value } object into { itemName: value }; name-keyed entries first so an id-keyed one wins.
  // `legacy` reports whether any name-keyed entry was seen (so the caller can rewrite the save with ids).
  function savedByName(saved) {
    var out = { map: {}, legacy: false };
    var keys = Object.keys(saved);
    keys.filter(isLegacyKey).concat(keys.filter(function (k) { return !isLegacyKey(k); })).forEach(function (k) {
      var it = itemFromKey(k);
      if (isLegacyKey(k)) out.legacy = true;
      if (it) out.map[it.name] = saved[k];
    });
    return out;
  }
  function byId(mapByName) {
    var out = {};
    Object.keys(mapByName).forEach(function (n) { if (ITEM_BY_NAME[n]) out[ITEM_BY_NAME[n].id] = mapByName[n]; });
    return out;
  }
  ALL_ITEMS.forEach(function (i) { defaultFactions[i.name] = i.factions.slice(); });

  function facFlags(list) {  // [bug, bot, squid] booleans, same rule as Engine.worksFor
    if (list.length === 1 && list[0] === "any") return [true, true, true];
    return FAC_KEYS.map(function (f) { return list.indexOf(f) !== -1; });
  }
  function facList(flags) {
    return flags.every(Boolean) ? ["any"] : FAC_KEYS.filter(function (f, i) { return flags[i]; });
  }
  function isCustomised(item) { return Object.prototype.hasOwnProperty.call(facOverrides, item.name); }
  function customisedCount() { return ALL_ITEMS.filter(isCustomised).length; }
  function applyFactions() {
    ALL_ITEMS.forEach(function (i) {
      i.factions = isCustomised(i) ? facOverrides[i.name].slice() : defaultFactions[i.name].slice();
    });
  }
  function loadFactions() {
    facOverrides = {};
    var saved = store.get(FACTIONS_KEY, null);
    var legacy = false;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      var r = savedByName(saved);
      legacy = r.legacy;
      ALL_ITEMS.forEach(function (i) {
        var v = r.map[i.name];
        if (Array.isArray(v) && v.every(function (f) { return f === "any" || FAC_KEYS.indexOf(f) !== -1; })) {
          facOverrides[i.name] = facList(facFlags(v));
        }
      });
    }
    applyFactions();
    if (legacy) saveFactions(); // rewrite the old name-keyed save with ids
  }
  function setItemFactions(item, flags) {
    var def = facFlags(defaultFactions[item.name]);
    if (flags.every(function (v, k) { return v === def[k]; })) delete facOverrides[item.name];
    else facOverrides[item.name] = facList(flags);
    applyFactions();
  }
  function saveFactions() { store.set(FACTIONS_KEY, byId(facOverrides)); }
  function onFactionEdit() { saveFactions(); refreshGear(); }
  // Back to the CSV defaults for items on screen (the search filter applies, like the other bulk buttons).
  function resetFactions(items) {
    shownOnly(items).forEach(function (i) { delete facOverrides[i.name]; });
    applyFactions();
    onFactionEdit();
  }

  // Base Game gear, plus the two base-game stratagems that sit in a requisition block (alwaysOwned), is always owned.
  function isBase(item) { return item.warbond === "base" || !!item.alwaysOwned; }
  function isOwned(item) { return isBase(item) || !!owned[item.name]; }
  function inPool(item) { return isOwned(item) && !blocked[item.name]; }

  function loadGear() {
    var saved = store.get(TRACKER_KEY, null);
    var legacy = false;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      var r = savedByName(saved);
      legacy = r.legacy;
      owned = {};
      Object.keys(r.map).forEach(function (n) { if (r.map[n]) owned[n] = true; });
    } else {
      // First visit in this browser: start with everything owned (people untick what they lack).
      owned = {};
      ALL_ITEMS.forEach(function (i) { if (!isBase(i)) owned[i.name] = true; });
      store.set(TRACKER_KEY, byId(owned));
    }
    blocked = {};
    var n = store.get(BLOCK_KEY, []);
    if (Array.isArray(n)) n.forEach(function (key) {
      var it = itemFromKey(key);
      if (isLegacyKey(key)) legacy = true;
      if (it) blocked[it.name] = true;
    });
    if (legacy) saveGear(); // rewrite the old name-keyed save with ids
  }
  function saveGear() {
    store.set(TRACKER_KEY, byId(owned));
    store.set(BLOCK_KEY, Object.keys(byId(blocked)));
  }
  // Counts over the items valid for a faction (omit the faction to count every item).
  function poolStats(faction) {
    var st = { total: 0, owned: 0, blocked: 0, pool: 0 };
    ALL_ITEMS.forEach(function (i) {
      if (faction && !Engine.worksFor(i, faction)) return;
      st.total++;
      if (isOwned(i)) { st.owned++; if (blocked[i.name]) st.blocked++; }
      if (inPool(i)) st.pool++;
    });
    return st;
  }
  // Names the engine must not roll: everything outside the pool.
  function excludedNames() {
    return new Set(ALL_ITEMS.filter(function (i) { return !inPool(i); }).map(function (i) { return i.name; }));
  }
  // The pool line on the Randomizer tab counts only what the selected faction can use
  // (items marked "any" included), so "of N" changes with the faction.
  function updatePoolLine() {
    var faction = selectedFaction();
    var st = poolStats(faction);
    var box = $("pool-text");
    box.textContent = "";
    box.appendChild(document.createTextNode("Rolling from "));
    box.appendChild(h("strong", null, String(st.pool)));
    box.appendChild(document.createTextNode(" of " + st.total + (faction === "any" ? "" : " " + FACTION_ADJECTIVE[faction] + "-compatible") + " items"));
    var bits = [];
    if (st.total - st.owned) bits.push((st.total - st.owned) + " not owned");
    if (st.blocked) bits.push(st.blocked + " blocked");
    if (bits.length) box.appendChild(document.createTextNode(" (" + bits.join(", ") + ")."));
    else box.appendChild(document.createTextNode("."));
    var custom = customisedCount();
    if (custom) box.appendChild(document.createTextNode(" Using your edited faction lists (" + custom + " item" + (custom === 1 ? "" : "s") + ")."));
  }

  // ---- Locks ----
  var LOCK_SLOTS = [
    { key: "primary", label: "Primary", list: "dl-primary", cats: ["primary"] },
    { key: "secondary", label: "Secondary", list: "dl-secondary", cats: ["secondary"] },
    { key: "throwable", label: "Throwable", list: "dl-throwable", cats: ["throwable"] },
    { key: "strat1", label: "Stratagem 1", list: "dl-strat", cats: Engine.STRATAGEM_CATEGORIES },
    { key: "strat2", label: "Stratagem 2", list: "dl-strat", cats: Engine.STRATAGEM_CATEGORIES },
    { key: "strat3", label: "Stratagem 3", list: "dl-strat", cats: Engine.STRATAGEM_CATEGORIES },
    { key: "strat4", label: "Stratagem 4", list: "dl-strat", cats: Engine.STRATAGEM_CATEGORIES },
  ];

  // Suggestion lists show item NAMES only. (An earlier version added the category as an option
  // "label", which some browsers display instead of the name.)
  function fillDatalist(id, items) {
    var dl = $(id);
    dl.textContent = "";
    items.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (i) {
      if (i.factions.indexOf("none") !== -1) return; // disabled items can't be picked
      dl.appendChild(h("option", { value: i.name }));
    });
  }

  function buildLockGrid() {
    var grid = $("lock-grid");
    grid.textContent = "";
    LOCK_SLOTS.forEach(function (slot) {
      var input = h("input", { type: "text", id: "lock-" + slot.key, list: slot.list, placeholder: "Random", "aria-label": slot.label + " lock" });
      input.addEventListener("input", updateLockSummary);
      var clear = h("button", { type: "button", class: "ctrl-btn lock-clear", title: "Clear", "aria-label": "Clear " + slot.label },
        "×");
      clear.addEventListener("click", function () { input.value = ""; updateLockSummary(); });
      grid.appendChild(h("div", { class: "lock-cell" },
        h("label", { for: "lock-" + slot.key }, slot.label),
        h("div", { class: "lock-input" }, input, clear)));
    });
  }
  function updateLockSummary() {
    var n = LOCK_SLOTS.filter(function (s) { return $("lock-" + s.key).value.trim() !== ""; }).length;
    $("lock-summary").textContent = n ? "(" + n + " locked)" : "";
  }

  // ---- Requirements ----
  function reqText(r) {
    if (r.min !== undefined && r.min === r.max) return "= " + r.min;
    if (r.min !== undefined && r.max !== undefined) return r.min + "–" + r.max;
    return r.min !== undefined ? "≥ " + r.min : "≤ " + r.max;
  }
  function reqWords(r) {
    if (r.min !== undefined && r.min === r.max) return "exactly " + r.min;
    if (r.min !== undefined && r.max !== undefined) return "between " + r.min + " and " + r.max;
    return r.min !== undefined ? "at least " + r.min : "at most " + r.max;
  }
  // ---- The rules list ----
  // Every default rule is a row in the Rules list, none is a switch. Three kinds of row:
  //  - preset rows: the nine default rules that are a plain count of one tag (Engine.RULES entries with a `preset`: Anti-Tank >= 1,
  //    Vehicle <= 1, ...). A row still at its default is handed to the engine as the default rule (it keeps its priority tier and
  //    wording). Adding a rule for the same tag edits it: the row becomes one of the player's own requirements for that tag and the
  //    default is switched off for the engine.
  //  - generic default rows: the other default rules (Engine.RULES entries with `rules`: support, chaff in primary / secondary,
  //    shield, supply, ...). They can be removed (not edited in place: remove one and build your own).
  //  - the player's own rules: plain tag counts (state.requirements) and generic rules (state.customRules).
  // A removed default is state.disabledRules[id]; "Reset to system defaults" brings them all back.
  var PRESETS = Engine.RULES.filter(function (r) { return r.preset; });
  var PRESET_IDS = {};
  PRESETS.forEach(function (p) { PRESET_IDS[p.id] = true; });
  var DEFAULT_IDS = {};
  Engine.RULES.forEach(function (r) { DEFAULT_IDS[r.id] = true; });
  function presetForTag(tag) { return PRESETS.filter(function (p) { return p.preset.tag === tag; })[0] || null; }
  function presetDefault(p) {
    var d = {};
    if (p.preset.min !== undefined) d.min = p.preset.min;
    if (p.preset.max !== undefined) d.max = p.preset.max;
    return d;
  }
  function sameReq(a, b) { return a.min === b.min && a.max === b.max; }

  // -- Rules as sentences --
  var SCOPE_LABELS = {
    all: "whole loadout", ps: "primary + secondary", weapons: "all three weapons", strats: "stratagems",
    primary: "primary", secondary: "secondary", throwable: "throwable",
  };
  var CATEGORY_ORDER = ["primary", "secondary", "throwable", "support", "backpack", "vehicle", "eagle", "orbital", "sentry", "defensive"];
  function categoryLabel(c) { return WEAPON_CAT_LABELS[c] || TYPE_LABELS[c] || c; }
  function selectorLabel(id) {
    var m = /^(tag|cat):(.+)$/.exec(id);
    if (!m) return id;
    if (m[1] === "tag") return TAG_NAMES[m[2]] || m[2];
    return categoryLabel(m[2]);
  }
  function condText(c) {
    return selectorLabel(c.sel) + " " + reqText(c) + (c.scope && c.scope !== "all" ? " (" + SCOPE_LABELS[c.scope] + ")" : "");
  }
  function describeRule(r) {
    var must = condText(r.must);
    if (!r.when || !r.when.length) return must;
    return "If " + r.when.map(condText).join(" and ") + ", then " + must;
  }

  // -- Odds rules --
  var DEFAULT_WEIGHTS = Engine.RULES.filter(function (r) { return r.weight; });
  function weightKey(w) { return w.sel + "|" + w.scope; }
  function defaultWeightFor(w) { return DEFAULT_WEIGHTS.filter(function (r) { return weightKey(r.weight) === weightKey(w); })[0] || null; }
  function factorText(f) { return "\u00D7" + String(Math.round(f * 100) / 100); }
  function describeWeight(w) {
    return selectorLabel(w.sel) + " " + factorText(w.factor) + " odds" + (w.scope !== "all" ? " (" + SCOPE_LABELS[w.scope] + ")" : "");
  }

  // The rows shown, in order: default rows (RULES order), the player's plain tag rules, the player's generic rules, the player's odds rules.
  function ruleRows() {
    var rows = [];
    // Default rows run from the highest priority tier to the lowest (Core, then Preferred).
    var byTier = Engine.RULES.map(function (r, i) { return { r: r, i: i, t: Engine.RULE_TIER.hasOwnProperty(r.id) ? Engine.RULE_TIER[r.id] : 9 }; })
      .sort(function (x, y) { return x.t - y.t || x.i - y.i; }).map(function (x) { return x.r; });
    byTier.forEach(function (r) {
      if (r.preset) {
        var tag = r.preset.tag;
        if (state.requirements[tag]) rows.push({ kind: "plain", tag: tag, req: state.requirements[tag], preset: r, pristine: false });
        else if (!state.disabledRules[r.id]) rows.push({ kind: "plain", tag: tag, req: presetDefault(r), preset: r, pristine: true });
      } else if (r.weight) {
        var mine = state.weights.filter(function (w) { return weightKey(w) === weightKey(r.weight); })[0];
        if (mine) rows.push({ kind: "weight", w: mine, overrides: r, pristine: false });
        else if (!state.disabledRules[r.id]) rows.push({ kind: "default", rule: r, text: r.label, detail: describeWeight(r.weight), pristine: true });
      } else if (r.calibrate) {
        if (!state.disabledRules[r.id]) rows.push({ kind: "default", rule: r, text: r.label, detail: r.note, pristine: true });
      } else if (!state.disabledRules[r.id]) {
        rows.push({ kind: "default", rule: r, text: r.label, detail: describeRule(r.rules[0]), pristine: true });
      }
    });
    Object.keys(state.requirements).forEach(function (tag) {
      if (!presetForTag(tag)) rows.push({ kind: "plain", tag: tag, req: state.requirements[tag], preset: null, pristine: false });
    });
    state.customRules.forEach(function (rule, i) { rows.push({ kind: "custom", rule: rule, index: i, text: describeRule(rule), pristine: false }); });
    state.weights.forEach(function (w) { if (!defaultWeightFor(w)) rows.push({ kind: "weight", w: w, overrides: null, pristine: false }); });
    return rows;
  }
  // Rules handed to the engine as switched off: the removed defaults, plus every preset replaced by an edited row.
  function disabledList() {
    var ids = Object.keys(state.disabledRules);
    PRESETS.forEach(function (p) {
      if (state.requirements[p.preset.tag] && ids.indexOf(p.id) === -1) ids.push(p.id);
    });
    return ids;
  }
  function defaultsChanged() {
    return Object.keys(state.disabledRules).length > 0 || PRESETS.some(function (p) { return state.requirements[p.preset.tag]; }) ||
      state.weights.some(defaultWeightFor);
  }
  function customWeights() { return state.weights.filter(function (w) { return !defaultWeightFor(w); }); }
  // Rules the player added themselves: plain rules for tags that have no default row, and generic rules.
  function customTags() {
    return Object.keys(state.requirements).filter(function (tag) { return !presetForTag(tag); });
  }
  function hasCustom() { return customTags().length > 0 || state.customRules.length > 0 || customWeights().length > 0; }
  function renderRulesSummary() {
    var added = state.customRules.length + customWeights().length, edited = state.weights.filter(defaultWeightFor).length, off = 0;
    Object.keys(state.requirements).forEach(function (tag) { if (presetForTag(tag)) edited++; else added++; });
    Object.keys(state.disabledRules).forEach(function (id) {
      var p = PRESET_IDS[id] ? Engine.RULES.filter(function (r) { return r.id === id; })[0] : null;
      if (!p || !state.requirements[p.preset.tag]) off++;   // a preset replaced by an edited row is counted as edited, not off
    });
    var parts = [];
    if (added) parts.push(added + " added");
    if (edited) parts.push(edited + " edited");
    if (off) parts.push(off + " off");
    $("rules-summary").textContent = parts.length ? "(" + parts.join(", ") + ")" : "";
  }
  function tierNote(id) {
    if (DEFAULT_WEIGHTS.some(function (r) { return r.id === id; }) || id === "evenOdds") return "odds";
    var t = Engine.RULE_TIER[id];
    return t !== undefined ? TIER_TITLES[t].toLowerCase() : "limit";
  }
  function renderRequireChips() {
    var box = $("require-chips");
    box.textContent = "";
    ruleRows().forEach(function (row) {
      var text, title, remove;
      if (row.kind === "plain") {
        var name = TAG_NAMES[row.tag] || row.tag;
        text = name + " " + reqText(row.req);
        title = row.pristine ? "Default rule (" + tierNote(row.preset.id) + "): " + reqWords(row.req) + " " + name : reqWords(row.req) + " " + name;
        remove = function () {
          delete state.requirements[row.tag];
          if (row.preset) state.disabledRules[row.preset.id] = true;   // a removed default stays removed until reset
        };
      } else if (row.kind === "default") {
        text = row.text;
        title = "Default rule (" + tierNote(row.rule.id) + "): " + row.detail;
        remove = function () { state.disabledRules[row.rule.id] = true; };
      } else if (row.kind === "weight") {
        text = describeWeight(row.w);
        title = row.overrides ? "Your odds rule (replaces the default: " + row.overrides.label + ")" : "Your odds rule: " + text + ". 1 = normal, below 1 = rarer, above 1 = more often.";
        remove = function () {
          state.weights = state.weights.filter(function (w) { return w !== row.w; });
          if (row.overrides) state.disabledRules[row.overrides.id] = true;   // a removed default stays removed until reset
        };
      } else {
        text = row.text;
        title = "Your rule: " + row.text;
        remove = function () { state.customRules.splice(row.index, 1); };
      }
      box.appendChild(h("span", { class: "chip" + (row.pristine ? " preset" : ""), "data-tag": row.tag || null, "data-rule": row.rule && row.rule.id || null, title: title }, text,
        h("button", { type: "button", "aria-label": "Remove rule: " + text, onclick: function () { remove(); onRulesChanged(); } }, "×")));
    });
    // The even-odds default is not a pass / fail rule, so say in plain words what it does (or that it is off).
    $("odds-note").textContent = state.disabledRules.evenOdds
      ? "Even odds is off: items that cover several needs (chaff + base breaker, say) come up more often than similar single-purpose items."
      : "Even odds: items that cover several needs (chaff + base breaker, say) are rolled a bit less, and single-purpose items a bit more, so similar items come up about equally often.";
    $("presets-reset").hidden = !defaultsChanged();
    $("custom-clear").hidden = !hasCustom();
    renderRulesSummary();
  }
  function clearCustom() {
    customTags().forEach(function (tag) { delete state.requirements[tag]; });
    state.customRules = [];
    state.weights = state.weights.filter(defaultWeightFor);
    onRulesChanged();
  }
  function resetPresets() {
    state.disabledRules = {};
    PRESETS.forEach(function (p) { delete state.requirements[p.preset.tag]; });
    state.weights = customWeights();
    onRulesChanged();
  }
  // A plain "how many of this tag, in the whole loadout" rule. It builds on the row already shown for that tag (see below).
  function addRequirement(tag, op, n) {
    if (!tag) return;
    if (!(n >= 0 && n <= 7) || (op === "min" && n < 1)) {
      showMessages([op === "min" ? "‘At least’ needs a whole number from 1 to 7." : "The count must be a whole number from 0 to 7."]);
      return;
    }
    // A new rule builds on the row already shown for that tag (the player's own rule, or the default row if it is still there).
    var p = presetForTag(tag);
    var dflt = p ? presetDefault(p) : {};
    var cur = Object.assign({}, state.requirements[tag] || (p && !state.disabledRules[p.id] ? dflt : {}));
    if (op === "min") cur.min = n;
    else if (op === "max") cur.max = n;
    else { cur.min = n; cur.max = n; }
    if (cur.min !== undefined && cur.max !== undefined && cur.min > cur.max) {
      // If the clash is with a number that is still the DEFAULT's (Eagle "at least 3" against the default "at most 2"),
      // the player's rule wins and that side is dropped. A clash with the player's own earlier rule is refused.
      if (op === "min" && dflt.max !== undefined && (state.requirements[tag] ? state.requirements[tag].max : dflt.max) === dflt.max) delete cur.max;
      else if (op === "max" && dflt.min !== undefined && (state.requirements[tag] ? state.requirements[tag].min : dflt.min) === dflt.min) delete cur.min;
      else {
        showMessages(["‘At least " + cur.min + "’ and ‘at most " + cur.max + "’ can't both hold for " + (TAG_NAMES[tag] || tag) + ". Remove the existing rule first."]);
        return;
      }
    }
    showMessages([]);
    if (p && sameReq(cur, dflt)) { delete state.requirements[tag]; delete state.disabledRules[p.id]; }   // back to the default row
    else state.requirements[tag] = cur;
    onRulesChanged();
  }


  // ---- Rule builder: categories, slots, if / then ----
  // Builds Engine generic rules (see engine.js, "Generic rules") from drop-downs. Every rule goes through
  // Engine.normalizeRule, the same check the saved settings pass on load.
  var SCOPE_ORDER = ["all", "ps", "weapons", "strats", "primary", "secondary", "throwable"];
  // The titled tags that some item carries, in the sections hd2tags.csv puts them in (sections and the tags inside them in the file's order).
  function groupedTags() {
    var present = {};
    titledTags().forEach(function (t) { present[t] = true; });
    return TAG_GROUPS.map(function (g) {
      return { name: g.name, tags: g.tags.filter(function (t) { return present[t]; }) };
    }).filter(function (g) { return g.tags.length; });
  }
  function titledTags() {
    var tags = {};
    DATA.items.forEach(function (i) { i.tags.forEach(function (t) { tags[t] = true; }); });
    return Object.keys(tags).filter(function (t) { return TAG_NAMES[t]; }).sort(function (a, b) { return TAG_NAMES[a].localeCompare(TAG_NAMES[b]); });
  }
  function selectorSelect() {
    var sel = h("select", { class: "b-sel", "aria-label": "What to count" });
    groupedTags().forEach(function (g) {
      var og = h("optgroup", { label: g.name });
      g.tags.forEach(function (t) { og.appendChild(h("option", { value: "tag:" + t }, TAG_NAMES[t])); });
      sel.appendChild(og);
    });
    var g2 = h("optgroup", { label: "Categories" });
    CATEGORY_ORDER.forEach(function (c) { g2.appendChild(h("option", { value: "cat:" + c }, categoryLabel(c))); });
    sel.appendChild(g2);
    return sel;
  }
  // The line under a rule-builder dropdown: what the picked tag / category is, how many items have it, and a few examples
  // (hover for all of them, or tap it to swap the line for the full list). Retired items (faction "none") are left out.
  var CATEGORY_DESC = {
    primary: "Primary weapons", secondary: "Secondary weapons (pistols and melee)", throwable: "Grenades and other throwables",
    support: "Support weapons", backpack: "Backpacks and Guard Dog Rovers", vehicle: "Vehicles, FRVs, tanks and exosuits",
    eagle: "Eagle air strikes", orbital: "Orbital strikes", sentry: "Sentries", defensive: "Mines, emplacements and the shield relay",
  };
  function itemsFor(selId) {
    var m = /^(tag|cat):(.+)$/.exec(selId);
    if (!m) return [];
    return DATA.items.filter(function (i) {
      return i.factions.indexOf("none") === -1 && (m[1] === "tag" ? i.tags.indexOf(m[2]) !== -1 : i.cat === m[2]);
    });
  }
  function hintFor(selId) {
    var m = /^(tag|cat):(.+)$/.exec(selId);
    var items = itemsFor(selId);
    var text = m ? (m[1] === "tag" ? TAG_DESC[m[2]] : CATEGORY_DESC[m[2]]) || "" : "";
    var names = items.map(function (i) { return i.name; });
    var eg = names.slice(0, 3).join(", ") + (names.length > 3 ? "\u2026" : "");
    var short = (text ? text + " \u2014 " : "") + names.length + " item" + (names.length === 1 ? "" : "s") + (names.length ? " (e.g. " + eg + ")" : "");
    var full = names.join(", ");
    // One small line. Hover it to see every item in a tooltip; tap or click it to swap the line for the full list (and back).
    var el = h("div", { class: "b-hint", title: full, tabindex: "0" }, short);
    function toggle() { var open = el.classList.toggle("open"); el.textContent = open ? (text ? text + ": " : "") + full : short; }
    if (names.length > 3) {
      el.addEventListener("click", toggle);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    } else el.removeAttribute("tabindex");
    return el;
  }
  // One "count of X, in Y, at least / at most / exactly N" row. read() gives the condition, or null if the number is not allowed.
  function condRow(role, prefix, onRemove) {
    var sel = selectorSelect();
    var scope = h("select", { class: "b-scope", "aria-label": "Where to count" });
    SCOPE_ORDER.forEach(function (k) { scope.appendChild(h("option", { value: k }, k === "all" ? "in the whole loadout" : "in " + SCOPE_LABELS[k])); });
    var op = h("select", { class: "b-op", "aria-label": "Rule type" },
      h("option", { value: "min" }, "at least"), h("option", { value: "max" }, "at most"), h("option", { value: "eq" }, "exactly"));
    var n = h("input", { type: "number", class: "b-n", min: "0", max: String(MAX_RULE_COUNT), value: "1", "aria-label": "Count" });
    var label = h("span", { class: "b-prefix" }, prefix);
    var kids = [label, sel, scope, op, n];
    if (onRemove) kids.push(h("button", { type: "button", class: "chip-x", "aria-label": "Remove this condition", onclick: onRemove }, "×"));
    var hint = h("div", { class: "b-hint-slot" }, hintFor(sel.value));
    kids.push(hint);
    sel.addEventListener("change", function () { hint.textContent = ""; hint.appendChild(hintFor(sel.value)); });
    var el = h("div", { class: "b-row", "data-role": role }, kids);
    el.setPrefix = function (t) { label.textContent = t; };
    el.read = function () {
      var v = parseInt(n.value, 10);
      if (!(v >= 0 && v <= MAX_RULE_COUNT) || (op.value === "min" && v < 1)) return null;
      var c = { sel: sel.value, scope: scope.value };
      if (op.value === "min" || op.value === "eq") c.min = v;
      if (op.value === "max" || op.value === "eq") c.max = v;
      return c;
    };
    return el;
  }
  function initRuleBuilder() {
    var box = $("builder-body");
    box.textContent = "";
    var whenRows = [];
    var whenBox = h("div", { id: "b-when" });
    var mustRow = condRow("must", "Require");
    function relabel() {
      whenRows.forEach(function (r, i) { r.setPrefix(i === 0 ? "If" : "and"); });
      mustRow.setPrefix(whenRows.length ? "then" : "Require");
      $("b-add-if").hidden = whenRows.length >= 2;
    }
    function addIf() {
      if (whenRows.length >= 2) return;
      var row = condRow("when", "If", function () { whenRows.splice(whenRows.indexOf(row), 1); row.remove(); relabel(); });
      whenRows.push(row); whenBox.appendChild(row); relabel();
    }
    box.appendChild(h("p", { class: "hint" }, "A count of what the selector picks, in the part of the loadout you choose. Add an ‘if’ and the rule only applies when that condition holds (for example: if Eagle at least 2, then Orbital at most 0). A plain count of one tag in the whole loadout (say Anti-Tank at most 2) changes that tag’s row: it merges into a range like 1–2, replaces a default number, and “at most 0” bans the tag. Locks always win: a locked item is never swapped out, and a rule it breaks is reported above the loadout."));
    box.appendChild(whenBox);
    box.appendChild(mustRow);
    box.appendChild(h("div", { class: "btn-row" },
      h("button", { type: "button", class: "ctrl-btn", id: "b-add-if", onclick: addIf }, "+ Add an ‘if’ condition"),
      h("button", { type: "button", class: "ctrl-btn", id: "b-add", onclick: function () {
        var when = whenRows.map(function (r) { return r.read(); }), must = mustRow.read();
        if (!must || when.some(function (c) { return !c; })) { showMessages(["Check the numbers: ‘at least’ needs 1 to " + MAX_RULE_COUNT + ", the others 0 to " + MAX_RULE_COUNT + "."]); return; }
        if (!when.length && must.scope === "all" && must.sel.indexOf("tag:") === 0) {
          // A plain tag count over the whole loadout is the same as editing that tag's row: it merges ranges, replaces a default number and lifts a default cap.
          addRequirement(must.sel.slice(4), must.min !== undefined && must.max !== undefined ? "eq" : must.min !== undefined ? "min" : "max", must.min !== undefined ? must.min : must.max);
          return;
        }
        addCustomRule(when.length ? { when: when, must: must } : { must: must });
        whenRows.slice().forEach(function (r) { r.remove(); }); whenRows.length = 0; relabel();
      } }, "Add rule")));
    // odds
    box.appendChild(h("h4", { class: "rules-subtitle" }, "Odds"));
    box.appendChild(h("p", { class: "hint" }, "Make a kind of item more or less likely to be rolled, without requiring or banning it. 1 is normal, 0.5 is half as likely, 2 is twice as likely. Only the random rolls are affected: locks and the rules above still win."));
    var oddsSel = selectorSelect();
    var oddsScope = h("select", { class: "b-scope", "aria-label": "Where it is rolled" });
    SCOPE_ORDER.forEach(function (k) { oddsScope.appendChild(h("option", { value: k }, k === "all" ? "in every slot" : "in " + SCOPE_LABELS[k])); });
    var oddsN = h("input", { type: "number", class: "b-n", min: "0.05", max: "20", step: "0.05", value: "0.5", "aria-label": "Odds multiplier" });
    box.appendChild(h("div", { class: "b-row", "data-role": "odds" }, oddsSel, oddsScope, h("span", { class: "b-prefix" }, "odds \u00D7"), oddsN,
      h("button", { type: "button", class: "ctrl-btn", id: "odds-add", onclick: function () {
        addWeight({ sel: oddsSel.value, scope: oddsScope.value, factor: parseFloat(oddsN.value) });
      } }, "Add odds rule")));
    relabel();
  }
  // An odds rule. One per selector + scope: a new one replaces the old; one that matches a default odds rule edits it, and
  // giving it the default's own number puts the default row back.
  function addWeight(raw) {
    var w = Engine.normalizeWeight(raw);
    if (!w) { showMessages(["That odds rule can't be built. The multiplier must be from 0.05 to 20."]); return; }
    var dflt = defaultWeightFor(w);
    var others = state.weights.filter(function (x) { return weightKey(x) !== weightKey(w); });
    if (others.length >= MAX_WEIGHT_RULES) { showMessages(["That's the most odds rules there is room for (" + MAX_WEIGHT_RULES + ")."]); return; }
    showMessages([]);
    if (dflt && Math.abs(dflt.weight.factor - w.factor) < 0.005) { state.weights = others; delete state.disabledRules[dflt.id]; }   // back to the default row
    else { state.weights = others.concat([w]); if (dflt) delete state.disabledRules[dflt.id]; }
    onRulesChanged();
  }
  function addCustomRule(raw) {
    var rule = Engine.normalizeRule(raw);
    if (!rule) { showMessages(["That rule can't be built. Check the numbers."]); return; }
    if (state.customRules.some(function (r) { return JSON.stringify(r) === JSON.stringify(rule); })) { showMessages(["You already have that rule."]); return; }
    if (state.customRules.length >= MAX_CUSTOM_RULES) { showMessages(["That's the most custom rules there is room for (" + MAX_CUSTOM_RULES + ")."]); return; }
    showMessages([]);
    state.customRules.push(rule);
    onRulesChanged();
  }

  var TIER_TITLES = { 0: "Overwrite", 1: "Core", 2: "Preferred" };
  // Called after any change to the rules: redraws the rows and the summary and saves the settings.
  function onRulesChanged() {
    renderRequireChips();
    saveSettings();
  }

  // ---- Persistence (faction) ----
  function settingsObject() {
    return { faction: selectedFaction(), disabledRules: Object.keys(state.disabledRules), requirements: state.requirements, customRules: state.customRules, weights: state.weights };
  }
  function saveSettings() {
    store.set(SETTINGS_KEY, settingsObject());
    applyFactionTheme(); updatePoolLine();
  }
  function applyFactionTheme() { document.documentElement.setAttribute("data-faction", selectedFaction()); }
  function loadSettings() {
    var s = store.get(SETTINGS_KEY, null);
    if (!s || typeof s !== "object") return;
    if (s.faction && FACTION_NAMES[s.faction]) {
      var radio = document.querySelector('input[name="faction"][value="' + s.faction + '"]');
      if (radio) radio.checked = true;
    }
    if (Array.isArray(s.disabledRules)) {
      s.disabledRules.forEach(function (id) {
        if (DEFAULT_IDS[id]) state.disabledRules[id] = true;
        if (id === "capSupport") ["capRegular", "capExpend", "capMixed"].forEach(function (x) { state.disabledRules[x] = true; });   // the old single switch
      });
    }
    state.customRules = Engine.normalizeRules(s.customRules).slice(0, MAX_CUSTOM_RULES);
    state.weights = Engine.normalizeWeights(s.weights).slice(0, MAX_WEIGHT_RULES);
    // The player's own rules (and edited default rows). Anything that doesn't look right is skipped, not trusted.
    if (s.requirements && typeof s.requirements === "object") {
      var tagsInData = {};
      DATA.items.forEach(function (i) { i.tags.forEach(function (t) { tagsInData[t] = true; }); });
      var okNum = function (v) { return typeof v === "number" && v >= 0 && v <= MAX_RULE_COUNT && Math.floor(v) === v; };
      Object.keys(s.requirements).forEach(function (tag) {
        var v = s.requirements[tag], r = {};
        if (!tagsInData[tag] || !v || typeof v !== "object") return;
        if (okNum(v.min) && (v.min >= 1 || v.max === 0)) r.min = v.min;   // "at least 0" can only come from "exactly 0"
        if (okNum(v.max)) r.max = v.max;
        if (r.min === undefined && r.max === undefined) return;
        if (r.min !== undefined && r.max !== undefined && r.min > r.max) return;
        state.requirements[tag] = r;
      });
    }
  }
  function selectedFaction() {
    var r = document.querySelector('input[name="faction"]:checked');
    return r ? r.value : "any";
  }

  function resetAll() {
    document.querySelector('input[name="faction"][value="any"]').checked = true;
    $("count").value = 1;
    LOCK_SLOTS.forEach(function (s) { $("lock-" + s.key).value = ""; });
    state.requirements = {};
    state.disabledRules = {};
    state.customRules = [];
    state.weights = [];
    renderRequireChips(); updateLockSummary(); saveSettings();   // My Gear is left alone: it's your data, not an option
    showMessages([]);
    $("results").textContent = "";
  }

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------
  function readLocks(errors) {
    var locks = {};
    LOCK_SLOTS.forEach(function (slot) {
      var text = $("lock-" + slot.key).value.trim();
      if (!text) return;
      var item = engine.resolve(text);
      if (!item) { errors.push(slot.label + ": unknown item ‘" + text + "’. Pick a name from the suggestions."); return; }
      if (item.factions.indexOf("none") !== -1) { errors.push(slot.label + ": ‘" + item.name + "’ is currently disabled."); return; }
      if (slot.cats.indexOf(item.cat) === -1) {
        errors.push(slot.label + ": ‘" + item.name + "’ is a " + (WEAPON_CAT_LABELS[item.cat] || TYPE_LABELS[item.cat] || item.cat).toLowerCase() +
          " and can't go in this slot.");
        return;
      }
      locks[slot.key] = item;
    });
    return locks;
  }

  function onGenerate(evt) {
    if (evt) evt.preventDefault();
    var errors = [];
    var faction = selectedFaction();

    var count = parseInt($("count").value, 10);
    if (!(count >= 1 && count <= MAX_COUNT)) errors.push("Loadouts must be a whole number from 1 to " + MAX_COUNT + ".");

    var st = poolStats();
    if (!st.pool) errors.push("Your gear pool is empty. Tick some items in My Gear first.");

    var locks = readLocks(errors);

    // The same stratagem can't sit in two slots (the game won't allow it). Locks override the
    // rules, but not this one.
    var seen = {}, dupes = {};
    ["strat1", "strat2", "strat3", "strat4"].forEach(function (k) {
      if (!locks[k]) return;
      if (seen[locks[k].name]) dupes[locks[k].name] = true;
      seen[locks[k].name] = true;
    });
    Object.keys(dupes).forEach(function (n) { errors.push("‘" + n + "’ can't be locked into more than one stratagem slot."); });

    // The game allows one FRV, one tank and one exosuit per loadout. Unlike the item caps, this is a hard
    // in-game limit, so locking two of the same kind is an error rather than something to override.
    [["frv", "FRV"], ["tank", "tank"], ["mech", "exosuit"]].forEach(function (kind) {
      var locked = ["strat1", "strat2", "strat3", "strat4"].filter(function (k) {
        return locks[k] && locks[k].tags.indexOf(kind[0]) !== -1;
      });
      if (locked.length > 1) errors.push("You can only bring one " + kind[1] + " in the game, but " + locked.length + " are locked.");
    });

    var excluded = excludedNames();
    Object.keys(locks).forEach(function (k) {
      if (excluded.has(locks[k].name)) {
        errors.push("‘" + locks[k].name + "’ isn't in your gear pool (" +
          (isOwned(locks[k]) ? "blocked" : "not owned") + "). Change it in My Gear, or lock something else.");
      }
    });

    if (errors.length) { showMessages(errors); return; }

    var loadouts = [], problems = [];
    for (var i = 0; i < count; i++) {
      try {
        loadouts.push(engine.generateLoadoutRelaxed({
          faction: faction, locks: locks,
          requirements: state.requirements, excluded: excluded, disabledRules: disabledList(), customRules: state.customRules, weights: state.weights,
        }));
      } catch (e) {
        if (!(e instanceof Engine.GenerationError)) throw e;
        problems.push(e.message);
        break;
      }
    }
    showMessages(problems);
    if (loadouts.length) {
      renderLoadouts(loadouts, faction, locks, state.requirements, disabledList(), state.customRules, state.weights);
      $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      $("results").textContent = "";
    }
  }

  // ---------------------------------------------------------------------------
  // My Gear tab
  // ---------------------------------------------------------------------------
  // Warbonds that are shown together under one collapsible header. The members keep their full names in the data
  // (so the Requisition pill, search and everything else are unchanged); only the My Gear titles drop the prefix.
  var WARBOND_GROUPS = [
    { name: "Requisition", iconKey: "req_p", keys: ["req_p", "req_o", "req_h", "req_b", "req_e", "req_r"], strip: /^Requisition:\s*/ },
  ];

  var facBulkRefreshers = [];   // one per header: redraws its three faction ticks
  function bulkFaction(items, f, on) {
    var k = FAC_KEYS.indexOf(f);
    shownOnly(items).forEach(function (i) { var flags = facFlags(i.factions); flags[k] = on; setItemFactions(i, flags); });
    onFactionEdit();
  }

  // A warbond's (or group's) header: title, bulk buttons, and the "pool / total" count. Clicking it opens or closes `body`.
  function makeHeader(o) {
    var items = o.items, tools = [];
    function toolBtn(label, attr, title, fn) {
      var attrs = { type: "button", class: "ctrl-btn", title: title };
      attrs[attr] = o.key;
      var btn = h("button", attrs, label);
      btn.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
      return btn;
    }
    if (o.fixedOwned) {
      tools.push(h("span", { class: "wb-fixed" }, "always owned"));
    } else {
      tools.push(
        toolBtn("Own All", "data-all", "Own every item in this " + o.noun, function () { setOwned(items, true); }),
        toolBtn("Own None", "data-none", "Own nothing in this " + o.noun, function () { setOwned(items, false); }));
    }
    tools.push(
      toolBtn("Block All", "data-block-all", "Block every item in this " + o.noun, function () { setBlocked(items, true); }),
      toolBtn("Block None", "data-block-none", "Unblock every item in this " + o.noun, function () { setBlocked(items, false); }));
    // Edit-factions ticks for the whole warbond (only visible while "Edit factions" is on): ticked = every item shown has that
    // faction, dash = some do. Clicking sets it for every item shown (the search filter applies, like the other bulk buttons).
    var bulkBoxes = FAC_KEYS.map(function (f) {
      var fb = h("input", { type: "checkbox", "data-fac-bulk": o.key + ":" + f, "aria-label": FACTION_ADJECTIVE[f] + ": every item shown in this " + o.noun });
      fb.addEventListener("click", function (e) { e.stopPropagation(); });
      fb.addEventListener("change", function () { bulkFaction(items, f, fb.checked); });
      return fb;
    });
    var bulkSet = h("span", { class: "fac-set fac-bulk", title: "Edit factions for every item shown in this " + o.noun },
      FAC_KEYS.map(function (f, k) {
        var lab = h("label", { class: "fac-chk fac-" + f, title: FACTION_ADJECTIVE[f] + " for every item shown in this " + o.noun }, bulkBoxes[k], facIcon(f, FAC_LETTER[f]));
        lab.addEventListener("click", function (e) { e.stopPropagation(); });
        return lab;
      }));
    facBulkRefreshers.push(function () {
      var shown = shownOnly(items);
      FAC_KEYS.forEach(function (f, k) {
        var n = shown.filter(function (i) { return facFlags(i.factions)[k]; }).length;
        bulkBoxes[k].disabled = shown.length === 0;
        bulkBoxes[k].checked = shown.length > 0 && n === shown.length;
        bulkBoxes[k].indeterminate = n > 0 && n < shown.length;
      });
    });
    var header = h("div", { class: "wb-header" },
      h("span", { class: "wb-name" }, o.icon, o.label),
      h("span", { class: "wb-tools" }, tools),
      bulkSet,
      // "pool / total", or "blocked / pool / total" once something owned is blocked
      h("span", { class: "wb-count", "data-total": String(items.length) },
        h("span", { class: "blocked-part", hidden: true }, h("span", { class: "blocked-count" }, "0"), " / "),
        h("span", { class: "pool-count" }, "0"), " / " + items.length));
    header.addEventListener("click", function () { o.body.classList.toggle("open"); });
    return header;
  }

  function makeBlock(w, label, withIcon) {
    // Items with a menu_order come first, in that order (the game's own menu order); the rest keep file order.
    var items = ALL_ITEMS.filter(function (i) { return i.warbond === w.key; })
      .map(function (i, k) { return { i: i, k: k }; })
      .sort(function (x, y) {
        var a = x.i.menuOrder == null ? 1e9 : x.i.menuOrder, b = y.i.menuOrder == null ? 1e9 : y.i.menuOrder;
        return a - b || x.k - y.k;
      }).map(function (x) { return x.i; });
    var base = w.key === "base";
    var rows = items.map(function (item) {
      var cb = h("input", { type: "checkbox", "data-item": item.name, "aria-label": "I own " + item.name });
      if (base || item.alwaysOwned) { cb.disabled = true; cb.title = "Base Game gear is always owned"; }
      cb.addEventListener("change", function () {
        if (cb.checked) owned[item.name] = true; else delete owned[item.name];
        onGearChange();
      });
      var nv = h("button", { type: "button", class: "block-btn", "data-block": item.name, "aria-pressed": "false",
        title: "Block: never roll this item" }, "Block");
      nv.addEventListener("click", function () {
        if (blocked[item.name]) delete blocked[item.name]; else blocked[item.name] = true;
        onGearChange();
      });
      // Edit-factions controls (only visible while "Edit factions" is on): T / A / I ticks and a revert button.
      var facBoxes = FAC_KEYS.map(function (f) {
        var fb = h("input", { type: "checkbox", "data-fac": f, "data-fac-item": item.name,
          "aria-label": FACTION_ADJECTIVE[f] + ": " + item.name });
        fb.addEventListener("change", function () {
          setItemFactions(item, facBoxes.map(function (b) { return b.checked; }));
          onFactionEdit();
        });
        return fb;
      });
      var revert = h("button", { type: "button", class: "fac-revert", "data-fac-revert": item.name, hidden: true,
        title: "Back to the default factions", "aria-label": "Reset factions for " + item.name }, "\u21BA");
      revert.addEventListener("click", function () { resetFactions([item]); });
      var facSet = h("span", { class: "fac-set" },
        FAC_KEYS.map(function (f, k) {
          return h("label", { class: "fac-chk fac-" + f, title: FACTION_ADJECTIVE[f] },
            facBoxes[k], facIcon(f, FAC_LETTER[f]));
        }), revert);
      var row = h("div", { class: "gear-row", "data-search": [item.name].concat(item.nicknames || [], [w.name, w.key]).join(" ").toLowerCase() },
        h("label", { class: "gear-main" }, cb, gearThumb(item),
          h("span", { class: "tr-name" }, item.name),
          h("span", { class: "tr-type" }, TYPE_LABELS[item.cat] || WEAPON_CAT_LABELS[item.cat] || item.cat)),
        facSet, nv);
      gearRows[item.name] = row;
      return row;
    });
    var body = h("div", { class: "wb-items" }, rows);
    var header = makeHeader({ key: w.key, label: label, icon: withIcon ? warbondIcon(w.key) : null, items: items, body: body,
      fixedOwned: base, noun: "warbond" });
    return h("div", { class: "wb-block" }, header, body);
  }

  // One header (with its own Own / Block buttons and count) over several warbond blocks.
  function makeGroup(g, members) {
    var items = ALL_ITEMS.filter(function (i) { return g.keys.indexOf(i.warbond) !== -1; });
    var body = h("div", { class: "wb-items wb-group-body" },
      members.map(function (w) { return makeBlock(w, w.name.replace(g.strip, ""), false); }));
    var header = makeHeader({ key: "group_" + g.name.toLowerCase(), label: g.name, icon: warbondIcon(g.iconKey), items: items, body: body,
      fixedOwned: false, noun: g.name + " group" });
    return h("div", { class: "wb-block wb-group" }, header, body);
  }

  function buildGear() {
    var list = $("gear-list");
    list.textContent = "";
    facBulkRefreshers = [];
    var done = {};
    DATA.warbonds.forEach(function (w) {
      if (!ALL_ITEMS.some(function (i) { return i.warbond === w.key; })) return;
      var g = WARBOND_GROUPS.filter(function (x) { return x.keys.indexOf(w.key) !== -1; })[0];
      if (!g) { list.appendChild(makeBlock(w, w.name, true)); return; }
      if (done[g.name]) return; // the group goes where its first member is
      done[g.name] = true;
      var members = DATA.warbonds.filter(function (x) {
        return g.keys.indexOf(x.key) !== -1 && ALL_ITEMS.some(function (i) { return i.warbond === x.key; });
      });
      list.appendChild(makeGroup(g, members));
    });
    refreshGear();
  }

  // While the search box is filtering, every bulk button (per warbond or global) only touches the rows on screen.
  function shownOnly(items) {
    return items.filter(function (i) { var r = gearRows[i.name]; return r && !r.hidden; });
  }
  function gearFiltered() { return $("gear-search").value.trim() !== ""; }
  function setOwned(items, on) {
    shownOnly(items).forEach(function (i) { if (isBase(i)) return; if (on) owned[i.name] = true; else delete owned[i.name]; });
    onGearChange();
  }
  function setBlocked(items, on) {
    shownOnly(items).forEach(function (i) { if (on) blocked[i.name] = true; else delete blocked[i.name]; });
    onGearChange();
  }
  function onGearChange() { saveGear(); refreshGear(); }

  // The "Blocked items" list at the bottom of My Gear: every blocked item in one place, with an Unblock button. Hidden when empty.
  function updateBlockedSection() {
    var items = ALL_ITEMS.filter(function (i) { return blocked[i.name]; });
    var sec = $("blocked-section");
    sec.hidden = items.length === 0;
    $("blocked-count").textContent = items.length ? "(" + items.length + ")" : "";
    var list = $("blocked-list");
    list.textContent = "";
    items.forEach(function (item) {
      var btn = h("button", { type: "button", class: "block-btn unblock-btn", "data-unblock": item.name, "aria-pressed": "true",
        title: "Unblock: allow this item to roll again" }, "Unblock");
      btn.addEventListener("click", function () { delete blocked[item.name]; onGearChange(); });
      list.appendChild(h("div", { class: "blocked-row" },
        gearThumb(item),
        h("span", { class: "tr-name" }, item.name),
        h("span", { class: "tr-type" }, warbondName[item.warbond] || item.warbond),
        btn));
    });
  }

  // Make the checkboxes, block buttons, counts and the randomizer's pool line match the model.
  function refreshGear() {
    facBulkRefreshers.forEach(function (fn) { fn(); });
    var byName = {};
    ALL_ITEMS.forEach(function (i) { byName[i.name] = i; });
    document.querySelectorAll("#gear-list .gear-row").forEach(function (row) {
      var cb = row.querySelector("input[data-item]");
      var item = byName[cb.getAttribute("data-item")];
      cb.checked = isOwned(item);
      var isBlocked = !!blocked[item.name];
      // Red strike-through only for gear you own but have blocked (an unowned item is out of the pool anyway).
      row.classList.toggle("is-blocked", isBlocked && isOwned(item));
      row.querySelector(".block-btn").setAttribute("aria-pressed", isBlocked ? "true" : "false");
      var flags = facFlags(item.factions);
      row.querySelectorAll("input[data-fac]").forEach(function (fb, k) { fb.checked = flags[k]; });
      row.classList.toggle("fac-custom", isCustomised(item));
      row.querySelector(".fac-revert").hidden = !isCustomised(item);
    });
    document.querySelectorAll("#gear-list .wb-block").forEach(function (block) {
      var rows = Array.prototype.slice.call(block.querySelectorAll(".gear-row"));
      var pool = 0, lost = 0;
      rows.forEach(function (row) {
        var item = byName[row.querySelector("input[data-item]").getAttribute("data-item")];
        if (inPool(item)) pool++; else if (isOwned(item) && blocked[item.name]) lost++;
      });
      var count = block.querySelector(".wb-count");
      count.querySelector(".pool-count").textContent = pool;
      count.querySelector(".blocked-count").textContent = lost;
      count.querySelector(".blocked-part").hidden = lost === 0;
      count.title = lost + " blocked · " + pool + " in your pool · " + count.getAttribute("data-total") + " in this warbond";
    });
    var st = poolStats();
    $("grand-total").textContent = st.owned + " / " + st.total + " items owned";
    $("gear-detail").textContent = "Rolling from " + st.pool + (st.blocked ? " (" + st.blocked + " blocked)" : "");
    updateFacTools();
    updateBlockedSection();
    updatePoolLine();
    if (lastRun) lastRun.entries.forEach(redraw);   // the NOT OWNED / BLOCKED markers follow My Gear
  }

  // ---- Edit factions: switch, count and the two bulk buttons ----
  // Both bulk buttons act on the items shown (the search filter applies, like the other bulk buttons) and need a
  // second click within 4 seconds, so a stray click can't overwrite your edits.
  var armed = null;   // { which: "reset" | "all", timer }
  function disarm() { if (armed) { clearTimeout(armed.timer); armed = null; } }
  function allTicked(item) { return facFlags(item.factions).every(Boolean); }
  function resetScope() { return shownOnly(ALL_ITEMS).filter(isCustomised); }
  function allScope() { return shownOnly(ALL_ITEMS).filter(function (i) { return !allTicked(i); }); }
  function updateFacTools() {
    var on = $("edit-factions").checked;
    $("view-gear").classList.toggle("edit-factions", on);
    $("fac-tools").hidden = !on;
    if (!on) { disarm(); return; }
    var total = customisedCount();
    var filtered = gearFiltered();
    $("fac-count").textContent = total ? total + " item" + (total === 1 ? "" : "s") + " edited" : "No edits: everything is on the default factions";
    function label(btn, which, scope, idle, idleShown) {
      btn.disabled = scope === 0;
      if (armed && armed.which === which) { btn.textContent = "Click again to " + (which === "reset" ? "reset " : "enable ") + scope; return; }
      btn.textContent = (filtered ? idleShown : idle) + (scope ? " (" + scope + ")" : "");
    }
    label($("fac-reset"), "reset", resetScope().length, "Reset to defaults", "Reset shown to defaults");
    label($("fac-all"), "all", allScope().length, "Enable for all factions", "Enable shown for all factions");
  }
  function onBulkFactionClick(which) {
    var scope = which === "reset" ? resetScope() : allScope();
    if (!scope.length) return;
    if (!armed || armed.which !== which) {
      disarm();
      armed = { which: which, timer: setTimeout(function () { armed = null; updateFacTools(); }, 4000) };
      updateFacTools();
      return;
    }
    disarm();
    if (which === "reset") { resetFactions(ALL_ITEMS); return; }
    scope.forEach(function (i) { setItemFactions(i, [true, true, true]); });
    onFactionEdit();
  }

  // Search: every word must appear in the item's name, a nickname, or its warbond's name/key
  // ("scope of authority" lists that whole warbond; "eagle hangar" lists the Hangar's Eagles).
  function filterGear() {
    var words = $("gear-search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    document.querySelectorAll("#gear-list .gear-row").forEach(function (row) {
      var hay = row.getAttribute("data-search");
      var match = words.every(function (w) { return hay.indexOf(w) !== -1; });
      row.hidden = !match;
      if (match) shown++;
    });
    // Blocks include the group blocks and the warbond blocks inside them: hide any with no visible row, and open
    // the ones that match while a search is active.
    document.querySelectorAll("#gear-list .wb-block").forEach(function (block) {
      var any = !!block.querySelector(".gear-row:not([hidden])");
      block.hidden = !any;
      if (words.length && any) block.querySelector(".wb-items").classList.add("open");
    });
    var note = $("gear-filter-note");
    note.hidden = !words.length;
    note.textContent = words.length
      ? "Search active: the Own / Block buttons only apply to the " + shown + " item" + (shown === 1 ? "" : "s") + " shown."
      : "";
  }

  // ---- Export / import of your data ----
  // One small JSON file with everything saved in this browser: owned and blocked items, faction edits (all by permanent item id) and
  // the randomizer settings (faction, rules, odds rules). Importing replaces what is saved here; anything in the file that
  // doesn't make sense (an unknown id, a rule that can't be built) is skipped by the same loaders the page uses on every visit.
  var EXPORT_APP = "hd2-slopinator", EXPORT_VERSION = 1, MAX_IMPORT_BYTES = 2000000;
  function dataMessage(text, bad) {
    var el = $("data-msg");
    el.textContent = text;
    el.classList.toggle("bad", !!bad);
  }
  function exportJson() {
    return JSON.stringify({
      app: EXPORT_APP, version: EXPORT_VERSION, exported: new Date().toISOString(),
      owned: byId(owned), blocked: Object.keys(byId(blocked)), factions: byId(facOverrides), settings: settingsObject(),
    }, null, 1);
  }
  function exportData() {
    var url;
    try {
      url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
      var a = h("a", { href: url, download: "hd2-slopinator-" + new Date().toISOString().slice(0, 10) + ".json" });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 2000);
      dataMessage("Exported. Import the file on another browser or device to bring your gear, faction edits and rules with you.");
    } catch (e) {
      dataMessage("Couldn't create the file in this browser.", true);
    }
  }
  function plainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function reloadSaved() {
    state.requirements = {}; state.disabledRules = {}; state.customRules = []; state.weights = [];
    loadSettings(); applyFactionTheme();
    loadGear(); loadFactions();
    renderRequireChips(); updateLockSummary(); buildGear(); filterGear(); updateFacTools(); updatePoolLine();
  }
  function importData(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { dataMessage("That file isn't valid JSON, so nothing was changed.", true); return; }
    if (!plainObject(d) || d.app !== EXPORT_APP) { dataMessage("That doesn't look like a file exported from this tool, so nothing was changed.", true); return; }
    if (typeof d.version !== "number" || d.version > EXPORT_VERSION) { dataMessage("That file is from a newer version of the tool. Nothing was changed.", true); return; }
    if (!confirm("Replace the gear, faction edits and rules saved in this browser with the ones in the file?")) { dataMessage("Import cancelled."); return; }
    if (plainObject(d.owned)) store.set(TRACKER_KEY, d.owned);
    if (Array.isArray(d.blocked)) store.set(BLOCK_KEY, d.blocked.filter(function (k) { return typeof k === "string" || typeof k === "number"; }).slice(0, 1000));
    if (plainObject(d.factions)) store.set(FACTIONS_KEY, d.factions);
    if (plainObject(d.settings)) store.set(SETTINGS_KEY, d.settings);
    reloadSaved();
    var edits = Object.keys(facOverrides).length;
    dataMessage("Imported: " + Object.keys(owned).length + " owned items, " + Object.keys(blocked).length + " blocked, " + edits + " faction edit" + (edits === 1 ? "" : "s") +
      ", and your rules and faction.");
  }
  function readImportFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { dataMessage("That file is too big to be one of ours, so nothing was changed.", true); return; }
    var reader = new FileReader();
    reader.onload = function () { importData(String(reader.result || "")); };
    reader.onerror = function () { dataMessage("Couldn't read that file.", true); };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Wire everything up
  // ---------------------------------------------------------------------------
  function init() {
    fillDatalist("dl-primary", engine.pools.primaries);
    fillDatalist("dl-secondary", engine.pools.secondaries);
    fillDatalist("dl-throwable", engine.pools.throwables);
    fillDatalist("dl-strat", engine.pools.strategems);

    buildLockGrid();
    loadSettings();
    applyFactionTheme();
    // Faction emblems on the faction buttons and in the Edit factions legend.
    FAC_KEYS.concat(["any"]).forEach(function (f) {
      var radio = document.querySelector('input[name="faction"][value="' + f + '"]');
      if (radio && radio.nextElementSibling) radio.nextElementSibling.insertBefore(facIcon(f), radio.nextElementSibling.firstChild);
    });
    document.querySelectorAll("#fac-tools [data-fac-legend]").forEach(function (el) {
      el.insertBefore(facIcon(el.getAttribute("data-fac-legend"), FAC_LETTER[el.getAttribute("data-fac-legend")]), el.firstChild);
    });
    loadGear();
    loadFactions();
    renderRequireChips();
    updateLockSummary();
    buildGear();

    $("controls").addEventListener("submit", onGenerate);
    window.addEventListener("hashchange", showSharedFromHash);
    showSharedFromHash();
    initRuleBuilder();
    $("presets-reset").addEventListener("click", resetPresets);
    $("custom-clear").addEventListener("click", clearCustom);
    $("reset-all").addEventListener("click", resetAll);
    $("pool-edit").addEventListener("click", function () { showView("gear"); });
    document.querySelectorAll('input[name="faction"]').forEach(function (r) { r.addEventListener("change", saveSettings); });

    $("data-export").addEventListener("click", exportData);
    $("data-import").addEventListener("click", function () { $("data-file").click(); });
    $("data-file").addEventListener("change", function () { readImportFile($("data-file").files[0]); $("data-file").value = ""; });
    $("gear-search").addEventListener("input", function () { filterGear(); updateFacTools(); facBulkRefreshers.forEach(function (fn) { fn(); }); });
    $("edit-factions").addEventListener("change", updateFacTools);
    $("fac-reset").addEventListener("click", function () { onBulkFactionClick("reset"); });
    $("fac-all").addEventListener("click", function () { onBulkFactionClick("all"); });
    $("gear-expand").addEventListener("click", function () {
      document.querySelectorAll("#gear-list .wb-items").forEach(function (el) { el.classList.add("open"); });
    });
    $("gear-collapse").addEventListener("click", function () {
      document.querySelectorAll("#gear-list .wb-items").forEach(function (el) { el.classList.remove("open"); });
    });
    $("gear-select-all").addEventListener("click", function () { setOwned(ALL_ITEMS, true); });
    $("gear-unblock-all").addEventListener("click", function () { setBlocked(ALL_ITEMS, false); });
    $("gear-clear").addEventListener("click", function () {
      if (confirm("Mark " + (gearFiltered() ? "the items shown" : "everything except Base Game gear") + " as not owned?")) setOwned(ALL_ITEMS, false);
    });
  }

  init();
})();
