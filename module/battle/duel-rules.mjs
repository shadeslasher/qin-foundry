// Pure helpers for officer duels (no Foundry needed: tested in test/duel.test.mjs).

/** Squares shown round the two officers in the close-up. */
export const DUEL_MARGIN = 2;

/** The squares to show: the two officers' squares with a margin, as { x, y, w, h }. */
export function duelWindow(a, b, margin = DUEL_MARGIN) {
  const x0 = Math.min(a.x, b.x) - margin, y0 = Math.min(a.y, b.y) - margin;
  const x1 = Math.max(a.x, b.x) + margin, y1 = Math.max(a.y, b.y) + margin;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
