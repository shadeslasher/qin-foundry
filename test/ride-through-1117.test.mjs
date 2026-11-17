// Ride Them Down (Gongsun Zan): the ride logs its path and who it trampled, for the white-horse animation (0.192.0).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res && res.ok !== false, res && res.error); return res; }
const cav = { id: 'cav', name: 'Cav', faction: 'X', tier: 2, category: 'cavalry', weapon: 'melee', skill: 'Qiangshu', damage: 8, armor: 3, armorPen: 3, unitValue: 2, move: 5, rangeMin: 1, rangeMax: 1 };
const inf = { ...cav, id: 'inf', name: 'Inf', category: 'infantry', move: 3 };
const zan = { id: 'z', name: 'Officer z', command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { activeName: 'Ride Them Down', active: { do: [{ if: { category: 'cavalry' }, who: { self: true }, then: [{ buff: { mods: [{ stat: 'move', value: 2 }], flags: [{ flag: 'rideThrough' }, { flag: 'passThroughEnemies' }] }, who: { self: true }, for: 'thisTurn' }] }] } } };

test('riding through two enemies logs the path square by square and both hits', () => {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 6; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'grass' };
  s.library.unitTypes.push(cav, inf); s.library.officers.push(zan);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'cav', owner: 'p1', side: 'player', x: 1, y: 2, officerId: 'z', morale: 80 })).unitId;
  const e1 = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 3, y: 2 })).unitId;
  const e2 = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 5, y: 2 })).unitId;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'move', started: true, tilesMoved: 0, from: { x: 1, y: 2 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: a }));
  const n0 = s.log.length, men = [e1, e2].map(id => R.unitById(s, id).men);
  must(R.act(s, HOST, { type: 'moveTo', unitId: a, x: 6, y: 2 }));
  const ride = s.log.slice(n0).find(e => e.detail?.type === 'rideThrough');
  assert.ok(ride, 'a rideThrough entry');
  assert.strictEqual(ride.detail.skill, 'Ride Them Down');
  assert.deepStrictEqual(ride.detail.path, [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]]);
  assert.deepStrictEqual(ride.detail.hits.map(h => [h[0], h[2]]), [[e1, 2], [e2, 4]]);
  ride.detail.hits.forEach(([id, c], i) => assert.strictEqual(men[i] - R.unitById(s, id).men, c));
});
