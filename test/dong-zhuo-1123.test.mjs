// Dong Zhuo, 2026-11-23 (David): Xiliang Iron Cavalry reaches 4 tiles; cavalry within 4 get Command +2 more and can't
// surrender. Fight or Be Butchered: Attack +5 for 3 turns.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const base = { faction: 'X', tier: 2, weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const inf = { ...base, id: 'inf', name: 'Inf', category: 'infantry' }, cav = { ...base, id: 'cav', name: 'Cav', category: 'cavalry', move: 5 };
const PASSIVE = { mods: [{ stat: 'command', value: 1, who: { side: 'allies', range: 4 } }, { stat: 'command', value: 2, who: { side: 'allies', range: 4, filter: { category: 'cavalry' } } },
  { stat: 'enemyLoss', value: 2, who: { side: 'allies', range: 4, self: true } }], flags: [{ flag: 'noSurrender', who: { side: 'allies', range: 4, filter: { category: 'cavalry' } } }] };
const off = { id: 'dz', name: 'Dong Zhuo', command: 5, fire: 5, skills: {}, passive: { effects: {} }, skill: null, battle: { passive: PASSIVE, passiveName: 'Xiliang Iron Cavalry' }, rank: 1, family: 'dz' };

test('Xiliang Iron Cavalry: Command +1 within 4, cavalry +3 and no surrender within 4, nothing at 5', () => {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 14; s.map.rows = 6; s.map.tiles = {};
  for (let x = 0; x < 14; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf, cav); s.library.officers.push(off);
  const add = (typeId, x, o = {}) => must(R.act(s, HOST, { type: 'addUnit', typeId, side: 'enemy', x, y: 2, ...o })).unitId;
  const dz = add('cav', 1, { officerId: 'dz' }), i4 = add('inf', 5), c4 = add('cav', 4, { y: 3 }), c5 = add('cav', 6);
  must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', owner: 'p1', x: 12, y: 2 }));
  const U = (id) => R.unitById(s, id);
  assert.strictEqual(SK.stat(s, U(i4), 'command'), 1);
  assert.strictEqual(SK.stat(s, U(c4), 'command'), 3);
  assert.strictEqual(SK.stat(s, U(c5), 'command'), 0);
  assert.strictEqual(SK.flag(s, U(c4), 'noSurrender'), true);
  assert.strictEqual(SK.flag(s, U(i4), 'noSurrender'), false);
  assert.strictEqual(SK.flag(s, U(c5), 'noSurrender'), false);
  assert.strictEqual(SK.stat(s, U(dz), 'command'), 0, 'not his own unit');
});

test('AI worth of officer auras where a unit stands (2026-11-24)', () => {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 14; s.map.rows = 6; s.map.tiles = {};
  for (let x = 0; x < 14; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf, cav); s.library.officers.push(off);
  const add = (typeId, x, o = {}) => must(R.act(s, HOST, { type: 'addUnit', typeId, side: 'enemy', x, y: 2, ...o })).unitId;
  add('cav', 1, { officerId: 'dz' }); const c4 = add('cav', 5), c6 = add('cav', 7);
  must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', owner: 'p1', x: 12, y: 2 }));
  const U = (id) => R.unitById(s, id);
  assert.ok(SK.skillWorthAt(s, U(c4)) > 5, 'cavalry inside his aura: Command +3 and more');
  assert.strictEqual(SK.skillWorthAt(s, U(c6)), 0);
});
