import test from 'node:test';
import assert from 'node:assert';
const { healthV2 } = await import('../module/health-v2.mjs');
test('health v2: 100 → 75, 75 → 50, 50 → 40, 25 → 20, keeping the share of health left', () => {
  assert.deepStrictEqual(healthV2({ value: 100, max: 100 }), { value: 75, max: 75 });
  assert.deepStrictEqual(healthV2({ value: 80, max: 100 }), { value: 60, max: 75 });
  assert.deepStrictEqual(healthV2({ value: 75, max: 75 }), { value: 50, max: 50 });
  assert.deepStrictEqual(healthV2({ value: 25, max: 50 }), { value: 20, max: 40 });
  assert.deepStrictEqual(healthV2({ value: 25, max: 25 }), { value: 20, max: 20 });
  assert.strictEqual(healthV2({ value: 60, max: 60 }), null, 'other sizes are left alone');
  assert.strictEqual(healthV2({ value: 40, max: 40 }), null, 'already converted');
});
