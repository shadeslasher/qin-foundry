// Fire Emblem-style battle controls on the canvas: an action menu beside the active unit,
// blue/red movement squares, attack target highlights, and a "which unit is this" highlight.
import * as E from "./engine.mjs";
import { getBattle, buildState } from "./adapter.mjs";
import { SYSTEM_ID } from "../config.mjs";

let requestFn = null;            // battleRequest, injected by battle.mjs (avoids a circular import)
let menuEl = null;
let mode = null;                 // null | "move" | "attack"
let overlay = null;              // PIXI.Graphics for squares
let labels = null;               // PIXI.Container for red-square costs
let highlight = null;            // PIXI.Graphics for the hover ring
let busy = false;
let current = null;              // { s, u, token, flags, opts, targets, allies }
let listeners = null;

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

export function setBattleRequest(fn) { requestFn = fn; }

function layer() { return canvas.interface ?? canvas.controls ?? canvas.stage; }
function gridSize() { return canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100; }
function toClient(pt) {
  if (canvas.clientCoordinatesFromCanvas) return canvas.clientCoordinatesFromCanvas(pt);
  const r = canvas.app.view.getBoundingClientRect();
  const p = canvas.stage.worldTransform.apply(pt);
  return { x: p.x + r.left, y: p.y + r.top };
}
function toWorld(clientX, clientY) {
  if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
  const r = canvas.app.view.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({ x: clientX - r.left, y: clientY - r.top });
}

/** Does this user steer the unit? Its owner, or the GM for unowned units (or when the owner is away). */
function iControl(u) {
  if (u.owner === game.user.id) return true;
  if (!game.user.isGM) return false;
  return !u.owner || !game.users.get(u.owner)?.active;
}

/* ------------------------------------------------------------ hover highlight (Take turn buttons) */

export function highlightUnit(tokenId, on) {
  if (highlight && !highlight.destroyed) { canvas.app?.ticker?.remove(highlight.qinTick); highlight.destroy(); }
  highlight = null;
  if (!on || !canvas?.ready) return;
  const tok = canvas.tokens?.get(tokenId);
  if (!tok) return;
  const g = new PIXI.Graphics();
  layer().addChild(g);
  let t = 0;
  g.qinTick = () => {
    t += canvas.app.ticker.deltaMS / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    const c = tok.center, r = Math.max(tok.w, tok.h) * (0.62 + 0.06 * pulse);
    g.clear();
    g.lineStyle(6, 0xffd34d, 0.55 + 0.45 * pulse).drawCircle(c.x, c.y, r);
    g.lineStyle(2, 0xffffff, 0.9).drawCircle(c.x, c.y, r + 5);
    // arrow above the token
    const top = tok.y - 14 - 10 * pulse;
    g.lineStyle(2, 0x000000, 0.8).beginFill(0xffd34d, 1)
      .drawPolygon([c.x - 14, top - 18, c.x + 14, top - 18, c.x, top]).endFill();
  };
  canvas.app.ticker.add(g.qinTick);
  highlight = g;
}

/* ------------------------------------------------------------ squares */

function clearSquares() {
  if (overlay && !overlay.destroyed) overlay.destroy();
  if (labels && !labels.destroyed) labels.destroy({ children: true });
  overlay = labels = null;
  if (listeners) {
    document.removeEventListener("pointerdown", listeners.down, true);
    document.removeEventListener("keydown", listeners.key, true);
    canvas.app?.view?.removeEventListener("contextmenu", listeners.block, true);
    listeners = null;
  }
}

function drawSquare(g, x, y, color, alpha, line = 0.9) {
  const size = gridSize();
  g.lineStyle(2, color, line).beginFill(color, alpha).drawRect(x * size + 2, y * size + 2, size - 4, size - 4).endFill();
}

function startPicking(onTile) {
  const view = canvas.app.view;
  const down = (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) return cancelMode();
    if (ev.button !== 0) return;
    const p = toWorld(ev.clientX, ev.clientY), size = gridSize();
    onTile(Math.floor(p.x / size), Math.floor(p.y / size));
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); cancelMode(); } };
  const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  listeners = { down, key, block };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
}

function cancelMode() {
  mode = null;
  clearSquares();
  renderMenu();
}

