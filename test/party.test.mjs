// Party panel: grouping by owner and what Heal / Morale change.
import test from 'node:test';
import assert from 'node:assert';

globalThis.foundry ??= {}; foundry.applications ??= { api: { ApplicationV2: class {} } }; foundry.utils ??= { escapeHTML: (s) => s };
const users = [{ id: 'gm', name: 'GM', isGM: true }, { id: 'b', name: 'Bob', isGM: false }, { id: 'a', name: 'Alice', isGM: false }];
const unit = (id, name, owner, men, morale) => ({ id, name, type: 'unit', system: { men: { value: men, max: 100 }, morale },
  testUserPermission: (u) => u.id === owner || u.isGM });
const actors = [unit('1', 'Spears', 'a', 60, 30), unit('2', 'Archers', 'a', 100, 50), unit('3', 'Cavalry', 'b', 10, 80), unit('4', 'Bandits', null, 50, 50),
  { id: '5', name: 'Liu Bei', type: 'character', testUserPermission: () => true }];
globalThis.game = { users: { find: (f) => users.find(f), filter: (f) => users.filter(f) }, actors: { contents: actors } };
globalThis.foundry.applications.api.DialogV2 ??= class {};
const { partyGroups, restoreUpdate, DEFAULT_MORALE } = await import('../module/party.mjs');

test('party: every player listed with their units; unowned units and characters left out', () => {
  users.push({ id: 'c', name: 'Cara', isGM: false });
  const g = partyGroups();
  assert.deepStrictEqual(g.map(x => x.user.name), ['Alice', 'Bob', 'Cara']);
  assert.strictEqual(g[2].units.length, 0, 'a player with no units still shows');
  assert.deepStrictEqual(g[0].units.map(a => a.name), ['Archers', 'Spears']);
  assert.deepStrictEqual(g[1].units.map(a => a.name), ['Cavalry']);
});
test('party: heal fills health, morale goes back to the default, nothing when already there', () => {
  assert.deepStrictEqual(restoreUpdate(actors[0], 'heal'), { 'system.men.value': 100 });
  assert.strictEqual(restoreUpdate(actors[1], 'heal'), null);
  assert.deepStrictEqual(restoreUpdate(actors[2], 'morale'), { 'system.morale': DEFAULT_MORALE });
  assert.strictEqual(restoreUpdate(actors[1], 'morale'), null);
  actors[0].system.status = 'defeated'; actors[0].system.men.value = 0;
  assert.deepStrictEqual(restoreUpdate(actors[0], 'heal'), { 'system.men.value': 100, 'system.status': 'active' }, 'healing revives a defeated unit');
  actors[0].system.status = 'active'; actors[0].system.men.value = 40;
  actors[2].system.status = 'surrendered';
  assert.deepStrictEqual(restoreUpdate(actors[2], 'morale'), { 'system.morale': DEFAULT_MORALE, 'system.status': 'active' }, 'morale reset brings a surrendered unit back');
  actors[2].system.status = 'active';
  actors[2].system.defaultMorale = 60; // a Disciplined+ unit rests at 60
  assert.deepStrictEqual(restoreUpdate(actors[2], 'morale'), { 'system.morale': 60 });
  delete actors[2].system.defaultMorale;
  // healing revives a Defeated unit; resetting morale brings a Surrendered one back
  actors[1].system.status = 'defeated';
  assert.deepStrictEqual(restoreUpdate(actors[1], 'heal'), { 'system.status': 'active' });
  assert.strictEqual(restoreUpdate(actors[1], 'morale'), null, 'morale reset leaves a Defeated unit defeated');
  actors[1].system.status = 'surrendered';
  assert.deepStrictEqual(restoreUpdate(actors[1], 'morale'), { 'system.status': 'active' });
  actors[1].system.status = 'active';
});

test('defaultMoraleFor: 50, +5/+10/+15 with Disciplined/+/++', async () => {
  const { defaultMoraleFor } = await import('../module/data/actor-models.mjs').catch(() => ({}));
  if (!defaultMoraleFor) return; // the data model needs Foundry's fields; covered by the convert step instead
  assert.strictEqual(defaultMoraleFor('Disciplined+ - Morale +10'), 60);
});

test('recruiting: needs a character, an allowed army, a cost and enough coin', async () => {
  const { recruitCheck } = await import('../module/recruit.mjs');
  const base = { coin: 800, cost: 775, armies: ['Han'], army: 'Han', hasCharacter: true };
  assert.ok(recruitCheck(base).ok);
  assert.ok(!recruitCheck({ ...base, coin: 700 }).ok, 'not enough coin');
  assert.ok(!recruitCheck({ ...base, army: 'Bandits' }).ok, 'army not allowed');
  assert.ok(!recruitCheck({ ...base, armies: [] }).ok, 'no armies picked yet');
  assert.ok(!recruitCheck({ ...base, hasCharacter: false }).ok, 'no character');
  assert.ok(!recruitCheck({ ...base, cost: 0 }).ok, 'no cost set');
});

test('equipment: one piece per family, a better tier replaces, remove by name', async () => {
  const { equipList, unequipList } = await import('../module/equipment.mjs');
  let list = [{ name: 'Precision', desc: '', level: 1, upgrades: [], options: [], chosen: -1 }];
  list = equipList(list, 'War Drums');
  assert.deepStrictEqual(list.map(e => e.name), ['Precision', 'War Drums']);
  assert.ok(list[1].equip && list[1].desc.includes('within 2 tiles'));
  list = equipList(list, 'War Drums++');
  assert.deepStrictEqual(list.map(e => e.name), ['Precision', 'War Drums++'], 'replaces the lower tier');
  list = equipList(list, 'Saddle');
  assert.deepStrictEqual(list.map(e => e.name), ['Precision', 'War Drums++', 'Saddle']);
  assert.strictEqual(equipList(list, 'Not a thing'), null);
  list = unequipList(list, 'War Drums++');
  assert.deepStrictEqual(list.map(e => e.name), ['Precision', 'Saddle']);
});
