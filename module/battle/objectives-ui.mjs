// Victory and defeat conditions in Foundry: the GM's setup (battle panel card, picking units and tiles, the
// extraction brush), the markers on the map (labels on hover), the tracker at the top right of the screen,
// and the Victory / Defeat banner everyone sees when the battle is decided. Rules: objectives.mjs + engine.mjs.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battlemap.mjs";
import { MAP_TERRAIN, MAP_OVERLAYS } from "./engine-data.mjs";
import { OBJECTIVES_FLAG, VICTORY_TYPES, DEFEAT_TYPES, emptyObjectives, evaluateObjectives, freshObjState, describe, hasObjectives } from "./objectives.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const hex = (n) => "#" + Number(n).toString(16).padStart(6, "0");
const gridSize = () => canvas.scene?.grid?.size ?? 100;
const EXTRACT = { fill: 0xff4fa8, line: 0xffd6ec, shadow: 0x5a1238 };
/** End-of-battle band: "open" (opens from a line across the middle) or "sides" (comes in from both sides). */
const BAND_STYLE = "open";

let onChange = () => {};
export function setObjectivesChangeHandler(fn) { onChange = fn; }

/* ------------------------------------------------------------ data */

export function objectivesOf(scene = canvas.scene) {
  const o = foundry.utils.deepClone(scene?.getFlag?.(SYSTEM_ID, OBJECTIVES_FLAG) ?? emptyObjectives());
  o.victory ??= []; o.defeat ??= []; o.extraction ??= [];
  return o;
}
async function saveObjectives(o, scene = canvas.scene) {
  if (!game.user.isGM || !scene) return;
  await scene.update({ [`flags.${SYSTEM_ID}.${OBJECTIVES_FLAG}`]: o });
  drawObjectiveMarkers(); renderTracker(); onChange();
}
const newId = () => foundry.utils.randomID?.(8) ?? Math.random().toString(36).slice(2, 10);

/** Names for the tracker and the card: units by token id, tiles by what's on them. */
function namesFor(scene) {
  const names = {};
  for (const t of scene?.tokens ?? []) names[t.id] = t.name;
  let tiles = null;
  const flag = scene?.getFlag?.(SYSTEM_ID, MAP_FLAG);
  try { tiles = flag ? decodeTiles(flag) : null; } catch { tiles = null; }
  const tileName = (x, y) => {
    const t = tiles?.[`${x},${y}`]; if (!t) return "";
    const ov = (t.overlays ?? []).filter(o => o !== "road").map(o => MAP_OVERLAYS[o]?.name).filter(Boolean);
    return ov.length ? ov[ov.length - 1] : (MAP_TERRAIN[t.terrain]?.name ?? "");
  };
  return { names, tileName };
}

/* ------------------------------------------------------------ the battle panel card (GM, before the battle) */

export function objectivesCardState(scene = canvas.scene) {
  const o = objectivesOf(scene), n = namesFor(scene);
  const row = (side, c) => {
    const T = (side === "victory" ? VICTORY_TYPES : DEFEAT_TYPES)[c.type] ?? {};
    const picking = pick && pick.condId === c.id;
    return {
      id: c.id, side, type: c.type, label: T.label ?? c.type, color: hex(T.color ?? 0x888888),
      units: T.needs === "units" ? ((c.unitIds ?? []).map(id => n.names[id] ?? "?").join(", ") || "none picked") : null,
      tile: T.needs === "tile" ? (c.x === undefined || c.x === null ? "none picked" : `${n.tileName(c.x, c.y) || "Tile"} · ${c.x}, ${c.y}`) : null,
      needsUnits: T.needs === "units", needsTile: T.needs === "tile", rounds: T.rounds ? (c.rounds ?? 1) : null,
      escape: c.type === "escape", paired: !!c.pair, pickingUnits: picking && pick.kind === "units", pickingTile: picking && pick.kind === "tile",
    };
  };
  return {
    victory: o.victory.map(c => row("victory", c)),
    defeat: o.defeat.map(c => row("defeat", c)),
    victoryTypes: Object.entries(VICTORY_TYPES).map(([k, v]) => ({ k, label: v.label })),
    defeatTypes: Object.entries(DEFEAT_TYPES).map(([k, v]) => ({ k, label: v.label })),
    extraction: o.extraction.length, brush: extractBrush?.mode ?? null,
  };
}

