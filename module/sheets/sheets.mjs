import { ASPECTS, SKILLS, DOMAINS, SKILL_LEVELS, BOL_LEVELS, MAGIC_WAYS, OFFICER_ABILITY_KINDS, OFFICER_EFFECTS, UNIT_CATEGORIES, SIDES, SIGNATURE_SLOTS, systemPath } from "../config.mjs";
import { actionsPerRound } from "../rules/qin-rules.mjs";

const { api, sheets } = foundry.applications;
// v14 renamed ActorSheetV2/ItemSheetV2 to ActorSheet/ItemSheet; fall back to the v13 names.
const ActorSheetBase = sheets.ActorSheet ?? sheets.ActorSheetV2;
const ItemSheetBase = sheets.ItemSheet ?? sheets.ItemSheetV2;

const ITEM_GROUPS = {
  weapon: "Weapons", armor: "Armor & shields", technique: "Combat techniques", tao: "Taos", magic: "Magic",
  gift: "Gift", weakness: "Weakness", gear: "Equipment", skill: "Extra skills", officerAbility: "Tactics", signature: "Signature skills", formation: "Formations",
};
const TAO_LEVELS = { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4" };
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Compendium entries with pre-built hover details, cached per pack (the system packs don't change in play). */
const libraryCache = new Map();
async function loadLibrary(packName) {
  if (libraryCache.has(packName)) return libraryCache.get(packName);
  const pack = game.packs.get(`qin.${packName}`);
  if (!pack) return [];
  const docs = await pack.getDocuments();
  const list = docs.map(d => ({ uuid: d.uuid, name: d.name, details: libraryDetails(d) })).sort((a, b) => a.name.localeCompare(b.name));
  libraryCache.set(packName, list);
  return list;
}
/** Hover-detail library pickers (.qin-picker): hover an entry for its details, click to choose it. */
export function wirePickers(app, el, entries) {
  const details = Object.fromEntries(entries.map(d => [d.uuid, d.details]));
  el.querySelectorAll(".qin-picker").forEach(picker => {
    const info = picker.querySelector(".qin-picker-info");
    const close = () => picker.classList.remove("open", "show-info");
    picker.querySelector(".qin-picker-toggle").addEventListener("click", ev => {
      ev.preventDefault();
      el.querySelectorAll(".qin-picker.open").forEach(p => { if (p !== picker) p.classList.remove("open", "show-info"); });
      picker.classList.toggle("open");
    });
    picker.querySelectorAll("li[data-uuid]").forEach(li => {
      li.addEventListener("mouseenter", () => { info.innerHTML = details[li.dataset.uuid] ?? ""; picker.classList.add("show-info"); });
      li.addEventListener("click", () => {
        if (li.classList.contains("owned")) return;
        picker.dataset.value = li.dataset.uuid;
        picker.querySelector(".qin-picker-label").textContent = li.textContent.trim();
        close();
      });
    });
    picker.addEventListener("mouseleave", () => picker.classList.remove("show-info"));
  });
  if (!app._qinPickerCloser) {
    app._qinPickerCloser = true;
    el.addEventListener("click", ev => {
      if (!ev.target.closest(".qin-picker")) el.querySelectorAll(".qin-picker.open").forEach(p => p.classList.remove("open", "show-info"));
    });
  }
}

function libraryDetails(doc) {
  const s = doc.system;
  let html = `<h4>${esc(doc.name)}</h4>`;
  if (doc.type === "tao") {
    html += s.description || "";
    html += `<ol class="qin-info-levels">${[1, 2, 3, 4].map(l => `<li><b>Level ${l}</b> (${l} Chi): ${esc(s.effects[`l${l}`])}</li>`).join("")}</ol>`;
  } else if (doc.type === "technique") {
    const used = { attack: "Attack Test", defense: "Active Defense", other: "Special" }[s.roll] ?? s.roll;
    html += `<p class="qin-muted">${s.kind === "distance" ? "Distance" : "Close"} combat · ${used} · ST +${s.stIncrease}</p>${s.description || ""}`;
  } else if (doc.type === "formation") {
    const fx = formationSummary(s);
    html += (fx ? `<p class="qin-info-fx">${esc(fx)}</p>` : "") + (s.description || "");
  } else html += s.description || "";
  return html;
}

/** Grow a window's default size with the Qin text size setting. */
export function scaledPosition(position) {
  let pct = 115;
  try { pct = Number(game.settings.get("qin", "textScale")) || 115; } catch { /* ignore */ }
  const k = pct / 100;
  const out = { ...position };
  if (typeof out.width === "number") out.width = Math.round(out.width * k);
  if (typeof out.height === "number") out.height = Math.min(Math.round(out.height * k), window.innerHeight - 40);
  return out;
}

/** Small tab helper: tabs switch without a re-render and survive re-renders. */
function tabMixin(Base) {
  return class extends Base {
    _qinTab = null;
    _initializeApplicationOptions(options) {
      const o = super._initializeApplicationOptions?.(options) ?? options;
      o.position = scaledPosition(o.position);
      return o;
    }
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
      toggleKnown: QinActorSheetBase.#toggleKnown,
      itemEdit: QinActorSheetBase.#itemEdit,
      itemDelete: QinActorSheetBase.#itemDelete,
      itemUse: QinActorSheetBase.#itemUse,
      itemChat: QinActorSheetBase.#itemChat,
      bolBox: QinActorSheetBase.#bolBox,
      meditate: QinActorSheetBase.#meditate,
      restChi: QinActorSheetBase.#restChi,
      toggleEquip: QinActorSheetBase.#toggleEquip,
      signatureOpen: QinActorSheetBase.#signatureOpen,
      addFromLibrary: QinActorSheetBase.#addFromLibrary,
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
          known: v.value > 0 || !!v.known, listed: !!v.known,
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
      taoLibrary: await QinActorSheetBase.#library(actor, "taos", "tao"),
      techniqueLibrary: await QinActorSheetBase.#library(actor, "techniques", "technique"),
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

  /** Entries of a system compendium with hover details, flagged if the character already has one of that name. */
  static async #library(actor, packName, type) {
    const docs = await loadLibrary(packName);
    const known = new Set(actor.items.filter(i => i.type === type).map(i => i.name));
    return docs.map(d => ({ ...d, owned: known.has(d.name) }));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    // Weapons, Taos, techniques etc. can be dragged to the macro bar (or onto other sheets)
    el.querySelectorAll("[data-item-id]").forEach(li => {
      const item = this.actor.items.get(li.dataset.itemId);
      if (!item || li.dataset.qinDrag) return;
      li.dataset.qinDrag = "1";
      li.setAttribute("draggable", "true");
      li.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
      });
    });
    // Aspect and skill rolls can be dragged to the macro bar too
    el.querySelectorAll('a[data-action="rollAspect"][data-aspect], a[data-action="rollSkill"][data-skill]').forEach(a => {
      if (a.dataset.qinDrag) return;
      a.dataset.qinDrag = "1";
      a.setAttribute("draggable", "true");
      a.addEventListener("dragstart", ev => {
        ev.stopPropagation();
        const data = { type: "QinRoll", actorUuid: this.actor.uuid };
        if (a.dataset.aspect) data.aspect = a.dataset.aspect;
        else {
          const key = a.dataset.skill;
          if (SKILLS[key]) data.skill = key;
          else { const it = this.actor.items.get(key); data.skillItem = it?.name ?? key; }
        }
        ev.dataTransfer.setData("text/plain", JSON.stringify(data));
      });
    });
    // Tao level selects update the embedded item directly
    el.querySelectorAll("select[data-tao-level]").forEach(sel => sel.addEventListener("change", ev => {
      ev.stopPropagation();
      this.actor.items.get(sel.dataset.taoLevel)?.update({ "system.level": Number(sel.value) });
    }));
    // Library pickers: hover an entry for its details, click to choose it
    wirePickers(this, el, [...(context.taoLibrary ?? []), ...(context.techniqueLibrary ?? [])]);
  }

  /** Copy the chosen compendium entry (a Tao or technique) onto the character. */
  static async #addFromLibrary(event, target) {
    const { library, type } = target.dataset;
    const uuid = this.element.querySelector(`.qin-picker[data-library="${library}"]`)?.dataset.value;
    if (!uuid) return ui.notifications.info(`Choose one from the list first.`);
    const doc = await fromUuid(uuid);
    if (!doc) return;
    if (this.actor.items.some(i => i.type === type && i.name === doc.name)) return ui.notifications.info(`${this.actor.name} already knows ${doc.name}.`);
    const data = doc.toObject();
    delete data._id;
    if (type === "tao") data.system.level = 1;
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Show a signature skill's description, with options to change or remove it. Empty slot: create one. */
  static async #signatureOpen(event, target) {
    const slot = target.dataset.slot;
    const label = SIGNATURE_SLOTS[slot]?.label ?? slot;
    const item = this.actor.items.find(i => i.type === "signature" && i.system.slot === slot);
    if (!item) {
      if (!this.isEditable) return;
      return openItemDraft(this.actor, { name: `New ${label}`, type: "signature", system: { slot } });
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
  /** Mark a Beginner-level skill as learned (or not). */
  static async #toggleKnown(event, target) {
    const key = target.dataset.skill;
    await this.actor.update({ [`system.skills.${key}.known`]: !this.actor.system.skills?.[key]?.known });
  }
  static async #itemCreate(event, target) {
    const type = target.dataset.type;
    openItemDraft(this.actor, { name: `New ${ITEM_GROUPS[type] ?? type}`.replace(/s$/, ""), type });
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
  static DEFAULT_OPTIONS = { position: { width: 640, height: 640 }, actions: { henchHp: HenchmanSheet.#henchHp } };

  /** Click a health pip: set health to that many (clicking the last full pip removes it). */
  static async #henchHp(event, target) {
    const i = Number(target.dataset.index), s = this.actor.system;
    const value = s.hp.value === i + 1 ? i : i + 1;
    const wounds = Math.max(0, s.tier - value);
    await this.actor.update({ "system.wounds": wounds, "system.outOfAction": wounds >= s.tier });
  }
  static PARTS = { sheet: { template: systemPath("templates/actor/henchman.hbs"), scrollable: [".qin-body"] } };

  /** Henchmen only track weapon skills, Dodging and Perception (plus any extra skills added by hand). */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const row = (key) => {
      const s = SKILLS[key], v = system.skills?.[key] ?? { value: 0, spec: "" };
      return { key, label: s.label, value: v.value, spec: v.spec, complex: s.complex };
    };
    context.hpPips = Array.from({ length: system.hp?.max ?? 0 }, (_, i) => i < (system.hp?.value ?? 0));
    context.weaponSkills = Object.entries(SKILLS).filter(([, s]) => s.martial).map(([k]) => row(k));
    context.otherSkills = ["dodging", "perception"].filter(k => SKILLS[k]).map(row);
    context.extraSkills = (context.items.skill || []).map(i => ({ id: i.id, name: i.name, value: i.system.value, levelLabel: SKILL_LEVELS[i.system.value], domain: DOMAINS[i.system.domain] ?? i.system.domain }));
    return context;
  }
}

