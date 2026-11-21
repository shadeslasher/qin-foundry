// Yuan Shao, 2026-11-21 (David): his passive's name is logged at the start of battle before the morale it gives,
// so its banner can play first; each unit's +15 is marked as a starting-morale gain.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const LORD = { passiveName: 'Lord of the North', activeName: 'The Hundred Thousand', passive: { mods: [
  { stat: 'startMorale', value: 15, who: { side: 'allies', all: true, self: true } },
  { stat: 'command', value: 1, who: { side: 'allies', range: 5 } },
  { stat: 'range', value: 1, who: { side: 'allies', range: 1, filter: { category: 'ranged' } } }] } };
const off = { id: 'ys', name: 'Yuan Shao', command: 4, fire: 4, skills: {}, passive: { effects: {} }, skill: null, battle: LORD, rank: 1, family: 'ys' };

test('Lord of the North: named first, then +15 starting morale for every unit on his side', () => {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(off);
  const ids = [{ side: 'enemy', x: 1, y: 1, officerId: 'ys' }, { side: 'enemy', x: 9, y: 9 }, { side: 'player', x: 5, y: 5 }]
    .map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  const log = s.log.map(e => e.detail).filter(Boolean);
  const named = log.findIndex(d => d.type === 'passiveStart' && d.skill === 'Lord of the North' && d.unit === ids[0]);
  assert.ok(named >= 0, 'passive named');
  const gains = log.map((d, i) => [d, i]).filter(([d]) => d.type === 'skillMorale' && d.start === 15);
  assert.deepStrictEqual(gains.map(([d]) => d.unit).sort(), [ids[0], ids[1]].sort());
  assert.ok(gains.every(([, i]) => i > named));
});
