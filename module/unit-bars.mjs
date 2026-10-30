// Battle unit "stand": instead of the token picture, every unit token is drawn as a square base in its
// side colour with up to five soldier figures (one per 20% of its strength), its officer's medallion,
// its faction banner rolled up in the corner (it unrolls while hovered), and health/morale bars.
import { factionOf } from "./factions.mjs";
import { traitTiersOf } from "./battle/traits.mjs";
import { tileRules } from "./battle/engine.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battle/battlemap.mjs";

const KEY = "qinUnitBars";
export const SIDE_COLORS = { player: 0x3a78c8, enemy: 0xc8443a, ally: 0x3fa66a, neutral: 0xd4a017 };

// Layout, as fractions of the token's size
const L = {
  pad: 0.03, fig: 0.36, ringCrop: 0.115, officer: 0.33,
  back: [[0.395, 0.31], [0.605, 0.31]], front: [[0.29, 0.52], [0.50, 0.53], [0.71, 0.52]],
  flagX: 0.87, flagY: 0.055, flagH: 0.26, rollW: 0.075, bar: 0.085,
};
// Slots in loss order: slot 1 is lost first, slot 5 (front-middle) is the last man standing
//   back row:   4 3       front row:  2 5 1
const SLOTS = { 1: L.front[2], 2: L.front[0], 3: L.back[1], 4: L.back[0], 5: L.front[1] };

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

/** Is this unit holding (+2 melee defense until its next activation)? */
function isHolding(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  if (!battle?.active || battle.sceneId !== token.document?.parent?.id) return false;
  return !!battle.meta?.[token.id]?.round?.holding;
}

/** Is this ranged unit on overwatch (it shoots the first enemy that moves into range before its next turn)? */
function isOverwatch(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  if (!battle?.active || battle.sceneId !== token.document?.parent?.id) return false;
  return !!battle.meta?.[token.id]?.overwatch;
}

/** Overwatch: an amber targeting reticle. */
function drawOverwatch(size) {
  const g = new PIXI.Graphics(), u = size / 20, col = 0xffb347;
  g.lineStyle(Math.max(1.5, u * 1.4), col, 1).drawCircle(0, 0, 6 * u);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.moveTo(dx * 3.2 * u, dy * 3.2 * u).lineTo(dx * 9 * u, dy * 9 * u);
  g.lineStyle(0).beginFill(0xff5a3c, 1).drawCircle(0, 0, 1.6 * u).endFill();
  return g;
}

/** Which way the unit faces in the battle (up, down, left or right), or null; none while tokens rotate instead. */
function facingOf(token) {
  const f = battleRecord(token)?.meta?.[token.id]?.facing;
  if (!f || (!f.dx && !f.dy)) return null;
  try { if (game.settings.get("qin", "rotateFacing")) return null; } catch { /* not registered */ }
  return f.dx ? (f.dx > 0 ? "right" : "left") : (f.dy > 0 ? "down" : "up");
}

