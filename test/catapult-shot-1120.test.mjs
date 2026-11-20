// Catapults (David, 2026-11-20): every shot from a catapult is a catapult shot: range 12 flat (no other range bonus),
// Damage 10, Pen 10, Attack +6, base Splash Attack. The officer's Command and weapon skill and the crew's traits don't
// count; unit tier and battlefield-skill auras (its own officer's included) do.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res && res.ok !== false, res && res.error); return res; }
const bow = { id: 'bow', name: 'Bow', faction: 'X', tier: 2, category: 'infantry', weapon: 'ranged', skill: 'Gongshu', damage: 4, armor: 2, armorPen: 1, unitValue: 2, move: 3, rangeMin: 2, rangeMax: 3 };
const inf = { ...bow, id: 'inf', name: 'Inf', weapon: 'melee', skill: 'Qiangshu', rangeMin: 1, rangeMax: 1, armor: 0, health: 100 };
const off = { id: 'o', name: 'Officer o', command: 5, fire: 2, skills: { gongshu: 4 }, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { passiveName: 'Sharp Eyes', passive: { mods: [{ stat: 'attack', value: 3, who: { self: true } }, { stat: 'range', value: 2, who: { self: true } }] } } };
function setup(dist, { traits = {}, splashTarget = false } = {}) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 20; s.map.rows = 4; s.map.tiles = {};
  for (let x = 0; x < 20; x++) for (let y = 0; y < 4; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.map.tiles['1,1'] = { terrain: 'plains', overlays: ['catapult'] };
  s.library.unitTypes.push(bow, inf); s.library.officers.push(off);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'bow', owner: 'p1', side: 'player', x: 1, y: 1, officerId: 'o', morale: 80 })).unitId;
  const d = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 1 + dist, y: 1 })).unitId;
  const nb = splashTarget ? must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 1 + dist, y: 2 })).unitId : null;
  R.unitById(s, a).traitTiers = traits;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'act', started: true, tilesMoved: 0, from: { x: 1, y: 1 } };
  const nbBefore = nb ? R.unitById(s, nb).men : 0;
  const n = s.log.length;
  const res = R.act(s, HOST, { type: 'attack', unitId: a, targetId: d });
  const r = res.ok === false ? null : s.log.slice(n).find(e => e.detail?.type === 'attack')?.detail.result;
  return { s, r, res, nb: nb && R.unitById(s, nb), nbBefore, att: R.unitById(s, a) };
}
const part = (r, re) => (r.attackRoll.parts.find(([k]) => re.test(k)) || [null, null])[1];

for (const dist of [3, 8]) test(`every shot from a catapult (distance ${dist}): +6, no Command or weapon skill, auras count`, () => {
  const { r } = setup(dist);
  assert.strictEqual(r.catapult, true);
  assert.strictEqual(part(r, /^Catapult/), 6);
  assert.strictEqual(part(r, /^Command/), 0);
  assert.strictEqual(part(r, /Officer's weapon/), null);
  assert.ok(r.attackRoll.parts.some(([k]) => /Sharp Eyes/.test(k)), "its own officer's passive counts");
});
test('range 12 flat: other range bonuses (the +2 from the passive) don\'t add', () => {
  assert.ok(setup(12).r, '12 is in range');
  assert.strictEqual(setup(13).res.ok, false, '13 is out of range');
});
test('the crew\'s traits don\'t count, and the trait flag is cleared afterwards', () => {
  const { r, att } = setup(5, { traits: { precision: 1 } });
  assert.strictEqual(part(r, /Precision/), null);
  assert.ok(!att._catShot);
});
test('Damage 10 and a base splash on the units next to the target', () => {
  const { r, nb, nbBefore } = setup(5, { splashTarget: true });
  assert.ok(r.casualtiesDefender >= 10, 'damage 10 against armor 0: ' + r.casualtiesDefender);
  assert.strictEqual(nbBefore - nb.men, 2, 'splash 2');
});
