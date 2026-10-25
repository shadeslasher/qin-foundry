// Victory and defeat conditions. The GM sets them up per scene (scene flag `objectives`); the engine tracks what
// happens in the battle (`objState`) and calls evaluateObjectives after every change. Pure (no Foundry).
//
// Config: { victory: [cond], defeat: [cond], extraction: ["x,y", ...] }
//   victory types: routUnit { unitIds }   routAll   seize { x, y }   burn { x, y }   hold { x, y, rounds }
//                  survive { rounds }      escape { unitIds } (onto the extraction squares)
//   defeat types:  unitRouted { unitIds }  tileSeized { x, y, pair? }   turnLimit { rounds }
//   Every victory condition must be done to win; any one defeat condition loses. Losing every player unit
//   always loses. A Hold comes with a paired "tile seized" defeat on the same square (pair = the hold's id).
// objState: { playerEnded: { "x,y": true }, enemyEnded: { "x,y": true }, roundsDone, escaped: [unitId] }
//   playerEnded / enemyEnded: a Player / Enemy side unit has ended its turn on that square (seized).

export const OBJECTIVES_FLAG = "objectives";

export const VICTORY_TYPES = {
  routUnit: { label: "Rout unit", needs: "units", color: 0xff8c1a },
  routAll: { label: "Rout all enemy units", needs: null, color: 0xff8c1a },
  seize: { label: "Seize tile", needs: "tile", color: 0xff8c1a },
  burn: { label: "Burn tile", needs: "tile", color: 0xe0352b },
  hold: { label: "Hold tile", needs: "tile", rounds: true, color: 0xb4b8bd },
  survive: { label: "Survive", needs: null, rounds: true, color: 0x7fb0ef },
  escape: { label: "Escape", needs: "units", color: 0xff4fa8 },
};
export const DEFEAT_TYPES = {
  unitRouted: { label: "Unit routed", needs: "units", color: 0x3fbf5f },
  tileSeized: { label: "Tile seized", needs: "tile", color: 0xf2d22e },
  turnLimit: { label: "Turn limit", needs: null, rounds: true, color: 0xe07a69 },
};

export const emptyObjectives = () => ({ victory: [], defeat: [], extraction: [] });
export const freshObjState = () => ({ playerEnded: {}, enemyEnded: {}, roundsDone: 0, escaped: [] });
const key = (c) => `${c.x},${c.y}`;
const routed = (u) => !u || u.status === "surrendered" || u.status === "defeated";

/** Is there anything set up? (The tracker shows whenever a battle runs; this says whether there are custom conditions.) */
export const hasObjectives = (o) => !!(o && ((o.victory?.length ?? 0) + (o.defeat?.length ?? 0)));

/**
 * Where every condition stands, and the result if the battle is decided.
 *   units: [{ id, side, status, name }], st: objState, burnt: { "x,y": true }, fires: { "x,y": { left } }
 * Returns { victory: [{ id, type, done, failed, n, of, note }], defeat: [{ id, type, triggered, n, of }], result }
 */
