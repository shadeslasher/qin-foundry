// Officers' battlefield skills at work (David, 2026-11-05). Pure: works on engine state, no Foundry.
//
// Every officer has a battlefield passive and a battlefield active, written in the spec vocabulary of skill-spec.mjs
// (adapter: officer library entry .battle = { passive, active, passiveName, activeName }). This file applies them:
//   - modifiers on rolls, movement, range, armor, damage, morale losses (rollParts, stat), from passives (the officer's
//     own unit or an aura over allies / enemies around it) and from buffs that actives put on units
//   - on/off properties (flag) and statuses (status: can't move, can't attack, skip turn...)
//   - triggers on events (event): battle start, round start, turn start/end, wins, losses, routs...
//   - actives (useActive): picks, then steps run in order; a step that needs a choice on the map (a free move, a
//     free attack's target) waits in turn.activation.skillRun until the player or the AI answers (skillAnswer)
// Buffs and counters live in the unit's fx (saved by the adapter): fx.buffs, fx.acts (activations started),
// fx.skUsed (trigger limits). "This turn" = the rest of the round; "N turns" = N rounds; "until its next turn"
// counts that unit's activations.
import * as E from './engine.mjs';

const live = (s) => E.liveUnits(s);
const fxOf = (u) => (u.fx ||= {});
const ally = (a, b) => E.alliance(a.side) === E.alliance(b.side);
const half = (v) => (v === 'half' ? 50 : Number(v));
const typeOf = (s, u) => E.typeOf(s, u) || {};

/** The battle specs of a unit's officer: { passive, active, passiveName, activeName, officer } or null. */
export function specsOf(s, u) {
  if (!u || !u.officerId) return null;
  const o = E.officerOf(s, u);
  return o && o.battle ? { ...o.battle, officer: o } : null;
}

// ---------------------------------------------------------------- terrain words
const TERRAIN_GROUPS = {
  town: ['town-hall', 'city', 'paving'], fort: ['fort', 'small-fort'], camp: ['camp', 'camp-stakes', 'camp-palisade', 'camp-wall', 'camp-gate'],
  water: ['river', 'lake', 'ford'], wall: ['city-wall', 'fortress-tower'], gate: ['city-gate', 'camp-gate'], village: ['farmhouse'],
  trees: ['trees'], forest: ['forest'], mountain: ['mountain'], palisade: ['camp-palisade', 'palisade'],
};
/** Does square (x, y) count as any of these terrain words? */
export function onTerrain(s, x, y, list) {
  const t = s.map && s.map.tiles && s.map.tiles[x + ',' + y];
  if (!t) return false;
  const ids = new Set([t.terrain, ...(t.overlays || [])]);
  for (const w of list) {
    if (w === 'burning') { if (s.siege && s.siege.fires && s.siege.fires[x + ',' + y]) return true; continue; }
    if (ids.has(w)) return true;
    if (TERRAIN_GROUPS[w] && TERRAIN_GROUPS[w].some(i => ids.has(i))) return true;
    if (w === 'pass' && ids.has('road')) { // a road through rough ground, or squeezed between impassable squares
      const r = E.tileRules(s, x, y);
      const rough = ['forest', 'rocky', 'marsh', 'sand'].includes(t.terrain) || (t.overlays || []).some(o => o === 'trees' || o === 'hill');
      const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => { const q = E.tileRules(s, x + dx, y + dy); return q && q.pass === 'none'; }).length;
      if (rough || walls >= 2 || (r && r.rough)) return true;
    }
  }
  return false;
}
const nearWater = (s, u) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onTerrain(s, u.x + dx, u.y + dy, ['water']));

// ---------------------------------------------------------------- filters and conditions
const tierOf = (s, u) => Number(typeOf(s, u).tier) || Number(typeOf(s, u).unitValue) || 1;
const enemiesAdjacent = (s, u) => live(s).filter(o => E.hostile(o, u) && E.manhattan(o, u) === 1).length;

