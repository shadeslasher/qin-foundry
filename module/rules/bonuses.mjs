// Structured bonuses on signature (unique) skills (David, 2026-11-05). Pure: no Foundry dependencies.
// A bonus is { stat, value, aspect, mode, condition, label } on a signature item's system.bonuses.
import { part } from "./sources.mjs";

export const BONUS_STATS = {
  pd: "Passive Defense",
  ad: "Active Defense Tests",
  attack: "Attack Tests",
  damage: "Damage",
  attackersPenalty: "Attackers take (on Attack Tests against him)",
  firstHitReduction: "First hit each round does less damage",
  hitReduction: "Every hit does less damage",
  initiative: "Initiative",
};
export const BONUS_SHORT = {
  pd: "Passive Defense", ad: "Active Defense", attack: "Attack", damage: "damage",
  attackersPenalty: "attackers", firstHitReduction: "first hit each round", hitReduction: "every hit", initiative: "Initiative",
};
export const BONUS_MODES = { always: "Always on", situational: "Situational" };
const ASPECT_KEYS = ["metal", "water", "fire", "wood", "earth"];
const ASPECT_LABEL = { metal: "Metal", water: "Water", fire: "Fire", wood: "Wood", earth: "Earth" };

/** Stats where the number is taken away (from damage, or from the attacker). */
export const REDUCING_STATS = new Set(["attackersPenalty", "firstHitReduction", "hitReduction"]);

export function normalizeBonus(b = {}, fallbackLabel = "") {
  const stat = BONUS_STATS[b.stat] ? b.stat : "pd";
  return {
    stat,
    value: Math.trunc(Number(b.value) || 0),
    aspect: ASPECT_KEYS.includes(b.aspect) ? b.aspect : "",
    mode: b.mode === "situational" ? "situational" : "always",
    condition: String(b.condition ?? "").trim(),
    label: String(b.label ?? "").trim() || fallbackLabel,
  };
}

/** The bonus's number: its value, plus an Aspect when it names one ("reduced by his Metal"). */
export function bonusValue(b, aspects = {}) {
  return (Number(b?.value) || 0) + (b?.aspect ? Number(aspects?.[b.aspect]) || 0 : 0);
}

/** "Passive Defense +1", "first hit each round −Metal 5", "+2 damage". */
export function describeBonus(b, aspects = {}) {
  const v = bonusValue(b, aspects);
  const asp = b.aspect ? `${ASPECT_LABEL[b.aspect]}${b.value ? (b.value > 0 ? ` +${b.value}` : ` −${-b.value}`) : ""}` : "";
  if (REDUCING_STATS.has(b.stat)) return `${BONUS_SHORT[b.stat]} −${asp ? `${asp} (${v})` : v}`;
  const sign = v < 0 ? "−" : "+";
  return `${BONUS_SHORT[b.stat]} ${sign}${asp ? `${asp} (${Math.abs(v)})` : Math.abs(v)}`;
}

/** Signature items whose bonuses are standing (the in-person Passive slot): actives apply only when used, battle slots belong to the battlefield. */
export function standingSignature(item) {
  if (item?.type !== "signature") return false;
  const slot = String(item.system?.slot ?? "passive");
  return !/^active\d?$/.test(slot) && !/^battle/.test(slot);
}

/** Bonus sources on an actor's items: [{ id, name, bonuses }]. */
export function bonusSourcesOf(items) {
  const out = [];
  for (const i of items ?? []) if (standingSignature(i) && i.system?.bonuses?.length) out.push({ id: i.id ?? i._id ?? i.name, name: i.name, bonuses: i.system.bonuses });
  return out;
}

/**
 * Flatten bonus sources into a list of resolved bonuses:
 * [{ key, stat, value, mode, condition, label, sourceId, sourceName, bonus }]. key = "<sourceId>:<index>" (for tick boxes).
 */
export function collectBonuses(sources, { aspects = {} } = {}) {
  const out = [];
  for (const s of sources ?? []) {
    (s.bonuses ?? []).forEach((raw, i) => {
      const b = normalizeBonus(raw, s.name);
      out.push({ key: `${s.id}:${i}`, stat: b.stat, value: bonusValue(b, aspects), mode: b.mode, condition: b.condition, label: b.label,
        sourceId: s.id, sourceName: s.name, bonus: b, text: describeBonus(b, aspects), fromEffect: !!s.fromEffect });
    });
  }
  return out;
}

/** { [stat]: { always: [...], situational: [...], alwaysTotal } } for every stat. */
export function bonusesByStat(list) {
  const out = {};
  for (const stat of Object.keys(BONUS_STATS)) out[stat] = { always: [], situational: [], alwaysTotal: 0 };
  for (const b of list ?? []) {
    const slot = out[b.stat];
    if (!slot) continue;
    slot[b.mode === "situational" ? "situational" : "always"].push(b);
    if (b.mode !== "situational") slot.alwaysTotal += b.value;
  }
  return out;
}

/**
 * Bonuses for one stat as tagged parts: always-on ones, plus situational ones that are ticked.
 * ticked = { [key]: true }. Returns { parts, total, always, situational (each with .ticked) }.
 */
export function bonusParts(list, stat, { ticked = {}, sign = 1, prefix = "" } = {}) {
  const always = [], situational = [], parts = [];
  for (const b of list ?? []) {
    if (b.stat !== stat) continue;
    if (b.mode === "situational") {
      const on = !!ticked[b.key];
      situational.push({ ...b, ticked: on });
      if (on) parts.push(part("unique", `${prefix}${b.label}${b.condition ? ` (${b.condition})` : ""}`, sign * b.value, { situational: true, key: b.key }));
    } else {
      always.push(b);
      parts.push(part("unique", `${prefix}${b.label}`, sign * b.value, { key: b.key }));
    }
  }
  return { parts, total: parts.reduce((t, p) => t + p.value, 0), always, situational };
}

/**
 * Passive Defense with every part tagged: Water + Wood + 2, sheet bonus, armour modifiers, unique bonuses (always on,
 * plus ticked situational ones when `ticked` is given), and timed Tao effects ({ label, value }).
 */
export function pdBreakdown({ aspects, pdBonus = 0, armor = [], bonuses = [], ticked = null, tao = [] }) {
  const parts = [
    part("aspect", "Water", aspects?.water ?? 0, { aspect: "water" }),
    part("aspect", "Wood", aspects?.wood ?? 0, { aspect: "wood" }),
    part("base", "Book rule", 2),
  ];
  if (pdBonus) parts.push(part("modifier", "Sheet bonus", pdBonus));
  for (const a of armor) if (a.pdModifier) parts.push(part("gear", a.name, a.pdModifier));
  const u = bonusParts(bonuses, "pd", { ticked: ticked ?? {} });
  parts.push(...(ticked ? u.parts : u.parts.filter(p => !p.situational)));
  for (const t of tao) if (t.value) parts.push(part("tao", t.label, t.value));
  const total = parts.reduce((s, p) => s + p.value, 0);
  const extra = parts.filter(p => !["aspect", "base"].includes(p.kind)).reduce((s, p) => s + p.value, 0);
  return { parts, total, extra, situational: u.situational };
}
