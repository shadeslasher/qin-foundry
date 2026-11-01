// Players drag their own units from the Actors directory onto the deployment squares during the tactics phase
// (David, 2026-10-30). Players can't create tokens themselves, so the drop is checked on their client and the
// active GM's client places the token after checking the same rules again.
// Deploy / Undeploy buttons in the Battle panel (David, 2026-10-31): Deploy puts the unit on the top-left free
// deployment square, Undeploy takes its token off the map. Both run on the GM's client too.
import { SYSTEM_ID } from "../config.mjs";
import { DEPLOY_FLAG, deployMoveCheck, zoneSet, zoneKey, firstFreeSquare, vanguardInputs } from "./deploy-rules.mjs";
import { traitTiersOf } from "./traits.mjs";

const QUERY = `${SYSTEM_ID}.deployActor`;
const UNDEPLOY = `${SYSTEM_ID}.undeployActor`;

/** The battle phase on this scene ("none" when no battle runs here). */
function phaseOn(scene) {
  const b = game.settings.get(SYSTEM_ID, "battle");
  return b?.active && scene?.id === b.sceneId ? (b.turn?.phase ?? "setup") : "none";
}

/** Squares ("x,y") covered by unit tokens on the scene (a token larger than one square covers them all). */
function occupiedSquares(scene) {
  const size = scene.grid?.size ?? 100, out = new Set();
  for (const t of scene.tokens.filter(t => t.actor?.type === "unit")) {
    const x0 = Math.round(t.x / size), y0 = Math.round(t.y / size);
    for (let dx = 0; dx < Math.max(1, Math.round(t.width ?? 1)); dx++)
      for (let dy = 0; dy < Math.max(1, Math.round(t.height ?? 1)); dy++) out.add(zoneKey(x0 + dx, y0 + dy));
  }
  return out;
}

/** The unit tokens on the scene that belong to this actor. */
const tokensOf = (scene, actor) => scene.tokens.filter(t => t.actorId === actor.id && t.actor?.type === "unit");

/** May this user deploy this actor at all (a unit they own that can fight)? */
function unitCheck(user, actor) {
  if (!actor || actor.type !== "unit") return { ok: false, reason: "Only units can be deployed." };
  if (!actor.testUserPermission(user, "OWNER")) return { ok: false, reason: "You can only deploy your own units." };
  if (actor.system?.status && actor.system.status !== "active") return { ok: false, reason: `${actor.name} can't fight (${actor.system.status}).` };
  return { ok: true, reason: "" };
}

/** Can this user drop this unit actor on square (x, y)? Returns { ok, reason }. */
function dropCheck(user, scene, actor, x, y) {
  const u = unitCheck(user, actor); if (!u.ok) return u;
  const size = scene.grid?.size ?? 100;
  const units = scene.tokens.filter(t => t.actor?.type === "unit");
  if (actor.prototypeToken?.actorLink && units.some(t => t.actorLink && t.actorId === actor.id)) return { ok: false, reason: `${actor.name} is already on the field.` };
  const occupied = units.some(t => Math.round(t.x / size) === x && Math.round(t.y / size) === y);
  const sq = units.map(t => ({ x: Math.round(t.x / size), y: Math.round(t.y / size), side: t.actor?.system?.side }));
  const vg = vanguardInputs(traitTiersOf(actor.system?.traits ?? ""), actor.system?.side, sq);
  return deployMoveCheck({ phase: phaseOn(scene), isGM: false, zones: zoneSet(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG)), occupied, ...vg }, x, y);
}

/** Who may press Deploy / Undeploy now: the GM in setup or tactics, players in tactics only. */
function buttonPhaseOk(user, scene) {
  const ph = phaseOn(scene);
  return ph === "tactics" || (user.isGM && ph === "setup");
}

/** GM side: place the unit if the rules allow it. With auto, it goes on the top-left free deployment square. */
async function placeForUser({ userId, sceneId, actorUuid, x, y, auto }) {
  const user = game.users.get(userId), scene = game.scenes.get(sceneId), actor = await fromUuid(actorUuid);
  if (!user || !scene) return { ok: false, error: "That scene or player is gone." };
  if (auto) {
    if (!buttonPhaseOk(user, scene)) return { ok: false, error: "Units can be deployed only before the battle's first round (the tactics phase)." };
    if (actor && tokensOf(scene, actor).length) return { ok: false, error: `${actor.name} is already on the field.` };
    const sq = firstFreeSquare(zoneSet(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG)), occupiedSquares(scene));
    if (!sq) return { ok: false, error: zoneSet(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG)).size ? "Every deployment square is taken." : "There are no deployment zones on this map." };
    ({ x, y } = sq);
  }
  // auto: the square is already a free deployment square and the phase is checked, so only the unit itself is
  // checked (the GM may also deploy in setup); a drop checks everything
  const chk = auto ? unitCheck(user, actor) : dropCheck(user, scene, actor, x, y);
  if (!chk.ok) return { ok: false, error: chk.reason };
  const size = scene.grid?.size ?? 100;
  const td = await actor.getTokenDocument({ x: x * size, y: y * size });
  await scene.createEmbeddedDocuments("Token", [td.toObject()], { qinBattle: true });
  return { ok: true };
}

