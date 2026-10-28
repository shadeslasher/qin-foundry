// Pure helpers for officer duels (no Foundry needed: tested in test/duel.test.mjs).

/** Kinds of ground a duel can be fought on, each with a GM-chosen person-scale scene (David, 2026-10-28). */
export const DUEL_GROUNDS = [
  ["plains", "Plains and fields"],
  ["forest", "Forest"],
  ["hills", "Hills and rocky ground"],
  ["water", "Riverbank, ford, marsh or bridge"],
  ["desert", "Sand"],
  ["town", "Town, city walls and gates"],
  ["camp", "Camp"],
  ["fort", "Fort or watchtower"],
  ["default", "Anything else"],
];

// overlays decide first (a camp on plains is a camp), then the terrain
const BY_OVERLAY = [
  [["fort", "small-fort", "watchtower"], "fort"],
  [["camp", "camp-stakes", "camp-palisade", "camp-wall", "camp-gate", "command-tent", "supply-depot"], "camp"],
  [["town-hall", "city-wall", "city-gate", "fortress-tower", "farmhouse", "ruins"], "town"],
  [["bridge", "dock", "boat"], "water"],
  [["trees"], "forest"],
  [["hill"], "hills"],
];
const BY_TERRAIN = {
  plains: "plains", steppe: "plains", scorched: "plains", farmland: "plains", "tall-grass": "plains",
  forest: "forest", rocky: "hills", ford: "water", marsh: "water", sand: "desert", paving: "town", city: "town",
};

/** Which duel ground a battle map square is: { terrain, overlays } -> a DUEL_GROUNDS key. */
export function duelGround(tile) {
  if (!tile) return "default";
  const ov = tile.overlays ?? [];
  for (const [list, g] of BY_OVERLAY) if (ov.some(o => list.includes(o))) return g;
  return BY_TERRAIN[tile.terrain] ?? "default";
}

/** The scene for a ground: its own choice, else the "anything else" scene, else none. */
export function duelSceneFor(map, ground) {
  return (map && (map[ground] || map.default)) || null;
}
