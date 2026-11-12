// Special animations for tier 1+ battlefield actives (David, 2026-11-09): each such officer can have his own. They are
// keyed by the active's name. So far: Guan Yu's Might That Shakes the Realm — the ground cracks around his unit as the
// buff lands, then heaves twice more, the cracks tearing on further out and a tall wall of dust rising, and while it lasts the Green Dragon Crescent Blade sweeps a full circle after each of his attacks.
// Lu Bu's None Can Stand Before Him — tall flames roar up from him as a wave of fire rolls out leaving trails of fire, and while it lasts the Sky Piercer drives
// through each target as its shield shatters; his Terror of the Battlefield — a dread pulse at the end of his turn
// (who flinched, who resisted) and ANOTHER TURN when a rout earns him one.
// Zhuge Liang's Stone Sentinel Maze — the Eight Trigrams formation draws itself beneath him, then a carved stone slab
// rises over each unit he picked: "Held" ones stand and fade, a unit that won its roll sees its stone crack and fall.
// Zhang Fei's Terror of Changban — he draws breath and roars: the screen shakes, diamond shockwaves roll out to the
// edge of his 5-square reach, and each unit it reaches flinches as a spiked ring locks round it ("Can't move").
// Cao Cao's The Hero Commands — his hanging banner is raised in the middle of his stand, then a wave of small flags and
// banners springs up over his 4-square reach, and each allied unit it reaches lights up in a column of gold as its buff lands.
// Liu Bei's Until the Day of Death Comes (was Restore the Han) — a blossoming tree grows on the square to his left and arches over him, its shadow falls
// across his unit, a peach garden of grass and flowers spreads ring by ring over his 4-square reach, and petals drop
// from the blossoms; each ally it reaches lights up in a column of pink as its buff lands. The tree is private art:
// modules/qin-3k-characters/art/fx/peach-tree.webp (without it the garden still plays).
import { atSpeed } from "./battle-speed.mjs";
import { overLayer, floatLocal } from "../attack-fx.mjs";
import { playMoment } from "../sound.mjs";

import { factionOf } from "../factions.mjs";
import { analyseFlag, releaseUnits } from "../unit-bars.mjs";

const rnd = (a, b) => a + Math.random() * (b - a);
const Blur = () => PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;

/** A container above the tokens and their unit stands (the interface group, sorted over the token layer). */
let topRoot = null;
function topLayer() {
  const ui = canvas.interface;
  if (!ui) return overLayer();
  if (!topRoot || topRoot.destroyed || topRoot.parent !== ui) {
    topRoot = new PIXI.Container();
    // above the token layer (200) and controls (1000), under the floating text (1100) so "Held" reads over the slab
    Object.assign(topRoot, { zIndex: 1050, sort: 1050, eventMode: "none" });
    ui.addChild(topRoot);
  }
  ui.sortDirty = true;
  return topRoot;
}

/** Run draw(dt seconds, elapsed seconds) every frame until it returns false. */
let running = 0;
/** Is a special animation still playing? (the animation recorder waits for it) */
export const uniqueFxBusy = () => running > 0;
function run(step) {
  running++;
  return new Promise(resolve => {
    let t = 0;
    const tick = () => {
      const dt = canvas.app.ticker.deltaMS / 1000 * (atSpeed(1000) ? 1000 / atSpeed(1000) : 1);
      t += dt;
      let more = false;
      try { more = step(dt, t); } catch (e) { console.warn("Qin | special animation", e); }
      if (!more) { canvas.app.ticker.remove(tick); running--; resolve(); }
    };
    canvas.app.ticker.add(tick);
  });
}

/** A layer on the map under the tokens (for marks on the ground). */
function groundLayer() {
  const c = new PIXI.Container();
  Object.assign(c, { elevation: 0, sortLayer: 650, sort: -1e6, zIndex: -1e6, eventMode: "none" });
  const primary = canvas.primary;
  (primary ?? canvas.stage).addChild(c);
  if (primary) primary.sortDirty = true;
  return c;
}

/* ------------------------------------------------------------ ground crack (on activation) */

/** The ground splits in three heaves (David, 2026-11-11). First all at once around the unit — evenly long cracks,
 *  dust pushed out in a ring, dust rising from the cracks and chips of earth thrown up. Then a harder heave: the cracks
 *  gape wider and tear on further out, with a bigger ring of dust. Then the hardest: they tear on further still and a
 *  tall wall of dust rises in a ring round the broken ground. Then it all fades. */
const HEAVES = [0, 0.85, 1.7];
function groundCrack(token) {
  const G = Math.min(token.w, token.h), k = G / 120, half = G / 2 - G * 0.03, B = Blur();
  const root = groundLayer(); root.position.set(token.center.x, token.center.y);
  const walk = (out, x, y, ang, len, w, depth) => {
    const pts = [[x, y]]; let a = ang, d = 0;
    while (d < len) {
      const st = rnd(6, 11) * k; a += rnd(-0.4, 0.4); a += (ang - a) * 0.25;
      x += Math.cos(a) * st; y += Math.sin(a) * st; d += st; pts.push([x, y]);
      if (depth < 2 && Math.random() < 0.16) walk(out, x, y, a + rnd(-1, 1), len * rnd(0.3, 0.45), w * 0.6, depth + 1);
    }
    out.push({ pts, w, depth });
  };
  // the cracks of each heave: the first from the edge of his stand, each later one tearing on from the ends of the last
  // one's main cracks, wider, with new cracks splitting off between them
  const heaves = [[]];
  for (let i = 0, n = 12; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.12, 0.12), r = half / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    walk(heaves[0], Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, a, rnd(92, 106) * k, rnd(3.5, 4.5) * k, 0);
  }
  for (let h = 1; h < HEAVES.length; h++) {
    const prev = heaves[h - 1].filter(q => q.depth === 0), out = []; heaves.push(out);
    for (const p of prev) { const [x, y] = p.pts[p.pts.length - 1]; walk(out, x, y, Math.atan2(y, x), rnd(110, 140) * k * (1 + 0.1 * (h - 1)), rnd(4.5, 5.6) * k * (1 + 0.15 * (h - 1)), 0); }
    const reach = Math.max(...prev.map(p => Math.hypot(...p.pts[0])));
    for (let i = 0, n = 12; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2 + rnd(-0.1, 0.1), r = reach + half * rnd(0.5, 0.8);
      walk(out, Math.cos(a) * r, Math.sin(a) * r, a, rnd(70, 100) * k, rnd(3, 4) * k, h === 1 ? 1 : 0);
    }
  }
  /** One set of cracks: the disturbed earth, the hot glow, the raised lip, the dark split (wider by `widen`). */
  const crackSet = (paths, widen = 1) => {
    const ground = new PIXI.Graphics(), dark = new PIXI.Graphics(), lip = new PIXI.Graphics(), glow = new PIXI.Graphics();
    if (B) { glow.filters = [new B(4 * k)]; ground.filters = [new B(6 * k)]; }
    for (const p of paths) for (let i = 1; i < p.pts.length; i++) {
      const tp = 1 - i / p.pts.length, [a, b] = [p.pts[i - 1], p.pts[i]], w = p.w * widen;
      ground.lineStyle(w * tp * 5 + 6 * k, 0x2a2212, 0.35).moveTo(...a).lineTo(...b);
      glow.lineStyle(w * tp * 2.4 + 2 * k, 0xffd27a, 1).moveTo(...a).lineTo(...b);
      lip.lineStyle(w * tp + 2 * k, 0x9a8a64, 0.75).moveTo(a[0] + k, a[1] + k).lineTo(b[0] + k, b[1] + k);
      dark.lineStyle(Math.max(0.8, w * tp), 0x120d07, 1).moveTo(...a).lineTo(...b);
    }
    const c = new PIXI.Container(); c.addChild(ground, glow, lip, dark); c.parts = { ground, glow, lip, dark };
    return c;
  };
  // each heave: its new cracks (revealed from the middle out) and the earlier cracks gaping wider
  const layers = [];
  heaves.forEach((paths, h) => {
    const fresh = crackSet(paths), m = new PIXI.Graphics(); if (h) fresh.mask = m;
    layers.push({ c: fresh, at: HEAVES[h], mask: h ? m : null, wide: false });
    root.addChild(fresh); if (h) root.addChild(m);
    for (let j = 0; j < h; j++) { const w = crackSet(heaves[j], 1 + 0.6 * (h - j)); w.alpha = 0; root.addChild(w); layers.push({ c: w, at: HEAVES[h], mask: null, wide: true }); }
  });
  const rings = HEAVES.map((at, h) => { const g = new PIXI.Graphics(); if (B) g.filters = [new B((10 + 4 * h) * k)]; root.addChildAt(g, 0); return { g, at, r0: half * (1 + h), grow: [1.6, 3, 4][h] ?? 4, w: [0.28, 0.4, 0.5][h] ?? 0.5, a: [0.45, 0.55, 0.6][h] ?? 0.6 }; });
  const dust = new PIXI.Container(); if (B) dust.filters = [new B(4 * k)]; root.addChild(dust);
  const puffs = [];
  const puff = (o) => { const g = new PIXI.Graphics().beginFill(o.col ?? 0xc4b08a, 1).drawCircle(0, 0, 1).endFill(); g.alpha = 0; dust.addChild(g); puffs.push({ g, ...o }); };
  heaves.forEach((paths, h) => { const mains = paths.filter(p => p.depth === 0), from = h ? Math.hypot(...mains[0].pts[0]) : half, big = 1 + 0.3 * h;
    for (let i = 0; i < 80 + 10 * h; i++) {
      const p = mains[i % mains.length], [x, y] = p.pts[Math.floor(rnd(0.15, 1) * (p.pts.length - 1))], d = Math.hypot(x, y) || 1;
      puff({ x, y, delay: HEAVES[h] + Math.max(0, d - from) / (600 * k) + rnd(0, 0.12), size: rnd(3, 6) * k * big, grow: rnd(2, 3), vx: x / d * rnd(4, 14) * k * big, vy: -rnd(10, 26) * k * big, life: rnd(1, 1.6), a0: rnd(0.25, 0.42) });
    } });
  // the third heave's wall of dust: a ring of big billows round the outer ends of the cracks, stacked so they climb
  // high like a wall, then hang and thin out
  const lastP = heaves[heaves.length - 1].filter(p => p.depth === 0), last = HEAVES[HEAVES.length - 1];
  const wallR = lastP.reduce((m, p) => m + Math.hypot(...p.pts[p.pts.length - 1]), 0) / lastP.length * 0.85;
  for (let i = 0, n = 90; i < n; i++) for (let j = 0; j < 3; j++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.03, 0.03), r = wallR * rnd(0.92, 1.08), x = Math.cos(a) * r, y = Math.sin(a) * r * 0.92;
    puff({ x, y, delay: last + 0.12 + j * 0.1 + rnd(0, 0.12), size: rnd(9, 15) * k * (1 - 0.15 * j), grow: rnd(1.8, 2.6), vx: Math.cos(a) * rnd(4, 12) * k, vy: -(45 + 45 * j + rnd(0, 30)) * k, life: rnd(1.7, 2.3), a0: rnd(0.4, 0.55) - 0.08 * j, col: Math.random() < 0.5 ? 0xc4b08a : 0xb09a74 });
  }
  const chips = [];
  HEAVES.forEach((at, h) => { for (let i = 0, n = 18 + 8 * h; i < n; i++) {
    const a = rnd(0, Math.PI * 2), r = half * rnd(1 + 0.8 * h, 1.3 + 1.6 * h), sp = 1 + 0.3 * h;
    const c = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0x3a3020 : 0x6b5a3c).drawPolygon([0, -3 * k, 3 * k, 0, k, 3 * k, -3 * k, k]).endFill();
    c.position.set(Math.cos(a) * r, Math.sin(a) * r); c.alpha = 0; c.scale.set(sp); root.addChild(c);
    chips.push({ c, t0: at, x: c.x, y: c.y, vx: Math.cos(a) * rnd(40, 110) * k * sp, vy: (Math.sin(a) * rnd(20, 60) - rnd(80, 160)) * k * sp, rot: rnd(-8, 8) });
  } });
  const FADE = last + 1.6, END = last + 2.6;
  return run((dt, t) => {
    const fade = t < FADE ? 1 : Math.max(0, 1 - (t - FADE) / 0.8);
    for (const L of layers) {
      const tt = t - L.at; if (tt < 0) { L.c.alpha = 0; continue; }
      L.c.alpha = fade * (L.wide ? Math.min(1, tt / 0.25) : 1);
      L.c.parts.glow.alpha = (L.wide ? 0.7 : 0.6) * Math.max(0, 1 - tt / 0.6);
      if (L.mask) L.mask.clear().beginFill(0xffffff).drawCircle(0, 0, half + G * 4.5 * Math.min(1, tt / 0.3)).endFill();
    }
    for (const R of rings) { const tt = t - R.at; if (tt < 0) { R.g.clear(); continue; } const rk = Math.min(1, tt / 0.7), rad = R.r0 + G * R.grow * (1 - (1 - rk) ** 2); R.g.clear().lineStyle(G * R.w * (1 - rk * 0.5), 0xb7a27c, R.a * (1 - rk)).drawEllipse(0, 0, rad, rad * 0.92); }
    for (const q of puffs) {
      const kk = (t - q.delay) / q.life;
      if (kk <= 0 || kk >= 1) { q.g.alpha = 0; continue; }
      const ez = 1 - (1 - kk) ** 2;   // they rise fast, then hang
      q.g.position.set(q.x + q.vx * ez * q.life, q.y + q.vy * ez * q.life); q.g.scale.set(q.size * (1 + (q.grow - 1) * Math.sqrt(kk)));
      q.g.alpha = q.a0 * (kk < 0.15 ? kk / 0.15 : 1 - (kk - 0.15) / 0.85);
    }
    for (const ch of chips) { const tt = t - ch.t0; if (tt < 0) continue; const kk = Math.min(tt, 0.9); ch.c.position.set(ch.x + ch.vx * kk, ch.y + ch.vy * kk + 260 * k * kk * kk); ch.c.rotation = ch.rot * kk; ch.c.alpha = Math.max(0, 1 - tt / 0.9); }
    if (t < END) return true;
    root.destroy({ children: true });
    return false;
  });
}

/* ------------------------------------------------------------ the Green Dragon Crescent Blade (sweep) */

