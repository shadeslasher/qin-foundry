// Battle AI driver (David, 2026-11-03): runs the AI on the active GM's client. Each side (enemy, ally) has its own
// switch in the GM controls; Pause stops it at once. When it is an AI side's move the driver waits a moment (so
// people can follow it on the map), asks the AI for one action and sends it through the normal battle channel;
// the battle update that follows starts the next step. A unit owned by a player is never moved by the AI.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle, buildState, runAction } from "./adapter.mjs";
import { aiStep, sideLevel } from "./ai.mjs";
import { atSpeed } from "./battle-speed.mjs";

const KEY = "battleAI";
const DEFAULTS = { enemy: false, ally: false, paused: false, delay: 900 };

export function registerBattleAI() {
  game.settings.register(SYSTEM_ID, KEY, { scope: "world", config: false, type: Object, default: { ...DEFAULTS }, onChange: () => schedule() });
  Hooks.on("updateSetting", (st) => { if (st.key === `${SYSTEM_ID}.battle`) schedule(); });
  Hooks.once("ready", () => schedule());
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
  if (cfg.paused || (!cfg.enemy && !cfg.ally)) return;
  const now = Date.now();
  if (bigMomentSince()) pauseUntil = now + atSpeed(BIG_PAUSE);
  const wait = Math.max(atSpeed(Math.max(150, Number(cfg.delay) || 900)), pauseUntil - now);
  timer = setTimeout(() => tick().catch(e => console.warn("Qin | battle AI", e)), wait);
}

async function tick() {
  if (busy || !isRunner()) return;
  const cfg = aiSettings();
  if (cfg.paused || (!cfg.enemy && !cfg.ally)) return;
  const battle = getBattle();
  if (!battle.active || battle.outcome) return;
  const unitId = battle.turn?.activation?.unitId ?? null;
  const { s } = buildState(battle, { terrainFor: unitId });
  let action = null;
  try { action = aiStep(s, { enemy: cfg.enemy, ally: cfg.ally }); }
  catch (e) { console.warn("Qin | battle AI planning", e); return; }
  if (!action) return;
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
