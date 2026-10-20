import { rollYinYang, renderTemplate, Chat } from "../dice.mjs";
import { remainingActions, resetActionUpdates, maxExchanges, changeSpent, requestNextTurn } from "../combat-actions.mjs";

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

  /** Current exchange within the round (1-based). */
  get exchange() { return this.getFlag("qin", "exchange") ?? 1; }

  /** Can this combatant still act (has actions left and isn't defeated)? */
  _qinCanAct(c) { return !!c && !c.isDefeated && remainingActions(c) > 0; }

  async startCombat() {
    if (game.user.isGM) await this.updateEmbeddedDocuments("Combatant", resetActionUpdates(this));
    const r = await super.startCombat();
    if (game.user.isGM) await this.update({ "flags.qin.exchange": 1 });
    return r;
  }

  /**
   * End the current turn: it uses one of the combatant's actions. Then the next combatant (by
   * initiative) with actions left acts. When everyone has had their go, a new exchange starts
   * from the top; when nobody has actions left (or the last exchange is done), a new round.
   */
  async nextTurn() {
    if (!game.user.isGM) { await requestNextTurn(this); return this; }
    const current = this.combatant;
    if (current && remainingActions(current) > 0) await changeSpent(current, 1);
    const turns = this.turns;
    for (let i = (this.turn ?? -1) + 1; i < turns.length; i++) {
      if (this._qinCanAct(turns[i])) return this.update({ turn: i }, { direction: 1 });
    }
    const next = this.exchange + 1;
    const first = turns.findIndex(c => this._qinCanAct(c));
    if (first >= 0 && next <= maxExchanges(this)) {
      return this.update({ turn: first, "flags.qin.exchange": next }, { direction: 1 });
    }
    return this.nextRound();
  }

  /** New round: everyone's actions refresh, and initiative is rerolled (Qin rerolls every round). */
  async nextRound() {
    if (!game.user.isGM) return this;
    await this.updateEmbeddedDocuments("Combatant", resetActionUpdates(this));
    const r = await super.nextRound();
    if (game.settings.get("qin", "rerollInitiative")) {
      await this.rollInitiative(this.combatants.map(c => c.id), { updateTurn: false });
    }
    const first = Math.max(0, this.turns.findIndex(c => this._qinCanAct(c)));
    await this.update({ turn: first, "flags.qin.exchange": 1 });
    return r;
  }
}
