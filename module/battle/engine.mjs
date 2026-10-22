// Three Kingdoms Tactics rules engine. Pure game logic: no networking.
// All state lives in one plain object so it can be saved as JSON.

import * as data from './engine-data.mjs';

// Four sides. Any two different sides are hostile; units of the same side never attack each other.
const SIDES = ['player', 'enemy', 'ally', 'neutral'];
const MAX_LOG = 400;

// ---------------------------------------------------------------- state

function newState() {
  return {
    version: 1,
    map: { image: null, cols: 24, rows: 16, tile: 48, offsetX: 0, offsetY: 0, terrain: {} },
    library: {
      unitTypes: clone(data.UNIT_TYPES),
      officers: clone(data.OFFICERS),
      formations: clone(data.FORMATIONS),
    },
    players: {},       // playerId -> { name, color }
    units: [],
    nextUnitId: 1,
    turn: freshTurn('setup', 0),
    log: [],
  };
}

function freshTurn(phase, round) {
  return {
    phase,            // setup | formations | officer | officerless | final
    round,
    ready: {},        // playerId -> true (formations phase)
    order: [],        // officer unit ids, highest initiative first
    init: {},         // unitId -> { total, yin, yang, fire }
    decided: [],      // officer units that have used their slot (acted / held / forfeited)
    held: [],         // officer units currently holding
    sideIdx: 0,       // officerless rotation pointer into SIDES
    claim: null,      // player id that claimed the player-side officerless turn
    activation: null, // { unitId, step: 'move'|'act', started, startedHidden, charge, interject }
  };
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------------------------------------------------------------- lookups

const typeOf = (s, u) => s.library.unitTypes.find(t => t.id === u.typeId) || null;
const officerOf = (s, u) => (u.officerId ? s.library.officers.find(o => o.id === u.officerId) || null : null);
const formationOf = (s, u) => s.library.formations.find(f => f.id === u.formation) || { id: 'none' };
const unitById = (s, id) => s.units.find(u => u.id === id) || null;
const alive = u => u.status === 'active';
const liveUnits = s => s.units.filter(alive);
const alliance = side => side || 'player';
const hostile = (a, b) => alliance(a.side) !== alliance(b.side);
const friendly = (a, b) => !hostile(a, b);
const passive = (s, u) => { const o = officerOf(s, u); return (o && o.passive && o.passive.effects) || {}; };
const unitAt = (s, x, y) => liveUnits(s).find(u => u.x === x && u.y === y) || null;
const terrainAt = (s, x, y) => s.map.terrain[x + ',' + y] || 'flat';
const inBounds = (s, x, y) => x >= 0 && y >= 0 && x < s.map.cols && y < s.map.rows;
const passable = (s, x, y) => inBounds(s, x, y) && (data.TERRAIN[terrainAt(s, x, y)] || data.TERRAIN.flat).passable;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const sign = n => (n > 0 ? 1 : n < 0 ? -1 : 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function log(s, text, detail) {
  s.log.push({ t: Date.now(), round: s.turn.round, text, detail: detail || null });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function moraleState(m) {
  if (m <= 0) return 'Surrendered';
  if (m <= 25) return 'Demoralized';
  if (m >= 75) return 'Encouraged';
  return 'Neutral';
}

// ---------------------------------------------------------------- traits
// A unit's traits come from its Traits tab as { "base name": tier }, tier 1 = base, 2 = "+", 3 = "++".
function trait(u, base) { const t = u && u.traitTiers; return (t && t[base]) || 0; }
const tierVal = (tier, vals) => (tier ? vals[Math.min(tier, vals.length) - 1] : 0);
/** Lasting per-unit battle effects (poison, sunder, reload, slowed, stood still last turn). */
function fx(u) { if (!u.fx) u.fx = {}; return u.fx; }
/** Extra range from Range Up (if the unit stood still on its last turn). */
function rangeBonus(s, u) { return fx(u).stillLast ? tierVal(trait(u, 'range up'), [1, 2]) : 0; }

// ---------------------------------------------------------------- tactics
// Placed before initiative by each side's tactician; hidden until they fire (once), then active for their duration.
const TACTIC_SIDES = ['player', 'ally', 'enemy'];
const SIDE_LABEL = { player: 'Player', ally: 'Ally', enemy: 'Enemy', neutral: 'Neutral' };
const tacticDef = key => data.TACTICS.find(t => t.key === key) || null;
const inTacticArea = (t, u) => Math.abs(u.x - t.x) <= t.size && Math.abs(u.y - t.y) <= t.size;
const tacticLive = (s, t) => t.state === 'active' && (t.untilRound === undefined || s.turn.round <= t.untilRound);
/** Active tactics of these keys helping unit u right now (only ever units of the side that placed them). */
function tacticsOn(s, u, keys) {
  const T = s.tactics; if (!T || !u) return [];
  const ks = [].concat(keys);
  return T.placed.filter(t => ks.includes(t.key) && t.side === u.side && tacticLive(s, t) &&
    (tacticDef(t.key).bound ? t.unitId === u.id : inTacticArea(t, u)));
}
const hasTactic = (s, u, k) => tacticsOn(s, u, k).length > 0;
/** A hidden tactic of u's side with this trigger that covers u (it would fire). */
const pendingTactic = (s, u, trigger) => !!(s.tactics && s.tactics.phase === 'battle' && s.tactics.placed.some(t =>
  t.state === 'hidden' && t.side === u.side && tacticDef(t.key).trigger === trigger && (t.key === 'raiseFlag' ? t.x === u.x && t.y === u.y : inTacticArea(t, u))));

function triggerTactic(s, t, u) {
  const def = tacticDef(t.key);
  t.state = def.turns ? 'active' : 'spent';
  t.firedRound = s.turn.round;
  t.untilRound = def.turns ? s.turn.round + def.turns - 1 : s.turn.round;
  if (def.bound && u) t.unitId = u.id;
  log(s, SIDE_LABEL[t.side] + ' tactic: ' + def.name + '!' + (t.tactician ? ' (' + t.tactician + ')' : '') + ' ' + def.text,
    { type: 'tactic', tactic: { id: t.id, key: t.key, name: def.name, side: t.side, x: t.x, y: t.y, size: t.size, tactician: t.tactician || null } });
}
/** Fire every hidden tactic of u's side whose trigger is `event` and whose square holds u. */
function fireTactics(s, event, u) {
  const T = s.tactics;
  if (!T || T.phase !== 'battle' || !u) return [];
  const fired = [];
  for (const t of T.placed) {
    if (t.state !== 'hidden' || t.side !== u.side) continue;
    const def = tacticDef(t.key);
    if (!def || def.trigger !== event) continue;
    if (t.key === 'raiseFlag' ? !(u.x === t.x && u.y === t.y) : !inTacticArea(t, u)) continue;
    triggerTactic(s, t, u);
    fired.push(t);
  }
  return fired;
}
const heroOfficer = (s, u) => { const o = officerOf(s, u), t = typeOf(s, u); return !!(o && t && ((o.skills || {})[t.skill] || 0) >= 5); };

function movementOf(s, u) {
  const t = typeOf(s, u); const f = formationOf(s, u);
  if (f.immobile) return 0;
  const slowed = fx(u).slow ? 1 : 0; // Barbed Arrows
  return Math.max(0, (t ? t.move : 4) + (f.moveMod || 0) + (passive(s, u).moveBonus || 0) - slowed);
}

function newRoundFlags() {
  return { activated: false, moved: false, cannotMove: false, holding: false, attacked: false,
    skillUsed: false, heroicUsed: false, meleeTarget: null, meleeAttacker: null };
}

// ---------------------------------------------------------------- dice

let rng = Math.random;
function setRng(fn) { rng = fn; }
function d10() { return Math.floor(rng() * 10); }
// Campaign homebrew: a double counts as its face value (double 8 = 8), not 0.
function yinYang() { const yin = d10(), yang = d10(); return { yin, yang, value: yin === yang ? yin : Math.abs(yin - yang) }; }

// ---------------------------------------------------------------- movement

// Tiles reachable by `u` with `budget` movement. Units block movement.
function reachable(s, u, budget) {
  // Units may move through friendly units (not stop on them); Heavy units, and all enemies, block.
  const out = new Map(), seen = new Map(); const key = (x, y) => x + ',' + y;
  const q = [[u.x, u.y, 0]]; seen.set(key(u.x, u.y), 0);
  while (q.length) {
    const [x, y, d] = q.shift();
    if (d >= budget) continue;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (seen.has(k) || !passable(s, nx, ny)) continue;
      const o = unitAt(s, nx, ny);
      if (o && (trait(o, 'heavy') || !stealthFriends(alliance(o.side), alliance(u.side)))) continue;
      seen.set(k, d + 1); q.push([nx, ny, d + 1]);
      if (!o) out.set(k, d + 1);
    }
  }
  out.delete(key(u.x, u.y));
  return out; // "x,y" -> distance (empty tiles only)
}

/**
 * Everywhere a unit threatens this turn: tiles it can move to (normal move), plus the tiles it could attack
 * from any of them (range bonuses, minimum range and Hybrid melee included). Keys are "x,y".
 */
function threatArea(s, u) {
  const key = (x, y) => x + ',' + y;
  const move = movementOf(s, u);
  const moveSet = new Set(move ? reachable(s, u, move).keys() : []);
  const t = typeOf(s, u), ranged = t.weapon === 'ranged';
  const bands = [[t.rangeMin || 1, (t.rangeMax || 1) + (ranged ? rangeBonus(s, u) : 0)]];
  if (ranged && trait(u, 'hybrid')) bands.push([1, 1]);
  const attack = new Set();
  const origins = [[u.x, u.y], ...[...moveSet].map(k => k.split(',').map(Number))];
  for (const [ox, oy] of origins) for (const [lo, hi] of bands) {
    for (let dx = -hi; dx <= hi; dx++) {
      const r = hi - Math.abs(dx);
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) < lo) continue;
        const x = ox + dx, y = oy + dy, k = key(x, y);
        if (passable(s, x, y) && !moveSet.has(k)) attack.add(k);
      }
    }
  }
  attack.delete(key(u.x, u.y));
  return { move: moveSet, attack };
}

/**
 * Where a unit can go this turn. blue: normal move (keeps its action). red: forced march
 * (another move's worth, 5 morale per extra tile, never down to 0 morale; ends the turn).
 */
