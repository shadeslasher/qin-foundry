// "New unit" (GM): make a battlefield unit owned by one of the players, from an existing unit or a blank one,
// kept in the Actors directory (a folder per player) so their army is tracked between battles.

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const SIDES = { player: "Player", ally: "Ally", enemy: "Enemy", neutral: "Neutral" };

/** Units to start from: the world's unit actors, then units in Actor compendiums (e.g. Three Kingdoms Battle Units). */
async function templates() {
  const out = (game.actors?.contents ?? []).filter(a => a.type === "unit").map(a => ({ id: a.uuid, name: a.name, group: "In this world" }));
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    let index;
    try { index = await pack.getIndex({ fields: ["type"] }); } catch { continue; }
    for (const e of index) if (e.type === "unit") out.push({ id: e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`, name: e.name, group: pack.title });
  }
  return out;
}

export async function newUnitDialog() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can create units this way.");
  const players = game.users.filter(u => !u.isGM);
  const list = await templates();
  const groups = {};
  for (const t of list) (groups[t.group] ??= []).push(t);
  const unitOpts = `<option value="">Blank unit</option>` + Object.entries(groups).map(([g, ts]) =>
    `<optgroup label="${esc(g)}">${ts.sort((a, b) => a.name.localeCompare(b.name)).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</optgroup>`).join("");
  const ownerOpts = `<option value="">No player (GM only)</option>` + players.map(u => `<option value="${u.id}">${esc(u.name)}${u.character ? ` (${esc(u.character.name)})` : ""}</option>`).join("");
  const chars = (game.actors?.contents ?? []).filter(a => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
  const officerOpts = `<option value="">No officer</option>` + chars.map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("");
  const sideOpts = Object.entries(SIDES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  const content = `<div class="qin-newunit">
    <div class="form-group"><label>Unit</label><select name="template">${unitOpts}</select></div>
    <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Same as the unit"></div>
    <div class="form-group"><label>Owner</label><select name="owner">${ownerOpts}</select></div>
    <div class="form-group"><label>Side</label><select name="side">${sideOpts}</select></div>
    <div class="form-group"><label>Officer</label><select name="officer">${officerOpts}</select></div>
    <p class="qin-muted">The unit goes in the Actors directory: player units in a folder for their owner under "Player Units"; enemy, ally and neutral units in "Enemy Units", "Ally Units" or "Neutral Units". Drag it onto a scene when it's needed. Picking an owner also picks their character as officer, if they have one.</p>
  </div>`;
  const DialogV2 = foundry.applications.api.DialogV2;
  const res = await DialogV2.wait({
    window: { title: "New unit", icon: "fa-solid fa-people-group" },
    position: { width: 440 },
    content,
    buttons: [
      { action: "create", label: "Create unit", icon: "fa-solid fa-check", default: true,
        callback: (ev, button) => Object.fromEntries(new FormData(button.form).entries()) },
      { action: "cancel", label: "Cancel" },
    ],
    render: (ev, dialog) => {
      const root = dialog.element ?? ev?.target?.element;
      const owner = root?.querySelector("[name=owner]"), off = root?.querySelector("[name=officer]"), side = root?.querySelector("[name=side]");
      owner?.addEventListener("change", () => {
        const u = game.users.get(owner.value);
        if (u?.character?.type === "character" && off) off.value = u.character.uuid;
        if (side) side.value = u ? "player" : side.value;
      });
    },
    rejectClose: false,
  });
  if (!res || typeof res !== "object") return;
  return createUnit(res);
}

const findFolder = (name, parent) => game.folders.find(f => f.type === "Actor" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));

/** Enemy, ally and neutral units: "Enemy Units", "Ally Units", "Neutral Units" (made when first needed). */
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

async function createUnit({ template, name, owner, side, officer }) {
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
