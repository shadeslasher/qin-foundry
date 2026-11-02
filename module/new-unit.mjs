// "New unit" (GM): make a battlefield unit owned by one of the players, from an existing unit or a blank one,
// kept in the Actors directory (a folder per player) so their army is tracked between battles.

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const SIDES = { player: "Player", ally: "Ally", enemy: "Enemy", neutral: "Neutral" };

/** The battle units' three armies (anything else is listed after them as "Other"). */
export const ARMIES = ["Han", "Bandits", "Yellow Turbans", "Qiang", "Northern", "Cao Cao", "Wei", "Xiongnu", "Xianbei", "Song", "Xiliang", "Mercenary", "Wu", "Yuan Shu", "Gongsun Zan", "Lu Bu", "Liu Bei", "Liu Biao", "Liu Yan", "Kong Rong", "Tao Qian", "Lu Zhi", "Yan Baihu", "Liu Chong", "Imperial", "Other"];
export function factionGroup(f) {
  const k = String(f ?? "").toLowerCase();
  if (/yellow|turban/.test(k)) return "Yellow Turbans";
  if (/bandit|zhang-yan|black.?mountain/.test(k)) return "Bandits";
  if (/qiang/.test(k)) return "Qiang"; // Qiang units (David, 2026-10-31)
  if (/northern/.test(k)) return "Northern"; // Northern units (David, 2026-10-31)
  if (/cao.?cao/.test(k)) return "Cao Cao"; // Cao Cao's units, e.g. the Qingzhou (David, 2026-10-31)
  if (/^wei\b/.test(k)) return "Wei"; // Wei: Tiger and Leopard Cavalry, Tiger Cubs (David, 2026-10-31)
  if (/xiongnu/.test(k)) return "Xiongnu"; // Xiongnu: Xiongnu Cavalry, Cataphracts, Noble Cavalry (David, 2026-11-01)
  if (/xianbei/.test(k)) return "Xianbei"; // Xianbei: Xianbei Riders, Xianbei Horse Archers (David, 2026-11-01)
  if (/^song\b/.test(k)) return "Song"; // Song: Yuan Shao's units (David, 2026-11-01)
  if (/xiliang/.test(k)) return "Xiliang"; // Xiliang: Dong Zhuo's cavalry (David, 2026-11-01)
  if (/mercenar/.test(k)) return "Mercenary"; // Mercenary units: never gain XP (David, 2026-11-01)
  if (/^wu\b/.test(k)) return "Wu"; // Wu: Sun Jian / Sun Ce units (David, 2026-11-01)
  if (/yuan.?shu/.test(k)) return "Yuan Shu"; // Yuan Shu's units (David, 2026-11-01)
  if (/gongsun|white.?horse/.test(k)) return "Gongsun Zan"; // Gongsun Zan's White Horse units (David, 2026-11-01)
  if (/lu.?bu/.test(k)) return "Lu Bu"; // Lu Bu's units (David, 2026-11-01)
  if (/liu.?bei|^yi\b/.test(k)) return "Liu Bei"; // Liu Bei's units (David, 2026-11-01)
  if (/liu.?biao/.test(k)) return "Liu Biao"; // Liu Biao's units (David, 2026-11-01)
  if (/liu.?yan|dongzhou/.test(k)) return "Liu Yan"; // Liu Yan's units (David, 2026-11-01)
  if (/kong.?rong|beihai|jian.?an/.test(k)) return "Kong Rong"; // Kong Rong's units (David, 2026-11-02)
  if (/tao.?qian|territorial/.test(k)) return "Tao Qian"; // Tao Qian's units (David, 2026-11-02)
  if (/\blu.?zhi|destroyer|defenders.of.the.empire/.test(k)) return "Lu Zhi"; // Lu Zhi's units (David, 2026-11-02)
  if (/yan.?baihu|^yue\b/.test(k)) return "Yan Baihu"; // Yan Baihu's units (David, 2026-11-02)
  if (/liu.?chong|^chen\b/.test(k)) return "Liu Chong"; // Liu Chong's units (David, 2026-11-02)
  if (/^imperial$|imperial-guard|imperial-army/.test(k)) return "Imperial"; // the Imperial units, recruited only with explicit leave (David, 2026-11-01)
  if (/^han\b|han-empire|^han$/.test(k)) return "Han";
  return "Other";
}

