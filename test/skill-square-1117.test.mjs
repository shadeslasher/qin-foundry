// Square areas (fireArea / WHO "square": true) and splash next to a contested target (David, 2026-11-17).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 0, recharge: 0 }, battle });
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'grass' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...(u.officerId ? { morale: 80 } : {}), ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

test('a 3x3 square around a picked tile: diagonal enemies are in, two tiles away are out', () => {
  const lx = officer('l', { activeName: 'Seven Hundred Li', active: { pick: [{ id: 't', side: 'tile', range: 6, count: 1 }], do: [
    { contest: { side: 'enemies', range: 1, square: true, from: { pick: 't' } }, lose: [{ morale: -20, who: { target: true } }], win: [{ morale: -10, who: { target: true } }] }] } });
  const { s, ids, u } = setup([{ side: 'player', x: 3, y: 3, officerId: 'l' }, { side: 'enemy', x: 5, y: 5 }, { side: 'enemy', x: 6, y: 6 }, { side: 'enemy', x: 7, y: 5 }], [lx]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: true, tilesMoved: 0, from: { x: 3, y: 3 } };
  const m = [1, 2, 3].map(i => u(i).morale);
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { t: [[5, 5]] } }));
  assert.ok(u(1).morale < m[0], 'on the centre tile');
  assert.ok(u(2).morale < m[1], 'diagonal: inside the square');
  assert.strictEqual(u(3).morale, m[2], 'two tiles away: outside');
});

test('splash: enemies next to a contested target lose morale too; units further off do not', () => {
  const zy = officer('z', { activeName: 'East Wind', active: { pick: [{ id: 'e', side: 'enemies', range: 6, count: 1 }], do: [
    { contest: { pick: 'e' }, lose: [{ morale: -10, who: { target: true } }, { morale: -5, who: { side: 'enemies', range: 1, from: { target: true } } }],
      win: [{ morale: -5, who: { target: true } }, { morale: -2, who: { side: 'enemies', range: 1, from: { target: true } } }] }] } });
  const { s, ids, u } = setup([{ side: 'player', x: 3, y: 3, officerId: 'z' }, { side: 'enemy', x: 5, y: 5 }, { side: 'enemy', x: 5, y: 6 }, { side: 'enemy', x: 8, y: 8 }], [zy]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: true, tilesMoved: 0, from: { x: 3, y: 3 } };
  const m = [1, 2, 3].map(i => u(i).morale);
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { e: [ids[1]] } }));
  const t = m[0] - u(1).morale, sp = m[1] - u(2).morale;
  assert.ok(t > sp && sp > 0, 'the neighbour loses less than the target (' + t + ' vs ' + sp + ')');
  assert.strictEqual(u(3).morale, m[2]);
});
