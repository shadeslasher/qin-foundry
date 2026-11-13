// Siege equipment as a player's stock, handed out during deployment (David, 2026-11-13).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { catapultTileOk, siegeLosses, afterLosses, issuedNow, stockRoom, stockTotal } from '../module/battle/siege-deploy.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
const P2 = { id: 'p2', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
/** 10x10 plains with a forest at (1,1), a hill at (2,2), a fort at (3,2), a watchtower at (4,2); zone = x <= 4. */
function field() {
  const s = R.newState(); s.players.p1 = { name: 'Alice' }; s.players.p2 = { name: 'Bob' };
  s.map.cols = 10; s.map.rows = 10; s.map.tiles = {};
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.map.tiles['1,1'] = { terrain: 'forest' };
  s.map.tiles['2,2'] = { terrain: 'plains', overlays: ['hill'] };
  s.map.tiles['3,2'] = { terrain: 'plains', overlays: ['fort'] };
  s.map.tiles['4,2'] = { terrain: 'plains', overlays: ['watchtower'] };
  s.deployZones = []; for (let x = 0; x <= 4; x++) for (let y = 0; y < 10; y++) s.deployZones.push(x + ',' + y);
  s.library.unitTypes.push(unitType('inf'), unitType('cav', { category: 'cavalry', move: 5 }), unitType('arch', { weapon: 'ranged', rangeMax: 3 }));
  s.siegeStock = { p1: { ladders: 1, engine: 1, catapult: 1 }, p2: { ladders: 0, engine: 0, catapult: 0 } };
  return s;
}
const add = (s, o) => R.unitById(s, must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);
function deploying(s) { must(R.act(s, HOST, { type: 'startBattle' })); assert.equal(s.turn.phase, 'tactics'); return s; }

test('catapult squares: hills, forts and open ground; not forest or watchtowers', () => {
  assert.ok(catapultTileOk({ terrain: 'plains' }).ok);
  assert.ok(catapultTileOk({ terrain: 'plains', overlays: ['hill'] }).ok);
  assert.ok(catapultTileOk({ terrain: 'paving', overlays: ['fort'] }).ok);
  assert.ok(catapultTileOk({ terrain: 'farmland', overlays: ['road'] }).ok);
  assert.ok(!catapultTileOk({ terrain: 'forest' }).ok);
  assert.ok(!catapultTileOk({ terrain: 'plains', overlays: ['trees'] }).ok);
  assert.ok(!catapultTileOk({ terrain: 'plains', overlays: ['watchtower'] }).ok);
  assert.ok(!catapultTileOk({ terrain: 'plains', overlays: ['city-wall'] }).ok);
  assert.ok(!catapultTileOk({ terrain: 'marsh' }).ok);
  assert.ok(!catapultTileOk({ terrain: 'plains', overlays: ['catapult'] }).ok);
});

test('siege equipment waits for the GM, then comes out of the player\'s stock', () => {
  const s = field();
  const a = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 0, y: 5 });
  const b = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 1, y: 5 });
  const c = add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 2, y: 5 });
  const d = add(s, { typeId: 'inf', side: 'player', owner: 'p2', x: 3, y: 5 });
  deploying(s);
  assert.equal(s.siegeDeploy, false, 'off when deployment starts');
  assert.ok(!R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: 'ladders' }).ok, 'not before the GM allows it');
  assert.ok(!R.act(s, P1, { type: 'allowSiege', on: true }).ok, 'only the GM switches it on');
  must(R.act(s, HOST, { type: 'allowSiege', on: true }));
  must(R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: 'ladders' }));
  assert.equal(a.carry, 'ladders');
  assert.ok(!R.act(s, P1, { type: 'assignSiege', unitId: b.id, kind: 'ladders' }).ok, 'only one ladder in stock');
  must(R.act(s, P1, { type: 'assignSiege', unitId: b.id, kind: 'engine' }));
  assert.ok(!R.act(s, P1, { type: 'assignSiege', unitId: c.id, kind: 'ladders' }).ok, 'cavalry carries none');
  assert.ok(!R.act(s, P1, { type: 'assignSiege', unitId: d.id, kind: 'ladders' }).ok, 'not someone else\'s unit');
  assert.ok(!R.act(s, P2, { type: 'assignSiege', unitId: d.id, kind: 'ladders' }).ok, 'p2 has no ladders');
  must(R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: null }));
  assert.equal(a.carry, null);
  must(R.act(s, P1, { type: 'assignSiege', unitId: b.id, kind: 'ladders' })); // swap: the engine goes back, the ladder comes out
  assert.equal(b.carry, 'ladders');
});

