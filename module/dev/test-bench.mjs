// Animation test bench (David, 2026-11-11): a permanent battle scene for trying out and recording battlefield skill
// animations. GM only. The layout (which units, where) is passed in, so the system holds no campaign content:
//
//   await game.qin.testBench.setup(layout)              // once: builds the scene, its folder and its units
//   await game.qin.testBench.reset({ officer })         // puts that officer on the officer unit, starts a battle on its turn
//   await game.qin.testBench.recordSkill({ officer, dir }) // ends the battle afterwards // reset, then record the officer's battlefield active
//
// layout: { name, background, cols, rows, grid = 100, folder, camera: { x, y, scale },
//           units: [{ key, pack, id, x, y, side, strength = 1, morale = 70, faction = "", officerSlot = false }] }
// `officer`: an Actor UUID (a world actor, or a compendium one, which is imported into the bench's folder once).
import { record } from "./recorder.mjs";

const FLAG = "bench";
const wait = (ms) => new Promise(r => setTimeout(r, ms));
/** Keep the canvas ticking while we wait (a hidden browser tab doesn't run its animation frames). */
async function pump(ms) {
  const iv = setInterval(() => { try { canvas.app.ticker.update(performance.now()); } catch { /* no canvas */ } }, 16);
  try { await wait(ms); } finally { clearInterval(iv); }
}
export function benchScene() { return game.scenes.find(s => s.getFlag("qin", FLAG)); }
const req = (action) => game.qin.battleRequest(action);

/** Build (or rebuild) the bench scene, folder and units from a layout. */
export async function setup(layout) {
  if (!game.user?.isGM) throw new Error("Only the GM can set up the test bench");
  const g = layout.grid ?? 100;
  let scene = benchScene();
  if (!scene) scene = await Scene.create({ name: layout.name ?? "Animation Test Bench", width: (layout.cols ?? 20) * g, height: (layout.rows ?? 12) * g, padding: 0, grid: { size: g, type: 1 }, navigation: false });
  const level = scene.levels?.contents?.[0];
  if (layout.background) {
    if (level) await level.update({ "background.src": layout.background });
    else await scene.update({ "background.src": layout.background });
  }
  let folder = game.folders.find(f => f.type === "Actor" && f.getFlag("qin", FLAG));
  if (!folder) folder = await Folder.create({ name: layout.folder ?? "Animation Test Bench", type: "Actor", flags: { qin: { [FLAG]: true } } });
  // old units out, new ones in
  const old = scene.getFlag("qin", FLAG)?.map ?? {};
  await scene.deleteEmbeddedDocuments("Token", scene.tokens.map(t => t.id));
  const oldActors = Object.values(old).map(m => m.actor).filter(id => game.actors.get(id));
  if (oldActors.length) await Actor.deleteDocuments(oldActors);
  const map = {}, tokens = [];
  for (const u of layout.units) {
    const pack = game.packs.get(u.pack);
    const a = await game.actors.importFromCompendium(pack, u.id, { folder: folder.id });
    map[u.key] = { actor: a.id };
    const td = (await a.getTokenDocument({ x: u.x * g, y: u.y * g, actorLink: true, disposition: u.side === "enemy" ? -1 : 1 })).toObject();
    if (level) td.level = level.id; // the scene's own level (a token made while another scene is viewed takes that one's)
    td.flags = { ...(td.flags ?? {}), qin: { ...(td.flags?.qin ?? {}), benchKey: u.key } };
    tokens.push(td);
  }
  const made = await scene.createEmbeddedDocuments("Token", tokens);
  for (const t of made) map[t.getFlag("qin", "benchKey")].token = t.id;
  await scene.setFlag("qin", FLAG, { layout, map });
  return scene;
}

/** The officer actor to put on the slot: a world actor as it is, a compendium actor imported once into the bench folder. */
async function officerActor(uuid) {
  if (!uuid) return null;
  if (!uuid.startsWith("Compendium.")) return fromUuid(uuid);
  const folder = game.folders.find(f => f.type === "Actor" && f.getFlag("qin", FLAG));
  const have = game.actors.find(a => a.getFlag("qin", "benchSource") === uuid);
  if (have) return have;
  const src = await fromUuid(uuid);
  const data = game.actors.fromCompendium(src);
  data.folder = folder?.id ?? null;
  data.flags = { ...(data.flags ?? {}), qin: { ...(data.flags?.qin ?? {}), benchSource: uuid } };
  return Actor.create(data);
}

/** Reset the bench: every unit back in place at full strength, the officer (if any) on the officer unit, a fresh battle
 *  started and, with an officer, his unit's turn begun. Returns { scene, unitId }. */
export async function reset({ officer = null, view = true } = {}) {
  const scene = benchScene();
  if (!scene) throw new Error("No test bench: run setup(layout) first");
  const { layout, map } = scene.getFlag("qin", FLAG);
  const g = layout.grid ?? 100;
  if (view && canvas.scene?.id !== scene.id) { await scene.view(); await pump(1500); }
  if (game.settings.get("qin", "battle")?.active) await req({ type: "endBattle" });
  document.querySelectorAll(".qin-ab, .qin-act-dim").forEach(e => e.remove());
  const off = await officerActor(officer);
  let slotToken = null;
  const tokUpd = [];
  for (const u of layout.units) {
    const m = map[u.key], a = game.actors.get(m.actor); if (!a) continue;
    const max = a.system.men?.max || 100;
    await a.update({ "system.side": u.side ?? "player", "system.faction": (u.officerSlot && off?.system?.faction) || u.faction || a.system.faction || "", "system.men.value": Math.round(max * (u.strength ?? 1)),
      "system.morale": u.morale ?? 70, "system.status": "active", "system.officer": u.officerSlot ? (off?.uuid ?? "") : (a.system.officer ?? "") });
    tokUpd.push({ _id: m.token, x: u.x * g, y: u.y * g, hidden: false, disposition: u.side === "enemy" ? -1 : 1 });
    if (u.officerSlot) slotToken = m.token;
  }
  await scene.updateEmbeddedDocuments("Token", tokUpd);
  if (layout.camera) canvas.pan(layout.camera);
  let r = await req({ type: "startBattle", sceneId: scene.id }); if (!r?.ok) throw new Error("startBattle: " + r?.error);
  r = await req({ type: "skipTactics" }); if (!r?.ok) throw new Error("skipTactics: " + r?.error);
  await pump(2500); // the round starts itself
  if (off && slotToken) {
    r = await req({ type: "decide", unitId: slotToken, choice: "act" }); if (!r?.ok) throw new Error("decide: " + r?.error);
    // full morale for the officer's unit, so any skill's morale cost can be paid (a battle start resets morale)
    await scene.tokens.get(slotToken)?.actor?.update({ "system.morale": 100 });
  }
  canvas.tokens?.releaseAll?.();
  await pump(1200);
  return { scene, unitId: slotToken };
}

/** Reset with this officer, then record his battlefield active (with `picks` for skills that need them). */
export async function recordSkill({ officer, picks = null, name = null, endBattle = true, ...opts } = {}) {
  const { unitId } = await reset({ officer });
  const off = await officerActor(officer);
  try {
    return await record({ name: name ?? `skill-${(off?.name ?? "officer").replace(/[^A-Za-z0-9]+/g, "-")}`, ...opts,
      start: () => req({ type: "useSkill", unitId, ...(picks ? { picks } : {}) }) });
  } finally {
    // the battle is world-wide: don't leave the bench's battle running
    if (endBattle && game.settings.get("qin", "battle")?.active) await req({ type: "endBattle" });
  }
}
