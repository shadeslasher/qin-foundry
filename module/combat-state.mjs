// Personal-combat state on an actor (David, 2026-11-05): Taos in effect (timed, this exchange, rest of fight),
// effects waiting for the next roll ("Next attack", "Next hit taken"...), ticked situational bonuses and the
// first hit taken each round. Stored in flags.qin.combatState; the GM's client expires timed effects as rounds pass.
import { SYSTEM_ID, rechargeStatus, rechargeLabel, isActiveSlot } from "./config.mjs";
import { normalizeCombatState, resolveTao, tickEffects, expireCombat, QUEUE_SLOTS } from "./rules/tao-rules.mjs";
import { collectBonuses } from "./rules/bonuses.mjs";
import * as Q from "./rules/qin-rules.mjs";
import { Chat } from "./dice.mjs";

const QUERY = `${SYSTEM_ID}.combatState`;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
/** "Tao of the Invisible Shield" -> "Invisible Shield". */
export const shortTao = (name) => String(name ?? "").replace(/^Tao of (the )?/i, "");
const uid = () => foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 12);

/** The running fight on the tracker as { id, round, exchange }, or null. */
export function currentFight() {
  const c = game.combat;
  return c?.started && c.round > 0 ? { id: c.id, round: c.round, exchange: c.getFlag?.(SYSTEM_ID, "exchange") ?? 1 } : null;
}

export const getState = (actor) => normalizeCombatState(actor?.flags?.[SYSTEM_ID]?.combatState);

export async function saveState(actor, state, extra = {}) {
  return actor.update({ [`flags.${SYSTEM_ID}.combatState`]: state, ...extra });
}

/** The actor's known Tao by key: { item, level }. */
export function taoOf(actor, key) {
  const item = actor?.items?.find?.(i => i.type === "tao" && i.system.key === key) ?? null;
  return { item, level: Number(item?.system?.level) || 0 };
}

/** Queued effects for one slot (attack, hitTaken, defense, initiative). */
export const queuedFor = (actor, slot) => getState(actor).queued.filter(q => q.slot === slot);

export async function removeQueued(actor, id) {
  const st = getState(actor);
  st.queued = st.queued.filter(q => q.id !== id);
  return saveState(actor, st);
}

/** Chi for a set of queued effects that a roll has just used, and take them off the queue. Returns the update to merge. */
export function consumeUpdate(actor, ids, state = getState(actor)) {
  const used = state.queued.filter(q => ids.includes(q.id));
  state.queued = state.queued.filter(q => !ids.includes(q.id));
  const cost = used.reduce((t, q) => t + (Number(q.cost) || 0), 0);
  const update = { [`flags.${SYSTEM_ID}.combatState`]: state };
  if (cost && actor.type === "character") {
    const { chi, damage } = Q.spendChi(actor.system.chi.value, cost);
    update["system.chi.value"] = chi;
    if (damage) update["system.bol.damage"] = (actor.system.bol.damage || 0) + damage;
  }
  return { update, cost, used };
}

export async function endEffect(actor, id) {
  const st = getState(actor);
  st.effects = st.effects.filter(e => e.id !== id);
  return saveState(actor, st);
}

export async function setSituational(actor, key, on) {
  return actor.update({ [`flags.${SYSTEM_ID}.combatState.situational.${key.replace(/\./g, "_")}`]: !!on });
}
/** Ticked situational bonuses: { key: true }. Keys with dots are stored with underscores. */
export function tickedOf(actor) {
  const raw = getState(actor).situational, out = {};
  for (const [k, v] of Object.entries(raw)) if (v) out[k] = true;
  return out;
}
export const sitKey = (key) => String(key).replace(/\./g, "_");

/* ---------------------------------------- Taos */

/**
 * Use an automated Tao effect: queue it (Chi spent when a roll uses it), or start it now (Chi spent now).
 * Levels with no automation keep the plain behaviour: spend Chi equal to the level, post the effect.
 */
