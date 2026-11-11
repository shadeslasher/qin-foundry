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
//
// Fighting (David, 2026-11-04), see mind() and positionScore():
//   - finishing blows: removing an enemy unit counts extra; skilled tacticians finish units cheaply (they play the
//     fight out and weigh the reply), poor ones now and then go for the kill whatever it costs (a "greedy" mistake)
//   - surrounding: closing the sides of an enemy unit is worth more the nearer it is to a full ring; being closed in
//     is dangerous. Aggressive postures care about the ring, defensive ones about their own safety
//   - morale: shaken or battered units step out of reach to recover (officer regen, morale squares, rallying
//     banners) unless they anchor a square or are steadfast
//   - formations (levels 2+): ranged units stay behind their melee, melee units screen them and keep together
//   - officers fight by type: Commanders and Strategists (and the tactician's own unit) are kept safer, Vanguards,
//     Champions and Sentinels take risks; and by Battle style (sheet field): Rash, Glory-seeking, Cautious,
//     Steadfast, Cunning, Protective. Rash and glory-seeking officers sometimes ignore the plan (said in the log)
//   - mistakes: tacticians of Art of War 0-2 often chase, blunder into reach, dawdle or ignore the ground
//
// Sieges (David, 2026-11-04; ai-siege.mjs): on maps with city walls, distances to enemies and to the squares a unit is
// sent to follow the real way in (gates, ladders), and each side has a role. Attackers batter gates (siege engines
// and catapults first), put up ladders, pick up dropped equipment and climb; defenders man the walls, shut their
// gates when the enemy is near, stay inside, and go for enemy units carrying ladders or engines.
//
// Traits (David, 2026-11-04): attacks are always played out with the real rules (levels 2+). The danger to a
// unit from each enemy is played out with the real rules too at levels 3+ (all traits on both sides: armor,
// Anti-Cavalry, Brace, charges, Terror, Fire Arrows, officer passives...); level 2 uses a quicker estimate that
// knows the main defensive and charge traits; levels 0-1 stay with the raw numbers. Positioning traits
// (traitPosition): staying still for Shield Battery / Range Up, staying hidden (Ambusher, Stalk), home ground
// (Jungle Warriors, Mountain Passes, Woodsmen), standing in allies' auras (War Drums, Imperial Solidarity,
// Imperial Mandate, Inspiration, Hold the Line, Rallying Banner), setting up Swarm / Opportunists attacks,
// Suppressing Fire on holding spears before a charge, and Cornered Tiger fighting on below half health.
//
// Fire (David, 2026-11-04): plans already pay for walking through flames and ending a turn in them. A unit also
// puts a fire out (Extinguish, instead of attacking) when it threatens a square that matters to the side: a square
// it keeps (worst of all when that square itself burns), any unit's job square, a building that helps its side
// (morale squares, defensive buildings), or allies standing next to the flames (see fireDanger).
// Starting fires (fireValue): the Set Fire action (Set Aflame tactic) and Fire Arrows hits that light a square are
// worth what the fire does to the enemy (units on it lose troops and morale if they stay, lose cover, and the
// fire spreads to neighbours) and to the side's own goals (a square it must burn), minus what it threatens of its own.
// Officer skills aren't automated in the engine (the GM applies them), so the AI doesn't use them yet.
import * as E from './engine.mjs';
import * as SK from './skills.mjs';
import { tacticsStep } from './ai-tactics.mjs';
import { hasWalls, moverKind, routeField, routeAt, siegeRoles } from './ai-siege.mjs';

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
  for (const k of Object.keys(s)) {
    if (k === '_inside') { o[k] = s[k]; continue; } // the engine's cache of the squares inside the city: depends only on the map
    o[k] = (k === 'map' || k === 'library' || k === 'objectives') ? s[k] : (s[k] && typeof s[k] === 'object' ? JSON.parse(JSON.stringify(s[k])) : s[k]);
  }
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
function outcomeScore(a, b, side, S, M) {
  const al = E.alliance(side); let v = 0;
  const gain = S ? S.gain : 1.35;
  for (const u0 of a.units) {
    const u1 = E.unitById(b, u0.id); if (!u1 || u0.status !== 'active') continue;
    // enemy losses count a little more than its own: a side that only trades evenly never attacks
    const mine = E.alliance(u0.side) === al;
    let w = worth(a, u0);
    if (S && mine && S.protect.has(u0.id)) w *= 1.8; // the opponent needs this one routed: keep it safe
    if (S && !mine && S.hunt.has(u0.id)) w *= 1.8;   // the opponent needs this one alive (or out): go for it
    if (S && !mine && S.siege && S.siege.defender && u0.carry) w *= 1.4; // ladders and engines at the walls: stop them
    const sign = mine ? -1 : gain;
    const dm = Math.max(0, u0.men - u1.men) / mx(u0);
    const dmo = Math.max(-20, Math.min(60, u0.morale - u1.morale)) / 100;
    // a unit put out of the fight stops hurting the side: finishing one counts extra (more for the bold and the glory-seeking)
    const lost = u1.status !== 'active' ? 0.7 + (mine ? 0 : (M ? M.kill : 0.2)) : 0;
    if (!mine && M && M.glory > 1 && (u0.officerId || (Number(E.typeOf(a, u0)?.tier) || 0) >= 3)) w *= M.glory; // famous foes
    v += sign * w * (dm + 0.45 * dmo + lost);
  }
  return v;
}

/** Raw-numbers guess at the casualties of a melee or ranged hit (no traits beyond the charge, no holds). */
function naiveHit(s, att, def, tiles) {
  const ta = E.typeOf(s, att), td = E.typeOf(s, def);
  const charge = ta.category === 'cavalry' && ta.weapon !== 'ranged' && tiles >= 2 ? [0, 4, 6, 8, 8][att.fierceCharge || 0] : 0; // charges add only the Fierce Charge bonus (0.123.0)
  return E.casualtiesOf((ta.damage || 0) + 2 + charge, td.armor || 0, ta.armorPen || 0, 0, 0);
}

/** Level 2's quicker guess: the raw numbers plus the main defensive and charge traits. */
function traitHit(s, att, def, tiles, holding) {
  const ta = E.typeOf(s, att), td = E.typeOf(s, def);
  const cav = ta.category === 'cavalry' && ta.weapon !== 'ranged';
  const charge = cav && tiles >= 2 ? [0, 4, 6, 8, 8][att.fierceCharge || 0] : 0;
  let armor = (td.armor || 0) + [0, 1, 2, 3][Math.min(3, E.unitTrait(def, 'reinforced armor'))];
  if (td.shield && E.unitTrait(att, 'shield breaker')) armor -= [0, 1, 2, 3, 4][Math.min(4, E.unitTrait(att, 'shield breaker'))];
  if (cav && E.unitTrait(def, 'anti-cavalry')) armor += 2 * Math.min(3, E.unitTrait(def, 'anti-cavalry'));
  if (holding && ta.weapon !== 'ranged') armor += 1 + (E.unitTrait(def, 'brace') ? Math.min(3, E.unitTrait(def, 'brace')) : 0);
  let dmg = (ta.damage || 0) + 2 + charge + (E.unitTrait(att, 'sharpened weapons') ? 1 : 0);
  if (E.unitTrait(def, 'colossal')) return 1;
  return E.casualtiesOf(dmg, Math.max(0, armor), ta.armorPen || 0, 0, 0);
}

/**
 * Levels 3+: what this enemy really does to the unit, played out with the full rules (both sides' traits,
 * officers, holds), net of what it loses itself; as a share of the unit's health. Cached per plan.
 */
function simThreat(base, uid, e, holding, samples) {
  const u = E.unitById(base, uid); if (!u) return null;
  const te = E.typeOf(base, e), ranged = te.weapon === 'ranged', cav = te.category === 'cavalry' && !ranged;
  // where it strikes from: in range for archers, next to the unit otherwise
  let spot = null;
  const want = ranged ? Math.max(te.rangeMin || 1, Math.min(te.rangeMax || 1, E.manhattan(e, u))) : 1;
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const x = u.x + dx * want, y = u.y + dy * want, o = E.unitAt(base, x, y);
    if (!o || o.id === e.id) { spot = { x, y }; break; }
  }
  if (!spot) return null;
  const tiles = cav ? Math.min(E.movementOf(base, e), 4) : 0;
  let tot = 0, n = 0;
  for (let i = 0; i < samples; i++) {
    const f = fork(base); E.setRng(seeded(hashStr('sim' + uid + e.id + i + (holding ? 'h' : ''))));
    const fe = E.unitById(f, e.id), fu = E.unitById(f, uid);
    fe.x = spot.x; fe.y = spot.y;
    fu.round = { ...fu.round, holding: !!holding };
    try { E.resolveAttack(f, fe, fu, { movedThisActivation: tiles > 0, tilesMoved: tiles }); } catch { continue; }
    const d = Math.max(0, u.men - fu.men) / mx(u) + 0.3 * Math.max(0, (u.morale ?? 50) - (fu.morale ?? 50)) / 100 + (fu.status !== 'active' ? 0.4 : 0);
    const back = Math.max(0, e.men - fe.men) / mx(e) + (fe.status !== 'active' ? 0.4 : 0);
    tot += d - 0.5 * back * worth(base, e) / worth(base, u); n++;
  }
  E.setRng(Math.random);
  return n ? { harm: tot / n, tiles } : null;
}

