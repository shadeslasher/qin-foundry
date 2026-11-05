// Unique-skill effects on others (David, 2026-11-05, skill-effects schema v2 §2). Using an active with an `effect`
// posts an effect card. Allies click "Take it"; enemies click "Resist" (or the GM picks who it lands on in a scene
// selection dialog). What lands is a timed effect on the target's combat state (shown in its Combat panel, counted
// down by combat round, expired by the GM's client). Players' clicks that need the GM go through a query.
import { SYSTEM_ID, SKILLS, SKILL_LEVELS } from "./config.mjs";
import { normalizeEffect, isFriendlyTarget, durationText, testText, testSideParts, resistOutcome, appliedEffect, withEffect, appliedText, sortForPicker, EFFECT_TARGETS } from "./rules/skill-effects.mjs";
import { collectBonuses } from "./rules/bonuses.mjs";
import { part, sumParts, partRowHTML } from "./rules/sources.mjs";
import { rollYinYang, Chat } from "./dice.mjs";
import { getState, saveState, currentFight } from "./combat-state.mjs";
import { attackerToken } from "./attack-fx.mjs";

const QUERY = `${SYSTEM_ID}.skillEffect`;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const uid = () => foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 12);
const skillLabel = (k) => SKILLS[k]?.label ?? k;
const parts = (list) => `<ul class="qin-parts">${list.map(partRowHTML).join("")}</ul>`;

/** Roll one side of an effect's Test for an actor: { total, parts, dice, roll }. */
export async function rollTestSide(actor, sideDef) {
  const sys = actor.system;
  const sk = sideDef.skill ? actor.getSkill(sideDef.skill) : null;
  const { roll, dice } = await rollYinYang({ beginner: !!sk && sk.value === 0 });
  const list = [
    ...testSideParts(sideDef, { aspects: sys.aspects, resistance: sys.resistance, skill: sk ? { label: `${sk.label} (${SKILL_LEVELS[sk.value] ?? sk.value})`, value: sk.value } : null }),
    part("dice", `Yin / Yang ${dice.yin} / ${dice.yang}${dice.double && !dice.critFail ? ", double" : ""}`, dice.value),
    ...(actor._penaltyParts?.(false) ?? []),
  ];
  await actor._afterDice?.(dice);
  return { total: sumParts(list), parts: list, dice, roll };
}

const bonusLine = (bonuses, aspects, who) => collectBonuses([{ id: "x", name: "", bonuses }], { aspects })
  .map((b, i) => `${b.text}${bonuses[i]?.vsSource ? ` against ${who}` : ""}`).join(", ");

