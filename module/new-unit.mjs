// "New unit" (GM): make a battlefield unit owned by one of the players, from an existing unit or a blank one,
// kept in the Actors directory (a folder per player) so their army is tracked between battles.

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const SIDES = { player: "Player", ally: "Ally", enemy: "Enemy", neutral: "Neutral" };

/** The battle units' three armies (anything else is listed after them as "Other"). */
const ARMIES = ["Han", "Bandits", "Yellow Turbans", "Other"];
function factionGroup(f) {
  const k = String(f ?? "").toLowerCase();
  if (/yellow|turban/.test(k)) return "Yellow Turbans";
  if (/bandit|zhang-yan|black.?mountain/.test(k)) return "Bandits";
  if (/^han\b|han-empire|^han$/.test(k)) return "Han";
  return "Other";
}

/** Units to start from: the world's unit actors, then units in Actor compendiums (e.g. Three Kingdoms Battle Units). */
async function templates() {
  const info = (sys) => ({ category: sys?.category ?? "infantry", tier: Number(sys?.tier) || 99, faction: factionGroup(sys?.faction) });
  const out = (game.actors?.contents ?? []).filter(a => a.type === "unit").map(a => ({ id: a.uuid, name: a.name, world: true, ...info(a.system) }));
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    let index;
    try { index = await pack.getIndex({ fields: ["type", "system.category", "system.tier", "system.faction"] }); } catch { continue; }
    for (const e of index) if (e.type === "unit") out.push({ id: e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`, name: e.name, world: false, ...info(e.system) });
  }
  return out;
}

/** The form's contents (unit list, owners, officers). */
async function formHTML() {
  const players = game.users.filter(u => !u.isGM);
  const list = await templates();
  // grouped by type (Infantry, Ranged Infantry, Cavalry) and army (Han, Bandits, Yellow Turbans), then by tier and name;
  // units made in this world are marked
  const TYPES = [["infantry", "Infantry"], ["ranged", "Ranged Infantry"], ["cavalry", "Cavalry"]];
  const typeOf = (t) => (TYPES.some(([k]) => k === t.category) ? t.category : "infantry");
  const unitOpts = `<option value="">Blank unit</option>` + TYPES.flatMap(([k, label]) => ARMIES.map(army => {
    const ts = list.filter(t => typeOf(t) === k && t.faction === army).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name) || (a.world ? -1 : 1));
    if (!ts.length) return "";
    return `<optgroup label="${label} · ${army}">${ts.map(t => `<option value="${esc(t.id)}">${t.tier < 99 ? `T${t.tier} · ` : ""}${esc(t.name)}${t.world ? " (this world)" : ""}</option>`).join("")}</optgroup>`;
  })).join("");
  const ownerOpts = `<option value="">No player (GM only)</option>` + players.map(u => `<option value="${u.id}">${esc(u.name)}${u.character ? ` (${esc(u.character.name)})` : ""}</option>`).join("");
  const chars = (game.actors?.contents ?? []).filter(a => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
  const officerOpts = `<option value="">No officer</option>` + chars.map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("");
  const sideOpts = Object.entries(SIDES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  return `<form class="dialog-form standard-form qin-newunit">
    <div class="dialog-content">
      <div class="form-group"><label>Unit</label><select name="template">${unitOpts}</select></div>
      <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Same as the unit"></div>
      <div class="form-group"><label>Owner</label><select name="owner">${ownerOpts}</select></div>
      <div class="form-group"><label>Side</label><select name="side">${sideOpts}</select></div>
      <div class="form-group"><label>Officer</label><select name="officer">${officerOpts}</select></div>
      <p class="qin-muted">The unit goes in the Actors directory: player units in a folder for their owner under "Player Units"; enemy, ally and neutral units in "Enemy Units", "Ally Units" or "Neutral Units". Drag it onto a scene when it's needed. This window stays open, so you can make several units in a row.</p>
    </div>
    <footer class="form-footer">
      <button type="submit" data-create><i class="fa-solid fa-check"></i> Create unit</button>
      <button type="button" data-close><i class="fa-solid fa-xmark"></i> Close</button>
    </footer>
  </form>`;
}

/** The New unit window (GM). Stays open after each unit is created. */
export class NewUnitApp extends foundry.applications.api.ApplicationV2 {
  static #inst = null;
  static DEFAULT_OPTIONS = {
    id: "qin-new-unit", classes: ["dialog", "qin-newunit-app"],
    window: { title: "New unit", icon: "fa-solid fa-people-group", resizable: false },
    position: { width: 440, height: "auto" },
  };
  /** Open it, or bring it to the front if it's already open. */
  static open() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can create units this way.");
    const app = (this.#inst ??= new NewUnitApp());
    if (app.rendered) { app.bringToFront?.(); return app; }
    app.render({ force: true });
    return app;
  }
  async _renderHTML() { return formHTML(); }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form");
    const owner = form.querySelector("[name=owner]"), off = form.querySelector("[name=officer]"), side = form.querySelector("[name=side]");
    owner?.addEventListener("change", () => {
      if (off) off.value = ""; // picking an owner starts with no officer; choose one if the unit has one
      if (side && game.users.get(owner.value)) side.value = "player";
    });
    form.querySelector("[data-close]")?.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("[data-create]");
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;
      try {
        const actor = await createUnit(Object.fromEntries(new FormData(form).entries()));
        if (actor) { const name = form.querySelector("[name=name]"); if (name) name.value = ""; } // keep the other choices for the next one
      } catch (err) {
        console.error("Qin | New unit failed", err);
        ui.notifications.error(`The unit couldn't be created: ${err.message}`);
      } finally { if (btn) btn.disabled = false; }
    });
  }
}

export function newUnitDialog() { return NewUnitApp.open(); }

const findFolder = (name, parent) => game.folders.find(f => f.type === "Actor" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));

/** Enemy, ally and neutral units each get one folder at the top of the Actors directory (made when first needed). */
const SIDE_FOLDERS = { enemy: { name: "Enemy Units", color: "#c8443a" }, ally: { name: "Ally Units", color: "#3fa66a" }, neutral: { name: "Neutral Units", color: "#d4a017" } };
async function sideFolder(side) {
  const f = SIDE_FOLDERS[side]; if (!f) return null;
  return findFolder(f.name, null) ?? await Folder.create({ name: f.name, type: "Actor", sorting: "a", color: f.color });
}

/** The owner's folder: "Player Units" / "<player>'s units" (made when first needed). */
async function ownerFolder(userId) {
  const user = game.users.get(userId); if (!user) return null;
  const find = findFolder;
  const top = find("Player Units", null) ?? await Folder.create({ name: "Player Units", type: "Actor", sorting: "a" });
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
  const folder = SIDE_FOLDERS[side] ? await sideFolder(side) : owner ? await ownerFolder(owner) : null;
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