const bladeTex = new Map();
/** The glaive, pointing right from its butt (the pivot); y+ is the cutting edge, which leads the swing. */
function glaiveTexture(G) {
  const key = Math.round(G);
  if (bladeTex.has(key)) return bladeTex.get(key);
  const S = 2, u = G * S / 140, L = Math.round(250 * u), H = Math.round(96 * u);
  const cv = document.createElement("canvas"); cv.width = L; cv.height = H; const g = cv.getContext("2d");
  const cy = H * 0.5, X = (x) => x * u, Y = (y) => cy + y * u;
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
  const gold = () => { const gg = g.createLinearGradient(0, Y(-10), 0, Y(10)); gg.addColorStop(0, "#f6dc8a"); gg.addColorStop(0.5, "#c8963c"); gg.addColorStop(1, "#7a5420"); return gg; };
  // jade butt spike, gold cap, dark wrapped shaft
  const jg = g.createLinearGradient(X(0), 0, X(16), 0); jg.addColorStop(0, "#9fe0c4"); jg.addColorStop(1, "#3f9c78");
  g.fillStyle = jg; poly([[1, 0], [16, -4], [16, 4]]); g.fill();
  g.fillStyle = gold(); poly([[15, -5], [22, -6], [24, -4], [24, 4], [22, 6], [15, 5]]); g.fill();
  const sg = g.createLinearGradient(0, Y(-4), 0, Y(4)); sg.addColorStop(0, "#6a3c2c"); sg.addColorStop(0.5, "#4a2619"); sg.addColorStop(1, "#26120b");
  g.fillStyle = sg; g.fillRect(X(24), Y(-3.6), X(108), 7.2 * u);
  g.strokeStyle = "rgba(20,8,4,.7)"; g.lineWidth = 0.9 * u;
  for (let x = 30; x < 130; x += 6.5) { g.beginPath(); g.moveTo(X(x), Y(-3.6)); g.lineTo(X(x + 4), Y(3.6)); g.stroke(); }
  // the blade: the silver edge runs straight from the guard, then curves back toward the spine at the tip
  const blade = [[146, -7], [150, 6], [160, 8], [170, 8], [173, 12], [200, 12], [214, 11], [226, 7], [236, 0], [243, -10], [248, -26],
    [242, -22], [234, -18], [226, -16], [220, -19], [214, -14], [207, -19], [200, -14], [193, -18], [186, -13], [180, -21], [174, -18], [170, -11], [158, -9]];
  const sv = g.createLinearGradient(0, Y(-12), 0, Y(28)); sv.addColorStop(0, "#c9ced1"); sv.addColorStop(0.55, "#f4f6f7"); sv.addColorStop(1, "#a7aeb3");
  g.fillStyle = sv; poly(blade); g.fill();
  g.strokeStyle = "#5d666b"; g.lineWidth = 1.2 * u; poly(blade); g.stroke();
  // the green body on the spine side, with a scale pattern
  const body = [[150, -6], [152, 3], [162, 4], [172, 4], [175, 7], [200, 7], [212, 6], [221, 2], [227, -4], [229, -10], [228, -15],
    [226, -14], [220, -16], [214, -11], [207, -16], [200, -11], [193, -15], [186, -10], [180, -18], [175, -15], [170, -9], [158, -8]];
  const gb = g.createLinearGradient(X(150), Y(-10), X(236), Y(14)); gb.addColorStop(0, "#0c4a1c"); gb.addColorStop(0.5, "#1f8a3a"); gb.addColorStop(1, "#0f5a24");
  g.fillStyle = gb; poly(body); g.fill();
  g.save(); poly(body); g.clip(); g.strokeStyle = "rgba(120,220,140,.35)"; g.lineWidth = 0.9 * u;
  for (let x = 150; x < 240; x += 6) for (let y = -22; y < 12; y += 5) { g.beginPath(); g.arc(X(x + ((y / 5) % 2 ? 3 : 0)), Y(y), 2.6 * u, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke(); }
  g.restore();
  g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 1.6 * u; g.beginPath();
  [[160, 8], [170, 8], [173, 12], [200, 12], [214, 11], [226, 7], [236, 0], [243, -10], [248, -26]].forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke();
  // gold guard with prongs sweeping back
  g.fillStyle = gold(); g.strokeStyle = "#5a3c14"; g.lineWidth = 0.8 * u;
  poly([[128, -4], [136, -9], [134, -16], [142, -11], [150, -14], [156, -8], [156, 8], [150, 14], [142, 11], [134, 18], [136, 9], [128, 4]]); g.fill(); g.stroke();
  poly([[136, -9], [122, -15], [130, -6]]); g.fill(); g.stroke();
  poly([[136, 9], [120, 17], [130, 6]]); g.fill(); g.stroke();
  g.fillStyle = "#7a5420"; poly([[146, 0], [150, -4], [154, 0], [150, 4]]); g.fill();
  g.fillStyle = "#f6dc8a"; poly([[148, 0], [150, -2], [152, 0], [150, 2]]); g.fill();
  // red tassel from a jade bead on the spine's hook
  g.fillStyle = "#9fe0c4"; g.beginPath(); g.arc(X(176), Y(-19), 1.8 * u, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#c8231a"; g.lineCap = "round";
  for (const [dx, dy, w] of [[-14, -14, 2.2], [-18, -9, 2], [-11, -18, 1.8]]) { g.lineWidth = w * u; g.beginPath(); g.moveTo(X(176), Y(-19)); g.quadraticCurveTo(X(176 + dx * 0.4), Y(-19 + dy * 0.9), X(176 + dx), Y(-19 + dy)); g.stroke(); }
  const tex = { tex: PIXI.Texture.from(cv), S, ay: 0.5 };
  bladeTex.set(key, tex);
  return tex;
}

/** A hit by the sweep: a white flash over the unit, a slash across it, and a short shake. */
function sweepHit(token, from) {
  const G = Math.min(token.w, token.h), pad = G * 0.03, box = new PIXI.Container();
  box.position.set(token.x, token.y); overLayer().addChild(box);
  const f = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(pad, pad, token.w - 2 * pad, token.h - 2 * pad, G * 0.1).endFill();
  const sl = new PIXI.Graphics(); sl.position.set(token.w / 2, token.h / 2);
  box.addChild(f, sl);
  const ang = Math.atan2(token.center.y - from.y, token.center.x - from.x) + Math.PI / 2;
  const base = { x: token.position.x, y: token.position.y }, mesh = token.mesh, mb = mesh ? { x: mesh.position.x, y: mesh.position.y } : null;
  return run((dt, a) => {
    f.alpha = Math.max(0, 0.85 - a * 3);
    const k = Math.min(1, a / 0.18), w = Math.max(0, 1 - a * 2.5);
    sl.clear();
    if (w > 0) sl.lineStyle(5 * w * G / 120 + 0.01, 0xffffff, Math.max(0, 1 - a * 3)).moveTo(-Math.cos(ang) * G * 0.45 * k, -Math.sin(ang) * G * 0.45 * k).lineTo(Math.cos(ang) * G * 0.45 * k, Math.sin(ang) * G * 0.45 * k);
    const sh = a < 0.25 ? Math.sin(a * 60) * 4 * (G / 120) * (1 - a / 0.25) : 0;
    if (!token.destroyed) { token.position.set(base.x + sh, base.y); if (mesh && !mesh.destroyed) mesh.position.set(mb.x + sh, mb.y); }
    if (a < 1.4) return true;
    if (!token.destroyed) { token.position.set(base.x, base.y); if (mesh && !mesh.destroyed) mesh.position.set(mb.x, mb.y); }
    box.destroy({ children: true });
    return false;
  });
}

/**
 * The glaive sweeps a full circle round the attacker: it shows held back for a moment, swings once round with faint
 * afterimages and a pale green arc behind it, and each enemy hit flashes as the blade passes (float(id, style, text, delay)
 * shows its numbers). Resolves when the swing is done (the hits finish on their own).
 */
export function playSweep(token, sweep, float) {
  if (!token || token.destroyed || !canvas?.ready) return Promise.resolve();
  const G = Math.min(token.w, token.h), c = token.center;
  const box = new PIXI.Container(); box.position.set(c.x, c.y); box.eventMode = "none"; overLayer().addChild(box);
  const B = Blur(), trail = new PIXI.Graphics(); if (B) trail.filters = [new B(3 * G / 120)]; box.addChild(trail);
  const tx = glaiveTexture(G);
  const mk = () => { const sp = new PIXI.Sprite(tx.tex); sp.scale.set(1 / tx.S); sp.anchor.set(0, tx.ay); sp.alpha = 0; box.addChild(sp); return sp; };
  const ghosts = [mk(), mk(), mk()]; ghosts.forEach(g => (g.tint = 0xc8f0e0));
  const blade = mk();
  const WIND = 0.25, SWING = 0.55, A0 = -Math.PI * 0.75, TURN = Math.PI * 2.15;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2);
  const angAt = (tt) => A0 + TURN * ease(Math.max(0, Math.min(1, tt / SWING)));
  // when the blade passes each unit hit
  const hits = (sweep.hits ?? []).map(([id, cas, mor]) => {
    const t = canvas.tokens.get(id); if (!t) return null;
    const a = Math.atan2(t.center.y - c.y, t.center.x - c.x);
    let at = SWING * 0.5;
    for (let i = 0; i <= 200; i++) { const aa = angAt(SWING * i / 200); if (Math.abs(Math.atan2(Math.sin(aa - a), Math.cos(aa - a))) < 0.12) { at = SWING * i / 200; break; } }
    return { t, id, cas, mor, at, done: false };
  }).filter(Boolean);
  return run((dt, T) => {
    const st = T - WIND;
    const k = Math.max(0, Math.min(1, st / SWING)), ang = st < 0 ? A0 - 0.25 * (-st / WIND) : angAt(st);
    blade.rotation = ang;
    blade.alpha = st < 0 ? 1 - (-st / WIND) : st > SWING ? Math.max(0, 1 - (st - SWING) / 0.35) : 1;
    ghosts.forEach((gh, i) => { gh.rotation = angAt(Math.max(0, st - (i + 1) * 0.035)); gh.alpha = st > 0 && st < SWING + 0.1 ? 0.35 - 0.1 * i : 0; });
    trail.clear();
    if (st > 0 && st < SWING + 0.25) {
      const span = Math.min(Math.PI * 0.9, TURN * k), fade = st > SWING ? Math.max(0, 1 - (st - SWING) / 0.25) : 1;
      for (let i = 0; i < 14; i++) {
        const a1 = ang - span * (i / 14), a2 = ang - span * ((i + 1) / 14);
        trail.lineStyle(G * 0.42 * (1 - i / 20), 0xd8fff0, (1 - i / 14) * 0.55 * fade).arc(0, 0, G * 1.48, a2, a1);
      }
    }
    for (const h of hits) if (!h.done && st >= h.at) {
      h.done = true; sweepHit(h.t, c);
      try { playMoment("Sweep hit", { minGap: 0 }); } catch { /* no sound */ } // one hit sound per enemy the blade passes
      float(h.id, "unitDamage", `−${h.cas}`);
      if (h.mor) float(h.id, "moraleDown", `−${h.mor} morale`, atSpeed(480)); // a little after the damage
    }
    if (st < SWING + 0.35) return true;
    box.destroy({ children: true });
    return false;
  });
}


/* ------------------------------------------------------------ fire eruption (Lu Bu, on activation) */

const fireTex = {};
/** A licking flame tongue: wavy sides, white-hot root, orange body, ragged red tip. */
function flameTexture() {
  if (fireTex.flame) return fireTex.flame;
  const W = 48, H = 150, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  g.beginPath(); g.moveTo(W * 0.56, 2);
  g.bezierCurveTo(W * 0.40, H * 0.18, W * 0.78, H * 0.30, W * 0.64, H * 0.46); g.bezierCurveTo(W * 0.98, H * 0.62, W * 0.96, H * 0.86, W * 0.66, H * 0.97);
  g.bezierCurveTo(W * 0.52, H, W * 0.40, H, W * 0.30, H * 0.96); g.bezierCurveTo(W * 0.02, H * 0.84, W * 0.10, H * 0.62, W * 0.34, H * 0.50);
  g.bezierCurveTo(W * 0.22, H * 0.36, W * 0.50, H * 0.24, W * 0.56, 2); g.closePath();
  const gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, "rgba(255,250,210,1)"); gr.addColorStop(0.16, "rgba(255,214,90,1)"); gr.addColorStop(0.42, "rgba(255,128,24,0.95)"); gr.addColorStop(0.72, "rgba(214,40,8,0.8)"); gr.addColorStop(1, "rgba(110,0,0,0)");
  g.fillStyle = gr; g.fill();
  const hg = g.createRadialGradient(W * 0.5, H * 0.86, 1, W * 0.5, H * 0.84, W * 0.36); hg.addColorStop(0, "rgba(255,255,235,0.9)"); hg.addColorStop(1, "rgba(255,220,120,0)");
  g.fillStyle = hg; g.fillRect(0, 0, W, H);
  return (fireTex.flame = PIXI.Texture.from(cv));
}
function softTexture(key, col) {
  if (fireTex[key]) return fireTex[key];
  const S = 64, cv = document.createElement("canvas"); cv.width = cv.height = S; const g = cv.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return (fireTex[key] = PIXI.Texture.from(cv));
}
function lerpCol(a, b, k) { const ch = (c, s) => (c >> s) & 255, m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k); return (m(16) << 16) | (m(8) << 8) | m(0); }

/** Tall flames roar up from his square while a wave of fire rolls out from him, leaving trails of fire burning behind
 *  it along the ground; then it all dies down (David, 2026-11-09). */
