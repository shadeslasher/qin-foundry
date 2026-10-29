// Two-weapon units (David, 2026-10-28): an officer leading e.g. Azure Dragons (spear and bow) uses his higher skill of the two.
import { test } from 'node:test';
import assert from 'node:assert';
import { officerEligibility, officerWeaponSkill, unitWeaponSkills } from '../module/officer-rules.mjs';
import { officerWeaponLevel } from '../module/battle/engine.mjs';

const officer = (skills) => ({ type: 'character', system: { skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { value: v }])) } });
const azure = { tier: 4, category: 'infantry', weaponSkill: 'qiangshu', weaponSkill2: 'gongshu' };

test('two-weapon unit: both skills count, the higher one is used', () => {
  assert.deepStrictEqual(unitWeaponSkills(azure), ['qiangshu', 'gongshu']);
  assert.deepStrictEqual(unitWeaponSkills({ weaponSkill: 'jianshu', weaponSkill2: '' }), ['jianshu']);
  const archer = officer({ qiangshu: 2, gongshu: 5 });
  assert.deepStrictEqual(officerWeaponSkill(archer, azure), { key: 'gongshu', value: 5 });
  assert.ok(officerEligibility(archer, azure).ok, 'a bowman can lead them');
  assert.ok(officerEligibility(officer({ qiangshu: 4 }), azure).ok, 'so can a spearman');
  const r = officerEligibility(officer({ qiangshu: 3, gongshu: 3 }), azure);
  assert.ok(!r.ok); assert.match(r.reason, /or/);
  // a one-weapon unit only counts its own weapon
  assert.ok(!officerEligibility(archer, { tier: 4, weaponSkill: 'qiangshu' }).ok);
});

test('engine: the officer weapon level for a unit type is the higher of its two skills', () => {
  assert.strictEqual(officerWeaponLevel({ skills: { qiangshu: 2, gongshu: 5 } }, { skill: 'qiangshu', skill2: 'gongshu' }), 5);
  assert.strictEqual(officerWeaponLevel({ skills: { qiangshu: 2, gongshu: 5 } }, { skill: 'qiangshu' }), 2);
  assert.strictEqual(officerWeaponLevel(null, { skill: 'qiangshu' }), 0);
});
