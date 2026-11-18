import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryRate, recoverDays, recoveryUpdate } from "../module/recovery.mjs";

test("rates by place", () => {
  assert.equal(recoveryRate({ owner: "faction", city: true, prosperity: "low" }), 0.2);
  assert.equal(recoveryRate({ owner: "faction", city: true, prosperity: "mid" }), 0.3);
  assert.equal(recoveryRate({ owner: "faction", city: true, prosperity: "high" }), 0.4);
  assert.equal(recoveryRate({ owner: "faction", city: false, prosperity: "high" }), 0.1); // no prosperity off-city
  assert.equal(recoveryRate({ owner: "allied", city: true, prosperity: "high" }), 0.2);
  assert.equal(recoveryRate({ owner: "allied", city: false }), 0.05);
  assert.equal(recoveryRate({ owner: "enemy", city: true }), 0);
});

test("full recovery in a faction city takes 5 days and costs 100 XP", () => {
  let u = { men: 0, maxMen: 50, level: 3, xp: 40, status: "active" };
  for (let d = 0; d < 5; d++) { const r = recoverDays(u, 0.2); u = { ...u, men: r.men, level: r.level, xp: r.xp, carryMen: r.carryMen, carryXp: r.carryXp }; }
  assert.equal(u.men, 50);
  assert.equal(u.level, 2); assert.equal(u.xp, 40); // 240 total − 100
});

test("archer of 50 loses 2 XP per health, can drop a level", () => {
  const r = recoverDays({ men: 40, maxMen: 50, level: 2, xp: 10, status: "active" }, 0.2);
  assert.equal(r.healed, 10); assert.equal(r.xpLost, 20);
  assert.equal(r.level, 1); assert.equal(r.xp, 90);
});

test("fractions carry between days", () => {
  let u = { men: 0, maxMen: 75, level: 1, xp: 0, status: "active" };
  const r1 = recoverDays(u, 0.05); // 3.75 a day
  assert.equal(r1.healed, 3); assert.ok(Math.abs(r1.carryMen - 0.75) < 1e-9);
  const r2 = recoverDays({ ...u, men: r1.men, carryMen: r1.carryMen }, 0.05);
  assert.equal(r2.healed, 4);
});

test("no XP left still recovers; defeated and full units don't", () => {
  const r = recoverDays({ men: 10, maxMen: 100, level: 1, xp: 0, status: "active" }, 0.2);
  assert.equal(r.healed, 20); assert.equal(r.xpLost, 0); assert.equal(r.level, 1);
  assert.equal(recoverDays({ men: 10, maxMen: 100, status: "defeated" }, 0.2), null);
  assert.equal(recoverDays({ men: 100, maxMen: 100, status: "active" }, 0.2), null);
});

test("level 5 unit drops to level 4", () => {
  const r = recoveryUpdate({ system: { men: { value: 50, max: 100 }, level: 5, xp: { value: 0 }, status: "active" } }, 0.2);
  assert.equal(r.update["system.level"], 4); assert.equal(r.update["system.xp.value"], 80);
});
