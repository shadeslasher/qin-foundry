// Officer duels, step 2 (David, 2026-10-28): when a duel is accepted, everyone goes to a person-scale scene the GM
// has set up for the ground the challenged officer stands on (plains, forest, town...). The two officers' tokens
// are placed there with a combat encounter; when the duel ends (or is called off) everyone comes back to the battle
// and the duel tokens and encounter are removed. The scenes themselves (hex grids or not) are the GM's own.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { FLAG as MAP_FLAG, decodeTiles } from "./battlemap.mjs";
import { DUEL_GROUNDS, OLD_GROUND, duelGround, duelSceneFor } from "./duel-rules.mjs";
import { duelZoom, tokenCentre } from "./duel-zoom.mjs";

const SETTING = "battle";
/** How close everyone's view is on the duel scene once the transition ends (David: "should zoom in farther"). */
const DUEL_VIEW_SCALE = 1.1;
export const DUEL_SCENES = "duelScenes"; // { ground: sceneId }

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const sceneMap = () => { try { return game.settings.get(SYSTEM_ID, DUEL_SCENES) || {}; } catch { return {}; } };
const officerOf = (scene, unitId) => scene?.tokens.get(unitId)?.actor?.system?.officerActor ?? null;

/** The battle map square under a unit: { terrain, overlays } (scenes from the map generator), else null. */
function tileUnder(scene, battle, unitId) {
  const pos = battle.meta?.[unitId]?.pos ?? (() => { const t = scene?.tokens.get(unitId); return t ? { x: Math.round(t.x / scene.grid.size), y: Math.round(t.y / scene.grid.size) } : null; })();
  const flag = scene?.getFlag?.(SYSTEM_ID, MAP_FLAG);
  if (!pos || !flag) return null;
  try {
    return decodeTiles(flag)?.[pos.x + "," + pos.y] ?? null;
  } catch { return null; }
}

/** Two spots near the middle of the duel scene, a couple of cells apart (hex or square grids). */
function startSpots(scene) {
  const g = scene.grid, d = scene.dimensions ?? { sceneX: 0, sceneY: 0, sceneWidth: scene.width, sceneHeight: scene.height };
  const cx = d.sceneX + d.sceneWidth / 2, cy = d.sceneY + d.sceneHeight / 2;
  try {
    const o = g.getOffset({ x: cx, y: cy });
    return [g.getTopLeftPoint({ i: o.i, j: o.j - 2 }), g.getTopLeftPoint({ i: o.i, j: o.j + 2 })];   // two cells either side of the middle (David, 2026-11-15)
  } catch {
    const s = g.size ?? 100;
    return [{ x: cx - 2 * s, y: cy - s / 2 }, { x: cx + s, y: cy - s / 2 }];
  }
}

