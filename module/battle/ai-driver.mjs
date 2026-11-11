// Battle AI driver (David, 2026-11-03): runs the AI on the active GM's client. Each side (enemy, ally) has its own
// switch in the GM controls; Pause stops it at once. When it is an AI side's move the driver waits a moment (so
// people can follow it on the map), asks the AI for one action and sends it through the normal battle channel;
// the battle update that follows starts the next step. A unit owned by a player is never moved by the AI.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle, buildState, runAction } from "./adapter.mjs";
import { aiStep, sideLevel } from "./ai.mjs";
import { atSpeed } from "./battle-speed.mjs";

const KEY = "battleAI";
// step: the AI only suggests its next move (shown on the map and in a card) and plays it when the GM clicks
// Next move (G); off = it plays by itself as before (David, 2026-11-10)
const DEFAULTS = { enemy: false, ally: false, paused: false, delay: 900, step: true };

export function registerBattleAI() {
  game.settings.register(SYSTEM_ID, KEY, { scope: "world", config: false, type: Object, default: { ...DEFAULTS }, onChange: () => schedule() });
  Hooks.on("updateSetting", (st) => { if (st.key === `${SYSTEM_ID}.battle`) schedule(); });
  Hooks.once("ready", () => schedule());
  // Pause / resume the battle AI from the keyboard (GM, David 2026-11-08); the GM controls' Pause button does the same
  game.keybindings.register(SYSTEM_ID, "pauseAI", {
    name: "Pause battle AI (GM)", hint: "Stops the enemy and ally AI at once; press again to let it carry on.",
    editable: [{ key: "KeyK" }], restricted: true, precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { toggleAIPause(); return true; },
  });
  game.keybindings.register(SYSTEM_ID, "aiNextMove", {
    name: "Battle AI: play the suggested move (GM)", hint: "When the AI suggests moves instead of playing by itself, plays the move it suggests.",
    editable: [{ key: "KeyG" }], restricted: true, precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { if (!suggestion) return false; playSuggestion(); return true; },
  });
  Hooks.on("canvasTearDown", () => clearSuggestion());
}

/** Pause the battle AI, or resume it. */
export async function toggleAIPause() {
  const paused = !aiSettings().paused;
  await setAI({ paused });
  ui.notifications.info(paused ? "Battle AI paused (K to resume)." : "Battle AI resumed.");
  try { (await import("./gm-panel.mjs")).GmPanel?.refresh?.(); } catch { /* panel not open */ }
}

export const aiSettings = () => ({ ...DEFAULTS, ...(game.settings.get(SYSTEM_ID, KEY) ?? {}) });
export async function setAI(patch) { await game.settings.set(SYSTEM_ID, KEY, { ...aiSettings(), ...patch }); }

/** The Art of War level the AI plays each side at (the side's tactician; 1 without one). */
export function aiLevels() {
  const battle = getBattle();
  if (!battle.active) return { enemy: 1, ally: 1 };
  const { s } = buildState(battle);
  return { enemy: sideLevel(s, "enemy"), ally: sideLevel(s, "ally") };
}

let timer = null, busy = false, fails = 0;

// Big moments get a longer pause before the AI goes on, so everyone sees what happened (David, 2026-11-04):
// a unit routed, a tactic sprung, an officer skill, heroic action or duel, an officer going his own way,
// a gate or building destroyed, and reinforcements arriving.
const BIG = new Set(["defeat", "tactic", "skill", "heroic", "duel", "aiNote", "burntDown", "gate", "levelUp", "surrounded"]);
const BIG_PAUSE = 2600;
let seenT = 0, seenArrived = null, pauseUntil = 0;
function bigMomentSince() {
  const battle = getBattle();
  const log = battle.log ?? [];
  const fresh = log.filter(e => (e.t ?? 0) > seenT);
  if (log.length) seenT = Math.max(seenT, ...log.map(e => e.t ?? 0));
  let big = fresh.some(e => BIG.has(e.detail?.type));
  try { // reinforcements that have just arrived
    const zones = game.scenes.get(battle.sceneId)?.getFlag(SYSTEM_ID, "reinforcements")?.zones ?? [];
    const arrived = zones.filter(z => z.arrived).length;
    if (seenArrived !== null && arrived > seenArrived) big = true;
    seenArrived = arrived;
  } catch { /* no scene */ }
  return big;
}
const isRunner = () => game.user?.isGM && (!game.users.activeGM || game.users.activeGM === game.user);

