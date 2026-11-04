// Battle AI (David, 2026-11-03): plays the enemy and/or allied side. Pure: works on engine state, no Foundry.
//
// How smart it plays comes from the side's tactician (Art of War, 0-5; no tactician plays as 1):
//   0-1  judges attacks by the raw numbers (damage, armor, charge) and ignores traits, holds and counters, so it
//        will charge cavalry into spears that are holding; barely thinks about what the enemy does back
//   2-3  plays each candidate attack out with the real rules a few times; weighs what the enemy can do back
//        before this unit acts again (turns alternate within a round, so every move is answered)
//   4-5  more samples, and plays out the strongest enemy reply to its best moves; delays (Hold) officers to react;
//        5 also lines up next round's attacks
// Lower levels also choose less precisely: their scores carry more random noise.
//
// The AI only knows what its side can see: hidden enemy units are left out of its planning.
import * as E from './engine.mjs';

const HOST = { id: 'host', host: true };

/** Mulberry32: a small seeded random generator, so a plan is repeatable for a given state. */
function seeded(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Settings for an Art of War level. */
export function profile(aow) {
  const l = Math.max(0, Math.min(5, Math.round(Number(aow) || 0)));
  return {
    level: l,
    naive: l <= 1,                          // judges attacks by raw numbers only
    samples: [1, 1, 4, 6, 10, 14][l],       // rule playouts per candidate attack
    noise: [0.55, 0.4, 0.25, 0.15, 0.07, 0.03][l],
    threatW: [0.1, 0.35, 0.6, 0.85, 1, 1][l],
    replies: l >= 4 ? (l >= 5 ? 6 : 4) : 0, // best candidates re-checked against a played-out enemy reply
    delay: l >= 3,                          // officers may Hold (act later) to react
    lookahead: l >= 5,                      // values standing where it can strike next round
    maxTiles: [12, 20, 35, 50, 70, 90][l],  // movement squares considered
  };
}

/** The Art of War level that plays this side: the side's tactician, else 1. */
export function sideLevel(s, side) {
  const tac = s.tactics?.sides?.[side];
  return tac ? Math.max(0, Math.min(5, Number(tac.aow) || 0)) : 1;
}

/** A copy of the state for trying things out. The map and the library are shared (never changed by a turn). */
export function fork(s) {
  const o = {};
  for (const k of Object.keys(s)) o[k] = (k === 'map' || k === 'library' || k === 'objectives') ? s[k] : (s[k] && typeof s[k] === 'object' ? JSON.parse(JSON.stringify(s[k])) : s[k]);
  o.log = [];
  return o;
}

/** The state as this side knows it: enemy units it can't see are left out. */
function knownState(s, side) {
  const v = fork(s), al = E.alliance(side);
  v.units = v.units.filter(u => E.alliance(u.side) === al || E.visibleTo(s, E.unitById(s, u.id), al));
  return v;
}

/** Full health (engine units made without a sheet have none recorded: 100). */
const mx = (u) => Math.max(1, Number(u && u.maxMen) || 100);

/** How much a unit is worth to its side. */
function worth(s, u) { const t = E.typeOf(s, u); const tier = Math.max(1, Number(t?.tier) || Number(t?.unitValue) || 1); return tier * tier * 0.5 + 1; }

/** Score change from `a` to `b` for `side`: enemy losses minus its own, by health share, morale and units lost. */
function outcomeScore(a, b, side) {
  const al = E.alliance(side); let v = 0;
  const gain = stanceOf(a, side) === 'defend' ? 1.1 : 1.35;
  for (const u0 of a.units) {
    const u1 = E.unitById(b, u0.id); if (!u1 || u0.status !== 'active') continue;
    // enemy losses count a little more than its own: a side that only trades evenly never attacks
    const w = worth(a, u0), sign = E.alliance(u0.side) === al ? -1 : gain;
    const dm = Math.max(0, u0.men - u1.men) / mx(u0);
    const dmo = Math.max(-20, Math.min(60, u0.morale - u1.morale)) / 100;
    const lost = u1.status !== 'active' ? 0.7 : 0;
    v += sign * w * (dm + 0.45 * dmo + lost);
  }
  return v;
}

/** Attack (go after the enemy) unless the side only has squares to keep: then it waits for the enemy to come. */
function stanceOf(s, side) { const g = goals(s, side); return g.keep.length && !g.take.length ? 'defend' : 'attack'; }

/** Raw-numbers guess at the casualties of a melee or ranged hit (no traits beyond the charge, no holds). */
function naiveHit(s, att, def, tiles) {
  const ta = E.typeOf(s, att), td = E.typeOf(s, def);
  const charge = ta.category === 'cavalry' && ta.weapon !== 'ranged' && tiles >= 2 ? Math.max(0, tiles - 1) + [0, 4, 6, 8, 10][att.fierceCharge || 0] : 0;
  return E.casualtiesOf((ta.damage || 0) + 2 + charge, td.armor || 0, ta.armorPen || 0, 0, 0);
}

/** Enemy units that could strike this unit before it acts again, with a guess at the harm, as a score (negative). */
function threatOf(s, u, side, P, areas) {
  if (!u || u.status !== 'active') return 0;
  const k = u.x + ',' + u.y, w = worth(s, u), hits = [];
  const holding = !!(u.round && u.round.holding);
  for (const e of E.liveUnits(s)) {
    if (!E.hostile(e, u)) continue;
    const ar = areas.get(e.id); if (!ar || !(ar.attack.has(k) || ar.move.has(k) || E.manhattan(e, u) <= 1)) continue;
    const te = E.typeOf(s, e);
    const cav = te.category === 'cavalry' && te.weapon !== 'ranged';
    let harm = naiveHit(s, e, u, cav ? Math.min(E.movementOf(s, e), E.manhattan(e, u)) : 0) / mx(u);
    // what a skilled side knows: spears that hold make charging cavalry pay
    if (!P.naive && cav && holding && (E.unitTrait(u, 'charge reflection') || E.unitTrait(u, 'brace'))) harm = -0.5 * harm * worth(s, e) / w;
    else if (!P.naive && cav && E.unitTrait(u, 'anti-cavalry')) harm *= 0.6;
    hits.push(harm);
  }
  hits.sort((x, y) => y - x);
  const top = hits.slice(0, 3).reduce((t, h, i) => t + h * [1, 0.6, 0.35][i], 0);
  return -P.threatW * (stanceOf(s, side) === 'defend' ? 1 : 0.75) * w * Math.min(1.2, top);
}

/** What this unit can strike next turn from where it ends (the other half of standing close): a score (positive). */
function pressureOf(s, u, P) {
  if (!u || u.status !== 'active') return 0;
  const t = E.typeOf(s, u), reach = E.movementOf(s, u) + Math.max(1, t.rangeMax || 1);
  let best = 0;
  for (const e of E.liveUnits(s)) {
    if (!E.hostile(u, e) || E.manhattan(u, e) > reach) continue;
    const cav = t.category === 'cavalry' && t.weapon !== 'ranged';
    best = Math.max(best, worth(s, e) * naiveHit(s, u, e, cav ? 3 : 0) / mx(e));
  }
  return 0.5 * P.threatW * best;
}

/** Squares the side wants to take or keep (from the battle's victory and defeat conditions). */
function goals(s, side) {
  const o = s.objectives || {}, al = E.alliance(side);
  const take = [], keep = [];
  const tile = (c) => [c.x, c.y];
  for (const c of o.victory || []) if (['seize', 'hold', 'burn'].includes(c.type)) (al === 'player' ? take : keep).push(tile(c));
  for (const c of o.defeat || []) if (c.type === 'tileSeized') (al === 'player' ? keep : take).push(tile(c));
  if (al !== 'player') for (const k of o.extraction || []) keep.push(k.split(',').map(Number));
  return { take, keep };
}

function nearest(u, pts) { let d = Infinity; for (const [x, y] of pts) d = Math.min(d, Math.abs(u.x - x) + Math.abs(u.y - y)); return d; }

/** Where the unit stands at the end of its turn: closing on enemies, objectives, and (level 5) next round's strikes. */
function positionScore(s0, s1, u0, u1, side, P) {
  if (!u1 || u1.status !== 'active') return 0;
  const w = worth(s0, u0), t = E.typeOf(s0, u0), ranged = t.weapon === 'ranged';
  const foes = E.liveUnits(s0).filter(e => E.hostile(e, u0));
  let v = 0;
  if (foes.length) {
    const d0 = Math.min(...foes.map(e => E.manhattan(e, u0))), d1 = Math.min(...foes.map(e => E.manhattan(e, u1)));
    const want = ranged ? Math.max(1, t.rangeMax || 1) : 1;
    v += 0.012 * w * (Math.abs(d0 - want) - Math.abs(d1 - want)); // close in (melee) or reach shooting range (ranged)
    if (P.lookahead) {
      const reach = E.movementOf(s1, u1) + (ranged ? t.rangeMax || 1 : 1);
      const weak = foes.filter(e => E.manhattan(e, u1) <= reach).map(e => worth(s1, e) * (1 - e.men / mx(e) + 0.2));
      if (weak.length) v += 0.05 * w * Math.max(...weak);
    }
  }
  const g = goals(s0, side);
  if (g.take.length) v += 0.08 * w * (nearest(u0, g.take) - nearest(u1, g.take));
  if (g.keep.length && foes.length) {
    const d1 = nearest(u1, g.keep), threatNear = foes.some(e => nearest(e, g.keep) <= 6);
    if (threatNear) v += 0.06 * w * (nearest(u0, g.keep) - d1) + (d1 <= 1 ? 0.1 * w : 0);
  }
  return v;
}

/** Finish an activation in a playout: second strikes on the weakest offered enemy, stay put on repositions. */
function finishPlayout(f, uid) {
  for (let guard = 0; guard < 4; guard++) {
    const ac = f.turn.activation; if (!ac || ac.unitId !== uid) return;
    if (ac.step === 'second' && ac.second) { E.act(f, HOST, { type: 'secondAttack', unitId: uid, targetId: ac.second.targets[0] }); continue; }
    if (ac.step === 'reposition') { E.act(f, HOST, { type: 'reposition', unitId: uid }); continue; }
    E.act(f, HOST, { type: 'endTurn', unitId: uid }); return;
  }
}

/** Play an enemy's strongest reply on this unit: it steps next to it (or shoots from where it is) and attacks. */
function replyScore(s, uid, side, areas) {
  const u = E.unitById(s, uid); if (!u || u.status !== 'active') return 0;
  const k = u.x + ',' + u.y; let worst = 0;
  for (const e of E.liveUnits(s)) {
    if (!E.hostile(e, u)) continue;
    const ar = areas.get(e.id); if (!ar || !(ar.attack.has(k) || ar.move.has(k))) continue;
    const te = E.typeOf(s, e), ranged = te.weapon === 'ranged';
    let spot = null;
    if (ranged && E.rangeOk(s, e, u)) spot = { x: e.x, y: e.y };
    else for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = u.x + dx, y = u.y + dy, kk = x + ',' + y;
      if ((ar.move.has(kk) || (e.x === x && e.y === y)) && !(E.unitAt(s, x, y) && E.unitAt(s, x, y) !== e)) { spot = { x, y }; break; }
    }
    if (!spot) continue;
    let tot = 0; const N = 3;
    for (let i = 0; i < N; i++) {
      const f = fork(s); E.setRng(seeded(hashStr(uid + e.id + i)));
      const fe = E.unitById(f, e.id), fu = E.unitById(f, uid);
      const tiles = Math.abs(fe.x - spot.x) + Math.abs(fe.y - spot.y);
      fe.x = spot.x; fe.y = spot.y;
      try { E.resolveAttack(f, fe, fu, { movedThisActivation: tiles > 0, tilesMoved: tiles }); } catch { continue; }
      tot += outcomeScore(s, f, side);
    }
    worst = Math.min(worst, tot / N);
  }
  return worst;
}

