// Battle unit traits (David's trait sheet, October 2026).
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
/** Player unit at (5,5) attacks an enemy at (5,4). setupFn(a, d, s) runs before the battle starts. */
function duel(aType, dType, rolls, setupFn, extra = []) {
  const s = setup();
  s.library.unitTypes.push(aType, dType, ...extra.map(e => e.type));
  const a = add(s, { typeId: aType.id, side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: dType.id, side: 'enemy', x: 5, y: 4 });
  for (const e of extra) e.id = add(s, { typeId: e.type.id, side: e.side, x: e.x, y: e.y, owner: e.side === 'player' ? 'p1' : undefined });
  if (setupFn) setupFn(R.unitById(s, a), R.unitById(s, d), s);
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  dice(rolls);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  return { s, A: R.unitById(s, a), D: R.unitById(s, d), r };
}
const part = (roll, re) => roll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);
const traits = (o) => (u) => { u.traitTiers = o; };

test('Anti-Cavalry (+0/+2/+4) and Anti-Infantry (+1/+2/+4): only on the unit\'s own attacks', () => {
  const { r } = duel(unitType('a'), unitType('c', { category: 'cavalry' }), [3, 0, 0, 0], (a, d) => { a.traitTiers = { 'anti-cavalry': 3 }; d.traitTiers = { 'anti-infantry': 2 }; });
  assert.strictEqual(part(r.attackRoll, /^Anti-Cavalry/), 4);
  assert.strictEqual(part(r.defendRoll, /^Anti-Infantry/), 0, 'not when defending');
  const b = duel(unitType('a'), unitType('c', { category: 'cavalry' }), [3, 0, 0, 0], traits({ 'anti-cavalry': 1 }));
  assert.strictEqual(part(b.r.attackRoll, /^Anti-Cavalry/), 0, 'plain Anti-Cavalry adds nothing to the roll');
});

test('Precision: Attack +2/+4 if the unit has not moved before attacking; Hefty Weapon -2 after moving', () => {
  const p = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ precision: 2 }));
  assert.strictEqual(part(p.r.attackRoll, /^Precision/), 4);
  p.A.round.moved = true;
  assert.strictEqual(part(R.buildRoll(p.s, p.A, 'attacker', { attacker: p.A, defender: p.D, ranged: false }), /^Precision/), 0, 'moved first');
  const h = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'hefty weapon': 1 }));
  assert.strictEqual(part(h.r.attackRoll, /^Hefty/), 0, 'did not move');
  h.A.round.moved = true;
  assert.strictEqual(part(R.buildRoll(h.s, h.A, 'attacker', { attacker: h.A, defender: h.D, ranged: false }), /^Hefty/), -2);
});

test('Brace adds melee defense while holding; Shielded adds melee +1/level and ranged +2/level; Shield Battery; Poison lowers defense', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('h'), unitType('m'), unitType('r', { weapon: 'ranged', rangeMax: 3 }));
  const h = add(s, { typeId: 'h', side: 'enemy', x: 5, y: 4 });
  const m = add(s, { typeId: 'm', side: 'player', owner: 'p1', x: 5, y: 5 });
  const rr = add(s, { typeId: 'r', side: 'player', owner: 'p1', x: 5, y: 7 });
  const H = R.unitById(s, h);
  H.traitTiers = { brace: 1, shielded: 3, 'shield battery': 1 }; H.round.holding = true; H.fx = { stillLast: true, poison: 1 };
  const roll = (att) => { const A = R.unitById(s, att); return R.buildRoll(s, H, 'defender', { attacker: A, defender: H, ranged: R.typeOf(s, A).weapon === 'ranged' }); };
  const melee = roll(m), ranged = roll(rr);
  assert.strictEqual(part(melee, /^Brace/), 2);
  assert.strictEqual(part(melee, /^Shielded/), 3);
  assert.strictEqual(part(melee, /^Shield Battery/), 0);
  assert.strictEqual(part(ranged, /^Shielded/), 6);
  assert.strictEqual(part(ranged, /^Shield Battery/), 2);
  assert.strictEqual(part(ranged, /^Brace/), 0);
  assert.strictEqual(part(melee, /^Poisoned/), -1);
  assert.strictEqual(part(ranged, /^Poisoned/), -1);
});

test('Swarm: Attack +2 with an ally next to the target; Volley Fire after a ranged hit this round', () => {
  const ally = { type: unitType('al'), side: 'player', x: 6, y: 4 };
  const { s, A, D, r } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], (a) => { a.traitTiers = { swarm: 2, 'volley fire': 1 }; }, [ally]);
  assert.strictEqual(part(r.attackRoll, /^Swarm/), 2);
  assert.strictEqual(part(r.attackRoll, /^Volley Fire/), 0, 'no ranged hit yet this round');
  D.round.hitByRanged = true;
  assert.strictEqual(part(R.buildRoll(s, A, 'attacker', { attacker: A, defender: D, ranged: false }), /^Volley Fire/), 1);
});