function fireEruption(token) {
  const G = Math.min(token.w, token.h), k = G / 120, ADD = PIXI.BLEND_MODES.ADD, B = Blur();
  const ground = groundLayer(); ground.position.set(token.center.x, token.center.y);
  const burn = new PIXI.Graphics(); if (B) burn.filters = [new B(10 * k)]; ground.addChild(burn);
  const over = new PIXI.Container(); over.position.set(token.center.x, token.center.y); overLayer().addChild(over);
  const smokeL = new PIXI.Container(), glowL = new PIXI.Container(), fireL = new PIXI.Container(); over.addChild(smokeL, glowL, fireL);
  const FLAME = flameTexture(), SMOKE = softTexture("smoke", "rgba(40,22,18,0.9)"), GLOW = softTexture("glow", "rgba(255,120,40,1)");
  const core = new PIXI.Sprite(GLOW); core.anchor.set(0.5); core.blendMode = ADD; glowL.addChild(core);
  const waveGlow = new PIXI.Graphics(); waveGlow.blendMode = ADD; if (B) waveGlow.filters = [new B(14 * k)]; glowL.addChild(waveGlow);
  const R = G * 2.6, WAVE = 0.95, PILLAR = 1.5;                      // the wave reaches ~2.6 squares in under a second
  const waveAt = (t) => G * 0.45 + (R - G * 0.45) * (1 - (1 - Math.min(1, t / WAVE)) ** 2);
  const RAYS = 12, rays = Array.from({ length: RAYS }, (_, i) => ({ a: (i / RAYS) * Math.PI * 2 + rnd(-0.08, 0.08), next: G * 0.55, wob: rnd(0, 6) }));
  const parts = [], embers = [], spots = [];
  let pacc = 0, wacc = 0, sacc = 0, eacc = 0;
  const flame = (x, y, o) => {
    const sp = new PIXI.Sprite(FLAME); sp.anchor.set(0.5, 0.92); sp.blendMode = ADD; fireL.addChild(sp);
    parts.push({ sp, smoke: false, x, y, vx: o.vx ?? 0, vy: o.vy, life: o.life, t: 0, sz: o.sz * k, sw: rnd(0, 6), flip: Math.random() < 0.5 ? -1 : 1, stretch: o.stretch ?? 1, hot: o.hot ?? 0xffffff });
  };
  const smoke = (x, y, big) => {
    const sp = new PIXI.Sprite(SMOKE); sp.anchor.set(0.5); smokeL.addChild(sp);
    parts.push({ sp, smoke: true, x, y, vx: rnd(-8, 8) * k, vy: -rnd(30, 55) * k, life: rnd(1.1, 1.7), t: 0, sz: (big ? rnd(1.1, 1.6) : rnd(0.6, 1)) * k });
  };
  return run((dt, t) => {
    const w = waveAt(t);
    // the pillar: tall flames roaring straight up out of his square
    if (t < PILLAR) {
      pacc += dt * (t < 0.3 ? 70 : 45);
      while (pacc >= 1) { pacc--; const x = rnd(-0.42, 0.42) * G, y = rnd(-0.3, 0.42) * G;
        flame(x, y, { vy: -rnd(150, 250) * k, vx: -x * 0.5, life: rnd(0.5, 0.8), sz: rnd(0.8, 1.3), stretch: 1.6, hot: 0xffd890 }); }
      if (Math.random() < dt * 6) smoke(rnd(-0.3, 0.3) * G, -G * rnd(1.7, 2.2), true);
    }
    // the wave front: a dense wall of flame racing outward
    if (t < WAVE + 0.05) {
      wacc += dt * 280;
      while (wacc >= 1) { wacc--; const a = rnd(0, Math.PI * 2), r = w + rnd(-G * 0.1, G * 0.06);
        flame(Math.cos(a) * r, Math.sin(a) * r, { vx: Math.cos(a) * 60 * k, vy: -rnd(40, 90) * k, life: rnd(0.3, 0.5), sz: rnd(0.45, 0.7) }); }
      // trails: fire left burning along each ray as the front passes
      for (const ry of rays) while (ry.next <= w) {
        const a = ry.a + Math.sin(ry.next / G * 2 + ry.wob) * 0.07;
        spots.push({ x: Math.cos(a) * ry.next, y: Math.sin(a) * ry.next, born: t, life: rnd(0.9, 1.3) * (1 - 0.25 * ry.next / R), acc: rnd(0, 1) });
        ry.next += G * rnd(0.26, 0.34);
      }
    }
    for (const sp of spots) {
      const age = (t - sp.born) / sp.life; if (age >= 1) continue;
      sp.acc += dt * 5 * (1 - age);
      while (sp.acc >= 1) { sp.acc--; flame(sp.x + rnd(-4, 4) * k, sp.y + rnd(-4, 4) * k, { vy: -rnd(30, 60) * k, life: rnd(0.35, 0.6), sz: rnd(0.3, 0.45) * (1 - 0.5 * age) }); }
    }
    if (t < 1.9) { sacc += dt * 7; while (sacc >= 1) { sacc--; const a = rnd(0, Math.PI * 2), r = rnd(0.3, 1) * Math.min(w, R); smoke(Math.cos(a) * r, Math.sin(a) * r, false); } }
    if (t < 2.2) {
      eacc += dt * 70;
      while (eacc >= 1) { eacc--; const a = rnd(0, Math.PI * 2), r = rnd(0, 1) * w;
        const e = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0xffd27a : 0xff7a2a).drawCircle(0, 0, rnd(1.2, 2.6) * k).endFill(); e.blendMode = ADD; fireL.addChild(e);
        embers.push({ e, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: rnd(-20, 20) * k, vy: -rnd(80, 170) * k, t: 0, life: rnd(0.8, 1.4), w: rnd(0, 6) }); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt; const tt = p.t / p.life;
      if (tt >= 1) { p.sp.destroy(); parts.splice(i, 1); continue; }
      if (p.smoke) { p.sp.position.set(p.x + p.vx * p.t, p.y + p.vy * p.t); p.sp.scale.set(p.sz * (1 + tt * 1.4)); p.sp.alpha = 0.3 * (tt < 0.2 ? tt / 0.2 : 1 - (tt - 0.2) / 0.8); continue; }
      p.sp.position.set(p.x + p.vx * p.t + Math.sin(p.t * 14 + p.sw) * 3 * k, p.y + p.vy * p.t);
      const sc = p.sz * (tt < 0.25 ? 0.6 + 1.6 * tt : 1 - (tt - 0.25) * 0.9);
      p.sp.scale.set(sc * (0.85 + 0.15 * Math.sin(p.t * 30 + p.sw)) * p.flip, sc * (1.1 + 0.3 * tt) * p.stretch);
      p.sp.alpha = tt < 0.12 ? tt / 0.12 : 1 - (tt - 0.12) / 0.88;
      p.sp.tint = tt < 0.45 ? lerpCol(p.hot, 0xffa060, tt / 0.45) : lerpCol(0xffa060, 0xd03018, (tt - 0.45) / 0.55);
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const m = embers[i]; m.t += dt; const tt = m.t / m.life;
      if (tt >= 1) { m.e.destroy(); embers.splice(i, 1); continue; }
      m.e.position.set(m.x + m.vx * m.t + Math.sin(m.t * 6 + m.w) * 8 * k, m.y + m.vy * m.t); m.e.alpha = 1 - tt;
    }
    // glows: a hot core under the pillar, a bright band riding the wave
    core.width = core.height = G * 2.2; core.alpha = 0.3 * (t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - PILLAR + 0.3) / 0.6)) * (0.9 + 0.1 * Math.sin(t * 25));
    waveGlow.clear(); if (t < WAVE + 0.3) waveGlow.lineStyle(G * 0.4, 0xff6a20, 0.3 * (t < WAVE ? 1 : 1 - (t - WAVE) / 0.3)).drawCircle(0, 0, w);
    // no scorch marks at all: no streaks along the trails, no dark patch over him (David, 2026-11-09)
    if (t < 4.5 && (t < 3.2 || parts.length || embers.length)) return true;
    ground.destroy({ children: true }); over.destroy({ children: true });
    return false;
  });
}

/* ------------------------------------------------------------ the Sky Piercer (Lu Bu's attacks while his active is on) */

/** The Fangtian Huaji, pointing right from its butt (the pivot): red-lacquered shaft with gold bands, red horsehair tassel,
 *  two crescent side blades and a long spear point. */
function jiTexture(G) {
  const key = "ji" + Math.round(G);
  if (bladeTex.has(key)) return bladeTex.get(key);
  const S = 2, u = G * S / 140, L = Math.round(300 * u), H = Math.round(90 * u);
  const cv = document.createElement("canvas"); cv.width = L; cv.height = H; const g = cv.getContext("2d");
  const cy = H * 0.5, X = (x) => x * u, Y = (y) => cy + y * u;
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
  const gold = () => { const gg = g.createLinearGradient(0, Y(-8), 0, Y(8)); gg.addColorStop(0, "#f6dc8a"); gg.addColorStop(0.5, "#c8963c"); gg.addColorStop(1, "#7a5420"); return gg; };
  const steel = (y0, y1) => { const sv = g.createLinearGradient(0, Y(y0), 0, Y(y1)); sv.addColorStop(0, "#aeb6bb"); sv.addColorStop(0.5, "#f5f7f8"); sv.addColorStop(1, "#8f989e"); return sv; };
  g.fillStyle = "#b9c0c4"; poly([[0, 0], [14, -3.5], [14, 3.5]]); g.fill();
  g.fillStyle = gold(); g.fillRect(X(14), Y(-4.5), 6 * u, 9 * u);
  const sg = g.createLinearGradient(0, Y(-3.5), 0, Y(3.5)); sg.addColorStop(0, "#c0392b"); sg.addColorStop(0.5, "#8e1b12"); sg.addColorStop(1, "#4a0b06");
  g.fillStyle = sg; g.fillRect(X(20), Y(-3.2), X(190) - X(20), 6.4 * u);
  g.fillStyle = gold(); for (const x of [60, 110, 160]) g.fillRect(X(x), Y(-3.8), 3 * u, 7.6 * u);
  g.fillStyle = gold(); g.strokeStyle = "#5a3c14"; g.lineWidth = 0.8 * u;
  poly([[188, -5], [200, -7], [204, -5], [204, 5], [200, 7], [188, 5]]); g.fill(); g.stroke();
  g.strokeStyle = "#d9261c"; g.lineCap = "round";
  for (const [dx, dy, w] of [[-22, -9, 2.4], [-26, -3, 2.2], [-24, 4, 2.2], [-20, 10, 2], [-28, 1, 1.8]]) { g.lineWidth = w * u; g.beginPath(); g.moveTo(X(192), Y(0)); g.quadraticCurveTo(X(192 + dx * 0.5), Y(dy * 0.3), X(192 + dx), Y(dy)); g.stroke(); }
  for (const sd of [-1, 1]) { // the crescents, their cutting curve facing outward
    g.beginPath(); g.moveTo(X(206), Y(sd * 4));
    g.bezierCurveTo(X(200), Y(sd * 20), X(214), Y(sd * 42), X(236), Y(sd * 40));
    g.bezierCurveTo(X(226), Y(sd * 34), X(218), Y(sd * 22), X(224), Y(sd * 12));
    g.bezierCurveTo(X(220), Y(sd * 10), X(214), Y(sd * 7), X(214), Y(sd * 4)); g.closePath();
    g.fillStyle = steel(sd * 4, sd * 42); g.fill(); g.strokeStyle = "#4d555a"; g.lineWidth = 1.1 * u; g.stroke();
    g.beginPath(); g.moveTo(X(206), Y(sd * 4)); g.bezierCurveTo(X(200), Y(sd * 20), X(194), Y(sd * 30), X(182), Y(sd * 34)); g.bezierCurveTo(X(192), Y(sd * 24), X(198), Y(sd * 14), X(204), Y(sd * 4)); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 1.4 * u; g.beginPath(); g.moveTo(X(182), Y(sd * 34)); g.bezierCurveTo(X(194), Y(sd * 30), X(198), Y(sd * 24), X(202), Y(sd * 16)); g.bezierCurveTo(X(206), Y(sd * 28), X(216), Y(sd * 42), X(236), Y(sd * 40)); g.stroke();
  }
  const tip = [[204, -4], [230, -6], [262, -5], [298, 0], [262, 5], [230, 6], [204, 4]];
  g.fillStyle = steel(-6, 6); poly(tip); g.fill(); g.strokeStyle = "#4d555a"; g.lineWidth = 1.1 * u; poly(tip); g.stroke();
  g.strokeStyle = "rgba(60,70,75,.6)"; g.lineWidth = 0.9 * u; g.beginPath(); g.moveTo(X(206), Y(0)); g.lineTo(X(290), Y(0)); g.stroke();
  const tex = { tex: PIXI.Texture.from(cv), S, len: 300 * G / 140 };
  bladeTex.set(key, tex);
  return tex;
}

/** A blue shield flashes on the target and shatters: its defences count for nothing. */
function shieldShatter(token) {
  const G = Math.min(token.w, token.h), k = G / 120, ADD = PIXI.BLEND_MODES.ADD;
  const root = new PIXI.Container(); root.position.set(token.center.x, token.center.y); overLayer().addChild(root);
  const sh = new PIXI.Graphics(); sh.lineStyle(4 * k, 0xbfe4ff, 1).beginFill(0x4aa3ff, 0.35).drawPolygon([0, -34, 28, -24, 24, 10, 0, 34, -24, 10, -28, -24].map(v => v * k)).endFill(); sh.blendMode = ADD; root.addChild(sh);
  const shards = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, Math.PI * 2), g = new PIXI.Graphics().beginFill(0x9fd2ff, 0.9).drawPolygon([0, -6 * k, 5 * k, 3 * k, -4 * k, 5 * k]).endFill(); g.blendMode = ADD; root.addChild(g);
    shards.push({ g, vx: Math.cos(a) * rnd(80, 200) * k, vy: (Math.sin(a) * rnd(80, 200) - 40) * k, rot: rnd(-12, 12) });
  }
  return run((dt, t) => {
    sh.alpha = t < 0.16 ? 1 : Math.max(0, 1 - (t - 0.16) / 0.1); sh.scale.set(t < 0.16 ? 0.7 + t * 2 : 1.02 + t * 0.4);
    for (const q of shards) { const d = t - 0.16; q.g.alpha = d < 0 ? 0 : Math.max(0, 1 - d / 0.7); q.g.position.set(d > 0 ? q.vx * d : 0, d > 0 ? (q.vy + 120 * k * d) * d : 0); q.g.rotation = q.rot * t; }
    if (t < 0.95) return true;
    root.destroy({ children: true }); return false;
  });
}

/** The Sky Piercer drives straight through the target and out the far side; it lands at the same moment as the lunge
 *  (240 ms), when the target's shield shatters. */
export function playSkyPiercer(attacker, defender) {
  if (!attacker || !defender || attacker.destroyed || defender.destroyed) return Promise.resolve();
  const G = Math.min(attacker.w, attacker.h), a0 = attacker.center, b = defender.center, ADD = PIXI.BLEND_MODES.ADD, BF = Blur();
  const ang = Math.atan2(b.y - a0.y, b.x - a0.x), d = Math.hypot(b.x - a0.x, b.y - a0.y);
  const root = new PIXI.Container(); root.position.set(a0.x, a0.y); root.rotation = ang; overLayer().addChild(root);
  const streak = new PIXI.Graphics(); streak.blendMode = ADD; if (BF) streak.filters = [new BF(4)]; root.addChild(streak);
  const T = jiTexture(G), sc = 1.2 / T.S, LEN = T.len * 1.2;
  const mk = () => { const sp = new PIXI.Sprite(T.tex); sp.scale.set(sc); sp.anchor.set(0, 0.5); root.addChild(sp); return sp; };
  const ghosts = [0, 1, 2].map(() => { const g = mk(); g.tint = 0xff9080; g.alpha = 0; return g; });
  const ji = mk();
  const back = -LEN * 0.55, fwd = d + G * 0.9 - LEN;   // the point ends well past the target's far side
  const posAt = (t) => t < 0.14 ? back - G * 0.15 * (t / 0.14)
    : t < 0.24 ? back - G * 0.15 + (fwd - back + G * 0.15) * (1 - (1 - (t - 0.14) / 0.1) ** 3)
    : t < 0.5 ? fwd : fwd + (back - fwd) * Math.min(1, (t - 0.5) / 0.3);
  let hit = false;
  return run((dt, t) => {
    ji.x = posAt(t); ji.alpha = t < 0.08 ? t / 0.08 : t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.2) : 1;
    ghosts.forEach((g, i) => { g.x = posAt(Math.max(0, t - 0.025 * (i + 1))); g.alpha = t > 0.14 && t < 0.36 ? 0.4 - 0.12 * i : 0; });
    streak.clear();
    if (t > 0.16 && t < 0.6) { const f = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.3;
      streak.lineStyle(G * 0.22 * f, 0xff2a10, 0.7 * f).moveTo(G * 0.2, 0).lineTo(ji.x + LEN, 0);
      streak.lineStyle(G * 0.06 * f, 0xfff0e0, 0.9 * f).moveTo(G * 0.3, 0).lineTo(ji.x + LEN, 0); }
    if (!hit && t >= 0.24) { hit = true; shieldShatter(defender); }
    if (t < 0.85) return true;
    root.destroy({ children: true }); return false;
  });
}

