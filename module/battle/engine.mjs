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

function movementOf(s, u) {
  const t = typeOf(s, u); const f = formationOf(s, u);
  if (f.immobile) return 0;
  return Math.max(0, (t ? t.move : 4) + (f.moveMod || 0) + (passive(s, u).moveBonus || 0));
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
  const out = new Map(); const key = (x, y) => x + ',' + y;
  const q = [[u.x, u.y, 0]]; out.set(key(u.x, u.y), 0);
  while (q.length) {
    const [x, y, d] = q.shift();
    if (d >= budget) continue;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (out.has(k) || !passable(s, nx, ny) || unitAt(s, nx, ny)) continue;
      out.set(k, d + 1); q.push([nx, ny, d + 1]);
    }
  }
  out.delete(key(u.x, u.y));
  return out; // "x,y" -> distance
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
      const cost = 5 * (d - move);
      if (u.morale - cost > 0) red.set(k, { dist: d, cost });
    }
  }
  return { blue, red };
}

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
  const skillOk = !!(o && o.skill && !u.round.skillUsed && u.morale >= (Number(o.skill.moraleCost) || 0));
  const artOk = !!(o && o.battleArt && !u.round.skillUsed && moraleState(u.morale) === 'Encouraged');
  return {
    move: opts.blue.size + opts.red.size > 0,
    attack: canStillAct && attackTargets(s, u).length > 0,
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
  if (!alive(u)) return true;
  if (alliance(u.side) === viewerAlliance || !u.hidden) return true;
  const cover = (data.TERRAIN[terrainAt(s, u.x, u.y)] || {}).cover || 0;
  return liveUnits(s).some(o => alliance(o.side) === viewerAlliance && manhattan(o, u) <= cover);
}

// ---------------------------------------------------------------- combat

function rangeOk(s, attacker, defender) {
  const t = typeOf(s, attacker); const d = manhattan(attacker, defender);
  return d >= (t.rangeMin || 1) && d <= (t.rangeMax || 1);
}

