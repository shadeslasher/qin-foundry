// Battle AI: placing tactics (David, 2026-11-04). Pure: works on engine state, no Foundry.
//
// During the tactics phase an AI-run side (enemy or ally) with no tactician takes its officer with the best Art of
// War; then it places Art of War + 1 tactics (each within its Art of War, no duplicates, high-ground tactics only on
// high ground), the same limits players have. It scores every tactic it can use at likely squares: where its units
// stand, where they will be after their first move (towards the enemy or the square they're sent to), the squares
// it must keep or take, and high ground (Raise Flag). Each tactic is worth what its trigger is likely to do there,
// for the units it covers: cavalry for Cavalry Charge, ranged units for Divine Winds, hidden units for Ambush,
// infantry that will hold for Hold the Line, flammable ground near the enemy for Set Aflame... weighed by the
// side's posture (aggressive sides favour attack tactics, defensive ones defense and holding). Better tacticians
// read the field better; poor ones sometimes settle for a weaker square or tactic.
// The side's placements are marked done with its last one (engine `aiDone`), so the GM can move or remove them.
import * as E from './engine.mjs';
import { TACTICS } from './engine-data.mjs';
import { strategy } from './ai.mjs';

const HEROIC = false; // heroic actions are switched off in battles (engine HEROIC_ENABLED)

function seeded(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const worth = (s, u) => { const t = E.typeOf(s, u); const tier = Math.max(1, Number(t?.tier) || Number(t?.unitValue) || 1); return tier * tier * 0.5 + 1; };

/** The officer with the best Art of War among this side's units (a tactician entry), or null. */
export function bestTactician(s, side) {
  let best = null;
  for (const u of E.liveUnits(s)) {
    if (u.side !== side || !u.officerId) continue;
    const o = E.officerOf(s, u); if (!o) continue;
    const aow = Number(o.skills?.artOfWar ?? o.skills?.artofwar) || 0;
    if (aow >= 1 && (!best || aow > best.aow)) best = { id: o.id, name: o.name, aow, kind: 'officer' };
  }
  return best;
}

/** Where a unit will likely be after its first move: up to its movement towards its job square or the nearest enemy. */
function frontOf(s, u, S, foes) {
  const job = S.jobs.get(u.id);
  let to = job ? job.pt : null;
  if (!to && foes.length) to = foes.reduce((b, e) => (!b || E.manhattan(u, e) < E.manhattan(u, b) ? e : b), null);
  if (!to) return { x: u.x, y: u.y };
  const d = E.manhattan(u, to), step = Math.min(E.movementOf(s, u), Math.max(0, d - 1));
  if (!d || !step) return { x: u.x, y: u.y };
  return { x: Math.round(u.x + (to.x - u.x) * step / d), y: Math.round(u.y + (to.y - u.y) * step / d) };
}

const inArea = (c, size, p) => Math.abs(p.x - c.x) <= size && Math.abs(p.y - c.y) <= size;
const hides = (s, x, y) => !!E.tileRules(s, x, y)?.hides;
const flammable = (s, x, y) => !!E.tileRules(s, x, y)?.flammable;

/**
 * How much tactic `d` placed at `c` is worth to this side: for each of its units the area will cover (now, or after
 * its first move), how likely the trigger is and how much the effect helps it.
 */
export function tacticValue(s, side, S, d, c, ctx) {
  const { mine, foes, front } = ctx;
  const aggr = S.posture === 'aggressive' ? 1.25 : S.posture === 'balanced' ? 1 : S.posture === 'defensive' ? 0.65 : 0.45;
  const defn = S.posture === 'defensive' || S.posture === 'stall' ? 1.3 : S.posture === 'balanced' ? 1 : 0.7;
  const size = d.reach ?? d.size;
  const ally = (u) => { const t = E.typeOf(s, u); return { t, cav: t.category === 'cavalry' && t.weapon !== 'ranged', ranged: t.weapon === 'ranged', melee: t.weapon !== 'ranged', inf: t.category === 'infantry' }; };
  // a unit counts fully when it stands in the area now and after its first move, half when only one of them
  const cover = (u) => (inArea(c, size, u) ? 0.5 : 0) + (inArea(c, size, front.get(u.id)) ? 0.5 : 0);
  const enemiesNear = (p, r) => foes.filter(e => E.manhattan(e, p) <= r).length;
  let v = 0;
  for (const u of mine) {
    const k = cover(u); if (!k) continue;
    const a = ally(u), w = worth(s, u), f = front.get(u.id);
    const fight = enemiesNear(f, E.movementOf(s, u) + 2) ? 1 : 0.4; // will it see action from there?
    let p = 0;
    switch (d.key) {
      case 'attack': p = 1.0 * aggr * fight; break;
      case 'defend': p = 1.0 * defn * fight; break;
      case 'flanking': p = (a.cav ? 1 : 0.35) * aggr * fight; break;
      case 'ambush': p = (u.hidden || hides(s, u.x, u.y) || hides(s, f.x, f.y) ? 1 : 0.1) * (E.unitTrait(u, 'ambusher') ? 1.6 : 1) * fight; break;
      case 'cavalryCharge': p = a.cav ? 1.6 * aggr * fight : 0; break;
      case 'surround': p = 0.5 * aggr * fight; break;
      case 'rapidAdvance': p = u.officerId ? (S.posture === 'stall' || S.take.length ? 0.8 : 0.3) : 0; break;
      case 'backsTurned': p = a.melee ? 0.7 * defn * fight : 0; break;
      case 'holdTheLine': p = a.inf && a.melee ? 1.2 * defn * (E.unitTrait(u, 'brace') || E.unitTrait(u, 'anti-cavalry') ? 1.4 : 1) * fight : 0; break;
      case 'heroNeeded': p = HEROIC && u.officerId ? 0.6 : 0; break;
      case 'divineWinds': p = a.ranged ? 1.5 * fight : 0; break;
      case 'allOutAttack': p = a.melee ? 0.9 * aggr * fight : 0; break;
      case 'inspiring': p = u.officerId && foes.some(e => e.officerId) ? 0.5 * fight : 0; break;
      case 'phoenix': p = a.melee ? 1.6 * aggr * fight : 0; break;
      case 'fear': p = 0.35 * defn * fight; break;
      case 'brutalize': p = 0.7 * aggr * fight; break;
      case 'warrior1000': case 'clearPath': {
        const o = u.officerId ? E.officerOf(s, u) : null;
        p = o && E.officerWeaponLevel(o, a.t) >= 5 ? 2 * fight : 0; break;
      }
      case 'raiseFlag': p = 0.5 * defn; break; // rallies units around the flag; someone must stand on it
      case 'setAflame': {
        // flammable ground next to where it will stand, with enemies close to that ground
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = f.x + dx, y = f.y + dy;
          if (flammable(s, x, y) && enemiesNear({ x, y }, 3)) n++;
        }
        p = Math.min(2, n) * 0.6; break;
      }
    }
    v += k * p * w;
  }
  // Raise Flag only works from high ground with a unit on the flag: worth more on a square it must keep
  if (d.key === 'raiseFlag') {
    if (!E.tileRules(s, c.x, c.y)?.high) return 0;
    if (S.keep.some(p => E.manhattan(p, c) <= 2)) v *= 1.5;
    if (!mine.some(u => E.manhattan(u, c) <= E.movementOf(s, u) * 2)) return 0;
  }
  // Brutalize hurts the enemies in its area: count them
  if (d.key === 'brutalize') v *= 0.4 + 0.3 * Math.min(3, foes.filter(e => inArea(c, size, e)).length);
  return v;
}

