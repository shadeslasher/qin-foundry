// Behind a mountain (David, 2026-11-16): ranged attacks from directly across a mountain next to the target can't hit it.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const ut = (id, o) => Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
  damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
function map() {
  const s = R.newState(); s.map.cols = 10; s.map.rows = 10; s.map.tiles = {};
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.map.tiles['5,5'] = { terrain: 'mountain' };
  s.library.unitTypes.push(ut('inf'), ut('arch', { weapon: 'ranged', rangeMax: 4 }));
  return s;
}
const add = (s, o) => R.unitById(s, must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);

test('a unit right behind a mountain is safe from shots straight across it', () => {
  const s = map();
  const d = add(s, { typeId: 'inf', side: 'enemy', x: 6, y: 5 });   // east of the mountain
  const across = add(s, { typeId: 'arch', side: 'player', x: 3, y: 5 });
  assert.ok(R.mountainShields(s, across, d));
  assert.ok(!R.rangeOk(s, across, d), 'same row, mountain in between');
  const side = add(s, { typeId: 'arch', side: 'player', x: 6, y: 2 });
  assert.ok(R.rangeOk(s, side, d), 'from the north the mountain is not in the way');
  const behind = add(s, { typeId: 'arch', side: 'player', x: 9, y: 5 });
  assert.ok(R.rangeOk(s, behind, d), 'from the far side');
  const diag = add(s, { typeId: 'arch', side: 'player', x: 3, y: 4 });
  assert.ok(R.rangeOk(s, diag, d), 'not in a straight line');
});