function schedule() {
  if (!isRunner()) return;
  clearTimeout(timer);
  const cfg = aiSettings();
  if (cfg.paused || (!cfg.enemy && !cfg.ally)) return clearSuggestion();
  if (cfg.step) { timer = setTimeout(() => suggest().catch(e => console.warn("Qin | battle AI", e)), 120); return; }
  clearSuggestion();
  const now = Date.now();
  if (bigMomentSince()) pauseUntil = now + atSpeed(BIG_PAUSE);
  const wait = Math.max(atSpeed(Math.max(150, Number(cfg.delay) || 900)), pauseUntil - now);
  timer = setTimeout(() => tick().catch(e => console.warn("Qin | battle AI", e)), wait);
}

/** What the AI would do now: { action, s } or null. */
function plan(cfg = aiSettings()) {
  const battle = getBattle();
  if (!battle.active || battle.outcome) return null;
  const unitId = battle.turn?.activation?.unitId ?? null;
  const { s } = buildState(battle, { terrainFor: unitId });
  try { const action = aiStep(s, { enemy: cfg.enemy, ally: cfg.ally }); return action ? { action, s } : null; }
  catch (e) { console.warn("Qin | battle AI planning", e); return null; }
}

async function tick() {
  if (busy || !isRunner()) return;
  const cfg = aiSettings();
  if (cfg.paused || (!cfg.enemy && !cfg.ally)) return;
  const p = plan(cfg); if (!p) return;
  await perform(p.action);
}
async function perform(action) {
  busy = true;
  try {
    const res = await runAction(game.user.id, action);
    if (res?.ok) { fails = 0; return; }
    fails++;
    console.warn("Qin | battle AI action refused", action, res?.error);
    // don't get stuck: end the unit's turn if it can't do what it planned
    if (getBattle().turn?.activation?.skillQueue?.length) await runAction(game.user.id, { type: "skillChoose", skip: true }); // a skill's choice first
    if (action.unitId && getBattle().turn?.activation?.unitId === action.unitId) await runAction(game.user.id, { type: "endTurn", unitId: action.unitId });
    if (fails >= 3) {
      fails = 0;
      await setAI({ paused: true });
      ui.notifications.warn(`Battle AI paused: its moves keep being refused (${res?.error ?? "unknown"}). Resume it in GM controls.`);
    }
  } finally {
    busy = false;
    schedule();
  }
}

