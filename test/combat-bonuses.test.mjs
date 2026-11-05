import test from "node:test";
import assert from "node:assert/strict";
import "./mocks.mjs";
import { part, formatValue, sumParts, chipHTML, partRowHTML } from "../module/rules/sources.mjs";
import { collectBonuses, bonusesByStat, bonusParts, pdBreakdown, bonusSourcesOf, normalizeBonus, describeBonus, bonusValue } from "../module/rules/bonuses.mjs";
import { resolveTao, taoCost, taoActionsFor, roundsLeft, tickEffects, expireCombat, liveEffects, effectTotals, damageAfterReductions, isFirstHitThisRound, normalizeCombatState } from "../module/rules/tao-rules.mjs";
import * as Q from "../module/rules/qin-rules.mjs";
import { suggestBonuses } from "../tools/suggest-sig-bonuses.mjs";
const { CharacterData } = await import("../module/data/actor-models.mjs");

const guan = { metal: 5, water: 4, fire: 4, wood: 3, earth: 5 };
const paragon = { id: "p1", name: "Paragon of Righteousness", type: "signature", system: { slot: "passive", bonuses: [
  { stat: "pd", value: 1, mode: "always" },
  { stat: "ad", value: 2, mode: "always" },
  { stat: "damage", value: 2, mode: "situational", condition: "against an opponent who hasn't acted yet this round" },
] } };

test("source tags: values, chips and rows", () => {
  assert.equal(formatValue(2, "unique"), "+2");
  assert.equal(formatValue(-2, "unique"), "−2");
  assert.equal(formatValue(6, "aspect"), "6");
  assert.equal(formatValue(2, "houseRule"), "2");
  assert.equal(sumParts([part("aspect", "Metal", 6), part("skill", "Qiangshu", 6), part("wound", "Injury", -1)]), 11);
  assert.match(chipHTML(part("aspect", "Water", 4, { aspect: "water" })), /qin-src-aspect qin-src-water/);
  assert.match(chipHTML(part("unique", "Paragon", 2, { situational: true })), /qin-src-unique qin-src-situational/);
  assert.equal(part("nonsense", "x", 1).kind, "modifier");
  assert.match(partRowHTML(part("houseRule", "Yang over Yin 5, half", 2)), /House rule<\/span>Yang over Yin 5, half.*>2</);
  assert.match(partRowHTML(part("tao", "<b>", 1)), /&lt;b&gt;/);
});

test("bonus collection: only standing signatures, by stat and mode, Aspect-based values", () => {
  const battle = { id: "b", name: "Battle", type: "signature", system: { slot: "battlePassive", bonuses: [{ stat: "pd", value: 5 }] } };
  const active = { id: "a", name: "Stroke", type: "signature", system: { slot: "active", bonuses: [{ stat: "damage", value: 3 }] } };
  const iron = { id: "i", name: "Iron Body", type: "signature", system: { slot: "passive", bonuses: [{ stat: "firstHitReduction", value: 0, aspect: "metal" }] } };
  const sources = bonusSourcesOf([paragon, battle, active, iron, { type: "weapon", system: {} }]);
  assert.deepEqual(sources.map(s => s.id), ["p1", "i"]);
  const list = collectBonuses(sources, { aspects: guan });
  assert.equal(list.length, 4);
  assert.equal(list[0].key, "p1:0");
  assert.equal(list[0].label, "Paragon of Righteousness");
  assert.equal(list[3].value, 5); // his Metal
  const by = bonusesByStat(list);
  assert.equal(by.pd.alwaysTotal, 1);
  assert.equal(by.ad.alwaysTotal, 2);
  assert.equal(by.damage.alwaysTotal, 0);
  assert.equal(by.damage.situational.length, 1);
  assert.equal(by.firstHitReduction.alwaysTotal, 5);
  assert.equal(by.initiative.always.length, 0);
  assert.equal(normalizeBonus({ stat: "bogus", mode: "x" }, "L").stat, "pd");
  assert.equal(normalizeBonus({ mode: "x" }).mode, "always");
  assert.equal(bonusValue({ value: 1, aspect: "earth" }, guan), 6);
  assert.equal(describeBonus({ stat: "pd", value: 1 }), "Passive Defense +1");
  assert.equal(describeBonus({ stat: "attackersPenalty", value: 2 }), "attackers −2");
});

