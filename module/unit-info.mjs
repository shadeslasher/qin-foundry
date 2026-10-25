// Battle unit details for everyone at the table: the hover tooltip, a movement preview while hovering,
// and a read-only "Info" window (portrait, stats, officer, formations, traits).
import * as E from "./battle/engine.mjs";
import { getBattle, buildState, emptyBattle, formationsEnabled } from "./battle/adapter.mjs";
import { formationSummary } from "./sheets/sheets.mjs";
import { factionOf } from "./factions.mjs";
import { SKILLS } from "./config.mjs";
import { healthColor, moraleColor } from "./unit-bars.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Can this user see the unit at all (hidden tokens stay secret from players)? */
export function unitVisible(token) {
  return token?.actor?.type === "unit" && !(token.document?.hidden && !game.user.isGM);
}

function rangeText(sys) {
  if (!(sys.range > 1)) return "";
  const lo = Math.min(sys.rangeMin || 1, sys.range);
  return lo > 1 ? `${lo}–${sys.range}` : `${sys.range}`;
}

/** Every unit shows its weapon; ranged units add their range. */
function weaponLine(sys) {
  const r = rangeText(sys);
  const weapon = esc(sys.unitType || (r ? "Ranged" : "Melee"));
  return r ? `${weapon} · Range ${r}` : weapon;
}

/** Officer actor for a unit (world actors resolve synchronously). */
function officerOf(sys) {
  try { return sys.officerActor ?? null; } catch { return null; }
}

/* ------------------------------------------------------------ hover tooltip */

