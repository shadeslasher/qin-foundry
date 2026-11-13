// Siege equipment as a player's stock (David, 2026-11-13). Ladders, siege engines and catapults no longer sit on a
// unit's Equipment: each player keeps a stock (on their character, flag qin.siegeStock), at most their max unit count
// in all. During deployment, once the GM allows siege equipment, players hand ladders or engines to their units and
// place catapults on squares of their deployment zone. After the battle only what was used is lost: ladders set
// against a wall, engines left on the field, catapults that burned. Pure rules here; the engine and UI use them.

export const SIEGE_KINDS = ["ladders", "engine", "catapult"];
export const SIEGE_LABEL = { ladders: "Ladders", engine: "Siege engine", catapult: "Catapult" };
export const SIEGE_PLURAL = { ladders: "ladders", engine: "siege engines", catapult: "catapults" };

/** A stock record with every kind as a whole number >= 0. */
export function cleanStock(st) {
  const o = {};
  for (const k of SIEGE_KINDS) o[k] = Math.max(0, Math.floor(Number(st?.[k]) || 0));
  return o;
}
export const stockTotal = (st) => SIEGE_KINDS.reduce((n, k) => n + (cleanStock(st)[k]), 0);

// Catapults (David, 2026-11-13): hills, forts and open ground; never forest, trees, mountains, water, marsh, walls,
// gates, towers, watchtowers, camp walls or buildings.
const OPEN_TERRAIN = new Set(["plains", "farmland", "steppe", "sand", "rocky", "scorched", "paving", "city"]);
const OK_OVERLAYS = new Set(["road", "hill", "fort", "small-fort", "camp"]);
const TERRAIN_NAME = { forest: "forest", mountain: "mountains", river: "water", lake: "water", ford: "water", marsh: "marsh", cliffs: "cliffs", "tall-grass": "tall grass" };

/** Can a catapult stand on this map square? { ok, reason }. */
export function catapultTileOk(tile) {
  if (!tile) return { ok: false, reason: "Off the battle map" };
  const ov = tile.overlays ?? [];
  if (ov.includes("catapult")) return { ok: false, reason: "There's already a catapult there" };
  if (!OPEN_TERRAIN.has(tile.terrain)) return { ok: false, reason: `A catapult can't stand on ${TERRAIN_NAME[tile.terrain] ?? tile.terrain}` };
  const bad = ov.find(o => !OK_OVERLAYS.has(o));
  if (bad) return { ok: false, reason: `A catapult can't stand on ${bad.replace(/-/g, " ")}` };
  return { ok: true };
}

/** What a player's units carry and what catapults they placed, in this battle state. */
export function siegeInUse(s, owner) {
  const n = { ladders: 0, engine: 0, catapult: 0 };
  for (const u of s.units ?? []) if (u.owner === owner && (u.carry === "ladders" || u.carry === "engine")) n[u.carry]++;
  for (const c of s.siege?.catapults ?? []) if (c.owner === owner && !s.siege?.burnt?.[c.x + "," + c.y]) n.catapult++;
  return n;
}

/** Per player, what was handed out when deployment ended (the snapshot losses are counted against). */
export function issuedNow(s) {
  const out = {};
  const owners = new Set([...(s.units ?? []).map(u => u.owner), ...(s.siege?.catapults ?? []).map(c => c.owner)].filter(o => o && o !== "host"));
  for (const o of owners) { const n = siegeInUse(s, o); if (stockTotal(n)) out[o] = n; }
  return out;
}

/**
 * After the battle: what each player lost. `issued` is the deployment snapshot; `back` is what is still in hand at the
 * end (carried by their units, catapults still standing). Lost = issued − back, never below 0.
 */
export function siegeLosses(issued, back) {
  const out = {};
  for (const [o, n] of Object.entries(issued ?? {})) {
    const b = back?.[o] ?? {}, lost = {};
    for (const k of SIEGE_KINDS) lost[k] = Math.max(0, (n[k] || 0) - (b[k] || 0));
    if (stockTotal(lost)) out[o] = lost;
  }
  return out;
}

/** The stock after losses (never below 0). */
export function afterLosses(stock, lost) {
  const st = cleanStock(stock), o = {};
  for (const k of SIEGE_KINDS) o[k] = Math.max(0, st[k] - (lost?.[k] || 0));
  return o;
}

/** Room left under the cap (max unit count); Infinity without a cap. */
export function stockRoom(stock, cap) {
  if (cap == null || !Number.isFinite(Number(cap))) return Infinity;
  return Math.max(0, Number(cap) - stockTotal(stock));
}