test("bonus parts: always on applied, situational only when ticked", () => {
  const list = collectBonuses(bonusSourcesOf([paragon]), { aspects: guan });
  const off = bonusParts(list, "damage");
  assert.equal(off.total, 0);
  assert.equal(off.situational[0].ticked, false);
  const on = bonusParts(list, "damage", { ticked: { "p1:2": true } });
  assert.equal(on.total, 2);
  assert.equal(on.parts[0].situational, true);
  assert.equal(bonusParts(list, "ad").total, 2);
  assert.equal(bonusParts(list, "ad", { sign: -1 }).total, -2);
});

test("Passive Defense breakdown: aspects + 2 + sheet, armour, unique and Tao parts", () => {
  const list = collectBonuses(bonusSourcesOf([paragon]), { aspects: guan });
  const pd = pdBreakdown({ aspects: guan, pdBonus: 0, armor: [{ name: "Shield", pdModifier: 1 }], bonuses: list, tao: [{ label: "Chi Defense", value: 4 }] });
  assert.equal(pd.total, 4 + 3 + 2 + 1 + 1 + 4);
  assert.equal(pd.extra, 6);
  assert.deepEqual(pd.parts.map(p => p.kind), ["aspect", "aspect", "base", "gear", "unique", "tao"]);
  assert.equal(pdBreakdown({ aspects: guan }).total, 9);
  // a situational PD bonus counts only when ticked
  const sit = collectBonuses([{ id: "s", name: "Shield wall", bonuses: [{ stat: "pd", value: 2, mode: "situational" }] }]);
  assert.equal(pdBreakdown({ aspects: guan, bonuses: sit }).total, 9);
  assert.equal(pdBreakdown({ aspects: guan, bonuses: sit, ticked: { "s:0": true } }).total, 11);
});

test("character data: unique PD, Active Defense bonus, Chi Defense and Feel no pain from the combat state", () => {
  const make = (flags) => {
    const d = Object.assign(new CharacterData(), {
      aspects: { ...guan }, skills: { jianshu: { value: 3, spec: "" } }, pdBonus: 0, chi: { value: 10, bonus: 0 }, bol: { damage: 20, override: [0, 0, 0, 0, 0] },
    });
    d.parent = { items: [paragon], flags: { qin: { combatState: flags } } };
    d.prepareDerivedData();
    return d;
  };
  const plain = make(undefined);
  assert.equal(plain.passiveDefense, 10); // Water 4 + Wood 3 + 2 + Paragon 1
  assert.equal(plain.pdExtra, 1);
  assert.equal(plain.activeDefenseBonus, 2);
  assert.ok(plain.penalty > 0);
  const fx = make({ effects: [
    { id: "e1", key: "invisibleShield.2", label: "Chi Defense", effect: "pd", value: 4, combat: "", round: 0, exchange: 1 },
    { id: "e2", key: "strengthenedBody.2", label: "Feel no pain", effect: "noPain", combat: "", round: 0, rounds: 2 },
    { id: "e3", key: "strengthenedBody.4", label: "Hard Hide", effect: "hitReduction", value: 5, combat: "", round: 0, rounds: 4 },
  ] });
  assert.equal(fx.passiveDefense, 14);
  assert.equal(fx.penalty, 0);
  assert.ok(fx.woundPenalty > 0);
  assert.deepEqual(fx.hitReductions, [{ label: "Hard Hide", value: 5 }]);
});

test("Tao costs: level for fixed effects, the bonus for scaled ones", () => {
  assert.equal(taoCost("invisibleShield", 1, 4, guan), 4); // Strong Defense: reduction = Tao level
  assert.equal(resolveTao("invisibleShield", 1, 4, guan).value, 4);
  assert.equal(taoCost("invisibleShield", 2, 3, guan), 3); // Chi Defense: + Tao level PD
  assert.equal(taoCost("invisibleShield", 3, 4, guan), 3); // Strong Block: level 3
  assert.equal(resolveTao("invisibleShield", 3, 4, guan).value, 3); // + Wood
  assert.equal(taoCost("invisibleShield", 4, 4, guan), 4); // Chi Block
  assert.equal(taoCost("strengthenedBody", 2, 4, guan), 2);
  assert.equal(resolveTao("strengthenedBody", 2, 3, guan).rounds, 3);
  assert.equal(taoCost("strengthenedBody", 4, 4, guan), 4);
  assert.equal(resolveTao("strengthenedBody", 4, 4, guan).value, 5); // Metal
  assert.equal(taoCost("destructiveBreath", "any", 2, guan), 2);
  assert.equal(resolveTao("destructiveBreath", "any", 2, guan).slot, "attack");
  assert.equal(taoCost("suddenLightning", 2, 3, guan), 3);
  assert.equal(resolveTao("suddenLightning", 2, 3, guan).value, 3);
  assert.equal(taoCost("strengthenedBody", 3, 4, guan), 3); // not automated: the level
  assert.equal(resolveTao("invisibleShield", 3, 2, guan), null); // level not known
  const rows = taoActionsFor([{ id: "t1", name: "Invisible Shield", key: "invisibleShield", level: 4 }, { id: "t2", name: "Strengthened Body", key: "strengthenedBody", level: 4 },
    { id: "t3", name: "Destructive Breath", key: "destructiveBreath", level: 2 }, { id: "t4", name: "Ten Thousand Hands", key: "tenThousandHands", level: 2 }], guan);
  assert.deepEqual(rows[0].actions.map(a => a.name), ["Strong Defense", "Chi Defense", "Strong Block", "Chi Block"]);
  assert.deepEqual(rows[1].actions.map(a => a.name), ["Feel no pain", "Hard Hide"]);
  assert.deepEqual(rows[1].other, [1, 3]);
  assert.deepEqual(rows[2].actions.map(a => a.name), ["Destructive Breath"]);
  assert.deepEqual(rows[2].other, []);
  assert.deepEqual(rows[3].actions, []);
  assert.deepEqual(rows[3].other, [1, 2]);
});