/* ------------------------------------------------------------ Terror of the Battlefield (end of his turn) */

/** A dark red dread pulse rolls out over the squares around him; each unit that lost the roll (or had no officer) flashes
 *  red and flinches, each that won gets a blue ward flash and "Resisted". Its morale loss floats after (the usual floats). */
export function playTerror(token, results, tokOf, float) {
  if (!token || token.destroyed) return Promise.resolve();
  const G = Math.min(token.w, token.h), k = G / 120, P = G * 0.03, ADD = PIXI.BLEND_MODES.ADD, BF = Blur();
  const pul = new PIXI.Graphics(); if (BF) pul.filters = [new BF(8 * k)]; pul.position.set(token.center.x, token.center.y); overLayer().addChild(pul);
  const marks = [];
  return run((dt, t) => {
    pul.clear();
    for (const d of [0, 0.18]) { const q = (t - d) / 0.6; if (q > 0 && q < 1) { const r = G * 0.5 + G * q; pul.lineStyle(G * 0.28 * (1 - q) + 2, 0x8a0a05, 0.8 * (1 - q)).drawRoundedRect(-r, -r, 2 * r, 2 * r, G * 0.2); } }
    pul.beginFill(0x3a0000, 0.18 * Math.max(0, 1 - t)).drawRect(-G * 1.5, -G * 1.5, G * 3, G * 3).endFill();
    if (!marks.length && t >= 0.25) for (const [id, lost] of results) {
      const u = tokOf(id); if (!u || u.destroyed) continue;
      const g = new PIXI.Graphics(); g.position.set(u.center.x, u.center.y); overLayer().addChild(g);
      if (!lost) { g.blendMode = ADD; if (BF) g.filters = [new BF(3)]; float?.(id, "moraleUp", "Resisted"); }
      marks.push({ g, u, lost, t0: t, x0: u.mesh?.position.x });
    }
    for (const m of marks) {
      const q = t - m.t0; m.g.clear();
      if (m.lost) {
        m.g.beginFill(0xb01008, 0.5 * Math.max(0, 1 - q / 0.5)).drawRoundedRect(-G / 2 + P, -G / 2 + P, G - 2 * P, G - 2 * P, G * 0.1).endFill();
        const mesh = m.u.mesh; if (mesh && !mesh.destroyed && m.x0 !== undefined) mesh.position.x = m.x0 + (q < 0.45 ? Math.sin(q * 70) * 5 * k * (1 - q / 0.45) : 0);
      } else m.g.lineStyle(6 * k, 0x7cc4ff, 0.9 * Math.max(0, 1 - q / 0.8)).drawRoundedRect(-G / 2 + P, -G / 2 + P, G - 2 * P, G - 2 * P, G * 0.1);
    }
    if (t < 1.1) return true;
    pul.destroy(); for (const m of marks) { m.g.destroy(); const mesh = m.u.mesh; if (mesh && !mesh.destroyed && m.x0 !== undefined) mesh.position.x = m.x0; }
    return false;
  });
}

/* ------------------------------------------------------------ another turn (Lu Bu's rout) */

/** His unit flashes red, red rings pulse out of its square, and ANOTHER TURN pops up over it in gold and red. */
export function playAnotherTurn(token) {
  if (!token || token.destroyed) return Promise.resolve();
  const G = Math.min(token.w, token.h), k = G / 120, P = G * 0.03, ADD = PIXI.BLEND_MODES.ADD, BF = Blur(), c = token.center;
  const root = new PIXI.Container(); root.position.set(c.x, c.y); overLayer().addChild(root);
  const ring = new PIXI.Graphics(); ring.blendMode = ADD; if (BF) ring.filters = [new BF(4 * k)];
  const glow = new PIXI.Graphics().beginFill(0xff2a10).drawRoundedRect(-G / 2 + P, -G / 2 + P, G - 2 * P, G - 2 * P, G * 0.1).endFill(); glow.blendMode = ADD;
  const txt = new PIXI.Text("ANOTHER TURN", { fontFamily: "Signika, Arial", fontWeight: "900", fontSize: Math.round(30 * k), fill: ["#ffe8a0", "#ff7a2a"], stroke: 0x3a0503, strokeThickness: Math.round(6 * k), letterSpacing: 2 });
  txt.anchor.set(0.5); root.addChild(glow, ring, txt);
  return run((dt, t) => {
    glow.alpha = t < 0.1 ? t / 0.1 * 0.7 : Math.max(0, 0.7 - (t - 0.1) * 1.2);
    ring.clear();
    for (const d of [0, 0.15]) { const q = (t - d) / 0.5; if (q > 0 && q < 1) ring.lineStyle(10 * k * (1 - q) + 1, 0xff4a20, 1 - q).drawRoundedRect(-G / 2 - G * 0.5 * q, -G / 2 - G * 0.5 * q, G + G * q, G + G * q, G * 0.12); }
    const s = t < 0.15 ? 0.6 + 0.55 * (t / 0.15) : t < 0.25 ? 1.15 - 0.15 * ((t - 0.15) / 0.1) : 1;
    txt.scale.set(s); txt.alpha = t < 1.1 ? 1 : Math.max(0, 1 - (t - 1.1) / 0.4); txt.y = -G * 0.62 - t * 10 * k;
    if (t < 1.5) return true;
    root.destroy({ children: true }); return false;
  });
}

/* ------------------------------------------------------------ Zhuge Liang: Eight Trigrams and stone sentinels */

// the eight trigrams (Later Heaven order), 1 = solid line, 0 = broken; from the inside line out
const TRI=[[1,1,1],[0,1,1],[1,0,1],[0,0,1],[1,1,0],[0,1,0],[1,0,0],[0,0,0]];
const baguaCache = new Map();
function baguaTextureRaw(R){
  const S=2, D=Math.ceil(R*2.2*S), cv=document.createElement('canvas'); cv.width=cv.height=D; const g=cv.getContext('2d');
  const c=D/2, r=R*S;
  g.translate(c,c); g.strokeStyle='#fff'; g.fillStyle='#fff'; g.lineCap='round';
  const ring=(rr,w)=>{ g.lineWidth=w*S; g.beginPath(); g.arc(0,0,rr*S,0,Math.PI*2); g.stroke(); };
  const oct=(rr,w)=>{ g.lineWidth=w*S; g.beginPath(); for(let i=0;i<=8;i++){ const a=(i+0.5)/8*Math.PI*2-Math.PI/2; const x=Math.cos(a)*rr*S, y=Math.sin(a)*rr*S; i?g.lineTo(x,y):g.moveTo(x,y); } g.closePath(); g.stroke(); };
  ring(R,2.5); ring(R*0.94,1); oct(R*0.86,2); oct(R*0.52,1.6); ring(R*0.3,1.6);
  // spokes between the trigrams
  g.lineWidth=1*S; for(let i=0;i<8;i++){ const a=(i+0.5)/8*Math.PI*2-Math.PI/2; g.beginPath(); g.moveTo(Math.cos(a)*R*0.3*S,Math.sin(a)*R*0.3*S); g.lineTo(Math.cos(a)*R*0.86*S,Math.sin(a)*R*0.86*S); g.stroke(); }
  // trigrams
  for(let i=0;i<8;i++){
    g.save(); g.rotate(i/8*Math.PI*2);
    const w=R*0.26*S, th=R*0.045*S;
    TRI[i].forEach((solid,j)=>{ const y=-(R*0.58+j*R*0.085)*S;
      if(solid) g.fillRect(-w/2,y-th/2,w,th); else { g.fillRect(-w/2,y-th/2,w*0.42,th); g.fillRect(w*0.08,y-th/2,w*0.42,th); } });
    g.restore();
  }
  // small tick marks on the outer band
  g.lineWidth=1*S; for(let i=0;i<64;i++){ const a=i/64*Math.PI*2; g.beginPath(); g.moveTo(Math.cos(a)*R*0.94*S,Math.sin(a)*R*0.94*S); g.lineTo(Math.cos(a)*R*(i%8===0?0.88:0.91)*S,Math.sin(a)*R*(i%8===0?0.88:0.91)*S); g.stroke(); }
  // the taiji in the centre
  const tr=R*0.22*S;
  g.beginPath(); g.arc(0,0,tr,0,Math.PI*2); g.lineWidth=1.5*S; g.stroke();
  g.beginPath(); g.arc(0,0,tr,-Math.PI/2,Math.PI/2); g.arc(0,tr/2,tr/2,Math.PI/2,-Math.PI/2,true); g.arc(0,-tr/2,tr/2,Math.PI/2,-Math.PI/2); g.fill();
  g.beginPath(); g.arc(0,-tr/2,tr*0.14,0,Math.PI*2); g.fill();
  g.globalCompositeOperation='destination-out'; g.beginPath(); g.arc(0,tr/2,tr*0.14,0,Math.PI*2); g.fill();
  const tex=PIXI.Texture.from(cv); tex.qS=S; return tex;
}
function baguaTexture(R) { const k = Math.round(R); if (!baguaCache.has(k)) baguaCache.set(k, baguaTextureRaw(R)); return baguaCache.get(k); }

/** The Eight Trigrams formation draws itself in on the ground beneath his unit, turns slowly with light rising off it,
 *  then fades (David, 2026-11-09). */
/** How long the trigrams turn at full strength, and how long they turn before the stones begin to rise. */
const TRIGRAM_HOLD = 3.8, STONES_AFTER = 1.6;
function eightTrigrams(token) {
  const G = Math.min(token.w, token.h), R = G * 1.45, tex = baguaTexture(R), B = Blur(), ADD = PIXI.BLEND_MODES.ADD;
  const root = groundLayer(); root.position.set(token.center.x, token.center.y);
  const glow = new PIXI.Sprite(tex); glow.anchor.set(0.5); glow.tint = 0x59d6ff; glow.blendMode = ADD; if (B) glow.filters = [new B(8 * G / 120)];
  const lines = new PIXI.Sprite(tex); lines.anchor.set(0.5); lines.tint = 0xfff1c2; lines.blendMode = ADD;
  const disc = new PIXI.Graphics().beginFill(0x0b1a2a, 0.35).drawCircle(0, 0, R * 1.02).endFill(); if (B) disc.filters = [new B(6)];
  const draw = new PIXI.Graphics(); draw.blendMode = ADD; if (B) draw.filters = [new B(3)];
  // start invisible: the canvas can draw once before the first tick sets them (David, 2026-11-11: the trigrams flashed)
  for (const sp of [glow, lines]) { sp.scale.set(0); sp.alpha = 0; } disc.alpha = 0;
  root.addChild(disc, glow, lines, draw);
  const over = new PIXI.Container(); over.position.set(token.center.x, token.center.y); overLayer().addChild(over);
  const motes = [];
  return run((dt, a) => {
    // it turns a while before the stones rise (David, 2026-11-11), then fades as they settle
    const grow = 1 - (1 - Math.min(1, a / 0.55)) ** 3, fade = a < TRIGRAM_HOLD ? 1 : Math.max(0, 1 - (a - TRIGRAM_HOLD) / 0.8);
    root.rotation = a * 0.25;
    for (const sp of [glow, lines]) sp.scale.set(grow / tex.qS);
    lines.alpha = fade * (0.85 + 0.15 * Math.sin(a * 6)); glow.alpha = fade * (0.9 + 0.1 * Math.sin(a * 4)); disc.alpha = fade * grow;
    draw.clear(); if (a < 0.7) { const q = a / 0.7; draw.lineStyle(G * 0.08, 0xbff0ff, 1 - q).arc(0, 0, R * grow, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); }
    if (a < TRIGRAM_HOLD && Math.random() < dt * 15) {
      const ang = rnd(0, Math.PI * 2), r = R * rnd(0.55, 0.95) * grow;
      const m = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0xbff0ff : 0xfff1c2).drawCircle(0, 0, rnd(1.2, 2.4) * G / 120).endFill(); m.blendMode = ADD; over.addChild(m);
      motes.push({ m, x: Math.cos(ang) * r, y: Math.sin(ang) * r, t: 0, life: rnd(0.8, 1.3) });
    }
    for (let i = motes.length - 1; i >= 0; i--) { const o = motes[i]; o.t += dt; const q = o.t / o.life; if (q >= 1) { o.m.destroy(); motes.splice(i, 1); continue; } o.m.position.set(o.x, o.y - q * G * 0.6); o.m.alpha = 1 - q; }
    if (a < TRIGRAM_HOLD + 0.8) return true;
    root.destroy({ children: true }); over.destroy({ children: true });
    return false;
  });
}

function stoneTexture(w, h, seed) {
  // a broad, squat standing slab: wider than tall at its base, a flat sloping top with chipped corners (drawn in a 100 x 100 box, scaled to w x h)
  const S=2, cv=document.createElement('canvas'); cv.width=w*S; cv.height=h*S; const g=cv.getContext('2d'); g.scale(S*w/100,S*h/100);
  const P=(pts)=>{ g.beginPath(); pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y)); g.closePath(); };
  const stone=(x0,x1)=>{ const gr=g.createLinearGradient(x0,0,x1,0); gr.addColorStop(0,'#55585a'); gr.addColorStop(0.35,'#a7a9a3'); gr.addColorStop(0.62,'#8c8f8a'); gr.addColorStop(1,'#46494a'); return gr; };
  const slab=[[10,100],[6,40],[14,20],[30,14],[62,8],[84,12],[92,24],[95,62],[90,100]];
  P(slab); g.fillStyle=stone(6,95); g.fill();
  // the top face, lit
  P([[14,20],[30,14],[62,8],[84,12],[92,24],[60,22],[28,26]]); g.fillStyle='rgba(235,235,225,.28)'; g.fill();
  // a darker right side face for depth
  P([[84,12],[92,24],[95,62],[90,100],[78,100],[80,40]]); g.fillStyle='rgba(0,0,0,.18)'; g.fill();
  P(slab); g.lineWidth=1.6; g.strokeStyle='#2a2c2c'; g.stroke();
  g.save(); P(slab); g.clip();
  for(let i=0;i<220;i++){ g.fillStyle=`rgba(${Math.random()<0.5?'25,25,25':'235,235,225'},${Math.random()*0.14})`; g.fillRect(Math.random()*100,Math.random()*100,1.6,1.6); }
  g.strokeStyle='rgba(25,25,25,.55)'; g.lineWidth=0.9;
  for(let i=0;i<4;i++){ let x=12+Math.random()*70, y=18+Math.random()*40; g.beginPath(); g.moveTo(x,y); for(let j=0;j<4;j++){ x+=rnd(-6,6); y+=rnd(4,9); g.lineTo(x,y); } g.stroke(); }
  g.restore();
  // a carved trigram glowing on its face
  const tri=TRI[seed%8]; g.fillStyle='#8ff0ff'; g.shadowColor='#59d6ff'; g.shadowBlur=7;
  tri.forEach((solid,j)=>{ const y=42+j*11; if(solid) g.fillRect(32,y,34,5); else { g.fillRect(32,y,14.5,5); g.fillRect(51.5,y,14.5,5); } });
  const tex=PIXI.Texture.from(cv); tex.qS=S; return tex;
}