/** Units to start from: the units in Actor compendiums (e.g. Three Kingdoms Battle Units). */
export async function templates() {
  const info = (sys) => ({ category: sys?.category ?? "infantry", tier: Number(sys?.tier) || 99, faction: factionGroup(sys?.faction), cost: Number(sys?.cost) || 0,
    damage: Number(sys?.damage) || 0, pen: Number(sys?.armorPen) || 0, armor: Number(sys?.armor) || 0 });
  const out = []; // compendium units only (copies already in the world aren't offered as templates)
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    let index;
    try { index = await pack.getIndex({ fields: ["type", "img", "prototypeToken.texture.src", "system.category", "system.tier", "system.faction", "system.cost", "system.damage", "system.armorPen", "system.armor"] }); } catch { continue; }
    for (const e of index) if (e.type === "unit") out.push({ id: e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`, name: e.name, img: e.prototypeToken?.texture?.src || e.img, world: false, ...info(e.system) });
  }
  return out;
}

const TYPES = [["infantry", "Infantry", "Inf"], ["ranged", "Ranged", "Rng"], ["cavalry", "Cavalry", "Cav"]];
const typeKey = (t) => (TYPES.some(([k]) => k === t.category) ? t.category : "infantry");
export const DRAG_TYPE = "QinNewUnit";

/** The window's frame; the list, chips and selected card are filled in by the app (2026-11-02 redesign: layout C). */
function shellHTML(armies) {
  const players = game.users.filter(u => !u.isGM);
  const ownerOpts = `<option value="">GM only</option>` + players.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
  const chars = (game.actors?.contents ?? []).filter(a => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
  const officerOpts = `<option value="">None</option>` + chars.map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("");
  const sideOpts = Object.entries(SIDES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  const armyOpts = armies.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  return `<form class="qin-nu">
    <div class="qin-nu-top">
      <div class="qin-nu-row">
        <select name="army" aria-label="Army" class="qin-nu-army">${armyOpts}</select>
        <label class="qin-nu-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" name="search" placeholder="Search" aria-label="Search units" autocomplete="off"></label>
      </div>
      <div class="qin-nu-chips" data-chips></div>
    </div>
    <div class="qin-nu-list" data-list></div>
    <div class="qin-nu-foot">
      <div class="qin-nu-sel">
        <img data-sel-img src="icons/svg/combat.svg" alt="">
        <div class="qin-nu-sel-text">
          <input type="text" name="name" aria-label="Name" placeholder="Pick a unit, or drag one onto the map">
          <div class="qin-nu-traits" data-sel-traits></div>
        </div>
      </div>
      <div class="qin-nu-grid">
        <label>Owner<select name="owner">${ownerOpts}</select></label>
        <label>Side<select name="side">${sideOpts}</select></label>
        <label>Officer<select name="officer">${officerOpts}</select></label>
      </div>
      <button type="submit" data-create class="qin-nu-create"><i class="fa-solid fa-check"></i> Create unit</button>
      <p class="qin-nu-hint" data-tooltip="Player units go in &quot;Player Units&quot; under their owner (or &quot;No owner&quot;); enemy, ally and neutral units go in &quot;Enemy Units&quot;, &quot;Ally Units&quot; or &quot;Neutral Units&quot;. Dragging a unit onto the map makes it with these settings and places it there.">Drag a unit onto the map to place it there <i class="fa-regular fa-circle-question"></i></p>
    </div>
  </form>`;
}

/** The New unit window (GM). Stays open after each unit is created; units can be dragged straight onto the map. */
export class NewUnitApp extends foundry.applications.api.ApplicationV2 {
  static #inst = null;
  static DEFAULT_OPTIONS = {
    id: "qin-new-unit", classes: ["qin-newunit-app"],
    window: { title: "New unit", icon: "fa-solid fa-people-group", resizable: true },
    position: { width: 480, height: 720 },
  };
  /** Open it, or bring it to the front if it's already open. */
  static open() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can create units this way.");
    const app = (this.#inst ??= new NewUnitApp());
    if (app.rendered) { app.bringToFront?.(); return app; }
    app.render({ force: true });
    return app;
  }
  /** The open window, if any (the map drop reads its Owner / Side / Officer). */
  static get instance() { return this.#inst?.rendered ? this.#inst : null; }

  state = { army: null, search: "", tier: 0, type: "", selected: "" };

  async _renderHTML() {
    this.list = await templates();
    const have = new Set(this.list.map(t => t.faction));
    this.armies = ARMIES.filter(a => have.has(a));
    if (!this.state.army || !have.has(this.state.army)) this.state.army = this.armies[0] ?? "Other";
    return shellHTML(this.armies);
  }

  /** The current Owner / Side / Officer / Name choices. */
  settings() {
    const form = this.element?.querySelector("form.qin-nu"); if (!form) return {};
    const f = Object.fromEntries(new FormData(form).entries());
    return { owner: f.owner || "", side: f.side || "player", officer: f.officer || "", name: f.name || "" };
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form.qin-nu");
    this.form = form;
    form.army.value = this.state.army;
    form.search.value = this.state.search;
    form.army.addEventListener("change", () => { this.state.army = form.army.value; this.state.tier = 0; this.#draw(); });
    form.search.addEventListener("input", () => { this.state.search = form.search.value; this.#draw(); });
    const owner = form.owner, side = form.side, off = form.officer;
    owner.addEventListener("change", () => { off.value = ""; if (game.users.get(owner.value)) side.value = "player"; });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!this.state.selected) return ui.notifications.warn("Pick a unit first (or drag one onto the map).");
      const btn = form.querySelector("[data-create]");
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const actor = await createUnit({ template: this.state.selected, ...this.settings() });
        if (actor) form.name.value = ""; // keep the other choices for the next one
      } catch (err) {
        console.error("Qin | New unit failed", err);
        ui.notifications.error(`The unit couldn't be created: ${err.message}`);
      } finally { btn.disabled = false; }
    });
    this.#draw();
    this.#showSelected();
  }

  /** Units of the chosen army that pass the search and the tier / type chips. */
  #visible() {
    const q = this.state.search.trim().toLowerCase();
    return this.list.filter(t => t.faction === this.state.army
      && (!this.state.tier || t.tier === this.state.tier)
      && (!this.state.type || typeKey(t) === this.state.type)
      && (!q || t.name.toLowerCase().includes(q)));
  }

  #draw() {
    const form = this.form; if (!form) return;
    const inArmy = this.list.filter(t => t.faction === this.state.army);
    const tiers = [...new Set(inArmy.map(t => t.tier).filter(t => t < 99))].sort((a, b) => a - b);
    const types = TYPES.filter(([k]) => inArmy.some(t => typeKey(t) === k));
    const chip = (label, on, attrs, aria = "") => `<button type="button" class="qin-nu-chip${on ? " on" : ""}" ${attrs}${aria ? ` aria-label="${aria}"` : ""} aria-pressed="${on}">${label}</button>`;
    form.querySelector("[data-chips]").innerHTML =
      chip("All tiers", !this.state.tier, `data-tier="0"`) + tiers.map(t => chip(`T${t}`, this.state.tier === t, `data-tier="${t}"`)).join("") +
      `<span class="qin-nu-gap"></span>` + types.map(([k, label, short]) => chip(short, this.state.type === k, `data-type="${k}"`, label)).join("");
    for (const b of form.querySelectorAll("[data-tier]")) b.addEventListener("click", () => { this.state.tier = Number(b.dataset.tier); this.#draw(); });
    for (const b of form.querySelectorAll("[data-type]")) b.addEventListener("click", () => { this.state.type = this.state.type === b.dataset.type ? "" : b.dataset.type; this.#draw(); });

    const vis = this.#visible();
    const rows = TYPES.flatMap(([k, label]) => {
      const ts = vis.filter(t => typeKey(t) === k).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
      if (!ts.length) return [];
      return [`<div class="qin-nu-head">${label}<span>dmg / pen / armor · cost</span></div>`, ...ts.map(t => `
        <button type="button" class="qin-nu-unit${t.id === this.state.selected ? " on" : ""}" draggable="true" data-uuid="${esc(t.id)}" data-tooltip="Click to pick · drag onto the map to place">
          <img src="${esc(t.img)}" alt="">
          <span class="qin-nu-name">${esc(t.name)}</span>
          ${t.tier < 99 ? `<span class="qin-nu-tier t${t.tier}">T${t.tier}</span>` : ""}
          <span class="qin-nu-stats">${t.damage} / ${t.pen} / ${t.armor}</span>
          <span class="qin-nu-cost">${t.cost || "–"}</span>
        </button>`)];
    });
    const list = form.querySelector("[data-list]");
    list.innerHTML = rows.length ? rows.join("") : `<p class="qin-nu-empty">No units match.</p>`;
    for (const el of list.querySelectorAll(".qin-nu-unit")) {
      el.addEventListener("click", () => this.#select(el.dataset.uuid));
      el.addEventListener("dragstart", (ev) => {
        this.#select(el.dataset.uuid);
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, template: el.dataset.uuid }));
        const img = el.querySelector("img"); if (img) ev.dataTransfer.setDragImage(img, 18, 18);
      });
    }
  }

  async #select(uuid) {
    if (this.state.selected === uuid) return;
    this.state.selected = uuid;
    for (const el of this.form?.querySelectorAll(".qin-nu-unit") ?? []) el.classList.toggle("on", el.dataset.uuid === uuid);
    if (this.form?.name) this.form.name.value = "";
    this.#showSelected();
  }

  async #showSelected() {
    const form = this.form; if (!form) return;
    const t = this.list.find(x => x.id === this.state.selected);
    form.querySelector("[data-sel-img]").src = t?.img || "icons/svg/combat.svg";
    form.name.placeholder = t ? t.name : "Pick a unit, or drag one onto the map";
    const tr = form.querySelector("[data-sel-traits]");
    if (!t) { tr.textContent = ""; return; }
    tr.textContent = `${t.faction} · ${t.tier < 99 ? `Tier ${t.tier} · ` : ""}${t.cost || 0}`;
    const doc = await fromUuid(t.id).catch(() => null);
    if (this.state.selected !== t.id || !doc) return;
    const names = (doc.system?.traitList ?? []).filter(x => !x.equip && (x.level ?? 1) <= 1 && !(x.options?.length)).map(x => x.name).filter(Boolean);
    if (names.length) tr.textContent = `${t.faction} · ${t.tier < 99 ? `Tier ${t.tier} · ` : ""}${t.cost || 0} · ${names.join(", ")}`;
  }
}

