import test from 'node:test';
import assert from 'node:assert';
globalThis.CONFIG = { QIN: {} };
globalThis.foundry = { utils: {} };
const F = await import('../module/factions.mjs');

test('faction list: pinned four first, rest alphabetical; old text values still resolve', () => {
  F.registerFactions([{ name: 'Yuan Shao', img: 'y.png' }, { name: 'Sun Jian' }, { name: 'Abandoned' }, { name: 'Cao Cao' }, { name: 'Liu Bei' }, { name: 'Han Empire' }, { name: 'Gong Du' }]);
  assert.deepStrictEqual(F.factionList().map(f => f.name), ['Han Empire', 'Liu Bei', 'Cao Cao', 'Sun Jian', 'Abandoned', 'Gong Du', 'Yuan Shao']);
  assert.strictEqual(F.factionOf('yuan-shao').img, 'y.png');
  assert.strictEqual(F.factionOf('Yuan Shao').key, 'yuan-shao');
  assert.deepStrictEqual(F.factionOf('Bandits'), { key: 'Bandits', name: 'Bandits', img: null, unknown: true });
  assert.strictEqual(F.factionOf(''), null);
});
