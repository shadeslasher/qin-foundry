// Deployment zones: the squares players may move their units to while a battle is being deployed (the tactics
// phase). Pure (no Foundry), so the token drag check, the engine and the tests all share it.

/** Scene flag (system scope) holding the zone squares as "x,y" strings. Kept with the scene between battles. */
export const DEPLOY_FLAG = "deployZones";

export const zoneKey = (x, y) => `${x},${y}`;
export const zoneSet = (list) => new Set(Array.isArray(list) ? list : []);

const ok = { ok: true, reason: "" };
const no = (reason) => ({ ok: false, reason });

/**
 * May this user move a unit token to square (x, y)?
 *   phase    - "none" when no battle is running on the scene, else the battle's phase
 *              ("setup", "tactics", "start", "officer"...)
 *   isGM     - the GM can always place units outside the battle rounds
 *   zones    - Set of "x,y" deployment squares
 *   occupied - another unit already stands on (x, y)
 */
export function deployMoveCheck({ phase, isGM, zones, occupied }, x, y) {
  if (isGM) return ["none", "setup", "tactics"].includes(phase) ? ok
    : no("Units move with the Move action during a battle (go back to setup to reposition them).");
  if (phase === "none" || phase === "setup") return no("Players move their units onto the deployment squares once the battle begins, during the tactics phase.");
  if (phase !== "tactics") return no("Units move with the Move action during a battle.");
  const z = zones ?? new Set();
  if (!z.size) return no("There are no deployment zones on this map, so units stay where the GM placed them.");
  if (!z.has(zoneKey(x, y))) return no("Drop the unit on a deployment square (the blue-white tiles).");
  if (occupied) return no("Another unit is already on that square.");
  return ok;
}
