import test from "node:test";
import assert from "node:assert/strict";
import "./mocks.mjs";
import { collectBonuses, bonusesVs, bonusesByStat, normalizeBonus, describeBonus, attackerSideBonuses, targetAdParts, pdBreakdown, bonusSourcesOf } from "../module/rules/bonuses.mjs";
import { normalizeStack, stackSteps, setSteps, adjustSteps, stackDefs, stackEvent, roundAlreadyCounted, attackedLastRound, droppedLevel, countEngaged, engagedWithAdjust } from "../module/rules/stacks.mjs";
import { normalizeEffect, durationText, durationFields, testText, resistOutcome, outcomeFor, appliedEffect, withEffect, appliedText, testSideParts, sortForPicker, isFriendlyTarget } from "../module/rules/skill-effects.mjs";
import { roundsLeft, tickEffects, expireCombat, liveEffects, effectTotals, damageAfterReductions, normalizeCombatState } from "../module/rules/tao-rules.mjs";
import { buildSkillCompendium, sigSlots } from "../tools/build-skill-compendium.mjs";

const aspects = { metal: 5, water: 4, fire: 4, wood: 3, earth: 5 };

/* ---------------------------------------- growing bonuses */

test("stack: normalization, defaults, resetOn / offset inside stack (or on the bonus)", () => {
  assert.deepEqual(normalizeStack({ trigger: "roundStart", max: 3, resetOn: "moved" }), { trigger: "roundStart", max: 3, resetOn: "moved", offset: 0 });
  assert.deepEqual(normalizeStack({ trigger: "opponentsEngaged", max: 2 }), { trigger: "opponentsEngaged", max: 2, resetOn: "fightEnd", offset: 1 });
  assert.equal(normalizeStack({ trigger: "opponentsEngaged", max: 2, offset: 0 }).offset, 0);
  assert.equal(normalizeStack({ trigger: "hitTaken", max: 3 }, { resetOn: "never" }).resetOn, "never");
  assert.equal(normalizeStack({ trigger: "bogus" }).trigger, "manual");
  assert.equal(normalizeStack(null), null);
  const b = normalizeBonus({ stat: "attack", value: 1, stack: { trigger: "dropOpponent", max: 3 } });
  assert.equal(b.stack.trigger, "dropOpponent");
  assert.equal(normalizeBonus({ stat: "attack", value: -3, vsSource: true }).vsSource, true);
});

test("stack: steps are capped, set / adjust, opponents engaged minus offset", () => {
  const s = normalizeStack({ trigger: "manual", max: 3 });
  let st = setSteps([], "a:0", 5, 3);
  assert.equal(stackSteps(s, st, "a:0"), 3);
  st = adjustSteps(st, "a:0", -1, 3);
  assert.equal(stackSteps(s, st, "a:0"), 2);
  st = adjustSteps(st, "a:0", -5, 3);
  assert.deepEqual(st, []); // 0 steps: the entry goes
  const eng = normalizeStack({ trigger: "opponentsEngaged", max: 3 });
  assert.equal(stackSteps(eng, [], "x", { engaged: 1 }), 0);
  assert.equal(stackSteps(eng, [], "x", { engaged: 3 }), 2);
  assert.equal(stackSteps(eng, [], "x", { engaged: 9 }), 3);
  assert.equal(stackSteps(eng, [], "x", { engaged: null }), 0);
});