/** Enemy units that could strike this unit before it acts again, with a guess at the harm, as a score (negative). */
function threatOf(s, u, side, P, areas, S, M) {
  if (!u || u.status !== 'active') return 0;
  const k = u.x + ',' + u.y, w = worth(s, u), hits = [];
  const holding = !!(u.round && u.round.holding);
  for (const e of E.liveUnits(s)) {
    if (!E.hostile(e, u)) continue;
    const ar = areas.get(e.id); if (!ar || !(ar.attack.has(k) || ar.move.has(k) || E.manhattan(e, u) <= 1)) continue;
    const te = E.typeOf(s, e);
    const cav = te.category === 'cavalry' && te.weapon !== 'ranged';
    const dist = cav ? Math.min(E.movementOf(s, e), E.manhattan(e, u)) : 0;
    let harm;
    const sim = P.level >= 3 && M && M.sim ? M.sim(e, holding) : null;
    if (sim) {
      // the real fight, scaled for a charge from closer or further than the playout's
      const scale = cav && sim.tiles ? naiveHit(s, e, u, dist) / Math.max(1, naiveHit(s, e, u, sim.tiles)) : 1;
      harm = sim.harm * (sim.harm > 0 ? scale : 1);
    } else if (P.level === 2) {
      harm = traitHit(s, e, u, dist, holding) / mx(u);
      if (cav && holding && E.unitTrait(u, 'charge reflection')) harm = -0.5 * harm * worth(s, e) / w;
    } else {
      harm = naiveHit(s, e, u, dist) / mx(u);
      // what a skilled side knows: spears that hold make charging cavalry pay
      if (!P.naive && cav && holding && (E.unitTrait(u, 'charge reflection') || E.unitTrait(u, 'brace'))) harm = -0.5 * harm * worth(s, e) / w;
      else if (!P.naive && cav && E.unitTrait(u, 'anti-cavalry')) harm *= 0.6;
    }
    hits.push(harm);
  }
  hits.sort((x, y) => y - x);
  const top = hits.slice(0, 3).reduce((t, h, i) => t + h * [1, 0.6, 0.35][i], 0);
  const prot = (S && S.protect.has(u.id) ? 1.6 : 1) * (M ? M.threat : 1) * (M && M.shaken ? 1.5 : 1);
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
  if (off) v *= (1.25 + 0.08 * (Number(off.command) || 0)) * (/champion/i.test(off.ctype || '') ? 1.3 : 1); // Champions hold chokepoints
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
  const burn = []; // squares the side wants burnt (allies of the players with a Burn objective)
  let aggr = 0;
  const left = (c) => Math.max(0, (Number(c.rounds) || 0) - done);
  const pairedHold = new Set((o.victory || []).filter(c => c.type === 'hold').map(c => c.id));
  const enemySide = al !== 'player'; // the AI is playing against the players' objectives
  // Objectives already settled are dropped (David, 2026-11-11): a seized or burnt square, a Hold done or lost,
  // units that got away; their units go where the battle is still open
  const burnt = s.siege?.burnt || {}, escaped = new Set(st.escaped || []);
  const settled = (c, k) => (c.type === 'seize' && k && st.playerEnded?.[k]) || (c.type === 'burn' && k && burnt[k])
    || (c.type === 'hold' && ((k && st.enemyEnded?.[k]) || done >= (Number(c.rounds) || 0)))
    || (c.type === 'escape' && (c.unitIds || []).every(id => escaped.has(id)));
  // how much each square matters (David, 2026-11-11): squares that decide the battle, and a Hold close to done,
  // get more of the army; extraction squares share their weight
  const urg = new Map();
  const weigh = (k, w) => { if (k) urg.set(k, Math.max(urg.get(k) || 0, w)); };
  const holdUrg = (c) => { const n = Number(c.rounds) || 0; return n ? 1 + 1.5 * (1 - left(c) / n) : 1; };
  for (const c of o.victory || []) {
    const k = c.x !== undefined && c.x !== null ? tileKey(c) : null;
    if (settled(c, k)) continue;
    if (k) weigh(k, c.type === 'hold' ? holdUrg(c) : c.type === 'seize' ? 1.3 : 1.1);
    if (c.type === 'escape') for (const e of o.extraction || []) weigh(e, 0.6);
    if (enemySide) switch (c.type) {
      case 'seize': if (k) keep.set(k, 'seize'); aggr -= 0.35; why.push('keep ' + k + ' (opponent must seize it)'); break;
      case 'burn': if (k) keep.set(k, 'burn'); aggr -= 0.25; why.push('guard ' + k + ' (opponent must burn it)'); break;
      case 'hold': if (k) take.set(k, 'hold'); aggr += 0.25; why.push('take ' + k + ' (opponent must hold it)'); break;
      case 'survive': { const f = c.rounds ? 1 - left(c) / c.rounds : 0; aggr += 0.6 + 0.4 * f; why.push('attack: opponent only has to survive'); break; }
      case 'routUnit': for (const id of c.unitIds || []) protect.add(id); break;
      case 'escape': for (const id of c.unitIds || []) hunt.add(id); for (const e of o.extraction || []) keep.set(e, 'extraction'); aggr += 0.2; break;
    } else switch (c.type) {
      case 'seize': case 'burn': if (k) take.set(k, c.type); if (k && c.type === 'burn') burn.push(ptOf(k)); aggr += 0.2; break;
      case 'hold': if (k) keep.set(k, 'hold'); aggr -= 0.3; break;
      case 'survive': aggr -= 0.5; why.push('play for time: survive'); break;
      case 'routUnit': for (const id of c.unitIds || []) hunt.add(id); break;
      case 'escape': for (const id of c.unitIds || []) { protect.add(id); escapeTake.set(id, o.extraction || []); } break;
    }
  }
  for (const c of o.defeat || []) {
    const k = c.x !== undefined && c.x !== null ? tileKey(c) : null;
    if (c.type === 'tileSeized' && k && st.enemyEnded?.[k]) continue;
    if (c.type === 'tileSeized' && !pairedHold.has(c.pair)) weigh(k, 1.5); // losing it loses the battle
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
  const pts = [...[...keep.keys()].map(k => ({ ...ptOf(k), kind: 'keep', w: urg.get(k) || 1 })), ...[...take.keys()].map(k => ({ ...ptOf(k), kind: 'take', w: urg.get(k) || 1 }))]
    .sort((a, b) => b.w - a.w); // the most urgent square picks its anchor first
  const free = mine.filter(u => !escapeTake.has(u.id));
  for (const [id, sq] of escapeTake) if (sq.length) jobs.set(id, { pt: ptOf(sq.reduce((b, k) => { const p = ptOf(k), u = E.unitById(s, id); return !b || !u || E.manhattan(u, p) < E.manhattan(u, ptOf(b)) ? k : b; }, null)), kind: 'take', anchor: true });
  if (pts.length && free.length) {
    const taken = new Set();
    // anchors first: for every square, the strongest unit, discounted by how far it is
    for (const p of pts) {
      let best = null, bv = -Infinity;
      for (const u of free) { if (taken.has(u.id)) continue; const v = strength(s, u) - 0.12 * E.manhattan(u, p) * worth(s, u) / p.w; if (v > bv) { bv = v; best = u; } }
      if (best) { taken.add(best.id); jobs.set(best.id, { pt: p, kind: p.kind, anchor: true }); }
    }
    // the rest are shared out: each square in turn takes the nearest unit left, so every square is covered
    // each square's share of guards follows its urgency
    const wSum = pts.reduce((t, p) => t + p.w, 0);
    const caps = pts.map(p => Math.ceil(free.length * p.w / wSum) + 1), count = new Map(pts.map((p, i) => [i, 1]));
    const rest = free.filter(u => !taken.has(u.id));
    for (let guard = 0; rest.length && guard < 200; guard++) {
      let pick = null;
      for (let i = 0; i < pts.length; i++) {
        if (count.get(i) >= caps[i]) continue;
        for (const u of rest) { const d = (E.manhattan(u, pts[i]) - (count.get(i) ? 0 : 3)) / pts[i].w; /* urgent squares reach further for help */ if (!pick || d < pick.d) pick = { u, i, d }; }
      }
      if (!pick) break;
      // far-off units fight where they are rather than marching across the map (unless the side must defend)
      if (pick.d > 14 && posture !== 'defensive' && posture !== 'stall') { rest.splice(rest.indexOf(pick.u), 1); continue; }
      jobs.set(pick.u.id, { pt: pts[pick.i], kind: pts[pick.i].kind, anchor: false });
      count.set(pick.i, count.get(pick.i) + 1); rest.splice(rest.indexOf(pick.u), 1);
    }
  }
  if (pts.length > 1) reinforceThreatened(s, side, pts, jobs, why);
  const siegeS = { take: [...take.keys()].map(ptOf), keep: [...keep.keys()].map(ptOf) };
  const siege = siegeRoles(s, side, siegeS);
  const reinforceSquares = coming.filter(r => Number.isFinite(r.x) && Number.isFinite(r.y)).map(r => ({ x: r.x, y: r.y }));
  const team = teamPlan(s, side, jobs, protect);
  if (team.why) why.push(...team.why);
  return { posture, ...POSTURE[posture], aggr, reinforceSquares, burn, siege, focus: team.focus, converge: team.converge, keep: [...keep.keys()].map(ptOf), take: [...take.keys()].map(ptOf), jobs, protect, hunt, reinforceRound, why };
}

/**
 * Guards leave quiet squares to help one under attack (David, 2026-11-11). A square's danger is the enemy strength
 * that can reach it next turn, its defense the strength of its guards there; a square no enemy can reach is quiet.
 * Each guard (never an anchor) of a quiet square may be sent to the most threatened one: the side's Art of War sets
 * how likely and how far it looks, and the officer's battle style shifts it (Protective goes to help, Steadfast
 * keeps his post, Cautious rarely leaves, Cunning reads it better, Rash and Glory-seeking run to the fighting).
 * Rolled once per unit per round, so the decision holds while the side plays its turn.
 */
function reinforceThreatened(s, side, pts, jobs, why) {
  const lvl = sideLevel(s, side);
  const base = [0, 0.15, 0.35, 0.6, 0.85, 1][lvl];
  if (!base) return;
  const al = E.alliance(side), live = E.liveUnits(s);
  const foes = live.filter(u => E.alliance(u.side) !== al && !u.hidden);
  const power = (u) => worth(s, u) * u.men / mx(u);
  const key = (p) => p.x + ',' + p.y;
  const danger = new Map(), guard = new Map();
  for (const p of pts) {
    danger.set(key(p), foes.reduce((t, e) => t + (E.manhattan(e, p) <= E.movementOf(s, e) + Math.max(1, E.typeOf(s, e).rangeMax || 1) + 1 ? power(e) : 0), 0));
    guard.set(key(p), 0);
  }
  for (const [id, j] of jobs) { const u = E.unitById(s, id); if (u && guard.has(key(j.pt))) guard.set(key(j.pt), guard.get(key(j.pt)) + power(u)); }
  const need = (p) => danger.get(key(p)) * p.w - guard.get(key(p));
  const reach = [0, 10, 14, 18, 24, 30][lvl]; // how far a guard may be sent from
  for (const [id, j] of [...jobs]) {
    if (j.anchor || danger.get(key(j.pt)) > 0) continue; // anchors keep their square; only quiet squares give guards
    const u = E.unitById(s, id); if (!u) continue;
    const hot = pts.filter(p => p !== j.pt && danger.get(key(p)) > 0 && need(p) > 0 && E.manhattan(u, p) <= reach)
      .sort((a, b) => need(b) - need(a))[0];
    if (!hot) continue;
    const off = u.officerId ? E.officerOf(s, u) : null, st = stylesOf(off?.style);
    let chance = base;
    if (st.has('protective')) chance += 0.25;
    if (st.has('cunning')) chance += 0.1;
    if (st.has('rash') || st.has('glory-seeking')) chance += 0.15;
    if (st.has('cautious')) chance -= 0.2;
    if (st.has('steadfast')) chance *= 0.3;
    const r = seeded(hashStr(id + ':help:' + (s.turn?.round ?? 0)))();
    if (r >= Math.max(0, Math.min(1, chance))) continue;
    jobs.set(id, { pt: { x: hot.x, y: hot.y, kind: hot.kind, w: hot.w }, kind: hot.kind, anchor: false, helping: key(j.pt) });
    guard.set(key(hot), guard.get(key(hot)) + power(u)); guard.set(key(j.pt), guard.get(key(j.pt)) - power(u));
    why.push((off?.name || u.name || id) + ' leaves ' + key(j.pt) + ' to help at ' + key(hot));
  }
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

// ---------------------------------------------------------------- the unit's mind (David, 2026-11-04)

const TYPE_MIND = { // by the officer's character type
  commander: { threat: 1.35, close: 0.8 },
  strategist: { threat: 1.6, close: 0.6 },
  vanguard: { threat: 0.75, close: 1.35, kill: 1.2 },
  champion: { threat: 0.85, anchor: 1.3 },
  sentinel: { threat: 0.85, kill: 1.3 },
};
export const BATTLE_STYLES = ['rash', 'glory-seeking', 'cautious', 'steadfast', 'cunning', 'protective'];
/** Battle style words on an officer's sheet ("Rash, Cunning"), as a Set of the known ones. */
export function stylesOf(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[,;/]+/).map(x => x.trim().replace(/\s+/g, '-'))) {
    if (w === 'glory' || w === 'glory-seeker' || w === 'gloryseeking') out.add('glory-seeking');
    else if (w === 'reckless') out.add('rash');
    else if (BATTLE_STYLES.includes(w)) out.add(w);
  }
  return out;
}

