// Scene switcher thumbnails (David, 2026-11-16: "extremely laggy").
import test from 'node:test';
import assert from 'node:assert';
globalThis.Hooks ??= { on() {}, once() {} };
const { thumbSize } = await import('../module/scene-switcher.mjs');

test('thumbnail crop covers a 300×188 card from a wide map', () => {
  const c = thumbSize(6000, 3000);
  assert.deepStrictEqual([c.tw, c.th], [300, 188]);
  assert.ok(Math.abs(c.sh - 3000) < 1e-9);           // full height used
  assert.ok(Math.abs(c.sw / c.sh - 300 / 188) < 1e-9); // card's shape
  assert.ok(Math.abs(c.sx - (6000 - c.sw) / 2) < 1e-9 && c.sy === 0);
});
test('thumbnail crop of a tall map uses the full width, centred', () => {
  const c = thumbSize(1000, 4000);
  assert.ok(Math.abs(c.sw - 1000) < 1e-9 && c.sx === 0);
  assert.ok(c.sy > 0 && Math.abs(c.sy * 2 + c.sh - 4000) < 1e-9);
});
