import test from "node:test";
import assert from "node:assert/strict";
import { MOMENTS, LOCAL_MOMENTS, ALIASES, moveSoundTimes, registerSoundPack, soundPack, soundsFor, pickSound, stepSounds, attackSounds, logSoundSteps, turnSounds } from "../module/sound.mjs";

test("sounds: every moment in the picker page's list is known, and the menu ones are local", () => {
  for (const m of ["Cursor move", "Select / confirm", "Menu opens", "Tactic triggered", "Fire catches / burning", "Gate destroyed",
    "Tactic placed", "Unit selected", "Error / not allowed", "Cancel / back", "Condition shown"]) assert.ok(MOMENTS.includes(m), m);
  for (const m of ["Cursor move", "Select / confirm", "Menu opens", "Unit selected", "Error / not allowed", "Cancel / back", "Tactic placed"]) assert.ok(LOCAL_MOMENTS.has(m), m);
  assert.ok(!LOCAL_MOMENTS.has("Tactic triggered") && !LOCAL_MOMENTS.has("Melee hit"));
});

test("sounds: the GM's own files replace the pack's; empty moments borrow a fallback; random pick", () => {
  const pack = { "Melee hit": ["a.ogg", "b.ogg"], "Bow shot": ["bow.ogg"] };
  assert.deepEqual(soundsFor("Melee hit", pack, {}), ["a.ogg", "b.ogg"]);
  assert.deepEqual(soundsFor("Melee hit", pack, { "Melee hit": ["mine.ogg"] }), ["mine.ogg"]);
  assert.deepEqual(soundsFor("Melee hit", pack, { "Melee hit": [] }), ["a.ogg", "b.ogg"]);
  assert.deepEqual(soundsFor("Crossbow shot", pack, {}), ["bow.ogg"]);
  assert.deepEqual(soundsFor("Cavalry charge", pack, {}), ["a.ogg", "b.ogg"]);
  assert.deepEqual(soundsFor("Gate opens", pack, {}), []);
  assert.equal(pickSound(["a", "b", "c"], 0), "a");
  assert.equal(pickSound(["a", "b", "c"], 0.5), "b");
  assert.equal(pickSound(["a", "b", "c"], 0.9999), "c");
  assert.equal(pickSound([], 0.3), null);
});

test("sounds: an attack's sounds as it starts, lands and is struck back", () => {
  const dmg = [["unitDamage", "-3"]];
  assert.deepEqual(attackSounds({ ranged: false, toDefender: dmg }), { start: null, hit: "Melee hit", back: null });
  assert.deepEqual(attackSounds({ ranged: false, toDefender: dmg, charge: true, returnStrike: true }), { start: null, hit: "Cavalry charge", back: "Counter-attack" });
  assert.deepEqual(attackSounds({ ranged: false, toDefender: [] }).hit, "Miss or blocked");
  assert.deepEqual(attackSounds({ ranged: true, toDefender: dmg }), { start: "Bow shot", hit: "Arrow hit", back: null });
  assert.equal(attackSounds({ ranged: true, crossbow: true, toDefender: dmg }).start, "Crossbow shot");
  assert.equal(attackSounds({ ranged: true, crossbow: true, overwatch: true, toDefender: dmg }).start, "Overwatch shot");
  assert.equal(attackSounds({ ranged: true, toDefender: [["moraleDown", "-5 morale"]] }).hit, "Miss or blocked");
});

test("sounds: animation steps and log entries", () => {
  assert.deepEqual(stepSounds({ kind: "tactic" }), [[0, "Tactic triggered"]]);
  assert.deepEqual(stepSounds({ kind: "setFire" }), [[0, "Fire catches / burning"]]);
  assert.deepEqual(stepSounds({ kind: "floats", items: [["u", "moraleDown", "-5"], ["v", "xp", "+1 XP"]] }), [[0, "Morale drop"], [150, "XP gained"]]);
  assert.deepEqual(stepSounds({ kind: "fallen", units: [["a", "skull"], ["b", "flag"]] }), [[0, "Unit destroyed"], [250, "Unit surrenders"]]);
  assert.deepEqual(stepSounds({ kind: "attack" }), []);
  const steps = logSoundSteps([
    { detail: { type: "overwatch", on: true } }, { detail: { type: "gate", state: "open", by: "u1" } },
    { detail: { type: "gate", state: "broken" } }, { detail: { type: "burntDown", gate: true } }, { detail: { type: "burntDown", gate: false } },
    { detail: { type: "outcome", result: "victory" } }, { detail: { type: "skill" } }, { detail: { type: "ladder" } },
  ], "holdPosition");
  assert.deepEqual(steps.map(s => s.moment), ["Overwatch set", "Gate opens", "Gate destroyed", "Victory", "Officer skill", "Ladder placed", "Hold"]);
  assert.deepEqual(logSoundSteps([{ detail: { type: "gate", state: "locked", by: "u1" } }], "reload").map(s => s.moment), ["Reload"]);
});

test("sounds: battle start, round start, and whose turn", () => {
  const off = { active: false, round: 0, unit: null, phase: null };
  assert.deepEqual(turnSounds(off, { active: true, round: 0, unit: null, phase: "tactics" }), ["Battle start"]);
  assert.deepEqual(turnSounds(off, { active: true, round: 0, unit: null, phase: "setup" }), []);
  assert.deepEqual(turnSounds({ active: true, round: 0, phase: "setup" }, { active: true, round: 0, phase: "tactics" }), ["Battle start"]);
  assert.deepEqual(turnSounds({ active: true, round: 1, unit: "a", phase: "rounds" }, { active: true, round: 1, unit: "b", side: "enemy", phase: "rounds" }), ["Turn start"]);
  assert.deepEqual(turnSounds({ active: true, round: 1, unit: "a", phase: "rounds" }, { active: true, round: 2, unit: "c", side: "player", phase: "rounds" }), ["Round start", "Turn start"]);
  assert.deepEqual(turnSounds({ active: true, round: 1, unit: "a", phase: "rounds" }, { active: true, round: 1, unit: "a", side: "player", phase: "rounds" }), []);
  assert.deepEqual(turnSounds({ active: true, round: 1, unit: "a" }, { active: false }), []);
});

test("sounds: victory and defeat condition shown are one moment (old names still load)", () => {
  assert.ok(!MOMENTS.includes("Victory condition shown") && MOMENTS.includes("Condition shown"));
  registerSoundPack({ "Victory condition shown": ["v.ogg"], "Defeat condition shown": ["d.ogg"] });
  assert.deepEqual(soundPack()["Condition shown"], ["v.ogg", "d.ogg"]);
  assert.equal(ALIASES["Defeat condition shown"], "Condition shown");
});

test("sounds: player and enemy turns share Turn start; move sounds repeat once per square", () => {
  assert.ok(MOMENTS.includes("Turn start") && !MOMENTS.includes("Player turn") && !MOMENTS.includes("Enemy turn"));
  registerSoundPack({ "Player turn": ["p.ogg"], "Enemy turn": ["e.ogg"] });
  assert.deepEqual(soundPack()["Turn start"], ["p.ogg", "e.ogg"]);
  assert.deepEqual(moveSoundTimes(1), [0, 167]);
  assert.deepEqual(moveSoundTimes(4), [0, 167, 333, 500].map(Math.round).map((v, i) => i * 167));
  assert.equal(moveSoundTimes(40).length, 12);
  assert.deepEqual(moveSoundTimes(3, 10), [0, 160, 320]);
});
