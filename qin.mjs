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

const { SYSTEM_ID } = CFG;

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
  game.settings.register(SYSTEM_ID, "autoOpenBattle", {
    name: "Open the battle panel automatically", scope: "client", config: true, type: Boolean, default: true,
  });

  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper("qinObj", (options) => options.hash);
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

  registerBattleQuery();
});

Hooks.once("ready", () => {
  if (game.user.isGM && getBattle().active) BattlePanel.open();
  else if (getBattle().active && game.settings.get(SYSTEM_ID, "autoOpenBattle")) BattlePanel.open();
});

Hooks.on("renderChatMessageHTML", onRenderChatMessage);
Hooks.on("updateToken", (doc, change, options) => onTokenMoved(doc, change, options));
Hooks.on("updateActor", () => BattlePanel.refresh());

Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "qinBattle", title: "Battle panel", icon: "fa-solid fa-chess-rook", order: 99,
    button: true, visible: true, onChange: () => BattlePanel.open(),
  };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push({ ...tool, onClick: tool.onChange });
  else if (controls.tokens?.tools) controls.tokens.tools.qinBattle = tool;
});

// New characters start with sensible tokens
Hooks.on("preCreateActor", (actor, data) => {
  if (data.prototypeToken) return;
  const proto = { actorLink: actor.type === "character", displayName: 20, displayBars: 20 };
  if (actor.type === "unit") Object.assign(proto, { bar1: { attribute: "men" }, actorLink: false });
  actor.updateSource({ prototypeToken: proto });
});
