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
import { registerUnitBars, redrawAllUnitBars, registerFacingKey } from "./module/unit-bars.mjs";
import { registerFactions, factionList } from "./module/factions.mjs";
import { refreshBattleUI, repositionBattleUI, lockUnitTokens, onUnitSelected, registerUnitClicks } from "./module/battle/battle-ui.mjs";
import { refreshTactics, registerTactics } from "./module/battle/tactics-ui.mjs";
import { registerDeployZones, drawDeployZones, setDeployChangeHandler } from "./module/battle/deploy.mjs";
import { NEW_UNIT_TOOL, newUnitDialog } from "./module/new-unit.mjs";
import { UNIT_EDITOR_TOOL, UnitEditorApp, registerUnitEditor, reapplyUnitEdits } from "./module/unit-editor.mjs";
import { registerMapRenderer, syncBattleMap, initBattleMapSync, redrawScene, MapEditorApp } from "./module/battle/maprender.mjs";
import { importBattleMap } from "./module/battle/battlemap.mjs";
import { registerUnitInfo, openUnitInfo, openOfficerView, registerDangerZoneKey, toggleDangerZone } from "./module/unit-info.mjs";

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
  CONFIG.qinFactions ??= {};
  globalThis.qin = game.qin = { config: CFG, rules: QinRules, openBattle: () => BattlePanel.open(), battleRequest, registerFactions, factionList, openUnitInfo, openOfficerView, importBattleMap: () => importBattleMap(SYSTEM_ID),
    registerMapRenderer, redrawMap: (scene = canvas.scene) => redrawScene(scene), paintMap: (scene = canvas.scene) => MapEditorApp.open(scene), refreshBattlePanel: () => BattlePanel.refresh(), newUnit: () => newUnitDialog(), unitEditor: () => UnitEditorApp.open() };

  CONFIG.Actor.documentClass = QinActor;
  CONFIG.Item.documentClass = QinItem;
  CONFIG.Combat.documentClass = QinCombat;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, henchman: HenchmanData, unit: UnitData });
  Object.assign(CONFIG.Item.dataModels, {
    weapon: IM.WeaponData, armor: IM.ArmorData, tao: IM.TaoData, technique: IM.TechniqueData, magic: IM.MagicData,
    gift: IM.TraitData, weakness: IM.TraitData, gear: IM.GearData, skill: IM.SkillData, officerAbility: IM.OfficerAbilityData, signature: IM.SignatureData, formation: IM.FormationData,
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
      refreshBattleUI();
      redrawAllUnitBars();
      refreshTactics();
      drawDeployZones();
      syncBattleMap();
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
  registerUnitEditor();
  game.settings.register(SYSTEM_ID, "useFormations", { // on hold since 2026-10-24: too fiddly for players
    name: "Use formations in battles", hint: "When off, units fight without formations: the battle panel doesn't offer them and their modifiers don't apply. Units keep the formations on their sheets.",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => { BattlePanel.refresh(); redrawAllUnitBars(); },
  });
  game.settings.register(SYSTEM_ID, "compactUnits", { // the Battle panel's "Less info" button, per player
    scope: "client", config: false, type: Boolean, default: false,
  });
  game.settings.register(SYSTEM_ID, "rotateFacing", {
    name: "Rotate unit tokens to show facing", hint: "Battle units turn toward the unit they attacked, or the first unit that attacked them that round (unless they had already attacked), and turn back when the round ends. Leave off if your token art isn't top-down.",
    scope: "world", config: true, type: Boolean, default: false,
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
  if (!Handlebars.helpers.inc) Handlebars.registerHelper("inc", (n) => Number(n) + 1);

  // Combat turn hotkeys (change them in Configure Controls)
  const turnKey = (dir) => () => {
    const combat = game.combat;
    if (!combat?.started) return false;
    if (!game.user.isGM && !combat.combatant?.isOwner) { ui.notifications.warn("It isn't your turn."); return true; }
    if (dir > 0) combat.nextTurn();
    else if (game.user.isGM) combat.previousTurn();
    return true;
  };
  game.keybindings.register(SYSTEM_ID, "nextTurn", {
    name: "Next turn (combat)", hint: "End the current turn. Players can use it on their own turn.",
    editable: [{ key: "PageDown" }], onDown: turnKey(1), precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
  });
  game.keybindings.register(SYSTEM_ID, "previousTurn", {
    name: "Previous turn (combat)", hint: "Step back one turn (GM only).",
    editable: [{ key: "PageUp" }], onDown: turnKey(-1), restricted: true, precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
  });
  game.keybindings.register(SYSTEM_ID, "battlePanel", {
    name: "Open battle panel", hint: "Opens the Battle window; press again to close it.",
    editable: [{ key: "KeyB" }], precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { if (BattlePanel.instance?.rendered) BattlePanel.instance.close(); else BattlePanel.open(); return true; },
  });
  game.keybindings.register(SYSTEM_ID, "newUnit", {
    name: "New unit (GM)", hint: "Opens the New unit window (or brings it to the front).",
    editable: [{ key: "KeyN" }], restricted: true, precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { newUnitDialog(); return true; },
  });

  registerBattleQuery();
  registerCombatQuery();
});

Hooks.once("ready", () => {
  reapplyUnitEdits();
  registerAttackFxSocket();
  initBattleMapSync();
  refreshTactics();
  if (game.user.isGM && getBattle().active) BattlePanel.open();
  else if (getBattle().active && game.settings.get(SYSTEM_ID, "autoOpenBattle")) BattlePanel.open();
});

Hooks.on("renderChatMessageHTML", onRenderChatMessage);
registerTokenHover();
registerDamageFloats();
registerUnitBars();
registerUnitInfo();
registerTactics();
registerDeployZones();
setDeployChangeHandler(() => BattlePanel.refresh());
registerUnitClicks();
Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("updateToken", (doc, change, options) => {
  onTokenMoved(doc, change, options);
  // Wipe the hover movement trail after each move unless the GM wants it
  if (("x" in change || "y" in change) && game.user.isActiveGM && !game.settings.get(SYSTEM_ID, "showMovementTrail") && doc.movementHistory?.length) {
    setTimeout(() => doc.clearMovementHistory?.().catch?.(() => {}), 0);
  }
});
Hooks.on("updateActor", () => { BattlePanel.refresh(); refreshBattleUI(); });
Hooks.on("canvasReady", () => refreshBattleUI());
Hooks.on("canvasPan", () => repositionBattleUI());
Hooks.on("preUpdateToken", lockUnitTokens);
Hooks.on("controlToken", onUnitSelected);

Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "qinBattle", title: "Battle panel", icon: "fa-solid fa-chess-rook", order: 99,
    button: true, visible: true, onChange: () => BattlePanel.open(),
  };
  const unitTool = { ...NEW_UNIT_TOOL, visible: !!game.user?.isGM }, editTool = { ...UNIT_EDITOR_TOOL, visible: !!game.user?.isGM };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push({ ...tool, onClick: tool.onChange }, { ...unitTool, onClick: unitTool.onChange }, { ...editTool, onClick: editTool.onChange });
  else if (controls.tokens?.tools) { controls.tokens.tools.qinBattle = tool; controls.tokens.tools.qinNewUnit = unitTool; controls.tokens.tools.qinUnitEditor = editTool; }
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
/** Aspect or skill Test from the macro bar: the selected token's character, else the one it was dragged from. */
async function rollTestMacro({ actorUuid, aspect, skill, skillItem }) {
  const tok = canvas?.tokens?.controlled?.find(t => t.actor && t.actor.type !== "unit" && t.actor.isOwner);
  const actor = tok?.actor ?? (actorUuid ? await fromUuid(actorUuid) : null);
  if (!actor) return ui.notifications.warn("Select a token first.");
  if (!actor.isOwner) return ui.notifications.warn(`You don't own ${actor.name}.`);
  if (aspect) return actor.rollTest({ aspect });
  let key = skill, domain = CFG.SKILLS[skill]?.domain;
  if (!key && skillItem) {
    const it = actor.items.find(i => i.type === "skill" && i.name === skillItem);
    if (!it) return ui.notifications.warn(`${actor.name} has no "${skillItem}" skill.`);
    key = it.id; domain = it.system.domain;
  }
  domain ??= "metal";
  return actor.rollTest({ aspect: domain, skill: key, physical: domain === "water" });
}
Hooks.once("init", () => { registerDangerZoneKey(SYSTEM_ID); registerFacingKey(SYSTEM_ID); game.qin.toggleDangerZone = toggleDangerZone; game.qin.rollItemMacro = rollItemMacro; game.qin.rollTestMacro = rollTestMacro; });
Hooks.on("hotbarDrop", (bar, data, slot) => {
  if (data?.type !== "QinRoll") return;
  (async () => {
    const actor = data.actorUuid ? fromUuidSync(data.actorUuid) : null;
    const label = data.aspect ? `${CFG.ASPECTS[data.aspect]?.label ?? data.aspect} Test`
      : data.skill ? (CFG.SKILLS[data.skill]?.label ?? data.skill) : data.skillItem;
    const payload = { actorUuid: data.actorUuid, aspect: data.aspect, skill: data.skill, skillItem: data.skillItem };
    const command = `game.qin.rollTestMacro(${JSON.stringify(payload)});`;
    let macro = game.macros.find(m => m.command === command && m.isOwner);
    macro ??= await CONFIG.Macro.documentClass.create({
      name: label, type: "script", img: data.aspect ? "icons/svg/d10-grey.svg" : "icons/svg/book.svg", command, flags: { qin: { rollMacro: true, actor: actor?.name } },
    });
    await game.user.assignHotbarMacro(macro, slot);
  })();
  return false;
});
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

// Only the GM may create, change or remove a unit's formations
for (const hook of ["preCreateItem", "preUpdateItem", "preDeleteItem"]) {
  Hooks.on(hook, (item) => {
    if (item.type !== "formation" || !item.parent || game.user.isGM) return;
    ui.notifications.warn("Only the GM can change a unit's formations.");
    return false;
  });
}

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

/* Unit tokens: only Player units are linked to their actor sheet (health and morale carry between battles).
 * Ally, Enemy and Neutral units are always placed as independent copies, even the first one. A second token
 * of the same Player unit on a scene is also a copy, so two tokens never share one health pool. */
const pendingLinked = new Set();
Hooks.on("preCreateToken", (doc, data) => {
  const actor = doc.actor ?? game.actors.get(data.actorId);
  if (actor?.type !== "unit") return;
  if (actor.system.side !== "player") { if (doc.actorLink) doc.updateSource({ actorLink: false }); return; }
  const scene = doc.parent, key = `${scene?.id}.${actor.id}`;
  const taken = pendingLinked.has(key) || scene?.tokens.some(t => t.actorLink && t.actorId === actor.id);
  if (taken) { if (doc.actorLink) doc.updateSource({ actorLink: false }); return; }
  if (!doc.actorLink) doc.updateSource({ actorLink: true });
  pendingLinked.add(key); setTimeout(() => pendingLinked.delete(key), 0);
});

// Changing a unit's side updates what its future tokens do
Hooks.on("preUpdateActor", (actor, change) => {
  const side = foundry.utils.getProperty(change, "system.side");
  if (actor.type !== "unit" || side === undefined || actor.isToken) return;
  foundry.utils.setProperty(change, "prototypeToken.actorLink", side === "player");
});

/** Existing scenes: unlink non-Player unit tokens and extra copies of a Player unit. */
async function unlinkSharedUnits(scene) {
  if (!scene || !game.user.isActiveGM) return;
  const seen = new Set(), updates = [];
  for (const t of scene.tokens) {
    if (!t.actorLink || t.actor?.type !== "unit") continue;
    if (t.actor.system.side !== "player" || seen.has(t.actorId)) updates.push({ _id: t.id, actorLink: false });
    else seen.add(t.actorId);
  }
  if (!updates.length) return;
  await scene.updateEmbeddedDocuments("Token", updates);
  ui.notifications.info(`${updates.length} unit token${updates.length === 1 ? "" : "s"} on "${scene.name}" now track their own health and morale.`);
}
Hooks.on("canvasReady", (c) => { unlinkSharedUnits(c.scene).catch(e => console.warn("Qin | unlinking unit tokens", e)); });

// New characters start with sensible tokens
Hooks.on("preCreateActor", (actor, data) => {
  if (data.prototypeToken) return;
  const proto = { actorLink: actor.type === "character", displayName: 20, displayBars: 20 };
  // Units: our own always-on health/morale bars replace Foundry's; player units keep their health between battles
  if (actor.type === "unit") Object.assign(proto, { bar1: { attribute: null }, displayBars: 0, actorLink: (data.system?.side ?? "player") === "player" });
  actor.updateSource({ prototypeToken: proto });
});
