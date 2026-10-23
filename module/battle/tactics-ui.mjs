// Battle tactics: the tactics screen (before initiative), placing tactic squares on the map, the squares
// themselves on the map, and the animation when one fires.
import { TACTICS } from "./engine-data.mjs";
import { getBattle } from "./adapter.mjs";
import { drawLadder, drawSiegeEngine } from "../unit-bars.mjs";
import { canRedraw } from "./maprender.mjs";
// battle requests go through game.qin (set up at init) so this file stays free of the panel and sheet modules
const battleRequest = (action) => game.qin.battleRequest(action);

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const TACTIC_COLORS = { player: 0x3a78c8, ally: 0x3fa66a, enemy: 0xc8443a };
const SIDE_NAME = { player: "Player", ally: "Ally", enemy: "Enemy" };
const tacticDef = (key) => TACTICS.find(t => t.key === key);
const area = (size) => `${2 * size + 1}×${2 * size + 1}`;
/** "1 turn" means the rest of the round the tactic fires in; each further turn is one more round. */
const lastsLabel = (d) => {
  const m = /^(\d+) turns?$/.exec(d.lasts ?? ""); if (!m) return d.lasts ?? "";
  const n = Number(m[1]);
  return `${d.lasts} (rest of the round${n === 2 ? " and the next" : n > 2 ? ` and the next ${n - 1}` : ""})`;
};
/** Hover text for a tactic: trigger, duration, effect. */
const tacticTip = (d) => `<b>Trigger:</b> ${esc(d.when ?? "")}<br><b>Duration:</b> ${esc(lastsLabel(d))}<br><b>Effect:</b> ${esc(d.text)}`;
const tacticTipText = (d) => `Trigger: ${d.when ?? ""} · Duration: ${lastsLabel(d)} · Effect: ${d.text}`;
/** Tooltip attributes: HTML where Foundry supports it (data-tooltip-html), plain text otherwise. */
const tipAttrs = (d) => d ? `data-tooltip="${esc(tacticTipText(d))}" data-tooltip-html="${esc(tacticTip(d))}" data-tooltip-class="qin-tac-tip"` : "";
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
        return `<div class="qin-tac-row ${locked ? "locked" : ""}" ${tipAttrs(d)}><span>${esc(d.name)}${locked ? ` <small>· Art of War ${d.aow}</small>` : ""}${done && side === "player" ? ` <small class="qin-tac-placed">(placed)</small>` : ""}</span><span>${area(d.size)}</span><span>${btn}</span></div>`;
      }).join("");
      if (side !== "player" || tac) body += `<details class="qin-tac-list" data-side="${side}" ${(this.openLists ??= new Set(gm ? [] : ["player"])).has(side) ? "open" : ""}><summary>${side === "player" ? "Tactics" : "Place a tactic"}</summary><div class="qin-tac-row hd"><span>Tactic</span><span>Size</span><span></span></div>${rows}</details>`;
    }
    if (placed.length && (gm || side === "player")) {
      body += placed.map(p => `<div class="qin-tac-chip" ${tipAttrs(tacticDef(p.key))}><span><b>${esc(tacticDef(p.key)?.name ?? p.key)}</b> <small>${area(p.size)} · at ${p.x}, ${p.y}</small></span>${canPlace ? `<span><a data-act="place" data-side="${side}" data-key="${p.key}" data-id="${p.id}" data-tooltip="Move"><i class="fa-solid fa-up-down-left-right"></i></a> <a data-act="remove" data-id="${p.id}" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></a></span>` : ""}</div>`).join("");
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
let overlayTick = null;

/** How long a fired tactic still lasts, for its badge: "Ends this round", "2 rounds left", "Until destroyed". */
function remainingLabel(p, round) {
  const def = tacticDef(p.key);
  if (def?.turns >= 99) return "Until destroyed";
  if (p.untilRound === undefined) return "";
  const left = p.untilRound - round + 1;
  return left <= 1 ? "Ends this round" : `${left} rounds left`;
}

export function drawTacticOverlays() {
  if (overlayTick) { canvas?.app?.ticker?.remove(overlayTick); overlayTick = null; }
  if (overlay && !overlay.destroyed) overlay.destroy({ children: true });
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
  const live = []; // active areas: a slowly breathing glow and a few motes drifting up
  for (const p of shown) {
    const col = TACTIC_COLORS[p.side] ?? 0xffffff, X = (p.x - p.size) * size, Y = (p.y - p.size) * size, W = (2 * p.size + 1) * size;
    const hex = "#" + col.toString(16).padStart(6, "0"), name = tacticDef(p.key)?.name ?? p.key;
    if (p.state === "active") {
      const glow = new PIXI.Graphics(); c.addChildAt(glow, 0);
      const motes = new PIXI.Graphics(); c.addChild(motes);
      const n = Math.min(14, 4 + p.size * 2), rnd = (i, k) => { const v = Math.sin((p.x * 73 + p.y * 37 + i * 11 + k) * 12.9898) * 43758.5453; return v - Math.floor(v); };
      live.push({ glow, motes, col, X, Y, W, seeds: Array.from({ length: n }, (_, i) => ({ x: rnd(i, 1), s: 0.35 + rnd(i, 2) * 0.5, o: rnd(i, 3), r: 1.5 + rnd(i, 4) * 2.5 })) });
      // name, then the countdown badge beside it
      const t = new Txt(name, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.2), fontWeight: "bold", fill: hex, stroke: "#000000", strokeThickness: 4, lineJoin: "round" }));
      t.position.set(X + 6, Y + 4); c.addChild(t);
      const label = remainingLabel(p, round);
      if (label) {
        const bt = new Txt(`⌛ ${label}`, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.16), fontWeight: "bold", fill: "#ffffff" }));
        const padX = size * 0.07, padY = size * 0.03, bx = X + 6, by = Y + 6 + t.height;
        const pill = new PIXI.Graphics().lineStyle(Math.max(1, size * 0.015), col, 1).beginFill(0x111111, 0.78)
          .drawRoundedRect(bx, by, bt.width + 2 * padX, bt.height + 2 * padY, (bt.height + 2 * padY) / 2).endFill();
        bt.position.set(bx + padX, by + padY);
        c.addChild(pill, bt);
      }
    } else {
      g.lineStyle(3, col, 0.9); g.beginFill(col, 0.05).drawRect(X, Y, W, W).endFill(); g.lineStyle(3, col, 0.95); dashedRect(g, X, Y, W, W);
      const t = new Txt(name, new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.2), fontWeight: "bold", fill: hex, stroke: "#000000", strokeThickness: 4, lineJoin: "round" }));
      t.position.set(X + 6, Y + 4); c.addChild(t);
    }
  }
  const layer = canvas.interface ?? canvas.stage;
  layer.addChildAt?.(c, 0) ?? layer.addChild(c);
  overlay = c;
  if (live.length && canvas.app?.ticker) {
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / 1000, breathe = 0.5 + 0.5 * Math.sin(t * 1.6);
      for (const a of live) {
        a.glow.clear()
          .lineStyle(3, a.col, 0.55 + 0.3 * breathe).beginFill(a.col, 0.07 + 0.06 * breathe).drawRect(a.X, a.Y, a.W, a.W).endFill()
          .lineStyle(0).beginFill(a.col, 0.05 * breathe).drawRect(a.X + a.W * 0.04, a.Y + a.W * 0.04, a.W * 0.92, a.W * 0.92).endFill();
        a.motes.clear();
        for (const m of a.seeds) {
          const k = (m.o + t * m.s * 0.12) % 1;                       // 0 at the bottom of the area, 1 at the top
          const fade = Math.sin(Math.PI * k);
          a.motes.beginFill(0xffffff, 0.6 * fade).drawCircle(a.X + a.W * (0.06 + 0.88 * m.x) + Math.sin(t * 0.8 + m.o * 6) * size * 0.06, a.Y + a.W * (1 - k), m.r).endFill();
        }
      }
    };
    draw();
    overlayTick = draw;
    canvas.app.ticker.add(overlayTick);
  }
}

