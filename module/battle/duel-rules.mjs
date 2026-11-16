// Pure helpers for officer duels (no Foundry needed: tested in test/duel.test.mjs).

/** Kinds of ground a duel can be fought on, each with a GM-chosen person-scale scene (David, 2026-10-28; split up
 *  2026-11-15: marsh, bridge, town, city wall, gate, ford, riverbank and fort are each their own; a hill or a watchtower
 *  is fought on the tile under it). */
export const DUEL_GROUNDS = [
  ["plains", "Plains and fields"],
  ["forest", "Forest"],
  ["hills", "Rocky ground"],          // key kept for saved settings
  ["desert", "Sand"],
  ["riverbank", "Riverbank (land beside a river or lake, or a dock)"],
  ["ford", "Ford"],
  ["marsh", "Marsh"],
  ["bridge", "Bridge"],
  ["town", "Town (streets, buildings, ruins)"],
  ["wall", "City wall"],
  ["gate", "City gate"],
  ["camp", "Camp"],
  ["fort", "Fort"],
  ["default", "Anything else"],
];
/** A split ground with no scene of its own uses the old combined ground's scene (worlds set up before the split). */
export const OLD_GROUND = { riverbank: "water", ford: "water", marsh: "water", bridge: "water", wall: "town", gate: "town" };

// overlays decide first (a camp on plains is a camp), then the terrain
const BY_OVERLAY = [
  [["fort", "small-fort"], "fort"],
  [["camp", "camp-stakes", "camp-palisade", "camp-wall", "camp-gate", "command-tent", "supply-depot"], "camp"],
  [["city-gate"], "gate"],
  [["city-wall", "fortress-tower"], "wall"],
  [["town-hall", "farmhouse", "ruins"], "town"],
  [["bridge"], "bridge"],
  [["dock", "boat"], "riverbank"],
  [["trees"], "forest"],
  // a hill or a watchtower is fought on the tile under it
];
const BY_TERRAIN = {
  plains: "plains", steppe: "plains", scorched: "plains", farmland: "plains", "tall-grass": "plains",
  forest: "forest", rocky: "hills", ford: "ford", marsh: "marsh", sand: "desert", paving: "town", city: "town", bridge: "bridge",
};
const WATER = new Set(["river", "lake", "ford"]);
const BANK = new Set(["plains", "hills", "desert"]);   // open land beside water is a riverbank (forest, marsh… stay what they are)

/** Which duel ground a battle map square is: { terrain, overlays } -> a DUEL_GROUNDS key. `around`: the 8 squares
 *  around it (any may be null), to tell a riverbank. */
export function duelGround(tile, around = []) {
  if (!tile) return "default";
  const ov = tile.overlays ?? [];
  for (const [list, g] of BY_OVERLAY) if (ov.some(o => list.includes(o))) return g;
  const g = BY_TERRAIN[tile.terrain] ?? "default";
  if (BANK.has(g) && around.some(t => t && WATER.has(t.terrain))) return "riverbank";
  return g;
}

/** The scene for a ground: its own choice, else the "anything else" scene, else none. */
export function duelSceneFor(map, ground) {
  return (map && (map[ground] || (OLD_GROUND[ground] && map[OLD_GROUND[ground]]) || map.default)) || null;
}
