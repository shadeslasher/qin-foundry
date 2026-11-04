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
const isRunner = () => game.user?.isGM && (!game.users.activeGM || game.users.activeGM === game.user);

function schedule() {
  if (!isRunner()) return;
  clearTimeout(timer);
  const cfg = aiSettings();
  if (cfg.paused || (!cfg.enemy && !cfg.ally)) return;
  timer = setTimeout(() => tick().catch(e => console.warn("Qin | battle AI", e)), atSpeed(Math.max(150, Number(cfg.delay) || 900)));
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