/** GM: send everyone to the duel scene for the challenged officer's ground and set the duel up there. */
export async function openDuelScene() {
  if (!game.user.isGM) return;
  const battle = getBattle(), p = battle.duels?.pending;
  if (!p || p.stage !== "fighting" || p.duelSceneId) return;
  const scene = game.scenes.get(battle.sceneId);
  const ground = duelGround(tileUnder(scene, battle, p.to));
  const duel = game.scenes.get(duelSceneFor(sceneMap(), ground) ?? "");
  if (!duel) {
    ui.notifications.info(`No duel scene is set for ${(DUEL_GROUNDS.find(([k]) => k === ground) ?? [, ground])[1].toLowerCase()}: fight the duel here (Game Settings > Duel scenes).`);
    return;
  }
  const A = officerOf(scene, p.from), B = officerOf(scene, p.to);
  if (!A || !B) return ui.notifications.warn("The duelling officers couldn't be found; fight the duel here instead.");
  try {
    const [sa, sb] = startSpots(duel);
    const docs = await Promise.all([A.getTokenDocument({ x: sa.x, y: sa.y, actorLink: true }), B.getTokenDocument({ x: sb.x, y: sb.y, actorLink: true })]);
    const toks = await duel.createEmbeddedDocuments("Token", docs.map(d => d.toObject()));
    const combat = await Combat.create({ scene: duel.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", toks.map(t => ({ tokenId: t.id, sceneId: duel.id, actorId: t.actorId })));
    const b = getBattle();
    if (b.duels?.pending) {
      Object.assign(b.duels.pending, { duelSceneId: duel.id, duelCombatId: combat.id, duelTokenIds: toks.map(t => t.id) });
      await game.settings.set(SYSTEM_ID, SETTING, b);
    }
    // the Fire Emblem rush-in: on the challenged officer, then the duel settles in between the two (David, 2026-11-15)
    const mid = (() => { const a = tokenCentre(duel, toks[0]?.id), c = tokenCentre(duel, toks[1]?.id); return a && c ? { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } : null; })();
    try { await duelZoom({ from: tokenCentre(scene, p.to), to: mid, toScene: duel.id, toScale: DUEL_VIEW_SCALE }); } catch (e) { console.warn("Qin | duel zoom", e); }
    await duel.activate();
  } catch (e) {
    console.error("Qin | duel scene", e);
    ui.notifications.error(`The duel scene couldn't be set up (${e.message}); fight the duel here instead.`);
  }
}

/** GM: the duel is over; everyone back to the battle; remove the duel tokens and encounter (the scene stays). */
export async function closeDuelScene(pending) {
  if (!game.user.isGM || !pending?.duelSceneId) return;
  const battle = getBattle();
  try {
    const back = game.scenes.get(battle.sceneId);
    if (back && !back.active) {
      const duel = game.scenes.get(pending.duelSceneId), ids = pending.duelTokenIds ?? [];
      const a = tokenCentre(duel, ids[0]), c = tokenCentre(duel, ids[1]);
      try { await duelZoom({ from: a && c ? { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } : null, to: tokenCentre(back, pending.to), toScene: back.id, dir: "out" }); } catch (e) { console.warn("Qin | duel zoom", e); }
      await back.activate();
    }
    const combat = game.combats.get(pending.duelCombatId);
    if (combat) await combat.delete();
    const duel = game.scenes.get(pending.duelSceneId);
    const ids = (pending.duelTokenIds ?? []).filter(id => duel?.tokens.get(id));
    if (duel && ids.length) await duel.deleteEmbeddedDocuments("Token", ids);
  } catch (e) { console.warn("Qin | leaving the duel scene", e); }
}

/** Game Settings > Duel scenes: pick a person-scale scene for each kind of ground. */
export class DuelScenesConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "qin-duel-scenes", classes: ["qin", "qin-duel-scenes"], tag: "form",
    window: { title: "Duel scenes", icon: "fa-solid fa-swords" },
    position: { width: 460, height: "auto" },
    form: { handler: DuelScenesConfig.#save, closeOnSubmit: true },
  };
  async _renderHTML() {
    const map = sceneMap();
    const opts = (sel) => `<option value="">(none)</option>` + game.scenes.contents.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    return `<p class="qin-muted">When a duel is accepted, everyone goes to the scene chosen for the ground the challenged officer stands on, and the two officers are placed there with a combat encounter. "Anything else" covers grounds without their own scene; with nothing chosen, the duel is fought on the battle map.</p>
      ${DUEL_GROUNDS.map(([k, label]) => `<div class="form-group"><label>${esc(label)}</label><select name="${k}">${opts(map[k] ?? map[OLD_GROUND[k]])}</select></div>`).join("")}
      <footer class="form-footer"><button type="submit"><i class="fa-solid fa-floppy-disk"></i> Save</button></footer>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }
  static async #save(event, form, formData) {
    const data = formData.object ?? {};
    const map = {};
    for (const [k] of DUEL_GROUNDS) if (data[k]) map[k] = data[k];
    await game.settings.set(SYSTEM_ID, DUEL_SCENES, map);
  }
}

/* ------------------------------------------------------------------ duel arenas (David, 2026-11-15) */
// "Instead of cropping the scene, make any of the hexes outside the range darkened and create an invisible wall that
// doesn't allow movement outside of it." The arena is every cell within `radius` steps of the scene's middle cell (a big
// hexagon on hex grids, a square on square grids). Outside it a dark overlay tile (an uploaded PNG with the arena cut
// out) and, along its edge, movement-only walls (no sight, light or sound). Run again to change the radius: the old
// overlay and walls (flag qin.duelArena) are replaced.
// `rows`: also keep only cells within that many rows of the middle (David, 2026-11-16: on the city wall the arena stops at
// the wall's edges; Duel – City wall uses rows 3). Running it again without options keeps the scene's saved radius/rows.
export async function makeDuelArena(scene = canvas.scene, opts = {}) {
  const saved = scene?.getFlag?.(SYSTEM_ID, "duelArena") ?? {};
  const { radius = saved.radius ?? 6, darkness = 0.6, rows = saved.rows ?? null } = opts;
  if (!game.user.isGM || !scene) return null;
  const g = scene.grid, d = scene.dimensions ?? { sceneX: 0, sceneY: 0, sceneWidth: scene.width, sceneHeight: scene.height };
  const mid = g.getOffset({ x: d.sceneX + d.sceneWidth / 2, y: d.sceneY + d.sceneHeight / 2 });
  const dist = (o) => {
    if (g.isHexagonal && g.offsetToCube) { const a = g.offsetToCube(mid), b = g.offsetToCube(o); return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s)); }
    return Math.max(Math.abs(o.i - mid.i), Math.abs(o.j - mid.j));
  };
  const cells = [];
  for (let i = mid.i - radius - 1; i <= mid.i + radius + 1; i++) for (let j = mid.j - radius - 1; j <= mid.j + radius + 1; j++) if (dist({ i, j }) <= radius && (rows == null || Math.abs(i - mid.i) <= rows)) cells.push({ i, j });
  const polys = cells.map(o => g.getVertices(o).map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })));
  // boundary = cell edges that only one arena cell has
  const key = (a, b) => { const s = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort(); return s.join("|"); };
  const edges = new Map();
  for (const vs of polys) vs.forEach((a, k) => { const b = vs[(k + 1) % vs.length], kk = key(a, b); const e = edges.get(kk); if (e) e.n++; else edges.set(kk, { a, b, n: 1 }); });
  const walls = [...edges.values()].filter(e => e.n === 1).map(e => ({
    c: [e.a.x, e.a.y, e.b.x, e.b.y], move: CONST.WALL_MOVEMENT_TYPES.NORMAL, sight: CONST.WALL_SENSE_TYPES.NONE,
    light: CONST.WALL_SENSE_TYPES.NONE, sound: CONST.WALL_SENSE_TYPES.NONE, flags: { [SYSTEM_ID]: { duelArena: true } } }));
  // the overlay: the whole scene dark, the arena cells cut out
  const W = scene.width, H = scene.height, ox = d.sceneX, oy = d.sceneY;
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = c.getContext("2d");
  ctx.fillStyle = `rgba(0,0,0,${darkness})`; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000";
  for (const vs of polys) { ctx.beginPath(); vs.forEach((p, k) => (k ? ctx.lineTo(p.x - ox, p.y - oy) : ctx.moveTo(p.x - ox, p.y - oy))); ctx.closePath(); ctx.fill(); ctx.lineWidth = 1; ctx.stroke(); }
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker, dir = `worlds/${game.world.id}/duel-arenas`;
  try { await FP.createDirectory("data", dir); } catch { /* already there */ }
  const file = new File([blob], `arena-${scene.id}-${Date.now()}.png`, { type: "image/png" });
  const up = await FP.upload("data", dir, file, {}, { notify: false });
  const src = up?.path ?? `${dir}/${file.name}`;
  // replace the old arena
  const oldT = scene.tiles.filter(t => t.getFlag(SYSTEM_ID, "duelArena")).map(t => t.id), oldW = scene.walls.filter(w => w.getFlag(SYSTEM_ID, "duelArena")).map(w => w.id);
  if (oldT.length) await scene.deleteEmbeddedDocuments("Tile", oldT);
  if (oldW.length) await scene.deleteEmbeddedDocuments("Wall", oldW);
  const centre = (game.release?.generation ?? 12) >= 14;   // v14 places a tile by its centre
  await scene.createEmbeddedDocuments("Tile", [{ texture: { src }, x: centre ? ox + W / 2 : ox, y: centre ? oy + H / 2 : oy, width: W, height: H, locked: true, sort: -1, flags: { [SYSTEM_ID]: { duelArena: true } } }]);
  await scene.createEmbeddedDocuments("Wall", walls);
  await scene.setFlag(SYSTEM_ID, "duelArena", { radius, rows });
  return { cells: cells.length, walls: walls.length, src };
}
