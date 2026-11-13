// The Combat panel (David, 2026-11-05): one character's fight at a glance, docked beside the chat. Status (Chi,
// Breath of Life, actions, round and exchange), effects in force, effects ready for the next roll, Tao buttons,
// unique actives and situational tick boxes. Owners and the GM can open it.
import { systemPath, rechargeStatus, rechargeLabel, isActiveSlot, SIGNATURE_SLOTS, SKILL_LEVELS } from "./config.mjs";
import { damageDialog } from "./chat.mjs";
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
    position: { width: 820, height: "auto" },
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
      attack: CombatPanel.#onAttack,
      defend: CombatPanel.#onDefend,
      takeHit: CombatPanel.#onTakeHit,
      dismissIncoming: CombatPanel.#onDismiss,
      endTurn: CombatPanel.#onEndTurn,
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
    o.position.width = Math.min(window.innerWidth - 320, Math.round(820 * pct / 100));
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
      const what = e.kind === "unique" || e.bonuses?.length
        ? [...collectBonuses([{ id: e.sourceId || e.id, name: e.label, bonuses: e.bonuses ?? [] }], { aspects: sys.aspects }).map(b => b.text), ...(e.armorMin ? [`protection ${e.armorMin}`] : [])].join(", ")
        : e.armorMin ? `clothing gives protection ${e.armorMin}`
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
        // the button shows only the level and name; the rest is in a hover card (David, 2026-11-10)
        const e = (x) => foundry.utils.escapeHTML(String(x ?? ""));
        const tip = `<div class="qin-sig-tip"><div class="qin-sig-tip-hd"><div class="qin-sig-tip-slot">${e(shortTao(t.taoName))}${a.level === "any" ? "" : ` · level ${e(a.level)}`}</div>`
          + `<div class="qin-sig-tip-name">${e(a.name)}</div><div class="qin-sig-chips"><span class="qin-sig-chip chi">${e(a.cost)} Chi</span>${a.when ? `<span class="qin-sig-chip cd">${e(a.when)}</span>` : ""}</div></div>`
          + `<div class="qin-sig-tip-bd"><ul class="qin-sig-rules"><li>${e(a.text)}</li>${disabled ? `<li><i>Not now: ${e(reason)}</i></li>` : ""}</ul></div></div>`;
        return { level: a.level, label: `${a.level === "any" ? "" : `${a.level} · `}${a.name}`, disabled, reason, tip };
      }).concat(t.other.map(l => {
        // Levels not automated (Six Directions...): the button takes the Chi (= the level) and posts the text; the rest is by hand
        const item = actor.items.get(t.taoId);
        const text = item?.system.effects?.[`l${l}`] ?? "";
        const e = (x) => foundry.utils.escapeHTML(String(x ?? ""));
        const tip = `<div class="qin-sig-tip"><div class="qin-sig-tip-hd"><div class="qin-sig-tip-slot">${e(shortTao(t.taoName))} · level ${l}</div>`
          + `<div class="qin-sig-tip-name">Level ${l}</div><div class="qin-sig-chips"><span class="qin-sig-chip chi">${l} Chi</span><span class="qin-sig-chip cd">applied by hand</span></div></div>`
          + `<div class="qin-sig-tip-bd"><ul class="qin-sig-rules"><li>${e(text) || "<i>No text on the Tao.</i>"}</li><li><i>The Chi is taken and the level posted to chat; movement and the rest are done by hand.</i></li></ul></div></div>`;
        return { level: l, label: `${l} · ${text ? shortLevelName(text) : `Level ${l}`}`, manual: true, tip };
      })).sort((a, b) => (a.level === "any" ? 0 : a.level) - (b.level === "any" ? 0 : b.level)),
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
      glance: glanceOf(actor, combatant), incoming: incomingFor(actor, fight), target: targetInfo(actor),
      weapons: weaponsOf(actor), techniques: techniquesOf(actor),
      myTurn: !!(combatant && game.combat?.combatant === combatant), inFight: !!combatant,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("input[data-sit-key]").forEach(cb => cb.addEventListener("change", () => setSituational(this.actor, cb.dataset.sitKey, cb.checked)));
  }

  static async #onTao(event, target) {
    if (target.classList.contains("off")) return;          // greyed out (kept clickable-looking so its hover card still shows)
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
  static async #onAttack(event, target) {
    const w = this.actor.items.get(target.dataset.id);
    if (w) await this.actor.rollAttack(w);
  }
  static async #onDefend(event, target) {
    const msg = game.messages.get(target.dataset.msg);
    if (msg) await this.actor.rollDefense(target.dataset.type, { ...msg.flags.qin, msgId: msg.id });
  }
  static async #onTakeHit(event, target) {
    const msg = game.messages.get(target.dataset.msg);
    if (msg) await damageDialog(msg.flags.qin, this.actor);
  }
  static async #onDismiss(event, target) { DISMISSED.add(target.dataset.msg); this.render(); }
  static async #onEndTurn() { await game.combat?.nextTurn(); }
  static async #onUseActive(event, target) {
    const item = this.actor.items.get(target.dataset.id);
    if (item) await useActive(this.actor, item);
  }
}