test('catapults: inside the zone, on allowed squares, out of stock; taken down during deployment', () => {
  const s = field(); deploying(s);
  assert.ok(!R.act(s, P1, { type: 'placeCatapult', x: 2, y: 2 }).ok, 'switch off');
  must(R.act(s, HOST, { type: 'allowSiege', on: true }));
  assert.ok(!R.act(s, P1, { type: 'placeCatapult', x: 7, y: 2 }).ok, 'outside the zone');
  assert.ok(!R.act(s, P1, { type: 'placeCatapult', x: 1, y: 1 }).ok, 'forest');
  assert.ok(!R.act(s, P1, { type: 'placeCatapult', x: 4, y: 2 }).ok, 'watchtower');
  must(R.act(s, P1, { type: 'placeCatapult', x: 2, y: 2 }));
  assert.deepEqual(s.map.tiles['2,2'].overlays, ['hill', 'catapult']);
  assert.ok(R.tileRules(s, 2, 2).names.includes('Catapult'));
  assert.ok(!R.act(s, P1, { type: 'placeCatapult', x: 3, y: 2 }).ok, 'only one in stock');
  assert.ok(!R.act(s, P2, { type: 'removeCatapult', x: 2, y: 2 }).ok, 'not someone else\'s');
  must(R.act(s, P1, { type: 'removeCatapult', x: 2, y: 2 }));
  assert.deepEqual(s.map.tiles['2,2'].overlays, ['hill']);
  must(R.act(s, P1, { type: 'placeCatapult', x: 3, y: 2 }));
  assert.equal(s.siege.catapults.length, 1);
});

test('deployment ends: the hand-out is recorded and the switch locks', () => {
  const s = field();
  const a = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 0, y: 5 });
  deploying(s);
  must(R.act(s, HOST, { type: 'allowSiege', on: true }));
  must(R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: 'engine' }));
  must(R.act(s, P1, { type: 'placeCatapult', x: 0, y: 0 }));
  must(R.act(s, HOST, { type: 'skipTactics' }));
  assert.equal(s.siegeDeploy, false);
  assert.deepEqual(s.siegeIssued, { p1: { ladders: 0, engine: 1, catapult: 1 } });
  assert.ok(!R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: null }).ok, 'locked once the battle starts');
});

test('back to setup returns everything', () => {
  const s = field();
  const a = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 0, y: 5 });
  deploying(s);
  must(R.act(s, HOST, { type: 'allowSiege', on: true }));
  must(R.act(s, P1, { type: 'assignSiege', unitId: a.id, kind: 'ladders' }));
  must(R.act(s, P1, { type: 'placeCatapult', x: 0, y: 0 }));
  must(R.act(s, HOST, { type: 'resetBattle' }));
  assert.equal(a.carry, null);
  assert.deepEqual(s.map.tiles['0,0'].overlays ?? [], []);
  assert.equal(s.siege.catapults.length, 0);
});

test('losses: only what was used', () => {
  const issued = { p1: { ladders: 2, engine: 1, catapult: 1 }, p2: { ladders: 1, engine: 0, catapult: 0 } };
  const back = { p1: { ladders: 1, engine: 0, catapult: 1 }, p2: { ladders: 1 } };
  assert.deepEqual(siegeLosses(issued, back), { p1: { ladders: 1, engine: 1, catapult: 0 } });
  assert.deepEqual(afterLosses({ ladders: 3, engine: 1, catapult: 1 }, { ladders: 1, engine: 1, catapult: 0 }), { ladders: 2, engine: 0, catapult: 1 });
  assert.equal(stockRoom({ ladders: 2, engine: 1 }, 6), 3);
  assert.equal(stockRoom({ ladders: 2 }, null), Infinity);
  assert.equal(stockTotal({ ladders: 2, engine: 1, catapult: 1 }), 4);
});

test('issuedNow counts carried equipment and standing catapults per player', () => {
  const s = field();
  add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 0, y: 5 }).carry = 'ladders';
  add(s, { typeId: 'inf', side: 'enemy', x: 8, y: 5 }).carry = 'engine';
  s.siege = { ladders: [], dropped: [], gates: [], catapults: [{ x: 0, y: 0, owner: 'p1' }] };
  assert.deepEqual(issuedNow(s), { p1: { ladders: 1, engine: 0, catapult: 1 } });
});
