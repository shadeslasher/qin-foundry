// Battle AI (David, 2026-11-03).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as AI from '../module/battle/ai.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
function battle(types, units) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.library.unitTypes.push(...types);
  const ids = units.map(o => must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids };
}
/** Let the AI play until it hands the turn back. Returns the actions it took. */
function runAI(s, sides, level) {
  const done = [];
  for (let i = 0; i < 12; i++) {
    const a = AI.aiStep(s, sides, { level }); if (!a) break;
    R.setRng(() => 0.5);
    must(R.act(s, HOST, a)); done.push(a);
  }
  return done;
}

test('AI: an enemy unit closes in on and attacks a player unit in reach', () => {
  const { s, ids } = battle([unitType('inf'), unitType('foe')], [
    { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 5 },
    { typeId: 'foe', side: 'enemy', x: 5, y: 8 },
  ]);
  must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[0] }));
  const acts = runAI(s, { enemy: true }, 3);
  assert.strictEqual(acts[0].type, 'begin');
  assert.ok(acts.some(a => a.type === 'moveTo'), 'moves');
  assert.ok(acts.some(a => a.type === 'attack' && a.targetId === ids[0]), 'attacks: ' + JSON.stringify(acts));
  assert.strictEqual(AI.aiStep(s, { enemy: true }, {}), null, 'the turn is handed back');
});

test('AI: off for a side it does not control, and never moves a player-owned unit', () => {
  const { s, ids } = battle([unitType('inf'), unitType('foe')], [
    { typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 5 },
    { typeId: 'foe', side: 'enemy', x: 5, y: 8 },
  ]);
  assert.strictEqual(AI.aiStep(s, { enemy: true, ally: true }), null, "the player side's turn");
  must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[0] }));
  assert.strictEqual(AI.aiStep(s, { ally: true }), null, 'enemy AI off');
});

test('AI: a foolish tactician charges cavalry into holding spears; a skilled one does not', () => {
  const spear = unitType('spear', { damage: 4, armor: 5, armorPen: 5 });
  const cav = unitType('cav', { category: 'cavalry', move: 5, damage: 5, armor: 4, armorPen: 5 });
  let charges = { 0: 0, 5: 0 };
  for (const level of [0, 5]) for (let trial = 0; trial < 4; trial++) {
    const { s, ids } = battle([spear, cav], [
      { typeId: 'spear', side: 'player', owner: 'p1', x: 5, y: 5 },
      { typeId: 'cav', side: 'enemy', x: 5, y: 9 },
    ]);
    const sp = R.unitById(s, ids[0]), cv = R.unitById(s, ids[1]);
    sp.traitTiers = { 'anti-cavalry': 2, 'charge reflection': 1, brace: 1 }; sp.maxMen = sp.men = 100;
    cv.traitTiers = { 'fierce charge': 1 }; cv.fierceCharge = 1; cv.maxMen = cv.men = 65;
    must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'holdPosition', unitId: ids[0] }));
    const acts = runAI(s, { enemy: true }, level, trial);
    if (acts.some(a => a.type === 'attack')) charges[level]++;
  }
  assert.ok(charges[0] >= 3, 'level 0 charges the holding spears: ' + charges[0] + '/4');
  assert.ok(charges[5] <= 1, 'level 5 keeps away: ' + charges[5] + '/4');
});

test('AI: profiles get sharper with Art of War, and the side level comes from its tactician', () => {
  assert.ok(AI.profile(0).naive && !AI.profile(2).naive);
  assert.ok(AI.profile(5).noise < AI.profile(1).noise && AI.profile(5).samples > AI.profile(2).samples);
  const s = R.newState(); s.tactics = { sides: { enemy: { aow: 4 } } };
  assert.strictEqual(AI.sideLevel(s, 'enemy'), 4);
  assert.strictEqual(AI.sideLevel(s, 'ally'), 1, 'no tactician plays as 1');
});

// ---- strategy: objectives, the clock, reinforcements, ground (David, 2026-11-04)
const strong = unitType('strong', { tier: 4, damage: 8, armor: 5, armorPen: 5 });
const weak = unitType('weak', { tier: 1, damage: 4, armor: 1, armorPen: 2 });
const foe = unitType('foe');
function strat(objectives, units, extra = {}) {
  const { s, ids } = battle([strong, weak, foe], units);
  s.objectives = { victory: [], defeat: [], extraction: [], ...objectives };
  Object.assign(s, extra);
  return { s, ids, S: AI.strategy(s, 'enemy') };
}
const army = [
  { typeId: 'foe', side: 'player', owner: 'p1', x: 5, y: 2 },
  { typeId: 'strong', side: 'enemy', x: 3, y: 9 },
  { typeId: 'weak', side: 'enemy', x: 5, y: 8 },
  { typeId: 'weak', side: 'enemy', x: 8, y: 9 },
];

test('AI strategy: players must seize a square: the enemy keeps it, its strongest unit anchors it, and it plays defensively', () => {
  const { ids, S } = strat({ victory: [{ id: 'v1', type: 'seize', x: 5, y: 9 }] }, army);
  assert.ok(['defensive', 'balanced'].includes(S.posture) && S.aggr < 0, 'leans defensive: ' + S.posture + ' ' + S.aggr);
  assert.deepStrictEqual(S.keep, [{ x: 5, y: 9 }]);
  const anchor = [...S.jobs].find(([, j]) => j.anchor)[0];
  assert.strictEqual(anchor, ids[1], 'the strong unit anchors, though a weaker one stands closer');
});