test("stack: triggers and resets", () => {
  const list = collectBonuses([{ id: "s", name: "Skill", bonuses: [
    { stat: "ad", value: 1, stack: { trigger: "roundStart", max: 3, resetOn: "moved" } },
    { stat: "attack", value: 1, stack: { trigger: "noAttackLastRound", max: 2, resetOn: "attack" } },
    { stat: "damage", value: 2, stack: { trigger: "dropOpponent", max: 3 } },
    { stat: "pd", value: 1, stack: { trigger: "hitTaken", max: 2, resetOn: "never" } },
    { stat: "pd", value: 5 },
  ] }]);
  const defs = stackDefs(list);
  assert.equal(defs.length, 4);
  let st = [];
  st = stackEvent(st, defs, "roundStart", { firstRound: true }).stacks;
  assert.deepEqual(st, [{ key: "s:0", steps: 1 }]); // round 1: no "last round" yet
  st = stackEvent(st, defs, "roundStart", { attackedLastRound: false }).stacks;
  assert.equal(stackSteps(defs[0].stack, st, "s:0"), 2);
  assert.equal(stackSteps(defs[1].stack, st, "s:1"), 1);
  st = stackEvent(st, defs, "roundStart", { attackedLastRound: true }).stacks;
  assert.equal(stackSteps(defs[0].stack, st, "s:0"), 3);
  assert.equal(stackSteps(defs[1].stack, st, "s:1"), 1); // he attacked last round: no step
  st = stackEvent(st, defs, "roundStart", {}).stacks;
  assert.equal(stackSteps(defs[0].stack, st, "s:0"), 3); // capped at max
  st = stackEvent(st, defs, "attack").stacks;
  assert.equal(stackSteps(defs[1].stack, st, "s:1"), 0); // resets when he attacks
  assert.equal(stackSteps(defs[0].stack, st, "s:0"), 3);
  st = stackEvent(st, defs, "moved").stacks;
  assert.equal(stackSteps(defs[0].stack, st, "s:0"), 0); // resets when he moves
  st = stackEvent(st, defs, "dropOpponent").stacks;
  st = stackEvent(st, defs, "hitTaken").stacks;
  st = stackEvent(st, defs, "hitTaken").stacks;
  st = stackEvent(st, defs, "hitTaken").stacks;
  assert.equal(stackSteps(defs[2].stack, st, "s:2"), 1);
  assert.equal(stackSteps(defs[3].stack, st, "s:3"), 2);
  assert.equal(stackEvent(st, defs, "hitTaken").changed, false);
  const end = stackEvent(st, defs, "fightEnd");
  assert.deepEqual(end.stacks, [{ key: "s:3", steps: 2 }]); // only "never" survives the end of the fight
  // round bookkeeping
  const fight = { id: "c", round: 3 };
  assert.equal(roundAlreadyCounted({ combat: "c", round: 3 }, fight), true);
  assert.equal(roundAlreadyCounted({ combat: "c", round: 2 }, fight), false);
  assert.equal(roundAlreadyCounted({ combat: "other", round: 9 }, fight), false);
  assert.equal(attackedLastRound({ combat: "c", round: 2 }, fight), true);
  assert.equal(attackedLastRound({ combat: "c", round: 3 }, fight), false);
});

test("stack: value × steps in the totals and card labels", () => {
  const sources = [{ id: "z", name: "Unbroken Line", bonuses: [{ stat: "ad", value: 1, stack: { trigger: "roundStart", max: 3 } }, { stat: "attack", value: 1, stack: { trigger: "opponentsEngaged", max: 3, offset: 1 } }] }];
  const list = collectBonuses(sources, { aspects, stacks: [{ key: "z:0", steps: 2 }], engaged: 3 });
  assert.equal(list[0].value, 2);
  assert.equal(list[0].label, "Unbroken Line (2/3)");
  assert.equal(list[0].text, "Active Defense +2 (2/3)");
  assert.equal(list[1].value, 2); // 3 engaged − 1
  assert.equal(bonusesByStat(list).ad.alwaysTotal, 2);
  const none = collectBonuses(sources, { aspects });
  assert.equal(none[0].value, 0);
  assert.equal(none[0].label, "Unbroken Line (0/3)");
  assert.equal(describeBonus(normalizeBonus({ stat: "attack", value: 1, stack: { max: 3 } }), {}, 3), "Attack +3 (3/3)");
});

test("stack: hostile tokens adjacent, the panel's correction holds for its round, dropped wound level", () => {
  const pos = { me: [0, 0], a: [1, 0], b: [0, 1], c: [2, 0], d: [1, 1], e: [1, 0] };
  const dist = (x, y) => Math.max(Math.abs(pos[x.id][0] - pos[y.id][0]), Math.abs(pos[x.id][1] - pos[y.id][1]));
  const me = { id: "me", disposition: 1 };
  const tokens = [{ id: "a", disposition: -1 }, { id: "b", disposition: -2 }, { id: "c", disposition: -1 }, { id: "d", disposition: 1 }, { id: "e", disposition: -1, out: true }];
  assert.equal(countEngaged(me, tokens, dist), 2); // a and b; c too far, d friendly, e out of action
  assert.equal(countEngaged({ id: "me", disposition: 0 }, tokens, dist), 0);
  const fight = { id: "c1", round: 2 };
  assert.equal(engagedWithAdjust(2, { adjust: 1, combat: "c1", round: 2 }, fight), 3);
  assert.equal(engagedWithAdjust(2, { adjust: 1, combat: "c1", round: 1 }, fight), 2);
  assert.equal(engagedWithAdjust(1, { adjust: -3, combat: "c1", round: 2 }, fight), 0);
  assert.equal(droppedLevel({ level: "normal" }, { level: "bruised" }), true);
  assert.equal(droppedLevel({ level: "bruised" }, { level: "bruised" }), false);
  assert.equal(droppedLevel({ level: "fatally", coma: false }, { level: "fatally", coma: true, out: true }), true);
  assert.equal(droppedLevel({ health: 3, out: false }, { health: 2, out: false }), true);
  assert.equal(droppedLevel({ health: 3, out: false }, { health: 3, out: false }), false);
});

