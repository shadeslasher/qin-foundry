// Battle tactics: tactician setup before initiative, placement limits, triggers and effects.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
const P2 = { id: 'p2', host: false };
function dice(values) { const q = values.slice(); R.setRng(() => (q.length ? q.shift() : 0) / 10 + 0.001); }
function must(res) { assert.ok(res.ok, res.error); return res; }
function setup() { const s = R.newState(); s.players.p1 = { name: 'Alice' }; s.players.p2 = { name: 'Bob' }; return s; }
function add(s, o) { return must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
const LIU_BEI = { id: 'Actor.liu', name: 'Liu Bei', aow: 2, kind: 'player', userId: 'p1' };
const part = (roll, re) => roll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);
const lastAttack = (s) => s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;

/** A player unit at (5,5) and an enemy at (5,4); tactics placed by `place(s)` before the battle. */
function battle(place, extra = []) {
  const s = setup();
  s.library.unitTypes.push(unitType('a'), unitType('d'), ...extra.map(e => e.type));
  const a = add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 });
  for (const e of extra) e.id = add(s, { typeId: e.type.id, side: e.side, x: e.x, y: e.y, owner: e.side === 'player' ? 'p1' : undefined });
  must(R.act(s, HOST, { type: 'startBattle' }));
  if (place) place(s);
  must(R.act(s, HOST, { type: 'finishTactics' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  return { s, a, d, A: R.unitById(s, a), D: R.unitById(s, d) };
}

test('the battle opens with the tactics phase; finishing or skipping it moves on to formations', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('a'));
  add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 1, y: 1 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  assert.strictEqual(R.prompt(s).kind, 'tactics');
  must(R.act(s, HOST, { type: 'setTactician', side: 'enemy', tactician: { id: 'x', name: 'Zhang Bao', aow: 0 } }));
  must(R.act(s, HOST, { type: 'placeTactic', side: 'enemy', key: 'brutalize', x: 3, y: 3 }));
  must(R.act(s, HOST, { type: 'skipTactics' }));
  assert.strictEqual(s.turn.phase, 'formations');
  assert.strictEqual(s.tactics.placed.length, 0, 'skipping clears placed tactics');
});

test('player tactician: needs Art of War, places up to Art of War + 1 tactics of their level, once each', () => {
  const s = setup();
  must(R.act(s, HOST, { type: 'startBattle' }));
  assert.ok(!R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { id: 'x', name: 'Xu Chu', aow: 0 } }).ok, 'no Art of War');
  must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: LIU_BEI }));
  assert.ok(!R.act(s, P2, { type: 'placeTactic', side: 'player', key: 'attack', x: 1, y: 1 }).ok, 'another player cannot place');
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'enemy', key: 'attack', x: 1, y: 1 }).ok, 'players only place player tactics');
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'divineWinds', x: 1, y: 1 }).ok, 'Art of War 4 tactic');
  const id = must(R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'attack', x: 1, y: 1 })).tacticId;
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'attack', x: 2, y: 2 }).ok, 'once each');
  must(R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'attack', x: 6, y: 6, id }));
  assert.deepStrictEqual([s.tactics.placed[0].x, s.tactics.placed[0].y], [6, 6], 'moved, not duplicated');
  must(R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'defend', x: 2, y: 2 }));
  must(R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'ambush', x: 3, y: 3 }));
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'flanking', x: 4, y: 4 }).ok, 'Art of War 2 + 1 = 3 tactics');
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'raiseFlag', x: 4, y: 4 }).ok);
  // an officer tactician: only the GM places, same limits
  must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { id: 'h', name: 'Han Dang', aow: 1, kind: 'officer' } }));
  assert.strictEqual(s.tactics.placed.length, 0, 'a new tactician starts clean');
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'attack', x: 1, y: 1 }).ok);
  must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'attack', x: 1, y: 1 }));
  // Raise Flag needs high ground
  must(R.act(s, HOST, { type: 'setTactician', side: 'ally', tactician: { id: 'g', name: 'Huangfu Song' } }));
  assert.ok(!R.act(s, HOST, { type: 'placeTactic', side: 'ally', key: 'raiseFlag', x: 1, y: 1 }).ok);
  must(R.act(s, HOST, { type: 'placeTactic', side: 'ally', key: 'raiseFlag', x: 1, y: 1, highGround: true }));
});

