// Sun Ce (David, 2026-11-19): Reckless Conqueror (stacks per unit routed, attacking or defending) and Lightning Campaign
// (+1 movement within 4 tiles; allies that haven't acted take their turn right after his).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const RECKLESS = { mods: [{ stat: 'attack', value: 2, per: 'reckless', max: 5 }, { stat: 'meleeDef', value: -1, per: 'reckless', max: 5 }, { stat: 'rangedDef', value: -1, per: 'reckless', max: 5 }],
  triggers: [{ on: 'kill', do: [{ counter: 'reckless', add: 1, who: { self: true } }, { morale: 5, who: { self: true } }] },
    { on: 'defendKill', do: [{ counter: 'reckless', add: 1, who: { self: true } }, { morale: 5, who: { self: true } }] }] };
const LIGHTNING = { do: [{ buff: { mods: [{ stat: 'move', value: 1 }] }, who: { side: 'allies', range: 4, self: true }, for: { rounds: 3 } }, { turnNow: { side: 'allies', range: 4 } }] };
const sc = { id: 'sc', name: 'Sun Ce', command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Lightning Campaign', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { active: LIGHTNING, activeName: 'Lightning Campaign', passive: RECKLESS, passiveName: 'Reckless Conqueror' } };
function setup(units) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(sc);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', morale: 60, owner: u.side === 'player' ? 'p1' : undefined, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' })); R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}
const sum = (parts) => parts.reduce((a, p) => a + p[1], 0);

test('the specs are valid', () => {
  assert.deepStrictEqual(validateSpec(RECKLESS, 'passive'), []);
  assert.deepStrictEqual(validateSpec(LIGHTNING, 'active'), []);
});

test('Reckless Conqueror: +5 morale and a stack per rout, attacking or defending; Attack +2 / defense −1 each, up to 5', () => {
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'sc' }, { side: 'enemy', x: 2, y: 1 }]);
  const atk = () => sum(SK.rollParts(s, u(0), 'attacker', { attacker: u(0), defender: u(1) }));
  const def = () => sum(SK.rollParts(s, u(0), 'defender', { attacker: u(1), defender: u(0) }));
  const a0 = atk(), d0 = def(), m0 = u(0).morale;
  SK.onAttack(s, u(0), u(1), { winner: 'attacker', killedBy: u(0).id });            // he breaks a unit he attacks
  assert.strictEqual(atk() - a0, 2); assert.strictEqual(def() - d0, -1); assert.strictEqual(u(0).morale, m0 + 5);
  SK.onAttack(s, u(1), u(0), { winner: 'defender', killedBy: u(0).id });            // a unit breaks attacking him
  assert.strictEqual(atk() - a0, 4); assert.strictEqual(u(0).morale, m0 + 10);
  for (let i = 0; i < 6; i++) SK.onAttack(s, u(0), u(1), { winner: 'attacker', killedBy: u(0).id });
  assert.strictEqual(atk() - a0, 10, 'capped at +10'); assert.strictEqual(def() - d0, -5, 'capped at −5');
  SK.onAttack(s, u(1), u(0), { winner: 'attacker', killedBy: u(1).id });            // he is the one broken: no stack
  assert.strictEqual(atk() - a0, 10);
});

test('Lightning Campaign: +1 movement within 4 tiles; allies that haven\'t acted go right after his turn', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'sc', morale: 90 }, { side: 'player', x: 3, y: 2 }, { side: 'player', x: 2, y: 3 },
    { side: 'player', x: 9, y: 9 }, { side: 'enemy', x: 11, y: 0 }]);
  u(2).round.activated = true; // already acted this round
  const mv = [0, 1, 2, 3].map(i => SK.stat(s, u(i), 'move'));
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  assert.deepStrictEqual([0, 1, 2, 3].map(i => SK.stat(s, u(i), 'move') - mv[i]), [1, 1, 1, 0]);
  assert.deepStrictEqual(s.skillNow, [ids[1]], 'only the ally in range that has not acted');
  must(R.act(s, HOST, { type: 'endTurn', unitId: ids[0] }));
  assert.strictEqual(s.turn.activation?.unitId, ids[1], 'it takes its turn right after his');
  must(R.act(s, HOST, { type: 'endTurn', unitId: ids[1] }));
  assert.ok(u(1).round.activated, 'that was its turn for the round');
});