function enterMove() {
  const { s, u } = current;
  const { blue, red } = E.moveOptions(s, u);
  // adjacent allies that haven't moved can be swapped with
  const allies = s.units.filter(o => o.status === "active" && o.id !== u.id && E.unitById(s, o.id) && o.side !== "enemy" === (u.side !== "enemy")
    && Math.abs(o.x - u.x) + Math.abs(o.y - u.y) === 1 && !o.round.moved && !u.round.moved);
  mode = "move";
  clearSquares();
  overlay = new PIXI.Graphics();
  labels = new PIXI.Container();
  layer().addChild(overlay, labels);
  const Txt = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  const size = gridSize();
  const style = new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: Math.round(size * 0.22), fontWeight: "bold", fill: "#ffffff", stroke: "#000000", strokeThickness: 3 });
  for (const k of blue.keys()) { const [x, y] = k.split(",").map(Number); drawSquare(overlay, x, y, 0x2f80ed, 0.35); }
  for (const [k, v] of red) {
    const [x, y] = k.split(",").map(Number);
    drawSquare(overlay, x, y, 0xd63c3c, 0.3);
    const t = new Txt(`-${v.cost}`, style); t.anchor?.set?.(0.5); t.position.set(x * size + size / 2, y * size + size / 2); labels.addChild(t);
  }
  for (const a of allies) drawSquare(overlay, a.x, a.y, 0x3fbf5f, 0.25);
  renderMenu();
  startPicking((x, y) => {
    const k = x + "," + y;
    const ally = allies.find(a => a.x === x && a.y === y);
    if (ally) return send({ type: "swap", unitId: u.id, targetId: ally.id });
    if (blue.has(k)) return send({ type: "moveTo", unitId: u.id, x, y });
    if (red.has(k)) return send({ type: "moveTo", unitId: u.id, x, y });
    ui.notifications.warn("Pick a blue square (move), a red square (forced march) or a green ally (swap).");
  });
}

function enterAttack() {
  const { s, u } = current;
  const targets = E.attackTargets(s, u);
  mode = "attack";
  clearSquares();
  overlay = new PIXI.Graphics();
  layer().addChild(overlay);
  for (const d of targets) drawSquare(overlay, d.x, d.y, 0xd63c3c, 0.35, 1);
  renderMenu();
  startPicking((x, y) => {
    const d = targets.find(t => t.x === x && t.y === y);
    if (!d) return ui.notifications.warn("Click one of the enemy units marked in red.");
    send({ type: "attack", unitId: u.id, targetId: d.id });
  });
}

async function send(action) {
  if (!requestFn || busy) return;
  busy = true;
  mode = null;
  clearSquares();
  renderMenu();
  try { await requestFn(action); } finally { busy = false; refreshBattleUI(); }
}

/* ------------------------------------------------------------ the menu */

function hideMenu() {
  menuEl?.remove();
  menuEl = null;
}

function placeMenu() {
  if (!menuEl || !current?.token) return;
  const t = current.token;
  const p = toClient({ x: t.x + t.w, y: t.y });
  menuEl.style.left = `${Math.round(p.x + 8)}px`;
  menuEl.style.top = `${Math.round(p.y)}px`;
}

