// Growing bonuses (David, 2026-11-05, skill-effects schema v2 §1): a bonus with `stack: { trigger, max, resetOn, offset }`
// is worth value × steps, steps capped at max. Pure: no Foundry dependencies.
// Steps are kept per actor in flags.qin.combatState.stacks as [{ key, steps }] (an array, so a whole-state save
// replaces it instead of merging old keys back in). key = the bonus key ("<sourceId>:<index>").

export const STACK_TRIGGERS = {
  roundStart: "each round",
  noAttackLastRound: "each round after one with no attack",
  dropOpponent: "each opponent he drops",
  hitTaken: "each hit he takes",
  opponentsEngaged: "opponents engaged",
  manual: "counter",
};
export const STACK_RESETS = { attack: "resets when he attacks", moved: "resets when he moves", fightEnd: "resets at the end of the fight", never: "never resets" };

/** { trigger, max, resetOn, offset } or null. resetOn defaults to "fightEnd", offset (opponentsEngaged) to 1. */
export function normalizeStack(s, outer = {}) {
  if (!s || typeof s !== "object") return null;
  const trigger = STACK_TRIGGERS[s.trigger] ? s.trigger : "manual";
  const max = Math.max(1, Math.trunc(Number(s.max) || 0) || 1);
  // resetOn / offset belong inside `stack`; a copy one level up (on the bonus) is accepted too
  const r = s.resetOn ?? outer.resetOn;
  const resetOn = STACK_RESETS[r] ? r : "fightEnd";
  const o = s.offset ?? outer.offset;
  const offset = trigger === "opponentsEngaged" ? (o === undefined || o === null || o === "" ? 1 : Math.trunc(Number(o) || 0)) : 0;
  return { trigger, max, resetOn, offset };
}

const clamp = (n, max) => Math.max(0, Math.min(max, Math.trunc(Number(n) || 0)));

/** Stored steps for a key (0 when none). */
export function storedSteps(stacks, key) {
  const e = (stacks ?? []).find(s => s?.key === key);
  return Math.max(0, Math.trunc(Number(e?.steps) || 0));
}

/** Steps a stacking bonus counts now. opponentsEngaged: engaged − offset (engaged null = unknown → 0). */
export function stackSteps(stack, stacks, key, { engaged = null } = {}) {
  if (!stack) return 1;
  if (stack.trigger === "opponentsEngaged") return engaged == null ? 0 : clamp(Number(engaged) - stack.offset, stack.max);
  return clamp(storedSteps(stacks, key), stack.max);
}

/** Set one key's steps (removes it at 0). Returns a new array. */
export function setSteps(stacks, key, steps, max = Infinity) {
  const out = (stacks ?? []).filter(s => s?.key && s.key !== key);
  const n = clamp(steps, max);
  if (n > 0) out.push({ key, steps: n });
  return out;
}

/** +delta steps on one key, capped. */
export const adjustSteps = (stacks, key, delta, max) => setSteps(stacks, key, storedSteps(stacks, key) + (Number(delta) || 0), max);

/** The stacking bonuses in a collected bonus list: [{ key, stack, label }]. */
export function stackDefs(list) {
  return (list ?? []).filter(b => b.stack).map(b => ({ key: b.key, stack: b.stack, label: b.baseLabel ?? b.label }));
}

/**
 * Apply an event to the stored steps. defs = stackDefs(...). Returns { stacks, changed }.
 * events: "roundStart" (ctx.attackedLastRound, ctx.firstRound), "attack", "moved", "dropOpponent", "hitTaken", "fightEnd".
 * Triggers add a step; resets clear the step count of bonuses whose resetOn matches ("fightEnd" clears all but "never").
 */
export function stackEvent(stacks, defs, event, ctx = {}) {
  let out = [...(stacks ?? [])];
  const before = JSON.stringify(out);
  for (const d of defs ?? []) {
    const s = d.stack;
    if (!s) continue;
    // Resets first (an attack that resets doesn't also count as a trigger for the same bonus)
    const resets = event === "fightEnd" ? s.resetOn !== "never" : s.resetOn === event;
    if (resets) { out = setSteps(out, d.key, 0); continue; }
    let add = 0;
    if (event === "roundStart") {
      if (s.trigger === "roundStart") add = 1;
      else if (s.trigger === "noAttackLastRound" && !ctx.firstRound && !ctx.attackedLastRound) add = 1;
    } else if (event === "dropOpponent" && s.trigger === "dropOpponent") add = Math.max(1, Number(ctx.count) || 1);
    else if (event === "hitTaken" && s.trigger === "hitTaken") add = 1;
    if (add) out = adjustSteps(out, d.key, add, s.max);
  }
  if (event === "fightEnd") { // drop entries whose bonus is gone, except "never" ones
    const never = new Set((defs ?? []).filter(d => d.stack?.resetOn === "never").map(d => d.key));
    out = out.filter(e => never.has(e.key));
  }
  return { stacks: out, changed: JSON.stringify(out) !== before };
}

/** Is this round already counted for the round-start triggers? last = { combat, round }. */
export function roundAlreadyCounted(last, fight) {
  return !!(last && fight && last.combat === fight.id && Number(last.round) >= Number(fight.round));
}

/** Did the actor attack in the round before `fight.round`? lastAttack = { combat, round }. */
export function attackedLastRound(lastAttack, fight) {
  return !!(lastAttack && fight && lastAttack.combat === fight.id && Number(lastAttack.round) === Number(fight.round) - 1);
}

/** Did a hit move the target to a worse wound level (or out)? Character levels by index; henchmen by health lost. */
const LEVEL_ORDER = ["normal", "bruised", "slightly", "seriously", "fatally"];
export function droppedLevel(before, after) {
  if (!before || !after) return false;
  if (after.out && !before.out) return true;
  if (before.health != null && after.health != null) return Number(after.health) < Number(before.health);
  const b = LEVEL_ORDER.indexOf(before.level), a = LEVEL_ORDER.indexOf(after.level);
  return a > b || (!!after.coma && !before.coma) || (!!after.dead && !before.dead);
}

/**
 * Hostile tokens next to a token (grid distance 1). tokens: [{ id, disposition, out }]; distance(a, b) → spaces.
 * Hostile = opposite sides (friendly vs hostile/secret); neutral tokens engage no one. Tokens out of action don't count.
 */
export function countEngaged(self, tokens, distance) {
  const side = (d) => (Number(d) > 0 ? 1 : Number(d) < 0 ? -1 : 0);
  const mine = side(self?.disposition);
  if (!mine) return 0;
  let n = 0;
  for (const t of tokens ?? []) {
    if (!t || t.id === self.id || t.out) continue;
    if (side(t.disposition) !== -mine) continue;
    const d = distance(self, t);
    if (d > 0 && d <= 1) n++;
  }
  return n;
}

/** The engaged count with the panel's correction: corrections hold for the round they were made in. */
export function engagedWithAdjust(auto, engaged, fight) {
  const same = engaged && fight && engaged.combat === fight.id && Number(engaged.round) === Number(fight.round);
  return Math.max(0, (Number(auto) || 0) + (same ? Number(engaged.adjust) || 0 : 0));
}
