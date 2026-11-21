/* Frame-sheet effects (David, 2026-11-19): JB2A / Eskie effects turned into 10-across frame sheets, kept as private art
 * in modules/qin-3k-characters/art/fx/ (never in this repository). A missing sheet loads as null and is skipped. */

const FX_DIR = "modules/qin-3k-characters/art/fx/";
/** key: [file, frames, frame width, frame height, frames per second] */
export const SHEETS = {
  // Sun Ce: Lightning Campaign
  lcStrike: ["sunce-strike.webp", 30, 400, 400, 30],
  lcArc: ["sunce-arc.webp", 60, 600, 188, 10],
  lcStatic: ["sunce-static.webp", 59, 256, 256, 30],
  // Sun Ce: Reckless Conqueror
  rcErupt: ["sunce-erupt.webp", 60, 320, 320, 30],
  rcBelow: ["sunce-shieldb.webp", 75, 300, 300, 15],
  rcAbove: ["sunce-shielda.webp", 75, 300, 300, 15],
  rcRing: ["sunce-ring.webp", 60, 300, 300, 10],
  // Sun Quan: Heaven-Sent Talent
  hsStrands: ["sunquan-strands.webp", 61, 300, 300, 30],
  hsBeam: ["sunquan-beam.webp", 61, 480, 120, 15],
  hsBurst: ["sunquan-burst.webp", 51, 300, 300, 30],
  hsStars: ["sunquan-stars.webp", 60, 300, 300, 15],
  // Sun Quan: Guardian of the Great River (allies on or next to water)
  grWater: ["sunquan-water.webp", 78, 240, 240, 15],
  // Yuan Shao: Lord of the North (battle start) and The Hundred Thousand (Eskie Effects Patreon)
  ysGather: ["yuanshao-gather.webp", 19, 200, 200, 15],
  ysBurst: ["yuanshao-burst.webp", 22, 200, 200, 15],
  ysDustRing: ["yuanshao-dustring.webp", 15, 200, 200, 15],
  ysDustPuff: ["yuanshao-dustpuff.webp", 18, 200, 200, 15],
};
const cache = {};
export function loadSheet(key) {
  if (cache[key]) return cache[key];
  const [file, n, fw, fh, fps] = SHEETS[key];
  cache[key] = new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const base = PIXI.Texture.from(img).baseTexture, frames = [];
      for (let i = 0; i < n; i++) frames.push(new PIXI.Texture(base, new PIXI.Rectangle((i % 10) * fw, Math.floor(i / 10) * fh, fw, fh)));
      res({ frames, w: fw, h: fh, fps });
    };
    img.onerror = () => res(null);
    img.src = FX_DIR + file;
  });
  return cache[key];
}
export const loadSheets = (keys) => Promise.all(keys.map(loadSheet)).then(list => Object.fromEntries(keys.map((k, i) => [k, list[i]])));
/** The frame shown t seconds in (speed times its own rate); loops, or null once a one-shot has run out. */
export function frameAt(sheet, t, { speed = 1, loop = false } = {}) {
  if (!sheet || t < 0) return null;
  let f = Math.floor(t * sheet.fps * speed);
  if (loop) f %= sheet.frames.length; else if (f >= sheet.frames.length) return null;
  return sheet.frames[f];
}
/** A sprite for a sheet: additive, anchored at its centre (or ax along x), sized width W (height keeps the frame's shape unless H). */
export function sheetSprite(sheet, W, { ax = 0.5, H = null } = {}) {
  if (!sheet) return null;
  const sp = new PIXI.Sprite(sheet.frames[0]); sp.anchor.set(ax, 0.5); sp.blendMode = PIXI.BLEND_MODES.ADD;
  sp.width = W; sp.height = H ?? W * sheet.h / sheet.w; sp.visible = false;
  return sp;
}
/** Show frame tex on sp (keeping its size), or hide it. */
export function showFrame(sp, tex, alpha = 1) {
  if (!sp) return;
  if (!tex) { sp.visible = false; return; }
  const sx = sp.scale.x, sy = sp.scale.y; sp.texture = tex; sp.scale.set(sx, sy); sp.visible = true; sp.alpha = alpha;
}
globalThis.Hooks?.once?.("canvasReady", () => loadSheets(Object.keys(SHEETS)));
