import * as CFG from "./module/config.mjs";
import { CharacterData, HenchmanData, UnitData } from "./module/data/actor-models.mjs";
import * as IM from "./module/data/item-models.mjs";
import { QinActor } from "./module/documents/actor.mjs";
import { QinItem, QinCombat } from "./module/documents/other.mjs";
import { CharacterSheet, HenchmanSheet, UnitSheet, QinItemSheet } from "./module/sheets/sheets.mjs";
import { onRenderChatMessage } from "./module/chat.mjs";
import { BattlePanel, registerBattleQuery, battleRequest } from "./module/battle/battle.mjs";
import { defaultFormations, emptyBattle, onTokenMoved, getBattle } from "./module/battle/adapter.mjs";
import * as QinRules from "./module/rules/qin-rules.mjs";
import { registerTokenHover } from "./module/token-hover.mjs";
import { registerCombatQuery, onRenderCombatTracker } from "./module/combat-actions.mjs";
import { registerAttackFxSocket, registerDamageFloats } from "./module/attack-fx.mjs";

const { SYSTEM_ID } = CFG;

/** Expose the chosen text size to the stylesheet as a zoom factor. */
function applyTextScale() {
  let pct = 115;
  try { pct = Number(game.settings.get(SYSTEM_ID, "textScale")) || 115; } catch { /* not registered yet */ }
  document.documentElement.style.setProperty("--qin-scale", String(pct / 100));
}

Hooks.once("init", () => {
  console.log("Qin | Initializing Qin: The Warring States");
  CONFIG.QIN = CFG;
  globalThis.qin = game.qin = { config: CFG, rules: QinRules, openBattle: () => BattlePanel.open(), battleRequest };

  CONFIG.Actor.documentClass = QinActor;
  CONFIG.Item.documentClass = QinItem;
  CONFIG.Combat.documentClass = QinCombat;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, henchman: HenchmanData, unit: UnitData });
  Object.assign(CONFIG.Item.dataModels, {
    weapon: IM.WeaponData, armor: IM.ArmorData, tao: IM.TaoData, technique: IM.TechniqueData, magic: IM.MagicData,
    gift: IM.TraitData, weakness: IM.TraitData, gear: IM.GearData, skill: IM.SkillData, officerAbility: IM.OfficerAbilityData, signature: IM.SignatureData,
  });
  CONFIG.Actor.trackableAttributes = {
    character: { bar: [], value: ["chi.value", "bol.damage", "renown"] },
    unit: { bar: ["men"], value: ["morale"] },
    henchman: { bar: [], value: [] },
  };

  const { Actors, Items } = foundry.documents.collections;
  Actors.registerSheet(SYSTEM_ID, CharacterSheet, { types: ["character"], makeDefault: true, label: "Qin character" });
  Actors.registerSheet(SYSTEM_ID, HenchmanSheet, { types: ["henchman"], makeDefault: true, label: "Qin henchman" });
  Actors.registerSheet(SYSTEM_ID, UnitSheet, { types: ["unit"], makeDefault: true, label: "Battlefield unit" });
  Items.registerSheet(SYSTEM_ID, QinItemSheet, { makeDefault: true, label: "Qin item" });

  const { ObjectField, ArrayField } = foundry.data.fields;
  game.settings.register(SYSTEM_ID, "battle", {
    scope: "world", config: false, type: new ObjectField(), default: emptyBattle(),
    onChange: () => {
      BattlePanel.refresh();
      if (getBattle().active && !BattlePanel.instance?.rendered && game.settings.get(SYSTEM_ID, "autoOpenBattle")) BattlePanel.open();
    },
  });
  game.settings.register(SYSTEM_ID, "formations", {
    scope: "world", config: false, type: new ArrayField(new ObjectField()), default: defaultFormations(), onChange: () => BattlePanel.refresh(),
  });
  game.settings.register(SYSTEM_ID, "rerollInitiative", {
    name: "Reroll initiative every round (personal combat)", hint: "Qin rerolls Water + Yin/Yang each round.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(SYSTEM_ID, "rotateFacing", {
    name: "Rotate unit tokens to show facing", hint: "Battle units turn to face their last move or melee target. Turn off if your token art isn't top-down.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(SYSTEM_ID, "manageStealth", {
    name: "Hide stealthy enemy units from players", hint: "Enemy units hidden in grass or trees are hidden from players until spotted.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(SYSTEM_ID, "textScale", {
    name: "Qin text size", hint: "Scales the text on Qin sheets, the battle panel and Qin chat cards. Reopen sheets after changing.",
    scope: "client", config: true, type: Number, default: 115,
    choices: { 100: "Normal (100%)", 115: "Large (115%)", 130: "Larger (130%)", 145: "Largest (145%)" },
    onChange: applyTextScale,
  });
  applyTextScale();
  game.settings.register(SYSTEM_ID, "attackTargeting", {
    name: "Click a hex to attack", hint: "When attacking from a token on the scene, highlight the weapon's reach and click the hex to strike. Right-click or Esc cancels.",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SYSTEM_ID, "attackAnimations", {
    name: "Attack animations", hint: "Automatic uses JB2A animations when the Sequencer and JB2A modules are active, otherwise the built-in effects.",
    scope: "world", config: true, type: String, default: "auto",
    choices: { auto: "Automatic (JB2A if available)", builtin: "Built-in effects only", off: "Off" },
  });
  game.settings.register(SYSTEM_ID, "showMovementTrail", {
    name: "Show token movement trails", hint: "Foundry draws the path a token has travelled when you hover it. Off: the trail is wiped after every move.",
    scope: "world", config: true, type: Boolean, default: false,
  });
  game.settings.register(SYSTEM_ID, "autoOpenBattle", {
    name: "Open the battle panel automatically", scope: "client", config: true, type: Boolean, default: true,
  });

  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  // Option values are strings ("0".."6"), but our data is numbers: compare as strings so the
  // stored level (e.g. 1 = Apprentice) is the one shown as selected.
  const coreSelectOptions = Handlebars.helpers.selectOptions;
  if (coreSelectOptions && !coreSelectOptions.qinWrapped) {
    const wrapped = function (choices, options) {
      const sel = options?.hash?.selected;
      if (typeof sel === "number" || typeof sel === "boolean") options.hash.selected = String(sel);
      else if (Array.isArray(sel)) options.hash.selected = sel.map(v => (typeof v === "number" ? String(v) : v));
      return coreSelectOptions.call(this, choices, options);
    };
    wrapped.qinWrapped = true;
    Handlebars.registerHelper("selectOptions", wrapped);
  }
  Handlebars.registerHelper("qinObj", (options) => options.hash);
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

  registerBattleQuery();
  registerCombatQuery();
});

