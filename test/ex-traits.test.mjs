import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function dice(values) { const q = values.slice(); R.setRng(() => (q.length ? q.shift() : 0) / 10 + 0.001); }
function must(res) { assert.ok(res.ok, res.error); return res; }
function setup() { const s = R.newState(); s.players.p1 = { name: 'Alice' }; return s; }
function add(s, o) { return must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId; }
function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
function plains(s, special = {}) {
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  Object.assign(s.map.tiles, special);
}
/** Player unit at (5,5) attacks an enemy at (5,4). setupFn(a, d, s) runs before the battle starts. */
function duel(aType, dType, rolls, setupFn, extra = [], beforeAttack) {
  const s = setup();
  s.library.unitTypes.push(aType, dType, ...extra.map(e => e.type));
  const a = add(s, { typeId: aType.id, side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: dType.id, side: 'enemy', x: 5, y: 4 });
  for (const e of extra) e.id = add(s, { typeId: e.type.id, side: e.side, x: e.x, y: e.y, owner: e.side === 'player' ? 'p1' : undefined });
  if (setupFn) setupFn(R.unitById(s, a), R.unitById(s, d), s);
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  if (beforeAttack) beforeAttack(R.unitById(s, a), R.unitById(s, d), s);
  dice(rolls);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  return { s, A: R.unitById(s, a), D: R.unitById(s, d), r };
}
const part = (roll, re) => roll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);
const traits = (o) => (u) => { u.traitTiers = o; };
import { traitTiersOf } from '../module/battle/traits.mjs';

// David, 2026-10-29: EX tiers, Splash Attack++, Sunder++, Anti-Cavalry attacking cavalry, Charge Reflection cavalry-only
test('"Name EX" parses as tier 4 of Name', () => {
  const t = traitTiersOf('Disciplined EX\nCharging Strike EX - Attack +8\nEvasion EX');
  assert.strictEqual(t.disciplined, 4); assert.strictEqual(t['charging strike'], 4); assert.strictEqual(t.evasion, 4);
  assert.strictEqual(R.evasionOf({ traitTiers: t }), 70);
  assert.strictEqual(R.disciplinedBonus({ traitTiers: t }), 20);
});

test('Disciplined EX: no morale loss from casualties', () => {
  const u = { men: 100, maxMen: 100, fx: {}, traitTiers: { disciplined: 4 } };
  u.men = 39; assert.strictEqual(R.checkpointMorale(u), 0);
});

test('Charging Strike EX: Attack +8 after moving a single tile', () => {
  const s = setup(); plains(s); s.library.unitTypes.push(unitType('a'), unitType('d'));
  const a = add(s, { typeId: 'a', side: 'player', owner: 'p1', x: 5, y: 6 }), d = add(s, { typeId: 'd', side: 'enemy', x: 5, y: 4 });
  R.unitById(s, a).traitTiers = { 'charging strike': 4 };
  must(R.act(s, HOST, { type: 'startBattle' })); dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'move', unitId: a, x: 5, y: 5 }));
  dice([3, 0, 0, 0]); must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.strictEqual(part(r.attackRoll, /^Charging Strike/), 8);
});

test('Anti-Cavalry: Attack +1/+2/+3 on its own attacks against cavalry, nothing against infantry', () => {
  for (const [tier, want] of [[1, 1], [2, 2], [3, 3]]) {
    const { r } = duel(unitType('a'), unitType('d', { category: 'cavalry' }), [3, 0, 0, 0], traits({ 'anti-cavalry': tier }));
    assert.strictEqual(part(r.attackRoll, /^Anti-Cavalry: attacking/), want);
  }
  const { r } = duel(unitType('a'), unitType('d'), [3, 0, 0, 0], traits({ 'anti-cavalry': 3 }));
  assert.strictEqual(part(r.attackRoll, /^Anti-Cavalry/), 0);
});

test('Sunder++ lowers armor by 6', () => {
  const { D } = duel(unitType('a'), unitType('d'), [9, 0, 0, 0], traits({ sunder: 3 }));
  assert.strictEqual(D.fx.sunder, 6);
});

test('Splash Attack++: 6 casualties to each other enemy next to the defender', () => {
  const { s, r } = duel(unitType('a', { damage: 9 }), unitType('d', { armor: 0 }), [9, 0, 0, 0], traits({ 'splash attack': 3 }),
    [{ type: unitType('e', { armor: 0 }), side: 'enemy', x: 4, y: 4 }]);
  const sp = s.log.filter(e => e.detail && e.detail.type === 'splash').pop();
  assert.ok(sp, 'splash logged'); assert.strictEqual(sp.detail.casualties, 6);
});

test('Anti-Cavalry attack bonus is melee only', () => {
  const { r } = duel(unitType('a', { weapon: 'ranged', rangeMax: 3 }), unitType('d', { category: 'cavalry' }), [3, 0, 0, 0], traits({ 'anti-cavalry': 3 }));
  assert.strictEqual(part(r.attackRoll, /^Anti-Cavalry/), 0);
});

test('Throwing Axes: a range-2 unit fights adjacent enemies in melee without the Hybrid Attack -2', () => {
  const ax = duel(unitType('a', { weapon: 'ranged', rangeMax: 2 }), unitType('d'), [3, 0, 0, 0], traits({ 'throwing axes': 1 }));
  assert.strictEqual(ax.r.ranged, false, 'adjacent attack is melee');
  assert.strictEqual(part(ax.r.attackRoll, /^Hybrid/), 0);
  const hy = duel(unitType('a', { weapon: 'ranged', rangeMax: 2 }), unitType('d'), [3, 0, 0, 0], traits({ hybrid: 1 }));
  assert.strictEqual(part(hy.r.attackRoll, /^Hybrid/), -2);
});

test('Shields add 15% Evasion per level; the unit takes the Evasion step the total reaches; Shield Breaker ignores it', () => {
  const ev = (t, b) => R.evasionOf({ traitTiers: t }, b);
  assert.strictEqual(ev({ shielded: 1 }), 0, 'Shielded alone (15) reaches nothing');
  assert.strictEqual(ev({ shielded: 2 }), 25, 'Shielded+ alone (30) = Evasion');
  assert.strictEqual(ev({ shielded: 3 }), 40, 'Shielded++ alone (45) = Evasion+');
  assert.strictEqual(ev({ evasion: 1, shielded: 1 }), 40, 'Evasion + Shielded = Evasion+');
  assert.strictEqual(ev({ evasion: 2, shielded: 2 }), 70, 'Evasion+ + Shielded+ = Evasion EX');
  assert.strictEqual(ev({ evasion: 3, shielded: 3 }), 70, 'capped at Evasion EX');
  assert.strictEqual(ev({ evasion: 1, shielded: 3 }, true), 25, 'Shield Breaker: only the unit\'s own Evasion');
});
