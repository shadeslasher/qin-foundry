// Qin personal combat: rounds split into exchanges, each combatant has a pool of actions per round
// (from the martial Skill they declare). Their turn in an exchange uses one action; so does each
// Block or Dodge. Initiative stays fixed for the whole round.
import { SKILLS, SKILL_LEVELS, SYSTEM_ID } from "./config.mjs";
import { actionsPerRound } from "./rules/qin-rules.mjs";

const QUERY = `${SYSTEM_ID}.combat`;

/** Martial skills the actor could declare this round, best first. */
export function martialOptions(actor) {
  const out = [];
  for (const [key, s] of Object.entries(SKILLS)) {
    if (!s.martial) continue;
    out.push({ key, label: s.label, value: actor?.system?.skills?.[key]?.value ?? 0 });
  }
  for (const i of actor?.items ?? []) if (i.type === "skill" && i.system.martial) out.push({ key: i.id, label: i.name, value: i.system.value ?? 0 });
  return out.sort((a, b) => b.value - a.value);
}

function skillLevel(actor, key) {
  return martialOptions(actor).find(o => o.key === key)?.value;
}

/** { max, spent, skill } for a combatant (computed if not stored yet). */
export function getActions(c) {
  const stored = c?.getFlag?.(SYSTEM_ID, "actions") ?? c?.flags?.[SYSTEM_ID]?.actions;
  if (stored && Number.isFinite(stored.max)) return { max: stored.max, spent: stored.spent || 0, skill: stored.skill ?? null };
  return freshActions(c);
}
function freshActions(c, skill) {
  const opts = martialOptions(c?.actor);
  const key = skill && opts.some(o => o.key === skill) ? skill : opts[0]?.key ?? null;
  const level = key ? skillLevel(c?.actor, key) ?? 0 : 0;
  return { max: actionsPerRound(level), spent: 0, skill: key };
}
export function remainingActions(c) {
  const a = getActions(c);
  return Math.max(0, a.max - a.spent);
}

/** Combatant updates that reset everyone's pool for a new round (keeping their declared skill). */
export function resetActionUpdates(combat) {
  return combat.combatants.map(c => ({ _id: c.id, [`flags.${SYSTEM_ID}.actions`]: freshActions(c, getActions(c).skill) }));
}

/** Exchanges this round = the most actions anyone has. */
export function maxExchanges(combat) {
  let m = 1;
  for (const c of combat.combatants) if (!c.isDefeated) m = Math.max(m, getActions(c).max);
  return m;
}

async function writeActions(c, actions) {
  const update = { [`flags.${SYSTEM_ID}.actions`]: actions };
  if (game.user.isGM || c.isOwner) {
    try { return await c.update(update); } catch (e) { if (game.user.isGM) throw e; }
  }
  return askGM({ type: "set", combatId: c.parent.id, combatantId: c.id, actions });
}

/** Spend (positive) or refund (negative) actions. */
export async function changeSpent(c, delta) {
  const a = getActions(c);
  a.spent = Math.max(0, Math.min(a.max + 5, a.spent + delta));
  return writeActions(c, a);
}

export async function declareSkill(c, key) {
  const a = getActions(c);
  const fresh = freshActions(c, key);
  return writeActions(c, { ...fresh, spent: Math.min(a.spent, fresh.max + 5) });
}

/** The combatant for this actor in the active, started combat (if any). */
export function activeCombatantFor(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return null;
  const byActor = combat.combatants.find(c => c.actor === actor);
  if (byActor) return byActor;
  if (!actor.id) return null;
  return combat.combatants.find(c => c.actorId === actor.id && (!actor.isToken || c.tokenId === actor.token?.id)) ?? null;
}

/**
 * Called before a Block / Dodge. Uses an action if the defender is in combat.
 * Returns false if the player chose not to defend.
 */
export async function spendDefenseAction(actor) {
  const c = activeCombatantFor(actor);
  if (!c) return true;
  if (remainingActions(c) <= 0) {
    const Dlg = foundry.applications.api.Dialog ?? foundry.applications.api.DialogV2;
    const ok = await Dlg.confirm({
      window: { title: "No actions left" },
      content: `<p><b>${foundry.utils.escapeHTML?.(c.name) ?? c.name}</b> has used all their actions this round.</p><p>Defend anyway (for example with the Tao of the Invisible Shield's Chi Block)? No action will be marked.</p>`,
    });
    return !!ok;
  }
  await changeSpent(c, 1);
  return true;
}

