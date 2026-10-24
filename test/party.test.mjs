// Party panel: grouping by owner and what Heal / Morale change.
import test from 'node:test';
import assert from 'node:assert';

globalThis.foundry ??= {}; foundry.applications ??= { api: { ApplicationV2: class {} } }; foundry.utils ??= { escapeHTML: (s) => s };
const users = [{ id: 'gm', name: 'GM', isGM: true }, { id: 'b', name: 'Bob', isGM: false }, { id: 'a', name: 'Alice', isGM: false }];
const unit = (id, name, owner, men, morale) => ({ id, name, type: 'unit', system: { men: { value: men, max: 100 }, morale },
  testUserPermission: (u) => u.id === owner || u.isGM });
const actors = [unit('1', 'Spears', 'a', 60, 30), unit('2', 'Archers', 'a', 100, 50), unit('3', 'Cavalry', 'b', 10, 80), unit('4', 'Bandits', null, 50, 50),
  { id: '5', name: 'Liu Bei', type: 'character', testUserPermission: () => true }];
globalThis.game = { users: { find: (f) => users.find(f) }, actors: { contents: actors } };
const { partyGroups, restoreUpdate, DEFAULT_MORALE } = await import('../module/party.mjs');

test('party: units grouped by their player, unowned units and characters left out', () => {
  const g = partyGroups();
  assert.deepStrictEqual(g.map(x => x.user.name), ['Alice', 'Bob']);
  assert.deepStrictEqual(g[0].units.map(a => a.name), ['Archers', 'Spears']);
  assert.deepStrictEqual(g[1].units.map(a => a.name), ['Cavalry']);
});
test('party: heal fills health, morale goes back to the default, nothing when already there', () => {
  assert.deepStrictEqual(restoreUpdate(actors[0], 'heal'), { 'system.men.value': 100 });
  assert.strictEqual(restoreUpdate(actors[1], 'heal'), null);
  assert.deepStrictEqual(restoreUpdate(actors[2], 'morale'), { 'system.morale': DEFAULT_MORALE });
  assert.strictEqual(restoreUpdate(actors[1], 'morale'), null);
});