export function newUnitDialog() { return NewUnitApp.open(); }

/** Make a unit from the template with the window's choices and put its token where it was dropped. */
export async function placeNewUnit(template, scene, x, y) {
  const opts = NewUnitApp.instance?.settings() ?? {};
  const actor = await createUnit({ template, ...opts });
  if (!actor) return;
  const tl = canvas.grid?.getTopLeftPoint?.({ x, y }) ?? { x: Math.floor(x / scene.grid.size) * scene.grid.size, y: Math.floor(y / scene.grid.size) * scene.grid.size };
  const td = await actor.getTokenDocument({ x: tl.x, y: tl.y });
  await scene.createEmbeddedDocuments("Token", [td.toObject()]);
  const form = NewUnitApp.instance?.form; if (form?.name) form.name.value = "";
  return actor;
}

/** GM: a unit dragged from the New unit window onto the map. */
export function registerNewUnitDrop() {
  Hooks.on("dropCanvasData", (cv, data) => {
    if (data?.type !== DRAG_TYPE) return;
    if (!game.user.isGM || !cv.scene) return false;
    placeNewUnit(data.template, cv.scene, data.x, data.y).catch(err => { console.error("Qin | New unit drop failed", err); ui.notifications.error(`The unit couldn't be placed: ${err.message}`); });
    return false;
  });
}

