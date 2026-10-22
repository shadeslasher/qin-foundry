import test from 'node:test';
import assert from 'node:assert';
globalThis.CONFIG = {}; globalThis.foundry = { utils: {} };
const U = await import('../module/unit-bars.mjs');

test('figures: one per 20% of strength (cavalry of 50), at least 1 while alive', () => {
  assert.deepStrictEqual([100, 81, 80, 61, 60, 41, 40, 21, 20, 1, 0].map(m => U.figureCount(m, 100)), [5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0]);
  assert.deepStrictEqual([50, 41, 40, 30, 10, 1].map(m => U.figureCount(m, 50)), [5, 5, 4, 3, 1, 1]);
});

test('loss order (2 back, 3 front): front-right first, then front-left, back-right, back-left; front-middle is the last man', () => {
  const key = (p) => p.join(',');
  const BL = '0.395,0.285', BR = '0.605,0.285', FL = '0.29,0.495', FM = '0.5,0.505', FR = '0.71,0.495';
  assert.deepStrictEqual(U.figureSlots(5).map(key), [BL, BR, FL, FM, FR]);
  assert.deepStrictEqual(U.figureSlots(4).map(key), [BL, BR, FL, FM]);
  assert.deepStrictEqual(U.figureSlots(3).map(key), [BL, BR, FM]);
  assert.deepStrictEqual(U.figureSlots(2).map(key), [BL, FM]);
  assert.deepStrictEqual(U.figureSlots(1).map(key), [FM]);
});

test('status icons: Command roll bonus/penalty, defense, ranged defense', () => {
  let battle = { active: true, sceneId: 's', turn: { activation: null }, meta: {} };
  globalThis.game = { settings: { get: () => battle } };
  const form = (sys) => ({ get: (id) => (id === 'f' ? { type: 'formation', system: sys } : null) });
  const tok = (sys, items = form({}), id = 't') => ({ id, document: { parent: { id: 's' } }, actor: { system: { formation: 'f', range: 1, category: 'infantry', men: { value: 100, max: 100 }, morale: 50, traits: '', ...sys }, items } });
  // morale and losses
  assert.strictEqual(U.unitStatus(tok({ morale: 80 })).attack, 2);
  assert.strictEqual(U.unitStatus(tok({ morale: 20, men: { value: 15, max: 100 } })).attack, -4, 'demoralised and down to 1 soldier');
  // ranged unit on its turn, not moved: +2
  battle.turn.activation = { unitId: 't' };
  assert.strictEqual(U.unitStatus(tok({ range: 3 })).attack, 2);
  battle.meta.t = { round: { moved: true } };
  assert.strictEqual(U.unitStatus(tok({ range: 3 })).attack, 0, 'moved: keeps nothing');
  // cavalry after a 4-tile move: +2, Fierce Charge+ makes it +4, Wedge adds +4
  battle.meta = {}; battle.turn.activation = { unitId: 't', movedThisActivation: true, tilesMoved: 4 };
  assert.strictEqual(U.unitStatus(tok({ category: 'cavalry' })).attack, 2);
  assert.strictEqual(U.unitStatus(tok({ category: 'cavalry', traits: 'Fierce Charge+ - x' })).attack, 4);
  assert.strictEqual(U.unitStatus(tok({ category: 'cavalry' }, form({ chargeBonus: 4 }))).attack, 6);
  // undone / not its turn: no charge
  battle.turn.activation = null;
  assert.strictEqual(U.unitStatus(tok({ category: 'cavalry' })).attack, 0);
  assert.strictEqual(U.unitStatus(tok({}, form({ atkMod: -1 }))).attack, -1, 'formation attack modifier always shows');
  // during an attack the sword shows that attack's total
  const t = tok({}); t.qinAttackBonus = -1; assert.strictEqual(U.unitStatus(t).attack, -1);
  // defense: Hold +2, Turtle defAll +2; ranged defense: Loose (enemy ranged -3) = 3, Spear Wall (enemy ranged +2) = -2
  battle.meta.t = { round: { holding: true } };
  assert.strictEqual(U.unitStatus(tok({}, form({ defAll: 2 }))).defense, 4);
  assert.strictEqual(U.unitStatus(tok({}, form({ defAll: 2 }))).rangedDefense, 2, 'Turtle helps against arrows too; Hold does not');
  assert.strictEqual(U.unitStatus(tok({}, form({ defRanged: 3, defMelee: -1 }))).rangedDefense, 3);
  assert.strictEqual(U.unitStatus(tok({}, form({ defRanged: 3, defMelee: -1 }))).defense, 1, 'Loose: hold 2, melee defense -1');
  assert.strictEqual(U.unitStatus(tok({}, form({ defRanged: -2 }))).rangedDefense, -2);
});
