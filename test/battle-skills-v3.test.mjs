// Battlefield skills, v3 building blocks (David, 2026-11-05): memory, officer checks, turn order, casualties,
// traits, tactics, timing by his turn, counters, challenges, drawn attacks, line moves, forced attacks.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const off = (id, battle, extra = {}) => ({ id, name: 'Off ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 10, recharge: 0 }, battle, rank: 1, family: id, ...extra });
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...(u.officerId && u.morale === undefined ? { morale: 80 } : {}), ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}
const act = (s, id) => { s.turn.activation = { unitId: id, step: 'move', started: false, tilesMoved: 0, from: { ...R.unitById(s, id) } }; };
const sum = (parts) => parts.reduce((a, p) => a + p[1], 0);

test('memory: Attack +3 against an enemy that won its last melee', () => {
  const o = off('a', { passive: { mods: [{ stat: 'attack', value: 3, who: { self: true }, vs: { wonLastMelee: true } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }, { side: 'enemy', x: 1, y: 2 }], [o]);
  SK.onAttack(s, u(1), u(2), { winner: 'attacker', ranged: false });
  assert.strictEqual(sum(SK.rollParts(s, u(0), 'attacker', { attacker: u(0), defender: u(1) })), 3);
  assert.strictEqual(sum(SK.rollParts(s, u(0), 'attacker', { attacker: u(0), defender: u(2) })), 0);
});

test('officer checks: next to an ally led by a higher-rank officer; his faction leader', () => {
  const o = off('a', { passive: { mods: [{ stat: 'command', value: 1, who: { self: true }, if: { allyAdjacentWhere: { officerRank: 'above' } } },
    { stat: 'meleeDef', value: 2, who: { self: true }, if: { allyAdjacentWhere: { ledByFactionLeader: true } } }] } }, { rank: 2, faction: 'wei' });
  const lord = off('b', null, { rank: 5, ruler: true, faction: 'wei' });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 1, officerId: 'b' }, { side: 'enemy', x: 5, y: 5 }], [o, lord]);
  const parts = SK.rollParts(s, u(0), 'defender', { attacker: u(2), defender: u(0) });
  assert.strictEqual(sum(parts), 3);
  u(1).x = 8; assert.strictEqual(sum(SK.rollParts(s, u(0), 'defender', { attacker: u(2), defender: u(0) })), 0);
});

