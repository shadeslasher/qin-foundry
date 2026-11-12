// The range preview for a battlefield active (2026-11-11): squares in range by side, the units it reaches now.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 15, recharge: 0 }, battle });
function setup(units, officers) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

test('an area buff on allies within 2: the squares within 2 and the allies standing in them', () => {
  const act = { do: [{ buff: { mods: [{ stat: 'attack', value: 3 }] }, who: { side: 'allies', range: 2 }, for: { rounds: 2 } }] };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'o' }, { side: 'player', x: 6, y: 6 }, { side: 'player', x: 9, y: 9 }, { side: 'enemy', x: 5, y: 6 }],
    [officer('o', { active: act })]);
  const r = SK.activeReach(s, u(0));
  assert.strictEqual(r.tiles.length, 13); // a diamond of radius 2
  assert.ok(r.tiles.every(([, , k]) => k === 'allies'));
  assert.deepStrictEqual(r.units.map(([id]) => id), [u(1).id]); // not the far ally, not the enemy, not himself (no self)
  assert.strictEqual(r.whole, false);
});

test('a pick of enemies within 3: red squares, and the enemies it could pick', () => {
  const act = { pick: [{ id: 'e', side: 'enemies', range: 3, count: 1 }], do: [{ buff: { mods: [{ stat: 'meleeDef', value: -2 }] }, who: { pick: 'e' }, for: { rounds: 1 } }] };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'o' }, { side: 'enemy', x: 7, y: 5 }, { side: 'enemy', x: 10, y: 10 }], [officer('o', { active: act })]);
  const r = SK.activeReach(s, u(0));
  assert.ok(r.tiles.length > 0 && r.tiles.every(([, , k]) => k === 'enemies'));
  assert.deepStrictEqual(r.units, [[u(1).id, 'enemies']]);
});

test('no officer active: nothing', () => {
  const { s, u } = setup([{ side: 'player', x: 5, y: 5 }], []);
  assert.deepStrictEqual(SK.activeReach(s, u(0)), { tiles: [], units: [], whole: false });
});

test('passive aura reach: the range over other units, or nothing for a passive on his own unit only', () => {
  const aura = { mods: [{ stat: 'command', value: 2, who: { side: 'allies', range: 4 } }] };
  const own = { mods: [{ stat: 'meleeDef', value: 8, who: { self: true } }] };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'a' }, { side: 'player', x: 1, y: 1, officerId: 'b' }, { side: 'player', x: 9, y: 9 }],
    [officer('a', { passive: aura }), officer('b', { passive: own })]);
  assert.deepStrictEqual(SK.passiveAura(s, u(0)), { range: 4, whole: false });
  assert.strictEqual(SK.passiveAura(s, u(1)), null);
  assert.strictEqual(SK.passiveAura(s, u(2)), null);
});

test('Dawn Breaks the Dark: Command +1 for each ally within 6 at 25 morale or less, for 3 turns', () => {
  const act = { do: [{ counter: 'dawn', set: 0 }, { counter: 'dawn', add: 1, who: { side: 'allies', range: 6, filter: { moraleBelow: 26 } } },
    { buff: { mods: [{ stat: 'command', value: 1, per: 'dawn' }] }, who: { self: true }, for: { rounds: 3 } }] };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'z' }, { side: 'player', x: 6, y: 5 }, { side: 'player', x: 5, y: 8 }, { side: 'player', x: 7, y: 7 }, { side: 'player', x: 11, y: 11 }, { side: 'enemy', x: 4, y: 5 }],
    [officer('z', { active: act })]);
  u(1).morale = 20; u(2).morale = 25; u(3).morale = 40; u(4).morale = 10; u(5).morale = 5;   // in range low, in range at 25, in range high, too far, enemy
  SK.runSteps(s, act.do, { src: u(0), name: 'Dawn Breaks the Dark' });
  assert.strictEqual(SK.stat(s, u(0), 'command'), 2);             // two allies within 6 at 25 or less
  assert.strictEqual(SK.stat(s, u(1), 'command'), 0);             // the buff is his alone

});

test('Terror of Changban: losers lose 20 morale; his unit gets Attack +1 for each enemy it routs', () => {
  const tgt = { target: true }, rout = { if: { moraleBelow: 1 }, who: tgt, then: [{ buff: { mods: [{ stat: 'attack', value: 1 }] }, who: { self: true }, for: { rounds: 3 } }] };
  const act = { do: [{ contest: { side: 'enemies', range: 5 }, aspect: 'Fire',
    lose: [{ morale: -20, who: tgt }, { status: 'cantMove', who: tgt, for: 'untilNextTurnEnd' }, rout],
    win: [{ morale: -5, who: tgt }, { status: 'cantMove', who: tgt, for: 'untilNextTurnEnd' }, rout] }] };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'f' }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 5, y: 7 }, { side: 'enemy', x: 3, y: 5 }],
    [officer('f', { active: act })]);
  u(1).morale = 15; u(2).morale = 30; u(3).morale = 18;    // no officers: they lose the roll; 15 and 18 drop to 0, 30 to 10
  SK.runSteps(s, act.do, { src: u(0), name: 'Terror of Changban' });
  assert.strictEqual(u(1).morale, 0); assert.strictEqual(u(2).morale, 10);
  assert.strictEqual(SK.stat(s, u(0), 'attack'), 2);
});
