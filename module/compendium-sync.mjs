// Update from compendium (David, 2026-10-26): characters dragged out of a compendium are copies, so a module update
// doesn't reach them. This pulls the latest build from the compendium entry the actor came from, keeping what play
// has changed (damage, Chi, experience, renown, coin) and the equipment it carries.

/** Item types play may change (kept as they are; the compendium's are only added when missing). */
export const KEPT_ITEM_TYPES = new Set(["weapon", "armor", "gear"]);
/** system fields that belong to play, not to the build. */
export const KEPT_SYSTEM_PATHS = ["bol", "chi.value", "experience", "renown", "coin", "wounds", "outOfAction"];

const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split("."); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; };
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The compendium entry an actor came from (Foundry records it when importing or dropping one), or null. */
export function sourceUuid(actor) {
  return actor?._stats?.compendiumSource ?? actor?.flags?.core?.sourceId ?? null;
}

/**
 * What to change on `current` (actor data) to match `source` (compendium entry data).
 * Returns { update, deleteIds, create }: the actor update, embedded items to delete, items to create.
 */
export function planSync(current, source) {
  const system = clone(source.system ?? {});
  for (const p of KEPT_SYSTEM_PATHS) {
    const v = getPath(current.system ?? {}, p);
    if (v !== undefined) setPath(system, p, clone(v));
  }
  const update = { name: source.name, img: source.img, system };
  if (source.prototypeToken) {
    update["prototypeToken.name"] = source.prototypeToken.name ?? source.name;
    const src = source.prototypeToken.texture?.src;
    if (src) update["prototypeToken.texture.src"] = src;
  }
  const curItems = current.items ?? [];
  const deleteIds = curItems.filter(i => !KEPT_ITEM_TYPES.has(i.type)).map(i => i._id);
  const has = (i) => curItems.some(c => c.type === i.type && c.name === i.name);
  const create = (source.items ?? [])
    .filter(i => !KEPT_ITEM_TYPES.has(i.type) || !has(i))
    .map(i => { const d = clone(i); delete d._id; return d; });
  return { update, deleteIds, create };
}

/** Update one world actor from its compendium entry. Returns true if it was updated. */
export async function syncFromCompendium(actor, { quiet = false } = {}) {
  const uuid = sourceUuid(actor);
  if (!uuid) { if (!quiet) ui.notifications.warn(`${actor.name} didn't come from a compendium.`); return false; }
  const src = await fromUuid(uuid);
  if (!src) { if (!quiet) ui.notifications.warn(`Can't find ${actor.name}'s compendium entry any more.`); return false; }
  const plan = planSync(actor.toObject(), src.toObject());
  if (plan.deleteIds.length) await actor.deleteEmbeddedDocuments("Item", plan.deleteIds, { render: false });
  if (plan.create.length) await actor.createEmbeddedDocuments("Item", plan.create, { render: false });
  await actor.update(plan.update, { diff: false, recursive: true });
  if (!quiet) ui.notifications.info(`${actor.name} updated from the compendium.`);
  return true;
}

/** Update every world actor that came from a compendium (optionally only those in one folder). */
export async function syncAllFromCompendium(folder = null) {
  const inFolder = (a) => !folder || a.folder === folder || folder.getSubfolders?.(true)?.includes(a.folder);
  const list = (game.actors?.contents ?? []).filter(a => ["character", "henchman"].includes(a.type) && sourceUuid(a) && inFolder(a));
  if (!list.length) return ui.notifications.info("No characters here came from a compendium.");
  const ok = await (foundry.applications.api.DialogV2).confirm({
    window: { title: "Update from compendium" },
    content: `<p>Update <b>${list.length}</b> character${list.length === 1 ? "" : "s"} to the latest version in the compendium?</p><p>Damage, Chi, experience, renown, coin and equipment are kept. Everything else (aspects, skills, Taos, techniques, unique skills, bio) is replaced.</p>`,
  });
  if (!ok) return;
  let n = 0;
  for (const a of list) { try { if (await syncFromCompendium(a, { quiet: true })) n++; } catch (e) { console.warn("Qin | update from compendium", a.name, e); } }
  ui.notifications.info(`${n} of ${list.length} character${list.length === 1 ? "" : "s"} updated from the compendium.`);
}

/** Hooks: a right-click option on actors and actor folders, and a button at the top of the Actors directory. */
export function registerCompendiumSync() {
  const entryOption = (menu) => menu.push({
    name: "Update from compendium", icon: '<i class="fa-solid fa-cloud-arrow-down"></i>',
    condition: (li) => { const a = game.actors.get(li.dataset?.entryId ?? li.data?.("entryId") ?? li[0]?.dataset?.entryId); return game.user.isGM && !!sourceUuid(a); },
    callback: (li) => { const a = game.actors.get(li.dataset?.entryId ?? li.data?.("entryId") ?? li[0]?.dataset?.entryId); if (a) syncFromCompendium(a); },
  });
  Hooks.on("getActorContextOptions", (app, menu) => entryOption(menu));          // v13+
  Hooks.on("getActorDirectoryEntryContext", (app, menu) => entryOption(menu));   // older
  const folderOption = (menu) => menu.push({
    name: "Update characters from compendium", icon: '<i class="fa-solid fa-cloud-arrow-down"></i>',
    condition: () => game.user.isGM,
    callback: (li) => { const el = li.closest?.("[data-folder-id]") ?? li[0]?.closest?.("[data-folder-id]") ?? li; const f = game.folders.get(el?.dataset?.folderId); syncAllFromCompendium(f ?? null); },
  });
  Hooks.on("getFolderContextOptions", (app, menu) => { if (app?.documentName === "Actor" || app?.constructor?.documentName === "Actor") folderOption(menu); });
  Hooks.on("getActorDirectoryFolderContext", (app, menu) => folderOption(menu));
  Hooks.on("renderActorDirectory", (app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.querySelector(".qin-sync-all")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "qin-sync-all";
    b.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Update characters from compendium';
    b.title = "Pull the latest version of every character that came from a compendium (keeps damage, Chi, experience and equipment)";
    b.addEventListener("click", () => syncAllFromCompendium());
    (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(b);
  });
}
