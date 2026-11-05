// Burning squares on the battle map (David, 2026-11-04): flickering flames and a soft pulsing orange glow on every
// square that is on fire, drawn on the ground under the unit stands so units stay readable. Everyone on the scene
// sees them while the battle runs; they go when the fire burns out or is put out. The map image itself still shows
// its own (small, still) flames and, once burnt down, the scorched ground or ruins.
import { getBattle } from "./adapter.mjs";

let layer = null, glow = null, flames = null, fires = [], tickFn = null;

/** One flame tongue as a polygon: base centre (cx, by), width w, height h, sway s (tip offset). */
function tongue(cx, by, w, h, s) {
  const left = [], right = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const hw = (w / 2) * Math.pow(1 - u, 1.2) * (u < 0.22 ? Math.sqrt(u / 0.22) * 0.85 + 0.15 : 1);
    const x = cx + s * u * u, y = by - h * u;
    left.push(x - hw, y); right.unshift(x + hw, y);
  }
  return [...left, ...right];
}

/** Draw one frame of the burning squares (pure apart from the Graphics; exported for the preview). */
export function drawFireFrame(gGlow, gFlames, list, size, t) {
  gGlow.clear(); gFlames.clear();
  for (const [x, y] of list) {
    const seed = (x * 73856093) ^ (y * 19349663), ph = (seed % 1000) / 159;
    const X = x * size, Y = y * size;
    // the glow: a warm square that breathes, brighter in the middle
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + ph);
    gGlow.beginFill(0xff5a00, 0.16 + 0.08 * pulse).drawRoundedRect(X + 1, Y + 1, size - 2, size - 2, size * 0.12).endFill();
    gGlow.beginFill(0xff9a2e, 0.12 + 0.08 * pulse).drawEllipse(X + size / 2, Y + size * 0.62, size * 0.42, size * 0.3).endFill();
    // the flames: five tongues along the bottom of the square, flickering and swaying, each with a hot core
    for (let i = 0; i < 5; i++) {
      const q = ph + i * 1.7;
      const fl = 0.75 + 0.25 * Math.sin(t * (7 + i) + q) * Math.sin(t * (3.1 + i * 0.7) + q * 2);
      const cx = X + size * (0.18 + i * 0.16) + Math.sin(t * 1.3 + q) * size * 0.02;
      const by = Y + size * (0.92 - (i % 2) * 0.06);
      const h = size * (i === 2 ? 0.78 : i % 2 ? 0.62 : 0.5) * fl, w = size * 0.27, s = Math.sin(t * 2.2 + q) * size * 0.08;
      gFlames.beginFill(0xc8280a, 0.55).drawPolygon(tongue(cx, by, w * 1.15, h, s)).endFill();
      gFlames.beginFill(0xff7a1a, 0.75).drawPolygon(tongue(cx, by, w * 0.8, h * 0.78, s * 0.8)).endFill();
      gFlames.beginFill(0xffd25a, 0.85).drawPolygon(tongue(cx, by - h * 0.02, w * 0.38, h * 0.45, s * 0.5)).endFill();
    }
    // embers drifting up
    for (let i = 0; i < 4; i++) {
      const life = ((t * 0.55 + i * 0.27 + ph) % 1);
      const ex = X + size * (0.25 + 0.5 * (((seed >> (i * 3)) & 7) / 7)) + Math.sin(t * 3 + i) * size * 0.05;
      const ey = Y + size * (0.85 - 0.85 * life);
      gFlames.beginFill(0xffb040, 0.9 * (1 - life)).drawCircle(ex, ey, size * 0.025 * (1 - life * 0.5)).endFill();
    }
  }
}

function stop() {
  if (tickFn) { canvas?.app?.ticker?.remove(tickFn); tickFn = null; }
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = glow = flames = null;
}

/** Show the flames for the burning squares of the battle on this scene (call on every battle change). */
export function drawFires() {
  const b = getBattle();
  const list = b.active && canvas?.ready && b.sceneId === canvas.scene?.id ? Object.keys(b.siege?.fires ?? {}).map(k => k.split(",").map(Number)) : [];
  fires = list;
  if (!list.length) return stop();
  if (!layer || layer.destroyed) {
    layer = new PIXI.Container(); layer.eventMode = "none";
    glow = new PIXI.Graphics(); flames = new PIXI.Graphics();
    flames.blendMode = PIXI.BLEND_MODES.ADD; // flames brighten what is under them
    layer.addChild(glow, flames);
    const parent = canvas.tokens ?? canvas.interface ?? canvas.stage; // on the ground, under the unit stands
    parent.addChildAt?.(layer, 0) ?? parent.addChild(layer);
    const t0 = performance.now();
    tickFn = () => {
      if (!layer || layer.destroyed) return;
      drawFireFrame(glow, flames, fires, canvas.scene?.grid?.size ?? 100, (performance.now() - t0) / 1000);
    };
    canvas.app.ticker.add(tickFn);
  }
}

export function registerFireFx() {
  Hooks.on("canvasReady", () => { stop(); drawFires(); });
  Hooks.on("canvasTearDown", () => stop());
}
