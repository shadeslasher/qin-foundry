// Battle unit "stand": instead of the token picture, every unit token is drawn as a square base in its
// side colour with up to five soldier figures (one per 20% of its strength), its officer's medallion,
// its faction banner rolled up in the corner (it unrolls while hovered), and health/morale bars.
import { factionOf } from "./factions.mjs";

const KEY = "qinUnitBars";
const SIDE_COLORS = { player: 0x3a78c8, enemy: 0xc8443a, ally: 0x3fa66a, neutral: 0xd4a017 };

// Layout, as fractions of the token's size
const L = {
  pad: 0.03, fig: 0.36, ringCrop: 0.115, officer: 0.33,
  back: [[0.29, 0.33], [0.50, 0.31], [0.71, 0.33]], front: [[0.395, 0.53], [0.605, 0.53]],
  flagX: 0.87, flagY: 0.055, flagH: 0.26, rollW: 0.075, bar: 0.15,
};
// Slots in loss order: slot 1 is lost first, slot 5 (back-middle) is the last man standing
//   back row:  4 5 3      front row:  2 1
const SLOTS = { 1: L.front[1], 2: L.front[0], 3: L.back[2], 4: L.back[0], 5: L.back[1] };

/* ------------------------------------------------------------ helpers */

/** Is it this unit's turn right now? */
function isActive(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  return !!(battle?.active && battle.sceneId === token.document?.parent?.id && battle.turn?.activation?.unitId === token.id);
}

function hasActed(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  if (!battle?.active || battle.sceneId !== token.document?.parent?.id) return false;
  if (battle.turn?.activation?.unitId === token.id) return false;
  return !!battle.meta?.[token.id]?.round?.activated;
}

/** Did this unit Hold this round (enemy attacks against it -2 until the round ends)? */
function isHolding(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  if (!battle?.active || battle.sceneId !== token.document?.parent?.id) return false;
  return !!battle.meta?.[token.id]?.round?.holding;
}

/** A heater shield centred on (0,0), w wide and h tall. */
function shieldPoints(w, h) {
  const pts = [-w / 2, -h / 2, w / 2, -h / 2];
  for (let k = 0; k <= 24; k++) {
    const a = (Math.PI * k) / 24;
    pts.push((w / 2) * Math.cos(a), -h / 2 + h * 0.45 + h * 0.55 * Math.sin(a));
  }
  return pts;
}
function drawShield(w, h) {
  const g = new PIXI.Graphics();
  g.beginFill(0x000000, 0.45).drawPolygon(shieldPoints(w, h).map((v, i) => v + (i % 2 ? h * 0.06 : w * 0.04))).endFill();
  g.lineStyle(Math.max(1.5, w * 0.07), 0x14141e, 1).beginFill(0x3a78c8, 1).drawPolygon(shieldPoints(w, h)).endFill();
  g.lineStyle(Math.max(1, w * 0.06), 0xffd34d, 1).drawPolygon(shieldPoints(w * 0.76, h * 0.76));
  return g;
}

const textClass = () => foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
const loadTex = (src) => {
  if (!src) return Promise.resolve(null);
  const fn = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  return Promise.resolve(fn ? fn(src) : PIXI.Texture.from(src)).catch(() => null);
};

function healthColor(p) { return p > 0.5 ? 0x3f9b4a : p > 0.25 ? 0xd4a017 : 0xc0392b; }
function moraleColor(m) { return m >= 75 ? 0x4aa3df : m <= 25 ? 0x7d5a9e : 0x2f6fb2; }

/** How many soldier figures a unit shows: one per 20% of its strength (cavalry: of 50). */
export function figureCount(men, max) {
  if (!(men > 0)) return 0;
  return Math.max(1, Math.min(5, Math.ceil((5 * men) / (max || 100) - 1e-9)));
}

/** Which slots are still standing for n figures, in draw order (back row first, right soldier on top). */
export function figureSlots(n) {
  const keep = [];
  for (let k = 5; k > 5 - n; k--) keep.push(SLOTS[k]);
  const isFront = (p) => L.front.includes(p);
  return keep.sort((a, b) => (isFront(a) - isFront(b)) || (a[0] - b[0]));
}