function renderMenu(sub = null) {
  if (!current) return hideMenu();
  const { u, flags, officer } = current;
  if (!menuEl) {
    menuEl = document.createElement("div");
    menuEl.className = "qin qin-fe-menu";
    document.body.append(menuEl);
    menuEl.addEventListener("click", onMenuClick);
  }
  const b = (act, label, enabled, tip = "", extra = "") =>
    `<button type="button" data-fe="${act}" ${enabled && !busy ? "" : "disabled"} ${tip ? `data-tooltip="${esc(tip)}"` : ""} ${extra}>${label}</button>`;
  let html = `<div class="qin-fe-title">${esc(u.name)}</div>`;
  if (mode === "move") html += `<div class="qin-fe-hint">Blue: move · Red: forced march (ends turn) · Green: swap<br>Right-click or Esc to go back</div>` + b("cancel", "Back", true);
  else if (mode === "attack") html += `<div class="qin-fe-hint">Click an enemy marked in red.<br>Right-click or Esc to go back</div>` + b("cancel", "Back", true);
  else if (sub === "heroic") {
    html += `<div class="qin-fe-hint">Heroic action (free, doesn't end the turn) · ${officer.fire - (u.heroicUsed || 0)}/${officer.fire} left</div>`;
    (officer.heroicActions || []).forEach((h, i) => {
      html += b("heroicPick", esc(h.name), u.lastHeroic !== h.name, h.text, `data-index="${i}"`);
    });
    html += b("back", "Back", true);
  } else if (sub === "ability") {
    if (officer?.skill) html += b("skill", `${esc(officer.skill.name)}${officer.skill.moraleCost ? ` (${officer.skill.moraleCost} morale)` : ""}`, flags.skill, officer.skill.text || "");
    if (officer?.battleArt) html += b("art", `Battle art: ${esc(officer.battleArt.name)}`, flags.art, officer.battleArt.text || "");
    html += b("back", "Back", true);
  } else {
    const abilityTip = !officer ? "No officer" : officer.skill ? `${officer.skill.name}: ${officer.skill.text || ""}` : "This officer has no battle ability";
    html += b("move", "Move", flags.move, flags.move ? "" : "Already moved or can't move");
    html += b("attack", "Attack", flags.attack, flags.attack ? "" : "No enemy in range");
    html += b("hold", "Hold", flags.hold, "No more action this turn; enemy attacks against it −1 until next turn");
    html += b("ability", "Ability", flags.ability, abilityTip);
    html += b("heroic", "Heroic action", flags.heroic, officer ? "Free action from the heroic action list" : "Needs an officer");
    html += b("end", "End turn", flags.endTurn);
  }
  menuEl.innerHTML = html;
  placeMenu();
}

function onMenuClick(ev) {
  const btn = ev.target.closest("button[data-fe]");
  if (!btn || btn.disabled || !current) return;
  const id = current.u.id;
  switch (btn.dataset.fe) {
    case "move": return enterMove();
    case "attack": return enterAttack();
    case "cancel": return cancelMode();
    case "back": return renderMenu();
    case "hold": return send({ type: "holdPosition", unitId: id });
    case "end": return send({ type: "endTurn", unitId: id });
    case "heroic": return renderMenu("heroic");
    case "heroicPick": return send({ type: "heroic", unitId: id, index: Number(btn.dataset.index) });
    case "ability": {
      const { officer, flags } = current;
      if (flags.skill && !(officer.battleArt && flags.art)) return send({ type: "useSkill", unitId: id });
      if (flags.art && !(officer.skill && flags.skill)) return send({ type: "battleArt", unitId: id });
      return renderMenu("ability");
    }
    case "skill": return send({ type: "useSkill", unitId: id });
    case "art": return send({ type: "battleArt", unitId: id });
  }
}

/** Rebuild the menu from the current battle state (call whenever the battle changes). */
export function refreshBattleUI() {
  if (!canvas?.ready) return;
  const battle = getBattle();
  const ac = battle.active ? battle.turn?.activation : null;
  if (!ac || canvas.scene?.id !== battle.sceneId) { current = null; mode = null; clearSquares(); return hideMenu(); }
  const { s } = buildState(battle, { terrainFor: ac.unitId });
  const u = E.unitById(s, ac.unitId);
  const token = canvas.tokens.get(ac.unitId);
  if (!u || !token || !iControl(u)) { current = null; mode = null; clearSquares(); return hideMenu(); }
  const changed = current?.u?.id !== u.id || current?.key !== JSON.stringify([u.x, u.y, ac.step, u.round, u.morale]);
  current = { s, u, token, flags: E.actionMenu(s, u), officer: E.officerOf(s, u), key: JSON.stringify([u.x, u.y, ac.step, u.round, u.morale]) };
  if (changed) { mode = null; clearSquares(); }
  if (!mode) renderMenu();
}

export function repositionBattleUI() { placeMenu(); }

/** Unit tokens can't be dragged during a battle round: units move with the Move action. */
export function lockUnitTokens(tokenDoc, change, options) {
  if (options?.qinBattle || !("x" in change || "y" in change)) return;
  if (tokenDoc.actor?.type !== "unit") return;
  const battle = game.settings.get(SYSTEM_ID, "battle");
  if (!battle?.active || tokenDoc.parent?.id !== battle.sceneId || battle.turn?.phase === "setup") return;
  ui.notifications.warn("Units move with the Move action during a battle (the GM can go back to setup to reposition).");
  return false;
}