/* ---------------------------------------- targetAd and armorPierce */

test("targetAd and armorPierce: attacker side, defense parts, damage after pierce", () => {
  const list = collectBonuses([{ id: "g", name: "Green Dragon", bonuses: [
    { stat: "targetAd", value: 2 }, { stat: "armorPierce", value: 1 },
    { stat: "armorPierce", value: 2, mode: "situational", condition: "on a charge" },
  ] }], { aspects });
  assert.equal(describeBonus(list[0].bonus), "opponents' Active Defense −2");
  assert.equal(describeBonus(list[1].bonus), "target's armour −1");
  const by = bonusesByStat(list);
  assert.equal(by.targetAd.alwaysTotal, 2);
  assert.equal(by.armorPierce.alwaysTotal, 1);
  const off = attackerSideBonuses(list, { techniquePierce: 2, techniqueName: "Direct Hit" });
  assert.equal(off.targetAdTotal, 2);
  assert.equal(off.pierce, 3);
  assert.equal(off.pierceParts[0].technique, true);
  const on = attackerSideBonuses(list, { ticked: { "g:2": true } });
  assert.equal(on.pierce, 3);
  assert.equal(on.pierceParts[1].label, "Green Dragon (on a charge)");
  assert.equal(on.pierceParts[1].situational, true);
  const act = collectBonuses([{ id: "a", name: "Crescent Sweep", bonuses: [{ stat: "targetAd", value: 1 }] }]);
  assert.equal(attackerSideBonuses(list, { activeList: act, activeName: "Crescent Sweep" }).targetAdTotal, 3);
  const parts = targetAdParts(off.targetAd, "Guan Yu");
  assert.deepEqual(parts.map(p => [p.kind, p.label, p.value]), [["unique", "Attacker: Guan Yu, Green Dragon", -2]]);
  // armour 5 − pierce 3 = 2 counts
  const r = damageAfterReductions({ amount: 10, protection: 5, pierce: off.pierce });
  assert.equal(r.final, 8);
  assert.equal(damageAfterReductions({ amount: 10, protection: 2, pierce: 5 }).final, 10);
});

/* ---------------------------------------- effects on others */

const thunder = { target: "enemies", test: { user: { aspect: "fire", skill: "intimidation" }, resist: { aspect: "resistance", skill: "" } }, onFail: [], note: "can't attack him or move toward him", duration: { rounds: 2 } };
const oath = { target: "allies", onFail: [{ stat: "attack", value: 2 }, { stat: "ad", value: 2 }], duration: { rounds: 3 }, note: "up to two allies within 10 yards who can see him; he gets it too" };
const silence = { target: "enemies", test: { user: { aspect: "fire", skill: "intimidation" }, resist: { aspect: "resistance", skill: "" } },
  onFail: [{ stat: "attack", value: -3, vsSource: true }, { stat: "ad", value: -2, vsSource: true }], duration: { rounds: 3 } };

test("effect: the schema examples normalize; durations; Test text", () => {
  const t = normalizeEffect(thunder);
  assert.equal(t.target, "enemies");
  assert.deepEqual(t.test.resist, { aspect: "resistance", skill: "" });
  assert.equal(t.onFail.length, 0);
  assert.equal(t.note, "can't attack him or move toward him");
  assert.equal(isFriendlyTarget(t), false);
  const o = normalizeEffect(oath);
  assert.equal(o.test, null);
  assert.equal(o.onFail[1].stat, "ad");
  assert.equal(isFriendlyTarget(o), true);
  const s = normalizeEffect(silence);
  assert.equal(s.onFail[0].vsSource, true);
  assert.equal(s.onFail[0].value, -3);
  assert.equal(normalizeEffect({ target: "nobody" }), null);
  assert.equal(normalizeEffect(null), null);
  assert.equal(durationText({ rounds: 2 }), "2 rounds");
  assert.equal(durationText({ round: true }), "until the end of this round");
  assert.equal(durationText({ scene: true }), "this scene");
  assert.equal(durationText({ fight: true }), "the rest of the fight");
  assert.equal(testText(t.test, (k) => k === "intimidation" ? "Intimidation" : k), "Fire + Intimidation vs Resistance");
  assert.deepEqual(durationFields({ rounds: 3 }, { id: "c", round: 2 }), { combat: "c", round: 2, rounds: 3 });
  assert.deepEqual(durationFields({ round: true }, { id: "c", round: 2 }), { combat: "c", round: 2, rounds: 1 });
  assert.equal(durationFields({ fight: true }, { id: "c", round: 2 }).restOfFight, true);
  assert.equal(durationFields({ rounds: 3 }, null).combat, ""); // outside a fight: until ended
});

