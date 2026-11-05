// resistTest bonuses (skill-effects schema v2.2, David, 2026-11-05): normalising `against`, effect tags, and which
// resist bonuses apply by themselves and which are offered as tick boxes (pure helpers).
import test from "node:test";
import assert from "node:assert/strict";
import "./mocks.mjs";
import { BONUS_STATS, BONUS_SHORT, RESIST_TAGS, normalizeBonus, describeBonus, collectBonuses, bonusSourcesOf, parseResistTags, resistTagsText,
  resistMatches, resistParts, resistTestBonuses, bonusParts, skillTestParts } from "../module/rules/bonuses.mjs";
import { effectTags, normalizeEffect, SKILL_EFFECT_TAGS } from "../module/rules/skill-effects.mjs";
import { SKILLS } from "../module/config.mjs";

const passive = (id, name, bonuses) => ({ id, name, type: "signature", system: { slot: "passive", bonuses } });
const unflinching = passive("un", "Unflinching", [{ stat: "resistTest", value: 2, mode: "always", against: ["fear", "intimidation"] }]);
const antidotes = passive("an", "Antidote Habit", [{ stat: "resistTest", value: 2, mode: "always", against: "illness, Poison" }]);
const iron = passive("ir", "Iron Will", [{ stat: "resistTest", value: 1, mode: "always" }]);
const incorruptible = passive("ic", "Incorruptible", [{ stat: "resistTest", value: 1, mode: "situational", against: ["bribery", "threats"], condition: "when on duty" }]);
const tireless = passive("ti", "Tireless", [{ stat: "resistTest", value: 1, mode: "situational", condition: "on a forced march" }]);
const listOf = (...items) => collectBonuses(bonusSourcesOf(items));

test("resistTest: a known stat; `against` normalised from an array or a comma string", () => {
  assert.ok(BONUS_STATS.resistTest);
  assert.equal(BONUS_SHORT.resistTest, "resist rolls");
  assert.deepEqual(RESIST_TAGS, ["fear", "intimidation", "provocation", "persuasion", "bribery", "threats", "deception", "interrogation",
    "despair", "coercion", "seduction", "poison", "illness", "fatigue", "pain", "magic"]);
  assert.deepEqual(parseResistTags(["Fear", "INTIMIDATION"]), ["fear", "intimidation"]);
  assert.deepEqual(parseResistTags("bribes and threats".split(" and ")), ["bribery", "threats"], "light synonyms");
  assert.deepEqual(parseResistTags("illness, poison; fatigue, poison"), ["illness", "poison", "fatigue"], "comma / semicolon list, de-duplicated");
  assert.deepEqual(parseResistTags(" "), []);
  assert.deepEqual(parseResistTags(undefined), []);
  assert.deepEqual(parseResistTags("wasps"), ["wasps"], "unknown words kept (they never match)");
  assert.deepEqual(normalizeBonus({ stat: "resistTest", value: 2, against: "Fear, Intimidation" }).against, ["fear", "intimidation"]);
  assert.deepEqual(normalizeBonus({ stat: "resistTest", value: 2 }).against, [], "missing = every resist roll");
  assert.equal("against" in normalizeBonus({ stat: "pd", value: 1 }), false, "other stats carry no `against`");
  assert.equal(resistTagsText(["fear", "intimidation"]), "fear, Intimidation");
});

test("resistTest: description and collection", () => {
  assert.equal(describeBonus(normalizeBonus({ stat: "resistTest", value: 2, against: ["fear", "intimidation"] })), "+2 to resist fear, Intimidation");
  assert.equal(describeBonus(normalizeBonus({ stat: "resistTest", value: 1 })), "resist rolls +1");
  assert.equal(describeBonus(normalizeBonus({ stat: "resistTest", value: 0, aspect: "earth", against: ["poison"] }), { earth: 3 }), "+Earth (3) to resist poison");
  const list = listOf(unflinching, antidotes, iron);
  assert.deepEqual(list.map(b => [b.key, b.stat, b.value, b.against, b.text]), [
    ["un:0", "resistTest", 2, ["fear", "intimidation"], "+2 to resist fear, Intimidation"],
    ["an:0", "resistTest", 2, ["illness", "poison"], "+2 to resist illness, poison"],
    ["ir:0", "resistTest", 1, [], "resist rolls +1"],
  ]);
  assert.equal(resistTestBonuses(list).length, 3);
  // never leaks into other rolls
  assert.equal(bonusParts(list, "ad").parts.length, 0);
  assert.equal(skillTestParts(list, "intimidation").parts.length, 0);
});

