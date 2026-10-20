// Chat card buttons: Block / Dodge / Apply damage on attack cards.
import { formDialog, renderTemplate, Chat } from "./dice.mjs";

export function onRenderChatMessage(message, html) {
  const flags = message.flags?.qin;
  if (!flags?.kind) return;
  html.querySelectorAll("[data-qin-action]").forEach((btn) => {
    const action = btn.dataset.qinAction;
    if (action === "applyDamage" && !game.user.isGM) { btn.remove(); return; }
    if (action === "defend") {
      const target = flags.target ? fromUuidSync(flags.target) : null;
      const canDefend = game.user.isGM || target?.isOwner || (!target && game.user.character);
      if (!canDefend) { btn.remove(); return; }
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
  if (action === "applyDamage") {
    let actor = flags.target ? await fromUuid(flags.target) : null;
    if (!actor) actor = canvas.tokens?.controlled?.[0]?.actor;
    if (!actor) return ui.notifications.warn("No target on the card: select the token to damage.");
    const content = await renderTemplate("templates/dialog/damage.hbs", {
      name: actor.name, damage: flags.damage, protection: actor.system.armor?.protection ?? 0, pierce: flags.pierce || 0,
    });
    const fd = await formDialog({ title: `Damage ${actor.name}`, content, okLabel: "Apply" });
    if (!fd) return;
    const text = await actor.applyDamage(Number(fd.damage) || 0, {
      protection: Number(fd.protection) || 0, pierce: Number(fd.pierce) || 0, reduction: Number(fd.reduction) || 0,
    });
    if (text) Chat().create({ content: `<div class="qin-chat"><p>${text}</p></div>`, speaker: { alias: "Damage" } });
  }
}