/** Short text for a formation's numeric effects (shown on unit sheets). */
export function formationSummary(f) {
  const out = [];
  const sg = (n) => (n > 0 ? `+${n}` : `${n}`);
  if (f.immobile) out.push("Cannot move");
  else if (f.moveMod) out.push(`Movement ${sg(f.moveMod)}`);
  if (f.vsAttack) out.push(`Enemy attacks ${sg(f.vsAttack)}`);
  if (f.vsMelee) out.push(`Enemy melee ${sg(f.vsMelee)}`);
  if (f.vsRanged) out.push(`Enemy ranged ${sg(f.vsRanged)}`);
  if (f.vsCharge !== null && f.vsCharge !== undefined) out.push(`Enemy cavalry charges ${sg(f.vsCharge)}`);
  if (f.defAll) out.push(`Defending ${sg(f.defAll)}`);
  if (f.defFront) out.push(`Defending from the front ${sg(f.defFront)}`);
  if (f.frontMelee) out.push(`Melee from the front ${sg(f.frontMelee)}`);
  if (f.chargeBonus) out.push(`Own cavalry charge ${sg(f.chargeBonus)}`);
  if (f.dmgMod) out.push(`Damage ${sg(f.dmgMod)}`);
  if (f.casReduce) out.push(`${f.casReduce} fewer casualties`);
  if (f.noAttackerBonus) out.push("No attacker bonus");
  if (f.noRear) out.push("Can't be attacked in the rear");
  return out.join(" · ");
}

