// Battlefield terrain from the battle map file.
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
/** A 12x12 plains map with some squares changed: { "x,y": { terrain, overlays } }. */
function field(special = {}) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  Object.assign(s.map.tiles, special);
  return s;
}
const add = (s, o) => must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId;
const part = (roll, re) => roll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);

test('terrain and overlays add up', () => {
  const s = field({ '3,3': { terrain: 'forest', overlays: ['hill'] } });
  const r = R.tileRules(s, 3, 3);
  assert.deepStrictEqual([r.move, r.meleeDef, r.rangedDef, r.range, r.downhill, r.hides], [1, 1, 1, -1, 1, true]);
  assert.strictEqual(R.tileRules(s, 0, 0).move, 0);
});

test('movement: costs, impassable squares, bridges, roads and "not cavalry"', () => {
  const s = field({
    '5,4': { terrain: 'marsh' },                       // costs 3
    '5,6': { terrain: 'river' }, '6,6': { terrain: 'river', overlays: ['bridge'] },
    '4,5': { terrain: 'plains', overlays: ['abatis'] },
    '6,5': { terrain: 'plains', overlays: ['road'] }, '7,5': { terrain: 'paving', overlays: ['road'] },
  });
  s.library.unitTypes.push(unitType('inf'), unitType('cav', { category: 'cavalry', move: 3 }));
  const u = R.unitById(s, add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 5 }));
  const reach = R.reachable(s, u, 3);
  assert.ok(reach.has('5,4') && reach.get('5,4') === 3, 'marsh costs 1 + 2');
  assert.ok(!reach.has('5,6'), 'river blocks');
  assert.ok(reach.has('6,6'), 'bridge crosses the river');
  assert.strictEqual(reach.get('6,5'), 1, 'roads cost the normal 1');
  assert.strictEqual(reach.get('7,5'), 2, 'road on paving: still 1 each');
  assert.strictEqual(reach.steps.get('7,5'), 2);
  assert.ok(reach.has('4,5'), 'infantry crosses abatis');
  const c = R.unitById(s, add(s, { typeId: 'cav', side: 'player', owner: 'p1', x: 5, y: 8 }));
  c.x = 3; c.y = 5;
  assert.ok(!R.reachable(s, c, 3).has('4,5'), 'cavalry cannot');
});

test('defense, range, command and camp defences in the rolls', () => {
  const s = field({
    '5,3': { terrain: 'forest' }, '5,8': { terrain: 'plains', overlays: ['hill'] },
    '8,8': { terrain: 'plains', overlays: ['camp-stakes'] }, '8,9': { terrain: 'plains' },
  });
  s.library.unitTypes.push(unitType('arch', { weapon: 'ranged', rangeMax: 3 }), unitType('inf'));
  const a = R.unitById(s, add(s, { typeId: 'arch', side: 'player', owner: 'p1', x: 5, y: 8 }));
  const d = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 5, y: 4 }));
  assert.ok(R.rangeOk(s, a, d), 'range 3 + hill 1 reaches 4');
  d.y = 3; // in the forest, 5 away
  assert.ok(!R.rangeOk(s, a, d));
  d.y = 4;
  const atk = R.buildRoll(s, a, 'attacker', { attacker: a, defender: d, ranged: true });
  assert.strictEqual(part(atk, /downhill/), 1, 'hill: Command +1 attacking downhill');
  d.y = 3; a.y = 6;
  const def = R.buildRoll(s, d, 'defender', { attacker: a, defender: d, ranged: true });
  assert.strictEqual(part(def, /^Terrain .*ranged defense/), 1, 'forest: ranged defense +1');
  // camp stakes only defend against attacks from outside the camp
  const c = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 8, y: 8 }));
  const m = R.unitById(s, add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 8, y: 9 }));
  assert.strictEqual(part(R.buildRoll(s, c, 'defender', { attacker: m, defender: c }), /^Camp/), 1);
});

test('forests hide; ending a turn in fire costs troops and morale', () => {
  const s = field({ '5,4': { terrain: 'forest' }, '6,5': { terrain: 'plains', overlays: ['fire'] } });
  s.library.unitTypes.push(unitType('inf'));
  const u = add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 5 });
  add(s, { typeId: 'inf', side: 'enemy', x: 11, y: 11 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'skipTactics' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: u }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: u, x: 6, y: 5 }));
  must(R.act(s, P1, { type: 'endTurn', unitId: u }));
  const U = R.unitById(s, u);
  assert.deepStrictEqual([U.men, U.morale], [90, 45]);
});

test('battle map file: validated, packed onto the scene, unpacked for the engine', async () => {
  const B = await import('../module/battle/battlemap.mjs');
  assert.ok(B.validateBattleMap({ format: 'other' }));
  const file = { format: 'qin-battlemap', version: 1, name: 'Test', scene: { width: 300, height: 200, gridSize: 100, cols: 3, rows: 2 },
    tiles: [{ x: 0, y: 0, terrain: 'forest' }, { x: 1, y: 0, terrain: 'plains', overlays: ['city-gate'], gateOpen: false },
      { x: 2, y: 1, terrain: 'lava', overlays: ['volcano'] }], structures: [{ type: 'fort', x: 0, y: 0, w: 2, h: 2 }] };
  assert.strictEqual(B.validateBattleMap(file), null);
  const { data, unknown } = B.encodeBattleMap(file);
  assert.deepStrictEqual(unknown.sort(), ['lava', 'volcano']);
  const tiles = B.decodeTiles(JSON.parse(JSON.stringify(data)));
  assert.deepStrictEqual(tiles['0,0'], { terrain: 'forest' });
  assert.deepStrictEqual(tiles['1,0'], { terrain: 'plains', overlays: ['city-gate'], gateOpen: false });
  assert.deepStrictEqual(tiles['0,1'], { terrain: 'plains' }, 'squares missing from the file are plains');
});

test('hill: Command +1 only against lower units, attacking or attacked; tall grass hides', async () => {
  {
    const s = field({ '3,3': { terrain: 'plains', overlays: ['hill'] }, '3,4': { terrain: 'plains', overlays: ['hill'] }, '5,3': { terrain: 'plains', overlays: ['city-wall'] } });
    s.library.unitTypes.push(unitType('inf'));
    const a = R.unitById(s, add(s, { typeId: 'inf', side: 'player', owner: 'p1', x: 3, y: 3 }));
    const low = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 2, y: 3 }));
    const up = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 3, y: 4 }));
    const wall = R.unitById(s, add(s, { typeId: 'inf', side: 'enemy', x: 5, y: 3 }));
    const dh = (d) => part(R.buildRoll(s, a, 'attacker', { attacker: a, defender: d }), /downhill/);
    assert.deepStrictEqual([dh(low), dh(up), dh(wall)], [1, 0, 0]);
    const below = (d) => part(R.buildRoll(s, a, 'defender', { attacker: d, defender: a }), /from below/);
    assert.deepStrictEqual([below(low), below(up), below(wall)], [1, 0, 0]);
  }
  assert.strictEqual(R.tileRules(field({ '1,1': { terrain: 'tall-grass' } }), 1, 1).hides, true);
});
