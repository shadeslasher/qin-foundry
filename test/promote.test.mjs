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
  assert.deepStrictEqual(ps.map(p => [p.t.name, p.kind, p.cost]), [['Blade A', 'side', 300], ['Axe B', 'promote', 350]], 'side-grade: half the new unit\'s cost');
  const sp = promotionPaths(list[0], list);   // Pike A: not Beta's pike, not tier 3
  assert.deepStrictEqual(sp.map(p => p.t.name), ['Halberd A', 'Pike B']);
  assert.strictEqual(sp[0].cost, 275, 'half of 550');
  const bw = promotionPaths(list[8], list);
  assert.deepStrictEqual(bw.map(p => p.t.name), ['Xbow A']);
});

test('promotion: mounted shooters side-grade with cavalry and ranged; features depend on where you come from', async () => {
  const { promotionPaths, branchesOf, promoteCheck } = await import('../module/promote.mjs');
  const all = [...list, ...cav];
  assert.deepStrictEqual(branchesOf(cav[1]), ['cavalry', 'ranged']);
  const fromBow = promotionPaths(all.find(t => t.name === 'Bow A'), all).find(p => p.t.name === 'Horse Bow B');
  assert.strictEqual(fromBow?.kind, 'promote', 'foot archers can promote onto horses');
  assert.deepStrictEqual(fromBow.needFeatures, ['pastures']);
  const fromLance = promotionPaths(cav[0], all).find(p => p.t.name === 'Horse Bow B');
  assert.deepStrictEqual(fromLance.needFeatures, ['fletcher']);
  const hb = promotionPaths(cav[1], all);
  assert.deepStrictEqual(hb.filter(p => p.kind === 'side').map(p => p.t.name).sort(), ['Bow B', 'Lance B']);
  assert.deepStrictEqual(hb.filter(p => p.kind === 'promote').map(p => p.t.name), ['Horse Bow C']);
  assert.deepStrictEqual(hb.find(p => p.t.name === 'Horse Bow C').needFeatures, ['pastures', 'fletcher']);
  assert.deepStrictEqual(hb.find(p => p.t.name === 'Bow B').needFeatures, [], 'side-grade off the horse: no feature');
  const sideOn = promotionPaths(all.find(t => t.name === 'Bow B'), all).find(p => p.t.name === 'Horse Bow B');
  assert.strictEqual(sideOn.kind, 'side');
  assert.strictEqual(promoteCheck({ level: 2, coin: 999, path: sideOn, city: { features: ['fletcher'] } }).reason, 'Needs Horse Pastures here');
  assert.ok(promoteCheck({ level: 2, coin: 999, path: sideOn, city: { features: ['pastures'] } }).ok);
  const sideLance = promotionPaths(all.find(t => t.name === 'Lance B'), all).find(p => p.t.name === 'Horse Bow B');
  assert.strictEqual(promoteCheck({ level: 2, coin: 999, path: sideLance, city: { features: ['pastures'] } }).reason, 'Needs a Fletcher here');
  assert.ok(!promotionPaths(cav[0], all).some(p => p.t.name === 'Bow B'), 'a lance rider does not become foot archers');
});

test('promotion: Tier 5 units do not side-grade', async () => {
  const { promotionPaths } = await import('../module/promote.mjs');
  const imp = [T('Guard A', 'Imperial', 5, 'infantry', 'qiangshu', 3000), T('Guard B', 'Imperial', 5, 'infantry', 'qiangshu', 3000)];
  assert.deepStrictEqual(promotionPaths(imp[0], imp), []);
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
  assert.strictEqual(promoteCheck({ level: 4, coin: 999, path: up, city: { prosperity: 1, features: [] } }).reason, 'Needs a Weaponsmith here');
  assert.ok(promoteCheck({ level: 4, coin: 999, path: up, city: { prosperity: 1, features: ['weaponsmith'] } }).ok);
  assert.ok(promoteCheck({ level: 2, coin: 999, path: side, city: { prosperity: 1, features: [] } }).ok, 'side-grades need no feature');
  assert.ok(!promoteCheck({ level: 4, coin: 999, path: up, block: 'not here' }).ok);
});

