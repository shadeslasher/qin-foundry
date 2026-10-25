// Unit names (L): a dark pill under every unit stand you can see, with the unit's name and, in gold, its officer.
// A toggle that stays on until pressed again (per computer).
import { SIDE_COLORS } from "../unit-bars.mjs";

const KEY = "qin.nameLabels";
let on = false, layer = null, pending = null;

/** What a unit's label says (pure; exported for tests): the unit name, and the officer's name when it has one. */
export function labelLines(name, officerName) {
  return { main: String(name ?? "").trim() || "Unit", sub: String(officerName ?? "").trim() || null };
}

const unitVisible = (tok) => tok?.actor?.type === "unit" && !(tok.document?.hidden && !game.user.isGM);
const textClass = () => foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;

function clear() { if (layer && !layer.destroyed) layer.destroy({ children: true }); layer = null; }

export function drawNameLabels() {
  clear();
  if (!on || !canvas?.ready) return;
  const Txt = textClass(), T = canvas.scene?.grid?.size ?? 100;
  layer = new PIXI.Container(); layer.eventMode = "none";
  const f1 = Math.max(10, Math.round(T * 0.15)), f2 = Math.max(9, Math.round(T * 0.125));
  for (const tok of canvas.tokens?.placeables ?? []) {
    if (!unitVisible(tok) || tok.visible === false || tok.actor.system.status === "escaped") continue;
    let off = null; try { off = tok.actor.system.officerActor; } catch { off = null; }
    const { main, sub } = labelLines(tok.document.name, off?.name);
    const t1 = new Txt(main, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: f1, fontWeight: "bold", fill: "#ffffff" }));
    const t2 = sub ? new Txt(sub, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: f2, fill: "#f0c860" })) : null;
    const cx = tok.x + tok.w / 2, top = tok.y + tok.h + T * 0.03;
    const wd = Math.max(t1.width, t2 ? t2.width : 0) + T * 0.16, ht = t1.height + (t2 ? t2.height - 2 : 0) + T * 0.06;
    const bg = new PIXI.Graphics().lineStyle(Math.max(1, T * 0.015), SIDE_COLORS[tok.actor.system.side] ?? 0x888888, 1)
      .beginFill(0x14161a, 0.82).drawRoundedRect(cx - wd / 2, top, wd, ht, T * 0.05).endFill();
    t1.anchor?.set?.(0.5, 0); t1.position.set(cx, top + T * 0.02);
    layer.addChild(bg, t1);
    if (t2) { t2.anchor?.set?.(0.5, 0); t2.position.set(cx, top + T * 0.01 + t1.height - 1); layer.addChild(t2); }
    if (tok.document.hidden) { bg.alpha = 0.6; t1.alpha = 0.7; if (t2) t2.alpha = 0.7; } // the GM's view of a hidden unit
  }
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(layer);
}

export function nameLabelsOn() { return on; }
export function toggleNameLabels() {
  on = !on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* fine */ }
  drawNameLabels();
}

export function registerNameLabels() {
  try { on = localStorage.getItem(KEY) === "1"; } catch { on = false; }
  const redraw = () => { if (!on) return; clearTimeout(pending); pending = setTimeout(drawNameLabels, 60); };
  for (const h of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady", "refreshToken"]) Hooks.on(h, redraw);
  Hooks.on("canvasTearDown", clear);
}
