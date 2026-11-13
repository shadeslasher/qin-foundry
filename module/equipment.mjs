// Equipment on units: pieces from the Equipment catalogue stored as trait-list entries flagged `equip`, shown on the
// unit sheet's Equipment tab and in the Info window, read by the engine like traits. The GM equips from a picker
// window (the sheet's + button, or the Party panel's Equip button); the GM or the unit's owner may equip.
import { EQUIPMENT, KIND_LABEL, equipmentByName, equipmentFamily, equipmentKind } from "./battle/equipment-data.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** The unit's equipment entries (from its source trait list). */
export function equipmentOf(actor) {
  const list = actor?._source?.system?.traitList ?? actor?.system?._source?.traitList ?? actor?.system?.traitList ?? [];
  // the description comes from the catalogue, so pieces equipped before a rules change show the current text
  return list.filter(e => e.equip).map(e => ({ ...e, desc: equipmentByName(e.name)?.desc ?? e.desc }));
}

/** A new trait list with `name` equipped (replacing anything of the same family). Pure; exported for tests. */
const SIEGE = new Set(["Siege Ladders", "Siege Engine"]); // a unit carries one or the other, never both
export const siegeClash = (list, name) => SIEGE.has(equipmentFamily(name)) && (list ?? []).some(e => e.equip && SIEGE.has(equipmentFamily(e.name)) && equipmentFamily(e.name) !== equipmentFamily(name));
/** The piece of gear (War Drums / Rallying Banner / War Horn) a new gear piece would replace, or null. */
export const gearReplaced = (list, name) => equipmentKind(name) === "gear" ? ((list ?? []).find(e => e.equip && equipmentKind(e.name) === "gear" && equipmentFamily(e.name) !== equipmentFamily(name))?.name ?? null) : null;
export function equipList(list, name) {
  const piece = equipmentByName(name); if (!piece) return null;
  if (siegeClash(list, name)) return null;
  // same family goes (a tier swap); a gear piece also pushes out any other gear (one piece of gear in all)
  const kept = (list ?? []).filter(e => !(e.equip && (equipmentFamily(e.name) === piece.family || (piece.kind === "gear" && equipmentKind(e.name) === "gear"))));
  return [...kept, { name: piece.name, desc: piece.desc, level: 1, upgrades: [], options: [], chosen: -1, equip: true }];
}
/** A new trait list without that piece. */
export function unequipList(list, name) { return (list ?? []).filter(e => !(e.equip && e.name === name)); }

async function saveList(actor, list) {
  await actor.update({ "system.traitList": list, "system.traits": "" });
  try { (await import("./sheets/sheets.mjs")).resetTraitCatalog(); } catch { /* fine */ }
}
/** Saddles are for cavalry only (David, 2026-11-12). */
export const isCavalry = (actor) => (actor?.system?.category ?? "") === "cavalry";
/** Fine Arrows are for units that shoot (range 2+, hybrids included; David, 2026-11-12). */
export const isRangedUnit = (actor) => (actor?.system?.range ?? 1) > 1;
/** A unit owned by a player (not only the GM). */
export const playerOwned = (actor) => !!actor && (game.users ?? []).some(u => !u.isGM && actor.testUserPermission?.(u, "OWNER"));
/** Who may equip a unit: the GM, or the unit's owner (David, 2026-10-25). */
export const canEquip = (actor) => !!actor && (game.user.isGM || actor.isOwner);
export async function equipUnit(actor, name) {
  if (!canEquip(actor)) return;
  const src = foundry.utils.deepClone(actor._source.system.traitList ?? []);
  if (equipmentFamily(name) === "Fine Arrows" && !isRangedUnit(actor)) return ui.notifications.warn(`${actor.name} doesn't shoot: only ranged units can use Fine Arrows.`);
  if (equipmentFamily(name) === "Saddle" && !isCavalry(actor)) return ui.notifications.warn(`${actor.name} isn't cavalry: only cavalry can use a saddle.`);
  if (equipmentKind(name) === "siege" && playerOwned(actor)) return ui.notifications.warn("Players' siege equipment is handed out from the Party panel's Siege tab during deployment.");
  if (siegeClash(src, name)) return ui.notifications.warn(`${actor.name} already carries siege equipment: drop it first (a unit carries ladders or an engine, never both).`);
  const swapped = gearReplaced(src, name);
  const list = equipList(src, name); if (!list) return;
  await saveList(actor, list);
  ui.notifications.info(`${actor.name} now carries ${name}${swapped ? ` (put down ${swapped})` : ""}.`);
}
export async function unequipUnit(actor, name) {
  if (!canEquip(actor)) return;
  await saveList(actor, unequipList(foundry.utils.deepClone(actor._source.system.traitList ?? []), name));
}

