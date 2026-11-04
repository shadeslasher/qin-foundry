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
