// Fire Emblem-style battle controls on the canvas: an action menu beside the active unit,
// blue/red movement squares, attack target highlights, and a "which unit is this" highlight.
import * as E from "./engine.mjs";
import { getBattle, buildState, isWritingBack } from "./adapter.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { playMoment } from "../sound.mjs";
import { openUnitInfo, unitVisible, setPickingCheck, canPinThreat, threatPinned, toggleThreatRange } from "../unit-info.mjs";
import { deployMoveCheck, zoneSet, DEPLOY_FLAG } from "./deploy-rules.mjs";

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
    canvas.app?.view?.removeEventListener("pointermove", listeners.move);
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
  let over = null; // the square under the cursor: a tick each time it moves to another one
  const move = (ev) => {
    const p = toWorld(ev.clientX, ev.clientY), size = gridSize(), k = `${Math.floor(p.x / size)},${Math.floor(p.y / size)}`;
    if (over !== null && k !== over) playMoment("Cursor move", { minGap: 40 });
    over = k;
  };
  view.addEventListener("pointermove", move);
  listeners = { down, key, block, move };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
}

function cancelMode() {
  playMoment("Cancel / back");
  if (mode === "reposition" && current) return send({ type: "reposition", unitId: current.u.id });
  if (mode === "second" && current) return send({ type: "secondAttack", unitId: current.u.id });
  mode = null;
  clearSquares();
  renderMenu();
}

function enterMove() {
  const { s, u } = current;
  const { blue, red, climb } = E.moveOptions(s, u);
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
  for (const k of blue.keys()) { const [x, y] = k.split(",").map(Number); drawSquare(overlay, x, y, climb?.has(k) ? 0x9b59d0 : 0x2f80ed, 0.35); }
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
    playMoment("Error / not allowed");
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
    if (!d) return pickWarn("Click one of the enemy units marked in red.");
    send({ type: "attack", unitId: u.id, targetId: d.id });
  });
}

/** Duel: enemy officer units next to this one, marked in gold; click one to challenge its officer. */
function enterDuel() {
  const { s, u } = current;
  const targets = E.duelTargets(s, u);
  mode = "duel";
  clearSquares();
  overlay = new PIXI.Graphics();
  overlay.eventMode = "none";
  layer().addChild(overlay);
  for (const d of targets) drawSquare(overlay, d.x, d.y, 0xe0b040, 0.4, 1);
  renderMenu();
  startPicking((x, y) => {
    const d = targets.find(t => t.x === x && t.y === y);
    if (!d) return pickWarn("Click one of the enemy officer units marked in gold.");
    send({ type: "duel", unitId: u.id, targetId: d.id });
  });
}

/** Wedge follow-up: green tiles next to the beaten enemy; click one to move there, or stay. */
function enterReposition() {
  const ac = current?.s?.turn?.activation;
  const tiles = ac?.reposition?.tiles ?? [];
  mode = "reposition";
  clearSquares();
  overlay = new PIXI.Graphics();
  overlay.eventMode = "none";
  layer().addChild(overlay);
  for (const [x, y] of tiles) drawSquare(overlay, x, y, 0x3fbf5f, 0.3, 1);
  renderMenu();
  startPicking((x, y) => {
    if (!tiles.some(([tx, ty]) => tx === x && ty === y)) return playMoment("Error / not allowed"), ui.notifications.warn(ac?.reposition?.skirmish ? "Click a green tile, or press Stay here." : "Click a green tile next to the enemy, or press Stay here.");
    send({ type: "reposition", unitId: current.u.id, x, y });
  });
}

/** Dual Weapons follow-up: red enemies next to the unit; click one for the second attack (Attack -2), or skip. */
function enterSecond() {
  const { s } = current;
  const ids = s.turn?.activation?.second?.targets ?? [];
  const targets = ids.map(id => E.unitById(s, id)).filter(Boolean);
  mode = "second";
  clearSquares();
  overlay = new PIXI.Graphics();
  overlay.eventMode = "none";
  layer().addChild(overlay);
  for (const d of targets) drawSquare(overlay, d.x, d.y, 0xd63c3c, 0.35, 1);
  renderMenu();
  startPicking((x, y) => {
    const d = targets.find(o => o.x === x && o.y === y);
    if (!d) return pickWarn("Click an enemy marked in red, or press Skip.");
    send({ type: "secondAttack", unitId: current.u.id, targetId: d.id });
  });
}