export class UnitSheet extends tabMixin(api.HandlebarsApplicationMixin(ActorSheetBase)) {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sheet", "actor", "unit"],
    position: { width: 660, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      openOfficer: UnitSheet.#openOfficer,
      clearOfficer: UnitSheet.#clearOfficer,
      itemEdit: UnitSheet.#itemEdit,
      itemDelete: UnitSheet.#itemDelete,
      itemCreate: UnitSheet.#itemCreate,
      addFormation: UnitSheet.#addFormation,
      addAllFormations: UnitSheet.#addAllFormations,
    },
  };
  static PARTS = { sheet: { template: systemPath("templates/actor/unit.hbs"), scrollable: [".qin-body"] } };

  _initializeApplicationOptions(options) {
    const o = super._initializeApplicationOptions?.(options) ?? options;
    o.position = scaledPosition(o.position);
    return o;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document, system = actor.system;
    const officer = system.officerActor;
    const formations = actor.items.filter(i => i.type === "formation").sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const lib = game.user.isGM ? await loadLibrary("formations") : [];
    const owned = new Set(formations.map(f => f.name));
    Object.assign(context, {
      actor, system, editable: this.isEditable, isGM: game.user.isGM,
      categories: UNIT_CATEGORIES, sides: SIDES,
      weaponSkills: Object.fromEntries(Object.entries(SKILLS).filter(([, s]) => s.martial).map(([k, s]) => [k, s.label])),
      formationChoices: { none: "No formation", ...Object.fromEntries(formations.map(f => [f.id, f.name])) },
      formations: formations.map(f => ({ id: f.id, name: f.name, description: f.system.description, summary: formationSummary(f.system), active: system.formation === f.id })),
      formationLibrary: lib.map(l => ({ ...l, owned: owned.has(l.name) })),
      officer, officerStats: officer ? {
        fire: officer.system.aspects.fire, command: officer.system.skills.command.value,
        skill: officer.getSkill(system.weaponSkill).value, skillLabel: SKILLS[system.weaponSkill]?.label,
      } : null,
      menPct: Math.min(100, Math.round(100 * system.men.value / (system.men.max || 100))),
      xpPct: Math.min(100, Math.round(100 * (system.xp?.value ?? 0) / (system.xp?.max || 100))),
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    wirePickers(this, this.element, context.formationLibrary ?? []);
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

  static #item(target) { return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId); }
  static async #itemEdit(event, target) { UnitSheet.#item.call(this, target)?.sheet.render(true); }
  static async #itemDelete(event, target) {
    const item = UnitSheet.#item.call(this, target);
    if (!item) return;
    const ok = await (api.Dialog ?? api.DialogV2).confirm({ window: { title: `Remove ${item.name}?` }, content: `<p>Remove <b>${esc(item.name)}</b> from ${esc(this.document.name)}?</p>` });
    if (ok) {
      if (this.document.system.formation === item.id) await this.document.update({ "system.formation": "none" });
      await item.delete();
    }
  }
  static async #itemCreate(event, target) {
    const type = target.dataset.type;
    openItemDraft(this.document, { name: type === "formation" ? "New Formation" : `New ${type}`, type });
  }
  static async #addFormation() {
    const uuid = this.element.querySelector('.qin-picker[data-library="formations"]')?.dataset.value;
    if (!uuid) return ui.notifications.info("Choose a formation from the list first.");
    const doc = await fromUuid(uuid);
    if (doc) await this.document.createEmbeddedDocuments("Item", [doc.toObject()]);
  }
  static async #addAllFormations() {
    const owned = new Set(this.document.items.filter(i => i.type === "formation").map(i => i.name));
    const lib = await loadLibrary("formations");
    const docs = (await Promise.all(lib.filter(l => !owned.has(l.name)).map(l => fromUuid(l.uuid)))).filter(Boolean);
    if (docs.length) await this.document.createEmbeddedDocuments("Item", docs.map(d => d.toObject()));
  }
  static async #openOfficer() { this.document.system.officerActor?.sheet.render(true); }
  static async #clearOfficer() { this.document.update({ "system.officer": "" }); }
}