test('Unwavering ignores the Demoralized penalty', () => {
  const { r } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], (a) => { a.traitTiers = { unwavering: 1 }; a.morale = 10; });
  assert.ok(r.attackRoll.parts.some(([l, v]) => /Demoralized \(ignored: Unwavering\)/.test(l) && v === 0));
});

test('Counter-Attack: a winning defender strikes back harder; Duelist ignores strike-back damage', () => {
  // defender wins: A 0+2 = 2, D 9 -> diff 7. Return damage 6 + 7 + 4 (Counter-Attack+) = 17 - armor 3 = 14.
  let { A } = duel(unitType('a'), unitType('d'), [0, 0, 9, 0], (a, d) => { d.traitTiers = { 'counter-attack': 2 }; });
  assert.strictEqual(A.men, 100 - 14);
  ({ A } = duel(unitType('a'), unitType('d'), [0, 0, 9, 0], (a) => { a.traitTiers = { duelist: 1 }; }));
  assert.strictEqual(A.men, 100);
});

test('Sunder and Poison stick to a beaten defender and do not stack; Shield Breaker ignores shield armor', () => {
  let { D } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { a.traitTiers = { sunder: 2, poison: 1 }; d.fx = { sunder: 2, poison: 1 }; });
  assert.strictEqual(D.fx.sunder, 4, 'Sunder+ replaces Sunder');
  assert.strictEqual(D.fx.poison, 1, "Poison doesn't stack");
  // attacker 9+2 = 11 vs 0 -> diff 11; damage 6 + 11 = 17. Defender armor 3 of which 2 shield -> 1 counts: 16 casualties.
  ({ D } = duel(unitType('a'), unitType('d', { shieldArmor: 2 }), [9, 0, 0, 0], (a) => { a.traitTiers = { 'shield breaker': 1 }; }));
  assert.strictEqual(D.men, 100 - 16);
});

test('Terror: +2 morale loss; Terror+: double; Fragile loser loses 5 more', () => {
  // diff 11 (9+2 vs 0): the loser loses 10, plus the morale its casualties cost
  const cm = (r) => r.casualtyMorale.defender;
  let { D, r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], traits({ terror: 1 }));
  assert.strictEqual(D.morale, 50 - 12 - cm(r));
  ({ D, r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], traits({ terror: 2 })));
  assert.strictEqual(D.morale, Math.max(0, 50 - 20 - cm(r)));
  ({ D, r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { fragile: 1 }; }));
  assert.strictEqual(D.morale, 50 - 15 - cm(r));
});

test('Reload: after attacking it must take the Reload action (allowed after moving, ends the turn) before attacking again', () => {
  const { s, A, D } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [3, 0, 0, 0], traits({ reload: 1 }));
  assert.strictEqual(A.fx.reload, 'empty');
  // its next activation: can't attack, can move and then reload
  s.turn.activation = { unitId: A.id, step: 'move', started: true, movedThisActivation: false, tilesMoved: 0 }; A.round = { ...A.round, attacked: false, moved: false };
  const menu = R.actionMenu(s, A);
  assert.ok(!menu.attack && menu.reload);
  assert.ok(!R.act(s, P1, { type: 'attack', unitId: A.id, targetId: D.id }).ok);
  must(R.act(s, P1, { type: 'moveTo', unitId: A.id, x: 5, y: 6 }));
  must(R.act(s, P1, { type: 'reload', unitId: A.id }));
  assert.ok(!A.fx.reload);
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== A.id, 'reloading ends the turn');
});

test('Barbed Arrows: a hit target moves 1 less on its next turn; Expendable gives no kill morale; Mercenary earns no XP', () => {
  let { D } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [9, 0, 0, 0], traits({ 'barbed arrows': 1 }));
  assert.ok(D.fx.slow);
  const { r } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], (a, d) => { d.traitTiers = { expendable: 1 }; d.men = 1; a.traitTiers = { mercenary: 1 }; });
  assert.ok(!r.killMorale);
  assert.strictEqual(r.xpAttacker, 0);
});