/* ---------------------------------------- the all-in-one parts (David, 2026-11-10) */

const DISMISSED = new Set();
const esc = (x) => foundry.utils.escapeHTML(String(x ?? ""));
const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
const tipList = (title, rows) => `<div class="qin-sig-tip"><div class="qin-sig-tip-hd"><div class="qin-sig-tip-name">${esc(title)}</div></div><div class="qin-sig-tip-bd"><ul class="qin-sig-rules">${rows.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div></div>`;

/** A short name for a level from its text: the words before the first colon or full stop, at most four words. */
function shortLevelName(text) {
  const head = String(text).split(/[:.(]/)[0].trim();
  const words = head.split(/\s+/);
  return words.length <= 4 ? head : `${words.slice(0, 4).join(" ")}…`;
}

function glanceOf(actor, combatant) {
  const sys = actor.system;
  const pdRows = (sys.pdParts ?? []).map(p => `${p.label} ${sgn(p.value)}`);
  const adRows = (sys.bonusList ?? []).filter(b => b.stat === "ad" && b.mode !== "situational").map(b => `${b.label}: ${b.text}`);
  const water = sys.aspects?.water ?? 0, pen = sys.armor?.movementPenalty ?? 0;
  const move = Math.max(0, water - pen);
  return [
    { label: "Passive Def.", value: sys.passiveDefense ?? "—", tip: tipList(`Passive Defense ${sys.passiveDefense}`, pdRows.length ? pdRows : ["Water + Wood + 2"]) },
    { label: "Active Def.", value: sgn(sys.activeDefenseBonus || 0), tip: tipList("Active Defense bonus", adRows.length ? adRows : ["Block: Water + weapon Skill + Yin/Yang", "Dodge: Water + Dodging + Yin/Yang", "No standing bonus"]) },
    { label: "Armor", value: sys.armor?.protection ?? 0, tip: tipList(`Protection ${sys.armor?.protection ?? 0}`, [sys.armor?.name || "No armour", ...(sys.armor?.defenseBonus ? [`Shield: Block +${sys.armor.defenseBonus}`] : []), ...(pen ? [`Movement −${pen} (protection over Metal)`] : [])]) },
    { label: "Initiative", value: combatant?.initiative ?? "—", tip: tipList("Initiative", ["Water + Yin/Yang die, rerolled every round", combatant?.initiative == null ? "Not rolled yet" : `This round: ${combatant.initiative}`]) },
    { label: "Move", value: `${move} yd`, tip: tipList(`Movement ${move} yards`, [`Water ${water}${pen ? `, armour −${pen}` : ""}`, "Moved by hand on the map"]) },
  ];
}

/** The newest hit against him this round that he hasn't defended or taken yet. */
function incomingFor(actor, fight) {
  if (!fight) return null;
  const msgs = game.messages.contents;
  for (let i = msgs.length - 1, n = 0; i >= 0 && n < 60; i--, n++) {
    const f = msgs[i].flags?.qin;
    if (!f?.kind) continue;
    if (f.kind === "damage" && f.target === actor.uuid) return null;
    if (f.kind === "defense" && f.defender === actor.uuid) return null;
    if (f.kind !== "attack" || f.target !== actor.uuid) continue;
    if (!f.hit || DISMISSED.has(msgs[i].id) || f.fight?.id !== fight.id || f.fight?.round !== fight.round) return null;
    const who = f.attacker ? fromUuidSync(f.attacker) : null;
    return { msg: msgs[i].id, attacker: who?.name ?? "Someone", total: f.total, st: f.st, damage: f.damage, ranged: f.ranged, isGM: game.user.isGM };
  }
  return null;
}

function targetInfo(actor) {
  const t = [...game.user.targets][0];
  if (!t?.actor || t.actor === actor) return null;
  const me = canvas.tokens?.placeables.find(p => p.actor === actor);
  let yd = null;
  try { if (me) yd = Math.round(canvas.grid.measurePath([me.center, t.center]).distance); } catch { /* no grid */ }
  const pd = t.actor.type === "unit" ? null : t.actor.system.passiveDefense;
  return { name: t.name, pd, yd, units: canvas.scene?.grid?.units || "yd" };
}

function weaponsOf(actor) {
  return actor.items.filter(i => i.type === "weapon" && i.system.equipped).map(w => {
    const sk = actor.getSkill(w.system.skill), r = w.system.range;
    const range = w.system.isRanged ? [r.c, r.m, r.l, r.e].filter(Boolean).join(" / ") + " yd" : "close combat";
    return { id: w.id, name: w.name, img: w.img, sub: `${sk.label} ${SKILL_LEVELS[sk.value] ?? ""} · damage ${w.system.damage}${w.system.attackModifier ? ` · attack ${sgn(w.system.attackModifier)}` : ""} · ${range}` };
  });
}

function techniquesOf(actor) {
  return actor.items.filter(i => i.type === "technique").map(t => {
    const text = (t.system.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { name: t.name, tip: tipList(t.name, [`${t.system.roll === "defense" ? "Block / Dodge" : t.system.roll === "attack" ? "Attack" : "Other"} · ST +${t.system.stIncrease}`, ...(text ? [text] : []), "Chosen in the Attack or Block window"]) };
  });
}

/** Live updates: the actor, its items and the combat. */
/** I (David, 2026-11-10; C is Foundry's own character-sheet key): the Combat panel of the selected token's character, else your own character; press again to close it. */
export function togglePanelKey() {
  const tok = canvas?.tokens?.controlled?.find(t => t.actor && t.actor.type !== "unit");
  const actor = tok?.actor ?? game.user.character;
  if (!actor || actor.type === "unit") return ui.notifications.info("Select a character's token first (or have a character assigned to you).");
  const app = CombatPanel.instances.get(actor.uuid);
  if (app?.rendered) return app.close();
  CombatPanel.open(actor);
}

/** Alt+click on a character's token (David, 2026-11-10): its Combat panel (shift-click stays Foundry's add-to-selection). */
function onAltClick(ev) {
  if (!ev.altKey || ev.button !== 0 || ev.shiftKey || ev.ctrlKey || !canvas?.ready || ev.target !== canvas.app?.view) return;
  const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX, y: ev.clientY });
  const hits = (canvas.tokens?.placeables ?? []).filter(t => t.visible && t.actor && t.actor.type !== "unit" && t.actor.isOwner && t.bounds?.contains(p.x, p.y));
  const tok = hits.sort((a, b) => (b.document.sort ?? 0) - (a.document.sort ?? 0))[0];
  if (!tok) return;
  ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
  CombatPanel.open(tok.actor);
}

