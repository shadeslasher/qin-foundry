// Fire spreading, crossing fire and Extinguish (David, 2026-11-04).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
/** A 12x12 map of plains with the given squares; a player unit and a far-off enemy; the first round started. */
function setup(special = {}, at = { x: 1, y: 1 }) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  Object.assign(s.map.tiles, special);
  s.library.unitTypes.push(inf);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', owner: 'p1', ...at })).unitId;
  const e = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 11, y: 11 })).unitId;
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.siege = s.siege || { ladders: [], dropped: [], gates: [] };
  return { s, a, e };
}
const grass = { terrain: 'tall-grass' }, forest = { terrain: 'forest' };

test('fire spreads once a round to a flammable neighbour; tall grass (resistance 0) catches at once', () => {
  const { s } = setup({ '5,5': grass, '6,5': grass });
  must(R.act(s, HOST, { type: 'gmSetFire', x: 5, y: 5 }));
  R._endRound(s);
  assert.ok(s.siege.fires['6,5'], 'the grass next to it caught');
  assert.strictEqual(s.siege.fires['5,5'].left, 1, 'and the first fire burned down a round');
});

test('fire resistance: forest (1) takes a spread before it catches', () => {
  const { s } = setup({ '5,5': { terrain: 'farmland' }, '5,6': forest });
  s.siege.fires = { '5,5': { left: 5 } };
  R._endRound(s);
  assert.ok(!s.siege.fires['5,6'] && s.siege.scorch['5,6'] === 1, 'scorched once');
  R._endRound(s);
  assert.ok(s.siege.fires['5,6'], 'caught on the second spread');
});

test('fire spreads across diagonals, never onto plains, and picks among neighbours at random', () => {
  const { s } = setup({ '5,5': grass, '6,6': grass, '4,4': grass });
  s.siege.fires = { '5,5': { left: 5 } };
  R.setRng(() => 0.99); R._endRound(s);
  const lit = Object.keys(s.siege.fires).filter(k => k !== '5,5');
  assert.strictEqual(lit.length, 1, 'one square a round');
  assert.ok(['6,6', '4,4'].includes(lit[0]), 'a diagonal one: ' + lit[0]);
  const lone = setup({ '5,5': grass }).s; lone.siege.fires = { '5,5': { left: 5 } };
  R._endRound(lone);
  assert.deepStrictEqual(Object.keys(lone.siege.fires), ['5,5'], 'plains around it: nowhere to go');
});

test('walking through a burning square costs 5 morale; stopping in one does not (that costs at the end of the turn); undo gives it back', () => {
  const { s, a } = setup({ '1,2': grass }, { x: 1, y: 1 });
  s.siege.fires = { '1,2': { left: 5 } };
  // walls of impassable ground force the path through the fire
  for (const k of ['0,2', '2,2']) s.map.tiles[k] = { terrain: 'mountain' };
  const u = R.unitById(s, a), m0 = u.morale;
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  const { blue, fire } = R.moveOptions(s, u);
  assert.ok(blue.has('1,3') && fire.get('1,3') === 5, 'the path through the fire is marked -5');
  assert.ok(!fire.get('1,2'), 'stopping on the fire itself is not "passing through"');
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 1, y: 3 }));
  assert.strictEqual(u.morale, m0 - 5);
  must(R.act(s, P1, { type: 'undoMove', unitId: a }));
  assert.strictEqual(u.morale, m0, 'undo gives the morale back');
});

test('Extinguish: instead of attacking, a unit next to a fire puts it out, losing 11 minus a Yin/Yang roll in troops and morale', () => {
  const { s, a } = setup({ '2,2': grass }, { x: 1, y: 1 });
  s.siege.fires = { '2,2': { left: 3 } };
  const u = R.unitById(s, a), men = u.men, mo = u.morale;
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  assert.ok(R.actionMenu(s, u).extinguish, 'offered (a diagonal neighbour counts)');
  R.setRng(() => 0.45); // yin 4, yang 4: doubles, result 4 -> loses 7
  must(R.act(s, P1, { type: 'extinguish', unitId: a, x: 2, y: 2 }));
  assert.ok(!s.siege.fires['2,2'], 'out');
  assert.strictEqual(u.men, men - 7); assert.strictEqual(u.morale, mo - 7);
  assert.ok(u.round.activated, 'it ends the turn');
});

test('Extinguish: free with water next to the unit; only burning squares next to it', () => {
  const { s, a } = setup({ '2,1': grass, '0,1': { terrain: 'lake' } }, { x: 1, y: 1 });
  s.siege.fires = { '2,1': { left: 3 } };
  const u = R.unitById(s, a), men = u.men, mo = u.morale;
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  assert.ok(!R.act(s, P1, { type: 'extinguish', unitId: a, x: 5, y: 5 }).ok, 'not far off');
  must(R.act(s, P1, { type: 'extinguish', unitId: a, x: 2, y: 1 }));
  assert.strictEqual(u.men, men); assert.strictEqual(u.morale, mo);
  assert.ok(!s.siege.fires['2,1']);
});