/** Icons for the tooltip's stat tiles. */
// There's no chestplate emoji, so armor is a small drawn cuirass in the same spirit as the others
const CHESTPLATE = `<svg class="qin-tt-svg" viewBox="0 0 24 24"><path d="M7 3.5c1.6 1.3 3.2 1.9 5 1.9s3.4-.6 5-1.9l3.6 2.2-1.4 4.3-1.6-.6v8.1c0 1.6-2.4 3-5.6 3s-5.6-1.4-5.6-3v-8.1l-1.6.6-1.4-4.3z" fill="#b9c3cc" stroke="#3a4048" stroke-width="1.1" stroke-linejoin="round"/><path d="M12 5.4v15.1M8.2 11.5c2.4 1 5.2 1 7.6 0M8.2 15c2.4 1 5.2 1 7.6 0" fill="none" stroke="#6d7782" stroke-width="1"/><path d="M7.3 4.1c-.6 1.6-.3 3.4.9 5.5M16.7 4.1c.6 1.6.3 3.4-.9 5.5" fill="none" stroke="#c9a24a" stroke-width="1.1"/></svg>`;
// Pierce: a sword striking a breastplate from the upper right, with a crack and sparks (David, 2026-10-25)
const PIERCE = `<svg class="qin-tt-svg" viewBox="0 0 24 24"><path d="M7 9c1.6 1.2 3.2 1.8 5 1.8s3.4-.6 5-1.8l2.6 1.6-1 3.2-1.2-.4V19c0 1.3-2.4 2.5-5.4 2.5S6.6 20.3 6.6 19v-5.6l-1.2.4-1-3.2z" fill="#b9c3cc" stroke="#3a4048" stroke-width="1.1" stroke-linejoin="round"/><path d="M10.8 13 L13.14 10.78 L18.13 5.02 L16.6 3.7 L11.6 9.46 L9.87 12.2 Z" fill="#e9eef2" stroke="#3a4048" stroke-width="1"/><path d="M19.9 7.5 L14.8 1.9" stroke="#c9a24a" stroke-width="1.8" stroke-linecap="round"/><path d="M17.36 4.36 L19.7 2.4" stroke="#7a2a20" stroke-width="2" stroke-linecap="round"/><circle cx="20.5" cy="2" r="1.2" fill="#c9a24a"/><path d="M10.8 13l-1.6 2.2 1.2 1.6-1.8 2.4M10.8 13l2 1.4-.6 1.9" fill="none" stroke="#3a4048" stroke-width="1" stroke-linecap="round"/><path d="M7.3 12l-2-1.2M8.2 9.8l-1-2.1M11.4 9.2l.3-2.3" stroke="#ffe08a" stroke-width="1.1" stroke-linecap="round"/></svg>`;
// Move: a walking boot (traced from an icon David supplied; game-icons.net style, CC BY 3.0 — credited in the README)
const BOOT = `<svg class="qin-tt-svg" viewBox="0 0 24 24"><path d="M10.90 21.06C10.29 19.87 9.27 18.83 7.72 17.81C7.42 17.61 7.08 17.40 6.97 17.34L6.76 17.22L6.63 17.34C6.56 17.41 6.46 17.55 6.41 17.65C6.31 17.84 6.30 17.84 6.10 17.81C5.40 17.69 4.27 17.19 3.61 16.70C2.82 16.11 2.39 15.49 2.45 15.02C2.48 14.77 2.66 14.15 2.80 13.82L2.87 13.65L3.07 13.87C3.57 14.45 4.14 14.81 6.16 15.82C7.06 16.28 8.09 16.82 8.43 17.03C9.90 17.90 11.05 18.95 11.80 20.08L12.00 20.39L16.49 20.39C20.53 20.39 20.97 20.40 21.00 20.47C21.02 20.51 21.03 20.78 21.03 21.06L21.03 21.57L16.10 21.57L11.16 21.57L10.90 21.06ZM12.26 19.37C12.01 19.00 11.27 18.17 10.94 17.88C9.73 16.82 9.01 16.37 6.59 15.16C4.30 14.00 3.67 13.57 3.40 12.97L3.30 12.75L3.54 12.36C3.92 11.74 4.62 10.82 5.24 10.17C6.40 8.91 6.73 8.55 7.05 8.16C8.20 6.77 9.37 5.02 10.55 2.89C10.77 2.49 10.96 2.15 10.97 2.14C10.98 2.13 11.17 2.07 11.39 2.00C12.17 1.78 13.18 1.76 13.97 1.96C14.64 2.13 15.64 2.68 16.18 3.17L16.42 3.40L16.01 3.43C14.62 3.55 13.33 4.22 12.14 5.45C10.26 7.37 9.30 10.00 9.56 12.50C9.68 13.74 9.99 14.52 10.54 15.04C11.44 15.89 13.01 16.32 13.96 15.98C14.26 15.87 15.00 15.77 15.43 15.77C17.44 15.76 19.37 16.81 20.32 18.42C20.50 18.73 20.83 19.48 20.83 19.58C20.83 19.59 18.94 19.60 16.63 19.60L12.42 19.60L12.26 19.37ZM12.80 15.27C11.82 15.10 10.89 14.47 10.65 13.82C10.31 12.90 10.22 11.41 10.44 10.33C11.09 7.26 13.30 4.70 15.67 4.27C17.15 4.00 18.47 4.80 19.33 6.49C19.52 6.86 19.85 7.68 19.85 7.78C19.85 7.81 19.75 7.85 19.62 7.87C16.27 8.31 14.44 9.63 13.83 12.05C13.69 12.61 13.68 14.02 13.81 14.65C13.85 14.86 13.88 15.06 13.87 15.10C13.80 15.26 13.24 15.35 12.80 15.27Z" fill="#b9c3cc" stroke="#3a4048" stroke-width=".3" stroke-linejoin="round" fill-rule="evenodd"/></svg>`;
// Damage: crossed swords drawn like the Pierce sword
const SWORDS = `<svg class="qin-tt-svg" viewBox="0 0 24 24"><path d="M3 3 L3.92 5.76 L13.24 15.08 L15.08 13.24 L5.76 3.92 Z" fill="#e9eef2" stroke="#3a4048" stroke-width="1"/><path d="M11.9 16.42 L16.42 11.9" stroke="#c9a24a" stroke-width="1.8" stroke-linecap="round"/><path d="M14.16 14.16 L20.15 20.15" stroke="#7a2a20" stroke-width="2" stroke-linecap="round"/><circle cx="21" cy="21" r="1.2" fill="#c9a24a"/><path d="M21 3 L18.24 3.92 L8.92 13.24 L10.76 15.08 L20.08 5.76 Z" fill="#e9eef2" stroke="#3a4048" stroke-width="1"/><path d="M7.58 11.9 L12.1 16.42" stroke="#c9a24a" stroke-width="1.8" stroke-linecap="round"/><path d="M9.84 14.16 L3.85 20.15" stroke="#7a2a20" stroke-width="2" stroke-linecap="round"/><circle cx="3" cy="21" r="1.2" fill="#c9a24a"/></svg>`;
const TT_ICONS = { dmg: SWORDS, armor: CHESTPLATE, pen: PIERCE, move: BOOT };