/* Facing chevrons show while a unit is hovered, or on every unit while the "show facing" key (X) is held. */
let showAllFacing = false;
function setShowAllFacing(on) {
  showAllFacing = on;
  for (const t of canvas?.tokens?.placeables ?? []) {
    const ch = t[KEY]?.qinChevron;
    if (ch && !ch.destroyed) ch.visible = on || !!t.hover;
  }
}
export function registerFacingKey(systemId) {
  game.keybindings.register(systemId, "showFacing", {
    name: "Show unit facing (hold)",
    hint: "While held, every unit that faces a direction shows its chevron, not just the one you hover over.",
    editable: [{ key: "KeyX" }],
    onDown: () => { if (!canvas?.ready) return false; setShowAllFacing(true); return true; },
    onUp: () => { setShowAllFacing(false); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
  // switching windows while holding the key never sends the key-up: let go then
  window.addEventListener("blur", () => { if (showAllFacing) setShowAllFacing(false); });
}

/** A thin white chevron just inside the unit's border, pointing the way it faces. */
function drawFacingChevron(dir, w, h, T, pad, barsTop) {
  // the tip sits the same distance in from the border on every side (facing down, that puts it over the bars)
  const g = new PIXI.Graphics(), half = T * 0.15, depth = T * 0.055, inset = pad + T * 0.045; // long and flat
  let x, y, rot;
  if (dir === "up") { x = w / 2; y = inset; rot = -Math.PI / 2; }
  else if (dir === "down") { x = w / 2; y = h - inset; rot = Math.PI / 2; }
  else if (dir === "left") { x = inset; y = h * 0.45; rot = Math.PI; }
  else { x = w - inset; y = h * 0.45; rot = 0; }
  // drawn pointing right with its tip at (0, 0), then turned
  const path = (gr) => gr.moveTo(-depth, -half).lineTo(0, 0).lineTo(-depth, half);
  path(g.lineStyle({ width: Math.max(2, T * 0.036), color: 0x000000, alpha: 0.8, cap: "round", join: "round" }));
  path(g.lineStyle({ width: Math.max(1, T * 0.018), color: 0xffffff, alpha: 1, cap: "round", join: "round" }));
  g.position.set(x, y); g.rotation = rot;
  return g;
}

function battleRecord(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return null; }
  return battle?.active && battle.sceneId === token.document?.parent?.id ? battle : null;
}

/**
 * What the status icons show, all as changes to Command rolls:
 *  attack - situational bonus/penalty to this unit's rolls: morale (+2 Encouraged / -2 Demoralized),
 *           losses (2 soldiers -1, 1 soldier -2), and on its own turn the cavalry charge bonus after a
 *           2+ tile move, or the ranged attacker's +2 kept by not moving. During an attack it shows that
 *           attack's whole situational total instead (token.qinAttackBonus).
 *  defense - against melee attacks: Hold (+2), Brace, Shielded, Poison, Suppressing Fire.
 *  rangedDefense - against ranged attacks: Shielded, Shield Battery, Poison. (Hold does not count against ranged attacks.)
 *  range - extra range (nothing grants this automatically yet).
 */
const tierCache = new Map();
function tiersFor(text) {
  const key = String(text ?? "");
  if (!tierCache.has(key)) { if (tierCache.size > 500) tierCache.clear(); tierCache.set(key, traitTiersOf(key)); }
  return tierCache.get(key);
}
const tierVal = (tier, vals) => (tier ? vals[Math.min(tier, vals.length) - 1] : 0);

const mapTiles = new Map(); // sceneId -> { flag, tiles }
/** Terrain effects of the square a token stands on (battle-map scenes only). */
function terrainUnder(token) {
  const scene = token.document?.parent;
  const flag = scene?.flags?.qin?.[MAP_FLAG];
  if (!flag) return null;
  let c = mapTiles.get(scene.id);
  if (!c || c.flag !== flag) { c = { flag, tiles: decodeTiles(flag) }; mapTiles.set(scene.id, c); }
  const size = scene.grid?.size ?? 100;
  const x = Math.round((token.document.x ?? token.x) / size), y = Math.round((token.document.y ?? token.y) / size);
  return tileRules({ map: { tiles: c.tiles, cols: flag.cols, rows: flag.rows } }, x, y);
}

export function unitStatus(token) {
  const actor = token.actor, s = actor.system, battle = battleRecord(token);
  const meta = battle?.meta?.[token.id] ?? {};
  const round = meta.round ?? {}, fx = meta.fx ?? {};
  const tr = tiersFor(s.traits);
  // rolls: changes to ALL Command rolls (attacking and defending): morale and losses
  let rolls = 0, attack = 0;
  const m = s.morale ?? 0;
  if (m >= 75) rolls += 2; else if (m > 0 && m <= 25 && !tr.unwavering) rolls -= 2;
  const figs = figureCount(s.men?.value ?? 0, s.men?.max || 100);
  if (figs === 1) rolls -= 2; else if (figs === 2) rolls -= 1;
  // attack: changes that only count when attacking
  if (!round.moved && s.range > 1) attack += tierVal(tr.precision, [2, 4, 6]); // Precision: ranged attacks only, hasn't moved before attacking
  if (round.moved && tr["hefty weapon"]) attack -= 2;
  const ac = battle?.turn?.activation;
  if (ac?.unitId === token.id && !ac.forcedMarched && !round.attacked) {
    if (s.range > 1) { if (!round.moved || tr["moving shot"]) attack += 2; }
    else if (s.category === "cavalry" && ac.movedThisActivation) {
      const tiles = ac.tilesMoved || 0;
      const fierce = Math.min(3, tr["fierce charge"] || 0);
      const charge = Math.max(0, tiles - 1); // +1 per tile past the first; Fierce Charge +2 / +4 / +4 on a charge
      if (charge > 0) attack += charge + [0, 2, 4, 4][fierce];
    }
  }
  if (token.qinAttackBonus !== undefined && token.qinAttackBonus !== null) attack = token.qinAttackBonus;
  const both = -(Number(fx.poison) || 0); // melee & ranged defense (Poison lowers both)
  const supp = !!fx.suppressed; // Suppressing Fire: Attack -1, melee defense -1, Hold and Brace lost
  if (supp) attack -= 1;
  const defense = (round.holding && !supp ? 2 + tierVal(tr.brace, [2, 4]) : 0) - (supp ? 1 : 0) + both + tierVal(tr.shielded, [1, 2, 3]);
  const rangedDefense = both + tierVal(tr.shielded, [2, 4, 6])
    + (fx.stillLast && tr["shield battery"] ? 2 : 0);
  let range = s.range > 1 && fx.stillLast ? tierVal(tr["range up"], [1, 2]) : 0;
  // the square it stands on (battle maps): command, defense, range
  const ground = terrainUnder(token);
  let groundDef = 0, groundRanged = 0;
  if (ground) {
    rolls += ground.command;
    if (token.qinAttackBonus === undefined || token.qinAttackBonus === null) attack += ground.atk;
    groundDef = ground.meleeDef; groundRanged = ground.rangedDef;
    if (s.range > 1) range += ground.range;
  }
  return { rolls, attack, defense: defense + groundDef, rangedDefense: rangedDefense + groundRanged, range, holding: !!round.holding, hidden: !!s.hidden,
    reloading: !!fx.reload, suppressed: supp };
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
/** A sword pointing up: steel blade, gold guard, red hilt. Centred on (0,0), fits a size x size box. */
function drawSword(size) {
  const g = new PIXI.Graphics(), u = size / 20;
  g.rotation = Math.PI / 4;
  g.lineStyle(Math.max(1, u * 0.6), 0x22262c, 1).beginFill(0xdfe6ee, 1)
    .drawPolygon([0, -9 * u, 1.3 * u, -7.4 * u, 1.3 * u, 3 * u, -1.3 * u, 3 * u, -1.3 * u, -7.4 * u]).endFill();
  g.lineStyle(0).beginFill(0xffffff, 0.7).drawRect(-0.3 * u, -7.2 * u, 0.6 * u, 9.6 * u).endFill();
  g.lineStyle(Math.max(1, u * 0.5), 0x3a2a08, 1).beginFill(0xd9a441, 1).drawRoundedRect(-4 * u, 3 * u, 8 * u, 1.6 * u, 0.6 * u).endFill();
  g.beginFill(0xc0281e, 1).drawRoundedRect(-1 * u, 4.6 * u, 2 * u, 3.6 * u, 0.6 * u).endFill();
  g.beginFill(0xd9a441, 1).drawCircle(0, 9.1 * u, 1.2 * u).endFill();
  return g;
}

/** A wooden siege ladder, centred on (0,0), about size tall. */
export function drawLadder(size) {
  const g = new PIXI.Graphics(), h = size * 0.68, wd = size * 0.3, lw = Math.max(1.5, size * 0.07);
  const y0 = -h / 2, x0 = -wd / 2, x1 = wd / 2;
  for (const [col, wid] of [[0x37200e, lw * 1.9], [0xb0763a, lw]]) {
    g.lineStyle(wid, col, 1).moveTo(x0, y0).lineTo(x0, -y0).moveTo(x1, y0).lineTo(x1, -y0);
    for (let i = 0; i < 4; i++) { const y = y0 + h * (i + 0.5) / 4; g.moveTo(x0, y).lineTo(x1, y); }
  }
  return g;
}
/** A covered battering ram on wheels. */
export function drawSiegeEngine(size) {
  const g = new PIXI.Graphics(), s = size * 0.72, lw = Math.max(1, size * 0.03);
  g.lineStyle(lw, 0x2d1c0c, 1).beginFill(0x78502a).drawPolygon([-s * 0.55, 0, 0, -s * 0.45, s * 0.55, 0]).endFill();
  g.lineStyle(Math.max(2, size * 0.08), 0x96969f, 1).moveTo(-s * 0.75, s * 0.05).lineTo(s * 0.6, s * 0.05);
  g.lineStyle(lw, 0x2d1c0c, 1).beginFill(0x6e4824).drawRect(-s * 0.5, s * 0.08, s, s * 0.12).endFill();
  for (const wx of [-s * 0.3, s * 0.3]) g.lineStyle(lw, 0x190f06, 1).beginFill(0x462d16).drawCircle(wx, s * 0.3, s * 0.14).endFill();
  return g;
}

/** A recurve bow with its string and a nocked arrow. */
function drawBow(size) {
  const g = new PIXI.Graphics(), u = size / 20;
  g.rotation = Math.PI / 4;
  g.lineStyle(Math.max(1, u * 0.5), 0xe8e0d0, 0.95).moveTo(-1 * u, -7.5 * u).lineTo(-1 * u, 7.5 * u);           // string
  g.lineStyle(Math.max(1.5, u * 1.6), 0x8a5a2b, 1).moveTo(-1 * u, -7.5 * u).bezierCurveTo(5 * u, -6 * u, 5 * u, 6 * u, -1 * u, 7.5 * u); // limbs
  g.lineStyle(Math.max(1, u * 0.6), 0xcfd6dd, 1).moveTo(-4 * u, 0).lineTo(7 * u, 0);                               // arrow
  g.lineStyle(0).beginFill(0xcfd6dd, 1).drawPolygon([7 * u, -1.2 * u, 9.2 * u, 0, 7 * u, 1.2 * u]).endFill();
  g.beginFill(0xc0281e, 1).drawPolygon([-4 * u, 0, -5.6 * u, -1.4 * u, -3 * u, -1.4 * u, -1.6 * u, 0, -3 * u, 1.4 * u, -5.6 * u, 1.4 * u]).endFill();
  return g;
}

/** A closed eye with a slash: this unit is hidden. */
function drawHiddenEye(size) {
  const g = new PIXI.Graphics(), u = size / 20;
  g.lineStyle(Math.max(1.5, u * 1.3), 0xe8f2ff, 1);
  g.moveTo(-7 * u, 0).quadraticCurveTo(0, -6.5 * u, 7 * u, 0).quadraticCurveTo(0, 6.5 * u, -7 * u, 0);
  g.lineStyle(0).beginFill(0xe8f2ff, 1).drawCircle(0, 0, 2.2 * u).endFill();
  g.lineStyle(Math.max(2, u * 1.8), 0x1a140e, 1).moveTo(-6 * u, -6 * u).lineTo(6 * u, 6 * u);
  g.lineStyle(Math.max(1.5, u * 1.1), 0xe8f2ff, 1).moveTo(-6 * u, -6 * u).lineTo(6 * u, 6 * u);
  return g;
}

/** Yin and yang: a change to ALL of this unit's Command rolls. */
function drawYinYang(size) {
  const g = new PIXI.Graphics(), r = size * 0.36;
  const half = [];
  for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + Math.PI * k / 24; half.push(Math.cos(a) * r, Math.sin(a) * r); }
  g.lineStyle(0).beginFill(0xf2ece0, 1).drawCircle(0, 0, r).endFill();
  g.beginFill(0x15110c, 1).drawPolygon(half).endFill();
  g.beginFill(0xf2ece0, 1).drawCircle(0, -r / 2, r / 2).endFill();
  g.beginFill(0x15110c, 1).drawCircle(0, r / 2, r / 2).endFill();
  g.beginFill(0x15110c, 1).drawCircle(0, -r / 2, r / 6).endFill();
  g.beginFill(0xf2ece0, 1).drawCircle(0, r / 2, r / 6).endFill();
  g.lineStyle(Math.max(1, size * 0.03), 0x15110c, 1).drawCircle(0, 0, r);
  return g;
}

function drawArrowShield(size) {
  const c = new PIXI.Container();
  c.addChild(drawShield(size * 0.6, size * 0.7));
  const g = new PIXI.Graphics(), u = size / 20;
  g.rotation = -Math.PI / 5;
  g.lineStyle(Math.max(1, u * 0.7), 0xf2f2f2, 1).moveTo(-8 * u, 0).lineTo(6 * u, 0);
  g.lineStyle(0).beginFill(0xf2f2f2, 1).drawPolygon([6 * u, -1.4 * u, 8.6 * u, 0, 6 * u, 1.4 * u]).endFill();
  g.beginFill(0xc0281e, 1).drawPolygon([-8 * u, 0, -9.6 * u, -1.5 * u, -6.8 * u, -1.5 * u, -5.4 * u, 0, -6.8 * u, 1.5 * u, -9.6 * u, 1.5 * u]).endFill();
  c.addChild(g);
  return c;
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

export function healthColor(p) { return p > 0.5 ? 0x3f9b4a : p > 0.25 ? 0xd4a017 : 0xc0392b; }
export function moraleColor(m) { return m >= 75 ? 0x4aa3df : m <= 25 ? 0x7d5a9e : 0x2f6fb2; }

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
  const acted = hasActed(token), active = !acted && isActive(token), holding = isHolding(token), watching = isOverwatch(token);
  const art = unitArt(token), off = officerArt(actor), fac = factionOf(s.faction);
  const n = figureCount(men, max);
  if (token.mesh && !token.mesh.destroyed) token.mesh.renderable = false; // the stand replaces the picture
  const st = unitStatus(token);
  // a player's own units get bright corner brackets (only that player sees them; the GM never does)
  const mine = !game.user?.isGM && !!actor.isOwner;
  const facing = facingOf(token);
  const key = JSON.stringify([men, max, morale, w, h, s.side, acted, active, holding, watching, st, mine, n, art, off, fac?.img ?? null, facing, battleRecord(token)?.meta?.[token.id]?.carry ?? null, s.traits]); // traits: equipment icons (ladders, engine)
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

  if (st.hidden) stand.alpha = 0.55; // hidden: see-through for those who can still see it
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
  const bh = Math.max(5, Math.round(T * L.bar)), tabW = Math.max(4, Math.round(bh * 0.45));
  const barX = pad + tabW + 1, barW = w - barX - pad, top = h - pad - 2 * (bh + 1) + 1;
  const bars = new PIXI.Container(); // kept apart from the stand so it never greys out
  const g = new PIXI.Graphics();
  bars.addChild(g);
  g.lineStyle(1, 0x000000, 0.9).beginFill(color, 1).drawRoundedRect(pad, top, tabW, 2 * (bh + 1) - 1, 2).endFill();
  const Txt = textClass();
  const styleOpts = { fontFamily: "Signika, sans-serif", fontSize: Math.round(T * 0.13), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: Math.max(2, Math.round(T * 0.035)) };
  [[Math.max(0, Math.min(1, men / max)), healthColor(men / max)],
   [Math.max(0, Math.min(1, morale / 100)), moraleColor(morale)]].forEach(([pct, col], i) => {
    const y = top + i * (bh + 1);
    g.lineStyle(1, 0x000000, 0.9).beginFill(0x111111, 0.8).drawRoundedRect(barX, y, barW, bh, 2).endFill();
    if (pct > 0) g.lineStyle(0).beginFill(col, 0.95).drawRoundedRect(barX + 1, y + 1, Math.max(2, (barW - 2) * pct), bh - 2, 2).endFill();
  });
  c.addChild(bars);
  // which way it faces: shown only while the unit is hovered
  if (facing) { const ch = c.qinChevron = drawFacingChevron(facing, w, h, T, pad, top); ch.visible = !!token.hover || showAllFacing; c.addChild(ch); }
  else c.qinChevron = null;

  // already acted this round: grey it out and say so
  if (acted) {
    const CMF = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    if (CMF) { const f = new CMF(); f.desaturate(); f.brightness(0.75, true); stand.filters = [f]; }
    // the side colour stays: the outline is drawn on top, un-greyed (bars are never greyed)
    c.addChild(new PIXI.Graphics().lineStyle(Math.max(2, T * 0.03), color, 1).drawRoundedRect(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1));
    const t = new Txt(watching ? "Watch" : holding ? "Hold" : "Done", new PIXI.TextStyle({ ...styleOpts, fontSize: Math.round(T * 0.165), fill: "#dddddd" }));
    t.anchor?.set?.(0.5, 0.5);
    c.addChild(t);
    if (holding || watching) { // small shield beside "Hold", reticle beside "Watch"
      const sw = T * 0.15, sh = T * 0.18, gapX = T * 0.025, total = sw + gapX + t.width;
      const icon = watching ? drawOverwatch(T * 0.19) : drawShield(sw, sh);
      const ly = top / 2;
      icon.position.set(w / 2 - total / 2 + sw / 2, ly);
      t.position.set(w / 2 - total / 2 + sw + gapX + t.width / 2, ly);
      c.addChild(icon);
    } else t.position.set(w / 2, top / 2);
  }

  // status icons just above the health bar, left-aligned: Command roll (sword), defense (shield),
  // ranged defense (shield + arrow), range (bow). Positive numbers plain on the shields, signed on sword/bow.
  const signed = (v) => (v > 0 ? `+${v}` : `\u2212${Math.abs(v)}`);
  const plain = (v) => (v > 0 ? `${v}` : `\u2212${Math.abs(v)}`);
  const icons = [];
  if (st.rolls) icons.push([drawYinYang, signed(st.rolls), st.rolls < 0]);
  if (st.attack) icons.push([drawSword, signed(st.attack), st.attack < 0]);
  if (st.defense) icons.push([(sz) => drawShield(sz * 0.62, sz * 0.72), plain(st.defense), st.defense < 0]);
  if (st.rangedDefense) icons.push([drawArrowShield, plain(st.rangedDefense), st.rangedDefense < 0]);
  if (st.range) icons.push([drawBow, signed(st.range), st.range < 0]);
  if (st.hidden) icons.push([drawHiddenEye, "", false]);
  if (watching) icons.push([drawOverwatch, "", false]);
  // siege equipment it carries: the battle's record once a battle runs (it can drop or pick it up), else its traits
  const tiers = tiersFor(s.traits);
  const carried = battleRecord(token)?.meta?.[token.id]?.carry;
  const carry = carried !== undefined ? carried : (tiers["siege ladders"] || tiers["siege ladder"]) ? "ladders" : tiers["siege engine"] ? "engine" : null;
  if (carry === "ladders") icons.push([(sz) => drawLadder(sz * 0.95), "", false]);
  if (carry === "engine") icons.push([(sz) => drawSiegeEngine(sz * 0.95), "", false]);
  const isz = T * 0.17;
  icons.forEach(([fn, label, bad], i) => {
    const cx = pad + T * 0.02 + isz / 2 + i * (isz + T * 0.015), cy = top - isz / 2 - T * 0.012;
    const chip = new PIXI.Graphics().lineStyle(Math.max(1, T * 0.012), 0xd9a441, 1).beginFill(0x1a140e, 0.82).drawCircle(0, 0, isz / 2).endFill();
    chip.position.set(cx, cy);
    const ic = fn(isz); ic.position.set(cx, cy);
    const num = new Txt(label, new PIXI.TextStyle({ ...styleOpts, fill: bad ? "#ff6b5a" : "#ffffff", fontSize: Math.round(isz * 0.46), strokeThickness: Math.max(2, Math.round(isz * 0.12)) }));
    num.anchor?.set?.(0.5, 0.5); num.position.set(cx + isz * 0.3, cy + isz * 0.28);
    c.addChild(chip, ic, num);
  });


  if (fall && !fall.destroyed) c.addChildAt(fall, c.getChildIndex(stand) + 1);

  if (mine && !active) {
    const L2 = T * 0.15, lw = Math.max(2, T * 0.04), x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
    const g2 = new PIXI.Graphics().lineStyle(Math.max(2, T * 0.025), 0x78c8ff, 1).drawRoundedRect(x0, y0, x1 - x0, y1 - y0, T * 0.1);
    g2.lineStyle(lw, 0xdcf0ff, 1);
    for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]])
      g2.moveTo(px + sx * L2, py).lineTo(px, py).lineTo(px, py + sy * L2);
    c.addChild(g2);
  }

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
  Hooks.on("hoverToken", (token, hovered) => {
    if (token.actor?.type !== "unit") return;
    animateFlag(token, hovered ? 1 : 0);
    const ch = token[KEY]?.qinChevron;
    if (ch && !ch.destroyed) ch.visible = !!hovered || showAllFacing;
  });
  // health, morale, officer or faction changes on the actor redraw its tokens
  Hooks.on("updateActor", (actor) => {
    if (actor.type === "unit") for (const t of actor.getActiveTokens?.(true) ?? []) drawUnitBars(t);
    // an officer's portrait changed: redraw the units they lead
    if (actor.type === "character") for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.system?.officer === actor.uuid) drawUnitBars(t);
  });
}
