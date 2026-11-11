import { test } from "node:test";
import assert from "node:assert/strict";
import { factionOf, tierNum, matches } from "../module/officer-codex.mjs";

test("faction and group from the compendium folders", () => {
  assert.deepEqual(factionOf(["Characters", "Wei"]), { faction: "Wei", group: "", minor: false });
  assert.deepEqual(factionOf(["Characters", "Liu Biao", "Cai"]), { faction: "Liu Biao", group: "Cai", minor: false });
  assert.deepEqual(factionOf(["Minor Characters", "Yellow Turbans"]), { faction: "Yellow Turbans", group: "", minor: true });
  assert.equal(factionOf([]).faction, "Unsorted");
});
test("tier number and filters", () => {
  assert.equal(tierNum("2 High"), 2); assert.equal(tierNum("0 Lu Bu"), 0); assert.equal(tierNum(""), null);
  const o = { name: "Huang Gai", title: "Unreadable Warrior", faction: "Wu", group: "", type: "Champion", tier: 2 };
  assert.ok(matches(o, { q: "huang gai" }) && matches(o, { q: "gai" }));
  assert.ok(!matches(o, { q: "huang wu" }), "the faction isn't searched");
  assert.ok(!matches(o, { q: "warrior" }), "nor the epithet");
  assert.ok(!matches(o, { q: "cao" }));
  assert.ok(matches(o, { types: ["Champion", "Vanguard"], tier: "2", faction: "Wu" }));
  assert.ok(!matches(o, { types: ["Commander"] }));
  assert.ok(!matches(o, { tier: 1 }));
});
