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
  trees: ['trees'], forest: ['forest'], mountain: ['mountain'], palisade: ['camp-palisade', 'palisade'], catapult: ['catapult'], boat: ['boat'], road: ['road'],
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
/** Is square (x, y), or one next to it, any of these terrains? */
function nextTo(s, x, y, list) { return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onTerrain(s, x + dx, y + dy, list)); }
const nearWater = (s, u) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onTerrain(s, u.x + dx, u.y + dy, ['water']));

// ---------------------------------------------------------------- filters and conditions
const tierOf = (s, u) => Number(typeOf(s, u).tier) || Number(typeOf(s, u).unitValue) || 1;
const offOf = (s, u) => (u && u.officerId ? E.officerOf(s, u) : null);
const roundNow = (s) => (s.turn && s.turn.round) || 0;
/** Resting morale: 50, Disciplined/+/++/EX 55/60/65/70. */
const restingOf = (u) => 50 + ([0, 5, 10, 15, 20][E.unitTrait(u, 'disciplined')] || 0);
/** Height of a square: hills, mountains, walls and towers stand above the open ground. */
export function heightAt(s, x, y) {
  const t = s.map && s.map.tiles && s.map.tiles[x + ',' + y]; if (!t) return 0;
  const ids = [t.terrain, ...(t.overlays || [])];
  if (ids.some(i => i === 'city-wall' || i === 'fortress-tower' || i === 'watchtower' || i === 'mountain')) return 2;
  return ids.includes('hill') ? 1 : 0;
}
/** From where an attacker comes at the defender: 'rear', 'side' or 'front' (by the defender's facing). */
function attackSide(s, a, d) { return E._isRear(s, a, d) ? 'rear' : E._isFront(s, a, d) ? 'front' : 'side'; }
/** Did unit u do `what` (a memory list in fx: id -> round) on its last turn: this round or the round before? */
const recent = (map, round, back = 1) => !!map && Object.values(map).some(r => r >= round - back);
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
      case 'cooldownDone': { // its officer's battlefield active is off cooldown (2026-11-09: Readied only when a cut brings it to 0)
        const o = u.officerId ? E.officerOf(s, u) : null, n = Number(o?.skill?.recharge) || 0, last = fxOf(u).skillLast, r = (s.turn && s.turn.round) || 0;
        if ((last == null || !n || r >= last + n) !== !!v) return false; break; }
      case 'officerType': { const o = u.officerId ? E.officerOf(s, u) : null; if (!o || String(o.ctype || '').toLowerCase() !== String(v).toLowerCase()) return false; break; }
      case 'onTerrain': if (!onTerrain(s, u.x, u.y, v)) return false; break;
      case 'nearWater': if (nearWater(s, u) !== !!v) return false; break;
      case 'hidden': if (!!u.hidden !== !!v) return false; break;
      case 'notActed': if (!!(u.round && u.round.activated) === !!v) return false; break;
      case 'acted': if (!!(u.round && u.round.activated) !== !!v) return false; break;
      // it is this unit's own turn (its activation, or the settle right after it ends) — Lu Bu's extra turns (David, 2026-11-09)
      case 'myTurn': { const t = s.turn || {}; const mine = !!(t.activation && t.activation.unitId === u.id) || t.endingUnit === u.id; if (mine !== !!v) return false; break; }
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
      // v3: what happened earlier in the battle (fx memory, kept by skills.mjs)
      case 'not': if (matches(s, v, u, ctx)) return false; break;
      case 'ownSide': if (!(ctx.src && u.side === ctx.src.side) === !!v) return false; break; // his own side (not an allied side)
      case 'homeDistrict': { const o = u.officerId ? E.officerOf(s, u) : null; if (!!(o && o.homeDistrict) !== !!v) return false; break; } // fighting in his own district (from the world map)
      case 'nextToTerrain': if (!nextTo(s, u.x, u.y, v)) return false; break; // on or next to such ground
      case 'impassableAdjacent': if ([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !E._passable(s, u.x + dx, u.y + dy, u)).length < Number(v)) return false; break;
      case 'carrying': if ((u.carry || null) !== v) return false; break;
      case 'onCatapult': if (!onTerrain(s, u.x, u.y, ['catapult']) === !!v) return false; break;
      case 'arrivedAsReinforcement': if (!!fxOf(u).reinforced !== !!v) return false; break;
      case 'attackedSinceItsTurn': { const atk = fxOf(u).skAttackers || {}, since = fxOf(u).lastActRound ?? -1; // attacked by anyone since its own last turn
        if (Object.values(atk).some(r => r >= since) !== !!v) return false; break; }
      case 'nearPick': { const p = ((ctx.picks || {})[v.pick] || []).map(c => Array.isArray(c) ? { x: c[0], y: c[1] } : E.unitById(s, c)).filter(Boolean);
        if (!p.some(q => q.id !== u.id && E.manhattan(q, u) <= (v.range ?? 1))) return false; break; }
      case 'adjacentToSource': if (!(ctx.src && E.manhattan(u, ctx.src) === 1) === !!v) return false; break;
      case 'wonLastMelee': if (!!(fxOf(u).lastMelee && fxOf(u).lastMelee.won) !== !!v || !fxOf(u).lastMelee) return false; break;
      case 'lostLastMelee': if (!!(fxOf(u).lastMelee && !fxOf(u).lastMelee.won) !== !!v || !fxOf(u).lastMelee) return false; break;
      case 'attackedAllyLastTurn': { // it attacked one of the officer's side (within N of his unit, if a number) this round or last
        const src = ctx.src, hit = fxOf(u).hitUnits || {}, r0 = roundNow(s);
        const ok = Object.entries(hit).some(([id, r]) => { const x = E.unitById(s, id); return r >= r0 - 1 && x && src && ally(x, src) && (v === true || E.manhattan(x, src) <= Number(v)); });
        if (ok !== !!v) return false; break;
      }
      case 'beatAllyLastTurn': {
        const src = ctx.src, beat = fxOf(u).beat || {}, r0 = roundNow(s);
        if (!Object.entries(beat).some(([id, r]) => { const x = E.unitById(s, id); return r >= r0 - 1 && x && src && ally(x, src); })) return false; break;
      }
      case 'attackedSourceRecently': { const src = ctx.src; const r = src && (fxOf(src).skAttackers || {})[u.id]; if (!(r != null && r >= roundNow(s) - 1) === !!v) return false; break; }
      case 'attackedBySource': { // his unit attacked it this round (0) or since its last turn (1)
        const src = ctx.src, r = src && (fxOf(src).hitUnits || {})[u.id];
        if (!(r != null && r >= roundNow(s) - (v === true ? 0 : Number(v)))) return false; break;
      }
      case 'lostAttackRecently': if (!((fxOf(u).lostAtk ?? -9) >= roundNow(s) - 1) === !!v) return false; break;
      case 'moraleLostAtLeast': if ((fxOf(u).mLost || 0) < Number(v)) return false; break;
      case 'moraleLostThisRound': if (!(fxOf(u).mLostRound && fxOf(u).mLostRound.round === roundNow(s) && fxOf(u).mLostRound.n > 0) === !!v) return false; break;
      case 'movedThisBattle': if (!!fxOf(u).movedEver !== !!v) return false; break;
      case 'movedLastTurn': if (!!fxOf(u).movedLast !== !!v) return false; break;
      case 'adjacentAtTurnStart': { const me = ctx.self || ctx.src; const was = !!(me && (fxOf(me).adjStart || []).includes(u.id)); if (was !== !!v) return false; break; }
      case 'startedOn': { const p = fxOf(u).startPos; if (!p || !onTerrain(s, p.x, p.y, v)) return false; break; }
      case 'startedNearWater': { const p = fxOf(u).startPos; if (!p || ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onTerrain(s, p.x + dx, p.y + dy, ['water'])) === !!v) return false; break; }
      case 'belowResting': if (((u.morale ?? 50) < restingOf(u)) !== !!v) return false; break;
      case 'fullMorale': if (((u.morale ?? 50) >= 100) !== !!v) return false; break;
      case 'firstAttackTaken': if (!!fxOf(u).firstTaken === !!v) return false; break; // no attack made on it yet this battle
      case 'unitTier': { const tt = tierOf(s, u); if (Array.isArray(v) ? !v.includes(tt) : tt !== Number(v)) return false; break; }
      case 'unitFaction': { const fac = String(t.faction || '').toLowerCase(); if (!(Array.isArray(v) ? v : [v]).some(x => fac.includes(String(x).toLowerCase()))) return false; break; }
      // v3: the officer leading it, compared with his (ctx.src's officer; vs: the roll's own unit)
      case 'officerRank': case 'officerTier': {
        const me = offOf(s, ctx.self && ctx.self.id !== u.id ? ctx.self : ctx.src), o = offOf(s, u); if (!o || !me) return false;
        const a = k === 'officerRank' ? (o.rank || 1) : -(o.tier ?? 9), b = k === 'officerRank' ? (me.rank || 1) : -(me.tier ?? 9); // tier 0 is the highest
        if (v === 'above' ? !(a > b) : v === 'below' ? !(a < b) : !(a >= Number(v))) return false; break;
      }
      case 'aspectAbove': { const me = offOf(s, ctx.self && ctx.self.id !== u.id ? ctx.self : ctx.src), o = offOf(s, u); if (!o || !me) return false;
        const val = (x) => (v === 'command' ? x.command : (x.aspects || {})[v]) || 0; if (!(val(o) > val(me))) return false; break; }
      case 'ledByFactionLeader': { const me = offOf(s, ctx.src), o = offOf(s, u);
        const ok = !!(o && o.ruler && (!me || !me.faction || !o.faction || me.faction === o.faction) && u.id !== (ctx.src && ctx.src.id)); if (ok !== !!v) return false; break; }
      case 'sameFamily': { const me = offOf(s, ctx.src), o = offOf(s, u); if (!(o && me && o.family && o.family === me.family && u.id !== ctx.src.id) === !!v) return false; break; }
      // v3: other allied units around it that match a filter
      case 'allyAdjacentWhere': if (!live(s).some(o => o.id !== u.id && ally(o, u) && E.manhattan(o, u) === 1 && matches(s, v, o, ctx))) return false; break;
      case 'allyWithinWhere': if (!live(s).some(o => o.id !== u.id && ally(o, u) && E.manhattan(o, u) <= Number(v.range) && matches(s, v.filter, o, ctx))) return false; break;
      case 'noAllyWithin': if (live(s).some(o => o.id !== u.id && ally(o, u) && E.manhattan(o, u) <= Number(v))) return false; break;
      // v3: how the attack comes (conditions on a roll)
      case 'attackFrom': { if (ctx.attackSide) { if (![].concat(v).includes(ctx.attackSide)) return false; break; }
        const a = ctx.role === 'attacker' ? u : ctx.attackerUnit, d = ctx.role === 'attacker' ? ctx.other : u;
        if (!a || !d || !(Array.isArray(v) ? v : [v]).includes(attackSide(s, a, d))) return false; break; }
      case 'fromHiding': if (!!ctx.ambush !== !!v) return false; break;
      case 'higherGround': { const o = ctx.other; if (!o) return false; if ((heightAt(s, u.x, u.y) > heightAt(s, o.x, o.y)) !== !!v) return false; break; }
      case 'lowerGround': { const o = ctx.other; if (!o) return false; if ((heightAt(s, u.x, u.y) < heightAt(s, o.x, o.y)) !== !!v) return false; break; }
      case 'fallKind': if (!(Array.isArray(v) ? v : [v]).includes(ctx.fallKind)) return false; break;
      case 'byAllyWithin': { const by = ctx.by; if (!by || !ctx.src || !ally(by, ctx.src) || E.manhattan(by, ctx.src) > Number(v)) return false; break; }
      case 'allyFallenThisBattle': if (!!((s.skFallen || {})[E.alliance(u.side)]) !== !!v) return false; break;
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
    if (p && p[kind] && !(X.id !== u.id && ally(X, u) && cutOff(u, X)))
      for (const e of p[kind]) if (whoIncludes(s, e.who, X, u)) out.push({ entry: e, src: X, name: sp.passiveName || 'passive', ext: {} });
  }
  const acts = fxOf(u).acts || 0;
  for (const b of fxOf(u).buffs || []) {
    if (b.until.from && acts < b.until.from) continue; // "its next turn": not yet
    const src = E.unitById(s, b.src) || u;
    if (src.id !== u.id && ally(src, u) && b.status !== 'isolated' && cutOff(u, src)) continue; // cut off from allied help
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
  const rc = { role, ranged: !!ctx.ranged, charge: !!ctx.charge, overwatch: !!ctx.overwatch, tilesMoved: ctx.tilesMoved, self: u, other, ambush: !!ctx.ambush && role === 'attacker', attackerUnit: ctx.attacker };
  const parts = [];
  for (const { entry: m, src, name, buff, ext } of reaching(s, u, 'mods')) {
    const when = ROLL_STATS[m.stat]; if (!when || !when(rc)) continue;
    if (!matches(s, m.if, u, { ...rc, ...ext, src })) continue;
    if (m.vs && (!other || !matches(s, m.vs, other, { ...rc, ...ext, self: u, src }))) continue;
    const who = E.officerOf(s, src);
    const val = (Number(m.value) || 0) * perOf(src, m); if (!val) continue;
    parts.push([(who ? who.name + ' · ' : '') + name + ': ' + STAT_LABEL[m.stat] + (m.per ? ' (×' + perOf(src, m) / 1 + ')' : ''), val]);
  }
  return parts;
}