/** A carved stone slab rises out of the ground over a target with dust and a seal closing round its square: it stands a
 *  moment ("Held") and fades; on a unit that won its roll it cracks apart and falls ("Resisted"). */
function stoneSentinel(token, resisted, i, float) {
  if (!token || token.destroyed) return Promise.resolve();
  const G = Math.min(token.w, token.h), k = G / 120, B = Blur(), ADD = PIXI.BLEND_MODES.ADD;
  // above the unit stands: they are drawn on the token objects (token layer, interface group), which sit over the
  // primary group's overLayer, so the slab goes into the interface group sorted above the token layer
  const root = new PIXI.Container(); root.position.set(token.center.x, token.center.y); topLayer().addChild(root);
  const W = G * 0.74, H = G * 0.8, tex = stoneTexture(W, H, i * 3 + 1), base = G * 0.36;
  const shadow = new PIXI.Graphics().beginFill(0x000000, 0.35).drawEllipse(0, G * 0.32, W * 0.9, W * 0.3).endFill(); if (B) shadow.filters = [new B(4 * k)];
  const seal = new PIXI.Graphics(); seal.blendMode = ADD; if (B) seal.filters = [new B(2 * k)];
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(-G, -G * 1.5, G * 2, G * 1.5 + base).endFill();
  const stone = new PIXI.Sprite(tex); stone.scale.set(1 / tex.qS); stone.anchor.set(0.5, 1); stone.mask = mask;
  root.addChild(shadow, seal, stone, mask);
  const dust = [], pieces = [];
  let said = false;
  return run((dt, a) => {
    const rise = 1 - (1 - Math.min(1, a / 0.35)) ** 3;
    stone.y = base + H * (1 - rise); stone.x = a < 0.4 ? Math.sin(a * 90) * 2 * k * (1 - a / 0.4) : 0;
    shadow.alpha = rise;
    seal.clear();
    if (a > 0.1) { const q = Math.min(1, (a - 0.1) / 0.35), al = a < 1.4 ? 1 : Math.max(0, 1 - (a - 1.4) / 0.5), sz = G * (1.3 - 0.3 * q);
      seal.lineStyle(3 * k, resisted ? 0xffd27a : 0x8ff0ff, 0.85 * al).drawRoundedRect(-sz / 2, -sz / 2, sz, sz, G * 0.12); }
    if (!said && a >= 0.45) { said = true; float?.(resisted ? "moraleUp" : "levelUp", resisted ? "Resisted" : "Held"); }
    if (a < 0.45 && Math.random() < dt * 20) {
      const d = new PIXI.Graphics().beginFill(0xbdb39a, 0.5).drawCircle(0, 0, rnd(3, 6) * k).endFill(); if (B) d.filters = [new B(3 * k)]; root.addChild(d);
      dust.push({ d, x: rnd(-W * 0.7, W * 0.7), y: base, vx: rnd(-40, 40) * k, vy: -rnd(10, 40) * k, t: 0 });
    }
    for (let j = dust.length - 1; j >= 0; j--) { const o = dust[j]; o.t += dt; if (o.t > 0.9) { o.d.destroy(); dust.splice(j, 1); continue; } o.d.position.set(o.x + o.vx * o.t, o.y + o.vy * o.t); o.d.alpha = 0.6 * (1 - o.t / 0.9); o.d.scale.set(1 + o.t * 2); }
    if (resisted) {
      if (a >= 0.8 && !pieces.length) {
        stone.visible = false;
        for (let p = 0; p < 9; p++) {
          const g = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0x8a8d88 : 0x5d605f).drawPolygon([0, 0, rnd(8, 16) * k, rnd(-4, 4) * k, rnd(6, 14) * k, rnd(10, 18) * k, rnd(-4, 4) * k, rnd(8, 14) * k]).endFill();
          g.position.set(rnd(-W / 2, W / 2), base - rnd(0, H)); root.addChild(g);
          pieces.push({ g, vx: rnd(-60, 60) * k, vy: rnd(-80, -10) * k, r: rnd(-6, 6), x0: g.x, y0: g.y });
        }
      }
      for (const p of pieces) { const q = a - 0.8; p.g.position.set(p.x0 + p.vx * q, p.y0 + p.vy * q + 400 * k * q * q); p.g.rotation = p.r * q; p.g.alpha = Math.max(0, 1 - q / 0.8); }
    } else stone.alpha = a < 1.3 ? 1 : Math.max(0, 1 - (a - 1.3) / 0.7);
    if (a < 2.0) return true;
    root.destroy({ children: true });
    return false;
  });
}
/** Stone Sentinel Maze: a stone on each unit it was used on, one after another. */
export function playSentinels(results, tokOf, float) {
  // each unit's debuff lands (its stand is released) once its stone has risen and gone (David, 2026-11-11)
  const all = results.map(([id, lost], i) => new Promise(res => setTimeout(() => res(stoneSentinel(tokOf(id), !lost, i, (style, text) => float?.(id, style, text))), atSpeed(i * 120)))
    .then(() => releaseUnits([id])));
  return Promise.all(all);
}

/* ------------------------------------------------------------ Sima Yi: the wolf pack (No Herd to Hide In) */

const sm = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
/* A wolf seen from above, sitting, facing up (-y). h = how far its head is thrown back to howl (0..1). */
function drawWolf(g, u, h, t){
  const FUR=0x6f757c, DARK=0x454a50, LIGHT=0xaab0b6, OUT=0x1c1e21;
  g.clear();
  // tail, curled round to its right
  g.lineStyle({width:5.5*u,color:OUT,cap:'round'}).moveTo(2*u,15*u).bezierCurveTo(10*u,22*u,17*u,14*u,13*u,5*u);
  g.lineStyle({width:4*u,color:FUR,cap:'round'}).moveTo(2*u,15*u).bezierCurveTo(10*u,22*u,17*u,14*u,13*u,5*u);
  g.lineStyle({width:2.2*u,color:LIGHT,cap:'round'}).moveTo(14.2*u,9*u).lineTo(13*u,5*u);
  g.lineStyle(1.2*u,OUT,1);
  // hind paws, haunches
  for(const s of [-1,1]) g.beginFill(FUR).drawEllipse(s*9.5*u,3*u,2.6*u,4*u).endFill();
  g.beginFill(FUR).drawEllipse(0,8*u,11*u,9*u).endFill();
  // front paws, shoulders and chest
  for(const s of [-1,1]) g.beginFill(LIGHT).drawEllipse(s*4.2*u,-10.5*u,2.3*u,3.4*u).endFill();
  g.beginFill(FUR).drawEllipse(0,-2*u,8.2*u,9.5*u).endFill();
  // the dark saddle down its back
  g.lineStyle(0).beginFill(DARK,0.85).drawEllipse(0,4*u,4.6*u,11*u).endFill();
  // head: pulls back over the shoulders as it lifts
  const hy=(-13+6*h)*u, tremble=h>0.9?Math.sin(t*38)*0.35*u:0, hx=tremble;
  // ears: back and smaller when the head is thrown back
  g.lineStyle(1.1*u,OUT,1);
  for(const s of [-1,1]){ const ex=hx+s*5.2*u, ey=hy+(1.5+3.5*h)*u, L=(6-2.2*h)*u;
    g.beginFill(DARK).drawPolygon([ex-s*2.4*u,ey-2.2*u, ex+s*2.2*u,ey-1.2*u, ex+s*1.6*u,ey+L]).endFill();
    g.lineStyle(0).beginFill(0xc89a8e,0.8).drawPolygon([ex-s*0.8*u,ey-0.8*u, ex+s*1.2*u,ey-0.4*u, ex+s*1.1*u,ey+L*0.6]).endFill(); g.lineStyle(1.1*u,OUT,1); }
  // skull
  g.beginFill(FUR).drawEllipse(hx,hy,6.6*u,(6.6-0.8*h)*u).endFill();
  g.lineStyle(0).beginFill(DARK,0.8).drawEllipse(hx,hy+1.5*u,3.4*u,3.6*u).endFill();
  // muzzle: long when it looks ahead, a short upturned stub when it howls at the sky
  const mL=(10-6.5*h)*u, mW=(3.6+0.9*h)*u, my=hy-(3.5-1.5*h)*u;
  g.lineStyle(1.1*u,OUT,1).beginFill(LIGHT).drawPolygon([hx-mW,my, hx+mW,my, hx+mW*0.62,my-mL, hx-mW*0.62,my-mL]).endFill();
  g.beginFill(LIGHT).drawEllipse(hx,my-mL,mW*0.62,1.6*u).endFill();
  // the open mouth, seen down the throat
  if(h>0.35){ const o=sm((h-0.35)/0.5); g.lineStyle(0.8*u,OUT,1).beginFill(0x3a0f12).drawEllipse(hx,my-mL*0.45,mW*0.62*o,(mL*0.42+0.6*u)*o).endFill();
    g.lineStyle(0).beginFill(0xc85a5e,0.9*o).drawEllipse(hx,my-mL*0.3,mW*0.34*o,mL*0.2*o).endFill();           // tongue
    g.beginFill(0xffffff,o); for(const s of [-1,1]) g.drawPolygon([hx+s*mW*0.5,my-mL*0.8, hx+s*mW*0.32,my-mL*0.8, hx+s*mW*0.4,my-mL*0.55]); g.endFill(); } // fangs
  // nose
  g.lineStyle(0).beginFill(0x111214).drawEllipse(hx,my-mL-0.6*u,1.5*u,1.1*u).endFill();
  // eyes: amber and open, closing as it howls
  for(const s of [-1,1]){ const ex=hx+s*2.9*u, ey=hy-(1.6-2.2*h)*u;
    if(h<0.5) g.beginFill(0xffc93c).drawEllipse(ex,ey,1.15*u,(0.85*(1-h*1.6))*u).endFill().beginFill(0x111111).drawCircle(ex,ey,0.42*u).endFill();
    else g.lineStyle(0.8*u,OUT,1).moveTo(ex-1.1*u,ey).lineTo(ex+1.1*u,ey).lineStyle(0); }
}


/* A wolf seen from above, running, facing up (-y): stretched low, tail streaming out behind, no legs drawn
   (David, 2026-11-10). ph = stride phase (radians); leap = 0..1 blends into the stretched pounce, jaws open. */
function drawWolfRun(g, u, ph, leap = 0) {
  const FUR = 0x6f757c, DARK = 0x454a50, LIGHT = 0xaab0b6, OUT = 0x1c1e21;
  const mix = (a, b) => a + (b - a) * leap;
  g.clear();
  // tail: straight out behind, swaying with the stride
  const sway = Math.sin(ph) * 3.2 * u * (1 - leap);
  for (const [w, col] of [[5.2, OUT], [3.7, FUR]]) g.lineStyle({ width: w * u, color: col, cap: "round" }).moveTo(0, 15 * u).bezierCurveTo(-sway * 0.6, 21 * u, sway, 26 * u, sway * 1.5, 31 * u);
  g.lineStyle({ width: 2 * u, color: LIGHT, cap: "round" }).moveTo(sway * 1.15, 27.5 * u).lineTo(sway * 1.5, 31 * u);
  // body: lean and stretched, flexing a little with each stride
  const fl = 1 + 0.07 * Math.sin(ph * 2) * (1 - leap) + 0.08 * leap;
  g.lineStyle(1.2 * u, OUT, 1);
  g.beginFill(FUR).drawEllipse(0, 8 * u, 7.8 * u, 9 * u * fl).endFill();
  g.beginFill(FUR).drawEllipse(0, -4 * u, 7.2 * u, 9.5 * u * fl).endFill();
  g.lineStyle(0).beginFill(FUR).drawRect(-6.4 * u, -3 * u, 12.8 * u, 9 * u).endFill();
  g.beginFill(DARK, 0.6).drawEllipse(0, 3 * u, 2.6 * u, 13 * u).endFill();
  // head low and forward, ears back, muzzle long
  const hy = -15.5 * u - 1.2 * u * leap, hx = Math.sin(ph) * 0.6 * u * (1 - leap);
  g.lineStyle(1.1 * u, OUT, 1);
  for (const sd of [-1, 1]) { const ex = hx + sd * 4.6 * u, ey = hy + 2.6 * u;
    g.beginFill(DARK).drawPolygon([ex - sd * 2.2 * u, ey - 2 * u, ex + sd * 2 * u, ey - 1 * u, ex + sd * 1.2 * u, ey + 5 * u]).endFill(); }
  g.beginFill(FUR).drawEllipse(hx, hy, 5.8 * u, 6.2 * u).endFill();
  g.lineStyle(0).beginFill(DARK, 0.8).drawEllipse(hx, hy + 1.5 * u, 3 * u, 3.4 * u).endFill();
  const my = hy - 3.4 * u, mL = 9.5 * u, mW = 3.2 * u;
  g.lineStyle(1.1 * u, OUT, 1).beginFill(LIGHT).drawPolygon([hx - mW, my, hx + mW, my, hx + mW * 0.6, my - mL, hx - mW * 0.6, my - mL]).endFill();
  g.beginFill(LIGHT).drawEllipse(hx, my - mL, mW * 0.6, 1.5 * u).endFill();
  if (leap > 0.3) { // jaws open for the bite
    g.lineStyle(0).beginFill(0x3a0f12).drawPolygon([hx - mW * 0.5, my - mL * 0.35, hx + mW * 0.5, my - mL * 0.35, hx, my - mL * 0.95]).endFill();
    g.beginFill(0xffffff); for (const sd of [-1, 1]) g.drawPolygon([hx + sd * mW * 0.5, my - mL * 0.4, hx + sd * mW * 0.25, my - mL * 0.4, hx + sd * mW * 0.36, my - mL * 0.62]); g.endFill();
  }
  g.lineStyle(0).beginFill(0x111214).drawEllipse(hx, my - mL - 0.6 * u, 1.4 * u, 1.05 * u).endFill();
  for (const sd of [-1, 1]) g.beginFill(0xffc93c).drawEllipse(hx + sd * 2.7 * u, hy - 1.6 * u, 1.1 * u, 0.8 * u).endFill().beginFill(0x111111).drawCircle(hx + sd * 2.7 * u, hy - 1.6 * u, 0.4 * u).endFill();
}

/** Eight wolves appear one after another, clockwise, out of dark mist around his unit, throw back their heads and howl
 *  (rings of sound), then fade (David, 2026-11-10). */
