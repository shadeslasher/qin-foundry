// Medical Supplies (David, 2026-11-09): Tend the Wounded heals this unit or an adjacent ally; checkpoint morale isn't lost twice.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { aiStep } from '../module/battle/ai.mjs';
import { equipmentByName } from '../module/battle/equipment-data.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
function setup(units, med = 1) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', ...u })).unitId);
  units.forEach((u, i) => { const x = R.unitById(s, ids[i]); x.men = x.maxMen = 100; if (u.med) x.traitTiers = { 'medical supplies': u.med }; });
  must(R.act(s, HOST, { type: 'startBattle' }));
  if (s.turn.phase === 'tactics') must(R.act(s, HOST, { type: 'skipTactics' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}
const turn = (s, id) => { s.turn.activation = { unitId: id, step: 'move', started: false, tilesMoved: 0, from: { ...R.unitById(s, id) } }; R.unitById(s, id).round = R.newRoundFlags(); };

test('catalogue: three tiers of gear', () => {
  assert.strictEqual(equipmentByName('Medical Supplies').kind, 'gear');
  assert.strictEqual(equipmentByName('Medical Supplies++').family, 'Medical Supplies');
});

test('heals 15% of full health, never above the start of the battle; 2 uses; takes the turn', () => {
  const { s, u, ids } = setup([{ side: 'player', owner: 'p1', x: 1, y: 1, med: 1 }, { side: 'player', owner: 'p1', x: 2, y: 1 }, { side: 'enemy', x: 9, y: 9 }]);
  u(1).men = 60;                                                    // the ally lost 40 this battle
  u(0).men = 95;                                                    // the carrier lost 5
  turn(s, ids[0]);
  assert.deepStrictEqual(R.medTargets(s, u(0)).map(t => t.id).sort(), [ids[0], ids[1]].sort());
  assert.strictEqual(R.medHeal(u(0), u(0)), 5, 'only what it lost');
  must(R.act(s, { id: 'p1' }, { type: 'tendWounded', unitId: ids[0], targetId: ids[1] }));
  assert.strictEqual(u(1).men, 75); assert.strictEqual(R.medLeft(u(0)), 1);
  turn(s, ids[0]); must(R.act(s, { id: 'p1' }, { type: 'tendWounded', unitId: ids[0], targetId: ids[1] }));
  assert.strictEqual(u(1).men, 90); assert.strictEqual(R.medLeft(u(0)), 0);
  turn(s, ids[0]); assert.ok(!R.act(s, { id: 'p1' }, { type: 'tendWounded', unitId: ids[0], targetId: ids[1] }).ok, 'no uses left');
});

test('Medical Supplies++: 20%, 3 uses', () => {
  const { s, u, ids } = setup([{ side: 'player', owner: 'p1', x: 1, y: 1, med: 3 }, { side: 'enemy', x: 9, y: 9 }]);
  u(0).men = 40; turn(s, ids[0]);
  must(R.act(s, { id: 'p1' }, { type: 'tendWounded', unitId: ids[0], targetId: ids[0] }));
  assert.strictEqual(u(0).men, 60); assert.strictEqual(R.medLeft(u(0)), 2);
});

test('not with an enemy next to the unit using it', () => {
  const { s, u, ids } = setup([{ side: 'player', owner: 'p1', x: 1, y: 1, med: 1 }, { side: 'enemy', x: 2, y: 1 }]);
  u(0).men = 50; turn(s, ids[0]);
  assert.strictEqual(R.medTargets(s, u(0)).length, 0);
  assert.ok(!R.act(s, { id: 'p1' }, { type: 'tendWounded', unitId: ids[0], targetId: ids[0] }).ok);
});

test('after healing, dropping past a checkpoint already passed costs no morale again', () => {
  const { s, u } = setup([{ side: 'player', owner: 'p1', x: 1, y: 1, med: 1 }, { side: 'enemy', x: 9, y: 9 }]);
  const x = u(0);
  x.men = 75; const m1 = 50 - R.checkpointMorale(x);               // past 80%: -10
  assert.strictEqual(m1, 40);
  x.men = 90;                                                       // healed back above 80%
  x.men = 78; assert.strictEqual(R.checkpointMorale(x), 0, 'the 80% checkpoint was already paid');
  x.men = 55; assert.strictEqual(R.checkpointMorale(x), 10, 'a new one (60%) still costs');
});

test('the AI tends a badly hurt unit when no enemy is near', () => {
  const { s, u, ids } = setup([{ side: 'enemy', x: 1, y: 1, med: 1 }, { side: 'enemy', x: 2, y: 1 }, { side: 'ally', x: 10, y: 10 }]);
  u(1).men = 50; turn(s, ids[0]);
  const a = aiStep(s, { enemy: true });
  assert.deepStrictEqual(a && { type: a.type, targetId: a.targetId }, { type: 'tendWounded', targetId: ids[1] });
});