export async function activateTao(actor, item, level, { quiet = false } = {}) {
  const lvlKnown = Number(item.system.level) || 0;
  const r = resolveTao(item.system.key, level, lvlKnown, actor.system.aspects);
  if (!r) return plainTaoUse(actor, item, Number(level));
  const fight = currentFight();
  const st = getState(actor);
  if (r.kind === "queue") {
    if (st.queued.some(q => q.key === r.id)) return ui.notifications.info(`${r.name} is already waiting for the ${QUEUE_SLOTS[r.slot].toLowerCase()}.`);
    st.queued.push({ id: uid(), key: r.id, slot: r.slot, label: level === "any" ? `${shortTao(item.name)} ${lvlKnown}` : `${shortTao(item.name)} ${lvlKnown}, ${r.name}`, short: r.name,
      text: r.text, value: r.value, cost: r.cost, free: r.free, kind: "tao" });
    await saveState(actor, st);
    if (!quiet) await taoCard(actor, item, r, `Ready for the ${QUEUE_SLOTS[r.slot].toLowerCase()}: ${r.cost} Chi when it is used.`);
    return r;
  }
  if (st.effects.some(e => e.key === r.id)) return ui.notifications.info(`${r.name} is already in effect.`);
  const eff = { id: uid(), key: r.id, label: r.name, source: shortTao(item.name), kind: "tao", effect: r.kind === "exchange" ? r.stat : r.effect,
    value: r.value, combat: fight?.id ?? "", round: fight?.round ?? 0 };
  if (r.kind === "exchange") eff.exchange = fight?.exchange ?? 1;
  else eff.rounds = r.rounds;
  st.effects.push(eff);
  const { chi, damage } = Q.spendChi(actor.system.chi?.value ?? 0, actor.type === "character" ? r.cost : 0);
  const extra = actor.type === "character" ? { "system.chi.value": chi, ...(damage ? { "system.bol.damage": actor.system.bol.damage + damage } : {}) } : {};
  await saveState(actor, st, extra);
  if (damage) ui.notifications.warn(`${actor.name} draws on negative Chi: ${damage} damage taken (${r.name}).`);
  const lasts = r.kind === "exchange" ? "this exchange" : fight ? `${r.rounds} round${r.rounds === 1 ? "" : "s"}` : `${r.rounds} rounds (end it by hand outside a fight)`;
  if (!quiet) await taoCard(actor, item, r, `−${r.cost} Chi · ${lasts}`);
  if (r.kind === "exchange" && r.stat === "pd") await recheckLatestAttack(actor);
  return r;
}

async function taoCard(actor, item, r, line) {
  return Chat().create({
    speaker: Chat().getSpeaker({ actor }),
    content: `<div class="qin-chat"><h3><span class="qin-src qin-src-tao">Tao</span> ${esc(item.name)}: ${esc(r.name)}</h3><p>${esc(r.text)}</p><p class="qin-muted">${esc(line)}</p></div>`,
  });
}

/** The book behaviour for any other Tao level: spend Chi equal to the level and post the effect. */
export async function plainTaoUse(actor, item, lvl) {
  await actor.spendChi(lvl, item.name);
  const effect = item.system.effects?.[`l${lvl}`] ?? "";
  await Chat().create({
    speaker: Chat().getSpeaker({ actor }),
    content: `<div class="qin-chat"><h3><span class="qin-src qin-src-tao">Tao</span> ${esc(item.name)} — Level ${lvl}</h3><p>${esc(effect)}</p><p class="qin-muted">−${lvl} Chi</p></div>`,
  });
  return null;
}

/* ---------------------------------------- unique actives */

const ATTACK_STATS = new Set(["attack", "damage"]);
export const activeHasAttackBonus = (item) => (item.system.bonuses ?? []).some(b => ATTACK_STATS.has(b.stat));

/** Spend an active's Chi and start its recharge. Returns false (with a warning) while it recharges. */
export async function markActiveUsed(actor, item) {
  const fight = currentFight(), status = rechargeStatus(item.system, fight);
  if (!status.ready) { ui.notifications.warn(`${item.name}: ${status.text}.`); return false; }
  if (item.system.chiCost) await actor.spendChi(item.system.chiCost, item.name);
  if (fight) await item.update({ "system.lastUse": { combat: fight.id, round: fight.round } });
  return true;
}

/**
 * Use an in-person active. Attack actives (attack/damage bonuses) open the attack dialog with their bonuses already
 * applied (the Chi and recharge are taken when the attack is rolled). Others spend Chi, start the recharge and post;
 * their other bonuses (Passive Defense, Active Defense...) stay in effect for the rest of the fight if once per fight,
 * for the recharge's rounds otherwise (1 round when there is none).
 */
