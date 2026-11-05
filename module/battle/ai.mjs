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
//
// Strategy (David, 2026-11-04): before planning, the side reads the battle's objectives, the clock and its own
// coming reinforcements (see strategy()) and settles on a posture and a job for each unit:
//   - the opponent must seize or burn a square: the side keeps it, its strongest officer unit sits on it, and the
//     army plays more defensively around it
//   - the opponent only has to survive (or hold a square for rounds): the side attacks, harder as time runs out
//   - the opponent races a turn limit: time is on the side's side, so it plays defensively
//   - its own reinforcements are on the way: it plays for time (stays out of reach, takes good ground) until they come
//   - several squares to keep or take: units are split between them, each square gets its own anchor and guards
//   - units the opponent must rout are kept safe; units the opponent must keep alive (or get out) are hunted
// Every unit also values good ground (defense, command, high ground, cover; fire and fords are bad), more so in
// a defensive posture.
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
function outcomeScore(a, b, side, S) {
  const al = E.alliance(side); let v = 0;
  const gain = S ? S.gain : 1.35;
  for (const u0 of a.units) {
    const u1 = E.unitById(b, u0.id); if (!u1 || u0.status !== 'active') continue;
    // enemy losses count a little more than its own: a side that only trades evenly never attacks
    const mine = E.alliance(u0.side) === al;
    let w = worth(a, u0);
    if (S && mine && S.protect.has(u0.id)) w *= 1.8; // the opponent needs this one routed: keep it safe
    if (S && !mine && S.hunt.has(u0.id)) w *= 1.8;   // the opponent needs this one alive (or out): go for it
    const sign = mine ? -1 : gain;
    const dm = Math.max(0, u0.men - u1.men) / mx(u0);
    const dmo = Math.max(-20, Math.min(60, u0.morale - u1.morale)) / 100;
    const lost = u1.status !== 'active' ? 0.7 : 0;
    v += sign * w * (dm + 0.45 * dmo + lost);
  }
  return v;
}

/** Raw-numbers guess at the casualties of a melee or ranged hit (no traits beyond the charge, no holds). */
function naiveHit(s, att, def, tiles) {
  const ta = E.typeOf(s, att), td = E.typeOf(s, def);
  const charge = ta.category === 'cavalry' && ta.weapon !== 'ranged' && tiles >= 2 ? Math.max(0, tiles - 1) + [0, 4, 6, 8, 10][att.fierceCharge || 0] : 0;
  return E.casualtiesOf((ta.damage || 0) + 2 + charge, td.armor || 0, ta.armorPen || 0, 0, 0);
}