/**
 * Candidate plans for the unit whose activation is under way: where to move (or stay), then attack, hold or end.
 * Returns [{ actions, score }] best first. `s` must be the full state; the AI only uses what its side can see.
 */
export function plans(s, unitId, opts = {}) {
  const u0full = E.unitById(s, unitId); if (!u0full) return [];
  const side = u0full.side, P = profile(opts.level ?? sideLevel(s, side));
  const base = knownState(s, side);
  const u0 = E.unitById(base, unitId);
  const ac = base.turn.activation; if (!ac || ac.unitId !== unitId) return [];
  const rand = seeded(hashStr(unitId + ':' + base.turn.round + ':' + (opts.salt || '')));
  const areas = new Map(E.liveUnits(base).filter(e => E.hostile(e, u0)).map(e => [e.id, E.threatArea(base, e)]));
  const out = [];
  const consider = (actions, f) => {
    const u1 = E.unitById(f, unitId);
    const o1 = outcomeScore(base, f, side), p1 = positionScore(base, f, u0, u1, side, P), t1 = threatOf(f, u1, side, P, areas) + pressureOf(f, u1, P);
    let sc = o1 + p1 + t1;
    out.push({ actions, score: sc, state: f });
  };
  // reload first if the weapon needs it
  if (u0.fx && u0.fx.reload && !u0.round.attacked) {
    const f = fork(base); E.act(f, HOST, { type: 'reload', unitId });
    consider([{ type: 'reload', unitId }], f);
  }
  // where to stand
  let starts = [{ pre: [], f: base }];
  if (ac.step === 'move' && !u0.round.cannotMove) {
    const { blue } = E.moveOptions(base, u0);
    let tiles = [...blue.keys()].map(k => k.split(',').map(Number));
    const foes = E.liveUnits(base).filter(e => E.hostile(e, u0));
    const g = goals(base, side);
    const heur = ([x, y]) => Math.min(99, ...foes.map(e => Math.abs(e.x - x) + Math.abs(e.y - y))) + 0.5 * Math.min(99, nearest({ x, y }, [...g.take, ...g.keep]));
    tiles.sort((A, B) => heur(A) - heur(B));
    if (tiles.length > P.maxTiles) tiles = [...tiles.slice(0, Math.ceil(P.maxTiles * 0.7)), ...tiles.slice(Math.ceil(P.maxTiles * 0.7)).sort(() => rand() - 0.5).slice(0, Math.floor(P.maxTiles * 0.3))];
    starts = [{ pre: [{ type: 'skipMove', unitId }], f: (() => { const f = fork(base); E.act(f, HOST, { type: 'skipMove', unitId }); return f; })() }];
    for (const [x, y] of tiles) {
      const f = fork(base); E.setRng(seeded(hashStr(unitId + x + ',' + y)));
      const r = E.act(f, HOST, { type: 'moveTo', unitId, x, y });
      if (!r.ok) continue;
      starts.push({ pre: [{ type: 'moveTo', unitId, x, y }], f });
    }
  }
  for (const { pre, f } of starts) {
    const u = E.unitById(f, unitId);
    if (!u || u.status !== 'active') { consider(pre, f); continue; }
    const acf = f.turn.activation;
    if (!acf || acf.unitId !== unitId) { consider(pre, f); continue; } // the move ended the turn (it was struck, or climbed)
    // attack each target in reach
    if (!u.round.attacked && !(u.fx && u.fx.reload)) for (const d of E.attackTargets(f, u)) {
      const tid = typeof d === 'string' ? d : d.id;
      const target = E.unitById(f, tid); if (!target) continue;
      const act = { type: 'attack', unitId, targetId: tid };
      if (P.naive) {
        // raw numbers: what it expects to do, and what it expects back (melee only), traits and holds ignored
        const g = fork(f); const gu = E.unitById(g, unitId), gt = E.unitById(g, tid);
        const tiles = acf.movedThisActivation ? acf.tilesMoved || 0 : 0;
        const ta = E.typeOf(g, gu), ranged = ta.weapon === 'ranged' && E.manhattan(gu, gt) > 1;
        gt.men = Math.max(0, gt.men - naiveHit(g, gu, gt, ranged ? 0 : tiles));
        if (!ranged) gu.men = Math.max(0, gu.men - Math.round(naiveHit(g, gt, gu, 0) * 0.5));
        if (gt.men <= 0) gt.status = 'defeated';
        gu.round.attacked = true;
        consider([...pre, act], g);
        continue;
      }
      // real rules, several times
      const runs = [];
      for (let i = 0; i < P.samples; i++) {
        const g = fork(f); E.setRng(seeded(hashStr(unitId + tid + i + pre.map(a => a.x + ',' + a.y).join())));
        const r = E.act(g, HOST, act); if (!r.ok) break;
        finishPlayout(g, unitId); runs.push(g);
      }
      if (!runs.length) continue;
      // average the playouts' scores; keep one of them as the representative end state
      const scores = runs.map(g => { const u1 = E.unitById(g, unitId); return outcomeScore(base, g, side) + positionScore(base, g, u0, u1, side, P) + threatOf(g, u1, side, P, areas) + pressureOf(g, u1, P); });
      out.push({ actions: [...pre, act], score: scores.reduce((t, x) => t + x, 0) / scores.length, state: runs[0] });
    }
    // hold position (defensive stance)
    if (!u.round.attacked && !acf.forcedMarched) {
      const g = fork(f); const r = E.act(g, HOST, { type: 'holdPosition', unitId });
      if (r.ok) consider([...pre, { type: 'holdPosition', unitId }], g);
    }
    // overwatch (ranged, nothing to shoot yet)
    if (E.typeOf(f, u).weapon === 'ranged' && !u.round.attacked && !E.attackTargets(f, u).length) {
      const g = fork(f); const r = E.act(g, HOST, { type: 'overwatch', unitId });
      if (r.ok) { consider([...pre, { type: 'overwatch', unitId }], g); out[out.length - 1].score += 0.02 * worth(base, u0); }
    }
    // just end the turn here
    { const g = fork(f); E.act(g, HOST, { type: 'endTurn', unitId }); consider([...pre, { type: 'endTurn', unitId }], g); }
  }
  // the best few, checked against the enemy's strongest reply
  out.sort((a, b) => b.score - a.score);
  if (P.replies) for (const c of out.slice(0, P.replies)) c.score += 0.6 * replyScore(c.state, unitId, side, areas);
  // noise: lower levels choose less precisely
  const scale = 0.08 * worth(base, u0);
  for (const c of out) { const n = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()); c.score += n * P.noise * scale; }
  out.sort((a, b) => b.score - a.score);
  E.setRng(Math.random);
  return out.map(({ actions, score }) => ({ actions, score }));
}

