// Reinforcement zones on the map (GM, mid-battle): paint a zone with a brush, place units on it, and they stay
// hidden from players and out of the fight until the zone's round starts. Then they are revealed, join the battle
// and can act that round. The zones are saved on the scene; only the GM sees them.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle } from "./adapter.mjs";
import { REINFORCE_FLAG, REINFORCE_TOKEN_FLAG, zonesOf, waitingZoneAt, isWaiting, dueZones, nextZoneName, arrivalRound } from "./reinforce-rules.mjs";

const COLOR = 0xffb020, SHADOW = 0x3a2600;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
let layer = null, brush = null, onChange = () => {};
export function setReinforceChangeHandler(fn) { onChange = fn; }

const gridSize = () => canvas.scene?.grid?.size ?? 100;
export const zonesOn = (scene = canvas.scene) => zonesOf(scene?.getFlag?.(SYSTEM_ID, REINFORCE_FLAG));
const newId = () => foundry.utils.randomID?.(8) ?? Math.random().toString(36).slice(2, 10);

async function saveZones(scene, zones) {
  if (!game.user.isGM || !scene) return;
  await scene.update({ [`flags.${SYSTEM_ID}.${REINFORCE_FLAG}`]: { zones } });
  drawReinforceZones(); onChange();
}

/** Is a battle running on this scene (past setup)? Zones only matter then. */
function inBattle(scene = canvas.scene) {
  const b = getBattle();
  return !!scene && b.active && b.sceneId === scene.id && !["setup", "over"].includes(b.turn?.phase);
}

/** Tokens waiting in a zone. */
export function waitingTokens(scene, zoneId = null) {
  return (scene?.tokens ?? []).filter(t => t.actor?.type === "unit" && isWaiting(t.getFlag(SYSTEM_ID, REINFORCE_TOKEN_FLAG), zonesOn(scene))
    && (!zoneId || t.getFlag(SYSTEM_ID, REINFORCE_TOKEN_FLAG) === zoneId));
}

/* ------------------------------------------------------------ the battle panel card */

export function reinforceCardState(scene = canvas.scene) {
  if (!game.user.isGM || !inBattle(scene)) return null;
  const round = getBattle().turn?.round ?? 0;
  return {
    round,
    zones: zonesOn(scene).map(z => ({
      id: z.id, name: z.name, squares: (z.squares ?? []).length, round: z.round, arrived: !!z.arrived,
      waiting: waitingTokens(scene, z.id).length,
      painting: brush?.zoneId === z.id && brush.mode === "paint", erasing: brush?.zoneId === z.id && brush.mode === "erase",
      when: z.arrived ? "arrived" : z.round <= round ? "arrives when the next round starts" : `arrives at the start of round ${z.round}`,
    })),
  };
}

export async function newZone(inRounds) {
  const scene = canvas.scene; if (!inBattle(scene)) return;
  const zones = zonesOn(scene);
  const z = { id: newId(), name: nextZoneName(zones), squares: [], round: arrivalRound(getBattle().turn?.round ?? 0, inRounds), arrived: false };
  await saveZones(scene, [...zones, z]);
  startReinforceBrush(z.id, "paint");
}

export async function removeZone(zoneId) {
  const scene = canvas.scene; if (!scene) return;
  if (brush?.zoneId === zoneId) stopBrush();
  // units waiting in it come back into view
  for (const t of waitingTokens(scene, zoneId)) await t.update({ hidden: false, [`flags.${SYSTEM_ID}.-=${REINFORCE_TOKEN_FLAG}`]: null }, { qinBattle: true });
  await saveZones(scene, zonesOn(scene).filter(z => z.id !== zoneId));
}

export async function setZoneRound(zoneId, round) {
  const scene = canvas.scene; if (!scene) return;
  await saveZones(scene, zonesOn(scene).map(z => z.id === zoneId ? { ...z, round: Math.max(1, Math.round(Number(round) || 1)) } : z));
}

/* ------------------------------------------------------------ arrival */

