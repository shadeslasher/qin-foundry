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

// ---- fighting: officers, mistakes, morale (David, 2026-11-04)
const off = (id, name, ctype, style, o) => ({ id, name, fire: 2, command: 3, skills: {}, heroicActions: [], ctype, style, ...o });
function withOfficers(units, officers, objectives) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.library.unitTypes.push(strong, weak, foe); s.library.officers.push(...officers);
  const ids = units.map(o => must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);
  if (objectives) s.objectives = { victory: [], defeat: [], extraction: [], ...objectives };
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids };
}

test('AI: battle styles read from the sheet text', () => {
  assert.deepStrictEqual([...AI.stylesOf('Rash, glory seeking; Cunning, nonsense')].sort(), ['cunning', 'glory-seeking', 'rash']);
  assert.strictEqual(AI.stylesOf('').size, 0);
});

test('AI: Strategists and the tactician are kept safer; Vanguards take risks', () => {
  const { s, ids } = withOfficers(army, [off('o1', 'Guo Jia', 'Strategist', ''), off('o2', 'Zhang Liao', 'Vanguard', '')]);
  R.unitById(s, ids[1]).officerId = 'o1'; R.unitById(s, ids[2]).officerId = 'o2';
  const S = AI.strategy(s, 'enemy'), P = AI.profile(5);
  const a = AI.mind(s, R.unitById(s, ids[1]), S, P), b = AI.mind(s, R.unitById(s, ids[2]), S, P);
  assert.ok(a.threat > 1.4 && b.threat < 1 && b.close > a.close);
  s.tactics = { sides: { enemy: { id: 'o1', name: 'Guo Jia', aow: 5 } } };
  assert.ok(AI.mind(s, R.unitById(s, ids[1]), S, P).threat > a.threat, 'the tactician himself even more so');
});

test('AI: poor tacticians make mistakes often, masters never', () => {
  const count = { 0: 0, 4: 0 };
  for (const lvl of [0, 4]) for (let round = 1; round <= 40; round++) {
    const { s, ids } = battle([foe], army.slice(0, 1).concat([{ typeId: 'foe', side: 'enemy', x: 5, y: 8 }]));
    s.turn.round = round;
    if (AI.mind(s, R.unitById(s, ids[1]), AI.strategy(s, 'enemy'), AI.profile(lvl)).mistake) count[lvl]++;
  }
  assert.ok(count[0] >= 10 && count[0] <= 28, 'level 0: ' + count[0] + '/40');
  assert.strictEqual(count[4], 0);
});

test('AI: a rash officer told to keep a square sometimes charges anyway, and says so; a steadfast one never leaves', () => {
  let wild = 0, notes = 0, steady = 0;
  for (let round = 1; round <= 30; round++) {
    const { s, ids } = withOfficers(army, [off('o1', 'Zhang Fei', 'Vanguard', 'Rash'), off('o2', 'Gao Shun', 'Champion', 'Steadfast')],
      { victory: [{ id: 'v1', type: 'seize', x: 3, y: 9 }, { id: 'v2', type: 'seize', x: 8, y: 9 }] });
    R.unitById(s, ids[1]).officerId = 'o1'; R.unitById(s, ids[3]).officerId = 'o2';
    s.turn.round = round;
    const S = AI.strategy(s, 'enemy');
    const m = AI.mind(s, R.unitById(s, ids[1]), S, AI.profile(2));
    if (m.disobey) { wild++; if (/Zhang Fei/.test(m.note)) notes++; }
    if (AI.mind(s, R.unitById(s, ids[3]), S, AI.profile(2)).ignoreJob) steady++;
  }
  assert.ok(wild >= 3 && wild <= 15, 'rash: ' + wild + '/30');
  assert.strictEqual(notes, wild, 'each time in the log');
  assert.strictEqual(steady, 0);
});

test('AI: an officer going his own way puts a line in the log first, once, then acts', () => {
  for (let round = 1; round <= 30; round++) {
    const { s, ids } = withOfficers([
      { typeId: 'foe', side: 'player', owner: 'p1', x: 5, y: 3 },
      { typeId: 'strong', side: 'enemy', x: 5, y: 9, officerId: 'o1' },
    ], [off('o1', 'Zhang Fei', 'Vanguard', 'Rash, Glory-seeking')], { victory: [{ id: 'v1', type: 'seize', x: 5, y: 9 }] });
    s.turn.round = round;
    const m = AI.mind(s, R.unitById(s, ids[1]), AI.strategy(s, 'enemy'), AI.profile(1));
    if (!m.disobey) continue;
    const acts = runAI(s, { enemy: true }, 1);
    const notes = acts.filter(a => a.type === 'aiNote');
    assert.strictEqual(notes.length, 1, JSON.stringify(acts));
    assert.ok(s.log.some(e => e.detail?.type === 'aiNote'));
    assert.ok(acts.findIndex(a => a.type === 'aiNote') < acts.findIndex(a => a.type === 'moveTo' || a.type === 'skipMove'));
    return;
  }
  assert.fail('never disobeyed in 30 rounds');
});