/** Post the effect card for an active (its Chi and recharge already taken). Rolls the user's Test if there is one. */
export async function postEffectCard(actor, item) {
  const eff = normalizeEffect(item.system.effect);
  if (!eff) return null;
  const fight = currentFight();
  let roll = null;
  if (eff.test) roll = await rollTestSide(actor, eff.test.user);
  const aspects = actor.system.aspects;
  const friendly = isFriendlyTarget(eff);
  const fail = bonusLine(eff.onFail, aspects, actor.name), succ = bonusLine(eff.onSuccess, aspects, actor.name);
  const buttons = friendly ? [["effectTake", "Take it"]]
    : eff.test ? [["effectResist", "Resist"]]
      : [["effectApply", "Apply (GM)"], ["effectApplyMe", "Apply to me"]];
  const lines = [
    `<p class="qin-sig-meta">${esc(EFFECT_TARGETS[eff.target])} · ${esc(durationText(eff.duration))}${eff.test ? ` · ${esc(testText(eff.test, skillLabel))}` : ""}</p>`,
    item.system.description ? `<div class="qin-effect-text">${item.system.description}</div>` : "",
    fail ? `<p><b>${eff.test ? "If they lose:" : "Effect:"}</b> ${esc(fail)}</p>` : "",
    eff.note ? `<p><b>${fail ? "Also" : eff.test ? "If they lose" : "Effect"}:</b> ${esc(eff.note)}</p>` : "",
    succ ? `<p><b>If they resist:</b> ${esc(succ)}</p>` : eff.test ? `<p class="qin-muted">Resisted: no effect. Ties go to the target.</p>` : "",
    roll ? `<div class="qin-effect-roll"><span class="qin-muted">${esc(actor.name)}'s Test</span>${parts(roll.parts)}<div class="qin-total">Total <b>${roll.total}</b>${roll.dice.critFail ? " · critical failure: everyone resists" : ""}</div></div>` : "",
  ];
  const content = `<div class="qin-chat qin-effect-card"><h3><span class="qin-src qin-src-unique">Unique</span> ${esc(item.name)}</h3>
    <p class="qin-muted">Used by <b>${esc(actor.name)}</b>${item.system.chiCost ? ` · ${item.system.chiCost} Chi` : ""}</p>${lines.join("")}
    <div class="qin-buttons">${buttons.map(([a, l]) => `<button type="button" data-qin-action="${a}">${l}</button>`).join("")}</div></div>`;
  const tok = attackerToken(actor);
  return Chat().create({
    speaker: Chat().getSpeaker({ actor }), content, rolls: roll ? [roll.roll] : [],
    flags: { [SYSTEM_ID]: { kind: "effect", user: actor.uuid, userName: actor.name, itemId: item.id, itemName: item.name, effect: eff,
      total: roll?.total ?? null, critFail: !!roll?.dice.critFail, disposition: tok?.document?.disposition ?? 1, fight } },
  });
}

/* ---------------------------------------- landing an effect */

const srcOf = (flags) => ({ itemId: flags.itemId, itemName: flags.itemName, actorUuid: flags.user, actorName: flags.userName });

/** Put an outcome of the card's effect on a target actor (through the GM if the user can't update it). Returns the entry. */
export async function landEffect(message, target, outcome) {
  const flags = message.flags[SYSTEM_ID];
  const entry = appliedEffect(flags.effect, outcome, srcOf(flags), currentFight(), uid());
  if (!entry) return null;
  if (target.isOwner) {
    const st = getState(target);
    st.effects = withEffect(st.effects, entry);
    await saveState(target, st);
    return entry;
  }
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications.warn("The GM needs to be connected to apply that."); return null; }
  try {
    const r = await gm.query(QUERY, { userId: game.user.id, targetUuid: target.uuid, outcome, messageId: message.id }, { timeout: 15000 });
    return r?.ok ? entry : null;
  } catch (e) { ui.notifications.warn(e.message); return null; }
}

function landedLine(target, entry) {
  return entry ? `${esc(target.name)}: ${esc(appliedText(entry, target.system.aspects) || "in effect")} (${esc(durationLabel(entry))})` : `${esc(target.name)}: no effect`;
}
const durationLabel = (entry) => entry.restOfFight ? (entry.scene ? "this scene" : "rest of the fight") : !entry.combat ? "until ended" : `${entry.rounds} round${entry.rounds === 1 ? "" : "s"}`;

/** The player's own character: a controlled token they own, or their assigned character. */
function myCharacter() {
  const tok = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner && t.actor.type !== "unit");
  return tok?.actor ?? game.user.character ?? null;
}

/** A resist roll by one target against the card's total: { total, parts, outcome, dice, roll }. */
async function resistRoll(flags, target) {
  const r = await rollTestSide(target, flags.effect.test.resist);
  const outcome = resistOutcome({ userTotal: Number(flags.total) || 0, resistTotal: r.total, userCritFail: flags.critFail, resistCritFail: r.dice.critFail });
  return { ...r, outcome };
}

/* ---------------------------------------- chat card buttons */

export function onRenderEffectCard(message, html, flags) {
  html.querySelectorAll("[data-qin-action]").forEach((btn) => {
    const a = btn.dataset.qinAction;
    if (a === "effectApply" && !game.user.isGM) return btn.remove();
    if (a === "effectApplyMe" && game.user.isGM) return btn.remove();
    btn.addEventListener("click", (ev) => { ev.preventDefault(); onEffectClick(a, message, flags).catch(e => { console.error(e); ui.notifications.error(e.message); }); });
  });
}

