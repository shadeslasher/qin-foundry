// Battle tactics: the tactics screen (before initiative), placing tactic squares on the map, the squares
// themselves on the map, and the animation when one fires.
import { TACTICS } from "./engine-data.mjs";
import { getBattle } from "./adapter.mjs";
import { drawLadder, drawSiegeEngine } from "../unit-bars.mjs";
// battle requests go through game.qin (set up at init) so this file stays free of the panel and sheet modules
const battleRequest = (action) => game.qin.battleRequest(action);

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const TACTIC_COLORS = { player: 0x3a78c8, ally: 0x3fa66a, enemy: 0xc8443a };
const SIDE_NAME = { player: "Player", ally: "Ally", enemy: "Enemy" };
const tacticDef = (key) => TACTICS.find(t => t.key === key);
const area = (size) => `${2 * size + 1}×${2 * size + 1}`;
const gridSize = () => canvas.scene?.grid?.size ?? 100;

/** Characters that can be picked as a tactician. Players' characters first, then officers, A–Z. */
function candidates() {
  const list = (game.actors?.contents ?? []).filter(a => a.type === "character").map(a => {
    const user = game.users.find(u => !u.isGM && a.testUserPermission(u, "OWNER"));
    return { id: a.uuid, name: a.name, img: a.img, aow: Number(a.system.skills?.artOfWar?.value) || 0, kind: user ? "player" : "officer", userId: user?.id ?? null };
  });
  return list.sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name) : x.kind === "player" ? -1 : 1));
}

/** The tactics state as this client sees it (null outside the tactics phase). */
function tacticsNow() {
  const b = getBattle();
  return b.active && b.turn?.phase === "tactics" && b.tactics ? b : null;
}

/** Is this user the player tactician (a player character they own)? */
function iAmPlayerTactician(T) {
  const tac = T?.sides?.player;
  return !!tac && tac.kind === "player" && tac.userId === game.user.id;
}

/* ------------------------------------------------------------ the tactics screen */

const Base = foundry.applications?.api?.ApplicationV2 ?? class {}; // (plain class when loaded outside Foundry, e.g. tests)

export class TacticsApp extends Base {
  static DEFAULT_OPTIONS = {
    id: "qin-tactics",
    classes: ["qin", "qin-tactics"],
    window: { title: "Battle Setup: Tactics", icon: "fa-solid fa-chess-knight", resizable: true },
    position: { width: 460, height: "auto" },
  };
  static instance = null;
  static open() {
    this.instance ??= new TacticsApp();
    return this.instance.render({ force: true });
  }

  async _renderHTML() {
    const b = tacticsNow();
    if (!b) return `<p class="qin-muted">The tactics phase is over.</p>`;
    const T = b.tactics, gm = game.user.isGM;
    const sides = gm ? ["player", "ally", "enemy"] : ["player"];
    return `<div class="qin-tac">${sides.map(side => this.#section(side, T, gm)).join("")}
      ${gm ? `<div class="qin-tac-foot"><button type="button" data-act="skip" class="qin-tac-skip">Skip tactics</button><button type="button" data-act="finish" class="qin-primary">Finish tactics</button></div>`
        : `<p class="qin-muted qin-tac-wait">Ally and enemy tacticians are hidden from players. Waiting for the GM to start the battle…</p>`}
    </div>`;
  }