function moveOptions(s, u) {
  const blue = new Map(), red = new Map();
  const ac = s.turn.activation;
  if (!u || !ac || ac.unitId !== u.id || ac.step !== 'move' || u.round.cannotMove) return { blue, red };
  const move = movementOf(s, u);
  if (!move) return { blue, red };
  const reach = reachable(s, u, move * 2);
  for (const [k, d] of reach) {
    if (d <= move) blue.set(k, d);
    else {
      const cost = forcedMarchCost(s, u) * (d - move);
      if (u.morale - cost > 0) red.set(k, { dist: d, cost });
    }
  }
  return { blue, red };
}

/** Morale per extra tile of forced march: 5, or 2 under Rapid Advance, Swift Retreat (active, or about to fire). */
function forcedMarchCost(s, u) { return hasTactic(s, u, 'rapidAdvance') || pendingTactic(s, u, 'forcedMarch') ? 2 : 5; }

/** Enemy units this unit could attack right now. */
function attackTargets(s, u) {
  return liveUnits(s).filter(d => hostile(u, d) && visibleTo(s, d, alliance(u.side)) && rangeOk(s, u, d));
}

/** What the Fire Emblem-style action menu may offer the active unit. */
function actionMenu(s, u) {
  const ac = s.turn.activation;
  const none = { move: false, attack: false, hold: false, ability: false, heroic: false, endTurn: false };
  if (!u || !ac || ac.unitId !== u.id || !alive(u)) return none;
  const o = officerOf(s, u);
  const opts = moveOptions(s, u);
  const canStillAct = !u.round.attacked && !ac.forcedMarched;
  const reloading = !!fx(u).reload;
  const skillOk = !!(o && o.skill && !u.round.skillUsed && u.morale >= (Number(o.skill.moraleCost) || 0));
  const artOk = !!(o && o.battleArt && !u.round.skillUsed && moraleState(u.morale) === 'Encouraged');
  return {
    move: opts.blue.size + opts.red.size > 0,
    attack: canStillAct && !reloading && attackTargets(s, u).length > 0, reloading,
    reload: reloading && !u.round.attacked,
    raiseFlag: canStillAct && pendingTactic(s, u, 'raiseFlag'),
    setFire: canStillAct && pendingTactic(s, u, 'setFire'),
    hold: canStillAct,
    ability: skillOk || artOk, skill: skillOk, art: artOk,
    heroic: !!(o && (o.heroicActions || []).length && !u.round.heroicUsed && (u.heroicUsed || 0) < (o.fire || 0)),
    undo: !!ac.undo,
    endTurn: true,
  };
}

// ---------------------------------------------------------------- facing

function faceToward(u, target) {
  const dx = sign(target.x - u.x), dy = sign(target.y - u.y);
  if (dx || dy) u.facing = { dx, dy };
}

// Rear: the attacker is behind the defender relative to its facing.
function isRear(s, attacker, defender) {
  const f = defender.facing || { dx: 0, dy: 1 };
  const dot = (attacker.x - defender.x) * f.dx + (attacker.y - defender.y) * f.dy;
  return dot < 0;
}
function isFront(s, attacker, defender) {
  const f = defender.facing || { dx: 0, dy: 1 };
  return (attacker.x - defender.x) * f.dx + (attacker.y - defender.y) * f.dy > 0;
}

// ---------------------------------------------------------------- visibility

// Can units of alliance `viewerAlliance` see unit `u`?
function visibleTo(s, u, viewerAlliance) {
  // Hidden units can't be seen by other sides (players and their NPC allies share what they see).
  // They're only revealed by attacking, ending their turn next to a hostile unit, or an ability/the GM.
  if (!u.hidden) return true;
  return stealthFriends(alliance(u.side), viewerAlliance);
}
/** Sides that share sight and don't reveal each other: the same side, or Player with Ally. */
function stealthFriends(a, b) {
  if (a === b) return true;
  return (a === 'player' && b === 'ally') || (a === 'ally' && b === 'player');
}
/** A unit that moves next to hidden hostile units reveals them. */
function revealAround(s, u) {
  for (const o of liveUnits(s)) {
    if (o.hidden && !stealthFriends(alliance(o.side), alliance(u.side)) && manhattan(o, u) === 1) {
      o.hidden = false;
      log(s, o.name + ' is spotted by ' + u.name + '.', { type: 'revealed', unit: o.id });
    }
  }
}
/** Hostile troops next to this unit (they stop it hiding and reveal it at the end of its turn). */
function hostileAdjacent(s, u) {
  return liveUnits(s).some(o => o !== u && !stealthFriends(alliance(o.side), alliance(u.side)) && manhattan(o, u) === 1);
}
/** Other enemies next to the unit it can see (Dual Weapons' second attack). */
function secondTargets(s, u, first) {
  return liveUnits(s).filter(o => o !== first && hostile(u, o) && manhattan(o, u) === 1 && visibleTo(s, o, alliance(u.side))).map(o => o.id);
}
/** Empty, passable tiles next to the defender (Wedge's follow-up move). */
function repositionTiles(s, d, u) {
  const out = [];
  for (const [dx, dy] of ORTHO) {
    const x = d.x + dx, y = d.y + dy;
    if (!passable(s, x, y)) continue;
    const o = unitAt(s, x, y);
    if (o && o !== u) continue;
    if (o === u) continue; // already there
    out.push([x, y]);
  }
  return out;
}
/** Does terrain hide a unit that ends its turn there? (forests) */
function hidesIn(s, u) { return terrainAt(s, u.x, u.y) === 'trees'; }

// ---------------------------------------------------------------- combat

function rangeOk(s, attacker, defender) {
  const t = typeOf(s, attacker); const d = manhattan(attacker, defender);
  const bonus = t.weapon === 'ranged' ? rangeBonus(s, attacker) : 0;
  return d >= (t.rangeMin || 1) && d <= (t.rangeMax || 1) + bonus;
}

// Build one side's roll. role: 'attacker' | 'defender'.
function buildRoll(s, unit, role, ctx) {
  const t = typeOf(s, unit), o = officerOf(s, unit), f = formationOf(s, unit), p = passive(s, unit);
  const other = role === 'attacker' ? ctx.defender : ctx.attacker;
  const of = formationOf(s, other);
  const dice = yinYang();
  const parts = [['Yin/Yang (' + dice.yin + ' vs ' + dice.yang + ')', dice.value]];
  parts.push(['Command', o ? o.command : 0]);
  parts.push(['Fire', o ? o.fire : 0]);
  parts.push(['Skill (' + t.skill + ')', o ? (o.skills && o.skills[t.skill]) || 0 : 0]);
  parts.push(['Unit Value', t.unitValue || 0]);

  if (role === 'attacker') {
    if (f.noAttackerBonus) parts.push(['Attacker bonus (lost: ' + f.name + ')', 0]);
    else if (ctx.ranged && unit.round.moved && !trait(unit, 'moving shot')) parts.push(['Attacker bonus (lost: moved before shooting)', 0]);
    else parts.push(['Attacker bonus', 2]);
    if (!ctx.ranged && f.frontMelee && isFront(s, other, unit)) parts.push(['Formation front (' + f.name + ')', f.frontMelee]);
    if (ctx.charge) parts.push(['Cavalry charge (' + ctx.tilesMoved + ' tile' + (ctx.tilesMoved === 1 ? '' : 's') + ' moved' + (ctx.fierce >= 2 ? ', ' + FIERCE_NAMES[ctx.fierce] : '') + ')', ctx.chargeBonus]);
    if (ctx.charge && ctx.fierce === 1) parts.push(['Fierce Charge', 1]);
    if (ctx.charge && f.chargeBonus) parts.push(['Formation charge bonus (' + f.name + ')', f.chargeBonus]);
    if (ctx.charge && p.chargeAttackBonus) parts.push(['Officer passive: charge', p.chargeAttackBonus]);
    if (f.atkMod) parts.push(['Attack (' + f.name + ')', f.atkMod]); // attack modifiers only count when attacking
    if (ctx.hybridMelee) parts.push(['Hybrid: melee attack', -2]);
    if (ctx.second) parts.push(['Second attack (Dual Weapons)', -2]);
    if (trait(unit, 'hefty weapon') && unit.round.moved) parts.push(['Hefty Weapon (moved)', -2]);
    if (!unit.round.moved && trait(unit, 'precision')) parts.push(['Precision', tierVal(trait(unit, 'precision'), [2, 4])]);
    if (trait(unit, 'swarm') && liveUnits(s).some(o => o !== unit && friendly(o, unit) && manhattan(o, other) === 1))
      parts.push(['Swarm', tierVal(trait(unit, 'swarm'), [1, 2])]);
    if (trait(unit, 'volley fire') && other.round && other.round.hitByRanged) parts.push(['Volley Fire', 1]);
    if (ctx.chargeCancelled) parts.push(['Charge bonus (cancelled: ' + of.name + ')', 0]);
    if (ctx.rear) parts.push(['Rear attack', 2]);
    if (ctx.rear && of.rearAtk) parts.push(['Rear attack vs ' + of.name, of.rearAtk]);
    if (ctx.ambush) parts.push(['Attacking from hiding', 2]);
    for (const tc of tacticsOn(s, unit, ['attack', 'flanking', 'ambush', 'cavalryCharge'])) parts.push(['Tactic: ' + tacticDef(tc.key).name, 2]);
    if (ctx.ranged && hasTactic(s, unit, 'divineWinds')) parts.push(['Tactic: Divine Winds', 2]);
    if (unit.round.moved && hasTactic(s, unit, 'clearPath')) parts.push(['Tactic: Clear a Path (attacking after moving)', 8]);
    if (ctx.phoenixWon) parts.push(['Tactic: Fury of a Phoenix (won the first attack)', 1]);
  } else {
    // Defense bonuses: everything that makes a unit harder to hit is added to the defender's roll
    if (!ctx.ranged && unit.round.holding) parts.push(['Holding: melee defense', 2]); // Hold doesn't help against ranged attacks
    if (!ctx.ranged && unit.round.holding && trait(unit, 'brace')) parts.push(['Brace: melee defense', 2]);
    if (ctx.ranged && trait(unit, 'shielded')) parts.push(['Shielded: ranged defense', tierVal(trait(unit, 'shielded'), [2, 4, 6])]);
    if (ctx.ranged && trait(unit, 'shield battery') && fx(unit).stillLast) parts.push(['Shield Battery: ranged defense', 2]);
    if (fx(unit).poison) parts.push(['Poisoned: melee & ranged defense', -fx(unit).poison]);
    if (f.defAll) parts.push(['Melee & ranged defense (' + f.name + ')', f.defAll]);
    if (ctx.ranged && f.defRanged) parts.push(['Ranged defense (' + f.name + ')', f.defRanged]);
    if (!ctx.ranged && f.defMelee) parts.push(['Melee defense (' + f.name + ')', f.defMelee]);
    if (f.defFront && isFront(s, ctx.attacker, unit)) parts.push(['Defense from the front (' + f.name + ')', f.defFront]);
    if (!ctx.ranged && f.frontMelee && isFront(s, ctx.attacker, unit)) parts.push(['Formation front vs melee (' + f.name + ')', f.frontMelee]);
    if (hasTactic(s, unit, 'defend')) parts.push(['Tactic: Defend (melee & ranged defense)', 2]);
    if (ctx.ranged && t.weapon === 'ranged' && hasTactic(s, unit, 'divineWinds')) parts.push(['Tactic: Divine Winds (ranged defense)', 2]);
    if (unit.round.holding && s.tactics && s.tactics.placed.some(tc => tc.key === 'holdTheLine' && tc.side === unit.side && tacticLive(s, tc) &&
      tc.anchor && (tc.anchor === unit.id || (unitById(s, tc.anchor) && manhattan(unitById(s, tc.anchor), unit) === 1))))
      parts.push(['Tactic: Hold the Line (' + (ctx.ranged ? 'ranged' : 'melee') + ' defense)', ctx.ranged ? 2 : 3]);
  }
  if (hasTactic(s, unit, 'heroNeeded')) parts.push(['Tactic: A Hero is Needed', 4]);
  if (hasTactic(s, unit, 'warrior1000')) parts.push(['Tactic: A Warrior Worth 1000', 5]);
  if (hasTactic(s, unit, 'fear')) parts.push(['Tactic: Surrounded by Fear', 4]);

  const oc = (typeOf(s, other) || {}).category;
  if (oc === 'cavalry' && trait(unit, 'anti-cavalry')) parts.push(['Anti-Cavalry', tierVal(trait(unit, 'anti-cavalry'), [1, 2, 4])]);
  if (oc === 'infantry' && trait(unit, 'anti-infantry')) parts.push(['Anti-Infantry', tierVal(trait(unit, 'anti-infantry'), [1, 2, 4])]);
  const ms = moraleState(unit.morale);
  if (ms === 'Encouraged') parts.push(['Encouraged', 2]);
  const steady = p.ignoreMoralePenalty ? 'officer passive' : trait(unit, 'unwavering') ? 'Unwavering' : null;
  if (ms === 'Demoralized') parts.push(['Demoralized' + (steady ? ' (ignored: ' + steady + ')' : ''), steady ? 0 : -2]);
  // Strength penalties scale with the unit's full health (cavalry have 50)
  const full = unit.maxMen || 100;
  // Strength penalties follow the soldier figures on the token (one per 20% of full strength):
  // 2 soldiers left (21-40%) -1, 1 soldier left (1-20%) -2
  const figures = soldierFigures(unit.men, full);
  if (figures === 1) parts.push(['One soldier left (1-20% strength)', -2]);
  else if (figures === 2) parts.push(['Two soldiers left (21-40% strength)', -1]);
  for (const m of unit.mods || []) parts.push(['Modifier: ' + m.label, Number(m.value) || 0]);

  const total = parts.reduce((a, [, v]) => a + v, 0);
  return { total, parts, dice };
}