async function onEffectClick(action, message, flags) {
  if (!normalizeEffect(flags.effect)) return;
  if (game.user.isGM && action !== "effectApplyMe") return new EffectTargetPicker({ message, mode: action === "effectResist" ? "resist" : "apply" }).render({ force: true });
  const me = myCharacter();
  if (!me) return ui.notifications.warn("Select your token (or have a character assigned) first.");
  if (action === "effectResist") {
    const r = await resistRoll(flags, me);
    const entry = await landEffect(message, me, r.outcome);
    return Chat().create({
      speaker: Chat().getSpeaker({ actor: me }), rolls: [r.roll],
      content: `<div class="qin-chat"><h3>${esc(me.name)} resists ${esc(flags.itemName)}</h3>${parts(r.parts)}<div class="qin-total">Total <b>${r.total}</b> vs <b>${flags.total}</b> (${esc(flags.userName)})</div>
        <div class="qin-result ${r.outcome === "success" ? "ok" : "fail"}">${r.outcome === "success" ? "Resisted" : "Fails to resist"}</div><p>${landedLine(me, entry)}</p></div>`,
    });
  }
  const entry = await landEffect(message, me, "fail");
  if (entry) await Chat().create({ speaker: Chat().getSpeaker({ actor: me }), content: `<div class="qin-chat"><p><span class="qin-src qin-src-unique">Unique</span> ${esc(flags.itemName)} (from ${esc(flags.userName)}): ${landedLine(me, entry)}</p></div>` });
}

/* ---------------------------------------- GM: pick targets on the scene */

const api = globalThis.foundry?.applications?.api;

export class EffectTargetPicker extends (api?.ApplicationV2 ?? class {}) {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-effect-picker"],
    position: { width: 440, height: "auto" },
    window: { resizable: true, icon: "fa-solid fa-users" },
    actions: { apply: EffectTargetPicker.#onApply, closePicker: function () { this.close(); }, all: EffectTargetPicker.#onAll },
  };

  constructor({ message, mode }) {
    super({ id: `qin-effect-picker-${message.id}` });
    this.message = message;
    this.flags = message.flags[SYSTEM_ID];
    this.mode = mode; // "apply" (onFail on every ticked actor) or "resist" (each rolls)
    this.results = null;
  }

  get title() { return `${this.flags.itemName}: ${this.mode === "resist" ? "who resists" : "who takes it"}`; }

  /** Character and henchman tokens on the current scene, the user's side first. */
  tokens() {
    const list = (canvas?.scene?.tokens ?? []).filter(t => t.actor && ["character", "henchman"].includes(t.actor.type))
      .map(t => ({ id: t.id, name: t.name, disposition: t.disposition, actor: t.actor }));
    return sortForPicker(list, this.flags.disposition);
  }

  async _renderHTML() {
    const side = (d) => d > 0 ? "Friendly" : d < 0 ? "Hostile" : "Neutral";
    if (this.results) {
      const rows = this.results.map(r => `<li><b>${esc(r.name)}</b>${r.total != null ? `: ${r.total} vs ${this.flags.total} · <span class="${r.outcome === "success" ? "ok" : "fail"}">${r.outcome === "success" ? "resisted" : "fails"}</span>` : ""}<br><span class="qin-muted">${r.line}</span></li>`).join("");
      return `<div class="qin-picker"><ul class="qin-picker-results">${rows || "<li>No one ticked.</li>"}</ul><p class="qin-muted">Posted to chat.</p>
        <div class="qin-buttons"><button type="button" data-action="closePicker">Close</button></div></div>`;
    }
    const toks = this.tokens();
    const eff = normalizeEffect(this.flags.effect);
    const rows = toks.map(t => `<label class="qin-picker-row"><input type="checkbox" name="t" value="${t.id}"><span class="qin-cp-grow">${esc(t.name)}</span><span class="qin-muted">${side(t.disposition)}</span></label>`).join("");
    return `<div class="qin-picker"><p class="qin-muted">${esc(this.flags.userName)} · ${esc(EFFECT_TARGETS[eff.target])} · ${esc(durationText(eff.duration))}${this.mode === "resist" ? ` · Test total ${this.flags.total}` : ""}</p>
      <div class="qin-picker-list">${rows || "<p>No character or henchman tokens on this scene.</p>"}</div>
      <div class="qin-buttons"><button type="button" data-action="all" data-side="mine">Tick my side</button><button type="button" data-action="all" data-side="other">Tick the other side</button>
      <button type="button" class="qin-primary" data-action="apply">${this.mode === "resist" ? "Roll resist and apply" : "Apply"}</button></div></div>`;
  }