/** Is this unit led by its side's tactician? */
function isTacticianUnit(s, u) {
  const tac = s.tactics?.sides?.[u.side], off = u.officerId ? E.officerOf(s, u) : null;
  return !!(tac && off && (tac.id === off.id || tac.name === off.name));
}

/**
 * How this unit fights this activation: weights from its officer's type and battle style, how shaken it is, and
 * (rolled once per unit per round, so the plan holds together) a mistake or a bout of disobedience.
 *   { threat, close, kill, glory, flank, ground, anchorish, shaken, recover, ignoreJob, mistake, disobey, note }
 */
export function mind(s, u, S, P) {
  const off = u.officerId ? E.officerOf(s, u) : null;
  const ty = TYPE_MIND[String(off?.ctype || '').trim().toLowerCase()] || {};
  const st = stylesOf(off?.style);
  const M = { threat: ty.threat || 1, close: ty.close || 1, kill: (P.level >= 3 ? 0.4 : 0.2) * (ty.kill || 1), glory: 1, flank: 1, ground: 1,
    anchorish: ty.anchor || 1, shaken: false, recover: 0, ignoreJob: false, mistake: null, disobey: false, note: null, styles: st };
  if (isTacticianUnit(s, u)) M.threat *= 1.5;
  if (st.has('rash')) { M.threat *= 0.5; M.close *= 1.6; M.kill *= 1.3; }
  if (st.has('glory-seeking')) { M.glory = 1.6; M.kill *= 1.5; }
  if (st.has('cautious')) { M.threat *= 1.4; M.close *= 0.6; }
  if (st.has('cunning')) { M.flank = 1.6; M.ground = 1.4; }
  const tiger = E.unitTrait(u, 'cornered tiger') && u.men < mx(u) / 2; // fights harder below half health
  // shaken or battered: wants to step back and recover (skilled sides see it sooner)
  const mo = Number(u.morale ?? 50), hp = u.men / mx(u);
  const line = P.level >= 2 ? (mo < 40 || hp < 0.35) : mo < 20;
  if (line && !st.has('steadfast') && !tiger) { M.shaken = true; M.recover = P.level >= 2 ? 1 : 0.5; }
  if (tiger && P.level >= 2) { M.threat *= 0.7; M.close *= 1.2; }
  // dice for this round: mistakes (poor tacticians), disobedience (rash and glory-seeking officers)
  const r = seeded(hashStr(u.id + ':mind:' + (s.turn?.round ?? 0)));
  const r1 = r(), r2 = r(), r3 = r();
  const foes = E.liveUnits(s).filter(e => E.hostile(e, u));
  const reach = E.movementOf(s, u) + Math.max(1, E.typeOf(s, u).rangeMax || 1);
  const weakNear = foes.some(e => e.men / mx(e) < 0.4 && E.manhattan(u, e) <= reach);
  if (weakNear && r1 < [0.16, 0.11, 0.06, 0.02, 0, 0][P.level]) M.mistake = 'greedy';
  else if (r1 < [0.46, 0.33, 0.18, 0.07, 0, 0][P.level]) M.mistake = ['chase', 'blind', 'dawdle', 'ground'][Math.floor(r2 * 4)];
  if (M.mistake === 'greedy') { M.threat *= 0.15; M.kill = 2.5; }
  if (M.mistake === 'chase') { M.close = Math.max(M.close, 1.8); M.ignoreJob = true; }
  if (M.mistake === 'blind') M.threat *= 0.3;
  if (M.mistake === 'dawdle') M.close = 0;
  if (M.mistake === 'ground') M.ground = 0;
  const wild = (st.has('rash') ? 0.3 : 0) + (st.has('glory-seeking') ? 0.25 : 0);
  const job = S.jobs.get(u.id);
  const held = !!job || S.posture === 'defensive' || S.posture === 'stall'; // orders that hold him back
  if (wild && held && foes.length && r3 < wild * (1 - 0.08 * P.level)) {
    M.disobey = true; M.ignoreJob = true; M.threat *= 0.4; M.close = Math.max(M.close, 2); M.recover = 0; M.shaken = false;
    const name = off?.name || u.name;
    M.note = st.has('glory-seeking') && !st.has('rash') ? name + ' seeks glory and leaves his post to take on the enemy!' : name + ' ignores his orders and charges!';
  }
  if (st.has('steadfast')) M.ignoreJob = false;
  return M;
}