export function registerCombatPanel() {
  Hooks.once("ready", () => document.addEventListener("pointerdown", onAltClick, true));
  Hooks.once("init", () => game.keybindings.register("qin", "combatPanel", {
    name: "Open the Combat panel", hint: "Of the selected token's character, or your own character if none is selected; press again to close it.",
    editable: [{ key: "KeyI" }], precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { togglePanelKey(); return true; },
  }));
  let pending = null;
  const all = () => { clearTimeout(pending); pending = setTimeout(() => CombatPanel.refresh(), 30); };
  setCombatStateChangeHandler(all);
  Hooks.on("updateActor", (actor) => CombatPanel.refresh(actor));
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent?.documentName === "Actor") CombatPanel.refresh(item.parent); });
  Hooks.on("createChatMessage", (m) => { if (m.flags?.qin?.kind) all(); });
  Hooks.on("targetToken", (user) => { if (user === game.user) all(); });
  for (const h of ["updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "createCombat", "combatStart"]) Hooks.on(h, all);
  // Unlinked tokens' actors change through their token
  // Token moves change who is engaged with whom: refresh every open panel
  Hooks.on("updateToken", (tok, change) => { if ("x" in change || "y" in change) all(); else if (tok.actor) CombatPanel.refresh(tok.actor); });
}