/** Place Ladder: gold wall squares next to the unit; click one. */
function enterLadder() {
  const { s, u } = current;
  const tiles = E.ladderTiles(s, u);
  mode = "ladder";
  clearSquares();
  overlay = new PIXI.Graphics();
  overlay.eventMode = "none";
  layer().addChild(overlay);
  for (const [x, y] of tiles) drawSquare(overlay, x, y, 0xd9a441, 0.35, 1);
  renderMenu();
  startPicking((x, y) => {
    if (!tiles.some(([tx, ty]) => tx === x && ty === y)) return pickWarn("Click one of the gold wall squares.");
    send({ type: "placeLadder", unitId: current.u.id, x, y });
  });
}

/** Set Aflame: orange tiles around the unit; click one to set it alight. */
function enterSetFire() {
  const { u } = current;
  const tiles = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [u.x + dx, u.y + dy]);
  mode = "fire";
  clearSquares();
  overlay = new PIXI.Graphics();
  overlay.eventMode = "none";
  layer().addChild(overlay);
  for (const [x, y] of tiles) drawSquare(overlay, x, y, 0xff7a1a, 0.35, 1);
  renderMenu();
  startPicking((x, y) => {
    if (!tiles.some(([tx, ty]) => tx === x && ty === y)) return pickWarn("Click one of the orange tiles next to the unit.");
    send({ type: "setFire", unitId: current.u.id, x, y });
  });
}

async function send(action) {
  if (!requestFn || busy) return;
  busy = true;
  mode = null;
  clearSquares();
  renderMenu();
  playMoment("Select / confirm");
  try { const res = await requestFn(action); if (res && res.ok === false) playMoment("Error / not allowed", { minGap: 0 }); } finally { busy = false; refreshBattleUI(); }
}

/* ------------------------------------------------------------ the menu */

