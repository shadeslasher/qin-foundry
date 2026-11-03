// Add to Party Officers: the copy's data.
import test from 'node:test';
import assert from 'node:assert';
globalThis.foundry = globalThis.foundry || { utils: { deepClone: (o) => structuredClone(o), escapeHTML: (s) => s } };
const { officerCopyData, FOLDER } = await import('../module/officers.mjs');

test('Add to Party Officers: same name, in the folder, every player owns it, linked token', () => {
  assert.strictEqual(FOLDER, 'Party Officers');
  const src = { _id: 'abc', name: 'Zhao Yun', folder: 'f0', ownership: { default: 0, gm: 3 }, prototypeToken: { actorLink: false, name: 'Zhao Yun' }, flags: { 'qin-3k-characters': { roll20Id: 'x' } } };
  const d = officerCopyData(src, { folderId: 'off', sourceUuid: 'Actor.abc', levels: { OBSERVER: 2, OWNER: 3 } });
  assert.strictEqual(d._id, undefined);
  assert.strictEqual(d.name, 'Zhao Yun');
  assert.strictEqual(d.folder, 'off');
  assert.deepStrictEqual(d.ownership, { default: 3 });
  assert.strictEqual(d.prototypeToken.actorLink, true);
  assert.strictEqual(d.prototypeToken.name, 'Zhao Yun');
  assert.strictEqual(d.flags.qin.officerOf, 'Actor.abc');
  assert.ok(d.flags['qin-3k-characters'], 'other flags kept (Update from compendium still works)');
  assert.strictEqual(src._id, 'abc', 'the original is untouched');
  assert.strictEqual(officerCopyData({ ...src, name: 'Zhao Yun (Copy)' }, { folderId: 'off', sourceUuid: 'x', levels: { OWNER: 3 } }).name, 'Zhao Yun');
});