/** Reveal the units waiting in these zones: they join the battle now. */
async function arrive(scene, zones, why) {
  const names = [];
  for (const z of zones) {
    for (const t of waitingTokens(scene, z.id)) {
      names.push(t.name);
      await t.update({ hidden: false, [`flags.${SYSTEM_ID}.-=${REINFORCE_TOKEN_FLAG}`]: null }, { qinBattle: true });
    }
  }
  const ids = new Set(zones.map(z => z.id));
  await saveZones(scene, zonesOn(scene).map(z => ids.has(z.id) ? { ...z, arrived: true } : z));
  if (names.length) ChatMessage.create({ content: `<p><b>Reinforcements arrive${why ? ` (${esc(why)})` : ""}:</b> ${names.map(esc).join(", ")}.</p>`, speaker: { alias: "Battle" } });
  return names;
}

/** Called by the adapter when the GM starts a round: zones due this round arrive before the units are counted. */
export async function arriveDue(scene, round) {
  if (!game.user.isGM || !scene) return [];
  const due = dueZones(zonesOn(scene), round);
  return due.length ? arrive(scene, due, `round ${round}`) : [];
}

/** The GM's "Arrive now" button. */
export async function arriveNow(zoneId) {
  const scene = canvas.scene, z = zonesOn(scene).find(z => z.id === zoneId);
  if (!z || z.arrived) return;
  await arrive(scene, [z], "");
}

/** The battle ended or went back to setup: forget the zones and show every waiting unit. */
export async function clearReinforcements(scene) {
  if (!game.user.isGM || !scene) return;
  stopBrush();
  for (const t of waitingTokens(scene)) await t.update({ hidden: false, [`flags.${SYSTEM_ID}.-=${REINFORCE_TOKEN_FLAG}`]: null }, { qinBattle: true });
  if (zonesOn(scene).length) await scene.update({ [`flags.${SYSTEM_ID}.-=${REINFORCE_FLAG}`]: null });
  drawReinforceZones(); onChange();
}

/* ------------------------------------------------------------ units placed on a zone */

/** A unit token placed on a live zone hides and waits; moved off it, it comes back. GM's client. */
async function checkToken(tokenDoc, change = {}) {
  if (game.users.activeGM?.id !== game.user.id) return;
  const scene = tokenDoc.parent;
  if (!scene || tokenDoc.actor?.type !== "unit" || !inBattle(scene)) return;
  const zones = zonesOn(scene); if (!zones.length) return;
  const size = scene.grid?.size ?? 100;
  const x = Math.round((change.x ?? tokenDoc.x) / size), y = Math.round((change.y ?? tokenDoc.y) / size);
  const z = waitingZoneAt(zones, x, y), cur = tokenDoc.getFlag(SYSTEM_ID, REINFORCE_TOKEN_FLAG);
  if (z && cur !== z.id) {
    await tokenDoc.update({ hidden: true, [`flags.${SYSTEM_ID}.${REINFORCE_TOKEN_FLAG}`]: z.id }, { qinBattle: true });
    onChange();
  } else if (!z && cur) {
    await tokenDoc.update({ hidden: false, [`flags.${SYSTEM_ID}.-=${REINFORCE_TOKEN_FLAG}`]: null }, { qinBattle: true });
    onChange();
  }
}

/* ------------------------------------------------------------ the brush */

function canvasPoint(ev) {
  const view = canvas.app.view;
  return canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
    ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - view.getBoundingClientRect().left, y: ev.clientY - view.getBoundingClientRect().top });
}

export function stopBrush() {
  if (brush?.listeners) {
    const l = brush.listeners;
    document.removeEventListener("pointerdown", l.down, true);
    document.removeEventListener("pointermove", l.move, true);
    document.removeEventListener("pointerup", l.up, true);
    document.removeEventListener("keydown", l.key, true);
    canvas.app?.view?.removeEventListener("contextmenu", l.block, true);
    if (canvas.app?.view) canvas.app.view.style.cursor = "";
  }
  brush = null;
}

