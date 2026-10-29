// Unit Editor (GM): browse unit templates (world units and unit compendiums), open one to change it for good,
// and push the changes onto copies already made from it. Compendium edits are also kept in a world setting,
// so a module update that overwrites its compendium doesn't lose them (they're put back on load).

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const SYS = () => game.system.id;
const EDITS = "unitTemplateEdits";

/** Stats a copy takes from its template ("Update copies"). Health, morale, XP, level and officer stay the copy's own. */
const COPY_FIELDS = ["tier", "category", "unitType", "weaponSkill", "weaponSkill2", "armor", "armorNote", "damage", "armorPen", "move", "range", "rangeMin", "unitValue", "faction"];

export function registerUnitEditor() {
  game.settings.register(SYS(), EDITS, { scope: "world", config: false, type: new foundry.data.fields.ObjectField(), default: {} });
  // remember every change made to a unit inside a compendium
  Hooks.on("updateActor", (actor, changes, opts, userId) => {
    if (userId !== game.user.id || !actor.pack || actor.type !== "unit" || opts?.qinReapply) return;
    const all = foundry.utils.deepClone(game.settings.get(SYS(), EDITS) ?? {});
    const o = actor.toObject();
    all[actor.uuid] = { name: o.name, img: o.img, system: o.system, at: Date.now() };
    game.settings.set(SYS(), EDITS, all);
  });
}

/** On load (GM): put back compendium edits that a module update overwrote. */
export async function reapplyUnitEdits() {
  if (!game.user.isGM) return;
  const all = game.settings.get(SYS(), EDITS) ?? {};
  const fixed = [];
  for (const [uuid, e] of Object.entries(all)) {
    let doc; try { doc = await fromUuid(uuid); } catch { continue; }
    if (!doc) continue;
    const cur = doc.toObject();
    if (cur.name === e.name && cur.img === e.img && foundry.utils.objectsEqual(cur.system, e.system)) continue;
    const pack = game.packs.get(doc.pack), wasLocked = pack?.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await doc.update({ name: e.name, img: e.img, system: e.system }, { qinReapply: true, diff: false, recursive: false });
      fixed.push(e.name);
    } catch (err) { console.warn("Qin | Couldn't restore unit edits for", e.name, err); }
    finally { if (wasLocked) await pack.configure({ locked: true }); }
  }
  if (fixed.length) ui.notifications.info(`Restored your Unit Editor changes to ${fixed.length} compendium unit${fixed.length === 1 ? "" : "s"} (${fixed.join(", ")}). Use "Forget edits" in the Unit Editor to take the compendium's version instead.`, { permanent: true });
}

/** World units made from this template: by the New unit tool, or dragged/imported from the compendium. */
export function copiesOf(uuid) {
  return (game.actors?.contents ?? []).filter(a => a.type === "unit" && a.uuid !== uuid &&
    (a.getFlag(SYS(), "template") === uuid || a._stats?.compendiumSource === uuid || a._stats?.duplicateSource === uuid));
}

