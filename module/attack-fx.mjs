// Attack targeting (click a hex in reach) and attack animations.
// Animations use Sequencer + JB2A when both modules are active, otherwise built-in PIXI effects
// that are broadcast to every client over the system socket.
import { SYSTEM_ID } from "./config.mjs";

const SOCKET = `system.${SYSTEM_ID}`;

/* ---------------------------------------- Weapon → animation style */

const KIND_BY_SKILL = {
  qiangshu: "thrust", daoshu: "stab", jianshu: "slash", bangshu: "blunt", chuishu: "blunt",
  dunshu: "blunt", improvisation: "blunt", handToHand: "punch",
  gongshu: "arrow", nushu: "bolt", throwing: "thrown",
};

export function fxKind(weapon) {
  const k = KIND_BY_SKILL[weapon?.system?.skill];
  if (k) return k;
  return weapon?.system?.isRanged ? "arrow" : "slash";
}

/**
 * Sequencer database paths to try, checked against the free JB2A_DnD5e database
 * (github.com/Jules-Bens-Aa/JB2A_DnD5e). Per-skill picks come first, then per-style fallbacks.
 */
const JB2A_BY_SKILL = {
  qiangshu: ["jb2a.spear.melee.01.white", "jb2a.glaive.melee.01", "jb2a.halberd.melee.01"],
  daoshu: ["jb2a.dagger.melee.02.white", "jb2a.shortsword.melee.01"],
  jianshu: ["jb2a.sword.melee.01.white", "jb2a.shortsword.melee.01", "jb2a.rapier.melee.01"],
  bangshu: ["jb2a.quarterstaff.melee.01.white", "jb2a.club.melee.01.white"],
  chuishu: ["jb2a.mace.melee.01.white", "jb2a.warhammer.melee.01", "jb2a.hammer.melee.01"],
  dunshu: ["jb2a.melee_attack.06.shield.01"],
  improvisation: ["jb2a.club.melee.01.white", "jb2a.melee_attack.02.club"],
  handToHand: ["jb2a.unarmed_strike.physical.01.blue", "jb2a.flurry_of_blows.physical"],
  gongshu: ["jb2a.arrow.physical.white.01", "jb2a.arrow.physical.blue"],
  nushu: ["jb2a.bolt.physical.orange", "jb2a.arrow.physical.white.01"],
  throwing: ["jb2a.dagger.throw.01.white"],
};
const JB2A_PATHS = {
  thrust: ["jb2a.spear.melee.01.white", "jb2a.glaive.melee.01"],
  stab: ["jb2a.dagger.melee.02.white", "jb2a.shortsword.melee.01"],
  slash: ["jb2a.sword.melee.01.white", "jb2a.melee_generic.slash.01"],
  blunt: ["jb2a.club.melee.01.white", "jb2a.mace.melee.01.white"],
  punch: ["jb2a.unarmed_strike.physical.01.blue"],
  arrow: ["jb2a.arrow.physical.white.01"],
  bolt: ["jb2a.bolt.physical.orange"],
  thrown: ["jb2a.dagger.throw.01.white"],
  impact: ["jb2a.impact.005.orange", "jb2a.impact.008.orange", "jb2a.impact.001.blue"],
};
const RANGED_KINDS = new Set(["arrow", "bolt", "thrown"]);

function sequencerReady() {
  return !!(game.modules.get("sequencer")?.active && globalThis.Sequence && globalThis.Sequencer?.Database);
}
function dbHas(path) {
  if (!path) return false;
  try {
    if (Sequencer.Database.entryExists(path)) return true;
    return !!Sequencer.Database.getPathsUnder?.(path)?.length;
  } catch { return false; }
}
function firstPath(list) { return list.find(dbHas) ?? null; }

/* ---------------------------------------- Targeting */

function fxLayer() { return canvas.interface ?? canvas.controls ?? canvas.stage; }

function toWorld(clientX, clientY) {
  if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
  const r = canvas.app.view.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({ x: clientX - r.left, y: clientY - r.top });
}