export async function addCondition(side, type) {
  const o = objectivesOf();
  const T = (side === "victory" ? VICTORY_TYPES : DEFEAT_TYPES)[type]; if (!T) return;
  const c = { id: newId(), type };
  if (T.needs === "units") c.unitIds = [];
  if (T.needs === "tile") { c.x = null; c.y = null; }
  if (T.rounds) c.rounds = 3;
  o[side].push(c);
  // Hold comes with its pair: the enemy seizing the same tile is a defeat
  if (type === "hold") o.defeat.push({ id: newId(), type: "tileSeized", x: null, y: null, pair: c.id });
  await saveObjectives(o);
  if (T.needs === "units") startPick(c.id, "units");
  else if (T.needs === "tile") startPick(c.id, "tile");
}

export async function removeCondition(id) {
  const o = objectivesOf();
  o.victory = o.victory.filter(c => c.id !== id);
  o.defeat = o.defeat.filter(c => c.id !== id && c.pair !== id);
  if (pick?.condId === id) stopPick();
  await saveObjectives(o);
}

export async function setRounds(id, rounds) {
  const o = objectivesOf();
  const c = [...o.victory, ...o.defeat].find(c => c.id === id); if (!c) return;
  c.rounds = Math.max(1, Math.round(Number(rounds) || 1));
  await saveObjectives(o);
}

/* ------------------------------------------------------------ picking units and tiles on the map */

let pick = null; // { condId, kind: "units" | "tile", listeners }

function canvasPoint(ev) {
  const view = canvas.app.view;
  return canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
    ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - view.getBoundingClientRect().left, y: ev.clientY - view.getBoundingClientRect().top });
}
function unitTokenAt(p) {
  return (canvas.tokens?.placeables ?? []).find(t => t.actor?.type === "unit" && p.x >= t.document.x && p.y >= t.document.y
    && p.x < t.document.x + t.w && p.y < t.document.y + t.h) ?? null;
}

export function stopPick() {
  if (pick?.listeners) {
    document.removeEventListener("pointerdown", pick.listeners.down, true);
    document.removeEventListener("keydown", pick.listeners.key, true);
    canvas.app?.view?.removeEventListener("contextmenu", pick.listeners.block, true);
    if (canvas.app?.view) canvas.app.view.style.cursor = "";
  }
  pick = null;
  onChange();
}

/** Units: click units to add or remove them (Esc, right-click or Done to finish). Tile: click one square. */
export function startPick(condId, kind) {
  if (!game.user.isGM || !canvas?.ready) return;
  if (pick?.condId === condId && pick.kind === kind) return stopPick(); // pressing it again finishes
  stopBrush(); stopPick();
  const view = canvas.app.view;
  const down = async (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) return stopPick();
    if (ev.button !== 0) return;
    const p = canvasPoint(ev), o = objectivesOf();
    const c = [...o.victory, ...o.defeat].find(c => c.id === condId);
    if (!c) return stopPick();
    if (kind === "units") {
      const tok = unitTokenAt(p);
      if (!tok) return ui.notifications.info("Click a unit token (Esc or right-click when you're done).");
      const ids = new Set(c.unitIds ?? []);
      if (ids.has(tok.id)) ids.delete(tok.id); else ids.add(tok.id);
      c.unitIds = [...ids];
      await saveObjectives(o);
    } else {
      const size = gridSize();
      c.x = Math.floor(p.x / size); c.y = Math.floor(p.y / size);
      for (const d of o.defeat) if (d.pair === c.id) { d.x = c.x; d.y = c.y; } // a Hold's paired defeat follows it
      await saveObjectives(o);
      stopPick();
    }
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); stopPick(); } };
  const block = (ev) => ev.preventDefault();
  pick = { condId, kind, listeners: { down, key, block } };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
  view.style.cursor = "crosshair";
  ui.notifications.info(kind === "units" ? "Click units to add or remove them. Esc or right-click when you're done." : "Click the tile.");
  onChange();
}

