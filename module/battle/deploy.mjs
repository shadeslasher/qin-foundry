// Deployment zones on the map: the GM paints them with a brush from the battle panel (saved on the scene),
// and they show as blue-white squares, one per tile, while a battle is being set up and during the tactics
// phase, when players drag their units onto them. The rules for who may move where are in deploy-rules.mjs.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { DEPLOY_FLAG, zoneKey, zoneSet } from "./deploy-rules.mjs";

const FILL = 0xe6f1ff, EDGE = 0xf2f8ff, SHADOW = 0x10263f;

let layer = null;         // PIXI container under the tokens
let dropMark = null;      // highlight on the square a dragged unit would land on
let edit = null;          // { sceneId, pending: Set, mode: "paint" | "erase" | null }
let brush = null;         // active pointer listeners
let onChange = () => {};  // the battle panel re-renders when the brush state changes

export function setDeployChangeHandler(fn) { onChange = fn; }

const gridSize = () => canvas.scene?.grid?.size ?? 100;
export function savedZones(scene = canvas.scene) { return zoneSet(scene?.getFlag?.(SYSTEM_ID, DEPLOY_FLAG)); }

/** What the battle panel shows on its Deployment zones card. */
export function deployCardState() {
  const scene = canvas.scene;
  const saved = savedZones(scene);
  const editing = edit && edit.sceneId === scene?.id ? edit : null;
  const now = editing ? editing.pending : saved;
  const changed = !!editing && (now.size !== saved.size || [...now].some(k => !saved.has(k)));
  return { count: now.size, saved: saved.size, changed, mode: editing?.mode ?? null };
}

/** Which squares to draw now, if any. */
function zonesToShow() {
  const scene = canvas.scene;
  if (!scene) return null;
  if (edit && edit.sceneId === scene.id) return edit.pending; // the GM is painting: show the unsaved zones
  const battle = getBattle();
  if (battle.active && battle.sceneId === scene.id) return ["setup", "tactics"].includes(battle.turn?.phase) ? savedZones(scene) : null;
  return game.user.isGM ? savedZones(scene) : null; // before a battle only the GM sees them
}

/** Redraw the zones (call when the scene, the battle phase or the zones change). */
export function drawDeployZones() {
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = null;
  if (!canvas?.ready) return;
  const zones = zonesToShow();
  if (!zones?.size) return;
  const size = gridSize(), g = new PIXI.Graphics();
  g.eventMode = "none";
  const tiles = [...zones].map(k => k.split(",").map(Number));
  // every square filled edge to edge, each with its own blue-white outline (a faint dark line under it keeps it visible on light ground)
  g.beginFill(FILL, 0.32);
  for (const [x, y] of tiles) g.drawRect(x * size, y * size, size, size);
  g.endFill();
  const w = Math.max(1.5, size * 0.025), inset = w;
  g.lineStyle(w * 2, SHADOW, 0.35);
  for (const [x, y] of tiles) g.drawRect(x * size + inset, y * size + inset, size - 2 * inset, size - 2 * inset);
  g.lineStyle(w, EDGE, 0.95);
  for (const [x, y] of tiles) g.drawRect(x * size + inset, y * size + inset, size - 2 * inset, size - 2 * inset);
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.addChild(g);
  const parent = canvas.tokens ?? canvas.interface ?? canvas.stage; // on the ground, under the unit stands
  parent.addChildAt?.(layer, 0) ?? parent.addChild(layer);
}

/* ------------------------------------------------------------ the GM's brush */

function ensureEdit() {
  const scene = canvas.scene;
  if (!edit || edit.sceneId !== scene.id) edit = { sceneId: scene.id, pending: new Set(savedZones(scene)), mode: null };
  return edit;
}

function stopBrush() {
  if (brush) {
    document.removeEventListener("pointerdown", brush.down, true);
    document.removeEventListener("pointermove", brush.move, true);
    document.removeEventListener("pointerup", brush.up, true);
    document.removeEventListener("keydown", brush.key, true);
    canvas.app?.view?.removeEventListener("contextmenu", brush.block, true);
    if (canvas.app?.view) canvas.app.view.style.cursor = "";
  }
  brush = null;
  if (edit) edit.mode = null;
}

