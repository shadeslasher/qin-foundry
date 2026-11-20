// Sima Yi (David, 2026-11-20): Fortify and Endure starts at Command +1 and goes up to +6; the Wolf also switches the
// target's battlefield passive off while it's locked ('noPassive' status).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';
import { validateSpec } from '../module/battle/skill-spec.mjs';
const HOST = { id: 'host', host: true };
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 3, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 3, move: 3, rangeMin: 1, rangeMax: 1 };
const PASSIVE = { mods: [{ stat: 'command', value: 1, who: { side: 'allies', range: 5 } }, { stat: 'command', value: 1, per: 'fortify', max: 5, who: { side: 'allies', range: 5 } }, { stat: 'meleeDef', value: 2, if: { holding: true } }, { stat: 'rangedDef', value: 2, if: { holding: true } }],
  triggers: [{ on: 'turnEnd', do: [{ if: { moved: true }, who: { self: true }, then: [{ counter: 'fortify', set: 0 }], else: [{ counter: 'fortify', add: 1, max: 5 }] }] }] };
const WOLF = { pick: [{ id: 'e', side: 'enemies', range: 'any', count: 1, filter: { allyAdjacent: false } }], do: [{ status: 'cantMoveOrAttack', who: { pick: 'e' }, for: { rounds: 2 } }, { status: 'noSkills', who: { pick: 'e' }, for: { rounds: 2 } }, { status: 'noPassive', who: { pick: 'e' }, for: { rounds: 2 } }, { buff: { mods: [{ stat: 'meleeDef', value: -5 }, { stat: 'rangedDef', value: -5 }] }, who: { pick: 'e' }, for: { rounds: 2 } }] };
const AURA = { mods: [{ stat: 'command', value: 3, who: { side: 'allies', range: 3, self: true } }] };
test('specs valid', () => { assert.deepStrictEqual(validateSpec(PASSIVE, 'passive'), []); assert.deepStrictEqual(validateSpec(WOLF, 'active'), []); });
function setup() {
  const s = R.newState(); s.map.cols = 12; s.map.rows = 6; s.map.tiles = {}; for (let x = 0; x < 12; x++) for (let y = 0; y < 6; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf);
  s.library.officers.push({ id: 'sy', name: 'Sima Yi', command: 5, fire: 3, skills: {}, passive: { effects: {} }, skill: { name: 'Wolf', text: 'x', moraleCost: 15, recharge: 5 }, battle: { passive: PASSIVE, active: WOLF, passiveName: 'Fortify', activeName: 'Wolf' } },
    { id: 'en', name: 'Enemy', command: 3, fire: 3, skills: {}, passive: { effects: {} }, battle: { passive: AURA, active: null, passiveName: 'Aura', activeName: '' } });
  const sy = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 1, y: 1, officerId: 'sy', morale: 90 }).unitId;
  const al = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'player', x: 2, y: 2, morale: 60 }).unitId;
  const en = R.act(s, HOST, { type: 'addUnit', typeId: 'inf', side: 'enemy', x: 10, y: 4, officerId: 'en', morale: 60 }).unitId;
  R.act(s, HOST, { type: 'startBattle' }); R.setRng(() => 0.3); R.act(s, HOST, { type: 'startRound' });
  return { s, sy: R.unitById(s, sy), al: R.unitById(s, al), en: R.unitById(s, en) };
}
const part = (s, u, name, role = 'attacker') => R.buildRoll(s, u, role, { attacker: u, defender: u }).parts.filter(p => p[0].includes(name)).reduce((a, p) => a + p[1], 0);
test('Fortify and Endure: +1 from the start', () => { const { s, al } = setup(); assert.strictEqual(part(s, al, 'Fortify'), 1); });
test('the Wolf switches the target passive off', () => {
  const { s, sy, en } = setup();
  assert.strictEqual(part(s, en, 'Aura'), 3);
  s.turn.activation = { unitId: sy.id, step: 'move', started: false, tilesMoved: 0, from: { x: 1, y: 1 } }; sy.round.activated = false;
  const r = R.act(s, HOST, { type: 'useSkill', unitId: sy.id, picks: { e: [en.id] } }); assert.ok(r.ok, r.error);
  assert.strictEqual(part(s, en, 'Aura'), 0, 'passive off while locked');
});
