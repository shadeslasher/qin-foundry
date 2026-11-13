// Placing a catapult during deployment (David, 2026-11-13): the squares where one can go (inside the player's
// deployment zone, on hills, forts or open ground) get a dashed amber outline; click one to set the catapult up there.
// Right-click or Esc cancels. The GM may place anywhere a catapult can stand.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { battleRequest } from "./battle.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battlemap.mjs";
import { DEPLOY_FLAG } from "./deploy-rules.mjs";
import { catapultTileOk } from "./siege-deploy.mjs";

let placing = null;
const AMBER = 0xf2c14e;

/** Squares where this user may set a catapult up now, as "x,y" keys. */
export function catapultSquares(scene = canvas?.scene) {
  const b = getBattle();
  if (!scene || !b.active || b.sceneId !== scene.id) return [];
  const flag = scene.getFlag(SYSTEM_ID, MAP_FLAG); if (!flag) return [];
  const tiles = { ...decodeTiles(flag) };
  for (const [k, o] of Object.entries(b.tileOverrides ?? {})) if (o?.tile) tiles[k] = o.tile;
  const zone = game.user.isGM ? null : new Set(scene.getFlag(SYSTEM_ID, DEPLOY_FLAG) ?? []);
  return Object.keys(tiles).filter(k => (!zone || zone.has(k)) && catapultTileOk(tiles[k]).ok);
}

export function stopCatapultPlacement() {
  if (!placing) return;
  const { view, down, key, block, g } = placing;
  document.removeEventListener("pointerdown", down, true);
  document.removeEventListener("keydown", key, true);
  view.removeEventListener("contextmenu", block, true);
  if (g && !g.destroyed) g.destroy({ children: true });
  placing = null;
}
export const placingCatapult = () => !!placing;

function dashed(g, x, y, w, h, dash) {
  const seg = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(len / (dash * 2)));
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * dash) / len, b = Math.min(1, ((i * 2 + 1) * dash) / len);
      g.moveTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a).lineTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
    }
  };
  seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
}

/** Show the allowed squares; the next click on one of them places the catapult. */
export function startCatapultPlacement(owner = null) {
  stopCatapultPlacement();
  if (!canvas?.ready) return ui.notifications.warn("Open the battle scene first.");
  const b = getBattle();
  if (!b.active || b.sceneId !== canvas.scene?.id) return ui.notifications.warn("Catapults are placed on the battle scene, during deployment.");
  const keys = catapultSquares();
  if (!keys.length) return ui.notifications.warn(game.user.isGM ? "There's nowhere on this map a catapult can stand." : "No square in your deployment zone can take a catapult (hills, forts and open ground only).");
  const size = canvas.grid.size, view = canvas.app.view, ok = new Set(keys);
  const g = new PIXI.Graphics(); g.eventMode = "none";
  for (const k of keys) {
    const [x, y] = k.split(",").map(Number);
    g.lineStyle(0).beginFill(AMBER, 0.12).drawRect(x * size + 3, y * size + 3, size - 6, size - 6).endFill();
    g.lineStyle(Math.max(2, size * 0.035), AMBER, 0.95); dashed(g, x * size + 4, y * size + 4, size - 8, size - 8, size * 0.09);
  }
  (canvas.interface ?? canvas.stage).addChild(g);
  const toWorld = (cx, cy) => canvas.canvasCoordinatesFromClient?.({ x: cx, y: cy }) ?? canvas.stage.worldTransform.applyInverse({ x: cx - view.getBoundingClientRect().left, y: cy - view.getBoundingClientRect().top });
  const down = async (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) return stopCatapultPlacement();
    if (ev.button !== 0) return;
    const p = toWorld(ev.clientX, ev.clientY), x = Math.floor(p.x / size), y = Math.floor(p.y / size);
    if (!ok.has(x + "," + y)) return ui.notifications.warn("A catapult can't go there: pick one of the dashed squares.");
    stopCatapultPlacement();
    await battleRequest({ type: "placeCatapult", x, y, ...(game.user.isGM && owner ? { owner } : {}) });
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); stopCatapultPlacement(); } };
  const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  placing = { view, down, key, block, g };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
  ui.notifications.info("Click a dashed square to set the catapult up. Right-click or Esc to cancel.");
}
