// Chat card buttons: Block / Dodge / Apply damage / Chi Defense on attack cards.
import { formDialog, renderTemplate } from "./dice.mjs";
import { getState, taoOf, tickedOf, currentFight, activateTao, rollBonuses } from "./combat-state.mjs";
import { isFirstHitThisRound } from "./rules/tao-rules.mjs";
import { onRenderEffectCard } from "./skill-effects.mjs";

export function onRenderChatMessage(message, html) {
  const flags = message.flags?.qin;
  if (!flags?.kind) return;
  if (flags.kind === "effect") return onRenderEffectCard(message, html, flags);
  html.querySelectorAll("[data-qin-action]").forEach((btn) => {
    const action = btn.dataset.qinAction;
    if (action === "applyDamage" && !game.user.isGM) { btn.remove(); return; }
    if (action === "defend" || action === "chiDefense") {
      const target = flags.target ? fromUuidSync(flags.target) : null;
      const canDefend = game.user.isGM || target?.isOwner || (!target && game.user.character);
      if (!canDefend || (action === "chiDefense" && !target)) { btn.remove(); return; }
    }
    btn.addEventListener("click", (ev) => onClick(ev, message, flags));
  });
}

async function onClick(event, message, flags) {
  event.preventDefault();
  const btn = event.currentTarget;
  const action = btn.dataset.qinAction;
  if (action === "defend") {
    let actor = flags.target ? await fromUuid(flags.target) : null;
    if (!actor) actor = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor) return ui.notifications.warn("Select the defending token first.");
    return actor.rollDefense(btn.dataset.type, flags);
  }
  if (action === "chiDefense") {
    // Invisible Shield 2: + Tao level to Passive Defense for this exchange, before the attack is compared
    const actor = flags.target ? await fromUuid(flags.target) : null;
    const tao = taoOf(actor, "invisibleShield");
    if (!actor || tao.level < 2) return;
    return activateTao(actor, tao.item, 2);
  }
  if (action === "applyDamage") {
    let actor = flags.target ? await fromUuid(flags.target) : null;
    if (!actor) actor = canvas.tokens?.controlled?.[0]?.actor;
    if (!actor) return ui.notifications.warn("No target on the card: select the token to damage.");
    const sys = actor.system;
    // What will come off automatically after armour, shown in the dialog
    const auto = [];
    const ticked = tickedOf(actor);
    for (const h of sys.hitReductions ?? []) auto.push({ kind: "tao", label: `Strengthened Body, ${h.label}`, value: h.value });
    const first = isFirstHitThisRound(getState(actor).firstHit, currentFight());
    for (const b of rollBonuses(actor, flags.attacker ?? null)) {
      if (b.mode === "situational" && !ticked[b.key]) continue;
      if (b.stat === "hitReduction" || (b.stat === "firstHitReduction" && first)) auto.push({ kind: "unique", situational: b.mode === "situational", label: `${b.label}${b.stat === "firstHitReduction" ? " (first hit this round)" : ""}`, value: b.value });
    }
    const shield = taoOf(actor, "invisibleShield").level;
    const content = await renderTemplate("templates/dialog/damage.hbs", {
      name: actor.name, damage: flags.damage, protection: sys.armor?.protection ?? 0, pierce: flags.pierce || 0,
      auto, strongDefense: shield >= 1 ? shield : 0, strongQueued: getState(actor).queued.some(q => q.key === "invisibleShield.1"),
    });
    const fd = await formDialog({ title: `Damage ${actor.name}`, content, okLabel: "Apply" });
    if (!fd) return;
    await actor.applyDamage(Number(fd.damage) || 0, {
      protection: Number(fd.protection) || 0, pierce: Number(fd.pierce) || 0, reduction: Number(fd.reduction) || 0,
      strongDefense: shield >= 1 ? !!fd.strongDefense : false, card: true, attacker: flags.attacker ?? null,
      // the attacker's armour-pierce sources, tagged on the damage card (unless the pierce was changed by hand)
      pierceParts: Number(fd.pierce) === Number(flags.pierce || 0) ? flags.pierceParts ?? [] : [],
    });
  }
}