// Faction banner analysis (cached): the opaque bounds and the main cloth colour for the rolled bundle
const flagInfo = new Map();
function analyseFlag(src) {
  if (flagInfo.has(src)) return flagInfo.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight, cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 <= x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
        // main colour: median of the hoist-side panel (the left part of the banner)
        const ch = [[], [], []];
        for (let y = Math.round(y0 + (y1 - y0) * 0.3); y < y0 + (y1 - y0) * 0.7; y += 3)
          for (let x = Math.round(x0 + (x1 - x0) * 0.15); x < x0 + (x1 - x0) * 0.45; x += 3) {
            const i = (y * w + x) * 4; if (d[i + 3] < 200) continue;
            ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]);
          }
        const med = (a) => (a.sort((m, n) => m - n)[a.length >> 1] ?? 128);
        resolve({ rect: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], main: [med(ch[0]), med(ch[1]), med(ch[2])] });
      } catch { resolve({ rect: null, main: [140, 40, 40] }); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  flagInfo.set(src, p);
  return p;
}
const rgb = ([r, g, b], k = 1, add = 0) => (Math.min(255, Math.max(0, Math.round(r * k + add))) << 16)
  | (Math.min(255, Math.max(0, Math.round(g * k + add))) << 8) | Math.min(255, Math.max(0, Math.round(b * k + add)));

function unitArt(token) {
  return token.document?.texture?.src || token.actor?.prototypeToken?.texture?.src || token.actor?.img;
}
function officerArt(actor) {
  let o = null;
  try { o = actor.system.officerActor; } catch { /* none */ }
  return o ? (o.prototypeToken?.texture?.src || o.img) : null;
}

function clear(token) {
  const c = token[KEY];
  if (token.qinFall && !token.qinFall.destroyed) token.qinFall.destroy({ children: true });
  token.qinFall = null;
  if (c?.qinTick) canvas.app?.ticker?.remove(c.qinTick);
  if (c && !c.destroyed) c.destroy({ children: true });
  token[KEY] = null;
  if (token.mesh && !token.mesh.destroyed) token.mesh.renderable = true;
}

/* ------------------------------------------------------------ drawing */

function circleFigure(tex, size, cropRing) {
  const g = new PIXI.Container();
  const r = size / 2;
  const sh = new PIXI.Graphics();
  sh.beginFill(0x000000, 0.35).drawEllipse(r * 0.06, r * 0.12, r, r).endFill();
  g.addChild(sh);
  if (tex) {
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    const full = cropRing ? size / (1 - 2 * L.ringCrop) : size;
    s.width = full; s.height = full;
    const m = new PIXI.Graphics().beginFill(0xffffff).drawCircle(0, 0, r).endFill();
    g.addChild(s, m);
    s.mask = m;
  }
  if (cropRing) g.addChild(new PIXI.Graphics().lineStyle(Math.max(1.5, size / 28), 0x281e14, 1).drawCircle(0, 0, r - size / 56));
  return g;
}

/** The banner: rolled into a bundle, or unrolled by `t` (0..1) from its hoist edge, rightwards. */
function buildFlag(tex, info, T) {
  const box = new PIXI.Container();
  const fh = T * L.flagH;
  const rect = info?.rect;
  const ftex = rect ? new PIXI.Texture(tex.baseTexture ?? tex.source ?? tex, new PIXI.Rectangle(...rect)) : tex;
  const fw = fh * (rect ? rect[2] / rect[3] : 1);
  const sprite = new PIXI.Sprite(ftex);
  sprite.width = fw; sprite.height = fh;
  const mask = new PIXI.Graphics();
  sprite.mask = mask;
  const roll = new PIXI.Graphics();
  box.addChild(sprite, mask, roll);
  const main = info?.main ?? [140, 40, 40];
  const col = rgb(main), dark = rgb(main, 0.55), light = rgb(main, 1.25, 20);
  const tw = T * L.rollW;
  box.qinSet = (t) => {
    t = Math.max(0, Math.min(1, t));
    const vis = fw * t;
    mask.clear();
    if (vis > 0.5) mask.beginFill(0xffffff).drawRect(0, 0, vis, fh).endFill();
    sprite.visible = vis > 0.5;
    roll.clear();
    if (t >= 1) return;
    // the still-rolled part: a cloth bundle at the free edge (shrinks as it unrolls)
    const w = t > 0 ? tw * 0.7 : tw, h = fh * 0.95, x = t > 0 ? vis - w * 0.4 : 0;
    roll.lineStyle(1, dark, 1).beginFill(col, 1).drawRoundedRect(x, 0, w, h, w / 2).endFill();
    roll.lineStyle(1, light, 0.8).moveTo(x + w * 0.3, w * 0.4).lineTo(x + w * 0.3, h - w * 0.4);
    roll.lineStyle(1, dark, 0.9);
    for (let k = 1; k < 5; k++) { const y = (h * k) / 5; roll.moveTo(x + 1, y + w * 0.35).lineTo(x + w - 1, y - w * 0.35); }
  };
  box.qinSet(0);
  box.position.set(T * L.flagX, T * L.flagY);
  return box;
}

