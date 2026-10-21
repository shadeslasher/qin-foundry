import test from "node:test";
import assert from "node:assert";
import * as M from "./mocks.mjs";
const { CharacterData, UnitData } = await import("../module/data/actor-models.mjs");
const A = await import("../module/battle/adapter.mjs");

const skills = (o = {}) => {
  const out = {};
  for (const k of ["jianshu", "qiangshu", "command", "dodging", "perception", "horsemanship", "acrobatics", "meditation", "calligraphy"]) out[k] = { value: o[k] ?? 0, spec: "" };
  return out;
};

function character(aspects, sk, items = []) {
  const d = Object.assign(new CharacterData(), {
    aspects, skills: sk, pdBonus: 0, chi: { value: 0, bonus: 0 }, bol: { damage: 0, override: [0, 0, 0, 0, 0] },
  });
  d.parent = { items };
  d.prepareDerivedData();
  return d;
}

test("character derived data matches the book's Xian", () => {
  const d = character({ metal: 4, water: 3, fire: 2, wood: 2, earth: 3 }, skills({ jianshu: 2, horsemanship: 2, perception: 2, acrobatics: 1, meditation: 1, calligraphy: 1 }));
  assert.strictEqual(d.chi.max, 12);
  assert.strictEqual(d.passiveDefense, 7);
  assert.strictEqual(d.bol.total, 17);
  assert.deepStrictEqual(d.bol.levels.map(l => l.max), [6, 5, 3, 2, 1]);
});

test("Strengthened Body item adds boxes; armor sets the movement penalty", () => {
  const items = [{ type: "tao", system: { key: "strengthenedBody", level: 3 } }, { type: "armor", system: { equipped: true, protection: 5, defenseBonus: 0 } }];
  const d = character({ metal: 4, water: 3, fire: 2, wood: 2, earth: 3 }, skills({ jianshu: 2 }), items);
  assert.deepStrictEqual(d.bol.levels.map(l => l.max), [10, 7, 3, 2, 1]);
  assert.strictEqual(d.armor.movementPenalty, 1);
});

test("battle adapter: a full officer turn through Foundry tokens", async () => {
  const gm = M.addUser("gm", true), alice = M.addUser("alice", false);
  game.user = gm;
  M.setSetting("battle", A.emptyBattle());
  M.setSetting("formations", A.defaultFormations());
  M.setSetting("manageStealth", true);
  M.setSetting("rotateFacing", true);

  const officer = M.makeActor({ type: "character", uuid: "Actor.wenping", system: { name: "Wen Ping", aspects: { metal: 3, water: 3, fire: 3, wood: 3, earth: 4 }, skills: skills({ qiangshu: 4, command: 4 }) },
    items: [{ name: "Unyielding Defender", type: "signature", system: { slot: "battlePassive", moraleCost: 0, effects: { noRearAgainst: true, ignoreMoralePenalty: false, ignoreEncirclement: false, moveBonus: 0, chargeAttackBonus: 0, extraMoraleLossOnWin: 0 }, description: "" } },
      { name: "Hold the Ford!", type: "signature", system: { slot: "battleActive", moraleCost: 20, effects: {}, description: "<p>+1 defending</p>" } }] });
  const unitSystem = (o) => {
    const u = Object.assign(new UnitData(), { side: "player", faction: "Han", tier: 2, category: "infantry", weaponSkill: "qiangshu", unitValue: 2, damage: 6, armor: 3, armorPen: 0, move: 4, range: 1, rangeMin: 1, men: { value: 100, max: 100 }, xp: { value: 0, max: 100 }, morale: 50, formation: "none", hidden: false, status: "active", officer: "", ...o });
    u.prepareDerivedData();
    return u;
  };
  const scene = M.makeScene("field");
  const shieldWall = { id: "fsw", type: "formation", name: "Shield Wall", system: { moveMod: -1, defFront: 2, vsCharge: null, description: "" } };
  const ally = M.makeActor({ type: "unit", owners: ["alice"], items: [shieldWall], system: unitSystem({ officer: "Actor.wenping" }) });
  const foe = M.makeActor({ type: "unit", system: unitSystem({ side: "enemy", faction: "Yellow Turban", weaponSkill: "jianshu" }) });
  const tA = M.addToken(scene, { id: "tokA", name: "Wen Ping's Ji Infantry", x: 2, y: 2, actor: ally });
  const tE = M.addToken(scene, { id: "tokE", name: "Yellow Turbans", x: 2, y: 6, actor: foe });

  let r = await A.runAction("gm", { type: "startBattle", sceneId: "field" });
  assert.ok(r.ok, r.error);
  r = await A.runAction("alice", { type: "setFormation", unitId: "tokA", formation: "tokA.fsw" });
  assert.ok(r.ok, r.error);
  assert.strictEqual(ally.system.formation, "fsw", "formation (item id) written to the actor");
  r = await A.runAction("gm", { type: "startRound" });
  assert.ok(r.ok, r.error);
  let b = A.getBattle();
  assert.deepStrictEqual(b.turn.order, ["tokA"], "only the officer unit has initiative");
  r = await A.runAction("bob", { type: "decide", unitId: "tokA", choice: "act" });
  assert.ok(!r.ok, "someone else can't act for Alice's unit");
  r = await A.runAction("alice", { type: "decide", unitId: "tokA", choice: "act" });
  assert.ok(r.ok, r.error);
  // The Battle Active signature skill works as the officer's battle skill (costs 20 morale)
  ally.system.morale = 60;
  r = await A.runAction("alice", { type: "useSkill", unitId: "tokA" });
  assert.ok(r.ok, r.error);
  assert.strictEqual(ally.system.morale, 40);

  // Alice drags her token 3 tiles down (Shield Wall: movement 3)
  tA.y = 5 * 100;
  await A.onTokenMoved(tA, { y: 500 }, {});
  b = A.getBattle();
  assert.strictEqual(b.turn.activation.step, "act");
  assert.deepStrictEqual(b.meta.tokA.pos, { x: 2, y: 5 });
  assert.strictEqual(tA.rotation, 0, "token turned to face down (its move direction)");

  const chatBefore = M.chat.length;
  r = await A.runAction("alice", { type: "attack", unitId: "tokA", targetId: "tokE" });
  assert.ok(r.ok, r.error);
  assert.ok(foe.system.men.value < 100, "enemy took casualties");
  // XP: casualties dealt x (enemy tier / own tier) — same tier here
  assert.strictEqual(ally.system.xp.value, 100 - foe.system.men.value, "XP equals casualties dealt at equal tier");
  const allyCasualties = 100 - ally.system.men.value;
  const allyXpBefore = ally.system.xp.value;
  assert.ok(M.chat.length > chatBefore && /attacks/.test(M.chat.at(-1).content), "attack posted to chat");
  b = A.getBattle();
  assert.strictEqual(b.turn.phase, "officerless", "turn handed on after the attack");

  // A token moved outside its turn is simply recorded
  tE.x = 4 * 100;
  await A.onTokenMoved(tE, { x: 400 }, {});
  b = A.getBattle();
  assert.deepStrictEqual(b.meta.tokE.pos, { x: 4, y: 6 });

  r = await A.runAction("alice", { type: "endBattle" });
  assert.ok(!r.ok, "only the GM ends battles");
  r = await A.runAction("gm", { type: "endBattle" });
  assert.ok(r.ok && !A.getBattle().active);
  assert.strictEqual(ally.system.xp.value, Math.max(0, allyXpBefore - allyCasualties), "after battle, XP drops by casualties suffered");
});
