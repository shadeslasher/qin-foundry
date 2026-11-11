// Tile info (V): a small, see-through tooltip by the cursor that names the square under it and lists what it
// does (movement, defense, range, hiding, fire...). Off by default; V turns it on or off for this computer.
import { uiScale, infoScale } from "../ui-scale.mjs";
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
    if ((rules.names || []).some(n => n === "Road" || n === "Bridge")) lines.push("Road: a move that passes through or ends on a road gets 1 extra square (once)");
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
  if (rules.noSurround) lines.push("Can't be surrounded here");
  if (rules.moraleTurn) lines.push(`Morale ${sign(rules.moraleTurn)} per turn here`);
  if (rules.healthTurn) lines.push(`Health ${sign(rules.healthTurn)} per turn here`);
  if (rules.flammable) lines.push("Flammable");
  return { title: rules.names.join(" · ") || "Open ground", lines };
}

/** A city gate on this square: owner, state and health (from the running battle, or a fresh gate before one starts). */
export function gateInfo(siege, x, y, tile) {
  if (!(tile?.overlays ?? []).includes("city-gate")) return null;
  const g = (siege?.gates ?? []).find(q => q.squares.some(([gx, gy]) => gx === x && gy === y));
  const maxHp = g?.maxHp ?? 80 * (g?.squares?.length ?? 1), hp = g ? (g.hp ?? maxHp) : maxHp;
  return { owner: g?.owner ?? "friendly", state: g?.state ?? "locked", hp, maxHp };
}
const OWNER_NAME = { friendly: "Player side", enemy: "Enemy side" };
const STATE_NAME = { locked: "locked", open: "open", broken: "broken open", burned: "burned" };
function gateHtml(g) {
  const p = Math.max(0, Math.min(1, g.maxHp ? g.hp / g.maxHp : 0));
  const col = p > 0.5 ? "#3f9b4a" : p > 0.25 ? "#d4a017" : "#c0392b";
  return `<div class="qin-tip-gate">${esc(OWNER_NAME[g.owner] ?? g.owner)} gate, ${esc(STATE_NAME[g.state] ?? g.state)}</div>`
    + `<div class="qin-tip-hp"><span style="width:${(p * 100).toFixed(0)}%;background:${col}"></span></div><div class="qin-tip-hpn">${g.hp} / ${g.maxHp} health</div>`;
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
    const siege = getBattle().siege ?? {};
    try { tip = tileTipLines(E.tileRules({ map: { tiles }, siege }, x, y)); } catch { tip = null; }
    const gate = tip ? gateInfo(siege, x, y, tiles[key]) : null;
    if (!tip) return hide();
    // fire: rounds left while it burns, or how much it takes to catch (David, 2026-11-04)
    const burning = siege.fires?.[key];
    if (burning) tip.lines.unshift(`Burning: ${burning.left} round${burning.left === 1 ? "" : "s"} left`, "Walking through costs 5 morale");
    else if (tip.lines.includes("Flammable")) {
      const r = E.tileRules({ map: { tiles }, siege }, x, y), left = Math.max(0, (r?.fireRes ?? 0) - (siege.scorch?.[key] ?? 0));
      tip.lines[tip.lines.indexOf("Flammable")] = left ? `Flammable: catches after ${left} more spread${left === 1 ? "" : "s"}` : "Flammable: catches at the first spark";
    }
    if (!el) { el = document.createElement("div"); el.className = "qin-tile-tip"; document.body.appendChild(el); }
    el.innerHTML = `<b>${esc(tip.title)}</b>${gate ? gateHtml(gate) : ""}${tip.lines.length ? `<ul>${tip.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<div class="qin-muted">No effects</div>`}`;
    el.style.display = "";
    last = key;
  }
  const pad = 14, k = infoScale(), w = el.offsetWidth * k, h = el.offsetHeight * k; // drawn at the screen scale
  el.style.left = `${Math.min(window.innerWidth - w - 4, ev.clientX + pad)}px`;
  el.style.top = `${Math.min(window.innerHeight - h - 4, ev.clientY + pad)}px`;
}

export function tileTipEnabled() { return enabled; }
export function toggleTileTip() {
  enabled = !enabled;
  try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* fine */ }
  if (!enabled) hide();
}

export function registerTileTip() {
  try { enabled = localStorage.getItem(KEY) === "1"; } catch { enabled = false; }
  document.addEventListener("pointermove", (ev) => { if (ev.target === canvas?.app?.view) show(ev); else hide(); }, true);
  document.addEventListener("pointerleave", hide, true);
  Hooks.on("canvasReady", hide);
  Hooks.on("canvasPan", hide);
}