/** Does unit u match FILTER f? `ctx.self` = the unit whose roll it is (for vs filters), `ctx.src` = the officer's unit. */
export function matches(s, f, u, ctx = {}) {
  if (!f) return true;
  const t = typeOf(s, u), ranged = t.weapon === 'ranged';
  for (const [k, v] of Object.entries(f)) {
    switch (k) {
      case 'category':
        if (v === 'ranged' ? !ranged : v === 'cavalry' ? t.category !== 'cavalry' : (t.category === 'cavalry' || ranged)) return false; break;
      case 'melee': if (ranged === !!v) return false; break;
      case 'levy': if (!!E.unitTrait(u, 'levy') !== !!v) return false; break;
      case 'trait': if (!E.unitTrait(u, String(v).toLowerCase())) return false; break;
      case 'officer': if (!!u.officerId !== !!v) return false; break;
      case 'officerType': { const o = u.officerId ? E.officerOf(s, u) : null; if (!o || String(o.ctype || '').toLowerCase() !== String(v).toLowerCase()) return false; break; }
      case 'onTerrain': if (!onTerrain(s, u.x, u.y, v)) return false; break;
      case 'nearWater': if (nearWater(s, u) !== !!v) return false; break;
      case 'hidden': if (!!u.hidden !== !!v) return false; break;
      case 'notActed': if (!!(u.round && u.round.activated) === !!v) return false; break;
      case 'acted': if (!!(u.round && u.round.activated) !== !!v) return false; break;
      case 'moraleBelow': if (!((u.morale ?? 50) < half(v))) return false; break;
      case 'moraleAbove': if (!((u.morale ?? 50) > half(v))) return false; break;
      case 'healthBelow': { const fr = v === 'half' ? 0.5 : Number(v); if (!(u.men < fr * (u.maxMen || 100))) return false; break; }
      case 'surroundedOrEngaged': if (!(u.surrounded || enemiesAdjacent(s, u) >= Number(v))) return false; break;
      case 'notAttackedLastTurn': if (!!fxOf(u).skAttackedLast === !!v) return false; break;
      case 'noEnemyAdjacent': if ((enemiesAdjacent(s, u) === 0) !== !!v) return false; break;
      case 'attackedMeLastTurn': { // vs: it attacked ctx.self on its last turn (this round or the previous one)
        const me = ctx.self, last = me && fxOf(me).skAttackers && fxOf(me).skAttackers[u.id];
        if (!(last != null && last >= ((s.turn && s.turn.round) || 0) - 1) === !!v) return false; break;
      }
      case 'tierAbove': if (!(ctx.self && tierOf(s, u) > tierOf(s, ctx.self)) === !!v) return false; break;
      case 'flammable': break; // tiles only
      // v2
      case 'any': if (!v.some(g => matches(s, g, u, ctx))) return false; break;
      case 'isPick': if (!(ctx.picks && (ctx.picks[v] || []).includes(u.id))) return false; break;
      case 'isSource': if (!!(ctx.src && ctx.src.id === u.id) !== !!v) return false; break;
      case 'isTarget': if (!!(ctx.target && ctx.target.id === u.id) !== !!v) return false; break;
      case 'allyAdjacent': { const n = live(s).filter(o => o.id !== u.id && ally(o, u) && E.manhattan(o, u) === 1).length; if (v === false ? n > 0 : n < (v === true ? 1 : Number(v))) return false; break; }
      case 'allyWithin': if (!live(s).some(o => o.id !== u.id && ally(o, u) && E.manhattan(o, u) <= Number(v))) return false; break;
      case 'enemyAdjacent': if (enemiesAdjacent(s, u) < (v === true ? 1 : Number(v))) return false; break;
      case 'tierBelow': if (!(ctx.self && tierOf(s, u) < tierOf(s, ctx.self)) === !!v) return false; break;
      case 'officerTierAtLeast': { const o = u.officerId ? E.officerOf(s, u) : null; if (!o || (Number(o.tier) || 0) < Number(v)) return false; break; }
      case 'lessMoraleThanSource': if (!(ctx.src && (u.morale ?? 50) < (ctx.src.morale ?? 50)) === !!v) return false; break;
      case 'holding': if (!!(u.round && u.round.holding) !== !!v) return false; break;
      case 'wasAttackedThisTurn': if (!!(u.round && u.round.wasAttacked) !== !!v) return false; break;
      case 'attackedThisTurn': if (!!(u.round && u.round.madeAttack) !== !!v) return false; break;
      // conditions (COND) on the receiving unit and the roll
      case 'attacking': if ((ctx.role === 'attacker') !== !!v) return false; break;
      case 'defending': if ((ctx.role === 'defender') !== !!v) return false; break;
      case 'kind': {
        const kind = ctx.overwatch ? 'overwatch' : ctx.charge ? 'charge' : ctx.ranged ? 'ranged' : 'melee';
        if (!(kind === v || (v === 'melee' && kind === 'charge'))) return false; break;
      }
      case 'moved': if (!!(u.round && u.round.moved) !== !!v) return false; break;
      case 'notMoved': if (!!(u.round && u.round.moved) === !!v) return false; break;
      case 'movedAtLeast': { const ac = s.turn && s.turn.activation; const n = ctx.tilesMoved ?? (ac && ac.unitId === u.id ? ac.tilesMoved : 0); if (!((n || 0) >= Number(v))) return false; break; }
      case 'firstAttackOfBattle': case 'notAttackedThisBattle': if (!!fxOf(u).attackedOnce === !!v) return false; break;
      case 'firstAttackOfTurn': if (!!(u.round && u.round.madeAttack) === !!v) return false; break;
      case 'selfOnTerrain': if (!ctx.src || !onTerrain(s, ctx.src.x, ctx.src.y, v)) return false; break;
      case 'selfHidden': if (!ctx.src || !!ctx.src.hidden !== !!v) return false; break;
      case 'selfNotMoved': if (!ctx.src || !!(ctx.src.round && ctx.src.round.moved) === !!v) return false; break;
      case 'selfMoraleAbove': if (!ctx.src || !((ctx.src.morale ?? 50) > half(v))) return false; break;
      case 'selfMoraleBelow': if (!ctx.src || !((ctx.src.morale ?? 50) < half(v))) return false; break;
      default: break;
    }
  }
  return true;
}

/** Does WHO (seen from the officer's unit `src`) include unit u? */
export function whoIncludes(s, who, src, u, ctx = {}) {
  if (!who || (who.self === true && !who.side && who.pick === undefined && !who.target)) return u.id === src.id;
  if (who.pick !== undefined) return (ctx.picks && (ctx.picks[who.pick] || []).includes(u.id)) && matches(s, who.filter, u, { ...ctx, src });
  if (who.target) return !!(ctx.target && ctx.target.id === u.id);
  const center = who.from ? fromPoint(s, who.from, ctx) : src;
  if (!center) return false;
  if (who.from && u.id === center.id) return false;
  if (u.id === src.id && !who.from) return who.side === 'allies' && who.self === true && matches(s, who.filter, u, { ...ctx, src });
  if ((who.side === 'allies') !== ally(u, src)) return false;
  const d = E.manhattan(center, u);
  if (who.all !== true) { if (who.exact != null ? d !== who.exact : d > (who.range ?? 0)) return false; }
  return matches(s, who.filter, u, { ...ctx, src });
}
/** The unit or square a "from" points at: { pick } (a unit or a tile pick) or { target }. */
function fromPoint(s, from, ctx) {
  if (from.target) return ctx.target || null;
  const p = ((ctx.picks && ctx.picks[from.pick]) || [])[0];
  if (Array.isArray(p)) return { x: p[0], y: p[1], id: null };
  return p ? E.unitById(s, p) : null;
}
/** The units WHO reaches (seen from src). */
export function resolveWho(s, who, src, ctx = {}) {
  return live(s).filter(u => whoIncludes(s, who, src, u, ctx));
}

