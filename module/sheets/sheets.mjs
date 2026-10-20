import { ASPECTS, SKILLS, DOMAINS, SKILL_LEVELS, BOL_LEVELS, MAGIC_WAYS, OFFICER_ABILITY_KINDS, OFFICER_EFFECTS, UNIT_CATEGORIES, SIDES, SIGNATURE_SLOTS, systemPath } from "../config.mjs";
import { actionsPerRound } from "../rules/qin-rules.mjs";

const { api, sheets } = foundry.applications;
// v14 renamed ActorSheetV2/ItemSheetV2 to ActorSheet/ItemSheet; fall back to the v13 names.
const ActorSheetBase = sheets.ActorSheet ?? sheets.ActorSheetV2;
const ItemSheetBase = sheets.ItemSheet ?? sheets.ItemSheetV2;

const ITEM_GROUPS = {
  weapon: "Weapons", armor: "Armor & shields", technique: "Combat techniques", tao: "Taos", magic: "Magic",
  gift: "Gift", weakness: "Weakness", gear: "Equipment", skill: "Extra skills", officerAbility: "Tactics", signature: "Signature skills",
};
const TAO_LEVELS = { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4" };
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Small tab helper: tabs switch without a re-render and survive re-renders. */
function tabMixin(Base) {
  return class extends Base {
    _qinTab = null;
    _onRender(context, options) {
      super._onRender?.(context, options);
      const el = this.element;
      const first = el.querySelector("nav.qin-tabs [data-tab]")?.dataset.tab;
      this._activateTab(this._qinTab ?? first);
      el.querySelectorAll("nav.qin-tabs [data-tab]").forEach(a => a.addEventListener("click", ev => {
        ev.preventDefault(); this._activateTab(a.dataset.tab);
      }));
    }
    _activateTab(tab) {
      if (!tab) return;
      this._qinTab = tab;
      this.element.querySelectorAll("[data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === tab));
    }
  };
}

class QinActorSheetBase extends tabMixin(api.HandlebarsApplicationMixin(ActorSheetBase)) {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sheet", "actor"],
    position: { width: 760, height: 780 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollAspect: QinActorSheetBase.#rollAspect,
      rollSkill: QinActorSheetBase.#rollSkill,
      itemCreate: QinActorSheetBase.#itemCreate,
      itemEdit: QinActorSheetBase.#itemEdit,
      itemDelete: QinActorSheetBase.#itemDelete,
      itemUse: QinActorSheetBase.#itemUse,
      itemChat: QinActorSheetBase.#itemChat,
      bolBox: QinActorSheetBase.#bolBox,
      meditate: QinActorSheetBase.#meditate,
      restChi: QinActorSheetBase.#restChi,
      toggleEquip: QinActorSheetBase.#toggleEquip,
      signatureOpen: QinActorSheetBase.#signatureOpen,
      addTao: QinActorSheetBase.#addTao,
    },
  };

  get actor() { return this.document; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const items = {};
    for (const k of Object.keys(ITEM_GROUPS)) items[k] = [];
    for (const i of actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0))) (items[i.type] ??= []).push(i);
    const skillsByDomain = Object.entries(DOMAINS).map(([domain, label]) => ({
      domain, label,
      skills: Object.entries(SKILLS).filter(([, s]) => s.domain === domain).map(([key, s]) => {
        const v = system.skills?.[key] ?? { value: 0, spec: "" };
        return {
          key, label: s.label, value: v.value, spec: v.spec, complex: s.complex, needsSpec: s.spec, martial: s.martial, homebrew: s.homebrew,
          levelLabel: SKILL_LEVELS[v.value], actions: s.martial ? actionsPerRound(v.value) : null,
        };
      }),
      extra: (items.skill || []).filter(i => i.system.domain === domain),
    }));
    Object.assign(context, {
      actor, system, items, owner: actor.isOwner, editable: this.isEditable,
      aspects: Object.entries(ASPECTS).map(([key, a]) => ({ key, ...a, value: system.aspects?.[key] })),
      skillsByDomain, skillLevels: SKILL_LEVELS, bolLabels: BOL_LEVELS,
      weapons: (items.weapon || []).map(w => ({ item: w, skill: actor.getSkill(w.system.skill), ranged: w.system.isRanged })),
      magicWays: MAGIC_WAYS, officerKinds: OFFICER_ABILITY_KINDS, taoLevels: TAO_LEVELS,
      signature: Object.entries(SIGNATURE_SLOTS).map(([key, s]) => ({ key, label: s.label, item: (items.signature || []).find(i => i.system.slot === key) ?? null })),
      taoLibrary: await QinActorSheetBase.#taoLibrary(actor),
    });
    if (system.bol?.levels) {
      context.bol = system.bol.levels.map(l => ({
        ...l, label: BOL_LEVELS[l.key].label,
        boxes: Array.from({ length: l.max }, (_, i) => ({ filled: i < l.filled, index: i })),
        offset: system.bol.levels.slice(0, system.bol.levels.indexOf(l)).reduce((a, x) => a + x.max, 0),
      }));
    }
    return context;
  }

  /** Every Tao in the system compendium, flagged if the character already knows it. */
  static async #taoLibrary(actor) {
    const pack = game.packs.get("qin.taos");
    if (!pack) return [];
    const index = await pack.getIndex();
    const known = new Set(actor.items.filter(i => i.type === "tao").map(i => i.name));
    return index.contents.map(e => ({ uuid: e.uuid, name: e.name, owned: known.has(e.name) })).sort((a, b) => a.name.localeCompare(b.name));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Tao level selects update the embedded item directly
    this.element.querySelectorAll("select[data-tao-level]").forEach(sel => sel.addEventListener("change", ev => {
      ev.stopPropagation();
      this.actor.items.get(sel.dataset.taoLevel)?.update({ "system.level": Number(sel.value) });
    }));
    // The library picker isn't part of the actor's data
    this.element.querySelector(".qin-tao-choice")?.addEventListener("change", ev => ev.stopPropagation());
  }

  static async #addTao(event, target) {
    const uuid = this.element.querySelector(".qin-tao-choice")?.value;
    if (!uuid) return;
    const tao = await fromUuid(uuid);
    if (!tao) return;
    if (this.actor.items.some(i => i.type === "tao" && i.name === tao.name)) return ui.notifications.info(`${this.actor.name} already knows ${tao.name}.`);
    const data = tao.toObject();
    delete data._id;
    data.system.level = 1;
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Show a signature skill's description, with options to change or remove it. Empty slot: create one. */
  static async #signatureOpen(event, target) {
    const slot = target.dataset.slot;
    const label = SIGNATURE_SLOTS[slot]?.label ?? slot;
    const item = this.actor.items.find(i => i.type === "signature" && i.system.slot === slot);
    if (!item) {
      if (!this.isEditable) return;
      const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${label}`, type: "signature", system: { slot } }]);
      return created?.sheet.render(true);
    }
    const meta = [label];
    if (item.system.chiCost) meta.push(`${item.system.chiCost} Chi`);
    if (item.system.moraleCost) meta.push(`${item.system.moraleCost} morale`);
    const buttons = [{ action: "close", label: "Close", default: true }, { action: "chat", label: "Post to chat", icon: "fa-solid fa-comment" }];
    if (this.isEditable) buttons.push({ action: "edit", label: "Change", icon: "fa-solid fa-pen" }, { action: "remove", label: "Remove", icon: "fa-solid fa-trash" });
    const choice = await (api.Dialog ?? api.DialogV2).wait({
      window: { title: item.name },
      classes: ["qin", "qin-sig-popup"],
      position: { width: 420 },
      content: `<div class="qin-sig-meta">${esc(meta.join(" · "))}</div>${item.system.description || "<p><i>No description yet.</i></p>"}`,
      buttons,
      rejectClose: false,
    });
    if (choice === "edit") item.sheet.render(true);
    else if (choice === "chat") item.toChat();
    else if (choice === "remove") item.delete();
  }

  static async #rollAspect(event, target) {
    this.actor.rollTest({ aspect: target.dataset.aspect });
  }
  static async #rollSkill(event, target) {
    const key = target.dataset.skill;
    const domain = SKILLS[key]?.domain ?? this.actor.items.get(key)?.system.domain ?? "metal";
    this.actor.rollTest({ aspect: domain, skill: key, physical: domain === "water" });
  }
  static async #itemCreate(event, target) {
    const type = target.dataset.type;
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${ITEM_GROUPS[type] ?? type}`.replace(/s$/, ""), type }]);
    item?.sheet.render(true);
  }
  static #itemOf(target) { return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId); }
  static async #itemEdit(event, target) { QinActorSheetBase.#itemOf.call(this, target)?.sheet.render(true); }
  static async #itemDelete(event, target) {
    const item = QinActorSheetBase.#itemOf.call(this, target);
    if (!item) return;
    const ok = await (api.Dialog ?? api.DialogV2).confirm({ window: { title: `Delete ${item.name}?` }, content: `<p>Delete <b>${item.name}</b>?</p>` });
    if (ok) item.delete();
  }
  static async #itemUse(event, target) { QinActorSheetBase.#itemOf.call(this, target)?.use(); }
  static async #itemChat(event, target) { QinActorSheetBase.#itemOf.call(this, target)?.toChat(); }
  static async #toggleEquip(event, target) {
    const item = QinActorSheetBase.#itemOf.call(this, target);
    if (item) item.update({ "system.equipped": !item.system.equipped });
  }
  static async #bolBox(event, target) {
    // Click a box to cross off up to it; click the last crossed box to clear it.
    const n = Number(target.dataset.n) + 1;
    const cur = this.actor.system.bol.damage;
    this.actor.update({ "system.bol.damage": cur === n ? n - 1 : n });
  }
  static async #meditate() { this.actor.meditate(); }
  static async #restChi() {
    const hours = Number(await (api.Dialog ?? api.DialogV2).prompt({
      window: { title: "Sleep" }, content: `<label>Hours slept <input type="number" name="h" value="8" min="0"></label>`,
      ok: { callback: (e, b) => b.form.elements.h.value }, rejectClose: false,
    }));
    if (hours > 0) this.actor.gainChi(hours);
  }
}