/* ---------------------------------------- GM relay for players */

async function askGM(payload) {
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications.warn("The GM needs to be connected."); return null; }
  try { return await gm.query(QUERY, { userId: game.user.id, ...payload }, { timeout: 15000 }); }
  catch (e) { ui.notifications.warn(e.message); return null; }
}

export function requestNextTurn(combat) {
  return askGM({ type: "next", combatId: combat.id });
}

export function registerCombatQuery() {
  CONFIG.queries[QUERY] = async ({ userId, type, combatId, combatantId, actions }) => {
    const user = game.users.get(userId);
    const combat = game.combats.get(combatId);
    if (!user || !combat) return { ok: false };
    if (type === "next") {
      if (!combat.combatant?.testUserPermission(user, "OWNER")) return { ok: false };
      await combat.nextTurn();
      return { ok: true };
    }
    if (type === "set") {
      const c = combat.combatants.get(combatantId);
      if (!c?.testUserPermission(user, "OWNER")) return { ok: false };
      await c.update({ [`flags.${SYSTEM_ID}.actions`]: actions });
      return { ok: true };
    }
    return { ok: false };
  };
}

/* ---------------------------------------- Combat tracker display */

export function onRenderCombatTracker(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const combat = app.viewed ?? game.combat;
  if (!root || !combat) return;
  root.querySelectorAll(".qin-actions, .qin-exchange").forEach(e => e.remove());

  if (combat.started) {
    const ex = document.createElement("div");
    ex.className = "qin-exchange";
    ex.textContent = `Exchange ${combat.getFlag(SYSTEM_ID, "exchange") ?? 1} / ${maxExchanges(combat)}`;
    const title = root.querySelector(".encounter-title");
    if (title) title.after(ex);
    else (root.querySelector(".combat-tracker-header, header") ?? root).append(ex);
  }

  for (const li of root.querySelectorAll("li.combatant[data-combatant-id]")) {
    const c = combat.combatants.get(li.dataset.combatantId);
    if (!c || c.actor?.type === "unit") continue;
    const a = getActions(c);
    const left = Math.max(0, a.max - a.spent);
    const extra = Math.max(0, a.spent - a.max);
    const el = document.createElement("div");
    el.className = "qin-actions";
    const level = a.skill ? skillLevel(c.actor, a.skill) : 0;
    const skillName = martialOptions(c.actor).find(o => o.key === a.skill)?.label ?? "no martial skill";
    el.dataset.tooltip = `${left} of ${a.max} actions left (${skillName}, ${SKILL_LEVELS[level] ?? ""})` +
      (c.isOwner ? "<br>Click: use one · Right-click: give one back · Shift-click: declare skill" : "");
    el.innerHTML = Array.from({ length: a.max }, (_, i) => `<i class="qin-pip ${i < left ? "full" : ""}"></i>`).join("") +
      (extra ? `<span class="qin-pip-extra">+${extra}</span>` : "");
    if (c.isOwner) {
      el.classList.add("editable");
      el.addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.shiftKey) return declareDialog(c);
        changeSpent(c, 1);
      });
      el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); changeSpent(c, -1); });
    }
    const anchor = li.querySelector(".token-name") ?? li;
    anchor.append(el);
  }
}

async function declareDialog(c) {
  const opts = martialOptions(c.actor);
  if (!opts.length) return ui.notifications.info(`${c.name} has no martial skills.`);
  const cur = getActions(c).skill;
  const Dlg = foundry.applications.api.Dialog ?? foundry.applications.api.DialogV2;
  const content = `<p>Martial skill declared this round (sets the number of actions):</p>
    <select name="skill" style="width:100%">${opts.map(o => `<option value="${o.key}" ${o.key === cur ? "selected" : ""}>${o.label} — ${SKILL_LEVELS[o.value]} (${actionsPerRound(o.value)} actions)</option>`).join("")}</select>`;
  const key = await Dlg.prompt({
    window: { title: `${c.name}: declare skill` }, content,
    ok: { label: "Declare", callback: (event, button) => button.form.elements.skill.value },
    rejectClose: false,
  });
  if (key) declareSkill(c, key);
}
