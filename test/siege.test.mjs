// City walls, ladders and siege equipment.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function dice(values) { const q = values.slice(); R.setRng(() => (q.length ? q.shift() : 0) / 10 + 0.001); }
function must(res) { assert.ok(res.ok, res.error); return res; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
/** 14x14 plains; a walled city from (3,3) to (9,9): wall ring, a tower at (3,3), a gate at (6,9), paving inside. */
function city() {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.map.cols = 14; s.map.rows = 14; s.map.tiles = {};
  for (let x = 0; x < 14; x++) for (let y = 0; y < 14; y++) {
    const ring = x >= 3 && x <= 9 && y >= 3 && y <= 9 && (x === 3 || x === 9 || y === 3 || y === 9);
    const inside = x > 3 && x < 9 && y > 3 && y < 9;
    s.map.tiles[x + ',' + y] = { terrain: inside ? 'paving' : 'plains', ...(ring ? { overlays: ['city-wall'] } : {}) };
  }
  s.map.tiles['3,3'].overlays = ['fortress-tower'];
  s.map.tiles['6,9'].overlays = ['city-gate'];
  s.library.unitTypes.push(unitType('inf'), unitType('arch', { weapon: 'ranged', rangeMax: 3 }), unitType('cav', { category: 'cavalry', move: 5 }));
  return s;
}
const add = (s, o) => R.unitById(s, must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);

test('inside the walls is worked out from the map', () => {
  const s = city();
  assert.ok(R.insideCity(s, 6, 6));
  assert.ok(!R.insideCity(s, 1, 1));
  assert.ok(!R.insideCity(s, 6, 9), 'the gate is part of the wall');
});

test('melee and walls: same level, the city inside, or a ladder from outside', () => {
  const s = city();
  const top = add(s, { typeId: 'inf', side: 'enemy', x: 6, y: 3 });     // on the north wall
  const out = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 2 });
  const inn = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 4 });
  const wallMate = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 7, y: 3 });
  assert.ok(!R.rangeOk(s, out, top), 'plains cannot attack the wall');
  assert.ok(!R.rangeOk(s, top, out), 'the wall cannot attack the plains');
  assert.ok(R.rangeOk(s, inn, top) && R.rangeOk(s, top, inn), 'city <-> wall');
  assert.ok(R.rangeOk(s, wallMate, top), 'wall <-> wall');
  s.siege = { ladders: ['6,3'], dropped: [] };
  assert.ok(R.rangeOk(s, out, top) && R.rangeOk(s, top, out), 'a ladder on that square opens it up');
});

test('ranged: shots from the ground stop at the wall; from the wall they carry on, with +1 range', () => {
  const s = city();
  const archer = add(s, { typeId: 'arch', side: 'player', owner: 'p1', x: 6, y: 1 });
  const onWall = add(s, { typeId: 'inf', side: 'enemy', x: 6, y: 3 });
  const behind = add(s, { typeId: 'inf', side: 'enemy', x: 6, y: 4 });
  assert.ok(R.rangeOk(s, archer, onWall), 'can shoot the wall without ladders');
  assert.ok(!R.rangeOk(s, archer, behind), 'but not past it');
  const wallArcher = add(s, { typeId: 'arch', side: 'enemy', x: 5, y: 9 });
  const far = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 13 });
  assert.ok(R.rangeOk(s, wallArcher, far), 'from the wall: range 3 + 1 reaches 4 out');
});

test('Place Ladder: needs ladders, a wall square next to it, ends the turn; the ladders are used', () => {
  const s = city();
  const u = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 2 });
  add(s, { typeId: 'inf', side: 'enemy', x: 12, y: 12 });
  u.carry = 'ladders';
  assert.strictEqual(R.movementOf(s, u), 2, 'carrying ladders: movement -1');
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'skipTactics' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: u.id }));
  assert.ok(R.actionMenu(s, u).placeLadder);
  assert.ok(!R.act(s, P1, { type: 'placeLadder', unitId: u.id, x: 6, y: 9 }).ok, 'not a square next to it');
  must(R.act(s, P1, { type: 'placeLadder', unitId: u.id, x: 6, y: 3 }));
  assert.deepStrictEqual(s.siege.ladders, ['6,3']);
  assert.strictEqual(u.carry, null);
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== u.id, 'ends the turn');
});

test('climbing: all its movement, onto an empty laddered wall square; then it can still act', () => {
  const s = city();
  s.siege = { ladders: ['6,3'], dropped: [] };
  const u = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 2 });
  const foe = add(s, { typeId: 'inf', side: 'enemy', x: 7, y: 3 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'skipTactics' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: u.id }));
  const opts = R.moveOptions(s, u);
  assert.ok(opts.climb.has('6,3'));
  must(R.act(s, P1, { type: 'moveTo', unitId: u.id, x: 6, y: 3 }));
  assert.deepStrictEqual([u.x, u.y], [6, 3]);
  assert.strictEqual(s.turn.activation.step, 'act', 'movement over, actions remain');
  assert.ok(R.actionMenu(s, u).attack, 'can attack the defender beside it on the wall');
  // cavalry and units carrying equipment can't climb
  const s2 = city(); s2.siege = { ladders: ['6,3'], dropped: [] };
  const c = add(s2, { typeId: 'cav', side: 'player', owner: 'p1', x: 6, y: 2 });
  assert.strictEqual(R.climbTiles(s2, c).length, 0);
  const l = add(s2, { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 2 }); l.x = 6; l.y = 2; c.x = 1; c.y = 1;
  l.carry = 'engine';
  assert.strictEqual(R.climbTiles(s2, l).length, 0);
});

test('equipment: dropped by choice or when the unit falls, picked up by an empty-handed unit moving there', () => {
  const s = city();
  const a = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 1, y: 12 });
  const b = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 1, y: 10 });
  add(s, { typeId: 'inf', side: 'enemy', x: 12, y: 1 });
  a.carry = 'engine';
  assert.strictEqual(R.movementOf(s, a), 1, 'siege engine: movement -2');
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'skipTactics' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a.id }));
  must(R.act(s, P1, { type: 'dropEquipment', unitId: a.id }));
  assert.deepStrictEqual(s.siege.dropped, [{ x: 1, y: 12, kind: 'engine' }]);
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: a.id, x: 2, y: 12 }));
  must(R.act(s, P1, { type: 'endTurn', unitId: a.id }));
  must(R.act(s, HOST, { type: 'skipPrompt' })); // the enemy's turn
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: b.id }));
  must(R.act(s, P1, { type: 'moveTo', unitId: b.id, x: 1, y: 12 }));
  assert.strictEqual(b.carry, 'engine');
  assert.strictEqual(s.siege.dropped.length, 0);
  // falling drops it
  b.men = 0; R.settle(s);
  assert.deepStrictEqual(s.siege.dropped, [{ x: 1, y: 12, kind: 'engine' }]);
});

test('units on the wall walk along it; gates cannot be entered', () => {
  const s = city();
  const u = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 3 });
  const reach = R.reachable(s, u, 4);
  assert.ok(reach.has('8,3') && reach.has('3,5'), 'along the wall and round the tower');
  assert.ok(!reach.has('5,4') && !reach.has('5,2'), 'not down off it');
  const g = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 10 });
  assert.ok(!R.reachable(s, g, 3).has('6,9'), 'the closed gate');
});