const FIERCE_NAMES = ['', 'Fierce Charge', 'Fierce Charge+', 'Fierce Charge++'];

/** Soldier figures a unit shows: one per 20% of its full strength (matches the token). */
function soldierFigures(men, full) {
  if (!(men > 0)) return 0;
  return Math.max(1, Math.min(5, Math.ceil((5 * men) / (full || 100) - 1e-9)));
}

function damageValue(s, u) { // formation damage modifier applies to the unit's damage value
  const t = typeOf(s, u), f = formationOf(s, u);
  return Math.max(0, (t.damage || 0) + (f.dmgMod || 0));
}

// Resolve an attack. Returns a result object (also logged). Mutates state.
function resolveAttack(s, attacker, defender, opts) {
  const at = typeOf(s, attacker), dt = typeOf(s, defender);
  // Hybrid: a ranged unit may fight an adjacent enemy in melee (Attack -2)
  const hybridMelee = at.weapon === 'ranged' && !!trait(attacker, 'hybrid') && manhattan(attacker, defender) === 1;
  const ranged = at.weapon === 'ranged' && !hybridMelee;
  // Charge: a cavalry unit's melee attack gains +1 for every 2 tiles it moved this turn (rounded down)
  const tilesMoved = opts.movedThisActivation ? (opts.tilesMoved || 0) : 0;
  // Fierce Charge trait: 1 = +1 on a charge; 2 (+) and 3 (++) = +1 per tile instead of per 2; 3 also doubles morale loss on a win
  const fierce = attacker.fierceCharge || 0;
  const dfF = formationOf(s, defender);
  const rawCharge = !ranged && at.category === 'cavalry' ? Math.floor(fierce >= 2 ? tilesMoved : tilesMoved / 2) : 0;
  const chargeCancelled = rawCharge > 0 && !!dfF.noChargeBonus; // e.g. Spear Wall, Hollowed Square
  const chargeBonus = chargeCancelled ? 0 : rawCharge;
  const charge = chargeBonus > 0;
  const df = formationOf(s, defender);
  let rear = isRear(s, attacker, defender) && !df.noRear && !passive(s, defender).noRearAgainst;
  const ambush = !!opts.ambush;
  const free = !!opts.free; // a tactic's free attack: no strike back, doesn't use the unit's action
  const ctx = { attacker, defender, ranged, charge, chargeBonus, chargeCancelled, tilesMoved, fierce, rear, ambush, hybridMelee, second: !!opts.second, phoenixWon: !!opts.phoenixWon };
  // Tactics this attack sets off (they count for this attack already)
  let allOut = [];
  if (!opts.noTactics) {
    fireTactics(s, 'attack', attacker);
    fireTactics(s, 'attacked', defender);
    fireTactics(s, ranged ? 'rangedAttack' : 'meleeAttack', attacker);
    if (rear) fireTactics(s, 'rearAttack', attacker);
    if (ambush) fireTactics(s, 'ambush', attacker);
    if (charge) fireTactics(s, 'charge', attacker);
    if (heroOfficer(s, attacker)) fireTactics(s, 'heroAttack', attacker);
    if (liveUnits(s).some(o => o !== attacker && o.side === attacker.side && manhattan(o, defender) === 1)) allOut = fireTactics(s, 'flankedAttack', attacker);
  }

  const A = buildRoll(s, attacker, 'attacker', ctx);
  const D = buildRoll(s, defender, 'defender', ctx);
  const diff = Math.abs(A.total - D.total);
  const winner = A.total > D.total ? 'attacker' : D.total > A.total ? 'defender' : null;
  const aNeg = A.total <= 0, dNeg = D.total <= 0;

  // Who deals damage
  let dmgToDef = 0, dmgToAtt = 0;
  const base = (u) => damageValue(s, u);
  const winBonus = (side) => (winner === side ? diff : 0);
  if (!ranged) {
    if (!aNeg) dmgToDef = base(attacker) + winBonus('attacker');
    // ranged defenders deal no return damage against melee attackers
    if (!dNeg && (dt.weapon !== 'ranged' || trait(defender, 'hybrid'))) dmgToAtt = base(defender) + winBonus('defender');
    if (ambush) dmgToAtt = 0; // attacked from hiding: the defender rolls but can't strike back
  } else {
    if (!aNeg && winner === 'attacker') dmgToDef = base(attacker) + diff;
    const canReturn = dt.weapon === 'ranged' ? rangeOk(s, defender, attacker)
      : manhattan(attacker, defender) === 1;
    if (!dNeg && canReturn) dmgToAtt = base(defender) + winBonus('defender');
    if (ambush) dmgToAtt = 0;
  }
  if (free) dmgToAtt = 0;
  // Winning the exchange while defending: Counter-Attack and Charge Reflection hit back harder
  if (winner === 'defender' && dmgToAtt > 0) {
    dmgToAtt += tierVal(trait(defender, 'counter-attack'), [2, 4]);
    if (charge && trait(defender, 'charge reflection')) dmgToAtt += chargeBonus;
  }
  if (trait(attacker, 'duelist')) dmgToAtt = 0; // Duelist: ignores counter-strike damage

  // Casualties = damage - (armor reduced by the other side's armor penetration) - formation damage reduction.
  // Armor is also lowered by Sunder, and Shield Breaker ignores the armor a unit gets from shields.
  const af = formationOf(s, attacker);
  const armorOf = (t, u, breaker) => Math.max(0, (t.armor ?? t.defense ?? 0) - (fx(u).sunder || 0) - (breaker ? (t.shieldArmor || 0) : 0));
  const casDef = Math.max(0, dmgToDef - Math.max(0, armorOf(dt, defender, trait(attacker, 'shield breaker')) - (at.armorPen || 0)) - (df.casReduce || 0));
  const casAtt = Math.max(0, dmgToAtt - Math.max(0, armorOf(at, attacker, trait(defender, 'shield breaker')) - (dt.armorPen || 0)) - (af.casReduce || 0));

  // Morale loss for the loser
  let moraleLoss = 0, mult = 1, loser = null;
  if (winner) {
    loser = winner === 'attacker' ? defender : attacker;
    moraleLoss = diff;
    if (winner === 'attacker') {
      // a charge alone doesn't multiply morale loss; rear attacks and Fierce Charge++ double it (both: x3)
      const fierceDouble = charge && fierce >= 3;
      if (rear && fierceDouble) mult = 3; else if (rear || fierceDouble) mult = 2;
      moraleLoss = diff * mult + (passive(s, attacker).extraMoraleLossOnWin || 0);
      const terror = trait(attacker, 'terror'); // Terror: +2 morale loss; Terror+: double it
      if (terror === 1) moraleLoss += 2; else if (terror >= 2) moraleLoss *= 2;
    } else {
      moraleLoss = diff + (passive(s, defender).extraMoraleLossOnWin || 0);
    }
    if (trait(loser, 'fragile')) moraleLoss += 5;
  }

  // Apply simultaneously
  const menBefore = { d: defender.men, a: attacker.men };
  defender.men = Math.max(0, defender.men - casDef);
  attacker.men = Math.max(0, attacker.men - casAtt);
  if (loser) loser.morale = clamp(loser.morale - moraleLoss, 0, 100);

  // Lasting effects of a successful attack (the attacker won the roll)
  if (winner === 'attacker') {
    const pz = trait(attacker, 'poison'), sd = trait(attacker, 'sunder');
    if (pz) fx(defender).poison = Math.max(fx(defender).poison || 0, tierVal(pz, [1, 2]));   // doesn't stack; Poison+ replaces Poison
    if (sd) fx(defender).sunder = Math.max(fx(defender).sunder || 0, tierVal(sd, [2, 4]));   // doesn't stack; Sunder+ replaces Sunder
  }
  if (casDef > 0 && trait(attacker, 'barbed arrows')) fx(defender).slow = true;          // -1 movement on its next turn
  if (ranged) defender.round.hitByRanged = true;                                          // for Volley Fire
  if (trait(attacker, 'reload')) fx(attacker).reload = 'empty';                           // must take the Reload action before attacking again

  // Facing and memory for this round (a free attack doesn't use up the unit's attack)
  if (!free) attacker.round.attacked = true;
  if (!ranged) {
    attacker.round.meleeTarget = defender.id;
    defender.round.meleeAttacker = attacker.id;
    faceToward(attacker, defender);
    if (!defender.round.meleeTarget) faceToward(defender, attacker);
  }
  if (attacker.hidden) attacker.hidden = false;

  const result = {
    attacker: attacker.id, defender: defender.id, ranged, charge, rear, ambush,
    attackRoll: A, defendRoll: D, diff, winner,
    damageToDefender: dmgToDef, damageToAttacker: dmgToAtt,
    casualtiesDefender: casDef, casualtiesAttacker: casAtt,
    moraleLoss, moraleMultiplier: mult, loser: loser ? loser.id : null,
  };
  const tags = [ranged ? 'ranged' : 'melee', charge && 'cavalry charge', rear && 'rear', ambush && 'from hiding', free && 'free attack'].filter(Boolean).join(', ');
  const wtxt = winner ? (winner === 'attacker' ? attacker.name : defender.name) + ' wins by ' + diff : 'Tie';
  log(s, attacker.name + ' attacks ' + defender.name + ' (' + tags + '): ' + A.total + ' vs ' + D.total + '. ' + wtxt +
    '. Casualties: ' + defender.name + ' -' + casDef + ', ' + attacker.name + ' -' + casAtt +
    (loser ? '. ' + loser.name + ' loses ' + moraleLoss + ' morale' + (mult > 1 ? ' (x' + mult + ')' : '') : '') + '.',
    { type: 'attack', result });

  // XP: casualties inflicted x (enemy tier / own tier), rounded down
  // (only the men the enemy actually had count)
  result.xpAttacker = gainXp(s, attacker, (menBefore.d - defender.men) * (dt.tier || 1) / (at.tier || 1), 'casualties dealt');
  result.xpDefender = gainXp(s, defender, (menBefore.a - attacker.men) * (at.tier || 1) / (dt.tier || 1), 'casualties dealt');
  // Killing blows: morale 5 x enemy tier, XP 25 x (enemy tier / own tier)
  if (defender.men <= 0 && attacker.men > 0) { result.killedBy = attacker.id; result.killMorale = trait(defender, 'expendable') ? 0 : gainMorale(s, attacker, 5 * (dt.tier || 1), 'killing blow'); result.xpAttacker += gainXp(s, attacker, 25 * (dt.tier || 1) / (at.tier || 1), 'killing blow'); }
  if (result.killedBy === attacker.id) killTactics(s, attacker, defender);
  if (attacker.men <= 0 && defender.men > 0) { result.killedBy = defender.id; result.killMorale = trait(attacker, 'expendable') ? 0 : gainMorale(s, defender, 5 * (at.tier || 1), 'killing blow'); result.xpDefender += gainXp(s, defender, 25 * (at.tier || 1) / (dt.tier || 1), 'killing blow'); }
  if (result.killedBy === defender.id) killTactics(s, defender, attacker);
  settle(s);
  // All Out Attack: every unit of the side in the area that can reach the enemy attacks it for free
  for (const tc of allOut) {
    for (const o of liveUnits(s)) {
      if (!alive(defender)) break;
      if (o === attacker || o.side !== tc.side || !inTacticArea(tc, o) || !rangeOk(s, o, defender) || !visibleTo(s, defender, alliance(o.side))) continue;
      resolveAttack(s, o, defender, { free: true, noTactics: true });
    }
  }
  return result;
}

