// Lu Bu (David, 2026-11-19): enemy units with less morale than his unit get Command −5 when they attack it.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const HOST = { id: 'host', host: true };
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 3, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 3, move: 3, rangeMin: 1, rangeMax: 1 };
const MOD = { stat: 'command', value: -5, who: { side: 'enemies', all: true }, vs: { isSource: true }, if: { attacking: true, moraleBelowSource: true } };
function setup(luMorale, foeMorale) {
  const s = R.newState(); s.map.cols = 6; s.map.rows = 3; s.map.tiles = {}; for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push({ id: 'lb', name: 'Lu Bu', command: 4, fire: 5, skills: {}, passive: { effects: {} }, battle: { passive: { mods: [MOD] }, active: null, passiveName: 'Terror', activeName: '' } });
  const lb = R.unitById(s, R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 2, y: 1, officerId: 'lb', morale: luMorale }).unitId);
  const f = R.unitById(s, R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 3, y: 1, morale: foeMorale }).unitId);
  R.act(s, HOST, { type: 'startBattle' });
  return { s, lb, f };
}
const cmd = (r) => r.parts.filter(p => /Terror/.test(p[0])).reduce((a, p) => a + p[1], 0);
test('spec valid', () => assert.deepStrictEqual(validateSpec({ mods: [MOD] }, 'passive'), []));
test('only when the lower-morale unit attacks him', () => {
  let { s, lb, f } = setup(70, 50);
  assert.strictEqual(cmd(R.buildRoll(s, f, 'attacker', { attacker: f, defender: lb })), -5, 'attacking him with less morale');
  assert.strictEqual(cmd(R.buildRoll(s, f, 'defender', { attacker: lb, defender: f })), 0, 'not when he attacks');
  ({ s, lb, f } = setup(50, 70));
  assert.strictEqual(cmd(R.buildRoll(s, f, 'attacker', { attacker: f, defender: lb })), 0, 'not with more morale');
});
