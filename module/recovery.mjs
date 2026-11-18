/**
 * Unit recovery between battles (David, 2026-11-18).
 *
 * - Units recover each day while the party is stopped and stationed inside a location
 *   owned by their faction or by an ally.
 * - Base: 20% of max health a day (full in 5 days) in a city of the unit's own faction.
 * - Non-city locations ×0.5. Allied locations another ×0.5.
 * - City prosperity: Low ×1, Medium ×1.5, High ×2. Non-city locations get no prosperity bonus.
 * - Cost: 1 XP per 1% of max health recovered (a full recovery is always 100 XP).
 *   XP loss can drop a unit below its level; trait choices are kept (they only unlock again).
 *   Units with no XP left still recover.
 * - Defeated units never recover.
 */
export const BASE_RATE = 0.2;
export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 5;

const PROSPERITY = { low: 1, mid: 1.5, medium: 1.5, high: 2 };

/** Share of max health recovered per day. owner: "faction" | "allied" | anything else (none). */
export function recoveryRate({ owner, city = false, prosperity = "low" } = {}) {
  if (owner !== "faction" && owner !== "allied") return 0;
  let r = BASE_RATE;
  if (!city) r *= 0.5;
  else r *= PROSPERITY[String(prosperity ?? "low").toLowerCase()] ?? 1;
  if (owner === "allied") r *= 0.5;
  return Math.round(r * 1e6) / 1e6;
}

/** Total XP as one number: (level − 1) × 100 + xp. */
export const totalXp = (level, xp) => (Math.max(1, level || 1) - 1) * XP_PER_LEVEL + Math.max(0, xp || 0);

/** Level and XP from a total, after a loss (level 5 keeps an empty bar). */
export function fromTotalXp(total) {
  total = Math.max(0, total);
  let level = Math.min(MAX_LEVEL, Math.floor(total / XP_PER_LEVEL) + 1);
  let xp = level >= MAX_LEVEL ? 0 : Math.floor(total - (level - 1) * XP_PER_LEVEL);
  return { level, xp };
}

/**
 * One or more days of recovery for a unit.
 * unit: { men, maxMen, level, xp, status, carryMen, carryXp } (carries are fractions left from earlier days).
 * Returns null when nothing changes, else { men, level, xp, carryMen, carryXp, healed, xpLost }.
 */
export function recoverDays(unit, rate, days = 1) {
  const max = unit.maxMen || 0, men = unit.men || 0;
  if (!(rate > 0) || days <= 0 || unit.status === "defeated" || max <= 0 || men >= max) return null;
  const want = (unit.carryMen || 0) + max * rate * days;
  const healed = Math.min(max - men, Math.floor(want + 1e-9));
  const carryMen = men + healed >= max ? 0 : want - healed;
  if (healed <= 0) return { men, level: unit.level || 1, xp: unit.xp || 0, carryMen, carryXp: unit.carryXp || 0, healed: 0, xpLost: 0 };
  const loseExact = (unit.carryXp || 0) + (100 * healed) / max;   // 1 XP per 1% of max health
  const before = totalXp(unit.level, unit.xp);
  const xpLost = Math.min(before, Math.floor(loseExact + 1e-9));
  const carryXp = before - xpLost <= 0 ? 0 : loseExact - xpLost;  // no XP left: still recovers, nothing owed
  const { level, xp } = fromTotalXp(before - xpLost);
  return { men: men + healed, level, xp, carryMen, carryXp, healed, xpLost };
}

/** Actor update data for a day of recovery (null if nothing to do). */
export function recoveryUpdate(actor, rate, days = 1) {
  const s = actor.system ?? {}, f = actor.flags?.qin?.recovery ?? {};
  const r = recoverDays({ men: s.men?.value, maxMen: s.men?.max, level: s.level, xp: s.xp?.value, status: s.status,
    carryMen: f.men, carryXp: f.xp }, rate, days);
  if (!r) return null;
  return { update: { "system.men.value": r.men, "system.level": r.level, "system.xp.value": r.xp,
    "flags.qin.recovery": { men: r.carryMen, xp: r.carryXp } }, ...r };
}

/**
 * Recover a set of unit actors (GM client). place: { owner, city, prosperity, name }.
 * Posts one GM-whispered chat line listing who recovered, XP lost and any levels lost.
 * Returns the list of results.
 */
export async function recoverActors(actors, place, { days = 1, chat = true } = {}) {
  const rate = recoveryRate(place);
  const out = [];
  for (const a of actors ?? []) {
    if (a?.type !== "unit") continue;
    const r = recoveryUpdate(a, rate, days);
    if (!r) continue;
    const lvBefore = a.system.level ?? 1;
    await a.update(r.update);
    if (r.healed > 0) out.push({ actor: a, ...r, levelsLost: lvBefore - r.level });
  }
  if (chat && out.length && globalThis.ChatMessage) {
    const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const lines = out.map(o => `<li><b>${esc(o.actor.name)}</b> +${o.healed} health (${o.men}/${o.actor.system.men?.max}), −${o.xpLost} XP${o.levelsLost > 0 ? `, down to level ${o.level}` : ""}</li>`);
    await ChatMessage.create({ content: `<b>Units recover${place?.name ? ` in ${esc(place.name)}` : ""}</b> (${Math.round(rate * 1000) / 10}% a day)<ul>${lines.join("")}</ul>`,
      whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [] });
  }
  return out;
}