export async function useActive(actor, item) {
  const status = rechargeStatus(item.system, currentFight());
  if (!status.ready) return ui.notifications.warn(`${item.name}: ${status.text}.`);
  if (activeHasAttackBonus(item)) {
    const weapon = await pickWeapon(actor);
    if (!weapon) return;
    return actor.rollAttack(weapon, { active: item });
  }
  if (!(await markActiveUsed(actor, item))) return;
  const fight = currentFight();
  const others = (item.system.bonuses ?? []).filter(b => !ATTACK_STATS.has(b.stat));
  if (others.length) {
    const st = getState(actor);
    st.effects = st.effects.filter(e => e.sourceId !== item.id);
    const n = Number(item.system.recharge) || 0;
    st.effects.push({ id: uid(), key: `sig.${item.id}`, sourceId: item.id, label: item.name, kind: "unique", bonuses: others.map(b => ({ ...b })),
      combat: fight?.id ?? "", round: fight?.round ?? 0, rounds: item.system.perScene ? 0 : Math.max(1, n), restOfFight: !!item.system.perScene });
    await saveState(actor, st);
  }
  const rl = rechargeLabel(item.system);
  const fx = others.length ? `<p>${collectBonuses([{ id: item.id, name: item.name, bonuses: others }], { aspects: actor.system.aspects }).map(b => esc(b.text + (b.condition ? ` (${b.condition})` : ""))).join(" · ")}</p>` : "";
  await Chat().create({
    speaker: Chat().getSpeaker({ actor }),
    content: `<div class="qin-chat"><h3><span class="qin-src qin-src-unique">Unique</span> ${esc(item.name)}</h3><p class="qin-sig-meta">Used${item.system.chiCost ? ` · ${item.system.chiCost} Chi` : ""}${rl ? ` · ${esc(rl)}` : ""}</p>${fx}${item.system.description || ""}</div>`,
  });
}

/** The weapon for an attack active: the only equipped one, or ask. */
async function pickWeapon(actor) {
  const list = actor.items.filter(i => i.type === "weapon" && i.system.equipped);
  const all = list.length ? list : actor.items.filter(i => i.type === "weapon");
  if (!all.length) { ui.notifications.warn(`${actor.name} has no weapon.`); return null; }
  if (all.length === 1) return all[0];
  const Dlg = foundry.applications.api.DialogV2 ?? foundry.applications.api.Dialog;
  const id = await Dlg.prompt({
    window: { title: `${actor.name}: weapon` },
    content: `<select name="w" style="width:100%">${all.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select>`,
    ok: { label: "Attack", callback: (ev, button) => button.form.elements.w.value }, rejectClose: false,
  });
  return id ? actor.items.get(id) : null;
}

/* ---------------------------------------- Chi Defense re-checks the attack */

/** The latest attack card aimed at this actor that hit and hasn't been re-checked. */
function latestAttackOn(actor) {
  const msgs = game.messages?.contents ?? [];
  for (let i = msgs.length - 1; i >= Math.max(0, msgs.length - 30); i--) {
    const f = msgs[i].flags?.[SYSTEM_ID];
    if (f?.kind !== "attack" || f.target !== actor.uuid) continue;
    const fight = currentFight();
    const same = fight ? f.fight?.id === fight.id && f.fight?.round === fight.round && f.fight?.exchange === fight.exchange : !f.fight;
    return f.hit && !f.chiDefense && same ? msgs[i] : null;
  }
  return null;
}

async function recheckLatestAttack(actor) {
  const msg = latestAttackOn(actor);
  if (msg) await recheckAttack(msg, actor);
}

