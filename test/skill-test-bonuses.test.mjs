// skillTest bonuses (skill-effects schema v2.1 §4, David, 2026-11-05): collection and application (pure helpers).
import test from "node:test";
import assert from "node:assert/strict";
import "./mocks.mjs";
import { BONUS_STATS, normalizeBonus, describeBonus, collectBonuses, bonusesByStat, bonusSourcesOf, parseSkillList, skillListText,
  appliesToSkill, skillTestParts, skillTestBonuses, bonusParts } from "../module/rules/bonuses.mjs";

const ruleByTerror = { id: "rt", name: "Rule by Terror", type: "signature", system: { slot: "passive", bonuses: [
  { stat: "skillTest", value: 3, mode: "always", skills: ["intimidation"] },
] } };
const silverTongue = { id: "st", name: "Silver Tongue", type: "signature", system: { slot: "passive", bonuses: [
  { stat: "skillTest", value: 2, mode: "situational", skills: ["eloquence", "diplomacy"], condition: "to persuade someone to change sides" },
] } };

test("skillTest: a known stat; skills parsed from keys, names or a comma list", () => {
  assert.ok(BONUS_STATS.skillTest);
  assert.deepEqual(parseSkillList(["intimidation", "Eloquence"]), ["intimidation", "eloquence"]);
  assert.deepEqual(parseSkillList("Intimidation, art of war; Jianshu, intimidation"), ["intimidation", "artOfWar", "jianshu"]);
  assert.deepEqual(parseSkillList("Hand-to-Hand, Jianshu (fencing)"), ["handToHand", "jianshu"]);
  assert.deepEqual(parseSkillList("customSkillId"), ["customSkillId"], "custom skill items keep their id");
  assert.deepEqual(parseSkillList(""), []);
  assert.equal(skillListText(["eloquence", "diplomacy"]), "Eloquence / Diplomacy");
  const n = normalizeBonus({ stat: "skillTest", value: 2, skills: "Diplomacy" });
  assert.deepEqual(n.skills, ["diplomacy"]);
  assert.equal("skills" in normalizeBonus({ stat: "pd", value: 1 }), false, "other stats carry no skills");
});

test("skillTest: description and collection with source tags", () => {
  assert.equal(describeBonus(normalizeBonus({ stat: "skillTest", value: 3, skills: ["intimidation"] })), "Intimidation Tests +3");
  assert.equal(describeBonus(normalizeBonus({ stat: "skillTest", value: 2, skills: ["eloquence", "diplomacy"] })), "Eloquence / Diplomacy Tests +2");
  assert.equal(describeBonus(normalizeBonus({ stat: "skillTest", value: -1, aspect: "fire", skills: ["acting"] }), { fire: 4 }), "Acting Tests +Fire −1 (3)");
  const list = collectBonuses(bonusSourcesOf([ruleByTerror, silverTongue]));
  assert.deepEqual(list.map(b => [b.key, b.stat, b.value, b.mode, b.sourceName, b.skills]), [
    ["rt:0", "skillTest", 3, "always", "Rule by Terror", ["intimidation"]],
    ["st:0", "skillTest", 2, "situational", "Silver Tongue", ["eloquence", "diplomacy"]],
  ]);
  assert.equal(skillTestBonuses(list).length, 2);
  const by = bonusesByStat(list);
  assert.equal(by.skillTest.alwaysTotal, 3);
  assert.equal(by.skillTest.situational.length, 1);
  // skillTest bonuses never leak into other stats' parts
  assert.equal(bonusParts(list, "attack").parts.length, 0);
  assert.equal(bonusParts(list, "ad").parts.length, 0);
});

test("skillTest application: only Tests with a listed skill; situational only when ticked; never martial", () => {
  const list = collectBonuses(bonusSourcesOf([ruleByTerror, silverTongue]));
  assert.ok(appliesToSkill(list[0], "intimidation"));
  assert.ok(!appliesToSkill(list[0], "eloquence"));
  assert.ok(appliesToSkill(list[1], "diplomacy"));
  const intim = skillTestParts(list, "intimidation");
  assert.deepEqual(intim.parts.map(p => [p.kind, p.label, p.value, !!p.situational]), [["unique", "Rule by Terror", 3, false]]);
  assert.equal(intim.total, 3);
  const dipl = skillTestParts(list, "diplomacy");
  assert.equal(dipl.total, 0, "situational: not ticked");
  assert.deepEqual(dipl.situational.map(b => [b.key, b.ticked]), [["st:0", false]]);
  const on = skillTestParts(list, "diplomacy", { ticked: { "st:0": true } });
  assert.deepEqual(on.parts.map(p => [p.label, p.value, p.situational]), [["Silver Tongue (to persuade someone to change sides)", 2, true]]);
  assert.equal(skillTestParts(list, "", {}).total, 0, "pure Aspect Test");
  assert.equal(skillTestParts(list, "acting").total, 0, "unlisted skill");
  assert.equal(skillTestParts(list, "intimidation", { martial: true }).total, 0, "martial rolls use attack/ad bonuses");
});

test("skillTest on an active is applied only when used (not a standing bonus)", () => {
  const act = { id: "a", name: "Banquet", type: "signature", system: { slot: "active2", bonuses: [{ stat: "skillTest", value: 2, skills: ["intimidation"] }] } };
  assert.equal(bonusSourcesOf([act]).length, 0);
});