function wolfPack(token) {
  const G = Math.min(token.w, token.h), u = G / 120 * 1.5, B = Blur(), ADD = PIXI.BLEND_MODES.ADD, c = token.center;
  const moon = new PIXI.Graphics().beginFill(0x9fc4ff, 0.13).drawCircle(0, 0, G * 1.5).endFill(); if (B) moon.filters = [new B(26)]; moon.blendMode = ADD;
  const ground = groundLayer(); ground.position.set(c.x, c.y); ground.addChild(moon);
  const wolves = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
    const ang = i * Math.PI / 4, R = G * (i % 2 ? 0.94 : 0.8);
    const root = new PIXI.Container(); root.position.set(c.x + Math.sin(ang) * R, c.y - Math.cos(ang) * R); root.rotation = ang; overLayer().addChild(root);
    const mist = new PIXI.Graphics().beginFill(0x1b2230, 0.75).drawCircle(0, 0, G * 0.3).endFill(); if (B) mist.filters = [new B(10)];
    const shadow = new PIXI.Graphics().beginFill(0x000000, 0.4).drawEllipse(0, 3 * u, 13 * u, 15 * u).endFill(); if (B) shadow.filters = [new B(4)];
    const g = new PIXI.Graphics(), rings = new PIXI.Graphics(); rings.blendMode = ADD; if (B) rings.filters = [new B(1.5)];
    root.addChild(mist, shadow, g, rings);
    return { root, mist, shadow, g, rings, delay: i * 0.1 };
  });
  return run((dt, a) => {
    moon.alpha = sm(a / 0.5) * (1 - sm((a - 2.8) / 0.6));
    for (const w of wolves) {
      const t = a - w.delay, appear = sm(t / 0.4), gone = sm((t - 2.75) / 0.5), h = sm((t - 0.55) / 0.4) * (1 - sm((t - 2.3) / 0.3));
      w.g.alpha = w.shadow.alpha = appear * (1 - gone);
      w.mist.alpha = Math.max(0, appear * (1 - sm((t - 0.3) / 0.5))) + gone * (1 - sm((t - 3.0) / 0.3)) * 0.8;
      w.g.scale.set(0.85 + 0.15 * appear);
      drawWolf(w.g, u, h, t);
      w.rings.clear();
      if (t > 0.9 && t < 2.5) {
        const hy = (-13 + 6) * u - 2 * u, env = sm((t - 0.9) / 0.2) * (1 - sm((t - 2.2) / 0.3));
        for (let r = 0; r < 3; r++) { const q = ((t - 0.9) / 0.75 + r / 3) % 1; w.rings.lineStyle((3.2 * (1 - q) + 0.8) * u * 0.6, 0xd8ecff, 0.85 * (1 - q) * env).drawCircle(0, hy, (4 + 30 * q) * u); }
      }
    }
    if (a < 4.3) return true;
    ground.destroy({ children: true }); for (const w of wolves) w.root.destroy({ children: true });
    return false;
  });
}

/** The hunt: six wolves circle the unit he picked, closing in, then pounce on it together ("Hunted"). */
export function playHunt(token, float) {
  if (!token || token.destroyed) return Promise.resolve();
  const G = Math.min(token.w, token.h), u = G / 120 * 1.5, B = Blur(), N = 6, CIRCLE = 2.2, c = token.center, k = G / 120;
  const ground = groundLayer(); ground.position.set(c.x, c.y);
  const mark = new PIXI.Graphics(); if (B) mark.filters = [new B(10)]; ground.addChild(mark);
  const over = new PIXI.Container(); overLayer().addChild(over);
  const flash = new PIXI.Graphics().beginFill(0xb01008).drawRoundedRect(-G / 2 + 4 * k, -G / 2 + 4 * k, G - 8 * k, G - 8 * k, G * 0.1).endFill(); flash.position.set(c.x, c.y); flash.alpha = 0; over.addChild(flash);
  const dust = new PIXI.Graphics(); dust.position.set(c.x, c.y); if (B) dust.filters = [new B(3)]; over.addChild(dust);
  const wolves = Array.from({ length: N }, (_, i) => {
    const root = new PIXI.Container(); over.addChild(root);
    const shadow = new PIXI.Graphics().beginFill(0x000000, 0.35).drawEllipse(0, 4 * u, 10 * u, 20 * u).endFill(); if (B) shadow.filters = [new B(4)];
    const g = new PIXI.Graphics(); root.addChild(shadow, g);
    return { root, g, off: i * Math.PI * 2 / N, ph: rnd(0, 6) }; // evenly spaced round the ring
  });
  const mesh = token.mesh, x0 = mesh?.position.x;
  let hit = -1;
  return run((dt, a) => {
    const close = sm(a / CIRCLE), spin = a * (1.6 + 1.4 * close), R0 = G * (1.85 - 0.9 * close);
    const ma = sm(a / 0.4) * (1 - sm((a - CIRCLE - 0.2) / 0.6));
    mark.clear().lineStyle(G * 0.35, 0x0d1018, 0.45 * ma).drawCircle(0, 0, R0);
    for (const w of wolves) {
      const th = w.off + spin; let R = R0, rot = th + Math.PI, sc = 1, al = sm(a / 0.35);
      const leap = sm((a - CIRCLE + 0.12) / 0.2);
      if (a > CIRCLE) { const p = Math.min(1, (a - CIRCLE) / 0.2); R = R0 + (G * 0.32 - R0) * sm(p); rot = th + Math.PI + (Math.PI / 2) * sm(p); sc = 1 + 0.35 * Math.sin(Math.PI * p); }
      if (a > CIRCLE + 0.45) al *= 1 - sm((a - CIRCLE - 0.45) / 0.5);
      w.root.position.set(c.x + Math.cos(th) * R, c.y + Math.sin(th) * R);
      w.root.rotation = rot; w.root.scale.set(sc); w.root.alpha = al;
      w.ph += dt * (13 + 9 * close);   // the stride quickens as they close
      drawWolfRun(w.g, u, w.ph, leap);
    }
    if (hit < 0 && a >= CIRCLE + 0.2) { hit = a; float?.("unitDamage", "Hunted"); }
    if (hit >= 0) {
      const q = a - hit, kk = Math.min(1, q / 0.7);
      flash.alpha = 0.5 * (1 - kk);
      dust.clear().lineStyle(8 * k * (1 - kk) + 1, 0xbdb39a, 0.6 * (1 - kk)).drawCircle(0, 0, G * 0.5 + G * 0.5 * kk);
      if (mesh && !mesh.destroyed && x0 !== undefined) mesh.position.x = x0 + (q < 0.4 ? Math.sin(q * 70) * 6 * k * (1 - q / 0.4) : 0);
    }
    if (a < CIRCLE + 1.2) return true;
    if (mesh && !mesh.destroyed && x0 !== undefined) mesh.position.x = x0;
    ground.destroy({ children: true }); over.destroy({ children: true });
    return false;
  });
}

/* ------------------------------------------------------------ Zhang Fei: Terror of Changban (David, 2026-11-11) */

/** His roar: he draws breath (shrinks, a red glow gathers), then swells as the screen shakes; the squares in reach
 *  (5 across + down) flash red and three diamond shockwaves roll out to the edge of that reach, with sound-wave arcs
 *  and a ring of dust. */
function roarOfChangban(token, reach = 5) {
  const G = Math.min(token.w, token.h), k = G / 120, ADD = PIXI.BLEND_MODES.ADD, BF = Blur(), c = token.center;
  const ground = groundLayer(); ground.position.set(c.x, c.y);
  const tint = new PIXI.Graphics(); ground.addChild(tint);
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++)
    if ((dx || dy) && Math.abs(dx) + Math.abs(dy) <= reach) tint.beginFill(0xc82814, 1).drawRect(dx * G - G / 2 + 1, dy * G - G / 2 + 1, G - 2, G - 2).endFill();
  tint.alpha = 0;
  const root = new PIXI.Container(); root.position.set(c.x, c.y); topLayer().addChild(root);
  const aura = new PIXI.Graphics(); aura.blendMode = ADD; if (BF) aura.filters = [new BF(14 * k)];
  aura.beginFill(0xff4620, 1).drawCircle(0, 0, G * 0.85).endFill(); aura.alpha = 0;
  const waves = new PIXI.Graphics(); if (BF) waves.filters = [new BF(2.5 * k)];
  const arcs = new PIXI.Graphics(), dust = new PIXI.Graphics(); if (BF) dust.filters = [new BF(3 * k)];
  root.addChild(aura, dust, waves, arcs);
  const mesh = token.mesh, s0x = mesh?.scale.x, s0y = mesh?.scale.y;
  const view = canvas.app.view, roarAt = 0.35;
  const diamond = (g, r, wob) => { for (let a = 0; a <= 64; a++) { const ang = a / 64 * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang), d = r / (Math.abs(cs) + Math.abs(sn)) * (1 + 0.025 * Math.sin(a * 7 + wob)); a ? g.lineTo(cs * d, sn * d) : g.moveTo(cs * d, sn * d); } g.closePath(); };
  return run((dt, t) => {
    // breath in, then the roar swells him
    let sc = t < roarAt ? 1 - 0.08 * (t / roarAt) : t < roarAt + 0.15 ? 0.92 + 0.28 * ((t - roarAt) / 0.15) : 1.2 - 0.2 * Math.min(1, (t - roarAt - 0.15) / 0.4);
    if (mesh && !mesh.destroyed && s0x) mesh.scale.set(s0x * sc, s0y * sc);
    aura.alpha = t < roarAt ? 0.55 * t / roarAt : Math.max(0, 0.55 * (1 - (t - roarAt) / 0.8));
    // the screen shakes for half a second
    const sk = t > roarAt && t < roarAt + 0.5 ? 1 - (t - roarAt) / 0.5 : 0;
    view.style.translate = sk ? `${(Math.sin(t * 90) * 7 * sk).toFixed(1)}px ${(Math.cos(t * 77) * 5 * sk).toFixed(1)}px` : "";
    tint.alpha = t < roarAt ? 0 : t < roarAt + 0.25 ? (t - roarAt) / 0.25 * 0.32 : Math.max(0, 0.32 * (1 - (t - roarAt - 0.25) / 1.6));
    waves.clear();
    for (let i = 0; i < 3; i++) {
      const q = (t - roarAt - i * 0.12) / 0.75; if (q < 0 || q > 1) continue;
      const r = G * 0.6 + q * (reach + 0.5) * G;
      waves.lineStyle((i ? 8 : 14) * k * (1 - q * 0.6), i ? 0xff7a45 : 0xffd9a8, (1 - q) * (i ? 0.7 : 1)); diamond(waves, r, t * 40);
    }
    arcs.clear();
    const sw = t - roarAt;
    if (sw > 0 && sw < 0.7) for (let i = 0; i < 4; i++) {
      const q = sw * 2.2 - i * 0.18; if (q < 0 || q > 1) continue;
      const r = G * 0.7 + q * G * 1.6;
      for (const dir of [0, Math.PI]) arcs.lineStyle(4 * k, 0xfff3e0, 1 - q).arc(0, -4 * k, r, dir - 0.5, dir + 0.5).moveTo(0, 0);
    }
    dust.clear();
    if (sw > 0 && sw < 1) for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + 0.3, d = G * 0.6 + sw * G * (2.2 + (i % 5) * 0.35);
      dust.beginFill(0xbea06e, 0.6 * (1 - sw)).drawCircle(Math.cos(a) * d, Math.sin(a) * d * 0.9, (5 + (i % 3) * 2 + sw * 6) * k).endFill();
    }
    if (t < roarAt + 1.9) return true;
    view.style.translate = "";
    if (mesh && !mesh.destroyed && s0x) mesh.scale.set(s0x, s0y);
    root.destroy({ children: true }); ground.destroy({ children: true });
    return false;
  });
}

/** Each unit the roar reached flinches; a spiked iron ring locks round it (red: lost the roll, gold: won) and
 *  "Can't move" floats up (its morale loss floats with the usual floats). */
export function playRooted(src, results, tokOf, float, reach = 5) {
  const marks = [];
  for (const [id, lost] of results) {
    const u = tokOf(id); if (!u || u.destroyed) continue;
    const G = Math.min(u.w, u.h), g = new PIXI.Graphics(); g.position.set(u.center.x, u.center.y); topLayer().addChild(g);
    // when the roar's shockwave reaches it (the roar started about a quarter second before this step)
    const d = src && !src.destroyed ? (Math.abs(u.center.x - src.center.x) + Math.abs(u.center.y - src.center.y)) / G : reach;
    marks.push({ id, u, g, G, lost, x0: u.mesh?.position.x, at: Math.max(0, 0.18 + d / reach * 0.55), shown: false });
  }
  if (!marks.length) return Promise.resolve();
  return run((dt, t) => {
    let busy = false;
    for (const m of marks) {
      const q = t - m.at; if (q < 0) { busy = true; continue; }
      if (!m.shown) { m.shown = true; float?.(m.id, m.lost ? "moraleDown" : "moraleUp", "Can't move"); }
      const { g, G } = m, k = G / 120, col = m.lost ? 0xff5a3c : 0xe8a23a, a = Math.min(1, q / 0.2) * (q < 1.4 ? 1 : Math.max(0, 1 - (q - 1.4) / 0.5));
      const mesh = m.u.mesh; if (mesh && !mesh.destroyed && m.x0 !== undefined) mesh.position.x = m.x0 + (q < 0.35 ? Math.sin(q * 70) * 6 * k * (1 - q / 0.35) : 0);
      g.clear().lineStyle(3 * k, col, a).drawCircle(0, 0, G * 0.52);
      for (let i = 0; i < 10; i++) { const ang = i / 10 * Math.PI * 2 + q * 0.4; g.moveTo(Math.cos(ang) * G * 0.52, Math.sin(ang) * G * 0.52).lineTo(Math.cos(ang) * G * 0.62, Math.sin(ang) * G * 0.62); }
      if (q < 1.9) busy = true;
    }
    if (busy) return true;
    for (const m of marks) { m.g.destroy(); const mesh = m.u.mesh; if (mesh && !mesh.destroyed && m.x0 !== undefined) mesh.position.x = m.x0; }
    return false;
  });
}


/* ------------------------------------------------------------ Cao Cao: The Hero Commands (David, 2026-11-11) */

