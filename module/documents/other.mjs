import { rollYinYang, renderTemplate, Chat } from "../dice.mjs";

export class QinItem extends foundry.documents.Item {
  /** Use the item from its owner's sheet. */
  async use() {
    const actor = this.actor;
    if (!actor) return;
    switch (this.type) {
      case "weapon": return actor.rollAttack(this);
      case "tao": return actor.useTao(this);
      case "magic": return actor.useMagic(this);
      default: return this.toChat();
    }
  }

  async toChat() {
    await Chat().create({
      speaker: Chat().getSpeaker({ actor: this.actor }),
      content: `<div class="qin-chat"><h3>${this.name}</h3>${this.system.description || ""}</div>`,
    });
  }
}

/**
 * Personal (Qin) combat: initiative = Water + Yin/Yang Die, rerolled each round.
 * Ties go to the higher Water value (stored as a decimal).
 */
export class QinCombat extends foundry.documents.Combat {
  async rollInitiative(ids, { updateTurn = true } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    const lines = [];
    for (const id of ids) {
      const c = this.combatants.get(id);
      const actor = c?.actor;
      if (!actor || actor.type === "unit") continue;
      const { roll, dice } = await rollYinYang();
      const water = actor.system.aspects?.water ?? 0;
      const total = water + dice.value;
      updates.push({ _id: id, initiative: total + water / 100 });
      lines.push({ name: c.name, total, water, dice });
      if (dice.chiGain) await actor.gainChi?.(dice.chiGain);
      if (dice.chiLoss) await actor.loseChi?.(dice.chiLoss);
    }
    if (!updates.length) return this;
    const currentId = this.combatant?.id;
    await this.updateEmbeddedDocuments("Combatant", updates);
    if (updateTurn && currentId) await this.update({ turn: this.turns.findIndex(t => t.id === currentId) });
    const content = await renderTemplate("templates/chat/initiative.hbs", { lines });
    await Chat().create({ content, speaker: { alias: "Initiative" } });
    return this;
  }

  /** New round: everyone rerolls initiative (Qin rerolls every round). */
  async nextRound() {
    const r = await super.nextRound();
    if (game.user.isGM && game.settings.get("qin", "rerollInitiative")) {
      await this.rollInitiative(this.combatants.map(c => c.id), { updateTurn: false });
      await this.update({ turn: 0 });
    }
    return r;
  }
}