const hex = (n) => "#" + Number(n).toString(16).padStart(6, "0");

export function unitTooltipHTML(token) {
  const sys = token.actor.system, officer = officerOf(sys);
  const unitName = token.document.name;
  const fac = factionOf(sys.faction);
  // the faction name is left out when it just repeats the officer's name (Sun Jian's army, led by Sun Jian)
  const facName = fac && !(officer && fac.name.toLowerCase() === officer.name.toLowerCase()) ? fac.name : "";
  const men = sys.men?.value ?? 0, max = sys.men?.max || 100, morale = sys.morale ?? 0;
  const pct = (v) => Math.max(0, Math.min(100, v));
  // header (dark red band): flag, gold line (officer's title, else the faction), name, then unit type and tier badge.
  // Without an officer the unit's own name is the big line and the tier badge sits beside it.
  const tierN = Math.max(1, Math.min(4, Number(sys.tier) || 1)); // badge colour: bronze, silver, gold, purple (4+)
  const badge = `<span class="qin-tt-tier t${tierN}">T${esc(sys.tier)}</span>`; // a tab hanging from the card's top edge, top right
  const gold = officer ? (officer.system?.details?.title || facName) : facName;
  let html = `<div class="qin-tt"><div class="qin-tt-hd">${fac?.img ? `<img src="${esc(fac.img)}" alt="">` : ""}<div>`;
  if (gold) html += `<div class="qin-tt-ti">${esc(gold)}</div>`;
  if (officer) html += `<div class="qin-tt-of">${esc(officer.name)}</div><div class="qin-tt-un">${esc(unitName)}</div>`;
  else html += `<div class="qin-tt-of">${esc(unitName)}</div>`;
  html += `</div>${badge}</div><div class="qin-tt-body">`;
  if (sys.hidden) html += `<div class="qin-tt-sub"><i class="fa-solid fa-eye-slash"></i><span>Hidden</span></div>`;
  html += `<div class="qin-tt-bl"><span>Health</span><span>${men} / ${max}</span></div>
    <div class="qin-tt-bar"><i style="width:${pct((100 * men) / max)}%;background:${hex(healthColor(men / max))}"></i></div>
    <div class="qin-tt-bl"><span>Morale</span><span>${morale}${sys.moraleState ? ` · ${esc(sys.moraleState)}` : ""}</span></div>
    <div class="qin-tt-bar"><i style="width:${pct(morale)}%;background:${hex(moraleColor(morale))}"></i></div>`;
  const chip = (icon, v, label) => `<div class="qin-tt-chip"><i>${TT_ICONS[icon]}</i><b>${v}</b><small>${label}</small></div>`;
  html += `<div class="qin-tt-chips">${chip("dmg", sys.damage ?? 0, "Dmg")}${chip("pen", sys.armorPen ?? 0, "Pierce")}${chip("armor", sys.armor ?? 0, "Armor")}${chip("move", sys.move ?? 0, "Move")}</div>`;
  const w = weaponLine(sys);
  if (w) html += `<div class="qin-tt-weapon">${w}<small>Unit type</small></div>`;
  return html + `</div></div>`;
}

