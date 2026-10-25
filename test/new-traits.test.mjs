// The traits David moved into Battle traits on 2026-10-24 (Battle Sheets): Outrider, Trample, Stalwart, Shock Troop,
// Hold the Line, Zealot, Suppressing Fire, Repeating, Ambusher, Woodsmen, Scouts, Disciplined, Fanatic, Levy, Cowardly.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function dice(values) { const q = values.slice(); R.setRng(() => (q.length ? q.shift() : 0) / 10 + 0.001); }
function must(res) { assert.ok(res.ok, res.error); return res; }
function setup() { const s = R.newState(); s.players.p1 = { name: 'Alice' }; return s; }
function add(s, o) { return must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
function plains(s, special = {}) {
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  Object.assign(s.map.tiles, special);
}
/** Player unit at (5,5) attacks an enemy at (5,4). setupFn(a, d, s) runs before the battle starts. */
function duel(aType, dType, rolls, setupFn, extra = [], beforeAttack) {
  const s = setup();
  s.library.unitTypes.push(aType, dType, ...extra.map(e => e.type));
  const a = add(s, { typeId: aType.id, side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: dType.id, side: 'enemy', x: 5, y: 4 });
  for (const e of extra) e.id = add(s, { typeId: e.type.id, side: e.side, x: e.x, y: e.y, owner: e.side === 'player' ? 'p1' : undefined });
  if (setupFn) setupFn(R.unitById(s, a), R.unitById(s, d), s);
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  if (beforeAttack) beforeAttack(R.unitById(s, a), R.unitById(s, d), s);
  dice(rolls);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  return { s, A: R.unitById(s, a), D: R.unitById(s, d), r };
}
const part = (roll, re) => roll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);
const traits = (o) => (u) => { u.traitTiers = o; };
const rollOf = (s, u, role, other, extra = {}) => R.buildRoll(s, u, role, Object.assign(role === 'attacker' ? { attacker: u, defender: other } : { attacker: other, defender: u }, { ranged: false }, extra));

test('Shock Troop: Attack +2/+4/+6 on the unit\'s first attack of the battle only', () => {
  const { s, A, D, r } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'shock troop': 3 }));
  assert.strictEqual(part(r.attackRoll, /^Shock Troop/), 6);
  assert.ok(A.fx.attackedOnce);
  assert.strictEqual(part(rollOf(s, A, 'attacker', D), /^Shock Troop/), 0, 'second attack: no bonus');
  const b = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'shock troop': 1 }));
  assert.strictEqual(part(b.r.attackRoll, /^Shock Troop/), 2);
});

test('Ambusher: attacking from hiding gives Attack +4 instead of +2', () => {
  const s = setup(); s.library.unitTypes.push(unitType('a'), unitType('d'));
  const A = R.unitById(s, add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5 }));
  const D = R.unitById(s, add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 }));
  assert.strictEqual(part(rollOf(s, A, 'attacker', D, { ambush: true }), /hiding/), 2);
  A.traitTiers = { ambusher: 1 };
  assert.strictEqual(part(rollOf(s, A, 'attacker', D, { ambush: true }), /hiding/), 4);
  assert.strictEqual(part(rollOf(s, A, 'attacker', D), /hiding/), 0, 'not hidden: nothing');
});

test('Suppressing Fire: a hit gives the target Attack -1 until the end of its next turn', () => {
  const { s, A, D } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [9, 0, 0, 0], traits({ 'suppressing fire': 1 }));
  assert.ok(D.fx.suppressed);
  assert.strictEqual(part(rollOf(s, D, 'attacker', A), /^Suppressed/), -1);
  // a miss doesn't suppress
  const m = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [0, 0, 9, 0], traits({ 'suppressing fire': 1 }));
  assert.ok(!m.D.fx.suppressed);
});

test('Hold the Line: a holding unit gives adjacent allied infantry Melee defense +1/+2 (not ranged, not cavalry)', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('i'), unitType('c', { category: 'cavalry' }), unitType('e'));
  const H = R.unitById(s, add(s, { typeId: 'i', side: 'player', owner: 'p1', x: 5, y: 5 }));
  const N = R.unitById(s, add(s, { typeId: 'i', side: 'player', owner: 'p1', x: 6, y: 5 }));
  const C = R.unitById(s, add(s, { typeId: 'c', side: 'player', owner: 'p1', x: 4, y: 5 }));
  const E = R.unitById(s, add(s, { typeId: 'e', side: 'enemy', x: 6, y: 4 }));
  H.traitTiers = { 'hold the line': 2 };
  assert.strictEqual(part(rollOf(s, N, 'defender', E), /^Hold the Line/), 0, 'only while holding');
  H.round.holding = true;
  assert.strictEqual(part(rollOf(s, N, 'defender', E), /^Hold the Line/), 2);
  assert.strictEqual(part(rollOf(s, N, 'defender', E, { ranged: true }), /^Hold the Line/), 0, 'melee only');
  assert.strictEqual(part(rollOf(s, C, 'defender', E), /^Hold the Line/), 0, 'infantry only');
  assert.strictEqual(part(rollOf(s, H, 'defender', E), /^Hold the Line/), 0, 'not itself');
});

