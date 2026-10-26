// Attack targeting (click a hex in reach) and attack animations.
// Animations use Sequencer + JB2A when both modules are active, otherwise built-in PIXI effects
// that are broadcast to every client over the system socket.
import { playTacticTrigger, playSetFire } from "./battle/tactics-ui.mjs";
import { SYSTEM_ID } from "./config.mjs";
import { playStepSounds, attackSounds, playMoment } from "./sound.mjs";
import { drawUnitBars } from "./unit-bars.mjs";

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

/**
 * Container for animations drawn ON TOP of tokens. Token art lives in the primary canvas group,
 * which is sorted by elevation, so the container goes there with a very high elevation.
 */
let overRoot = null;
function overLayer() {
  const primary = canvas.primary;
  if (!primary) return fxLayer();
  if (!overRoot || overRoot.destroyed || overRoot.parent !== primary) {
    overRoot = new PIXI.Container();
    Object.assign(overRoot, { elevation: 1e8, sortLayer: 1e8, sort: 1e8, zIndex: 1e8, eventMode: "none" });
    primary.addChild(overRoot);
    primary.sortDirty = true;
  }
  return overRoot;
}

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
  showFloat(to, hit ? "hit" : "miss");
  return true;
}

/* ---------------------------------------- Floating text and the skull (seen by everyone) */

const FLOAT_STYLES = {
  hit: { text: "Hit!", fill: "#ffd36b", fontSize: 30 },
  unitDamage: { fill: "#ff3b30", fontSize: 40 },
  moraleDown: { fill: "#5aa9ff", fontSize: 32 },
  moraleUp: { fill: "#8fd3ff", fontSize: 32 },
  xp: { fill: "#ffd84a", fontSize: 30 },
  levelUp: { fill: "#ffe680", fontSize: 44 },
  surrounded: { fill: "#ffffff", fontSize: 34 },
  miss: { text: "Miss", fill: "#dddddd", fontSize: 28 },
  block: { text: "Blocked", fill: "#8ab8ff", fontSize: 30 },
  dodge: { text: "Dodged", fill: "#8fe08f", fontSize: 30 },
  blockFail: { text: "Block failed", fill: "#bbbbbb", fontSize: 22 },
  dodgeFail: { text: "Dodge failed", fill: "#bbbbbb", fontSize: 22 },
  damage: { fill: "#ff3b30", fontSize: 42 },
  heal: { fill: "#5fd36b", fontSize: 34 },
};

function floatLocal(at, style, text) {
  const st = FLOAT_STYLES[style] ?? FLOAT_STYLES.hit;
  try {
    canvas.interface?.createScrollingText?.(at, text ?? st.text, {
      anchor: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1, direction: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1,
      fontSize: st.fontSize, fill: st.fill, stroke: 0x000000, strokeThickness: 5, jitter: 0.2, duration: 2000,
    });
  } catch { /* cosmetic only */ }
}
const missText = (to) => floatLocal(to, "miss");

/** Show a floating label at a point for every client. style: hit, miss, block, dodge, blockFail, dodgeFail, damage, heal. */
/** Floating text on a given scene for every client (used by the battle, which runs on the GM's client). */
export function showFloatOnScene(sceneId, at, style, text = null) {
  if (!at) return;
  const data = { type: "float", sceneId, at: { x: at.x, y: at.y }, style, text };
  game.socket?.emit(SOCKET, data);
  if (canvas?.ready && canvas.scene?.id === sceneId) floatLocal(data.at, style, text);
}

export function showFloat(at, style, text = null) {
  if (!canvas?.ready || !at) return;
  const data = { type: "float", sceneId: canvas.scene.id, at: { x: at.x, y: at.y }, style, text };
  game.socket?.emit(SOCKET, data);
  floatLocal(data.at, style, text);
}

/** A grey skull over a token for every client (character killed / henchman out of action). */
export function showSkull(at, size = canvas.grid?.size ?? 100) {
  if (!canvas?.ready || !at) return;
  const data = { type: "skull", sceneId: canvas.scene.id, at: { x: at.x, y: at.y }, size };
  game.socket?.emit(SOCKET, data);
  skullLocal(data);
}

