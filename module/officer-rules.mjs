// Who may lead a battlefield unit: weapon skill N lets a character lead units up to tier N that use that weapon;
// leading cavalry also needs Horsemanship N. A unit with two weapons (weaponSkill2, e.g. Azure Dragons' spear and bow)
// counts the officer's higher of the two skills (David, 2026-10-28).

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

/** { ok, reason } for `officer` (a character actor) leading a unit with this system data. */
export function officerEligibility(officer, unit) {
  if (!officer || officer.type !== "character") return { ok: false, reason: "not a character" };
  const tier = Number(unit.tier) || 1, weapons = unitWeaponSkills(unit);
  const need = [];
  if (weapons.length && officerWeaponSkill(officer, unit).value < tier) need.push(weapons.map(w => `${SKILLS[w]?.label ?? w} ${tier}`).join(" or "));
  if (unit.category === "cavalry" && skillOf(officer, "horsemanship") < tier) need.push(`Horsemanship ${tier}`);
  return need.length ? { ok: false, reason: `needs ${need.join(" and ")}` } : { ok: true, reason: "" };
}
