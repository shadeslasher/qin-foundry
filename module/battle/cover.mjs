// Cover before the battle: enemy and neutral units the GM places in a forest or tall grass (with no road, watchtower
// or other overlay on that square) are hidden from players straight away, before the battle starts. Moving one out
// of cover shows it again. Once the battle runs, the engine's stealth rules take over (hiding at the end of a round,
// spotting, scouts). Runs on the active GM's client.
import { SYSTEM_ID } from "../config.mjs";
import * as E from "./engine.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battlemap.mjs";

/** Does this square of the scene's battle map give cover? */
export function coverAt(tiles, x, y) {
  if (!tiles) return false;
  return !!E.tileRules({ map: { tiles }, siege: {} }, x, y)?.hides;
}

/** Hidden by cover before the battle: enemy and neutral units only (players see their own side and allies). */
export const hidesBeforeBattle = (side, inCover) => inCover && (side === "enemy" || side === "neutral");

function preBattle(scene) {
  const b = game.settings.get(SYSTEM_ID, "battle");
  return !(b?.active && b.sceneId === scene.id && b.turn?.phase && b.turn.phase !== "setup");
}

async function check(tokenDoc, change = {}) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const scene = tokenDoc.parent, actor = tokenDoc.actor;
  if (!scene || actor?.type !== "unit" || !preBattle(scene)) return;
  const flag = scene.getFlag(SYSTEM_ID, MAP_FLAG); if (!flag) return;
  const size = scene.grid?.size ?? 100;
  const x = Math.round((change.x ?? tokenDoc.x) / size), y = Math.round((change.y ?? tokenDoc.y) / size);
  const hide = hidesBeforeBattle(actor.system.side, coverAt(decodeTiles(flag), x, y));
  const flagged = tokenDoc.getFlag(SYSTEM_ID, "stealthHidden");
  if (hide && !tokenDoc.hidden) {
    await tokenDoc.update({ hidden: true, [`flags.${SYSTEM_ID}.stealthHidden`]: true });
    if (!actor.system.hidden) await actor.update({ "system.hidden": true });
  } else if (!hide && flagged) {
    await tokenDoc.update({ hidden: false, [`flags.${SYSTEM_ID}.stealthHidden`]: false });
    if (actor.system.hidden) await actor.update({ "system.hidden": false });
  }
}

export function registerPreBattleCover() {
  Hooks.on("createToken", (doc) => check(doc));
  Hooks.on("updateToken", (doc, change) => { if ("x" in change || "y" in change) check(doc, change); });
  Hooks.on("updateActor", (actor, change) => { // a unit switched to the enemy or neutral side while standing in cover
    if (actor.type !== "unit" || !foundry.utils.hasProperty(change, "system.side")) return;
    for (const t of actor.getActiveTokens?.(false, true) ?? []) check(t);
  });
}