test('AI: a shaken unit with an officer steps out of reach to recover instead of fighting on', () => {
  const dist = {};
  for (const shaken of [true, false]) {
    const { s, ids } = withOfficers([
      { typeId: 'foe', side: 'player', owner: 'p1', x: 5, y: 3 },
      { typeId: 'foe', side: 'enemy', x: 5, y: 7, officerId: 'o1' },
    ], [off('o1', 'Li Dian', 'Commander', '')]);
    const u = R.unitById(s, ids[1]);
    if (shaken) u.morale = 22;
    runAI(s, { enemy: true }, 2);
    dist[shaken] = R.manhattan(R.unitById(s, ids[0]), R.unitById(s, ids[1]));
  }
  assert.ok(dist.true > dist.false, JSON.stringify(dist));
});

// ---- traits (David, 2026-11-04)
test('AI: levels 3+ play the danger out with the real rules: holding braced spears are safe from a cavalry charge', () => {
  const spear = unitType('spear', { damage: 4, armor: 5, armorPen: 5 });
  const cav = unitType('cav', { category: 'cavalry', move: 5, damage: 6, armor: 4, armorPen: 5 });
  const inf = unitType('inf2', { damage: 6, armor: 3, armorPen: 3 });
  const { s, ids } = battle([spear, cav, inf], [
    { typeId: 'spear', side: 'enemy', x: 5, y: 5 }, { typeId: 'cav', side: 'player', owner: 'p1', x: 5, y: 9 }, { typeId: 'inf2', side: 'player', owner: 'p1', x: 9, y: 5 },
  ]);
  const sp = R.unitById(s, ids[0]); sp.traitTiers = { 'anti-cavalry': 2, 'charge reflection': 1, brace: 1 };
  R.unitById(s, ids[1]).fierceCharge = 1;
  const open = AI._simThreat(s, ids[0], R.unitById(s, ids[1]), false, 3), held = AI._simThreat(s, ids[0], R.unitById(s, ids[1]), true, 3);
  assert.ok(open && held && held.harm <= open.harm, 'holding helps: ' + open.harm + ' -> ' + held.harm);
  // the raw numbers (what levels 0-1 believe): a 4-square Fierce Charge, damage 6 + 2 + 3 + 4 against armor 5
  const raw = R.casualtiesOf(15, 5, 5, 0, 0) / 100;
  assert.ok(held.harm < raw * 0.6, 'the real rules see the spears are much safer than the raw numbers say: ' + raw + ' vs ' + held.harm);
  // level 2's quick guess knows armor traits too
  sp.traitTiers['reinforced armor'] = 3;
  assert.ok(AI._traitHit(s, R.unitById(s, ids[2]), sp, 0, false) < R.casualtiesOf(8, 5, 3, 0, 0));
});

test('AI: Shield Battery / Range Up archers keep still when they can', () => {
  const bow = unitType('bow', { category: 'ranged', weapon: 'ranged', rangeMin: 2, rangeMax: 4, damage: 4, armor: 2 });
  const moved = {};
  for (const still of [true, false]) {
    const { s, ids } = battle([bow, unitType('slow', { move: 1 })], [
      { typeId: 'slow', side: 'player', owner: 'p1', x: 5, y: 2 },
      { typeId: 'bow', side: 'enemy', x: 5, y: 5 },
    ]);
    if (still) R.unitById(s, ids[1]).traitTiers = { 'shield battery': 1, 'range up': 1 };
    must(R.act(s, P1, { type: 'begin', unitId: ids[0] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[0] }));
    const acts = runAI(s, { enemy: true }, 4);
    moved[still] = acts.some(a => a.type === 'moveTo');
  }
  assert.deepStrictEqual(moved, { true: false, false: true }, 'stays put with the traits, steps back to full range without');
});

test('AI: Suppressing Fire goes for the braced spears when its cavalry is waiting to charge', () => {
  const bow = unitType('sup', { category: 'ranged', weapon: 'ranged', rangeMin: 2, rangeMax: 4, damage: 4, armor: 2 });
  const spear = unitType('spear', { damage: 4, armor: 4, armorPen: 4 });
  const cav = unitType('cav', { category: 'cavalry', move: 6, damage: 6, armor: 4, armorPen: 5 });
  let spearHits = 0;
  for (let t = 0; t < 4; t++) {
    const { s, ids } = battle([bow, spear, foe, cav], [
      { typeId: 'spear', side: 'player', owner: 'p1', x: 4, y: 2 },
      { typeId: 'foe', side: 'player', owner: 'p1', x: 7, y: 2 },
      { typeId: 'sup', side: 'enemy', x: 5 + (t % 2), y: 5 },
      { typeId: 'cav', side: 'enemy', x: 3, y: 8 },
    ]);
    R.unitById(s, ids[0]).traitTiers = { brace: 1, 'anti-cavalry': 1 }; R.unitById(s, ids[0]).round.holding = true;
    R.unitById(s, ids[2]).traitTiers = { 'suppressing fire': 1 };
    const S = AI.strategy(s, 'enemy');
    const f = AI.fork(s); f.turn.activation = { unitId: ids[2], step: 'move' };
    void S; void f;
    must(R.act(s, P1, { type: 'begin', unitId: ids[1] })); must(R.act(s, P1, { type: 'endTurn', unitId: ids[1] }));
    const acts = runAI(s, { enemy: true }, 4);
    const shot = acts.find(a => a.type === 'attack' && a.unitId === ids[2]);
    if (shot && shot.targetId === ids[0]) spearHits++;
  }
  assert.ok(spearHits >= 3, 'shoots the spears: ' + spearHits + '/4');
});