/* ------------------------------------------------------------ ladders on the walls, dropped siege equipment */

let siegeLayer = null;

/**
 * A city gate, so its state reads at a glance. Locked: two barred wooden doors with a lock. Open: the doors
 * swung back to the sides with the dark passage between. Broken: splintered planks. Its frame is the owner's
 * colour (blue friendly, red enemy).
 */
/**
 * A gate's doors over the map's own gatehouse art (the generator draws it closed). Locked: nothing extra.
 * Open: the doors on both faces swung outward. Broken: doors smashed, one hanging, one torn off on the ground.
 * Burned: scorched until the map is redrawn as ruins. Geometry follows the generator's gatehouse: the door
 * openings sit on both faces of the wall, 0.32 of a square wide for a single gate, 0.82 for a double.
 */
function drawGate(g, size, wallAt = () => false) {
  const xs = g.squares.map(([x]) => x), ys = g.squares.map(([, y]) => y);
  const n = g.squares.length > 1 ? 2 : 1, T = size;
  // does the wall run east-west here (so the passage, and the doors, face north and south)?
  let ew;
  if (n > 1) ew = ys[0] === ys[1];
  else { const [x, y] = g.squares[0]; const h = wallAt(x - 1, y) || wallAt(x + 1, y), v = wallAt(x, y - 1) || wallAt(x, y + 1); ew = h || !v; }
  const cx = ((Math.min(...xs) + Math.max(...xs)) / 2 + 0.5) * T, cy = ((Math.min(...ys) + Math.max(...ys)) / 2 + 0.5) * T;
  const depth = n > 1 ? T * 1.12 : T, half = depth / 2, mouth = n > 1 ? T * 0.82 : T * 0.32;
  const box = new PIXI.Container();
  if (g.state === "locked") return box;
  if (g.state === "burned") {
    if (canRedraw(canvas.scene)) return box; // the map itself is redrawn with ruins there
    const len = T * n, w = ew ? len : depth, h = ew ? depth : len;
    box.addChild(new PIXI.Graphics().beginFill(0x120b06, 0.55).drawRect(cx - w / 2, cy - h / 2, w, h).endFill());
    return box;
  }
  const tan = ew ? [1, 0] : [0, 1];                // along the wall
  const leafLen = mouth / 2, th = Math.max(3, T * 0.085);
  const leaf = (hx, hy, dir, { broken = false } = {}) => {
    const gr = new PIXI.Graphics(), L = broken ? leafLen * 0.72 : leafLen;
    const ex = hx + dir[0] * L, ey = hy + dir[1] * L, nx = -dir[1] * th / 2, ny = dir[0] * th / 2;
    // a little shadow, then the planked leaf with iron bands
    gr.beginFill(0x0e100a, 0.35).drawPolygon([hx + nx + th * 0.5, hy + ny + th * 0.6, ex + nx + th * 0.5, ey + ny + th * 0.6, ex - nx + th * 0.5, ey - ny + th * 0.6, hx - nx + th * 0.5, hy - ny + th * 0.6]).endFill();
    gr.lineStyle(Math.max(1, T * 0.012), 0x2a1a0c, 1).beginFill(broken ? 0x5a3a1e : 0x6b4424, 1);
    if (broken) { // splintered end
      const mx = hx + dir[0] * L * 1.12, my = hy + dir[1] * L * 1.12;
      gr.drawPolygon([hx + nx, hy + ny, ex + nx, ey + ny, mx + nx * 0.2, my + ny * 0.2, ex - nx * 0.4, ey - ny * 0.4, ex + dir[0] * L * 0.06 - nx, ey + dir[1] * L * 0.06 - ny, hx - nx, hy - ny]);
    } else gr.drawPolygon([hx + nx, hy + ny, ex + nx, ey + ny, ex - nx, ey - ny, hx - nx, hy - ny]);
    gr.endFill();
    gr.lineStyle(Math.max(1, T * 0.014), 0x3b3f45, 1);
    for (const f of broken ? [0.3] : [0.25, 0.75]) { const px = hx + dir[0] * L * f, py = hy + dir[1] * L * f; gr.moveTo(px + nx, py + ny).lineTo(px - nx, py - ny); }
    gr.lineStyle(0).beginFill(0x1a120a, 1).drawCircle(hx, hy, th * 0.45).endFill(); // hinge post
    return gr;
  };
  const lean = 0.22; // open doors lean slightly away from the opening
  for (const face of [-1, 1]) {                    // both faces of the wall
    const nrm = ew ? [0, face] : [face, 0];
    const fx = cx + nrm[0] * (half - T * 0.03), fy = cy + nrm[1] * (half - T * 0.03);
    for (const side of [-1, 1]) {                  // the two leaves of the door
      const hx = fx + tan[0] * side * mouth / 2, hy = fy + tan[1] * side * mouth / 2;
      const open = [nrm[0] * Math.cos(lean) + tan[0] * side * Math.sin(lean), nrm[1] * Math.cos(lean) + tan[1] * side * Math.sin(lean)];
      if (g.state === "open") box.addChild(leaf(hx, hy, open));
      else if (side === -1) { // broken: this leaf hangs half open and smashed
        const a = 0.55, d = [nrm[0] * Math.sin(a) - tan[0] * side * Math.cos(a), nrm[1] * Math.sin(a) - tan[1] * side * Math.cos(a)];
        box.addChild(leaf(hx, hy, d, { broken: true }));
      } else { // the other leaf torn off, lying on the ground beyond the gate
        const lx = fx + nrm[0] * T * 0.28 + tan[0] * mouth * 0.05, ly = fy + nrm[1] * T * 0.28 + tan[1] * mouth * 0.05;
        const a = 0.35, d = [tan[0] * Math.cos(a) + nrm[0] * Math.sin(a), tan[1] * Math.cos(a) + nrm[1] * Math.sin(a)];
        const gr = leaf(lx - d[0] * leafLen / 2, ly - d[1] * leafLen / 2, d, { broken: true }); gr.alpha = 0.95; box.addChild(gr);
      }
    }
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
  const bm = canvas.scene?.getFlag?.(game.system?.id ?? "qin", "battlemap");
  const wallAt = (x, y) => !!bm && x >= 0 && y >= 0 && x < bm.cols && y < bm.rows && (bm.overlays?.[y * bm.cols + x] ?? []).some(o => o === "city-wall" || o === "city-gate" || o === "fortress-tower");
  for (const g of gates) c.addChild(drawGate(g, size, wallAt));
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