/* ------------------------------------------------------------ extraction squares (Escape): a brush that saves as you paint */

let extractBrush = null;

function stopBrush() {
  if (extractBrush?.listeners) {
    const l = extractBrush.listeners;
    document.removeEventListener("pointerdown", l.down, true);
    document.removeEventListener("pointermove", l.move, true);
    document.removeEventListener("pointerup", l.up, true);
    document.removeEventListener("keydown", l.key, true);
    canvas.app?.view?.removeEventListener("contextmenu", l.block, true);
    if (canvas.app?.view) canvas.app.view.style.cursor = "";
  }
  extractBrush = null;
}

export function startExtractionBrush(mode) {
  if (!game.user.isGM || !canvas?.ready) return;
  if (extractBrush?.mode === mode) { stopBrush(); onChange(); return; }
  stopPick(); stopBrush();
  const view = canvas.app.view, size = gridSize();
  const tiles = new Set(objectivesOf().extraction);
  let painting = false;
  const apply = (ev) => {
    const p = canvasPoint(ev), k = `${Math.floor(p.x / size)},${Math.floor(p.y / size)}`;
    if (p.x < 0 || p.y < 0) return;
    if (mode === "paint") tiles.add(k); else tiles.delete(k);
    drawObjectiveMarkers({ extraction: tiles });
  };
  const down = (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) { stopBrush(); onChange(); return; }
    if (ev.button !== 0) return;
    painting = true; apply(ev);
  };
  const move = (ev) => { if (painting && ev.target === view) apply(ev); };
  const up = async () => {
    if (!painting) return;
    painting = false;
    const o = objectivesOf(); o.extraction = [...tiles].sort();
    await saveObjectives(o);
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); stopBrush(); onChange(); } };
  const block = (ev) => ev.preventDefault();
  extractBrush = { mode, listeners: { down, move, up, key, block } };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
  view.style.cursor = "crosshair";
  ui.notifications.info(mode === "paint" ? "Paint extraction squares (pink): click or drag. Right-click or Esc to stop." : "Erase extraction squares: click or drag. Right-click or Esc to stop.");
  onChange();
}

/* ------------------------------------------------------------ markers on the map */

let markerLayer = null, groundLayer = null, hoverLabel = null, hoverSpots = [];

/** Can this user see the conditions on this scene now? (GM always; players while a battle runs there.) */
function visibleHere() {
  const scene = canvas.scene; if (!scene) return false;
  const b = getBattle();
  const inBattle = b.active && b.sceneId === scene.id && b.turn?.phase !== "setup";
  return game.user.isGM || inBattle;
}

/** Where each condition stands now (the engine's record while a battle runs, else everything open). */
function currentEval(scene, o) {
  const b = getBattle();
  if (b.active && b.sceneId === scene.id && b.objEval) return b.objEval;
  const units = (scene.tokens ?? []).filter(t => t.actor?.type === "unit").map(t => ({ id: t.id, side: t.actor.system.side, status: t.actor.system.status }));
  return evaluateObjectives(o, units, b.active && b.sceneId === scene.id ? (b.objState ?? freshObjState()) : freshObjState(),
    { burnt: b.siege?.burnt ?? {}, fires: b.siege?.fires ?? {} });
}

