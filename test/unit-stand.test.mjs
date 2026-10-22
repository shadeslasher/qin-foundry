import test from 'node:test';
import assert from 'node:assert';
globalThis.CONFIG = {}; globalThis.foundry = { utils: {} };
const U = await import('../module/unit-bars.mjs');

test('figures: one per 20% of strength (cavalry of 50), at least 1 while alive', () => {
  assert.deepStrictEqual([100, 81, 80, 61, 60, 41, 40, 21, 20, 1, 0].map(m => U.figureCount(m, 100)), [5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0]);
  assert.deepStrictEqual([50, 41, 40, 30, 10, 1].map(m => U.figureCount(m, 50)), [5, 5, 4, 3, 1, 1]);
});

test('loss order (2 back, 3 front): front-right first, then front-left, back-right, back-left; front-middle is the last man', () => {
  const key = (p) => p.join(',');
  const BL = '0.395,0.285', BR = '0.605,0.285', FL = '0.29,0.495', FM = '0.5,0.505', FR = '0.71,0.495';
  assert.deepStrictEqual(U.figureSlots(5).map(key), [BL, BR, FL, FM, FR]);
  assert.deepStrictEqual(U.figureSlots(4).map(key), [BL, BR, FL, FM]);
  assert.deepStrictEqual(U.figureSlots(3).map(key), [BL, BR, FM]);
  assert.deepStrictEqual(U.figureSlots(2).map(key), [BL, FM]);
  assert.deepStrictEqual(U.figureSlots(1).map(key), [FM]);
});