// The cloths are drawn once into canvases and cut into strips (sprites) so they can wave. The clan character comes from
// the unit's faction banner: its centre panel (the same place on every RTK13-style banner), as fractions of the
// banner's opaque area.
const PANEL = [0.128, 0.125, 0.604, 0.804];
const HC_NAVY = "rgb(33,38,64)", HC_RED = "#8a1c18", HC_GOLD = "#e0b040", HC_BLACK = "#141414";
const HC_PAL = [[HC_NAVY, HC_RED, HC_GOLD], [HC_RED, HC_GOLD, HC_NAVY], [HC_BLACK, HC_RED, HC_GOLD], [HC_GOLD, HC_RED, HC_NAVY]];
const HC_KINDS = ["pennant", "swallow", "streamer", "flag", "stripes"];
const hcCloth = new Map();
/** One cloth (a canvas turned into a texture), cached by style, colours and banner. */
function clothTexture(kind, pal, panel) {
  const key = kind + pal.join() + (panel?.src ?? "");
  if (hcCloth.has(key)) return hcCloth.get(key);
  const [A, B, C] = pal, cv = document.createElement("canvas"), sizes = { hang: [240, 446], side: [270, 500], pennant: [200, 120], swallow: [220, 110], streamer: [260, 46], flag: [200, 140], stripes: [200, 150] };
  const [w, h] = sizes[kind]; cv.width = w; cv.height = h; const g = cv.getContext("2d");
  const drawPanel = (x, y, pw) => { if (panel) g.drawImage(panel.img, panel.x, panel.y, panel.w, panel.h, x, y, pw, pw * panel.h / panel.w); };
  if (kind === "hang") { // hanging banner: red border with gold studs, gold trim, swallowtail bottom
    const tail = h * 0.14, b = w * 0.09;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(w / 2, h - tail); g.lineTo(0, h); g.closePath(); g.fillStyle = HC_RED; g.fill();
    g.beginPath(); g.moveTo(b, b); g.lineTo(w - b, b); g.lineTo(w - b, h - b * 1.2); g.lineTo(w / 2, h - tail - b * 0.6); g.lineTo(b, h - b * 1.2); g.closePath(); g.fillStyle = HC_NAVY; g.fill();
    g.strokeStyle = HC_GOLD; g.lineWidth = 6; g.stroke();
    drawPanel(w * 0.16, h * 0.2, w * 0.68);
    g.fillStyle = HC_GOLD; for (let y = b * 1.5; y < h - tail - b; y += b * 1.4) for (const x of [b / 2, w - b / 2]) { g.beginPath(); g.arc(x, y, b * 0.18, 0, 7); g.fill(); }
  } else if (kind === "side") { // side banner: saw-tooth trim on the free edge and the bottom
    const body = w * 0.8, n = 7;
    g.fillStyle = HC_NAVY; g.fillRect(0, 0, body, h * 0.9); g.fillStyle = HC_RED;
    for (let i = 0; i < n; i++) { const y0 = i * h * 0.9 / n, y1 = (i + 1) * h * 0.9 / n; g.beginPath(); g.moveTo(body, y0); g.lineTo(w, (y0 + y1) / 2); g.lineTo(body, y1); g.fill(); }
    for (let i = 0; i < 4; i++) { const x0 = i * body / 4, x1 = (i + 1) * body / 4; g.beginPath(); g.moveTo(x0, h * 0.9); g.lineTo((x0 + x1) / 2, h); g.lineTo(x1, h * 0.9); g.fill(); }
    g.strokeStyle = HC_GOLD; g.lineWidth = 8; g.strokeRect(w * 0.05, w * 0.05, body - w * 0.1, h * 0.9 - w * 0.1);
    drawPanel(body * 0.1, h * 0.18, body * 0.8);
  } else if (kind === "pennant") { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h / 2); g.lineTo(0, h); g.closePath(); g.fillStyle = A; g.fill(); g.strokeStyle = C; g.lineWidth = 8; g.stroke();
    g.beginPath(); g.moveTo(0, h * 0.3); g.lineTo(w * 0.55, h / 2); g.lineTo(0, h * 0.7); g.fillStyle = B; g.fill();
  } else if (kind === "swallow") { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w * 0.72, h / 2); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = A; g.fill();
    g.fillStyle = B; g.fillRect(0, h * 0.38, w * 0.8, h * 0.24); g.strokeStyle = C; g.lineWidth = 6; g.stroke();
  } else if (kind === "streamer") { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h * 0.35); g.lineTo(w * 0.92, h / 2); g.lineTo(w, h * 0.65); g.lineTo(0, h); g.closePath(); g.fillStyle = B; g.fill();
    g.fillStyle = C; g.fillRect(0, h * 0.4, w * 0.85, h * 0.2);
  } else if (kind === "flag") { g.fillStyle = B; g.fillRect(0, 0, w, h); g.fillStyle = A; g.fillRect(14, 14, w - 28, h - 28); drawPanel((w - h * 0.62) / 2, h * 0.19, h * 0.62);
  } else { for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? B : A; g.fillRect(0, i * h / 5, w, h / 5); } g.strokeStyle = C; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  const tex = PIXI.Texture.from(cv); hcCloth.set(key, tex); return tex;
}
/** A cloth on a pole as strips: `vertical` strips wave up and down (a flag flying to the right), horizontal ones sway. */
function waving(tex, w, h, n, vertical) {
  const c = new PIXI.Container(), base = tex.baseTexture ?? tex, W = tex.width, H = tex.height, strips = [];
  for (let i = 0; i < n; i++) {
    const fr = vertical ? new PIXI.Rectangle(i * W / n, 0, W / n, H) : new PIXI.Rectangle(0, i * H / n, W, H / n);
    const sp = new PIXI.Sprite(new PIXI.Texture(base, fr));
    if (vertical) { sp.width = w / n + 0.6; sp.height = h; sp.x = i * w / n; } else { sp.width = w; sp.height = h / n + 0.6; sp.y = i * h / n; }
    c.addChild(sp); strips.push(sp);
  }
  c.qinWave = (t, amp, speed, ph) => strips.forEach((sp, i) => { const q = i / n; if (vertical) sp.y = Math.sin(q * 5 - t * speed + ph) * amp * q; else sp.x = Math.sin(t * 3.2 + q * 2.4) * amp * q; });
  return c;
}
const hcRnd = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };

/** His hanging banner is raised in the middle of his stand; then a wave of small flags and banners of mixed styles
 *  springs up over every tile in `reach` (2-3 per tile), rippling out from him, waves a moment and sinks away. Each
 *  allied unit he buffed (`touched`) is released as the wave reaches its tile: a column of gold light, its stand
 *  swells, its buff burst plays (with the Buff lands sound) and its gains float up. */
function heroCommands(token, touched = [], release = () => {}, reach = 4) {
  const G = Math.min(token.w, token.h), k = G / 120, ADD = PIXI.BLEND_MODES.ADD, BF = Blur(), c = token.center;
  const RAISE = [0.1, 0.55], UNROLL = [0.5, 0.8], WAVE0 = 0.95, RING = 0.16, LIVE = 1.5;
  const ringAt = (d) => WAVE0 + (d - 1) * RING, END = ringAt(reach) + LIVE + 0.8;
  const ground = groundLayer(); ground.position.set(c.x, c.y); ground.sortableChildren = true;
  const root = new PIXI.Container(); root.position.set(c.x, c.y); topLayer().addChild(root);
  const glow = new PIXI.Graphics(); glow.blendMode = ADD; if (BF) glow.filters = [new BF(16 * k)];
  glow.beginFill(0xffc846, 1).drawCircle(0, 0, G * 0.95).endFill(); glow.alpha = 0;
  const mast = new PIXI.Container(); root.addChild(glow, mast);
  // the central banner and the small flags, built once the faction banner's picture is in
  const hs = k * 1.6, hang = { pole: new PIXI.Graphics(), cloth: null, bar: new PIXI.Graphics(), tassels: new PIXI.Graphics() };
  mast.addChild(hang.pole, hang.bar, hang.tassels);
  const flags = [];
  const fac = factionOf(token.actor?.system?.faction);
  (async () => {
    let panel = null;
    if (fac?.img) try {
      const [img, info] = await Promise.all([new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = fac.img; }), analyseFlag(fac.img)]);
      const [x0, y0, w0, h0] = info?.rect ?? [0, 0, img.naturalWidth, img.naturalHeight];
      panel = { img, src: fac.img, x: x0 + PANEL[0] * w0, y: y0 + PANEL[1] * h0, w: (PANEL[2] - PANEL[0]) * w0, h: (PANEL[3] - PANEL[1]) * h0 };
    } catch { /* no picture: plain cloths */ }
    if (mast.destroyed) return;
    hang.cloth = waving(clothTexture("hang", HC_PAL[0], panel), 56 * hs, 104 * hs, 30, false); mast.addChildAt(hang.cloth, 1);
    // 2-3 per tile in reach, each a little offset in place and time; the same every time
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      const d = Math.abs(dx) + Math.abs(dy); if (!d || d > reach) continue;
      const tx = Math.round(c.x / G) * 1000 + dx, ty = Math.round(c.y / G) * 1000 + dy, n = 2 + Math.floor(hcRnd(tx * 31 + ty * 7) * 2);
      for (let j = 0; j < n; j++) {
        const r = (q) => hcRnd(tx * 101 + ty * 37 + j * 13 + q);
        const kind = r(4) < 0.18 ? "side" : HC_KINDS[Math.floor(r(5) * HC_KINDS.length)], pal = HC_PAL[Math.floor(r(6) * HC_PAL.length)];
        const s = k * (0.42 + 0.22 * r(7)), poleH = (kind === "side" ? 150 : 85 + 50 * r(8)) * s;
        const tex = clothTexture(kind, kind === "side" ? HC_PAL[0] : pal, panel);
        const w = kind === "side" ? 64 * s : tex.width * 0.3 * s, h = kind === "side" ? 118 * s : tex.height * 0.3 * s;
        const box = new PIXI.Container(); box.position.set((dx - 0.5 + 0.15 + 0.62 * r(1)) * G, (dy - 0.5 + 0.55 + 0.4 * r(2)) * G); box.zIndex = box.y; box.scale.y = 0;
        const pole = new PIXI.Graphics().beginFill(0x3a2a18).drawRect(-1.2 * k, -poleH, 2.4 * k, poleH).endFill().beginFill(0xd8b040).drawCircle(0, -poleH - 1.5 * s, 2.8 * s).endFill();
        const cl = waving(tex, w, h, 10, true); cl.position.set(1.2 * k, -poleH + 2 * s);
        box.addChild(pole, cl); ground.addChild(box);
        flags.push({ box, cl, at: ringAt(d) + r(3) * 0.12, ph: r(9) * 6, amp: (kind === "side" ? 4 : 3) * s, speed: kind === "streamer" ? 10 : 8 });
      }
    }
  })();
  // the allies it reaches, and when
  const hits = touched.map(id => canvas.tokens?.get(id)).filter(u => u && !u.destroyed).map(u => {
    const d = Math.round((Math.abs(u.center.x - c.x) + Math.abs(u.center.y - c.y)) / G);
    const col = new PIXI.Graphics(); col.blendMode = ADD; if (BF) col.filters = [new BF(6 * k)]; col.alpha = 0;
    col.position.set(u.center.x, u.center.y); topLayer().addChild(col);
    for (let j = 0; j < 12; j++) col.beginFill(0xffd25a, 0.07 + j * 0.022).drawRect(-G * 0.38, G * 0.5 - (j + 1) * G * 2.2 / 12, G * 0.76, G * 2.2 / 12).endFill();
    return { u, col, at: ringAt(Math.max(1, d)) + 0.12, done: false };
  });
  const swell = (stand, sc) => { if (stand && !stand.destroyed) { const t = stand.parent; stand.pivot.set(t.w / 2, t.h / 2); stand.position.set(t.w / 2, t.h / 2); stand.scale.set(sc); } };
  return run((dt, t) => {
    glow.alpha = (t < 0.6 ? 0.5 * t / 0.6 : Math.max(0.1, 0.5 * (1 - (t - 0.6) / 1.4))) * (t > END - 0.5 ? Math.max(0, (END - t) / 0.5) : 1);
    // the central banner: the pole rises from the middle of his stand, the cloth unrolls from the crossbar
    const rise = ease((t - RAISE[0]) / (RAISE[1] - RAISE[0])), unroll = ease((t - UNROLL[0]) / (UNROLL[1] - UNROLL[0]));
    const foot = G * 0.3, poleH = 150 * hs * rise, top = foot - poleH + 8 * hs, w = 56 * hs;
    hang.pole.clear(); hang.bar.clear(); hang.tassels.clear();
    if (rise > 0) hang.pole.beginFill(0x3a2a18).drawRect(-1.5 * hs, foot - poleH, 3 * hs, poleH).endFill().beginFill(0xd8b040).drawCircle(0, foot - poleH - 3 * hs, 4 * hs).endFill();
    if (unroll > 0) {
      hang.bar.beginFill(0x3a2a18).drawRect(-w / 2 - 5 * hs, top - 3 * hs, w + 10 * hs, 3 * hs).endFill().beginFill(0xd8b040).drawCircle(-w / 2 - 5 * hs, top - 1.5 * hs, 3 * hs).drawCircle(w / 2 + 5 * hs, top - 1.5 * hs, 3 * hs).endFill();
      for (const x of [-w / 2 - 5 * hs, w / 2 + 5 * hs]) hang.tassels.lineStyle(2 * hs, 0xc8302a).moveTo(x, top).lineTo(x + Math.sin(t * 3) * 2 * hs, top + 14 * hs);
    }
    if (hang.cloth) { hang.cloth.visible = unroll > 0; hang.cloth.position.set(-w / 2, top); hang.cloth.qinWave(t, 5 * hs, 0, 0);
      const m = hang.cloth.mask ?? (hang.cloth.mask = new PIXI.Graphics()); if (!m.parent) mast.addChild(m);
      m.clear().beginFill(0xffffff).drawRect(-w, top - 2, w * 2, 104 * hs * unroll + 4).endFill(); }
    mast.alpha = t > END - 0.5 ? Math.max(0, (END - t) / 0.5) : 1;
    // the wave of small flags: each springs up with a little overshoot, waves, then sinks away
    for (const f of flags) {
      const q = t - f.at; if (q < 0) continue;
      const grow = q < 0.2 ? ease(q / 0.2) * 1.1 : q < 0.3 ? 1.1 - 0.1 * ((q - 0.2) / 0.1) : 1, out = q > LIVE ? Math.max(0, 1 - (q - LIVE) / 0.4) : 1;
      f.box.scale.y = grow * (0.6 + 0.4 * out); f.box.alpha = out; f.cl.qinWave(t, f.amp, f.speed, f.ph);
    }
    // the allies: released as the wave reaches their tile
    for (const h of hits) {
      const q = t - h.at; if (q < 0) continue;
      if (!h.done) { h.done = true; release([h.u.id]); floatLocal({ x: h.u.center.x, y: h.u.center.y - G * 0.5 }, "xp", "Attack +5"); setTimeout(() => floatLocal({ x: h.u.center.x, y: h.u.center.y - G * 0.2 }, "surrounded", "Move +1 · Morale ≥ 10"), atSpeed(120)); }
      h.col.alpha = q < 0.15 ? q / 0.15 : Math.max(0, 1 - (q - 0.15) / 0.75);
      swell(h.u.qinUnitBars, 1 + 0.12 * Math.sin(Math.min(1, q / 0.3) * Math.PI));
    }
    if (t < END) return true;
    for (const h of hits) { swell(h.u.qinUnitBars, 1); h.col.destroy(); if (!h.done) release([h.u.id]); }
    root.destroy({ children: true }); ground.destroy({ children: true });
    return false;
  });
}
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);

/* ------------------------------------------------------------ Restore the Han (peach garden) */

const PEACH_TREE = "modules/qin-3k-characters/art/fx/peach-tree.webp";
/** The trunk's foot in the picture (fraction of width, height), and the tree's width in squares. */
const PT_AX = 0.205, PT_AY = 0.955, PT_W = 3.5;
let peachArt = null;
/** The tree picture as a texture, plus spots on its blossoms (for petals to fall from) with their colours. */
function loadPeach() {
  if (peachArt) return peachArt;
  peachArt = new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight, spots = [];
      try {
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data, step = Math.max(2, Math.round(w / 300));
        for (let y = 0; y < h * 0.75; y += step) for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4; if (d[i + 3] > 220 && d[i] > 190 && d[i + 1] < 185 && d[i] - d[i + 2] > 25) spots.push([x / w, y / h, (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]]);
        }
      } catch { /* no spots: petals fall from the crown's middle */ }
      res({ tex: PIXI.Texture.from(img), w, h, spots });
    };
    img.onerror = () => res(null);
    img.src = PEACH_TREE;
  });
  return peachArt;
}
globalThis.Hooks?.once?.("canvasReady", () => loadPeach());