test('Attack: fires on the first attack in its square, helps only that side, and only once', () => {
  const ally = { type: R.typeOf ? unitType('al') : null, side: 'ally', x: 6, y: 4 };
  const { s, A } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: LIU_BEI }));
    must(R.act(s, P1, { type: 'placeTactic', side: 'player', key: 'attack', x: 5, y: 5 }));
  }, [ally]);
  assert.strictEqual(s.tactics.placed[0].state, 'hidden');
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: A.id, targetId: lastIdEnemy(s) }));
  const r = lastAttack(s);
  assert.strictEqual(part(r.attackRoll, /^Tactic: Attack/), 2, 'the triggering attack already counts');
  assert.strictEqual(s.tactics.placed[0].state, 'active');
  assert.ok(s.log.some(e => e.detail && e.detail.type === 'tactic' && e.detail.tactic.name === 'Attack'));
  const AL = R.unitById(s, ally.id), D = R.unitById(s, lastIdEnemy(s));
  assert.strictEqual(part(R.buildRoll(s, AL, 'attacker', { attacker: AL, defender: D }), /^Tactic/), 0, 'ally units get nothing from a player tactic');
  // it lasts the rest of the round, then is spent
  s.turn.activation = null;
  R.act(s, HOST, { type: 'skipPrompt' });
  for (let i = 0; i < 6 && s.turn.round === 1; i++) R.act(s, HOST, { type: 'skipPrompt' });
  assert.strictEqual(s.tactics.placed[0].state, 'spent');
});
function lastIdEnemy(s) { return s.units.find(u => u.side === 'enemy').id; }

test('Defend fires when a unit in its square is attacked: melee and ranged defense +2', () => {
  const { s, A, D } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'enemy', tactician: { id: 'z', name: 'Zhang Bao' } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'enemy', key: 'defend', x: 5, y: 3 }));
  });
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: A.id, targetId: D.id }));
  assert.strictEqual(part(lastAttack(s).defendRoll, /^Tactic: Defend/), 2);
});

test('Raise Flag: from the centre tile instead of attacking, rallies the side to 50 morale', () => {
  const buddy = { type: unitType('b'), side: 'player', x: 7, y: 7 };
  const { s, A } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 1 } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'raiseFlag', x: 5, y: 5, highGround: true }));
  }, [buddy]);
  const B = R.unitById(s, buddy.id); B.morale = 20;
  assert.ok(R.actionMenu(s, A).raiseFlag);
  must(R.act(s, P1, { type: 'raiseFlag', unitId: A.id }));
  assert.strictEqual(B.morale, 50);
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== A.id, 'ends the turn');
});

test('Brutalize: destroying an enemy costs the other enemies in the square 25 morale', () => {
  const other = { type: unitType('o'), side: 'enemy', x: 7, y: 4 };
  const { s, A, D } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 5 } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'brutalize', x: 5, y: 5 }));
  }, [other]);
  D.men = 1;
  dice([9, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: A.id, targetId: D.id }));
  assert.strictEqual(R.unitById(s, other.id).morale, 25);
  assert.strictEqual(s.tactics.placed[0].state, 'spent');
});

test('Backs Turned: moving away from a unit in the square draws a free attack that cannot be struck back', () => {
  const { s, A, D } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'enemy', tactician: { id: 'z', name: 'Zhang Bao' } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'enemy', key: 'backsTurned', x: 5, y: 4 }));
  });
  dice([0, 0, 9, 0]);
  must(R.act(s, P1, { type: 'moveTo', unitId: A.id, x: 5, y: 7 }));
  const r = lastAttack(s);
  assert.strictEqual(r.attacker, D.id);
  assert.strictEqual(r.casualtiesAttacker, 0, 'no strike back');
  assert.ok(A.men < 100);
  assert.deepStrictEqual([A.x, A.y], [5, 7], 'the move still happens');
});

