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
  // any character can lead any unit (David, 2026-10-28)
  assert.ok(officerEligibility(officer({}), azure).ok);
  assert.ok(officerEligibility(officer({ jianshu: 1 }), { tier: 4, category: 'cavalry', weaponSkill: 'qiangshu' }).ok, 'no weapon or Horsemanship minimum');
  assert.ok(!officerEligibility({ type: 'unit' }, azure).ok, 'only characters');
  // a one-weapon unit only counts its own weapon
  assert.deepStrictEqual(officerWeaponSkill(archer, { tier: 4, weaponSkill: 'qiangshu' }), { key: 'qiangshu', value: 2 });
});

test('engine: the officer weapon level for a unit type is the higher of its two skills', () => {
  assert.strictEqual(officerWeaponLevel({ skills: { qiangshu: 2, gongshu: 5 } }, { skill: 'qiangshu', skill2: 'gongshu' }), 5);
  assert.strictEqual(officerWeaponLevel({ skills: { qiangshu: 2, gongshu: 5 } }, { skill: 'qiangshu' }), 2);
  assert.strictEqual(officerWeaponLevel(null, { skill: 'qiangshu' }), 0);
});

test('attacking: the officer adds Attack +1 per level of the unit weapon above Competent; defending, nothing', async () => {
  const R = await import('../module/battle/engine.mjs');
  const roll = (lv, role = 'attacker') => {
    const s = R.newState();
    s.library.unitTypes = [{ id: 'sp', name: 'Spears', tier: 2, category: 'infantry', weapon: 'melee', skill: 'qiangshu', skill2: 'gongshu', damage: 4, armor: 4, armorPen: 4, move: 3, rangeMin: 1, rangeMax: 1, unitValue: 2, formations: ['none'] }];
    s.library.officers = [{ id: 'o', name: 'O', fire: 0, command: 0, skills: { qiangshu: lv, gongshu: 1 }, heroicActions: [] }];
    const mk = (id, side, off) => ({ id, typeId: 'sp', officerId: off ? 'o' : null, name: id, side, x: side === 'player' ? 5 : 6, y: 5, men: 100, maxMen: 100, morale: 60, status: 'active', facing: null, formation: 'none', traitTiers: {}, fx: {}, mods: [], round: { activated: false, moved: false, attacked: false }, xp: 0, level: 1 });
    const A = mk('a', 'player', true), D = mk('d', 'enemy', false); s.units = [A, D];
    const me = role === 'attacker' ? A : D;
    const r = R.buildRoll(s, role === 'attacker' ? A : A, role, { attacker: role === 'attacker' ? A : D, defender: role === 'attacker' ? D : A });
    return (r.parts.find(p => /^Officer's weapon/.test(p[0])) || [, 0])[1];
  };
  assert.strictEqual(roll(2), 0, 'Competent: nothing');
  assert.strictEqual(roll(3), 1, 'Expert +1');
  assert.strictEqual(roll(4), 2, 'Master +2');
  assert.strictEqual(roll(5), 3, 'Legendary +3');
  assert.strictEqual(roll(5, 'defender'), 0, 'not when defending');
});