/* ------------------------------------------------------------ hover movement preview */

let preview = null;
let pickingCheck = () => false;
export function setPickingCheck(fn) { pickingCheck = fn; }

export function clearMovePreview() {
  if (preview && !preview.destroyed) preview.destroy();
  preview = null;
  dimDanger(false);
}

// While a unit is hovered, the danger zone fades so that unit's own move/attack squares stand out
const DANGER_DIM = 0.4;
let hoverDim = false;
function dimDanger(on) {
  hoverDim = on;
  if (danger && !danger.destroyed) danger.alpha = on ? DANGER_DIM : 1;
}

/** The battle state for previews (outside a battle, the scene as it stands). */
function previewState(focusId) {
  let battle = getBattle();
  if (!battle.active || battle.sceneId !== canvas.scene?.id) battle = { ...emptyBattle(), sceneId: canvas.scene?.id };
  try { return buildState(battle, focusId ? { terrainFor: focusId } : {}).s; } catch (e) { console.warn("Qin | preview", e); return null; }
}

const MOVE_COLORS = { enemy: 0xdc3232, player: 0x2f80ed, ally: 0x3fbf5f, neutral: 0xf2d22e }, ATTACK = 0xff961e;

/**
 * Hovered unit: where it can move this turn (red for enemies, blue for player units, green for allies, yellow for neutrals) and, in orange,
 * how much further it can attack from there.
 */
export function showMovePreview(token) {
  clearMovePreview();
  if (!canvas?.ready || !unitVisible(token) || pickingCheck()) return;
  const s = previewState(token.id);
  const u = s && E.unitById(s, token.id);
  if (!u || u.status !== "active") return;
  const { move, attack } = E.threatArea(s, u);
  const size = canvas.scene.grid.size, side = token.actor.system.side;
  const mcol = MOVE_COLORS[side] ?? MOVE_COLORS.ally;
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  const sq = (k, col, a) => {
    const [x, y] = k.split(",").map(Number);
    g.lineStyle(2, col, 0.8).beginFill(col, a).drawRect(x * size + 3, y * size + 3, size - 6, size - 6).endFill();
  };
  for (const k of attack) sq(k, ATTACK, 0.2);
  for (const k of move) sq(k, mcol, 0.25);
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  preview = g;
  dimDanger(true);
}

/* ------------------------------------------------------------ threat range: one unit's reach, pinned from its click box */

const pinned = new Map(); // token id -> PIXI.Graphics
export const threatPinned = (tokenId) => pinned.has(tokenId);
/** May this user pin a unit's threat range? Players: enemy and neutral units only; the GM: any unit. */
export function canPinThreat(token, user = game.user) {
  const side = token?.actor?.system?.side;
  return !!token?.actor && token.actor.type === "unit" && (user.isGM || side === "enemy" || side === "neutral");
}
function unpinThreat(id) { const g = pinned.get(id); if (g && !g.destroyed) g.destroy(); pinned.delete(id); }
function drawPinnedThreat(id) {
  unpinThreat(id);
  const token = canvas?.tokens?.get(id);
  if (!token || !unitVisible(token)) return;
  const s = previewState(id), u = s && E.unitById(s, id);
  if (!u || u.status !== "active") return;
  const { move, attack } = E.threatArea(s, u);
  const size = canvas.scene.grid.size, mcol = MOVE_COLORS[token.actor.system.side] ?? MOVE_COLORS.enemy;
  const g = new PIXI.Graphics(); g.eventMode = "none";
  const sq = (k, col, a) => { const [x, y] = k.split(",").map(Number); g.lineStyle(2, col, 0.7).beginFill(col, a).drawRect(x * size + 4, y * size + 4, size - 8, size - 8).endFill(); };
  for (const k of attack) sq(k, ATTACK, 0.16);
  for (const k of move) sq(k, mcol, 0.2);
  const layer = canvas.interface ?? canvas.controls ?? canvas.stage;
  layer.addChildAt?.(g, 0) ?? layer.addChild(g);
  pinned.set(id, g);
}
/** Toggle a unit's pinned threat range (its move squares and, in orange, where it could attack from them). */
export function toggleThreatRange(token) {
  if (pinned.has(token.id)) { unpinThreat(token.id); return false; }
  drawPinnedThreat(token.id);
  return pinned.has(token.id);
}
function redrawPinned() { for (const id of [...pinned.keys()]) drawPinnedThreat(id); }
function clearPinned() { for (const id of [...pinned.keys()]) unpinThreat(id); }

