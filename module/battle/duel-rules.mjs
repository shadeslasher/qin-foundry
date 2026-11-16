// Pure helpers for officer duels (no Foundry needed: tested in test/duel.test.mjs).

/** Kinds of ground a duel can be fought on, each with a GM-chosen person-scale scene (David, 2026-10-28; split up
 *  2026-11-15: marsh, bridge, town, city wall, gate, ford, fort, farmland, tall grass and scorched ground are each their
 *  own; a hill, watchtower, dock or boat is fought on the tile under it, and there are no riverbank duels). */
export const DUEL_GROUNDS = [
  ["plains", "Plains and steppe"],
  ["farmland", "Farmland"],
  ["tallgrass", "Tall grass"],
  ["scorched", "Scorched ground"],
  ["forest", "Forest"],
  ["hills", "Rocky ground"],          // key kept for saved settings
  ["desert", "Sand"],
  ["ford", "Ford"],
  ["marsh", "Marsh"],
  ["bridge", "Bridge"],
  ["street", "City street (road through city or paving)"],   // David, 2026-11-16
  ["town", "Town (streets, buildings, ruins)"],
  ["wall", "City wall"],
  ["gate", "City gate"],
  ["camp", "Camp"],
  ["fort", "Fort"],
  ["default", "Anything else"],
];
/** A split ground with no scene of its own uses the old combined ground's scene (worlds set up before the split). */
export const OLD_GROUND = { street: "town", farmland: "plains", tallgrass: "plains", scorched: "plains", ford: "water", marsh: "water", bridge: "water", wall: "town", gate: "town" };

// overlays decide first (a camp on plains is a camp), then the terrain
const BY_OVERLAY = [
  [["fort", "small-fort"], "fort"],
  [["camp", "camp-stakes", "camp-palisade", "camp-wall", "camp-gate", "command-tent", "supply-depot"], "camp"],
  [["city-gate"], "gate"],
  [["city-wall", "fortress-tower"], "wall"],
  [["town-hall", "farmhouse", "ruins"], "town"],
  [["bridge"], "bridge"],
  [["trees"], "forest"],
  // a hill, watchtower, dock or boat is fought on the tile under it
];
const BY_TERRAIN = {
  plains: "plains", steppe: "plains", scorched: "scorched", farmland: "farmland", "tall-grass": "tallgrass",
  forest: "forest", rocky: "hills", ford: "ford", marsh: "marsh", sand: "desert", paving: "town", city: "town", bridge: "bridge",
};
/** Which duel ground a battle map square is: { terrain, overlays } -> a DUEL_GROUNDS key. */
export function duelGround(tile) {
  if (!tile) return "default";
  const ov = tile.overlays ?? [];
  for (const [list, g] of BY_OVERLAY) {
    // a road on a city or paving square is a city street (before town hall / farmhouse / ruins, after walls and gates)
    if (g === "town" && ov.includes("road") && (tile.terrain === "city" || tile.terrain === "paving")) return "street";
    if (ov.some(o => list.includes(o))) return g;
  }
  if (ov.includes("road") && (tile.terrain === "city" || tile.terrain === "paving")) return "street";
  return BY_TERRAIN[tile.terrain] ?? "default";
}

/** The scene for a ground: its own choice, else the "anything else" scene, else none. */
export function duelSceneFor(map, ground) {
  return (map && (map[ground] || (OLD_GROUND[ground] && map[OLD_GROUND[ground]]) || map.default)) || null;
}
