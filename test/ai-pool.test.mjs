import test from 'node:test';
import assert from 'node:assert';
import * as AI from '../module/battle/ai.mjs';
import { thinkStep } from '../module/battle/ai-pool.mjs';

test('battle AI thread: answers a ping and passes errors back instead of throwing', async () => {
  const out = [];
  globalThis.self = globalThis; const keep = globalThis.postMessage;
  globalThis.postMessage = (d) => out.push(d);
  try {
    await import('../module/battle/ai-worker.mjs');
    globalThis.onmessage({ data: { id: 1, op: 'ping' } });
    globalThis.onmessage({ data: { id: 2, op: 'step', s: null, args: { sides: { enemy: true } } } });
  } finally { globalThis.postMessage = keep; delete globalThis.onmessage; }
  assert.deepStrictEqual(out[0], { id: 1, ok: true, result: 'pong' });
  assert.strictEqual(out[1].id, 2); assert.strictEqual(out[1].ok, false);
});

test('thinkStep without threads gives the same answer as aiStep', async () => {
  const s = { turn: { phase: 'tactics' }, units: [] };
  assert.deepStrictEqual(await thinkStep(s, {}), AI.aiStep(s, {}));
  assert.deepStrictEqual(AI.pickBest(['a', 'b', 'c'], [1, 3, 3]), { type: 'begin', unitId: 'b' }, 'ties go to the earlier unit');
});
