// Officer duels, step 2 (David, 2026-10-28): when a duel is accepted, everyone goes to a person-scale scene the GM
// has set up for the ground the challenged officer stands on (plains, forest, town...). The two officers' tokens
// are placed there with a combat encounter; when the duel ends (or is called off) everyone comes back to the battle
// and the duel tokens and encounter are removed. The scenes themselves (hex grids or not) are the GM's own.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { FLAG as MAP_FLAG, decodeTiles } from "./battlemap.mjs";
import { DUEL_GROUNDS, duelGround, duelSceneFor } from "./duel-rules.mjs";

const SETTING = "battle";
export const DUEL_SCENES = "duelScenes"; // { ground: sceneId }

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const sceneMap = () => { try { return game.settings.get(SYSTEM_ID, DUEL_SCENES) || {}; } catch { return {}; } };
const officerOf = (scene, unitId) => scene?.tokens.get(unitId)?.actor?.system?.officerActor ?? null;

/** The battle map square under a unit: { terrain, overlays } (scenes from the map generator), else null. */
function tileUnder(scene, battle, unitId) {
  const pos = battle.meta?.[unitId]?.pos ?? (() => { const t = scene?.tokens.get(unitId); return t ? { x: Math.round(t.x / scene.grid.size), y: Math.round(t.y / scene.grid.size) } : null; })();
  const flag = scene?.getFlag?.(SYSTEM_ID, MAP_FLAG);
  if (!pos || !flag) return null;
  try { return decodeTiles(flag)?.[pos.x + "," + pos.y] ?? null; } catch { return null; }
}

/** Two spots near the middle of the duel scene, a couple of cells apart (hex or square grids). */
function startSpots(scene) {
  const g = scene.grid, d = scene.dimensions ?? { sceneX: 0, sceneY: 0, sceneWidth: scene.width, sceneHeight: scene.height };
  const cx = d.sceneX + d.sceneWidth / 2, cy = d.sceneY + d.sceneHeight / 2;
  try {
    const o = g.getOffset({ x: cx, y: cy });
    return [g.getTopLeftPoint({ i: o.i, j: o.j - 1 }), g.getTopLeftPoint({ i: o.i, j: o.j + 2 })];
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
    if (back && !back.active) await back.activate();
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
      ${DUEL_GROUNDS.map(([k, label]) => `<div class="form-group"><label>${esc(label)}</label><select name="${k}">${opts(map[k])}</select></div>`).join("")}
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