/** Tactics set off when `killer` destroys `victim`: Brutalize, Inspiring the Army. */
function killTactics(s, killer, victim) {
  for (const tc of fireTactics(s, 'destroy', killer)) {
    for (const o of liveUnits(s)) if (o.men > 0 && alliance(o.side) !== alliance(tc.side) && inTacticArea(tc, o)) o.morale = clamp(o.morale - 25, 0, 100);
    log(s, 'Brutalize: enemy units in the area lose 25 morale.');
  }
  if (killer.officerId && victim.officerId) for (const tc of fireTactics(s, 'officerKill', killer)) {
    for (const o of liveUnits(s)) if (o.men > 0 && o.side === tc.side) o.morale = clamp(o.morale + 25, 0, 100);
    log(s, 'Inspiring the Army: every ' + SIDE_LABEL[tc.side].toLowerCase() + ' unit gains 25 morale.');
  }
}

const XP_PER_LEVEL = 100;
function gainXp(s, u, amount, why) {
  if (u.side !== 'player' || trait(u, 'mercenary')) return 0; // only Player units earn XP; Mercenaries never do
  const n = Math.floor(amount);
  if (n <= 0) return 0;
  u.xp = (u.xp || 0) + n;
  log(s, u.name + ' gains ' + n + ' XP (' + why + ').', { type: 'xp', unit: u.id, amount: n });
  // Every 100 XP is a level (tier doesn't change; levels feed the promotion tree later)
  while (u.xp >= XP_PER_LEVEL) {
    u.xp -= XP_PER_LEVEL;
    u.level = (u.level || 1) + 1;
    log(s, u.name + ' reaches level ' + u.level + '!', { type: 'levelUp', unit: u.id, level: u.level });
  }
  return n;
}

function gainMorale(s, u, n, why) {
  const before = u.morale;
  u.morale = clamp(u.morale + n, 0, 100); // kill morale may exceed the 75 regen cap
  log(s, u.name + ' gains ' + (u.morale - before) + ' morale (' + why + ').', { type: 'moraleGain', unit: u.id });
  return u.morale - before;
}

// Apply defeats, surrenders, adjacency penalties and encirclement until stable.
function settle(s, opts = {}) {
  s._settleDepth = (s._settleDepth || 0) + 1;
  try { settleLoop(s, opts); } finally { s._settleDepth--; }
  if (!s._settleDepth) { processFear(s); delete s._settleDepth; }
}
function settleLoop(s, opts) {
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const u of liveUnits(s)) {
      let ended = null;
      if (u.men <= 0) { u.status = 'defeated'; ended = 'is destroyed'; }
      else if (u.morale <= 0 && !hasTactic(s, u, 'fear')) { u.status = 'surrendered'; ended = 'surrenders'; } // Surrounded by Fear: never surrenders
      if (!ended) continue;
      changed = true;
      log(s, u.name + ' ' + ended + '.', { type: 'defeat', unit: u.id });
      if (u.status === 'surrendered') surrenderTactics(s, u);
      for (const tc of s.tactics ? s.tactics.placed : []) if (tc.key === 'fear' && tc.unitId === u.id && tc.state === 'active') tc.state = 'spent';
      removeFromTurn(s, u.id);
      for (const n of liveUnits(s)) {
        if (friendly(n, u) && manhattan(n, u) === 1) {
          n.morale = clamp(n.morale - 5, 0, 100);
          log(s, n.name + ' loses 5 morale (adjacent ally ' + ended.replace('is ', '') + ').');
        }
      }
    }
    // a normal (undoable) move waits: encirclement is only applied once the move is committed
    if (!opts.deferEncirclement && checkEncirclement(s)) changed = true;
    if (!changed) return;
  }
}

/** Surround the Enemy: a surrender in its square costs every enemy unit 5 morale (10 if it had an officer). */
function surrenderTactics(s, v) {
  const T = s.tactics; if (!T || T.phase !== 'battle') return;
  for (const tc of T.placed) {
    if (tc.key !== 'surround' || alliance(tc.side) === alliance(v.side) || !inTacticArea(tc, v)) continue;
    if (tc.state === 'hidden') triggerTactic(s, tc, null); else if (!tacticLive(s, tc)) continue;
    const n = v.officerId ? 10 : 5;
    for (const o of liveUnits(s)) if (alliance(o.side) !== alliance(tc.side)) o.morale = clamp(o.morale - n, 0, 100);
    log(s, 'Surround the Enemy: every enemy unit loses ' + n + ' morale.');
  }
}

/** Surrounded by Fear: the unit strikes its attackers for free until one of them is destroyed. */
function processFear(s) {
  const q = s._fearQueue; delete s._fearQueue;
  for (const id of q || []) {
    const u = unitById(s, id);
    for (let i = 0; i < 12 && u && alive(u); i++) {
      const foes = liveUnits(s).filter(o => hostile(o, u) && manhattan(o, u) === 1).sort((a, b) => a.men - b.men);
      if (!foes.length) break;
      resolveAttack(s, u, foes[0], { free: true, noTactics: true });
      if (!alive(foes[0])) {
        for (const tc of s.tactics.placed) if (tc.key === 'fear' && tc.unitId === u.id) tc.state = 'spent';
        log(s, u.name + ' breaks out: Surrounded by Fear ends.');
        break;
      }
    }
  }
}

function checkEncirclement(s) {
  let changed = false;
  for (const u of liveUnits(s)) {
    let enemies = 0, open = 0;
    for (const [dx, dy] of ORTHO) {
      const x = u.x + dx, y = u.y + dy;
      if (!passable(s, x, y)) continue;
      const o = unitAt(s, x, y);
      if (o && hostile(o, u)) enemies++; else open++;
    }
    // surrounded: every side blocked by an enemy or by impassable ground, with at least one enemy
    const surrounded = enemies >= 1 && open === 0;
    if (surrounded && !u.surrounded) {
      u.surrounded = true;
      if (fireTactics(s, 'surrounded', u).length || hasTactic(s, u, 'fear')) {
        log(s, u.name + ' is surrounded but will not surrender!');
        (s._fearQueue = s._fearQueue || []).push(u.id);
      } else if (passive(s, u).ignoreEncirclement) log(s, u.name + ' is surrounded but its officer ignores the morale loss.');
      else { u.morale = clamp(u.morale - 50, 0, 100); log(s, u.name + ' is fully surrounded: -50 morale.', { type: 'surrounded', unit: u.id }); changed = true; }
    } else if (!surrounded && u.surrounded) u.surrounded = false;
  }
  return changed;
}