test("timed effects count down by combat round and expire; exchange effects last one exchange", () => {
  const hh = { id: "h", combat: "c1", round: 2, rounds: 3 };
  assert.equal(roundsLeft(hh, { id: "c1", round: 2 }), 3);
  assert.equal(roundsLeft(hh, { id: "c1", round: 4 }), 1);
  assert.equal(roundsLeft(hh, { id: "c1", round: 5 }), 0);
  assert.equal(roundsLeft(hh, { id: "c2", round: 2 }), 0);
  assert.equal(roundsLeft({ id: "m", combat: "" }, { id: "c1", round: 1 }), null);
  const cd = { id: "x", combat: "c1", round: 2, exchange: 1 };
  assert.equal(roundsLeft(cd, { id: "c1", round: 2, exchange: 1 }), 1);
  assert.equal(roundsLeft(cd, { id: "c1", round: 2, exchange: 2 }), 0);
  assert.equal(roundsLeft({ combat: "c1", round: 1, restOfFight: true }, { id: "c1", round: 9 }), Infinity);
  const manual = { id: "m", combat: "" }, other = { id: "o", combat: "c9", round: 1, rounds: 1 };
  const t = tickEffects([hh, cd, manual, other], { id: "c1", round: 5, exchange: 1 });
  assert.deepEqual(t.keep.map(e => e.id), ["m", "o"]);
  assert.deepEqual(t.expired.map(e => e.id), ["h", "x"]);
  assert.deepEqual(expireCombat([hh, manual, other], "c1").map(e => e.id), ["m", "o"]);
  assert.deepEqual(liveEffects([hh, manual, other], { id: "c1", round: 3 }, (id) => id !== "c9").map(e => e.id), ["h", "m"]);
  const tot = effectTotals([{ effect: "pd", value: 3, label: "CD" }, { effect: "noPain" }, { effect: "hitReduction", value: 5, label: "HH" }, { kind: "unique", label: "Scraping", sourceId: "s", bonuses: [{ stat: "ad", value: 1 }] }]);
  assert.equal(tot.pd[0].value, 3);
  assert.equal(tot.noPain, true);
  assert.equal(tot.bonusSources[0].id, "s");
  assert.deepEqual(normalizeCombatState(null), { effects: [], queued: [], situational: {}, firstHit: null });
});

test("damage reductions in order: armour, then hit reductions, then Strong Defense", () => {
  const r = damageAfterReductions({ amount: 14, protection: 5, pierce: 0, reductions: [
    { label: "Strong Defense", value: 4, step: "strongDefense" },
    { label: "Hard Hide", value: 5, step: "hit" },
  ] });
  assert.equal(r.armor.applied, 5);
  assert.deepEqual(r.steps.map(s => [s.label, s.applied]), [["Hard Hide", 5], ["Strong Defense", 4]]);
  assert.equal(r.final, 0);
  // Strong Defense finds nothing left: not used (no Chi)
  const small = damageAfterReductions({ amount: 8, protection: 5, reductions: [{ label: "SD", value: 4, step: "strongDefense" }, { label: "HH", value: 5, step: "hit" }] });
  assert.equal(small.final, 0);
  assert.equal(small.steps[1].used, false);
  // pierce lowers armour, manual comes last, never below 0
  const p = damageAfterReductions({ amount: 12, protection: 5, pierce: 2, reductions: [{ label: "Other", value: 1, step: "manual" }, { label: "Iron", value: 2, step: "hit" }] });
  assert.equal(p.armor.applied, 3);
  assert.deepEqual(p.steps.map(s => s.label), ["Iron", "Other"]);
  assert.equal(p.final, 6);
  assert.equal(damageAfterReductions({ amount: 3, protection: 5 }).final, 0);
  // first hit of the round
  assert.equal(isFirstHitThisRound(null, { id: "c", round: 1 }), true);
  assert.equal(isFirstHitThisRound({ combat: "c", round: 1 }, { id: "c", round: 1 }), false);
  assert.equal(isFirstHitThisRound({ combat: "c", round: 1 }, { id: "c", round: 2 }), true);
});

