// Live battle maps: redraw a scene's map image from its layout code with the map generator's own drawing code,
// and paint terrain and overlays on it from inside Foundry.
//
// The system doesn't ship the generator. A module provides it: in "setup", call
//   game.qin.registerMapRenderer({ workerUrl: "modules/<id>/scripts/mapmaker-worker.js" })
// where the worker answers { id, code, edits?, px, blend, vignette, grid, image? } (edits: { x, y, terrain } |
// { x, y, overlay, on }) with { id, ok, code, data, blob? }.
// Without one, imported maps still work; they just can't be redrawn.
import { SYSTEM_ID } from "../config.mjs";
import { FLAG, encodeBattleMap, decodeTiles } from "./battlemap.mjs";
import { getBattle } from "./adapter.mjs";
import { MAP_TERRAIN, MAP_OVERLAYS } from "./engine-data.mjs";

let renderer = null, worker = null, seq = 0;
const pending = new Map();

/** A module hands over the map generator. */
export function registerMapRenderer(r) {
  if (!r?.workerUrl) return console.warn("Qin | registerMapRenderer needs { workerUrl }");
  renderer = r;
  worker?.terminate(); worker = null;
  console.log("Qin | map generator registered", r.workerUrl);
  game.qin?.refreshBattlePanel?.();
}
export const hasMapRenderer = () => !!renderer;

function work(msg) {
  if (!renderer) return Promise.reject(new Error("No map generator is installed (it comes with the Three Kingdoms module)."));
  if (!worker) {
    const url = foundry.utils.getRoute?.(renderer.workerUrl) ?? renderer.workerUrl;
    worker = new Worker(url);
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data?.id); if (!p) return;
      pending.delete(ev.data.id);
      ev.data.ok ? p.res(ev.data) : p.rej(new Error(ev.data.error || "The map couldn't be drawn."));
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.rej(new Error(ev.message || "The map generator stopped."));
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }); });
}

export const mapFlag = (scene) => scene?.getFlag?.(SYSTEM_ID, FLAG) ?? null;
/** Can this scene's map be redrawn here? */
export const canRedraw = (scene) => !!(renderer && mapFlag(scene)?.layoutCode);

let tilesMemo = null; // { flag, tiles } for the scene being redrawn
function tilesOf(scene) { const f = mapFlag(scene); if (!tilesMemo || tilesMemo.flag !== f) tilesMemo = { flag: f, tiles: decodeTiles(f) }; return tilesMemo.tiles; }

/** Changes the battle has made to the map, drawn on top of the saved layout (burned gates become ruins). */
function battleEdits(scene) {
  const b = getBattle();
  if (!b.active || b.sceneId !== scene.id) return [];
  const edits = [];
  for (const g of b.siege?.gates ?? []) if (g.state === "burned")
    for (const [x, y] of g.squares) edits.push({ x, y, overlay: "city-gate", on: false }, { x, y, overlay: "ruins", on: true });
  // fire: burning squares show flames; burnt ones show what they burned into (scorched ground, ruins, or nothing)
  const flag = mapFlag(scene), tiles = flag ? tilesOf(scene) : null;
  for (const k of Object.keys(b.siege?.burnt ?? {})) {
    const [x, y] = k.split(",").map(Number), tile = tiles?.[k]; if (!tile) continue;
    const t = MAP_TERRAIN[tile.terrain];
    if (t?.flammable) edits.push({ x, y, terrain: t.burnsInto && MAP_TERRAIN[t.burnsInto] ? t.burnsInto : "scorched" });
    for (const o of tile.overlays ?? []) {
      const op = MAP_OVERLAYS[o]; if (!op?.flammable) continue;
      edits.push({ x, y, overlay: o, on: false });
      if (op.burnsInto && MAP_OVERLAYS[op.burnsInto]) edits.push({ x, y, overlay: op.burnsInto, on: true });
      else if (op.burnsInto && MAP_TERRAIN[op.burnsInto]) edits.push({ x, y, terrain: op.burnsInto });
    }
  }
  for (const k of Object.keys(b.siege?.fires ?? {})) { const [x, y] = k.split(",").map(Number); edits.push({ x, y, overlay: "fire", on: true }); }
  return edits;
}

