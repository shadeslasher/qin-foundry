// "Add to Party Officers" (David, 2026-11-01; changed 2026-11-03): the GM makes a copy of a character (or henchman)
// in a world actor folder named "Party Officers". The copy keeps the original's name (no "(Copy)") and every player owns it.
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const FOLDER = "Party Officers";

/** The world's Party Officers actor folder, made if it isn't there yet. */
async function officersFolder() {
  const f = game.folders.find(x => x.type === "Actor" && x.name === FOLDER && !x.folder);
  return f ?? Folder.create({ name: FOLDER, type: "Actor", color: "#7a5a2a", sorting: "a" });
}

/** The copy's data (pure, for tests): no id, same name, in the folder, every player owns it, linked token. */
export function officerCopyData(src, { folderId, sourceUuid, levels }) {
  const data = foundry.utils.deepClone(src);
  delete data._id;
  data.name = String(data.name ?? "").replace(/\s*\(copy\)\s*$/i, "");
  data.folder = folderId;
  data.ownership = { default: levels.OWNER };
  data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true, disposition: 1, name: data.prototypeToken?.name || data.name };
  data.flags = { ...(data.flags ?? {}), qin: { ...(data.flags?.qin ?? {}), officerOf: sourceUuid } };
  return data;
}

export async function addToOfficers(actor) {
  // since 2026-11-08 the party's officers are read-only for the players (the Officers tab of the Party window)
  if (game.user.isGM && actor?.type === "character") return (await import("./officer-codex.mjs")).addToParty(actor.uuid);
  if (!game.user.isGM || !actor) return;
  const already = game.actors.filter(a => a.getFlag("qin", "officerOf") === actor.uuid);
  if (already.length) {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Add to Party Officers" },
      content: `<p>${esc(actor.name)} is already in <b>${FOLDER}</b>. Make another copy?</p>`, rejectClose: false });
    if (!ok) return;
  }
  const folder = await officersFolder();
  const data = officerCopyData(actor.toObject(), { folderId: folder.id, sourceUuid: actor.uuid, levels: CONST.DOCUMENT_OWNERSHIP_LEVELS });
  const copy = await Actor.create(data);
  if (!copy) return ui.notifications.error("The officer couldn't be created.");
  ui.notifications.info(`${copy.name} added to ${FOLDER}; every player owns it.`);
  return copy;
}