const gen = new WeakMap();

export async function drawUnitBars(token) {
  const actor = token?.actor;
  if (!actor || actor.type !== "unit" || token.destroyed) return clear(token);
  const s = actor.system;
  const men = s.men?.value ?? 0, max = s.men?.max || 100, morale = s.morale ?? 0;
  const w = token.w, h = token.h, T = Math.min(w, h);
  const acted = hasActed(token), active = !acted && isActive(token), holding = isHolding(token);
  const art = unitArt(token), off = officerArt(actor), fac = factionOf(s.faction);
  const n = figureCount(men, max);
  if (token.mesh && !token.mesh.destroyed) token.mesh.renderable = false; // the stand replaces the picture
  const key = JSON.stringify([men, max, morale, w, h, s.side, acted, active, holding, n, art, off, fac?.img ?? null]);
  let c = token[KEY];
  if (c && !c.destroyed && c.parent === token && c.qinKey === key) return;
  const my = (gen.get(token) ?? 0) + 1;
  gen.set(token, my);

  const [figTex, offTex, flagTex, info] = await Promise.all([loadTex(art), loadTex(off), loadTex(fac?.img), fac?.img ? analyseFlag(fac.img) : null]);
  if (gen.get(token) !== my || token.destroyed) return; // a newer draw started meanwhile

  c = token[KEY];
  if (!c || c.destroyed || c.parent !== token) {
    if (c && !c.destroyed) c.destroy({ children: true });
    c = token[KEY] = new PIXI.Container();
    c.eventMode = "none";
    token.addChild(c);
  }
  c.qinKey = key;
  if (c.qinTick) { canvas.app?.ticker?.remove(c.qinTick); c.qinTick = null; }
  const prevN = c.qinFigN;
  let fall = token.qinFall;                       // soldiers still falling survive the redraw
  if (fall && !fall.destroyed && fall.parent === c) c.removeChild(fall);
  for (const ch of c.removeChildren()) ch.destroy({ children: true });
  const stand = new PIXI.Container();
  c.addChild(stand);

  // base in the side colour
  const color = SIDE_COLORS[s.side] ?? 0x888888, pad = T * L.pad;
  stand.addChild(new PIXI.Graphics().lineStyle(Math.max(2, T * 0.03), color, 1).beginFill(color, 0.27)
    .drawRoundedRect(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1).endFill());

  // soldiers
  const fd = T * L.fig;
  for (const [fx, fy] of figureSlots(n)) {
    const f = circleFigure(figTex, fd, true);
    f.position.set(fx * w, fy * h);
    stand.addChild(f);
  }
  // soldiers lost since the last draw topple over and fade (slot 1 first)
  if (prevN !== undefined && n < prevN) {
    if (!fall || fall.destroyed) { fall = token.qinFall = new PIXI.Container(); fall.eventMode = "none"; }
    let i = 0;
    for (let k = 6 - prevN; k <= 5 - n; k++, i++) {
      const [fx, fy] = SLOTS[k];
      const f = circleFigure(figTex, fd, true);
      fall.addChild(f);
      topple(f, fx * w, fy * h, fd, 650 + i * 160, fx < 0.5 ? -1 : 1);
    }
  }
  c.qinFigN = n;
  // officer medallion (their own token art, frame and all)
  if (offTex) {
    const od = T * L.officer, o = circleFigure(offTex, od, false);
    o.position.set(T * 0.015 + od / 2, T * 0.015 + od / 2);
    stand.addChild(o);
  }
  // faction banner, rolled up; unrolls while hovered
  if (flagTex) {
    const flag = buildFlag(flagTex, info, T);
    flag.position.x = w - T * (1 - L.flagX);
    c.qinFlag = flag;
    stand.addChild(flag);
    if (token.hover) animateFlag(token, 1, 0);
  } else c.qinFlag = null;

  // health / morale bars along the bottom, inside the tile
  const bh = Math.max(9, Math.round(T * L.bar)), tabW = Math.max(4, Math.round(bh * 0.45));
  const barX = pad + tabW + 1, barW = w - barX - pad, top = h - pad - 2 * (bh + 1) + 1;
  const bars = new PIXI.Container(); // kept apart from the stand so it never greys out
  const g = new PIXI.Graphics();
  bars.addChild(g);
  g.lineStyle(1, 0x000000, 0.9).beginFill(color, 1).drawRoundedRect(pad, top, tabW, 2 * (bh + 1) - 1, 2).endFill();
  const Txt = textClass();
  const styleOpts = { fontFamily: "Signika, sans-serif", fontSize: Math.round(bh * 0.85), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: Math.max(2, Math.round(bh * 0.25)) };
  const style = new PIXI.TextStyle(styleOpts);
  [[Math.max(0, Math.min(1, men / max)), healthColor(men / max), `${men} / ${max}`],
   [Math.max(0, Math.min(1, morale / 100)), moraleColor(morale), `Morale ${morale}`]].forEach(([pct, col, label], i) => {
    const y = top + i * (bh + 1);
    g.lineStyle(1, 0x000000, 0.9).beginFill(0x111111, 0.8).drawRoundedRect(barX, y, barW, bh, 2).endFill();
    if (pct > 0) g.lineStyle(0).beginFill(col, 0.95).drawRoundedRect(barX + 1, y + 1, Math.max(2, (barW - 2) * pct), bh - 2, 2).endFill();
    const t = new Txt(label, style);
    t.anchor?.set?.(0.5, 0.5);
    t.position.set(barX + barW / 2, y + bh / 2);
    if (t.width > barW - 2) t.scale.set((barW - 2) / t.width);
    bars.addChild(t);
  });
  c.addChild(bars);

  // already acted this round: grey it out and say so
  if (acted) {
    const CMF = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    if (CMF) { const f = new CMF(); f.desaturate(); f.brightness(0.75, true); stand.filters = [f]; }
    // the side colour stays: the outline is drawn on top, un-greyed (bars are never greyed)
    c.addChild(new PIXI.Graphics().lineStyle(Math.max(2, T * 0.03), color, 1).drawRoundedRect(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1));
    const t = new Txt(holding ? "Hold" : "Done", new PIXI.TextStyle({ ...styleOpts, fontSize: Math.round(bh * 1.1), fill: "#dddddd" }));
    t.anchor?.set?.(0.5, 0.5);
    c.addChild(t);
    if (holding) { // small shield beside "Hold"
      const sw = T * 0.15, sh = T * 0.18, gapX = T * 0.025, total = sw + gapX + t.width;
      const icon = drawShield(sw, sh);
      icon.position.set(w / 2 - total / 2 + sw / 2, top / 2);
      t.position.set(w / 2 - total / 2 + sw + gapX + t.width / 2, top / 2);
      c.addChild(icon);
    } else t.position.set(w / 2, top / 2);
  }

  // holding this round: a shield badge on the top edge showing the -2 attackers suffer
  if (holding) {
    const bw = T * 0.22, bhh = T * 0.25;
    const badge = drawShield(bw, bhh);
    badge.position.set(w / 2, T * 0.135);
    const lbl = new Txt("-2", new PIXI.TextStyle({ ...styleOpts, fontSize: Math.round(bhh * 0.42), strokeThickness: Math.max(2, Math.round(bhh * 0.08)) }));
    lbl.anchor?.set?.(0.5, 0.5);
    lbl.position.set(w / 2, T * 0.135 + bhh * 0.02);
    c.addChild(badge, lbl);
  }

  if (fall && !fall.destroyed) c.addChildAt(fall, c.getChildIndex(stand) + 1);

  // this unit's turn: pulsing gold glow behind, gold border, and a bobbing arrow above
  if (active) {
    const gold = 0xffd34d;
    const glow = new PIXI.Graphics().lineStyle(T * 0.09, gold, 1).drawRoundedRect(pad - T * 0.05, pad - T * 0.05, w - 2 * pad + T * 0.1, h - 2 * pad + T * 0.1, T * 0.14);
    const Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;
    if (Blur) glow.filters = [new Blur(T * 0.05)];
    c.addChildAt(glow, 0);
    c.addChild(new PIXI.Graphics().lineStyle(Math.max(2, T * 0.035), gold, 1).drawRoundedRect(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1));
    const arrow = new PIXI.Graphics().lineStyle(Math.max(1, T * 0.012), 0x281a0a, 1).beginFill(gold, 1)
      .drawPolygon([-T * 0.12, -T * 0.17, T * 0.12, -T * 0.17, 0, 0]).endFill();
    c.addChild(arrow);
    let time = 0;
    c.qinTick = () => {
      time += canvas.app.ticker.deltaMS / 1000;
      const p = 0.5 + 0.5 * Math.sin(time * 4);
      if (glow.destroyed || arrow.destroyed) return;
      glow.alpha = 0.45 + 0.55 * p;
      arrow.position.set(w / 2, -T * 0.03 - T * 0.06 * (1 - p));
    };
    c.qinTick();
    canvas.app?.ticker?.add(c.qinTick);
  }
}