// What the scene's current background shows, so the next redraw only redraws what changed
const DRAWN = "battlemapDrawn";
const currentSrc = (scene) => (scene.levels?.size ? scene.levels.contents[0]?.background?.src : null) ?? scene.background?.src ?? null;
const absUrl = (src) => { try { return new URL(/^[a-z]+:/i.test(src) ? src : (foundry.utils.getRoute?.(src) ?? src), window.location.href).href; } catch { return src; } };

async function setBackground(scene, src) {
  if (scene.levels?.size) {
    try { await scene.levels.contents[0].update({ background: { src } }); return; } catch (e) { console.warn("Qin | level background", e); }
  }
  await scene.update({ "background.src": src });
}

let busy = null, again = null;

/**
 * GM: redraw the scene's map. `edits` (painted squares) are saved into the layout; the battle's own changes
 * (burned gates) are only drawn. Calls made while a redraw runs are merged into one more redraw after it.
 */
export async function redrawScene(scene, { edits = [], look = null, quiet = false } = {}) {
  if (!game.user.isGM) return;
  if (!scene) return;
  const flag = mapFlag(scene);
  if (!flag?.layoutCode) return ui.notifications.warn("This scene has no map generator layout to redraw from. Re-import it from a new export.");
  if (!renderer) return ui.notifications.warn("Redrawing needs the map generator, which comes with the Three Kingdoms module.");
  if (busy) {
    again = { scene, edits: [...(again?.edits ?? []), ...edits], look: look ?? again?.look ?? null, quiet: quiet && (again?.quiet ?? true) };
    return busy;
  }
  busy = (async () => {
    const note = quiet ? null : ui.notifications.info("Redrawing the battle map…", { permanent: true });
    try {
      let code = flag.layoutCode, data = null;
      const px = flag.gridSize, blend = look?.blend ?? flag.blend ?? 50, vignette = look?.vignette ?? flag.vignette ?? true;
      if (edits.length) { // save the painted squares into the layout first
        const r = await work({ code, edits, px, image: false });
        code = r.code; data = r.data;
      }
      // a partial redraw when the background is the last image we drew with the same look
      const drawn = scene.getFlag(SYSTEM_ID, DRAWN), src0 = currentSrc(scene);
      const prev = drawn && drawn.src === src0 && drawn.px === px && drawn.blend === blend && drawn.vignette === vignette
        ? { code: drawn.code, edits: drawn.edits ?? [], key: drawn.key, url: absUrl(src0) } : null;
      const shownEdits = battleEdits(scene), key = foundry.utils.randomID?.() ?? String(Date.now());
      const t0 = performance.now();
      const shown = await work({ code, edits: shownEdits, px, blend, vignette, image: true, type: "image/jpeg", key, prev }); // JPEG saves in a fraction of the time; the worker keeps the lossless image between redraws
      console.log(`Qin | battle map ${shown.unchanged ? "unchanged" : shown.region ? `partly redrawn (${shown.region.w}×${shown.region.h} px)` : "redrawn"} in ${Math.round(performance.now() - t0)} ms`);
      if (shown.unchanged) {
        if (data || look) { await scene.unsetFlag(SYSTEM_ID, FLAG); await scene.setFlag(SYSTEM_ID, FLAG, { ...flag, ...(data ? encodeBattleMap({ ...data, name: flag.name ?? data.name, layoutCode: code, scene: { ...data.scene, gridSize: px } }).data : {}), blend, vignette }); }
        if (!quiet) ui.notifications.info("Nothing on the map changed.");
        return;
      }
      const file = shown.blob;
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      const dir = `worlds/${game.world.id}/battlemaps`;
      try { await FP.createDirectory("data", dir); } catch { /* already there */ }
      const ext = { "image/jpeg": "jpg", "image/webp": "webp" }[file.type] ?? "png";
      const name = `${(scene.name || "battle-map").replace(/[^\w-]+/g, "-")}-${Date.now()}.${ext}`;
      const res = await FP.upload("data", dir, new File([file], name, { type: file.type }), {}, { notify: false });
      const src = res?.path ?? `${dir}/${name}`;
      if (data || look) {
        const next = data
          ? encodeBattleMap({ ...data, name: flag.name ?? data.name, layoutCode: code, scene: { ...data.scene, gridSize: px } }).data
          : { ...flag };
        next.blend = blend; next.vignette = vignette;
        // replace the whole flag (a merge would keep overlays that were painted away)
        await scene.unsetFlag(SYSTEM_ID, FLAG);
        await scene.setFlag(SYSTEM_ID, FLAG, next);
      }
      await setBackground(scene, src);
      await scene.setFlag(SYSTEM_ID, DRAWN, { code, edits: shownEdits, key, src, px, blend, vignette });
      if (!quiet) ui.notifications.info("Battle map redrawn.");
    } catch (e) {
      console.error("Qin | redrawing the battle map", e);
      ui.notifications.error(`The battle map couldn't be redrawn: ${e.message}`);
    } finally {
      note?.remove?.();
    }
  })();
  try { await busy; } finally {
    busy = null;
    if (again) { const a = again; again = null; redrawScene(a.scene, a); }
  }
}

