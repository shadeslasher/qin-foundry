// ignoreArmor flag (Guan Yu, David 2026-11-19): all of the unit's damage ignores armor, its strike back included.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const HOST = { id: 'host', host: true };
const heavy = { id: 'hv', name: 'Heavy', faction: 'X', tier: 3, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 8, armor: 10, armorPen: 2, unitValue: 3, move: 3, rangeMin: 1, rangeMax: 1 };
const off = (id, passive) => ({ id, name: id, command: 0, fire: 0, skills: {}, passive: { effects: {} }, battle: passive ? { passive, active: null, passiveName: 'x', activeName: '' } : null });
function fight(flagA, flagB) {
  const s = R.newState(); s.map.cols = 6; s.map.rows = 3; s.map.tiles = {}; for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(heavy); s.library.officers.push(off('A', flagA ? { flags: [{ flag: 'ignoreArmor' }] } : null), off('B', flagB ? { flags: [{ flag: 'ignoreArmor' }] } : null));
  const a = R.act(s, HOST, { type: 'addUnit', typeId: 'hv', side: 'player', x: 2, y: 1, officerId: 'A', morale: 90 }).unitId;
  const b = R.act(s, HOST, { type: 'addUnit', typeId: 'hv', side: 'enemy', x: 3, y: 1, officerId: 'B', morale: 90 }).unitId;
  R.act(s, HOST, { type: 'startBattle' });
  const vals = [0.95, 0.05, 0.05, 0.05]; let i = 0; R.setRng(() => vals[i++ % vals.length]);
  return R.resolveAttack(s, R.unitById(s, a), R.unitById(s, b), { movedThisActivation: false, tilesMoved: 0 });
}
test('spec valid', () => assert.deepStrictEqual(validateSpec({ flags: [{ flag: 'ignoreArmor' }] }, 'passive'), []));
test('the attacker\'s hit ignores armor; the defender\'s strike back ignores armor only if it has the flag too', () => {
  const plain = fight(false, false), a = fight(true, false), both = fight(true, true);
  assert.ok(a.casualtiesDefender > plain.casualtiesDefender, `armor ignored: ${a.casualtiesDefender} > ${plain.casualtiesDefender}`);
  assert.strictEqual(a.casualtiesAttacker, plain.casualtiesAttacker);
  assert.ok(both.casualtiesAttacker > plain.casualtiesAttacker, 'strike back ignores armor');
});

test('ignoreEvasion: evasive defenders take full melee casualties', () => {
  const ev = { ...heavy, id: 'ev', armor: 0 };
  const go = (flag) => {
    const s = R.newState(); s.map.cols = 6; s.map.rows = 3; s.map.tiles = {}; for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
    s.library.unitTypes.push(heavy, ev); s.library.officers.push(off('A', flag ? { flags: [{ flag: 'ignoreEvasion' }] } : null), off('B', null));
    const a = R.act(s, HOST, { type: 'addUnit', typeId: 'hv', side: 'player', x: 2, y: 1, officerId: 'A', morale: 90 }).unitId;
    const b = R.act(s, HOST, { type: 'addUnit', typeId: 'ev', side: 'enemy', x: 3, y: 1, officerId: 'B', morale: 90 }).unitId;
    R.unitById(s, b).traitTiers = { evasion: 3 };
    R.act(s, HOST, { type: 'startBattle' });
    const vals = [0.95, 0.05, 0.05, 0.05]; let i = 0; R.setRng(() => vals[i++ % vals.length]);
    return R.resolveAttack(s, R.unitById(s, a), R.unitById(s, b), { movedThisActivation: false, tilesMoved: 0 }).casualtiesDefender;
  };
  assert.ok(go(true) > go(false), `${go(true)} > ${go(false)}`);
});