function skullLocal({ at, size }) {
  const s = size * 0.55;
  return animate(2800, (g, t) => {
    const pop = t < 0.12 ? ease.out(t / 0.12) * 1.15 : t < 0.2 ? 1.15 - 0.15 * ((t - 0.12) / 0.08) : 1;
    const alpha = 1 - seg(t, 0.75, 1);
    const cx = at.x, cy = at.y - size * 0.15 - size * 0.25 * seg(t, 0.2, 1);
    const k = s * pop;
    const grey = 0xb5b5b5, dark = 0x1e1e1e;
    // cranium + jaw
    g.lineStyle(Math.max(2, k * 0.06), dark, alpha).beginFill(grey, alpha);
    g.drawEllipse(cx, cy - k * 0.12, k * 0.42, k * 0.38);
    g.drawRoundedRect(cx - k * 0.24, cy + k * 0.12, k * 0.48, k * 0.26, k * 0.06);
    g.endFill();
    g.lineStyle(0).beginFill(grey, alpha).drawRect(cx - k * 0.22, cy + k * 0.06, k * 0.44, k * 0.12).endFill();
    // eyes and nose
    g.beginFill(dark, alpha);
    g.drawEllipse(cx - k * 0.16, cy - k * 0.06, k * 0.11, k * 0.12);
    g.drawEllipse(cx + k * 0.16, cy - k * 0.06, k * 0.11, k * 0.12);
    g.drawPolygon([cx, cy + k * 0.04, cx - k * 0.05, cy + k * 0.13, cx + k * 0.05, cy + k * 0.13]);
    g.endFill();
    // teeth
    g.lineStyle(Math.max(1.5, k * 0.03), dark, alpha);
    for (const dx of [-0.12, -0.04, 0.04, 0.12]) g.moveTo(cx + k * dx, cy + k * 0.2).lineTo(cx + k * dx, cy + k * 0.36);
  });
}

export function registerAttackFxSocket() {
  game.socket?.on(SOCKET, (data) => {
    if (!data || (data.sceneId && canvas?.scene?.id !== data.sceneId)) return;
    if (data.type === "fx") playBuiltIn(data);
    else if (data.type === "float") floatLocal(data.at, data.style, data.text);
    else if (data.type === "skull") skullLocal(data);
    else if (data.type === "defense") defenseLocal(data);
    else if (data.type === "slice") sliceLocal(data);
    else if (data.type === "battleAnim") playBattleAnim(data);
  });
}

/* ---------------------------------------- Damage indicators */

/** Floating "-N" (or "+N" healing) when Breath of Life changes, and a skull on death. */
export function registerDamageFloats() {
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (actor.type === "character" && foundry.utils.hasProperty(change, "system.bol.damage")) {
      options.qinBol = { before: actor.system.bol.damage, wasDead: !!actor.system.bol.dead };
    }
    if (actor.type === "henchman" && foundry.utils.hasProperty(change, "system.outOfAction")) {
      options.qinOut = !!actor.system.outOfAction;
    }
    if (actor.type === "henchman" && foundry.utils.hasProperty(change, "system.wounds")) {
      options.qinWounds = actor.system.wounds;
    }
  });
  Hooks.on("updateActor", (actor, change, options, userId) => {
    if (userId !== game.user.id || !canvas?.ready) return;
    const tokens = actor.getActiveTokens?.(true) ?? [];
    if (!tokens.length) return;
    if (options.qinBol) {
      const delta = actor.system.bol.damage - options.qinBol.before;
      const died = !options.qinBol.wasDead && actor.system.bol.dead;
      for (const t of tokens) {
        if (delta > 0) { showSlice(t, delta); showFloat(t.center, "damage", `-${delta}`); }
        else if (delta < 0) showFloat(t.center, "heal", `+${-delta}`);
        if (died) showSkull(t.center);
      }
    }
    if (options.qinWounds !== undefined) {
      const delta = actor.system.wounds - options.qinWounds;
      for (const t of tokens) {
        if (delta > 0) { showSlice(t, delta * 3); showFloat(t.center, "damage", `-${delta}`); }
        else if (delta < 0) showFloat(t.center, "heal", `+${-delta}`);
      }
    }
    if (options.qinOut === false && actor.system.outOfAction) for (const t of tokens) showSkull(t.center);
  });
}

/* ---------------------------------------- Built-in effects (PIXI) */