  #section(side, T, gm) {
    const tac = T.sides?.[side] ?? null;
    const placed = T.placed.filter(p => p.side === side);
    const portrait = tac?.img ? `<img class="qin-tac-por" src="${esc(tac.img)}" alt="">` : `<div class="qin-tac-por qin-tac-none">?</div>`;
    const label = tac ? `${esc(tac.name)}${side === "player" ? ` <small>(${tac.kind === "player" ? (tac.userId === game.user.id ? "you" : "player") : "officer"}) · Art of War ${tac.aow}</small>` : ""}` : "None";
    const picker = gm ? `<button type="button" class="qin-tac-dd" data-act="pick" data-side="${side}"><span>${label}</span><i class="fa-solid fa-caret-down"></i></button>`
      : `<div class="qin-tac-dd static"><span>${label}</span></div>`;
    let body = "";
    const canPlace = gm || (side === "player" && iAmPlayerTactician(T));
    if (side === "player" && tac) {
      const cap = tac.aow + 1;
      body += `<div class="qin-tac-count">Tactics placed: ${placed.length} / ${cap} <small>(Art of War + 1)</small></div>
        <div class="qin-tac-slots">${Array.from({ length: cap }, (_, i) => `<i class="${i < placed.length ? "f" : ""}"></i>`).join("")}</div>`;
      if (tac.kind === "officer" && !gm) body += `<p class="qin-muted">The GM is placing ${esc(tac.name)}'s tactics.</p>`;
      else if (tac.kind === "player" && !canPlace) body += `<p class="qin-muted">${esc(tac.name)} is placing the tactics.</p>`;
    }
    if ((canPlace && tac) || (gm && side !== "player")) {
      // the tactics this tactician may use: player side by Art of War level; ally and enemy: all of them
      const rows = TACTICS.map(d => {
        const done = placed.find(p => p.key === d.key);
        const locked = side === "player" && tac && d.aow > tac.aow;
        const full = side === "player" && tac && !done && placed.length >= tac.aow + 1;
        const btn = locked ? "" : done && side === "player" ? `<a data-act="place" data-side="${side}" data-key="${d.key}" data-id="${done.id}">Move</a>`
          : full ? "" : `<a data-act="place" data-side="${side}" data-key="${d.key}">Place</a>`;
        return `<div class="qin-tac-row ${locked ? "locked" : ""}" data-tooltip="${esc(d.text)}"><span>${esc(d.name)}${locked ? ` <small>· Art of War ${d.aow}</small>` : ""}${done && side === "player" ? ` <small class="qin-tac-placed">(placed)</small>` : ""}</span><span>${area(d.size)}</span><span>${btn}</span></div>`;
      }).join("");
      if (side !== "player" || tac) body += `<details class="qin-tac-list" data-side="${side}" ${(this.openLists ??= new Set(gm ? [] : ["player"])).has(side) ? "open" : ""}><summary>${side === "player" ? "Tactics" : "Place a tactic"}</summary><div class="qin-tac-row hd"><span>Tactic</span><span>Size</span><span></span></div>${rows}</details>`;
    }
    if (placed.length && (gm || side === "player")) {
      body += placed.map(p => `<div class="qin-tac-chip"><span><b>${esc(tacticDef(p.key)?.name ?? p.key)}</b> <small>${area(p.size)} · at ${p.x}, ${p.y}</small></span>${canPlace ? `<span><a data-act="place" data-side="${side}" data-key="${p.key}" data-id="${p.id}" data-tooltip="Move"><i class="fa-solid fa-up-down-left-right"></i></a> <a data-act="remove" data-id="${p.id}" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></a></span>` : ""}</div>`).join("");
    }
    return `<section class="qin-tac-sec ${side}">
      <h4>${SIDE_NAME[side]} tactician <small>${side === "player" ? (gm ? "players see this section" : "") : "GM only"}</small></h4>
      <div class="qin-tac-body"><div class="qin-tac-sel"><label>Tactician</label>${portrait}${picker}</div>${body}</div>
    </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    // the window's contents are rebuilt each time it reopens, so hook up clicks per element, not once per app
    if (this.wired !== content) { this.wired = content; content.addEventListener("click", (ev) => this.#onClick(ev)); }
    // keep each tactic list open or closed across refreshes
    for (const d of content.querySelectorAll("details.qin-tac-list")) d.addEventListener("toggle", () => {
      this.openLists ??= new Set();
      if (d.open) this.openLists.add(d.dataset.side); else this.openLists.delete(d.dataset.side);
    });
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    ev.preventDefault();
    const d = el.dataset;
    if (d.act === "pick") return this.#pickTactician(d.side, el);
    if (d.act === "place") return startPlacement(d.side, d.key, d.id || null);
    if (d.act === "remove") return battleRequest({ type: "removeTactic", id: d.id });
    if (d.act === "skip") return battleRequest({ type: "skipTactics" });
    if (d.act === "finish") return battleRequest({ type: "finishTactics" });
  }

  /** A dropdown of portraits: None, players' characters, officers. Player side: no Art of War = greyed out. */
  #pickTactician(side, anchor) {
    document.querySelector(".qin-tac-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "qin qin-tac-menu";
    const opts = candidates();
    menu.innerHTML = `<input type="search" placeholder="Search…">
      <div class="qin-tac-opt" data-id="">None</div>
      ${opts.map(o => {
        const off = side === "player" && o.aow < 1;
        return `<div class="qin-tac-opt ${off ? "off" : ""}" data-id="${esc(o.id)}" data-name="${esc(o.name.toLowerCase())}"><img src="${esc(o.img)}" alt=""><b>${esc(o.name)}</b> <small>${o.kind} · ${o.aow ? `Art of War ${o.aow}` : "no Art of War"}</small></div>`;
      }).join("")}`;
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${r.left}px`, top: `${r.bottom + 2}px`, width: `${Math.max(260, r.width)}px` });
    const search = menu.querySelector("input");
    search.focus();
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const o of menu.querySelectorAll(".qin-tac-opt[data-name]")) o.hidden = !!q && !o.dataset.name.includes(q);
    });
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    menu.addEventListener("click", async (e) => {
      const o = e.target.closest(".qin-tac-opt");
      if (!o || o.classList.contains("off")) return;
      close();
      const pick = opts.find(x => x.id === o.dataset.id) ?? null;
      await battleRequest({ type: "setTactician", side, tactician: pick });
    });
  }
}