  _replaceHTML(result, content) { content.innerHTML = result; }

  static #onAll(event, target) {
    const mine = target.dataset.side === "mine";
    const sign = Math.sign(Number(this.flags.disposition) || 0);
    const byId = new Map(this.tokens().map(t => [t.id, t]));
    this.element.querySelectorAll('input[name="t"]').forEach(cb => {
      const t = byId.get(cb.value);
      cb.checked = (Math.sign(Number(t?.disposition) || 0) === sign) === mine;
    });
  }

  static async #onApply() {
    const ids = [...this.element.querySelectorAll('input[name="t"]:checked')].map(cb => cb.value);
    const byId = new Map(this.tokens().map(t => [t.id, t]));
    const results = [], rolls = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      if (this.mode === "resist") {
        const r = await resistRoll(this.flags, t.actor);
        const entry = await landEffect(this.message, t.actor, r.outcome);
        rolls.push(r.roll);
        results.push({ name: t.name, total: r.total, outcome: r.outcome, parts: r.parts, line: landedLine(t.actor, entry) });
      } else {
        const entry = await landEffect(this.message, t.actor, "fail");
        results.push({ name: t.name, total: null, line: landedLine(t.actor, entry) });
      }
    }
    this.results = results;
    if (results.length) {
      const body = results.map(r => r.total != null
        ? `<div class="qin-effect-result"><b>${esc(r.name)}</b>: ${r.total} vs ${this.flags.total} · <span class="qin-result-inline ${r.outcome === "success" ? "ok" : "fail"}">${r.outcome === "success" ? "resisted" : "fails"}</span>${parts(r.parts)}<p class="qin-muted">${r.line}</p></div>`
        : `<p>${r.line}</p>`).join("");
      await Chat().create({ speaker: { alias: this.flags.itemName }, rolls,
        content: `<div class="qin-chat"><h3><span class="qin-src qin-src-unique">Unique</span> ${esc(this.flags.itemName)} (${esc(this.flags.userName)})${this.mode === "resist" ? ": resist rolls" : ""}</h3>${body}</div>` });
    }
    this.render();
  }
}

/* ---------------------------------------- GM side of a player's click */

export function registerSkillEffects() {
  Hooks.once("init", () => {
    CONFIG.queries[QUERY] = async ({ userId, targetUuid, outcome, messageId }) => {
      if (!game.user.isGM) return { ok: false };
      const user = game.users.get(userId);
      const flags = game.messages.get(messageId)?.flags?.[SYSTEM_ID];
      if (flags?.kind !== "effect") return { ok: false };
      const target = targetUuid ? await fromUuid(targetUuid) : null;
      const caster = flags?.user ? await fromUuid(flags.user) : null;
      if (!user || !target || !normalizeEffect(flags?.effect)) return { ok: false };
      // The player owns the target (their own character) or the actor who used the skill
      if (!target.testUserPermission(user, "OWNER") && !caster?.testUserPermission(user, "OWNER")) return { ok: false };
      const entry = appliedEffect(normalizeEffect(flags.effect), outcome === "success" ? "success" : "fail", srcOf(flags), currentFight(), uid());
      if (!entry) return { ok: true };
      const st = getState(target);
      st.effects = withEffect(st.effects, entry);
      await saveState(target, st);
      return { ok: true };
    };
  });
}
