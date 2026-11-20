// Zhuge Liang (David, 2026-11-20): allies exactly 2 tiles from his unit can't be surrounded; his own unit gets +1 range
// when it's a ranged unit.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const HOST = { id: 'host', host: true };
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 3, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 3, move: 3, rangeMin: 1, rangeMax: 1 };
const bow = { id: 'bow', name: 'Bow', faction: 'X', tier: 3, category: 'ranged', weapon: 'ranged', skill: 'Gongshu', damage: 4, armor: 1, armorPen: 2, unitValue: 3, move: 3, rangeMin: 2, rangeMax: 4 };
const PASSIVE = { mods: [{ stat: 'command', value: 5, who: { side: 'allies', exact: 2 } }, { stat: 'range', value: 1, if: { category: 'ranged' } }, { stat: 'attack', value: -3, who: { side: 'enemies', range: 1 } }, { stat: 'meleeDef', value: -3, who: { side: 'enemies', range: 1 } }, { stat: 'rangedDef', value: -3, who: { side: 'enemies', range: 1 } }],
  flags: [{ flag: 'cantBeSurrounded' }, { flag: 'cantBeSurrounded', who: { side: 'allies', exact: 2 } }] };
test('spec valid', () => assert.deepStrictEqual(validateSpec(PASSIVE, 'passive'), []));
function setup(typeId) {
  const s = R.newState(); s.map.cols = 12; s.map.rows = 8; s.map.tiles = {}; for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf, bow);
  s.library.officers.push({ id: 'zl', name: 'Zhuge Liang', command: 4, fire: 3, skills: {}, passive: { effects: {} }, battle: { passive: PASSIVE, active: null, passiveName: 'Eight Trigrams', activeName: '' } });
  const zl = R.act(s, HOST, { type: 'addUnit', typeId, side: 'player', x: 2, y: 2, officerId: 'zl', morale: 60 }).unitId;
  const a2 = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 4, y: 2, morale: 60 }).unitId;
  const a1 = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 2, y: 3, morale: 60 }).unitId;
  const a3 = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 5, y: 2, morale: 60 }).unitId;
  R.act(s, HOST, { type: 'startBattle' });
  return { s, zl: R.unitById(s, zl), a1: R.unitById(s, a1), a2: R.unitById(s, a2), a3: R.unitById(s, a3) };
}
test('allies exactly 2 tiles away can\'t be surrounded; 1 or 3 away can', () => {
  const { s, zl, a1, a2, a3 } = setup('inf');
  assert.ok(SK.flag(s, zl, 'cantBeSurrounded'));
  assert.ok(SK.flag(s, a2, 'cantBeSurrounded'));
  assert.ok(!SK.flag(s, a1, 'cantBeSurrounded'));
  assert.ok(!SK.flag(s, a3, 'cantBeSurrounded'));
});
test('+1 range only on a ranged unit', () => {
  const b = setup('bow'); assert.strictEqual(SK.stat(b.s, b.zl, 'range'), 1);
  const i = setup('inf'); assert.strictEqual(SK.stat(i.s, i.zl, 'range'), 0);
});
