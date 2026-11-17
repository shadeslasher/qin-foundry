// Ride Them Down (Gongsun Zan, David 2026-11-17): draw a path up to the unit's movement (never the same square twice,
// ending on an empty square); his unit rides it, every enemy on it takes his unit's damage, and his turn ends.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res && res.ok !== false, res && res.error); return res; }
const cav = { id: 'cav', name: 'Cav', faction: 'X', tier: 2, category: 'cavalry', weapon: 'melee', skill: 'Qiangshu', damage: 8, armor: 3, armorPen: 3, unitValue: 2, move: 5, rangeMin: 1, rangeMax: 1 };
const inf = { ...cav, id: 'inf', name: 'Inf', category: 'infantry', move: 3 };
const ACTIVE = { require: { category: 'cavalry' }, pick: [{ id: 'p', side: 'path', range: 'move', count: 1 }], do: [{ ride: { pick: 'p' } }] };
const zan = { id: 'z', name: 'Officer z', command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Ride Them Down', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { activeName: 'Ride Them Down', active: ACTIVE } };
function setup() {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 6; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'grass' };
  s.library.unitTypes.push(cav, inf); s.library.officers.push(zan);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'cav', owner: 'p1', side: 'player', x: 1, y: 2, officerId: 'z', morale: 80 })).unitId;
  const e1 = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 2, y: 2 })).unitId;
  const e2 = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 3, y: 3 })).unitId;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'move', started: true, tilesMoved: 0, from: { x: 1, y: 2 } };
  return { s, a, e1, e2 };
}

test('the spec is valid', () => assert.deepStrictEqual(validateSpec(ACTIVE, 'active'), []));

test('riding a drawn path: both enemies on it are hit, he ends on the last square and his turn ends', () => {
  const { s, a, e1, e2 } = setup();
  const men = [e1, e2].map(id => R.unitById(s, id).men), n0 = s.log.length;
  must(R.act(s, HOST, { type: 'useSkill', unitId: a, picks: { p: [[2, 2], [3, 2], [3, 3], [3, 4], [4, 4]] } }));
  const u = R.unitById(s, a);
  assert.deepStrictEqual([u.x, u.y], [4, 4]);
  const ride = s.log.slice(n0).find(e => e.detail?.type === 'rideThrough');
  assert.deepStrictEqual(ride.detail.path, [[1, 2], [2, 2], [3, 2], [3, 3], [3, 4], [4, 4]]);
  assert.deepStrictEqual(ride.detail.hits.map(h => [h[0], h[2]]), [[e1, 1], [e2, 3]]);
  ride.detail.hits.forEach(([id, c], i) => assert.ok(c > 0 && men[i] - R.unitById(s, id).men === c));
  assert.notStrictEqual(s.turn.activation?.unitId, a, 'his turn is over');
});

test('bad paths are refused and cost nothing', () => {
  const { s, a } = setup();
  const m = R.unitById(s, a).morale;
  for (const [p, why] of [
    [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2], [2, 1]], 'crosses itself'],
    [[[2, 2], [4, 2]], 'skips a square'],
    [[[1, 3], [2, 3], [3, 3]], 'ends on a unit'],
    [[[1, 3], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4]], 'longer than its movement (5)'],
    [[], 'no path'],
  ]) { const r = R.act(s, HOST, { type: 'useSkill', unitId: a, picks: { p } }); assert.ok(r && r.ok === false, why); }
  assert.strictEqual(R.unitById(s, a).morale, m);
});