export function evaluateObjectives(cfg, units, st, { burnt = {}, fires = {} } = {}) {
  const o = cfg ?? emptyObjectives(), s = st ?? freshObjState();
  const byId = new Map(units.map(u => [u.id, u]));
  const escaped = new Set(s.escaped ?? []);
  const victory = (o.victory ?? []).map(c => {
    const r = { id: c.id, type: c.type, done: false, failed: false, n: null, of: null, note: "" };
    switch (c.type) {
      case "routUnit": {
        const ids = c.unitIds ?? [];
        r.n = ids.filter(id => routed(byId.get(id))).length; r.of = ids.length;
        r.done = ids.length > 0 && r.n === ids.length;
        r.failed = ids.some(id => escaped.has(id));
        break;
      }
      case "routAll": {
        const enemies = units.filter(u => u.side === "enemy");
        r.n = enemies.filter(u => u.status !== "active").length; r.of = enemies.length;
        r.done = enemies.length > 0 && r.n === enemies.length;
        break;
      }
      case "seize": r.done = !!s.playerEnded?.[key(c)]; break;
      case "burn": {
        r.done = !!burnt[key(c)];
        const f = fires[key(c)];
        if (f && !r.done) r.note = `burning, ${f.left} round${f.left === 1 ? "" : "s"} left`;
        break;
      }
      case "hold":
        r.n = Math.min(s.roundsDone ?? 0, c.rounds ?? 0); r.of = c.rounds ?? 0;
        r.failed = !!s.enemyEnded?.[key(c)];
        r.done = !r.failed && (s.roundsDone ?? 0) >= (c.rounds ?? 0);
        break;
      case "survive":
        r.n = Math.min(s.roundsDone ?? 0, c.rounds ?? 0); r.of = c.rounds ?? 0;
        r.done = (s.roundsDone ?? 0) >= (c.rounds ?? 0);
        break;
      case "escape": {
        const ids = c.unitIds ?? [];
        r.n = ids.filter(id => escaped.has(id)).length; r.of = ids.length;
        r.done = ids.length > 0 && r.n === ids.length;
        r.failed = ids.some(id => !escaped.has(id) && routed(byId.get(id)));
        break;
      }
    }
    return r;
  });
  const defeat = (o.defeat ?? []).map(c => {
    const r = { id: c.id, type: c.type, triggered: false, n: null, of: null, pair: c.pair ?? null };
    switch (c.type) {
      case "unitRouted": r.triggered = (c.unitIds ?? []).some(id => routed(byId.get(id)) && !escaped.has(id)); break;
      case "tileSeized": r.triggered = !!s.enemyEnded?.[key(c)]; break;
      case "turnLimit":
        r.n = Math.min(s.roundsDone ?? 0, c.rounds ?? 0); r.of = c.rounds ?? 0;
        r.triggered = (s.roundsDone ?? 0) >= (c.rounds ?? 0);
        break;
    }
    return r;
  });
  // always: losing every player unit (units that escaped aren't lost)
  const players = units.filter(u => u.side === "player");
  const allLost = players.length > 0 && players.every(u => routed(u) && !escaped.has(u.id));
  defeat.push({ id: "allPlayerRouted", type: "allPlayerRouted", triggered: allLost, always: true });
  const won = victory.length > 0 && victory.every(v => v.done);
  const result = won ? "victory" : defeat.some(d => d.triggered) ? "defeat" : null;
  return { victory, defeat, result };
}

/** The name a condition shows for a unit: its officer's name when it has one (David, 2026-10-25), else the token's. */
export function conditionUnitName(tok) {
  let off = null;
  try { off = tok.actor?.system?.officerActor ?? null; } catch { off = null; }
  return off?.name || tok.name;
}

/** Plain words for a condition, for the tracker and the log. names: id -> unit name; tileName(x, y) -> e.g. "Bridge". */
export function describe(c, { names = {}, tileName = () => "" } = {}, { coords = true } = {}) {
  const units = (ids) => (ids ?? []).map(id => names[id] ?? "a unit").join(", ") || "(pick units)";
  const tile = (c) => (c.x === undefined || c.x === null ? "(pick a tile)" : `${tileName(c.x, c.y) || "the tile"}${coords ? ` (${c.x}, ${c.y})` : ""}`);
  switch (c.type) {
    case "routUnit": return `Rout ${units(c.unitIds)}`;
    case "routAll": return "Rout all enemy units";
    case "seize": return `Seize ${tile(c)}`;
    case "burn": return `Burn down ${tile(c)}`;
    case "hold": return `Hold ${tile(c)}`;
    case "survive": return "Survive";
    case "escape": return `Escape: ${units(c.unitIds)}`;
    case "unitRouted": return `${units(c.unitIds)} routed`;
    case "tileSeized": return `Defend ${tile(c)}`;
    case "turnLimit": return "Time runs out";
    case "allPlayerRouted": return "All player units routed";
  }
  return c.type;
}