test('Range Up: +2 range after standing still; Moving Shot keeps the attacker bonus after moving', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('r', { weapon: 'ranged', rangeMax: 3 }), unitType('t'));
  const r = add(s, { typeId: 'r', side: 'player', owner: 'p1', x: 5, y: 10 });
  const t = add(s, { typeId: 't', side: 'enemy', x: 5, y: 5 });
  const U = R.unitById(s, r), T = R.unitById(s, t);
  assert.ok(!R.rangeOk(s, U, T));
  U.traitTiers = { 'range up': 2 }; U.fx = { stillLast: true };
  assert.ok(R.rangeOk(s, U, T), '5 tiles with range 3+2');
  U.traitTiers['moving shot'] = 1; U.round.moved = true;
  const roll = R.buildRoll(s, U, 'attacker', { attacker: U, defender: T, ranged: true });
  assert.ok(roll.parts.some(([l, v]) => l === 'Attacker bonus' && v === 2));
});

test('Hybrid: a ranged unit fights an adjacent enemy in melee at Attack -2', () => {
  const { r } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [3, 0, 0, 0], traits({ hybrid: 1 }));
  assert.ok(!r.ranged);
  assert.strictEqual(part(r.attackRoll, /^Hybrid/), -2);
});

test('Dual Weapons: a second attack at -2 on another adjacent enemy, or skip', () => {
  const other = { type: unitType('o'), side: 'enemy', x: 4, y: 5 };
  const { s, A } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'dual weapons': 1 }), [other]);
  assert.strictEqual(s.turn.activation.step, 'second');
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'secondAttack', unitId: A.id, targetId: other.id }));
  const r2 = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.strictEqual(r2.defender, other.id);
  assert.strictEqual(part(r2.attackRoll, /^Second attack/), -2);
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== A.id, 'turn over');
});

test('Charge Reflection: a defender that beats a charge adds the charge bonus to its strike back', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('cav', { category: 'cavalry' }), unitType('d'));
  const a = add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 5, y: 1 });
  const d = add(s, { typeId: 'd', side: 'enemy', x: 5, y: 5 });
  R.unitById(s, d).traitTiers = { 'charge reflection': 1, 'anti-cavalry': 1 }; // only Anti-Cavalry units strike back at a charge
  must(R.act(s, HOST, { type: 'startBattle' })); dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 5, y: 4 })); // 3 tiles: charge +1
  dice([0, 0, 9, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  // A: 0+2+2 = 4 (3 tiles: +2), D: 9 -> diff 5. Return: 6 + 5 + 2 (reflected charge) = 13 - 3 = 10.
  assert.strictEqual(R.unitById(s, a).men, 100 - 10);
  assert.ok(r.charge);
});

test('Inspiration: allies next to it gain 4 morale at the end of the round, not the end of its turn', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('i'), unitType('al'), unitType('e'));
  const i = add(s, { typeId: 'i', side: 'player', owner: 'p1', x: 5, y: 5 });
  const al = add(s, { typeId: 'al', side: 'player', owner: 'p1', x: 6, y: 5 });
  add(s, { typeId: 'e', side: 'enemy', x: 15, y: 15 });
  R.unitById(s, i).traitTiers = { inspiration: 1 };
  must(R.act(s, HOST, { type: 'startBattle' })); dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  const round = s.turn.round;
  for (let g = 0; g < 20 && s.turn.round === round; g++) {
    if (!s.turn.activation) {
      const cand = s.units.filter(u => u.status === 'active');
      let ok = false;
      for (const u of cand) for (const actor of [P1, HOST]) if (!ok && R.act(s, actor, { type: 'begin', unitId: u.id }).ok) ok = true;
      if (!ok) for (const actor of [P1, HOST]) R.act(s, actor, { type: 'claim' });
      continue;
    }
    if (s.turn.activation.unitId === i) assert.strictEqual(R.unitById(s, al).morale, 50, 'nothing at the end of its own turn');
    const ac = s.turn.activation.unitId;
    R.act(s, R.unitById(s, ac).side === 'player' ? P1 : HOST, { type: 'endTurn', unitId: ac });
  }
  assert.strictEqual(s.turn.round, round + 1, 'round ended');
  assert.strictEqual(R.unitById(s, al).morale, 54);
});

test('Wedge + Dual Weapons: moves up after winning, then gets the second attack from the new tile', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('w'), unitType('d'), unitType('o'));
  s.library.formations.push({ id: 'wd', name: 'Wedge', defAll: -2, winReposition: true });
  const a = add(s, { typeId: 'w', side: 'player', owner: 'p1', x: 5, y: 4 });
  const d = add(s, { typeId: 'd', side: 'enemy', x: 5, y: 5 });
  const o = add(s, { typeId: 'o', side: 'enemy', x: 7, y: 5 }); // only adjacent after moving to (6,5)
  const A = R.unitById(s, a); A.formation = 'wd'; A.traitTiers = { 'dual weapons': 1 };
  must(R.act(s, HOST, { type: 'startBattle' })); dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  dice([9, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  assert.strictEqual(s.turn.activation.step, 'reposition');
  must(R.act(s, P1, { type: 'reposition', unitId: a, x: 6, y: 5 }));
  assert.strictEqual(s.turn.activation.step, 'second');
  assert.deepStrictEqual(s.turn.activation.second.targets, [o]);
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'secondAttack', unitId: a, targetId: o }));
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== a);
});