const ease = { out: t => 1 - (1 - t) ** 3, inOut: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

/** Runs draw(g, t) every frame for `ms`, then cleans up. */
/**
 * Runs draw(g, t, extras) every frame for `ms`, then cleans up.
 * opts.setup(container) may add sprites and return anything (passed as `extras`); opts.cleanup(extras) runs at the end.
 */
function animate(ms, draw, opts = {}) {
  return new Promise(resolve => {
    const box = new PIXI.Container();
    const g = new PIXI.Graphics();
    box.addChild(g);
    overLayer().addChild(box);
    let extras = null;
    try { extras = opts.setup?.(box) ?? null; } catch (e) { console.warn(e); }
    let elapsed = 0;
    const tick = () => {
      elapsed += canvas.app.ticker.deltaMS;
      const t = clamp01(elapsed / ms);
      g.clear();
      try { draw(g, t, extras); } catch (e) { console.warn(e); }
      if (t >= 1) {
        canvas.app.ticker.remove(tick);
        try { opts.cleanup?.(extras); } catch (e) { console.warn(e); }
        box.destroy({ children: true });
        resolve();
      }
    };
    canvas.app.ticker.add(tick);
  });
}

/* ---------------------------------------- Block, dodge and the damage slice */

/** A copy of the token's artwork, placed over it (null if the token has no art yet). */
function tokenGhost(token) {
  const mesh = token?.mesh;
  if (!mesh?.texture) return null;
  const sp = new PIXI.Sprite(mesh.texture);
  sp.anchor.set(mesh.anchor?.x ?? 0.5, mesh.anchor?.y ?? 0.5);
  sp.position.set(mesh.position.x, mesh.position.y);
  sp.width = mesh.width; sp.height = mesh.height;
  sp.rotation = mesh.rotation ?? 0;
  return sp;
}

/**
 * Show a Block / Dodge result on the defender for every client.
 * @param {Token} token    defender
 * @param {object} from    attacker position {x,y} (optional, sets which side the shield faces)
 */
export async function showDefense(token, kind, success, from = null) {
  if (!canvas?.ready || !token) return;
  const mode = game.settings.get(SYSTEM_ID, "attackAnimations");
  if (mode === "off") return;
  if (kind === "block" && mode !== "builtin" && sequencerReady()) {
    const path = success ? firstPath(["jb2a.shield.01.complete.01.blue", "jb2a.shield.01.complete"]) : firstPath(["jb2a.shield.01.outro_explode.blue", "jb2a.shield.01.outro_explode"]);
    if (path) {
      try { await new Sequence().effect().file(path).atLocation(token).scaleToObject(1.6).play(); return; }
      catch (e) { console.warn("Qin | Sequencer shield failed, using the built-in one", e); }
    }
  }
  const data = { type: "defense", sceneId: canvas.scene.id, tokenId: token.id, kind, success, from: from ? { x: from.x, y: from.y } : null };
  game.socket?.emit(SOCKET, data);
  defenseLocal(data);
}

/** A bloody gash opening across the token (damage got through), for every client. Bigger for more damage. */
export function showSlice(token, amount = 3) {
  if (!canvas?.ready || !token || game.settings.get(SYSTEM_ID, "attackAnimations") === "off") return;
  const data = {
    type: "slice", sceneId: canvas.scene.id, tokenId: token.id, amount,
    angle: (Math.random() * 0.5 + 0.45) * (Math.random() < 0.5 ? 1 : -1), seed: Math.floor(Math.random() * 1e9),
  };
  game.socket?.emit(SOCKET, data);
  sliceLocal(data);
}

function defenseLocal({ tokenId, kind, success, from }) {
  const token = canvas.tokens?.get(tokenId);
  if (!token) return;
  const c = token.center, size = Math.max(token.w, token.h);
  let ux = 0, uy = -1;
  if (from) { const dx = from.x - c.x, dy = from.y - c.y, d = Math.hypot(dx, dy) || 1; ux = dx / d; uy = dy / d; }
  return kind === "block" ? shieldFx(c, size, ux, uy, success) : dodgeFx(token, size, ux, uy, success);
}

function drawShield(g, x, y, r, alpha, rot = 0, half = 0) {
  // round bronze shield with a rim, boss and rivets; half: 0 whole, -1/1 = one half (for the break)
  const start = half === 0 ? 0 : half < 0 ? Math.PI / 2 : -Math.PI / 2;
  const end = half === 0 ? Math.PI * 2 : start + Math.PI;
  const arcPoly = (rad) => {
    const pts = [];
    if (half) pts.push(x, y);
    for (let i = 0; i <= 24; i++) { const a = rot + start + (end - start) * (i / 24); pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    return pts;
  };
  g.lineStyle(Math.max(2, r * 0.12), 0x5a3a14, alpha).beginFill(0xb07a2a, alpha).drawPolygon(arcPoly(r)).endFill();
  g.lineStyle(Math.max(1, r * 0.05), 0xe8c170, alpha * 0.9).drawPolygon(arcPoly(r * 0.78));
  if (!half) {
    g.lineStyle(Math.max(1, r * 0.04), 0x3b260c, alpha).beginFill(0xd9b26a, alpha).drawCircle(x, y, r * 0.26).endFill();
    g.lineStyle(0).beginFill(0xf6e3b0, alpha);
    for (let i = 0; i < 8; i++) { const a = rot + (i / 8) * Math.PI * 2; g.drawCircle(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.05); }
    g.endFill();
  }
}

function shieldFx(c, size, ux, uy, success) {
  const r = size * 0.4;
  const at = { x: c.x + ux * size * 0.3, y: c.y + uy * size * 0.3 };
  const rays = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2 + Math.random() * 0.3);
  if (success) {
    return animate(900, (g, t) => {
      const pop = t < 0.15 ? ease.out(t / 0.15) : 1;
      const knock = t > 0.15 && t < 0.3 ? Math.sin(((t - 0.15) / 0.15) * Math.PI) * size * 0.06 : 0;
      const a = 1 - seg(t, 0.7, 1);
      drawShield(g, at.x + ux * knock, at.y + uy * knock, r * (0.6 + 0.4 * pop), a);
      if (t > 0.15 && t < 0.55) { // clang: ring + sparks off the face of the shield
        const k = seg(t, 0.15, 0.55);
        g.lineStyle(size * 0.03, 0xffffff, 1 - k).drawCircle(at.x, at.y, r * (1 + 0.6 * k));
        g.lineStyle(Math.max(2, size * 0.02), 0xfff1c1, 1 - k);
        for (const ry of rays) {
          const r0 = r * (1.05 + 0.3 * k), r1 = r * (1.25 + 0.6 * k);
          g.moveTo(at.x + Math.cos(ry) * r0, at.y + Math.sin(ry) * r0).lineTo(at.x + Math.cos(ry) * r1, at.y + Math.sin(ry) * r1);
        }
      }
    });
  }
  // Failed block: the shield takes the blow, cracks and breaks in two
  const crack = [[0, 0], [0.15, -0.35], [-0.05, -0.6], [0.1, -0.95], [-0.1, 0.3], [0.08, 0.62], [-0.04, 0.98]];
  const ang = Math.atan2(uy, ux) + Math.PI / 2;
  return animate(1100, (g, t) => {
    const a = 1 - seg(t, 0.65, 1);
    if (t < 0.35) {
      const shake = t > 0.12 ? Math.sin(t * 90) * size * 0.015 : 0;
      drawShield(g, at.x + shake, at.y, r, 1, ang);
      if (t > 0.12) {
        const k = seg(t, 0.12, 0.32);
        g.lineStyle(Math.max(2, r * 0.06), 0x1a1006, 1);
        const pts = crack.map(([px, py]) => ({ x: at.x + (Math.cos(ang) * px - Math.sin(ang) * py) * r, y: at.y + (Math.sin(ang) * px + Math.cos(ang) * py) * r }));
        const n = Math.max(2, Math.round(pts.length * k));
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < n; i++) g.lineTo(pts[i].x, pts[i].y);
      }
    } else {
      const k = ease.out(seg(t, 0.35, 1));
      const spread = size * 0.35 * k, spin = 0.9 * k, drop = size * 0.25 * k * k;
      const px = Math.cos(ang), py = Math.sin(ang);
      drawShield(g, at.x - px * spread, at.y - py * spread + drop, r, a, ang - spin, -1);
      drawShield(g, at.x + px * spread, at.y + py * spread + drop, r, a, ang + spin, 1);
      g.lineStyle(0).beginFill(0xb07a2a, a);
      for (let i = 0; i < 6; i++) { const ry = rays[i]; g.drawCircle(at.x + Math.cos(ry) * r * 1.4 * k, at.y + Math.sin(ry) * r * 1.4 * k + drop, r * 0.06); }
      g.endFill();
    }
  });
}

