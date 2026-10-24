// Who may lead a battlefield unit: weapon skill N lets a character lead units up to tier N that use that weapon;
// leading cavalry also needs Horsemanship N.

import { SKILLS } from "./config.mjs";

const skillOf = (actor, key) => {
  try { const v = actor.getSkill?.(key)?.value; if (Number.isFinite(v)) return v; } catch { /* fall through */ }
  return Number(actor.system?.skills?.[key]?.value) || 0;
};

/** { ok, reason } for `officer` (a character actor) leading a unit with this system data. */
export function officerEligibility(officer, unit) {
  if (!officer || officer.type !== "character") return { ok: false, reason: "not a character" };
  const tier = Number(unit.tier) || 1, weapon = unit.weaponSkill;
  const need = [];
  if (weapon && skillOf(officer, weapon) < tier) need.push(`${SKILLS[weapon]?.label ?? weapon} ${tier}`);
  if (unit.category === "cavalry" && skillOf(officer, "horsemanship") < tier) need.push(`Horsemanship ${tier}`);
  return need.length ? { ok: false, reason: `needs ${need.join(" and ")}` } : { ok: true, reason: "" };
}