test('All Out Attack: attacking an enemy next to another unit of the side lets every unit in range strike for free', () => {
  const buddy = { type: unitType('b'), side: 'player', x: 6, y: 4 };
  const { s, A, D } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 4 } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'allOutAttack', x: 5, y: 5 }));
  }, [buddy]);
  dice([3, 0, 0, 0, 3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: A.id, targetId: D.id }));
  const attacks = s.log.filter(e => e.detail && e.detail.type === 'attack').map(e => e.detail.result);
  assert.strictEqual(attacks.length, 2);
  assert.strictEqual(attacks[1].attacker, buddy.id);
  assert.strictEqual(attacks[1].damageToAttacker, 0, 'free attack: no strike back');
  assert.ok(!R.unitById(s, buddy.id).round.attacked, "doesn't use the buddy's own attack");
});

test('Fury of a Phoenix: a second melee attack, +1 if the first was won', () => {
  const { s, A, D } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 5 } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'phoenix', x: 5, y: 5 }));
  });
  dice([5, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: A.id, targetId: D.id }));
  assert.strictEqual(s.turn.activation.step, 'second');
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'secondAttack', unitId: A.id, targetId: D.id }));
  assert.strictEqual(part(lastAttack(s).attackRoll, /Fury of a Phoenix/), 1);
  assert.strictEqual(part(lastAttack(s).attackRoll, /^Second attack/), 0, 'no Dual Weapons penalty');
});

test('Rapid Advance, Swift Retreat: forced march costs 2 morale a tile', () => {
  const { s, A } = battle((s) => {
    must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 3 } }));
    must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'rapidAdvance', x: 5, y: 5 }));
  });
  const red = R.moveOptions(s, A).red;
  assert.strictEqual(red.get('5,10').cost, 4, '2 tiles past a move of 3 = 4 morale');
  must(R.act(s, P1, { type: 'moveTo', unitId: A.id, x: 5, y: 10 }));
  assert.strictEqual(A.morale, 46);
});

test('Surrounded by Fear: no surrender or morale loss; free attacks until an attacker falls', () => {
  const ring = [[4, 6], [6, 6], [5, 5], [5, 7]].map(([x, y], i) => ({ type: unitType('r' + i), side: 'enemy', x, y }));
  const s = setup();
  s.library.unitTypes.push(unitType('p'), unitType('e'), ...ring.map(r => r.type));
  const p = add(s, { typeId: 'p', side: 'player', owner: 'p1', x: 5, y: 6 });
  add(s, { typeId: 'e', side: 'enemy', x: 5, y: 3 });
  for (const r of ring.slice(0, 3)) r.id = add(s, { typeId: r.type.id, side: 'enemy', x: r.x, y: r.y });
  const last = ring[3]; last.id = add(s, { typeId: last.type.id, side: 'enemy', x: 5, y: 9 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  must(R.act(s, HOST, { type: 'setTactician', side: 'player', tactician: { ...LIU_BEI, aow: 5 } }));
  must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: 'fear', x: 5, y: 6 }));
  must(R.act(s, HOST, { type: 'finishTactics' }));
  R.unitById(s, ring[0].id).men = 1;
  dice(new Array(40).fill(9));
  // the third enemy closes the ring
  R.unitById(s, last.id).y = 7; R.settle(s);
  const P = R.unitById(s, p);
  assert.strictEqual(P.status, 'active');
  assert.ok(P.morale >= 50, 'no -50 for being surrounded');
  assert.strictEqual(R.unitById(s, ring[0].id).status, 'defeated', 'it struck until one attacker fell');
});
