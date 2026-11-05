// Battle AI: placing tactics (David, 2026-11-04).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as AI from '../module/battle/ai.mjs';
import * as AT from '../module/battle/ai-tactics.mjs';
import { TACTICS } from '../module/battle/engine-data.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const ut = (id, o) => Object.assign({ id, name: id, faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 }, o);
const cav = ut('cav', { category: 'cavalry', move: 5 }), inf = ut('inf'), bow = ut('bow', { category: 'ranged', weapon: 'ranged', rangeMin: 2, rangeMax: 4 });
const off = (id, name, aow, o) => ({ id, name, fire: 2, command: 2, skills: { artOfWar: aow, qiangshu: 3 }, heroicActions: [], ...o });

/** A battle in its tactics phase: player units at the top, enemy units at the bottom. */
function tacticsBattle(enemy, { officers = [], objectives = null, tiles = null } = {}) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  s.map.cols = 16; s.map.rows = 16;
  if (tiles) { s.map.tiles = {}; for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' }; Object.assign(s.map.tiles, tiles); }
  s.library.unitTypes.push(cav, inf, bow);
  s.library.officers.push(...officers);
  for (let i = 0; i < 3; i++) must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', owner: 'p1', x: 5 + i * 2, y: 2 }));
  for (const o of enemy) must(R.act(s, HOST, { type: 'addUnit', side: 'enemy', ...o }));
  if (objectives) s.objectives = { victory: [], defeat: [], extraction: [], ...objectives };
  must(R.act(s, HOST, { type: 'startBattle' }));
  return s;
}
/** Let the AI run the tactics phase for the enemy side. */
function runTactics(s, aow) {
  const acts = [];
  for (let i = 0; i < 12; i++) { const a = AI.aiStep(s, { enemy: true }); if (!a) break; must(R.act(s, HOST, a)); acts.push(a); }
  return acts;
}
const placed = (s) => s.tactics.placed.filter(p => p.side === 'enemy');

test('AI tactics: with no tactician it takes its officer with the best Art of War', () => {
  const s = tacticsBattle([{ typeId: 'inf', x: 5, y: 12, officerId: 'a' }, { typeId: 'inf', x: 7, y: 12, officerId: 'b' }],
    { officers: [off('a', 'Xiahou Dun', 1), off('b', 'Xun Yu', 4)] });
  runTactics(s);
  assert.strictEqual(s.tactics.sides.enemy.name, 'Xun Yu');
  assert.strictEqual(s.tactics.sides.enemy.aow, 4);
});

test('AI tactics: Art of War + 1 tactics, each within its Art of War, no duplicates; then it leaves the GM alone', () => {
  const s = tacticsBattle([{ typeId: 'cav', x: 4, y: 12, officerId: 'a' }, { typeId: 'cav', x: 6, y: 12 }, { typeId: 'inf', x: 8, y: 12 }], { officers: [off('a', 'Zhang Liao', 2)] });
  runTactics(s);
  const list = placed(s);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(new Set(list.map(p => p.key)).size, 3, 'no duplicates');
  assert.ok(list.every(p => TACTICS.find(d => d.key === p.key).aow <= 2), 'within Art of War 2: ' + list.map(p => p.key));
  assert.ok(list.some(p => p.key === 'cavalryCharge'), 'a cavalry army takes Cavalry Charge');
  assert.ok(s.tactics.sides.enemy.aiDone);
  s.tactics.placed = s.tactics.placed.filter(p => p.key !== 'cavalryCharge'); // the GM removes one
  assert.strictEqual(AI.aiStep(s, { enemy: true }), null, 'done: it does not put it back');
});

test('AI tactics: archers get Divine Winds; Raise Flag only goes on high ground', () => {
  const s = tacticsBattle([{ typeId: 'bow', x: 4, y: 12, officerId: 'a' }, { typeId: 'bow', x: 6, y: 12 }, { typeId: 'bow', x: 8, y: 12 }],
    { officers: [off('a', 'Sima Yi', 4)], tiles: { '6,13': { terrain: 'plains', overlays: ['hill'] } } });
  runTactics(s);
  const list = placed(s);
  assert.ok(list.some(p => p.key === 'divineWinds'), list.map(p => p.key).join());
  for (const p of list.filter(p => p.key === 'raiseFlag')) assert.ok(R.tileRules(s, p.x, p.y).high, 'flag on high ground');
});

test('AI tactics: a side keeping a square leans on defense; one racing the clock on attack', () => {
  const army = [{ typeId: 'inf', x: 4, y: 12, officerId: 'a' }, { typeId: 'inf', x: 6, y: 12 }, { typeId: 'inf', x: 8, y: 12 }];
  const def = tacticsBattle(army, { officers: [off('a', 'Cao Ren', 3)], objectives: { victory: [{ id: 'v', type: 'seize', x: 6, y: 13 }], defeat: [{ id: 'd', type: 'turnLimit', rounds: 8 }] } });
  runTactics(def);
  const att = tacticsBattle(army, { officers: [off('a', 'Cao Ren', 3)], objectives: { victory: [{ id: 'v', type: 'survive', rounds: 5 }] } });
  runTactics(att);
  const d = placed(def).map(p => p.key), a = placed(att).map(p => p.key);
  const defensive = (l) => l.filter(k => ['defend', 'holdTheLine', 'backsTurned', 'raiseFlag'].includes(k)).length;
  assert.ok(defensive(d) > defensive(a), 'keeping: ' + d + ' / attacking: ' + a);
  assert.ok(a.includes('attack'), 'the attacking side takes Attack: ' + a);
});
