// Deployment zones (2026-10-24): players move their own units onto free deployment squares during the tactics
// phase only; never outside a battle; the GM can place units outside the battle rounds.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { deployMoveCheck, zoneSet } from '../module/battle/deploy-rules.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }

test('deployMoveCheck: who may move a unit where', () => {
  const zones = zoneSet(['2,3', '3,3']);
  const chk = (o, x = 2, y = 3) => deployMoveCheck(Object.assign({ phase: 'tactics', isGM: false, zones, occupied: false }, o), x, y).ok;
  assert.ok(chk({}), 'player, tactics, free zone square');
  assert.ok(!chk({}, 5, 5), 'outside the zone');
  assert.ok(!chk({ occupied: true }), 'square taken');
  assert.ok(!chk({ zones: zoneSet([]) }), 'no zones: players cannot move');
  assert.ok(!chk({ phase: 'none' }), 'no battle: players cannot move their units');
  assert.ok(!chk({ phase: 'setup' }), 'setup: the GM positions');
  assert.ok(!chk({ phase: 'formations' }), 'deployment locks once tactics are finished');
  assert.ok(!chk({ phase: 'officer' }), 'rounds: Move action only');
  assert.ok(chk({ isGM: true, phase: 'none' }, 9, 9), 'GM outside a battle: anywhere');
  assert.ok(chk({ isGM: true, phase: 'tactics' }, 9, 9), 'GM during tactics: anywhere');
  assert.ok(!chk({ isGM: true, phase: 'officer' }), 'GM during the rounds: Move action');
});

test('engine place: players deploy onto zone squares during tactics only', () => {
  const s = R.newState(); s.players.p1 = { name: 'Alice' };
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 1, y: 1 })).unitId;
  const b = must(R.act(s, HOST, { type: 'addUnit', typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 2, y: 4 })).unitId;
  must(R.act(s, HOST, { type: 'addUnit', typeId: 'yt_warriors', side: 'enemy', x: 10, y: 10 }));
  s.deployZones = ['2,3', '3,3', '2,4'];
  assert.ok(!R.act(s, P1, { type: 'place', unitId: a, x: 2, y: 3 }).ok, 'not during setup');
  must(R.act(s, HOST, { type: 'startBattle' }));
  assert.strictEqual(s.turn.phase, 'tactics');
  must(R.act(s, P1, { type: 'place', unitId: a, x: 2, y: 3 }));
  assert.deepStrictEqual([R.unitById(s, a).x, R.unitById(s, a).y], [2, 3]);
  assert.ok(!R.act(s, P1, { type: 'place', unitId: a, x: 5, y: 5 }).ok, 'outside the zone');
  assert.ok(!R.act(s, P1, { type: 'place', unitId: a, x: 2, y: 4 }).ok, 'square taken by another unit');
  assert.ok(R.act(s, P1, { type: 'place', unitId: b, x: 3, y: 3 }).ok);
  must(R.act(s, HOST, { type: 'place', unitId: a, x: 7, y: 7 })); // the GM may put it anywhere
  must(R.act(s, HOST, { type: 'skipTactics' }));
  assert.ok(!R.act(s, P1, { type: 'place', unitId: a, x: 2, y: 3 }).ok, 'locked after tactics');
});
