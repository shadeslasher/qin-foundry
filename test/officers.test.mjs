// Add to Officers: the copy's data.
import test from 'node:test';
import assert from 'node:assert';
globalThis.foundry = globalThis.foundry || { utils: { deepClone: (o) => structuredClone(o), escapeHTML: (s) => s } };
const { officerCopyData } = await import('../module/officers.mjs');

test('Add to Officers: a copy in the folder, seen by everyone, owned by the chosen player, linked token', () => {
  const src = { _id: 'abc', name: 'Zhao Yun', folder: 'f0', ownership: { default: 0 }, prototypeToken: { actorLink: false, name: 'Zhao Yun' }, flags: { 'qin-3k-characters': { roll20Id: 'x' } } };
  const d = officerCopyData(src, { folderId: 'off', userId: 'u1', sourceUuid: 'Actor.abc', levels: { OBSERVER: 2, OWNER: 3 } });
  assert.strictEqual(d._id, undefined);
  assert.strictEqual(d.folder, 'off');
  assert.deepStrictEqual(d.ownership, { default: 2, u1: 3 });
  assert.strictEqual(d.prototypeToken.actorLink, true);
  assert.strictEqual(d.prototypeToken.name, 'Zhao Yun');
  assert.strictEqual(d.flags.qin.officerOf, 'Actor.abc');
  assert.ok(d.flags['qin-3k-characters'], 'other flags kept (Update from compendium still works)');
  assert.strictEqual(src._id, 'abc', 'the original is untouched');
  const none = officerCopyData(src, { folderId: 'off', userId: null, sourceUuid: 'Actor.abc', levels: { OBSERVER: 2, OWNER: 3 } });
  assert.deepStrictEqual(none.ownership, { default: 2 });
});
