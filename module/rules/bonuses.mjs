// Structured bonuses on signature (unique) skills (David, 2026-11-05). Pure: no Foundry dependencies.
// A bonus is { stat, value, aspect, mode, condition, label } on a signature item's system.bonuses.
import { part } from "./sources.mjs";
import { normalizeStack, stackSteps } from "./stacks.mjs";
import { SKILLS } from "../config.mjs";

export const BONUS_STATS = {
  pd: "Passive Defense",
  ad: "Active Defense Tests",
  attack: "Attack Tests",
  damage: "Damage",
  attackersPenalty: "Attackers take (on Attack Tests against him)",
  firstHitReduction: "First hit each round does less damage",
  hitReduction: "Every hit does less damage",
  initiative: "Initiative",
  targetAd: "Opponents' Active Defense against his attacks",
  armorPierce: "Target's armour counts less against his hits",
  skillTest: "Tests with given skills",
  resistTest: "Tests to resist (fear, poison, ...)",
};
export const BONUS_SHORT = {
  pd: "Passive Defense", ad: "Active Defense", attack: "Attack", damage: "damage",
  attackersPenalty: "attackers", firstHitReduction: "first hit each round", hitReduction: "every hit", initiative: "Initiative",
  targetAd: "opponents' Active Defense", armorPierce: "target's armour", skillTest: "Tests",
  resistTest: "resist rolls",
};
export const BONUS_MODES = { always: "Always on", situational: "Situational" };
const ASPECT_KEYS = ["metal", "water", "fire", "wood", "earth"];
const ASPECT_LABEL = { metal: "Metal", water: "Water", fire: "Fire", wood: "Wood", earth: "Earth" };

/** Stats where the number is taken away (from damage, or from the attacker). */
export const REDUCING_STATS = new Set(["attackersPenalty", "firstHitReduction", "hitReduction", "targetAd", "armorPierce"]);

const SKILL_BY_NAME = new Map();
for (const [k, v] of Object.entries(SKILLS)) {
  SKILL_BY_NAME.set(k.toLowerCase(), k);
  SKILL_BY_NAME.set(v.label.toLowerCase(), k);
  SKILL_BY_NAME.set(v.label.replace(/\s*\(.*\)\s*$/, "").toLowerCase(), k);
}

/**
 * Skill keys for a skillTest bonus (schema v2.1 §4): an array or a comma list of keys or names ("intimidation",
 * "Art of War", "Jianshu"). Built-in skills become their keys; anything else (a custom skill item's id) is kept as is.
 */
