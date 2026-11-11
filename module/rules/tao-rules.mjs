// Tao automation for personal combat (David, 2026-11-05). Pure: no Foundry dependencies.
// Chi cost = the effect's level for fixed effects; for scaled ("paid in Chi") effects the cost equals the bonus.

/**
 * Automated Tao levels, keyed "<taoKey>.<level>" ("any" = usable at any known level).
 * kind: queue (waits for the next matching roll; Chi spent when a roll uses it), exchange (this exchange only,
 * Chi spent now), timed (counts down each combat round, Chi spent now).
 * slot (queue): attack = next attack that hits, hitTaken = next hit taken, defense = next Active Defense, initiative.
 */
export const TAO_AUTOMATION = {
  "invisibleShield.1": { name: "Strong Defense", kind: "queue", slot: "hitTaken",
    value: (lvl) => lvl, cost: (lvl) => lvl, text: (v) => `−${v} next hit`, when: "When hit: reduce one blow" },
  "invisibleShield.2": { name: "Chi Defense", kind: "exchange", stat: "pd",
    value: (lvl) => lvl, cost: (lvl) => lvl, text: (v) => `PD +${v} this exchange`, when: "When attacked, before the attack is compared" },
  "invisibleShield.3": { name: "Strong Block", kind: "queue", slot: "defense",
    value: (lvl, a) => a.wood ?? 0, cost: () => 3, text: (v) => `+Wood ${v} next defense`, when: "On an Active Defense" },
  "invisibleShield.4": { name: "Chi Block", kind: "queue", slot: "defense", free: true,
    value: () => 0, cost: () => 4, text: () => "free defense, no action", when: "A free Active Defense, even with no actions left" },
  "strengthenedBody.2": { name: "Feel no pain", kind: "timed", effect: "noPain",
    value: () => 0, rounds: (lvl) => lvl, cost: () => 2, text: (v, r) => `no injury penalties, ${r} rounds`, when: "Any time" },
  "strengthenedBody.4": { name: "Hard Hide", kind: "timed", effect: "hitReduction",
    value: (lvl, a) => a.metal ?? 0, rounds: (lvl) => lvl, cost: () => 4, text: (v, r) => `−Metal ${v} every hit, ${r} rounds`, when: "Any time" },
  "destructiveBreath.any": { name: "Destructive Breath", kind: "queue", slot: "attack",
    value: (lvl) => lvl, cost: (lvl) => lvl, text: (v) => `+${v} damage next hit`, when: "Before an attack" },
  "suddenLightning.2": { name: "Speed", kind: "queue", slot: "initiative",
    value: (lvl) => lvl, cost: (lvl) => lvl, text: (v) => `Initiative +${v}`, when: "Before Initiative is rolled" },
};

/* More Taos (David, 2026-11-10: "automate the taos"). Two more kinds:
 *  scene: lasts the rest of the fight (or until ended by hand outside one); carries roll bonuses (the unique-skill bonus
 *         format) and/or armorMin (clothing counts as armour of that protection).
 *  queue slot "test": waits for the next Test with one of `skills`, adds `value` to it. */