function removeFromTurn(s, id) {
  const t = s.turn;
  t.held = t.held.filter(x => x !== id);
  if (t.activation && t.activation.unitId === id) { t.activation = null; t.pendingFinish = id; }
}

// ---------------------------------------------------------------- turn system

function hasOfficer(u) { return !!u.officerId; }
function rankOf(s, id) { const i = s.turn.order.indexOf(id); return i < 0 ? Infinity : i; }

function rollInitiative(s) {
  const t = s.turn; t.init = {};
  const officers = liveUnits(s).filter(hasOfficer);
  for (const u of officers) {
    const o = officerOf(s, u); const d = yinYang();
    t.init[u.id] = { total: d.value + (o ? o.fire : 0), yin: d.yin, yang: d.yang, fire: o ? o.fire : 0, tiebreak: rng() };
  }
  const sideRank = u => (u.side === 'player' ? 0 : 1);
  officers.sort((a, b) => {
    const A = t.init[a.id], B = t.init[b.id];
    return (B.total - A.total) || (B.fire - A.fire) || (sideRank(a) - sideRank(b)) || (A.tiebreak - B.tiebreak);
  });
  t.order = officers.map(u => u.id);
  log(s, 'Round ' + t.round + ' initiative: ' + officers.map(u => u.name + ' ' + t.init[u.id].total).join(', ') +
    (officers.length ? '' : '(no officers)') + '.');
}

// What the game is waiting for right now.
// Returns { kind, unitId?, side?, rank } where kind is one of:
//  'setup' | 'formations' | 'decide' (act/hold) | 'final' (act/forfeit) |
//  'claim' (player side officerless) | 'host-pick' (enemy/ally officerless) |
//  'pick' (claimer picks a unit) | 'activation' | 'idle'
function prompt(s) {
  const t = s.turn;
  if (t.phase === 'setup') return { kind: 'setup', rank: -1 };
  if (t.phase === 'tactics') return { kind: 'tactics', rank: -1 };
  if (t.phase === 'formations') return { kind: 'formations', rank: -1 };
  if (t.activation) {
    const u = unitById(s, t.activation.unitId);
    return { kind: 'activation', unitId: t.activation.unitId, rank: hasOfficer(u) ? rankOf(s, u.id) : Infinity };
  }
  if (t.phase === 'officer') {
    const id = t.order.find(id => !t.decided.includes(id) && alive(unitById(s, id)));
    if (id !== undefined) return { kind: 'decide', unitId: id, rank: rankOf(s, id) };
    return { kind: 'idle', rank: Infinity };
  }
  if (t.phase === 'officerless') {
    const side = currentOfficerlessSide(s);
    if (!side) return { kind: 'idle', rank: Infinity };
    if (side === 'player') return t.claim ? { kind: 'pick', side, player: t.claim, rank: Infinity } : { kind: 'claim', side, rank: Infinity };
    return { kind: 'host-pick', side, rank: Infinity };
  }
  if (t.phase === 'final') {
    const id = finalQueue(s)[0];
    if (id !== undefined) return { kind: 'final', unitId: id, rank: rankOf(s, id) };
    return { kind: 'idle', rank: Infinity };
  }
  return { kind: 'idle', rank: Infinity };
}

function officerlessRemaining(s, side) {
  return liveUnits(s).filter(u => !hasOfficer(u) && u.side === side && !u.round.activated);
}
function currentOfficerlessSide(s) {
  for (let i = 0; i < SIDES.length; i++) {
    const side = SIDES[(s.turn.sideIdx + i) % SIDES.length];
    if (officerlessRemaining(s, side).length) return side;
  }
  return null;
}
function finalQueue(s) {
  // held officers, lowest initiative first
  return s.turn.held.filter(id => alive(unitById(s, id))).sort((a, b) => rankOf(s, b) - rankOf(s, a));
}

// Move the turn forward through empty phases.
function advance(s) {
  const t = s.turn;
  for (let guard = 0; guard < 20; guard++) {
    if (t.activation) return;
    const p = prompt(s);
    if (p.kind !== 'idle') return;
    if (t.phase === 'officer') { t.phase = 'officerless'; t.sideIdx = 0; t.claim = null; log(s, 'Officer-less phase.'); continue; }
    if (t.phase === 'officerless') { t.phase = 'final'; if (t.held.length) log(s, 'Final pass for held officers.'); continue; }
    if (t.phase === 'final') { endRound(s); return; }
    return;
  }
}

function endRound(s) {
  const next = s.turn.round + 1;
  // Inspiration: at the end of the round, allied units next to it gain 4 morale
  for (const u of liveUnits(s)) if (trait(u, 'inspiration')) {
    for (const o of liveUnits(s)) if (o !== u && friendly(o, u) && manhattan(o, u) === 1 && o.morale < 100) {
      o.morale = Math.min(100, o.morale + 4);
      log(s, o.name + ' gains 4 morale (Inspiration from ' + u.name + ').');
    }
  }
  log(s, 'Round ' + s.turn.round + ' ends.');
  for (const tc of s.tactics ? s.tactics.placed : []) if (tc.state === 'active' && tc.untilRound !== undefined && tc.untilRound < next) tc.state = 'spent';
  s.turn = freshTurn('formations', next);
  for (const u of s.units) u.round = newRoundFlags();
  log(s, 'Round ' + next + ': declare formations.');
}

function startActivation(s, u, extra) {
  s.turn.activation = Object.assign({ unitId: u.id, step: 'move', started: false, startedHidden: !!u.hidden,
    movedThisActivation: false, tilesMoved: 0, forcedMarched: false, interject: false }, extra || {});
}

function finishActivation(s, u) {
  const t = s.turn;
  // End-of-turn morale regen for units with an officer (up to 75)
  const o = officerOf(s, u);
  if (o && alive(u) && u.morale < 75) {
    const before = u.morale;
    u.morale = Math.min(75, u.morale + o.fire + o.command);
    if (u.morale !== before) log(s, u.name + ' regains ' + (u.morale - before) + ' morale (officer Fire + Command).');
  }
  if (alive(u)) {
    const f = fx(u);
    f.stillLast = !u.round.moved;                       // Shield Battery, Range Up: "ended its last turn without moving"
    delete f.slow;                                      // Barbed Arrows lasts one turn
  }
  // Stealth: ending the turn in a forest hides the unit; ending it next to a hostile unit reveals it
  if (alive(u)) {
    // a unit can only go into hiding with no enemy troops next to it
    if (hidesIn(s, u) && !hostileAdjacent(s, u)) u.hidden = true;
    if (u.hidden && hostileAdjacent(s, u)) {
      u.hidden = false;
      log(s, u.name + ' is spotted (ended its turn next to an enemy).', { type: 'revealed', unit: u.id });
    }
  } else u.hidden = false;
  if (t.pendingFinish === u.id) t.pendingFinish = null;
  bookkeep(s, u);
  t.activation = null;
  if (alive(u)) log(s, u.name + ' ends its turn.');
  settle(s);
  advance(s);
}

// Mark a unit's turn as used and move the rotation on.
function bookkeep(s, u) {
  const t = s.turn;
  u.round.activated = true;
  if (hasOfficer(u)) {
    if (!t.decided.includes(u.id)) t.decided.push(u.id);
    t.held = t.held.filter(x => x !== u.id);
  } else {
    t.sideIdx = (SIDES.indexOf(u.side) + 1) % SIDES.length;
    t.claim = null;
  }
}

// ---------------------------------------------------------------- actions

// actor: { id: playerId | 'host', host: bool }
function controls(s, actor, u) {
  if (!u) return false;
  if (actor.host) return true;
  return u.owner === actor.id;
}

const ok = (extra) => Object.assign({ ok: true }, extra || {});
const err = (error) => ({ ok: false, error });

function act(s, actor, a) {
  try {
    const fn = ACTIONS[a && a.type];
    if (!fn) return err('Unknown action');
    const hostOnly = HOST_ONLY.has(a.type);
    if (hostOnly && !actor.host) return err('Only the host can do that');
    const res = fn(s, actor, a) || ok();
    if (res.ok && s.turn.activation && a.type !== 'moveTo' && a.type !== 'undoMove') delete s.turn.activation.undo;
    // A unit that died during its own turn still hands the turn on.
    if (s.turn.pendingFinish) {
      const u = unitById(s, s.turn.pendingFinish); s.turn.pendingFinish = null;
      if (u) bookkeep(s, u);
      advance(s);
    }
    return res;
  } catch (e) {
    return err('Rules error: ' + e.message);
  }
}

const HOST_ONLY = new Set(['setHidden', 'setMap', 'paintTerrain', 'setLibrary', 'addUnit', 'editUnit', 'removeUnit',
  'startBattle', 'resetBattle', 'startRound', 'skipPrompt', 'addMod', 'removeMod', 'adjust', 'setFacing',
  'setTactician', 'finishTactics', 'skipTactics']);