/**
 * A lost soldier: after `delay` ms (so the attack's numbers show first) it tips over sideways from its
 * feet, then slowly fades away and is removed.
 */
function topple(f, x, y, size, delay, dir) {
  const r = size / 2;
  f.pivot.set(0, r);                 // rotate around the bottom of the figure
  f.position.set(x, y + r);
  let t = -delay;
  const fallMs = 520, fadeMs = 1300;
  const tick = () => {
    t += canvas.app.ticker.deltaMS;
    if (f.destroyed) return canvas.app.ticker.remove(tick);
    if (t < 0) return;
    const k = Math.min(1, t / fallMs), e = k * k;              // accelerating fall
    f.rotation = dir * 1.35 * e;
    f.position.y = y + r + size * 0.06 * e;
    if (t > fallMs * 0.6) f.alpha = Math.max(0, 1 - (t - fallMs * 0.6) / fadeMs);
    if (f.alpha <= 0) { canvas.app.ticker.remove(tick); f.destroy({ children: true }); }
  };
  canvas.app.ticker.add(tick);
}

/* ------------------------------------------------------------ banner unrolling on hover */

function animateFlag(token, to, ms = 380) {
  const flag = token[KEY]?.qinFlag;
  if (!flag || flag.destroyed) return;
  canvas.app?.ticker?.remove(flag.qinTick ?? (() => {}));
  const from = flag.qinT ?? 0;
  if (!ms) { flag.qinT = to; return flag.qinSet(to); }
  let t = 0;
  flag.qinTick = () => {
    t += canvas.app.ticker.deltaMS;
    const k = Math.min(1, t / (ms * Math.abs(to - from) || 1));
    const e = 1 - (1 - k) ** 3;
    flag.qinT = from + (to - from) * e;
    if (!flag.destroyed) flag.qinSet(flag.qinT);
    if (k >= 1 || flag.destroyed) canvas.app.ticker.remove(flag.qinTick);
  };
  canvas.app.ticker.add(flag.qinTick);
}

/** Redraw every unit token (e.g. when the battle round or turn changes). */
export function redrawAllUnitBars() {
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.type === "unit") drawUnitBars(t);
}

export function registerUnitBars() {
  Hooks.on("drawToken", drawUnitBars);
  Hooks.on("refreshToken", drawUnitBars);
  Hooks.on("destroyToken", clear);
  Hooks.on("hoverToken", (token, hovered) => { if (token.actor?.type === "unit") animateFlag(token, hovered ? 1 : 0); });
  // health, morale, officer or faction changes on the actor redraw its tokens
  Hooks.on("updateActor", (actor) => {
    if (actor.type === "unit") for (const t of actor.getActiveTokens?.(true) ?? []) drawUnitBars(t);
    // an officer's portrait changed: redraw the units they lead
    if (actor.type === "character") for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.system?.officer === actor.uuid) drawUnitBars(t);
  });
}