/** An outline with an arrow pointing inward from the middle of each edge. */
function drawMark(g, x, y, color, size) {
  const X = x * size, Y = y * size, i = size * 0.04, W = size - 2 * i, s = size * 0.11, m = size * 0.08;
  g.lineStyle(size * 0.1, 0x000000, 0.35).drawRect(X + i, Y + i, W, W);
  g.lineStyle(size * 0.05, color, 1).drawRect(X + i, Y + i, W, W);
  const cx = X + size / 2, cy = Y + size / 2;
  const tri = (pts) => g.lineStyle(Math.max(1, size * 0.02), 0x000000, 0.55).beginFill(color, 1).drawPolygon(pts).endFill();
  tri([cx - s, Y + i + m, cx + s, Y + i + m, cx, Y + i + m + s * 1.1]);
  tri([cx - s, Y + size - i - m, cx + s, Y + size - i - m, cx, Y + size - i - m - s * 1.1]);
  tri([X + i + m, cy - s, X + i + m, cy + s, X + i + m + s * 1.1, cy]);
  tri([X + size - i - m, cy - s, X + size - i - m, cy + s, X + size - i - m - s * 1.1, cy]);
}

export function drawObjectiveMarkers({ extraction = null } = {}) {
  for (const l of [markerLayer, groundLayer]) if (l && !l.destroyed) l.destroy({ children: true });
  markerLayer = groundLayer = null; hoverSpots = [];
  clearHoverLabel();
  if (!canvas?.ready || !visibleHere()) return;
  const scene = canvas.scene, o = objectivesOf(scene), size = gridSize();
  const ev = currentEval(scene, o), n = namesFor(scene);
  const open = new Map([...ev.victory.map(r => [r.id, !r.done && !r.failed]), ...ev.defeat.map(r => [r.id, !r.triggered])]);
  // extraction squares: pink, on the ground under the units
  const ext = extraction ?? new Set(o.extraction);
  if (ext.size) {
    const g = new PIXI.Graphics(); g.eventMode = "none";
    g.beginFill(EXTRACT.fill, 0.45); for (const k of ext) { const [x, y] = k.split(",").map(Number); g.drawRect(x * size, y * size, size, size); } g.endFill();
    const w = Math.max(1.5, size * 0.03);
    g.lineStyle(w * 2, EXTRACT.shadow, 0.35); for (const k of ext) { const [x, y] = k.split(",").map(Number); g.drawRect(x * size + w, y * size + w, size - 2 * w, size - 2 * w); }
    g.lineStyle(w, EXTRACT.line, 1); for (const k of ext) { const [x, y] = k.split(",").map(Number); g.drawRect(x * size + w, y * size + w, size - 2 * w, size - 2 * w); }
    groundLayer = new PIXI.Container(); groundLayer.eventMode = "none"; groundLayer.addChild(g);
    const parent = canvas.tokens ?? canvas.interface ?? canvas.stage;
    parent.addChildAt?.(groundLayer, 0) ?? parent.addChild(groundLayer);
    for (const k of ext) { const [x, y] = k.split(",").map(Number); hoverSpots.push({ x, y, text: "Extraction (Escape)" }); }
  }
  // outlines with inward arrows: tiles and units still to deal with
  const g = new PIXI.Graphics(); g.eventMode = "none";
  const unitPos = (id) => { const t = scene.tokens.get(id); return t && !t.hidden ? { x: Math.round(t.x / size), y: Math.round(t.y / size) } : null; };
  const mark = (x, y, color, text) => { drawMark(g, x, y, color, size); hoverSpots.push({ x, y, text }); };
  for (const [side, list, types] of [["Victory", o.victory, VICTORY_TYPES], ["Defeat", o.defeat, DEFEAT_TYPES]]) {
    for (const c of list) {
      if (!open.get(c.id)) continue;
      const T = types[c.type]; if (!T) continue;
      const text = `${side}: ${describe(c, n, { coords: false })}`;
      if (c.type === "escape") continue; // escapers are shown by the pink squares they head for
      if (c.pair) continue;                // a Hold's paired defeat shares the Hold's grey marker
      if (T.needs === "tile" && c.x !== null && c.x !== undefined) mark(c.x, c.y, T.color, c.type === "hold" ? `${text} for ${c.rounds} rounds (no enemy may end its turn there)` : text);
      if (T.needs === "units") for (const id of c.unitIds ?? []) { const p = unitPos(id); if (p) mark(p.x, p.y, T.color, text); }
    }
  }
  markerLayer = new PIXI.Container(); markerLayer.eventMode = "none"; markerLayer.addChild(g);
  (canvas.interface ?? canvas.stage).addChild(markerLayer);
}

