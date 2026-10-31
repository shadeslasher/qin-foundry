// Players drag their own units from the Actors directory onto the deployment squares during the tactics phase
// (David, 2026-10-30). Players can't create tokens themselves, so the drop is checked on their client and the
// active GM's client places the token after checking the same rules again.
import { SYSTEM_ID } from "../config.mjs";
import { DEPLOY_FLAG, deployMoveCheck, zoneSet } from "./deploy-rules.mjs";

const QUERY = `${SYSTEM_ID}.deployActor`;

/** The battle phase on this scene ("none" when no battle runs here). */
function phaseOn(scene) {
  const b = game.settings.get(SYSTEM_ID, "battle");
  return b?.active && scene?.id === b.sceneId ? (b.turn?.phase ?? "setup") : "none";
}

/** Can this user drop this unit actor on square (x, y)? Returns { ok, reason }. */
function dropCheck(user, scene, actor, x, y) {
  if (!actor || actor.type !== "unit") return { ok: false, reason: "Only units can be deployed." };
  if (!actor.testUserPermission(user, "OWNER")) return { ok: false, reason: "You can only deploy your own units." };
  if (actor.system?.status && actor.system.status !== "active") return { ok: false, reason: `${actor.name} can't fight (${actor.system.status}).` };
  const size = scene.grid?.size ?? 100;
  const units = scene.tokens.filter(t => t.actor?.type === "unit");
  if (actor.prototypeToken?.actorLink && units.some(t => t.actorLink && t.actorId === actor.id)) return { ok: false, reason: `${actor.name} is already on the field.` };
  const occupied = units.some(t => Math.round(t.x / size) === x && Math.round(t.y / size) === y);
  return deployMoveCheck({ phase: phaseOn(scene), isGM: false, zones: zoneSet(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG)), occupied }, x, y);
}

/** GM side: place the unit if the rules allow it. */
async function placeForUser({ userId, sceneId, actorUuid, x, y }) {
  const user = game.users.get(userId), scene = game.scenes.get(sceneId), actor = await fromUuid(actorUuid);
  if (!user || !scene) return { ok: false, error: "That scene or player is gone." };
  const chk = dropCheck(user, scene, actor, x, y);
  if (!chk.ok) return { ok: false, error: chk.reason };
  const size = scene.grid?.size ?? 100;
  const td = await actor.getTokenDocument({ x: x * size, y: y * size });
  await scene.createEmbeddedDocuments("Token", [td.toObject()], { qinBattle: true });
  return { ok: true };
}

export function registerDeployDrop() {
  CONFIG.queries[QUERY] = async (data) => (game.user.isGM ? placeForUser(data) : { ok: false, error: "Only the GM's client places units" });
  // Player client: a unit actor dropped on the map during deployment goes to the GM to be placed
  Hooks.on("dropCanvasData", (cv, data) => {
    if (game.user.isGM || data?.type !== "Actor") return;
    const scene = cv.scene; if (!scene) return;
    const actor = fromUuidSync(data.uuid);
    if (actor?.type !== "unit") return;
    const size = scene.grid?.size ?? 100, x = Math.floor(data.x / size), y = Math.floor(data.y / size);
    const chk = dropCheck(game.user, scene, actor, x, y);
    if (!chk.ok) { ui.notifications.warn(chk.reason); return false; }
    const gm = game.users.activeGM;
    if (!gm) { ui.notifications.warn("The GM needs to be connected to place units."); return false; }
    gm.query(QUERY, { userId: game.user.id, sceneId: scene.id, actorUuid: actor.uuid, x, y }, { timeout: 30000 })
      .then(res => { if (!res?.ok) ui.notifications.warn(res?.error ?? "The unit couldn't be placed."); })
      .catch(e => ui.notifications.warn(e.message));
    return false; // the GM creates the token
  });
}

export { dropCheck as _dropCheck };
