// Burning squares on the battle map (David, 2026-11-04): a soft pulsing orange glow and drifting embers on every
// square that is on fire (the map image draws the flames themselves; David didn't want a second set), drawn on the ground under the unit stands so units stay readable. Everyone on the scene
// sees them while the battle runs; they go when the fire burns out or is put out. The map image itself still shows
// its own (small, still) flames and, once burnt down, the scorched ground or ruins.
import { getBattle } from "./adapter.mjs";

let layer = null, glow = null, flames = null, fires = [], tickFn = null;

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
    flames.blendMode = PIXI.BLEND_MODES.ADD; // embers brighten what is under them
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
