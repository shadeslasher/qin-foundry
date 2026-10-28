// Officer duels, step 2 (David, 2026-10-28): when a duel is accepted, the GM's client builds a close-up scene of
// the two officers' squares, puts their character tokens on it with a combat encounter, and brings everyone there.
// When the duel ends (or is called off), everyone goes back to the battle and the close-up is removed.
//
// The close-up is drawn by the map generator (from the Three Kingdoms module) at a high resolution; without it,
// the battle map's own image is cropped and enlarged instead.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { canRedraw, renderWindow, setBackground } from "./maprender.mjs";
import { duelWindow } from "./duel-rules.mjs";

const SETTING = "battle";
const PX = 256;          // pixels a square in the close-up

export const duelScenesOn = () => { try { return game.settings.get(SYSTEM_ID, "duelScenes") !== false; } catch { return true; } };

/** Crop and enlarge the battle scene's own background (no map generator). */
async function cropBackground(scene, win, px) {
  const src = (scene.levels?.size ? scene.levels.contents[0]?.background?.src : null) ?? scene.background?.src;
  if (!src) return null;
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = foundry.utils.getRoute?.(src) ?? src; });
  const g = scene.grid.size, c = document.createElement("canvas");
  c.width = win.w * px; c.height = win.h * px;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#6f8f4a"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, win.x * g, win.y * g, win.w * g, win.h * g, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
}

async function upload(blob, name) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const dir = `worlds/${game.world.id}/battlemaps/duels`;
  for (const d of [`worlds/${game.world.id}/battlemaps`, dir]) { try { await FP.createDirectory("data", d); } catch { /* already there */ } }
  const file = new File([blob], `${name.replace(/[^\w-]+/g, "-")}-${Date.now()}.jpg`, { type: "image/jpeg" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  return res?.path ?? `${dir}/${file.name}`;
}

const officerOf = (scene, unitId) => scene?.tokens.get(unitId)?.actor?.system?.officerActor ?? null;

/** GM: build the close-up for the duel that was just accepted and take everyone there. */
export async function openDuelScene() {
  if (!game.user.isGM || !duelScenesOn()) return;
  const battle = getBattle(), p = battle.duels?.pending;
  if (!p || p.stage !== "fighting" || p.duelSceneId) return;
  const scene = game.scenes.get(battle.sceneId);
  const posOf = (id) => battle.meta?.[id]?.pos ?? (() => { const t = scene?.tokens.get(id); return t ? { x: Math.round(t.x / scene.grid.size), y: Math.round(t.y / scene.grid.size) } : null; })();
  const pa = posOf(p.from), pb = posOf(p.to);
  const A = officerOf(scene, p.from), B = officerOf(scene, p.to);
  if (!scene || !pa || !pb || !A || !B) return ui.notifications.warn("The duel scene couldn't be set up; fight the duel here instead.");
  const note = ui.notifications.info("Setting the scene for the duel…", { permanent: true });
  try {
    const win = duelWindow(pa, pb);
    let blob = null;
    if (canRedraw(scene)) { try { blob = await renderWindow(scene, win, PX); } catch (e) { console.warn("Qin | duel close-up", e); } }
    if (!blob) { try { blob = await cropBackground(scene, win, PX); } catch (e) { console.warn("Qin | duel crop", e); } }
    const name = `Duel: ${A.name} vs ${B.name}`;
    const src = blob ? await upload(blob, `duel-${A.name}-${B.name}`) : null;
    const duel = await Scene.create({
      name, width: win.w * PX, height: win.h * PX, padding: 0, backgroundColor: "#4a5a34",
      grid: { size: PX, type: 1, distance: 5, units: "yd" }, tokenVision: false, fog: { exploration: false },
      navigation: false, flags: { [SYSTEM_ID]: { duelOf: scene.id } },
    });
    if (src) await setBackground(duel, src);
    const place = (actor, pos) => actor.getTokenDocument({ x: (pos.x - win.x) * PX, y: (pos.y - win.y) * PX, width: 1, height: 1, actorLink: true });
    const docs = await Promise.all([place(A, pa), place(B, pb)]);
    const toks = await duel.createEmbeddedDocuments("Token", docs.map(d => d.toObject()));
    const combat = await Combat.create({ scene: duel.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", toks.map(t => ({ tokenId: t.id, sceneId: duel.id, actorId: t.actorId })));
    const b = getBattle();
    if (b.duels?.pending) { b.duels.pending.duelSceneId = duel.id; b.duels.pending.duelCombatId = combat.id; await game.settings.set(SYSTEM_ID, SETTING, b); }
    await duel.activate();
  } catch (e) {
    console.error("Qin | duel scene", e);
    ui.notifications.error(`The duel scene couldn't be set up (${e.message}); fight the duel here instead.`);
  } finally { note?.remove?.(); }
}

/** GM: the duel is over; bring everyone back to the battle and clear the close-up away. */
export async function closeDuelScene(pending) {
  if (!game.user.isGM || !pending?.duelSceneId) return;
  const battle = getBattle();
  try {
    const back = game.scenes.get(battle.sceneId);
    if (back && !back.active) await back.activate();
    const combat = game.combats.get(pending.duelCombatId);
    if (combat) await combat.delete();
    const duel = game.scenes.get(pending.duelSceneId);
    if (duel) await duel.delete();
  } catch (e) { console.warn("Qin | closing the duel scene", e); }
}
