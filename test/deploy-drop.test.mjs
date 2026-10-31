// Players dropping their own units from the Actors directory onto deployment squares (2026-10-30)
import test from 'node:test';
import assert from 'node:assert';
globalThis.foundry ??= {};
let phase = 'tactics';
globalThis.game = { settings: { get: () => ({ active: true, sceneId: 's1', turn: { phase } }) } };
globalThis.CONFIG = { queries: {} };
globalThis.Hooks = { on() {} };
const { _dropCheck: dropCheck } = await import('../module/battle/deploy-drop.mjs');
const scene = (tokens = []) => ({ id: 's1', grid: { size: 100 }, tokens, getFlag: () => ['2,2', '3,2'] });
const actor = (o = {}) => ({ id: 'a1', type: 'unit', name: 'Ji', system: { status: 'active' }, prototypeToken: { actorLink: true }, testUserPermission: () => true, ...o });
const user = {};
test('a player may drop their own unit on a free deployment square in the tactics phase', () => {
  assert.ok(dropCheck(user, scene(), actor(), 2, 2).ok);
});
test('not off the zone, not on an occupied square, not someone else\'s unit, not twice, not outside tactics', () => {
  assert.ok(!dropCheck(user, scene(), actor(), 5, 5).ok, 'off zone');
  assert.ok(!dropCheck(user, scene([{ x: 200, y: 200, actor: { type: 'unit' } }]), actor(), 2, 2).ok, 'occupied');
  assert.ok(!dropCheck(user, scene(), actor({ testUserPermission: () => false }), 2, 2).ok, 'not owner');
  assert.ok(!dropCheck(user, scene([{ x: 900, y: 900, actorLink: true, actorId: 'a1', actor: { type: 'unit' } }]), actor(), 2, 2).ok, 'already placed');
  phase = 'officer'; assert.ok(!dropCheck(user, scene(), actor(), 2, 2).ok, 'mid-battle'); phase = 'tactics';
});