function dodgeFx(token, size, ux, uy, success) {
  const side = Math.random() < 0.5 ? 1 : -1;
  const px = -uy * side, py = ux * side; // sidestep perpendicular to the attack
  const base = token.mesh?.position ? { x: token.mesh.position.x, y: token.mesh.position.y } : token.center;
  return animate(success ? 800 : 900, (g, t, ghosts) => {
    const c = token.center;
    if (success) {
      // afterimages slide aside and fade, with speed lines
      const out = ease.out(seg(t, 0, 0.4)), back = ease.inOut(seg(t, 0.55, 1));
      const d = size * 0.45 * out * (1 - back);
      ghosts?.forEach((sp, i) => {
        const lag = (i + 1) / (ghosts.length + 1);
        sp.position.set(base.x + px * d * (1 - lag * 0.6), base.y + py * d * (1 - lag * 0.6));
        sp.alpha = 0.45 * (1 - lag) * (1 - seg(t, 0.4, 1));
      });
      if (t < 0.6) {
        const a = 0.7 * (1 - seg(t, 0.25, 0.6));
        g.lineStyle(Math.max(2, size * 0.02), 0xffffff, a);
        for (const o of [-0.25, 0, 0.25]) {
          const sx = c.x + ux * size * o, sy = c.y + uy * size * o;
          g.moveTo(sx + px * size * 0.2, sy + py * size * 0.2).lineTo(sx + px * size * (0.2 + 0.45 * out), sy + py * size * (0.2 + 0.45 * out));
        }
      }
    } else {
      // tries to slip aside, gets caught and jolts back
      const k = t < 0.3 ? ease.out(t / 0.3) : 1 - ease.out(seg(t, 0.3, 0.45));
      const d = size * 0.2 * k;
      ghosts?.forEach((sp, i) => {
        sp.position.set(base.x + px * d * (1 - i * 0.3), base.y + py * d * (1 - i * 0.3));
        sp.alpha = 0.4 * (1 - i * 0.3) * (1 - seg(t, 0.3, 0.6));
      });
      if (t > 0.4) {
        const j = seg(t, 0.4, 1);
        g.lineStyle(Math.max(2, size * 0.025), 0xbbbbbb, 1 - j);
        for (let i = 0; i < 3; i++) {
          const a = Math.atan2(py, px) + (i - 1) * 0.5;
          const r0 = size * 0.42, r1 = size * (0.5 + 0.12 * j);
          g.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0).lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
        }
      }
    }
  }, {
    setup: (box) => {
      const ghosts = [0, 1, 2].map(() => tokenGhost(token)).filter(Boolean);
      ghosts.forEach(sp => { sp.alpha = 0; box.addChildAt(sp, 0); });
      return ghosts;
    },
  });
}

