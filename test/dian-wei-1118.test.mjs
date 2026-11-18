// Dian Wei's Eighty Jin of Iron / Unbroken Bulwark (David, 2026-11-18)
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const HIT = { casualties: 4, who: { target: true }, ignoreArmor: true };
const GATE = { oncePerBattle: true, require: { healthBelow: 'half' }, do: [{ buff: { flags: [{ flag: 'noSurrender' }, { flag: 'casualtyHalf' }],
  triggers: [{ on: 'enemyPasses', range: 2, limit: 'targetTurn', group: 'gate', do: [HIT] }, { on: 'enemyTurnEnd', range: 2, limit: 'targetTurn', group: 'gate', do: [HIT] }] }, who: { self: true }, for: { rounds: 3 } }] };
const GUARD = { mods: [{ stat: 'meleeDef', value: 8, who: { side: 'allies', range: 1 } }], flags: [{ flag: 'noRearAgainst', who: { side: 'allies', range: 1 } }, { flag: 'ignoreStrength' }] };
const officer = { id: 'dw', name: 'Dian Wei', command: 2, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Eighty Jin of Iron', text: 'x', moraleCost: 0, recharge: 0 },
  battle: { active: GATE, activeName: 'Eighty Jin of Iron', passive: GUARD, passiveName: 'Unbroken Bulwark' } };
function setup(units) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(officer);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, morale: 80, ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

test('specs validate', () => {
  assert.deepStrictEqual(validateSpec(GATE, 'active'), []);
  assert.deepStrictEqual(validateSpec(GUARD, 'passive'), []);
});

test('Eighty Jin of Iron: enemies ending their turn within 2 tiles take 4 armor-piercing casualties; farther ones don\'t', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5, officerId: 'dw' }, { side: 'enemy', x: 7, y: 5 }, { side: 'enemy', x: 9, y: 5 }]);
  u(0).men = Math.floor((u(0).maxMen || 100) / 2) - 1;
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  const m1 = u(1).men, m2 = u(2).men;
  SK.onActivationEnd(s, u(1)); SK.onActivationEnd(s, u(2));
  assert.strictEqual(u(1).men, m1 - 4, '2 tiles away');
  assert.strictEqual(u(2).men, m2, '4 tiles away');
});

test('Unbroken Bulwark: his unit ignores the low-health penalties', () => {
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'dw' }, { side: 'enemy', x: 6, y: 5 }]);
  u(0).men = 15;
  assert.ok(SK.flag(s, u(0), 'ignoreStrength'));
});

test('Eighty Jin of Iron: a unit walking through the zone is hit once, where it enters, and not again when it ends its turn there', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5, officerId: 'dw' }, { side: 'enemy', x: 6, y: 2 }]);
  u(0).men = 40;
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: ids[0] }));
  const m = u(1).men;
  s.turn.activation = { unitId: ids[1], step: 'move', started: false, tilesMoved: 0, from: { x: 6, y: 2 } };
  const n0 = s.log.length;
  must(R.act(s, HOST, { type: 'moveTo', unitId: ids[1], x: 6, y: 5 }));
  assert.strictEqual(u(1).men, m - 4, 'one hit for the whole walk');
  const walk = s.log.slice(n0).find(e => e.detail?.type === 'walk'), hit = s.log.slice(n0).find(e => e.detail?.type === 'skillCasualties');
  assert.deepStrictEqual(walk.detail.path, [[6, 2], [6, 3], [6, 4], [6, 5]]);
  assert.strictEqual(hit.detail.at, 1, 'it stops on (6,4), the first square within 2');
  assert.strictEqual(hit.detail.skill, 'Eighty Jin of Iron');
  SK.onActivationEnd(s, u(1));
  assert.strictEqual(u(1).men, m - 4, 'not hit again at the end of the same turn');
});

test('walk paths go round enemy units', () => {
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5 }, { side: 'enemy', x: 6, y: 5 }]);
  s.turn.activation = { unitId: ids[0], step: 'move', started: false, tilesMoved: 0, from: { x: 5, y: 5 } };
  const n0 = s.log.length;
  must(R.act(s, HOST, { type: 'moveTo', unitId: ids[0], x: 7, y: 6 }));
  const p = s.log.slice(n0).find(e => e.detail?.type === 'walk').detail.path;
  assert.strictEqual(p.length, 4);
  assert.ok(!p.some(([x, y]) => x === 6 && y === 5), 'never on the enemy square');
  for (let i = 1; i < p.length; i++) assert.strictEqual(Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]), 1, 'one square at a time');
});

test('Fight or Be Butchered: the end-of-turn morale loss names its skill (for the whip animation)', () => {
  const FB = { do: [{ buff: { mods: [{ stat: 'attack', value: 4 }], flags: [{ flag: 'noSurrender' }], triggers: [{ on: 'turnEnd', do: [{ morale: -5, who: { self: true } }] }] }, who: { side: 'allies', range: 5 }, for: { rounds: 2 } }] };
  const dz = { id: 'dz', name: 'Dong Zhuo', command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Fight or Be Butchered', text: 'x', moraleCost: 0, recharge: 0 },
    battle: { active: FB, activeName: 'Fight or Be Butchered' } };
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(dz);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: 'p1', side: 'player', x: 2, y: 2, officerId: 'dz', morale: 80 })).unitId;
  const b = must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: 'p1', side: 'player', x: 4, y: 2, morale: 80 })).unitId;
  must(R.act(s, HOST, { type: 'startBattle' })); R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  s.turn.activation = { unitId: a, step: 'move', started: false, tilesMoved: 0, from: { x: 2, y: 2 } };
  must(R.act(s, HOST, { type: 'useSkill', unitId: a }));
  const n0 = s.log.length;
  SK.onActivationEnd(s, R.unitById(s, b));
  const e = s.log.slice(n0).find(x => x.detail?.type === 'skillMorale');
  assert.strictEqual(e.detail.skill, 'Fight or Be Butchered');
  assert.strictEqual(e.detail.lost, 5);
});
