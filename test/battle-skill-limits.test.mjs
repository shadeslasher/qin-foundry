import test from "node:test";
import assert from "node:assert/strict";
import { skillCheck } from "../module/battle/engine.mjs";

const st = (round) => ({ turn: { round } });
const unit = (morale, last, used = false) => ({ morale, fx: { skillLast: last ?? undefined }, round: { skillUsed: used } }); // the last use lives in fx (saved with the battle)
const off = (skill) => ({ skill: { name: "S", moraleCost: 20, ...skill } });

test("battle skills: must have more morale than the cost (no paying down to 0)", () => {
  assert.equal(skillCheck(st(1), unit(80), off({ moraleCost: 80 })).ok, false);
  assert.equal(skillCheck(st(1), unit(81), off({ moraleCost: 80 })).ok, true);
  assert.equal(skillCheck(st(1), unit(90, null, true), off({})).reason, "Officer skill already used this turn");
});

test("battle skills: actives need at least 75 morale; last stands 25 or less (David, 2026-11-09)", () => {
  assert.equal(skillCheck(st(1), unit(74), off({})).reason, "Needs at least 75 morale");
  assert.equal(skillCheck(st(1), unit(75), off({})).ok, true);
  assert.equal(skillCheck(st(1), unit(26), off({ lastStand: true, moraleCost: 0 })).reason, "Last stand: only at 25 morale or less");
  assert.equal(skillCheck(st(1), unit(10), off({ lastStand: true, moraleCost: 0 })).ok, true);
});

test("battle skills: cooldown in turns, once per battle, last stand", () => {
  assert.equal(skillCheck(st(3), unit(90, 2), off({ recharge: 2 })).reason, "Recharging: 1 turn");
  assert.equal(skillCheck(st(4), unit(90, 2), off({ recharge: 2 })).ok, true);
  assert.equal(skillCheck(st(3), unit(90, 2), off({})).ok, true);
  assert.equal(skillCheck(st(9), unit(90, 1), off({ perBattle: true })).reason, "Already used this battle");
  assert.equal(skillCheck(st(1), unit(90, null), off({ perBattle: true })).ok, true);
  assert.equal(skillCheck(st(1), unit(40), off({ lastStand: true, moraleCost: 10 })).ok, false);
  assert.equal(skillCheck(st(1), unit(25), off({ lastStand: true, moraleCost: 10 })).ok, true);
  assert.equal(skillCheck(st(1), unit(25), off({ lastStand: true, moraleCost: 25 })).ok, false);
});
