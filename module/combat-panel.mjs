// The Combat panel (David, 2026-11-05): one character's fight at a glance, docked beside the chat. Status (Chi,
// Breath of Life, actions, round and exchange), effects in force, effects ready for the next roll, Tao buttons,
// unique actives and situational tick boxes. Owners and the GM can open it.
import { systemPath, rechargeStatus, rechargeLabel, isActiveSlot, SIGNATURE_SLOTS } from "./config.mjs";
import { taoActionsFor, roundsLeft, QUEUE_SLOTS } from "./rules/tao-rules.mjs";
import { collectBonuses } from "./rules/bonuses.mjs";
import { getState, currentFight, activateTao, endEffect, removeQueued, setSituational, tickedOf, useActive, setCombatStateChangeHandler, shortTao, growingRows, adjustStack, auraBonuses } from "./combat-state.mjs";
import { appliedText, normalizeEffect, durationText, EFFECT_TARGETS } from "./rules/skill-effects.mjs";
import { STACK_TRIGGERS, STACK_RESETS } from "./rules/stacks.mjs";
import { activeCombatantFor, getActions } from "./combat-actions.mjs";

const { api } = foundry.applications;

export class CombatPanel extends api.HandlebarsApplicationMixin(api.ApplicationV2) {
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-combat-panel"],
    position: { width: 360, height: "auto" },
    window: { resizable: true, icon: "fa-solid fa-shield-halved" },
    actions: {
      tao: CombatPanel.#onTao,
      taoOther: CombatPanel.#onTaoOther,
      endEffect: CombatPanel.#onEndEffect,
      unqueue: CombatPanel.#onUnqueue,
      useActive: CombatPanel.#onUseActive,
      stackUp: CombatPanel.#onStackUp,
      stackDown: CombatPanel.#onStackDown,
      openSheet: function () { this.actor.sheet.render(true); },
    },
  };
  static PARTS = { body: { template: systemPath("templates/combat-panel.hbs"), scrollable: [".qin-cp-body"] } };

  /** Open (or bring forward) the panel for an actor the user owns. */
  static open(actor) {
    if (!actor?.isOwner) return ui.notifications.warn("Only the character's owner or the GM can open its Combat panel.");
    let app = CombatPanel.instances.get(actor.uuid);
    if (!app) {
      app = new CombatPanel({ actor, id: `qin-combat-panel-${actor.uuid.replace(/[^\w-]/g, "-")}` });
      CombatPanel.instances.set(actor.uuid, app);
    }
    app.render({ force: true });
    if (app.rendered) app.bringToFront?.();
    return app;
  }

  static refresh(actor = null) {
    for (const [uuid, app] of CombatPanel.instances) {
      if (!app.rendered) continue;
      if (!actor || uuid === actor.uuid || app.actor === actor) app.render();
    }
  }

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  get title() { return `${this.actor.name} · Combat panel`; }

  /** Docked beside the chat sidebar. */
  _initializeApplicationOptions(options) {
    const o = super._initializeApplicationOptions(options);
    let pct = 115;
    try { pct = Number(game.settings.get("qin", "textScale")) || 115; } catch { /* fine */ }
    o.position.width = Math.round(360 * pct / 100);
    const sb = document.getElementById("sidebar")?.getBoundingClientRect();
    const right = sb && sb.width ? sb.left : window.innerWidth - 300;
    o.position.left = Math.max(0, right - o.position.width - 8);
    o.position.top = Math.max(0, (sb?.top ?? 0) + 8);
    return o;
  }

  async close(options) {
    CombatPanel.instances.delete(this.actor.uuid);
    return super.close(options);
  }

  async _prepareContext() {
    const actor = this.actor, sys = actor.system;
    const fight = currentFight();
    const state = getState(actor);
    const combatant = activeCombatantFor(actor);
    const acts = combatant ? getActions(combatant) : null;
    const left = acts ? Math.max(0, acts.max - acts.spent) : 0;
    const pct = (v, m) => Math.max(0, Math.min(100, m ? Math.round((v / m) * 100) : 0));

    // In effect now: timed / exchange / rest-of-fight effects, then always-on unique bonuses
    const inEffect = (sys.combatEffects ?? []).map(e => {
      const l = roundsLeft(e, fight);
      const leftText = e.exchange ? "this exchange" : e.restOfFight ? "rest of fight" : l === null ? "until ended" : `${l} round${l === 1 ? "" : "s"}`;
      if (e.kind === "skillEffect") {
        // Put on this character by someone's unique skill: the source, the bonuses ("against <source>"), the note
        const text = appliedText(e, sys.aspects);
        return { id: e.id, kind: "unique", text: `${e.label}${e.source ? ` (from ${e.source})` : ""}${text ? `: ${text}` : ""}`, left: e.scene ? "this scene" : leftText, canEnd: true,
          reminder: !(e.bonuses ?? []).length };
      }
      const what = e.kind === "unique"
        ? collectBonuses([{ id: e.sourceId, name: e.label, bonuses: e.bonuses }], { aspects: sys.aspects }).map(b => b.text).join(", ")
        : e.effect === "pd" ? `Passive Defense +${e.value}` : e.effect === "hitReduction" ? `−${e.value} damage on every hit` : e.effect === "noPain" ? "no injury penalties" : "";
      return { id: e.id, kind: e.kind === "unique" ? "unique" : "tao", text: `${e.label}${what ? `: ${what}` : ""}`, left: leftText, canEnd: true };
    });
    const always = (sys.bonusList ?? []).filter(b => b.mode !== "situational" && !b.fromEffect);
    const alwaysBySource = new Map();
    for (const b of always) { if (!alwaysBySource.has(b.sourceName)) alwaysBySource.set(b.sourceName, []); alwaysBySource.get(b.sourceName).push(b.text); }
    const alwaysRows = [...alwaysBySource].map(([name, t]) => ({ text: `${name}: ${t.join(", ")}` }));
    // Allies' auras reaching him here (schema v2.3), worked out from the tokens on the viewed scene
    const auras = auraBonuses(actor);
    for (const b of auras) if (b.mode !== "situational") alwaysRows.push({ text: `${b.label}: ${b.text}${b.aura?.who ? ` (${b.aura.who})` : ""}`, aura: true });

    // Growing bonuses: "Name: +2 (2/3)" with + / − (opponents engaged: the count, corrected for this round)
    const growing = growingRows(actor).map(r => ({ key: r.key, text: `${r.label}: ${r.text}`,
      sub: r.trigger === "opponentsEngaged" ? `opponents engaged ${r.engaged ?? 0}${r.offset ? ` − ${r.offset}` : ""} · + / − corrects the count this round`
        : `${STACK_TRIGGERS[r.trigger]} · ${STACK_RESETS[r.resetOn]}`, canDown: r.trigger === "opponentsEngaged" ? (r.engaged ?? 0) > 0 : r.steps > 0, canUp: r.trigger === "opponentsEngaged" || r.steps < r.max }));

    // Ready for the next roll
    const queued = Object.entries(QUEUE_SLOTS).map(([slot, label]) => ({
      label, items: state.queued.filter(q => q.slot === slot).map(q => ({ id: q.id, kind: q.kind ?? "tao", text: `${q.label}: ${q.text}`, cost: q.cost })),
    })).filter(g => g.items.length);

    // Taos
    const taoItems = actor.items.filter(i => i.type === "tao" && (i.system.level || 0) > 0);
    const taoRows = taoActionsFor(taoItems.map(i => ({ id: i.id, name: i.name, key: i.system.key, level: i.system.level })), sys.aspects);
    const initRolled = !!(combatant && combatant.initiative != null && left > 0);
    const taos = taoRows.map(t => ({
      id: t.taoId, name: `${shortTao(t.taoName)} ${t.taoLevel}`, other: t.other.length > 0, otherLabel: t.actions.length ? "Other levels" : "Use",
      buttons: t.actions.map(a => {
        let disabled = false, reason = "";
        if (a.kind === "queue" && state.queued.some(q => q.key === a.id)) { disabled = true; reason = "ready"; }
        else if (a.kind !== "queue" && (sys.combatEffects ?? []).some(e => e.key === a.id)) {
          const e = sys.combatEffects.find(x => x.key === a.id), l = roundsLeft(e, fight);
          disabled = true; reason = e.exchange ? "active this exchange" : l === null ? "active" : `active, ${l} left`;
        } else if (a.slot === "initiative" && initRolled) { disabled = true; reason = "before Initiative only"; }
        return { level: a.level, label: `${a.level === "any" ? "" : `${a.level} · `}${a.name}`, sub: `${a.text} · ${a.cost} Chi`, when: a.when, disabled, reason };
      }),
    }));

    // Unique actives
    const actives = actor.items.filter(i => i.type === "signature" && isActiveSlot(i.system.slot)).map(i => {
      const status = rechargeStatus(i.system, fight);
      const eff = normalizeEffect(i.system.effect);
      const fx = [collectBonuses([{ id: i.id, name: i.name, bonuses: i.system.bonuses }], { aspects: sys.aspects }).map(b => b.text).join(", "),
        eff ? `${EFFECT_TARGETS[eff.target]}, ${durationText(eff.duration)}${eff.test ? ", Test" : ""}` : ""].filter(Boolean).join(" · ");
      return { id: i.id, name: i.name, slot: SIGNATURE_SLOTS[i.system.slot]?.label ?? "", sub: fx, cost: i.system.chiCost, ready: status.ready,
        status: status.text ? status.text.replace(/^Recharging/, "recharging").replace(/^Used this fight/, "used this fight") : "", recharge: rechargeLabel(i.system) };
    });

    // Situational tick boxes
    const ticked = tickedOf(actor);
    const situational = [...(sys.bonusList ?? []), ...auras].filter(b => b.mode === "situational").map(b => ({ key: b.key, checked: !!ticked[b.key], text: `${b.label}: ${b.text}`, condition: b.condition }));

    return {
      actor, isCharacter: actor.type === "character",
      subtitle: [sys.details?.tier ? `Tier ${sys.details.tier}` : "", sys.details?.characterType].filter(Boolean).join(" · "),
      fight: fight ? `Round ${fight.round} · Exchange ${fight.exchange}` : "Not in a fight",
      chi: sys.chi ? { value: sys.chi.value, max: sys.chi.max, pct: pct(sys.chi.value, sys.chi.max) } : null,
      bol: sys.bol?.total ? { value: sys.bol.remaining, max: sys.bol.total, pct: pct(sys.bol.remaining, sys.bol.total) } : sys.hp ? { value: sys.hp.value, max: sys.hp.max, pct: pct(sys.hp.value, sys.hp.max), henchman: true } : null,
      actions: acts ? { left, max: acts.max, pips: Array.from({ length: acts.max }, (_, i) => i < left) } : null,
      inEffect, alwaysRows, growing, queued, taos, actives, situational,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("input[data-sit-key]").forEach(cb => cb.addEventListener("change", () => setSituational(this.actor, cb.dataset.sitKey, cb.checked)));
  }

  static async #onTao(event, target) {
    const item = this.actor.items.get(target.dataset.taoId);
    if (!item) return;
    const level = target.dataset.level === "any" ? "any" : Number(target.dataset.level);
    await activateTao(this.actor, item, level);
  }
  static async #onTaoOther(event, target) { this.actor.items.get(target.dataset.taoId)?.use(); }
  static async #onEndEffect(event, target) { await endEffect(this.actor, target.dataset.id); }
  static async #onUnqueue(event, target) { await removeQueued(this.actor, target.dataset.id); }
  static async #onStackUp(event, target) { await adjustStack(this.actor, target.dataset.key, 1); }
  static async #onStackDown(event, target) { await adjustStack(this.actor, target.dataset.key, -1); }
  static async #onUseActive(event, target) {
    const item = this.actor.items.get(target.dataset.id);
    if (item) await useActive(this.actor, item);
  }
}

/** Live updates: the actor, its items and the combat. */
export function registerCombatPanel() {
  let pending = null;
  const all = () => { clearTimeout(pending); pending = setTimeout(() => CombatPanel.refresh(), 30); };
  setCombatStateChangeHandler(all);
  Hooks.on("updateActor", (actor) => CombatPanel.refresh(actor));
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent?.documentName === "Actor") CombatPanel.refresh(item.parent); });
  for (const h of ["updateCombatant", "createCombatant", "deleteCombatant", "createCombat", "combatStart"]) Hooks.on(h, all);
  // Unlinked tokens' actors change through their token
  // Token moves change who is engaged with whom: refresh every open panel
  Hooks.on("updateToken", (tok, change) => { if ("x" in change || "y" in change) all(); else if (tok.actor) CombatPanel.refresh(tok.actor); });
}