test('casualties that ignore armor; a trait granted for a while; an enemy tactic cancelled', () => {
  const o = off('a', { active: { pick: [{ id: 'e', side: 'enemies', range: 5, count: 1 }], do: [
    { casualties: 10, ignoreArmor: true, who: { pick: 'e' } }, { grantTrait: 'Zealot', who: { self: true }, for: { rounds: 2 } }, { cancelTactic: true }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 3, y: 1 }], [o]);
  act(s, ids[0]); const men = u(1).men;
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  assert.strictEqual(u(1).men, men - 10);
  assert.strictEqual(R.unitTrait(u(0), 'zealot'), 1);
  assert.ok(SK.cancelsTactic(s, 'enemy'));
});

test('his turn decides: a buff "until his next turn" ends when HE next starts a turn', () => {
  const o = off('a', { active: { do: [{ buff: { mods: [{ stat: 'meleeDef', value: 2 }] }, who: { side: 'allies', range: 1 }, for: 'untilSourceTurnStart' }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 1 }, { side: 'enemy', x: 6, y: 6 }], [o]);
  act(s, ids[0]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  SK.onActivationEnd(s, u(0));
  SK.onActivationStart(s, u(1)); SK.onActivationEnd(s, u(1));
  assert.strictEqual(SK.buffsOf(s, u(1)).length, 1, 'the ally\'s own turn doesn\'t end it');
  SK.onActivationStart(s, u(0));
  assert.strictEqual(SK.buffsOf(s, u(1)).length, 0, 'his next turn does');
});

test('counters: +1 Command for allies each turn he stays put, up to +4, reset when he moves', () => {
  const o = off('a', { passive: { mods: [{ stat: 'command', value: 1, per: 'fortify', max: 4, who: { side: 'allies', range: 4, self: true } }],
    triggers: [{ on: 'turnEnd', if: { moved: false }, do: [{ counter: 'fortify', add: 1, max: 4 }] }, { on: 'turnEnd', if: { moved: true }, do: [{ counter: 'fortify', set: 0 }] }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 2 }, { side: 'enemy', x: 9, y: 9 }], [o]);
  for (let i = 0; i < 6; i++) SK.onActivationEnd(s, u(0));
  assert.strictEqual(sum(SK.rollParts(s, u(1), 'defender', { attacker: u(2), defender: u(1) })), 4);
  u(0).round.moved = true; SK.onActivationEnd(s, u(0));
  assert.strictEqual(sum(SK.rollParts(s, u(1), 'defender', { attacker: u(2), defender: u(1) })), 0);
});

test('the first enemy to attack him must win a Command roll, or its attack is lost (unled units always lose)', () => {
  const o = off('a', { passive: { flags: [{ flag: 'challengeFirstAttacker', who: { self: true } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1 }], [o]);
  const men = u(0).men;
  const r1 = R.resolveAttack(s, u(1), u(0), { movedThisActivation: false, tilesMoved: 0 });
  assert.ok(r1.cancelled); assert.strictEqual(u(0).men, men);
  const r2 = R.resolveAttack(s, u(1), u(0), { movedThisActivation: false, tilesMoved: 0 });
  assert.ok(!r2.cancelled, 'only the first');
});

test('melee attacks on allies next to him are drawn onto him', () => {
  const o = off('a', { active: { do: [{ buff: { flags: [{ flag: 'drawMeleeAttacks:3' }] }, who: { self: true }, for: { rounds: 2 } }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 1 }, { side: 'enemy', x: 3, y: 1 }], [o]);
  act(s, ids[0]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  const r = R.resolveAttack(s, u(2), u(1), { movedThisActivation: false, tilesMoved: 0 });
  assert.strictEqual(r.defender, ids[0]);
});

test('a straight-line move, then a blast around where it stops', () => {
  const o = off('a', { active: { do: [{ move: 4, who: { self: true }, mode: 'line' }, { blast: true, moraleLoss: 10, selfHalf: true }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 5, y: 2 }], [o]);
  act(s, ids[0]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  const sq = SK.choiceSquares(s, SK.pendingChoice(s));
  assert.ok(sq.every(([x, y]) => x === 1 || y === 1), 'straight lines only');
  const m = u(1).morale, men0 = u(0).men;
  must(R.act(s, HOST, { type: 'skillChoose', x: 5, y: 1 }));
  assert.strictEqual(u(1).morale, m - 10);
  assert.ok(u(0).men < men0, 'his unit pays too');
});

test('an enemy that loses the roll turns on its neighbour; a "require" keeps an active unusable', () => {
  const o = off('a', { active: { pick: [{ id: 'e', side: 'enemies', range: 4, count: 1, filter: { allyAdjacent: true } }],
    do: [{ contest: { pick: 'e' }, lose: [{ forceAttack: { target: true }, at: { side: 'enemies', exact: 1, from: { target: true } } }] }] } });
  const o2 = off('b', { active: { require: { moraleBelow: 26 }, do: [{ morale: 5, who: { self: true } }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 3, y: 1 }, { side: 'enemy', x: 4, y: 1 }, { side: 'player', x: 9, y: 9, officerId: 'b' }], [o, o2]);
  act(s, ids[0]); const men = u(2).men;
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  assert.ok(u(2).men < men, 'the neighbour was attacked');
  act(s, ids[3]);
  assert.ok(!R.act(s, HOST, { type: 'useSkill', unitId: ids[3] }).ok, 'not at 60 morale');
});

test('turn order: the picked officer unit acts right after his unit', () => {
  const o = off('a', { active: { pick: [{ id: 'a', side: 'allies', range: 5, count: 1 }], do: [{ turnOrder: 'actNext', who: { pick: 'a' } }] } });
  const o2 = off('b', null), o3 = off('c', null);
  const { s, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 9, y: 9, officerId: 'c' }, { side: 'player', x: 2, y: 2, officerId: 'b' }], [o, o2, o3]);
  s.turn.order = [ids[0], ids[1], ids[2]]; s.turn.decided = [];
  must(R.act(s, HOST, { type: 'decide', unitId: ids[0], choice: 'act' }));
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[2]] } }));
  must(R.act(s, { id: 'p1' }, { type: 'endTurn', unitId: ids[0] }));
  assert.strictEqual(R.prompt(s).unitId, ids[2]);
});

test('v3.1: a later pick depends on the earlier one; two units swap; enemy effects are cleansed', () => {
  const o = off('a', { active: { pick: [{ id: 'a', side: 'allies', range: 5, count: 1 }, { id: 'b', side: 'allies', range: 5, count: 1, filter: { nearPick: { pick: 'a', range: 1 } } }],
    do: [{ swapUnits: { pick: 'a' }, with: { pick: 'b' } }, { cleanse: { pick: 'a' } }] } });
  const foe = off('z', { active: { pick: [{ id: 'e', side: 'enemies', range: 'any', count: 1 }], do: [{ status: 'cantMove', who: { pick: 'e' }, for: { rounds: 2 } }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 3, y: 3 }, { side: 'player', x: 4, y: 3 }, { side: 'player', x: 6, y: 1 }, { side: 'enemy', x: 9, y: 9, officerId: 'z' }], [o, foe]);
  act(s, ids[4]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[4], picks: { e: [ids[1]] } }));
  assert.ok(SK.status(s, u(1), 'cantMove'));
  act(s, ids[0]);
  assert.deepStrictEqual(SK.pickCandidates(s, u(0), { id: 'b', side: 'allies', range: 5, count: 1, filter: { nearPick: { pick: 'a', range: 1 } } }, { a: [ids[1]] }), [ids[2]]);
  assert.ok(!R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[1]], b: [ids[3]] } }).ok, 'not next to the first');
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[1]], b: [ids[2]] } }));
  assert.deepStrictEqual([u(1).x, u(2).x], [4, 3]);
  assert.ok(!SK.status(s, u(1), 'cantMove'), 'cleansed');
});