function clearHoverLabel() { if (hoverLabel && !hoverLabel.destroyed) hoverLabel.destroy(); hoverLabel = null; }
function onHover(ev) {
  if (!canvas?.ready || !hoverSpots.length || ev.target !== canvas.app.view) { if (hoverLabel) clearHoverLabel(); return; }
  const size = gridSize(), p = canvasPoint(ev), x = Math.floor(p.x / size), y = Math.floor(p.y / size);
  const here = hoverSpots.filter(s => s.x === x && s.y === y).map(s => s.text);
  const text = [...new Set(here)].join("\n");
  if (hoverLabel?.qinText === text && hoverLabel?.qinAt === `${x},${y}`) return;
  clearHoverLabel();
  if (!text) return;
  const Txt = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  const t = new Txt(text, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.2), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: 4, align: "center" }));
  t.anchor?.set?.(0.5, 1); t.position.set(x * size + size / 2, y * size - 4);
  t.qinText = text; t.qinAt = `${x},${y}`; t.eventMode = "none";
  (canvas.interface ?? canvas.stage).addChild(t);
  hoverLabel = t;
}

/* ------------------------------------------------------------ the tracker (top right, left of the sidebar) */

let trackerEl = null;

function placeTracker() {
  if (!trackerEl) return;
  const sb = document.getElementById("sidebar") ?? ui.sidebar?.element;
  const left = sb?.getBoundingClientRect?.().left;
  trackerEl.style.right = `${Math.max(8, (left ? window.innerWidth - left : 0) + 8)}px`;
}

export function renderTracker() {
  const b = getBattle(), scene = canvas?.scene;
  const show = !!scene && b.active && b.sceneId === scene.id && b.turn?.phase !== "setup";
  if (!show) { trackerEl?.remove(); trackerEl = null; return; }
  const o = objectivesOf(scene), ev = currentEval(scene, o), n = namesFor(scene);
  const byId = new Map([...o.victory, ...o.defeat].map(c => [c.id, c]));
  const status = (r) => {
    if (r.done) return `<i class="fa-solid fa-check"></i>`;
    if (r.failed) return `<i class="fa-solid fa-xmark"></i>`;
    if (r.type === "hold") return `<span class="qin-obj-pips">${Array.from({ length: r.of }, (_, i) => `<b class="${i < r.n ? "f" : ""}"></b>`).join("")}</span> ${r.n} / ${r.of}`;
    if (r.type === "survive" || r.type === "turnLimit") return `Round ${Math.min((r.n ?? 0) + 1, r.of)} / ${r.of}`;
    if (r.of) return `${r.n} / ${r.of}`;
    return r.note ? esc(r.note) : "—";
  };
  const timer = (r, color) => (r.type === "survive" || r.type === "turnLimit") && r.of ? `<span class="qin-obj-timer"><i style="width:${Math.min(100, 100 * (r.n ?? 0) / r.of)}%;background:${color}"></i></span>` : "";
  const line = (r, types, cls = "") => {
    const c = byId.get(r.id) ?? { type: r.type };
    const T = types[r.type], color = hex(T?.color ?? 0x8a8578);
    const state = r.done ? "done" : r.failed ? "failed" : r.triggered ? "triggered" : "";
    const go = targetOf(c, scene) ? ` data-locate="${esc(r.id)}" title="Show on the map"` : "";
    return `<li class="${state} ${cls}"${go}><span class="qin-obj-sw" style="border-color:${color}${r.done ? `;background:${color}` : ""}"></span><span>${esc(describe(c, n))}</span><span class="qin-obj-st">${r.always ? "always" : status(r)}</span>${timer(r, color)}</li>`;
  };
  const v = ev.victory.map(r => line(r, VICTORY_TYPES)).join("");
  const d = ev.defeat.filter(r => !(r.pair && ev.victory.some(x => x.id === r.pair))).map(r => line(r, DEFEAT_TYPES, r.always ? "always" : "")).join("");
  const html = `${ev.victory.length ? `<section class="v"><h4>Victory <small>${ev.victory.length > 1 ? "complete all" : ""}</small></h4><ul>${v}</ul></section>` : ""}
    <section class="d"><h4>Defeat <small>any one</small></h4><ul>${d}</ul></section>`;
  if (!trackerEl) {
    trackerEl = document.createElement("div");
    trackerEl.id = "qin-objectives";
    trackerEl.className = "qin-obj-tracker";
    trackerEl.addEventListener("click", (ev) => { const li = ev.target.closest("[data-locate]"); if (li) locate(li.dataset.locate); });
    document.body.appendChild(trackerEl);
  }
  trackerEl.innerHTML = html;
  placeTracker();
}