// ---------------------------------------------------------------- what reaches a unit
/** Every passive mod/flag and buff entry that reaches unit u: [{ entry, src, name, buff }]. kind: 'mods' | 'flags'. */
function reaching(s, u, kind) {
  const out = [];
  for (const X of live(s)) {
    const sp = specsOf(s, X);
    const p = sp && sp.passive;
    if (p && p[kind]) for (const e of p[kind]) if (whoIncludes(s, e.who, X, u)) out.push({ entry: e, src: X, name: sp.passiveName || 'passive', ext: {} });
  }
  const acts = fxOf(u).acts || 0;
  for (const b of fxOf(u).buffs || []) {
    if (b.until.from && acts < b.until.from) continue; // "its next turn": not yet
    const src = E.unitById(s, b.src) || u;
    const ext = { picks: b.picks || {}, target: b.target ? E.unitById(s, b.target) : null };
    for (const e of b[kind] || []) out.push({ entry: e, src, name: b.name, buff: b, ext });
  }
  return out;
}
const ROLL_STATS = { attack: (c) => c.role === 'attacker', commandAtk: (c) => c.role === 'attacker', command: () => true,
  commandDef: (c) => c.role === 'defender', meleeDef: (c) => c.role === 'defender' && !c.ranged, rangedDef: (c) => c.role === 'defender' && !!c.ranged,
  overwatch: (c) => c.role === 'attacker' && !!c.overwatch };
const STAT_LABEL = { attack: 'Attack', commandAtk: 'Command (attacking)', command: 'Command', commandDef: 'Command (defending)',
  meleeDef: 'melee defense', rangedDef: 'ranged defense', overwatch: 'Overwatch attack' };

/** Roll parts from officers' battlefield skills for unit u (role 'attacker'|'defender'; ctx as in buildRoll). */
export function rollParts(s, u, role, ctx = {}) {
  const other = role === 'attacker' ? ctx.defender : ctx.attacker;
  const rc = { role, ranged: !!ctx.ranged, charge: !!ctx.charge, overwatch: !!ctx.overwatch, tilesMoved: ctx.tilesMoved, self: u };
  const parts = [];
  for (const { entry: m, src, name, buff, ext } of reaching(s, u, 'mods')) {
    const when = ROLL_STATS[m.stat]; if (!when || !when(rc)) continue;
    if (!matches(s, m.if, u, { ...rc, ...ext, src })) continue;
    if (m.vs && (!other || !matches(s, m.vs, other, { ...rc, ...ext, self: u, src }))) continue;
    const who = E.officerOf(s, src);
    parts.push([(who ? who.name + ' · ' : '') + name + (buff ? '' : '') + ': ' + STAT_LABEL[m.stat], Number(m.value) || 0]);
  }
  return parts;
}

/** Sum of a non-roll stat on unit u (move, range, armor, pen, damage, moraleLossLess...). regenCap: the highest. */
export function stat(s, u, name, ctx = {}) {
  let v = 0, cap = 0;
  for (const { entry: m, src, ext } of reaching(s, u, 'mods')) {
    if (m.stat !== name) continue;
    if (!matches(s, m.if, u, { ...ctx, ...ext, src, self: u })) continue;
    if (m.vs && (!ctx.other || !matches(s, m.vs, ctx.other, { ...ctx, ...ext, self: u, src }))) continue;
    if (name === 'regenCap') cap = Math.max(cap, Number(m.value) || 0); else v += Number(m.value) || 0;
  }
  return name === 'regenCap' ? cap : v;
}

/** A flag on unit u: false, true, or its number (revealHidden:N, splash:N), or its list (ignoreTerrainCost). */
export function flag(s, u, name, ctx = {}) {
  let best = false;
  for (const { entry: f, src, ext } of reaching(s, u, 'flags')) {
    const [fname, arg] = String(f.flag).split(':');
    if (fname !== name && !(name === 'noSurrender' && fname === 'noRout')) continue;
    if (!matches(s, f.if, u, { ...ctx, ...ext, src, self: u })) continue;
    if (arg === undefined) return true;
    if (name === 'ignoreTerrainCost') best = [...(best || []), ...arg.split(',')];
    else best = Math.max(Number(best) || 0, Number(arg) || 0);
  }
  return best;
}

/** A status a buff put on unit u ('cantMove', 'cantAttack', 'cantMoveOrAttack', 'skipTurn', 'moveOrAttack', 'noSkills', 'stripDefenses'). */
export function status(s, u, name) {
  const acts = fxOf(u).acts || 0;
  const list = (fxOf(u).buffs || []).filter(b => !(b.until.from && acts < b.until.from));
  return list.some(b => b.status === name || (b.status === 'cantMoveOrAttack' && (name === 'cantMove' || name === 'cantAttack')));
}

// ---------------------------------------------------------------- buffs and their ends
let buffSeq = 0;
/** Put a buff on unit u from the officer's unit src: mods, flags or a status, for a duration. */
export function addBuff(s, u, src, name, { mods, flags, triggers, status: st, after, target }, dur, ctx = {}) {
  const round = (s.turn && s.turn.round) || 0, acts = fxOf(u).acts || 0;
  const until = typeof dur === 'object' && dur ? { kind: 'round', round: round + Math.max(1, dur.rounds) - 1 }
    : dur === 'thisTurn' ? { kind: 'round', round }
    : dur === 'untilNextTurnEnd' ? { kind: 'actEnd', acts: acts + 1 }
    : dur === 'nextTurn' ? { kind: 'actEnd', acts: acts + 1, from: acts + 1 }
    : dur === 'untilNextTurnStart' ? { kind: 'actStart', acts: acts + 1 }
    : dur === 'nextAttack' ? { kind: 'attack' } : dur === 'nextRoll' ? { kind: 'roll' } : { kind: 'battle' };
  const b = { id: 'b' + (++buffSeq) + '.' + round, name, src: src.id, until };
  if (mods && mods.length) b.mods = mods.map(m => ({ ...m, who: undefined }));
  if (flags && flags.length) b.flags = flags.map(f => ({ ...f, who: undefined }));
  if (triggers && triggers.length) b.triggers = triggers;
  if (target) b.targetFilter = target;
  if (st) b.status = st;
  if (after) b.after = after;
  if (ctx.picks && Object.keys(ctx.picks).length) b.picks = ctx.picks;
  if (ctx.target) b.target = ctx.target.id;
  (fxOf(u).buffs ||= []).push(b);
  return b;
}
function dropBuffs(u, test) { const f = fxOf(u); if (f.buffs) { f.buffs = f.buffs.filter(b => !test(b)); if (!f.buffs.length) delete f.buffs; } }