function hideMenu() {
  menuEl?.remove();
  menuEl = null;
  hidePickHint();
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

/** A wrong click while picking: one warning, not a new one for every click. */
let lastPickWarn = 0;
function pickWarn(msg) {
  if (Date.now() - lastPickWarn < 4000) return;
  lastPickWarn = Date.now();
  playMoment("Error / not allowed");
  ui.notifications.warn(msg);
}

let pickHintEl = null;
function showPickHint(html) {
  if (!pickHintEl) { pickHintEl = document.createElement("div"); pickHintEl.className = "qin qin-pick-hint"; document.body.append(pickHintEl); }
  pickHintEl.innerHTML = html;
}
function hidePickHint() { pickHintEl?.remove(); pickHintEl = null; }

function renderMenu(sub = null) {
  if (!current) return hideMenu();
  const { u, flags, officer } = current;
  if (!menuEl) {
    menuEl = document.createElement("div");
    menuEl.className = "qin qin-fe-menu";
    document.body.append(menuEl);
    menuEl.addEventListener("click", onMenuClick);
    playMoment("Menu opens");
  } else if (sub) playMoment("Menu opens");
  // Picking a square (move, attack, ladders, fire): no box beside the unit, just a hint along the bottom of the screen
  const PICK_HINT = {
    move: "Blue: move · Purple: climb the ladder (all movement) · Red: forced march (officer units, ends turn) · Green: swap",
    attack: "Click an enemy marked in red.",
    duel: "Click an enemy officer unit marked in gold to challenge its officer to a duel.",
    ladder: "Click a gold wall square next to the unit to set the ladders there.",
    fire: "Click an orange tile next to the unit to set it on fire (forest or tall grass).",
  };
  if (PICK_HINT[mode]) {
    menuEl.style.display = "none";
    showPickHint(`<b>${esc(u.name)}</b> · ${PICK_HINT[mode]}<br><span class="qin-fe-back"><i class="fa-solid fa-computer-mouse"></i> Right-click or Esc to go back</span>`);
    return;
  }
  menuEl.style.display = "";
  hidePickHint();
  const b = (act, label, enabled, tip = "", extra = "") =>
    `<button type="button" data-fe="${act}" ${enabled && !busy ? "" : "disabled"} ${tip ? `data-tooltip="${esc(tip)}"` : ""} ${extra}>${label}</button>`;
  let html = `<div class="qin-fe-title">${esc(u.name)}</div>`;
  if (mode === "second") html += `<div class="qin-fe-hint">Dual Weapons: strike another enemy marked in red (Attack −2), or skip.</div>` + b("skipSecond", "Skip", true);
  else if (mode === "reposition") html += (current?.s?.turn?.activation?.reposition?.outrider
    ? `<div class="qin-fe-hint">Outrider: ride on to a green tile, or stay.</div>`
    : current?.s?.turn?.activation?.reposition?.skirmish
    ? `<div class="qin-fe-hint">Skirmisher: move to a green tile, or stay.</div>`
    : `<div class="qin-fe-hint">Won the attack: move to a green tile beside the enemy, or stay.</div>`) + b("stay", "Stay here", true);
  else if (sub === "heroic") {
    html += `<div class="qin-fe-hint">Heroic action (free, doesn't end the turn) · ${officer.fire - (u.heroicUsed || 0)}/${officer.fire} left</div>`;
    (officer.heroicActions || []).forEach((h, i) => {
      html += b("heroicPick", esc(h.name), u.lastHeroic !== h.name, h.text, `data-index="${i}"`);
    });
    html += b("back", "Back", true);
  } else if (sub === "horn") {
    html += `<div class="qin-fe-hint">War Horn: which adjacent ally acts again? Ends this unit's turn.</div>`;
    for (const t of E.hornTargets(current.s, u)) html += b("hornPick", esc(t.name), true, "", `data-target="${esc(t.id)}"`);
    html += b("back", "Back", true);
  } else if (sub === "ability") {
    if (officer?.skill) { const why = flags.skill ? "" : E.skillCheck(current.s, u, officer).reason; html += b("skill", `${esc(officer.skill.name)}${officer.skill.moraleCost ? ` (${officer.skill.moraleCost} morale)` : ""}${why ? ` · ${esc(why)}` : ""}`, flags.skill, officer.skill.text || ""); }
    if (officer?.battleArt) html += b("art", `Battle art: ${esc(officer.battleArt.name)}`, flags.art, officer.battleArt.text || "");
    html += b("back", "Back", true);
  } else {
    const abilityTip = !officer ? "No officer" : officer.skill ? `${officer.skill.name}: ${officer.skill.text || ""}` : "This officer has no battle ability";
    if (flags.undo) html += b("undo", "↶ Undo move", true, "Go back to where the unit started (only for a normal move, before doing anything else)");
    if (flags.takeBack) html += b("takeBack", "↶ Take back turn", true, "Not this unit after all: give the turn back (only before it does anything)");
    html += b("move", "Move", flags.move, flags.move ? "" : "Already moved or can't move");
    if (flags.openGate) html += b("openGate", "Open gate", true, "Unbar the gate next to this unit (owners from either side, anyone from inside the city). Ends the turn.");
    if (flags.closeGate) html += b("closeGate", "Shut gate", true, "Shut and bar the gate next to this unit (the gateway must be empty). Ends the turn.");
    if (flags.pickUp) html += b("pickUp", "Pick up", true, "Take up the siege equipment lying here. Ends the turn.");
    if (flags.placeLadder) html += b("placeLadder", "Place Ladder", true, "Set siege ladders against a city wall square next to this unit. Ends the turn.");
    if (flags.drop) html += b("drop", "Drop equipment", true, "Put down the siege equipment this unit carries (free). Another unit can pick it up.");
    if (flags.reinvigorate) html += b("horn", "Reinvigorate", true, "War Horn: an adjacent ally that has already acted takes another turn at once. Ends this unit's turn; the horn needs a round to recharge.");
    if (flags.raiseFlag) html += b("raiseFlag", "Raise Flag", true, "Raise Flag tactic: instead of attacking, units in the area below 50 morale rally to 50. Ends the turn.");
    if (flags.setFire) html += b("setFire", "Set Fire", true, "Set Aflame tactic: instead of attacking, set an adjacent flammable tile on fire. Ends the turn.");
    if (flags.reloading) html += b("reload", "Reload", flags.reload, "Reload the weapon (needed before it can attack again). Can follow a move; ends the turn.");
    else html += b("attack", "Attack", flags.attack, flags.attack ? "" : "No enemy in range");
    if (flags.outrider) html += b("outrider", "Ride on", true, "Outrider: instead of attacking, move a little further. Ends the turn after.");
    if (flags.duel) html += b("duel", "Duel", true, "Challenge an adjacent enemy officer to single combat (your action for the turn). Refusing costs his unit 15 morale.");
    html += b("hold", "Hold", flags.hold, "No more action this turn; +1 melee defense until this unit's next turn");
    if (flags.overwatch) html += b("overwatch", "Overwatch", true, "End the turn and watch: shoot the first enemy that ends its turn in range before this unit's next turn (one shot)");
    html += b("ability", "Ability", flags.ability, abilityTip);
    if (flags.heroic) html += b("heroic", "Heroic action", true, "Free action from the heroic action list"); // off for now (engine HEROIC_ENABLED)
    html += b("end", "End turn", flags.endTurn);
  }
  menuEl.innerHTML = html;
  placeMenu();
  // the cursor may already be over the menu (it stays put after clicking Move, Attack…): no mouseenter will
  // come, so dodge now
  requestAnimationFrame(dodgeIfHovered);
}

let lastPointer = null;
document.addEventListener("pointermove", (ev) => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, { passive: true, capture: true });
function dodgeIfHovered() {
  if (!menuEl || !mode || !lastPointer || menuEl.style.display === "none") return;
  const r = menuEl.getBoundingClientRect();
  if (lastPointer.x < r.left || lastPointer.x > r.right || lastPointer.y < r.top || lastPointer.y > r.bottom) return;
  menuSide = menuSide === "right" ? "left" : "right";
  placeMenu();
}

function onMenuClick(ev) {
  const btn = ev.target.closest("button[data-fe]");
  if (!btn || btn.disabled || !current) return;
  const id = current.u.id;
  playMoment(["cancel", "back"].includes(btn.dataset.fe) ? "Cancel / back" : "Select / confirm");
  switch (btn.dataset.fe) {
    case "move": return enterMove();
    case "attack": return enterAttack();
    case "duel": return enterDuel();
    case "cancel": return cancelMode();
    case "stay": return send({ type: "reposition", unitId: id });
    case "reload": return send({ type: "reload", unitId: id });
    case "raiseFlag": return send({ type: "raiseFlag", unitId: id });
    case "placeLadder": return enterLadder();
    case "openGate": return send({ type: "openGate", unitId: id });
    case "closeGate": return send({ type: "closeGate", unitId: id });
    case "pickUp": return send({ type: "pickUpEquipment", unitId: id });
    case "drop": return send({ type: "dropEquipment", unitId: id });
    case "setFire": return enterSetFire();
    case "skipSecond": return send({ type: "secondAttack", unitId: id });
    case "back": return renderMenu();
    case "hold": return send({ type: "holdPosition", unitId: id });
    case "outrider": return send({ type: "outrider", unitId: id });
    case "overwatch": return send({ type: "overwatch", unitId: id });
    case "end": return send({ type: "endTurn", unitId: id });
    case "undo": return send({ type: "undoMove", unitId: id });
    case "takeBack": return send({ type: "takeBack", unitId: id });
    case "horn": { const ts = E.hornTargets(current.s, current.u); return ts.length === 1 ? send({ type: "reinvigorate", unitId: id, targetId: ts[0].id }) : renderMenu("horn"); }
    case "hornPick": return send({ type: "reinvigorate", unitId: id, targetId: btn.dataset.target });
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
  if (!battle.active) { hideDuel(); return resetBattleUI(); }
  renderDuel(battle);
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
  if (ac.step === "duel") { mode = null; clearSquares(); return hideMenu(); } // waiting on the duel
  if (ac.step === "reposition") { if (mode !== "reposition") enterReposition(); return; }
  if (ac.step === "second") { if (mode !== "second") enterSecond(); return; }
  if (!mode) renderMenu();
}

export function repositionBattleUI() { placeMenu(); hidePick(); }

/* ------------------------------------------------------------ officer duels */

let duelEl = null;
function hideDuel() { duelEl?.remove(); duelEl = null; }
/**
 * The duel box. Challenged: the challenged unit's owner (a player) and the GM get Accept / Refuse.
 * Being fought: the GM gets End duel (once the round of personal combat is over) and Call off; everyone else sees who is fighting.
 */
function renderDuel(battle) {
  const p = battle.duels?.pending;
  if (!p) return hideDuel();
  const { s } = buildState(battle);
  const A = E.unitById(s, p.from), B = E.unitById(s, p.to);
  if (!A || !B) return hideDuel();
  const nm = (u) => esc(E.officerOf(s, u)?.name ?? u.name);
  const answerer = game.user.isGM || (B.owner && B.owner === game.user.id);
  const key = JSON.stringify([p.from, p.to, p.stage, answerer, game.user.isGM]);
  if (duelEl?.dataset.key === key) return;
  hideDuel();
  duelEl = document.createElement("div");
  duelEl.className = "qin qin-fe-menu qin-duel-box";
  duelEl.dataset.key = key;
  let html = `<div class="qin-fe-title"><i class="fa-solid fa-swords"></i> Duel</div>`;
  if (p.stage === "asked") {
    html += `<div class="qin-fe-hint"><b>${nm(A)}</b> (${esc(A.name)}) challenges <b>${nm(B)}</b> (${esc(B.name)}) to single combat.</div>`;
    if (answerer) html += `<div class="qin-fe-hint">Refusing costs ${esc(B.name)} 15 morale, and no one can challenge it again this battle.</div>`
      + `<button type="button" data-duel="accept">Accept</button><button type="button" data-duel="refuse">Refuse</button>`;
    else html += `<div class="qin-fe-hint">Waiting for ${nm(B)}'s answer…</div>`;
  } else {
    html += `<div class="qin-fe-hint"><b>${nm(A)}</b> and <b>${nm(B)}</b> fight one round, mounted, with the actions their weapon skill gives (Horsemanship doesn't limit them).</div>`;
    if (game.user.isGM) html += `<div class="qin-fe-hint">When the round is over, End duel compares how far each fell on the Breath of Life track.</div>`
      + `<button type="button" data-duel="end">End duel</button><button type="button" data-duel="cancel">Call off</button>`;
  }
  duelEl.innerHTML = html;
  Object.assign(duelEl.style, { position: "fixed", top: "90px", left: "50%", transform: "translateX(-50%)", zIndex: 100, maxWidth: "360px" });
  document.body.append(duelEl);
  playMoment("Menu opens");
  duelEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-duel]");
    if (!btn || !requestFn) return;
    playMoment("Select / confirm");
    const what = btn.dataset.duel;
    btn.disabled = true;
    const action = what === "accept" ? { type: "duelAnswer", accept: true } : what === "refuse" ? { type: "duelAnswer", accept: false }
      : what === "end" ? { type: "duelEnd" } : { type: "duelCancel" };
    const res = await requestFn(action);
    if (res && res.ok === false) btn.disabled = false;
  });
}

