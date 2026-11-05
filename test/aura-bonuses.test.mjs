// Aura bonuses (skill-effects schema v2.3, David, 2026-11-05): passive unique skills that give allies near the holder
// a bonus. Pure selection: disposition, range, defeated holders, never the holder, no stacking of the same aura,
// always-on vs situational.
import test from "node:test";
import assert from "node:assert/strict";
import "./mocks.mjs";
import { normalizeBonus, normalizeAura, collectBonuses, bonusSourcesOf, auraBonusesFor, auraBonusesOf, auraRangeText, bonusParts, resistParts } from "../module/rules/bonuses.mjs";

const passive = (id, name, bonuses) => ({ id, name, type: "signature", system: { slot: "passive", bonuses } });
const fear = passive("fe", "Steady Presence", [{ stat: "resistTest", value: 1, mode: "always", against: ["fear"], aura: { range: 0, who: "allies who can hear him" } }]);
const ranged = passive("rg", "Shield Wall", [{ stat: "pd", value: 1, mode: "situational", condition: "against ranged attacks", aura: { range: 1, who: "allies next to him" } }]);
const officers = passive("of", "Stern Commander", [{ stat: "attack", value: 1, mode: "situational", aura: { range: 0, who: "officers under his command" } }]);
const both = passive("bo", "First Into the Fray", [
  { stat: "initiative", value: 2, mode: "always", condition: "first round of a fight", label: "First Into the Fray" },
  { stat: "initiative", value: 2, mode: "always", condition: "first round of a fight", label: "First Into the Fray", aura: { range: 0, who: "allies who can hear him" } }]);

/** A source token on the scene. */
const src = (tokenId, name, items, { disposition = 1, out = false, actorId = `A_${name}`, linked = true, aspects = {} } = {}) =>
  ({ tokenId, actorId, linked, name, disposition, out, aspects, bonusSources: bonusSourcesOf(items) });
const me = { tokenId: "me", actorId: "A_me", linked: true, disposition: 1 };

test("aura: normalised on the bonus (range squares, 0 = the scene; who is text); not an object = no aura", () => {
  assert.deepEqual(normalizeAura({ range: "1", who: " allies next to him " }), { range: 1, who: "allies next to him" });
  assert.deepEqual(normalizeAura({ who: "allies who can see him" }), { range: 0, who: "allies who can see him" }, "missing range = anywhere on the scene");
  assert.deepEqual(normalizeAura({ range: -3 }), { range: 0, who: "" });
  assert.equal(normalizeAura(null), null);
  assert.equal(normalizeAura("yes"), null);
  assert.equal(normalizeAura([1]), null);
  assert.deepEqual(normalizeBonus({ stat: "ad", value: 1, aura: { range: 0, who: "allies who can see him" } }).aura, { range: 0, who: "allies who can see him" });
  assert.equal("aura" in normalizeBonus({ stat: "ad", value: 1 }), false, "plain bonuses carry no aura");
  assert.equal("aura" in normalizeBonus({ stat: "ad", value: 1, aura: null }), false);
  assert.equal(auraRangeText({ range: 1 }), "next to him");
  assert.equal(auraRangeText({ range: 3 }), "within 3 squares");
  assert.equal(auraRangeText({ range: 0 }), "on the scene");
});

test("aura: never in the holder's own bonuses; his plain copy is (the data gives him a separate one)", () => {
  const own = collectBonuses(bonusSourcesOf([fear, both]));
  assert.deepEqual(own.map(b => [b.key, b.stat, b.value]), [["bo:0", "initiative", 2]], "only the plain bonus");
  const gives = auraBonusesOf(bonusSourcesOf([fear, both]));
  assert.deepEqual(gives.map(b => [b.key, b.stat, b.aura.who]), [["fe:0", "resistTest", "allies who can hear him"], ["bo:1", "initiative", "allies who can hear him"]]);
  // keys stay the bonus's index on the item, so tick boxes and steps don't move
  assert.equal(gives[1].key, "bo:1");
});

test("aura selection: same disposition only; neutral gets none and gives none", () => {
  const sources = [src("a", "Fan Chou", [fear]), src("e", "Enemy Drummer", [fear], { disposition: -1 }), src("n", "Neutral Monk", [fear], { disposition: 0 })];
  assert.deepEqual(auraBonusesFor({ receiver: me, sources }).map(b => b.holderName), ["Fan Chou"]);
  assert.deepEqual(auraBonusesFor({ receiver: { ...me, disposition: -1 }, sources }).map(b => b.holderName), ["Enemy Drummer"], "hostile with hostile");
  assert.deepEqual(auraBonusesFor({ receiver: { ...me, disposition: 0 }, sources }), [], "neutral receives nothing");
  assert.deepEqual(auraBonusesFor({ receiver: { ...me, disposition: -2 }, sources: [src("s", "Secret", [fear], { disposition: -2 })] }), [], "secret: none");
  assert.deepEqual(auraBonusesFor({ receiver: null, sources }), []);
});