const ACTIONS = {
  // ---------- host / GM
  setMap(s, actor, a) {
    const m = s.map;
    for (const k of ['image', 'cols', 'rows', 'tile', 'offsetX', 'offsetY']) if (a[k] !== undefined) m[k] = a[k];
    m.cols = clamp(Math.round(m.cols) || 1, 1, 200); m.rows = clamp(Math.round(m.rows) || 1, 1, 200);
    m.tile = clamp(Number(m.tile) || 48, 8, 400);
  },
  paintTerrain(s, actor, a) {
    if (!data.TERRAIN[a.terrain]) return err('Unknown terrain');
    for (const [x, y] of a.cells || []) {
      if (!inBounds(s, x, y)) continue;
      if (a.terrain === 'flat') delete s.map.terrain[x + ',' + y]; else s.map.terrain[x + ',' + y] = a.terrain;
    }
  },
  setLibrary(s, actor, a) {
    if (!['unitTypes', 'officers', 'formations'].includes(a.key) || !Array.isArray(a.data)) return err('Bad library data');
    for (const item of a.data) if (!item || typeof item.id !== 'string') return err('Every entry needs a string "id"');
    s.library[a.key] = a.data;
    log(s, 'Host updated the ' + a.key + ' library.');
  },
  addUnit(s, actor, a) {
    const t = s.library.unitTypes.find(x => x.id === a.typeId); if (!t) return err('Unknown unit type');
    if (a.officerId && !s.library.officers.find(o => o.id === a.officerId)) return err('Unknown officer');
    if (!SIDES.includes(a.side)) return err('Bad side');
    if (!inBounds(s, a.x, a.y) || unitAt(s, a.x, a.y)) return err('Tile is occupied or off the map');
    const o = a.officerId ? s.library.officers.find(o => o.id === a.officerId) : null;
    const u = {
      id: 'u' + s.nextUnitId++, typeId: t.id, officerId: a.officerId || null,
      name: a.name || (o ? o.name + "'s " : '') + t.name,
      side: a.side, owner: a.owner || null, x: a.x, y: a.y, men: 100,
      morale: a.morale !== undefined ? clamp(a.morale, 0, 100) : 50,
      formation: 'none', facing: { dx: 0, dy: a.side === 'enemy' ? 1 : -1 }, hidden: false,
      status: 'active', mods: [], heroicUsed: 0, lastHeroic: null, surrounded: false, round: newRoundFlags(),
    };
    s.units.push(u);
    log(s, 'Host placed ' + u.name + ' (' + u.side + ').');
    return ok({ unitId: u.id });
  },
  editUnit(s, actor, a) {
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    const p = a.patch || {};
    for (const k of ['name', 'typeId', 'officerId', 'side', 'owner', 'men', 'morale', 'formation', 'hidden', 'status']) {
      if (p[k] !== undefined) u[k] = p[k];
    }
    u.men = clamp(Number(u.men) || 0, 0, 999); u.morale = clamp(Number(u.morale) || 0, 0, 100);
    if (u.officerId === '') u.officerId = null;
    if (u.owner === '') u.owner = null;
    settle(s);
  },
  removeUnit(s, actor, a) {
    const i = s.units.findIndex(u => u.id === a.unitId); if (i < 0) return err('No such unit');
    removeFromTurn(s, a.unitId); s.turn.order = s.turn.order.filter(x => x !== a.unitId);
    log(s, 'Host removed ' + s.units[i].name + '.');
    s.units.splice(i, 1); advance(s);
  },
  adjust(s, actor, a) {
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    if (a.men) u.men = clamp(u.men + a.men, 0, 999);
    if (a.morale) u.morale = clamp(u.morale + a.morale, 0, 100);
    log(s, 'Host adjusted ' + u.name + (a.men ? ' men ' + (a.men > 0 ? '+' : '') + a.men : '') +
      (a.morale ? ' morale ' + (a.morale > 0 ? '+' : '') + a.morale : '') + (a.reason ? ' (' + a.reason + ')' : '') + '.');
    settle(s);
  },
  addMod(s, actor, a) {
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    u.mods.push({ id: 'm' + Date.now() + Math.floor(rng() * 1000), label: String(a.label || 'Modifier'), value: Number(a.value) || 0 });
    log(s, u.name + ' gains roll modifier ' + a.label + ' ' + (a.value > 0 ? '+' : '') + a.value + '.');
  },
  removeMod(s, actor, a) {
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    u.mods = u.mods.filter(m => m.id !== a.modId);
  },
  setFacing(s, actor, a) {
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    u.facing = { dx: sign(a.dx), dy: sign(a.dy) };
  },
  place(s, actor, a) { // sandbox placement: host any time; players their own units during setup
    const u = unitById(s, a.unitId); if (!u) return err('No such unit');
    if (!actor.host && !(s.turn.phase === 'setup' && controls(s, actor, u))) return err('You can only place your units during setup');
    if (!inBounds(s, a.x, a.y)) return err('Off the map');
    const o = unitAt(s, a.x, a.y); if (o && o !== u) return err('Tile occupied');
    u.x = a.x; u.y = a.y; settle(s);
  },
  startBattle(s) {
    if (s.turn.phase !== 'setup') return err('Battle already started');
    // Tactics come first: before formations, initiative or anything else
    s.turn = freshTurn('tactics', 1);
    s.tactics = { phase: 'setup', sides: { player: null, ally: null, enemy: null }, placed: [], nextId: 1 };
    for (const u of s.units) u.round = newRoundFlags();
    // Every unit starts facing the nearest enemy
    for (const u of liveUnits(s)) {
      const foes = liveUnits(s).filter(o => hostile(o, u)).sort((a, b) => manhattan(a, u) - manhattan(b, u));
      if (foes.length) {
        const f = foes[0], dx = f.x - u.x, dy = f.y - u.y;
        u.facing = Math.abs(dx) > Math.abs(dy) ? { dx: sign(dx), dy: 0 } : { dx: 0, dy: sign(dy) };
      }
    }
    log(s, 'Battle begins. Tacticians, choose your tactics.');
  },
  resetBattle(s) {
    s.turn = freshTurn('setup', 0);
    s.tactics = null;
    for (const u of s.units) u.round = newRoundFlags();
    log(s, 'Host returned to setup.');
  },
  startRound(s, actor) {
    if (s.turn.phase === 'tactics') ACTIONS.finishTactics(s, actor); // starting the round ends the tactics phase as it stands
    if (s.turn.phase !== 'formations') return err('Not in the formations step');
    s.turn.phase = 'officer'; s.turn.decided = []; s.turn.held = [];
    rollInitiative(s); advance(s);
  },
  skipPrompt(s) { // host safety valve: skip whoever the game is waiting on
    const p = prompt(s), t = s.turn;
    if (p.kind === 'activation') { const u = unitById(s, p.unitId); log(s, 'Host ended ' + u.name + "'s turn."); finishActivation(s, u); return; }
    if (p.kind === 'decide') { t.decided.push(p.unitId); t.held.push(p.unitId); log(s, 'Host made ' + unitById(s, p.unitId).name + ' hold.'); }
    else if (p.kind === 'final') { const u = unitById(s, p.unitId); u.round.activated = true; t.held = t.held.filter(x => x !== u.id); log(s, 'Host forfeited ' + u.name + "'s turn."); }
    else if (p.kind === 'claim' || p.kind === 'pick' || p.kind === 'host-pick') {
      for (const u of officerlessRemaining(s, p.side)) u.round.activated = true;
      t.claim = null; log(s, 'Host skipped the remaining ' + p.side + ' officer-less turns.');
    } else return err('Nothing to skip');
    advance(s);
  },

  // ---------- tactics phase (before the first round)
  setTactician(s, actor, a) { // a.tactician: { id, name, img, aow, kind: 'player'|'officer', userId } or null
    const T = s.tactics;
    if (!T || T.phase !== 'setup') return err('Tacticians are chosen before the battle starts');
    if (!TACTIC_SIDES.includes(a.side)) return err('Bad side');
    const tac = a.tactician || null;
    if (tac && a.side === 'player' && !(Number(tac.aow) >= 1)) return err(tac.name + ' has no Art of War, so cannot lead the player tactics');
    T.sides[a.side] = tac ? { id: tac.id, name: tac.name, img: tac.img || null, aow: Number(tac.aow) || 0, kind: tac.kind || 'officer', userId: tac.userId || null } : null;
    T.placed = T.placed.filter(p => p.side !== a.side); // a new tactician starts with a clean slate
  },
  placeTactic(s, actor, a) { // a: { side, key, x, y, id? (move an existing one), highGround? }
    const T = s.tactics;
    if (!T || T.phase !== 'setup') return err('Tactics are placed before the battle starts');
    if (!TACTIC_SIDES.includes(a.side)) return err('Bad side');
    const tac = T.sides[a.side], def = tacticDef(a.key);
    if (!def) return err('Unknown tactic');
    if (!tacticPlacer(s, actor, a.side)) return err('Only the tactician places these tactics');
    if (!inBounds(s, a.x, a.y)) return err('Off the map');
    const existing = a.id ? T.placed.find(p => p.id === a.id && p.side === a.side) : null;
    if (a.side === 'player') {
      if (!tac) return err('Choose a tactician first');
      if (def.aow > tac.aow) return err(def.name + ' needs Art of War ' + def.aow);
      const others = T.placed.filter(p => p.side === 'player' && p !== existing);
      if (others.length >= tac.aow + 1) return err('No tactics left to place (Art of War ' + tac.aow + ' + 1 = ' + (tac.aow + 1) + ')');
      if (others.some(p => p.key === a.key)) return err(def.name + ' is already placed');
    }
    if (def.highGround && !a.highGround) return err(def.name + ' must be placed on high ground (hill, city wall, fort or command tent)');
    if (existing) { existing.x = a.x; existing.y = a.y; return ok({ tacticId: existing.id }); }
    const id = 't' + T.nextId++;
    T.placed.push({ id, key: a.key, side: a.side, x: a.x, y: a.y, size: def.size, state: 'hidden', tactician: tac ? tac.name : null });
    return ok({ tacticId: id });
  },
  removeTactic(s, actor, a) {
    const T = s.tactics;
    if (!T || T.phase !== 'setup') return err('Tactics are placed before the battle starts');
    const p = T.placed.find(x => x.id === a.id); if (!p) return err('No such tactic');
    if (!tacticPlacer(s, actor, p.side)) return err('Only the tactician places these tactics');
    T.placed = T.placed.filter(x => x !== p);
  },
  finishTactics(s) {
    const T = s.tactics;
    if (s.turn.phase !== 'tactics' || !T) return err('Not in the tactics phase');
    T.phase = 'battle';
    s.turn.phase = 'formations';
    const n = T.placed.length;
    log(s, n ? n + ' tactic' + (n === 1 ? ' is' : 's are') + ' set. Round 1: declare formations.' : 'No tactics placed. Round 1: declare formations.');
  },
  skipTactics(s) {
    const T = s.tactics;
    if (s.turn.phase !== 'tactics' || !T) return err('Not in the tactics phase');
    T.placed = []; T.phase = 'battle';
    s.turn.phase = 'formations';
    log(s, 'Tactics skipped. Round 1: declare formations.');
  },

  // ---------- GM: hide or reveal a unit (abilities, landmarks, rulings)
  setHidden(s, actor, a) {
    const u = unitById(s, a.unitId);
    if (!u || !alive(u)) return err('No such unit');
    u.hidden = !!a.hidden;
    log(s, u.name + (u.hidden ? ' is now hidden.' : ' is revealed.'), { type: u.hidden ? 'hidden' : 'revealed', unit: u.id });
  },

  // ---------- formations
  setFormation(s, actor, a) {
    const u = unitById(s, a.unitId);
    if (!controls(s, actor, u)) return err('Not your unit');
    if (!['formations', 'setup', 'tactics'].includes(s.turn.phase) && !actor.host) return err('Formations are declared at the start of the round');
    const f = s.library.formations.find(f => f.id === a.formation); if (!f) return err('Unknown formation');
    const t = typeOf(s, u);
    if (t.formations && !t.formations.includes(f.id)) return err(t.name + " can't use " + f.name);
    u.formation = f.id;
  },
  ready(s, actor) {
    if (s.turn.phase !== 'formations') return err('Not in the formations step');
    s.turn.ready[actor.id] = true;
  },

  // ---------- turn order
  decide(s, actor, a) {
    const p = prompt(s), t = s.turn, u = unitById(s, a.unitId);
    if (!controls(s, actor, u)) return err('Not your unit');
    if (p.kind === 'decide' && p.unitId === u.id) {
      if (a.choice === 'act') { startActivation(s, u); return; }
      if (a.choice === 'hold') { t.decided.push(u.id); t.held.push(u.id); log(s, u.name + ' holds its turn.'); advance(s); return; }
    }
    if (p.kind === 'final' && p.unitId === u.id) {
      if (a.choice === 'act') { startActivation(s, u); return; }
      if (a.choice === 'forfeit') { u.round.activated = true; t.held = t.held.filter(x => x !== u.id); log(s, u.name + ' gives up its turn.'); advance(s); return; }
    }
    return err("It isn't that unit's decision right now");
  },
  claim(s, actor) {
    const p = prompt(s);
    if (p.kind !== 'claim') return err('No player-side turn to claim right now');
    const mine = officerlessRemaining(s, 'player').filter(u => controls(s, { id: actor.id, host: false }, u) || (actor.host && !u.owner));
    if (!mine.length) return err('You have no officer-less units left to move');
    s.turn.claim = actor.id;
    log(s, (actor.host ? 'Host' : (s.players[actor.id] || {}).name || 'A player') + ' claims the player-side turn.');
  },
  begin(s, actor, a) { // pick which officer-less unit takes the turn
    const p = prompt(s), u = unitById(s, a.unitId);
    if (!u || hasOfficer(u) || u.round.activated || !alive(u)) return err('Pick an officer-less unit that has not acted');
    if (p.kind === 'pick') {
      if (actor.id !== s.turn.claim) return err('Another player claimed this turn');
      if (u.side !== 'player' || !(u.owner === actor.id || (actor.host && !u.owner))) return err('Pick one of your own units');
    } else if (p.kind === 'host-pick') {
      if (!actor.host) return err('The host moves ' + p.side + ' units');
      if (u.side !== p.side) return err('It is the ' + p.side + " side's turn");
    } else return err('Not an officer-less turn');
    startActivation(s, u);
  },
  interject(s, actor, a) {
    const t = s.turn, u = unitById(s, a.unitId);
    if (!controls(s, actor, u)) return err('Not your unit');
    if (!t.held.includes(u.id) || u.round.activated) return err('Only a held officer can interject');
    if (t.activation && t.activation.started) return err('Wait until the current unit finishes its turn');
    const p = prompt(s);
    if (!['decide', 'final', 'claim', 'pick', 'host-pick', 'activation'].includes(p.kind)) return err('Nothing to interject before');
    if (!(rankOf(s, u.id) < p.rank)) return err(u.name + ' does not have higher initiative than the unit about to act');
    if (t.activation) { // the unit about to act hasn't started: it waits
      const waiting = unitById(s, t.activation.unitId);
      if (t.activation.interject) { t.held.push(waiting.id); }
      t.activation = null;
      log(s, waiting.name + ' waits.');
    }
    t.held = t.held.filter(x => x !== u.id);
    log(s, u.name + ' interjects!');
    startActivation(s, u, { interject: true });
  },

  // ---------- activation steps
  move(s, actor, a) { return doMove(s, actor, a, false); },
  moveTo(s, actor, a) { // click-to-move: blue tile = move, red tile = forced march (ends the turn)
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    const k = a.x + ',' + a.y;
    const { blue, red } = moveOptions(s, u);
    const forced = !blue.has(k) && red.has(k);
    if (!blue.has(k) && !forced) return err("Can't move there");
    const from = { x: u.x, y: u.y };
    const prevFacing = u.facing ? { ...u.facing } : null, prevHidden = !!u.hidden, prevStarted = !!ac.started;
    // Backs Turned: enemies it leaves behind may strike it as it goes
    const struck = backsTurned(s, u, { x: a.x, y: a.y });
    if (!alive(u)) return;
    if (forced) fireTactics(s, 'forcedMarch', u);
    u.x = a.x; u.y = a.y; u.round.moved = true;
    u.facing = { dx: sign(u.x - from.x), dy: sign(u.y - from.y) };
    if (Math.abs(u.x - from.x) > Math.abs(u.y - from.y)) u.facing.dy = 0; else if (u.y !== from.y) u.facing.dx = 0;
    ac.started = true; ac.movedThisActivation = true; ac.step = 'act';
    revealAround(s, u);
    if (heroOfficer(s, u)) fireTactics(s, 'heroMove', u);
    if (forced) {
      const { cost, dist } = red.get(k);
      ac.forcedMarched = true;
      u.morale = clamp(u.morale - cost, 0, 100);
      log(s, u.name + ' force-marches ' + dist + ' tiles (-' + cost + ' morale).');
      settle(s);
      if (alive(u)) finishActivation(s, u);
      return;
    }
    ac.tilesMoved = blue.get(k);
    if (!struck) ac.undo = { from, facing: prevFacing, hidden: prevHidden, started: prevStarted };
    log(s, u.name + ' moves ' + blue.get(k) + ' tile' + (blue.get(k) === 1 ? '' : 's') + '.');
    settle(s, { deferEncirclement: true });
  },
  undoMove(s, actor, a) { // only a normal (blue) move, and only if nothing else happened since
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    if (!ac.undo) return err('Nothing to undo');
    if (unitAt(s, ac.undo.from.x, ac.undo.from.y) && unitAt(s, ac.undo.from.x, ac.undo.from.y) !== u) return err('Its old tile is taken');
    u.x = ac.undo.from.x; u.y = ac.undo.from.y; u.facing = ac.undo.facing; u.hidden = ac.undo.hidden;
    u.round.moved = false; ac.step = 'move'; ac.movedThisActivation = false; ac.tilesMoved = 0; ac.started = ac.undo.started;
    delete ac.undo;
    log(s, u.name + ' takes back its move.');
  },
  forcedMarch(s, actor, a) { return doMove(s, actor, a, true); },
  skipMove(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    if (r.act.step !== 'move') return err('Already past movement');
    r.act.step = 'act'; r.act.started = true;
  },
  swap(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r; const o = unitById(s, a.targetId);
    if (ac.step !== 'move') return err('Swapping replaces movement');
    if (!o || !alive(o) || !friendly(u, o) || manhattan(u, o) !== 1) return err('Pick an adjacent allied unit');
    if (u.round.moved || o.round.moved) return err('Both units must not have moved this round');
    [u.x, o.x] = [o.x, u.x]; [u.y, o.y] = [o.y, u.y];
    u.round.moved = o.round.moved = true; u.round.cannotMove = o.round.cannotMove = true;
    ac.step = 'act'; ac.started = true;
    log(s, u.name + ' swaps places with ' + o.name + '.');
    revealAround(s, u); revealAround(s, o);
    settle(s);
  },
  holdPosition(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    if (r.u.round.attacked || r.act.forcedMarched) return err('Too late to hold this turn');
    r.u.round.holding = true;
    log(s, r.u.name + ' holds position (+2 melee defense this round).');
    for (const tc of fireTactics(s, 'hold', r.u)) tc.anchor = r.u.id; // Hold the Line: this unit and adjacent holders
    finishActivation(s, r.u);
  },
  attack(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r; const d = unitById(s, a.targetId);
    if (ac.forcedMarched) return err('A forced march replaces the attack');
    if (u.round.attacked) return err('Already attacked');
    if (fx(u).reload) return err('This unit must reload before it can attack again');
    if (!d || !alive(d) || !hostile(u, d)) return err('Pick an enemy unit');
    if (!visibleTo(s, d, alliance(u.side))) return err('You cannot see that unit');
    if (!rangeOk(s, u, d)) return err('Target out of range');
    // attacking commits the move: apply any encirclement it caused first
    settle(s);
    if (!alive(d)) { log(s, d.name + ' gave up before the attack landed.'); if (alive(u)) finishActivation(s, u); return; }
    const res = resolveAttack(s, u, d, { movedThisActivation: ac.movedThisActivation, tilesMoved: ac.tilesMoved || 0, ambush: !!u.hidden });
    if (!alive(u)) return;
    // Wedge: after winning, the attacker may move to any empty tile next to the enemy unit
    if (formationOf(s, u).winReposition && res && res.winner === 'attacker') {
      const tiles = repositionTiles(s, d, u);
      if (tiles.length) { ac.step = 'reposition'; ac.reposition = { targetId: d.id, tiles, won: res.winner === 'attacker', melee: !res.ranged }; log(s, u.name + ' may move next to ' + d.name + '.'); return; }
    }
    // Clear a Path: destroying an enemy after moving lets the unit move and attack again
    if (res && res.killedBy === u.id && ac.movedThisActivation && hasTactic(s, u, 'clearPath')) {
      u.round.attacked = false; u.round.moved = false;
      Object.assign(ac, { step: 'move', movedThisActivation: false, tilesMoved: 0, forcedMarched: false });
      log(s, u.name + ' clears a path: it may move and attack again.');
      return;
    }
    if (offerSecond(s, u, ac, d, res.winner === 'attacker', !res.ranged)) return;
    finishActivation(s, u);
  },
  secondAttack(s, actor, a) { // Dual Weapons follow-up: attack one of the offered enemies, or skip (no targetId)
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    if (ac.step !== 'second' || !ac.second) return err('No second attack available');
    const kind = ac.second.kind || 'dual';
    let won = false, melee = true, target = null;
    if (a.targetId) {
      if (!ac.second.targets.includes(a.targetId)) return err('Pick one of the marked enemies');
      target = unitById(s, a.targetId);
      if (target && alive(target)) {
        const res = resolveAttack(s, u, target, kind === 'phoenix'
          ? { phoenixWon: !!ac.second.won, movedThisActivation: ac.movedThisActivation, tilesMoved: ac.tilesMoved || 0 }
          : { second: true, movedThisActivation: ac.movedThisActivation, tilesMoved: ac.tilesMoved || 0 });
        won = res.winner === 'attacker'; melee = !res.ranged;
      }
    }
    delete ac.second;
    if (kind === 'dual') ac.dualDone = true;
    if (alive(u) && kind === 'dual' && offerSecond(s, u, ac, target, won, melee)) return;
    if (alive(u)) finishActivation(s, u);
  },
  reposition(s, actor, a) { // Wedge follow-up: pick one of the offered tiles, or stay (no x/y)
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    if (ac.step !== 'reposition' || !ac.reposition) return err('Nothing to reposition');
    if (a.x !== undefined && a.y !== undefined) {
      if (!ac.reposition.tiles.some(([x, y]) => x === a.x && y === a.y)) return err('Pick one of the marked tiles');
      const from = { x: u.x, y: u.y };
      u.x = a.x; u.y = a.y;
      u.facing = { dx: sign(u.x - from.x), dy: sign(u.y - from.y) };
      if (u.facing.dx && u.facing.dy) u.facing.dy = 0;
      log(s, u.name + ' moves up beside the enemy.');
      revealAround(s, u);
    }
    const { targetId, won, melee } = ac.reposition;
    delete ac.reposition;
    // Wedge + Dual Weapons (or Fury of a Phoenix): after moving up, the next attack comes from the new tile
    if (offerSecond(s, u, ac, unitById(s, targetId), won, melee !== false)) return;
    finishActivation(s, u);
  },
  reload(s, actor, a) { // Reload trait: reloads the weapon; allowed after moving, ends the turn
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u } = r;
    if (!fx(u).reload) return err('Nothing to reload');
    if (u.round.attacked) return err('Already attacked this turn');
    delete fx(u).reload;
    log(s, u.name + ' reloads.');
    finishActivation(s, u);
  },
  raiseFlag(s, actor, a) { // Raise Flag tactic: instead of attacking, from the tactic's centre tile
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    if (u.round.attacked || ac.forcedMarched) return err('Raising the flag replaces the attack');
    const fired = fireTactics(s, 'raiseFlag', u);
    if (!fired.length) return err('No Raise Flag tactic on this tile');
    for (const tc of fired) for (const o of liveUnits(s)) if (o.side === tc.side && inTacticArea(tc, o) && o.morale < 50) o.morale = 50;
    log(s, u.name + ' raises the flag: units in the area below 50 morale rally to 50.');
    u.round.attacked = true;
    finishActivation(s, u);
  },
  setFire(s, actor, a) { // Set Aflame tactic: instead of attacking, set an adjacent flammable tile alight
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r;
    if (u.round.attacked || ac.forcedMarched) return err('Setting a fire replaces the attack');
    if (Math.abs(a.x - u.x) + Math.abs(a.y - u.y) !== 1) return err('Pick a tile next to the unit');
    if (!fireTactics(s, 'setFire', u).length) return err('No Set Aflame tactic covers this unit');
    log(s, u.name + ' sets the tile at ' + a.x + ', ' + a.y + ' on fire.', { type: 'setFire', x: a.x, y: a.y });
    u.round.attacked = true;
    finishActivation(s, u);
  },
  endTurn(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    finishActivation(s, r.u);
  },
  useSkill(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const o = officerOf(s, r.u); if (!o || !o.skill) return err('No officer skill');
    if (r.u.round.skillUsed) return err('Officer skill already used this turn');
    const cost = Number(o.skill.moraleCost) || 0;
    if (r.u.morale < cost) return err('Not enough morale (needs ' + cost + ')');
    r.u.morale -= cost; r.u.round.skillUsed = true; r.act.started = true;
    log(s, r.u.name + ' uses ' + o.skill.name + (cost ? ' (-' + cost + ' morale)' : '') + ': ' + o.skill.text, { type: 'skill' });
    settle(s);
  },
  heroic(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const o = officerOf(s, r.u); const h = o && o.heroicActions && o.heroicActions[a.index];
    if (!h) return err('No such heroic action');
    if (r.u.heroicUsed >= o.fire) return err('No heroic actions left (limit = Fire ' + o.fire + ')');
    if (r.u.round.heroicUsed) return err('Only one heroic action per turn');
    if (r.u.lastHeroic === h.name) return err("Can't use the same heroic action twice in a row");
    r.u.heroicUsed++; r.u.lastHeroic = h.name; r.u.round.heroicUsed = true; r.act.started = true;
    log(s, r.u.name + ' heroic action: ' + h.name + ' (' + r.u.heroicUsed + '/' + o.fire + '). ' + (h.text || ''), { type: 'heroic' });
    fireTactics(s, 'heroic', r.u);
  },
  battleArt(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const o = officerOf(s, r.u); if (!o || !o.battleArt) return err('No battle art');
    if (moraleState(r.u.morale) !== 'Encouraged') return err('Battle arts need Encouraged morale (75+)');
    if (r.u.round.skillUsed) return err('Officer skill already used this turn');
    r.u.round.skillUsed = true; r.act.started = true;
    log(s, r.u.name + ' battle art: ' + o.battleArt.name + '. ' + (o.battleArt.text || ''), { type: 'skill' });
  },
};

