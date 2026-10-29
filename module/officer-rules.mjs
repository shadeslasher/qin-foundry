// Officers and their units' weapons. Since 2026-10-28 any character can lead any unit (no weapon or Horsemanship minimum);
// the officer's skill in the unit's weapon gives Attack +1 per level above 2 (engine buildRoll). A unit with two weapons
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
 *  Any character can lead any unit (David, 2026-10-28); his matching weapon skill gives the unit Attack +1 per level above 2 instead. */
export function officerEligibility(officer, unit) {
  if (!officer || officer.type !== "character") return { ok: false, reason: "not a character" };
  return { ok: true, reason: "" };
}