/** The tactics this side would place: [{ key, x, y, highGround }], best first, within its Art of War. */
export function planTactics(s, side, opts = {}) {
  const tac = s.tactics?.sides?.[side]; if (!tac) return [];
  const aow = Math.max(0, Number(tac.aow) || 0), slots = aow + 1;
  const level = Math.min(5, aow);
  // the side knows its own units and the enemies it can see
  const al = E.alliance(side);
  const mine = E.liveUnits(s).filter(u => u.side === side);
  const foes = E.liveUnits(s).filter(u => E.alliance(u.side) !== al && E.visibleTo(s, u, al));
  if (!mine.length) return [];
  const S = opts.strategy || strategy(s, side);
  const front = new Map(mine.map(u => [u.id, frontOf(s, u, S, foes)]));
  const ctx = { mine, foes, front };
  // squares worth trying
  const cands = new Map();
  const add = (p) => { if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) cands.set(p.x + ',' + p.y, { x: p.x, y: p.y }); };
  for (const u of mine) { add(u); add(front.get(u.id)); }
  for (const p of [...S.keep, ...S.take]) add(p);
  if (mine.length > 1) { // the army's middle, now and after the first move
    const avg = (ps) => ({ x: Math.round(ps.reduce((t, p) => t + p.x, 0) / ps.length), y: Math.round(ps.reduce((t, p) => t + p.y, 0) / ps.length) });
    add(avg(mine)); add(avg([...front.values()]));
  }
  // high ground near the army or its squares (Raise Flag)
  for (const k of Object.keys(s.map?.tiles || {})) {
    const [x, y] = k.split(',').map(Number);
    if (E.tileRules(s, x, y)?.high && (mine.some(u => E.manhattan(u, { x, y }) <= 8) || S.keep.some(p => E.manhattan(p, { x, y }) <= 3))) add({ x, y });
  }
  const usable = TACTICS.filter(d => (d.aow ?? 1) <= aow);
  const rand = seeded(hashStr(side + ':tactics:' + (s.turn?.round ?? 0) + ':' + mine.length));
  const noise = [0.6, 0.45, 0.3, 0.15, 0.06, 0.02][level];
  const scored = [];
  for (const d of usable) {
    let best = null;
    for (const c of cands.values()) {
      let v = tacticValue(s, side, S, d, c, ctx);
      if (v <= 0) continue;
      v *= 1 + noise * (rand() * 2 - 1); // poorer tacticians misjudge the field
      if (!best || v > best.v) best = { key: d.key, x: c.x, y: c.y, v, highGround: !!E.tileRules(s, c.x, c.y)?.high };
    }
    if (best) scored.push(best);
  }
  scored.sort((a, b) => b.v - a.v);
  return scored.slice(0, slots).map(({ key, x, y, highGround }) => ({ key, x, y, highGround }));
}

/**
 * The AI's next step in the tactics phase for this side: choose a tactician, place the next tactic, or nothing.
 */
export function tacticsStep(s, side, opts = {}) {
  const T = s.tactics;
  if (!T || T.phase !== 'setup' || s.turn?.phase !== 'tactics') return null;
  const tac = T.sides?.[side];
  if (!tac) {
    const best = bestTactician(s, side);
    return best ? { type: 'setTactician', side, tactician: best, ai: true } : null;
  }
  if (tac.aiDone) return null;
  const plan = planTactics(s, side, opts);
  const placed = new Set(T.placed.filter(p => p.side === side).map(p => p.key));
  const todo = plan.filter(p => !placed.has(p.key));
  if (!todo.length) return null;
  const next = todo[0];
  return { type: 'placeTactic', side, key: next.key, x: next.x, y: next.y, highGround: next.highGround, ai: true, last: todo.length === 1 };
}