async function updateCopies(template) {
  const copies = copiesOf(template.uuid);
  if (!copies.length) return ui.notifications.info(`No copies of ${template.name} in this world.`);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Update copies of ${template.name}?` },
    content: `<p>Give ${copies.length} cop${copies.length === 1 ? "y" : "ies"} of <b>${esc(template.name)}</b> its current stats and traits?</p>
      <p class="qin-muted">${copies.map(c => esc(c.name)).join(", ")}</p>
      <p class="qin-muted">Each copy keeps its own name, health, morale, XP, level, officer and the trait choices it has made.</p>`,
  });
  if (!ok) return;
  const t = template.toObject().system;
  for (const c of copies) {
    const upd = {};
    for (const k of COPY_FIELDS) upd[`system.${k}`] = t[k];
    upd["system.men.max"] = t.men.max;
    if (c.system.men.value > t.men.max) upd["system.men.value"] = t.men.max;
    // trait cards: the template's, keeping choices the copy already made on matching choice cards
    const mine = c._source.system.traitList ?? [];
    upd["system.traitList"] = (t.traitList ?? []).map((e, i) => {
      const m = mine[i], same = m?.options?.length && e.options?.length && m.options.map(o => o.name).join("|") === e.options.map(o => o.name).join("|");
      return same && m.chosen >= 0 ? { ...e, chosen: m.chosen } : e;
    });
    upd["system.traits"] = "";
    await c.update(upd);
  }
  ui.notifications.info(`Updated ${copies.length} cop${copies.length === 1 ? "y" : "ies"} of ${template.name}.`);
}

const Base = foundry.applications.api.ApplicationV2;
export class UnitEditorApp extends Base {
  static #inst;
  static open() { (this.#inst ??= new UnitEditorApp()).render(true); return this.#inst; }
  static DEFAULT_OPTIONS = {
    id: "qin-unit-editor", classes: ["qin", "qin-sheet", "qin-unit-editor"],
    window: { title: "Unit Editor", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 620, height: 680 },
  };
  #filter = "";
  #closed = new Set();

  async #entries() {
    const edits = game.settings.get(SYS(), EDITS) ?? {};
    const groups = [];
    const world = (game.actors?.contents ?? []).filter(a => a.type === "unit" && !a.getFlag(SYS(), "template") && !a._stats?.compendiumSource)
      .map(a => ({ uuid: a.uuid, name: a.name, img: a.img, sys: a.system, copies: copiesOf(a.uuid).length }));
    groups.push({ key: "world", label: "World units", units: world });
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Actor") continue;
      let index; try { index = await pack.getIndex({ fields: ["type", "img", "system.tier", "system.category", "system.damage", "system.armor", "system.armorPen", "system.men", "system.move", "system.range"] }); } catch { continue; }
      const units = index.filter(e => e.type === "unit").map(e => {
        const uuid = e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`;
        return { uuid, name: e.name, img: e.img, sys: e.system ?? {}, copies: copiesOf(uuid).length, edited: !!edits[uuid] };
      });
      if (units.length) groups.push({ key: pack.collection, label: pack.title, units, pack: true });
    }
    return groups;
  }

  async _renderHTML() {
    const f = this.#filter.toLowerCase();
    const groups = await this.#entries();
    const row = (u) => {
      const s = u.sys, stats = `T${s.tier ?? "?"} · ${s.category ?? ""} · ${s.damage ?? "?"}/${s.armor ?? "?"}/${s.armorPen ?? 0} · ${s.men?.max ?? "?"} health · move ${s.move ?? "?"}${(s.range ?? 1) > 1 ? ` · range ${s.range}` : ""}`;
      return `<li data-uuid="${esc(u.uuid)}">
        <img src="${esc(u.img)}" alt="">
        <div class="qin-ue-main"><b>${esc(u.name)}</b>${u.edited ? ` <span class="qin-trait-badge" title="Changed in the Unit Editor">edited</span>` : ""}<span class="qin-muted">${esc(stats)}</span></div>
        <div class="qin-ue-btns">
          <button type="button" data-act="edit" title="Open and change this unit for good"><i class="fa-solid fa-pen"></i> Edit</button>
          <button type="button" data-act="copies" ${u.copies ? "" : "disabled"} title="Give copies already made from it its current stats"><i class="fa-solid fa-clone"></i> Update copies (${u.copies})</button>
          ${u.edited ? `<button type="button" data-act="forget" title="Stop restoring your changes after module updates"><i class="fa-solid fa-eraser"></i></button>` : ""}
        </div></li>`;
    };
    const body = groups.map(g => {
      const units = g.units.filter(u => !f || u.name.toLowerCase().includes(f)).sort((a, b) => (a.sys.tier ?? 0) - (b.sys.tier ?? 0) || a.name.localeCompare(b.name));
      if (!units.length && f) return "";
      const open = f || !this.#closed.has(g.key);
      return `<section class="qin-ue-group${open ? " open" : ""}" data-group="${esc(g.key)}">
        <h3 data-act="toggle"><i class="fa-solid fa-caret-${open ? "down" : "right"}"></i> ${esc(g.label)} <span class="qin-muted">(${units.length})</span></h3>
        ${open ? `<ul class="qin-ue-list">${units.map(row).join("") || `<li class="qin-muted">No units.</li>`}</ul>` : ""}</section>`;
    }).join("");
    return `<div class="qin-ue">
      <div class="qin-ue-top"><input type="search" data-filter placeholder="Find a unit…" value="${esc(this.#filter)}">
        <button type="button" data-act="export" title="Save your compendium changes as a file"><i class="fa-solid fa-file-export"></i> Export edits</button></div>
      <p class="qin-muted">Edit changes the unit itself, so every copy made from now on gets the changes. Units already made from it change only when you press "Update copies".</p>
      ${body}</div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const input = content.querySelector("[data-filter]");
    input?.addEventListener("input", foundry.utils.debounce(() => { this.#filter = input.value; this.render().then(() => { const i = this.element.querySelector("[data-filter]"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250));
    if (!content.dataset.qinWired) { content.dataset.qinWired = "1"; content.addEventListener("click", (ev) => this.#onClick(ev)); }
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act, uuid = el.closest("[data-uuid]")?.dataset.uuid;
    if (act === "toggle") { const k = el.closest("[data-group]").dataset.group; this.#closed.has(k) ? this.#closed.delete(k) : this.#closed.add(k); return this.render(); }
    if (act === "export") {
      const all = game.settings.get(SYS(), EDITS) ?? {};
      if (!Object.keys(all).length) return ui.notifications.info("No compendium units have been changed yet.");
      return foundry.utils.saveDataToFile(JSON.stringify(all, null, 2), "application/json", "qin-unit-edits.json");
    }
    if (!uuid) return;
    if (act === "forget") {
      const all = foundry.utils.deepClone(game.settings.get(SYS(), EDITS) ?? {}); delete all[uuid];
      await game.settings.set(SYS(), EDITS, all); return this.render();
    }
    const doc = await fromUuid(uuid);
    if (!doc) return ui.notifications.error("That unit couldn't be found.");
    if (act === "edit") {
      const pack = doc.pack ? game.packs.get(doc.pack) : null;
      if (pack?.locked) await pack.configure({ locked: false }); // compendium units can only be changed while unlocked
      doc.sheet.render(true);
      if (pack) ui.notifications.info(`Editing ${doc.name} in ${pack.title}. Changes save as you make them.`);
    }
    if (act === "copies") { await updateCopies(doc); this.render(); }
  }
}

export const UNIT_EDITOR_TOOL = {
  name: "qinUnitEditor", title: "Unit Editor", icon: "fa-solid fa-hammer", order: 97,
  button: true, visible: true, onChange: () => UnitEditorApp.open(),
};
