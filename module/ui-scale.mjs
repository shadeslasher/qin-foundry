// Screen scale for the battle overlays (David, 2026-11-09): the banners, menus, tips and trackers drawn over the map are
// laid out for a 2560x1380 screen and scaled to the one in use (the smaller of the two ratios), so they look the same at
// any resolution. The CSS reads --qin-vs; code that places an overlay by its measured size multiplies by uiScale().
export const DESIGN_W = 2560, DESIGN_H = 1380;
export function uiScale(w = globalThis.innerWidth || DESIGN_W, h = globalThis.innerHeight || DESIGN_H) {
  return Math.max(0.5, Math.min(2.5, Math.min(w / DESIGN_W, h / DESIGN_H)));
}
/** Foundry's Font Size setting (Configure Settings > User Interface): the page's root font size over the default 16px.
 *  Info boxes (unit, tile and token hover boxes) grow and shrink with it (David, 2026-11-10). */
export function fontScale() {
  const px = parseFloat(globalThis.getComputedStyle?.(document.documentElement)?.fontSize) || 16;
  return Math.max(0.5, Math.min(2, px / 16));
}
/** Scale of the info boxes: the screen scale times the font size setting. */
export const infoScale = () => uiScale() * fontScale();
function apply() {
  const st = document.documentElement?.style; if (!st) return;
  st.setProperty("--qin-vs", String(uiScale()));
  st.setProperty("--qin-ib", String(infoScale()));
}
export function registerUiScale() {
  apply();
  globalThis.addEventListener?.("resize", apply);
  Hooks.once("ready", () => setTimeout(apply, 0));                      // after Foundry has applied the font size
  Hooks.on("clientSettingChanged", (key) => { if (key === "core.uiConfig" || key === "core.fontSize") setTimeout(apply, 0); });
}
