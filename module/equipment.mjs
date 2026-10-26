// Equipment on units: pieces from the Equipment catalogue stored as trait-list entries flagged `equip`, shown on the
// unit sheet's Equipment tab and in the Info window, read by the engine like traits. The GM equips from a picker
// window (the sheet's + button, or the Party panel's Equip button). One piece per family; a higher tier replaces.
import { EQUIPMENT, equipmentByName, equipmentFamily } from "./battle/equipment-data.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** The unit's equipment entries (from its source trait list). */
export function equipmentOf(actor) {
  const list = actor?._source?.system?.traitList ?? actor?.system?._source?.traitList ?? actor?.system?.traitList ?? [];
  return list.filter(e => e.equip);
}

/** A new trait list with `name` equipped (replacing anything of the same family). Pure; exported for tests. */
const SIEGE = new Set(["Siege Ladders", "Siege Engine"]); // a unit carries one or the other, never both
export const siegeClash = (list, name) => SIEGE.has(equipmentFamily(name)) && (list ?? []).some(e => e.equip && SIEGE.has(equipmentFamily(e.name)) && equipmentFamily(e.name) !== equipmentFamily(name));
export function equipList(list, name) {
  const piece = equipmentByName(name); if (!piece) return null;
  if (siegeClash(list, name)) return null;
  const kept = (list ?? []).filter(e => !(e.equip && equipmentFamily(e.name) === piece.family));
  return [...kept, { name: piece.name, desc: piece.desc, level: 1, upgrades: [], options: [], chosen: -1, equip: true }];
}
/** A new trait list without that piece. */
export function unequipList(list, name) { return (list ?? []).filter(e => !(e.equip && e.name === name)); }

async function saveList(actor, list) {
  await actor.update({ "system.traitList": list, "system.traits": "" });
  try { (await import("./sheets/sheets.mjs")).resetTraitCatalog(); } catch { /* fine */ }
}
export async function equipUnit(actor, name) {
  if (!game.user.isGM || !actor) return;
  const src = foundry.utils.deepClone(actor._source.system.traitList ?? []);
  if (siegeClash(src, name)) return ui.notifications.warn(`${actor.name} already carries siege equipment: drop it first (a unit carries ladders or an engine, never both).`);
  const list = equipList(src, name); if (!list) return;
  await saveList(actor, list);
  ui.notifications.info(`${actor.name} now carries ${name}.`);
}
export async function unequipUnit(actor, name) {
  if (!game.user.isGM || !actor) return;
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
    if (!game.user.isGM || !actor) return;
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
    return `<div class="qin-eq-wrap">
      <p class="qin-eq-intro">${esc(this.actor.name)} carries one piece per kind; a better piece replaces the one it has.</p>
      ${EQUIPMENT.map(f => {
        const cur = have.get(f.family);
        const blocked = !cur && SIEGE.has(f.family) && [...have.keys()].some(k => SIEGE.has(k));
        return `<section class="qin-eq-fam ${cur ? "has" : ""} ${blocked ? "blocked" : ""}"><h4>${esc(f.family)}${cur ? ` <span class="qin-eq-cur">carrying ${esc(cur)}</span>` : ""}</h4>
          <div class="qin-eq-tiers">${f.tiers.map(t => `<button type="button" class="qin-eq-tier ${cur === t.name ? "on" : ""}" ${blocked ? "disabled" : ""} data-action="${cur === t.name ? "unequip" : "equip"}" data-name="${esc(t.name)}" data-tooltip="${esc(blocked ? "Already carrying other siege equipment — a unit carries ladders or an engine, never both." : t.desc)}">
            ${cur === t.name ? `<i class="fa-solid fa-check"></i> ` : ""}${esc(t.name)}</button>`).join("")}</div>
          <div class="qin-eq-desc" data-desc>${esc((f.tiers.find(t => t.name === cur) ?? f.tiers[0]).desc)}</div>
        </section>`; }).join("")}
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
