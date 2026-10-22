import test from 'node:test';
import assert from 'node:assert';
globalThis.CONFIG = {}; globalThis.foundry = { utils: {} };
const U = await import('../module/unit-bars.mjs');

test('figures: one per 20% of strength (cavalry of 50), at least 1 while alive', () => {
  assert.deepStrictEqual([100, 81, 80, 61, 60, 41, 40, 21, 20, 1, 0].map(m => U.figureCount(m, 100)), [5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0]);
  assert.deepStrictEqual([50, 41, 40, 30, 10, 1].map(m => U.figureCount(m, 50)), [5, 5, 4, 3, 1, 1]);
});

test('loss order 4 5 3 / 2 1: front-right goes first, back-middle is the last man; back row layered left to right', () => {
  const key = (p) => p.join(',');
  const back = ['0.29,0.33', '0.5,0.31', '0.71,0.33'], front = ['0.395,0.53', '0.605,0.53'];
  assert.deepStrictEqual(U.figureSlots(5).map(key), [...back, ...front]);
  assert.deepStrictEqual(U.figureSlots(4).map(key), [...back, front[0]]);
  assert.deepStrictEqual(U.figureSlots(3).map(key), back);
  assert.deepStrictEqual(U.figureSlots(2).map(key), [back[0], back[1]]);
  assert.deepStrictEqual(U.figureSlots(1).map(key), [back[1]]);
});