const B = (stat, value, extra = {}) => ({ stat, value, mode: "always", ...extra });
const WOOD_SKILLS = ["architecture", "bureaucracy", "calligraphy", "herbalism", "history", "investigation", "law", "learning", "literature", "medicine", "navigation", "perception", "science"];
Object.assign(TAO_AUTOMATION, {
  "breathOfPower.1": { name: "Improvised Shield", kind: "scene", value: () => 2, cost: () => 1,
    bonuses: () => [B("ad", 2, { condition: "defending with a harmless object (cloth, fan, cloak)" })],
    text: () => "Active Defense +2 with a harmless object", when: "Holding a cloth, fan, cloak or the like" },
  "breathOfPower.3": { name: "Invisible Armor", kind: "scene", value: () => 3, cost: () => 3, armorMin: () => 3,
    text: () => "clothing next to the skin gives protection 3", when: "Any time" },
  "strengthenedBody.3": { name: "Cleanse the Blood", kind: "scene", value: (l, a) => a.earth ?? 0, cost: () => 3,
    bonuses: () => [B("resistTest", 0, { aspect: "earth", against: ["poison", "illness"] })],
    text: (v) => `+Earth ${v} to resist poison and disease`, when: "Poisoned or sick" },
  "hiddenShadow.1": { name: "Dark Veil", kind: "scene", value: (l, a) => a.fire ?? 0, cost: () => 1,
    bonuses: () => [B("skillTest", 0, { aspect: "fire", skills: ["stealth"], condition: "still and partly hidden" })],
    text: (v) => `Stealth +Fire ${v} while still and partly hidden`, when: "Hiding, keeping still" },
  "hiddenShadow.3": { name: "Path of Shadows", kind: "scene", value: (l, a) => a.fire ?? 0, cost: () => 3,
    bonuses: () => [B("skillTest", 0, { aspect: "fire", skills: ["stealth"], condition: "moving unseen" })],
    text: (v) => `Stealth +Fire ${v} while moving unseen`, when: "Moving unseen" },
  "hiddenShadow.4": { name: "Path of Ghosts", kind: "scene", value: (l, a) => a.fire ?? 0, cost: () => 4,
    bonuses: () => [B("skillTest", 0, { aspect: "fire", skills: ["stealth"], condition: "any subtle action, attacks included" })],
    text: (v) => `Stealth +Fire ${v} on any subtle action`, when: "Any subtle action" },
  "innerEye.1": { name: "Keen Eye", kind: "queue", slot: "test", skills: ["perception"], value: (l, a) => a.earth ?? 0, cost: () => 1,
    text: (v) => `Perception +Earth ${v}, next Test`, when: "Before a Perception Test" },
  "innerEye.2": { name: "Sharp Sense", kind: "queue", slot: "test", skills: ["perception"], value: (l) => l, cost: (l) => l,
    text: (v) => `Perception +${v} with one sense, next Test`, when: "Before a Perception Test" },
  "clearMind.1": { name: "Sharp Mind", kind: "scene", value: () => 2, cost: () => 1,
    bonuses: () => [B("skillTest", 2, { skills: WOOD_SKILLS })], text: () => "+2 to Tests with mental (Wood) Skills", when: "Any time" },
  "clearMind.4": { name: "Visionary Mind", kind: "scene", value: (l, a) => a.water ?? 0, cost: () => 4,
    bonuses: () => [B("skillTest", 0, { aspect: "water", skills: ["investigation", "learning", "science"], condition: "reasoning: puzzles, connecting facts" })],
    text: (v) => `+Water ${v} to reasoning Tests`, when: "Puzzles, connecting facts" },
  "serenePresence.1": { name: "Mask of Serenity", kind: "scene", value: (l) => l, cost: () => 1,
    bonuses: (l) => [B("skillTest", l, { skills: ["acting", "diplomacy", "eloquence", "etiquette", "seduction"], condition: "to please or win confidence" })],
    text: (v) => `+${v} to Tests to please or win confidence`, when: "Fire hours" },
  "serenePresence.2": { name: "Behind the Mask", kind: "scene", value: (l) => l, cost: () => 2,
    bonuses: (l) => [B("skillTest", l, { skills: ["empathy"], condition: "to read a person" })], text: (v) => `Empathy +${v}`, when: "Reading a person" },
  "serenePresence.3": { name: "Mask of Terror", kind: "scene", value: (l) => l, cost: () => 3,
    bonuses: (l) => [B("skillTest", l, { skills: ["intimidation", "command"], condition: "to impress or unsettle" })],
    text: (v) => `+${v} to Tests to impress or unsettle`, when: "Fire hours" },
  "serenePresence.4": { name: "The Mirror", kind: "scene", value: (l, a) => a.earth ?? 0, cost: () => 4,
    bonuses: () => [B("resistTest", 0, { aspect: "earth", against: ["deception", "persuasion", "seduction", "intimidation", "coercion"] })],
    text: (v) => `+Earth ${v} to resist manipulation, lies, seduction and intimidation`, when: "Any time" },
  "inspiredCreation.1": { name: "The Hand That Mends", kind: "scene", value: (l, a) => a.earth ?? 0, cost: () => 1,
    bonuses: () => [B("skillTest", 0, { aspect: "earth", skills: ["craft", "forge", "architecture"], condition: "repair or restoration" })],
    text: (v) => `+Earth ${v} to repair Tests`, when: "Repairing" },
  "inspiredCreation.2": { name: "The Hand That Creates", kind: "scene", value: (l) => l, cost: () => 2,
    bonuses: (l) => [B("skillTest", l, { skills: ["craft", "forge", "arts", "calligraphy", "music"], condition: "creating an object or work of art" })],
    text: (v) => `+${v} to Tests creating an object or work of art`, when: "Creating" },
});