// Build one side's roll. role: 'attacker' | 'defender'.
function buildRoll(s, unit, role, ctx) {
  const t = typeOf(s, unit), o = officerOf(s, unit), f = formationOf(s, unit), p = passive(s, unit);
  const other = role === 'attacker' ? ctx.defender : ctx.attacker;
  const of = formationOf(s, other);
  const dice = yinYang();
  const parts = [['Yin/Yang (' + dice.yin + ' vs ' + dice.yang + ')', dice.value]];
  const commandOmitted = role === 'defender' && ctx.ambush;
  parts.push(['Command' + (commandOmitted ? ' (ambushed: omitted)' : ''), o && !commandOmitted ? o.command : 0]);
  parts.push(['Fire', o ? o.fire : 0]);
  parts.push(['Skill (' + t.skill + ')', o ? (o.skills && o.skills[t.skill]) || 0 : 0]);
  parts.push(['Unit Value', t.unitValue || 0]);

  if (role === 'attacker') {
    if (f.noAttackerBonus) parts.push(['Attacker bonus (lost: ' + f.name + ')', 0]);
    else if (ctx.ranged && unit.round.moved) parts.push(['Attacker bonus (lost: moved before shooting)', 0]);
    else parts.push(['Attacker bonus', 2]);
    if (!ctx.ranged && f.frontMelee && isFront(s, other, unit)) parts.push(['Formation front (' + f.name + ')', f.frontMelee]);
    if (ctx.charge) parts.push(['Cavalry charge (' + ctx.tilesMoved + ' tile' + (ctx.tilesMoved === 1 ? '' : 's') + ' moved' + (ctx.fierce >= 2 ? ', ' + FIERCE_NAMES[ctx.fierce] : '') + ')', ctx.chargeBonus]);
    if (ctx.charge && ctx.fierce === 1) parts.push(['Fierce Charge', 1]);
    if (ctx.charge && f.chargeBonus) parts.push(['Formation charge bonus (' + f.name + ')', f.chargeBonus]);
    if (ctx.charge && p.chargeAttackBonus) parts.push(['Officer passive: charge', p.chargeAttackBonus]);
    if (ctx.rear) parts.push(['Rear attack', 2]);
    // defender's formation modifies the attacker's roll
    if (of.vsAttack) parts.push(['Target formation (' + of.name + ')', of.vsAttack]);
    if (ctx.ranged && of.vsRanged) parts.push(['Target formation vs ranged (' + of.name + ')', of.vsRanged]);
    if (!ctx.ranged) {
      const m = ctx.charge && of.vsCharge !== undefined ? of.vsCharge : of.vsMelee;
      if (m) parts.push(['Target formation vs ' + (ctx.charge ? 'charge' : 'melee') + ' (' + of.name + ')', m]);
    }
    if (other.round.holding) parts.push(['Target is holding', -2]);
  } else {
    if (f.defFront && isFront(s, ctx.attacker, unit)) parts.push(['Formation front defense (' + f.name + ')', f.defFront]);
    if (f.defAll) parts.push(['Formation defense (' + f.name + ')', f.defAll]);
    if (!ctx.ranged && f.frontMelee && isFront(s, ctx.attacker, unit)) parts.push(['Formation front vs melee (' + f.name + ')', f.frontMelee]);
  }

  const ms = moraleState(unit.morale);
  if (ms === 'Encouraged') parts.push(['Encouraged', 2]);
  if (ms === 'Demoralized') parts.push(['Demoralized' + (p.ignoreMoralePenalty ? ' (ignored: officer passive)' : ''), p.ignoreMoralePenalty ? 0 : -2]);
  // Strength penalties scale with the unit's full health (cavalry have 50)
  const full = unit.maxMen || 100;
  if (unit.men < full * 0.25) parts.push(['Below a quarter strength', -2]);
  else if (unit.men < full * 0.5) parts.push(['Below half strength', -1]);
  for (const m of unit.mods || []) parts.push(['Modifier: ' + m.label, Number(m.value) || 0]);

  const total = parts.reduce((a, [, v]) => a + v, 0);
  return { total, parts, dice };
}

const FIERCE_NAMES = ['', 'Fierce Charge', 'Fierce Charge+', 'Fierce Charge++'];

function damageValue(s, u) { // formation damage modifier applies to the unit's damage value
  const t = typeOf(s, u), f = formationOf(s, u);
  return Math.max(0, (t.damage || 0) + (f.dmgMod || 0));
}

