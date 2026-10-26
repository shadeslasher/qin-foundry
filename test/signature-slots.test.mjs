import test from "node:test";
import assert from "node:assert/strict";
import { SIGNATURE_SLOTS, extraActivesForTier } from "../module/config.mjs";

test("signature slots: extra in-person actives by tier (Tier 2 one, Tier 1 two, Tier 0 three)", () => {
  for (const [t, n] of [["", 0], ["4", 0], ["3", 0], ["2 Low", 1], ["2 Mid", 1], ["2 High", 1], ["1", 2], ["1 Exception", 2], ["0 Lu Bu", 3], ["0 Guan Yu", 3]]) assert.equal(extraActivesForTier(t), n, t);
  assert.deepEqual(Object.keys(SIGNATURE_SLOTS), ["passive", "active", "active2", "active3", "active4", "battlePassive", "battleActive"]);
  for (const k of ["active2", "active3", "active4"]) assert.equal(SIGNATURE_SLOTS[k].battle, false);
});
