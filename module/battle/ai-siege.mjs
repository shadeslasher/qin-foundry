// Battle AI: sieges (David, 2026-11-04). Pure: works on engine state, no Foundry.
//
// On a map with city walls, straight-line distance lies: a unit outside the walls is "close" to a square inside but
// can't get there. So the AI measures distance along the real way in (route distance, see routeField): open
// ground costs 1 a square, an open or broken gate 1, a locked gate of its own side 2 (it can open it), an enemy
// gate it must batter 8 (4 carrying a siege engine), a wall square with a ladder 3 (6 for a unit carrying ladders,
// which can put one up), and nothing else crosses the walls. Cavalry can't climb.
// Each side also gets a siege role (siegeRoles): attacker when what it wants is inside the walls and its army is
// outside (it batters gates, puts up ladders, climbs, sends engines to the gates and catapults at them), defender
// when it holds the city against an army outside (it mans the walls, shuts its gates when the enemy comes near,
// stays inside, and goes first for enemy units carrying ladders or engines).
import * as E from './engine.mjs';

/** Does this map have city walls? (cached per map) */
const wallsMemo = new WeakMap();
export function hasWalls(s) {
  const m = s.map; if (!m || !m.tiles) return false;
  if (wallsMemo.has(m)) return wallsMemo.get(m);
  const v = Object.values(m.tiles).some(t => (t.overlays || []).some(o => o === 'city-wall' || o === 'city-gate' || o === 'fortress-tower'));
  wallsMemo.set(m, v);
  return v;
}

/** What kind of mover a unit is, for routes: 'cav' | 'foot' | 'ladders' | 'engine'. */
export function moverKind(s, u) {
  if (u.carry === 'engine') return 'engine';
  if (u.carry === 'ladders') return 'ladders';
  return E.typeOf(s, u).category === 'cavalry' ? 'cav' : 'foot';
}

/** The cost to enter a square on the way in (Infinity: can't), for a mover of this kind and alliance. */
function stepCost(s, x, y, kind, al) {
  const g = E.gateAt(s, x, y);
  if (g) {
    if (g.state === 'open' || g.state === 'broken' || g.state === 'burned') return 1;
    const own = g.owner === 'enemy' ? al === 'enemy' : al !== 'enemy';
    return own ? 2 : kind === 'engine' ? 4 : 8;
  }
  if (E.isWallTop(s, x, y)) {
    if (kind === 'cav') return Infinity;
    const ladder = s.siege && s.siege.ladders && s.siege.ladders.includes(x + ',' + y);
    if (ladder) return 3;
    if (kind === 'ladders') return 6;
    return Infinity;
  }
  const r = E.tileRules(s, x, y);
  if (r) {
    if (r.pass === 'none') return Infinity;
    if (r.pass === 'noCavalry' && kind === 'cav') return Infinity;
  }
  return 1;
}

const fieldMemo = new Map();
/**
 * Route distance from every square to the nearest of `targets` ([{x, y}]), for this mover kind and alliance.
 * Returns a Float64Array indexed y * cols + x (Infinity where there's no way). Cached by map, gates, ladders, targets.
 */
export function routeField(s, kind, al, targets) {
  const { cols, rows } = s.map;
  const sg = s.siege || {};
  const key = [cols, rows, kind, al, (sg.gates || []).map(g => g.id + g.state + g.owner).join(), (sg.ladders || []).join(';'),
    targets.map(p => p.x + ',' + p.y).sort().join(';')].join('|');
  const hit = fieldMemo.get(key);
  if (hit && hit.map === s.map) return hit.d;
  const n = cols * rows, d = new Float64Array(n).fill(Infinity);
  // Dijkstra with small integer costs: a bucket queue
  const buckets = [[]];
  for (const p of targets) {
    if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows) continue;
    const i = p.y * cols + p.x; if (d[i] === 0) continue;
    d[i] = 0; buckets[0].push(i);
  }
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c]; if (!b) continue;
    for (const i of b) {
      if (d[i] !== c) continue;
      const x = i % cols, y = (i - x) / cols;
      // working backwards from the targets: stepping from (nx, ny) into (x, y) costs what entering (x, y) costs
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const cost = stepCost(s, x, y, kind, al);
        if (!Number.isFinite(cost)) continue;
        const j = ny * cols + nx, nd = c + cost;
        if (nd < d[j]) { d[j] = nd; (buckets[nd] ||= []).push(j); }
      }
    }
  }
  if (fieldMemo.size > 300) fieldMemo.clear();
  fieldMemo.set(key, { map: s.map, d });
  return d;
}

/** Route distance from a square to the field's targets (Infinity: no way in). */
export const routeAt = (s, d, p) => d[p.y * s.map.cols + p.x];

/**
 * Siege roles for a side: { attacker, defender } (both false off siege maps).
 * Attacker: what it wants (squares to take, or most enemies) is inside the walls while most of its army is outside.
 * Defender: it keeps squares inside, or most of its army is inside with the enemy outside.
 */
export function siegeRoles(s, side, S) {
  if (!hasWalls(s)) return { attacker: false, defender: false };
  const al = E.alliance(side), inside = (p) => E.insideCity(s, p.x, p.y) || E.isWallTop(s, p.x, p.y);
  const live = E.liveUnits(s), mine = live.filter(u => E.alliance(u.side) === al), foes = live.filter(u => E.alliance(u.side) !== al);
  const share = (us) => us.length ? us.filter(inside).length / us.length : 0;
  const myIn = share(mine), foeIn = share(foes);
  const takeIn = S.take.some(inside), keepIn = S.keep.some(inside);
  const attacker = (takeIn || (foeIn > 0.5 && myIn < 0.5)) && myIn < 0.75;
  const defender = keepIn || (myIn >= 0.5 && foeIn < 0.5);
  return { attacker, defender: defender && !attacker };
}