function sliceLocal({ tokenId, angle, amount = 3, seed = 1 }) {
  const token = canvas.tokens?.get(tokenId);
  if (!token) return;
  let r = seed || 1;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647); // same wound on every client
  const c = token.center, size = Math.max(token.w, token.h);
  const sev = Math.min(1, 0.45 + amount / 12);              // severity: wider, longer, bloodier
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }, nrm = { x: -dir.y, y: dir.x };
  const L = size * (0.32 + 0.16 * sev), W = size * (0.05 + 0.06 * sev);
  const N = 14;
  const spine = Array.from({ length: N + 1 }, (_, i) => {
    const u = i / N, along = -L + 2 * L * u, wob = (rnd() - 0.5) * size * 0.05;
    return { u, x: c.x + dir.x * along + nrm.x * wob, y: c.y + dir.y * along + nrm.y * wob, w: Math.sin(Math.PI * u) ** 0.8 * (0.75 + 0.5 * rnd()) };
  });
  const drips = Array.from({ length: Math.round(3 + 4 * sev) }, () => {
    const p = spine[1 + Math.floor(rnd() * (N - 1))];
    return { x: p.x, y: p.y + W * p.w * 0.5, len: size * (0.18 + 0.4 * rnd()) * sev, w: size * (0.012 + 0.012 * rnd()), delay: 0.2 + rnd() * 0.25 };
  });
  const spray = Array.from({ length: Math.round(8 + 10 * sev) }, () => {
    const p = spine[Math.floor(rnd() * N)];
    const side = rnd() < 0.5 ? -1 : 1, v = 0.3 + rnd() * 0.9;
    return { x: p.x, y: p.y, vx: nrm.x * side * v + dir.x * (rnd() - 0.5) * 0.6, vy: nrm.y * side * v + dir.y * (rnd() - 0.5) * 0.6, s: 0.6 + rnd() };
  });
  const lens = (reveal, open, scale) => {
    const n = Math.max(1, Math.round(N * reveal)), top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const p = spine[i];
      const w = W * scale * p.w * open * (i === n && reveal < 1 ? 0.3 : 1);
      top.push(p.x + nrm.x * w, p.y + nrm.y * w);
      bot.unshift(p.x - nrm.x * w, p.y - nrm.y * w);
    }
    return top.concat(bot);
  };
  return animate(2600, (g, t) => {
    const reveal = ease.out(seg(t, 0, 0.12));                 // the blade tears it open
    const open = 0.25 + 0.75 * ease.out(seg(t, 0.06, 0.3));    // then the wound gapes
    const fade = 1 - seg(t, 0.72, 1);
    // bruised edge, raw wound, dark depth, wet highlight
    g.lineStyle(0).beginFill(0x4a0008, 0.55 * fade).drawPolygon(lens(reveal, open, 1.6)).endFill();
    g.beginFill(0xa3001b, 0.95 * fade).drawPolygon(lens(reveal, open, 1.0)).endFill();
    g.beginFill(0x2a0004, 0.95 * fade).drawPolygon(lens(reveal, open, 0.45)).endFill();
    if (reveal > 0.3) {
      g.lineStyle(Math.max(1, size * 0.008), 0xff6b6b, 0.7 * fade);
      const n = Math.round(N * reveal);
      for (let i = 2; i < n - 1; i++) {
        const p = spine[i], q = spine[i + 1], w = W * p.w * open * 0.55;
        g.moveTo(p.x + nrm.x * w, p.y + nrm.y * w).lineTo(q.x + nrm.x * w, q.y + nrm.y * w);
      }
    }
    // spray flung off the cut
    if (t < 0.5) {
      const k = seg(t, 0.04, 0.5);
      g.lineStyle(0).beginFill(0xb5001e, 1 - k);
      for (const d of spray) {
        const dist = size * 0.55 * ease.out(k) * d.s;
        g.drawCircle(d.x + d.vx * dist, d.y + d.vy * dist + size * 0.2 * k * k, size * 0.018 * d.s * (1 - 0.6 * k));
      }
      g.endFill();
    }
    // blood running down from the wound
    for (const d of drips) {
      const k = ease.inOut(seg(t, d.delay, 0.85));
      if (k <= 0) continue;
      const len = d.len * k;
      g.lineStyle(d.w, 0x8f0016, 0.95 * fade).moveTo(d.x, d.y).lineTo(d.x, d.y + len);
      g.lineStyle(0).beginFill(0x8f0016, 0.95 * fade).drawCircle(d.x, d.y + len, d.w * 0.9).endFill();
    }
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
  const impact = () => { if (hit) { burst(to, size); floatLocal(to, "hit"); } else missText(to); };

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

/* ---------------------------------------- Battle (unit) combat choreography */

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Send a battle animation script to everyone (the battle runs on the GM's client). */
export function broadcastBattleAnim(sceneId, steps) {
  if (!steps?.length) return;
  const data = { type: "battleAnim", sceneId, steps };
  game.socket?.emit(SOCKET, data);
  return playBattleAnim(data);
}

/** Fully surrounded: the unit's outline flashes white three times and "Surrounded!" rises over it. */
function surroundedLocal(token) {
  if (!token) return;
  const x = token.x, y = token.y, w = token.w, h = token.h, T = Math.min(w, h), pad = T * 0.03;
  floatLocal({ x: x + w / 2, y: y + h * 0.42 }, "surrounded", "Surrounded!");
  return animate(1000, (g, t) => {
    const a = Math.max(0, Math.sin(t * Math.PI * 3));
    if (a <= 0) return;
    g.lineStyle(T * 0.09, 0xffffff, 0.35 * a).drawRoundedRect(x + pad - T * 0.04, y + pad - T * 0.04, w - 2 * pad + T * 0.08, h - 2 * pad + T * 0.08, T * 0.13);
    g.lineStyle(T * 0.035, 0xffffff, a).drawRoundedRect(x + pad, y + pad, w - 2 * pad, h - 2 * pad, T * 0.1);
  });
}

/** A white flag raised and waved over a unit that surrenders. */
function whiteFlagLocal({ at, size }) {
  return animate(2600, (g, t) => {
    const rise = ease.out(seg(t, 0, 0.2));
    const alpha = 1 - seg(t, 0.8, 1);
    const k = size * 0.6;
    const baseX = at.x - k * 0.2, footY = at.y + k * 0.15, topY = footY - k * (0.4 + 0.6 * rise);
    // pole
    g.lineStyle(Math.max(2, k * 0.05), 0x5a3b1e, alpha).moveTo(baseX, footY).lineTo(baseX, topY);
    g.lineStyle(0).beginFill(0xd8b25a, alpha).drawCircle(baseX, topY, k * 0.035).endFill();
    // waving cloth: a strip whose edges ripple along its length
    const len = k * 0.62, hgt = k * 0.36, n = 14, top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, wave = Math.sin(f * 5 - t * 22) * hgt * 0.14 * f;
      const x = baseX + f * len * (0.92 + 0.08 * Math.cos(t * 9));
      top.push(x, topY + k * 0.03 + wave);
      bot.unshift(x, topY + k * 0.03 + hgt + wave - f * hgt * 0.08);
    }
    g.lineStyle(Math.max(1.5, k * 0.03), 0x333333, alpha).beginFill(0xffffff, alpha).drawPolygon([...top, ...bot]).endFill();
  });
}

/** Fade a token (art, bars, ring) to nothing over ms. Visual only: the GM hides the token afterwards. */
function fadeOutToken(token, ms = 1200) {
  if (!token || token.destroyed) return Promise.resolve();
  const parts = [token, token.mesh].filter(Boolean);
  const start = parts.map(p => p.alpha ?? 1);
  return new Promise(resolve => {
    let t = 0;
    const tick = () => {
      t += canvas.app.ticker.deltaMS;
      const k = Math.min(1, t / ms);
      parts.forEach((p, i) => { if (!p.destroyed) p.alpha = start[i] * (1 - k); });
      if (k >= 1) { canvas.app.ticker.remove(tick); resolve(); }
    };
    canvas.app.ticker.add(tick);
  });
}

/**
 * A volley: a dozen arrows leave the shooter's tile at staggered moments, arc through the air and come
 * down spread across the target's tile, stick for a moment and fade. Resolves when the last has landed.
 */
function volley(from, to, count = 12) {
  if (!from || !to || from.destroyed || to.destroyed) return Promise.resolve();
  const T = Math.min(to.w, to.h), rnd = (a, b) => a + Math.random() * (b - a);
  const arrows = Array.from({ length: count }, (_, i) => ({
    sx: from.x + from.w * rnd(0.25, 0.75), sy: from.y + from.h * rnd(0.3, 0.6),
    ex: to.x + to.w * rnd(0.15, 0.85), ey: to.y + to.h * rnd(0.2, 0.75),
    delay: i * 45 + rnd(0, 30), flight: rnd(520, 640),
  }));
  const total = Math.max(...arrows.map(a => a.delay + a.flight)) + 380;
  const len = T * 0.26;
  return animate(total, (g, t) => {
    const now = t * total;
    for (const a of arrows) {
      const k = (now - a.delay) / a.flight;
      if (k < 0) continue;
      const dist = Math.hypot(a.ex - a.sx, a.ey - a.sy), arc = Math.min(dist * 0.25, T * 1.8);
      const p = Math.min(1, k);
      const x = a.sx + (a.ex - a.sx) * p, y = a.sy + (a.ey - a.sy) * p - arc * 4 * p * (1 - p);
      // direction of travel (tangent of the arc); once landed, keep the last angle and fade
      const q = Math.min(0.999, p), dx = a.ex - a.sx, dy = (a.ey - a.sy) - arc * 4 * (1 - 2 * q);
      const ang = Math.atan2(dy, dx), ux = Math.cos(ang), uy = Math.sin(ang);
      const alpha = k <= 1 ? 1 : Math.max(0, 1 - (now - a.delay - a.flight) / 380);
      if (alpha <= 0) continue;
      const tx = x - ux * len, ty = y - uy * len;
      g.lineStyle(Math.max(3, T * 0.03), 0x1a120a, alpha * 0.7).moveTo(tx, ty).lineTo(x, y);        // dark edge
      g.lineStyle(Math.max(1.5, T * 0.016), 0xe6cf9f, alpha).moveTo(tx, ty).lineTo(x, y);          // shaft
      g.lineStyle(0).beginFill(0xd8dde2, alpha)                                                      // head
        .drawPolygon([x + ux * T * 0.06, y + uy * T * 0.06, x - uy * T * 0.03, y + ux * T * 0.03, x + uy * T * 0.03, y - ux * T * 0.03]).endFill();
      g.lineStyle(Math.max(1.5, T * 0.016), 0xc0281e, alpha)                                         // red fletching
        .moveTo(tx, ty).lineTo(tx - ux * T * 0.05 - uy * T * 0.035, ty - uy * T * 0.05 + ux * T * 0.035)
        .moveTo(tx, ty).lineTo(tx - ux * T * 0.05 + uy * T * 0.035, ty - uy * T * 0.05 - ux * T * 0.035);
    }
  });
}

/** Shift a token part of the way toward a point and back (visual only). */
function lunge(token, toward, ms = 520) {
  if (!token || token.destroyed) return Promise.resolve();
  const c = token.center, dx = toward.x - c.x, dy = toward.y - c.y, d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(d * 0.45, Math.max(token.w, token.h) * 0.4);
  const ux = (dx / d) * reach, uy = (dy / d) * reach;
  const base = { x: token.position.x, y: token.position.y };
  const mesh = token.mesh, mBase = mesh ? { x: mesh.position.x, y: mesh.position.y } : null;
  return new Promise(resolve => {
    let t = 0;
    const tick = () => {
      t += canvas.app.ticker.deltaMS;
      const k = Math.min(1, t / ms);
      const off = k < 0.45 ? ease.out(k / 0.45) : 1 - ease.inOut((k - 0.45) / 0.55);
      if (!token.destroyed) {
        token.position.set(base.x + ux * off, base.y + uy * off);
        if (mesh && !mesh.destroyed) mesh.position.set(mBase.x + ux * off, mBase.y + uy * off);
      }
      if (k >= 1) {
        canvas.app.ticker.remove(tick);
        if (!token.destroyed) {
          token.position.set(base.x, base.y);
          if (mesh && !mesh.destroyed) mesh.position.set(mBase.x, mBase.y);
          try { token.renderFlags?.set({ refreshPosition: true }); } catch { /* fine */ }
        }
        resolve();
      }
    };
    canvas.app.ticker.add(tick);
  });
}

function levelUpLocal(token, level) {
  if (!token) return;
  const c = token.center, size = Math.max(token.w, token.h);
  floatLocal({ x: c.x, y: c.y - size * 0.2 }, "levelUp", `LEVEL UP!  Lv ${level}`);
  return animate(1300, (g, t) => {
    const k = ease.out(t), a = 1 - t;
    g.lineStyle(0).beginFill(0xffe680, 0.35 * a).drawCircle(c.x, c.y, size * (0.45 + 0.35 * k)).endFill();
    g.lineStyle(size * 0.05, 0xfff3b0, 0.9 * a).drawCircle(c.x, c.y, size * (0.5 + 0.55 * k));
    g.lineStyle(size * 0.025, 0xffffff, 0.8 * a);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + t * 1.5, r0 = size * (0.55 + 0.3 * k), r1 = r0 + size * 0.18;
      g.moveTo(c.x + Math.cos(ang) * r0, c.y + Math.sin(ang) * r0).lineTo(c.x + Math.cos(ang) * r1, c.y + Math.sin(ang) * r1);
    }
  });
}

/**
 * Steps: { kind: "attack", attacker, defender, toDefender: [[style,text]...], toAttacker: [...], returnStrike: bool }
 *        { kind: "floats", items: [[tokenId, style, text], ...] }   (shown together)
 *        { kind: "levelUp", unit, level }
 *        { kind: "fallen", units: [[tokenId, "skull" | "flag"], ...] }
 *        { kind: "surrounded", units: [tokenId, ...] }
 */
export async function playBattleAnim({ sceneId, steps }) {
  if (!canvas?.ready || (sceneId && canvas.scene?.id !== sceneId)) return;
  const tok = (id) => canvas.tokens?.get(id);
  const showAll = (id, list) => { const t = tok(id); if (t) list.forEach(([style, text], i) => setTimeout(() => floatLocal(t.center, style, text), i * 180)); };
  for (const st of steps) {
    try { playStepSounds(st); } catch (e) { console.warn("Qin | battle sound", e); }
    try {
      if (st.kind === "attack") {
        const A = tok(st.attacker), D = tok(st.defender);
        if (A && D) {
          // the attacker's sword icon shows this attack's bonus while the exchange plays
          A.qinAttackBonus = st.attackBonus ?? 0;
          drawUnitBars(A);
          // ranged attacks loose a volley of arrows; melee attacks lunge at the target
          const strike = (from, to, isRanged) => isRanged ? volley(from, to) : lunge(from, to.center).then(() => 0);
          const hitAt = (isRanged) => (isRanged ? 620 : 240);
          const snd = attackSounds(st);
          if (snd.start) playMoment(snd.start, { minGap: 0 });
          const goA = strike(A, D, st.ranged);
          await wait(hitAt(st.ranged));
          playMoment(snd.hit, { minGap: 0 });
          showAll(st.defender, st.toDefender);
          await goA;
          await wait(180);
          if (st.returnStrike) {
            const backRanged = !!st.returnRanged;
            const goD = strike(D, A, backRanged);
            await wait(hitAt(backRanged));
            playMoment(snd.back, { minGap: 0 });
            showAll(st.attacker, st.toAttacker);
            await goD;
          } else showAll(st.attacker, st.toAttacker);
          await wait(450);
          await wait(500);
          A.qinAttackBonus = null;
          if (!A.destroyed) drawUnitBars(A);
        }
      } else if (st.kind === "floats") {
        for (const [id, style, text] of st.items) { const t = tok(id); if (t) floatLocal(t.center, style, text); }
        await wait(500);
      } else if (st.kind === "levelUp") {
        levelUpLocal(tok(st.unit), st.level);
        await wait(700);
      } else if (st.kind === "tactic") {
        await playTacticTrigger(st.tactic);
      } else if (st.kind === "setFire") {
        await playSetFire(st.x, st.y);
      } else if (st.kind === "surrounded") {
        for (const id of st.units) surroundedLocal(tok(id));
        await wait(1400);
      } else if (st.kind === "fallen") {
        // every unit that fell in this action goes together: skull (destroyed) or white flag (surrendered),
        // half a second, then a slow fade
        const fallen = st.units.map(([id, how]) => [tok(id), how]).filter(([t]) => t);
        for (const [t, how] of fallen) {
          const fx = { at: t.center, size: Math.max(t.w, t.h) };
          if (how === "flag") whiteFlagLocal(fx); else skullLocal(fx);
        }
        await wait(500);
        await Promise.all(fallen.map(([t]) => fadeOutToken(t)));
      }
    } catch (e) { console.warn("Qin | battle animation", e); }
  }
}