test("aura selection: range in squares (1 = next to him); 0 = anywhere on the scene; unknown distance = out of reach", () => {
  const sources = [src("w", "Wall Holder", [ranged]), src("f", "Fan Chou", [fear])];
  const at = (d) => auraBonusesFor({ receiver: me, sources, distance: { w: d, f: 40 } }).map(b => b.holderName);
  assert.deepEqual(at(1), ["Wall Holder", "Fan Chou"]);
  assert.deepEqual(at(0), ["Wall Holder", "Fan Chou"], "same square");
  assert.deepEqual(at(2), ["Fan Chou"], "two squares: only the scene-wide one");
  assert.deepEqual(at(null), ["Fan Chou"]);
  const calls = [];
  auraBonusesFor({ receiver: me, sources, distance: (s) => { calls.push(s.tokenId); return 1; } });
  assert.deepEqual(calls, ["w"], "distance measured only for ranged auras, once per holder");
});

test("aura selection: defeated / out of action holders give nothing", () => {
  assert.deepEqual(auraBonusesFor({ receiver: me, sources: [src("a", "Fan Chou", [fear], { out: true })] }), []);
});

test("aura selection: never the holder himself (same token, or the same linked actor); an unlinked copy of the same henchman is someone else", () => {
  assert.deepEqual(auraBonusesFor({ receiver: me, sources: [src("me", "Me", [fear], { actorId: "A_me" })] }), [], "same token");
  assert.deepEqual(auraBonusesFor({ receiver: me, sources: [src("me2", "Me again", [fear], { actorId: "A_me" })] }), [], "same linked actor, other token");
  const sergeant = { tokenId: "s1", actorId: "A_sgt", linked: false, disposition: 1 };
  assert.equal(auraBonusesFor({ receiver: sergeant, sources: [src("s2", "Sergeant", [fear], { actorId: "A_sgt", linked: false })] }).length, 1, "another unlinked token of the same actor");
});

test("aura selection: copies of the same aura never stack; different holders' do", () => {
  const sources = [src("a1", "Fan Chou", [fear], { actorId: "A_fan" }), src("a2", "Fan Chou", [fear], { actorId: "A_fan", linked: false }), src("b", "Sun Jing", [fear])];
  const list = auraBonusesFor({ receiver: me, sources });
  assert.deepEqual(list.map(b => [b.key, b.holderName]), [["aura:A_fan:fe:0", "Fan Chou"], ["aura:A_Sun Jing:fe:0", "Sun Jing"]]);
  const r = resistParts(list, ["fear"]);
  assert.equal(r.total, 2, "two holders: +1 each");
  assert.deepEqual(r.parts.map(p => p.label), ["Fan Chou (aura): Steady Presence (vs fear)", "Sun Jing (aura): Steady Presence (vs fear)"]);
});

test("aura selection: always-on ones apply; situational ones are tick boxes labelled '<Holder>: <skill> (<who>)', unticked by default", () => {
  const list = auraBonusesFor({ receiver: me, sources: [src("o", "Cao Cao", [officers]), src("w", "Wall Holder", [ranged])], distance: () => 1 });
  assert.deepEqual(list.map(b => [b.label, b.mode, b.fromAura]), [
    ["Cao Cao: Stern Commander (officers under his command)", "situational", true],
    ["Wall Holder: Shield Wall (allies next to him)", "situational", true]]);
  const off = bonusParts(list, "attack");
  assert.equal(off.total, 0, "unticked by default");
  assert.equal(off.situational[0].ticked, false);
  const on = bonusParts(list, "attack", { ticked: { [list[0].key]: true } });
  assert.equal(on.total, 1);
  assert.equal(on.parts[0].label, "Cao Cao: Stern Commander (officers under his command)");
  const pd = bonusParts(list, "pd", { ticked: { [list[1].key]: true } });
  assert.deepEqual(pd.parts.map(p => [p.label, p.value]), [["Wall Holder: Shield Wall (allies next to him) (against ranged attacks)", 1]]);
  // always on
  const init = auraBonusesFor({ receiver: me, sources: [src("x", "Xiahou Dun", [both])] });
  assert.deepEqual(bonusParts(init, "initiative").parts.map(p => [p.label, p.value, !!p.situational]), [["Xiahou Dun (aura): First Into the Fray", 2, false]]);
});

test("aura selection: an Aspect in the value is the holder's; an aura put on him by someone else's effect doesn't spread", () => {
  const metal = passive("me", "Iron Example", [{ stat: "ad", value: 0, aspect: "metal", aura: { range: 0, who: "allies who can see him" } }]);
  assert.equal(auraBonusesFor({ receiver: me, sources: [src("h", "Holder", [metal], { aspects: { metal: 4 } })] })[0].value, 4);
  const s = src("h", "Holder", [], {});
  s.bonusSources = [{ id: "fx", name: "Borrowed", bonuses: fear.system.bonuses, fromEffect: true, sourceActor: "Actor.someone" }];
  assert.deepEqual(auraBonusesFor({ receiver: me, sources: [s] }), []);
  s.bonusSources[0].sourceActor = null; // his own active, in force on him
  assert.equal(auraBonusesFor({ receiver: me, sources: [s] }).length, 1);
});
