// Battle AI cavalry (David, 2026-11-24): no pull-back for its own sake; stay clear of being cut off unless strong enough;
// prefer charging lone enemies and shooters or generals.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as AI from '../module/battle/ai.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
const unitType = (id, o) => Object.assign({ id, name: id, faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
  damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
function battle(types, units) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.library.unitTypes.push(...types);
  const ids = units.map(o => must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids };
}
/** The player's units pass; returns the enemy cavalry unit's first activation's actions. */
function enemyTurn(s, ids, players, level = 3) {
  for (const id of players.slice(0, 1)) { must(R.act(s, P1, { type: "begin", unitId: id })); must(R.act(s, P1, { type: "endTurn", unitId: id })); }
  const done = [];
  for (let i = 0; i < 6; i++) { const a = AI.aiStep(s, { enemy: true }, { level }); if (!a) break; R.setRng(() => 0.5); must(R.act(s, HOST, a)); done.push(a); if (a.type === 'endTurn') break; }
  return done;
}
const cav = (o) => unitType('cav', Object.assign({ category: 'cavalry', move: 5, damage: 6, armor: 4, armorPen: 5 }, o));

test('AI cavalry: a lone enemy is charged before one standing among its allies', () => {
  let lone = 0;
  for (let trial = 0; trial < 3; trial++) {
    const { s, ids } = battle([unitType('inf'), cav()], [
      { typeId: 'inf', side: 'player', owner: 'p1', x: 7, y: 9 },    // lone
      { typeId: 'inf', side: 'player', owner: 'p1', x: 13, y: 9 },   // among allies
      { typeId: 'inf', side: 'player', owner: 'p1', x: 15, y: 9 },
      { typeId: 'inf', side: 'player', owner: 'p1', x: 13, y: 11 },
      { typeId: 'cav', side: 'enemy', x: 10, y: 7 },
      { typeId: 'inf', side: 'enemy', x: 10, y: 3 },
    ]);
    const acts = enemyTurn(s, ids, ids.slice(0, 4));
    const hit = acts.find(a => a.type === 'attack');
    if (hit && hit.targetId === ids[0]) lone++;
  }
  assert.ok(lone >= 2, 'charges the lone unit: ' + lone + '/3');
});

test('AI cavalry: does not end its turn cut off deep among strong enemies, but a far stronger unit will fight there', () => {
  // three Tier 3 foes ahead, its own infantry far behind: a Tier 2 horse unit keeps clear
  const foe = unitType('foe', { tier: 3, damage: 8, armor: 6, armorPen: 6 });
  const { s, ids } = battle([foe, cav(), unitType('inf')], [
    { typeId: 'foe', side: 'player', owner: 'p1', x: 10, y: 12 },
    { typeId: 'foe', side: 'player', owner: 'p1', x: 12, y: 12 },
    { typeId: 'foe', side: 'player', owner: 'p1', x: 8, y: 12 },
    { typeId: 'cav', side: 'enemy', x: 10, y: 6 },
    { typeId: 'inf', side: 'enemy', x: 10, y: 1 },
  ]);
  const acts = enemyTurn(s, ids, ids.slice(0, 3));
  const c = R.unitById(s, ids[3]);
  const nearest = Math.min(...ids.slice(0, 3).map(id => R.manhattan(R.unitById(s, id), c)));
  assert.ok(!acts.some(a => a.type === 'attack') && nearest >= 3, 'stays clear: ' + JSON.stringify(acts) + ' nearest ' + nearest);
  // a Tier 5 heavy horse against Tier 1 levies goes in
  const weak = unitType('weak', { tier: 1, damage: 3, armor: 1, armorPen: 1 });
  const big = cav({ tier: 5, damage: 14, armor: 12, armorPen: 10 });
  const b = battle([weak, big, unitType('inf')], [
    { typeId: 'weak', side: 'player', owner: 'p1', x: 10, y: 10 },
    { typeId: 'weak', side: 'player', owner: 'p1', x: 12, y: 10 },
    { typeId: 'weak', side: 'player', owner: 'p1', x: 8, y: 10 },
    { typeId: 'cav', side: 'enemy', x: 10, y: 6 },
    { typeId: 'inf', side: 'enemy', x: 10, y: 1 },
  ]);
  const acts2 = enemyTurn(b.s, b.ids, b.ids.slice(0, 3));
  assert.ok(acts2.some(a => a.type === 'attack'), 'attacks: ' + JSON.stringify(acts2));
});

test('AI cavalry: hemmed in and losing a standstill fight, a skilled AI backs out of reach and charges next turn; a weak one fights on', () => {
  const run = (level) => {
    const sab = unitType('sab', { damage: 8, armor: 5, armorPen: 3 }), horse = cav({ damage: 9, armor: 4, armorPen: 4 });
    const s = R.newState(); s.players.p1 = { name: 'Alice' };
    s.library.unitTypes.push(sab, horse);
    for (let y = 2; y <= 14; y++) for (const x of [9, 11]) s.map.terrain[x + ',' + y] = 'impassable'; // a one-tile lane
    const ids = [['sab', 'player', 10, 10], ['cav', 'enemy', 10, 9]].map(([t, sd, x, y]) => must(R.act(s, HOST, { type: 'addUnit', typeId: t, side: sd, owner: sd === 'player' ? 'p1' : undefined, x, y })).unitId);
    must(R.act(s, HOST, { type: 'startBattle' })); R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
    const sb = R.unitById(s, ids[0]), cv = R.unitById(s, ids[1]);
    sb.traitTiers = { evasion: 2, 'charging strike': 1, 'anti-infantry': 1 };
    cv.traitTiers = { 'fierce charge': 2, disciplined: 1 }; cv.fierceCharge = 2; cv.maxMen = cv.men = 75;
    const acts = enemyTurn(s, ids, [ids[0]], level);
    return { s, ids, acts };
  };
  const weak = run(1);
  assert.ok(weak.acts.some(a => a.type === 'attack'), 'a weak AI fights on: ' + JSON.stringify(weak.acts));
  const { s, ids, acts } = run(4);
  assert.ok(!acts.some(a => a.type === 'attack'), 'backs off: ' + JSON.stringify(acts));
  assert.ok(R.manhattan(R.unitById(s, ids[1]), R.unitById(s, ids[0])) >= 5, 'out of reach of the infantry');
  // next round: the infantry waits, the cavalry charges
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  const next = enemyTurn(s, ids, [ids[0]], 4);
  const hit = next.find(a => a.type === 'attack');
  assert.ok(hit, 'charges back in: ' + JSON.stringify(next));
});