/* ------------------------------------------------------------ redraw when the battle changes the map */

let lastKey = null;
const battleMapKey = () => {
  const b = getBattle();
  if (!b.active) return "";
  return b.sceneId + "|" + [...(b.siege?.gates ?? []).filter(g => g.state === "burned").map(g => g.id),
    ...Object.keys(b.siege?.fires ?? {}).map(k => "f" + k), ...Object.keys(b.siege?.burnt ?? {}).map(k => "b" + k)].sort().join(",");
};
/** Called whenever the battle setting changes: one GM redraws when the drawn changes (burned gates) change. */
export function syncBattleMap() {
  const key = battleMapKey(), prev = lastKey;
  lastKey = key;
  if (prev === null || prev === key) return;
  if (!game.user.isGM || (game.users.activeGM && !game.users.activeGM.isSelf)) return;
  const sceneId = (key || prev).split("|")[0];
  const scene = game.scenes.get(sceneId);
  // only when something burned (or a battle with burned gates ended)
  const burned = (k) => !!k && k.split("|")[1] !== "";
  if (scene && canRedraw(scene) && (burned(key) || burned(prev))) redrawScene(scene, { quiet: true });
}
export function initBattleMapSync() { lastKey = battleMapKey(); }

/* ------------------------------------------------------------ the map painter */

const Base = foundry.applications?.api?.ApplicationV2 ?? class {};
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
// overlays the generator draws per square (forts, town halls and camps are placed in the generator itself)
const PAINT_OVERLAYS = ["road", "hill", "city-wall", "city-gate", "fortress-tower", "watchtower", "small-fort", "command-tent",
  "trench", "abatis", "supply-depot", "farmhouse", "ruins", "fire", "bridge", "dock", "boat", "catapult", "trees"];
const TERRAIN_COLORS = { plains: 0x8fae5a, steppe: 0xc2b56e, sand: 0xd9c38c, paving: 0xa8a29a, city: 0x8a7d6a, farmland: 0xb3a04e,
  "tall-grass": 0x6f9a3c, forest: 0x2f5a2a, marsh: 0x5d7a5a, mountain: 0x7a7266, cliffs: 0x5e554a, river: 0x3b6ea8, lake: 0x2f5f95,
  ford: 0x6f97b8, scorched: 0x3a3028, rocky: 0x8e8778 };

export class MapEditorApp extends Base {
  static DEFAULT_OPTIONS = {
    id: "qin-map-editor",
    classes: ["qin", "qin-map-editor"],
    window: { title: "Battle Map Painter", icon: "fa-solid fa-paintbrush", resizable: true },
    position: { width: 360, height: "auto" },
  };
  static instance = null;
  static open(scene = canvas.scene) {
    if (!game.user.isGM) return;
    if (!canRedraw(scene)) return ui.notifications.warn(renderer ? "This scene has no map generator layout." : "Painting the map needs the map generator, which comes with the Three Kingdoms module.");
    this.instance ??= new MapEditorApp();
    this.instance.sceneId = scene.id;
    return this.instance.render({ force: true });
  }

  brush = { kind: "terrain", id: "forest", on: true };
  edits = [];        // [{ x, y, terrain } | { x, y, overlay, on }] in paint order
  look = null;       // { blend, vignette } when changed

  get scene() { return game.scenes.get(this.sceneId); }