/* ------------------------------------------------------------ danger zone (Z): every tile the enemy threatens */

let dangerOn = false, danger = null;

function clearDanger() {
  if (danger && !danger.destroyed) danger.destroy();
  danger = null;
}

/** Redraw the danger zone if it's on: the combined move + attack reach of every enemy unit the viewer can see. */
export function drawDangerZone() {
  clearDanger();
  if (!dangerOn || !canvas?.ready) return;
  const s = previewState(null);
  if (!s) return;
  const zone = new Set();
  for (const u of s.units) {
    if (u.status !== "active" || u.side !== "enemy") continue;
    const tok = canvas.tokens.get(u.id);
    if (!tok || !unitVisible(tok) || (u.hidden && !game.user.isGM)) continue; // hidden enemies stay secret
    const { move, attack } = E.threatArea(s, u);
    for (const k of move) zone.add(k);
    for (const k of attack) zone.add(k);
    zone.add(u.x + "," + u.y);
  }
  const size = canvas.scene.grid.size;
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  g.beginFill(MOVE_COLORS.enemy, 0.28);
  for (const k of zone) { const [x, y] = k.split(",").map(Number); g.drawRect(x * size, y * size, size, size); }
  g.endFill();
  // a bright edge around the zone
  g.lineStyle(3, 0xff463c, 0.95);
  for (const k of zone) {
    const [x, y] = k.split(",").map(Number), X = x * size, Y = y * size;
    if (!zone.has(`${x + 1},${y}`)) g.moveTo(X + size, Y).lineTo(X + size, Y + size);
    if (!zone.has(`${x - 1},${y}`)) g.moveTo(X, Y).lineTo(X, Y + size);
    if (!zone.has(`${x},${y + 1}`)) g.moveTo(X, Y + size).lineTo(X + size, Y + size);
    if (!zone.has(`${x},${y - 1}`)) g.moveTo(X, Y).lineTo(X + size, Y);
  }
  const layer = canvas.interface ?? canvas.controls ?? canvas.stage;
  layer.addChildAt?.(g, 0) ?? layer.addChild(g);
  g.alpha = hoverDim ? DANGER_DIM : 1;
  danger = g;
}

export function toggleDangerZone() {
  dangerOn = !dangerOn;
  drawDangerZone();
}