// Resolve an attack. Returns a result object (also logged). Mutates state.
function resolveAttack(s, attacker, defender, opts) {
  const at = typeOf(s, attacker), dt = typeOf(s, defender);
  const ranged = at.weapon === 'ranged';
  // Charge: a cavalry unit's melee attack gains +1 for every 2 tiles it moved this turn (rounded down)
  const tilesMoved = opts.movedThisActivation ? (opts.tilesMoved || 0) : 0;
  // Fierce Charge trait: 1 = +1 on a charge; 2 (+) and 3 (++) = +1 per tile instead of per 2; 3 also doubles morale loss on a win
  const fierce = attacker.fierceCharge || 0;
  const chargeBonus = !ranged && at.category === 'cavalry' ? Math.floor(fierce >= 2 ? tilesMoved : tilesMoved / 2) : 0;
  const charge = chargeBonus > 0;
  const df = formationOf(s, defender);
  let rear = isRear(s, attacker, defender) && !df.noRear && !passive(s, defender).noRearAgainst;
  const ambush = !!opts.ambush;
  const ctx = { attacker, defender, ranged, charge, chargeBonus, tilesMoved, fierce, rear, ambush };

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
    if (!dNeg && dt.weapon !== 'ranged') dmgToAtt = base(defender) + winBonus('defender');
  } else {
    if (!aNeg && winner === 'attacker') dmgToDef = base(attacker) + diff;
    const canReturn = dt.weapon === 'ranged' ? rangeOk(s, defender, attacker)
      : manhattan(attacker, defender) === 1;
    if (!dNeg && canReturn) dmgToAtt = base(defender) + winBonus('defender');
  }
  // Casualties = damage - (armor reduced by the other side's armor penetration) - formation damage reduction
  const af = formationOf(s, attacker);
  const armorOf = (t) => (t.armor ?? t.defense ?? 0);
  const casDef = Math.max(0, dmgToDef - Math.max(0, armorOf(dt) - (at.armorPen || 0)) - (df.casReduce || 0));
  const casAtt = Math.max(0, dmgToAtt - Math.max(0, armorOf(at) - (dt.armorPen || 0)) - (af.casReduce || 0));

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
    } else {
      moraleLoss = diff + (passive(s, defender).extraMoraleLossOnWin || 0);
    }
  }

  // Apply simultaneously
  const menBefore = { d: defender.men, a: attacker.men };
  defender.men = Math.max(0, defender.men - casDef);
  attacker.men = Math.max(0, attacker.men - casAtt);
  if (loser) loser.morale = clamp(loser.morale - moraleLoss, 0, 100);

  // Facing and memory for this round
  attacker.round.attacked = true;
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
  const tags = [ranged ? 'ranged' : 'melee', charge && 'cavalry charge', rear && 'rear', ambush && 'ambush'].filter(Boolean).join(', ');
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
  if (defender.men <= 0 && attacker.men > 0) { result.killedBy = attacker.id; result.killMorale = gainMorale(s, attacker, 5 * (dt.tier || 1), 'killing blow'); result.xpAttacker += gainXp(s, attacker, 25 * (dt.tier || 1) / (at.tier || 1), 'killing blow'); }
  if (attacker.men <= 0 && defender.men > 0) { result.killedBy = defender.id; result.killMorale = gainMorale(s, defender, 5 * (at.tier || 1), 'killing blow'); result.xpDefender += gainXp(s, defender, 25 * (at.tier || 1) / (dt.tier || 1), 'killing blow'); }
  settle(s);
  return result;
}

