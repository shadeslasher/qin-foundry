// Battle overlays and the activation banner scale with the screen (David, 2026-11-09).
import test from 'node:test';
import assert from 'node:assert';
import { uiScale } from '../module/ui-scale.mjs';
import { screenScale, artLayout } from '../module/battle/active-banner.mjs';

test('screen scale: 1 on the 2560x1380 design screen, the smaller ratio elsewhere, kept within 0.5..2.5', () => {
  assert.strictEqual(uiScale(2560, 1380), 1);
  assert.strictEqual(uiScale(1920, 1080), 0.75);
  assert.ok(Math.abs(uiScale(2549, 1374) - 0.9957) < 0.001);
  assert.strictEqual(uiScale(800, 400), 0.5);
  assert.strictEqual(screenScale(1280, 720), 0.5);
});
test('banner art box follows the screen', () => {
  assert.deepStrictEqual(artLayout({ src: 'x', w: 500, h: 1000 }, 0, 0, 860 * 0.75), { imgH: 1290, boxW: 645, offX: -0 });
});
