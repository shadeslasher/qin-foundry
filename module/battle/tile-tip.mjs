// Tile info (V): a small, see-through tooltip by the cursor that names the square under it and lists what it
// does (movement, defense, range, hiding, fire...). Off by default; V turns it on or off for this computer.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battlemap.mjs";
import * as E from "./engine.mjs";

const KEY = "qin.tileTip";
let el = null, enabled = false, last = null, cache = { sceneId: null, flag: null, tiles: null };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

/** Title and effect lines for a square (pure; exported for tests). `rules` is engine.tileRules' result. */
export function tileTipLines(rules) {
  if (!rules) return null;
  const lines = [];
  if (rules.pass === "none") lines.push("Impassable");
  else {
    if (rules.pass === "noCavalry") lines.push("No cavalry");
    if (rules.move > 0) lines.push(`Move +${rules.move} to enter`);
  }
  if (rules.meleeDef) lines.push(`Melee defense ${sign(rules.meleeDef)}`);
  if (rules.rangedDef) lines.push(`Ranged defense ${sign(rules.rangedDef)}`);
  if (rules.campDef) lines.push(`Defense ${sign(rules.campDef)} against attacks from outside the camp`);
  if (rules.range) lines.push(`Range ${sign(rules.range)}`);
  if (rules.atk) lines.push(`Attack ${sign(rules.atk)}`);
  if (rules.command) lines.push(`Command ${sign(rules.command)}`);
  if (rules.downhill) lines.push(`Command +${rules.downhill} against lower units`);
  if (rules.high && !rules.downhill) lines.push("High ground");
  if (rules.hides) lines.push("Hides units");
  if (rules.moraleTurn) lines.push(`Morale ${sign(rules.moraleTurn)} per turn here`);
  if (rules.healthTurn) lines.push(`Health ${sign(rules.healthTurn)} per turn here`);
  if (rules.flammable) lines.push("Flammable");
  return { title: rules.names.join(" · ") || "Open ground", lines };
}

function tilesFor(scene) {
  const flag = scene?.getFlag?.(SYSTEM_ID, MAP_FLAG);
  if (!flag) return null;
  if (cache.sceneId !== scene.id || cache.flag !== flag) { try { cache = { sceneId: scene.id, flag, tiles: decodeTiles(flag) }; } catch { cache = { sceneId: scene.id, flag, tiles: null }; } }
  return cache.tiles;
}

function hide() { if (el) el.style.display = "none"; last = null; }

function show(ev) {
  if (!enabled || !canvas?.ready) return hide();
  const tiles = tilesFor(canvas.scene); if (!tiles) return hide();
  const view = canvas.app.view;
  const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
    ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - view.getBoundingClientRect().left, y: ev.clientY - view.getBoundingClientRect().top });
  const size = canvas.scene.grid?.size ?? 100, x = Math.floor(p.x / size), y = Math.floor(p.y / size);
  const key = `${x},${y}`;
  if (!tiles[key]) return hide();
  if (key !== last) {
    let tip = null;
    try { tip = tileTipLines(E.tileRules({ map: { tiles }, siege: getBattle().siege ?? {} }, x, y)); } catch { tip = null; }
    if (!tip) return hide();
    if (!el) { el = document.createElement("div"); el.className = "qin-tile-tip"; document.body.appendChild(el); }
    el.innerHTML = `<b>${esc(tip.title)}</b>${tip.lines.length ? `<ul>${tip.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<div class="qin-muted">No effects</div>`}`;
    el.style.display = "";
    last = key;
  }
  const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.min(window.innerWidth - w - 4, ev.clientX + pad)}px`;
  el.style.top = `${Math.min(window.innerHeight - h - 4, ev.clientY + pad)}px`;
}

export function tileTipEnabled() { return enabled; }
export function toggleTileTip() {
  enabled = !enabled;
  try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* fine */ }
  if (!enabled) hide();
  ui.notifications.info(enabled ? "Tile info on: hover a square to see what it does. Press V again to turn it off." : "Tile info off.");
}

export function registerTileTip() {
  try { enabled = localStorage.getItem(KEY) === "1"; } catch { enabled = false; }
  document.addEventListener("pointermove", (ev) => { if (ev.target === canvas?.app?.view) show(ev); else hide(); }, true);
  document.addEventListener("pointerleave", hide, true);
  Hooks.on("canvasReady", hide);
  Hooks.on("canvasPan", hide);
}
