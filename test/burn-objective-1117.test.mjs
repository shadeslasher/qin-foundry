// Burn objectives give Set Fire to a unit next to the square; fire doesn't spread onto open plains (David, 2026-11-17).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as D from '../module/battle/engine-data.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res && res.ok !== false, res && res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
function setup(tiles = {}) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 10; s.map.rows = 6; s.map.tiles = {};
  for (let x = 0; x < 10; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains', ...(tiles[x + ',' + y] || {}) };
  s.library.unitTypes.push(inf);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: 'p1', side: 'player', x: 2, y: 2 })).unitId;
  must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 8, y: 5 }));
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'act', started: true, tilesMoved: 0, from: { x: 2, y: 2 } };
  return { s, a };
}

test('a unit next to a burn objective gets Set Fire for that square, without a tactic', () => {
  const { s, a } = setup({ '3,2': { terrain: 'forest' } });
  s.objectives = { victory: [{ id: 'b1', type: 'burn', x: 3, y: 2 }], defeat: [] };
  const u = R.unitById(s, a);
  assert.ok(R.actionMenu(s, u).setFire);
  assert.deepStrictEqual(R.setFireTiles(s, u), [[3, 2]]);
  must(R.act(s, HOST, { type: 'setFire', unitId: a, x: 3, y: 2 }));
  assert.ok(s.siege.fires['3,2']);
});

test('no burn objective next to it and no tactic: no Set Fire', () => {
  const { s, a } = setup({ '3,2': { terrain: 'forest' } });
  s.objectives = { victory: [{ id: 'b1', type: 'burn', x: 6, y: 2 }], defeat: [] };
  assert.ok(!R.actionMenu(s, R.unitById(s, a)).setFire);
  assert.ok(R.act(s, HOST, { type: 'setFire', unitId: a, x: 3, y: 2 }).ok === false);
});

test('fire spreads to forest but never onto open plains', () => {
  const was = D.MAP_TERRAIN.plains.flammable; D.MAP_TERRAIN.plains.flammable = true; // as a sheet that makes plains burn
  try {
    const { s } = setup({ '5,2': { terrain: 'forest' } });
    s.siege = { fires: { '5,2': { left: 5 } }, burnt: {} };
    for (let i = 0; i < 6; i++) R._endRound(s);
    const lit = Object.keys({ ...s.siege.fires, ...s.siege.burnt, ...(s.siege.scorch || {}) }).filter(k => k !== '5,2');
    assert.deepStrictEqual(lit, [], 'nothing around it caught: ' + lit.join(' '));
  } finally { D.MAP_TERRAIN.plains.flammable = was; }
});
