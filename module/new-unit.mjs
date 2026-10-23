// "New unit" (GM): make a battlefield unit owned by one of the players, from an existing unit or a blank one,
// and optionally place its token on the scene with a click.

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
    <div class="form-group"><label>Place it</label><label class="qin-check"><input type="checkbox" name="place" ${canvas?.ready ? "checked" : "disabled"}> Click a square on this scene to put its token there</label></div>
    <p class="qin-muted">The owner can control the unit and its token. Picking an owner also picks their character as officer, if they have one.</p>
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

async function createUnit({ template, name, owner, side, officer, place }) {
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
  const actor = await Actor.create(data);
  if (!actor) return;
  ui.notifications.info(`Created ${actor.name}${owner ? ` for ${game.users.get(owner)?.name}` : ""}.`);
  if (place && canvas?.ready) placeToken(actor);
  else actor.sheet?.render(true);
  return actor;
}

/** Click a square to put the unit's token there; right-click or Esc to skip. */
function placeToken(actor) {
  const view = canvas.app.view, size = canvas.scene.grid.size;
  const g = new PIXI.Graphics(); g.eventMode = "none";
  (canvas.interface ?? canvas.stage).addChild(g);
  const toWorld = (ev) => canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - view.getBoundingClientRect().left, y: ev.clientY - view.getBoundingClientRect().top });
  const sq = (ev) => { const p = toWorld(ev); return [Math.floor(p.x / size), Math.floor(p.y / size)]; };
  const w = actor.prototypeToken?.width ?? 1, h = actor.prototypeToken?.height ?? 1;
  const move = (ev) => { const [x, y] = sq(ev); g.clear().lineStyle(3, 0x3a78c8, 1).beginFill(0x3a78c8, 0.25).drawRect(x * size, y * size, w * size, h * size).endFill(); };
  const stop = () => {
    document.removeEventListener("pointerdown", down, true); view.removeEventListener("pointermove", move);
    document.removeEventListener("keydown", key, true); view.removeEventListener("contextmenu", block, true);
    if (!g.destroyed) g.destroy();
  };
  const down = async (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) { stop(); return actor.sheet?.render(true); }
    if (ev.button !== 0) return;
    const [x, y] = sq(ev); stop();
    const td = await actor.getTokenDocument({ x: x * size, y: y * size });
    await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); stop(); } };
  const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  document.addEventListener("pointerdown", down, true); view.addEventListener("pointermove", move);
  document.addEventListener("keydown", key, true); view.addEventListener("contextmenu", block, true);
  ui.notifications.info(`Click a square to place ${actor.name}. Right-click or Esc to skip.`);
}

export const NEW_UNIT_TOOL = {
  name: "qinNewUnit", title: "New unit (owned by a player)", icon: "fa-solid fa-people-group", order: 98,
  button: true, visible: true, onChange: () => newUnitDialog(),
};