test('Allies can be moved through but Heavy units and enemies block', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('m', { move: 3 }), unitType('w'));
  const m = add(s, { typeId: 'm', side: 'player', owner: 'p1', x: 5, y: 5 });
  const w = add(s, { typeId: 'w', side: 'player', owner: 'p1', x: 5, y: 4 });
  const M = R.unitById(s, m);
  // straight up through the ally at (5,4) to (5,3)
  assert.ok(R.reachable(s, M, 2).has('5,3'));
  assert.ok(!R.reachable(s, M, 2).has('5,4'), "can't stop on the ally");
  R.unitById(s, w).traitTiers = { heavy: 1 };
  assert.ok(!R.reachable(s, M, 2).has('5,3'), 'Heavy ally blocks the straight path');
});

test('Trait text parses to tiers; shield armor is read from the armor note', async () => {
  const T = await import('../module/battle/traits.mjs');
  assert.deepStrictEqual(T.traitTiersOf('<p>Anti-Cavalry+ - Command rolls +2</p><p>Precision++ &ndash; x</p><p>Hefty Weapon</p><p>Range Up+: y</p><p>Counter-Attack - z</p>'),
    { 'anti-cavalry': 2, precision: 3, 'hefty weapon': 1, 'range up': 2, 'counter-attack': 1 });
  assert.strictEqual(T.shieldArmorOf('2 (Leather) + 2 (Lg Shield)'), 2);
  assert.strictEqual(T.shieldArmorOf('1 (Shield) + 1 (Helmet)'), 1);
  assert.strictEqual(T.shieldArmorOf('3'), 0);
});

test('Precision stacks on top of the ranged attacker bonus', () => {
  const { r } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d'), [3, 0, 0, 0], traits({ precision: 1 }));
  assert.strictEqual(part(r.attackRoll, /^Attacker bonus/), 2);
  assert.strictEqual(part(r.attackRoll, /^Precision/), 2);
});

test('threatArea: move tiles plus attack reach beyond them (archer move 3, range 3 reaches 6)', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('r', { weapon: 'ranged', rangeMin: 1, rangeMax: 3, move: 3 }), unitType('m', { move: 3 }));
  const r = R.unitById(s, add(s, { typeId: 'r', side: 'enemy', x: 10, y: 8 }));
  const { move, attack } = R.threatArea(s, r);
  assert.ok(move.has('10,5') && !move.has('10,4'));
  assert.ok(attack.has('10,2') && !attack.has('10,1'), 'range 3 beyond a 3-tile move');
  assert.ok(!attack.has('10,6'), 'move tiles are not repeated as attack tiles');
  const m = R.unitById(s, add(s, { typeId: 'm', side: 'enemy', x: 3, y: 8 }));
  const mt = R.threatArea(s, m);
  assert.ok(mt.attack.has('3,4') && !mt.attack.has('3,3'), 'melee reaches one tile past its move');
});

test('trait cards: level locks, upgrades, choices, and a higher version replacing the lower one', async () => {
  const T = await import('../module/battle/traits.mjs');
  const list = [
    { name: 'Anti-Infantry', desc: 'a', level: 1, upgrades: [{ level: 5, name: 'Anti-Infantry+', desc: 'b' }] },
    { name: 'Unwavering', desc: 'u', level: 8, upgrades: [] },
    { name: 'Anti-Cavalry', desc: 'c', level: 1, upgrades: [] },
    { name: '', level: 3, upgrades: [], options: [{ name: 'Anti-Cavalry+', desc: 'c+' }, { name: 'Duelist', desc: 'd' }], chosen: -1 },
  ];
  assert.deepStrictEqual(T.traitTiersOf(T.traitTextOf(list, 1)), { 'anti-infantry': 1, 'anti-cavalry': 1 });
  assert.strictEqual(T.pendingTraitChoices(list, 3), 1);
  list[3].chosen = 0;
  assert.deepStrictEqual(T.traitTiersOf(T.traitTextOf(list, 9)), { 'anti-infantry': 2, unwavering: 1, 'anti-cavalry': 2 });
  assert.ok(!/Anti-Cavalry -/.test(T.traitTextOf(list, 9)), 'Anti-Cavalry is replaced by Anti-Cavalry+');
  assert.deepStrictEqual([...T.replacedTraits(list, 9)], [[2, 'Anti-Cavalry+']]);
});