test('Zealot: Command rolls +1/+2/+3 at 25 morale or less instead of the Demoralized -2', () => {
  const s = setup(); s.library.unitTypes.push(unitType('a'), unitType('d'));
  const A = R.unitById(s, add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5, morale: 20 }));
  const D = R.unitById(s, add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 }));
  A.traitTiers = { zealot: 3 };
  const roll = rollOf(s, A, 'attacker', D);
  assert.strictEqual(part(roll, /^Zealot/), 3);
  assert.strictEqual(part(roll, /^Demoralized/), 0);
  A.morale = 60;
  assert.strictEqual(part(rollOf(s, A, 'attacker', D), /^Zealot/), 0, 'only when low');
});

test('Repeating: two hits of half damage (and half pen), armor counted against each', () => {
  // attacker 9+2 = 11 vs 0: damage 6 + 11 = 17 -> hits of 9 and 8, armor 3 -> 6 + 5 = 11 casualties (a normal hit: 14)
  let { D, r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], traits({ repeating: 1 }));
  assert.strictEqual(r.casualtiesDefender, 11);
  assert.strictEqual(D.men, 100 - 11);
  // armor pen 2 is split 1 + 1 over the two hits and goes through on top: (6 + 1) + (5 + 1) = 13
  ({ r } = duel(unitType('a', { armorPen: 2 }), unitType('d'), [9, 0, 0, 0], traits({ repeating: 1 })));
  assert.strictEqual(r.casualtiesDefender, 13);
});

test('Trample: a winning charge against infantry costs the defender 5 more morale', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('cav', { category: 'cavalry', move: 5 }), unitType('inf'));
  const c = add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 5, y: 9 });
  const d = add(s, { typeId: 'inf', side: 'enemy', x: 5, y: 4 });
  const C = R.unitById(s, c), D = R.unitById(s, d);
  C.traitTiers = { trample: 1 };
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: c }));
  must(R.act(s, P1, { type: 'moveTo', unitId: c, x: 5, y: 5 }));
  dice([9, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: c, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.ok(r.charge && r.winner === 'attacker');
  // base loss = diff - 1, +5 Trample
  assert.strictEqual(r.moraleLoss, r.diff - 1 + 5);
  assert.strictEqual(D.morale, Math.max(0, 50 - r.moraleLoss - r.casualtyMorale.defender));
});

test('Cowardly: rear attacks cause double morale loss; Disciplined no longer halves morale loss (it raises starting morale instead)', () => {
  // rear: the defender faces away (north), the attacker comes from the south
  let { r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { cowardly: 1 }; }, [], (a, d) => { d.facing = { dx: 0, dy: -1 }; });
  assert.ok(r.rear);
  assert.strictEqual(r.moraleLoss, (r.diff - 1) * 2);
  ({ r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { cowardly: 1 }; }));
  assert.strictEqual(r.moraleLoss, r.diff - 1, 'not from the front');
  ({ r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { disciplined: 1, fragile: 1 }; }));
  assert.strictEqual(r.moraleLoss, r.diff - 1 + 5, 'Fragile +5, no halving');
});

test('Fanatic: never surrenders at 0 morale, fights on (Demoralized) until destroyed', () => {
  const s = setup(); s.library.unitTypes.push(unitType('a'), unitType('d'));
  const a = add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5, morale: 10 });
  const A = R.unitById(s, a), D = R.unitById(s, add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 }));
  A.traitTiers = { fanatic: 1 };
  must(R.act(s, HOST, { type: 'adjust', unitId: a, morale: -10 }));
  assert.strictEqual(A.morale, 0);
  assert.strictEqual(A.status, 'active');
  assert.strictEqual(part(rollOf(s, A, 'attacker', D), /^Demoralized/), -2);
  A.men = 0; R.settle(s);
  assert.strictEqual(A.status, 'defeated');
});