/** Open, refresh or close the tactics screen to match the battle. */
export function refreshTactics() {
  const b = tacticsNow();
  const app = TacticsApp.instance;
  drawSiegeOverlays();
  if (!b) { if (app?.rendered) app.close(); drawTacticOverlays(); return; }
  if (app?.rendered) app.render();
  else TacticsApp.open();
  drawTacticOverlays();
}

/* ------------------------------------------------------------ placing a square on the map */

let placing = null;

function stopPlacement() {
  if (!placing) return;
  const { view, down, move, key, block, g } = placing;
  document.removeEventListener("pointerdown", down, true);
  view.removeEventListener("pointermove", move);
  document.removeEventListener("keydown", key, true);
  view.removeEventListener("contextmenu", block, true);
  if (g && !g.destroyed) g.destroy();
  placing = null;
}

/** The square follows the cursor; click a tile to place it there, right-click or Esc to cancel. */
export function startPlacement(side, key, id = null) {
  stopPlacement();
  if (!canvas?.ready) return;
  const def = tacticDef(key); if (!def) return;
  const view = canvas.app.view, size = gridSize(), color = TACTIC_COLORS[side];
  const g = new PIXI.Graphics(); g.eventMode = "none";
  (canvas.interface ?? canvas.stage).addChild(g);
  const Txt = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  const label = new Txt(`${def.name} · click to place`, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.24), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: 4 }));
  g.addChild(label);
  const toWorld = (cx, cy) => canvas.canvasCoordinatesFromClient?.({ x: cx, y: cy }) ?? canvas.stage.worldTransform.applyInverse({ x: cx - view.getBoundingClientRect().left, y: cy - view.getBoundingClientRect().top });
  const tile = (ev) => { const p = toWorld(ev.clientX, ev.clientY); return [Math.floor(p.x / size), Math.floor(p.y / size)]; };
  const draw = (x, y) => {
    g.clear();
    const s = def.size, X = (x - s) * size, Y = (y - s) * size, W = (2 * s + 1) * size;
    g.lineStyle(4, color, 1).beginFill(color, 0.22).drawRect(X, Y, W, W).endFill();
    g.lineStyle(2, 0xffffff, 0.9).beginFill(color, 0.45).drawRect(x * size + 4, y * size + 4, size - 8, size - 8).endFill();
    label.position.set(X + 8, Y + 6);
  };
  const move = (ev) => { const [x, y] = tile(ev); draw(x, y); };
  const down = async (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) return stopPlacement();
    if (ev.button !== 0) return;
    const [x, y] = tile(ev);
    stopPlacement();
    await battleRequest({ type: "placeTactic", side, key, x, y, id: id || undefined });
  };
  const key2 = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); stopPlacement(); } };
  const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  placing = { view, down, move, key: key2, block, g };
  document.addEventListener("pointerdown", down, true);
  view.addEventListener("pointermove", move);
  document.addEventListener("keydown", key2, true);
  view.addEventListener("contextmenu", block, true);
  ui.notifications.info(`Click a tile to place ${def.name}. Right-click or Esc to cancel.`);
}

/* ------------------------------------------------------------ tactic squares on the map */

let overlay = null;

