// Sun Quan (David, 2026-11-20): Guardian of the Great River gives allies within 4 Command +2; on or next to river, ford
// or marsh, his unit and allies within 4 also get Attack +2 and melee and ranged defense +2. Heaven-Sent Talent also
// gives the chosen unit Command +4 for 3 turns.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const HOST = { id: 'host', host: true };
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 3, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 3, move: 3, rangeMin: 1, rangeMax: 1 };
const W = { nextToTerrain: ['river', 'ford', 'marsh'] }, who = { side: 'allies', range: 4, self: true };
const PASSIVE = { mods: [{ stat: 'command', value: 2, who: { side: 'allies', range: 4 } }, { stat: 'attack', value: 2, who, if: W }, { stat: 'meleeDef', value: 2, who, if: W }, { stat: 'rangedDef', value: 2, who, if: W }] };
const ACTIVE = { pick: [{ id: 'a', side: 'allies', range: 5, count: 1, filter: { officer: true } }], do: [{ resetCooldown: { pick: 'a' } }, { buff: { flags: [{ flag: 'freeActive' }] }, who: { pick: 'a' }, for: 'nextSkill' }, { buff: { mods: [{ stat: 'command', value: 4 }] }, who: { pick: 'a' }, for: { rounds: 3 } }] };
test('specs valid', () => { assert.deepStrictEqual(validateSpec(PASSIVE, 'passive'), []); assert.deepStrictEqual(validateSpec(ACTIVE, 'active'), []); });
function setup() {
  const s = R.newState(); s.map.cols = 12; s.map.rows = 8; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) s.map.tiles[x + ',' + y] = { terrain: x === 6 ? 'river' : 'plains' };
  s.library.unitTypes.push(inf);
  s.library.officers.push({ id: 'sq', name: 'Sun Quan', command: 4, fire: 4, skills: {}, passive: { effects: {} }, battle: { passive: PASSIVE, active: null, passiveName: 'Guardian of the Great River', activeName: '' } });
  const add = (x, y, o) => R.unitById(s, R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x, y, officerId: o, morale: 60 }).unitId);
  const sq = add(3, 3, 'sq'), near = add(5, 3), far = add(2, 5), away = add(5, 7);
  R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 7, y: 3, morale: 60 });
  R.act(s, HOST, { type: 'startBattle' });
  return { s, sq, near, far, away };
}
test('Attack +2 and defense +2 only for allies within 4 that are on or next to the river', () => {
  const { s, near, far, sq } = setup();
  assert.strictEqual(SK.stat(s, near, 'attack'), 2);
  assert.strictEqual(SK.stat(s, near, 'meleeDef'), 2);
  assert.strictEqual(SK.stat(s, far, 'attack'), 0, 'away from the water');
  assert.strictEqual(SK.stat(s, sq, 'attack'), 0, 'his own unit, not near the water');
  assert.strictEqual(SK.stat(s, far, 'command'), 2, 'Command +2 everywhere in range');
});
test('next to the river but more than 4 tiles from him: nothing', () => {
  const { s, away } = setup();
  assert.strictEqual(SK.stat(s, away, 'attack'), 0);
});