test("effect: resist outcomes, ties to the target, critical failures", () => {
  assert.equal(resistOutcome({ userTotal: 12, resistTotal: 11 }), "fail");
  assert.equal(resistOutcome({ userTotal: 12, resistTotal: 12 }), "success");
  assert.equal(resistOutcome({ userTotal: 12, resistTotal: 12, tiesTo: "user" }), "fail");
  assert.equal(resistOutcome({ userTotal: 12, resistTotal: 15 }), "success");
  assert.equal(resistOutcome({ userTotal: 12, resistTotal: 20, resistCritFail: true }), "fail");
  assert.equal(resistOutcome({ userTotal: 30, resistTotal: 1, userCritFail: true }), "success");
  const s = normalizeEffect({ ...silence, onSuccess: [{ stat: "attack", value: -1, vsSource: true }] });
  assert.equal(outcomeFor(s, "fail").bonuses.length, 2);
  assert.equal(outcomeFor(s, "success").bonuses[0].value, -1);
  assert.equal(outcomeFor(normalizeEffect(silence), "success").applies, false);
  const parts = testSideParts({ aspect: "resistance", skill: "" }, { resistance: 9, aspects });
  assert.deepEqual(parts.map(p => [p.label, p.value]), [["Resistance", 9]]);
  const up = testSideParts({ aspect: "fire", skill: "intimidation" }, { aspects, skill: { label: "Intimidation", value: 3 } });
  assert.deepEqual(up.map(p => [p.kind, p.value]), [["aspect", 4], ["skill", 3]]);
});

test("effect: applied effects count down by round, expire, and replace an earlier copy", () => {
  const src = { itemId: "item1", itemName: "Oath of the Peach Garden", actorUuid: "Actor.liubei", actorName: "Liu Bei" };
  const fight = { id: "c", round: 2 };
  const e = appliedEffect(normalizeEffect(oath), "fail", src, fight, "id1");
  assert.equal(e.kind, "skillEffect");
  assert.equal(e.source, "Liu Bei");
  assert.equal(e.sourceActor, "Actor.liubei");
  assert.equal(e.rounds, 3);
  assert.match(e.note, /two allies/);
  assert.equal(roundsLeft(e, { id: "c", round: 2 }), 3);
  assert.equal(roundsLeft(e, { id: "c", round: 4 }), 1);
  assert.equal(tickEffects([e], { id: "c", round: 4 }).keep.length, 1);
  assert.equal(tickEffects([e], { id: "c", round: 5 }).expired.length, 1);
  assert.equal(expireCombat([e], "c").length, 0);
  const again = appliedEffect(normalizeEffect(oath), "fail", src, { id: "c", round: 3 }, "id2");
  const list = withEffect(withEffect([], e), again);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "id2");
  assert.equal(appliedEffect(normalizeEffect(silence), "success", src, fight, "x"), null); // resisted, no onSuccess
  // notes-only effect: a reminder with no bonuses
  const t = appliedEffect(normalizeEffect(thunder), "fail", { ...src, actorName: "Zhang Fei" }, fight, "t");
  assert.equal(t.bonuses.length, 0);
  assert.equal(appliedText(t), "can't attack him or move toward him");
  assert.equal(roundsLeft(t, { id: "c", round: 3 }), 1);
});