/** Engine hook: a unit starts an activation. Returns 'skip' if a status makes it skip the turn. */
export function onActivationStart(s, u) {
  const f = fxOf(u); f.acts = (f.acts || 0) + 1;
  dropBuffs(u, b => b.until.kind === 'actStart' && f.acts >= b.until.acts);
  revealSweep(s);
  if (status(s, u, 'skipTurn')) { dropBuffs(u, b => b.status === 'skipTurn'); return 'skip'; }
  if (status(s, u, 'cantMove')) u.round.cannotMove = true;
  event(s, 'turnStart', u);
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'alliesTurnStart' : 'enemyTurnStart', X, { target: u });
  return null;
}
/** Engine hook: a unit's activation ends. */
export function onActivationEnd(s, u) {
  const f = fxOf(u);
  f.skAttackedLast = !!(u.round && u.round.attacked);
  event(s, 'turnEnd', u);
  for (const X of live(s)) if (E.hostile(X, u) && E.manhattan(X, u) === 1) event(s, 'enemyEndsAdjacent', X, { target: u });
  dropBuffs(u, b => b.until.kind === 'actEnd' && (f.acts || 0) >= b.until.acts);
  revealSweep(s); moraleSweep(s);
}
/** Engine hook: the round has ended (before the next starts). */
export function onRoundEnd(s) {
  for (const X of live(s)) event(s, 'roundEnd', X);
  const round = (s.turn && s.turn.round) || 0;
  for (const u of s.units || []) dropBuffs(u, b => b.until.kind === 'round' && round >= b.until.round);
}
/** Engine hook: a new round starts. */
export function onRoundStart(s) {
  for (const X of live(s)) event(s, 'roundStart', X);
  revealSweep(s);
}
/** Engine hook: the battle starts (round 1, after tactics). */
export function onBattleStart(s) {
  for (const X of live(s)) {
    const sm = stat(s, X, 'startMorale');
    if (sm) { X.morale = Math.max(0, Math.min(100, (X.morale ?? 50) + sm)); say(s, X.name + (sm > 0 ? ' starts the battle with +' : ' starts the battle with ') + sm + ' morale (battlefield skill).', { type: 'skillMorale', unit: X.id }); }
  }
  for (const X of live(s)) event(s, 'battleStart', X);
  // what the GM still applies by hand: passives the engine can't fully play
  for (const X of live(s)) { const sp = specsOf(s, X); if (sp && sp.passive && sp.passive.manual) say(s, (sp.officer.name || X.name) + ' · ' + (sp.passiveName || 'passive') + ' (GM' + (sp.passive.mods || sp.passive.flags || sp.passive.triggers ? ', partly' : '') + '): ' + sp.passive.manual, { type: 'skillManual', unit: X.id }); }
}
/** Clear a unit's skill state (back to setup). */
export function resetUnit(u) {
  if (!u.fx) return;
  for (const k of ['buffs', 'acts', 'skUsed', 'skBelowHalf', 'skAttackers', 'skAttackedLast', 'skillLast', 'rerollRound']) delete u.fx[k];
}
/** Engine hook: an attack was resolved (before settle). res: the engine's attack result. */
export function onAttack(s, attacker, defender, res) {
  const round = (s.turn && s.turn.round) || 0;
  (fxOf(defender).skAttackers ||= {})[attacker.id] = round;
  for (const u of [attacker, defender]) dropBuffs(u, b => b.until.kind === 'roll');
  // buffs for "its next attack": used up now, with their follow-ups
  const used = (fxOf(attacker).buffs || []).filter(b => b.until.kind === 'attack');
  dropBuffs(attacker, b => b.until.kind === 'attack');
  // Splash (a battlefield skill): enemies next to the defender take N casualties when the attack lands
  const sp = flag(s, attacker, 'splash', { role: 'attacker', ranged: !!res.ranged, other: defender });
  if (sp && res.casualtiesDefender > 0) for (const b of live(s)) {
    if (b.id === defender.id || b.id === attacker.id || !E.hostile(b, attacker) || E.manhattan(b, defender) !== 1) continue;
    const c = Math.min(Number(sp), b.men); b.men -= c;
    say(s, 'Splash (battlefield skill): ' + b.name + ', next to ' + defender.name + ', takes ' + c + ' casualties.', { type: 'splash', unit: b.id, casualties: c });
  }
  const killed = res.killedBy === attacker.id;
  const won = res.winner === 'attacker', lost = res.winner === 'defender';
  if (E.alive(defender) && defender.men > 0) event(s, 'attacked', defender, { target: attacker });
  if (res.winner) {
    const w = won ? attacker : defender, l = won ? defender : attacker;
    event(s, 'win', w, { target: l }); event(s, 'lose', l, { target: w });
    event(s, won ? 'attackWin' : 'defendWin', w, { target: l });
    for (const X of live(s)) if (X.id !== w.id && ally(X, w)) event(s, 'allyWins', X, { target: w });
  }
  if (killed) event(s, 'kill', attacker, { target: defender });
  for (const b of used) if (b.after) {
    const src = E.unitById(s, b.src) || attacker;
    const steps = [...(killed ? b.after.onKill || [] : []), ...(won ? b.after.onWin || [] : []), ...(lost ? b.after.onLose || [] : [])];
    if (steps.length) runSteps(s, steps, { src, target: defender, picks: b.after.picks || {}, name: b.name, auto: !activeIs(s, src) });
  }
  moraleSweep(s);
}
const activeIs = (s, u) => !!(s.turn && s.turn.activation && s.turn.activation.unitId === u.id);
/** Engine hook: a unit routed, surrendered or was destroyed. */
export function onFall(s, u) {
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'allyFalls' : 'enemyFalls', X, { target: u });
}
/** The first drop below half morale each battle. */
function moraleSweep(s) {
  for (const u of live(s)) { const f = fxOf(u); if (!f.skBelowHalf && (u.morale ?? 50) < 50 && u.men > 0) { f.skBelowHalf = true; event(s, 'firstBelowHalfMorale', u); } }
}
export function onMorale(s) { moraleSweep(s); }
/** revealHidden:N — hidden enemies within N of a unit with it are revealed. */
function revealSweep(s) {
  for (const X of live(s)) {
    const n = flag(s, X, 'revealHidden'); if (!n) continue;
    for (const u of live(s)) if (u.hidden && E.hostile(u, X) && E.manhattan(u, X) <= Number(n)) { u.hidden = false; say(s, u.name + ' is spotted by ' + X.name + ' (battlefield skill).', { type: 'revealed', unit: u.id }); }
  }
}