/** May this participant place/move/remove tactics for that side? The GM always; a player only for themselves. */
function tacticPlacer(s, actor, side) {
  if (actor.host) return true;
  const tac = s.tactics && s.tactics.sides[side];
  return side === 'player' && !!tac && tac.kind === 'player' && tac.userId === actor.id;
}

/** Backs Turned: hostile units next to `u` that it moves away from strike it for free. Returns true if any did. */
function backsTurned(s, u, to) {
  let struck = false;
  for (const h of liveUnits(s)) {
    if (!alive(u)) break;
    if (!hostile(h, u) || manhattan(h, u) !== 1 || manhattan(h, to) <= 1) continue;
    if (!hasTactic(s, h, 'backsTurned') && !fireTactics(s, 'backsTurned', h).length) continue;
    log(s, h.name + ' strikes as ' + u.name + ' turns its back!');
    resolveAttack(s, h, u, { free: true, noTactics: true });
    struck = true;
  }
  return struck;
}

/** After an attack: Dual Weapons (once), then Fury of a Phoenix (once a round). Sets up the 'second' step. */
function offerSecond(s, u, ac, first, won, melee) {
  if (!alive(u)) return false;
  if (trait(u, 'dual weapons') && !ac.dualDone) {
    const targets = secondTargets(s, u, first);
    if (targets.length) { ac.step = 'second'; ac.second = { targets, kind: 'dual' }; log(s, u.name + ' may strike a second enemy.'); return true; }
  }
  if (melee && !u.round.phoenixUsed && hasTactic(s, u, 'phoenix')) {
    const targets = liveUnits(s).filter(o => hostile(o, u) && manhattan(o, u) === 1 && visibleTo(s, o, alliance(u.side))).map(o => o.id);
    if (targets.length) {
      u.round.phoenixUsed = true;
      ac.step = 'second'; ac.second = { targets, kind: 'phoenix', won: !!won };
      log(s, u.name + ' may make a second melee attack (Fury of a Phoenix).');
      return true;
    }
  }
  return false;
}

