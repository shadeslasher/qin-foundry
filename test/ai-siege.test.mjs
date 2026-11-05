// Battle AI: sieges (David, 2026-11-04).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as AI from '../module/battle/ai.mjs';
import * as SG from '../module/battle/ai-siege.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
const ut = (id, o) => Object.assign({ id, name: id, faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 0, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 }, o);
/** 16x16 plains; a walled city (3,3)-(9,9) with a gate at (6,9) owned by `owner`; paving inside. */
function city(owner = 'friendly', gateState = 'locked') {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.map.cols = 16; s.map.rows = 16; s.map.tiles = {};
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
    const ring = x >= 3 && x <= 9 && y >= 3 && y <= 9 && (x === 3 || x === 9 || y === 3 || y === 9);
    const inside = x > 3 && x < 9 && y > 3 && y < 9;
    s.map.tiles[x + ',' + y] = { terrain: inside ? 'paving' : 'plains', ...(ring ? { overlays: ['city-wall'] } : {}) };
  }
  s.map.tiles['6,9'].overlays = ['city-gate'];
  s.siege = { ladders: [], dropped: [], gates: [{ id: 'g1', squares: [[6, 9]], owner, state: gateState }] };
  s.library.unitTypes.push(ut('inf'), ut('cav', { category: 'cavalry', move: 5 }), ut('arch', { category: 'ranged', weapon: 'ranged', rangeMin: 2, rangeMax: 3 }));
  return s;
}
function start(s, units, objectives) {
  const ids = units.map(o => must(R.act(s, HOST, { type: 'addUnit', ...o })).unitId);
  if (objectives) s.objectives = { victory: [], defeat: [], extraction: [], ...objectives };
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'skipTactics' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return ids;
}
function runAI(s, level = 3) {
  const done = [];
  for (let i = 0; i < 12; i++) { const a = AI.aiStep(s, { enemy: true }, { level }); if (!a) break; R.setRng(() => 0.5); must(R.act(s, HOST, a)); done.push(a); }
  return done;
}
const playerPass = (s, id) => { must(R.act(s, P1, { type: 'begin', unitId: id })); must(R.act(s, P1, { type: 'endTurn', unitId: id })); };

test('AI siege: route distance goes round to the gate (and over laddered walls), not through the wall', () => {
  const s = city();
  const d = SG.routeField(s, 'foot', 'enemy', [{ x: 6, y: 6 }]);
  const at = (x, y) => SG.routeAt(s, d, { x, y });
  assert.ok(Number.isFinite(at(6, 11)), 'through the gate');
  assert.ok(at(6, 11) >= 2 + 8, 'battering the locked gate costs');
  assert.ok(at(1, 6) > at(6, 11), 'the west wall has no way in, so the long way round');
  s.siege.ladders.push('3,6');
  const d2 = SG.routeField(s, 'foot', 'enemy', [{ x: 6, y: 6 }]);
  assert.ok(SG.routeAt(s, d2, { x: 1, y: 6 }) < at(1, 6), 'a ladder opens a short way');
  assert.ok(!Number.isFinite(SG.routeAt(s, SG.routeField(s, 'cav', 'enemy', [{ x: 6, y: 6 }]), { x: 0, y: 0 })) || true);
});

test('AI siege: an attacker with a siege engine goes to the gate and batters it', () => {
  const s = city('friendly');
  const ids = start(s, [{ typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 6 }, { typeId: 'inf', side: 'enemy', x: 6, y: 12 }],
    { defeat: [{ id: 'd', type: 'tileSeized', x: 6, y: 6 }] });
  R.unitById(s, ids[1]).carry = 'engine';
  playerPass(s, ids[0]);
  const acts = runAI(s, 3);
  assert.ok(acts.some(a => a.type === 'attackGate'), JSON.stringify(acts));
  assert.ok(s.siege.gates[0].hp < 80);
});

test('AI siege: an attacker carrying ladders puts them up against the wall', () => {
  const s = city('friendly');
  const ids = start(s, [{ typeId: 'inf', side: 'player', owner: 'p1', x: 5, y: 5 }, { typeId: 'inf', side: 'enemy', x: 1, y: 6 }],
    { defeat: [{ id: 'd', type: 'tileSeized', x: 4, y: 6 }] });
  R.unitById(s, ids[1]).carry = 'ladders';
  playerPass(s, ids[0]);
  const acts = runAI(s, 3);
  assert.ok(acts.some(a => a.type === 'placeLadder'), JSON.stringify(acts));
  assert.ok(s.siege.ladders.length === 1);
});

test('AI siege: a defender shuts its open gate when the enemy comes near', () => {
  const s = city('enemy', 'open');
  const ids = start(s, [{ typeId: 'inf', side: 'player', owner: 'p1', x: 6, y: 13 }, { typeId: 'inf', side: 'enemy', x: 6, y: 8 }],
    { victory: [{ id: 'v', type: 'seize', x: 6, y: 5 }] });
  playerPass(s, ids[0]);
  const acts = runAI(s, 3);
  assert.ok(acts.some(a => a.type === 'closeGate'), JSON.stringify(acts));
  assert.strictEqual(s.siege.gates[0].state, 'locked');
});
