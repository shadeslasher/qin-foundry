// Buff and debuff animations (David, 2026-11-21): which look plays for an effect, by the stats it changes.
import test from 'node:test';
import assert from 'node:assert';
import { looksOfBuff, looksOfKey } from '../module/battle/buff-looks.mjs';
const L = (b) => looksOfBuff(b).sort();
test('raises and lowers', () => {
  assert.deepStrictEqual(L({ mods: [{ stat: 'attack', value: 4 }, { stat: 'move', value: 1 }, { stat: 'moraleFloor', value: 10 }] }), ['atkUp', 'morUp', 'movUp']); // The Hero Commands
  assert.deepStrictEqual(L({ mods: [{ stat: 'attack', value: 3 }, { stat: 'meleeDef', value: 3 }] }), ['atkUp', 'defUp']);
  assert.deepStrictEqual(L({ mods: [{ stat: 'command', value: 4 }] }), ['cmdUp']); // Heaven-Sent Talent
  assert.deepStrictEqual(L({ mods: [{ stat: 'meleeDef', value: -5 }, { stat: 'rangedDef', value: -5 }], status: 'cantMoveOrAttack' }), ['defDn', 'stun']); // The Wolf
  assert.deepStrictEqual(L({ mods: [{ stat: 'damageTaken', value: -2 }] }), ['defUp']);
  assert.deepStrictEqual(L({ mods: [{ stat: 'command', value: -5 }] }), ['cmdDn']);
  assert.deepStrictEqual(L({ flags: [{ flag: 'ignoreLowMorale' }] }), ['morUp']);
  assert.deepStrictEqual(L({ flags: [{ flag: 'freeActive' }] }), [], 'nothing to show: the old sweep plays');
});
test('lasting trait effects', () => {
  assert.deepStrictEqual(looksOfKey('t:sunder:4'), ['defDn']);
  assert.deepStrictEqual(looksOfKey('t:suppressed'), ['atkDn', 'movDn']);
  assert.deepStrictEqual(looksOfKey('b:xyz'), []);
});
