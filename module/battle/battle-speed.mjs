// Battle speed (David, 2026-11-04): F switches this computer between normal and double speed. At double speed the
// battle animations (lunges, hits, floating numbers), token slides, camera pans and the battle AI's pause between
// moves all take half as long. Each person sets their own.
import { SYSTEM_ID } from "../config.mjs";

export function battleSpeed() {
  try { return game.settings.get(SYSTEM_ID, "battleSpeed") === 2 ? 2 : 1; } catch { return 1; }
}
/** A duration in ms at the current battle speed. */
export const atSpeed = (ms) => ms / battleSpeed();

function applyTokenSpeed() {
  const m = CONFIG.Token?.movement;
  if (!m) return;
  m.qinBaseSpeed ??= Number(m.defaultSpeed) || 6;
  m.defaultSpeed = m.qinBaseSpeed * battleSpeed();
}

export function registerBattleSpeed() {
  game.settings.register(SYSTEM_ID, "battleSpeed", {
    name: "Battle speed", scope: "client", config: false, type: Number, default: 1,
    onChange: () => applyTokenSpeed(),
  });
  game.keybindings.register(SYSTEM_ID, "battleSpeed", {
    name: "Battle speed ×2", hint: "Switches battle animations, unit moves, camera pans and the battle AI between normal and double speed (on this computer).",
    editable: [{ key: "KeyF" }], precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => {
      const next = battleSpeed() === 2 ? 1 : 2;
      game.settings.set(SYSTEM_ID, "battleSpeed", next);
      ui.notifications.info(next === 2 ? "Battle speed: double (press F for normal)" : "Battle speed: normal");
      return true;
    },
  });
  Hooks.once("ready", () => applyTokenSpeed());
}