test("effectTags: the effect's own tags, else derived from the Test's user skill", () => {
  const vsRes = (skill) => ({ target: "enemies", test: { user: { aspect: "fire", skill }, resist: { aspect: "resistance" } }, onFail: [] });
  assert.deepEqual(effectTags(vsRes("intimidation")), ["intimidation", "fear", "threats"]);
  assert.deepEqual(effectTags(vsRes("eloquence")), ["persuasion", "provocation"]);
  assert.deepEqual(effectTags(vsRes("diplomacy")), ["persuasion", "provocation"]);
  assert.deepEqual(effectTags(vsRes("seduction")), ["seduction", "persuasion"]);
  for (const k of ["acting", "stealth", "theft"]) assert.deepEqual(effectTags(vsRes(k)), ["deception"], k);
  for (const k of ["medicine", "herbalism", "externalAlchemy"]) assert.deepEqual(effectTags(vsRes(k)), ["poison"], k);
  assert.deepEqual(effectTags(vsRes("Intimidation")), ["intimidation", "fear", "threats"], "a skill name works too");
  assert.deepEqual(effectTags(vsRes("artOfWar")), []);
  assert.deepEqual(effectTags(vsRes("")), [], "pure Aspect Test");
  assert.deepEqual(effectTags({ target: "allies", onFail: [] }), [], "no Test");
  assert.deepEqual(effectTags(null), []);
  assert.deepEqual(effectTags({ ...vsRes("intimidation"), tags: "Despair, fear" }), ["despair", "fear"], "own tags win");
  // normalizeEffect keeps tags; derivation also works on a normalized effect
  assert.deepEqual(normalizeEffect({ ...vsRes("medicine"), tags: ["Poison"] }).tags, ["poison"]);
  assert.deepEqual(effectTags(normalizeEffect(vsRes("seduction"))), ["seduction", "persuasion"]);
  for (const k of Object.keys(SKILL_EFFECT_TAGS)) assert.ok(SKILLS[k], `${k} is a skill key in config.mjs`);
});

test("resist parts against an effect: auto when untagged or matching; the rest offered, ticked only when matching", () => {
  const list = listOf(unflinching, antidotes, iron, incorruptible, tireless);
  assert.deepEqual(resistMatches(list[0], ["intimidation", "fear", "threats"]), ["fear", "intimidation"]);
  const r = resistParts(list, ["intimidation", "fear", "threats"]);
  assert.deepEqual(r.parts.map(p => [p.kind, p.label, p.value, !!p.situational]), [
    ["unique", "Unflinching (vs fear, Intimidation)", 2, false],
    ["unique", "Iron Will", 1, false],
    ["unique", "Incorruptible (vs threats)", 1, true],
  ]);
  assert.equal(r.total, 4);
  assert.deepEqual(r.auto.map(b => b.key), ["un:0", "ir:0"]);
  assert.deepEqual(r.offered.map(b => [b.key, b.ticked]), [["an:0", false], ["ic:0", true], ["ti:0", false]],
    "non-matching always-on: offered unticked; situational matching: ticked; situational untagged: unticked");
  // the tick boxes' answer overrides the defaults; auto ones stay
  const t = resistParts(list, ["intimidation", "fear", "threats"], { ticked: { "an:0": true, "ic:0": false } });
  assert.equal(t.total, 2 + 1 + 2);
  assert.deepEqual(t.parts.map(p => p.label), ["Unflinching (vs fear, Intimidation)", "Antidote Habit", "Iron Will"]);
  // the Combat panel's ticks tick by default
  assert.equal(resistParts(list, ["poison"], { panelTicked: { "ti:0": true } }).offered.find(b => b.key === "ti:0").ticked, true);
  // poison: Antidote Habit applies by itself, Unflinching is offered unticked
  const p = resistParts(list, ["poison"]);
  assert.deepEqual(p.auto.map(b => b.key), ["an:0", "ir:0"]);
  assert.equal(p.total, 3);
  assert.equal(p.offered.find(b => b.key === "un:0").ticked, false);
  // an effect with no tags: only the untagged always-on ones apply by themselves
  const none = resistParts(list, []);
  assert.deepEqual(none.auto.map(b => b.key), ["ir:0"]);
  assert.ok(none.offered.every(b => !b.ticked));
});

test("resist parts on a plain Resistance roll: everything offered, the untagged always-on ones ticked", () => {
  const list = listOf(unflinching, antidotes, iron, tireless);
  const r = resistParts(list, null);
  assert.equal(r.auto.length, 0);
  assert.deepEqual(r.offered.map(b => [b.key, b.ticked]), [["un:0", false], ["an:0", false], ["ir:0", true], ["ti:0", false]]);
  assert.deepEqual(r.parts.map(p => [p.label, p.value]), [["Iron Will", 1]]);
  const t = resistParts(list, null, { ticked: { "un:0": true, "ir:0": true } });
  assert.equal(t.total, 3);
  assert.equal(t.parts[0].label, "Unflinching");
});

test("resistTest from an applied effect (an ally's buff) counts the same way", () => {
  const buff = { id: "fx-rally", name: "Rally the Line", fromEffect: true, bonuses: [{ stat: "resistTest", value: 2, mode: "always", against: ["fear"] }] };
  const list = collectBonuses([buff]);
  assert.equal(list[0].fromEffect, true);
  assert.deepEqual(resistParts(list, ["intimidation", "fear", "threats"]).parts.map(p => [p.label, p.value]), [["Rally the Line (vs fear)", 2]]);
  assert.equal(resistParts(list, ["poison"]).total, 0);
});