test("effect: vsSource bonuses only count on rolls between the target and the source", () => {
  const src = { itemId: "nm", itemName: "The Name That Silences Crying", actorUuid: "Actor.zhangliao", actorName: "Zhang Liao" };
  const fight = { id: "c", round: 1 };
  const fx = appliedEffect(normalizeEffect(silence), "fail", src, fight, "e1");
  const buff = appliedEffect(normalizeEffect(oath), "fail", { ...src, itemId: "oath", itemName: "Oath", actorUuid: "Actor.liubei", actorName: "Liu Bei" }, fight, "e2");
  const state = normalizeCombatState({ effects: [fx, buff] });
  const live = liveEffects(state.effects, { id: "c", round: 2 });
  const totals = effectTotals(live);
  assert.equal(totals.bonusSources[0].sourceActor, "Actor.zhangliao");
  const all = collectBonuses(totals.bonusSources, { aspects });
  assert.equal(all.length, 4);
  const standing = bonusesVs(all, null);
  assert.deepEqual(standing.map(b => [b.stat, b.value]), [["attack", 2], ["ad", 2]]); // only the Oath
  const vsZhang = bonusesVs(all, "Actor.zhangliao");
  assert.equal(bonusesByStat(vsZhang).attack.alwaysTotal, -1); // +2 Oath −3 against him
  assert.equal(bonusesByStat(vsZhang).ad.alwaysTotal, 0);
  assert.equal(bonusesByStat(bonusesVs(all, "Actor.caocao")).attack.alwaysTotal, 2);
  assert.match(appliedText(fx), /Attack −3 against Zhang Liao, Active Defense −2 against Zhang Liao/);
  // vsSource bonuses never feed the standing Passive Defense
  const pdFx = appliedEffect(normalizeEffect({ target: "enemy", onFail: [{ stat: "pd", value: -2, vsSource: true }], duration: { rounds: 1 } }), "fail", src, fight, "p");
  const pdList = collectBonuses(effectTotals([pdFx]).bonusSources);
  assert.equal(pdBreakdown({ aspects, bonuses: bonusesVs(pdList, null) }).total, 9);
  assert.equal(pdBreakdown({ aspects, bonuses: bonusesVs(pdList, "Actor.zhangliao") }).total, 7);
});

test("effect: picker puts the user's side first", () => {
  const toks = [{ name: "Lu Bu", disposition: -1 }, { name: "Zhang Fei", disposition: 1 }, { name: "Diaochan", disposition: 0 }, { name: "Guan Yu", disposition: 1 }];
  assert.deepEqual(sortForPicker(toks, 1).map(t => t.name), ["Guan Yu", "Zhang Fei", "Diaochan", "Lu Bu"]);
  assert.deepEqual(sortForPicker(toks, -1).map(t => t.name), ["Lu Bu", "Diaochan", "Guan Yu", "Zhang Fei"]);
});

test("passive signatures with stack keep feeding the standing totals; actives don't", () => {
  const items = [
    { id: "p", name: "Holds the Line", type: "signature", system: { slot: "passive", bonuses: [{ stat: "pd", value: 1, stack: { trigger: "roundStart", max: 3 } }] } },
    { id: "a", name: "Roar", type: "signature", system: { slot: "active", bonuses: [], effect: thunder } },
  ];
  const list = collectBonuses(bonusSourcesOf(items), { aspects, stacks: [{ key: "p:0", steps: 3 }] });
  assert.equal(pdBreakdown({ aspects, bonuses: list }).total, 12);
});

/* ---------------------------------------- compendium tool */

test("compendium tool: in-person skills, general versions, Taught by, source flag", () => {
  const docs = [
    { name: "Zhang Fei", sig: {
      passive: { name: "Son of the Butcher", desc: "+1 damage.", bonuses: [{ stat: "damage", value: 1 }] },
      active: { name: "Thunder at the Bridge", desc: "He roars.", chi: 3, recharge: 0, perScene: true, effect: thunder },
      battlePassive: { name: "Battle thing", desc: "x" },
    } },
    { name: "Guan Ping", "sig.passive": { name: "Son of Guan Yu", generalName: "Son of a Famous Warrior", desc: "Beside Guan Yu, +1 Active Defense.", generalDesc: "Beside his father, +1 Active Defense.", bonuses: [{ stat: "ad", value: 1, mode: "situational" }] } },
    { name: "", sig: { passive: { name: "Nameless" } } },
  ];
  assert.deepEqual(Object.keys(sigSlots(docs[0])), ["passive", "active"]);
  const items = buildSkillCompendium(docs);
  assert.equal(items.length, 3);
  const [p, a, g] = items;
  assert.equal(p.type, "signature");
  assert.equal(p.system.slot, "passive");
  assert.match(p.system.description, /<p>\+1 damage\.<\/p><p><i>Taught by: Zhang Fei<\/i><\/p>/);
  assert.equal(p.flags.qin.source, "Zhang Fei");
  assert.equal(p.system.effect, null);
  assert.equal(a.system.chiCost, 3);
  assert.equal(a.system.perScene, true);
  assert.equal(a.system.effect.target, "enemies");
  assert.equal(g.name, "Son of a Famous Warrior");
  assert.match(g.system.description, /Beside his father/);
  assert.match(g.system.description, /Taught by: Guan Ping/);
  assert.equal(g.flags.qin.sourceSkill, "Son of Guan Yu");
  assert.equal(g._id.length, 16);
  assert.equal(buildSkillCompendium(docs)[2]._id, g._id); // stable ids
  assert.equal(buildSkillCompendium({ characters: docs }).length, 3);
});