export const QUEUE_SLOTS = { attack: "Next attack", hitTaken: "Next hit taken", defense: "Next defense", initiative: "Next Initiative", test: "Next Test" };

/** The automation for a Tao key at an effect level (or its "any level" effect), or null. */
export function taoAutomation(key, level) {
  return TAO_AUTOMATION[`${key}.${level}`] ?? (level === "any" ? TAO_AUTOMATION[`${key}.any`] ?? null : null);
}

/** Resolve an automated effect for a Tao known at `taoLevel`: { id, name, kind, slot, value, cost, rounds, text, free }. */
export function resolveTao(key, level, taoLevel, aspects = {}) {
  const def = taoAutomation(key, level);
  if (!def) return null;
  const lvl = Math.max(0, Number(taoLevel) || 0);
  if (level !== "any" && Number(level) > lvl) return null;
  if (level === "any" && lvl < 1) return null;
  const value = def.value(lvl, aspects), cost = def.cost(lvl, aspects), rounds = def.rounds ? def.rounds(lvl, aspects) : 0;
  return { id: `${key}.${level}`, key, level, name: def.name, kind: def.kind, slot: def.slot ?? null, stat: def.stat ?? null,
    effect: def.effect ?? null, free: !!def.free, value, cost, rounds, text: def.text(value, rounds), when: def.when,
    bonuses: def.bonuses ? def.bonuses(lvl, aspects) : null, armorMin: def.armorMin ? def.armorMin(lvl, aspects) : 0, skills: def.skills ?? null };
}

/** Chi cost of an automated Tao effect (or the effect level for any other Tao level, as the book has it). */
export function taoCost(key, level, taoLevel, aspects = {}) {
  const r = resolveTao(key, level, taoLevel, aspects);
  return r ? r.cost : Number(level) || 0;
}

/**
 * Everything a character can do with their Taos in a fight: [{ taoKey, taoName, taoId, taoLevel, actions: [...], other: [levels] }].
 * taos = [{ id, name, key, level }]. `other` lists known levels with no automation (they keep the plain "use" behaviour).
 */
export function taoActionsFor(taos, aspects = {}) {
  const out = [];
  for (const t of taos ?? []) {
    const lvl = Number(t.level) || 0;
    if (lvl < 1) continue;
    const actions = [], other = [];
    const any = resolveTao(t.key, "any", lvl, aspects);
    if (any) actions.push(any);
    for (let l = 1; l <= Math.min(4, lvl); l++) {
      const r = resolveTao(t.key, l, lvl, aspects);
      if (r) actions.push(r); else if (!any) other.push(l);
    }
    out.push({ taoKey: t.key, taoName: t.name, taoId: t.id, taoLevel: lvl, actions, other });
  }
  return out;
}

/* ---------------------------------------- timed effects */

/**
 * A timed effect: { id, label, combat, round, rounds, exchange? }. Started in round R for N rounds, it lasts
 * rounds R .. R+N-1. combat "" = started outside a fight: it never runs out by itself (the GM ends it).
 * Exchange effects (rounds 0, exchange set) last only for the exchange they were started in.
 */
export function roundsLeft(eff, combat) {
  if (!eff?.combat) return null;
  if (!combat || combat.id !== eff.combat) return 0;
  if (eff.exchange) return (combat.round === eff.round && (combat.exchange ?? 1) === eff.exchange) ? 1 : 0;
  if (eff.restOfFight) return Infinity;
  return (Number(eff.round) || 0) + (Number(eff.rounds) || 0) - (Number(combat.round) || 0);
}

export const isEffectActive = (eff, combat) => { const l = roundsLeft(eff, combat); return l === null || l > 0; };

/** Split effects into the ones still running and the expired ones, for the combat's current round and exchange. */
export function tickEffects(effects, combat) {
  const keep = [], expired = [];
  for (const e of effects ?? []) {
    if (!e.combat || !combat || e.combat !== combat.id) { keep.push(e); continue; }
    (isEffectActive(e, combat) ? keep : expired).push(e);
  }
  return { keep, expired };
}

/** Effects left when a fight ends: everything tied to that fight goes. */
export function expireCombat(effects, combatId) {
  return (effects ?? []).filter(e => !e.combat || e.combat !== combatId);
}

/* ---------------------------------------- damage */

