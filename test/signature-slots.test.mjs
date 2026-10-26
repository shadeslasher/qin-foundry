import test from "node:test";
import assert from "node:assert/strict";
import { SIGNATURE_SLOTS, extraActivesForTier } from "../module/config.mjs";

test("signature slots: extra in-person actives by tier (Tier 2 one, Tier 1 two, Tier 0 three)", () => {
  for (const [t, n] of [["", 0], ["4", 0], ["3", 0], ["2 Low", 1], ["2 Mid", 1], ["2 High", 1], ["1", 2], ["1 Exception", 2], ["0 Lu Bu", 3], ["0 Guan Yu", 3]]) assert.equal(extraActivesForTier(t), n, t);
  assert.deepEqual(Object.keys(SIGNATURE_SLOTS), ["passive", "active", "active2", "active3", "active4", "battlePassive", "battleActive"]);
  for (const k of ["active2", "active3", "active4"]) assert.equal(SIGNATURE_SLOTS[k].battle, false);
});

test("signature recharge: used in round R with N rounds, ready in R+N; once per fight; nothing outside a fight", async () => {
  const { rechargeStatus, rechargeLabel, isActiveSlot } = await import("../module/config.mjs");
  const f = (round) => ({ id: "c1", round });
  const two = { recharge: 2, lastUse: { combat: "c1", round: 1 } };
  assert.equal(rechargeStatus(two, f(1)).ready, false);
  assert.equal(rechargeStatus(two, f(2)).text, "Recharging: 1 round");
  assert.equal(rechargeStatus(two, f(3)).ready, true);
  assert.equal(rechargeStatus(two, { id: "c2", round: 1 }).ready, true);
  assert.equal(rechargeStatus(two, null).ready, true);
  assert.equal(rechargeStatus({ recharge: 1, lastUse: { combat: "c1", round: 4 } }, f(4)).text, "Recharging: 1 round");
  assert.equal(rechargeStatus({ recharge: 0, lastUse: { combat: "c1", round: 4 } }, f(4)).ready, true);
  assert.equal(rechargeStatus({ perScene: true, lastUse: { combat: "c1", round: 1 } }, f(9)).text, "Used this fight");
  assert.equal(rechargeStatus({ perScene: true, lastUse: { combat: "", round: 0 } }, f(1)).ready, true);
  assert.deepEqual([rechargeLabel({ recharge: 1 }), rechargeLabel({ recharge: 2 }), rechargeLabel({ perScene: true }), rechargeLabel({})], ["Once per round", "2-round recharge", "Once per fight", ""]);
  assert.ok(isActiveSlot("active") && isActiveSlot("active3") && !isActiveSlot("battleActive") && !isActiveSlot("passive"));
});