/** GM side: take the unit's tokens off the battle map. */
async function removeForUser({ userId, sceneId, actorUuid }) {
  const user = game.users.get(userId), scene = game.scenes.get(sceneId), actor = await fromUuid(actorUuid);
  if (!user || !scene || !actor) return { ok: false, error: "That scene, player or unit is gone." };
  if (!actor.testUserPermission(user, "OWNER")) return { ok: false, error: "You can only undeploy your own units." };
  if (!buttonPhaseOk(user, scene)) return { ok: false, error: "Deployment is locked once tactics are finished." };
  const ids = tokensOf(scene, actor).map(t => t.id);
  if (!ids.length) return { ok: false, error: `${actor.name} isn't on the field.` };
  await scene.deleteEmbeddedDocuments("Token", ids, { qinBattle: true });
  return { ok: true };
}

/** Send a request to the active GM (or run it here on the GM's own client). */
async function ask(query, fn, data) {
  try {
    let res;
    if (game.user.isGM) res = await fn({ userId: game.user.id, ...data });
    else {
      const gm = game.users.activeGM;
      if (!gm) { ui.notifications.warn("The GM needs to be connected to deploy units."); return; }
      res = await gm.query(query, { userId: game.user.id, ...data }, { timeout: 30000 });
    }
    if (!res?.ok) ui.notifications.warn(res?.error ?? "That didn't work.");
  } catch (e) { ui.notifications.warn(e.message); }
}

/** The battle's scene, if a battle is running. */
function battleScene() {
  const b = game.settings.get(SYSTEM_ID, "battle");
  return b?.active ? game.scenes.get(b.sceneId) : null;
}

/** Deploy button: the unit goes on the top-left free deployment square. */
export function deployUnit(actorId) {
  const scene = battleScene(), actor = game.actors.get(actorId);
  if (!scene || !actor) return;
  return ask(QUERY, placeForUser, { sceneId: scene.id, actorUuid: actor.uuid, auto: true });
}

/** Undeploy button: the unit's token comes off the map. */
export function undeployUnit(actorId) {
  const scene = battleScene(), actor = game.actors.get(actorId);
  if (!scene || !actor) return;
  return ask(UNDEPLOY, removeForUser, { sceneId: scene.id, actorUuid: actor.uuid });
}

/**
 * The Battle panel's Deployment card: player-side units this user owns (the GM: every player-side unit), each
 * with Deploy or Undeploy. Null when the card shouldn't show.
 */
export function deployListState() {
  const scene = battleScene();
  if (!scene || !buttonPhaseOk(game.user, scene)) return null;
  const zones = zoneSet(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG));
  const free = firstFreeSquare(zones, occupiedSquares(scene));
  const units = game.actors.filter(a => a.type === "unit" && a.system?.side === "player" && (game.user.isGM || a.isOwner))
    .map(a => {
      const placed = tokensOf(scene, a).length > 0;
      const out = a.system?.status && a.system.status !== "active";
      const owner = game.users.find(u => !u.isGM && a.testUserPermission(u, "OWNER"))?.name ?? "No owner";
      return { id: a.id, name: a.name, img: a.prototypeToken?.texture?.src || a.img, placed, owner,
        officer: a.system?.officerActor?.name ?? null,
        canDeploy: !placed && !out && !!free, why: out ? `Can't fight (${a.system.status})` : !free ? (zones.size ? "Every deployment square is taken" : "No deployment zones on this map") : "" };
    })
    .sort((x, y) => (x.owner.localeCompare(y.owner)) || x.name.localeCompare(y.name));
  return { units, showOwner: game.user.isGM, zones: zones.size };
}

export function registerDeployDrop() {
  CONFIG.queries[QUERY] = async (data) => (game.user.isGM ? placeForUser(data) : { ok: false, error: "Only the GM's client places units" });
  CONFIG.queries[UNDEPLOY] = async (data) => (game.user.isGM ? removeForUser(data) : { ok: false, error: "Only the GM's client removes units" });
  // the Deployment card follows units arriving on and leaving the map
  const refresh = (doc) => { if (doc?.actor?.type === "unit") game.qin?.refreshBattlePanel?.(); };
  Hooks.on("createToken", refresh);
  Hooks.on("deleteToken", refresh);
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

export { dropCheck as _dropCheck, placeForUser as _placeForUser, removeForUser as _removeForUser };
