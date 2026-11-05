// Officers' battlefield passives and actives at work (David, 2026-11-05): skills.mjs + the engine hooks.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle, skill = { name: 'Act', text: 'x', moraleCost: 10, recharge: 0 }) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill, battle });
/** 12x12 plains; units: [{ side, x, y, officerId }]; officers: library entries. Round 1 started. */
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

test('specs: the validator knows good and bad specs', () => {
  assert.deepStrictEqual(validateSpec({ mods: [{ stat: 'attack', value: 2, who: { self: true } }] }, 'passive'), []);
  assert.ok(validateSpec({ mods: [{ stat: 'speed', value: 2, who: { self: true } }] }, 'passive').length);
  assert.deepStrictEqual(validateSpec({ pick: [{ id: 'e', side: 'enemies', range: 3, count: 1 }], do: [{ buff: { mods: [{ stat: 'attack', value: 2, vs: { isPick: 'e' } }] }, who: { side: 'allies', all: true, self: true }, for: 'thisTurn' }] }, 'active'), []);
});

test('passive aura: allies within 2 get Attack +2 (in the roll), not those farther away, not enemies', () => {
  const o = officer('a', { passiveName: 'Rally', passive: { mods: [{ stat: 'attack', value: 2, who: { side: 'allies', range: 2, self: true } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 2 }, { side: 'player', x: 6, y: 6 }, { side: 'enemy', x: 3, y: 1 }], [o]);
  const parts = (x, role = 'attacker') => SK.rollParts(s, x, role, { attacker: x, defender: u(3) });
  assert.strictEqual(parts(u(0)).reduce((a, p) => a + p[1], 0), 2, 'his own unit');
  assert.strictEqual(parts(u(1)).reduce((a, p) => a + p[1], 0), 2, 'ally 2 tiles away');
  assert.strictEqual(parts(u(2)).length, 0, 'ally too far');
  assert.strictEqual(parts(u(3)).length, 0, 'enemy');
  assert.strictEqual(parts(u(1), 'defender').length, 0, 'Attack only counts on its attacks');
});

test('passive stats: movement, morale floor, no surrender', () => {
  const o = officer('a', { passive: { mods: [{ stat: 'move', value: 1, who: { self: true } }, { stat: 'moraleFloor', value: 10, who: { self: true } }] } });
  const o2 = officer('b', { passive: { flags: [{ flag: 'noSurrender', who: { self: true } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 5, y: 5, officerId: 'b' }, { side: 'enemy', x: 10, y: 10 }], [o, o2]);
  assert.strictEqual(R.movementOf(s, u(0)), 4);
  u(0).morale = 0; u(1).morale = 0; R.settle(s);
  assert.strictEqual(u(0).morale, 10, 'floor');
  assert.strictEqual(u(1).status, 'active', 'fights on at 0 morale');
});

test('active: picks are checked before anything is paid; a status lasts until the end of the target\'s next turn', () => {
  const act = { pick: [{ id: 'e', side: 'enemies', range: 5, count: 1 }], do: [{ status: 'cantMoveOrAttack', who: { pick: 'e' }, for: 'untilNextTurnEnd' }] };
  const o = officer('a', { activeName: 'Pin', active: act });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 3, y: 1 }, { side: 'enemy', x: 11, y: 11 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  const before = u(0).morale;
  assert.ok(!R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[2]] } }).ok, 'out of range');
  assert.strictEqual(u(0).morale, before, 'nothing paid');
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  assert.strictEqual(u(0).morale, before - 10);
  assert.ok(SK.status(s, u(1), 'cantMove') && SK.status(s, u(1), 'cantAttack'));
  assert.ok(SK.cantAttackReason(s, u(1), u(0)));
  SK.onActivationStart(s, u(1)); assert.ok(SK.status(s, u(1), 'cantAttack'), 'during its next turn');
  SK.onActivationEnd(s, u(1)); assert.ok(!SK.status(s, u(1), 'cantAttack'), 'gone after it');
});

test('buffs: "this turn" ends with the round; {rounds: 2} lasts into the next one; vs a picked unit only', () => {
  const act = { pick: [{ id: 'e', side: 'enemies', range: 5, count: 1 }], do: [
    { buff: { mods: [{ stat: 'attack', value: 3, vs: { isPick: 'e' } }] }, who: { self: true }, for: { rounds: 2 } },
    { buff: { mods: [{ stat: 'meleeDef', value: 1 }] }, who: { self: true }, for: 'thisTurn' }] };
  const o = officer('a', { active: act });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }, { side: 'enemy', x: 1, y: 2 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  const sum = (role, other) => SK.rollParts(s, u(0), role, role === 'attacker' ? { attacker: u(0), defender: other } : { attacker: other, defender: u(0) }).reduce((a, p) => a + p[1], 0);
  assert.strictEqual(sum('attacker', u(1)), 3, 'against the pick');
  assert.strictEqual(sum('attacker', u(2)), 0, 'not against another');
  assert.strictEqual(sum('defender', u(2)), 1, 'melee defense this turn');
  R._endRound(s);
  assert.strictEqual(sum('defender', u(2)), 0, 'this turn is over');
  assert.strictEqual(sum('attacker', u(1)), 3, 'the 2-turn buff carries on');
  s.turn.round++; R._endRound(s);
  assert.strictEqual(sum('attacker', u(1)), 0, 'and ends after its 2nd round');
});

