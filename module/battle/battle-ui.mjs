// Fire Emblem-style battle controls on the canvas: an action menu beside the active unit,
// blue/red movement squares, attack target highlights, and a "which unit is this" highlight.
import * as E from "./engine.mjs";
import { getBattle, buildState, isWritingBack } from "./adapter.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { openUnitInfo, unitVisible, setPickingCheck } from "../unit-info.mjs";

setPickingCheck(() => !!mode);

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
  g.eventMode = "none";
  layer().addChild(g);
  let t = 0;
  g.qinTick = () => {
    // the hovered button can disappear without a mouseleave (the panel re-renders): drop the ring then
    if (tok.destroyed || !document.querySelector(`[data-unit-id="${tokenId}"]:hover`)) return highlightUnit(null, false);
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
  overlay.eventMode = labels.eventMode = "none";
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
  overlay.eventMode = "none";
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

let menuSide = "right";
function placeMenu() {
  if (!menuEl || !current?.token) return;
  // Use the unit's square from the battle record: the token may still be gliding there
  const t = current.token, size = gridSize(), u = current.u;
  const tx = u ? u.x * size : t.x, ty = u ? u.y * size : t.y, tw = t.w || size;
  const w = menuEl.offsetWidth || 180;
  const right = toClient({ x: tx + tw, y: ty }), left = toClient({ x: tx, y: ty });
  let side = menuSide;
  if (side === "right" && right.x + 8 + w > window.innerWidth) side = "left";
  if (side === "left" && left.x - 8 - w < 0) side = "right";
  menuEl.style.left = `${Math.round(side === "right" ? right.x + 8 : left.x - 8 - w)}px`;
  menuEl.style.top = `${Math.round(right.y)}px`;
}

function renderMenu(sub = null) {
  if (!current) return hideMenu();
  const { u, flags, officer } = current;
  if (!menuEl) {
    menuEl = document.createElement("div");
    menuEl.className = "qin qin-fe-menu";
    document.body.append(menuEl);
    menuEl.addEventListener("click", onMenuClick);
    // While picking a square, the menu jumps to the other side of the unit if the cursor goes over it
    menuEl.addEventListener("mouseenter", () => {
      if (!mode) return;
      menuSide = menuSide === "right" ? "left" : "right";
      placeMenu();
    });
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
    if (flags.undo) html += b("undo", "↶ Undo move", true, "Go back to where the unit started (only for a normal move, before doing anything else)");
    html += b("move", "Move", flags.move, flags.move ? "" : "Already moved or can't move");
    html += b("attack", "Attack", flags.attack, flags.attack ? "" : "No enemy in range");
    html += b("hold", "Hold", flags.hold, "No more action this turn; +2 melee defense this round");
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
    case "undo": return send({ type: "undoMove", unitId: id });
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
/** Tear down everything the battle put on the map (menu, squares, click capture, rings, pick menu). */
export function resetBattleUI() {
  current = null; mode = null; busy = false;
  clearSquares(); hideMenu(); hidePick(); highlightUnit(null, false);
}

export function refreshBattleUI() {
  if (!canvas?.ready) return;
  const battle = getBattle();
  if (!battle.active) return resetBattleUI();
  const ac = battle.active ? battle.turn?.activation : null;
  if (ac) hidePick();
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

export function repositionBattleUI() { placeMenu(); hidePick(); }

/* ------------------------------------------------------------ click a unit on the map to take its turn */

let pickEl = null;
function hidePick() { pickEl?.remove(); pickEl = null; }

/** Turn-start choices that apply to this unit right now (empty outside a battle round). */
function turnButtons(token) {
  const battle = getBattle();
  if (!battle.active || canvas.scene?.id !== battle.sceneId || battle.turn?.activation) return [];
  const { s } = buildState(battle);
  const u = E.unitById(s, token.id);
  if (!u || u.status !== "active" || u.round.activated) return [];
  const p = E.prompt(s);
  const me = game.user.isGM ? "host" : game.user.id;
  const mineToMove = u.owner === game.user.id || (game.user.isGM && !u.owner);
  const buttons = [];
  if (!u.officerId) {
    if (p.kind === "pick" && p.player === me && u.side === "player" && mineToMove) buttons.push(["Take turn", [{ type: "begin", unitId: u.id }]]);
    else if (p.kind === "claim" && u.side === "player" && mineToMove) buttons.push(["Take turn", [{ type: "claim" }, { type: "begin", unitId: u.id }]]);
    else if (p.kind === "host-pick" && game.user.isGM && u.side === p.side) buttons.push(["Take turn", [{ type: "begin", unitId: u.id }]]);
  } else if ((p.kind === "decide" || p.kind === "final") && p.unitId === u.id && iControl(u)) {
    buttons.push(["Act", [{ type: "decide", unitId: u.id, choice: "act" }]]);
    buttons.push([p.kind === "decide" ? "Hold" : "Give up turn", [{ type: "decide", unitId: u.id, choice: p.kind === "decide" ? "hold" : "forfeit" }]]);
  }
  return buttons;
}

/**
 * The little box beside a clicked unit: its turn-start choices during a battle round (if any apply
 * to this user) and an "Info" button that opens the unit's details for anyone.
 */
export function showUnitBox(token) {
  hidePick();
  if (!canvas?.ready || !unitVisible(token)) return;
  const buttons = token.actor.isOwner || game.user.isGM ? turnButtons(token) : [];
  pickEl = document.createElement("div");
  pickEl.className = "qin qin-fe-menu qin-fe-pick";
  pickEl.dataset.tokenId = token.id;
  pickEl.innerHTML = `<div class="qin-fe-title">${esc(token.document.name)}</div>`
    + buttons.map(([label], i) => `<button type="button" data-i="${i}">${label}</button>`).join("")
    + `<button type="button" data-info="1"><i class="fa-solid fa-circle-info"></i> Info</button>`;
  document.body.append(pickEl);
  const pos = toClient({ x: token.x + token.w, y: token.y });
  pickEl.style.left = `${Math.round(pos.x + 8)}px`;
  pickEl.style.top = `${Math.round(pos.y)}px`;
  pickEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    hidePick();
    if (btn.dataset.info) return openUnitInfo(token);
    if (!requestFn) return;
    for (const action of buttons[Number(btn.dataset.i)][1]) {
      const res = await requestFn(action);
      if (res && !res.ok) break;
    }
  });
}

/** Selecting your own unit token (or picking it from the battle panel) opens its box. */
export function onUnitSelected(token, controlled) {
  if (!controlled) { if (pickEl?.dataset.tokenId === token.id) hidePick(); return; }
  if (token.actor?.type === "unit") showUnitBox(token);
}

/**
 * Clicks on the map: players can't select units they don't own, so watch plain left-clicks on the
 * board ourselves. A click on a unit opens its box; a click on empty ground closes it.
 */
export function registerUnitClicks() {
  let down = null;
  Hooks.on("canvasReady", () => {
    const view = canvas.app?.view;
    if (!view || view.qinUnitClicks) return;
    view.qinUnitClicks = true;
    view.addEventListener("pointerdown", (ev) => { down = ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null; });
    view.addEventListener("pointerup", (ev) => {
      const d = down; down = null;
      if (!d || mode || ev.button !== 0 || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) return;
      const p = toWorld(ev.clientX, ev.clientY);
      const hit = (canvas.tokens?.placeables ?? []).filter(t => unitVisible(t) && t.visible !== false
        && p.x >= t.x && p.x < t.x + t.w && p.y >= t.y && p.y < t.y + t.h).sort((a, b) => (b.document.sort ?? 0) - (a.document.sort ?? 0))[0];
      if (hit) setTimeout(() => showUnitBox(hit), 0); // after Foundry's own control/release handling
      else hidePick();
    });
  });
}

/** Unit tokens can't be dragged during a battle round: units move with the Move action. */
export function lockUnitTokens(tokenDoc, change, options) {
  if (options?.qinBattle || isWritingBack() || !("x" in change || "y" in change)) return;
  if (tokenDoc.actor?.type !== "unit") return;
  const battle = game.settings.get(SYSTEM_ID, "battle");
  if (!battle?.active || tokenDoc.parent?.id !== battle.sceneId || battle.turn?.phase === "setup") return;
  ui.notifications.warn("Units move with the Move action during a battle (the GM can go back to setup to reposition).");
  return false;
}
