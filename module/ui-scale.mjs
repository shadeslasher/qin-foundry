// Screen scale for the battle overlays (David, 2026-11-09): the banners, menus, tips and trackers drawn over the map are
// laid out for a 2560x1380 screen and scaled to the one in use (the smaller of the two ratios), so they look the same at
// any resolution. The CSS reads --qin-vs; code that places an overlay by its measured size multiplies by uiScale().
export const DESIGN_W = 2560, DESIGN_H = 1380;
export function uiScale(w = globalThis.innerWidth || DESIGN_W, h = globalThis.innerHeight || DESIGN_H) {
  return Math.max(0.5, Math.min(2.5, Math.min(w / DESIGN_W, h / DESIGN_H)));
}
function apply() { document.documentElement?.style.setProperty("--qin-vs", String(uiScale())); }
export function registerUiScale() {
  apply();
  globalThis.addEventListener?.("resize", apply);
}
