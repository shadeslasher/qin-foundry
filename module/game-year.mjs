// Game year and office visibility (David, 2026-11-02).
// Players only see offices whose first year has arrived; the GM sees every office (future ones marked).
// Death (system.death) is GM only. The overworld time system will set the year later.
import { SYSTEM_ID } from "./config.mjs";

export const GAME_YEAR = "gameYear";
export const DEFAULT_YEAR = 190;

/**
 * The first year an office's "When" text names: "208", "c.209", "190s" (→ 190), "208–219" (→ 208),
 * "after 208" (→ 208). Text with no year ("early career") gives null, which counts as already held.
 */
export function officeStartYear(when) {
  const m = String(when ?? "").match(/(\d{3,4})/);
  return m ? Number(m[1]) : null;
}

/** True when an office has started by `year` (offices with no year count as started). */
export function officeStarted(office, year) {
  const y = officeStartYear(office?.when);
  return y === null || !Number.isFinite(year) || y <= year;
}

/**
 * The offices to show on a sheet, each with its index in the full list (edits use it) and a `future` flag.
 * Players get only started offices; the GM gets all of them.
 */
export function officesForViewer(offices, year, isGM) {
  return (offices ?? []).map((o, index) => ({ ...o, index, future: !officeStarted(o, year) }))
    .filter(o => isGM || !o.future);
}

export function currentYear() {
  try { return Number(game.settings.get(SYSTEM_ID, GAME_YEAR)) || DEFAULT_YEAR; } catch { return DEFAULT_YEAR; }
}

export function registerGameYear() {
  game.settings.register(SYSTEM_ID, GAME_YEAR, {
    name: "Current game year",
    hint: "Players see a character's offices only once this year reaches the office's first year. The GM always sees every office and the character's death.",
    scope: "world", config: true, type: Number, default: DEFAULT_YEAR,
    onChange: () => { for (const app of foundry.applications.instances?.values?.() ?? []) if (app.document?.type === "character") app.render(); },
  });
}