function dashedRect(g, x, y, w, h, dash = 14) {
  const line = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(len / (dash * 2)));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = Math.min(1, a + 0.5 / n);
      g.moveTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a).lineTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
    }
  };
  line(x, y, x + w, y); line(x + w, y, x + w, y + h); line(x + w, y + h, x, y + h); line(x, y + h, x, y);
}

/**
 * Squares on the map: the GM sees every unfired tactic (dashed); players see their own side's; every
 * fired tactic still in effect shows to everyone (faint fill).
 */
export function drawTacticOverlays() {
  if (overlay && !overlay.destroyed) overlay.destroy();
  overlay = null;
  if (!canvas?.ready) return;
  const b = getBattle();
  if (!b.active || b.sceneId !== canvas.scene?.id || !b.tactics) return;
  const round = b.turn?.round ?? 0, size = gridSize();
  const shown = b.tactics.placed.filter(p => p.state === "active" ? (p.untilRound === undefined || round <= p.untilRound)
    : p.state === "hidden" && (game.user.isGM || p.side === "player"));
  if (!shown.length) return;
  const c = new PIXI.Container(); c.eventMode = "none";
  const g = new PIXI.Graphics(); c.addChild(g);
  const Txt = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  for (const p of shown) {
    const col = TACTIC_COLORS[p.side] ?? 0xffffff, X = (p.x - p.size) * size, Y = (p.y - p.size) * size, W = (2 * p.size + 1) * size;
    if (p.state === "active") g.lineStyle(3, col, 0.85).beginFill(col, 0.12).drawRect(X, Y, W, W).endFill();
    else { g.lineStyle(3, col, 0.9); g.beginFill(col, 0.05).drawRect(X, Y, W, W).endFill(); g.lineStyle(3, col, 0.95); dashedRect(g, X, Y, W, W); }
    const name = tacticDef(p.key)?.name ?? p.key;
    const t = new Txt(p.state === "active" ? `${name} (active)` : name, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.2), fontWeight: "bold", fill: "#" + col.toString(16).padStart(6, "0"), stroke: "#000000", strokeThickness: 4 }));
    t.position.set(X + 6, Y + 4);
    c.addChild(t);
  }
  const layer = canvas.interface ?? canvas.stage;
  layer.addChildAt?.(c, 0) ?? layer.addChild(c);
  overlay = c;
}

/* ------------------------------------------------------------ ladders on the walls, dropped siege equipment */

let siegeLayer = null;

/**
 * A city gate, so its state reads at a glance. Locked: two barred wooden doors with a lock. Open: the doors
 * swung back to the sides with the dark passage between. Broken: splintered planks. Its frame is the owner's
 * colour (blue friendly, red enemy).
 */
