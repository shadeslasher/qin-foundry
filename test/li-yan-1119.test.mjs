// Li Yan, Keep the Grain Moving (David, 2026-11-19): officerless allies within 3 regain 3 morale at the end of their turn, up to resting.
import test from 'node:test'; import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const spec = { triggers: [{ on: 'allyTurnEnd', range: 3, targetIf: { officer: false }, do: [{ morale: 3, upToResting: true, who: { target: true } }] }] };
test('Li Yan: officerless allies within 3 regain 3 morale at the end of their turn, up to resting', () => {
  assert.deepStrictEqual(validateSpec(spec, 'passive'), []);
  const s = R.newState(); s.map.cols = 10; s.map.rows = 6; s.map.tiles = {}; for (let x = 0; x < 10; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push({ id: 'inf', name: 'Inf', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 });
  s.library.officers.push({ id: 'ly', name: 'Li Yan', command: 2, fire: 2, skills: {}, passive: { effects: {} }, battle: { passive: spec, active: null, passiveName: 'Keep the Grain Moving' } }, { id: 'x', name: 'X', command: 4, fire: 4, skills: {}, passive: { effects: {} } });
  const H = { id: 'host', host: true };
  R.act(s, H, { type: 'addUnit', typeId: 'inf', side: 'player', x: 1, y: 1, officerId: 'ly', morale: 70 });
  const near = R.act(s, H, { type: 'addUnit', typeId: 'inf', side: 'player', x: 3, y: 1, morale: 40 }).unitId;
  const far = R.act(s, H, { type: 'addUnit', typeId: 'inf', side: 'player', x: 8, y: 1, morale: 40 }).unitId;
  const led = R.act(s, H, { type: 'addUnit', typeId: 'inf', side: 'player', x: 2, y: 2, officerId: 'x', morale: 40 }).unitId;
  R.act(s, H, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 9, y: 5 });
  R.act(s, H, { type: 'startBattle' }); R.setRng(() => 0.3); R.act(s, H, { type: 'startRound' });
  const end = (id) => { const u = R.unitById(s, id); s.turn.activation = { unitId: id, step: 'move', started: true, tilesMoved: 0, from: { x: u.x, y: u.y } }; u.round.activated = false; R.act(s, H, { type: 'endTurn', unitId: id }); return u.morale; };
  const n0 = R.unitById(s, near).morale, f0 = R.unitById(s, far).morale, l0 = R.unitById(s, led).morale;
  assert.strictEqual(end(near), n0 + 3); assert.strictEqual(end(far), f0); assert.strictEqual(end(led), Math.min(75, l0 + 8), 'officer unit: only its own Fire + Command');
  R.unitById(s, near).morale = 49; assert.strictEqual(end(near), 50, 'up to resting');
});