test("attack damage parts: Metal, weapon, house rules and extra bonuses, tagged", () => {
  const dice = Q.yinYangResult(3, 8);
  const d = Q.attackDamageParts({ metal: 6, weapon: 5, weaponName: "Sky Piercer", dice, hit: true });
  assert.equal(d.total, 13);
  assert.deepEqual(d.parts.map(p => [p.kind, p.label, p.value]), [["aspect", "Metal", 6], ["gear", "Sky Piercer", 5], ["houseRule", "Yang over Yin 5, half", 2]]);
  assert.equal(d.total, Q.attackDamage({ metal: 6, weapon: 5, dice, hit: true }));
  const dbl = Q.attackDamageParts({ metal: 4, weapon: 3, dice: Q.yinYangResult(9, 9), hit: true, extra: [part("unique", "Paragon", 2, { situational: true }), part("tao", "Destructive Breath", 2)] });
  assert.equal(dbl.total, 4 + 3 + 4 + 2 + 2);
  assert.equal(dbl.parts[2].label, "Double 9, half");
});

test("signature bonus suggester: common phrasings, conditions make it situational", () => {
  const one = (t) => suggestBonuses(t).map(({ match, ...r }) => r);
  assert.deepEqual(one("+2 on Active Defense Tests."), [{ stat: "ad", value: 2, aspect: "", mode: "always", condition: "", label: "" }]);
  assert.deepEqual(one("+1 Passive Defense.").map(b => [b.stat, b.value, b.mode]), [["pd", 1, "always"]]);
  assert.deepEqual(one("Opponents take −2 on Attack Tests against him.").map(b => [b.stat, b.value, b.mode]), [["attackersPenalty", 2, "always"]]);
  assert.deepEqual(one("Attackers take -1 on Attack Tests against him.").map(b => [b.stat, b.value]), [["attackersPenalty", 1]]);
  assert.deepEqual(one("The first hit each round does 3 less damage.").map(b => [b.stat, b.value, b.mode]), [["firstHitReduction", 3, "always"]]);
  assert.deepEqual(one("Once per round one hit is reduced by his Earth.").map(b => [b.stat, b.value, b.aspect]), [["firstHitReduction", 0, "earth"]]);
  assert.deepEqual(one("Once per round, one hit is reduced by his Metal.").map(b => b.aspect), ["metal"]);
  assert.deepEqual(one("+2 damage.").map(b => [b.stat, b.value, b.mode]), [["damage", 2, "always"]]);
  const sit = one("+2 damage against an opponent who hasn't acted yet this round.");
  assert.equal(sit[0].mode, "situational");
  assert.equal(sit[0].condition, "against an opponent who hasn't acted yet this round");
  assert.equal(one("While mounted, +2 on Attack Tests.")[0].condition, "While mounted");
  assert.equal(one("+1 Passive Defense on foot")[0].condition, "on foot");
  assert.equal(one("+3 damage during a duel.")[0].condition, "during a duel");
  assert.equal(one("+1 on Active Defense Tests if he holds a shield.")[0].condition, "if he holds a shield");
  // two bonuses in one sentence don't become each other's condition
  assert.deepEqual(one("+1 Passive Defense and +2 on Active Defense Tests.").map(b => [b.stat, b.mode]), [["pd", "always"], ["ad", "always"]]);
  assert.deepEqual(one("<p>+1 Passive Defense.</p><p>+2 damage when mounted.</p>").map(b => [b.stat, b.mode, b.condition]), [["pd", "always", ""], ["damage", "situational", "when mounted"]]);
  assert.deepEqual(one("Every hit he takes does 1 less damage.").map(b => b.stat), ["hitReduction"]);
  assert.deepEqual(one("No numbers here."), []);
});