function measure(a, b) {
  const gridDist = canvas.grid.distance || 1;
  const r = canvas.grid.measurePath([a, b]);
  const yards = r.distance ?? 0;
  const spaces = Number.isFinite(r.spaces) && canvas.grid.type ? r.spaces : Math.round(yards / gridDist);
  return { yards, spaces };
}

function cellAt(point) {
  if (!canvas.grid.type) return { offset: null, center: { x: point.x, y: point.y } }; // gridless
  const offset = canvas.grid.getOffset(point);
  return { offset, center: canvas.grid.getCenterPoint(offset) };
}

function drawCell(g, offset, color, alpha, lineAlpha = 0.9) {
  if (!offset) return;
  const pts = canvas.grid.getVertices(offset);
  if (!pts?.length) return;
  g.lineStyle(2, color, lineAlpha);
  g.beginFill(color, alpha);
  g.drawPolygon(pts.flatMap(p => [p.x, p.y]));
  g.endFill();
}

function tokenAt(point, except) {
  return canvas.tokens.placeables.find(t => t !== except && t.visible !== false && t.bounds?.contains(point.x, point.y)) ?? null;
}

/** Range band for a ranged weapon at a distance in yards (null = out of range). */
export function rangeBand(weapon, yards) {
  const r = weapon.system.range;
  if (yards <= r.c) return { label: "short", st: -1 };
  if (yards <= r.m) return { label: "medium", st: 0 };
  if (yards <= r.l) return { label: "long", st: 1 };
  if (yards <= r.e) return { label: "extreme", st: 3 };
  return null;
}

/**
 * Let the user click a hex within the weapon's reach. Resolves to
 * { point, token, yards, spaces, band } or null if cancelled (right-click / Esc).
 */
export function pickAttackTarget(token, weapon) {
  const ranged = weapon.system.isRanged;
  const gridDist = canvas.grid.distance || 1;
  const maxYards = ranged ? weapon.system.range.e : gridDist; // close combat: the next hex
  const maxSpaces = ranged ? Math.max(1, Math.floor(maxYards / gridDist)) : 1;
  const origin = token.center;

  return new Promise(resolve => {
    const area = new PIXI.Graphics();
    const hover = new PIXI.Graphics();
    const layer = fxLayer();
    layer.addChild(area, hover);

    // Reach: every hex for short reaches, a circle for long bow ranges
    const originCell = cellAt(origin);
    if (originCell.offset && maxSpaces <= 12) {
      const { i, j } = originCell.offset;
      for (let di = -maxSpaces - 1; di <= maxSpaces + 1; di++) {
        for (let dj = -maxSpaces - 1; dj <= maxSpaces + 1; dj++) {
          const off = { i: i + di, j: j + dj };
          const c = canvas.grid.getCenterPoint(off);
          const { spaces } = measure(origin, c);
          if (spaces >= 1 && spaces <= maxSpaces && !token.bounds?.contains(c.x, c.y)) drawCell(area, off, 0xd4a017, 0.18, 0.5);
        }
      }
    } else {
      area.lineStyle(3, 0xd4a017, 0.8).beginFill(0xd4a017, 0.06).drawCircle(origin.x, origin.y, (maxYards / gridDist) * canvas.grid.size).endFill();
    }

    const banner = document.createElement("div");
    banner.className = "qin qin-target-banner";
    banner.innerHTML = `<b>${foundry.utils.escapeHTML?.(weapon.name) ?? weapon.name}</b>: click a hex ${ranged ? `within ${maxYards} yd` : "next to you"} to attack · right-click or Esc to cancel`;
    document.body.append(banner);

    const view = canvas.app.view;
    const valid = (pt) => {
      const { spaces, yards } = measure(origin, pt);
      if (token.bounds?.contains(pt.x, pt.y)) return null;
      if (spaces < 1 || spaces > maxSpaces) return null;
      if (ranged && yards > maxYards) return null;
      return { spaces, yards };
    };

    const onMove = (ev) => {
      if (ev.target !== view) return;
      const { offset, center } = cellAt(toWorld(ev.clientX, ev.clientY));
      hover.clear();
      const ok = valid(center);
      if (offset) drawCell(hover, offset, ok ? 0x3fbf5f : 0xc0392b, 0.3);
      else hover.lineStyle(2, ok ? 0x3fbf5f : 0xc0392b, 0.9).drawCircle(center.x, center.y, canvas.grid.size / 2);
    };
    const finish = (result) => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      view.removeEventListener("contextmenu", block, true);
      area.destroy(); hover.destroy(); banner.remove();
      resolve(result);
    };
    const onDown = (ev) => {
      if (ev.target !== view) return;
      ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.button === 2) return finish(null);
      if (ev.button !== 0) return;
      const { center } = cellAt(toWorld(ev.clientX, ev.clientY));
      const ok = valid(center);
      if (!ok) return ui.notifications.warn("That hex is out of reach.");
      const target = tokenAt(center, token);
      finish({ point: center, token: target, ...ok, band: ranged ? rangeBand(weapon, ok.yards) : null });
    };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(null); } };
    const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("keydown", onKey, true);
    view.addEventListener("contextmenu", block, true);
  });
}