const findFolder = (name, parent) => game.folders.find(f => f.type === "Actor" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));

/** Enemy, ally and neutral units each get one folder at the top of the Actors directory (made when first needed). */
const SIDE_FOLDERS = { enemy: { name: "Enemy Units", color: "#c8443a" }, ally: { name: "Ally Units", color: "#3fa66a" }, neutral: { name: "Neutral Units", color: "#d4a017" } };
async function sideFolder(side) {
  const f = SIDE_FOLDERS[side]; if (!f) return null;
  return findFolder(f.name, null) ?? await Folder.create({ name: f.name, type: "Actor", sorting: "a", color: f.color });
}

/** The owner's folder: "Player Units" / "<player>'s units", or "Player Units" / "No owner" for a unit nobody owns yet (made when first needed). */
async function ownerFolder(userId) {
  const user = userId ? game.users.get(userId) : null;
  const find = findFolder;
  const top = find("Player Units", null) ?? await Folder.create({ name: "Player Units", type: "Actor", sorting: "a" });
  if (!user) return find("No owner", top) ?? await Folder.create({ name: "No owner", type: "Actor", folder: top.id, sorting: "a", color: "#808080" });
  const name = `${user.name}'s units`;
  return find(name, top) ?? await Folder.create({ name, type: "Actor", folder: top.id, sorting: "a", color: user.color?.css ?? user.color ?? null });
}