/** Why unit u may not attack d right now because of battlefield skills (null = it may). */
export function cantAttackReason(s, u, d) {
  if (status(s, u, 'cantAttack')) return "It can't attack this turn (battlefield skill)";
  if (status(s, u, 'moveOrAttack') && u.round && u.round.moved) return 'It may move or attack this turn, not both (battlefield skill)';
  const acts = fxOf(u).acts || 0;
  for (const b of fxOf(u).buffs || []) {
    if (b.until.from && acts < b.until.from) continue;
    if (b.status === 'cantAttackSource' && b.src === d.id) return "It can't attack that unit (battlefield skill)";
    if (b.targetFilter && b.until.kind === 'attack') {
      const src = E.unitById(s, b.src) || u;
      if (!matches(s, b.targetFilter, d, { src, self: u, picks: b.picks || {}, target: b.target ? E.unitById(s, b.target) : null })) return 'The skill attack must target another unit';
    }
  }
  if (flag(s, d, 'untargetable')) return "That unit can't be attacked (battlefield skill)";
  return null;
}

// ---------------------------------------------------------------- triggers
const RANGED_EVENTS = { alliesTurnStart: 99, enemyTurnStart: 99, enemyEndsAdjacent: 1, allyFalls: 3, enemyFalls: 99, allyWins: 99 };
/** Run unit X's triggers for this event: its officer's passive, and triggers held by buffs on it. */
export function event(s, on, X, ctx = {}) {
  if (!E.alive(X) || X.men <= 0) return;
  const sp = specsOf(s, X);
  const lists = [];
  if (sp && sp.passive && sp.passive.triggers) lists.push({ trig: sp.passive.triggers, name: sp.passiveName || 'passive', key: 'p', picks: {} });
  for (const b of fxOf(X).buffs || []) if (b.triggers) lists.push({ trig: b.triggers, name: b.name, key: b.id, picks: b.picks || {}, buffSrc: b.src });
  if (!lists.length) return;
  const round = (s.turn && s.turn.round) || 0;
  for (const L of lists) L.trig.forEach((t, i) => {
    if (t.on !== on) return;
    if (ctx.target && on in RANGED_EVENTS && E.manhattan(X, ctx.target) > (t.range ?? RANGED_EVENTS[on])) return;
    if (t.if && !matches(s, t.if, X, { src: X, self: X, target: ctx.target, picks: L.picks })) return;
    if (t.limit) {
      const used = (fxOf(X).skUsed ||= {}), key = L.key + ':' + i;
      const stamp = t.limit === 'battle' ? 'b' : t.limit === 'round' ? 'r' + round : 't' + round + ':' + (fxOf(X).acts || 0);
      if (used[key] === stamp) return;
      used[key] = stamp;
    }
    runSteps(s, t.do || [], { src: X, target: ctx.target, picks: L.picks, name: L.name, auto: true });
  });
}

// ---------------------------------------------------------------- steps
/**
 * Run steps in order. A step that waits for a choice on the map (a free move; a free attack by another unit) stores
 * itself and the rest in turn.activation.skillRun and stops; skillAnswer carries on. Returns 'wait' or 'done'.
 */
export function runSteps(s, steps, ctx) {
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const r = step(s, st, ctx, steps.slice(i + 1));
    if (r === 'wait') return 'wait';
    if (r === 'stop') return 'done';
  }
  return 'done';
}
const say = (s, text, detail) => E._log(s, text, detail);
const nm = (u) => u.name;

function loseMorale(s, u, n, src) {
  let loss = Math.max(0, n);
  if (src && E.hostile(src, u)) loss = Math.max(0, loss - stat(s, u, 'skillLossLess') - stat(s, u, 'anyLossLess'));
  u.morale = Math.max(0, (u.morale ?? 50) - loss);
  onMorale(s, u);
  return loss;
}