export function parseSkillList(v) {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,;]/);
  const out = [];
  for (const r of raw) {
    const t = String(r ?? "").trim();
    if (!t) continue;
    const k = SKILL_BY_NAME.get(t.toLowerCase()) ?? SKILL_BY_NAME.get(t.replace(/[\s-]+/g, "").toLowerCase()) ?? t;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
const skillName = (k) => SKILLS[k]?.label.replace(/\s*\(.*\)\s*$/, "") ?? k;
/** "Intimidation", "Eloquence / Diplomacy". */
export const skillListText = (skills) => (skills ?? []).map(skillName).join(" / ");

/**
 * resistTest tags (schema v2.2): what a resist bonus is against, and what an effect is (effect tags).
 * Lower-case; Intimidation and Seduction are skill names, so they are written with a capital.
 */
export const RESIST_TAGS = ["fear", "intimidation", "provocation", "persuasion", "bribery", "threats", "deception", "interrogation",
  "despair", "coercion", "seduction", "poison", "illness", "fatigue", "pain", "magic"];
const RESIST_TAG_LABEL = { intimidation: "Intimidation", seduction: "Seduction" };
const RESIST_SYNONYMS = { fears: "fear", intimidate: "intimidation", threat: "threats", bribe: "bribery", bribes: "bribery",
  lies: "deception", lying: "deception", lie: "deception", poisons: "poison", disease: "illness", diseases: "illness", sickness: "illness",
  illnesses: "illness", tiredness: "fatigue", exhaustion: "fatigue", charm: "seduction", provocations: "provocation", sorcery: "magic" };

/** resistTest `against` / effect `tags`: an array or a comma list, lower-cased, de-duplicated ("Fear, intimidation"). Unknown words are kept (they just never match). */
export function parseResistTags(v) {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,;]/);
  const out = [];
  for (const r of raw) {
    let t = String(r ?? "").trim().toLowerCase();
    if (!t) continue;
    t = RESIST_SYNONYMS[t] ?? t;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
/** "fear, Intimidation". */
export const resistTagsText = (tags) => (tags ?? []).map(t => RESIST_TAG_LABEL[t] ?? t).join(", ");

export function normalizeBonus(b = {}, fallbackLabel = "") {
  const stat = BONUS_STATS[b.stat] ? b.stat : "pd";
  const extra = stat === "skillTest" ? { skills: parseSkillList(b.skills) } : stat === "resistTest" ? { against: parseResistTags(b.against) } : {};
  return {
    stat,
    value: Math.trunc(Number(b.value) || 0),
    aspect: ASPECT_KEYS.includes(b.aspect) ? b.aspect : "",
    mode: b.mode === "situational" ? "situational" : "always",
    condition: String(b.condition ?? "").trim(),
    label: String(b.label ?? "").trim() || fallbackLabel,
    stack: normalizeStack(b.stack, b),
    vsSource: !!b.vsSource,
    ...extra,
  };
}

/** True when the bonus is a skillTest bonus covering `skill` (a skill key). */
export function appliesToSkill(b, skill) {
  if (!skill || (b?.stat ?? b?.bonus?.stat) !== "skillTest") return false;
  const list = b.skills ?? b.bonus?.skills ?? [];
  return parseSkillList(list).includes(skill);
}

/** The bonus's number: its value, plus an Aspect when it names one ("reduced by his Metal"). */
export function bonusValue(b, aspects = {}) {
  return (Number(b?.value) || 0) + (b?.aspect ? Number(aspects?.[b.aspect]) || 0 : 0);
}

/** "Passive Defense +1", "first hit each round −Metal 5", "+2 damage". `steps` (growing bonuses) multiplies the value. */
export function describeBonus(b, aspects = {}, steps = null) {
  // resistTest with tags: "+2 to resist fear, Intimidation"; without: "resist rolls +2" (every resist roll)
  const against = b.stat === "resistTest" ? parseResistTags(b.against) : [];
  if (against.length) {
    const tail = ` to resist ${resistTagsText(against)}`;
    const v = bonusValue(b, aspects) * (steps ?? 1), sign = v < 0 ? "−" : "+";
    const asp = b.aspect && steps == null ? `${ASPECT_LABEL[b.aspect]}${b.value ? (b.value > 0 ? ` +${b.value}` : ` −${-b.value}`) : ""} (${Math.abs(v)})` : Math.abs(v);
    return `${sign}${asp}${tail}${steps != null ? ` (${steps}/${b.stack?.max ?? "?"})` : ""}`;
  }
  const short = b.stat === "skillTest" ? `${skillListText(parseSkillList(b.skills)) || "Skill"} Tests` : BONUS_SHORT[b.stat];
  if (steps != null) {
    const per = bonusValue(b, aspects), v = per * steps, sign = REDUCING_STATS.has(b.stat) ? "−" : v < 0 ? "−" : "+";
    return `${short} ${sign}${Math.abs(v)} (${steps}/${b.stack?.max ?? "?"})`;
  }
  const v = bonusValue(b, aspects);
  const asp = b.aspect ? `${ASPECT_LABEL[b.aspect]}${b.value ? (b.value > 0 ? ` +${b.value}` : ` −${-b.value}`) : ""}` : "";
  if (REDUCING_STATS.has(b.stat)) return `${short} −${asp ? `${asp} (${v})` : v}`;
  const sign = v < 0 ? "−" : "+";
  return `${short} ${sign}${asp ? `${asp} (${Math.abs(v)})` : Math.abs(v)}`;
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
 * [{ key, stat, value, mode, condition, label, sourceId, sourceName, bonus, stack, steps, perStep, vsSourceActor }].
 * key = "<sourceId>:<index>" (for tick boxes and growing-bonus steps; dots become underscores).
 * Growing bonuses (stack) are worth value × steps: steps from `stacks` ([{ key, steps }]), or for "opponentsEngaged"
 * from `engaged` (opponents in close combat; null = not known here, counts 0). Their label carries "(steps/max)".
 * Sources applied by another actor's effect carry sourceActor (a uuid): their vsSource bonuses only count on rolls
 * involving that actor (see bonusesVs).
 */
export function collectBonuses(sources, { aspects = {}, stacks = [], engaged = null } = {}) {
  const out = [];
  for (const s of sources ?? []) {
    (s.bonuses ?? []).forEach((raw, i) => {
      const b = normalizeBonus(raw, s.name);
      const key = `${s.id}:${i}`.replace(/\./g, "_");
      const per = bonusValue(b, aspects);
      const steps = b.stack ? stackSteps(b.stack, stacks, key, { engaged }) : null;
      out.push({ key, stat: b.stat, value: b.stack ? per * steps : per, mode: b.mode, condition: b.condition,
        label: b.stack ? `${b.label} (${steps}/${b.stack.max})` : b.label, baseLabel: b.label,
        sourceId: s.id, sourceName: s.name, bonus: b, text: describeBonus(b, aspects, steps), fromEffect: !!s.fromEffect,
        stack: b.stack, steps, perStep: per, ...(b.skills ? { skills: b.skills } : {}), ...(b.against ? { against: b.against } : {}),
        vsSourceActor: b.vsSource && s.sourceActor ? s.sourceActor : null, sourceActorName: s.sourceActorName ?? "" });
    });
  }
  return out;
}

/**
 * The bonuses that count on a roll involving `other` (an actor uuid, or null for no one in particular): every bonus,
 * except vsSource ones from an effect, which count only against the actor who applied them.
 */
export function bonusesVs(list, other = null) {
  return (list ?? []).filter(b => !b.vsSourceActor || (other && b.vsSourceActor === other));
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
 * skillTest bonuses (schema v2.1 §4) on a Test with `skill`, as tagged parts: always-on ones, plus situational ones
 * that are ticked (ticked = { [key]: true }). Martial skills are left to the attack and defense rolls' own stats, so
 * pass `martial: true` to get nothing. Returns { parts, total, always, situational (each with .ticked) }.
 */
export function skillTestParts(list, skill, { ticked = {}, martial = false } = {}) {
  if (martial || !skill) return { parts: [], total: 0, always: [], situational: [] };
  return bonusParts((list ?? []).filter(b => appliesToSkill(b, skill)), "skillTest", { ticked });
}

/** Every skillTest bonus on the list, for dialogs where the skill is still to be chosen. */
export const skillTestBonuses = (list) => (list ?? []).filter(b => b.stat === "skillTest");

/** Every resistTest bonus on the list (schema v2.2). */
export const resistTestBonuses = (list) => (list ?? []).filter(b => b.stat === "resistTest");

/** The tags of a resistTest bonus that are in `tags` (an effect's tags). */
export function resistMatches(b, tags) {
  const against = parseResistTags(b?.against ?? b?.bonus?.against);
  const t = parseResistTags(tags);
  return against.filter(x => t.includes(x));
}

/**
 * resistTest bonuses on a resist roll (schema v2.2), as tagged parts.
 * tags: the effect's tags (effectTags), or null for a plain Resistance roll with nothing named.
 * Against an effect: always-on bonuses that are untagged, or share a tag with it, apply automatically
 * ("Unflinching (vs fear)"); situational ones and always-on ones that don't match are offered as tick boxes,
 * ticked by default when they share a tag. A plain Resistance roll offers every one, ticking the untagged
 * always-on ones. The Combat panel's ticks (panelTicked = { key: true }) also tick by default. ticked = { key: bool }
 * (a dialog's answer) overrides the defaults; null = the defaults.
 * Returns { parts, total, auto, offered: [{ ...bonus, matched, ticked, text }] }.
 */
export function resistParts(list, tags = null, { ticked = null, panelTicked = {} } = {}) {
  const auto = [], offered = [], parts = [];
  const named = tags != null;
  for (const b of resistTestBonuses(list)) {
    const against = parseResistTags(b.against);
    const matched = named ? resistMatches(b, tags) : [];
    const vs = matched.length ? ` (vs ${resistTagsText(matched)})` : "";
    if (named && b.mode !== "situational" && (!against.length || matched.length)) {
      auto.push({ ...b, matched });
      parts.push(part("unique", `${b.label}${vs}`, b.value, { key: b.key }));
      continue;
    }
    const def = named ? matched.length > 0 || !!panelTicked[b.key] : (b.mode !== "situational" && !against.length) || !!panelTicked[b.key];
    const on = ticked ? !!ticked[b.key] : def;
    offered.push({ ...b, matched, ticked: on, byDefault: def });
    if (on) parts.push(part("unique", `${b.label}${vs || (b.condition ? ` (${b.condition})` : "")}`, b.value, { situational: true, key: b.key }));
  }
  return { parts, total: parts.reduce((t, p) => t + p.value, 0), auto, offered };
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

/**
 * What an attacker's bonuses do to the other side (schema v2): targetAd (the defender's Active Defense −N) and
 * armorPierce (the target's armour counts N less, added to a technique's pierce). Always-on bonuses, ticked
 * situational ones (ticked = { key: true }) and an active's bonuses (activeList, labelled "<name> (active)").
 * Returns { targetAd: [{ label, value, situational }], targetAdTotal, pierceParts: [{ label, value, situational, technique }], pierce }.
 */
export function attackerSideBonuses(list, { ticked = {}, activeList = [], activeName = "", techniquePierce = 0, techniqueName = "" } = {}) {
  const targetAd = [], pierceParts = [];
  const side = { targetAd, armorPierce: pierceParts };
  if (techniquePierce) pierceParts.push({ label: `${techniqueName || "Technique"} (technique)`, value: techniquePierce, situational: false, technique: true });
  for (const b of list ?? []) {
    if (!side[b.stat] || !b.value) continue;
    const sit = b.mode === "situational";
    if (sit && !ticked[b.key]) continue;
    side[b.stat].push({ label: `${b.label}${sit && b.condition ? ` (${b.condition})` : ""}`, value: b.value, situational: sit });
  }
  for (const b of activeList ?? []) if (side[b.stat] && b.value) side[b.stat].push({ label: `${activeName} (active)`, value: b.value, situational: false });
  const sum = (a) => a.reduce((t, p) => t + p.value, 0);
  return { targetAd, targetAdTotal: sum(targetAd), pierceParts, pierce: sum(pierceParts) };
}

/** The attacker's targetAd entries as tagged parts on the defender's Active Defense (negative). */
export function targetAdParts(targetAd, attackerName = "") {
  return (targetAd ?? []).map(t => part("unique", `Attacker${attackerName ? `: ${attackerName}` : ""}, ${t.label}`, -Math.abs(Number(t.value) || 0), { situational: !!t.situational }));
}