/**
 * Open an item sheet for an item that doesn't exist yet. Edits stay on the unsaved copy;
 * "Done" creates it on the actor, closing the window (X / Cancel) discards it.
 */
export function openItemDraft(actor, data) {
  const ItemClass = CONFIG.Item.documentClass;
  const draft = new ItemClass({ _id: foundry.utils.randomID(), ...data }, { parent: actor });
  const sheet = new QinItemSheet({ document: draft, qinDraft: true });
  // Anything the sheet would save goes into the draft instead of the database.
  draft.update = async (changes = {}) => {
    draft.updateSource(foundry.utils.expandObject(changes));
    if (sheet.rendered) sheet.render();
    return draft;
  };
  // Safety net: if Foundry refuses to show a sheet for an unsaved item, fall back to create-then-edit.
  Promise.resolve(sheet.render(true)).catch(async (err) => {
    console.warn("Qin | Draft item sheet failed, creating the item directly instead", err);
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    item?.sheet.render(true);
  });
  return sheet;
}

export class QinItemSheet extends api.HandlebarsApplicationMixin(ItemSheetBase) {
  _initializeApplicationOptions(options) {
    const o = super._initializeApplicationOptions?.(options) ?? options;
    o.position = scaledPosition(o.position);
    return o;
  }
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sheet", "item"],
    position: { width: 520, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: { draftDone: QinItemSheet.#draftDone, draftCancel: QinItemSheet.#draftCancel },
  };

  /** Unsaved drafts keep edits on the in-memory item instead of writing to the database. */
  async _processSubmitData(event, form, submitData, options) {
    if (!this.options.qinDraft) return super._processSubmitData(event, form, submitData, options);
    this.document.updateSource(foundry.utils.expandObject(submitData));
    if (this.rendered) this.render();
  }

  /** Formation effects are the GM's to set: players can read them but not edit. */
  get isEditable() {
    if (this.document.type === "formation" && !game.user.isGM) return false;
    return super.isEditable;
  }

  get title() {
    return this.options.qinDraft ? `New ${this.document.name}`.replace(/^New New /, "New ") : super.title;
  }

  /** Create the drafted item on its actor, with whatever was filled in. */
  static async #draftDone() {
    if (!this.options.qinDraft || this._qinCreating) return;
    this._qinCreating = true;
    try {
      try { await this.submit(); } catch (e) { console.warn("Qin | draft submit", e); }
      const data = this.document.toObject();
      await this.document.parent.createEmbeddedDocuments("Item", [data], { keepId: true });
      await this.close();
    } finally { this._qinCreating = false; }
  }
  static async #draftCancel() { await this.close(); }
  static PARTS = { sheet: { template: systemPath("templates/item/item.hbs") } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    Object.assign(context, {
      item, system: item.system, type: item.type, editable: this.isEditable, draft: !!this.options.qinDraft,
      readOnlyDesc: !this.isEditable,
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
