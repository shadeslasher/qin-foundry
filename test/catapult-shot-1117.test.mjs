// Catapult shots (David, 2026-11-17): an attack a ranged unit can only make because it stands on a catapult ignores its
// officer's Command and weapon skill and the bonuses of battlefield skills; a shot within its own range keeps them.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res && res.ok !== false, res && res.error); return res; }
const bow = { id: 'bow', name: 'Bow', faction: 'X', tier: 2, category: 'infantry', weapon: 'ranged', skill: 'Gongshu', damage: 4, armor: 2, armorPen: 1, unitValue: 2, move: 3, rangeMin: 2, rangeMax: 3 };
const inf = { ...bow, id: 'inf', name: 'Inf', weapon: 'melee', skill: 'Qiangshu', rangeMin: 1, rangeMax: 1 };
const off = { id: 'o', name: 'Officer o', command: 5, fire: 2, skills: { gongshu: 4 }, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { passiveName: 'Sharp Eyes', passive: { mods: [{ stat: 'attack', value: 3, who: { self: true } }] } } };
function setup(dist) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 16; s.map.rows = 4; s.map.tiles = {};
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.map.tiles['1,1'] = { terrain: 'plains', overlays: ['catapult'] };
  s.library.unitTypes.push(bow, inf); s.library.officers.push(off);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'bow', owner: 'p1', side: 'player', x: 1, y: 1, officerId: 'o', morale: 80 })).unitId;
  const d = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 1 + dist, y: 1 })).unitId;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'act', started: true, tilesMoved: 0, from: { x: 1, y: 1 } };
  const n = s.log.length;
  must(R.act(s, HOST, { type: 'attack', unitId: a, targetId: d }));
  return s.log.slice(n).find(e => e.detail?.type === 'attack').detail.result;
}
const part = (r, re) => (r.attackRoll.parts.find(([k]) => re.test(k)) || [null, null])[1];

test('a shot past its own range from a catapult: no Command, weapon skill or skill bonus', () => {
  const r = setup(8);
  assert.strictEqual(r.catapult, true);
  assert.strictEqual(part(r, /^Command/), 0);
  assert.strictEqual(part(r, /Officer's weapon/), null);
  assert.ok(!r.attackRoll.parts.some(([k]) => /Sharp Eyes/.test(k)), 'the passive is ignored');
});
test('a shot within its own range from a catapult keeps them', () => {
  const r = setup(3);
  assert.ok(!r.catapult);
  assert.strictEqual(part(r, /^Command/), 5);
  assert.strictEqual(part(r, /Officer's weapon/), 3);
  assert.ok(r.attackRoll.parts.some(([k]) => /Sharp Eyes/.test(k)), 'the passive counts');
});