test('Stalwart: cannot be surrounded, so encirclement costs it nothing', () => {
  const s = setup(); s.library.unitTypes.push(unitType('a'), unitType('e'));
  const u = add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5, morale: 70 });
  R.unitById(s, u).traitTiers = { stalwart: 1 };
  add(s, { typeId: 'e', side: 'enemy', x: 4, y: 5 });
  add(s, { typeId: 'e', side: 'enemy', x: 6, y: 5 });
  add(s, { typeId: 'e', side: 'enemy', x: 5, y: 4 });
  const last = add(s, { typeId: 'e', side: 'enemy', x: 9, y: 9 });
  must(R.act(s, HOST, { type: 'place', unitId: last, x: 5, y: 6 }));
  assert.strictEqual(R.unitById(s, u).morale, 70);
  assert.ok(!R.unitById(s, u).surrounded);
});

test('Woodsmen: forests cost no extra movement', () => {
  const s = setup(); plains(s, { '5,4': { terrain: 'forest' }, '5,3': { terrain: 'forest' } });
  s.library.unitTypes.push(unitType('w', { move: 2 }));
  const u = R.unitById(s, add(s, { typeId: 'w', side: 'player', owner: 'p1', x: 5, y: 5 }));
  assert.ok(!R.reachable(s, u, 2).has('5,3'), 'two forest squares cost 4 normally');
  u.traitTiers = { woodsmen: 1 };
  assert.strictEqual(R.reachable(s, u, 2).get('5,3'), 2);
});

test('Scouts: reveal hidden enemies within 2 tiles, and enemies can\'t hide that close to them', () => {
  const s = setup(); plains(s, { '5,2': { terrain: 'forest' } });
  s.library.unitTypes.push(unitType('sc', { move: 3 }), unitType('e'));
  const sc = add(s, { typeId: 'sc', side: 'player', owner: 'p1', x: 5, y: 8 });
  const e = add(s, { typeId: 'e', side: 'enemy', x: 5, y: 2 });
  const S = R.unitById(s, sc), E = R.unitById(s, e);
  S.traitTiers = { scouts: 1 };
  E.hidden = true;
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: sc }));
  must(R.act(s, P1, { type: 'moveTo', unitId: sc, x: 5, y: 5 }));
  assert.ok(E.hidden, '3 tiles away: still hidden');
  // next to it within 2: reveals on moving there
  S.round.moved = false; s.turn.activation.step = 'move';
  must(R.act(s, P1, { type: 'moveTo', unitId: sc, x: 5, y: 4 }));
  assert.ok(!E.hidden, 'spotted from 2 tiles');
});

test('Outrider: after a normal move, ride on 1 tile (Outrider+ 2) instead of attacking; the turn then ends', () => {
  const s = setup(); plains(s);
  s.library.unitTypes.push(unitType('cav', { category: 'cavalry', move: 3 }), unitType('e'));
  const c = add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 2, y: 9 });
  add(s, { typeId: 'e', side: 'enemy', x: 10, y: 1 });
  const C = R.unitById(s, c);
  C.traitTiers = { outrider: 2 };
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: c }));
  assert.ok(!R.actionMenu(s, C).outrider, 'only after moving');
  must(R.act(s, P1, { type: 'moveTo', unitId: c, x: 2, y: 6 }));
  assert.ok(R.actionMenu(s, C).outrider);
  must(R.act(s, P1, { type: 'outrider', unitId: c }));
  const tiles = s.turn.activation.reposition.tiles.map(([x, y]) => x + ',' + y);
  assert.ok(tiles.includes('2,4') && !tiles.includes('2,3'), 'up to 2 tiles');
  must(R.act(s, P1, { type: 'reposition', unitId: c, x: 2, y: 4 }));
  assert.deepStrictEqual([C.x, C.y], [2, 4]);
  assert.ok(C.round.attacked, 'riding on replaces the attack');
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== c, 'the turn ends');
});

// ---- Total War rebalance traits (David, 2026-10-25) ----
test('Evasion: ignores 25/40/55% of melee casualties (EX 70%), pen included, rounding the damage up; not against ranged attacks', () => {
  // attacker 9+2 = 11 vs 0: damage 6 + 11 = 17, pen 2, armor 3 -> 2 + 14 = 16; Evasion+ ignores 40%: 9.6 -> 10
  let { r } = duel(unitType('a', { armorPen: 2 }), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { evasion: 2 }; });
  assert.strictEqual(r.casualtiesDefender, 10);
  ({ r } = duel(unitType('a', { armorPen: 2 }), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { evasion: 3, 'evasion ex': 1 }; }));
  assert.strictEqual(r.casualtiesDefender, 5, 'Evasion EX: 16 x 0.3 = 4.8 -> 5');
  ({ r } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3, armorPen: 2 }), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { evasion: 3 }; }));
  assert.strictEqual(r.casualtiesDefender, 16, 'a shot is not evaded');
  // the attacker evades the melee strike back too: defender wins 9 vs 2 (attacker bonus): dmg 6 + 7 = 13 - 3 armor = 10 -> Evasion 25%: 7.5 -> 8
  ({ r } = duel(unitType('a'), unitType('d'), [0, 0, 9, 0], (a, d) => { a.traitTiers = { evasion: 1 }; }));
  assert.strictEqual(r.casualtiesAttacker, 8);
  // Repeating: evasion takes its share of the two hits together
  ({ r } = duel(unitType('a', { armorPen: 2 }), unitType('d'), [9, 0, 0, 0], (a, d) => { a.traitTiers = { repeating: 1 }; d.traitTiers = { evasion: 3 }; }));
  assert.strictEqual(r.casualtiesDefender, Math.ceil(13 * 0.45), '13 over two hits, 55% ignored -> 5.85 -> 6');
});

