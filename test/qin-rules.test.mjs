import test from "node:test";
import assert from "node:assert";
import * as Q from "../module/rules/qin-rules.mjs";

const xian = { metal: 4, water: 3, fire: 2, wood: 2, earth: 3 };

test("book example Xian: Chi 12, PD 7, BoL 17 as 6/5/3/2/1", () => {
  assert.strictEqual(Q.balance(xian), 3);
  assert.strictEqual(Q.chiMax(xian, 2), 12);
  assert.strictEqual(Q.passiveDefense(xian), 7);
  assert.strictEqual(Q.resistance(xian), 7);
  assert.strictEqual(Q.bolTotal(xian), 17);
  assert.deepStrictEqual(Q.bolDistribution(xian), [6, 5, 3, 2, 1]);
});

test("Ma Kui ruling: Chi uses Earth only (36 with Basic 3, Earth 3, skill 4)", () => {
  const a = { metal: 4, water: 3, fire: 3, wood: 2, earth: 3 }; // balance 2 -> basic 3
  assert.strictEqual(Q.chiMax(a, 4), 36);
});

test("Strengthened Body follows the book: L3 Bruised, L4 Slightly Injured", () => {
  assert.deepStrictEqual(Q.bolDistribution(xian, { strengthenedBody: 2 }), [10, 5, 3, 2, 1]);
  assert.deepStrictEqual(Q.bolDistribution(xian, { strengthenedBody: 4 }), [10, 7, 5, 2, 1]);
});

test("BoL state and penalties", () => {
  const d = [6, 5, 3, 2, 1];
  assert.strictEqual(Q.bolState(d, 0).penalty, 0);
  assert.strictEqual(Q.bolState(d, 11).current, "slightly");
  assert.strictEqual(Q.bolState(d, 11).penalty, 1);
  assert.strictEqual(Q.bolState(d, 14).penalty, 3);
  assert.strictEqual(Q.bolState(d, 16).penalty, 5);
  assert.ok(Q.bolState(d, 17).coma && !Q.bolState(d, 17).dead);
  assert.ok(Q.bolState(d, 18).dead);
});

test("homebrew Yin/Yang: doubles are face value + Chi, double zero is a critical failure", () => {
  assert.deepStrictEqual(Q.yinYangResult(8, 3), { yin: 8, yang: 3, value: 5, double: false, critFail: false, chiGain: 0, chiLoss: 0, yangDiff: 0 });
  const d8 = Q.yinYangResult(8, 8);
  assert.strictEqual(d8.value, 8); assert.strictEqual(d8.chiGain, 8); assert.ok(!d8.critFail);
  const d0 = Q.yinYangResult(0, 0);
  assert.ok(d0.critFail); assert.strictEqual(d0.chiLoss, 5); assert.strictEqual(d0.value, 0);
  const beg = Q.yinYangResult(6, 6, { beginner: true });
  assert.strictEqual(beg.value, 0); assert.strictEqual(beg.chiGain, 0);
});

test("attack damage: Yang difference, double bonus only on a hit", () => {
  assert.strictEqual(Q.attackDamage({ metal: 4, weapon: 3, dice: Q.yinYangResult(5, 9), hit: true }), 11); // book example
  assert.strictEqual(Q.attackDamage({ metal: 4, weapon: 3, dice: Q.yinYangResult(9, 5), hit: true }), 7);
  assert.strictEqual(Q.attackDamage({ metal: 4, weapon: 3, dice: Q.yinYangResult(9, 9), hit: true }), 16);
  assert.strictEqual(Q.attackDamage({ metal: 4, weapon: 3, dice: Q.yinYangResult(9, 9), hit: false }), 7);
});

test("negative Chi converts to damage", () => {
  assert.deepStrictEqual(Q.spendChi(3, 2), { chi: 1, damage: 0 });
  assert.deepStrictEqual(Q.spendChi(1, 3), { chi: -2, damage: 2 });
  assert.deepStrictEqual(Q.spendChi(-2, 1), { chi: -3, damage: 1 });
});

test("henchman health loss: 1 per hit, 2/3/4 at 2x/3x/4x Resistance", async () => {
  const { henchmanHealthLoss: h } = await import("../module/rules/qin-rules.mjs");
  const assert = (await import("node:assert/strict")).default;
  assert.equal(h(0, 4), 0);
  assert.equal(h(1, 4), 1);
  assert.equal(h(7, 4), 1);
  assert.equal(h(8, 4), 2);
  assert.equal(h(12, 4), 3);
  assert.equal(h(16, 4), 4);
  assert.equal(h(40, 4), 4);
});