function drawGate(g, size) {
  // The map image already shows the generator's gatehouse, so only mark it: the owner's colour round it and a
  // small badge for its state (locked, open, broken, burned). Burned gates get scorched until the map is redrawn.
  const xs = g.squares.map(([x]) => x), ys = g.squares.map(([, y]) => y);
  const X = Math.min(...xs) * size, Y = Math.min(...ys) * size;
  const W = (Math.max(...xs) - Math.min(...xs) + 1) * size, H = (Math.max(...ys) - Math.min(...ys) + 1) * size;
  const own = g.owner === "enemy" ? 0xc8443a : 0x3a78c8;
  const box = new PIXI.Container(), lw = Math.max(2, size * 0.035), inset = lw / 2 + 1;
  let gr = box.addChild(new PIXI.Graphics());
  if (g.state === "burned") {
    gr.lineStyle(0).beginFill(0x120b06, 0.55).drawRect(X, Y, W, H).endFill();
    gr.beginFill(0x2a1a10, 0.5).drawEllipse(X + W / 2, Y + H / 2, W * 0.42, H * 0.42).endFill();
  }
  gr.lineStyle(lw, own, 0.9).drawRect(X + inset, Y + inset, W - 2 * inset, H - 2 * inset);
  // badge in the top right corner
  const r = Math.max(8, size * 0.17), cx = X + W - r * 0.9, cy = Y + r * 0.9, ink = 0xffffff, t = Math.max(1.5, r * 0.16);
  gr.lineStyle(Math.max(1.5, r * 0.14), 0x1a1208, 1).beginFill(own, 1).drawCircle(cx, cy, r).endFill();
  gr = box.addChild(new PIXI.Graphics()); // the icon in its own shape, so no stray line joins it to the circle
  if (g.state === "locked") { // padlock
    gr.lineStyle(t, ink, 1).moveTo(cx - r * 0.3, cy - r * 0.12).arc(cx, cy - r * 0.12, r * 0.3, Math.PI, 0);
    gr.lineStyle(0).beginFill(ink, 1).drawRoundedRect(cx - r * 0.45, cy - r * 0.12, r * 0.9, r * 0.62, r * 0.1).endFill();
  } else if (g.state === "open") { // two doors swung apart
    gr.lineStyle(t, ink, 1).moveTo(cx - r * 0.55, cy + r * 0.45).lineTo(cx - r * 0.55, cy - r * 0.45).lineTo(cx - r * 0.15, cy - r * 0.3).lineTo(cx - r * 0.15, cy + r * 0.55).closePath()
      .moveTo(cx + r * 0.55, cy + r * 0.45).lineTo(cx + r * 0.55, cy - r * 0.45).lineTo(cx + r * 0.15, cy - r * 0.3).lineTo(cx + r * 0.15, cy + r * 0.55).closePath();
  } else if (g.state === "broken") { // a crack through the door
    gr.lineStyle(t * 1.1, ink, 1).moveTo(cx - r * 0.1, cy - r * 0.6).lineTo(cx + r * 0.2, cy - r * 0.15).lineTo(cx - r * 0.2, cy + r * 0.1).lineTo(cx + r * 0.1, cy + r * 0.6);
  } else if (g.state === "burned") { // flame
    gr.lineStyle(0).beginFill(0xffb347, 1).moveTo(cx, cy - r * 0.62).bezierCurveTo(cx + r * 0.55, cy - r * 0.1, cx + r * 0.45, cy + r * 0.55, cx, cy + r * 0.55)
      .bezierCurveTo(cx - r * 0.45, cy + r * 0.55, cx - r * 0.55, cy, cx - r * 0.1, cy - r * 0.25).bezierCurveTo(cx - r * 0.05, cy - r * 0.05, cx + r * 0.1, cy - r * 0.3, cx, cy - r * 0.62).endFill();
  }
  return box;
}
/** Ladders set against wall squares (leaning on the square), and siege equipment lying on the ground. */
export function drawSiegeOverlays() {
  if (siegeLayer && !siegeLayer.destroyed) siegeLayer.destroy({ children: true });
  siegeLayer = null;
  if (!canvas?.ready) return;
  const b = getBattle();
  if (!b.active || b.sceneId !== canvas.scene?.id || !b.siege) return;
  const { ladders = [], dropped = [], gates = [] } = b.siege;
  if (!ladders.length && !dropped.length && !gates.length) return;
  const size = gridSize(), c = new PIXI.Container(); c.eventMode = "none";
  for (const g of gates) c.addChild(drawGate(g, size));
  for (const k of ladders) {
    const [x, y] = k.split(",").map(Number);
    const l = drawLadder(size * 0.95);
    l.position.set(x * size + size * 0.5, y * size + size * 0.5); l.rotation = 0.35; l.alpha = 0.95;
    c.addChild(l);
  }
  for (const d of dropped) {
    const ring = new PIXI.Graphics().lineStyle(Math.max(1, size * 0.02), d.kind === "ladders" ? 0xd9a441 : 0xa0a0aa, 1).beginFill(0x18120c, 0.85).drawCircle(0, 0, size * 0.2).endFill();
    ring.position.set(x0(d) + size * 0.78, y0(d) + size * 0.78);
    const ic = (d.kind === "ladders" ? drawLadder : drawSiegeEngine)(size * 0.4);
    ic.position.copyFrom(ring.position);
    c.addChild(ring, ic);
  }
  function x0(d) { return d.x * size; } function y0(d) { return d.y * size; }
  const layer = canvas.tokens ?? canvas.interface ?? canvas.stage;
  layer.addChildAt?.(c, 0) ?? layer.addChild(c);
  siegeLayer = c;
}

/* ------------------------------------------------------------ the trigger animation */

/**
 * A tactic fires: the map dims, its square lights up in the colour of the side that placed it with sparks
 * rising from the tiles, and its name shows over the square. Resolves when it's done (~2.6 s).
 */