/** New card content and flags for an attack card after the target raised its Passive Defense with Chi Defense. */
export function recheckedCard(message, actor) {
  const f = message.flags[SYSTEM_ID];
  const now = (actor.system.combatEffects ?? []).filter(e => e.effect === "pd" && e.exchange).reduce((t, e) => t + (Number(e.value) || 0), 0);
  const add = now - (Number(f.chiDefIncluded) || 0);
  if (add <= 0 || f.st == null) return null;
  const st = f.st + add, hit = !f.critFail && f.total >= st;
  const div = document.createElement("div");
  div.innerHTML = message.content;
  const tot = div.querySelector(".qin-total");
  if (tot) tot.innerHTML = `Total <b>${f.total}</b> vs Passive Defense <b>${st}</b> <span class="qin-src qin-src-tao">Tao</span> Chi Defense +${add}`;
  const res = div.querySelector(".qin-result");
  if (res) { res.className = `qin-result ${hit ? "ok" : "fail"}`; res.textContent = hit ? `Still hits (margin ${f.total - st})` : "Miss: Chi Defense turns it aside"; }
  if (!hit) { div.querySelector(".qin-buttons")?.remove(); div.querySelector(".qin-damage")?.classList.add("qin-struck"); }
  else div.querySelector('[data-qin-action="chiDefense"]')?.remove();
  return { content: div.innerHTML, flags: { [`flags.${SYSTEM_ID}.st`]: st, [`flags.${SYSTEM_ID}.hit`]: hit, [`flags.${SYSTEM_ID}.chiDefense`]: add } };
}

export async function recheckAttack(message, actor) {
  const out = recheckedCard(message, actor);
  if (!out) return;
  const update = { content: out.content, ...out.flags };
  if (message.canUserModify?.(game.user, "update")) return message.update(update);
  const gm = game.users.activeGM;
  if (!gm) return ui.notifications.warn("The GM needs to be connected to update the attack card.");
  try { await gm.query(QUERY, { type: "recheck", userId: game.user.id, messageId: message.id, update }, { timeout: 15000 }); }
  catch (e) { ui.notifications.warn(e.message); }
}

/* ---------------------------------------- hooks */

/** Panels and sheets to refresh when combat state changes (set by the panel module). */
let onChange = () => {};
export function setCombatStateChangeHandler(fn) { onChange = fn; }

/** GM: drop effects that ran out at this round / exchange, for every actor in the fight. */
async function tickCombat(combat) {
  if (!game.user.isActiveGM) return;
  const fight = { id: combat.id, round: combat.round, exchange: combat.getFlag?.(SYSTEM_ID, "exchange") ?? 1 };
  const seen = new Set();
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || a.type === "unit" || seen.has(a.uuid)) continue;
    seen.add(a.uuid);
    const st = getState(a);
    const { keep, expired } = tickEffects(st.effects, fight);
    if (!expired.length) continue;
    st.effects = keep;
    await saveState(a, st);
    for (const e of expired) if (e.kind === "tao" && !e.exchange) Chat().create({ speaker: Chat().getSpeaker({ actor: a }), content: `<div class="qin-chat"><p class="qin-muted"><span class="qin-src qin-src-tao">Tao</span> ${esc(a.name)}: ${esc(e.label)} ends.</p></div>` });
  }
}

async function endCombatEffects(combat) {
  if (!game.user.isActiveGM) return;
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || a.type === "unit") continue;
    const st = getState(a);
    // Timed effects tied to the fight end with it; queued ones stay (nothing was spent on them yet)
    const effects = expireCombat(st.effects, combat.id);
    if (effects.length !== st.effects.length || st.firstHit) await saveState(a, { ...st, effects, firstHit: null });
  }
}

export function registerCombatState() {
  Hooks.on("updateCombat", (combat, change) => {
    const ex = foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.exchange`);
    if ("round" in change || ex !== undefined || "started" in change) tickCombat(combat).catch(e => console.warn("Qin | combat effects", e));
    onChange();
  });
  Hooks.on("deleteCombat", (combat) => { endCombatEffects(combat).catch(e => console.warn("Qin | combat effects", e)); onChange(); });
  Hooks.once("init", () => {
    CONFIG.queries[QUERY] = async ({ type, userId, messageId, update }) => {
      if (!game.user.isGM || type !== "recheck") return { ok: false };
      const user = game.users.get(userId), msg = game.messages.get(messageId);
      const target = msg?.flags?.[SYSTEM_ID]?.target ? fromUuidSync(msg.flags[SYSTEM_ID].target) : null;
      if (!user || !msg || !target?.testUserPermission(user, "OWNER")) return { ok: false };
      const allowed = {};
      for (const k of ["content", `flags.${SYSTEM_ID}.st`, `flags.${SYSTEM_ID}.hit`, `flags.${SYSTEM_ID}.chiDefense`]) if (k in update) allowed[k] = update[k];
      await msg.update(allowed);
      return { ok: true };
    };
  });
}

export { isActiveSlot };