/** Enemy units that could strike this unit before it acts again, with a guess at the harm, as a score (negative). */
function threatOf(s, u, side, P, areas, S) {
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
  const prot = S && S.protect.has(u.id) ? 1.6 : 1;
  return -P.threatW * (S ? S.threatMult : 0.75) * prot * w * Math.min(1.2, top);
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

const POSTURE = {
  //            gain on enemy losses, threat weight, closing on enemies, good ground
  aggressive: { gain: 1.55, threatMult: 0.6, close: 2, ground: 0.6 },
  balanced: { gain: 1.35, threatMult: 0.75, close: 1, ground: 1 },
  defensive: { gain: 1.15, threatMult: 1, close: 0.35, ground: 1.6 },
  stall: { gain: 1.05, threatMult: 1.3, close: -0.6, ground: 1.6 }, // play for time: stay out of reach
};
const tileKey = (c) => c.x + ',' + c.y;
const ptOf = (k) => { const [x, y] = String(k).split(',').map(Number); return { x, y }; };

/** How strong a unit is to hold ground: its worth, health, morale, and its officer. */
function strength(s, u) {
  const t = E.typeOf(s, u), off = u.officerId ? E.officerOf(s, u) : null;
  let v = worth(s, u) * (0.4 + 0.6 * u.men / mx(u)) * (0.7 + 0.3 * Math.min(100, u.morale ?? 50) / 100);
  if (off) v *= 1.25 + 0.08 * (Number(off.command) || 0);
  if (t.weapon === 'ranged') v *= 0.6; // a square is kept by those who can fight on it
  return v;
}

/**
 * The side's plan for the battle: its posture, the squares it keeps or takes, which unit goes where, and the
 * units to protect or hunt. Read from the objectives, the round, its coming reinforcements and the army sizes.
 *   { posture, gain, threatMult, close, ground, aggr, keep: [{x,y}], take: [{x,y}], jobs: Map(unitId -> { pt, kind, anchor }),
 *     protect: Set, hunt: Set, reinforceRound, why: [text] }
 */
export function strategy(s, side) {
  const o = s.objectives || {}, st = s.objState || {}, al = E.alliance(side);
  const round = Number(s.turn?.round) || 0, done = Number(st.roundsDone) || 0;
  const keep = new Map(), take = new Map(), protect = new Set(), hunt = new Set(), why = [];
  const escapeTake = new Map(); // unitId -> extraction squares it heads for (ally side)
  let aggr = 0;
  const left = (c) => Math.max(0, (Number(c.rounds) || 0) - done);
  const pairedHold = new Set((o.victory || []).filter(c => c.type === 'hold').map(c => c.id));
  const enemySide = al !== 'player'; // the AI is playing against the players' objectives
  for (const c of o.victory || []) {
    const k = c.x !== undefined && c.x !== null ? tileKey(c) : null;
    if (enemySide) switch (c.type) {
      case 'seize': if (k) keep.set(k, 'seize'); aggr -= 0.35; why.push('keep ' + k + ' (opponent must seize it)'); break;
      case 'burn': if (k) keep.set(k, 'burn'); aggr -= 0.25; why.push('guard ' + k + ' (opponent must burn it)'); break;
      case 'hold': if (k) take.set(k, 'hold'); aggr += 0.25; why.push('take ' + k + ' (opponent must hold it)'); break;
      case 'survive': { const f = c.rounds ? 1 - left(c) / c.rounds : 0; aggr += 0.6 + 0.4 * f; why.push('attack: opponent only has to survive'); break; }
      case 'routUnit': for (const id of c.unitIds || []) protect.add(id); break;
      case 'escape': for (const id of c.unitIds || []) hunt.add(id); for (const e of o.extraction || []) keep.set(e, 'extraction'); aggr += 0.2; break;
    } else switch (c.type) {
      case 'seize': case 'burn': if (k) take.set(k, c.type); aggr += 0.2; break;
      case 'hold': if (k) keep.set(k, 'hold'); aggr -= 0.3; break;
      case 'survive': aggr -= 0.5; why.push('play for time: survive'); break;
      case 'routUnit': for (const id of c.unitIds || []) hunt.add(id); break;
      case 'escape': for (const id of c.unitIds || []) { protect.add(id); escapeTake.set(id, o.extraction || []); } break;
    }
  }
  for (const c of o.defeat || []) {
    const k = c.x !== undefined && c.x !== null ? tileKey(c) : null;
    if (enemySide) switch (c.type) {
      case 'unitRouted': for (const id of c.unitIds || []) hunt.add(id); aggr += 0.15; break;
      case 'tileSeized': if (k) take.set(k, 'seize'); break;
      case 'turnLimit': aggr -= 0.5; why.push('defend: the opponent is racing the clock'); break;
    } else switch (c.type) {
      case 'unitRouted': for (const id of c.unitIds || []) protect.add(id); break;
      case 'tileSeized': if (k && !pairedHold.has(c.pair)) keep.set(k, 'defend'); aggr -= 0.2; break;
      case 'turnLimit': { const f = c.rounds ? 1 - left(c) / c.rounds : 0; aggr += 0.4 + 0.4 * f; why.push('attack: the clock is running'); break; }
    }
  }
  // a square both kept and taken (a Hold): fight for it
  for (const k of take.keys()) keep.delete(k);
  // the army sizes, and help on the way
  const live = E.liveUnits(s), mine = live.filter(u => E.alliance(u.side) === al), foes = live.filter(u => E.alliance(u.side) !== al);
  const power = (us) => us.reduce((t, u) => t + worth(s, u) * u.men / mx(u), 0);
  const myP = power(mine), foeP = power(foes);
  const coming = (s.incoming || []).filter(r => r.side && E.alliance(r.side) === al && (r.round ?? Infinity) > round);
  let reinforceRound = null;
  if (coming.length && mine.length) {
    reinforceRound = Math.min(...coming.map(r => r.round ?? Infinity));
    const extra = coming.reduce((t, r) => t + (Math.max(1, r.tier) ** 2 * 0.5 + 1), 0);
    const soon = Math.max(0, reinforceRound - round);
    aggr -= Math.min(0.9, 0.35 + 0.4 * extra / Math.max(1, myP)) * (soon <= 3 ? 1 : 0.6);
    why.push('play for time: reinforcements in round ' + reinforceRound);
  }
  if (foeP > 0 && myP > 0) aggr += Math.max(-0.15, Math.min(0.15, 0.2 * (myP / foeP - 1))); // a much bigger army leans in a little
  aggr = Math.max(-1, Math.min(1, aggr));
  const posture = aggr > 0.35 ? 'aggressive' : (coming.length && aggr < -0.35) ? 'stall' : aggr < -0.2 ? 'defensive' : 'balanced';
  // jobs: each square gets an anchor (strongest nearby unit; keep squares only) and its share of guards
  const jobs = new Map();
  const pts = [...[...keep.keys()].map(k => ({ ...ptOf(k), kind: 'keep' })), ...[...take.keys()].map(k => ({ ...ptOf(k), kind: 'take' }))];
  const free = mine.filter(u => !escapeTake.has(u.id));
  for (const [id, sq] of escapeTake) if (sq.length) jobs.set(id, { pt: ptOf(sq.reduce((b, k) => { const p = ptOf(k), u = E.unitById(s, id); return !b || !u || E.manhattan(u, p) < E.manhattan(u, ptOf(b)) ? k : b; }, null)), kind: 'take', anchor: true });
  if (pts.length && free.length) {
    const taken = new Set();
    // anchors first: for every square, the strongest unit, discounted by how far it is
    for (const p of pts) {
      let best = null, bv = -Infinity;
      for (const u of free) { if (taken.has(u.id)) continue; const v = strength(s, u) - 0.12 * E.manhattan(u, p) * worth(s, u); if (v > bv) { bv = v; best = u; } }
      if (best) { taken.add(best.id); jobs.set(best.id, { pt: p, kind: p.kind, anchor: true }); }
    }
    // the rest are shared out: each square in turn takes the nearest unit left, so every square is covered
    const cap = Math.ceil(free.length / pts.length) + 1, count = new Map(pts.map((p, i) => [i, 1]));
    const rest = free.filter(u => !taken.has(u.id));
    for (let guard = 0; rest.length && guard < 200; guard++) {
      let pick = null;
      for (let i = 0; i < pts.length; i++) {
        if (count.get(i) >= cap) continue;
        for (const u of rest) { const d = E.manhattan(u, pts[i]) - (count.get(i) ? 0 : 3); if (!pick || d < pick.d) pick = { u, i, d }; }
      }
      if (!pick) break;
      // far-off units fight where they are rather than marching across the map (unless the side must defend)
      if (pick.d > 14 && posture !== 'defensive' && posture !== 'stall') { rest.splice(rest.indexOf(pick.u), 1); continue; }
      jobs.set(pick.u.id, { pt: pts[pick.i], kind: pts[pick.i].kind, anchor: false });
      count.set(pick.i, count.get(pick.i) + 1); rest.splice(rest.indexOf(pick.u), 1);
    }
  }
  return { posture, ...POSTURE[posture], aggr, keep: [...keep.keys()].map(ptOf), take: [...take.keys()].map(ptOf), jobs, protect, hunt, reinforceRound, why };
}

/** How good this square is to stand on for this unit (defense, command, height, cover; fire and fords hurt). */
export function groundValue(s, u, x, y) {
  const r = E.tileRules(s, x, y); if (!r) return 0;
  const t = E.typeOf(s, u), ranged = t.weapon === 'ranged';
  let v = ranged
    ? 0.6 * r.rangedDef + 0.25 * r.meleeDef + 0.7 * r.range + 0.5 * r.atk + (r.high ? 0.4 : 0) + (r.hides ? 0.4 : 0)
    : 0.6 * r.meleeDef + 0.3 * r.rangedDef + (r.high ? 0.3 : 0) + 0.3 * r.downhill + (r.noSurround ? 0.3 : 0);
  v += 0.5 * (r.campDef || 0) + 0.4 * (r.command || 0) + 0.03 * (r.moraleTurn || 0) + 0.04 * (r.healthTurn || 0);
  return v;
}

function nearest(u, pts) { let d = Infinity; for (const p of pts) { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; d = Math.min(d, Math.abs(u.x - x) + Math.abs(u.y - y)); } return d; }

/** Where the unit stands at the end of its turn: its job, closing on enemies, good ground, and (level 5) next round's strikes. */
function positionScore(s0, s1, u0, u1, side, P, S) {
  if (!u1 || u1.status !== 'active') return 0;
  const w = worth(s0, u0), t = E.typeOf(s0, u0), ranged = t.weapon === 'ranged';
  const foes = E.liveUnits(s0).filter(e => E.hostile(e, u0));
  const job = S.jobs.get(u0.id);
  let v = 0;
  if (foes.length) {
    const d0 = Math.min(...foes.map(e => E.manhattan(e, u0))), d1 = Math.min(...foes.map(e => E.manhattan(e, u1)));
    const want = ranged ? Math.max(1, t.rangeMax || 1) : 1;
    // a unit guarding a square only goes out to meet enemies that come near it
    const near = job && job.kind === 'keep' ? foes.some(e => E.manhattan(e, job.pt) <= 6) : true;
    let close = S.close;
    if (S.hunt.size && foes.some(e => S.hunt.has(e.id))) close = Math.max(close, 1);
    if (job && job.kind === 'keep') close = near ? Math.max(0.6, close) : 0;
    v += 0.012 * w * close * (Math.abs(d0 - want) - Math.abs(d1 - want)); // close in (melee) or reach shooting range (ranged)
    // hunted units: get at them
    const hunted = foes.filter(e => S.hunt.has(e.id));
    if (hunted.length) v += 0.03 * w * (nearest(u0, hunted) - nearest(u1, hunted));
    if (P.lookahead) {
      const reach = E.movementOf(s1, u1) + (ranged ? t.rangeMax || 1 : 1);
      const weak = foes.filter(e => E.manhattan(e, u1) <= reach).map(e => worth(s1, e) * (1 - e.men / mx(e) + 0.2) * (S.hunt.has(e.id) ? 1.6 : 1));
      if (weak.length) v += 0.05 * w * Math.max(...weak);
    }
  }
  if (job) {
    const d0 = E.manhattan(u0, job.pt), d1 = E.manhattan(u1, job.pt);
    if (job.kind === 'take') {
      v += (job.anchor ? 0.12 : 0.08) * w * (d0 - d1);
      if (d1 === 0) v += 0.3 * w; // ending a turn there seizes it
    } else if (job.anchor) {
      v += 0.1 * w * (d0 - d1) + (d1 === 0 ? 0.45 * w : 0); // sit on the square
    } else {
      const ring = ranged ? 3 : 2; // guards stand around it (ranged a little further back)
      v += 0.06 * w * (Math.max(0, d0 - ring) - Math.max(0, d1 - ring)) - (d1 > ring + 2 ? 0.03 * w * (d1 - ring - 2) : 0);
    }
  }
  // good ground (lower levels see less of it)
  const gw = [0.3, 0.6, 0.85, 1, 1, 1][P.level] * S.ground;
  if (gw) v += 0.035 * w * gw * (groundValue(s0, u0, u1.x, u1.y) - groundValue(s0, u0, u0.x, u0.y));
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
function replyScore(s, uid, side, areas, S) {
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
      tot += outcomeScore(s, f, side, S);
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
  const S = opts.strategy || strategy(base, side), job = S.jobs.get(unitId);
  const out = [];
  const consider = (actions, f) => {
    const u1 = E.unitById(f, unitId);
    const o1 = outcomeScore(base, f, side, S), p1 = positionScore(base, f, u0, u1, side, P, S), t1 = threatOf(f, u1, side, P, areas, S) + pressureOf(f, u1, P);
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
    const objs = job ? [job.pt] : [...S.take, ...S.keep];
    const heur = ([x, y]) => (S.close > 0 ? 1 : 0.3) * Math.min(99, ...foes.map(e => Math.abs(e.x - x) + Math.abs(e.y - y))) + (job ? 1.5 : 0.5) * Math.min(99, nearest({ x, y }, objs))
      - 1.5 * groundValue(base, u0, x, y);
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
      const scores = runs.map(g => { const u1 = E.unitById(g, unitId); return outcomeScore(base, g, side, S) + positionScore(base, g, u0, u1, side, P, S) + threatOf(g, u1, side, P, areas, S) + pressureOf(g, u1, P); });
      out.push({ actions: [...pre, act], score: scores.reduce((t, x) => t + x, 0) / scores.length, state: runs[0] });
    }
    // hold position (defensive stance)
    if (!u.round.attacked && !acf.forcedMarched) {
      const g = fork(f); const r = E.act(g, HOST, { type: 'holdPosition', unitId });
      if (r.ok) {
        consider([...pre, { type: 'holdPosition', unitId }], g);
        // dug in on the square it keeps, or waiting for help: holding is worth a little more
        const gu = E.unitById(g, unitId);
        if ((job && job.kind === 'keep' && E.manhattan(gu, job.pt) <= 1) || S.posture === 'stall') out[out.length - 1].score += 0.04 * worth(base, u0);
      }
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
  if (P.replies) for (const c of out.slice(0, P.replies)) c.score += 0.6 * replyScore(c.state, unitId, side, areas, S);
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
    const S = strategy(s, side);
    let best = null, bestV = threatOf(s, u, side, P, areas, S);
    for (const [x, y] of ac.reposition.tiles) {
      const f = fork(s); const fu = E.unitById(f, unitId); fu.x = x; fu.y = y;
      const v = threatOf(f, fu, side, P, areas, S); if (v > bestV) { bestV = v; best = { x, y }; }
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