/* ------------------------------------------------------------ click a unit on the map to take its turn */

let pickEl = null;
function hidePick() { pickEl?.remove(); pickEl = null; }

/** Turn-start choices that apply to this unit right now (empty outside a battle round). */
function turnButtons(token) {
  const battle = getBattle();
  if (!battle.active || canvas.scene?.id !== battle.sceneId) return [];
  const { s } = buildState(battle);
  const u = E.unitById(s, token.id);
  if (!u || u.status !== "active" || u.round.activated) return [];
  const p = E.prompt(s), t = s.turn, a = t.activation;
  const buttons = [];
  // A held officer with higher initiative than the unit about to act can interject (until that unit has started)
  if (t.held?.includes(u.id) && iControl(u) && !(a && a.started) && !(a && a.unitId === u.id) && t.order.indexOf(u.id) < (p.rank ?? Infinity)
    && ["decide", "final", "claim", "pick", "host-pick", "activation"].includes(p.kind))
    buttons.push(["Interject", [{ type: "interject", unitId: u.id }]]);
  if (a) return buttons;
  const me = game.user.isGM ? "host" : game.user.id;
  const mineToMove = u.owner === game.user.id || (game.user.isGM && !u.owner);
  if (!u.officerId) {
    if (p.kind === "pick" && p.player === me && u.side === "player" && mineToMove) buttons.push(["Take turn", [{ type: "begin", unitId: u.id }]]);
    else if (p.kind === "claim" && u.side === "player" && mineToMove) buttons.push(["Take turn", [{ type: "begin", unitId: u.id }]]);
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
    + `<button type="button" data-info="1"><i class="fa-solid fa-circle-info"></i> Info</button>`
    + (canPinThreat(token) ? `<button type="button" data-threat="1" class="${threatPinned(token.id) ? "qin-on" : ""}" title="Keep this unit's reach on the map: where it can move this turn and, in orange, where it could attack from there. Press again to hide it."><i class="fa-solid fa-bullseye"></i> ${threatPinned(token.id) ? "Hide threat range" : "Threat range"}</button>` : "");
  document.body.append(pickEl);
  // no "Unit selected" sound while units are being deployed (setup and tactics phases: David, 2026-10-30)
  { const b = game.settings.get(SYSTEM_ID, "battle"); const deploying = b?.active && b.sceneId === canvas.scene?.id && ["setup", "tactics"].includes(b.turn?.phase);
    if (!deploying) playMoment("Unit selected"); }
  const pos = toClient({ x: token.x + token.w, y: token.y });
  pickEl.style.left = `${Math.round(pos.x + 8)}px`;
  pickEl.style.top = `${Math.round(pos.y)}px`;
  pickEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    hidePick();
    playMoment("Select / confirm");
    if (btn.dataset.info) return openUnitInfo(token);
    if (btn.dataset.threat) return toggleThreatRange(token);
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

/**
 * Who may drag a unit token where. Players: only their own units, only during the tactics phase, and only onto
 * free deployment squares (never outside a battle). The GM: anywhere outside the battle rounds.
 * During the rounds units move with the Move action.
 */
export function lockUnitTokens(tokenDoc, change, options) {
  if (options?.qinBattle || isWritingBack() || !("x" in change || "y" in change)) return;
  return checkUnitMove(tokenDoc, change.x ?? tokenDoc.x, change.y ?? tokenDoc.y);
}
/**
 * The same rule through Foundry's movement API (v13+): refusing a drag here cancels it cleanly. Refusing it later
 * in preUpdateToken left the dragged tokens stuck mid-drag (all moving together, no Esc, no clicking away).
 */
export function lockUnitMoves(tokenDoc, movement, operation) {
  if (operation?.qinBattle || isWritingBack()) return;
  const to = movement?.destination; if (!to) return;
  return checkUnitMove(tokenDoc, to.x ?? tokenDoc.x, to.y ?? tokenDoc.y);
}
function checkUnitMove(tokenDoc, px, py) {
  if (tokenDoc.actor?.type !== "unit") return;
  const battle = game.settings.get(SYSTEM_ID, "battle");
  const scene = tokenDoc.parent;
  const phase = battle?.active && scene?.id === battle.sceneId ? (battle.turn?.phase ?? "setup") : "none";
  const size = scene?.grid?.size ?? 100;
  const x = Math.round(px / size), y = Math.round(py / size);
  const occupied = (scene?.tokens ?? []).some(t => t.id !== tokenDoc.id && t.actor?.type === "unit" && Math.round(t.x / size) === x && Math.round(t.y / size) === y);
  const chk = deployMoveCheck({ phase, isGM: game.user.isGM, zones: zoneSet(scene?.getFlag?.(SYSTEM_ID, DEPLOY_FLAG)), occupied }, x, y);
  if (chk.ok) return;
  playMoment("Error / not allowed");
  ui.notifications.warn(chk.reason);
  return false;
}
