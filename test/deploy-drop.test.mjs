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

// Deploy / Undeploy buttons (2026-10-31)
import { firstFreeSquare, zoneSet } from '../module/battle/deploy-rules.mjs';
test('Deploy picks the top-left free deployment square: topmost row first, then leftmost', () => {
  const z = zoneSet(['5,3', '2,4', '7,3', '1,5']);
  assert.deepStrictEqual(firstFreeSquare(z), { x: 5, y: 3 });
  assert.deepStrictEqual(firstFreeSquare(z, new Set(['5,3'])), { x: 7, y: 3 });
  assert.deepStrictEqual(firstFreeSquare(z, new Set(['5,3', '7,3'])), { x: 2, y: 4 });
  assert.strictEqual(firstFreeSquare(z, new Set(['5,3', '7,3', '2,4', '1,5'])), null);
  assert.strictEqual(firstFreeSquare(new Set()), null);
});
const { _placeForUser: placeForUser, _removeForUser: removeForUser } = await import('../module/battle/deploy-drop.mjs');
function world(tokens = [], who = { id: 'p1', isGM: false }) {
  const created = [], deleted = [];
  const sc = { id: 's1', grid: { size: 100 }, tokens, getFlag: () => ['3,1', '1,2', '2,1'],
    createEmbeddedDocuments: async (_, docs) => created.push(...docs), deleteEmbeddedDocuments: async (_, ids) => deleted.push(...ids) };
  const act = actor({ uuid: 'Actor.a1', getTokenDocument: async (o) => ({ toObject: () => o }) });
  game.users = { get: () => who }; game.scenes = { get: () => sc };
  globalThis.fromUuid = async () => act;
  return { sc, created, deleted };
}
test('Deploy places the unit on the top-left free square; not twice; not after tactics', async () => {
  let w = world([{ x: 200, y: 100, width: 1, height: 1, actor: { type: 'unit' } }]);
  assert.ok((await placeForUser({ userId: 'p1', sceneId: 's1', actorUuid: 'Actor.a1', auto: true })).ok);
  assert.deepStrictEqual(w.created[0], { x: 300, y: 100 });
  w = world([{ x: 0, y: 0, actorId: 'a1', actorLink: true, actor: { type: 'unit' } }]);
  assert.ok(!(await placeForUser({ userId: 'p1', sceneId: 's1', actorUuid: 'Actor.a1', auto: true })).ok, 'already on the field');
  phase = 'officer'; w = world();
  assert.ok(!(await placeForUser({ userId: 'p1', sceneId: 's1', actorUuid: 'Actor.a1', auto: true })).ok, 'locked'); phase = 'tactics';
});
test('Undeploy removes the unit\'s tokens, only for its owner and only while deployment is open', async () => {
  let w = world([{ id: 't1', x: 0, y: 0, actorId: 'a1', actor: { type: 'unit' } }]);
  assert.ok((await removeForUser({ userId: 'p1', sceneId: 's1', actorUuid: 'Actor.a1' })).ok);
  assert.deepStrictEqual(w.deleted, ['t1']);
  phase = 'setup'; w = world([{ id: 't1', x: 0, y: 0, actorId: 'a1', actor: { type: 'unit' } }]);
  assert.ok(!(await removeForUser({ userId: 'p1', sceneId: 's1', actorUuid: 'Actor.a1' })).ok, 'players: tactics only');
  w = world([{ id: 't1', x: 0, y: 0, actorId: 'a1', actor: { type: 'unit' } }], { id: 'gm', isGM: true });
  assert.ok((await removeForUser({ userId: 'gm', sceneId: 's1', actorUuid: 'Actor.a1' })).ok, 'GM in setup'); phase = 'tactics';
});