const gardenCache = new Map();
/** One square of peach garden: a soft green glow, grass blades, small flowers and a few fallen petals (4 variants). */
function gardenTexture(G, v) {
  const key = Math.round(G) + ":" + v; if (gardenCache.has(key)) return gardenCache.get(key);
  const S = Math.round(G * 1.6), cv = document.createElement("canvas"); cv.width = cv.height = S; const c = cv.getContext("2d"), o = G * 0.3, r = (n) => hcRnd(v * 997 + n);
  const gr = c.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, G * 0.8);
  gr.addColorStop(0, "rgba(120,200,90,.5)"); gr.addColorStop(0.7, "rgba(110,190,80,.28)"); gr.addColorStop(1, "rgba(110,190,80,0)"); c.fillStyle = gr; c.fillRect(0, 0, S, S);
  for (let j = 0; j < 12; j++) { c.save(); c.translate(o + G * (-0.04 + 1.08 * r(j * 7 + 1)), o + G * (-0.04 + 1.08 * r(j * 7 + 2))); c.rotate(r(j * 7 + 3) * 6); c.globalAlpha = 0.85; c.fillStyle = r(j * 7 + 4) < 0.5 ? "#ffe3ec" : "#f8b9cc"; c.beginPath(); c.ellipse(0, 0, G * 0.036, G * 0.021, 0, 0, 7); c.fill(); c.restore(); }
  const GREENS = ["#2f6e24", "#3f8a2c", "#58a83a", "#79c44e", "#96d660"]; c.lineCap = "round";
  for (let j = 0; j < 38; j++) { const q = (n) => r(500 + j * 11 + n), gx = o + G * (-0.06 + 1.12 * q(1)), gy = o + G * (-0.02 + 1.06 * q(2)), hgt = G * (0.07 + 0.1 * q(3)), sw = (q(4) - 0.5) * G * 0.06;
    c.strokeStyle = GREENS[Math.floor(q(5) * GREENS.length)]; c.lineWidth = G * (0.017 + 0.007 * q(6)); c.beginPath(); c.moveTo(gx, gy); c.quadraticCurveTo(gx + sw * 0.3, gy - hgt * 0.6, gx + sw, gy - hgt); c.stroke(); }
  for (let j = 0; j < 4; j++) { const q = (n) => r(900 + j * 13 + n), fx = o + G * (0.08 + 0.84 * q(1)), fy = o + G * (0.12 + 0.84 * q(2)), sh = G * (0.08 + 0.06 * q(3)), fr = G * (0.042 + 0.02 * q(4));
    c.strokeStyle = "#3f8a2c"; c.lineWidth = G * 0.015; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, fy - sh); c.stroke();
    c.fillStyle = ["#ffd0de", "#fff6f9", "#f9a8c0", "#fff1b8"][Math.floor(q(5) * 4)];
    for (let p = 0; p < 5; p++) { const an = q(6) * 6 + p / 5 * 6.283; c.beginPath(); c.ellipse(fx + Math.cos(an) * fr * 0.62, fy - sh + Math.sin(an) * fr * 0.62, fr * 0.55, fr * 0.38, an, 0, 7); c.fill(); }
    c.fillStyle = "#e0558a"; c.beginPath(); c.arc(fx, fy - sh, fr * 0.26, 0, 7); c.fill(); }
  const tex = PIXI.Texture.from(cv); gardenCache.set(key, tex); return tex;
}

/** Restore the Han: the tree grows from the middle of the square to his left (drawn over everything), its shadow
 *  leaning right across his unit; the garden spreads ring by ring over `reach`; petals let go of the blossoms, tumble
 *  down and settle on the grass. Each ally he buffed (`touched`) is released as the garden reaches it. */
function peachGarden(token, touched = [], release = () => {}, reach = 4) {
  const G = Math.min(token.w, token.h), k = G / 120, ADD = PIXI.BLEND_MODES.ADD, BF = Blur(), c = token.center;
  const TRUNK = 0.25, GROW = 1.1, GARDEN = 1.35, RING = 0.16, LIVE = 2.4;
  const ringAt = (d) => (d ? GARDEN + (d - 1) * RING : GARDEN - 0.15), END = ringAt(reach) + LIVE + 0.7;
  const back = (x) => { x = Math.max(0, Math.min(1, x)); return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2; };
  const bx = c.x - G, by = c.y, TW = G * PT_W;
  // the garden, square by square, on the ground under the units
  const ground = groundLayer(); const patches = [];
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    const d = Math.abs(dx) + Math.abs(dy); if (d > reach) continue;
    const tx = Math.round(c.x / G) + dx, ty = Math.round(c.y / G) + dy, sp = new PIXI.Sprite(gardenTexture(G, Math.floor(hcRnd(tx * 31 + ty * 17) * 4)));
    sp.anchor.set(0.5); sp.position.set(c.x + dx * G, c.y + dy * G); sp.alpha = 0; ground.addChild(sp); patches.push({ sp, at: ringAt(d) });
  }
  // above the units: the tree's shadow, the tree, its glow, the petals
  const root = new PIXI.Container(); topLayer().addChild(root);
  const tree = { shadow: null, sprite: null, glow: null, tw: 0, th: 0, spots: [] }, petals = [];
  loadPeach().then(art => {
    if (root.destroyed || !art) return;
    const fs = TW / art.w; tree.tw = TW; tree.th = art.h * fs; tree.spots = art.spots; tree.fs = fs;
    tree.shadow = new PIXI.Sprite(art.tex); tree.shadow.tint = 0x000000; if (BF) tree.shadow.filters = [new BF(5 * k)];
    tree.sprite = new PIXI.Sprite(art.tex); tree.glow = new PIXI.Sprite(art.tex); tree.glow.blendMode = ADD; if (BF) tree.glow.filters = [new BF(10 * k)];
    for (const s of [tree.shadow, tree.sprite, tree.glow]) { s.anchor.set(PT_AX, PT_AY); s.position.set(bx, by); s.scale.set(0); s.alpha = 0; }
    const pet = new PIXI.Container(); root.addChild(tree.shadow, tree.sprite, tree.glow, pet);
    // petals: each lets go of a blossom, falls with a little sway and drift, settles under the crown and fades
    for (let i = 0; i < 150; i++) {
      const r = (q) => hcRnd(i * 53 + q), spot = art.spots.length ? art.spots[Math.floor(r(2) * art.spots.length)] : [0.5, 0.35, 0xf4a0c0];
      const x0 = bx + (spot[0] - PT_AX) * TW, y0 = by + (spot[1] - PT_AY) * tree.th;
      const land = Math.max(y0 + G * 0.35, by - G * 0.35 + r(3) * G * 1.1), v = G * (0.45 + 0.3 * r(4));
      const z = (0.5 + 0.35 * r(9)) * k * 1.6, g = new PIXI.Graphics();
      g.beginFill(spot[2]).lineStyle(0.6 * k, 0x3c0a1e, 0.45).moveTo(0, -5 * z).bezierCurveTo(4.6 * z, -4 * z, 4 * z, 3 * z, 0, 5 * z).bezierCurveTo(-4 * z, 3 * z, -4.6 * z, -4 * z, 0, -5 * z).endFill();
      g.beginFill(0xffffff, 0.5).lineStyle(0).drawEllipse(0, -2.4 * z, 2 * z, 2.2 * z).endFill();
      g.visible = false; pet.addChild(g);
      petals.push({ g, st: 1.15 + r(1) * 3.3, x0, y0, v, fall: (land - y0) / v, drift: G * (0.12 + 0.15 * r(5)), ph: r(6) * 6, rot: r(7) * 6, i });
    }
  });
  // the allies it reaches, and when
  const hits = touched.map(id => canvas.tokens?.get(id)).filter(u => u && !u.destroyed).map(u => {
    const d = Math.round((Math.abs(u.center.x - c.x) + Math.abs(u.center.y - c.y)) / G);
    const col = new PIXI.Graphics(); col.blendMode = ADD; if (BF) col.filters = [new BF(6 * k)]; col.alpha = 0;
    col.position.set(u.center.x, u.center.y); topLayer().addChild(col);
    for (let j = 0; j < 12; j++) col.beginFill(0xffa8c8, 0.07 + j * 0.022).drawRect(-G * 0.38, G * 0.5 - (j + 1) * G * 2.2 / 12, G * 0.76, G * 2.2 / 12).endFill();
    return { u, col, at: ringAt(Math.max(1, d)) + 0.2, done: false };
  });
  const swell = (stand, sc) => { if (stand && !stand.destroyed) { const t = stand.parent; stand.pivot.set(t.w / 2, t.h / 2); stand.position.set(t.w / 2, t.h / 2); stand.scale.set(sc); } };
  return run((dt, t) => {
    const fadeAll = t > END - 0.7 ? Math.max(0, (END - t) / 0.7) : 1;
    for (const p of patches) { const q = t - p.at; if (q < 0) continue; const g = Math.min(1, q / 0.45), out = q > LIVE ? Math.max(0, 1 - (q - LIVE) / 0.7) : 1;
      p.sp.alpha = g * out * fadeAll; p.sp.scale.set(0.85 + 0.15 * ease(g)); }
    if (tree.sprite) {
      const g = Math.max(0, Math.min(1, (t - TRUNK) / GROW)), s = g <= 0 ? 0 : (0.05 + 0.95 * back(g)) * tree.fs, sway = Math.sin(t * 1.3) * 0.012 * Math.min(1, Math.max(0, t - TRUNK) / 1.2);
      const a = fadeAll * Math.min(1, g * 3), fl = t - (TRUNK + 0.9), glow = fl < 0 ? 0 : fl < 0.25 ? fl / 0.25 : Math.max(0.18, 1 - (fl - 0.25) / 0.8);
      for (const sp of [tree.sprite, tree.glow]) { sp.scale.set(s); sp.rotation = sway; }
      tree.sprite.alpha = a; tree.glow.alpha = a * 0.35 * glow;
      // the shadow: the tree laid on the ground, leaning right
      tree.shadow.transform.setFromMatrix(new PIXI.Matrix(s, 0, -0.75 * s, -0.6 * s, bx, by)); tree.shadow.alpha = a * 0.55;
    }
    for (const p of petals) {
      const s0 = t - p.st; if (s0 < 0 || s0 > p.fall + 0.7) { p.g.visible = false; continue; }
      const f = Math.min(s0, p.fall), falling = s0 < p.fall;
      p.g.visible = true; p.g.position.set(p.x0 + f * p.drift + Math.sin(f * 3.2 + p.ph) * G * 0.08 * Math.min(1, f * 2), p.y0 + p.v * f);
      p.g.rotation = (falling ? s0 : p.fall) * 2.6 + p.rot; p.g.scale.y = falling ? 0.3 + 0.7 * Math.abs(Math.cos(s0 * 5 + p.i)) : 0.55;
      p.g.alpha = fadeAll * (s0 < 0.15 ? s0 / 0.15 : 1) * (falling ? 1 : 1 - (s0 - p.fall) / 0.7);
    }
    for (const h of hits) {
      const q = t - h.at; if (q < 0) continue;
      if (!h.done) { h.done = true; release([h.u.id]); floatLocal({ x: h.u.center.x, y: h.u.center.y - G * 0.5 }, "xp", "Attack +3 · Melee def +3"); setTimeout(() => floatLocal({ x: h.u.center.x, y: h.u.center.y - G * 0.2 }, "surrounded", "Morale ≥ 5"), atSpeed(120)); }
      h.col.alpha = q < 0.15 ? q / 0.15 : Math.max(0, 1 - (q - 0.15) / 0.75);
      swell(h.u.qinUnitBars, 1 + 0.12 * Math.sin(Math.min(1, q / 0.3) * Math.PI));
    }
    if (t < END) return true;
    for (const h of hits) { swell(h.u.qinUnitBars, 1); h.col.destroy(); if (!h.done) release([h.u.id]); }
    root.destroy({ children: true }); ground.destroy({ children: true });
    return false;
  });
}

/* ------------------------------------------------------------ registry */

/** Special animations played when a tier 1+ active is used, by the active's name. */
const ON_ACTIVATE = {
  "Might That Shakes the Realm": (token) => groundCrack(token),
  "None Can Stand Before Him": (token) => fireEruption(token),
  "Stone Sentinel Maze": (token) => eightTrigrams(token),
  "The Wolf Bares His Fangs": (token) => wolfPack(token),
  "Terror of Changban": (token) => roarOfChangban(token, 5),
};
/** Animations that release the units the active touched themselves, as their effect reaches them. */
const ON_ACTIVATE_SPREAD = {
  "The Hero Commands": (token, touched, release) => heroCommands(token, touched, release, 4),
  "Until the Day of Death Comes": (token, touched, release) => peachGarden(token, touched, release, 4),
  "Restore the Han": (token, touched, release) => peachGarden(token, touched, release, 4), // its old name (cards not yet updated)
  // the units it holds are released by the stones (playSentinels), not at the end of the banner
  "Stone Sentinel Maze": (token) => eightTrigrams(token),
};
/** An attack made while one of these actives is on plays its own strike alongside the lunge. */
const ON_ATTACK = { "None Can Stand Before Him": playSkyPiercer };
/** A skill's contested rolls on several units at once (David, 2026-11-09), by the skill's name. */
const ON_CONTEST = {
  "Terror of the Battlefield": (token, results, tokOf, float) => playTerror(token, results, tokOf, float),
  // the stones rise once the trigrams have turned a while (they start as the banner's dark lifts, about 0.25 s before this)
  "Stone Sentinel Maze": (token, results, tokOf, float) => new Promise(r => setTimeout(r, atSpeed(STONES_AFTER * 1000 - 250))).then(() => playSentinels(results, tokOf, float)),
  "Terror of Changban": (token, results, tokOf, float) => playRooted(token, results, tokOf, float, 5),
  // the hunt starts as the howl dies away
  "The Wolf Bares His Fangs": (token, results, tokOf, float) => new Promise(r => setTimeout(r, atSpeed(3200)))
    .then(() => Promise.all(results.map(([id]) => playHunt(tokOf(id), (st, tx) => float?.(id, st, tx))))),
};
export function playUniqueContest(skill, token, results, tokOf, float) {
  const fn = ON_CONTEST[skill];
  return fn ? fn(token, results, tokOf, float) : null;
}
export function playUniqueAttack(skill, attacker, defender) {
  const fn = ON_ATTACK[skill];
  return fn ? fn(attacker, defender) : null;
}
export function playUniqueActivation(st, token, release = null) {
  const spread = ON_ACTIVATE_SPREAD[st?.skill];
  if (spread && token && !token.destroyed && release) return { releases: true, done: spread(token, st.touched ?? [], release) };
  const fn = ON_ACTIVATE[st?.skill];
  if (fn && token && !token.destroyed) return fn(token);
  return null;
}
