// More battlefield skill shapes (2026-11-10): a morale gift, a keep-away contest (cantApproachSource) and a strike-back watch.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle, skill = { name: 'Act', text: 'x', moraleCost: 15, recharge: 0 }) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill, battle });
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...(u.officerId ? { morale: 80 } : {}), ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}
const SPECS = {
  p1: { mods: [{ stat: 'command', value: 1, who: { side: 'allies', range: 1 } }], triggers: [{ on: 'duelRefused', do: [{ morale: 10, who: { self: true } }] }] },
  a1: { pick: [{ id: 'a', side: 'allies', range: 2, count: 1 }], do: [{ morale: 10, who: { pick: 'a' } }] },
  p2: { mods: [{ stat: 'command', value: 1, if: { notMoved: true } }] },
  a2: { pick: [{ id: 'e', side: 'enemies', range: 3, count: 1 }], do: [{ contest: { pick: 'e' }, lose: [{ status: 'cantApproachSource', who: { target: true }, for: 'nextTurn' }] }] },
  p3: { mods: [{ stat: 'moraleLossLess', value: 2, who: { side: 'allies', range: 1 } }] },
  a3: { do: [{ buff: { triggers: [{ on: 'defendWin', do: [{ attack: { mods: [{ stat: 'attack', value: 3 }], target: { isTarget: true } }, who: { self: true } }] }] }, who: { self: true }, for: 'untilSourceTurnStart' }] },
};

test('the specs are valid', () => {
  for (const [k, v] of Object.entries(SPECS)) assert.deepStrictEqual(validateSpec(v, k.startsWith('a') ? 'active' : 'passive'), [], k);
});

test('adjacent allies get Command +1; an active gives an ally within 2 tiles 10 morale', () => {
  const o = officer('o1', { passive: SPECS.p1, active: SPECS.a1 }, { name: 'Act', text: 'x', moraleCost: 25, recharge: 3 });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'o1' }, { side: 'player', x: 2, y: 1 }, { side: 'player', x: 6, y: 6 }, { side: 'enemy', x: 10, y: 10 }], [o]);
  const sum = (x) => SK.rollParts(s, x, 'attacker', { attacker: x, defender: u(3) }).reduce((a, p) => a + p[1], 0);
  assert.strictEqual(sum(u(1)), 1); assert.strictEqual(sum(u(2)), 0);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  u(1).morale = 40;
  assert.ok(!R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[2]] } }).ok, 'too far');
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[1]] } }));
  assert.strictEqual(u(1).morale, 50);
});

test('Command +1 while not moved; a contest keeps an enemy from moving closer on its next turn', () => {
  const o = officer('o2', { passive: SPECS.p2, active: SPECS.a2 });
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 5, officerId: 'o2' }, { side: 'enemy', x: 4, y: 5 }], [o]);
  assert.strictEqual(SK.rollParts(s, u(0), 'attacker', { attacker: u(0), defender: u(1) }).reduce((a, p) => a + p[1], 0), 1);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 5 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } })); // no officer: loses the contest
  s.turn.activation = { unitId: ids[1], step: 'move', started: false, tilesMoved: 0, from: { x: 4, y: 5 } };
  const { blue } = R.moveOptions(s, u(1));
  assert.ok(blue.size > 0, 'it can still move');
  for (const k of blue.keys()) { const [x, y] = k.split(',').map(Number); assert.ok(Math.abs(x - 1) + Math.abs(y - 5) >= 3, 'never closer: ' + k); }
  assert.ok(!R.act(s, HOST, { type: 'moveTo', unitId: ids[1], x: 3, y: 5 }).ok);
});

test('adjacent allies lose 2 less morale from lost attacks; a watch lets his unit strike back at an attacker that loses', () => {
  const o = officer('o3', { passive: SPECS.p3, active: SPECS.a3 });
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5, officerId: 'o3' }, { side: 'player', x: 6, y: 5 }, { side: 'enemy', x: 5, y: 7 }], [o]);
  assert.strictEqual(SK.stat(s, u(1), 'moraleLossLess'), 2);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: {} }));
  assert.ok((u(0).fx.buffs || []).some(b => b.triggers), 'the watch is on');
  // the enemy attacks him and loses: his unit gets a short turn to strike back (Attack +3)
  s.turn.activation = { unitId: ids[2], step: 'move', started: true, tilesMoved: 0, from: { x: 5, y: 7 } };
  must(R.act(s, HOST, { type: 'moveTo', unitId: ids[2], x: 5, y: 6 }));
  let i = 0; R.setRng(() => [0, 0, 0.99, 0.99][i++ % 4]);
  must(R.act(s, HOST, { type: 'attack', unitId: ids[2], targetId: ids[0] }));
  assert.strictEqual(s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result.winner, 'defender');
  assert.strictEqual(s.turn.activation.unitId, ids[0]);
  assert.ok((s.turn.activation.skillQueue || []).some(q => q.kind === 'attack' && q.unitId === ids[0]), 'his counterattack');
  R.setRng(() => 0.3);
});