/* ------------------------------------------------------------ Victory / Defeat banner */

let lastOutcome = null, lastIntro = null;

export function playOutcome(result) {
  document.getElementById("qin-outcome")?.remove();
  const el = document.createElement("div");
  el.id = "qin-outcome";
  const kind = { victory: ["win", "Victory"], defeat: ["lose", "Defeat"], stalemate: ["draw", "Stalemate"] }[result] ?? ["lose", "Defeat"];
  el.className = `qin-outcome ${kind[0]} ${BAND_STYLE}`;
  el.innerHTML = `<div class="dim"></div><div class="band"><div class="half l"></div><div class="half r"></div></div><div class="word">${kind[1]}</div>`;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 700); }, 3600);
}

/** Battle changed: redraw, and play the banner once when the battle has just been decided. */
export function refreshObjectives() {
  drawObjectiveMarkers(); renderTracker();
  const out = getBattle().outcome ?? null, key = out ? `${out.result}@${out.at}` : null;
  if (key && key !== lastOutcome) playOutcome(out.result);
  lastOutcome = key;
  const b = getBattle(), intro = b.introAt ?? null;
  if (intro && intro !== lastIntro && b.active && b.sceneId === canvas?.scene?.id && b.turn?.phase === "tactics") playTour();
  lastIntro = intro;
}

