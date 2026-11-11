// Battlefield skill shapes (2026-11-11): attacks that roll twice and keep the higher, attacks on a unit that roll twice and
// keep the lower, and damage reduction that grows with each attack a unit takes in a round.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 15, recharge: 0 }, battle });
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
const SPECS = {
  best: { flags: [{ flag: 'bestOfTwoAttack' }] },
  worst: { flags: [{ flag: 'worstOfTwoAgainst' }] },
  grow: { mods: [{ stat: 'damageTaken', value: -2 }, ...[1, 2, 3].map(n => ({ stat: 'damageTaken', value: -2, if: { attacksTakenAtLeast: n } }))] },
};
test('the specs are valid', () => { for (const [k, v] of Object.entries(SPECS)) assert.deepStrictEqual(validateSpec(v, 'passive'), [], k); });

// a die sequence: each yin/yang pair comes from the list in turn
function dice(list) { let i = 0; R.setRng(() => list[i++ % list.length]); }
const roll = (s, a, d) => R.buildRoll(s, a, 'attacker', { attacker: a, defender: d, ranged: false, charge: false, tilesMoved: 0 });

test('rolls twice and keeps the higher on its own attacks; an attacker on the other unit keeps the lower', () => {
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'b' }, { side: 'enemy', x: 2, y: 1 }, { side: 'enemy', x: 5, y: 5, officerId: 'w' }],
    [officer('b', { passive: SPECS.best }), officer('w', { passive: SPECS.worst })]);
  // first pair 1 vs 3 (value 2), second pair 1 vs 9 (value 8): best keeps 8
  dice([0.0, 0.2, 0.0, 0.8]);
  const a = roll(s, u(0), u(1));
  assert.strictEqual(a.parts[0][1], 8, JSON.stringify(a.parts[0]));
  assert.match(a.parts[0][0], /best of/);
  // the plain enemy attacks the "worst" unit: keeps 2
  dice([0.0, 0.8, 0.0, 0.2]);
  const b = roll(s, u(1), u(2));
  assert.strictEqual(b.parts[0][1], 2, JSON.stringify(b.parts[0]));
  // best attacking worst: they cancel, one roll
  dice([0.0, 0.8, 0.0, 0.2]);
  const c = roll(s, u(0), u(2));
  assert.doesNotMatch(c.parts[0][0], /of/);
  R.setRng(Math.random);
});

test('damage reduction grows with each attack it takes in a round', () => {
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'g' }, { side: 'enemy', x: 2, y: 1 }], [officer('g', { passive: SPECS.grow })]);
  const red = () => SK.stat(s, u(0), 'damageTaken', { role: 'defender' });
  assert.strictEqual(red(), -2);
  u(0).round.attacksTaken = 1; assert.strictEqual(red(), -4);
  u(0).round.attacksTaken = 3; assert.strictEqual(red(), -8);
  u(0).round.attacksTaken = 6; assert.strictEqual(red(), -8, 'at most 8');
});
