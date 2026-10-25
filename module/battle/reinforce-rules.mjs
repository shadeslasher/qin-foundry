// Reinforcement zones (David, 2026-10-25): squares the GM paints mid-battle. Units placed on them are hidden from
// players and kept out of the battle until the zone's round starts; then they appear and can act. Pure helpers,
// shared by the engine adapter, the panel and the tests. The zones live in a scene flag; a waiting token carries
// the zone's id in a token flag.

export const REINFORCE_FLAG = "reinforcements"; // scene flag: { zones: [{ id, name, squares: ["x,y"], round, arrived }] }
export const REINFORCE_TOKEN_FLAG = "reinforce"; // token flag: the id of the zone it waits in

/** The zones in a scene flag (always an array). */
export function zonesOf(flag) { return Array.isArray(flag?.zones) ? flag.zones : []; }

/** The zone that covers a square, or null. */
export function zoneAt(zones, x, y) {
  const k = `${x},${y}`;
  return zones.find(z => (z.squares ?? []).includes(k)) ?? null;
}

/** The zone a token could wait in at this square: one that hasn't arrived yet. */
export function waitingZoneAt(zones, x, y) {
  const z = zoneAt(zones, x, y);
  return z && !z.arrived ? z : null;
}

/** Is a token with this zone flag still waiting (its zone exists and hasn't arrived)? */
export function isWaiting(zoneId, zones) {
  if (!zoneId) return false;
  const z = zones.find(z => z.id === zoneId);
  return !!z && !z.arrived;
}

/** Zones due to arrive at the start of this round (not arrived yet, round reached). */
export function dueZones(zones, round) {
  return zones.filter(z => !z.arrived && (z.round ?? Infinity) <= round);
}

/** A name for a new zone that doesn't clash with the others. */
export function nextZoneName(zones) {
  const used = new Set(zones.map(z => z.name));
  for (let i = 1; ; i++) { const n = `Reinforcements ${String.fromCharCode(64 + ((i - 1) % 26) + 1)}${i > 26 ? Math.ceil(i / 26) : ""}`; if (!used.has(n)) return n; }
}

/** The round a zone painted now arrives in: `inRounds` rounds after the current one (at least the next round). */
export function arrivalRound(currentRound, inRounds) {
  return Math.max(1, (currentRound || 0) + Math.max(1, Math.round(Number(inRounds) || 1)));
}