/** Z toggles the danger zone; rebindable in Configure Controls. Call during init. */
export function registerDangerZoneKey(systemId) {
  game.keybindings.register(systemId, "dangerZone", {
    name: "Toggle danger zone",
    hint: "Show every tile any visible enemy unit could move to or attack this turn.",
    editable: [{ key: "KeyZ" }],
    onDown: () => { if (!canvas?.ready) return false; toggleDangerZone(); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
}

/* ------------------------------------------------------------ officer sheet, view only */

/** Open an officer's character sheet read-only, even for players without permission to see it. */
export async function openOfficerView(uuidOrActor) {
  const officer = typeof uuidOrActor === "string" ? await fromUuid(uuidOrActor) : uuidOrActor;
  if (!officer) return ui.notifications.warn("That officer can't be found.");
  if (officer.testUserPermission(game.user, "OBSERVER")) return officer.sheet.render(true);
  const Cls = officer.sheet?.constructor;
  if (!Cls) return;
  const sheet = new Cls({
    document: officer, id: `qin-officer-view-${officer.id}`, viewPermission: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    window: { title: `${officer.name} (view only)` },
  });
  return sheet.render({ force: true });
}

/* ------------------------------------------------------------ the Info window */

function traitsHTML(raw) {
  const d = document.createElement("div");
  d.innerHTML = String(raw ?? "").replace(/<\/(p|div|li)>|<br\s*\/?>/gi, "\n");
  const lines = d.textContent.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return `<p class="qin-muted">No traits.</p>`;
  return `<ul class="qin-ui-traits">${lines.map(l => {
    const m = l.match(/^(.+?)\s+[-–]\s+(.+)$/);
    return m ? `<li><b>${esc(m[1])}</b> <span>${esc(m[2])}</span></li>` : `<li><b>${esc(l)}</b></li>`;
  }).join("")}</ul>`;
}

const Base = foundry.applications.api.ApplicationV2;

export class UnitInfoApp extends Base {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-unit-info"],
    window: { resizable: true, icon: "fa-solid fa-chess-rook" },
    position: { width: 560, height: "auto" },
  };

  constructor(token, options = {}) {
    super({ id: `qin-unit-info-${token.id}`, ...options });
    this.token = token;
  }

  get title() { return this.token?.document?.name ?? "Unit"; }

  async _renderHTML() {
    const tok = this.token, actor = tok.actor, sys = actor.system;
    const officer = officerOf(sys);
    const faction = factionOf(sys.faction);
    const forms = actor.items.filter(i => i.type === "formation").sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const stat = (k, v, sub = "") => `<div class="qin-ui-stat"><span>${k}</span><b>${v}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
    const menPct = Math.max(0, Math.min(100, Math.round(100 * sys.men.value / (sys.men.max || 100))));
    const w = weaponLine(sys);
    const sideLabel = { player: "Player", enemy: "Enemy", ally: "Ally", neutral: "Neutral" }[sys.side] ?? sys.side;
    const skill = SKILLS[sys.weaponSkill]?.label ?? sys.weaponSkill;
    return `<div class="qin-ui">
      <header class="qin-ui-head">
        <img class="qin-ui-portrait" src="${esc(actor.img)}" alt="">
        <div class="qin-ui-id">
          <h2>${esc(tok.document.name)}</h2>
          <div class="qin-ui-sub">Tier ${sys.tier} · Level ${sys.level ?? 1}${sys.unitType ? ` · ${esc(sys.unitType)}` : ""}${sys.category ? ` · ${esc(sys.category[0].toUpperCase() + sys.category.slice(1))}` : ""}</div>
          <div class="qin-ui-sub"><span class="qin-ui-side ${esc(sys.side)}">${esc(sideLabel)}</span>${faction ? ` ${faction.img ? `<img class="qin-ui-flag" src="${esc(faction.img)}" alt="">` : ""}${esc(faction.name)}` : ""}</div>
          <div class="qin-ui-bars">
            <div><span>Health</span><div class="qin-bar"><i style="width:${menPct}%"></i></div><b>${sys.men.value} / ${sys.men.max}</b></div>
            <div><span>Morale</span><div class="qin-bar morale"><i style="width:${Math.max(0, Math.min(100, sys.morale))}%"></i></div><b>${sys.morale} <small>${esc(sys.moraleState ?? "")}</small></b></div>
          </div>
        </div>
      </header>
      <section class="qin-ui-stats">
        ${stat("Damage", sys.damage ?? 0)}${stat("Pierce", sys.armorPen ?? 0)}${stat("Armor", sys.armor ?? 0, sys.armorNote)}
        ${stat("Movement", sys.move ?? 0)}${stat("Range", rangeText(sys) || "Melee")}${stat("Unit Value", sys.unitValue ?? 0)}
      </section>
      <section><h3>Officer</h3>${officer ? `
        <a class="qin-ui-officer" data-officer="${esc(officer.uuid)}" title="View ${esc(officer.name)}'s sheet">
          <img src="${esc(officer.img)}" alt="">
          <div>${officer.system?.details?.title ? `<div class="gold">${esc(officer.system.details.title)}</div>` : ""}<b>${esc(officer.name)}</b>
          <div class="qin-muted">Fights with ${esc(skill)} · click to view sheet</div></div>
        </a>` : `<p class="qin-muted">No officer. The unit rolls with Command, Fire and Skill at 0.</p>`}
      </section>
      ${!formationsEnabled() ? "" : `<section><h3>Formations</h3>${forms.length ? `<ul class="qin-ui-forms">${forms.map(f => {
        const sum = formationSummary(f.system);
        const active = sys.formation === f.id;
        return `<li class="${active ? "active" : ""}"><div><b>${esc(f.name)}</b>${active ? ` <span class="qin-tag">in use</span>` : ""}</div>${sum ? `<div class="qin-ui-fx">${esc(sum)}</div>` : ""}</li>`;
      }).join("")}</ul>` : `<p class="qin-muted">No formations known.</p>`}</section>`}
      <section><h3>Traits</h3>${traitsHTML(sys.traits)}</section>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("[data-officer]")?.addEventListener("click", (ev) => { ev.preventDefault(); openOfficerView(ev.currentTarget.dataset.officer); });
  }
}

export function openUnitInfo(token) {
  if (!unitVisible(token)) return;
  const id = `qin-unit-info-${token.id}`;
  const open = foundry.applications.instances?.get(id);
  if (open) { open.token = token; return open.render({ force: true }); }
  return new UnitInfoApp(token).render({ force: true });
}

/** The Info window for a unit actor that isn't on the map (e.g. a compendium unit in the Recruit window). */
export async function openUnitInfoForActor(uuidOrActor) {
  const actor = typeof uuidOrActor === "string" ? await fromUuid(uuidOrActor) : uuidOrActor;
  if (!actor || actor.type !== "unit") return ui.notifications.warn("That unit couldn't be opened.");
  const id = `a-${actor.id}`;
  const open = foundry.applications.instances?.get(`qin-unit-info-${id}`);
  if (open) return open.render({ force: true });
  return new UnitInfoApp({ id, actor, document: { name: actor.name } }).render({ force: true });
}

/** Keep open Info windows current when the unit changes. */
export function registerUnitInfo() {
  const refresh = (actor) => {
    for (const app of foundry.applications.instances?.values() ?? []) {
      if (app instanceof UnitInfoApp && (app.token?.actor === actor || app.token?.actor?.id === actor?.id)) app.render();
    }
  };
  Hooks.on("updateActor", refresh);
  Hooks.on("createItem", (i) => refresh(i.parent));
  Hooks.on("updateItem", (i) => refresh(i.parent));
  Hooks.on("deleteItem", (i) => refresh(i.parent));
  Hooks.on("hoverToken", (token, hovered) => { if (hovered) showMovePreview(token); else clearMovePreview(); });
  for (const h of ["updateToken", "deleteToken", "canvasTearDown"]) Hooks.on(h, () => clearMovePreview());
  // keep the danger zone current as units move, change or the battle advances
  let pending = null;
  const redraw = () => { clearTimeout(pending); pending = setTimeout(() => { if (dangerOn) drawDangerZone(); redrawPinned(); }, 60); };
  for (const h of ["updateToken", "createToken", "deleteToken", "updateActor", "updateSetting", "canvasReady"]) Hooks.on(h, redraw);
  Hooks.on("deleteToken", (doc) => unpinThreat(doc.id));
  Hooks.on("canvasTearDown", () => { clearDanger(); clearPinned(); });
}
