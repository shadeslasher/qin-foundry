import test from 'node:test';
import assert from 'node:assert';
const { healthV2 } = await import('../module/health-v2.mjs');
test('health v2: 100 → 75, 75 → 50, 50 → 40, 25 → 20, keeping the share of health left', () => {
  assert.deepStrictEqual(healthV2({ value: 100, max: 100 }), { value: 75, max: 75 });
  assert.deepStrictEqual(healthV2({ value: 80, max: 100 }), { value: 60, max: 75 });
  assert.deepStrictEqual(healthV2({ value: 75, max: 75 }), { value: 50, max: 50 });
  assert.deepStrictEqual(healthV2({ value: 25, max: 50 }), { value: 20, max: 40 });
  assert.deepStrictEqual(healthV2({ value: 25, max: 25 }), { value: 20, max: 20 });
  assert.strictEqual(healthV2({ value: 60, max: 60 }), null, 'other sizes are left alone');
  assert.strictEqual(healthV2({ value: 40, max: 40 }), null, 'already converted');
});

test('health v3: moves a world unit by the template difference, keeps share of health, adds Colossal', async () => {
  const { healthV3Update } = await import('../module/health-v2.mjs');
  const prev = { health: 75, damage: 9, armorPen: 9, armor: 4 };
  const tmpl = { men: { max: 10 }, damage: 11, armorPen: 11, armor: 2, traitList: [{ name: 'Colossal' }, { name: 'Trample' }] };
  // leveled copy (damage +1 from a level), at 60/75 health
  const own = { men: { value: 60, max: 75 }, damage: 10, armorPen: 9, armor: 4, traitList: [{ name: 'Trample' }] };
  const up = healthV3Update(own, tmpl, prev);
  assert.equal(up['system.men.max'], 10);
  assert.equal(up['system.men.value'], 8);
  assert.equal(up['system.damage'], 12);
  assert.equal(up['system.armorPen'], 11);
  assert.equal(up['system.armor'], 2);
  assert.deepStrictEqual(up['system.traitList'].map(e => e.name), ['Colossal', 'Trample']);
  // a unit whose health was changed by hand keeps it; token deltas use their own prefix
  const tok = healthV3Update({ men: { value: 30, max: 40 }, damage: 9 }, tmpl, prev, 'delta.system.');
  assert.deepStrictEqual(tok, { 'delta.system.damage': 11 });
  assert.equal(healthV3Update({ men: { value: 10, max: 10 }, damage: 11 }, tmpl, { ...prev, damage: 11 }), null);
});