function step(s, st, ctx, rest) {
  const src = ctx.src, label = (E.officerOf(s, src)?.name || nm(src)) + ' · ' + (ctx.name || 'skill');
  const units = (who) => resolveWho(s, who, src, ctx);
  if (st.manual !== undefined) { say(s, label + ' (GM): ' + st.manual, { type: 'skillManual', unit: src.id }); return; }
  if (st.morale !== undefined) {
    for (const u of units(st.who)) {
      if (st.morale > 0) { const b = u.morale; u.morale = Math.min(100, (u.morale ?? 50) + st.morale); if (u.morale !== b) say(s, label + ': ' + nm(u) + ' regains ' + (u.morale - b) + ' morale.', { type: 'skillMorale', unit: u.id }); }
      else { const l = loseMorale(s, u, -st.morale, src); say(s, label + ': ' + nm(u) + ' loses ' + l + ' morale.', { type: 'skillMorale', unit: u.id }); }
    }
    return;
  }
  if (st.health !== undefined) {
    for (const u of units(st.who)) { const b = u.men; u.men = Math.min(u.maxMen || u.men, u.men + st.health); if (u.men !== b) say(s, label + ': ' + nm(u) + ' regains ' + (u.men - b) + ' health.', { type: 'skillHealth', unit: u.id }); }
    return;
  }
  if (st.buff) {
    for (const u of units(st.who)) addBuff(s, u, src, ctx.name || 'skill', st.buff, st.for, ctx);
    const who = units(st.who).map(nm).join(', ');
    if (who) say(s, label + ': ' + who + ' — ' + describeBuff(st.buff) + ' (' + describeDur(st.for) + ').', { type: 'skillBuff', unit: src.id });
    return;
  }
  if (st.status || st.selfStatus) {
    const list = st.selfStatus ? [src] : units(st.who), stt = st.status || st.selfStatus;
    for (const u of list) addBuff(s, u, src, ctx.name || 'skill', { status: stt }, st.for, ctx);
    if (list.length) say(s, label + ': ' + list.map(nm).join(', ') + ' — ' + STATUS_TEXT[stt] + ' (' + describeDur(st.for) + ').', { type: 'skillStatus', unit: src.id });
    return;
  }
  if (st.contest) {
    for (const t of units(st.contest)) {
      const lost = contest(s, src, t, st.aspect);
      say(s, label + ': ' + nm(t) + (lost ? ' loses' : ' wins') + ' the contested Command roll.', { type: 'skillContest', unit: t.id, lost });
      const next = lost ? st.lose : st.win;
      if (next && next.length) runSteps(s, next, { ...ctx, target: t });
    }
    return;
  }
  if (st.push !== undefined) { for (const u of units(st.who)) push(s, src, u, st.push, label); return; }
  if (st.reveal !== undefined) {
    for (const u of live(s)) if (u.hidden && E.hostile(u, src) && E.manhattan(u, src) <= st.reveal) { u.hidden = false; say(s, label + ': ' + nm(u) + ' is revealed.', { type: 'revealed', unit: u.id }); }
    return;
  }
  if (st.fire) {
    for (const [x, y] of (ctx.picks && ctx.picks[st.fire.pick]) || []) E._ignite(s, x, y, label);
    return;
  }
  if (st.resetCooldown) {
    for (const u of units(st.resetCooldown)) { delete fxOf(u).skillLast; if (u.round) u.round.skillUsed = false; say(s, label + ': ' + nm(u) + "'s officer may use their battlefield active again.", { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.swap) {
    const o = units(st.swap)[0];
    if (o && E.manhattan(o, src) === 1) { const p = { x: src.x, y: src.y }; src.x = o.x; src.y = o.y; o.x = p.x; o.y = p.y; say(s, label + ': ' + nm(src) + ' and ' + nm(o) + ' swap places.', { type: 'swap', unit: src.id }); }
    return;
  }
  if (st.reinforce !== undefined) { say(s, label + ' (GM): up to ' + st.reinforce + ' allied unit(s) waiting as reinforcements arrive now, at the map edge nearest ' + nm(src) + '.', { type: 'skillManual', unit: src.id }); return; }
  if (st.extraTurn) {
    const list = units(st.extraTurn);
    for (const u of list) { (s.skillExtra ||= []).push({ unitId: u.id, moveOnly: !!st.moveOnly }); say(s, label + ': ' + nm(u) + ' will take another ' + (st.moveOnly ? 'move' : 'turn') + ' at once.', { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.if) {
    const u = (st.who ? units(st.who)[0] : src) || src;
    return runSteps(s, matches(s, st.if, u, { src, self: u }) ? st.then || [] : st.else || [], ctx) === 'wait' ? 'wait' : undefined;
  }
  if (st.onKill || st.onWin || st.onLose) return; // handled with the attack before them
  if (st.hide) {
    for (const u of units(st.hide)) if (!u.hidden) { u.hidden = true; say(s, label + ': ' + nm(u) + ' slips out of sight.', { type: 'hidden', unit: u.id }); }
    return;
  }
  if (st.fireArea !== undefined) {
    const c = st.from ? fromPoint(s, st.from, ctx) : src; if (!c) return;
    for (let dx = -st.fireArea; dx <= st.fireArea; dx++) for (let dy = -st.fireArea; dy <= st.fireArea; dy++)
      if (Math.abs(dx) + Math.abs(dy) <= st.fireArea && E._inBounds(s, c.x + dx, c.y + dy)) E._ignite(s, c.x + dx, c.y + dy, label);
    return;
  }
  if (st.attack) {
    // follow-ups right after this attack step belong to it
    const after = {}; let skip = 0;
    for (const r of rest) { if (r.onKill || r.onWin || r.onLose) { for (const k of ['onKill', 'onWin', 'onLose']) if (r[k]) after[k] = [...(after[k] || []), ...r[k]]; skip++; } else break; }
    if (ctx.picks) after.picks = ctx.picks;
    const who = units(st.who);
    for (const u of who) {
      addBuff(s, u, src, ctx.name || 'skill', { mods: st.attack.mods, flags: st.attack.flags, target: st.attack.target, after: Object.keys(after).length ? after : undefined }, 'nextAttack', ctx);
      if (u.id === src.id && !ctx.auto) { if (u.round) u.round.attacked = false; }
      else if (!ctx.auto) (s.turn.activation ? (s.turn.activation.skillQueue ||= []) : []).push({ kind: 'attack', unitId: u.id });
    }
    say(s, label + ': ' + who.map(nm).join(', ') + ' — ' + (st.moveFirst ? 'may move ' + st.moveFirst + ' and ' : '') + 'may attack' + (st.attack.mods?.length ? ' (' + describeBuff(st.attack) + ')' : '') + '.', { type: 'skillBuff', unit: src.id });
    if (ctx.auto) { // from a trigger: each unit gets a short extra turn of its own for it, and may pass
      if (!who.length) return;
      return interject(s, who.map(u => [...(st.moveFirst && u.id === src.id ? [{ kind: 'move', unitId: u.id, budget: st.moveFirst, mode: 'any', toward: null }] : []), { kind: 'attack', unitId: u.id }]), rest.slice(skip), ctx);
    }
    if (st.moveFirst) { queueMove(s, src, st.moveFirst, 'any', null); return wait(s, rest.slice(skip), ctx); }
    if (skip) return runSteps(s, rest.slice(skip), ctx) === 'wait' ? 'wait' : 'stop';
    return;
  }
  if (st.move !== undefined) {
    const list = units(st.who);
    const toward = st.toward ? units(st.toward)[0] : null;
    if (ctx.auto) { // from a trigger: a short extra turn for each unit, limited to this move (it may stay)
      if (!list.length) return;
      return interject(s, list.map(u => [{ kind: 'move', unitId: u.id, budget: st.move, mode: st.mode || 'any', toward: toward ? toward.id : null }]), rest, ctx);
    }
    for (const u of list) queueMove(s, u, st.move, st.mode || 'any', toward);
    if (list.length) return wait(s, rest, ctx);
    return;
  }
}
function queueMove(s, u, n, mode, toward) {
  const ac = s.turn && s.turn.activation; if (!ac) return;
  (ac.skillQueue ||= []).push({ kind: 'move', unitId: u.id, budget: n, mode, toward: toward ? toward.id : null });
}
/** Stop here until the queued choices are answered; remember the rest of the steps. */
function wait(s, rest, ctx) {
  const ac = s.turn && s.turn.activation; if (!ac) return;
  ac.skillRun = { rest, ctx: { src: ctx.src.id, target: ctx.target ? ctx.target.id : null, picks: ctx.picks || {}, name: ctx.name } };
  return 'wait';
}
/**
 * A trigger gave units a free move or attack (David, 2026-11-05): instead of making it for them, each unit gets a short
 * extra turn of its own once the current turn is over, limited to what the skill allows; its player (or the AI) makes
 * the move or attack, or passes. The trigger's remaining steps follow the last unit's choice.
 */
function interject(s, perUnit, rest, ctx) {
  const q = (s.skillInterjects ||= []);
  perUnit.forEach((choices, i) => q.push({ unitId: choices[0].unitId, name: ctx.name || 'skill', choices,
    run: i === perUnit.length - 1 && rest.length ? { rest, ctx: { src: ctx.src.id, target: ctx.target ? ctx.target.id : null, picks: ctx.picks || {}, name: ctx.name } } : null }));
  return 'wait';
}
/** Can this choice be made at all (a square to move to, an enemy in reach)? */
export function choiceOpen(s, ch) {
  const u = E.unitById(s, ch.unitId); if (!u || !E.alive(u)) return false;
  return ch.kind === 'move' ? choiceSquares(s, ch).length > 0 : E.attackTargets(s, u).length > 0;
}
/** Drop pending choices nothing can answer (no square, no enemy in reach). */
export function pruneChoices(s) {
  const ac = s.turn && s.turn.activation; if (!ac || !ac.skillQueue) return;
  while (ac.skillQueue.length && !choiceOpen(s, ac.skillQueue[0])) ac.skillQueue.shift();
}

/** The next choice an active is waiting for, if any: { kind: 'move'|'attack', unitId, budget, mode, toward }. */
export function pendingChoice(s) {
  const ac = s.turn && s.turn.activation;
  return ac && ac.skillQueue && ac.skillQueue.length ? ac.skillQueue[0] : null;
}
/** Squares the pending free move may end on (normal movement rules within its budget; "away" must end farther from every enemy). */
export function choiceSquares(s, ch) {
  const u = E.unitById(s, ch.unitId); if (!u) return [];
  const reach = E.reachable(s, u, ch.budget);
  const foes = live(s).filter(o => E.hostile(o, u));
  const near = (p) => Math.min(99, ...foes.map(e => E.manhattan(e, p)));
  const d0 = near(u), tw = ch.toward ? E.unitById(s, ch.toward) : null;
  const out = [];
  for (const k of reach.keys()) {
    const [x, y] = k.split(',').map(Number);
    if (ch.mode === 'away' && !(near({ x, y }) > d0)) continue;
    if (ch.mode === 'toward' && tw && !(E.manhattan({ x, y }, tw) < E.manhattan(u, tw))) continue;
    out.push([x, y]);
  }
  return out;
}
/**
 * Answer the pending choice: { x, y } for a move, { targetId } for another unit's free attack, or { skip: true }.
 * Then carry on with the active's remaining steps. Returns an error string or null.
 */
export function answer(s, a) {
  const ac = s.turn && s.turn.activation, ch = pendingChoice(s);
  if (!ch) return 'Nothing to choose';
  const u = E.unitById(s, ch.unitId);
  if (!a.skip && u) {
    if (ch.kind === 'move') {
      if (!choiceSquares(s, ch).some(([x, y]) => x === a.x && y === a.y)) return 'Pick one of the highlighted squares';
      u.x = a.x; u.y = a.y;
      say(s, nm(u) + ' moves to ' + a.x + ',' + a.y + ' (' + 'battlefield skill).', { type: 'skillMove', unit: u.id });
    } else if (ch.kind === 'attack') {
      const t = E.unitById(s, a.targetId);
      if (!t || !E.hostile(t, u) || !E.rangeOk(s, u, t) || cantAttackReason(s, u, t)) return 'Pick an enemy in reach';
      const had = !!(u.round && u.round.attacked); // a skill's attack doesn't use up the unit's own attack this round
      E.resolveAttack(s, u, t, { movedThisActivation: false, tilesMoved: 0 });
      if (u.round) u.round.attacked = had;
    }
  }
  ac.skillQueue.shift();
  pruneChoices(s);
  if (!ac.skillQueue.length) {
    delete ac.skillQueue;
    const run = ac.skillRun; delete ac.skillRun;
    if (run && run.rest && run.rest.length) {
      const src = E.unitById(s, run.ctx.src);
      if (src) runSteps(s, run.rest, { src, target: run.ctx.target ? E.unitById(s, run.ctx.target) : null, picks: run.ctx.picks, name: run.ctx.name });
    }
  }
  E.settle(s);
  // a skill's short extra turn is over: back to the battle (more of them, or whoever is next)
  if (!pendingChoice(s) && ac.skillOnly && s.turn.activation === ac) { E._endInterject(s); return null; }
  // the turn was waiting on this follow-up after its attack: it ends now
  if (!pendingChoice(s) && ac.skillResume && s.turn.activation === ac) {
    delete ac.skillResume;
    const v = E.unitById(s, ac.unitId);
    if (v && E.alive(v)) E._endAfterAttack(s, v, ac);
  }
  return null;
}

/** Contested Command roll of unit t against src's officer; true = t lost. Units without an officer fail. */
export function contest(s, src, t, aspect) {
  if (!t.officerId) return true;
  const so = E.officerOf(s, src), to = E.officerOf(s, t);
  const asp = (o) => (aspect && o && o.aspects && o.aspects[String(aspect).toLowerCase()]) || 0;
  const a = E.yinYang().value + ((so && so.command) || 0) + asp(so);
  const d = E.yinYang().value + ((to && to.command) || 0) + asp(to) + stat(s, t, 'resist');
  return a >= d;
}

/** Push u n squares straight away from src (the longer axis); stops at anything blocking. */
function push(s, src, u, n, label) {
  if (flag(s, u, 'cantBePushed')) return;
  const dx = u.x - src.x, dy = u.y - src.y;
  const [sx, sy] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const nx = u.x + sx, ny = u.y + sy;
    if (!E._inBounds(s, nx, ny) || !E._passable(s, nx, ny, u) || E.unitAt(s, nx, ny)) break;
    u.x = nx; u.y = ny; moved++;
  }
  if (moved) say(s, label + ': ' + nm(u) + ' is pushed back ' + moved + ' tile' + (moved > 1 ? 's' : '') + '.', { type: 'push', unit: u.id });
}

// ---------------------------------------------------------------- actives
/**
 * Use unit u's battlefield active. a: { picks: { id: [unitId...] | [[x, y]...] } }. Validates the picks
 * (side, range, count, filter) and runs the steps. Returns an error string or null.
 */
export function checkPicks(s, u, a = {}) { const r = readPicks(s, u, a); return typeof r === 'string' ? r : null; }
function readPicks(s, u, a) {
  const sp = specsOf(s, u); const act = sp && sp.active;
  if (!act) return 'No automated battlefield active';
  const picks = {};
  for (const pk of act.pick || []) {
    const chosen = (a.picks && a.picks[pk.id]) || [];
    const max = pk.count || 1;
    if (chosen.length > max) return 'Pick at most ' + max;
    if (!pk.upTo && chosen.length < Math.min(max, pickCandidates(s, u, pk).length)) return 'Pick ' + max + (pk.side === 'tile' ? ' square' : ' unit') + (max > 1 ? 's' : '');
    const ok = pickCandidates(s, u, pk);
    for (const c of chosen) {
      const key = Array.isArray(c) ? c.join(',') : c;
      if (!ok.some(o => (Array.isArray(o) ? o.join(',') : o) === key)) return 'That choice is not allowed';
    }
    picks[pk.id] = chosen;
  }
  return picks;
}
export function useActive(s, u, a = {}) {
  const sp = specsOf(s, u); const act = sp && sp.active;
  const picks = readPicks(s, u, a); if (typeof picks === 'string') return picks;
  if (act.manual && !act.do) say(s, (sp.officer.name || nm(u)) + ' · ' + (sp.activeName || 'active') + ' (GM): ' + act.manual, { type: 'skillManual', unit: u.id });
  else if (act.manual) say(s, (sp.officer.name || nm(u)) + ' · ' + (sp.activeName || 'active') + ' (GM, partly): ' + act.manual, { type: 'skillManual', unit: u.id });
  // an active may also carry passive-like parts while it lasts? (mods/flags at the top of an active apply to his unit this turn)
  if (act.mods || act.flags) addBuff(s, u, u, sp.activeName || 'active', { mods: act.mods, flags: act.flags }, 'thisTurn');
  runSteps(s, act.do || [], { src: u, picks, name: sp.activeName || 'active' });
  return null;
}
/** What a pick may choose: unit ids, or [x, y] squares for tiles. */
export function pickCandidates(s, u, pk) {
  const inRange = (p) => pk.range === 'any' || E.manhattan(u, p) <= pk.range;
  if (pk.side === 'tile') {
    const out = [];
    for (const k of Object.keys(s.map.tiles || {})) {
      const [x, y] = k.split(',').map(Number);
      if (!inRange({ x, y })) continue;
      if (pk.filter && pk.filter.flammable) { const r = E.tileRules(s, x, y); if (!r || !r.flammable || (s.siege && s.siege.fires && s.siege.fires[k])) continue; }
      if (pk.filter && pk.filter.onTerrain && !onTerrain(s, x, y, pk.filter.onTerrain)) continue;
      out.push([x, y]);
    }
    return out;
  }
  return live(s).filter(o => {
    if (o.id === u.id) return pk.side === 'allies' && !!pk.self && matches(s, pk.filter, o, { src: u });
    if ((pk.side === 'allies') !== ally(o, u)) return false;
    if (pk.side === 'enemies' && !E.visibleTo(s, o, E.alliance(u.side))) return false;
    return inRange(o) && matches(s, pk.filter, o, { src: u, self: u });
  }).map(o => o.id);
}

// ---------------------------------------------------------------- words for the log and the UI
const STATUS_TEXT = { cantMove: "can't move", cantAttack: "can't attack", cantMoveOrAttack: "can't move or attack", skipTurn: 'skips its turn',
  moveOrAttack: 'can move or attack, not both', noSkills: "can't use battlefield actives", stripDefenses: 'loses Brace, Hold, Charge Reflection and Anti-Cavalry' };
const STAT_TEXT = { attack: 'Attack', command: 'Command', commandAtk: 'Command when attacking', commandDef: 'Command when defending', meleeDef: 'melee defense',
  rangedDef: 'ranged defense', move: 'movement', range: 'range', armor: 'armor', pen: 'pen', damage: 'damage', resist: 'vs enemy skills',
  moraleLossLess: 'morale lost from lost rolls', checkpointLess: 'morale lost at casualty checkpoints', skillLossLess: 'morale lost to enemy skills',
  anyLossLess: 'morale losses', enemyLoss: 'morale enemies lose to it', enemyLossAtk: 'morale enemies it attacks lose', startMorale: 'starting morale',
  overwatch: 'Overwatch Attack', forcedMarchCost: 'forced march cost', regenCap: 'morale recovery cap' };
const sgn = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
export function describeBuff(b) {
  const parts = [];
  for (const m of b.mods || []) parts.push(STAT_TEXT[m.stat] + ' ' + (['moraleLossLess', 'checkpointLess', 'skillLossLess', 'anyLossLess', 'forcedMarchCost'].includes(m.stat) ? '−' + m.value : m.stat === 'regenCap' ? 'up to ' + m.value : sgn(m.value)));
  for (const f of b.flags || []) parts.push(String(f.flag).replace(/([A-Z])/g, ' $1').toLowerCase());
  if (b.status) parts.push(STATUS_TEXT[b.status]);
  return parts.join(', ');
}
export function describeDur(d) {
  return typeof d === 'object' && d ? (d.rounds === 1 ? 'this turn' : d.rounds + ' turns') : ({ thisTurn: 'this turn', nextAttack: 'its next attack', nextRoll: 'its next roll',
    untilNextTurnEnd: 'until the end of its next turn', untilNextTurnStart: 'until its next turn', battle: 'the rest of the battle' })[d] || '';
}
/** The buffs on a unit, for display: [{ name, text, from }]. */
export function buffsOf(s, u) {
  return (fxOf(u).buffs || []).map(b => ({ name: b.name, text: describeBuff(b), from: E.unitById(s, b.src)?.name || '' }));
}