/**
 * The always-on roll changes reaching unit u from officers' battlefield skills (buffs, its own officer's passive, other
 * officers' auras), for the stand's icons (David, 2026-11-09): only mods with no condition (no `if`, no `vs`); the
 * conditional ones show on the sword icon during the attack they apply to. { command, attack, meleeDef, rangedDef }.
 */
export function alwaysOnRolls(s, u) {
  const r = { command: 0, attack: 0, meleeDef: 0, rangedDef: 0 };
  for (const { entry: m, src } of reaching(s, u, 'mods')) {
    if (m.if || m.vs) continue;
    const v = (Number(m.value) || 0) * perOf(src, m); if (!v) continue;
    if (m.stat === 'command') r.command += v;
    else if (m.stat === 'attack' || m.stat === 'commandAtk') r.attack += v;
    else if (m.stat === 'commandDef') { r.meleeDef += v; r.rangedDef += v; }
    else if (m.stat === 'meleeDef') r.meleeDef += v;
    else if (m.stat === 'rangedDef') r.rangedDef += v;
  }
  return r;
}

/** "per" on a mod: its value counts once for each point of a counter on the officer's unit (capped by max). */
function perOf(src, m) {
  if (!m.per) return 1;
  const f = fxOf(src), n = m.per === 'routs' ? (f.routs || 0) : ((f.counters || {})[m.per] || 0);
  return m.max != null ? Math.min(n, Number(m.max)) : n;
}
/** Sum of a non-roll stat on unit u (move, range, armor, pen, damage, moraleLossLess...). regenCap: the highest. */
export function stat(s, u, name, ctx = {}) {
  let v = 0, cap = 0;
  for (const { entry: m, src, ext } of reaching(s, u, 'mods')) {
    if (m.stat !== name) continue;
    if (!matches(s, m.if, u, { ...ctx, ...ext, src, self: u })) continue;
    if (m.vs && (!ctx.other || !matches(s, m.vs, ctx.other, { ...ctx, ...ext, self: u, src }))) continue;
    const val = (Number(m.value) || 0) * perOf(src, m);
    if (name === 'regenCap') cap = Math.max(cap, val); else v += val;
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
    if (name === 'ignoreTerrainCost' || name === 'stopOn' || name === 'ignoreTraits') best = [...(best || []), ...arg.split(',')];
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
    : dur === 'nextAttack' ? { kind: 'attack' } : dur === 'nextRoll' ? { kind: 'roll' }
    : dur === 'untilSourceTurnStart' ? { kind: 'srcStart', src: src.id, acts: (fxOf(src).acts || 0) + 1 }
    : dur === 'untilSourceTurnEnd' ? { kind: 'srcEnd', src: src.id, acts: (fxOf(src).acts || 0) + 1 }
    : dur === 'nextContest' ? { kind: 'contest' } : dur === 'nextSkill' ? { kind: 'skill' } : { kind: 'battle' };
  const b = { id: 'b' + (++buffSeq) + '.' + round, name, src: src.id, until };
  if (mods && mods.length) b.mods = mods.map(m => ({ ...m, who: undefined }));
  if (flags && flags.length) b.flags = flags.map(f => ({ ...f, who: undefined }));
  if (triggers && triggers.length) b.triggers = triggers;
  if (arguments[4].traits) b.traits = arguments[4].traits;           // { name: tier } granted
  if (arguments[4].removeTraits) b.removeTraits = arguments[4].removeTraits; // [names] taken away
  if (arguments[4].after && arguments[4].after.endSteps) b.endSteps = arguments[4].after.endSteps;
  if (arguments[4].endSteps) b.endSteps = arguments[4].endSteps;     // steps when it ends ("when the 2 turns end, it loses 10 morale")
  if (target) b.targetFilter = target;
  if (st) b.status = st;
  if (after) b.after = after;
  if (ctx.picks && Object.keys(ctx.picks).length) b.picks = ctx.picks;
  if (ctx.target) b.target = ctx.target.id;
  (fxOf(u).buffs ||= []).push(b);
  return b;
}
let endQueue = [];
function dropBuffs(u, test) {
  const f = fxOf(u); if (!f.buffs) return;
  const gone = f.buffs.filter(b => test(b));
  if (!gone.length) return;
  f.buffs = f.buffs.filter(b => !test(b)); if (!f.buffs.length) delete f.buffs;
  for (const b of gone) if (b.endSteps) endQueue.push({ u, b });
}
/** Steps buffs run when they end (queued by dropBuffs, run here so they never run mid-loop). */
function runEndSteps(s) {
  while (endQueue.length) {
    const { u, b } = endQueue.shift();
    if (!E.alive(u)) continue;
    const src = E.unitById(s, b.src) || u;
    runSteps(s, b.endSteps, { src, target: u, picks: b.picks || {}, name: b.name, auto: true });
  }
}

/** Engine hook: a unit starts an activation. Returns 'skip' if a status makes it skip the turn. */
export function onActivationStart(s, u) {
  const f = fxOf(u); f.acts = (f.acts || 0) + 1;
  dropBuffs(u, b => b.until.kind === 'actStart' && f.acts >= b.until.acts);
  for (const o of s.units || []) dropBuffs(o, b => b.until.kind === 'srcStart' && b.until.src === u.id && f.acts >= b.until.acts);
  f.startPos = { x: u.x, y: u.y };
  f.adjStart = live(s).filter(o => o.id !== u.id && E.manhattan(o, u) === 1).map(o => o.id);
  runEndSteps(s);
  revealSweep(s);
  if (status(s, u, 'skipTurn')) { dropBuffs(u, b => b.status === 'skipTurn'); return 'skip'; }
  if (status(s, u, 'cantMove') && !flag(s, u, 'ignoreMoveLimits')) u.round.cannotMove = true;
  event(s, 'turnStart', u);
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'alliesTurnStart' : 'enemyTurnStart', X, { target: u });
  return null;
}
/** Engine hook: a unit's activation ends. */
export function onActivationEnd(s, u) {
  const f = fxOf(u);
  f.skAttackedLast = !!(u.round && u.round.attacked);
  f.movedLast = !!(u.round && u.round.moved); if (f.movedLast) f.movedEver = true;
  f.lastActRound = roundNow(s);
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'allyTurnEnd' : 'enemyTurnEnd', X, { target: u });
  event(s, 'turnEnd', u);
  for (const X of live(s)) if (E.hostile(X, u) && E.manhattan(X, u) === 1) event(s, 'enemyEndsAdjacent', X, { target: u });
  dropBuffs(u, b => b.until.kind === 'actEnd' && (f.acts || 0) >= b.until.acts);
  for (const o of s.units || []) dropBuffs(o, b => b.until.kind === 'srcEnd' && b.until.src === u.id && (f.acts || 0) >= b.until.acts);
  runEndSteps(s);
  revealSweep(s); moraleSweep(s);
}
/** Engine hook: the round has ended (before the next starts). */
export function onRoundEnd(s) {
  for (const X of live(s)) event(s, 'roundEnd', X);
  const round = (s.turn && s.turn.round) || 0;
  for (const g of (s.siege && s.siege.gates) || []) if (g.skillCloseRound != null && round >= g.skillCloseRound) {
    delete g.skillCloseRound; delete g.skillOneSide; if (g.state === 'open') { g.state = 'locked'; say(s, 'A gate opened by a battlefield skill swings shut.', { type: 'gate', gate: g.id, state: 'locked' }); } }
  for (const [k, o] of Object.entries(s.tileOverrides || {})) if (o.until != null && round >= o.until) { // a temporary tile change wears off
    s.map.tiles = { ...s.map.tiles, [k]: o.before }; delete s.tileOverrides[k]; say(s, 'The tile at ' + k + ' is back to what it was.', { type: 'terrain', x: +k.split(',')[0], y: +k.split(',')[1] });
  }
  for (const u of s.units || []) dropBuffs(u, b => b.until.kind === 'round' && round >= b.until.round);
  runEndSteps(s);
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
  for (const k of ['buffs', 'acts', 'skUsed', 'skBelowHalf', 'skAttackers', 'skAttackedLast', 'skillLast', 'rerollRound', 'lastMelee', 'hitUnits', 'beat',
    'lostAtk', 'mLost', 'mLostRound', 'mPrev', 'movedEver', 'movedLast', 'adjStart', 'startPos', 'firstTaken', 'routs', 'stacks', 'cdCut', 'skillTax']) delete u.fx[k];
}
/** Engine hook: an attack was resolved (before settle). res: the engine's attack result. */
export function onAttack(s, attacker, defender, res) {
  const round = (s.turn && s.turn.round) || 0;
  (fxOf(defender).skAttackers ||= {})[attacker.id] = round;
  (fxOf(attacker).hitUnits ||= {})[defender.id] = round;
  fxOf(defender).firstTaken = true;
  if (res.winner) {
    const w = res.winner === 'attacker' ? attacker : defender, l = w === attacker ? defender : attacker;
    (fxOf(w).beat ||= {})[l.id] = round;
    if (l === attacker) fxOf(attacker).lostAtk = round;
    if (!res.ranged) { fxOf(w).lastMelee = { won: true, round }; fxOf(l).lastMelee = { won: false, round }; }
  }
  if (res.killedBy === attacker.id) fxOf(attacker).routs = (fxOf(attacker).routs || 0) + 1;
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
  // Sweep (Guan Yu, David 2026-11-09): whenever it attacks, every other enemy unit in the 3x3 square around it takes N
  // casualties, ignoring armor and evasion (Colossal still caps a hit at 1). The unit it attacked is not swept. Casualty
  // checkpoints cost morale as usual, and its "enemies it damages lose more morale" counts on each
  const sw = Number(flag(s, attacker, 'sweep', { role: 'attacker', ranged: !!res.ranged, other: defender })) || 0;
  if (sw > 0) for (const b of live(s)) {
    if (b.id === attacker.id || b.id === defender.id || !E.hostile(b, attacker) || Math.max(Math.abs(b.x - attacker.x), Math.abs(b.y - attacker.y)) !== 1 || b.men <= 0) continue;
    const c = Math.min(E.unitTrait(b, 'colossal') ? 1 : sw, b.men); if (!c) continue;
    b.men -= c; fxOf(b).lastHitBy = attacker.id;
    const extra = (Number(stat(s, attacker, 'enemyLoss')) || 0) + (Number(flag(s, attacker, 'sweepMorale')) || 0);
    const ml = E.checkpointMorale(b) + extra;
    if (ml) b.morale = Math.max(0, (b.morale || 0) - ml);
    say(s, 'Sweep (battlefield skill): ' + b.name + ' takes ' + c + ' casualties' + (ml ? ' and loses ' + ml + ' morale' : '') + '.', { type: 'sweep', unit: b.id, by: attacker.id, casualties: c, morale: ml });
  }
  const killed = res.killedBy === attacker.id;
  const won = res.winner === 'attacker', lost = res.winner === 'defender';
  const side = attackSide(s, attacker, defender);
  if (E.alive(defender) && defender.men > 0) event(s, 'attacked', defender, { target: attacker, attackSide: side, ranged: !!res.ranged });
  if (res.winner) {
    const w = won ? attacker : defender, l = won ? defender : attacker;
    event(s, 'win', w, { target: l }); event(s, 'lose', l, { target: w });
    event(s, won ? 'attackWin' : 'defendWin', w, { target: l });
    for (const X of live(s)) if (X.id !== w.id && ally(X, w)) event(s, 'allyWins', X, { target: w });
  }
  if (killed) event(s, 'kill', attacker, { target: defender, fallKind: defender.men <= 0 ? 'destroyed' : 'surrendered' });
  for (const b of used) if (b.after) {
    const src = E.unitById(s, b.src) || attacker;
    const steps = [...(killed ? b.after.onKill || [] : []), ...(won ? b.after.onWin || [] : []), ...(lost ? b.after.onLose || [] : []), ...(b.after.then || [])];
    if (steps.length) runSteps(s, steps, { src, target: defender, picks: b.after.picks || {}, name: b.name, auto: !activeIs(s, src) });
  }
  moraleSweep(s);
}
const activeIs = (s, u) => !!(s.turn && s.turn.activation && s.turn.activation.unitId === u.id);
/** Engine hook: a unit routed, surrendered or was destroyed. */
export function onFall(s, u) {
  const kind = u.men <= 0 ? 'destroyed' : u.status === 'escaped' || u.status === 'routed' ? 'routed' : 'surrendered';
  (s.skFallen ||= {})[E.alliance(u.side)] = true;
  // who brought it down: the last unit to attack it
  const atk = fxOf(u).skAttackers || {}; let by = null, br = -1;
  for (const [id, r] of Object.entries(atk)) if (r >= br) { br = r; by = E.unitById(s, id); }
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'allyFalls' : 'enemyFalls', X, { target: u, fallKind: kind, by });
}
/** After every settle: morale lost this battle and this round (for "has lost N morale" skills), and the first drop below half. */
export function onSettle(s) {
  const r = roundNow(s);
  for (const u of s.units || []) {
    const f = fxOf(u), m = u.morale ?? 50;
    if (f.mPrev != null && m < f.mPrev) {
      f.mLost = (f.mLost || 0) + (f.mPrev - m);
      if (!f.mLostRound || f.mLostRound.round !== r) f.mLostRound = { round: r, n: 0 };
      f.mLostRound.n += f.mPrev - m;
    }
    f.mPrev = m;
    if (u.round && u.round.moved) f.movedEver = true;
  }
  moraleSweep(s);
  capRound(s);
}
/** Engine hook: a unit has moved (any normal move). Others may react to it. */
export function onMoved(s, u, from) {
  rideThrough(s, u, from);
  for (const X of live(s)) if (X.id !== u.id) event(s, ally(X, u) ? 'allyMoves' : 'enemyMoves', X, { target: u, from });
}
/** Engine hook: a duel ended. outcome: 'won' | 'lost' | 'refused' | 'slew' | 'fell' for each side. */
export function onDuel(s, u, outcome, other) {
  if (!u || !E.alive(u)) { /* an officerless unit still hears about it */ }
  const ev = { won: 'duelWin', slew: 'duelWin', lost: 'duelLose', fell: 'duelLose', refused: 'duelRefused' }[outcome];
  if (!ev || !u) return;
  if (E.alive(u)) event(s, ev, u, { target: other });
  if (ev === 'duelWin') for (const X of live(s)) if (X.id !== u.id && ally(X, u)) event(s, 'allyDuelWin', X, { target: u });
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
    for (const u of live(s)) if (u.hidden && E.hostile(u, X) && E.manhattan(u, X) <= Number(n) && !flag(s, u, 'noRevealBySkills')) { u.hidden = false; say(s, u.name + ' is spotted by ' + X.name + ' (battlefield skill).', { type: 'revealed', unit: u.id }); }
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
    if (b.status === 'cantAttackNearSource') { const x = E.unitById(s, b.src); if (x && (d.id === x.id || E.manhattan(d, x) === 1)) return "It can't attack that unit or the units next to it (battlefield skill)"; }
    if (b.targetFilter && b.until.kind === 'attack') {
      const src = E.unitById(s, b.src) || u;
      if (!matches(s, b.targetFilter, d, { src, self: u, picks: b.picks || {}, target: b.target ? E.unitById(s, b.target) : null })) return 'The skill attack must target another unit';
    }
  }
  if (flag(s, d, 'untargetable')) return "That unit can't be attacked (battlefield skill)";
  return null;
}