/* ---------------------------------------- Playing the animation */

/** The attacker's token on the current scene. */
export function attackerToken(actor) {
  if (!canvas?.ready) return null;
  if (actor.token?.object && actor.token.parent?.id === canvas.scene?.id) return actor.token.object;
  const controlled = canvas.tokens.controlled.find(t => t.actor === actor);
  return controlled ?? actor.getActiveTokens?.(true)?.[0] ?? null;
}

/**
 * Play an attack animation for everyone.
 * @param {object} o  { source: Token, target?: Token, point?: {x,y}, weapon: Item, hit: boolean }
 */
export async function playAttackFx({ source, target, point, weapon, hit }) {
  const mode = game.settings.get(SYSTEM_ID, "attackAnimations");
  if (mode === "off" || !source || !canvas?.ready) return;
  const to = target?.center ?? point;
  if (!to) return;
  const kind = fxKind(weapon);
  if (mode !== "builtin" && sequencerReady()) {
    try { if (await playSequencer({ source, target, to, weapon, kind, hit })) return; }
    catch (e) { console.warn("Qin | Sequencer animation failed, using the built-in one", e); }
  }
  const data = { type: "fx", sceneId: canvas.scene.id, kind, from: { x: source.center.x, y: source.center.y }, to: { x: to.x, y: to.y }, hit };
  game.socket?.emit(SOCKET, data);
  playBuiltIn(data);
}

async function playSequencer({ source, target, to, weapon, kind, hit }) {
  const custom = weapon.system.animation?.trim();
  const path = (custom && dbHas(custom) ? custom : null)
    ?? firstPath(JB2A_BY_SKILL[weapon.system.skill] ?? []) ?? firstPath(JB2A_PATHS[kind] ?? []);
  if (!path) return false;
  const seq = new Sequence();
  const fx = seq.effect().file(path).atLocation(source).stretchTo(target ?? to);
  if (!hit && target) fx.missed();
  if (RANGED_KINDS.has(kind) && hit) {
    fx.waitUntilFinished(-500);
    const impact = firstPath(JB2A_PATHS.impact);
    if (impact) seq.effect().file(impact).atLocation(target ?? to).scale(0.5);
  }
  await seq.play();
  if (!hit) missText(to);
  return true;
}

function missText(to) {
  try {
    canvas.interface?.createScrollingText?.(to, "Miss", { anchor: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1, fontSize: 28, fill: "#dddddd", stroke: 0x000000, strokeThickness: 4, jitter: 0.25 });
  } catch { /* cosmetic only */ }
}

export function registerAttackFxSocket() {
  game.socket?.on(SOCKET, (data) => {
    if (data?.type === "fx") playBuiltIn(data);
  });
}

/* ---------------------------------------- Built-in effects (PIXI) */

