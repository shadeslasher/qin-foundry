// New unit: creating units with stand-ins for Foundry's documents (regression: the folder helpers went missing in v0.41).
import test from 'node:test';
import assert from 'node:assert';

const folders = [], actors = [];
globalThis.foundry = { applications: { api: { ApplicationV2: class {} } }, utils: { mergeObject: (a, b) => Object.assign(a, b), escapeHTML: (s) => s } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 } };
globalThis.game = { folders: { find: (f) => folders.find(f) }, users: { get: (id) => (id === 'u1' ? { id: 'u1', name: 'Alice', color: '#123456' } : null) }, system: { id: 'qin' }, user: { isGM: true } };
globalThis.Folder = { create: async (d) => { const f = { id: 'f' + folders.length, ...d, folder: d.folder ? folders.find(x => x.id === d.folder) : null }; folders.push(f); return f; } };
globalThis.Actor = { create: async (d) => { actors.push(d); return { name: d.name }; } };
globalThis.ui = { notifications: { info() {}, error(m) { throw new Error(m); } } };
const { createUnit } = await import('../module/new-unit.mjs');

test('blank units go into the right folder for their side or owner', async () => {
  await createUnit({ template: '', name: '', owner: '', side: 'player', officer: '' });
  const nf = folders.find(f => f.id === actors.at(-1).folder);
  assert.strictEqual(nf.name, 'No owner', 'a player-side unit with no owner goes in "No owner"'); assert.strictEqual(nf.folder.name, 'Player Units');
  await createUnit({ template: '', name: 'Spare', owner: '', side: 'player', officer: '' });
  assert.strictEqual(folders.filter(f => f.name === 'No owner').length, 1, 'reuses "No owner"');
  await createUnit({ template: '', name: 'Raiders', owner: '', side: 'enemy', officer: '' });
  assert.strictEqual(folders.find(f => f.id === actors.at(-1).folder).name, 'Enemy Units');
  await createUnit({ template: '', name: 'Guard', owner: 'u1', side: 'player', officer: '' });
  const f = folders.find(f => f.id === actors.at(-1).folder);
  assert.strictEqual(f.name, "Alice's units"); assert.strictEqual(f.folder.name, 'Player Units');
  await createUnit({ template: '', name: 'More raiders', owner: '', side: 'enemy', officer: '' });
  assert.strictEqual(folders.filter(f => f.name === 'Enemy Units').length, 1, 'reuses the folder');
});