export async function createUnit({ template, name, owner, side, officer }) {
  let data;
  if (template) {
    const src = await fromUuid(template);
    if (!src) return ui.notifications.error("That unit couldn't be found.");
    data = src.toObject();
    delete data._id; delete data.folder; delete data.sort; delete data._stats;
  } else data = { type: "unit", name: "New unit", img: "icons/svg/combat.svg", system: {} };
  data.name = (name || "").trim() || data.name;
  data.ownership = { default: 0, ...(owner ? { [owner]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } : {}) };
  data.system = { ...(data.system ?? {}), side: side || "player", officer: officer || "" };
  // a player's unit keeps its health, morale and XP on the actor between battles
  data.prototypeToken = { ...(data.prototypeToken ?? {}), name: data.name, actorLink: !!owner || !!data.prototypeToken?.actorLink,
    disposition: side === "enemy" ? CONST.TOKEN_DISPOSITIONS.HOSTILE : side === "neutral" ? CONST.TOKEN_DISPOSITIONS.NEUTRAL : CONST.TOKEN_DISPOSITIONS.FRIENDLY };
  // enemy, ally and neutral units go in their side's folder; player units in their owner's folder
  const folder = SIDE_FOLDERS[side] ? await sideFolder(side) : await ownerFolder(owner);
  data.folder = folder?.id ?? null;
  // remember the template, so the Unit Editor can update this copy later
  if (template) data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [game.system.id]: { template } });
  const actor = await Actor.create(data);
  if (!actor) return;
  ui.notifications.info(`Created ${actor.name}${folder ? ` in ${folder.name}` : ""}.`);
  return actor;
}

export const NEW_UNIT_TOOL = {
  name: "qinNewUnit", title: "New unit (owned by a player)", icon: "fa-solid fa-people-group", order: 98,
  button: true, visible: true, onChange: () => newUnitDialog(),
};
