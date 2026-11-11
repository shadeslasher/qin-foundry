// Which units a battlefield active touched (David, 2026-11-11): pure, for the activation animation.
/** The other units an active just put a buff or debuff on (by the effect's name: the skill's), for its animation. */
export function touchedBy(s, before, skill, self) {
  return s.units.filter(u => u.id !== self && (u.fx?.buffs ?? []).some(b => b.name === skill) && !(before[u.id]?.buffs ?? []).includes(skill)).map(u => u.id);
}