export function playTacticTrigger(tc) {
  if (!canvas?.ready || !tc) return Promise.resolve();
  const size = gridSize(), col = TACTIC_COLORS[tc.side] ?? 0xffffff;
  const X = (tc.x - tc.size) * size, Y = (tc.y - tc.size) * size, W = (2 * tc.size + 1) * size;
  const dims = canvas.dimensions?.rect ?? { x: -1e5, y: -1e5, width: 2e5, height: 2e5 };
  const root = new PIXI.Container(); root.eventMode = "none";
  const dim = new PIXI.Graphics(), sq = new PIXI.Graphics(), sparks = new PIXI.Graphics();
  root.addChild(dim, sq, sparks);
  (canvas.interface ?? canvas.stage).addChild(root);
  // sparks: each rises from a random point in the square, fades as it climbs, then starts again
  const hi = (() => { const r = Math.min(255, ((col >> 16) & 255) + 110), g = Math.min(255, ((col >> 8) & 255) + 110), b = Math.min(255, (col & 255) + 110); return (r << 16) | (g << 8) | b; })();
  const n = Math.round(30 + 12 * (2 * tc.size + 1));
  const ps = Array.from({ length: n }, () => ({ x: X + Math.random() * W, y: Y + Math.random() * W, sp: 0.25 + Math.random() * 0.5, ph: Math.random(), r: 1.5 + Math.random() * 2.2 }));
  // the banner (HTML, so it reads crisply at any zoom)
  const banner = document.createElement("div");
  banner.className = `qin-tac-banner ${tc.side}`;
  banner.innerHTML = `<small>${SIDE_NAME[tc.side] ?? ""} tactic${tc.tactician ? ` · ${esc(tc.tactician)}` : ""}</small><b>${esc(tc.name)}</b>`;
  document.body.append(banner);
  const place = () => {
    const p = canvas.clientCoordinatesFromCanvas?.({ x: X + W / 2, y: Y + W / 2 }) ?? canvas.stage.worldTransform.apply({ x: X + W / 2, y: Y + W / 2 });
    banner.style.left = `${p.x}px`; banner.style.top = `${p.y}px`;
  };
  place();
  const DUR = 2600, t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / DUR;
      const fadeIn = Math.min(1, t / 0.12), fadeOut = t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) : 1, a = fadeIn * fadeOut;
      dim.clear().beginFill(0x000000, 0.45 * a).drawRect(dims.x, dims.y, dims.width, dims.height);
      if (dim.beginHole) dim.beginHole().drawRect(X, Y, W, W).endHole();
      dim.endFill();
      const pulse = 0.32 + 0.08 * Math.sin(t * 18);
      sq.clear().lineStyle(5, col, a).beginFill(col, pulse * a).drawRect(X, Y, W, W).endFill();
      sparks.clear();
      for (const p of ps) {
        const k = (p.ph + t * p.sp * 3) % 1, h = k * size * 1.1;
        const al = a * (1 - k) * 0.95;
        sparks.lineStyle(2, hi, al * 0.5).moveTo(p.x, p.y - h).lineTo(p.x, p.y - h + size * 0.18);
        sparks.lineStyle(0).beginFill(hi, al).drawCircle(p.x, p.y - h, p.r).endFill();
      }
      place();
      banner.style.opacity = String(a);
      banner.style.transform = `translate(-50%, -50%) scale(${0.9 + 0.1 * fadeIn})`;
      if (t < 1) requestAnimationFrame(tick);
      else { root.destroy({ children: true }); banner.remove(); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}

/** Set Fire: show the tile that was set alight (the fire itself is handled by the map). */
export function playSetFire(x, y) {
  if (!canvas?.ready) return Promise.resolve();
  const size = gridSize(), g = new PIXI.Graphics(); g.eventMode = "none";
  (canvas.interface ?? canvas.stage).addChild(g);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1200;
      g.clear().lineStyle(4, 0xff7a1a, 1 - t).beginFill(0xff5a00, 0.4 * (1 - t)).drawRect(x * size, y * size, size, size).endFill();
      if (t < 1) requestAnimationFrame(tick); else { g.destroy(); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}

export function registerTactics() {
  Hooks.on("canvasReady", () => { drawTacticOverlays(); drawSiegeOverlays(); });
  Hooks.on("canvasTearDown", () => stopPlacement());
}

