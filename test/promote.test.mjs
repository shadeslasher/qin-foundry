import { test } from 'node:test';
import assert from 'node:assert';

globalThis.foundry ??= {}; foundry.applications ??= { api: { ApplicationV2: class {} } }; foundry.utils ??= { escapeHTML: (s) => s };

const T = (name, faction, tier, category, weaponSkill, cost, extra = {}) => ({ id: name, name, faction, tier, category, weaponSkill, cost, ...extra });
const list = [
  T('Pike A', 'Alpha', 1, 'infantry', 'qiangshu', 500), T('Halberd A', 'Alpha', 1, 'infantry', 'qiangshu', 550),
  T('Axe A', 'Alpha', 1, 'infantry', 'chuishu', 600), T('Blade A', 'Alpha', 1, 'infantry', 'jianshu', 600),
  T('Pike B', 'Alpha', 2, 'infantry', 'qiangshu', 900), T('Axe B', 'Alpha', 2, 'infantry', 'chuishu', 950),
  T('Pike C', 'Alpha', 3, 'infantry', 'qiangshu', 1300), T('Other Pike', 'Beta', 1, 'infantry', 'qiangshu', 500),
  T('Bow A', 'Alpha', 1, 'ranged', 'gongshu', 400), T('Xbow A', 'Alpha', 1, 'ranged', 'nushu', 450),
];
const cav = [T('Lance A', 'Alpha', 1, 'cavalry', 'qiangshu', 700), T('Horse Bow B', 'Alpha', 2, 'cavalry', 'gongshu', 850, { range: 3 }),
  T('Bow B', 'Alpha', 2, 'ranged', 'gongshu', 600), T('Lance B', 'Alpha', 2, 'cavalry', 'qiangshu', 950), T('Horse Bow C', 'Alpha', 3, 'cavalry', 'gongshu', 1100, { range: 3 })];

test('promotion: branches split spear and blade infantry', async () => {
  const { branchOf } = await import('../module/promote.mjs');
  assert.strictEqual(branchOf(list[0]), 'spear');
  assert.strictEqual(branchOf(list[2]), 'blade');
  assert.strictEqual(branchOf(list[3]), 'blade');
  assert.strictEqual(branchOf(list[8]), 'ranged');
});

test('promotion: same army, same branch; side-grades at the same tier, promotions one tier up', async () => {
  const { promotionPaths } = await import('../module/promote.mjs');
  const ps = promotionPaths(list[2], list);   // Axe A
  assert.deepStrictEqual(ps.map(p => [p.t.name, p.kind, p.cost]), [['Blade A', 'side', 100], ['Axe B', 'promote', 350]]);
  const sp = promotionPaths(list[0], list);   // Pike A: not Beta's pike, not tier 3
  assert.deepStrictEqual(sp.map(p => p.t.name), ['Halberd A', 'Pike B']);
  assert.strictEqual(sp[0].cost, 100, 'side-grade at least the flat fee');
  const bw = promotionPaths(list[8], list);
  assert.deepStrictEqual(bw.map(p => p.t.name), ['Xbow A']);
});

test('promotion: mounted shooters are reached from both ranged and cavalry', async () => {
  const { promotionPaths, branchesOf } = await import('../module/promote.mjs');
  const all = [...list, ...cav];
  assert.deepStrictEqual(branchesOf(cav[1]), ['cavalry', 'ranged']);
  assert.ok(promotionPaths(all.find(t => t.name === 'Bow A'), all).some(p => p.t.name === 'Horse Bow B' && p.kind === 'promote'), 'archers can take to horse');
  assert.ok(promotionPaths(cav[0], all).some(p => p.t.name === 'Horse Bow B'), 'riders can take up bows');
  assert.ok(!promotionPaths(cav[0], all).some(p => p.t.name === 'Bow B'), 'a lance rider does not become foot archers');
  assert.deepStrictEqual(promotionPaths(cav[1], all).filter(p => p.kind === 'promote').map(p => p.t.name), ['Horse Bow C']);
});

test('promotion: exceptions add and block paths', async () => {
  const { promotionPaths, parseExceptions } = await import('../module/promote.mjs');
  const ex = parseExceptions('Axe A > Pike A\n!Axe A > Blade A');
  assert.deepStrictEqual(promotionPaths(list[2], list, ex).map(p => p.t.name).sort(), ['Axe B', 'Pike A']);
});

test('promotion: level, coin and city cap', async () => {
  const { promotionPaths, promoteCheck } = await import('../module/promote.mjs');
  const [side, up] = promotionPaths(list[2], list);
  assert.ok(!promoteCheck({ level: 1, coin: 999, path: side }).ok, 'side-grade needs level 2');
  assert.ok(promoteCheck({ level: 2, coin: 999, path: side }).ok);
  assert.strictEqual(promoteCheck({ level: 3, coin: 999, path: up }).reason, 'Needs Level 4');
  assert.ok(!promoteCheck({ level: 4, coin: 100, path: up }).ok, 'coin');
  assert.strictEqual(promoteCheck({ level: 4, coin: 999, path: up, city: { cap: 1, base: 1 } }).reason, 'Needs Low Prosperity');
  assert.ok(promoteCheck({ level: 4, coin: 999, path: up, city: { cap: 2, base: 2 } }).ok);
  assert.ok(!promoteCheck({ level: 4, coin: 999, path: up, block: 'not here' }).ok);
});

test('promotion: equipment stays unless the new unit cannot use it', async () => {
  const { keptEquipment } = await import('../module/promote.mjs');
  const tl = [{ name: 'Saddle+', equip: true }, { name: 'Fine Arrows', equip: true }, { name: 'War Drums', equip: true }, { name: 'Brace', equip: false }];
  assert.deepStrictEqual(keptEquipment(tl, { category: 'infantry', range: 1 }).map(e => e.name), ['War Drums']);
  assert.deepStrictEqual(keptEquipment(tl, { category: 'cavalry', range: 3 }).map(e => e.name), ['Saddle+', 'Fine Arrows', 'War Drums']);
});
