// More automated Taos (2026-11-10): scene effects with roll bonuses, Invisible Armor, the "next Test" queue.
import test from 'node:test';
import assert from 'node:assert';
import { resolveTao, taoActionsFor, effectTotals } from '../module/rules/tao-rules.mjs';
import { collectBonuses, appliesToSkill } from '../module/rules/bonuses.mjs';

const A = { metal: 2, water: 3, fire: 4, wood: 2, earth: 3 };
test('scene Taos carry their bonuses, with the Aspect counted', () => {
  const r = resolveTao('hiddenShadow', 3, 3, A);
  assert.strictEqual(r.kind, 'scene'); assert.strictEqual(r.cost, 3);
  const b = collectBonuses([{ id: 't', name: 'x', bonuses: r.bonuses }], { aspects: A });
  assert.strictEqual(b[0].value, 4); assert.ok(appliesToSkill(b[0], 'stealth'));
  assert.strictEqual(resolveTao('hiddenShadow', 3, 2, A), null, 'level not known');
});
test('Invisible Armor sets a protection floor; Keen Eye waits for a Perception Test', () => {
  assert.strictEqual(resolveTao('breathOfPower', 3, 3, A).armorMin, 3);
  assert.deepStrictEqual(effectTotals([{ id: 'e', label: 'Invisible Armor', armorMin: 3 }]).armorMin, 3);
  const k = resolveTao('innerEye', 1, 2, A);
  assert.deepStrictEqual([k.kind, k.slot, k.value, k.skills], ['queue', 'test', 3, ['perception']]);
});
test('every known level of an automated Tao gets a button', () => {
  const rows = taoActionsFor([{ id: 'a', name: 'Tao of the Serene Presence', key: 'serenePresence', level: 4 }], A);
  assert.strictEqual(rows[0].actions.length, 4); assert.strictEqual(rows[0].other.length, 0);
});