export function registerObjectives() {
  Hooks.once("ready", () => { const b = getBattle(), out = b.outcome; lastOutcome = out ? `${out.result}@${out.at}` : null; lastIntro = b.introAt ?? null; }); // no replay on reload
  Hooks.on("canvasReady", () => { stopPick(); stopBrush(); drawObjectiveMarkers(); renderTracker(); });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}`)) { drawObjectiveMarkers(); renderTracker(); }
  });
  Hooks.on("updateToken", (doc, change) => { if (doc.parent?.id === canvas.scene?.id && ("x" in change || "y" in change || "hidden" in change)) drawObjectiveMarkers(); });
  Hooks.on("collapseSidebar", () => setTimeout(placeTracker, 50));
  window.addEventListener("resize", () => placeTracker());
  document.addEventListener("pointermove", onHover);
}

/* ------------------------------------------------------------ where a condition is, the tour at the start, and jumping there from the tracker */

const VERB = { routUnit: "Rout", routAll: "Rout", seize: "Seize", burn: "Burn", hold: "Hold", survive: "Survive", escape: "Escape",
  unitRouted: "Protect", tileSeized: "Defend", turnLimit: "Time limit" };

/** The squares a condition points at (null for conditions without a place on the map). */
function targetOf(c, scene = canvas.scene) {
  if (!c || !scene) return null;
  const size = gridSize();
  const T = VICTORY_TYPES[c.type] ?? DEFEAT_TYPES[c.type];
  if (!T) return null;
  let squares = [];
  if (c.type === "escape") squares = objectivesOf(scene).extraction.map(k => k.split(",").map(Number));
  else if (T.needs === "tile" && c.x !== null && c.x !== undefined) squares = [[c.x, c.y]];
  else if (T.needs === "units") for (const id of c.unitIds ?? []) {
    const t = scene.tokens.get(id);
    if (t && (!t.hidden || game.user.isGM)) squares.push([Math.round(t.x / size), Math.round(t.y / size)]);
  }
  if (!squares.length) return null;
  const xs = squares.map(q => q[0]), ys = squares.map(q => q[1]);
  return { squares, color: T.color, escape: c.type === "escape",
    cx: (Math.min(...xs) + Math.max(...xs) + 1) / 2 * size, cy: (Math.min(...ys) + Math.max(...ys) + 1) / 2 * size,
    top: Math.min(...ys) * size, bottom: (Math.max(...ys) + 1) * size };
}

/** What the tour card or strip says: the verb, then what it's about. */
function tourWords(c, scene) {
  const n = namesFor(scene);
  const units = (ids) => (ids ?? []).map(id => n.names[id] ?? "a unit").join(", ");
  const tile = () => n.tileName(c.x, c.y) || "Tile";
  const rounds = (k) => `${k} round${k === 1 ? "" : "s"}`, Rounds = (k) => `${k} Round${k === 1 ? "" : "s"}`;
  switch (c.type) {
    case "routUnit": case "unitRouted": return units(c.unitIds);
    case "routAll": return "all enemy units";
    case "seize": case "burn": case "tileSeized": return tile();
    case "hold": return `${tile()} for ${rounds(c.rounds ?? 1)}`;
    case "survive": return Rounds(c.rounds ?? 1);
    case "escape": return units(c.unitIds) || "to the pink squares";
    case "turnLimit": return Rounds(c.rounds ?? 1);
  }
  return "";
}

/** Flash a target's outline on the map for `ms`. Returns a function that removes it early. */
function flashTarget(tg, ms) {
  const size = gridSize(), g = new PIXI.Graphics(); g.eventMode = "none";
  if (tg.escape) { g.lineStyle(size * 0.08, 0xffffff, 1); for (const [x, y] of tg.squares) g.drawRect(x * size + size * 0.04, y * size + size * 0.04, size * 0.92, size * 0.92); }
  else for (const [x, y] of tg.squares) drawMark(g, x, y, tg.color, size);
  (canvas.interface ?? canvas.stage).addChild(g);
  const t0 = performance.now();
  const tick = () => { const k = (performance.now() - t0) / 1000; g.alpha = 0.15 + 0.85 * Math.abs(Math.cos(k * Math.PI * 2.2)); };
  canvas.app.ticker.add(tick);
  let done = false;
  const stop = () => { if (done) return; done = true; canvas.app.ticker.remove(tick); if (!g.destroyed) g.destroy(); };
  setTimeout(stop, ms);
  return stop;
}

/** Screen position of a canvas point. */
function toScreen(x, y) {
  const c = canvas.clientCoordinatesFromCanvas?.({ x, y });
  if (c && Number.isFinite(c.x)) return { x: c.x, y: c.y };
  const r = canvas.app.view.getBoundingClientRect(), p = canvas.stage.worldTransform.apply({ x, y });
  return { x: r.left + p.x, y: r.top + p.y };
}

const sleep = (ms, tour) => new Promise(res => { const t = setTimeout(res, ms); tour?.timers.push([t, res]); });
let tour = null;

function endTour() {
  if (!tour) return;
  const t = tour; tour = null; t.cancelled = true;
  for (const [h, res] of t.timers) { clearTimeout(h); res(); }
  t.stopFlash?.();
  for (const el of t.els) el.remove();
  document.removeEventListener("keydown", t.key, true);
}

/** The start-of-battle tour: the camera visits every condition with a place on the map (the outline flashes and a card
 *  says what to do there), then the conditions without one show as a strip across the middle. Esc or Skip ends it. */
export async function playTour() {
  if (!canvas?.ready || !visibleHere()) return;
  endTour();
  const scene = canvas.scene, o = objectivesOf(scene);
  const stops = [], strips = [];
  for (const [side, list] of [["v", o.victory], ["d", o.defeat.filter(d => !d.pair)]]) for (const c of list) {
    const tg = targetOf(c, scene);
    if (tg) stops.push({ side, c, tg });
    else if (["routAll", "survive", "turnLimit"].includes(c.type)) strips.push({ side, c });
  }
  strips.sort((a, b) => (a.side === b.side ? 0 : a.side === "v" ? -1 : 1));
  if (!stops.length && !strips.length) return;
  const t = tour = { cancelled: false, timers: [], els: [], stopFlash: null };
  const skip = document.createElement("button");
  skip.type = "button"; skip.className = "qin-tour-skip"; skip.innerHTML = `Skip <kbd>Esc</kbd>`;
  skip.addEventListener("click", endTour);
  document.body.appendChild(skip); t.els.push(skip);
  t.key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); endTour(); } };
  document.addEventListener("keydown", t.key, true);
  const home = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x };
  const hex6 = (n) => "#" + n.toString(16).padStart(6, "0");
  for (const s of stops) {
    if (t.cancelled) return;
    await canvas.animatePan({ x: s.tg.cx, y: s.tg.cy, duration: 550 });
    if (t.cancelled) return;
    t.stopFlash = flashTarget(s.tg, 1500);
    const card = document.createElement("div");
    card.className = `qin-tour-card ${s.side === "v" ? "v" : "d"}`;
    card.innerHTML = `<b style="color:${hex6(s.tg.color === 0xb4b8bd ? 0xd9dce0 : s.tg.color)}">${VERB[s.c.type]}</b><span>${esc(tourWords(s.c, scene))}</span>`;
    document.body.appendChild(card); t.els.push(card);
    const r = { width: card.offsetWidth, height: card.offsetHeight }, above = toScreen(s.tg.cx, s.tg.top), below = toScreen(s.tg.cx, s.tg.bottom);
    const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, above.x - r.width / 2));
    const top = above.y - r.height - 10 >= 8 ? above.y - r.height - 10 : Math.min(window.innerHeight - r.height - 8, below.y + 10);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
    await sleep(1500, t);
    card.remove();
  }
  if (t.cancelled) return;
  if (stops.length) await canvas.animatePan({ ...home, duration: 550 });
  for (const s of strips) {
    if (t.cancelled) return;
    const strip = document.createElement("div");
    strip.className = `qin-tour-strip ${s.side === "v" ? "v" : "d"}`;
    strip.innerHTML = `<b>${VERB[s.c.type]}</b><span>${esc(tourWords(s.c, scene))}</span>`;
    document.body.appendChild(strip); t.els.push(strip);
    await sleep(2100, t);
    strip.remove();
    await sleep(100, t);
  }
  endTour();
}

/** Tracker click: move your own camera to the condition and flash it once. */
async function locate(id) {
  const scene = canvas?.scene; if (!scene) return;
  const o = objectivesOf(scene), c = [...o.victory, ...o.defeat].find(x => x.id === id);
  const tg = targetOf(c, scene); if (!tg) return;
  await canvas.animatePan({ x: tg.cx, y: tg.cy, duration: 400 });
  flashTarget(tg, 1300);
}