const ORTHO4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const RING = [0, 0.02, 0.06, 0.15, 0.35]; // value of an enemy closed in on 0-4 sides
function closedSides(s, e, al) {
  let n = 0;
  const cols = s.map?.cols, rows = s.map?.rows;
  for (const [dx, dy] of ORTHO4) {
    const x = e.x + dx, y = e.y + dy;
    if (cols && rows && (x < 0 || y < 0 || x >= cols || y >= rows)) { n++; continue; }
    const r = E.tileRules(s, x, y); if (r && r.pass === 'none' && !r.wall) { n++; continue; }
    const o = E.unitAt(s, x, y); if (o && o.status === 'active' && E.alliance(o.side) === al) n++;
  }
  return n;
}
const cantBeRinged = (s, e) => E.unitTrait(e, 'stalwart') || E.unitTrait(e, "pretender's guard") || !!E.tileRules(s, e.x, e.y)?.noSurround;

// ---------------------------------------------------------------- fire (David, 2026-11-04)

/** How much a burning square threatens what matters to this side, as a score (0 = leave it). */
export function fireDanger(s, side, S, fx, fy, w, selfId = null) {
  const al = E.alliance(side), cheb = (p) => Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy));
  const reach = [1, 0.55, 0.25];
  const flammable = (p) => { const r = E.tileRules(s, p.x, p.y); return !!(r && r.flammable) || (p.x === fx && p.y === fy); };
  let v = 0;
  const weigh = (p, wt, maxD = 2) => { const d = cheb(p); if (d <= maxD && flammable(p)) v += wt * reach[d]; };
  for (const p of S.keep) weigh(p, cheb(p) === 0 ? 1.4 : 0.9);
  for (const [, j] of S.jobs) weigh(j.pt, 0.5);
  for (const o of E.liveUnits(s)) if (o.id !== selfId && E.alliance(o.side) === al && cheb(o) <= 1) v += 0.25 * reach[cheb(o)];
  // buildings that help the side: morale squares (command tent, supply depot) and defensive ones (forts, towers)
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    const p = { x: fx + dx, y: fy + dy }, r = E.tileRules(s, p.x, p.y);
    if (r && r.flammable && (r.moraleTurn > 0 || r.meleeDef > 0 || r.command > 0)) weigh(p, 0.3);
  }
  return v * w;
}
/** What setting this square alight would be worth to this side (can be negative: leave it). */
export function fireValue(s, side, S, x, y, w, selfId = null) {
  const al = E.alliance(side), sg = s.siege || {};
  if (sg.fires && sg.fires[x + ',' + y]) return 0;
  const r = E.tileRules(s, x, y); if (!r || !r.flammable) return 0;
  const cheb = (p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
  let v = 0;
  for (const o of E.liveUnits(s)) {
    const d = cheb(o); if (d > 1 || o.id === selfId) continue; // the unit setting it walks away from it
    const ow = worth(s, o) * (d === 0 ? 0.35 : 0.12);
    v += E.alliance(o.side) === al ? -ow * 1.2 : ow; // its own count a little more: no one likes burning his own men
  }
  for (const p of S.burn || []) { const d = cheb(p); if (d <= 1) v += w * (d === 0 ? 1.5 : 0.4); } // a square it must burn
  // what it might spread to of the side's own
  v -= 0.6 * fireDanger(s, side, S, x, y, w, selfId);
  return v;
}
/** Burning squares worth putting out for this side (with their danger), from the state the side knows. */
function dangerousFires(s, side, S, w) {
  const out = [];
  for (const k of Object.keys((s.siege && s.siege.fires) || {})) {
    const [x, y] = k.split(',').map(Number), d = fireDanger(s, side, S, x, y, w);
    if (d > 0.08 * w) out.push({ x, y, d });
  }
  return out;
}

// ---------------------------------------------------------------- positioning traits (David, 2026-11-04)

const tileOf = (s, x, y) => s.map && s.map.tiles && s.map.tiles[x + ',' + y];
const jungle = (s, x, y) => { const t = tileOf(s, x, y); return !!t && (t.terrain === 'forest' || t.terrain === 'marsh' || (t.overlays || []).includes('trees')); };
const mountain = (s, x, y) => { const t = tileOf(s, x, y); const o = (t && t.overlays) || []; return !!t && (t.terrain === 'forest' || t.terrain === 'rocky' || o.includes('hill') || o.includes('trees')); };
const forest = (s, x, y) => { const t = tileOf(s, x, y); return !!t && (t.terrain === 'forest' || (t.overlays || []).includes('trees')); };

/** Allied auras covering a square for this unit (War Drums, Imperial Solidarity, Imperial Mandate, Inspiration, Hold the Line, Rallying Banner). */
function aurasAt(s, u, x, y) {
  const p = { x, y }, t = E.typeOf(s, u); let n = 0;
  for (const o of E.liveUnits(s)) {
    if (o.id === u.id || E.alliance(o.side) !== E.alliance(u.side)) continue;
    const d = E.manhattan(o, p), wd = E.unitTrait(o, 'war drums');
    if (wd && d <= (wd >= 2 ? 3 : 2)) n += wd >= 3 ? 2 : 1;
    if (E.unitTrait(o, 'imperial solidarity') && d <= 2) n += 1;
    if (E.unitTrait(u, 'imperial mandate') && d <= 2 && /^(han|imperial)\b/i.test(String(E.typeOf(s, o)?.faction || ''))) n += 1;
    if (d === 1 && (E.unitTrait(o, 'inspiration') || E.unitTrait(o, 'rallying banner'))) n += 1;
    if (d === 1 && t.category === 'infantry' && E.unitTrait(o, 'hold the line') && o.round && o.round.holding) n += 1;
  }
  return n;
}
/** Allies a unit with an aura covers from a square. */
function coveredBy(s, u, x, y) {
  const p = { x, y }, wd = E.unitTrait(u, 'war drums');
  const r = wd ? (wd >= 2 ? 3 : 2) : E.unitTrait(u, 'imperial solidarity') ? 2 : (E.unitTrait(u, 'inspiration') || E.unitTrait(u, 'rallying banner')) ? 1 : 0;
  if (!r) return 0;
  return E.liveUnits(s).filter(o => o.id !== u.id && E.alliance(o.side) === E.alliance(u.side) && E.manhattan(o, p) <= r).length;
}

/** What the unit's own traits make of where it ends its turn (levels 2+). */
function traitPosition(s0, s1, u0, u1, P, S) {
  const lw = [0, 0, 0.6, 0.85, 1, 1.1][P.level]; if (!lw || !u1 || u1.status !== 'active') return 0;
  const w = worth(s0, u0), tr = (k) => E.unitTrait(u0, k);
  let v = 0;
  // Shield Battery / Range Up: their bonuses need a turn ended without moving
  const still = (tr('shield battery') ? 1 : 0) + (tr('range up') ? tr('range up') : 0);
  if (still) {
    // finished turn: the engine's own record; turn still under way: whether it has moved yet
    const going = s1.turn && s1.turn.activation && s1.turn.activation.unitId === u0.id;
    const stayed = going ? !(u1.round && u1.round.moved) : !!(u1.fx && u1.fx.stillLast);
    if (stayed) v += 0.05 * w * still;
  }
  // staying hidden (hidden units strike from hiding; Ambusher doubles that)
  const hideW = (tr('ambusher') ? 2 : 1) * (tr('stalk') ? 1.3 : 1) * (S.posture === 'defensive' || S.posture === 'stall' ? 1.3 : 1);
  v += 0.06 * w * hideW * ((u1.hidden ? 1 : 0) - (u0.hidden ? 1 : 0));
  // home ground
  if (tr('jungle warriors')) v += 0.04 * w * Math.min(3, tr('jungle warriors')) * ((jungle(s0, u1.x, u1.y) ? 1 : 0) - (jungle(s0, u0.x, u0.y) ? 1 : 0));
  if (tr('mountain passes')) v += 0.04 * w * ((mountain(s0, u1.x, u1.y) ? 1 : 0) - (mountain(s0, u0.x, u0.y) ? 1 : 0));
  if (tr('woodsmen')) v += 0.02 * w * ((forest(s0, u1.x, u1.y) ? 1 : 0) - (forest(s0, u0.x, u0.y) ? 1 : 0));
  // allies' auras over it, and its own aura over allies
  v += 0.02 * w * (aurasAt(s1, u0, u1.x, u1.y) - aurasAt(s0, u0, u0.x, u0.y));
  v += 0.012 * w * (coveredBy(s1, u0, u1.x, u1.y) - coveredBy(s0, u0, u0.x, u0.y));
  // Swarm / Opportunists: an ally next to their target makes their attack stronger
  const al = E.alliance(u0.side);
  for (const e of E.liveUnits(s1)) {
    if (E.alliance(e.side) === al || E.manhattan(e, u1) !== 1 || E.manhattan(e, u0) === 1) continue;
    const helpers = E.liveUnits(s1).filter(o => o.id !== u0.id && E.alliance(o.side) === al && !(o.round && o.round.activated)
      && (E.unitTrait(o, 'swarm') || E.unitTrait(o, 'opportunists')) && E.manhattan(o, e) <= E.movementOf(s1, o) + 1).length;
    v += 0.025 * worth(s0, e) * Math.min(2, helpers);
  }
  return lw * v;
}

/** Suppressing Fire on a unit whose stand (Hold, Brace, Anti-Cavalry, Charge Reflection) is in the way of a charge. */
function suppressValue(s, att, target) {
  if (!E.unitTrait(att, 'suppressing fire')) return 0;
  const stand = (target.round && target.round.holding) || E.unitTrait(target, 'brace') || E.unitTrait(target, 'anti-cavalry') || E.unitTrait(target, 'charge reflection');
  if (!stand) return 0;
  const cav = E.liveUnits(s).filter(o => E.alliance(o.side) === E.alliance(att.side) && !(o.round && o.round.activated)
    && E.typeOf(s, o).category === 'cavalry' && E.typeOf(s, o).weapon !== 'ranged' && E.manhattan(o, target) <= E.movementOf(s, o) + 2);
  return cav.length ? 0.12 * worth(s, target) * Math.min(2, cav.length) : 0.04 * worth(s, target);
}

/** Distance from p to the nearest of pts for this unit: along the real way in on siege maps, straight otherwise. */
function routeDist(s, u, p, pts) {
  if (!pts.length) return Infinity;
  if (!hasWalls(s)) return nearest(p, pts);
  const d = routeAt(s, routeField(s, moverKind(s, u), E.alliance(u.side), pts), p);
  return Number.isFinite(d) ? d : 40 + nearest(p, pts); // no way in at all: far, but still prefer nearer
}

// ---------------------------------------------------------------- working together (David, 2026-11-11)
//
// Combined moves (Art of War 3+): the side picks one enemy unit that several of its units can reach this turn and
// that none of them would break alone, and gives them roles in order: ranged units soften it, foot close its sides
// and pin it, cavalry come last for the finishing blow. Members are drawn to attack it and to close in on its sides;
// nothing is forced: each unit still weighs the team's bonus against the danger it would be in, waiting is weighed
// against what it could do now, and members who'd risk more than they add aren't asked (David, 2026-11-11).
// Level 3 pairs two units, 4 up to three, 5 up to four.
// Reading ahead (Art of War 4+): units that can't strike anything worth it this turn converge on a target they can
// reach together within two rounds (three at level 5): they gather just outside its army's reach, on its open side,
// so they strike together next round rather than arriving one at a time.

const ROLE_ORDER = { soften: 0, pin: 1, finish: 2 };
function roleOf(s, u) {
  const t = E.typeOf(s, u);
  if (t.weapon === 'ranged') return 'soften';
  return t.category === 'cavalry' || E.unitTrait(u, 'fierce charge') ? 'finish' : 'pin';
}
const reachOf = (s, u) => E.movementOf(s, u) + (E.typeOf(s, u).weapon === 'ranged' ? Math.max(1, E.typeOf(s, u).rangeMax || 1) : 1);

/** The side's combined attack this turn and its convergence for the next rounds: { focus, converge, why }. */
export function teamPlan(s, side, jobs = new Map(), protect = new Set()) {
  const lvl = sideLevel(s, side), out = { focus: null, converge: null, why: [] };
  if (lvl < 3) return out;
  const al = E.alliance(side), live = E.liveUnits(s);
  const mine = live.filter(u => E.alliance(u.side) === al && u.side === side);
  const foes = live.filter(e => E.alliance(e.side) !== al && E.hostile(e, mine[0] || e) && (E.visibleTo ? E.visibleTo(s, e, al) : !e.hidden));
  if (mine.length < 2 || !foes.length) return out;
  // units free to join: not tied to a square they anchor, not kept out of harm's way, not too shaken
  const free = mine.filter(u => !(jobs.get(u.id)?.anchor) && !protect.has(u.id) && Number(u.morale ?? 50) >= 25);
  const maxN = [0, 0, 0, 2, 3, 4][lvl];
  const hit = (u, e) => traitHit(s, u, e, Math.max(0, E.manhattan(u, e) - 1), !!(e.round && e.round.holding));
  // this turn: who can still act and reach each enemy
  const ready = free.filter(u => !(u.round && u.round.activated));
  let best = null;
  for (const e of foes) {
    // what each would risk by going in: the other enemies able to reach the target's side next (and the target's own reply)
    const risk = (u) => {
      const ranged = E.typeOf(s, u).weapon === 'ranged';
      let r = ranged ? 0 : hit(e, u) * 0.5;
      for (const o of foes) if (o.id !== e.id && E.manhattan(o, e) <= reachOf(s, o) + (ranged ? 0 : 1)) r += hit(o, u) * (ranged ? 0.3 : 0.6);
      return worth(s, u) * r / mx(u);
    };
    const can = ready.filter(u => E.manhattan(u, e) <= reachOf(s, u)).map(u => ({ u, dmg: hit(u, e), role: roleOf(s, u), risk: risk(u) }))
      .filter(m => m.risk < worth(s, e) * m.dmg / Math.max(1, e.men) * 1.5 + 0.05 * worth(s, m.u)); // not worth what it would cost him
    // partners who already struck it this round still count towards the kill
    const done = free.filter(u => u.round && u.round.activated && u.round.attacked && u.round.attackedId === e.id).length;
    if (can.length + done < 2) continue;
    can.sort((a, b) => b.dmg - a.dmg);
    if (can[0].dmg >= e.men && !done) continue; // one unit breaks it alone: no need to combine
    const team = can.slice(0, maxN - done);
    if (!team.length) continue;
    const dmg = team.reduce((t, m) => t + m.dmg, 0);
    const kills = dmg >= e.men;
    const melee = team.filter(m => m.role !== 'soften').length;
    const ringable = !cantBeRinged(s, e) ? Math.min(4, melee + closedSides(s, e, al)) : 0;
    let v = worth(s, e) * (kills ? 1.6 : Math.min(1, dmg / Math.max(1, e.men)) * 0.8) + worth(s, e) * RING[ringable] * 2;
    if (protect.has(e.id)) v *= 0.5;
    // weakened units are worth finishing together; fresh ones mostly for the ring around them
    v += worth(s, e) * 0.4 * (1 - e.men / mx(e));
    v -= 0.05 * team.reduce((t, m) => t + E.manhattan(m.u, e), 0); // nearer teams first
    v -= team.reduce((t, m) => t + m.risk, 0) * (lvl >= 5 ? 1 : 0.8); // what going in together would cost
    if (v <= 0) continue;
    if (!best || v > best.v) best = { v, e, team, kills };
  }
  if (best) {
    const members = best.team.map(m => ({ id: m.u.id, role: m.role, order: ROLE_ORDER[m.role] }))
      .sort((a, b) => a.order - b.order);
    out.focus = { targetId: best.e.id, members, kills: best.kills };
    out.why.push('combined attack on ' + (best.e.name || best.e.id) + ': ' + members.map(m => m.role).join(', '));
  }
  // reading ahead: units with nothing in reach converge on a target for the next rounds
  if (lvl >= 4) {
    const ahead = lvl >= 5 ? 3 : 2;
    const inFocus = new Set((out.focus?.members || []).map(m => m.id));
    const idle = ready.filter(u => !inFocus.has(u.id) && !foes.some(e => E.manhattan(u, e) <= reachOf(s, u)));
    let bc = null;
    for (const e of foes) {
      const team = idle.filter(u => E.manhattan(u, e) <= reachOf(s, u) + E.movementOf(s, u) * (ahead - 1))
        .map(u => ({ u, dmg: hit(u, e) })).sort((a, b) => b.dmg - a.dmg).slice(0, maxN);
      if (team.length < 2) continue;
      const dmg = team.reduce((t, m) => t + m.dmg, 0);
      const v = worth(s, e) * (dmg >= e.men ? 1.4 : Math.min(1, dmg / Math.max(1, e.men)) * 0.7) - 0.03 * team.reduce((t, m) => t + E.manhattan(m.u, e), 0);
      if (!bc || v > bc.v) bc = { v, e, team };
    }
    if (bc) {
      // the open side: away from the target's friends
      const friends = foes.filter(f => f.id !== bc.e.id && E.manhattan(f, bc.e) <= 6);
      const cx = friends.length ? friends.reduce((t, f) => t + f.x, 0) / friends.length : bc.e.x, cy = friends.length ? friends.reduce((t, f) => t + f.y, 0) / friends.length : bc.e.y;
      out.converge = { targetId: bc.e.id, members: new Set(bc.team.map(m => m.u.id)), away: { x: Math.sign(bc.e.x - cx), y: Math.sign(bc.e.y - cy) }, ahead };
      out.why.push('gathering ' + bc.team.length + ' units to strike ' + (bc.e.name || bc.e.id) + ' together within ' + ahead + ' rounds');
    }
  }
  return out;
}

/** What going after his partners is worth to a waiting member: the team bonus he'd gain on the softened target. */
function waitGain(s, S, unitId) {
  const f = S.focus, t = f && E.unitById(s, f.targetId); if (!t) return 0;
  const lw = [0, 0, 0, 0.8, 1, 1.15][sideLevel(s, E.unitById(s, unitId)?.side)];
  return lw * 0.18 * worth(s, t) * (f.kills ? 1.4 : 1);
}

/** A member of the combined attack: is anyone ahead of it in the order still to act? */
function waitingFor(s, S, unitId) {
  const f = S.focus; if (!f) return false;
  const me = f.members.find(m => m.id === unitId); if (!me) return false;
  return f.members.some(m => m.order < me.order && (() => { const o = E.unitById(s, m.id); return o && o.status === 'active' && !(o.round && o.round.activated); })());
}

/** Plan bonuses for the combined attack and the convergence (added in plans and positionScore). */
function teamScore(s0, s1, u0, u1, S, P, act) {
  if (!u1) return 0;
  const w = worth(s0, u0); let v = 0;
  const f = S.focus, me = f && f.members.find(m => m.id === u0.id);
  if (me) {
    const t0 = E.unitById(s0, f.targetId), t1 = E.unitById(s1, f.targetId);
    if (t0) {
      const lw = [0, 0, 0, 0.8, 1, 1.15][P.level];
      if (act && act.type === 'attack' && act.targetId === f.targetId) v += lw * 0.18 * worth(s0, t0);
      if (t1 && t1.status !== 'active') v += lw * 0.25 * worth(s0, t0); // the team's work done
      // foot that couldn't strike yet: stand on a side of the target (pinning it for the others)
      if (me.role === 'pin' && t1 && t1.status === 'active') v += lw * 0.06 * w * ((E.manhattan(u0, t0) > 1 ? 1 : 0) - (E.manhattan(u1, t1) > 1 ? 1 : 0)) + lw * 0.01 * w * (E.manhattan(u0, t0) - E.manhattan(u1, t1));
    }
  }
  const c = S.converge;
  if (c && c.members.has(u0.id) && !(act && act.type === 'attack')) {
    const t = E.unitById(s0, c.targetId);
    if (t) {
      const lw = P.level >= 5 ? 1.2 : 1;
      const r = reachOf(s0, u0);
      // the staging ring: just within striking reach next round
      const ring = (p) => Math.abs(E.manhattan(p, t) - (r + 1));
      v += lw * 0.05 * w * (ring(u0) - ring(u1));
      // on the target's open side
      const side = (p) => (Math.sign(p.x - t.x) === c.away.x && c.away.x ? 1 : 0) + (Math.sign(p.y - t.y) === c.away.y && c.away.y ? 1 : 0);
      v += lw * 0.02 * w * (side(u1) - side(u0));
    }
  }
  return v;
}

/** Where the unit stands at the end of its turn: its job, closing on enemies, good ground, and (level 5) next round's strikes. */
function positionScore(s0, s1, u0, u1, side, P, S, M) {
  if (!u1 || u1.status !== 'active') return 0;
  M = M || { close: 1, ground: 1, flank: 1, recover: 0, shaken: false, ignoreJob: false, styles: new Set() };
  const w = worth(s0, u0), t = E.typeOf(s0, u0), ranged = t.weapon === 'ranged';
  const foes = E.liveUnits(s0).filter(e => E.hostile(e, u0));
  const job = M.ignoreJob ? null : S.jobs.get(u0.id);
  const al = E.alliance(side), lvl = P.level;
  let v = 0;
  if (foes.length) {
    const walls = hasWalls(s0) && !ranged;
    const d0 = walls ? routeDist(s0, u0, u0, foes) : Math.min(...foes.map(e => E.manhattan(e, u0)));
    const d1 = walls ? routeDist(s0, u0, u1, foes) : Math.min(...foes.map(e => E.manhattan(e, u1)));
    const want = ranged ? Math.max(1, t.rangeMax || 1) : 1;
    // a unit guarding a square only goes out to meet enemies that come near it
    const near = job && job.kind === 'keep' ? foes.some(e => E.manhattan(e, job.pt) <= 6) : true;
    let close = S.close * M.close;
    if (S.hunt.size && foes.some(e => S.hunt.has(e.id))) close = Math.max(close, 1);
    if (job && job.kind === 'keep') close = near ? Math.max(0.6, close) : 0;
    if (M.shaken && M.recover) close = Math.min(close, 0);
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
    const d0 = routeDist(s0, u0, u0, [job.pt]), d1 = routeDist(s0, u0, u1, [job.pt]);
    if (job.kind === 'take') {
      v += (job.anchor ? 0.12 : 0.08) * w * (d0 - d1);
      if (d1 === 0) v += 0.3 * w; // ending a turn there seizes it
    } else if (job.anchor) {
      v += 0.1 * w * (d0 - d1) + (d1 === 0 ? 0.45 * w * (M.anchorish || 1) : 0); // sit on the square
    } else {
      const ring = ranged ? 3 : 2; // guards stand around it (ranged a little further back)
      v += 0.06 * w * (Math.max(0, d0 - ring) - Math.max(0, d1 - ring)) - (d1 > ring + 2 ? 0.03 * w * (d1 - ring - 2) : 0);
    }
  }
  // good ground (lower levels see less of it)
  const gw = [0.3, 0.6, 0.85, 1, 1, 1][lvl] * S.ground * M.ground * (M.shaken ? 1.3 : 1);
  if (gw) v += 0.035 * w * gw * (groundValue(s0, u0, u1.x, u1.y) - groundValue(s0, u0, u0.x, u0.y));
  // surrounding: close in the sides of nearby enemies; keep its own sides open (better tacticians see more of it)
  const lw = [0.2, 0.4, 0.7, 1, 1.2, 1.3][lvl];
  const ringW = lw * M.flank * ({ aggressive: 1.3, balanced: 1, defensive: 0.6, stall: 0.3 })[S.posture];
  const safeW = lw * ({ aggressive: 0.7, balanced: 1, defensive: 1.3, stall: 1.5 })[S.posture];
  for (const e of foes) {
    if (E.manhattan(e, u1) !== 1 && E.manhattan(e, u0) !== 1) continue;
    const e1 = E.unitById(s1, e.id); if (!e1 || e1.status !== 'active' || cantBeRinged(s1, e1)) continue;
    v += ringW * worth(s0, e) * (RING[closedSides(s1, e1, al)] - RING[closedSides(s0, e, al)]);
  }
  if (!cantBeRinged(s1, u1)) {
    let shut = 0;
    for (const [dx, dy] of ORTHO4) {
      const x = u1.x + dx, y = u1.y + dy, o = E.unitAt(s1, x, y);
      if (o && o.status === 'active' && E.alliance(o.side) !== al) shut += 1;
      else if (lvl >= 3 && !o && foes.some(e => E.manhattan(e, { x, y }) <= E.movementOf(s0, e) && E.manhattan(e, u1) > 1)) shut += 0.4; // enemies could step in
    }
    v -= safeW * w * RING[Math.min(4, Math.round(shut))];
  }
  // morale: a shaken unit out of every enemy's reach recovers (officer regen, morale squares, rallying banners)
  if (M.shaken && M.recover && !(job && job.kind === 'keep' && job.anchor)) {
    const k1 = u1.x + ',' + u1.y;
    const safe = !foes.some(e => { const ar = (M.areas && M.areas.get(e.id)) || E.threatArea(s0, e); return ar.attack.has(k1) || ar.move.has(k1); });
    if (safe) {
      const off = u0.officerId ? E.officerOf(s0, u0) : null, mo = Number(u0.morale ?? 50);
      let gain = off ? Math.max(0, Math.min(75, mo + (off.fire || 0) + (off.command || 0)) - mo) : 0;
      gain += Math.max(0, E.tileRules(s0, u1.x, u1.y)?.moraleTurn || 0);
      if (E.liveUnits(s1).some(o => o.id !== u0.id && E.alliance(o.side) === al && E.unitTrait(o, 'rallying banner') && E.manhattan(o, u1) === 1)) gain += 5;
      v += M.recover * w * (0.15 + 0.6 * gain / 100);
    }
  }
  // formations (levels 2+): ranged behind the melee line, melee screening the ranged, units keeping together
  const fw = [0, 0, 0.5, 0.8, 1, 1.2][lvl];
  if (fw && foes.length) {
    const friends = E.liveUnits(s1).filter(o => o.id !== u0.id && E.alliance(o.side) === al);
    const nearFoe = (p) => Math.min(...foes.map(e => E.manhattan(e, p)));
    const melee = friends.filter(o => E.typeOf(s1, o).weapon !== 'ranged');
    if (ranged && melee.length) {
      const ahead = (p) => Math.max(0, Math.min(...melee.map(m => nearFoe(m))) - nearFoe(p));
      v -= fw * 0.03 * w * (ahead(u1) - ahead(u0));
    } else if (!ranged) {
      for (const r of friends.filter(o => E.typeOf(s1, o).weapon === 'ranged' && E.manhattan(o, u1) <= 3))
        if (nearFoe(u1) < nearFoe(r)) v += fw * 0.02 * w;
    }
    const tight = friends.filter(o => Math.abs(o.x - u1.x) <= 1 && Math.abs(o.y - u1.y) <= 1).length;
    v += fw * 0.01 * w * Math.min(2, tight) * (S.posture === 'defensive' || S.posture === 'stall' ? 1.5 : 1);
    // protective officers stay close to the side's commanders and strategists
    if (M.styles.has('protective')) {
      const vip = friends.filter(o => { const of = o.officerId ? E.officerOf(s1, o) : null; return of && /commander|strategist/i.test(of.ctype || ''); });
      if (vip.length) v += 0.04 * w * (nearest(u0, vip) - nearest(u1, vip));
    }
  }
  // attackers: a catapult square in range of an enemy gate still standing is a good place for a ranged unit (it bombards)
  if (S.siege && S.siege.attacker && hasWalls(s0) && ranged) {
    const cat = (p) => (E.tileRules(s0, p.x, p.y)?.names || []).includes('Catapult') && (s0.siege?.gates || []).some(g => (g.state === 'locked' || g.state === 'open')
      && (g.owner === 'enemy' ? E.alliance(side) !== 'enemy' : E.alliance(side) === 'enemy') && g.squares.some(([gx, gy]) => Math.abs(gx - p.x) + Math.abs(gy - p.y) <= 10));
    v += 0.15 * w * ((cat(u1) ? 1 : 0) - (cat(u0) ? 1 : 0));
  }
  // a city's defenders stay behind the walls while the enemy is outside (unless sent out or attacking)
  if (S.siege && S.siege.defender && S.posture !== 'aggressive' && !(job && !E.insideCity(s0, job.pt.x, job.pt.y))) {
    const inside = (p) => E.insideCity(s0, p.x, p.y) || E.isWallTop(s0, p.x, p.y);
    if (foes.some(e => !inside(e))) v += 0.05 * w * ((inside(u1) ? 1 : 0) - (inside(u0) ? 1 : 0));
  }
  // waiting for reinforcements: drift towards where they will come in
  if (S.posture === 'stall' && S.reinforceSquares?.length) v += 0.02 * w * (nearest(u0, S.reinforceSquares) - nearest(u1, S.reinforceSquares));
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
  const S = opts.strategy || strategy(base, side), M = opts.mind || mind(base, u0, S, P);
  M.areas = areas;
  { const cache = new Map(), n = P.level >= 4 ? 3 : 2;
    M.sim = (e, holding) => { const k = e.id + (holding ? '|h' : ''); if (!cache.has(k)) cache.set(k, simThreat(base, unitId, E.unitById(base, e.id) || e, holding, n)); return cache.get(k); }; }
  const job = M.ignoreJob ? null : S.jobs.get(unitId);
  const out = [];
  const consider = (actions, f) => {
    const u1 = E.unitById(f, unitId);
    const o1 = outcomeScore(base, f, side, S, M), p1 = positionScore(base, f, u0, u1, side, P, S, M) + traitPosition(base, f, u0, u1, P, S), t1 = threatOf(f, u1, side, P, areas, S, M) + pressureOf(f, u1, P);
    let sc = o1 + p1 + t1 + teamScore(base, f, u0, u1, S, P, actions[actions.length - 1]);
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
    const heur = ([x, y]) => (S.close * M.close > 0 ? 1 : 0.3) * Math.min(99, routeDist(base, u0, { x, y }, foes)) + (job ? 1.5 : 0.5) * Math.min(99, routeDist(base, u0, { x, y }, objs))
      - 1.5 * groundValue(base, u0, x, y);
    tiles.sort((A, B) => heur(A) - heur(B));
    // squares next to fires that threaten what matters go to the front, so a firefighting move is always weighed
    const fires = P.level >= 1 ? dangerousFires(base, side, S, worth(base, u0)) : [];
    if (fires.length) {
      const near = (t) => fires.some(f => Math.max(Math.abs(f.x - t[0]), Math.abs(f.y - t[1])) <= 1);
      tiles = [...tiles.filter(near), ...tiles.filter(t => !near(t))];
    }
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
      // fires its arrows started (or brought closer), at what they're worth to the side
      const fw = [0.5, 0.5, 0.8, 1, 1, 1][P.level], before = (f.siege && f.siege.fires) || {}, scBefore = (f.siege && f.siege.scorch) || {};
      const fireGain = (g) => {
        let v = 0;
        for (const k of Object.keys((g.siege && g.siege.fires) || {})) if (!before[k]) { const [x, y] = k.split(',').map(Number); v += fireValue(f, side, S, x, y, worth(base, u0), unitId); }
        for (const [k, n] of Object.entries((g.siege && g.siege.scorch) || {})) if (n > (scBefore[k] || 0)) { const [x, y] = k.split(',').map(Number); v += 0.3 * fireValue(f, side, S, x, y, worth(base, u0), unitId); }
        return fw * v;
      };
      const scores = runs.map(g => { const u1 = E.unitById(g, unitId); return outcomeScore(base, g, side, S, M) + positionScore(base, g, u0, u1, side, P, S, M) + traitPosition(base, g, u0, u1, P, S) + threatOf(g, u1, side, P, areas, S, M) + pressureOf(g, u1, P) + fireGain(g); });
      const sup = P.level >= 2 ? suppressValue(f, u, target) * [0, 0, 0.6, 0.85, 1, 1.1][P.level] : 0;
      const team = runs.reduce((t, g) => t + teamScore(base, g, u0, E.unitById(g, unitId), S, P, act), 0) / runs.length;
      out.push({ actions: [...pre, act], score: scores.reduce((t, x) => t + x, 0) / scores.length + sup + team, state: runs[0] });
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
    // siege work (instead of attacking): batter or bombard a gate, put up ladders, pick up dropped equipment, shut a gate
    if (!u.round.attacked && !acf.forcedMarched && S.siege && (S.siege.attacker || S.siege.defender)) {
      const menu = E.actionMenu(f, u), w0 = worth(base, u0), sw = [0.5, 0.7, 0.85, 1, 1, 1][P.level];
      const tryAct = (act, bonus) => { const g = fork(f); E.setRng(seeded(hashStr(unitId + act.type + (act.x ?? '') + ',' + (act.y ?? '')))); if (!E.act(g, HOST, act).ok) return null; consider([...pre, act], g); out[out.length - 1].score += bonus * sw; return g; };
      if (S.siege.attacker && menu.attackGate) {
        const g0 = E.gateTargets(f, u)[0]; const before = g0 ? (E.gateHp(g0)?.hp ?? 0) : 0;
        const act = { type: 'attackGate', unitId, gateId: g0 && g0.id };
        const g = fork(f); E.setRng(seeded(hashStr(unitId + 'gate'))); 
        if (g0 && E.act(g, HOST, act).ok) {
          const g1 = g.siege.gates.find(x => x.id === g0.id), drop = Math.max(0, before - (g1.hp || 0)) / Math.max(1, g1.maxHp || 80);
          consider([...pre, act], g);
          out[out.length - 1].score += sw * w0 * (1.2 * drop + (g1.state === 'broken' ? 0.8 : 0) + 0.05);
        }
      }
      if (S.siege.attacker && menu.placeLadder) for (const [x, y] of E.ladderTiles(f, u)) tryAct({ type: 'placeLadder', unitId, x, y }, 0.45 * w0);
      if (S.siege.attacker && menu.pickUp) tryAct({ type: 'pickUpEquipment', unitId }, 0.3 * w0);
      if (S.siege.defender && menu.closeGate) {
        const near = E.liveUnits(f).some(e => E.hostile(e, u) && (f.siege?.gates || []).some(g => g.state === 'open' && g.squares.some(([gx, gy]) => Math.abs(gx - e.x) + Math.abs(gy - e.y) <= 6)));
        // a shut gate keeps out the whole army: worth more when the side holds squares inside
        if (near) tryAct({ type: 'closeGate', unitId }, w0 * (0.6 + (S.keep.some(p => E.insideCity(base, p.x, p.y)) ? 0.6 : 0)));
      }
    }
    // Set Aflame: set an adjacent square alight instead of attacking, when the fire is worth more than the attack
    if (!u.round.attacked && !acf.forcedMarched && E.actionMenu(f, u).setFire) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = u.x + dx, y = u.y + dy, fv = fireValue(base, side, S, x, y, worth(base, u0), unitId);
      if (fv <= 0.05 * worth(base, u0)) continue;
      const g = fork(f); const act = { type: 'setFire', unitId, x, y };
      if (!E.act(g, HOST, act).ok) continue;
      consider([...pre, act], g);
      out[out.length - 1].score += fv * [0.5, 0.6, 0.8, 1, 1, 1][P.level];
    }
    // put out a fire that threatens what matters (instead of attacking)
    if (!u.round.attacked && !acf.forcedMarched) for (const [fx, fy] of E.extinguishTiles(f, u)) {
      const danger = fireDanger(base, side, S, fx, fy, worth(base, u0));
      if (danger <= 0.08 * worth(base, u0)) continue;
      const g = fork(f); E.setRng(seeded(hashStr(unitId + 'ext' + fx + ',' + fy)));
      const act = { type: 'extinguish', unitId, x: fx, y: fy };
      if (!E.act(g, HOST, act).ok) continue;
      consider([...pre, act], g);
      out[out.length - 1].score += danger * [0.4, 0.6, 0.8, 1, 1, 1][P.level];
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
  // a battlefield skill waits for a choice (a free move or a free attack)
  if (SK.pendingChoice(s)) return skillAnswer(s, side);
  // an officer's battlefield active: weighed at the start of the turn (before moving)
  if (!opts.noSkill && ac.step === 'move' && !u.round.moved && !u.round.skillUsed) { const sk = skillOption(s, unitId, opts, P); if (sk) return sk; }
  // Medical Supplies (2026-11-09): out of contact, tend the unit (or adjacent ally) that has lost the most, if it's down a fair share
  if (ac.step === 'move' && !u.round.moved && !u.round.attacked) {
    const ts = E.medTargets(s, u);
    if (ts.length) {
      const score = (t) => (1 - t.men / mx(t)) * (Number(E.typeOf(s, t)?.tier) || 1);
      const t = ts.slice().sort((x, y) => score(y) - score(x))[0];
      if (t.men / mx(t) <= 0.7) return { type: 'tendWounded', unitId, targetId: t.id };
    }
  }
  // an officer who goes his own way says so in the log, once a round, before he acts
  if (ac.step === 'move' && !(u.round && u.round.aiNoted)) {
    const M = mind(s, u, strategy(s, side), P);
    if (M.note) return { type: 'aiNote', unitId, text: M.note };
  }
  const list = plans(s, unitId, opts);
  return list.length ? list[0].actions[0] : { type: 'endTurn', unitId };
}

/**
 * Battlefield actives (David, 2026-11-05). The AI tries the officer's active with a few likely picks, plays the rest
 * of the turn out after it, and uses it when that beats the best turn without it (the morale it costs counts, and
 * effects that last beyond this turn add a little). Higher Art of War levels try more picks; level 0-1 tacticians
 * use skills on a whim now and then rather than when they help most.
 */
function skillOption(s, unitId, opts, P) {
  const u = E.unitById(s, unitId), o = E.officerOf(s, u), act = o && o.battle && o.battle.active;
  if (!act || !E.skillCheck(s, u, o).ok) return null;
  if (act.manual && !act.do) return null; // nothing the engine does: the GM plays it
  const combos = pickCombos(s, u, act.pick || [], P.level >= 3 ? 3 : P.level >= 2 ? 2 : 1);
  if (!combos.length) return null;
  const rand = seeded(hashStr(unitId + ':skill:' + s.turn.round));
  const S = strategy(s, u.side);
  if (P.naive) return rand() < 0.35 ? { type: 'useSkill', unitId, picks: combos[0] } : null; // on a whim
  const best0 = (plans(s, unitId, { ...opts, noSkill: true })[0] || { score: -Infinity }).score;
  let best = null;
  for (const picks of combos) {
    const g = fork(s);
    const before = buffCount(g);
    if (!E.act(g, HOST, { type: 'useSkill', unitId, picks }).ok) continue;
    for (let i = 0; i < 4 && SK.pendingChoice(g); i++) E.act(g, HOST, skillAnswer(g, u.side));
    const ac = g.turn.activation;
    const lasting = buffCount(g) - before;
    // what the skill itself did (plans() scores from its own starting state), then the best rest of the turn
    let score = outcomeScore(s, g, u.side, S, {}) + (ac && ac.unitId === unitId ? (plans(g, unitId, { ...opts, noSkill: true })[0] || { score: 0 }).score : 0);
    score += 0.12 * worth(s, u) * lasting;
    if (!best || score > best.score) best = { score, picks };
  }
  E.setRng(Math.random);
  return best && best.score > best0 + 0.05 * worth(s, u) ? { type: 'useSkill', unitId, picks: best.picks } : null;
}
const buffCount = (s) => s.units.reduce((n, x) => n + ((x.fx && x.fx.buffs) || []).filter(b => b.until.kind !== 'round' || b.until.round > s.turn.round).length, 0);
/** A few likely choices for an active's picks: enemies near and weak, allies hurt or in the fight, squares by enemies. */
function pickCombos(s, u, picks, k) {
  if (!picks.length) return [{}];
  const foes = E.liveUnits(s).filter(e => E.hostile(e, u));
  const near = (p) => Math.min(99, ...foes.map(e => E.manhattan(e, p)));
  const rank = (pk, earlier = {}) => {
    const c = SK.pickCandidates(s, u, pk, earlier);
    const val = (id) => {
      if (Array.isArray(id)) return -near({ x: id[0], y: id[1] });
      const x = E.unitById(s, id);
      return pk.side === 'enemies' ? -(x.men / mx(x)) * 2 - x.morale / 50 - E.manhattan(u, x) / 4 + (x.officerId ? 0.5 : 0)
        : -(x.morale / 50) - near(x) / 3 + (x.id === u.id ? 0.2 : 0);
    };
    return c.sort((a, b) => val(b) - val(a));
  };
  const lists = picks.map(rank);
  if (lists.some((l, i) => !l.length && !picks[i].upTo)) return [];
  const out = [];
  for (let i = 0; i < Math.max(1, Math.min(k, lists[0].length)); i++) {
    const combo = {}, used = new Set();
    picks.forEach((pk, j) => {
      const l = j === 0 ? [...lists[0].slice(i), ...lists[0].slice(0, i)] : rank(pk, combo); // later picks may depend on earlier ones
      combo[pk.id] = l.filter(c => !used.has(String(c))).slice(0, pk.count || 1);
      combo[pk.id].forEach(c => used.add(String(c)));
    });
    out.push(combo);
  }
  return out;
}
/**
 * Answer a battlefield skill's pending choice, or pass: a free attack is made only when playing it out comes out
 * ahead; a free move goes where the unit stands best (toward the fight for melee, at range for archers, away when
 * the skill says so), and the unit stays put when no square is better than where it is.
 */
function skillAnswer(s, side) {
  const ch = SK.pendingChoice(s); const u = ch && E.unitById(s, ch.unitId);
  const pass = { type: 'skillChoose', skip: true };
  if (!u) return pass;
  const S = strategy(s, u.side);
  if (ch.kind === 'split') { // share the morale where it is needed most (lowest morale first)
    const amounts = {}; let left = ch.total;
    for (const id of [...ch.units].sort((a, b) => (E.unitById(s, a)?.morale ?? 100) - (E.unitById(s, b)?.morale ?? 100))) {
      const x = E.unitById(s, id); const n = Math.min(ch.max, left, Math.max(0, 100 - (x?.morale ?? 100))); amounts[id] = n; left -= n;
    }
    return { type: 'skillChoose', amounts };
  }
  if (ch.kind === 'attack') {
    let best = null;
    for (const d of E.attackTargets(s, u)) {
      const f = fork(s); E.setRng(seeded(hashStr(u.id + d.id + s.turn.round)));
      E.act(f, HOST, { type: 'skillChoose', targetId: d.id });
      const v = outcomeScore(s, f, u.side, S, {});
      if (!best || v > best.v) best = { v, id: d.id };
    }
    E.setRng(Math.random);
    return best && best.v > 0 ? { type: 'skillChoose', targetId: best.id } : pass;
  }
  const sq = SK.choiceSquares(s, ch); if (!sq.length) return pass;
  const foes = E.liveUnits(s).filter(e => E.hostile(e, u));
  const d = ([x, y]) => Math.min(99, ...foes.map(e => E.manhattan(e, { x, y })));
  const ranged = (E.typeOf(s, u) || {}).weapon === 'ranged';
  const cost = (p) => ch.mode === 'away' ? -d(p) : ranged ? Math.abs(d(p) - 3) : d(p) <= 1 ? 1 : d(p);
  sq.sort((a, b) => cost(a) - cost(b));
  if (cost(sq[0]) >= cost([u.x, u.y])) return pass; // nothing better than where it stands
  return { type: 'skillChoose', x: sq[0][0], y: sq[0][1] };
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
  // a combined attack: going after his partners is weighed against what he can do now and the risk of waiting
  // (enemies acting first); it's never an order (David, 2026-11-11)
  const S0 = strategy(s, side);
  if (waitingFor(s, S0, unitId)) {
    const now = bestScore(s, unitId, { ...opts, level: P.level });
    const foesFirst = E.liveUnits(s).filter(e => E.hostile(e, u) && !e.round.activated && E.manhattan(e, u) <= E.movementOf(s, e) + 2).length;
    const later = 0.7 * waitGain(s, S0, unitId) - 0.04 * worth(s, u) * foesFirst;
    return { type: 'decide', unitId, choice: later > Math.max(0, now) * 0.3 ? 'hold' : 'act' };
  }
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
  const S = P.level >= 3 ? strategy(s, side) : null;
  for (const u of mine) {
    let v = bestScore(s, u.id, { ...opts, level: Math.min(P.level, 3) });
    // thinking a move ahead: Suppressing Fire goes before the charge it opens up
    if (P.level >= 3) for (const e of E.liveUnits(s)) if (E.hostile(e, u) && E.manhattan(e, u) <= E.movementOf(s, u) + (E.typeOf(s, u).rangeMax || 1)) v = Math.max(v, v + 3 * suppressValue(s, u, e));
    // a combined attack goes in its order: those still waiting for partners go after them
    if (P.level >= 3 && waitingFor(s, S, u.id)) v -= waitGain(s, S, u.id); // he'd gain that by going after them
    if (v > bestV) { bestV = v; best = u; }
  }
  return { type: 'begin', unitId: best.id };
}

/** What the AI does next, if it is this side's move: an action, or null when it's someone else's turn. */
export function aiStep(s, sides, opts = {}) {
  const on = (side) => !!sides?.[side];
  if (s.duels?.pending) return null;
  // tactics phase: an AI side picks its tactician and places its tactics (ai-tactics.mjs)
  if (s.turn?.phase === 'tactics') {
    for (const side of ['enemy', 'ally']) if (on(side)) { const a = tacticsStep(s, side, opts); if (a) return a; }
    return null;
  }
  // a battle-start reveal for an AI side (Inside Knowledge): it picks the strongest hidden enemy (David, 2026-11-09)
  const rv = SK.pendingReveal(s), rsrc = rv && E.unitById(s, rv.src);
  if (rsrc && on(rsrc.side) && !rsrc.owner) { const t = SK.aiRevealTarget(s, rsrc); return t ? { type: 'skillReveal', pickId: rv.id, targetId: t.id } : { type: 'skillReveal', pickId: rv.id, skip: true }; }
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

/** For the tests. */
export { simThreat as _simThreat, traitHit as _traitHit, traitPosition as _traitPosition };
