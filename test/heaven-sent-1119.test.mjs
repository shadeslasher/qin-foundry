// Heaven-Sent Talent (David, 2026-11-19): resets an allied officer's active (once-per-battle ones too); his next active
// is free and ignores the morale minimum; a last stand still needs low morale. The AI weighs rule-breaking skills.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as AI from '../module/battle/ai.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const HST = { pick: [{ id: 'a', side: 'allies', range: 5, count: 1, filter: { officer: true } }], do: [{ resetCooldown: { pick: 'a' } }, { buff: { flags: [{ flag: 'freeActive' }] }, who: { pick: 'a' }, for: 'nextSkill' }] };
const RALLY = { do: [{ buff: { mods: [{ stat: 'attack', value: 5 }] }, who: { side: 'allies', range: 4, self: true }, for: { rounds: 2 } }] };
const LIGHTNING = { do: [{ buff: { mods: [{ stat: 'move', value: 1 }] }, who: { side: 'allies', range: 4, self: true }, for: { rounds: 3 } }, { turnNow: { side: 'allies', range: 4 } }] };
const off = (id, name, active, cost, extra = {}) => ({ id, name, command: 3, fire: 3, skills: {}, passive: { effects: {} }, skill: { name, text: 'x', moraleCost: cost, recharge: 6, ...extra }, battle: { active, activeName: name, passive: null, passiveName: '' } });
function setup(officers, units) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 14; s.map.rows = 10; s.map.tiles = {};
  for (let x = 0; x < 14; x++) for (let y = 0; y < 10; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', morale: 60, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' })); R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}
const turnOf = (s, id) => { const x = R.unitById(s, id); s.turn.activation = { unitId: id, step: 'move', started: false, tilesMoved: 0, from: { x: x.x, y: x.y } }; x.round.activated = false; x.round.skillUsed = false; };

test('spec is valid', () => { assert.deepStrictEqual(validateSpec(HST, 'active'), []); });

test('resets a once-per-battle active already used; the next use is free and ignores the 75 minimum; then normal again', () => {
  const { s, u, ids } = setup([off('sq', 'Heaven-Sent Talent', HST, 25), off('zy', 'Inferno', RALLY, 25, { perBattle: true, recharge: 0 })],
    [{ side: 'player', x: 1, y: 1, officerId: 'sq', morale: 90 }, { side: 'player', x: 3, y: 1, officerId: 'zy', morale: 90 }, { side: 'enemy', x: 12, y: 8 }]);
  turnOf(s, ids[1]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[1] }));
  u(1).morale = 40; u(1).round.skillUsed = false;
  assert.match(R.skillCheck(s, u(1), R.officerOf(s, u(1))).reason, /Already used/);
  turnOf(s, ids[0]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[1]] } }));
  assert.strictEqual(u(0).morale, 65, 'Heaven-Sent itself still costs 25');
  turnOf(s, ids[1]);
  assert.ok(R.skillCheck(s, u(1), R.officerOf(s, u(1))).ok, 'usable again at 40 morale (under 75 and under its cost)');
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[1] }));
  assert.strictEqual(u(1).morale, 40, 'free');
  u(1).round.skillUsed = false; u(1).morale = 90;
  assert.match(R.skillCheck(s, u(1), R.officerOf(s, u(1))).reason, /Already used/, 'the free use is spent');
});

test('a last stand still needs low morale', () => {
  const { s, u, ids } = setup([off('sq', 'Heaven-Sent Talent', HST, 25), off('ls', 'Last Stand', RALLY, 10, { lastStand: true, recharge: 0 })],
    [{ side: 'player', x: 1, y: 1, officerId: 'sq', morale: 90 }, { side: 'player', x: 3, y: 1, officerId: 'ls', morale: 80 }, { side: 'enemy', x: 12, y: 8 }]);
  turnOf(s, ids[0]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0], picks: { a: [ids[1]] } }));
  turnOf(s, ids[1]);
  assert.match(R.skillCheck(s, u(1), R.officerOf(s, u(1))).reason, /Last stand/);
});

test('AI: Sun Quan resets a strong allied active that is recharging', () => {
  const { s, u, ids } = setup([off('sq', 'Heaven-Sent Talent', HST, 25), off('cc', 'Rally', RALLY, 20)],
    [{ side: 'player', x: 4, y: 4, officerId: 'sq', morale: 90 }, { side: 'player', x: 5, y: 4, officerId: 'cc', morale: 90 },
     { side: 'player', x: 4, y: 5 }, { side: 'player', x: 5, y: 5 }, { side: 'player', x: 4, y: 3 },
     { side: 'enemy', x: 7, y: 4 }, { side: 'enemy', x: 7, y: 5 }, { side: 'enemy', x: 7, y: 3 }]);
  turnOf(s, ids[1]); must(R.act(s, HOST, { type: 'useSkill', unitId: ids[1] })); u(1).round.activated = true; s.turn.activation = null;
  for (const b of u(1).fx.buffs || []) b.until = { kind: 'round', round: 0 }; for (const x of s.units) if (x.fx?.buffs) x.fx.buffs = []; // the rally has worn off
  turnOf(s, ids[0]);
  const a = AI.nextAction(s, ids[0], { level: 2 });
  assert.deepStrictEqual([a.type, a.picks?.a], ['useSkill', [ids[1]]]);
});

test('AI: Sun Ce sends in allies that have not acted when enemies are near', () => {
  const { s, ids } = setup([off('sc', 'Lightning Campaign', LIGHTNING, 15)],
    [{ side: 'player', x: 4, y: 4, officerId: 'sc', morale: 90 }, { side: 'player', x: 4, y: 5 }, { side: 'player', x: 4, y: 3 }, { side: 'player', x: 3, y: 4 },
     { side: 'enemy', x: 6, y: 4 }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 6, y: 3 }]);
  turnOf(s, ids[0]);
  const a = AI.nextAction(s, ids[0], { level: 2 });
  assert.strictEqual(a.type, 'useSkill');
});