/* ------------------------------------------------------------ suggest mode (David, 2026-11-10) */
let suggestion = null, card = null, gfx = null;
const unitName = (s, id) => s.units.find(u => u.id === id)?.name ?? "a unit";
/** One line for an AI action. */
export function describeAction(s, a) {
  const u = unitName(s, a.unitId), t = a.targetId ? unitName(s, a.targetId) : "";
  switch (a.type) {
    case "begin": return `Activate ${u}`;
    case "decide": return a.choice === "hold" ? `${u} holds this round` : `${u} acts`;
    case "moveTo": return `${u} moves to the marked square`;
    case "attack": return `${u} attacks ${t}`;
    case "secondAttack": return `${u} attacks ${t || "again"}`;
    case "attackGate": return `${u} attacks the gate`;
    case "reposition": return a.x != null ? `${u} repositions to the marked square` : `${u} repositions`;
    case "holdPosition": return `${u} holds its position`;
    case "overwatch": return `${u} stands on overwatch`;
    case "skipMove": return `${u} stays where it is`;
    case "endTurn": return `${u} ends its turn`;
    case "useSkill": return `${u} uses its officer's battlefield skill`;
    case "skillChoose": return a.skip ? `${u} skips the skill's choice` : `${u} makes the skill's choice`;
    case "skillReveal": return a.skip ? "No unit revealed" : `Reveal ${t}`;
    case "reload": return `${u} reloads`;
    case "tendWounded": return `${u} tends its wounded`;
    case "pickUpEquipment": return `${u} picks up equipment`;
    case "placeLadder": return `${u} places a ladder`;
    case "setFire": return `${u} sets a fire`;
    case "extinguish": return `${u} puts out a fire`;
    case "closeGate": return `${u} closes the gate`;
    case "setTactician": return `The ${a.side} side picks its tactician`;
    case "placeTactic": return `The ${a.side} side places a tactic (${a.key})`;
    case "aiNote": return a.text ?? "AI note";
    default: return `${u}: ${a.type}`;
  }
}
function clearSuggestion() {
  suggestion = null;
  card?.remove(); card = null;
  if (gfx && !gfx.destroyed) { canvas.app?.ticker?.remove(gfx.qinTick); gfx.destroy(); }
  gfx = null;
}
async function suggest() {
  if (busy || !isRunner()) return;
  const cfg = aiSettings();
  if (cfg.paused || (!cfg.enemy && !cfg.ally) || !cfg.step) return clearSuggestion();
  const p = plan(cfg);
  if (!p) return clearSuggestion();
  // a few steps need no decision of the GM's (the "act" prompt, skill choices with nothing to pick): still asked, as a move
  suggestion = p;
  showCard(describeAction(p.s, p.action));
  drawMarks(p.s, p.action);
}
async function playSuggestion() {
  if (busy || !suggestion) return;
  const fresh = plan();                                   // the battle may have moved on since it was shown
  clearSuggestion();
  if (fresh) await perform(fresh.action); else schedule();
}
function showCard(text) {
  if (!card) {
    card = document.createElement("div"); card.className = "qin qin-ai-suggest";
    card.innerHTML = `<div class="hd"><i class="fa-solid fa-robot"></i> AI suggests</div><div class="tx"></div>
      <div class="bt"><button type="button" data-a="play"><i class="fa-solid fa-forward-step"></i> Next move <kbd>G</kbd></button>
      <button type="button" data-a="auto" data-tooltip="Let the AI play by itself"><i class="fa-solid fa-forward-fast"></i> Auto</button></div>`;
    card.querySelector('[data-a="play"]').onclick = () => playSuggestion();
    card.querySelector('[data-a="auto"]').onclick = async () => { await setAI({ step: false }); try { (await import("./gm-panel.mjs")).GmPanel?.refresh?.(); } catch { /* */ } };
    document.body.appendChild(card);
  }
  card.querySelector(".tx").textContent = text;
}
/** Mark the unit, and where it goes or whom it hits. */
function drawMarks(s, a) {
  if (gfx && !gfx.destroyed) { canvas.app?.ticker?.remove(gfx.qinTick); gfx.destroy(); }
  gfx = null;
  if (!canvas?.ready) return;
  const size = canvas.grid.size, at = (x, y) => ({ x: (x + 0.5) * size, y: (y + 0.5) * size });
  const u = s.units.find(v => v.id === a.unitId), t = a.targetId ? s.units.find(v => v.id === a.targetId) : null;
  const from = u ? at(u.x, u.y) : null;
  const to = t ? at(t.x, t.y) : a.x != null && a.y != null ? at(a.x, a.y) : null;
  if (!from && !to) return;
  const g = new PIXI.Graphics(); g.eventMode = "none";
  (canvas.controls ?? canvas.interface).addChild(g);
  const red = !!t, col = red ? 0xff5040 : 0x4da3ff;
  let k = 0;
  g.qinTick = () => {
    k += (canvas.app.ticker.deltaMS || 16) / 1000; const p = 0.5 + 0.5 * Math.sin(k * 5);
    g.clear();
    if (from) g.lineStyle(5, 0xffd34d, 0.6 + 0.4 * p).drawRect(from.x - size / 2 + 3, from.y - size / 2 + 3, size - 6, size - 6);
    if (to) {
      g.lineStyle(5, col, 0.6 + 0.4 * p).drawRect(to.x - size / 2 + 3, to.y - size / 2 + 3, size - 6, size - 6);
      if (from) {
        const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, e = size * 0.42;
        const ax = from.x + ux * e, ay = from.y + uy * e, bx = to.x - ux * e, by = to.y - uy * e;
        g.lineStyle(6, col, 0.9).moveTo(ax, ay).lineTo(bx, by);
        g.beginFill(col, 0.95).lineStyle(0).drawPolygon([bx, by, bx - ux * 22 - uy * 13, by - uy * 22 + ux * 13, bx - ux * 22 + uy * 13, by - uy * 22 - ux * 13]).endFill();
      }
    }
  };
  canvas.app.ticker.add(g.qinTick);
  gfx = g;
}