export function startReinforceBrush(zoneId, mode) {
  if (!game.user.isGM || !canvas?.ready) return;
  if (brush?.zoneId === zoneId && brush.mode === mode) { stopBrush(); onChange(); return; }
  stopBrush();
  const scene = canvas.scene, view = canvas.app.view, size = gridSize();
  const zone = zonesOn(scene).find(z => z.id === zoneId); if (!zone) return;
  const tiles = new Set(zone.squares ?? []);
  let painting = false;
  const apply = (ev) => {
    const p = canvasPoint(ev); if (p.x < 0 || p.y < 0) return;
    const k = `${Math.floor(p.x / size)},${Math.floor(p.y / size)}`;
    if (mode === "paint") { // a square belongs to one zone
      for (const z of zonesOn(scene)) if (z.id !== zoneId && (z.squares ?? []).includes(k)) return;
      tiles.add(k);
    } else tiles.delete(k);
    drawReinforceZones({ [zoneId]: tiles });
  };
  const down = (ev) => {
    if (ev.target !== view) return;
    ev.stopPropagation(); ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) { stopBrush(); onChange(); return; }
    if (ev.button !== 0) return;
    painting = true; apply(ev);
  };
  const move = (ev) => { if (painting && ev.target === view) apply(ev); };
  const up = async () => {
    if (!painting) return;
    painting = false;
    await saveZones(scene, zonesOn(scene).map(z => z.id === zoneId ? { ...z, squares: [...tiles].sort() } : z));
    // units already standing on freshly painted squares start waiting; squares erased under a unit release it
    for (const t of scene.tokens) if (t.actor?.type === "unit") await checkToken(t);
  };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); stopBrush(); onChange(); } };
  const block = (ev) => ev.preventDefault();
  brush = { zoneId, mode, listeners: { down, move, up, key, block } };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("keydown", key, true);
  view.addEventListener("contextmenu", block, true);
  view.style.cursor = "crosshair";
  ui.notifications.info(mode === "paint" ? `Paint ${zone.name} (amber): click or drag. Right-click or Esc to stop.` : `Erase ${zone.name} squares: click or drag. Right-click or Esc to stop.`);
  onChange();
}

/* ------------------------------------------------------------ drawing (GM only) */

export function drawReinforceZones(override = null) {
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = null;
  if (!canvas?.ready || !game.user.isGM) return;
  const scene = canvas.scene, zones = zonesOn(scene).filter(z => !z.arrived);
  if (!zones.length || !inBattle(scene)) return;
  const size = gridSize();
  layer = new PIXI.Container(); layer.eventMode = "none";
  const g = new PIXI.Graphics(); layer.addChild(g);
  const w = Math.max(1.5, size * 0.03), inset = w;
  for (const z of zones) {
    const squares = override?.[z.id] ? [...override[z.id]] : (z.squares ?? []);
    const tiles = squares.map(k => k.split(",").map(Number));
    g.beginFill(COLOR, 0.22);
    for (const [x, y] of tiles) g.drawRect(x * size, y * size, size, size);
    g.endFill();
    g.lineStyle(w * 2, SHADOW, 0.4);
    for (const [x, y] of tiles) g.drawRect(x * size + inset, y * size + inset, size - 2 * inset, size - 2 * inset);
    g.lineStyle(w, COLOR, 0.95);
    for (const [x, y] of tiles) g.drawRect(x * size + inset, y * size + inset, size - 2 * inset, size - 2 * inset);
    if (tiles.length) { // label on the top-left-most square
      const [lx, ly] = tiles.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      const t = new PIXI.Text(`${z.name} · round ${z.round}`, { fontFamily: "Signika, sans-serif", fontSize: Math.max(11, size * 0.16), fontWeight: "bold", fill: 0xfff1cc, stroke: SHADOW, strokeThickness: 3 });
      t.position.set(lx * size + size * 0.08, ly * size + size * 0.06);
      layer.addChild(t);
    }
  }
  (canvas.interface ?? canvas.stage).addChild(layer);
}

export function registerReinforcements() {
  Hooks.on("canvasReady", () => { stopBrush(); drawReinforceZones(); });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.${REINFORCE_FLAG}`)) { drawReinforceZones(); onChange(); }
  });
  Hooks.on("createToken", (doc) => checkToken(doc));
  Hooks.on("updateToken", (doc, change) => { if ("x" in change || "y" in change) checkToken(doc, change); });
  Hooks.on("deleteToken", () => onChange());
}
