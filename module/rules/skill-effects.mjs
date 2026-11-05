// Unique-skill effects on others (David, 2026-11-05, skill-effects schema v2 §2). Pure: no Foundry dependencies.
// An active's `effect` = { target, test, onFail, onSuccess, duration, note }. Using the active posts an effect card;
// targets take it (allies) or resist it (enemies). What lands is a timed effect on the target's combat state.
import { normalizeBonus, collectBonuses, parseResistTags, parseSkillList } from "./bonuses.mjs";
import { part, sumParts } from "./sources.mjs";

export const EFFECT_TARGETS = { self: "Self", ally: "One ally", allies: "Allies", enemy: "One enemy", enemies: "Enemies" };
const ASPECT_KEYS = ["metal", "water", "fire", "wood", "earth"];
const ASPECT_LABEL = { metal: "Metal", water: "Water", fire: "Fire", wood: "Wood", earth: "Earth" };

const side = (s) => {
  if (!s || typeof s !== "object") return null;
  const aspect = s.aspect === "resistance" ? "resistance" : ASPECT_KEYS.includes(s.aspect) ? s.aspect : "";
  return aspect ? { aspect, skill: aspect === "resistance" ? "" : String(s.skill ?? "") } : null;
};

/** Normalized effect, or null when the active has none. */
export function normalizeEffect(e) {
  if (!e || typeof e !== "object" || !EFFECT_TARGETS[e.target]) return null;
  const user = side(e.test?.user), resist = side(e.test?.resist);
  const d = e.duration ?? {};
  const duration = d.scene ? { scene: true } : d.fight ? { fight: true } : d.round ? { round: true }
    : { rounds: Math.max(1, Math.trunc(Number(d.rounds) || 0) || 1) };
  return {
    target: e.target,
    test: user && resist ? { user, resist } : null,
    onFail: (e.onFail ?? []).map(b => normalizeBonus(b)),
    onSuccess: (e.onSuccess ?? []).map(b => normalizeBonus(b)),
    duration,
    note: String(e.note ?? "").trim(),
    // Schema v2.2: what the effect is, for resistTest bonuses (empty = derived from the Test's skill, see effectTags)
    tags: parseResistTags(e.tags),
  };
}

/**
 * The tags derived from the user's Test skill when an effect names none (schema v2.2). Skill keys from config.mjs;
 * anything not listed (and pure Aspect Tests) has no tags.
 */
export const SKILL_EFFECT_TAGS = {
  intimidation: ["intimidation", "fear", "threats"],
  eloquence: ["persuasion", "provocation"],
  diplomacy: ["persuasion", "provocation"],
  seduction: ["seduction", "persuasion"],
  acting: ["deception"],
  stealth: ["deception"],
  theft: ["deception"],
  medicine: ["poison"],
  herbalism: ["poison"],
  externalAlchemy: ["poison"],
};

/** An effect's tags (raw or normalized): its own `tags`, else the ones its Test's user skill implies. Pure. */
export function effectTags(eff) {
  const own = parseResistTags(eff?.tags);
  if (own.length) return own;
  const skill = eff?.test?.user?.skill;
  if (!skill) return [];
  const key = parseSkillList([skill])[0];
  return [...(SKILL_EFFECT_TAGS[key] ?? [])];
}

export const isFriendlyTarget = (eff) => ["self", "ally", "allies"].includes(eff?.target);

/**
 * The effect card's buttons (David, 2026-11-05: buffs are GM-only). Enemy effects with a Test: "Resist" (a player
 * rolls their own character's resist; the GM picks who resists). Everything else (self / ally / allies, and enemy
 * effects without a Test): one GM-only "Apply" that opens the scene picker. [{ action, label, gmOnly }].
 */
export function effectButtons(eff) {
  if (!eff) return [];
  if (!isFriendlyTarget(eff) && eff.test) return [{ action: "effectResist", label: "Resist", gmOnly: false }];
  return [{ action: "effectApply", label: "Apply", gmOnly: true }];
}

/** Older cards' buttons ("Take it", "Apply to me", "Apply (GM)") are all the GM's Apply now. */
export const effectAction = (action) => (action === "effectResist" ? "effectResist" : "effectApply");

/**
 * May a player (not the GM) land this effect? Only the outcome of their own resist roll against an enemy effect
 * with a Test. via = "resist" | "apply".
 */
export const playerMayLand = (eff, via) => via === "resist" && !!eff?.test && !isFriendlyTarget(eff);

/** "2 rounds", "until the end of this round", "this scene", "the rest of the fight". */
export function durationText(duration) {
  if (!duration) return "";
  if (duration.scene) return "this scene";
  if (duration.fight) return "the rest of the fight";
  if (duration.round) return "until the end of this round";
  const n = Number(duration.rounds) || 1;
  return `${n} round${n === 1 ? "" : "s"}`;
}