/** The next action for the unit whose activation is under way (the plan is made again after each step). */
export function nextAction(s, unitId, opts = {}) {
  const ac = s.turn.activation;
  if (!ac || ac.unitId !== unitId) return null;
  const u = E.unitById(s, unitId);
  const side = u.side, P = profile(opts.level ?? sideLevel(s, side));
  // follow-up choices inside an attack
  if (ac.step === 'second' && ac.second) {
    const ids = ac.second.targets.filter(id => E.unitById(s, id));
    const best = ids.sort((a, b) => (E.unitById(s, a).men / mx(E.unitById(s, a))) - (E.unitById(s, b).men / mx(E.unitById(s, b))))[0];
    return { type: 'secondAttack', unitId, targetId: best };
  }
  if (ac.step === 'reposition' && ac.reposition) {
    if (P.naive || !ac.reposition.tiles?.length) return { type: 'reposition', unitId };
    const areas = new Map(E.liveUnits(s).filter(e => E.hostile(e, u)).map(e => [e.id, E.threatArea(s, e)]));
    let best = null, bestV = threatOf(s, u, side, P, areas);
    for (const [x, y] of ac.reposition.tiles) {
      const f = fork(s); const fu = E.unitById(f, unitId); fu.x = x; fu.y = y;
      const v = threatOf(f, fu, side, P, areas); if (v > bestV) { bestV = v; best = { x, y }; }
    }
    return best ? { type: 'reposition', unitId, x: best.x, y: best.y } : { type: 'reposition', unitId };
  }
  const list = plans(s, unitId, opts);
  return list.length ? list[0].actions[0] : { type: 'endTurn', unitId };
}

