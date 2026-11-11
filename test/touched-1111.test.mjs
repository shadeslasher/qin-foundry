import { test } from "node:test";
import assert from "node:assert/strict";
import { touchedBy } from "../module/battle/touched.mjs";

test("an active's touched units: those that just gained its effect, not the user, not ones that had it already", () => {
  const s = { units: [
    { id: "me", fx: { buffs: [{ name: "Rally Cry" }] } },
    { id: "a", fx: { buffs: [{ name: "Rally Cry" }] } },
    { id: "b", fx: { buffs: [{ name: "Rally Cry" }] } },
    { id: "c", fx: { buffs: [{ name: "Other" }] } },
    { id: "d", fx: {} },
  ] };
  const before = { me: { buffs: [] }, a: { buffs: [] }, b: { buffs: ["Rally Cry"] }, c: { buffs: [] }, d: { buffs: [] } };
  assert.deepEqual(touchedBy(s, before, "Rally Cry", "me"), ["a"]);
});