test('AI strategy: players only have to survive: the enemy attacks, harder as time runs out', () => {
  const a = strat({ victory: [{ id: 'v1', type: 'survive', rounds: 6 }] }, army).S;
  assert.strictEqual(a.posture, 'aggressive');
  const b = strat({ victory: [{ id: 'v1', type: 'survive', rounds: 6 }] }, army, { objState: { playerEnded: {}, enemyEnded: {}, roundsDone: 5, escaped: [] } }).S;
  assert.ok(b.aggr > a.aggr, 'more urgent late');
});

test('AI strategy: players racing a turn limit: the enemy plays defensively', () => {
  const { S } = strat({ defeat: [{ id: 'd1', type: 'turnLimit', rounds: 8 }] }, army);
  assert.ok(S.aggr < -0.2 && S.posture === 'defensive', S.posture);
});

test('AI strategy: reinforcements on the way: the enemy plays for time until they arrive', () => {
  const coming = { incoming: [{ side: 'enemy', round: 3, tier: 3 }, { side: 'enemy', round: 3, tier: 3 }] };
  const { S } = strat({}, army, coming);
  assert.strictEqual(S.posture, 'stall');
  assert.strictEqual(S.reinforceRound, 3);
  const later = strat({}, army, coming);
  const { s } = later; s.turn.round = 3;
  assert.notStrictEqual(AI.strategy(s, 'enemy').posture, 'stall', 'once they are due it fights normally');
  assert.notStrictEqual(strat({}, army, { incoming: [{ side: 'player', round: 3, tier: 3 }] }).S.posture, 'stall', "the players' reinforcements don't make it wait");
});

test('AI strategy: two squares to keep: each gets its own anchor and guards', () => {
  const { S } = strat({ victory: [{ id: 'v1', type: 'seize', x: 2, y: 9 }, { id: 'v2', type: 'burn', x: 9, y: 9 }] }, army);
  const byPt = new Map();
  for (const [id, j] of S.jobs) { const k = j.pt.x + ',' + j.pt.y; byPt.set(k, [...(byPt.get(k) || []), { id, anchor: j.anchor }]); }
  assert.strictEqual(byPt.size, 2, 'both squares covered');
  for (const list of byPt.values()) assert.ok(list.some(j => j.anchor), 'an anchor on each');
});

test('AI strategy: a Hold the players must keep is a square the enemy goes to take; units to rout are protected', () => {
  const { ids, S } = strat({
    victory: [{ id: 'h1', type: 'hold', x: 5, y: 4, rounds: 3 }, { id: 'r1', type: 'routUnit', unitIds: ['X'] }],
    defeat: [{ id: 'd1', type: 'tileSeized', x: 5, y: 4, pair: 'h1' }, { id: 'd2', type: 'unitRouted', unitIds: ['P'] }],
  }, army);
  assert.deepStrictEqual(S.take, [{ x: 5, y: 4 }]); assert.deepStrictEqual(S.keep, []);
  assert.ok(S.protect.has('X') && S.hunt.has('P'));
  void ids;
});

test('AI: good ground: a fort beats open plains, fire is bad', () => {
  const { s, ids } = battle([foe], [{ typeId: 'foe', side: 'enemy', x: 5, y: 5 }, { typeId: 'foe', side: 'player', owner: 'p1', x: 1, y: 1 }]);
  s.map.tiles = { '5,5': { terrain: 'plains', overlays: [] }, '6,5': { terrain: 'plains', overlays: ['fort'] }, '7,5': { terrain: 'plains', overlays: ['fire'] } };
  const u = R.unitById(s, ids[0]);
  assert.ok(AI.groundValue(s, u, 6, 5) > AI.groundValue(s, u, 5, 5));
  assert.ok(AI.groundValue(s, u, 7, 5) < AI.groundValue(s, u, 5, 5));
});

test('AI: the anchor of a square the players must seize stays on it instead of marching out', () => {
  let left = { on: 0, off: 0 };
  for (const withObj of [true, false]) {
    const { s, ids } = battle([strong, foe], [
      { typeId: 'foe', side: 'player', owner: 'p1', x: 5, y: 2 },
      { typeId: 'strong', side: 'enemy', x: 5, y: 8 },
    ]);
    if (withObj) s.objectives = { victory: [{ id: 'v1', type: 'seize', x: 5, y: 8 }], defeat: [], extraction: [] };
    must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[0] }));
    runAI(s, { enemy: true }, 4);
    const u = R.unitById(s, ids[1]);
    left[withObj ? 'on' : 'off'] = R.manhattan(u, { x: 5, y: 8 });
  }
  assert.strictEqual(left.on, 0, 'stays on the square');
  assert.ok(left.off > 0, 'with nothing to keep it advances');
});

test('AI: waiting for reinforcements, it stays out of reach instead of walking into the enemy', () => {
  const dist = {};
  for (const wait of [true, false]) {
    const { s, ids } = battle([foe], [
      { typeId: 'foe', side: 'player', owner: 'p1', x: 5, y: 2 },
      { typeId: 'foe', side: 'enemy', x: 5, y: 9 },
    ]);
    if (wait) s.incoming = [{ side: 'enemy', round: 3, tier: 3 }, { side: 'enemy', round: 3, tier: 2 }];
    must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[0] }));
    runAI(s, { enemy: true }, 4);
    dist[wait] = R.manhattan(R.unitById(s, ids[0]), R.unitById(s, ids[1]));
  }
  assert.ok(dist.true > dist.false, 'keeps its distance: ' + JSON.stringify(dist));
});