/** Paint or erase deployment squares by clicking or dragging over the map. Right-click or Esc stops. */
export function startZoneBrush(mode) {
  if (!game.user.isGM || !canvas?.ready) return;
  const e = ensureEdit();
  if (e.mode === mode) { stopBrush(); onChange(); return; } // pressing the same brush again turns it off
  stopBrush();
  e.mode = mode;
  const view = canvas.app.view, size = gridSize();
  const dims = canvas.dimensions;
  const toTile = (ev) => {
    const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
      ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - view.getBoundingClientRect().left, y: ev.clientY - view.getBoundingClientRect().top });
    return [Math.floor(p.x / size), Math.floor(p.y / size)];
  };
  const inScene = (x, y) => !dims?.sceneRect || (x * size >= dims.sceneRect.x - size && y * size >= dims.sceneRect.y - size
    && x * size < dims.sceneRect.x + dims.sceneRect.width && y * size < dims.sceneRect.y + dims.sceneRect.height);
  let painting = false, last = null;
  const apply = (ev) => {
    const [x, y] = toTile(ev), k = zoneKey(x, y);
    if (k === last || x < 0 || y < 0 || !inScene(x, y)) return;
    last = k;
    if (e.mode === "paint") e.pending.add(k); else e.pending.delete(k);
    drawDeployZones();
  };
  const down = (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) { stopBrush(); onChange(); return; }
    if (ev.button !== 0) return;
    painting = true; last = null; apply(ev);
  };
  const move = (ev) => { if (painting && ev.target === view) apply(ev); };
  const up = () => { if (painting) { painting = false; onChange(); } };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); stopBrush(); onChange(); } };
  const block = (ev) => ev.preventDefault();
  brush = { down, move, up, key, block };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
  view.style.cursor = "crosshair";
  drawDeployZones();
  onChange();
  ui.notifications.info(mode === "paint" ? "Paint deployment squares: click or drag over the map. Right-click or Esc to stop." : "Erase deployment squares: click or drag over them. Right-click or Esc to stop.");
}

/** Clear every square (still needs Confirm to save). */
export function clearZones() {
  if (!game.user.isGM || !canvas?.scene) return;
  ensureEdit().pending.clear();
  drawDeployZones();
  onChange();
}

/** Save the painted squares on the scene. */
export async function confirmZones() {
  if (!game.user.isGM || !canvas?.scene || !edit || edit.sceneId !== canvas.scene.id) return;
  const list = [...edit.pending].sort();
  stopBrush();
  edit = null;
  await canvas.scene.setFlag(SYSTEM_ID, DEPLOY_FLAG, list);
  drawDeployZones();
  onChange();
  ui.notifications.info(list.length ? `Saved ${list.length} deployment square${list.length === 1 ? "" : "s"} on ${canvas.scene.name}.` : `Removed the deployment zones from ${canvas.scene.name}.`);
}

/** Throw away unsaved painting. */
export function discardZones() {
  stopBrush();
  edit = null;
  drawDeployZones();
  onChange();
}

/* ------------------------------------------------------------ while a player drags a unit */

function clearDropMark() {
  if (dropMark && !dropMark.destroyed) dropMark.destroy();
  dropMark = null;
}

/** A dragged unit's preview: mark the free deployment square it would land on. */
function markDrop(token) {
  clearDropMark();
  if (!token?.isPreview || token.actor?.type !== "unit") return;
  const battle = getBattle();
  if (!(battle.active && battle.sceneId === canvas.scene?.id && battle.turn?.phase === "tactics")) return;
  const zones = savedZones();
  const size = gridSize();
  const x = Math.floor((token.x + token.w / 2) / size), y = Math.floor((token.y + token.h / 2) / size);
  if (!zones.has(zoneKey(x, y))) return;
  const original = token._original ?? null;
  const taken = (canvas.tokens?.placeables ?? []).some(t => !t.isPreview && t !== original && t.id !== token.id && t.actor?.type === "unit"
    && Math.round(t.document.x / size) === x && Math.round(t.document.y / size) === y);
  if (taken) return;
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  const m = size * 0.05;
  g.lineStyle(size * 0.1, SHADOW, 0.55).drawRect(x * size + m, y * size + m, size - 2 * m, size - 2 * m);
  g.lineStyle(size * 0.06, 0xffffff, 1).beginFill(0xffffff, 0.18).drawRect(x * size + m, y * size + m, size - 2 * m, size - 2 * m).endFill();
  (canvas.interface ?? canvas.stage).addChild(g);
  dropMark = g;
}

export function registerDeployZones() {
  Hooks.on("canvasReady", () => { clearDropMark(); stopBrush(); drawDeployZones(); });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}`)) drawDeployZones();
  });
  Hooks.on("refreshToken", (token) => { if (token.isPreview) markDrop(token); });
  Hooks.on("destroyToken", (token) => { if (token.isPreview) clearDropMark(); });
  document.addEventListener("pointerup", () => setTimeout(clearDropMark, 0));
}