  async _renderHTML() {
    const flag = mapFlag(this.scene) ?? {};
    const b = this.brush;
    const terr = Object.keys(MAP_TERRAIN).map(id => `<button type="button" class="qin-mp-sw ${b.kind === "terrain" && b.id === id ? "on" : ""}" data-act="terrain" data-id="${id}">
      <i style="background:#${(TERRAIN_COLORS[id] ?? 0x888888).toString(16).padStart(6, "0")}"></i>${esc(MAP_TERRAIN[id].name)}</button>`).join("");
    const ovs = PAINT_OVERLAYS.filter(id => MAP_OVERLAYS[id] || id === "catapult").map(id => `<button type="button" class="qin-mp-sw ${b.kind === "overlay" && b.id === id ? "on" : ""}" data-act="overlay" data-id="${id}">${esc(MAP_OVERLAYS[id]?.name ?? id)}</button>`).join("");
    const blend = this.look?.blend ?? flag.blend ?? 50, vig = this.look?.vignette ?? flag.vignette ?? true;
    return `<div class="qin-mp">
      <p class="qin-muted">Pick a brush, then click or drag on the map. Changes show as coloured squares until you apply them. Close this window to stop painting.</p>
      <div class="qin-mp-grid"><button type="button" class="qin-mp-sw qin-mp-erase ${b.kind === "erase" ? "on" : ""}" data-act="erase"><i class="fa-solid fa-eraser"></i>Erase <small>(removes changes you painted)</small></button></div>
      <h4>Terrain</h4><div class="qin-mp-grid">${terr}</div>
      <h4>Overlays <span class="qin-mp-mode"><label><input type="radio" name="mpOn" value="1" ${b.on ? "checked" : ""}> Add</label> <label><input type="radio" name="mpOn" value="0" ${b.on ? "" : "checked"}> Remove</label></span></h4>
      <div class="qin-mp-grid">${ovs}</div>
      <h4>Look</h4>
      <div class="qin-mp-look"><label>Blend <input type="range" min="0" max="100" step="1" value="${blend}" data-look="blend"> <span>${blend}</span></label>
        <label><input type="checkbox" data-look="vignette" ${vig ? "checked" : ""}> Vignette</label></div>
      <div class="qin-mp-foot">
        <span class="qin-muted">${this.edits.length} change${this.edits.length === 1 ? "" : "s"}${this.look ? " · look changed" : ""}</span>
        <button type="button" data-act="undo" ${this.edits.length ? "" : "disabled"}>Undo</button>
        <button type="button" data-act="discard" ${this.edits.length || this.look ? "" : "disabled"}>Discard</button>
        <button type="button" class="qin-primary" data-act="apply">${this.edits.length || this.look ? "Apply and redraw" : "Redraw"}</button>
      </div>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    if (this.wired !== content) {
      this.wired = content;
      content.addEventListener("click", (ev) => this.#onClick(ev));
      content.addEventListener("change", (ev) => this.#onChange(ev));
      content.addEventListener("input", (ev) => { const r = ev.target.closest("[data-look=blend]"); if (r) r.nextElementSibling.textContent = r.value; });
    }
    this.#startPainting();
    this.#drawPending();
  }

  #onClick(ev) {
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const a = el.dataset.act;
    if (a === "terrain" || a === "overlay") { this.brush = { ...this.brush, kind: a, id: el.dataset.id }; return this.render(); }
    if (a === "erase") { this.brush = { ...this.brush, kind: "erase" }; return this.render(); }
    if (a === "undo") { this.edits.pop(); return this.render(); }
    if (a === "discard") { this.edits = []; this.look = null; return this.render(); }
    if (a === "apply") {
      const edits = this.edits, look = this.look, scene = this.scene;
      this.edits = []; this.look = null; this.render();
      return redrawScene(scene, { edits, look });
    }
  }

  #onChange(ev) {
    const t = ev.target;
    if (t.name === "mpOn") { this.brush = { ...this.brush, on: t.value === "1" }; return; }
    if (t.dataset.look) {
      const flag = mapFlag(this.scene) ?? {};
      this.look = { blend: this.look?.blend ?? flag.blend ?? 50, vignette: this.look?.vignette ?? flag.vignette ?? true };
      this.look[t.dataset.look] = t.type === "checkbox" ? t.checked : Number(t.value);
      this.render();
    }
  }

  /* painting on the canvas */
  #paint = null;
  #layer = null;

  #startPainting() {
    if (this.#paint || !canvas?.ready) return;
    const view = canvas.app.view, size = canvas.scene?.grid?.size ?? 100;
    const toWorld = (cx, cy) => canvas.canvasCoordinatesFromClient?.({ x: cx, y: cy }) ?? canvas.stage.worldTransform.applyInverse({ x: cx - view.getBoundingClientRect().left, y: cy - view.getBoundingClientRect().top });
    const tile = (ev) => { const p = toWorld(ev.clientX, ev.clientY); return [Math.floor(p.x / size), Math.floor(p.y / size)]; };
    let dragging = false, last = null;
    const put = (ev) => {
      const flag = mapFlag(this.scene); if (!flag) return;
      const [x, y] = tile(ev);
      if (x < 0 || y < 0 || x >= flag.cols || y >= flag.rows || last === `${x},${y}`) return;
      last = `${x},${y}`;
      const b = this.brush;
      // a newer edit of the same kind on this square replaces the older one
      const same = (e) => e.x === x && e.y === y;
      if (b.kind === "erase") { // take back every change painted on this square (terrain, added and removed overlays)
        const before = this.edits.length;
        this.edits = this.edits.filter(e => !same(e));
        if (this.edits.length === before) return;
      }
      else {
        this.edits = this.edits.filter(e => !(same(e) && (b.kind === "terrain" ? e.terrain : e.overlay === b.id)));
        this.edits.push(b.kind === "terrain" ? { x, y, terrain: b.id } : { x, y, overlay: b.id, on: b.on });
      }
      this.#drawPending();
    };
    const down = (ev) => {
      if (ev.target !== view || canvas.scene?.id !== this.sceneId) return;
      if (ev.button === 2) return;
      if (ev.button !== 0) return;
      ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
      dragging = true; last = null; put(ev);
    };
    const move = (ev) => { if (dragging) put(ev); };
    const up = () => { if (dragging) { dragging = false; this.render(); } };
    document.addEventListener("pointerdown", down, true);
    view.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, true);
    this.#paint = () => {
      document.removeEventListener("pointerdown", down, true);
      view.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up, true);
    };
  }

  #drawPending() {
    if (this.#layer && !this.#layer.destroyed) this.#layer.destroy({ children: true });
    this.#layer = null;
    if (!canvas?.ready || !this.edits.length || canvas.scene?.id !== this.sceneId) return;
    const size = canvas.scene.grid.size, c = new PIXI.Container(); c.eventMode = "none";
    const g = c.addChild(new PIXI.Graphics());
    const Txt = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
    const style = new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.16), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: 3, wordWrap: true, wordWrapWidth: size * 0.9, align: "center" });
    const bySquare = new Map();
    for (const e of this.edits) { const k = `${e.x},${e.y}`; (bySquare.get(k) ?? bySquare.set(k, []).get(k)).push(e); }
    for (const [k, list] of bySquare) {
      const [x, y] = k.split(",").map(Number);
      const t = [...list].reverse().find(e => e.terrain);
      const col = t ? (TERRAIN_COLORS[t.terrain] ?? 0x888888) : 0xffffff;
      g.lineStyle(Math.max(2, size * 0.03), 0xffd34d, 1).beginFill(col, t ? 0.7 : 0.18).drawRect(x * size + 2, y * size + 2, size - 4, size - 4).endFill();
      const words = list.map(e => e.terrain ? (MAP_TERRAIN[e.terrain]?.name ?? e.terrain) : `${e.on ? "+" : "−"}${MAP_OVERLAYS[e.overlay]?.name ?? e.overlay}`);
      const label = c.addChild(new Txt(words.join("\n"), style));
      label.anchor?.set?.(0.5); label.position.set(x * size + size / 2, y * size + size / 2);
    }
    (canvas.interface ?? canvas.stage).addChild(c);
    this.#layer = c;
  }

  async close(options) {
    this.#paint?.(); this.#paint = null;
    if (this.#layer && !this.#layer.destroyed) this.#layer.destroy({ children: true });
    this.#layer = null;
    return super.close?.(options);
  }
}
