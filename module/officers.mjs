// "Add to Officers" (David, 2026-11-01): the GM makes a copy of a character (or henchman) in a world folder named
// "Officers" that every player can see, owned by the player the GM picks, who can then control it.
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const FOLDER = "Officers";

/** The world's Officers actor folder, made if it isn't there yet. */
async function officersFolder() {
  const f = game.folders.find(x => x.type === "Actor" && x.name === FOLDER && !x.folder);
  return f ?? Folder.create({ name: FOLDER, type: "Actor", color: "#7a5a2a", sorting: "a" });
}

/** The copy's data (pure, for tests): no id, in the folder, everyone may look, the chosen player owns it. */
export function officerCopyData(src, { folderId, userId, sourceUuid, levels }) {
  const data = foundry.utils.deepClone(src);
  delete data._id;
  data.folder = folderId;
  data.ownership = { default: levels.OBSERVER };
  if (userId) data.ownership[userId] = levels.OWNER;
  data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true, disposition: 1 };
  data.flags = { ...(data.flags ?? {}), qin: { ...(data.flags?.qin ?? {}), officerOf: sourceUuid } };
  return data;
}

export async function addToOfficers(actor) {
  if (!game.user.isGM || !actor) return;
  const players = game.users.filter(u => !u.isGM);
  const already = game.actors.filter(a => a.getFlag("qin", "officerOf") === actor.uuid);
  const options = [`<option value="">No one yet (GM only controls it)</option>`, ...players.map(u => `<option value="${u.id}">${esc(u.name)}${u.character ? ` (${esc(u.character.name)})` : ""}</option>`)].join("");
  const content = `<p>Copy <b>${esc(actor.name)}</b> into the <b>${FOLDER}</b> folder, where every player can see it.</p>
    <label style="display:flex;gap:8px;align-items:center">Owned by <select name="owner">${options}</select></label>
    ${already.length ? `<p class="qin-muted">There ${already.length === 1 ? "is already a copy" : `are already ${already.length} copies`} of this character in the folder.</p>` : ""}`;
  const D = foundry.applications.api.DialogV2;
  const owner = await D.prompt({
    window: { title: "Add to Officers" }, content,
    ok: { label: "Add to Officers", icon: "fa-solid fa-user-plus", callback: (ev, button) => button.form.elements.owner.value },
    rejectClose: false,
  });
  if (owner === null || owner === undefined) return;
  const folder = await officersFolder();
  const data = officerCopyData(actor.toObject(), { folderId: folder.id, userId: owner || null, sourceUuid: actor.uuid, levels: CONST.DOCUMENT_OWNERSHIP_LEVELS });
  const copy = await Actor.create(data);
  if (!copy) return ui.notifications.error("The officer couldn't be created.");
  const who = owner ? game.users.get(owner)?.name : null;
  ui.notifications.info(`${copy.name} added to Officers${who ? `, owned by ${who}` : ""}.`);
  return copy;
}
