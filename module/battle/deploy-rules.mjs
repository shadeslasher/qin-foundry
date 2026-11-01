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
 *   vanguard - the unit has the Vanguard trait: it may also deploy outside the zones, more than 4 squares from every enemy
 *   enemies  - [{x, y}] of the enemy units (only needed for Vanguard)
 */
export const VANGUARD_MIN = 5; // "more than 4 tiles away from the nearest enemy" (David, 2026-11-01), counted like movement (orthogonal steps)
export function vanguardOk(enemies, x, y) {
  return (enemies ?? []).every(e => Math.abs(e.x - x) + Math.abs(e.y - y) >= VANGUARD_MIN);
}
export function deployMoveCheck({ phase, isGM, zones, occupied, vanguard, enemies }, x, y) {
  if (isGM) return ["none", "setup", "tactics"].includes(phase) ? ok
    : no("Units move with the Move action during a battle (go back to setup to reposition them).");
  if (phase === "none" || phase === "setup") return no("Players move their units onto the deployment squares once the battle begins, during the tactics phase.");
  if (phase !== "tactics") return no("Units move with the Move action during a battle.");
  const z = zones ?? new Set();
  if (!z.size) return no("There are no deployment zones on this map, so units stay where the GM placed them.");
  if (!z.has(zoneKey(x, y))) {
    if (!vanguard) return no("Drop the unit on a deployment square (the blue-white tiles).");
    if (!vanguardOk(enemies, x, y)) return no("Vanguard: outside the deployment squares the unit must be more than 4 squares from every enemy.");
  }
  if (occupied) return no("Another unit is already on that square.");
  return ok;
}

/**
 * The top-left free deployment square (topmost row first, then leftmost), or null when every square is taken.
 * Used by the Deploy button (David, 2026-10-31).
 *   zones    - Set (or array) of "x,y" deployment squares
 *   occupied - Set of "x,y" squares a unit already stands on
 */
export function firstFreeSquare(zones, occupied = new Set()) {
  const free = [...(zones ?? [])].filter(k => !occupied.has(k)).map(k => k.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!free.length) return null;
  free.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { x: free[0][0], y: free[0][1] };
}

/** Side helper shared by the Foundry checks: 'ally' fights with the players. */
const allianceOf = (side) => (side === "ally" ? "player" : side) || "player";
/** Vanguard inputs for a unit actor on a scene: { vanguard, enemies }. tokens: [{x, y, side}] in squares. */
export function vanguardInputs(traitTiers, side, tokens) {
  if (!traitTiers?.vanguard) return { vanguard: false, enemies: [] };
  return { vanguard: true, enemies: (tokens ?? []).filter(t => allianceOf(t.side) !== allianceOf(side)) };
}