test('promotion: features and Prosperity by tier', async () => {
  const { neededFeatures, minProsperity, promoteCheck } = await import('../module/promote.mjs');
  assert.deepStrictEqual(neededFeatures({ category: 'infantry', weaponSkill: 'qiangshu', range: 1 }), ['armorsmith']);
  assert.deepStrictEqual(neededFeatures({ category: 'infantry', weaponSkill: 'qiangshu', range: 3 }), ['armorsmith', 'fletcher']);
  assert.deepStrictEqual(neededFeatures({ category: 'cavalry', range: 3 }), ['pastures', 'fletcher']);
  assert.deepStrictEqual(neededFeatures({ category: 'ranged', range: 3 }), ['fletcher']);
  assert.deepStrictEqual([2, 3, 4].map(minProsperity), [1, 2, 3]);
  const path = { kind: 'promote', needLevel: 4, cost: 0, t: { tier: 4, category: 'infantry', weaponSkill: 'qiangshu', range: 3 } };
  assert.ok(promoteCheck({ level: 4, coin: 0, path, city: { prosperity: 1, features: ['fletcher'] } }).ok, 'any Prosperity with the feature');
  assert.strictEqual(promoteCheck({ level: 4, coin: 0, path, city: { prosperity: 3, features: ['weaponsmith'] } }).reason, 'Needs an Armorsmith or Fletcher here');
  const cav = { kind: 'promote', needLevel: 4, cost: 0, t: { tier: 4, category: 'cavalry', range: 1 } };
  assert.strictEqual(promoteCheck({ level: 4, coin: 0, path: cav, city: { prosperity: 1, features: [] } }).reason, 'Needs Horse Pastures here');
});

test('promotion: equipment stays unless the new unit cannot use it', async () => {
  const { keptEquipment } = await import('../module/promote.mjs');
  const tl = [{ name: 'Saddle+', equip: true }, { name: 'Fine Arrows', equip: true }, { name: 'War Drums', equip: true }, { name: 'Brace', equip: false }];
  assert.deepStrictEqual(keptEquipment(tl, { category: 'infantry', range: 1 }).map(e => e.name), ['War Drums']);
  assert.deepStrictEqual(keptEquipment(tl, { category: 'cavalry', range: 3 }).map(e => e.name), ['Saddle+', 'Fine Arrows', 'War Drums']);
});

test('promotion: Han units may move into the faction\'s lord armies, not into place-bound groups', async () => {
  const { promotionPaths, bridgeArmies } = await import('../module/promote.mjs');
  const han = T('Han Pike', 'Han', 1, 'infantry', 'qiangshu', 500);
  const more = [han, T('Lord Pike', 'Lordly', 2, 'infantry', 'qiangshu', 900), T('Lord Pike 1', 'Lordly', 1, 'infantry', 'qiangshu', 520),
    T('Frontier Pike', 'Qiang', 2, 'infantry', 'qiangshu', 900), T('Hired Pike', 'Mercenary', 1, 'infantry', 'qiangshu', 500)];
  const bridge = bridgeArmies(['Han', 'Lordly', 'Mercenary', 'Qiang', 'Imperial', 'Northern']);
  assert.deepStrictEqual(bridge, ['Lordly']);
  assert.deepStrictEqual(promotionPaths(han, more, undefined, bridge).map(p => [p.t.name, p.kind]), [['Lord Pike 1', 'side'], ['Lord Pike', 'promote']]);
  assert.deepStrictEqual(promotionPaths(han, more).map(p => p.t.name), [], 'no bridge without the faction\'s armies');
  assert.deepStrictEqual(promotionPaths(more[2], [...more, T('Han Pike 2', 'Han', 1, 'infantry', 'qiangshu', 500)], undefined, bridge).map(p => [p.t.name, p.kind]), [['Han Pike', 'side'], ['Han Pike 2', 'side'], ['Lord Pike', 'promote']], 'lord units side-grade into Han');
  assert.deepStrictEqual(promotionPaths(more[2], [...more, T('Han Pike 3', 'Han', 2, 'infantry', 'qiangshu', 900)], undefined, bridge).map(p => p.t.name).includes('Han Pike 3'), false, 'but never promote into Han');
  assert.deepStrictEqual(promotionPaths(more[4], more, undefined, bridge).map(p => p.t.name), [], 'Mercenaries don\'t side-grade into Han');
});

test('recruit: a feature-opened unit has no cap and needs no army or other feature', async () => {
  const { cityOffer } = await import('../module/recruit.mjs');
  const big = T('Big Beast', 'Southern', 4, 'cavalry', 'qiangshu', 3000);
  assert.deepStrictEqual(cityOffer(big, { groups: ['Han'], caps: { cavalry: 1 }, featureKeys: [], specialUnits: ['Big Beast'] }), { offered: true, cap: 99 });
  assert.strictEqual(cityOffer(big, { groups: ['Han'], caps: { cavalry: 1 }, featureKeys: [] }).offered, false);
});