/**
 * Damage after reductions, in order: armour (protection − pierce), then hit reductions (Hard Hide, unique
 * "every hit" / "first hit" reductions), then Strong Defense, then any manual reduction. Each step can't take
 * damage below 0; a step that finds nothing left to reduce reduces 0 (and reports used: false).
 * reductions: [{ label, value, kind, step: "hit" | "strongDefense" | "manual" }].
 * Returns { final, steps: [{ ...reduction, applied, used }], armor: { protection, pierce, applied } }.
 */
export function damageAfterReductions({ amount, protection = 0, pierce = 0, reductions = [] }) {
  let left = Math.max(0, Number(amount) || 0);
  const prot = Math.max(0, (Number(protection) || 0) - (Number(pierce) || 0));
  const armorApplied = Math.min(left, prot);
  left -= armorApplied;
  const order = { hit: 0, strongDefense: 1, manual: 2 };
  const steps = [];
  for (const r of [...reductions].sort((a, b) => (order[a.step] ?? 2) - (order[b.step] ?? 2))) {
    const v = Math.max(0, Number(r.value) || 0);
    const applied = Math.min(left, v);
    left -= applied;
    steps.push({ ...r, applied, used: applied > 0 });
  }
  return { final: left, steps, armor: { protection: Number(protection) || 0, pierce: Number(pierce) || 0, applied: armorApplied } };
}

/** Is this the first hit the actor takes this round? firstHit = { combat, round } of the last first hit recorded. */
export function isFirstHitThisRound(firstHit, combat) {
  if (!combat?.id) return true;
  return !(firstHit && firstHit.combat === combat.id && Number(firstHit.round) === Number(combat.round));
}

/* ---------------------------------------- the actor's combat state (flags.qin.combatState) */

/**
 * { effects: [timed / exchange / rest-of-fight effects], queued: [effects waiting for a roll],
 *   situational: { "<sourceId>:<index>": true } (ticked situational bonuses), firstHit: { combat, round },
 *   stacks: [{ key, steps }] (growing bonuses), engaged: { adjust, combat, round } (panel correction to the opponents
 *   engaged count, for that round), lastAttack: { combat, round }, stackRound: { combat, round } (last round counted) }.
 */
export function normalizeCombatState(raw) {
  return {
    effects: Array.isArray(raw?.effects) ? raw.effects.filter(Boolean) : [],
    queued: Array.isArray(raw?.queued) ? raw.queued.filter(Boolean) : [],
    situational: raw?.situational && typeof raw.situational === "object" ? { ...raw.situational } : {},
    firstHit: raw?.firstHit ?? null,
    stacks: Array.isArray(raw?.stacks) ? raw.stacks.filter(e => e?.key) : [],
    engaged: raw?.engaged ?? null,
    lastAttack: raw?.lastAttack ?? null,
    stackRound: raw?.stackRound ?? null,
  };
}

/** Effects in force: running ones of `combat` (when given), plus manual ones (started outside a fight). */
export function liveEffects(effects, combat, combatExists = () => true) {
  return (effects ?? []).filter(e => {
    if (!e.combat) return true;
    if (!combatExists(e.combat)) return false;
    if (!combat || combat.id !== e.combat) return true; // another fight still running: leave it to that fight's hooks
    return isEffectActive(e, combat);
  });
}

/** Totals from effects in force: { pd, hitReduction: [{label,value}], noPain, bonusSources: [{ id, name, bonuses, fromEffect }] }. */
export function effectTotals(effects) {
  const out = { pd: [], hitReduction: [], noPain: false, bonusSources: [], armorMin: 0, armorMinLabel: "" };
  for (const e of effects ?? []) {
    if (e.effect === "pd") out.pd.push({ label: e.label, value: Number(e.value) || 0 });
    else if (e.effect === "hitReduction") out.hitReduction.push({ label: e.label, value: Number(e.value) || 0 });
    else if (e.effect === "noPain") out.noPain = true;
    if (e.bonuses?.length) out.bonusSources.push({ id: e.sourceId || e.id, name: e.label, bonuses: e.bonuses, fromEffect: true,
      sourceActor: e.sourceActor || null, sourceActorName: e.source || "" });
    if (e.noPain) out.noPain = true;
    if ((Number(e.armorMin) || 0) > out.armorMin) { out.armorMin = Number(e.armorMin); out.armorMinLabel = e.label; } // Invisible Armor
  }
  return out;
}