test('Disciplined: no longer halves morale loss, and the engine adds nothing at battle start (the sheet sets the resting morale)', () => {
  const { A } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], (a, d) => { a.traitTiers = { disciplined: 2 }; });
  assert.strictEqual(A.morale, 50);
  assert.strictEqual(R.disciplinedBonus(A), 10);
});

test('Charging Strike: Attack +2/+4/+6 when the unit moved 2 or more tiles before a melee attack', () => {
  const s = setup(); plains(s); s.library.unitTypes.push(unitType('a', { move: 4 }), unitType('d'));
  const a = add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 8 }), d = add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 });
  R.unitById(s, a).traitTiers = { 'charging strike': 2 };
  must(R.act(s, HOST, { type: 'startBattle' })); dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'move', unitId: a, x: 5, y: 5 })); // 3 tiles
  dice([3, 0, 0, 0]); must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.strictEqual(part(r.attackRoll, /^Charging Strike/), 4);
  // one tile only: nothing
  const t = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'charging strike': 3 }));
  assert.strictEqual(part(t.r.attackRoll, /^Charging Strike/), 0);
});

test('Deflect: defense +2 (+3 vs ranged) against the first attack each round; Deflect+ the first two', () => {
  const s = setup(); s.library.unitTypes.push(unitType('a'), unitType('d'), unitType('b', { weapon: 'ranged', rangeMax: 3 }));
  const A = R.unitById(s, add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5 }));
  const B = R.unitById(s, add(s, { typeId: 'b', side: 'player', owner: 'p1', x: 5, y: 7 }));
  const D = R.unitById(s, add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 }));
  D.traitTiers = { deflect: 1 };
  assert.strictEqual(part(rollOf(s, D, 'defender', A), /^Deflect/), 2);
  assert.strictEqual(part(rollOf(s, D, 'defender', B, { ranged: true }), /^Deflect/), 3);
  D.round.attacksTaken = 1;
  assert.strictEqual(part(rollOf(s, D, 'defender', A), /^Deflect/), 0, 'already attacked once this round');
  D.traitTiers = { deflect: 2 };
  assert.strictEqual(part(rollOf(s, D, 'defender', A), /^Deflect\+/), 2, 'Deflect+ still works on the second attack');
  D.round.attacksTaken = 2;
  assert.strictEqual(part(rollOf(s, D, 'defender', A), /^Deflect/), 0);
  // the count comes from real attacks and resets each round
  const { D: D2 } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0]);
  assert.strictEqual(D2.round.attacksTaken, 1);
});

test('cavalry: Command +1 in melee against infantry, attacking or defending; not for shots', () => {
  const s = setup(); s.library.unitTypes.push(unitType('cav', { category: 'cavalry', move: 5 }), unitType('inf'), unitType('bow', { weapon: 'ranged', rangeMax: 3 }));
  const C = R.unitById(s, add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 5, y: 5 }));
  const I = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 5, y: 4 }));
  const B = R.unitById(s, add(s, { typeId: 'bow', side: 'enemy', x: 5, y: 7 }));
  assert.strictEqual(part(rollOf(s, C, 'attacker', I), /^Cavalry vs infantry/), 1);
  assert.strictEqual(part(rollOf(s, C, 'defender', I), /^Cavalry vs infantry/), 1, 'defending too');
  assert.strictEqual(part(rollOf(s, I, 'attacker', C), /^Cavalry vs infantry/), 0, 'the infantry gets nothing');
  assert.strictEqual(part(rollOf(s, C, 'defender', B, { ranged: true }), /^Cavalry vs infantry/), 0, 'not against a shot');
  const C2 = R.unitById(s, add(s, { typeId: 'cav', side: 'enemy', x: 4, y: 5 }));
  assert.strictEqual(part(rollOf(s, C, 'attacker', C2), /^Cavalry vs infantry/), 0, 'not against cavalry');
});