/** Best score this unit could get if it acted now (used for Hold decisions and for picking which unit goes). */
export function bestScore(s, unitId, opts = {}) {
  const f = fork(s), u = E.unitById(f, unitId);
  if (!u) return -Infinity;
  if (!f.turn.activation) {
    const p = E.prompt(f);
    const r = p.kind === 'decide' || p.kind === 'final' ? E.act(f, HOST, { type: 'decide', unitId, choice: 'act' }) : E.act(f, HOST, { type: 'begin', unitId });
    if (!r.ok) return -Infinity;
  }
  const list = plans(f, unitId, opts);
  return list.length ? list[0].score : -Infinity;
}

/**
 * An officer's turn comes up (kind 'decide' or 'final'): act now, or Hold to act after others (levels 3+).
 * Holding is worth it when nothing good is on offer now and enemy units have still to move this round.
 */
export function decision(s, unitId, opts = {}) {
  const p = E.prompt(s);
  const u = E.unitById(s, unitId), side = u.side, P = profile(opts.level ?? sideLevel(s, side));
  if (p.kind === 'final' || !P.delay) return { type: 'decide', unitId, choice: 'act' };
  const foesToCome = E.liveUnits(s).filter(e => E.hostile(e, u) && !e.round.activated && E.manhattan(e, u) <= 12);
  if (!foesToCome.length) return { type: 'decide', unitId, choice: 'act' };
  const sc = bestScore(s, unitId, { ...opts, level: P.level });
  return { type: 'decide', unitId, choice: sc < 0.05 * worth(s, u) ? 'hold' : 'act' };
}

