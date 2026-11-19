import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const ACT = {"do": [{"attack": {"mods": [{"stat": "attack", "value": 10}], "flags": [{"flag": "noStrikeBackIfWin"}]}, "who": {"self": true}, "extraMove": 3}, {"onWin": [{"push": 1, "who": {"target": true}}, {"attack": {"mods": [{"stat": "attack", "value": 2}], "target": {"isTarget": true}}, "who": {"side": "allies", "exact": 1, "from": {"target": true}}}]}]};
const officer = { id: 'sj', name: 'Sun Jian', command: 2, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'The Tiger Pounces', text: 'x', moraleCost: 0, recharge: 0 }, battle: { active: ACT, activeName: 'The Tiger Pounces' } };
// Sun Jian's The Tiger Pounces (David, 2026-11-18): the free attacks go to allies next to the enemy AFTER its push,
// and the attack carries the skill's name (its spirit-tiger animation keys off it)
test('The Tiger Pounces: allies next to the pushed enemy attack; the attack is marked with the skill', () => {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(officer);
  const add = u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', morale: 80, ...u })).unitId;
  const sj = add({ side: 'player', owner: 'p1', x: 5, y: 5, officerId: 'sj' }), en = add({ side: 'enemy', x: 6, y: 5 });
  const before = add({ side: 'player', owner: 'p1', x: 6, y: 4 }), after = add({ side: 'player', owner: 'p1', x: 8, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' })); R.setRng(() => 0.05); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: sj, step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: sj }));
  must(R.act(s, HOST, { type: 'attack', unitId: sj, targetId: en }));
  const e = R.unitById(s, en);
  assert.deepStrictEqual([e.x, e.y], [7, 5], 'pushed back one tile');
  const atk = s.log.map(l => l.detail).filter(d => d?.type === 'attack').at(-1);
  assert.ok(atk.result.nextAttack?.includes('The Tiger Pounces'), JSON.stringify(atk.result.nextAttack));
  const q = JSON.stringify(s.turn.skillQueue ?? s.skillQueue ?? s.turn);
  assert.ok(q.includes(after), 'the ally next to the new square gets the attack');
  assert.ok(!q.includes('"' + before + '"'), 'the ally only next to the old square does not');
});