test('local troops: any Prosperity, only chain roots recruitable; frontier groups skip a missing tier', async () => {
  const { cityOffer, recruitCheck } = await import('../module/recruit.mjs');
  const { promotionPaths } = await import('../module/promote.mjs');
  const loc = [T('Steppe Rider', 'Xiongnu', 2, 'cavalry', 'qiangshu', 900), T('Steppe Heavy', 'Xiongnu', 4, 'cavalry', 'qiangshu', 2000),
    T('Hill Axe', 'Qiang', 2, 'infantry', 'chuishu', 800), T('Hill Horse', 'Qiang', 3, 'cavalry', 'qiangshu', 1300)];
  const opt = { groups: ['Han'], caps: { cavalry: 1, infantry: 1 }, baseCap: 1, levelCaps: [0, 1, 2, 3], featureKeys: [], local: loc.map(t => t.name) };
  const ok = (t) => recruitCheck({ coin: 1e6, cost: t.cost, city: { ...cityOffer(t, opt, loc), tier: t.tier, base: 1, levelCaps: opt.levelCaps } });
  assert.deepStrictEqual(loc.map(t => ok(t).ok), [true, false, true, true], 'T4 is promotion only; a T3 nothing promotes into is a root');
  assert.strictEqual(ok(loc[1]).reason, 'Promotion only');
  assert.deepStrictEqual(promotionPaths(loc[0], loc).map(p => [p.t.name, p.kind, p.needFeatures.join()]), [['Steppe Heavy', 'promote', 'pastures']]);
  assert.deepStrictEqual(promotionPaths(T('Han Horse', 'Han', 2, 'cavalry', 'qiangshu', 900), [...loc, T('Han Heavy', 'Han', 4, 'cavalry', 'qiangshu', 2000)]).map(p => p.t.name), [], 'no tier skip outside frontier groups');
});

test('set links: Qiang foot units promote into the Qiang horse with Horse Pastures', async () => {
  const { promotionPaths, promotedInto } = await import('../module/promote.mjs');
  const q = [T('Qiang Warriors', 'Qiang', 2, 'infantry', 'chuishu', 800), T('Qiang Raiders', 'Qiang', 3, 'cavalry', 'daoshu', 1300)];
  assert.deepStrictEqual(promotionPaths(q[0], q).map(p => [p.t.name, p.kind, p.needFeatures.join()]), [['Qiang Raiders', 'promote', 'pastures']]);
  assert.strictEqual(promotedInto(q[1], q), true);
});

test('officer armies: home folder opens its own army once; aliases; never Han or frontier troops', async () => {
  const { homeArmies, freeGrants, grantFor } = await import('../module/officer-armies.mjs');
  const known = ['Han', 'Lordly', 'Song', 'Liu Bei', 'Qiang'];
  assert.deepStrictEqual(homeArmies('Lordly', known), ['Lordly']);
  assert.deepStrictEqual(homeArmies('Yuan Shao', known), ['Song']);
  assert.deepStrictEqual(homeArmies('Shu', known), ['Liu Bei']);
  assert.deepStrictEqual(homeArmies('Han', known), []);
  assert.deepStrictEqual(homeArmies('Qiang', known), []);
  assert.deepStrictEqual(homeArmies('Nobody', known), []);
  const offs = [{ uuid: 'A', name: 'Aide', armies: ['Lordly'] }, { uuid: 'B', name: 'Bo', armies: ['Song'] }, { uuid: 'C', name: 'Cy', armies: [] }];
  const free = freeGrants(offs, [{ via: 'B' }, { via: null }]);
  assert.deepStrictEqual(free.map(o => o.name), ['Aide'], 'Bo\'s unit already serves; Cy opens nothing');
  assert.strictEqual(grantFor('Lordly', free).uuid, 'A');
});

test('officer lock: only the opening officer may lead the unit', async () => {
  const { officerEligibility } = await import('../module/officer-rules.mjs');
  const saved = globalThis.game; const unit = { id: 'u1', getFlag: (s, k) => k === 'viaOfficer' ? 'Actor.off1' : null };
  globalThis.game = { actors: { get: (id) => id === 'u1' ? unit : null, contents: [] }, users: { contents: [] } };
  globalThis.fromUuidSync = (u) => ({ name: u === 'Actor.off1' ? 'Aide' : 'X' });
  try {
    assert.strictEqual(officerEligibility({ type: 'character', uuid: 'Actor.off2' }, {}, 'u1').reason, 'only Aide can lead it');
    assert.strictEqual(officerEligibility({ type: 'character', uuid: 'Actor.off1' }, {}, 'u1').ok, true);
  } finally { globalThis.game = saved; delete globalThis.fromUuidSync; }
});
