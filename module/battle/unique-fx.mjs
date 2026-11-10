// Special animations for tier 1+ battlefield actives (David, 2026-11-09): each such officer can have his own. They are
// keyed by the active's name. So far: Guan Yu's Might That Shakes the Realm — the ground cracks around his unit as the
// buff lands, and while it lasts the Green Dragon Crescent Blade sweeps a full circle after each of his attacks.
// Lu Bu's None Can Stand Before Him — a ring of fire bursts out around him, and while it lasts the Sky Piercer drives
// through each target as its shield shatters; his Terror of the Battlefield — a dread pulse at the end of his turn
// (who flinched, who resisted) and ANOTHER TURN when a rout earns him one.
import { atSpeed } from "./battle-speed.mjs";
import { overLayer } from "../attack-fx.mjs";
import { playMoment } from "../sound.mjs";

const rnd = (a, b) => a + Math.random() * (b - a);
const Blur = () => PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;

/** Run draw(dt seconds, elapsed seconds) every frame until it returns false. */
function run(step) {
  return new Promise(resolve => {
    let t = 0;
    const tick = () => {
      const dt = canvas.app.ticker.deltaMS / 1000 * (atSpeed(1000) ? 1000 / atSpeed(1000) : 1);
      t += dt;
      let more = false;
      try { more = step(dt, t); } catch (e) { console.warn("Qin | special animation", e); }
      if (!more) { canvas.app.ticker.remove(tick); resolve(); }
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

/** The ground splits all at once around the unit — evenly long cracks, dust pushed out in a ring, dust rising from the
 *  cracks and chips of earth thrown up — then it all fades. */
function groundCrack(token) {
  const G = Math.min(token.w, token.h), k = G / 120, half = G / 2 - G * 0.03;
  const root = groundLayer(); root.position.set(token.center.x, token.center.y);
  const paths = [];
  const walk = (x, y, ang, len, w, depth) => {
    const pts = [[x, y]]; let a = ang, d = 0;
    while (d < len) {
      const st = rnd(6, 11) * k; a += rnd(-0.4, 0.4); a += (ang - a) * 0.25;
      x += Math.cos(a) * st; y += Math.sin(a) * st; d += st; pts.push([x, y]);
      if (depth < 2 && Math.random() < 0.16) walk(x, y, a + rnd(-1, 1), len * rnd(0.3, 0.45), w * 0.6, depth + 1);
    }
    paths.push({ pts, w, depth });
  };
  for (let i = 0, n = 12; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.12, 0.12), r = half / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    walk(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, a, rnd(92, 106) * k, rnd(3.5, 4.5) * k, 0);
  }
  const B = Blur();
  const ground = new PIXI.Graphics(), dark = new PIXI.Graphics(), lip = new PIXI.Graphics(), glow = new PIXI.Graphics(), ring = new PIXI.Graphics();
  if (B) { glow.filters = [new B(4 * k)]; ground.filters = [new B(6 * k)]; ring.filters = [new B(10 * k)]; }
  for (const p of paths) for (let i = 1; i < p.pts.length; i++) {
    const tp = 1 - i / p.pts.length, [a, b] = [p.pts[i - 1], p.pts[i]];
    ground.lineStyle(p.w * tp * 5 + 6 * k, 0x2a2212, 0.35).moveTo(...a).lineTo(...b);        // disturbed earth along it
    glow.lineStyle(p.w * tp * 2.4 + 2 * k, 0xffd27a, 1).moveTo(...a).lineTo(...b);
    lip.lineStyle(p.w * tp + 2 * k, 0x9a8a64, 0.75).moveTo(a[0] + k, a[1] + k).lineTo(b[0] + k, b[1] + k);
    dark.lineStyle(Math.max(0.8, p.w * tp), 0x120d07, 1).moveTo(...a).lineTo(...b);
  }
  const dust = new PIXI.Container(); if (B) dust.filters = [new B(4 * k)];
  const puffs = [], mains = paths.filter(p => p.depth === 0);
  for (let i = 0; i < 80; i++) {
    const p = mains[i % mains.length], [x, y] = p.pts[Math.floor(rnd(0.15, 1) * (p.pts.length - 1))], d = Math.hypot(x, y) || 1;
    const g = new PIXI.Graphics().beginFill(0xc4b08a, 1).drawCircle(0, 0, 1).endFill(); dust.addChild(g);
    puffs.push({ g, x, y, delay: (d - half) / (600 * k) + rnd(0, 0.12), size: rnd(3, 6) * k, grow: rnd(2, 3), vx: x / d * rnd(4, 14) * k, vy: -rnd(10, 26) * k, life: rnd(1, 1.6), a0: rnd(0.25, 0.42) });
  }
  const chips = [];
  root.addChild(ground, ring, glow, lip, dark, dust);
  for (let i = 0; i < 18; i++) {
    const a = rnd(0, Math.PI * 2), r = half * rnd(1, 1.3);
    const c = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0x3a3020 : 0x6b5a3c).drawPolygon([0, -3 * k, 3 * k, 0, k, 3 * k, -3 * k, k]).endFill();
    c.position.set(Math.cos(a) * r, Math.sin(a) * r); root.addChild(c);
    chips.push({ c, x: c.x, y: c.y, vx: Math.cos(a) * rnd(40, 110) * k, vy: (Math.sin(a) * rnd(20, 60) - rnd(80, 160)) * k, rot: rnd(-8, 8) });
  }
  return run((dt, t) => {
    glow.alpha = 0.6 * Math.max(0, 1 - t / 0.6);
    const fade = t < 1.3 ? 1 : Math.max(0, 1 - (t - 1.3) / 0.8);
    for (const o of [ground, dark, lip]) o.alpha = fade;
    const rk = Math.min(1, t / 0.7), R = half + G * 1.6 * (1 - (1 - rk) ** 2);
    ring.clear().lineStyle(G * 0.28 * (1 - rk * 0.5), 0xb7a27c, 0.45 * (1 - rk)).drawEllipse(0, 0, R, R * 0.92);
    for (const q of puffs) {
      const kk = (t - q.delay) / q.life;
      if (kk <= 0 || kk >= 1) { q.g.alpha = 0; continue; }
      q.g.position.set(q.x + q.vx * kk * q.life, q.y + q.vy * kk * q.life); q.g.scale.set(q.size * (1 + (q.grow - 1) * Math.sqrt(kk)));
      q.g.alpha = q.a0 * (kk < 0.15 ? kk / 0.15 : 1 - (kk - 0.15) / 0.85);
    }
    for (const ch of chips) { const kk = Math.min(t, 0.9); ch.c.position.set(ch.x + ch.vx * kk, ch.y + ch.vy * kk + 260 * k * kk * kk); ch.c.rotation = ch.rot * kk; ch.c.alpha = Math.max(0, 1 - t / 0.9); }
    if (t < 2.3) return true;
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


/* ------------------------------------------------------------ ring of fire (Lu Bu, on activation) */

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

/** Fire bursts off his square and races out into a ring a little under two squares wide, burns, and dies down, leaving
 *  scorched ground (David, 2026-11-09). */
function ringOfFire(token) {
  const G = Math.min(token.w, token.h), k = G / 120, R = G * 1.75, ADD = PIXI.BLEND_MODES.ADD, B = Blur();
  const ground = groundLayer(); ground.position.set(token.center.x, token.center.y);
  const burn = new PIXI.Graphics(); if (B) burn.filters = [new B(16 * k)]; ground.addChild(burn);
  const over = new PIXI.Container(); over.position.set(token.center.x, token.center.y); overLayer().addChild(over);
  const smokeL = new PIXI.Container(), glowL = new PIXI.Container(), fireL = new PIXI.Container(); over.addChild(smokeL, glowL, fireL);
  const FLAME = flameTexture(), SMOKE = softTexture("smoke", "rgba(40,22,18,0.9)"), GLOW = softTexture("glow", "rgba(255,120,40,1)");
  const hot = new PIXI.Sprite(GLOW); hot.anchor.set(0.5); hot.blendMode = ADD; glowL.addChild(hot);
  const radAt = (t) => t < 0.35 ? G * 0.5 + (R - G * 0.5) * (1 - (1 - t / 0.35) ** 3) : R;   // bursts out, then holds
  const SPAWN_END = 1.55, parts = [], embers = [];
  let acc = 0, sacc = 0, eacc = 0;
  const spawn = (t, smoke) => {
    const th = rnd(0, Math.PI * 2), r = radAt(t) + rnd(-G * 0.12, G * 0.12);
    const sp = new PIXI.Sprite(smoke ? SMOKE : FLAME); sp.anchor.set(0.5, 0.92); if (!smoke) sp.blendMode = ADD;
    (smoke ? smokeL : fireL).addChild(sp);
    parts.push({ sp, smoke, x: Math.cos(th) * r, y: Math.sin(th) * r, vx: Math.cos(th) * rnd(4, 14) * k, vy: -rnd(smoke ? 25 : 35, smoke ? 45 : 80) * k,
      life: smoke ? rnd(1, 1.6) : rnd(0.45, 0.85), t: 0, sz: (smoke ? rnd(0.7, 1.2) : rnd(0.45, 0.85)) * k, sway: rnd(0, 6), flip: Math.random() < 0.5 ? -1 : 1 });
  };
  for (let i = 0; i < 16; i++) { // a flare off the edges of his own square as the ring leaves him
    const s2 = rnd(-0.5, 0.5) * G, h = G * 0.48, [x, y] = [[s2, -h], [h, s2], [s2, h], [-h, s2]][i % 4];
    const sp = new PIXI.Sprite(FLAME); sp.anchor.set(0.5, 0.92); sp.blendMode = ADD; fireL.addChild(sp);
    parts.push({ sp, smoke: false, x, y, vx: x * 0.2, vy: -rnd(50, 100) * k, life: rnd(0.4, 0.7), t: -rnd(0, 0.15), sz: rnd(0.4, 0.7) * k, sway: rnd(0, 6), flip: 1 });
  }
  return run((dt, t) => {
    const ring = radAt(t), fade = t < SPAWN_END ? 1 : Math.max(0, 1 - (t - SPAWN_END) / 0.9);
    if (t < SPAWN_END) {
      acc += dt * (t < 0.4 ? 380 : 300); while (acc >= 1) { acc--; spawn(t, false); }
      sacc += dt * 55; while (sacc >= 1) { sacc--; spawn(t, true); }
    }
    if (t < SPAWN_END + 0.3) {
      eacc += dt * 60;
      while (eacc >= 1) {
        eacc--; const th = rnd(0, Math.PI * 2), r = ring + rnd(-G * 0.1, G * 0.1);
        const e = new PIXI.Graphics().beginFill(Math.random() < 0.5 ? 0xffd27a : 0xff7a2a).drawCircle(0, 0, rnd(1.2, 2.6) * k).endFill(); e.blendMode = ADD; fireL.addChild(e);
        embers.push({ e, x: Math.cos(th) * r, y: Math.sin(th) * r, vx: rnd(-20, 20) * k, vy: -rnd(70, 150) * k, t: 0, life: rnd(0.8, 1.4), w: rnd(0, 6) });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt; const tt = p.t / p.life;
      if (tt >= 1) { p.sp.destroy(); parts.splice(i, 1); continue; }
      if (tt < 0) { p.sp.alpha = 0; continue; }
      if (p.smoke) { p.sp.position.set(p.x + p.vx * p.t, p.y + p.vy * p.t); p.sp.scale.set(p.sz * (1 + tt * 1.4)); p.sp.alpha = 0.55 * (tt < 0.2 ? tt / 0.2 : 1 - (tt - 0.2) / 0.8); continue; }
      p.sp.position.set(p.x + p.vx * p.t + Math.sin(p.t * 14 + p.sway) * 3 * k, p.y + p.vy * p.t);
      const s = p.sz * (tt < 0.25 ? 0.6 + 1.6 * tt : 1 - (tt - 0.25) * 0.9);
      p.sp.scale.set(s * (0.85 + 0.15 * Math.sin(p.t * 30 + p.sway)) * p.flip, s * (1.1 + 0.3 * tt));
      p.sp.alpha = tt < 0.12 ? tt / 0.12 : 1 - (tt - 0.12) / 0.88;
      p.sp.tint = tt < 0.45 ? lerpCol(0xffffff, 0xffa060, tt / 0.45) : lerpCol(0xffa060, 0xd03018, (tt - 0.45) / 0.55);
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const m = embers[i]; m.t += dt; const tt = m.t / m.life;
      if (tt >= 1) { m.e.destroy(); embers.splice(i, 1); continue; }
      m.e.position.set(m.x + m.vx * m.t + Math.sin(m.t * 6 + m.w) * 8 * k, m.y + m.vy * m.t); m.e.alpha = 1 - tt;
    }
    hot.width = hot.height = ring * 2.9; hot.alpha = 0.35 * fade * (0.9 + 0.1 * Math.sin(t * 25));
    const sa = t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 1.6) / 1.0);
    burn.clear().lineStyle(G * 0.55, 0x1a0402, 0.55 * sa).drawCircle(0, 0, ring); burn.beginFill(0x200402, 0.25 * sa).drawCircle(0, 0, ring).endFill();
    if (t < 4 && (t < 2.8 || parts.length || embers.length)) return true;
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

/* ------------------------------------------------------------ registry */

/** Special animations played when a tier 1+ active is used, by the active's name. */
const ON_ACTIVATE = {
  "Might That Shakes the Realm": (token) => groundCrack(token),
  "None Can Stand Before Him": (token) => ringOfFire(token),
};
/** An attack made while one of these actives is on plays its own strike alongside the lunge. */
const ON_ATTACK = { "None Can Stand Before Him": playSkyPiercer };
export function playUniqueAttack(skill, attacker, defender) {
  const fn = ON_ATTACK[skill];
  return fn ? fn(attacker, defender) : null;
}
export function playUniqueActivation(st, token) {
  const fn = ON_ACTIVATE[st?.skill];
  if (fn && token && !token.destroyed) return fn(token);
  return null;
}