export class CharacterSheet extends QinActorSheetBase {
  static PARTS = { sheet: { template: systemPath("templates/actor/character.hbs"), scrollable: [".qin-body"] } };
}

export class HenchmanSheet extends QinActorSheetBase {
  static DEFAULT_OPTIONS = { position: { width: 640, height: 640 } };
  static PARTS = { sheet: { template: systemPath("templates/actor/henchman.hbs"), scrollable: [".qin-body"] } };
}

export class UnitSheet extends tabMixin(api.HandlebarsApplicationMixin(ActorSheetBase)) {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sheet", "actor", "unit"],
    position: { width: 620, height: 680 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      openOfficer: UnitSheet.#openOfficer,
      clearOfficer: UnitSheet.#clearOfficer,
    },
  };
  static PARTS = { sheet: { template: systemPath("templates/actor/unit.hbs"), scrollable: [".qin-body"] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document, system = actor.system;
    const officer = system.officerActor;
    const formations = game.settings.get("qin", "formations") ?? [];
    Object.assign(context, {
      actor, system, editable: this.isEditable, isGM: game.user.isGM,
      categories: UNIT_CATEGORIES, sides: SIDES,
      weaponSkills: Object.fromEntries(Object.entries(SKILLS).filter(([, s]) => s.martial).map(([k, s]) => [k, s.label])),
      formationChoices: Object.fromEntries(formations.map(f => [f.id, f.name])),
      formationDesc: formations.find(f => f.id === system.formation)?.desc ?? "",
      officer, officerStats: officer ? {
        fire: officer.system.aspects.fire, command: officer.system.skills.command.value,
        skill: officer.getSkill(system.weaponSkill).value, skillLabel: SKILLS[system.weaponSkill]?.label,
        abilities: [
          ...officer.items.filter(i => i.type === "signature" && SIGNATURE_SLOTS[i.system.slot]?.battle).map(i => ({ name: i.name, kindLabel: SIGNATURE_SLOTS[i.system.slot].label, moraleCost: i.system.moraleCost })),
          ...officer.items.filter(i => i.type === "officerAbility").map(i => ({ name: i.name, kindLabel: OFFICER_ABILITY_KINDS[i.system.kind], moraleCost: i.system.moraleCost })),
        ],
      } : null,
      officerKinds: OFFICER_ABILITY_KINDS,
      menPct: Math.min(100, Math.round(100 * system.men.value / (system.men.max || 100))),
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Drop a character actor onto the sheet to make them this unit's officer.
    const zone = this.element.querySelector(".qin-officer-drop");
    zone?.addEventListener("dragover", ev => ev.preventDefault());
    zone?.addEventListener("drop", async ev => {
      ev.preventDefault();
      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      if (data.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      if (actor?.type !== "character") return ui.notifications.warn("Officers must be Qin characters.");
      await this.document.update({ "system.officer": actor.uuid });
    });
  }

  static async #openOfficer() { this.document.system.officerActor?.sheet.render(true); }
  static async #clearOfficer() { this.document.update({ "system.officer": "" }); }
}

export class QinItemSheet extends api.HandlebarsApplicationMixin(ItemSheetBase) {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sheet", "item"],
    position: { width: 520, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
  };
  static PARTS = { sheet: { template: systemPath("templates/item/item.hbs") } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    Object.assign(context, {
      item, system: item.system, type: item.type, editable: this.isEditable,
      skillChoices: Object.fromEntries(Object.entries(SKILLS).map(([k, s]) => [k, s.label])),
      martialChoices: { any: "Any weapon", ...Object.fromEntries(Object.entries(SKILLS).filter(([, s]) => s.martial).map(([k, s]) => [k, s.label])) },
      domains: DOMAINS, magicWays: MAGIC_WAYS, officerKinds: OFFICER_ABILITY_KINDS, skillLevels: SKILL_LEVELS,
      officerEffects: Object.entries(OFFICER_EFFECTS).map(([k, e]) => ({ key: k, ...e, value: item.system.effects?.[k] })),
      signatureSlots: Object.fromEntries(Object.entries(SIGNATURE_SLOTS).map(([k, s]) => [k, s.label])),
      showEffects: item.type === "officerAbility" || (item.type === "signature" && item.system.slot === "battlePassive"),
    });
    return context;
  }
}