const ease = { out: t => 1 - (1 - t) ** 3, inOut: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

/** Runs draw(g, t) every frame for `ms`, then cleans up. */
function animate(ms, draw) {
  return new Promise(resolve => {
    const g = new PIXI.Graphics();
    fxLayer().addChild(g);
    let elapsed = 0;
    const tick = () => {
      elapsed += canvas.app.ticker.deltaMS;
      const t = clamp01(elapsed / ms);
      g.clear();
      try { draw(g, t); } catch (e) { console.warn(e); }
      if (t >= 1) { canvas.app.ticker.remove(tick); g.destroy(); resolve(); }
    };
    canvas.app.ticker.add(tick);
  });
}

export function playBuiltIn({ sceneId, kind, from, to, hit }) {
  if (!canvas?.ready || (sceneId && canvas.scene?.id !== sceneId)) return;
  const size = canvas.grid.size;
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;   // direction
  const px = -uy, py = ux;                // perpendicular
  const angle = Math.atan2(dy, dx);
  const impact = () => (hit ? burst(to, size) : missText(to));

  switch (kind) {
    case "thrust": case "stab": {
      const shaft = kind === "thrust" ? size * 1.2 : size * 0.45;
      const ms = kind === "thrust" ? 650 : 420;
      let struck = false;
      return animate(ms, (g, t) => {
        // lunge forward fast, hold, pull back
        const fwd = t < 0.35 ? ease.out(seg(t, 0, 0.35)) : 1 - ease.inOut(seg(t, 0.55, 1)) * 0.8;
        if (t >= 0.35 && !struck) { struck = true; impact(); }
        const startTip = size * 0.35, endTip = dist - size * 0.15;
        const tipD = startTip + (endTip - startTip) * fwd;
        const tip = { x: from.x + ux * tipD, y: from.y + uy * tipD };
        const butt = { x: tip.x - ux * shaft, y: tip.y - uy * shaft };
        const alpha = 1 - seg(t, 0.75, 1);
        // motion streak
        if (t < 0.45) g.lineStyle(size * 0.12, 0xffffff, 0.25 * (1 - seg(t, 0.2, 0.45))).moveTo(from.x + ux * startTip, from.y + uy * startTip).lineTo(tip.x, tip.y);
        // shaft
        g.lineStyle(Math.max(3, size * 0.05), kind === "thrust" ? 0x7a4e2a : 0x555555, alpha).moveTo(butt.x, butt.y).lineTo(tip.x - ux * size * 0.12, tip.y - uy * size * 0.12);
        // blade / spearhead
        const w = size * (kind === "thrust" ? 0.09 : 0.06), l = size * (kind === "thrust" ? 0.28 : 0.24);
        const base = { x: tip.x - ux * l, y: tip.y - uy * l };
        g.lineStyle(1, 0x2b2b2b, alpha).beginFill(0xdfe6ee, alpha)
          .drawPolygon([tip.x, tip.y, base.x + px * w, base.y + py * w, base.x - px * w, base.y - py * w]).endFill();
      });
    }
    case "slash": case "blunt": {
      const ms = kind === "slash" ? 520 : 600;
      const r = size * (kind === "slash" ? 0.7 : 0.6);
      const c = { x: to.x - ux * size * 0.35, y: to.y - uy * size * 0.35 };
      const a0 = angle - 1.2, a1 = angle + 1.2;
      let struck = false;
      return animate(ms, (g, t) => {
        const sweep = ease.out(seg(t, 0, 0.5));
        if (t >= 0.3 && !struck) { struck = true; impact(); }
        const fade = 1 - seg(t, 0.5, 1);
        const head = a0 + (a1 - a0) * sweep;
        const steps = 16;
        for (let s = 0; s < steps; s++) {
          const f0 = s / steps, f1 = (s + 1) / steps;
          const b0 = a0 + (head - a0) * f0, b1 = a0 + (head - a0) * f1;
          const thick = size * (kind === "slash" ? 0.02 + 0.09 * f1 : 0.05 + 0.1 * f1);
          g.lineStyle(thick, kind === "slash" ? 0xeaf4ff : 0xf0d9a0, fade * (0.15 + 0.85 * f1));
          g.moveTo(c.x + Math.cos(b0) * r, c.y + Math.sin(b0) * r).lineTo(c.x + Math.cos(b1) * r, c.y + Math.sin(b1) * r);
        }
        if (kind === "blunt" && t > 0.3) {
          const k = seg(t, 0.3, 1);
          g.lineStyle(size * 0.05, 0xf0d9a0, 1 - k).drawCircle(to.x, to.y, size * (0.15 + 0.4 * k));
        }
      });
    }
    case "punch": {
      let n = 0;
      return animate(500, (g, t) => {
        const jabs = [0, 0.45];
        jabs.forEach((s, idx) => {
          const k = seg(t, s, s + 0.4);
          if (k <= 0 || k >= 1) return;
          if (k > 0.3 && n <= idx) { n = idx + 1; if (idx === 0) impact(); }
          const off = (idx ? -1 : 1) * size * 0.12;
          const p = { x: to.x - ux * size * 0.25 * (1 - k) + px * off, y: to.y - uy * size * 0.25 * (1 - k) + py * off };
          g.lineStyle(3, 0xffffff, 1 - k).beginFill(0xffe0b0, 0.6 * (1 - k)).drawCircle(p.x, p.y, size * (0.08 + 0.12 * k)).endFill();
        });
      });
    }
    default: { // arrow, bolt, thrown
      const ms = Math.min(900, Math.max(280, dist * 0.9));
      const len = size * (kind === "bolt" ? 0.3 : kind === "thrown" ? 0.6 : 0.45);
      const endD = target0(dist, size);
      return animate(ms, (g, t) => {
        const k = kind === "thrown" ? ease.out(t) : t;
        const d = size * 0.3 + (endD - size * 0.3) * k;
        const tip = { x: from.x + ux * d, y: from.y + uy * d };
        const tail = { x: tip.x - ux * len, y: tip.y - uy * len };
        g.lineStyle(size * 0.06, 0xffffff, 0.18).moveTo(tail.x - ux * len, tail.y - uy * len).lineTo(tip.x, tip.y); // trail
        g.lineStyle(Math.max(2, size * 0.03), 0x6b4423, 1).moveTo(tail.x, tail.y).lineTo(tip.x, tip.y);
        const w = size * 0.05, h = size * 0.1;
        const b = { x: tip.x - ux * h, y: tip.y - uy * h };
        g.lineStyle(0).beginFill(0xcfd6dd, 1).drawPolygon([tip.x, tip.y, b.x + px * w, b.y + py * w, b.x - px * w, b.y - py * w]).endFill();
        if (kind !== "thrown") {
          g.lineStyle(2, 0xf5f5f5, 0.9)
            .moveTo(tail.x, tail.y).lineTo(tail.x - ux * w * 1.5 + px * w * 1.2, tail.y - uy * w * 1.5 + py * w * 1.2)
            .moveTo(tail.x, tail.y).lineTo(tail.x - ux * w * 1.5 - px * w * 1.2, tail.y - uy * w * 1.5 - py * w * 1.2);
        }
      }).then(impact);
    }
  }
}

function target0(dist, size) { return Math.max(size * 0.4, dist - size * 0.2); }

/** Hit flash: a ring and radiating sparks. */
function burst(at, size) {
  const rays = Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2 + Math.random() * 0.4);
  return animate(380, (g, t) => {
    const k = ease.out(t), a = 1 - t;
    g.lineStyle(0).beginFill(0xffd27a, 0.45 * a).drawCircle(at.x, at.y, size * (0.12 + 0.25 * k)).endFill();
    g.lineStyle(size * 0.03, 0xff6b3d, a).drawCircle(at.x, at.y, size * (0.15 + 0.35 * k));
    g.lineStyle(Math.max(2, size * 0.025), 0xfff1c1, a);
    for (const r of rays) {
      const r0 = size * (0.1 + 0.3 * k), r1 = size * (0.2 + 0.45 * k);
      g.moveTo(at.x + Math.cos(r) * r0, at.y + Math.sin(r) * r0).lineTo(at.x + Math.cos(r) * r1, at.y + Math.sin(r) * r1);
    }
  });
}