Hooks.once("ready", () => {
  registerAttackFxSocket();
  if (game.user.isGM && getBattle().active) BattlePanel.open();
  else if (getBattle().active && game.settings.get(SYSTEM_ID, "autoOpenBattle")) BattlePanel.open();
});

Hooks.on("renderChatMessageHTML", onRenderChatMessage);
registerTokenHover();
registerDamageFloats();
Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("updateToken", (doc, change, options) => {
  onTokenMoved(doc, change, options);
  // Wipe the hover movement trail after each move unless the GM wants it
  if (("x" in change || "y" in change) && game.user.isActiveGM && !game.settings.get(SYSTEM_ID, "showMovementTrail") && doc.movementHistory?.length) {
    setTimeout(() => doc.clearMovementHistory?.().catch?.(() => {}), 0);
  }
});
Hooks.on("updateActor", () => BattlePanel.refresh());

Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "qinBattle", title: "Battle panel", icon: "fa-solid fa-chess-rook", order: 99,
    button: true, visible: true, onChange: () => BattlePanel.open(),
  };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push({ ...tool, onClick: tool.onChange });
  else if (controls.tokens?.tools) controls.tokens.tools.qinBattle = tool;
});

/* ---------- Macro bar: drag a weapon (or Tao, technique...) onto the hotbar to get a click-to-use button */
async function rollItemMacro(name, uuid) {
  // Use the selected token's copy of the item if it has one (handy for henchman groups), else the original
  const tok = canvas?.tokens?.controlled?.find(t => t.actor?.items?.getName?.(name));
  let item = tok?.actor.items.getName(name);
  if (!item && uuid) item = await fromUuid(uuid);
  if (!item) return ui.notifications.warn(`No "${name}" on the selected token.`);
  if (!item.isOwner) return ui.notifications.warn(`You don't own ${item.parent?.name ?? "that character"}.`);
  return item.use();
}
Hooks.once("init", () => { game.qin.rollItemMacro = rollItemMacro; });
Hooks.on("hotbarDrop", (bar, data, slot) => {
  if (data?.type !== "Item" || !data.uuid) return;
  const item = fromUuidSync(data.uuid);
  if (!item?.parent || !["weapon", "tao", "technique", "magic", "signature", "gear", "gift", "weakness"].includes(item.type)) return;
  (async () => {
    const command = `game.qin.rollItemMacro(${JSON.stringify(item.name)}, ${JSON.stringify(item.uuid)});`;
    const MacroCls = CONFIG.Macro.documentClass;
    let macro = game.macros.find(m => m.command === command && m.isOwner);
    macro ??= await MacroCls.create({
      name: item.type === "weapon" ? `${item.name} attack` : item.name, type: "script", img: item.img, command,
      flags: { qin: { itemMacro: true } },
    });
    await game.user.assignHotbarMacro(macro, slot);
  })();
  return false;
});

// Renaming an actor renames its tokens too (prototype + placed tokens that still had the old name)
Hooks.on("preUpdateActor", (actor, change, options) => {
  if (!("name" in change) || change.name === actor.name) return;
  options.qinOldName = actor.name;
  if (!actor.isToken && (actor.prototypeToken?.name === actor.name || !actor.prototypeToken?.name)) {
    foundry.utils.setProperty(change, "prototypeToken.name", change.name);
  }
});
Hooks.on("updateActor", async (actor, change, options, userId) => {
  const oldName = options.qinOldName;
  if (!oldName || userId !== game.user.id || !("name" in change)) return;
  const name = actor.name;
  if (actor.isToken) {
    if (actor.token?.name === oldName) await actor.token.update({ name });
    return;
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens.filter(t => t.actorLink && t.actorId === actor.id && t.name === oldName && t.canUserModify(game.user, "update"))
      .map(t => ({ _id: t.id, name }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
});

// New characters start with sensible tokens
Hooks.on("preCreateActor", (actor, data) => {
  if (data.prototypeToken) return;
  const proto = { actorLink: actor.type === "character", displayName: 20, displayBars: 20 };
  if (actor.type === "unit") Object.assign(proto, { bar1: { attribute: "men" }, actorLink: false });
  actor.updateSource({ prototypeToken: proto });
});
