// Exchanges & actions: turn order across exchanges, defenses using actions, round reset.
import test from "node:test";
import assert from "node:assert/strict";

class FakeCombatant {
  constructor(combat, id, name, skill, init) {
    Object.assign(this, { parent: combat, id, name, initiative: init, isDefeated: false, isOwner: true, flags: {} });
    this.actor = { type: "character", items: [], system: { skills: { jianshu: { value: skill } }, aspects: { water: 2 } } };
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async update(u) { for (const [k, v] of Object.entries(u)) { const [, scope, key] = k.split("."); (this.flags[scope] ??= {})[key] = structuredClone(v); } return this; }
}
class FakeCombat {
  constructor() { this.round = 1; this.turn = 0; this.flags = {}; this.started = true; this.combatants = []; this.combatants.get = id => this.combatants.find(c => c.id === id); }
  get turns() { return [...this.combatants].sort((a, b) => b.initiative - a.initiative); }
  get combatant() { return this.turns[this.turn]; }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "turn") this.turn = v; else if (k === "round") this.round = v; else { const [, scope, key] = k.split("."); (this.flags[scope] ??= {})[key] = v; } } return this; }
  async updateEmbeddedDocuments(_t, ups) { for (const u of ups) { const c = this.combatants.get(u._id); const { _id, ...rest } = u; await c.update(rest); } }
  async startCombat() { this.round = 1; this.turn = 0; }
  async nextRound() { this.round += 1; this.turn = 0; }
}
globalThis.foundry = { documents: { Combat: FakeCombat, Item: class {} } };
globalThis.game = { user: { isGM: true }, settings: { get: () => false }, combat: null };

const { QinCombat } = await import("../module/documents/other.mjs");
const CA = await import("../module/combat-actions.mjs");

function setup() {
  const combat = new QinCombat();
  // jianshu: Competent(2)=3 actions, Beginner(0)=1 action, Apprentice(1)=2 actions
  combat.combatants.push(new FakeCombatant(combat, "a", "Lu Bu", 2, 15), new FakeCombatant(combat, "b", "Grunt", 0, 12), new FakeCombatant(combat, "c", "Guan Yu", 1, 9));
  game.combat = combat;
  return combat;
}
const who = (combat) => `${combat.round}.${combat.exchange}:${combat.combatant.name}`;

test("exchanges follow initiative and skip characters out of actions", async () => {
  const combat = setup();
  await combat.startCombat();
  const seen = [who(combat)];
  for (let i = 0; i < 6; i++) { await combat.nextTurn(); seen.push(who(combat)); }
  assert.deepEqual(seen, ["1.1:Lu Bu", "1.1:Grunt", "1.1:Guan Yu", "1.2:Lu Bu", "1.2:Guan Yu", "1.3:Lu Bu", "2.1:Lu Bu"]);
  assert.equal(CA.maxExchanges(combat), 3);
  // new round restored everyone's actions
  assert.equal(CA.remainingActions(combat.combatants.get("b")), 1);
});

test("a dodge uses an action, so the defender may lose a later turn", async () => {
  const combat = setup();
  await combat.startCombat();
  // Guan Yu (2 actions) dodges twice before his first turn
  const gy = combat.combatants.get("c");
  assert.equal(await CA.spendDefenseAction(gy.actor), true);
  assert.equal(await CA.spendDefenseAction(gy.actor), true);
  assert.equal(CA.remainingActions(gy), 0);
  const seen = [who(combat)];
  for (let i = 0; i < 4; i++) { await combat.nextTurn(); seen.push(who(combat)); }
  assert.deepEqual(seen, ["1.1:Lu Bu", "1.1:Grunt", "1.2:Lu Bu", "1.3:Lu Bu", "2.1:Lu Bu"]);
});

test("declaring a different martial skill changes the action count", async () => {
  const combat = setup();
  const lb = combat.combatants.get("a");
  lb.actor.system.skills.bangshu = { value: 4 };
  await CA.declareSkill(lb, "bangshu");
  assert.equal(CA.getActions(lb).max, 5);
});
