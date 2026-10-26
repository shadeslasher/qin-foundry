import test from "node:test";
import assert from "node:assert/strict";
import { planSync, sourceUuid } from "../module/compendium-sync.mjs";

test("update from compendium: build replaced, play state and equipment kept", () => {
  const current = {
    name: "Old", system: { aspects: { metal: 2 }, bol: { damage: 7 }, chi: { value: 3, bonus: 0 }, experience: { value: 12, total: 40 }, renown: 5, coin: 90 },
    items: [{ _id: "t1", type: "tao", name: "Old Tao" }, { _id: "w1", type: "weapon", name: "Sword" }, { _id: "s1", type: "signature", name: "Old skill" }],
  };
  const source = {
    name: "New", img: "new.webp", prototypeToken: { name: "New", texture: { src: "tok.webp" } },
    system: { aspects: { metal: 4 }, bol: { damage: 0 }, chi: { value: 20, bonus: 1 }, experience: { value: 0, total: 0 }, renown: 0, coin: 0 },
    items: [{ _id: "x", type: "tao", name: "New Tao" }, { _id: "y", type: "weapon", name: "Sword" }, { _id: "z", type: "weapon", name: "Bow" }],
  };
  const p = planSync(current, source);
  assert.equal(p.update.name, "New");
  assert.equal(p.update.system.aspects.metal, 4);
  assert.equal(p.update.system.bol.damage, 7);
  assert.equal(p.update.system.chi.value, 3);
  assert.equal(p.update.system.chi.bonus, 1, "chi bonus is part of the build");
  assert.deepEqual(p.update.system.experience, { value: 12, total: 40 });
  assert.equal(p.update.system.coin, 90);
  assert.equal(p.update["prototypeToken.texture.src"], "tok.webp");
  assert.deepEqual(p.deleteIds.sort(), ["s1", "t1"]);
  assert.deepEqual(p.create.map(i => i.name).sort(), ["Bow", "New Tao"], "the Sword is kept, the missing Bow added");
  assert.ok(p.create.every(i => !("_id" in i)));
  assert.equal(sourceUuid({ _stats: { compendiumSource: "Compendium.m.p.Actor.a" } }), "Compendium.m.p.Actor.a");
  assert.equal(sourceUuid({ flags: { core: { sourceId: "Compendium.x" } } }), "Compendium.x");
  assert.equal(sourceUuid({}), null);
});