/** "Fire + Intimidation vs Resistance". skillLabel(key) names a skill key. */
export function testText(test, skillLabel = (k) => k) {
  if (!test) return "";
  const s = (x) => x.aspect === "resistance" ? "Resistance" : `${ASPECT_LABEL[x.aspect]}${x.skill ? ` + ${skillLabel(x.skill)}` : ""}`;
  return `${s(test.user)} vs ${s(test.resist)}`;
}

/**
 * The timed-effect fields for a duration, started now (fight = { id, round } or null), in the shape roundsLeft
 * understands: { combat, round, rounds } or { combat, round, restOfFight }. Outside a fight it runs until ended.
 */
export function durationFields(duration, fight) {
  const base = { combat: fight?.id ?? "", round: fight?.round ?? 0 };
  if (duration?.scene || duration?.fight) return { ...base, rounds: 0, restOfFight: true, scene: !!duration.scene };
  if (duration?.round) return { ...base, rounds: 1 };
  return { ...base, rounds: Math.max(1, Number(duration?.rounds) || 1) };
}

/**
 * Who wins a Test between the user's total and a target's resist total: "success" (the target resists) or "fail".
 * Ties go to the target unless tiesTo = "user". A critical failure always loses.
 */
export function resistOutcome({ userTotal, resistTotal, userCritFail = false, resistCritFail = false, tiesTo = "target" }) {
  if (userCritFail && !resistCritFail) return "success";
  if (resistCritFail) return "fail";
  if (resistTotal > userTotal) return "success";
  if (resistTotal < userTotal) return "fail";
  return tiesTo === "user" ? "fail" : "success";
}

/**
 * What lands on a target for an outcome ("fail" = lost the Test or there was none, "success" = resisted):
 * { bonuses, note, applies }. A resisted effect with no onSuccess does nothing.
 */
export function outcomeFor(eff, outcome) {
  if (outcome === "success") {
    const b = eff?.onSuccess ?? [];
    return { bonuses: b, note: b.length ? "resisted: reduced effect" : "", applies: b.length > 0 };
  }
  return { bonuses: eff?.onFail ?? [], note: eff?.note ?? "", applies: true };
}

/**
 * The entry put on the target's combat state (flags.qin.combatState.effects) for an outcome.
 * src = { itemId, itemName, actorUuid, actorName, messageId }. Same skill from the same user replaces the old entry (same key).
 */
export function appliedEffect(eff, outcome, src, fight, id) {
  const o = outcomeFor(eff, outcome);
  if (!o.applies) return null;
  const sourceId = `fx-${String(src.itemId ?? "x")}-${String(src.actorUuid ?? "").replace(/[^\w]/g, "")}`.slice(0, 80);
  return {
    id, key: sourceId, sourceId, kind: "skillEffect", label: src.itemName, source: src.actorName ?? "",
    sourceActor: src.actorUuid ?? "", messageId: src.messageId ?? "", outcome, note: o.note, bonuses: o.bonuses.map(b => ({ ...b })),
    ...durationFields(eff.duration, fight),
  };
}

/** Put an applied effect on a list of effects, replacing an earlier one with the same key. */
export function withEffect(effects, entry) {
  if (!entry) return [...(effects ?? [])];
  return [...(effects ?? []).filter(e => e.key !== entry.key), entry];
}

/** Text for an applied effect: "Attack −3 against Zhang Liao, Active Defense −2 against Zhang Liao". Notes-only: the note. */
export function appliedText(entry, aspects = {}) {
  const list = collectBonuses([{ id: entry.sourceId ?? entry.id, name: entry.label, bonuses: entry.bonuses ?? [] }], { aspects });
  const who = entry.source ? ` against ${entry.source}` : " against the user";
  const t = list.map((b, i) => `${b.text}${entry.bonuses[i]?.vsSource ? who : ""}${b.condition ? ` (${b.condition})` : ""}`).join(", ");
  return [t, entry.note].filter(Boolean).join(" · ");
}

/**
 * A roll's tagged parts for one side of an effect's Test. side = { aspect, skill }; who = { aspects, resistance,
 * skill: { label, value } | null }. Returns [parts without dice].
 */
export function testSideParts(sideDef, who) {
  if (!sideDef) return [];
  if (sideDef.aspect === "resistance") return [part("base", "Resistance", who.resistance ?? 0)];
  const out = [part("aspect", ASPECT_LABEL[sideDef.aspect], who.aspects?.[sideDef.aspect] ?? 0, { aspect: sideDef.aspect })];
  if (sideDef.skill && who.skill) out.push(part("skill", who.skill.label, who.skill.value ?? 0));
  return out;
}

export { sumParts };

/**
 * Order tokens for the target picker: the user's side first, then the rest, each by name.
 * tokens: [{ disposition, name }], userDisposition: the user's token disposition.
 */
export function sortForPicker(tokens, userDisposition) {
  const mine = (t) => (Math.sign(Number(t.disposition) || 0) === Math.sign(Number(userDisposition) || 0) ? 0 : 1);
  return [...(tokens ?? [])].sort((a, b) => mine(a) - mine(b) || String(a.name).localeCompare(String(b.name)));
}