const XP_PER_LEVEL = 100;
function gainXp(s, u, amount, why) {
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
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const u of liveUnits(s)) {
      let ended = null;
      if (u.men <= 0) { u.status = 'defeated'; ended = 'is destroyed'; }
      else if (u.morale <= 0) { u.status = 'surrendered'; ended = 'surrenders'; }
      if (!ended) continue;
      changed = true;
      log(s, u.name + ' ' + ended + '.', { type: 'defeat', unit: u.id });
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
    const surrounded = enemies >= 2 && open === 0;
    if (surrounded && !u.surrounded) {
      u.surrounded = true;
      if (passive(s, u).ignoreEncirclement) log(s, u.name + ' is surrounded but its officer ignores the morale loss.');
      else { u.morale = clamp(u.morale - 50, 0, 100); log(s, u.name + ' is fully surrounded: -50 morale.'); changed = true; }
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
  log(s, 'Round ' + s.turn.round + ' ends.');
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
  // Stealth: ending the turn in cover hides the unit
  const cover = (data.TERRAIN[terrainAt(s, u.x, u.y)] || {}).cover || 0;
  u.hidden = alive(u) && cover > 0;
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

const HOST_ONLY = new Set(['setMap', 'paintTerrain', 'setLibrary', 'addUnit', 'editUnit', 'removeUnit',
  'startBattle', 'resetBattle', 'startRound', 'skipPrompt', 'addMod', 'removeMod', 'adjust', 'setFacing']);

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
    s.turn = freshTurn('formations', 1);
    for (const u of s.units) u.round = newRoundFlags();
    // Every unit starts facing the nearest enemy
    for (const u of liveUnits(s)) {
      const foes = liveUnits(s).filter(o => hostile(o, u)).sort((a, b) => manhattan(a, u) - manhattan(b, u));
      if (foes.length) {
        const f = foes[0], dx = f.x - u.x, dy = f.y - u.y;
        u.facing = Math.abs(dx) > Math.abs(dy) ? { dx: sign(dx), dy: 0 } : { dx: 0, dy: sign(dy) };
      }
    }
    log(s, 'Battle begins. Round 1: declare formations.');
  },
  resetBattle(s) {
    s.turn = freshTurn('setup', 0);
    for (const u of s.units) u.round = newRoundFlags();
    log(s, 'Host returned to setup.');
  },
  startRound(s) {
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

  // ---------- formations
  setFormation(s, actor, a) {
    const u = unitById(s, a.unitId);
    if (!controls(s, actor, u)) return err('Not your unit');
    if (!['formations', 'setup'].includes(s.turn.phase) && !actor.host) return err('Formations are declared at the start of the round');
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
    u.x = a.x; u.y = a.y; u.round.moved = true;
    u.facing = { dx: sign(u.x - from.x), dy: sign(u.y - from.y) };
    if (Math.abs(u.x - from.x) > Math.abs(u.y - from.y)) u.facing.dy = 0; else if (u.y !== from.y) u.facing.dx = 0;
    if (!(data.TERRAIN[terrainAt(s, u.x, u.y)] || {}).cover) u.hidden = false;
    ac.started = true; ac.movedThisActivation = true; ac.step = 'act';
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
    ac.undo = { from, facing: prevFacing, hidden: prevHidden, started: prevStarted };
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
    settle(s);
  },
  holdPosition(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    if (r.u.round.attacked || r.act.forcedMarched) return err('Too late to hold this turn');
    r.u.round.holding = true;
    log(s, r.u.name + ' holds position (enemy attacks against it -2 this round).');
    finishActivation(s, r.u);
  },
  attack(s, actor, a) {
    const r = activeUnit(s, actor, a.unitId); if (r.error) return r;
    const { u, act: ac } = r; const d = unitById(s, a.targetId);
    if (ac.forcedMarched) return err('A forced march replaces the attack');
    if (u.round.attacked) return err('Already attacked');
    if (!d || !alive(d) || !hostile(u, d)) return err('Pick an enemy unit');
    if (!visibleTo(s, d, alliance(u.side))) return err('You cannot see that unit');
    if (!rangeOk(s, u, d)) return err('Target out of range');
    // attacking commits the move: apply any encirclement it caused first
    settle(s);
    if (!alive(d)) { log(s, d.name + ' gave up before the attack landed.'); if (alive(u)) finishActivation(s, u); return; }
    resolveAttack(s, u, d, { movedThisActivation: ac.movedThisActivation, tilesMoved: ac.tilesMoved || 0, ambush: ac.startedHidden });
    if (alive(u)) finishActivation(s, u);
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
  const from = { x: u.x, y: u.y };
  const tiles = s.freeMovement ? Math.abs(a.x - u.x) + Math.abs(a.y - u.y) : (reachable(s, u, budget).get(a.x + ',' + a.y) ?? 0);
  u.x = a.x; u.y = a.y; u.round.moved = true;
  u.facing = { dx: sign(u.x - from.x), dy: sign(u.y - from.y) };
  if (!(data.TERRAIN[terrainAt(s, u.x, u.y)] || {}).cover) u.hidden = false;
  ac.started = true; ac.movedThisActivation = true;
  if (!forced) ac.tilesMoved = tiles;
  if (forced) {
    ac.forcedMarched = true;
    u.morale = clamp(u.morale - 5, 0, 100);
    log(s, u.name + ' force-marches (-5 morale).');
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
  moveOptions, attackTargets, actionMenu,
  newState, act, viewFor, prompt, reachable, movementOf, moraleState, visibleTo, rangeOk,
  resolveAttack, buildRoll, setRng, yinYang, typeOf, officerOf, unitById, SIDES, settle, advance,
};