/** An officer-less turn for this side: which unit goes (the one with the best move; levels 0-1 pick at random). */
export function pickUnit(s, side, opts = {}) {
  const P = profile(opts.level ?? sideLevel(s, side));
  const mine = E.liveUnits(s).filter(u => u.side === side && !u.officerId && !u.round.activated);
  if (!mine.length) return null;
  if (P.naive) return { type: 'begin', unitId: mine[Math.floor(seeded(hashStr(side + s.turn.round + mine.length))() * mine.length)].id };
  let best = mine[0], bestV = -Infinity;
  for (const u of mine) { const v = bestScore(s, u.id, { ...opts, level: Math.min(P.level, 3) }); if (v > bestV) { bestV = v; best = u; } }
  return { type: 'begin', unitId: best.id };
}

/** What the AI does next, if it is this side's move: an action, or null when it's someone else's turn. */
export function aiStep(s, sides, opts = {}) {
  const on = (side) => !!sides?.[side];
  if (s.duels?.pending) return null;
  const p = E.prompt(s);
  if (p.kind === 'activation') {
    const u = E.unitById(s, p.unitId);
    return u && on(u.side) && !u.owner ? nextAction(s, u.id, opts) : null;
  }
  if (p.kind === 'decide' || p.kind === 'final') {
    const u = E.unitById(s, p.unitId);
    return u && on(u.side) && !u.owner ? decision(s, u.id, opts) : null;
  }
  if (p.kind === 'host-pick' && on(p.side)) return pickUnit(s, p.side, opts);
  return null;
}