/** The GM's picker: every piece in the catalogue, by family, with the unit's current piece marked. */
export class EquipmentPicker extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-equip"],
    window: { title: "Equipment", icon: "fa-solid fa-shield-halved", resizable: true },
    position: { width: 520, height: 640 },
    actions: { equip: EquipmentPicker.#equip, unequip: EquipmentPicker.#unequip },
  };
  static open(actor) {
    if (!canEquip(actor)) return;
    const id = `qin-equip-${actor.id}`;
    const open = foundry.applications.instances?.get(id);
    if (open) return open.render({ force: true });
    return new EquipmentPicker({ id, actor }).render({ force: true });
  }
  constructor(options) { super(options); this.actor = options.actor; }
  get title() { return `Equipment: ${this.actor?.name ?? ""}`; }
  static async #equip(ev, el) { await equipUnit(this.actor, el.dataset.name); this.render(); }
  static async #unequip(ev, el) { await unequipUnit(this.actor, el.dataset.name); this.render(); }
  async _renderHTML() {
    const have = new Map(equipmentOf(this.actor).map(e => [equipmentFamily(e.name), e.name]));
    // players' units get siege equipment from their owner's stock at deployment (David, 2026-11-13); units nobody owns
    // (the GM's enemies) still carry it on their sheet
    const siegeHere = !playerOwned(this.actor);
    const gear = [...have.keys()].find(k => equipmentKind(EQUIPMENT.find(f => f.family === k)?.tiers[0].name) === "gear") ?? null;
    const section = (f) => {
      const cur = have.get(f.family);
      const noSaddle = !cur && ((f.family === "Saddle" && !isCavalry(this.actor)) || (f.family === "Fine Arrows" && !isRangedUnit(this.actor)));
      const blocked = noSaddle || (!cur && f.kind === "siege" && [...have.keys()].some(k => SIEGE.has(k)));
      const swap = !cur && f.kind === "gear" && gear ? `replaces ${have.get(gear)}` : "";
      return `<section class="qin-eq-fam ${cur ? "has" : ""} ${blocked ? "blocked" : ""}"><h4>${esc(f.family)}${cur ? ` <span class="qin-eq-cur">carrying ${esc(cur)}</span>` : swap ? ` <span class="qin-eq-cur swap">${esc(swap)}</span>` : ""}</h4>
        <div class="qin-eq-tiers">${f.tiers.map(t => `<button type="button" class="qin-eq-tier ${cur === t.name ? "on" : ""}" ${blocked ? "disabled" : ""} data-action="${cur === t.name ? "unequip" : "equip"}" data-name="${esc(t.name)}" data-tooltip="${esc(noSaddle ? (f.family === "Saddle" ? "Cavalry only." : "Ranged units only.") : blocked ? "Already carrying other siege equipment — a unit carries ladders or an engine, never both." : t.desc)}">
          ${cur === t.name ? `<i class="fa-solid fa-check"></i> ` : ""}${esc(t.name)}</button>`).join("")}</div>
        <div class="qin-eq-desc" data-desc>${esc((f.tiers.find(t => t.name === cur) ?? f.tiers[0]).desc)}</div>
      </section>`;
    };
    return `<div class="qin-eq-wrap">
      <p class="qin-eq-intro">${esc(this.actor.name)} can carry one of each upgrade${siegeHere ? ", one piece of gear and one piece of siege equipment" : " and one piece of gear"}. A better tier replaces the one it has.${siegeHere ? "" : " Siege equipment is handed out from the Party panel's Siege tab during deployment."}</p>
      ${(siegeHere ? ["upgrade", "gear", "siege"] : ["upgrade", "gear"]).map(kind => `<div class="qin-eq-kind">${esc(KIND_LABEL[kind])}</div>${EQUIPMENT.filter(f => f.kind === kind).map(section).join("")}`).join("")}
    </div>`;
  }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    // hovering a tier shows its text under the row (the tooltip has it too)
    for (const btn of content.querySelectorAll(".qin-eq-tier")) btn.addEventListener("mouseenter", () => { const d = btn.closest(".qin-eq-fam")?.querySelector("[data-desc]"); if (d) d.textContent = btn.dataset.tooltip; });
  }
}

/** Keep open pickers current when a unit changes. */
export function registerEquipment() {
  Hooks.on("updateActor", (actor) => { for (const app of foundry.applications.instances?.values() ?? []) if (app instanceof EquipmentPicker && app.actor?.id === actor.id) app.render(); });
}
