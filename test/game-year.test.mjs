import test from 'node:test';
import assert from 'node:assert';
const { officeStartYear, officesForViewer } = await import('../module/game-year.mjs');
test('office start year: reads the first year in When', () => {
  assert.strictEqual(officeStartYear('208'), 208);
  assert.strictEqual(officeStartYear('c.209'), 209);
  assert.strictEqual(officeStartYear('190s'), 190);
  assert.strictEqual(officeStartYear('208–219'), 208);
  assert.strictEqual(officeStartYear('after 208'), 208);
  assert.strictEqual(officeStartYear('early career'), null);
  assert.strictEqual(officeStartYear(''), null);
});
test('players see only started offices; the GM sees all, future ones flagged, with their indexes', () => {
  const offices = [{ title: 'A', when: '190s' }, { title: 'B', when: '208' }, { title: 'C', when: 'early career' }, { title: 'D', when: 'c.214' }];
  assert.deepStrictEqual(officesForViewer(offices, 208, false).map(o => [o.title, o.index]), [['A', 0], ['B', 1], ['C', 2]]);
  const gm = officesForViewer(offices, 208, true);
  assert.deepStrictEqual(gm.map(o => [o.title, o.future]), [['A', false], ['B', false], ['C', false], ['D', true]]);
  assert.strictEqual(gm[3].index, 3);
});
