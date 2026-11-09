// Battlefield skills, 2026-11-09 (David): "his own district" comes from the world map (Cai Zan's Local Levies), and a
// battle-start reveal is picked by the GM, or by the AI for an AI side (Liu Dan's Inside Knowledge).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { aiStep } from '../module/battle/ai.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const big = { ...inf, id: 'big', name: 'Big', tier: 4, unitValue: 4 };
const off = (id, battle, extra = {}) => ({ id, name: 'Off ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: null, battle, rank: 1, family: id, ...extra });
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf, big); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: u.typeId || 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...u })).unitId);
  for (const [i, u] of units.entries()) if (u.hidden) R.unitById(s, ids[i]).hidden = true;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

const LEVIES = { passive: { mods: [{ stat: 'startMorale', value: 5, if: { homeDistrict: true } }] } };
const INSIDE = { passive: { triggers: [{ on: 'battleStart', do: [{ revealPick: 1 }] }] } };

test('specs are valid', () => {
  assert.deepStrictEqual(validateSpec(LEVIES.passive, 'passive'), []);
  assert.deepStrictEqual(validateSpec(INSIDE.passive, 'passive'), []);
});

test('Local Levies: +5 starting morale only when fighting in his own district', () => {
  const home = setup([{ side: 'enemy', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 8, y: 8 }], [off('a', LEVIES, { homeDistrict: true })]);
  const away = setup([{ side: 'enemy', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 8, y: 8 }], [off('a', LEVIES, { homeDistrict: false })]);
  assert.strictEqual(home.u(0).morale - away.u(0).morale, 5);
});

test('Inside Knowledge (GM side): waits for a pick, then reveals the chosen hidden enemy', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 8, y: 8, hidden: true }, { side: 'enemy', x: 9, y: 9, hidden: true }], [off('a', INSIDE)]);
  const p = SK.pendingReveal(s); assert.ok(p, 'a reveal is waiting');
  assert.strictEqual(SK.revealCandidates(s, u(0)).length, 2);
  assert.ok(!R.act(s, { id: 'p1' }, { type: 'skillReveal', pickId: p.id, targetId: ids[2] }).ok, 'only the GM picks');
  must(R.act(s, HOST, { type: 'skillReveal', pickId: p.id, targetId: ids[2] }));
  assert.strictEqual(u(2).hidden, false); assert.strictEqual(u(1).hidden, true);
  assert.strictEqual(SK.pendingReveal(s), null);
});

test('Inside Knowledge (AI side): the AI picks the strongest hidden enemy', () => {
  const { s, u, ids } = setup([{ side: 'enemy', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 6, y: 6, hidden: true }, { side: 'player', x: 9, y: 9, hidden: true, typeId: 'big' }], [off('a', INSIDE)]);
  const a = aiStep(s, { enemy: true });
  assert.deepStrictEqual(a && { type: a.type, targetId: a.targetId }, { type: 'skillReveal', targetId: ids[2] });
  must(R.act(s, HOST, a));
  assert.strictEqual(u(2).hidden, false); assert.strictEqual(u(1).hidden, true);
  assert.strictEqual(aiStep(s, { enemy: false }), null, 'the AI leaves a player-side pick alone');
});

test('Inside Knowledge with nothing hidden: nothing waits', () => {
  const { s } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 8, y: 8 }], [off('a', INSIDE)]);
  assert.strictEqual(SK.pendingReveal(s), null);
});

// Morale for beating an enemy unit, by tier (David, 2026-11-09)
test('killGain: same tier +10, +5 per tier above (max 25), -3 per tier below (min 2)', () => {
  const g = (k, f) => R.killGain(k, f);
  assert.deepStrictEqual([g(3, 3), g(2, 3), g(1, 3), g(1, 4), g(1, 5)], [10, 15, 20, 25, 25]);
  assert.deepStrictEqual([g(3, 2), g(3, 1), g(4, 1), g(5, 1)], [7, 4, 2, 2]);
});

test('a unit that makes the enemy surrender gains morale too (not only when it is destroyed)', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 1, y: 1 }, { side: 'enemy', x: 2, y: 1 }]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { ...u(0) } };
  u(1).morale = 1; u(0).morale = 50;
  R.setRng(() => 0.9);
  const r = R.resolveAttack(s, u(0), u(1), { movedThisActivation: false, tilesMoved: 0 });
  if (u(1).status === 'surrendered') { assert.strictEqual(r.killMorale, 10); assert.strictEqual(r.killMoraleBy, ids[0]); }
  else assert.fail('the enemy should have surrendered (status ' + u(1).status + ', morale ' + u(1).morale + ')');
});
