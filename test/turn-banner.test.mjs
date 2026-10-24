// Turn banner: what each viewer sees for each kind of prompt.
import test from 'node:test';
import assert from 'node:assert';
globalThis.foundry ??= {}; foundry.utils ??= { escapeHTML: (s) => s }; foundry.utils.deepClone ??= (o) => structuredClone(o);
globalThis.game ??= { settings: { get: () => ({}) }, user: { isGM: false } };
const { bannerFor } = await import('../module/battle/turn-banner.mjs');
const s = { turn: { round: 3 }, units: [{ id: 'a', name: 'Ji Infantry', side: 'player', owner: 'p1' }, { id: 'e', name: 'Warriors', side: 'enemy', owner: null }, { id: 'n', name: 'Militia', side: 'player', owner: null }] };
const names = { p1: 'Alice', p2: 'Bob' };
test('turn banner: your turn, another player, the enemy, hidden enemies, the GM with unowned units', () => {
  assert.strictEqual(bannerFor(s, { kind: 'activation', unitId: 'a' }, { me: 'p1', names }).title, 'Your turn');
  assert.strictEqual(bannerFor(s, { kind: 'activation', unitId: 'a' }, { me: 'p2', names }).title, "Alice's turn");
  const e = bannerFor(s, { kind: 'decide', unitId: 'e' }, { me: 'p1', names, officerName: () => 'Zhang Jue' });
  assert.strictEqual(e.title, 'Enemy turn'); assert.match(e.sub, /Warriors · led by Zhang Jue · act or hold/);
  assert.strictEqual(bannerFor(s, { kind: 'activation', unitId: 'e' }, { me: 'p1', names, canSee: () => false }).sub, '', 'hidden: no name');
  assert.strictEqual(bannerFor(s, { kind: 'activation', unitId: 'n' }, { me: 'host', isGM: true, names }).title, 'Your turn');
  assert.strictEqual(bannerFor(s, { kind: 'claim' }, { me: 'p1', names }).title, 'Player side');
  assert.strictEqual(bannerFor(s, { kind: 'pick', player: 'p2' }, { me: 'p1', names }).title, "Bob's turn");
  assert.strictEqual(bannerFor(s, { kind: 'host-pick', side: 'enemy' }, { me: 'p1', names }).title, 'Enemy turn');
});
