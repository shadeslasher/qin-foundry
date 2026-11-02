// Drawing during deployment (David, 2026-11-01): while a battle is in its tactics phase (deployment), players may
// use Foundry's drawing tools (freehand and the rest) to sketch plans on the map. When deployment ends (the first
// round starts, or the battle ends or goes back to setup) the drawing permission goes back to what it was and every
// drawing on the battle scene is deleted. Run by the active GM only.
import { SYSTEM_ID } from "../config.mjs";

const STATE = "deployDrawing"; // world setting: { granted, prevRoles, sceneId }

export function registerDeployDrawing() {
  game.settings.register(SYSTEM_ID, STATE, { scope: "world", config: false, type: new foundry.data.fields.ObjectField(), default: { granted: false, prevRoles: null, sceneId: null } });
}

const isLeadGM = () => game.user.isGM && (game.users.activeGM ? game.users.activeGM === game.user : true);
const PLAYER = () => CONST.USER_ROLES?.PLAYER ?? 1;

/** Keep drawing permission in step with the battle: on in deployment, off (and the map wiped) once it ends. */
export async function syncDeployDrawing(battle) {
  if (!isLeadGM()) return;
  const st = game.settings.get(SYSTEM_ID, STATE) ?? {};
  const deploying = !!battle?.active && battle.turn?.phase === "tactics";
  if (deploying && !st.granted) {
    const perms = foundry.utils.deepClone(game.settings.get("core", "permissions") ?? {});
    const def = CONST.USER_PERMISSIONS?.DRAWING_CREATE?.defaultRole ?? 2;
    const prev = Array.isArray(perms.DRAWING_CREATE) ? perms.DRAWING_CREATE : Object.values(CONST.USER_ROLES ?? {}).filter(r => r >= def);
    perms.DRAWING_CREATE = [...new Set([...prev, ...Object.values(CONST.USER_ROLES ?? { PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 }).filter(r => r >= PLAYER())])].sort();
    await game.settings.set(SYSTEM_ID, STATE, { granted: true, prevRoles: prev, sceneId: battle.sceneId });
    await game.settings.set("core", "permissions", perms);
    ui.notifications.info("Deployment: players can draw on the map (Drawing tools). The drawings are cleared when the battle starts.");
  } else if (!deploying && st.granted) {
    const perms = foundry.utils.deepClone(game.settings.get("core", "permissions") ?? {});
    if (st.prevRoles) perms.DRAWING_CREATE = st.prevRoles; else delete perms.DRAWING_CREATE;
    await game.settings.set(SYSTEM_ID, STATE, { granted: false, prevRoles: null, sceneId: null });
    await game.settings.set("core", "permissions", perms);
    const scene = game.scenes.get(st.sceneId ?? battle?.sceneId);
    const ids = scene?.drawings?.map(d => d.id) ?? [];
    if (ids.length) await scene.deleteEmbeddedDocuments("Drawing", ids);
    if (ids.length) ui.notifications.info(`Deployment over: ${ids.length} drawing${ids.length === 1 ? "" : "s"} cleared from the map.`);
  }
}

/** Switch this user to the freehand drawing tool (the Battle panel's Draw button in deployment). */
export function startFreehand() {
  try {
    if (ui.controls?.activate) return ui.controls.activate({ control: "drawings", tool: "freehand" });
  } catch (e) { console.warn("Qin | freehand", e); }
  canvas?.drawings?.activate?.();
}
