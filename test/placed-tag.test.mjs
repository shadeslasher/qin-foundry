// Actors directory "(placed)" tag.
import test from 'node:test';
import assert from 'node:assert';

// a tiny stand-in for the DOM: elements with children, dataset, class lookups
function el(cls, dataset = {}) {
  const e = { className: cls, dataset, children: [], textContent: '', style: {}, parent: null,
    append(c) { c.parent = e; e.children.push(c); }, remove() { const p = e.parent; p.children.splice(p.children.indexOf(e), 1); },
    all() { return e.children.flatMap(c => [c, ...c.all()]); },
    querySelectorAll(sel) { return sel === '[data-entry-id]' ? e.all().filter(c => c.dataset.entryId) : []; },
    querySelector(sel) { return e.all().find(c => sel.split(',').some(s => { s = s.trim(); return s.startsWith('.') && !s.includes(' ') && c.className === s.slice(1); })) ?? null; } };
  return e;
}
globalThis.document = { createElement: () => el('') };
const { placedActorIds, markPlaced } = await import('../module/placed-tag.mjs');

test('"(placed)" shows for actors with a token on the viewed scene, and goes away again', () => {
  const ids = placedActorIds({ tokens: [{ actorId: 'a1' }, { actorId: 'a1' }, { actorId: null }] });
  assert.deepStrictEqual([...ids], ['a1']);
  assert.strictEqual(placedActorIds(null).size, 0, 'no scene: nothing placed');
  const root = el('dir');
  for (const id of ['a1', 'a2']) { const li = el('entry', { entryId: id }); li.append(el('entry-name')); root.append(li); }
  markPlaced(root, ids);
  const tags = () => root.all().filter(c => c.className === 'qin-placed');
  assert.strictEqual(tags().length, 1); assert.strictEqual(tags()[0].parent.parent.dataset.entryId, 'a1');
  markPlaced(root, ids);
  assert.strictEqual(tags().length, 1, 'not added twice');
  markPlaced(root, new Set());
  assert.strictEqual(tags().length, 0, 'removed when the token is deleted or the scene changes');
});
