// Officers and their units' weapons. Since 2026-10-28 any character can lead any unit (no weapon or Horsemanship minimum);
// the officer's skill in the unit's weapon gives Attack +1 per level above 1 (engine buildRoll; above 2 until 2026-11-03). A unit with two weapons
// (weaponSkill2, e.g. Azure Dragons' spear and bow) counts the officer's higher of the two skills.

import { SKILLS } from "./config.mjs";

const skillOf = (actor, key) => {
  try { const v = actor.getSkill?.(key)?.value; if (Number.isFinite(v)) return v; } catch { /* fall through */ }
  return Number(actor.system?.skills?.[key]?.value) || 0;
};

/** The unit's weapon skills: its main one and, for two-weapon units, the second. */
export function unitWeaponSkills(unit) {
  return [unit?.weaponSkill, unit?.weaponSkill2].filter((k, i, a) => k && a.indexOf(k) === i);
}

/** The officer's best skill among the unit's weapons: { key, value } (key is the main weapon on a tie or with none). */
export function officerWeaponSkill(officer, unit) {
  let best = { key: unit?.weaponSkill ?? "", value: 0 };
  for (const k of unitWeaponSkills(unit)) { const v = officer ? skillOf(officer, k) : 0; if (v > best.value) best = { key: k, value: v }; }
  return best;
}

/** { ok, reason } for `officer` (a character actor) leading a unit with this system data.
 *  Any character can lead any unit (David, 2026-10-28); his matching weapon skill gives the unit Attack +1 per level above 1 instead. */
export function officerEligibility(officer, unit, unitId = null) {
  if (!officer || officer.type !== "character") return { ok: false, reason: "not a character" };
  // the one-unit check is for choosing an officer (pickers pass the unit's id); in battle the unit is a token copy
  // that would clash with its own actor, so the battle passes no id and skips it
  const other = unitId ? playerOfficerConflict(officer, unitId) : null;
  if (other) return { ok: false, reason: `leads ${other.name}` };
  return { ok: true, reason: "" };
}

/** Does a player own this character? (Not counting the GM.) */
export function playerOwned(officer) {
  const users = globalThis.game?.users; if (!users) return false;
  return (users.contents ?? [...users]).some(u => !u.isGM && officer?.testUserPermission?.(u, "OWNER"));
}
/**
 * A player's officer leads one unit at a time (David, 2026-11-01): the other unit he already leads, or null.
 * GM-only characters (NPC officers) can still lead several.
 */
export function playerOfficerConflict(officer, unitId) {
  if (!officer || officer.type !== "character" || !playerOwned(officer)) return null;
  return (globalThis.game?.actors?.contents ?? []).find(a => a.type === "unit" && a.id !== unitId && a.system?.officer === officer.uuid) ?? null;
}

/** Refuse a change that gives a player's officer a second unit (whatever window it comes from). */
export function registerOfficerLimit() {
  const check = (doc, officerUuid) => {
    if (!officerUuid) return;
    let off = null; try { off = fromUuidSync(officerUuid); } catch { off = null; }
    const other = playerOfficerConflict(off, doc.id);
    if (!other) return;
    ui.notifications.warn(`${off.name} already leads ${other.name}. A player's officer can lead only one unit; take him off that unit first.`);
    return false;
  };
  Hooks.on("preUpdateActor", (doc, change) => {
    if (doc.type !== "unit") return;
    const v = foundry.utils.getProperty(change, "system.officer");
    if (v !== undefined) return check(doc, v);
  });
  Hooks.on("preCreateActor", (doc, data) => { if (doc.type === "unit") return check(doc, foundry.utils.getProperty(data, "system.officer")); });
}