function activeUnit(s, actor, unitId) {
  const ac = s.turn.activation;
  if (!ac || ac.unitId !== unitId) return err("It isn't that unit's turn");
  const u = unitById(s, unitId);
  if (!controls(s, actor, u)) return err('Not your unit');
  return { u, act: ac };
}

function doMove(s, actor, a, forced) {
  const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
  const { u, act: ac } = r;
  if (forced) {
    if (ac.step !== 'act' || u.round.attacked || ac.forcedMarched) return err('Forced march comes after moving, instead of attacking');
  } else if (ac.step !== 'move') return err('Already moved');
  if (u.round.cannotMove) return err('This unit cannot move this round');
  const budget = movementOf(s, u);
  let warning = null;
  if (s.freeMovement) {
    // On a virtual tabletop the token has already been dragged: record it, warn if too far.
    const dist = Math.abs(a.x - u.x) + Math.abs(a.y - u.y);
    if (!budget) warning = u.name + ' cannot move in its formation.';
    else if (dist > budget) warning = u.name + ' moved ' + dist + ' tiles; its movement is ' + budget + '.';
  } else {
    if (!budget) return err('This unit cannot move (formation)');
    const reach = reachable(s, u, budget);
    if (!reach.has(a.x + ',' + a.y)) return err('Out of movement range or blocked');
  }
  backsTurned(s, u, { x: a.x, y: a.y });
  if (!alive(u)) return ok();
  if (forced) fireTactics(s, 'forcedMarch', u);
  const from = { x: u.x, y: u.y };
  const tiles = s.freeMovement ? Math.abs(a.x - u.x) + Math.abs(a.y - u.y) : (reachable(s, u, budget).get(a.x + ',' + a.y) ?? 0);
  u.x = a.x; u.y = a.y; u.round.moved = true;
  u.facing = { dx: sign(u.x - from.x), dy: sign(u.y - from.y) };
  ac.started = true; ac.movedThisActivation = true;
  revealAround(s, u);
  if (!forced) ac.tilesMoved = tiles;
  if (forced) {
    ac.forcedMarched = true;
    const fc = forcedMarchCost(s, u);
    u.morale = clamp(u.morale - fc, 0, 100);
    log(s, u.name + ' force-marches (-' + fc + ' morale).');
  } else ac.step = 'act';
  if (warning) log(s, 'Warning: ' + warning, { type: 'warning' });
  settle(s);
  if (forced && alive(u)) finishActivation(s, u);
  return ok(warning ? { warning } : {});
}

// ---------------------------------------------------------------- views

// State as seen by one participant: hidden enemy units are removed.
function viewFor(s, viewer) {
  const v = clone(s);
  if (!viewer.host) {
    v.units = v.units.filter(u => visibleTo(s, unitById(s, u.id), 'player'));
    // Never leak hidden-unit details through the log
    const hiddenIds = new Set(s.units.filter(u => !visibleTo(s, u, 'player')).map(u => u.id));
    v.log = v.log.filter(e => !(e.detail && e.detail.unit && hiddenIds.has(e.detail.unit)));
  }
  v.prompt = prompt(s);
  if (v.prompt.rank === Infinity) v.prompt.rank = 1e9; // JSON has no Infinity
  return v;
}

export {
  moveOptions, attackTargets, actionMenu, threatArea, TACTIC_SIDES,
  newState, act, viewFor, prompt, reachable, movementOf, moraleState, visibleTo, rangeOk,
  resolveAttack, buildRoll, setRng, yinYang, typeOf, officerOf, unitById, SIDES, settle, advance,
};