// ---------------------------------------------------------------- triggers
const RANGED_EVENTS = { alliesTurnStart: 99, enemyTurnStart: 99, enemyEndsAdjacent: 1, allyFalls: 3, enemyFalls: 99, allyWins: 99,
  enemyMoves: 1, allyMoves: 99, allyTurnEnd: 99, enemyTurnEnd: 99, allyDuelWin: 99 };
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
    const tc = { src: X, self: X, target: ctx.target, picks: L.picks, fallKind: ctx.fallKind, by: ctx.by, attackSide: ctx.attackSide, kindOverride: ctx.ranged };
    if (t.if && !matches(s, t.if, X, tc)) return;
    if (t.targetIf && !(ctx.target && matches(s, t.targetIf, ctx.target, tc))) return;
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
      if (st.morale > 0) { const b = u.morale; u.morale = Math.min(st.upToResting ? Math.max(b, restingOf(u)) : 100, (u.morale ?? 50) + st.morale); if (u.morale !== b) say(s, label + ': ' + nm(u) + ' regains ' + (u.morale - b) + ' morale.', { type: 'skillMorale', unit: u.id }); }
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
    for (const u of list) { const b = addBuff(s, u, src, ctx.name || 'skill', { status: stt }, st.for, ctx); if (st.from) b.isoFrom = units(st.from).filter(o => o.id !== u.id).map(o => o.id); }
    if (list.length) say(s, label + ': ' + list.map(nm).join(', ') + ' — ' + STATUS_TEXT[stt] + ' (' + describeDur(st.for) + ').', { type: 'skillStatus', unit: src.id });
    return;
  }
  if (st.contest) {
    for (const t of units(st.contest)) {
      const lost = contest(s, src, t, st.aspect);
      say(s, label + ': ' + nm(t) + (!t.officerId ? ' has no officer to resist.' : (lost ? ' loses' : ' wins') + ' the contested Command roll.'), { type: 'skillContest', unit: t.id, lost });
      const next = lost ? st.lose : st.win;
      if (next && next.length) runSteps(s, next, { ...ctx, target: t });
    }
    return;
  }
  if (st.push !== undefined) {
    for (const u of units(st.who)) {
      const from = { x: u.x, y: u.y };
      const moved = push(s, src, u, st.push, label);
      if (!moved && st.ifBlocked) runSteps(s, st.ifBlocked, { ...ctx, target: u, auto: true });
      if (moved && st.thenAdvance && E.manhattan(src, from) === 1 && !E.unitAt(s, from.x, from.y)) { src.x = from.x; src.y = from.y; say(s, label + ': ' + nm(src) + ' advances into the tile.', { type: 'skillMove', unit: src.id }); }
    }
    return;
  }
  if (st.revealPick !== undefined) { // the GM (or the AI, when this side is AI-run) picks hidden enemy units to reveal (David, 2026-11-09)
    const n = st.revealPick === true ? 1 : Math.max(1, Number(st.revealPick) || 1);
    if (!revealCandidates(s, src).length) { say(s, label + ': no hidden enemy unit to reveal.', { type: 'skillManual', unit: src.id }); return; }
    (s.revealPicks ||= []).push({ id: 'rp' + (s.revealPicks.length + 1) + '-' + src.id, src: src.id, side: src.side, left: n, label });
    say(s, label + ': a hidden enemy unit will be revealed (' + (n > 1 ? n + ' units, ' : '') + 'picked by the GM, or by the AI for an AI side).', { type: 'skillManual', unit: src.id });
    return;
  }
  if (st.reveal !== undefined) {
    for (const u of live(s)) if (u.hidden && E.hostile(u, src) && E.manhattan(u, src) <= st.reveal && !flag(s, u, 'noRevealBySkills')) { u.hidden = false; say(s, label + ': ' + nm(u) + ' is revealed.', { type: 'revealed', unit: u.id }); }
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
  if (st.cleanse) { // enemy battlefield-skill effects on these units end
    for (const u of units(st.cleanse)) { const before = (fxOf(u).buffs || []).length;
      dropBuffs(u, b => { const x = E.unitById(s, b.src); return x && E.hostile(x, u) && (!st.only || st.only.includes(b.status)); });
      if ((fxOf(u).buffs || []).length < before) say(s, label + ': the enemy\'s hold on ' + nm(u) + ' is broken.', { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.swapUnits) { // two units trade places
    const a = units(st.swapUnits)[0], b = units(st.with)[0];
    if (a && b && a.id !== b.id) { const p = { x: a.x, y: a.y }; a.x = b.x; a.y = b.y; b.x = p.x; b.y = p.y; say(s, label + ': ' + nm(a) + ' and ' + nm(b) + ' swap places.', { type: 'swap', unit: a.id }); }
    return;
  }
  if (st.climb) { // onto a wall square next to it, with no ladder
    const tiles = (ctx.picks && ctx.picks[st.climb.pick]) || [];
    for (const [x, y] of tiles) if (!E.unitAt(s, x, y) && E.manhattan({ x, y }, src) === 1) { const from = { x: src.x, y: src.y }; src.x = x; src.y = y; say(s, label + ': ' + nm(src) + ' climbs onto the wall.', { type: 'climb', unit: src.id }); onMoved(s, src, from); break; }
    return;
  }
  if (st.counter) { // a running count on his unit ("each turn it doesn't move: +1, up to +4")
    const c = (fxOf(src).counters ||= {}); const before = c[st.counter] || 0;
    c[st.counter] = st.set !== undefined ? st.set : Math.min(st.max ?? 99, before + (st.add ?? 1));
    if (c[st.counter] !== before) say(s, label + ': ' + c[st.counter] + (st.max ? '/' + st.max : '') + '.', { type: 'skillCounter', unit: src.id });
    return;
  }
  if (st.forceToward) { // it moves at once as far as it can toward a point (the picked tile or unit, the target, his unit)
    const pt = st.forceToward.source ? src : fromPoint(s, st.forceToward, ctx); if (!pt) return;
    for (const u of units(st.who)) {
      const reach = E.reachable(s, u, E.movementOf(s, u)); let best = null;
      for (const k of reach.keys()) { const [x, y] = k.split(',').map(Number); const d = E.manhattan({ x, y }, pt); if (!best || d < best.d) best = { x, y, d }; }
      if (best && best.d < E.manhattan(u, pt)) { const from = { x: u.x, y: u.y }; u.x = best.x; u.y = best.y; say(s, label + ': ' + nm(u) + ' is drawn toward ' + (pt.name || 'the bait') + '.', { type: 'skillMove', unit: u.id }); onMoved(s, u, from); }
    }
    return;
  }
  if (st.forceAttack) { // one unit attacks another at once (neither strikes back)
    const att = units(st.forceAttack)[0]; const def = st.at ? units(st.at).find(d => d.id !== (att && att.id)) : null;
    if (att && def && E.alive(att) && E.alive(def)) { say(s, label + ': ' + nm(att) + ' turns on ' + nm(def) + '!', { type: 'skill', unit: att.id }); E.resolveAttack(s, att, def, { free: true, noTactics: true, forced: true }); }
    return;
  }
  if (st.moveInto) { // his unit steps into the square the ally left, if it can reach it
    const v = ctx.vacated; if (!v || E.unitAt(s, v.x, v.y)) return;
    const reach = E.reachable(s, src, Math.max(1, E.movementOf(s, src)));
    if (reach.has(v.x + ',' + v.y)) { const from = { x: src.x, y: src.y }; src.x = v.x; src.y = v.y; say(s, label + ': ' + nm(src) + ' moves into the square it left.', { type: 'skillMove', unit: src.id }); onMoved(s, src, from); }
    else say(s, label + ': ' + nm(src) + " can't reach the square it left.", { type: 'skill', unit: src.id });
    return;
  }
  if (st.splitMorale) { // the player (or AI) shares out morale among the picked units
    const list = units(st.who).map(u => u.id); if (!list.length) return;
    const ac = s.turn && s.turn.activation;
    if (ctx.auto || !ac) { let left = st.splitMorale; for (const u of units(st.who).sort((a, b) => a.morale - b.morale)) { const n = Math.min(st.max || left, left, 100 - u.morale); if (n > 0) { u.morale += n; left -= n; say(s, label + ': ' + nm(u) + ' regains ' + n + ' morale.', { type: 'skillMorale', unit: u.id }); } } return; }
    (ac.skillQueue ||= []).push({ kind: 'split', unitId: src.id, units: list, total: st.splitMorale, max: st.max || st.splitMorale });
    return wait(s, rest, ctx);
  }
  if (st.blast) { // where his unit stops: fire on the flammable squares around it; enemies next to it hit hard; his unit pays half
    const dmg = Number(typeOf(s, src).damage) || 0, pen = Number(typeOf(s, src).armorPen) || 0;
    if (st.fire !== false) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const x = src.x + dx, y = src.y + dy; if (E._inBounds(s, x, y)) E._ignite(s, x, y, label); }
    for (const e of live(s).filter(o => E.hostile(o, src) && E.manhattan(o, src) === 1)) {
      const c = Math.min(e.men, E.casualtiesOf(dmg, Number(typeOf(s, e).armor) || 0, pen, 0, 0)); e.men -= c;
      if (st.moraleLoss) loseMorale(s, e, st.moraleLoss, src);
      say(s, label + ': ' + nm(e) + ' takes ' + c + ' casualties' + (st.moraleLoss ? ' and loses ' + st.moraleLoss + ' morale' : '') + '.', { type: 'skillCasualties', unit: e.id, casualties: c });
    }
    if (st.selfHalf) { const c = Math.min(src.men, Math.ceil(dmg / 2)); src.men -= c; say(s, label + ': ' + nm(src) + ' takes ' + c + ' casualties.', { type: 'skillCasualties', unit: src.id, casualties: c }); }
    return;
  }
  if (st.overwatchShot) { // his unit shoots at once, as on overwatch (if the target is in reach)
    for (const d of units(st.overwatchShot)) if (E.alive(src) && E.alive(d) && E.rangeOk(s, src, d)) {
      say(s, label + ': ' + nm(src) + ' fires on ' + nm(d) + '!', { type: 'overwatch', unit: src.id, fired: true });
      E.resolveAttack(s, src, d, { free: true, overwatch: true, noTactics: true });
    }
    return;
  }
  if (st.casualties !== undefined) {
    for (const u of units(st.who)) {
      const armor = st.ignoreArmor ? 0 : Math.max(0, Number(typeOf(s, u).armor) || 0);
      const c = Math.min(u.men, Math.max(0, st.casualties - armor)); if (!c) continue;
      u.men -= c; say(s, label + ': ' + nm(u) + ' takes ' + c + ' casualties' + (st.ignoreArmor ? ' (armor doesn\'t help)' : '') + '.', { type: 'skillCasualties', unit: u.id, casualties: c });
    }
    return;
  }
  if (st.turnOrder) { // actNext: right after his unit; actFirst: first next round; actLast: last this round
    for (const u of units(st.who)) { (s.skillOrder ||= []).push({ unitId: u.id, how: st.turnOrder, after: src.id, round: roundNow(s) });
      say(s, label + ': ' + nm(u) + ({ actNext: ' acts right after ' + nm(src) + '.', actFirst: ' acts first next round.', actLast: ' acts last this round.' })[st.turnOrder], { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.setTerrain) { // picked tiles become another terrain (s.tileOverrides is saved with the battle and laid over the map)
    const tiles = st.tiles ? ((ctx.picks && ctx.picks[st.tiles.pick]) || []) : [];
    for (const [x, y] of tiles) {
      const k = x + ',' + y, tile = s.map.tiles[k]; if (!tile) continue;
      const before = JSON.parse(JSON.stringify(tile)), now = JSON.parse(JSON.stringify(tile));
      if (['palisade', 'stakes', 'camp'].includes(st.setTerrain)) now.overlays = [...(now.overlays || []), st.setTerrain === 'palisade' ? 'camp-palisade' : st.setTerrain === 'stakes' ? 'camp-stakes' : 'camp'];
      else { now.terrain = st.setTerrain; now.overlays = (now.overlays || []).filter(o => o === 'road' || o === 'bridge'); }
      s.map.tiles = { ...s.map.tiles, [k]: now }; // copy: the decoded map is shared between builds
      (s.tileOverrides ||= {})[k] = { tile: now, before: (s.tileOverrides && s.tileOverrides[k] && s.tileOverrides[k].before) || before, until: st.for ? roundNow(s) + ((st.for.rounds) || 1) - 1 : null };
      say(s, label + ': the tile at ' + k + ' becomes ' + st.setTerrain + (st.for ? ' (' + describeDur(st.for) + ')' : ' for the rest of the battle') + '.', { type: 'terrain', x, y, terrain: st.setTerrain });
    }
    return;
  }
  if (st.openGate !== undefined) { // locked gates within N of his unit swing open
    let n = 0;
    for (const g of (s.siege && s.siege.gates) || []) if (g.state === 'locked' && g.squares.some(([x, y]) => E.manhattan({ x, y }, src) <= st.openGate)) {
      g.state = 'open'; n++; say(s, label + ': a gate swings open.', { type: 'gate', gate: g.id, state: 'open' });
      if (st.for) g.skillCloseRound = roundNow(s) + ((st.for.rounds) || 1) - 1; // shut again when the effect ends
      if (st.oneSide) g.skillOneSide = E.alliance(src.side);
    }
    if (!n) say(s, label + ': no locked gate within reach.', { type: 'skill', unit: src.id });
    return;
  }
  if (st.repair !== undefined) { // the most damaged gate within reach of his unit regains HP
    let best = null;
    for (const g of (s.siege && s.siege.gates) || []) { if (!(g.state === 'locked' || g.state === 'open') || !g.squares.some(([x, y]) => E.manhattan({ x, y }, src) <= (st.range || 2))) continue;
      if (!(g.maxHp > 0)) continue; if (g.hp < g.maxHp && (!best || g.maxHp - g.hp > best.maxHp - best.hp)) best = g; }
    if (best) { const n = Math.min(st.repair, best.maxHp - best.hp); best.hp += n; say(s, label + ': the gate regains ' + n + ' HP (' + best.hp + '/' + best.maxHp + ').', { type: 'gateHit', gate: best.id, hp: best.hp, maxHp: best.maxHp }); }
    else say(s, label + ': nothing within reach needs mending.', { type: 'skill', unit: src.id });
    return;
  }
  if (st.leave) { for (const u of units(st.leave)) { u.status = 'escaped'; u.hidden = false; say(s, label + ': ' + nm(u) + ' leaves the battle.', { type: 'escaped', unit: u.id }); } return; }
  if (st.convert) { // it comes over to his side; its officer is captured
    for (const u of units(st.convert)) {
      const o = offOf(s, u); u.side = src.side; u.owner = src.owner || null; u.officerId = null; u.morale = Math.max(u.morale, 1);
      say(s, label + ': ' + nm(u) + ' comes over to ' + nm(src) + '\'s side' + (o ? '; ' + o.name + ' is captured' : '') + '.', { type: 'convert', unit: u.id });
      (s.skillRequests ||= []).push({ kind: 'convert', unitId: u.id, side: src.side, captured: o ? o.id : null });
    }
    return;
  }
  if (st.spawn) { // a unit joins the battle next to his unit (the Foundry side creates it)
    (s.skillRequests ||= []).push({ kind: 'spawn', unit: st.spawn, side: src.side, near: { x: src.x, y: src.y }, srcId: src.id, owner: src.owner || null });
    say(s, label + ': ' + (st.spawn === 'levy' ? 'a Levy unit' : st.spawn) + ' joins the battle next to ' + nm(src) + '.', { type: 'spawn', unit: src.id });
    return;
  }
  if (st.grantTrait || st.removeTrait || st.stealTrait || st.stepTrait) {
    for (const u of units(st.who)) {
      if (st.grantTrait) addBuff(s, u, src, ctx.name || 'skill', { traits: { [st.grantTrait.toLowerCase()]: st.tier || 1 } }, st.for || 'battle', ctx);
      if (st.stepTrait) { const n = st.stepTrait.toLowerCase(); addBuff(s, u, src, ctx.name || 'skill', { traits: { [n]: Math.min(4, E.unitTrait(u, n) + 1) } }, st.for || 'battle', ctx); }
      if (st.removeTrait) addBuff(s, u, src, ctx.name || 'skill', { removeTraits: [st.removeTrait.toLowerCase()] }, st.for || 'battle', ctx);
      if (st.stealTrait) { // the strongest of the listed traits it has (or any of them): it loses it, his unit gains it
        const list = (st.stealTrait === true ? ['brace', 'charge reflection', 'anti-cavalry', 'splash attack', 'fierce charge', 'deflect', 'shielded', 'evasion', 'inspiration'] : st.stealTrait);
        const got = list.map(n => [n, E.unitTrait(u, n)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1])[0];
        if (!got) { say(s, label + ': ' + nm(u) + ' has no trait to take.', { type: 'skill', unit: u.id }); continue; }
        addBuff(s, u, src, ctx.name || 'skill', { removeTraits: [got[0]] }, st.for || 'battle', ctx);
        addBuff(s, src, src, ctx.name || 'skill', { traits: { [got[0]]: got[1] } }, st.for || 'battle', ctx);
        say(s, label + ': ' + nm(src) + ' takes ' + got[0] + ' from ' + nm(u) + '.', { type: 'skill', unit: u.id });
      }
    }
    if (!st.stealTrait) say(s, label + ': ' + units(st.who).map(nm).join(', ') + ' — ' + (st.grantTrait ? 'gains ' + st.grantTrait : st.stepTrait ? st.stepTrait + ' one step stronger' : 'loses ' + st.removeTrait) + ' (' + describeDur(st.for || 'battle') + ').', { type: 'skillBuff', unit: src.id });
    return;
  }
  if (st.cancelTactic) { // the next enemy tactic that would fire is cancelled (or the picked tile's tactic)
    (s.skillCancelTactic ||= []).push({ side: E.alliance(src.side), by: label, mode: st.cancelTactic });
    say(s, label + ': the next enemy tactic will come to nothing.', { type: 'skill', unit: src.id });
    return;
  }
  if (st.cooldown !== undefined) { // cut (negative) the battlefield active's wait of their officers
    for (const u of units(st.who)) { const f = fxOf(u); if (f.skillLast != null) f.skillLast += st.cooldown; say(s, label + ': ' + nm(u) + "'s officer can use their battlefield active " + Math.abs(st.cooldown) + ' turn' + (Math.abs(st.cooldown) > 1 ? 's' : '') + ' sooner.', { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.overwatchOn) { for (const u of units(st.overwatchOn)) { u.overwatch = true; say(s, label + ': ' + nm(u) + ' takes up overwatch.', { type: 'overwatch', unit: u.id, on: true }); } return; }
  if (st.reinforce !== undefined) { // a waiting allied reinforcement arrives now (the Foundry side places it)
    (s.skillRequests ||= []).push({ kind: 'reinforce', count: st.reinforce, side: src.side, near: st.near === 'hidden' ? 'hidden' : st.near || 'edge', srcId: src.id, filter: st.filter || null, onTerrain: st.onTerrain || null, buff: st.arriveBuff || null });
    say(s, label + ': ' + (st.reinforce > 1 ? 'up to ' + st.reinforce + ' allied reinforcements arrive' : 'an allied reinforcement arrives') + ' now.', { type: 'skill', unit: src.id });
    return;
  }
  if (st.reinforce !== undefined) { say(s, label + ' (GM): up to ' + st.reinforce + ' allied unit(s) waiting as reinforcements arrive now, at the map edge nearest ' + nm(src) + '.', { type: 'skillManual', unit: src.id }); return; }
  if (st.extraTurn) {
    const list = units(st.extraTurn);
    for (const u of list) { (s.skillExtra ||= []).push({ unitId: u.id, moveOnly: !!st.moveOnly }); say(s, label + ': ' + nm(u) + ' will take another ' + (st.moveOnly ? 'move' : 'turn') + ' at once.', { type: 'skill', unit: u.id }); }
    return;
  }
  if (st.if && st.each && st.who) { // test every unit it reaches; "then"/"else" run once per unit, with that unit as the target (2026-11-09)
    for (const u of units(st.who)) if (runSteps(s, matches(s, st.if, u, { src, self: u }) ? st.then || [] : st.else || [], { ...ctx, target: u }) === 'wait') return 'wait';
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
    const centers = st.from && st.from.pick ? ((ctx.picks || {})[st.from.pick] || []).map(c => Array.isArray(c) ? { x: c[0], y: c[1] } : E.unitById(s, c)).filter(Boolean)
      : [st.from ? fromPoint(s, st.from, ctx) : src].filter(Boolean);
    for (const c of centers) for (let dx = -st.fireArea; dx <= st.fireArea; dx++) for (let dy = -st.fireArea; dy <= st.fireArea; dy++)
      if (Math.abs(dx) + Math.abs(dy) <= st.fireArea && E._inBounds(s, c.x + dx, c.y + dy)) E._ignite(s, c.x + dx, c.y + dy, label);
    return;
  }
  if (st.attack) {
    // follow-ups right after this attack step belong to it
    const after = {}; let skip = 0;
    for (const r of rest) { if (r.onKill || r.onWin || r.onLose) { for (const k of ['onKill', 'onWin', 'onLose']) if (r[k]) after[k] = [...(after[k] || []), ...r[k]]; skip++; } else break; }
    if (ctx.picks) after.picks = ctx.picks;
    const who = units(st.who);
    if (st.extraMove) for (const u of who) addBuff(s, u, src, ctx.name || 'skill', { mods: [{ stat: 'move', value: st.extraMove }] }, 'thisTurn', ctx);
    // his own unit's attack in an active: the steps after it ("then it can move 2") wait for that attack
    const selfAttack = !ctx.auto && who.some(u => u.id === src.id);
    if (selfAttack && rest.length > skip) after.then = rest.slice(skip);
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
    if (st.moveFirst) { queueMove(s, src, st.moveFirst, 'any', null); return selfAttack ? 'wait' : wait(s, rest.slice(skip), ctx); }
    if (selfAttack) return 'stop';
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

/** Hidden enemy units a battle-start reveal (revealPick) may pick for src. */
export function revealCandidates(s, src) {
  return live(s).filter(u => u.hidden && E.hostile(u, src) && !flag(s, u, 'noRevealBySkills'));
}
/** The AI's pick for a reveal: the strongest hidden enemy (tier, then troops), nearest first on a tie. */
export function aiRevealTarget(s, src) {
  const c = revealCandidates(s, src);
  const tierOf = (u) => Number(typeOf(s, u).tier) || 1;
  c.sort((a, b) => tierOf(b) - tierOf(a) || (b.men || 0) - (a.men || 0) || E.manhattan(a, src) - E.manhattan(b, src));
  return c[0] || null;
}
/** Answer a waiting reveal: { pickId, targetId } or { pickId, skip: true }. Returns an error string or null. */
export function answerReveal(s, a) {
  const q = s.revealPicks || [], p = q.find(x => x.id === a.pickId) || q[0];
  if (!p) return 'No reveal is waiting';
  const src = E.unitById(s, p.src);
  if (!a.skip) {
    const t = E.unitById(s, a.targetId);
    if (!src || !t || !revealCandidates(s, src).some(u => u.id === t.id)) return 'Pick a hidden enemy unit';
    t.hidden = false;
    say(s, p.label + ': ' + nm(t) + ' is revealed.', { type: 'revealed', unit: t.id });
    p.left -= 1;
  }
  if (a.skip || p.left <= 0 || !src || !revealCandidates(s, src).length) s.revealPicks = q.filter(x => x !== p);
  return null;
}
/** The next reveal waiting for a pick, if any. */
export const pendingReveal = (s) => (s.revealPicks && s.revealPicks[0]) || null;

/** The next choice an active is waiting for, if any: { kind: 'move'|'attack', unitId, budget, mode, toward }. */
export function pendingChoice(s) {
  const ac = s.turn && s.turn.activation;
  return ac && ac.skillQueue && ac.skillQueue.length ? ac.skillQueue[0] : null;
}
/** Squares the pending free move may end on (normal movement rules within its budget; "away" must end farther from every enemy). */
export function choiceSquares(s, ch) {
  const u = E.unitById(s, ch.unitId); if (!u) return [];
  if (ch.mode === 'line') { // straight along one side, through empty open ground only
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= ch.budget; i++) {
      const x = u.x + dx * i, y = u.y + dy * i;
      if (!E._inBounds(s, x, y) || !E._passable(s, x, y, u) || E.unitAt(s, x, y)) break;
      out.push([x, y]);
    }
    return out;
  }
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
      if (ac.skillRun && ac.skillRun.ctx) ac.skillRun.ctx.vacated = { x: u.x, y: u.y };
      const from = { x: u.x, y: u.y };
      u.x = a.x; u.y = a.y;
      say(s, nm(u) + ' moves to ' + a.x + ',' + a.y + ' (' + 'battlefield skill).', { type: 'skillMove', unit: u.id });
      onMoved(s, u, from);
    } else if (ch.kind === 'split') { // share morale among the picked units: a.amounts { unitId: n }
      const am = a.amounts || {}; let sum = 0;
      for (const id of ch.units) { const n = Math.max(0, Math.floor(Number(am[id]) || 0)); if (n > ch.max) return 'At most ' + ch.max + ' each'; sum += n; }
      if (sum > ch.total) return 'At most ' + ch.total + ' in all';
      for (const id of ch.units) { const x = E.unitById(s, id), n = Math.floor(Number(am[id]) || 0); if (!x || !n) continue; const b = x.morale; x.morale = Math.min(100, x.morale + n); say(s, nm(x) + ' regains ' + (x.morale - b) + ' morale (battlefield skill).', { type: 'skillMorale', unit: x.id }); }
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
      if (src) runSteps(s, run.rest, { src, target: run.ctx.target ? E.unitById(s, run.ctx.target) : null, picks: run.ctx.picks, name: run.ctx.name, vacated: run.ctx.vacated });
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
  const a = E.yinYang().value + ((so && so.command) || 0) + asp(so) + stat(s, src, 'contestAtk') + stat(s, src, 'contestNext');
  const d = E.yinYang().value + ((to && to.command) || 0) + asp(to) + stat(s, t, 'resist') + stat(s, t, 'contestNext');
  for (const u of [src, t]) dropBuffs(u, b => b.until.kind === 'contest'); // "+N on its next contested roll": used now
  return a >= d;
}

/** Push u n squares straight away from src (the longer axis); stops at anything blocking. */
function push(s, src, u, n, label) {
  if (flag(s, u, 'cantBePushed')) return 0;
  const dx = u.x - src.x, dy = u.y - src.y;
  const [sx, sy] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const nx = u.x + sx, ny = u.y + sy;
    if (!E._inBounds(s, nx, ny) || !E._passable(s, nx, ny, u) || E.unitAt(s, nx, ny)) break;
    u.x = nx; u.y = ny; moved++;
  }
  if (moved) say(s, label + ': ' + nm(u) + ' is pushed back ' + moved + ' tile' + (moved > 1 ? 's' : '') + '.', { type: 'push', unit: u.id });
  return moved;
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
    const ok = pickCandidates(s, u, pk, picks);
    if (!pk.upTo && !ok.length) return activeBlocked(s, u) || 'Nothing to choose';
    if (!pk.upTo && chosen.length < Math.min(max, ok.length)) return 'Pick ' + max + (pk.side === 'tile' ? ' square' : ' unit') + (max > 1 ? 's' : '');
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
/** The highest morale an officer's active allows by its own rule (require.moraleBelow), or null if it sets none.
 *  Such actives (desperate or last-stand ones) skip the usual 75-morale minimum (David, 2026-11-09). */
export function activeMoraleCap(s, u) {
  const sp = specsOf(s, u); const r = sp && sp.active && sp.active.require;
  if (!r || r.moraleBelow == null) return null;
  return r.moraleBelow === 'half' ? 50 : Number(r.moraleBelow);
}
/** Why the active can't be used now (a pick it needs has nothing to choose), or null. */
export function activeBlocked(s, u) {
  const sp = specsOf(s, u); const act = sp && sp.active;
  if (!act) return null;
  if (act.require && !matches(s, act.require, u, { src: u, self: u })) return 'Not usable now (' + describeFilter(act.require) + ')';
  for (const pk of act.pick || []) if (!pk.upTo && !pk.filter?.nearPick && !pickCandidates(s, u, pk).length)
    return 'No ' + (pk.side === 'tile' ? 'square' : pk.side === 'allies' ? 'allied unit' : 'enemy unit') + ' it can be used on';
  return null;
}
/** What a pick may choose: unit ids, or [x, y] squares for tiles. */
export function pickCandidates(s, u, pk, earlier = {}) {
  const inRange = (p) => pk.range === 'any' || E.manhattan(u, p) <= pk.range;
  const fctx = { src: u, self: u, picks: earlier };
  if (pk.side === 'tile') {
    const out = [];
    for (const k of Object.keys(s.map.tiles || {})) {
      const [x, y] = k.split(',').map(Number);
      if (!inRange({ x, y })) continue;
      if (pk.filter && pk.filter.flammable) { const r = E.tileRules(s, x, y); if (!r || !r.flammable || (s.siege && s.siege.fires && s.siege.fires[k])) continue; }
      if (pk.filter && pk.filter.onTerrain && !onTerrain(s, x, y, pk.filter.onTerrain)) continue;
      if (pk.filter && pk.filter.empty && (E.unitAt(s, x, y) || !E._passable(s, x, y))) continue;
      if (pk.filter && pk.filter.adjacentToSource && E.manhattan({ x, y }, u) !== 1) continue;
      if (pk.filter && pk.filter.nextToTerrain && !nextTo(s, x, y, pk.filter.nextToTerrain)) continue;
      out.push([x, y]);
    }
    return out;
  }
  return live(s).filter(o => {
    if (o.id === u.id) return pk.side === 'allies' && !!pk.self && matches(s, pk.filter, o, fctx);
    if ((pk.side === 'allies') !== ally(o, u)) return false;
    if (pk.side === 'enemies' && !E.visibleTo(s, o, E.alliance(u.side))) return false;
    return inRange(o) && matches(s, pk.filter, o, fctx);
  }).map(o => o.id);
}

// ---------------------------------------------------------------- words for the log and the UI
const STATUS_TEXT = { cantMove: "can't move", cantAttack: "can't attack", cantMoveOrAttack: "can't move or attack", skipTurn: 'skips its turn',
  isolated: 'gets nothing from allied traits and abilities', cantAttackNearSource: "can't attack his unit or units next to it", noTactics: "can't set off tactics", noOverwatchAgainst: "overwatch can't target it", cantMoveAway: "can't move away",
  moveOrAttack: 'can move or attack, not both', noSkills: "can't use battlefield actives", stripDefenses: 'loses Brace, Hold, Charge Reflection and Anti-Cavalry' };
const STAT_TEXT = { attack: 'Attack', command: 'Command', commandAtk: 'Command when attacking', commandDef: 'Command when defending', meleeDef: 'melee defense',
  rangedDef: 'ranged defense', move: 'movement', range: 'range', armor: 'armor', pen: 'pen', damage: 'damage', resist: 'vs enemy skills',
  moraleLossLess: 'morale lost from lost rolls', checkpointLess: 'morale lost at casualty checkpoints', skillLossLess: 'morale lost to enemy skills',
  anyLossLess: 'morale losses', enemyLoss: 'morale enemies lose to it', enemyLossAtk: 'morale enemies it attacks lose', startMorale: 'starting morale',
  overwatch: 'Overwatch Attack', forcedMarchCost: 'forced march cost', regenCap: 'morale recovery cap', moraleFloor: 'morale floor',
  damageTaken: 'casualties taken', reflectMelee: 'damage back to melee attackers', moraleCapAttack: 'most morale lost per attack', moraleCapRound: 'most morale lost per round',
  surroundLossLess: 'morale lost when surrounded', fireLossLess: 'morale lost to fire', fireCasualties: '% casualties from fire', contestAtk: 'on its skills\' contested rolls',
  contestNext: 'on its next contested roll', skillCost: 'morale cost of its battlefield active', skillMinUp: 'morale its battlefield active needs', moveAway: 'movement away from the enemy', moveNoAttack: 'movement if it doesn\'t attack' };
const sgn = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
export function describeBuff(b) {
  const parts = [];
  for (const m of b.mods || []) parts.push(STAT_TEXT[m.stat] + ' ' + (['moraleLossLess', 'checkpointLess', 'skillLossLess', 'anyLossLess', 'forcedMarchCost'].includes(m.stat) ? '−' + m.value : m.stat === 'regenCap' ? 'up to ' + m.value : sgn(m.value)));
  for (const f of b.flags || []) { const [fn, arg] = String(f.flag).split(':'); parts.push(fn === 'sweep' ? arg + ' damage to every other enemy around it when it attacks (ignores armor and evasion)' : fn === 'cantBeSurrounded' ? "can't be surrounded" : fn === 'sweepMorale' ? 'enemies its sweep hits lose ' + arg + ' morale' : String(f.flag).replace(/([A-Z])/g, ' $1').toLowerCase()); }
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

// ---------------------------------------------------------------- active effects (David, 2026-11-09)
// Stats where a bigger number is worse for the unit (everything else: bigger is better).
const WORSE_UP = new Set(['damageTaken', 'skillCost', 'skillMinUp', 'fireCasualties']);
/** Is a skill buff on u good for it ('buff') or bad ('debuff')? Enemy skills and statuses are debuffs; else the sign of its mods. */
export function buffKind(s, u, b) {
  const src = E.unitById(s, b.src);
  if (b.status) return 'debuff';
  if (src && src.id !== u.id && E.hostile(src, u)) return 'debuff';
  let score = 0;
  for (const m of b.mods || []) { const v = Number(m.value) || 0; score += Math.sign(v) * (WORSE_UP.has(m.stat) ? -1 : 1); }
  if (b.removeTraits && b.removeTraits.length) score -= 1;
  return score < 0 ? 'debuff' : 'buff';
}
/**
 * How strong an effect is, for the stand's motes (David, 2026-11-09: more motes for stronger buffs): the size of each stat
 * change, at most 5 each (morale ones count a third), 2 for each special property (its tier if it has one, Splash:2 = 2),
 * 3 for a status (can't move, skip turn...). Attack +4 with Splash Attack++ = 6; Command +1 = 1.
 */
const MORALE_LIKE = /loss|morale|regen|floor|checkpoint/i;
export function effectPower(b) {
  let p = 0;
  for (const m of b.mods || []) { const v = Math.abs(Number(m.value) || 0); p += Math.min(5, MORALE_LIKE.test(m.stat) ? v / 3 : m.stat === 'fireCasualties' || m.stat === 'forcedMarchCost' ? v / 10 : v); }
  for (const f of b.flags || []) { const arg = Number(String(f.flag).split(':')[1]); p += arg > 0 && arg <= 4 ? arg : 2; }
  if (b.status) p += 3;
  if (b.triggers && !p) p = 2;
  return Math.max(1, Math.round(p));
}
/** How long a buff has left, in words. */
export function untilText(s, u, b) {
  const d = b.until || {}, round = (s.turn && s.turn.round) || 0, acts = fxOf(u).acts || 0, src = E.unitById(s, d.src);
  switch (d.kind) {
    case 'round': { const n = d.round - round + 1; return n <= 1 ? 'this turn' : n + ' turns left'; }
    case 'actEnd': return d.from && acts < d.from ? 'its next turn' : d.acts <= acts ? 'until the end of this turn' : 'until the end of its next turn';
    case 'actStart': return 'until its next turn';
    case 'attack': return 'its next attack';
    case 'roll': return 'its next roll';
    case 'contest': return 'its next contested roll';
    case 'skill': return 'its next battlefield active';
    case 'srcStart': return 'until ' + (src ? src.name + "'s" : 'the source\'s') + ' next turn';
    case 'srcEnd': return 'until the end of ' + (src ? src.name + "'s" : 'the source\'s') + ' next turn';
    default: return 'rest of the battle';
  }
}
/**
 * Everything changing unit u right now, for the stand effects and the Info window:
 * [{ key, kind: 'buff'|'debuff', power, name, text, from, until, aura }]. key is stable while the effect lasts (a new key = it just landed).
 * Skill buffs, the stat-changing trait effects (Sunder, Poison, Suppressing Fire, Deterrence, Barbed Arrows), and passive
 * auras from other officers' units (aura: true; listed, but the stands don't animate them, as they come and go with movement).
 */
export function effectsOf(s, u) {
  const out = [], f = fxOf(u);
  for (const b of f.buffs || []) {
    const text = describeBuff(b) || (b.triggers ? 'a lasting effect' : '');
    if (!text) continue;
    const src = E.unitById(s, b.src), o = src && E.officerOf(s, src);
    out.push({ key: 'b:' + b.id, kind: buffKind(s, u, b), power: effectPower(b), name: b.name, text, from: o ? o.name : (src && src.id !== u.id ? src.name : ''), until: untilText(s, u, b), aura: false });
  }
  const T = (key, name, text, from, until, power) => out.push({ key, kind: 'debuff', power, name, text, from, until, aura: false });
  if (f.sunder) T('t:sunder:' + f.sunder, 'Sundered', 'Armor −' + f.sunder, f.sunder >= 6 ? 'Sunder++' : f.sunder >= 4 ? 'Sunder+' : 'Sunder', 'rest of the battle', f.sunder);
  if (f.poison) T('t:poison:' + f.poison, 'Poisoned', 'Melee and ranged defense −' + f.poison, f.poison >= 2 ? 'Poison+' : 'Poison', 'rest of the battle', 2 * f.poison);
  if (f.suppressed) T('t:suppressed', 'Suppressed', 'Attack −1, melee defense −1, movement −2; loses Hold, Brace, Anti-Cavalry and Charge Reflection', 'Suppressing Fire', 'until the end of its next turn', 4);
  if (f.deterred) T('t:deterred', 'Deterred', 'Attack −2', 'Deterrence', 'its next attack', 2);
  if (f.slow) T('t:slow', 'Slowed', 'Movement −1', 'Barbed Arrows', 'its next turn', 1);
  // passive auras reaching u from other units (its own officer's passive is on the officer card already)
  for (const X of live(s)) {
    if (X.id === u.id) continue;
    const sp = specsOf(s, X), p = sp && sp.passive;
    if (!p || (ally(X, u) && cutOff(u, X))) continue;
    const mods = (p.mods || []).filter(e => whoIncludes(s, e.who, X, u)), flags = (p.flags || []).filter(e => whoIncludes(s, e.who, X, u));
    if (!mods.length && !flags.length) continue;
    const b = { src: X.id, mods, flags };
    const text = describeBuff(b); if (!text) continue;
    out.push({ key: 'a:' + X.id, kind: buffKind(s, u, b), power: effectPower(b), name: sp.passiveName || 'passive', text, from: (sp.officer && sp.officer.name) || X.name, until: 'while in range', aura: true });
  }
  return out;
}

// ---------------------------------------------------------------- v3 helpers the engine calls
/** Is unit u cut off from what ally X gives (traits, abilities, auras)? Isolated from all, or from that one unit. */
export function cutOff(u, X) {
  const f = u && u.fx; if (!f || !f.buffs) return false;
  return f.buffs.some(b => b.status === 'isolated' && !(b.until.from && (f.acts || 0) < b.until.from) && (!b.isoFrom || b.isoFrom.includes(X.id)));
}
/** Before an attack lands (David's battlefield skills): it may be lost (a challenge the attacker fails) or drawn onto another unit. */
export function beforeAttack(s, attacker, defender, opts = {}) {
  if (opts.forced || opts.overwatch) return null;
  // the first enemy to attack him each battle must win a contested Command roll, or its attack is lost
  if (flag(s, defender, 'challengeFirstAttacker') && !fxOf(defender).challenged && E.hostile(attacker, defender)) {
    fxOf(defender).challenged = true;
    const lost = contest(s, defender, attacker);
    say(s, nm(attacker) + (lost ? ' loses' : ' wins') + ' the contested Command roll against ' + nm(defender) + (lost ? ': its attack is lost.' : '.'), { type: 'skillContest', unit: attacker.id, lost });
    if (lost) return { cancel: true };
  }
  // melee attacks on allies next to a unit that draws them are made against that unit instead
  if (!opts.ranged) for (const X of live(s)) {
    if (X.id === defender.id || !ally(X, defender) || E.manhattan(X, defender) !== 1 || !E.hostile(attacker, X)) continue;
    const g = flag(s, X, 'drawMeleeAttacks'); if (!g) continue;
    say(s, nm(X) + ' draws the attack on ' + nm(defender) + ' onto itself (battlefield skill).', { type: 'skill', unit: X.id });
    addBuff(s, X, X, 'drawn attack', { flags: [{ flag: 'casualtyHalf' }] }, 'nextRoll');
    const n = Number(g) || 0; if (n) { const b = X.morale; X.morale = Math.min(100, X.morale + n); if (X.morale > b) say(s, nm(X) + ' regains ' + (X.morale - b) + ' morale.', { type: 'skillMorale', unit: X.id }); }
    return { redirect: X };
  }
  return null;
}
/** Ride through: the enemy units its move passed over each take its damage (the path that passes the most of them). */
export function rideThrough(s, u, from) {
  if (!flag(s, u, 'rideThrough') || !from) return;
  const foes = new Map(live(s).filter(o => E.hostile(o, u)).map(o => [o.x + ',' + o.y, o]));
  // shortest paths from `from` to u's square over passable ground; among them, the one over the most enemies
  const key = (x, y) => x + ',' + y, goal = key(u.x, u.y);
  let best = null; const q = [[from.x, from.y, [], 0]], seen = new Map([[key(from.x, from.y), 0]]);
  const limit = E.manhattan(from, u) + 4;
  while (q.length) {
    const [x, y, passed, n] = q.shift();
    if (key(x, y) === goal) { if (!best || passed.length > best.length) best = passed; continue; }
    if (n >= limit) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (!E._inBounds(s, nx, ny) || !E._passable(s, nx, ny, u)) continue;
      const p2 = foes.has(k) && !passed.includes(foes.get(k)) ? [...passed, foes.get(k)] : passed;
      if ((seen.get(k + ':' + p2.length) ?? 99) <= n + 1) continue;
      seen.set(k + ':' + p2.length, n + 1); q.push([nx, ny, p2, n + 1]);
    }
  }
  const dmg = Number(typeOf(s, u).damage) || 0, pen = Number(typeOf(s, u).armorPen) || 0;
  for (const e of best || []) { const c = Math.min(e.men, E.casualtiesOf(dmg, Number(typeOf(s, e).armor) || 0, pen, 0, 0)); e.men -= c;
    say(s, nm(u) + ' rides through ' + nm(e) + ': ' + c + ' casualties.', { type: 'skillCasualties', unit: e.id, casualties: c }); }
}
/** Extra tactics a side may place (a passive with the extraTactic flag on one of its units). */
export function extraTactics(s, side) {
  return live(s).filter(u => E.alliance(u.side) === E.alliance(side) || u.side === side).some(u => flag(s, u, 'extraTactic')) ? 1 : 0;
}
const describeFilter = (f) => Object.entries(f || {}).map(([k, v]) => k + (v === true ? '' : ' ' + JSON.stringify(v))).join(', ');
const DEFENSIVE = new Set(['evasion', 'brace', 'charge reflection', 'anti-cavalry', 'shielded', 'deflect', 'hold the line', 'unwavering', 'disciplined']);
/** A unit's trait tier after battlefield skills: granted, stepped up, taken away (buffs), or switched off for one attack. */
export function traitTier(u, name, base) {
  const f = u && u.fx; if (!f || (!f.buffs && !f.traitsOff)) return base;
  if (f.traitsOff && (Array.isArray(f.traitsOff) ? f.traitsOff.includes(name) : DEFENSIVE.has(name))) return 0;
  let v = base;
  for (const b of f.buffs || []) {
    if (b.until.from && (f.acts || 0) < b.until.from) continue;
    if (b.removeTraits && b.removeTraits.includes(name)) return 0;
    if (b.traits && b.traits[name] != null) v = Math.max(v, b.traits[name]);
  }
  return v;
}
/** A morale cap on one attack (moraleCapAttack): give back what went past it. */
export function capAttack(s, u, before) {
  const cap = stat(s, u, 'moraleCapAttack'); if (!cap || u.men <= 0) return;
  if (before - u.morale > cap) { const back = before - u.morale - cap; u.morale += back; say(s, nm(u) + ' loses at most ' + cap + ' morale from one attack (battlefield skill): +' + back + ' back.', { type: 'skillMorale', unit: u.id }); }
}
/** A morale cap per round (moraleCapRound), applied after each settle. */
function capRound(s) {
  for (const u of live(s)) {
    const cap = stat(s, u, 'moraleCapRound'); if (!cap) continue;
    const r = fxOf(u).mLostRound; if (!r || r.round !== roundNow(s) || r.n <= cap) continue;
    const back = r.n - cap; u.morale = Math.min(100, u.morale + back); r.n = cap; fxOf(u).mPrev = u.morale;
    say(s, nm(u) + ' loses at most ' + cap + ' morale this round (battlefield skill): +' + back + ' back.', { type: 'skillMorale', unit: u.id });
  }
}
/** The extra cost (or a cut) on an officer's battlefield active. */
export const skillTax = (s, u) => stat(s, u, 'skillCost');
/** "Its next battlefield active costs N more": buffs with the nextSkill duration end once it uses one. */
export function usedActive(u) { dropBuffs(u, b => b.until.kind === 'skill' || (b.flags || []).some(f => String(f.flag).split(':')[0] === 'readied')); } // Readied is used up by the active it readied
/** Is this enemy tactic cancelled by a battlefield skill? (Consumes the cancel.) */
export function cancelsTactic(s, tacticSide) {
  const list = s.skillCancelTactic || [];
  const i = list.findIndex(c => c.side !== E.alliance(tacticSide));
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}
/** Turn order changes from skills, after a unit's turn: who goes next (returns a unit id to start now, or null). */
export function orderAfterTurn(s) {
  const t = s.turn, list = s.skillOrder || [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i], u = E.unitById(s, o.unitId);
    if (!u || !E.alive(u) || o.round !== roundNow(s)) { if (o.how !== 'actFirst') { list.splice(i--, 1); } continue; }
    if (o.how === 'actLast') { t.order = [...t.order.filter(id => id !== u.id), u.id]; list.splice(i--, 1); continue; }
    if (o.how === 'actNext') {
      list.splice(i--, 1);
      if (u.round.activated || (t.decided || []).includes(u.id)) continue;
      if (u.officerId && t.phase === 'officer') { const at = t.order.indexOf(o.after); t.order = t.order.filter(id => id !== u.id); t.order.splice(Math.max(0, at + 1), 0, u.id); continue; }
      return u.id; // an officerless unit: it takes its turn now
    }
  }
  return null;
}
/** Units a skill put first in the turn order for this round (after initiative). */
export function orderAtInitiative(s) {
  const list = s.skillOrder || [], first = [];
  s.skillOrder = list.filter(o => { if (o.how === 'actFirst' && o.round === roundNow(s) - 1) { first.push(o.unitId); return false; } return o.how !== 'actFirst' ? o.round >= roundNow(s) : true; });
  if (first.length) s.turn.order = [...first.filter(id => s.turn.order.includes(id)), ...s.turn.order.filter(id => !first.includes(id))];
}
/** A skill's "next attack" buffs are used up (by an attack that isn't a contested roll, e.g. on a gate). */
export function consumeNextAttack(u) { dropBuffs(u, b => b.until.kind === 'attack'); }
