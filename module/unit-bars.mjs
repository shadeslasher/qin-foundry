// Battle unit "stand": instead of the token picture, every unit token is drawn as a square base in its
// side colour with up to five soldier figures (one per 20% of its strength), its officer's medallion,
// its faction banner rolled up in the corner (it unrolls while hovered), and health/morale bars.
import { factionOf } from "./factions.mjs";
import { traitTiersOf } from "./battle/traits.mjs";
import { tileRules, skillCheck, officerOf, typeOf, officerWeaponLevel } from "./battle/engine.mjs";
import { effectsOf, alwaysOnRolls, status as skStatus } from "./battle/skills.mjs";
import { BOOT } from "./icons.mjs";
import { buildState } from "./battle/adapter.mjs";
import { decodeTiles, FLAG as MAP_FLAG } from "./battle/battlemap.mjs";
import { playMoment } from "./sound.mjs";

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

/** Is this unit holding (+1 melee defense until its next activation)? */
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

/** Shock (David, 2026-10-31): a lightning bolt, the unit was hit by a winning charge and can move only 1 tile on its next activation (2026-11-10). */
function drawShock(size) {
  const g = new PIXI.Graphics(), u = size / 20;
  g.lineStyle(Math.max(1, u * 0.9), 0x3a2400, 1).beginFill(0xffd84a, 1)
    .drawPolygon([2 * u, -8.5 * u, -5 * u, 1 * u, -0.5 * u, 1 * u, -2.5 * u, 8.5 * u, 5.5 * u, -1.5 * u, 0.8 * u, -1.5 * u]).endFill();
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
 *  attack - situational bonus/penalty to this unit's rolls: morale (+1 Encouraged / -2 Demoralized),
 *           losses (2 soldiers -1, 1 soldier -2), and on its own turn the cavalry charge bonus after a
 *           2+ tile move, or the ranged attacker's +2 kept by not moving. During an attack it shows that
 *           attack's whole situational total instead (token.qinAttackBonus).
 *  defense - against melee attacks: Hold (+2), Brace, Shielded, Poison, Suppressing Fire.
 *  rangedDefense - against ranged attacks: Shielded, Shield Battery, Poison. (Hold does not count against ranged attacks.)
 *  range - extra range (nothing grants this automatically yet).
 * Since 2026-11-09 they also count the officer: his Command on every roll (rolls) and his weapon skill on attacks
 * (attack), and the always-on changes from battlefield skills (buffs, his passive, other officers' auras: rolls, attack,
 * defense, rangedDefense). Conditional ones ("Attack +2 against cavalry") show on the sword icon only during the attack
 * they apply to.
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
  if (m >= 75) rolls += 1; else if (m > 0 && m <= 25 && !tr.unwavering) rolls -= 2;
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
      const fierce = Math.min(4, tr["fierce charge"] || 0);
      // a charge (2+ tiles) gets only its Fierce Charge bonus: +4 / +6 / +8 (David, 2026-11-10; no +1 per tile)
      if (tiles >= 2) attack += [0, 4, 6, 8, 8][fierce];
    }
  }
  // the officer's Command and weapon skill, and the battlefield skills' always-on changes (David, 2026-11-09)
  const ex = rollExtras(token);
  let skDef = 0, skRanged = 0;
  if (ex) { rolls += ex.rolls; attack += ex.attack; skDef = ex.defense; skRanged = ex.rangedDefense; }
  if (token.qinAttackBonus !== undefined && token.qinAttackBonus !== null) attack = token.qinAttackBonus;
  const both = -(Number(fx.poison) || 0); // melee & ranged defense (Poison lowers both)
  const supp = !!fx.suppressed; // Suppressing Fire: Attack -1, melee defense -1, Hold and Brace lost
  if (supp) attack -= 1;
  const defense = (round.holding && !supp ? 1 + tierVal(tr.brace, [1, 2, 3]) : 0) - (supp ? 1 : 0) + both; // Shielded gives ranged defense only (2026-10-30)
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
  return { rolls, attack, defense: defense + groundDef + skDef, rangedDefense: rangedDefense + groundRanged + skRanged, range, holding: !!round.holding, hidden: !!s.hidden,
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

/** The red "no" sign drawn over a status icon: a ring and a slash, outlined dark so it reads on any colour. */
function noSign(g, u) {
  for (const [w, col] of [[3.6, 0x1a140e], [2.1, 0xff4a3c]]) {
    g.lineStyle({ width: Math.max(1, w * u * 0.75), color: col, alpha: 1, cap: "round" }).drawCircle(0, 0, 9 * u * 0.83);
    g.moveTo(-6.4 * u * 0.83, -6.4 * u * 0.83).lineTo(6.4 * u * 0.83, 6.4 * u * 0.83);
  }
}
/** Can't attack (David, 2026-11-09): the stand's attack sword with the red sign over it. */
function drawCantAttack(size) {
  const c = new PIXI.Container(), u = size / 20;
  c.addChild(drawSword(size * 0.86));
  const g = new PIXI.Graphics(); noSign(g, u); c.addChild(g);
  return c;
}
/** Can't move (David, 2026-11-09): the Move boot (the stat icon) with the red sign over it. */
let bootTexP = null;
function bootTexture() {
  return bootTexP ??= new Promise(res => {
    try {
      const svg = BOOT.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" ');
      const img = new Image();
      img.onload = () => { const cv = document.createElement("canvas"); cv.width = cv.height = 96; cv.getContext("2d").drawImage(img, 0, 0, 96, 96); res(PIXI.Texture.from(cv)); };
      img.onerror = () => res(null);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } catch { res(null); }
  });
}
let bootTex = null; bootTexture().then(t => { bootTex = t; });
function drawCantMove(size) {
  const c = new PIXI.Container(), u = size / 20;
  if (bootTex) { const b = new PIXI.Sprite(bootTex); b.anchor.set(0.5); b.width = b.height = size * 0.78; c.addChild(b); }
  const g = new PIXI.Graphics(); noSign(g, u); c.addChild(g);
  return c;
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
export function analyseFlag(src) {
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
  if (c?.qinReadyTick) canvas.app?.ticker?.remove(c.qinReadyTick);
  if (c?.qinFxTick) canvas.app?.ticker?.remove(c.qinFxTick);
  if (c?.qinLastTick) canvas.app?.ticker?.remove(c.qinLastTick);
  if (token.qinBurst && !token.qinBurst.destroyed) token.qinBurst.destroy({ children: true });
  token.qinBurst = null;
  if (c && !c.destroyed) c.destroy({ children: true });
  token[KEY] = null;
  if (token.mesh && !token.mesh.destroyed) token.mesh.renderable = true;
}


/* ------------------------------------------------------------ skill ready (David, 2026-11-09) */

// Which units' officers could use their battlefield active right now: "ready", "last" (a last stand), or none.
// Worked out once per battle state and shared by every stand; cleared when the battle, a unit or a token changes.
let readyCache = null;
function readyMap(battle) {
  if (readyCache) return readyCache.map; // cleared by the hooks in registerUnitBars whenever anything it depends on changes
  const map = {}, eff = {}, rolls = {}, locks = {};
  try {
    const { s } = buildState(battle);
    for (const u of s.units) {
      if (u.status !== "active") continue;
      // what the officer and the battlefield skills add to its rolls, for the icons (David, 2026-11-09): the officer's
      // Command on every roll, his weapon skill on its attacks, and the skills' always-on changes
      try {
        const o = u.officerId ? officerOf(s, u) : null, t = typeOf(s, u), sk = alwaysOnRolls(s, u);
        const lv = o && t ? officerWeaponLevel(o, t) : 0;
        rolls[u.id] = { rolls: (o?.command || 0) + sk.command, attack: (lv > 1 ? lv - 1 : 0) + sk.attack, defense: sk.meleeDef, rangedDefense: sk.rangedDef };
      } catch (e) { console.warn("Qin | roll icons", e); }
      // buffs and debuffs the stand shows (not passive auras: they come and go as units move)
      // can't move / can't attack from a battlefield skill (David, 2026-11-09): icons on the stand
      try { const m = !!skStatus(s, u, "cantMove"), a = !!skStatus(s, u, "cantAttack"); if (m || a) locks[u.id] = { move: m, attack: a }; } catch { /* fine */ }
      // each part on its own: one unit's problem must not take the marks off every other unit (David, 2026-11-09)
      try {
        const list = effectsOf(s, u).filter(e => !e.aura);
        if (list.length) { const of = (k) => list.filter(e => e.kind === k); eff[u.id] = { nb: of("buff").length, nd: of("debuff").length, pb: of("buff").reduce((a, e) => a + e.power, 0), pd: of("debuff").reduce((a, e) => a + e.power, 0), keys: list.map(e => e.key + "|" + e.kind), names: list.map(e => e.name) }; }
        // a buff his own battlefield active put on his own unit: an aura in his officer type's colour (David, 2026-11-12)
        const o = u.officerId ? officerOf(s, u) : null;
        if (eff[u.id] && o?.skill && list.some(e => e.self && e.kind === "buff" && e.name === o.skill.name)) eff[u.id].selfBuff = { ctype: o.ctype || "", tier: Number(o.tier) || 0, high: !!o.tierHigh };
      } catch (e) { console.warn("Qin | effects on " + u.id, e); }
      if (!u.officerId) continue;
      try {
        const o = officerOf(s, u);
        if (o?.skill && skillCheck(s, u, o).ok) map[u.id] = o.skill.lastStand ? "last" : "ready";
      } catch (e) { console.warn("Qin | skill-ready mark on " + u.id, e); }
    }
  } catch (e) { console.warn("Qin | skill-ready marks", e); }
  readyCache = { map, eff, rolls, locks };
  noteLanded(battle, eff);
  return map;
}
/** What the officer and the battlefield skills add to the unit's rolls (see readyMap), or null outside a battle. */
function lockStatus(token) {
  const battle = battleRecord(token);
  if (!battle) return null;
  readyMap(battle);
  return readyCache?.locks?.[token.id] ?? null;
}
function rollExtras(token) {
  const battle = battleRecord(token);
  if (!battle) return null;
  readyMap(battle);
  return readyCache?.rolls?.[token.id] ?? null;
}
function effectCounts(token) {
  const battle = battleRecord(token);
  if (!battle) return null;
  readyMap(battle);
  return readyCache?.eff?.[token.id] ?? null;
}
function skillReady(token) {
  const battle = battleRecord(token);
  return battle ? readyMap(battle)[token.id] ?? null : null;
}
const READY_COLORS = { ready: 0xffffff, last: 0xff5a3c };

/** Points evenly spaced around a rounded rectangle (for the light that runs along the stand's edge). */
function roundedRectPath(x, y, w, h, r, n = 240) {
  const P = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 12; i++) { const a = a0 + (a1 - a0) * i / 12; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  P.push([x + r, y], [x + w - r, y]); arc(x + w - r, y + r, -Math.PI / 2, 0);
  P.push([x + w, y + h - r]); arc(x + w - r, y + h - r, 0, Math.PI / 2);
  P.push([x + r, y + h]); arc(x + r, y + h - r, Math.PI / 2, Math.PI);
  P.push([x, y + r]); arc(x + r, y + r, Math.PI, Math.PI * 1.5);
  const Q = [...P, P[0]], d = [0];
  for (let i = 1; i < Q.length; i++) d.push(d[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
  const out = [];
  for (let k = 0, j = 0; k < n; k++) {
    const want = d.at(-1) * k / n;
    while (d[j + 1] < want) j++;
    const f = (want - d[j]) / ((d[j + 1] - d[j]) || 1);
    out.push([Q[j][0] + (Q[j + 1][0] - Q[j][0]) * f, Q[j][1] + (Q[j + 1][1] - Q[j][1]) * f]);
  }
  return out;
}

/**
 * The skill-ready mark (David, 2026-11-09): two streaks of light run round the stand's edge, passing under
 * the officer's portrait; a halo pulses round the portrait, with a small lightning badge bobbing beside it.
 * White when the active is ready, red-orange when it is a last stand that can be used now.
 */
function drawSkillReady(c, kind, offTex, w, h, T, pad) {
  const col = READY_COLORS[kind] ?? 0xffffff;
  const Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;
  const od = T * L.officer, mx = T * 0.015 + od / 2, my = T * 0.015 + od / 2, mr = od / 2;
  const box = new PIXI.Container(); box.eventMode = "none";
  const runGlow = new PIXI.Graphics(), run = new PIXI.Graphics();
  if (Blur) runGlow.filters = [new Blur(T * 0.025)];
  box.addChild(runGlow, run);
  // the portrait again, above the streaks, so they pass under it
  if (offTex) { const o = circleFigure(offTex, od, false); o.position.set(mx, my); box.addChild(o); }
  const haloGlow = new PIXI.Graphics(), halo = new PIXI.Graphics();
  if (Blur) haloGlow.filters = [new Blur(T * 0.03)];
  box.addChild(haloGlow, halo);
  const u = T / 200, chip = new PIXI.Graphics();
  chip.lineStyle(Math.max(1, 2 * u), col, 1).beginFill(0x1a140e, 1).drawCircle(0, 0, 11 * u).endFill();
  chip.lineStyle(0).beginFill(col, 1).drawPolygon([2 * u, -8 * u, -5 * u, 1 * u, -1 * u, 1 * u, -3 * u, 8 * u, 5 * u, -2 * u, 1 * u, -2 * u]).endFill();
  box.addChild(chip);
  const path = roundedRectPath(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1), n = path.length, len = Math.round(n * 0.16);
  let time = 0;
  const tick = () => {
    if (box.destroyed) return;
    time += (canvas.app?.ticker?.deltaMS ?? 16) / 1000;
    const start = Math.floor(((time / 2.6) % 1) * n);
    for (const g of [runGlow, run]) g.clear();
    for (const side of [0, n >> 1]) for (let i = 0; i < len - 1; i++) {
      const a = path[(start + side + i) % n], b = path[(start + side + i + 1) % n], al = Math.min(1, (i + 1) / (len * 0.5));
      runGlow.lineStyle(T * 0.05, col, al * 0.8).moveTo(...a).lineTo(...b);
      run.lineStyle(Math.max(2, T * 0.025), col, al).moveTo(...a).lineTo(...b);
    }
    const p = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 / 1.3);
    for (const g of [haloGlow, halo]) g.clear();
    haloGlow.lineStyle(T * (0.04 + 0.03 * p), col, 0.5 + 0.5 * p).drawCircle(mx, my, mr + T * 0.02);
    halo.lineStyle(T * (0.015 + 0.02 * p), col, 0.35 + 0.65 * p).drawCircle(mx, my, mr + T * 0.02);
    chip.position.set(mx + mr * 0.95, my + mr * 0.95 - T * 0.02 * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 / 0.9)));
  };
  tick();
  c.addChild(box);
  c.qinReadyBox = box;
  return tick;
}


/* ------------------------------------------------------------ lasting looks of special actives (David, 2026-11-12) */

// While certain tier 1+ battlefield actives last, the unit keeps a look of its own (by the active's name).
const LASTING = { "None Can Stand Before Him": "fire",   // Lu Bu: a fiery aura round his unit
  "Might That Shakes the Realm": "jade" };               // Guan Yu: the same in green (David, 2026-11-12)
// Every other officer whose battlefield active buffs his own unit (David, 2026-11-12): Tier 0-1 get the flame aura in their
// officer type's colour, Tier 2 High a glowing border outside the frame with motes rising from it, everyone else the border.
const TYPE_LOOK = { Vanguard: "fire", Champion: "jade", Commander: "gold", Strategist: "azure", Sentinel: "violet" };
const TYPE_HEX = { Vanguard: 0xee6a5e, Champion: 0x5fcf8c, Commander: 0xe8c04a, Strategist: 0x6fa8ee, Sentinel: 0xb48ae8 };
function lastingLook(eff) {
  for (const n of eff?.names ?? []) if (LASTING[n]) return LASTING[n];
  const sb = eff?.selfBuff; if (!sb || !TYPE_LOOK[sb.ctype]) return null;
  return sb.tier <= 1 ? TYPE_LOOK[sb.ctype] : (sb.high ? "border-high:" : "border:") + sb.ctype;
}
const AURA_LOOK = {
  fire: { glow: 0xff3a10, stops: ["rgba(255,240,170,1)", "rgba(255,150,40,0.95)", "rgba(220,40,10,0.6)", "rgba(120,0,0,0)"], embers: [0xffd27a, 0xff7a2a] },
  gold: { glow: 0xffb000, stops: ["rgba(255,250,215,1)", "rgba(255,215,90,0.95)", "rgba(215,150,20,0.6)", "rgba(110,60,0,0)"], embers: [0xfff0b0, 0xffc040] },
  azure: { glow: 0x2a8cff, stops: ["rgba(225,240,255,1)", "rgba(120,185,255,0.95)", "rgba(30,100,220,0.6)", "rgba(0,30,110,0)"], embers: [0xd8ecff, 0x60a8ff] },
  violet: { glow: 0xa050ff, stops: ["rgba(245,230,255,1)", "rgba(195,145,255,0.95)", "rgba(120,50,210,0.6)", "rgba(50,0,100,0)"], embers: [0xeedcff, 0xb070ff] },
  jade: { glow: 0x22d06a, stops: ["rgba(225,255,225,1)", "rgba(110,235,140,0.95)", "rgba(20,150,70,0.6)", "rgba(0,70,30,0)"], embers: [0xc8ffd0, 0x40e080] },
};
const auraFlameTex = {};
/** Soft wisps of flame for the lasting aura: a few variants, each a wavy column of blurred blobs, hot at the root. */
function wispTex(look = "fire", v = 0) {
  const key = look + v; if (auraFlameTex[key]) return auraFlameTex[key];
  const st = AURA_LOOK[look].stops, W = 64, H = 112, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  // a soft tongue of flame, leaning a little one way or the other, blurred so it has no hard edges
  const lean = [-10, -4, 5, 11][v % 4], gr = g.createLinearGradient(0, H - 8, 0, 8);
  gr.addColorStop(0, st[0]); gr.addColorStop(0.3, st[1]); gr.addColorStop(0.7, st[2]); gr.addColorStop(1, st[3]);
  g.filter = "blur(5px)"; g.fillStyle = gr;
  g.beginPath(); g.moveTo(W / 2 - 16, H - 12);
  g.bezierCurveTo(W / 2 - 22, H * 0.55, W / 2 + lean - 8, H * 0.35, W / 2 + lean, 10);
  g.bezierCurveTo(W / 2 + lean + 6, H * 0.4, W / 2 + 22, H * 0.55, W / 2 + 16, H - 12);
  g.closePath(); g.fill();
  // a hot core
  g.filter = "blur(7px)"; const cg = g.createRadialGradient(W / 2, H - 26, 0, W / 2, H - 26, 18); cg.addColorStop(0, st[0]); cg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = cg; g.fillRect(0, 0, W, H);
  return (auraFlameTex[key] = PIXI.Texture.from(cv));
}
/** A lasting aura of flame (Lu Bu's red fire, Guan Yu's green; David, 2026-11-12: soft and wispy, not spiky): a soft glow
 *  round the stand, and wisps of flame that rise from all along its edge, sway, drift up and thin away; embers rise. */
function drawFireAura(c, w, h, T, pad, look = "fire") {
  const P = AURA_LOOK[look], ADD = PIXI.BLEND_MODES.ADD, Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;
  const back = new PIXI.Container(), front = new PIXI.Container(); c.addChildAt(back, 0); c.addChild(front);
  const glow = new PIXI.Graphics(); glow.blendMode = ADD; if (Blur) glow.filters = [new Blur(T * 0.1)];
  glow.lineStyle(T * 0.18, P.glow, 1).drawRoundedRect(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1); back.addChild(glow);
  const rim = roundedRectPath(pad, pad, w - 2 * pad, h - 2 * pad, T * 0.1, 120), wisps = [], embers = [];
  const texs = [0, 1, 2, 3].map(v => wispTex(look, v));
  const spawn = (wp, first) => {
    const [x, y] = rim[Math.floor(Math.random() * rim.length)];
    Object.assign(wp, { x, y, life: 0.9 + Math.random() * 0.8, t: first ? Math.random() * 1.5 : 0, rise: T * (0.12 + Math.random() * 0.2), drift: (x - w / 2) / w * T * 0.25, sw: Math.random() * 6, sz: T / 112 * (0.4 + Math.random() * 0.3) });
    wp.sp.texture = texs[Math.floor(Math.random() * texs.length)];
  };
  for (let i = 0; i < 44; i++) { const lay = i < 30 ? back : front, sp = new PIXI.Sprite(texs[0]); sp.anchor.set(0.5, 0.88); sp.blendMode = i % 3 ? PIXI.BLEND_MODES.NORMAL : ADD; lay.addChild(sp); const wp = { sp, front: lay === front }; spawn(wp, true); wisps.push(wp); }
  for (let i = 0; i < 10; i++) { const e = new PIXI.Graphics().beginFill(P.embers[i % 2]).drawCircle(0, 0, T * 0.016).endFill(); e.blendMode = ADD; front.addChild(e); embers.push({ e, ph: Math.random(), x: pad + Math.random() * (w - 2 * pad), sp: 0.35 + Math.random() * 0.35 }); }
  let time = 0;
  const tick = () => {
    if (back.destroyed) return;
    const dt = (canvas.app?.ticker?.deltaMS ?? 16) / 1000; time += dt;
    glow.alpha = 0.6 + 0.2 * Math.sin(time * 3.1) + 0.08 * Math.sin(time * 7.7);
    for (const wp of wisps) {
      wp.t += dt; let q = wp.t / wp.life; if (q >= 1) { spawn(wp, false); q = 0; }
      const sway = Math.sin(time * 3 + wp.sw) * T * 0.03 * q;
      wp.sp.position.set(wp.x + wp.drift * q + sway, wp.y - wp.rise * q);
      wp.sp.scale.set(wp.sz * (1.1 - 0.4 * q), wp.sz * (0.6 + 0.7 * Math.sin(Math.min(1, q * 1.3) * Math.PI / 2)));
      wp.sp.rotation = Math.sin(time * 2 + wp.sw) * 0.15;
      wp.sp.alpha = (q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8) * (wp.front ? 0.75 : 1);
    }
    for (const m of embers) { const q = (time * m.sp + m.ph) % 1; m.e.position.set(m.x + Math.sin(time * 4 + m.ph * 9) * T * 0.04, h - pad - q * h * 1.3); m.e.alpha = 1 - q; }
  };
  // place every wisp before the stand is first drawn: until the first tick they sat unscaled at the stand's top-left
  // corner, and one big flame flashed there for a frame (David, 2026-11-12)
  tick();
  return tick;
}

/** A self-buff border for officers below Tier 1 (David, 2026-11-12): a glowing ring in the officer type's colour drawn
 *  just outside the stand's frame, with a dark gap, so the frame's side colour stays clear; it pulses slowly. Tier 2 High
 *  officers also get motes rising from it. */
function drawGlowBorder(c, w, h, T, pad, col, high) {
  const Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter, ADD = PIXI.BLEND_MODES.ADD, o = T * 0.075;
  const x = pad - o, y = pad - o, bw = w - 2 * pad + 2 * o, bh = h - 2 * pad + 2 * o, r = T * 0.14;
  const halo = new PIXI.Graphics(); if (Blur) halo.filters = [new Blur(T * 0.07)]; halo.eventMode = "none"; c.addChildAt(halo, 0);
  const front = new PIXI.Container(); front.eventMode = "none"; c.addChild(front);
  const line = new PIXI.Graphics(); front.addChild(line);
  line.lineStyle(T * 0.03, 0x101010, 0.55).drawRoundedRect(pad - o * 0.45, pad - o * 0.45, w - 2 * pad + o * 0.9, h - 2 * pad + o * 0.9, T * 0.12)
    .lineStyle(T * 0.022, col, 0.9).drawRoundedRect(x, y, bw, bh, r);
  const rim = high ? roundedRectPath(x, y, bw, bh, r, 160) : [], motes = [];
  for (let i = 0; high && i < 10; i++) { const g = new PIXI.Graphics().beginFill(col).drawCircle(0, 0, T * 0.016).endFill(); g.blendMode = ADD; front.addChild(g); motes.push({ g, i: Math.floor(Math.random() * rim.length), ph: Math.random(), sp: 0.35 + Math.random() * 0.3 }); }
  let time = 0;
  const tick = () => {
    if (halo.destroyed) return;
    time += (canvas.app?.ticker?.deltaMS ?? 16) / 1000; const p = 0.5 + 0.5 * Math.sin(time * 2.6);
    halo.clear().lineStyle(T * (0.07 + 0.03 * p), col, 0.55 + 0.3 * p).drawRoundedRect(x, y, bw, bh, r);
    for (const m of motes) { const q = (time * m.sp + m.ph) % 1, [mx, my] = rim[m.i]; m.g.position.set(mx, my - q * T * 0.35); m.g.alpha = 1 - q; if (q < 0.02) m.i = Math.floor(Math.random() * rim.length); }
  };
  tick(); return tick;
}

/* ------------------------------------------------------------ buffs and debuffs (David, 2026-11-09) */
// When a buff or debuff from a battlefield skill or a stat-changing trait lands, the stand plays a 1.5-second burst:
// tinted, with bright chevron lines scrolling up (blue, buff) or down (red, debuff) inside its frame. While effects last,
// motes drift up (buffs) or down (debuffs) across it, more for stronger effects, and a soft halo outside the frame grows
// with each one (up to 4).
const FX_BLUE = 0x4a9be8, FX_RED = 0xe0483c;
let seenFx = null;           // { battleKey, keys: { tokenId: Set } } — what each unit had last time, to spot new effects
const pendingBurst = new Map(); // tokenId -> ['buff'|'debuff', ...] waiting to play
function noteLanded(battle, eff) {
  const bkey = battle.sceneId || "";
  const now = {};
  for (const [id, e] of Object.entries(eff)) now[id] = new Set(e.keys);
  if (seenFx && seenFx.battleKey === bkey) {
    for (const [id, set] of Object.entries(now)) {
      const before = seenFx.keys[id] ?? new Set(), kinds = new Set();
      for (const k of set) if (!before.has(k)) kinds.add(k.split("|").pop());
      if (kinds.size) pendingBurst.set(id, [...kinds].sort()); // "buff" before "debuff"
    }
  }
  seenFx = { battleKey: bkey, keys: now };
}

/* Activation hold (David, 2026-11-09): when an officer uses a battlefield active, the GM freezes that unit's stand on
 * every client before the new state is saved, so its morale drop, ready mark and buff wait for the banner; the
 * activation animation releases it (or it releases itself after a while, e.g. on a client looking at another scene). */
const frozen = new Map(); // tokenId -> timeout
export function freezeUnits(ids, ms = 15000) {
  for (const id of ids ?? []) {
    clearTimeout(frozen.get(id));
    frozen.set(id, setTimeout(() => releaseUnits([id]), ms));
  }
}
export function releaseUnits(ids) {
  for (const id of ids ?? []) {
    if (!frozen.has(id)) continue;
    clearTimeout(frozen.get(id)); frozen.delete(id);
    const t = canvas?.tokens?.get(id);
    if (t) drawUnitBars(t);
  }
}
/** Hide the skill-ready mark at once (the activation's flash replaces it). */
export function hideSkillReady(token) {
  const c = token?.[KEY];
  if (c?.qinReadyTick) { canvas.app?.ticker?.remove(c.qinReadyTick); c.qinReadyTick = null; }
  if (c?.qinReadyBox && !c.qinReadyBox.destroyed) c.qinReadyBox.visible = false;
  if (c) c.qinKey = null; // the next draw puts it back if the unit is still ready
}

const fxTex = {};
/** A tile of the burst pattern: one bright chevron line in a 40 x 46 cell, pointing the way it scrolls. */
function chevronTexture(up) {
  const k = up ? "up" : "dn";
  if (fxTex[k]) return fxTex[k];
  const cv = document.createElement("canvas"); cv.width = 40; cv.height = 46;
  const g = cv.getContext("2d");
  const pts = up ? [[0, 22], [20, 8], [40, 22], [40, 30], [20, 16], [0, 30]] : [[0, 2], [20, 16], [40, 2], [40, 10], [20, 24], [0, 10]];
  g.fillStyle = up ? "rgba(200,230,255,0.75)" : "rgba(255,205,195,0.75)";
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  return (fxTex[k] = PIXI.Texture.from(cv));
}
/** The burst's tint: stronger at the end it starts from (the bottom for a buff, the top for a debuff). */
function tintTexture(up) {
  const k = "tint" + (up ? "up" : "dn");
  if (fxTex[k]) return fxTex[k];
  const cv = document.createElement("canvas"); cv.width = 4; cv.height = 128;
  const g = cv.getContext("2d"), gr = g.createLinearGradient(0, up ? 128 : 0, 0, up ? 0 : 128);
  const rgb = up ? "74,155,232" : "224,72,60";
  gr.addColorStop(0, `rgba(${rgb},0.45)`); gr.addColorStop(1, `rgba(${rgb},0.2)`);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  return (fxTex[k] = PIXI.Texture.from(cv));
}

/** Play the landing burst(s) on a token: 1.5 seconds each, a buff's then a debuff's. Sits on the token, above the stand.
 *  The effect sweeps in from the bottom for a buff (from the top for a debuff), holds, then fades. */
function playBurst(token, kinds, w, h, T, pad) {
  if (token.qinBurst && !token.qinBurst.destroyed) token.qinBurst.destroy({ children: true });
  const box = token.qinBurst = new PIXI.Container(); box.eventMode = "none";
  const x = pad, y = pad, bw = w - 2 * pad, bh = h - 2 * pad, r = T * 0.1, sc = T / 200;
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(x, y, bw, bh, r).endFill();
  box.addChild(mask); box.mask = mask;
  const layers = kinds.map((kind, i) => {
    const up = kind === "buff", L2 = new PIXI.Container();
    const tint = new PIXI.Sprite(tintTexture(up)); tint.position.set(x, y); tint.width = bw; tint.height = bh;
    const pat = new PIXI.TilingSprite(chevronTexture(up), bw, bh); pat.position.set(x, y); pat.tileScale.set(sc);
    const wipe = new PIXI.Graphics(); // how much of the stand the effect has reached so far
    L2.addChild(tint, pat, wipe); L2.mask = wipe; L2.alpha = 0; box.addChild(L2);
    return { L2, pat, wipe, up, start: i * 1.5 };
  });
  token.addChild(box);
  // the burst's sound (David, 2026-11-11): once per wave however many units it lands on; a debuff's plays with its own layer
  kinds.forEach((kind, i) => { const m = kind === "buff" ? "Buff lands" : "Debuff lands"; if (i) setTimeout(() => playMoment(m, { minGap: 400 }), i * 1500); else playMoment(m, { minGap: 400 }); });
  const DUR = 1.5, SWEEP = 0.35, SPEED = 184 * sc; // the pattern moves at one steady speed for the whole burst
  let t = 0;
  const tick = () => {
    if (box.destroyed) return canvas.app?.ticker?.remove(tick);
    t += (canvas.app?.ticker?.deltaMS ?? 16) / 1000;
    let done = true;
    for (const l of layers) {
      const lt = t - l.start, k = lt / DUR;
      if (k < 1) done = false;
      l.L2.alpha = k <= 0 || k >= 1 ? 0 : k > 0.8 ? (1 - k) / 0.2 : 1;
      const e = 1 - (1 - Math.min(1, Math.max(0, lt / SWEEP))) ** 2, reach = bh * e; // eases out as it reaches the far edge
      l.wipe.clear().beginFill(0xffffff).drawRect(x, l.up ? y + bh - reach : y, bw, reach).endFill();
      l.pat.tilePosition.y = (l.up ? -1 : 1) * SPEED * Math.max(0, lt);
    }
    if (done) { canvas.app?.ticker?.remove(tick); box.destroy({ children: true }); if (token.qinBurst === box) token.qinBurst = null; }
  };
  canvas.app?.ticker?.add(tick);
}

/** Motes for a kind of effect: more for stronger effects (their total power), 6 to 24. */
export const moteCount = (power) => Math.max(6, Math.min(24, Math.round(4 + 2 * (power || 0))));

/** The lingering look: a soft halo per kind (stronger with more effects) and drifting motes. Returns its ticker. */
function drawLingering(c, eff, w, h, T, pad) {
  const Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;
  const x = pad, y = pad, bw = w - 2 * pad, bh = h - 2 * pad, r = T * 0.1, sc = T / 200;
  const halos = [], motes = [];
  const under = new PIXI.Container(), over = new PIXI.Container();
  under.eventMode = over.eventMode = "none";
  for (const [n, pw, col, up, phase] of [[eff.nb, eff.pb, FX_BLUE, true, 0], [eff.nd, eff.pd, FX_RED, false, 1.5]]) {
    if (!n) continue;
    const k = Math.min(n, 4);
    const g = new PIXI.Graphics().lineStyle(T * (0.02 + 0.012 * k), col, 1).drawRoundedRect(x, y, bw, bh, r);
    if (Blur) g.filters = [new Blur(T * (0.03 + 0.012 * k))];
    under.addChild(g);
    halos.push({ g, peak: 0.25 + 0.17 * k, phase });
    for (let i = 0; i < moteCount(pw ?? 2 * n); i++) {
      const d = new PIXI.Graphics();
      d.beginFill(col, 0.25).drawCircle(0, 0, 1).endFill().beginFill(col, 0.85).drawCircle(0, 0, 0.62).endFill().beginFill(0xffffff, 1).drawCircle(0, 0, 0.3).endFill();
      over.addChild(d);
      const mo = { d, up };
      reseed(mo, true);
      motes.push(mo);
    }
  }
  function reseed(mo, first) {
    mo.size = (7 + Math.random() * 4) * sc;
    mo.x0 = x + (6 + Math.random() * (bw / sc - 17)) * sc;
    mo.dx = (Math.random() * 24 - 12) * sc;
    mo.span = (110 + Math.random() * 40) * sc;
    mo.dur = 2.2 + Math.random() * 1.4;
    mo.t = first ? -Math.random() * 0.4 + Math.random() * mo.dur : -Math.random() * 0.6;
    mo.d.scale.set(mo.size);
  }
  c.addChildAt(under, 0);
  c.addChild(over);
  let time = 0;
  const tick = () => {
    if (over.destroyed) return;
    const dt = (canvas.app?.ticker?.deltaMS ?? 16) / 1000;
    time += dt;
    for (const hl of halos) { const p = 0.5 + 0.5 * Math.sin((time + hl.phase) * Math.PI * 2 / 3); hl.g.alpha = hl.peak * (0.6 + 0.4 * p); }
    for (const mo of motes) {
      mo.t += dt;
      if (mo.t >= mo.dur) reseed(mo, false);
      const k = Math.max(0, mo.t) / mo.dur;
      const sway = k < 0.5 ? mo.dx * (k / 0.5) : mo.dx - 1.5 * mo.dx * ((k - 0.5) / 0.5);
      const top = y + T * 0.02, bottom = y + mo.span;
      mo.d.position.set(mo.x0 + sway, mo.up ? bottom - (bottom - top) * k : top + (bottom - top) * k);
      mo.d.alpha = mo.t < 0 ? 0 : k < 0.15 ? k / 0.15 : k > 0.85 ? Math.max(0, 0.85 * (1 - k) / 0.15) : 1;
    }
  };
  tick();
  return tick;
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
  if (frozen.has(token.id) && token[KEY] && !token[KEY].destroyed) return; // held for an activation animation
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
  const ready = acted ? null : skillReady(token); // skill-ready mark: not on a unit that has already acted this round
  const eff = effectCounts(token); // buffs and debuffs on it now (counts for the lingering look)
  const locks = lockStatus(token); // can't move / can't attack
  if (locks?.move && !bootTex) await bootTexture().then(t => { bootTex = t; });
  const lasting = lastingLook(eff);
  const key = JSON.stringify([ready, locks, lasting, eff ? [eff.nb, eff.nd, eff.pb, eff.pd] : null, men, max, morale, w, h, s.side, acted, active, holding, watching, st, mine, n, art, off, fac?.img ?? null, facing, battleRecord(token)?.meta?.[token.id]?.carry ?? null, !!battleRecord(token)?.meta?.[token.id]?.fx?.shocked, s.traits]); // traits: equipment icons (ladders, engine)
  if (pendingBurst.has(token.id)) { const kinds = pendingBurst.get(token.id); pendingBurst.delete(token.id); playBurst(token, kinds, w, h, T, T * L.pad); }
  let c = token[KEY];
  // (a ready mark that was hidden for an activation, e.g. one undone or replayed, is drawn again: David, 2026-11-09)
  if (c && !c.destroyed && c.parent === token && c.qinKey === key && !(ready && !c.qinReadyTick)) return;
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
  if (c.qinReadyTick) { canvas.app?.ticker?.remove(c.qinReadyTick); c.qinReadyTick = null; }
  if (c.qinFxTick) { canvas.app?.ticker?.remove(c.qinFxTick); c.qinFxTick = null; }
  if (c.qinLastTick) { canvas.app?.ticker?.remove(c.qinLastTick); c.qinLastTick = null; }
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
  if (battleRecord(token)?.meta?.[token.id]?.fx?.shocked) icons.push([drawShock, "", true]);
  if (locks?.move) icons.push([drawCantMove, "", true]);
  if (locks?.attack) icons.push([drawCantAttack, "", true]);
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
  if (ready) { c.qinReadyTick = drawSkillReady(c, ready, offTex, w, h, T, pad); canvas.app?.ticker?.add(c.qinReadyTick); }
  if (eff && (eff.nb || eff.nd)) { c.qinFxTick = drawLingering(c, eff, w, h, T, pad); canvas.app?.ticker?.add(c.qinFxTick); }
  if (lasting) {
    const [kind, ctype] = lasting.split(":");
    c.qinLastTick = ctype ? drawGlowBorder(c, w, h, T, pad, TYPE_HEX[ctype], kind === "border-high") : drawFireAura(c, w, h, T, pad, lasting);
    canvas.app?.ticker?.add(c.qinLastTick);
  }
  // the banner sits above every outline drawn on the stand (David, 2026-10-31: it went under the border); greyed with the stand
  if (c.qinFlag && !c.qinFlag.destroyed) {
    if (stand.filters?.length) c.qinFlag.filters = stand.filters;
    c.qinFlag.alpha = stand.alpha;
    c.addChild(c.qinFlag);
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
  // the skill-ready marks follow the battle (turns, morale, recharges): work them out again and redraw
  Hooks.on("updateSetting", (st) => { if (st.key === "qin.battle") { readyCache = null; redrawAllUnitBars(); } });
  for (const h of ["updateActor", "updateToken", "createToken", "deleteToken", "canvasReady"]) Hooks.on(h, () => { readyCache = null; });
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
export { drawLingering as _drawLingering, playBurst as _playBurst, drawSkillReady as _drawSkillReady, drawCantMove as _drawCantMove, drawCantAttack as _drawCantAttack, bootTexture as _bootTexture }; // for the stand harness