test('triggers: a kill gives morale; once per battle limit holds', () => {
  const o = officer('a', { passive: { triggers: [{ on: 'kill', limit: 'battle', do: [{ morale: 10, who: { self: true } }] }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }], [o]);
  u(0).morale = 50;
  SK.onAttack(s, u(0), u(1), { winner: 'attacker', killedBy: u(0).id, casualtiesDefender: 5 });
  assert.strictEqual(u(0).morale, 60);
  SK.onAttack(s, u(0), u(1), { winner: 'attacker', killedBy: u(0).id, casualtiesDefender: 5 });
  assert.strictEqual(u(0).morale, 60, 'only once a battle');
});

test('triggers: enemy units that end their turn next to him lose morale; held by a buff, only while it lasts', () => {
  const act = { do: [{ buff: { triggers: [{ on: 'enemyEndsAdjacent', do: [{ morale: -3, who: { target: true } }] }] }, who: { self: true }, for: 'thisTurn' }] };
  const o = officer('a', { active: act });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  u(1).morale = 50; SK.onActivationEnd(s, u(1));
  assert.strictEqual(u(1).morale, 47);
  R._endRound(s); SK.onActivationEnd(s, u(1));
  assert.strictEqual(u(1).morale, 47, 'buff over');
});

test('active with a free move waits for the choice; other actions wait; the rest of the steps follow', () => {
  const act = { do: [{ move: 2, who: { self: true } }, { morale: 5, who: { self: true } }] };
  const o = officer('a', { active: act });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 10, y: 10 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  u(0).morale = 50;
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  assert.ok(SK.pendingChoice(s));
  assert.strictEqual(u(0).morale, 40, 'paid; the +5 waits for the move');
  assert.ok(!R.act(s, { id: 'p1' }, { type: 'endTurn', unitId: ids[0] }).ok, 'must choose first');
  assert.ok(!R.act(s, HOST, { type: 'skillChoose', x: 9, y: 9 }).ok, 'too far');
  must(R.act(s, HOST, { type: 'skillChoose', x: 3, y: 1 }));
  assert.deepStrictEqual([u(0).x, u(0).y], [3, 1]);
  assert.strictEqual(u(0).morale, 45);
  assert.ok(!SK.pendingChoice(s));
});

test('contest: an enemy that loses the Command roll is pushed back', () => {
  const act = { pick: [{ id: 'e', side: 'enemies', range: 1, count: 1 }], do: [{ contest: { pick: 'e' }, lose: [{ push: 2, who: { target: true } }] }] };
  const o = officer('a', { active: act });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  assert.deepStrictEqual([u(1).x, u(1).y], [4, 1], 'no officer: it always loses');
});

test('roll stats in an attack: armor and morale loss reductions', () => {
  const o = officer('a', { passive: { mods: [{ stat: 'armor', value: 3, who: { self: true } }, { stat: 'moraleLossLess', value: 100, who: { self: true } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }], [o]);
  u(0).morale = 50;
  let r; R.setRng(() => 0.05); r = R.resolveAttack(s, u(1), u(0), { movedThisActivation: false, tilesMoved: 0 });
  if (r.loser === u(0).id) assert.strictEqual(r.moraleLoss, 0, 'no morale from a lost roll');
  assert.ok(r.casualtiesDefender <= 6, 'armor 6 against damage 6 pen 3');
});

test('AI: uses a clearly good active at the start of its turn, and answers its free move', async () => {
  const AI = await import('../module/battle/ai.mjs');
  const act = { do: [{ morale: -20, who: { side: 'enemies', range: 3 } }, { move: 1, who: { self: true }, mode: 'toward' }] };
  const o = officer('a', { active: act }, { name: 'Roar', text: 'x', moraleCost: 5 });
  const { s, u, ids } = setup([{ side: 'enemy', x: 5, y: 5, officerId: 'a' }, { side: 'player', x: 7, y: 5 }, { side: 'player', x: 5, y: 7 }], [o]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  const a1 = AI.nextAction(s, ids[0], { level: 3 });
  assert.strictEqual(a1.type, 'useSkill');
  must(R.act(s, HOST, a1));
  assert.strictEqual(u(1).morale, 30, 'the roar hit');
  const a2 = AI.nextAction(s, ids[0], { level: 3 });
  assert.strictEqual(a2.type, 'skillChoose');
  must(R.act(s, HOST, a2));
  assert.ok(!SK.pendingChoice(s));
});

test('spec data: found by item id, else by the item text however its HTML is written', async () => {
  const D = await import('../module/battle/skill-data.mjs');
  const spec = { mods: [{ stat: 'move', value: 1, who: { self: true } }] };
  D.setSpecData({ specs: { k1: spec }, byItem: { abc: 'k1' }, byText: { [D.textHash(D.normText('<p>Moves 1 more&nbsp;tile.</p>'))]: 'k1' } });
  assert.strictEqual(D.specForItem({ _id: 'abc' }), spec);
  assert.strictEqual(D.specForItem({ _id: 'zzz', system: { description: '<div>Moves 1 more tile.</div>' } }), spec);
  assert.strictEqual(D.specForItem({ _id: 'zzz', system: { description: 'Something else' } }), null);
  D.setSpecData(null);
});
