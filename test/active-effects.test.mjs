// Active effects (David, 2026-11-09): what the stands animate and the Info window lists.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import * as SK from '../module/battle/skills.mjs';

const HOST = { id: 'host', host: true };
function must(res) { assert.ok(res.ok, res.error); return res; }
const inf = { id: 'inf', name: 'Inf', faction: 'X', tier: 2, category: 'infantry', weapon: 'melee', skill: 'Qiangshu', damage: 6, armor: 3, armorPen: 3, unitValue: 2, move: 3, rangeMin: 1, rangeMax: 1 };
const officer = (id, battle) => ({ id, name: 'Officer ' + id, command: 3, fire: 2, skills: {}, passive: { effects: {} }, skill: { name: 'Act', text: 'x', moraleCost: 10, recharge: 0 }, battle });
function setup(units, officers = []) {
  const s = R.newState(); s.players.p1 = { name: 'A' };
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  s.library.unitTypes.push(inf); s.library.officers.push(...officers);
  const ids = units.map(u => must(R.act(s, HOST, { type: 'addUnit', typeId: 'inf', owner: u.side === 'player' ? 'p1' : undefined, ...(u.officerId ? { morale: 80 } : {}), ...u })).unitId);
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.setRng(() => 0.3); must(R.act(s, HOST, { type: 'startRound' }));
  return { s, ids, u: (i) => R.unitById(s, ids[i]) };
}

test('skill buffs: an ally\'s Attack +3 is a buff, an enemy skill or a status is a debuff, with time left', () => {
  const { s, u } = setup([{ side: 'player', x: 1, y: 1 }, { side: 'player', x: 2, y: 1 }, { side: 'enemy', x: 6, y: 6 }]);
  SK.addBuff(s, u(0), u(1), 'Lightning March', { mods: [{ stat: 'attack', value: 3 }] }, { rounds: 3 });
  SK.addBuff(s, u(0), u(2), 'Stone Sentinel Maze', { status: 'cantMoveOrAttack' }, 'untilNextTurnEnd');
  SK.addBuff(s, u(0), u(0), 'Costly', { mods: [{ stat: 'skillCost', value: 5 }] }, 'battle');
  const fx = SK.effectsOf(s, u(0));
  assert.deepStrictEqual(fx.map(f => [f.name, f.kind]), [['Lightning March', 'buff'], ['Stone Sentinel Maze', 'debuff'], ['Costly', 'debuff']]);
  assert.strictEqual(fx[0].until, '3 turns left');
  assert.strictEqual(fx[1].until, 'until the end of its next turn');
  assert.ok(fx.every(f => !f.aura));
});

test('trait effects: Sunder+, Poison, Suppressing Fire show as debuffs', () => {
  const { s, u } = setup([{ side: 'player', x: 1, y: 1 }]);
  Object.assign(u(0).fx ||= {}, { sunder: 4, poison: 1, suppressed: true });
  const fx = SK.effectsOf(s, u(0));
  assert.deepStrictEqual(fx.map(f => [f.name, f.text.split(',')[0], f.kind]), [['Sundered', 'Armor −4', 'debuff'], ['Poisoned', 'Melee and ranged defense −1', 'debuff'], ['Suppressed', 'Attack −1', 'debuff']]);
  assert.strictEqual(fx[0].from, 'Sunder+');
});

test('passive auras are listed (aura: true) only while in range, as buffs from allies and debuffs from enemies', () => {
  const a = officer('a', { passiveName: 'Rally', passive: { mods: [{ stat: 'command', value: 2, who: { side: 'allies', range: 2 } }] } });
  const e = officer('e', { passiveName: 'Awe', passive: { mods: [{ stat: 'attack', value: -2, who: { side: 'enemies', range: 1 } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'player', x: 2, y: 2 }, { side: 'enemy', x: 3, y: 2, officerId: 'e' }, { side: 'player', x: 9, y: 9 }], [a, e]);
  const fx = SK.effectsOf(s, u(1));
  assert.deepStrictEqual(fx.map(f => [f.name, f.kind, f.aura]), [['Rally', 'buff', true], ['Awe', 'debuff', true]]);
  assert.strictEqual(SK.effectsOf(s, u(3)).length, 0, 'out of range');
  assert.ok(!SK.effectsOf(s, u(0)).some(f => f.name === 'Rally'), 'his own passive is not listed on his unit');
});

test('Sweep (Guan Yu): every other enemy in the 3x3 square around the attacker takes 5, ignoring armor; not the target, not allies, not farther away', () => {
  const { s, u } = setup([{ side: 'player', x: 5, y: 5 }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 4, y: 4 }, { side: 'enemy', x: 7, y: 5 }, { side: 'player', x: 5, y: 6 }]);
  SK.addBuff(s, u(0), u(0), 'Might That Shakes the Realm', { mods: [{ stat: 'attack', value: 4 }, { stat: 'enemyLoss', value: 3 }], flags: [{ flag: 'sweep:5' }, { flag: 'sweepMorale:5' }, { flag: 'cantBeSurrounded' }] }, { rounds: 3 });
  const men = [1, 2, 3, 4].map(i => u(i).men), morale = u(2).morale;
  SK.onAttack(s, u(0), u(1), { winner: null, casualtiesDefender: 0, casualtiesAttacker: 0 });
  assert.deepStrictEqual([1, 2, 3, 4].map((i, k) => men[k] - u(i).men), [0, 5, 0, 0]);
  assert.ok(u(2).morale <= morale - 8, 'a swept unit loses the sweep\'s 5 morale and his 3 extra');
  const fx = SK.effectsOf(s, u(0));
  assert.match(fx[0].text, /5 damage to every other enemy around it when it attacks/);
  assert.match(fx[0].text, /can't be surrounded/);
  assert.ok(SK.flag(s, u(0), 'cantBeSurrounded'), 'the engine sees it');
  assert.strictEqual(fx[0].kind, 'buff');
});

test('icons: always-on roll changes from skills are summed; conditional ones (if / vs) are left for the attack itself', () => {
  const a = officer('a', { passiveName: 'Rally', passive: { mods: [{ stat: 'command', value: 2, who: { side: 'allies', range: 2, self: true } }, { stat: 'attack', value: 2, vs: { category: 'cavalry' }, who: { self: true } }] } });
  const e = officer('e', { passiveName: 'Awe', passive: { mods: [{ stat: 'attack', value: -2, who: { side: 'enemies', range: 1 } }] } });
  const { s, u } = setup([{ side: 'player', x: 1, y: 1, officerId: 'a' }, { side: 'enemy', x: 2, y: 1, officerId: 'e' }], [a, e]);
  SK.addBuff(s, u(0), u(0), 'Might', { mods: [{ stat: 'attack', value: 4 }, { stat: 'commandDef', value: 1 }] }, { rounds: 3 });
  assert.deepStrictEqual(SK.alwaysOnRolls(s, u(0)), { command: 2, attack: 4 - 2, meleeDef: 1, rangedDef: 1 });
});

test('Sweep hit sounds: its own pick, else the Melee hit sounds', async () => {
  const S = await import('../module/sound.mjs');
  assert.deepStrictEqual(S.soundsFor('Sweep hit', { 'Melee hit': ['hit.ogg'] }, {}), ['hit.ogg']);
  assert.deepStrictEqual(S.soundsFor('Sweep hit', { 'Melee hit': ['hit.ogg'] }, { 'Sweep hit': ['clang.ogg'] }), ['clang.ogg']);
  assert.ok(S.MOMENTS.includes('Sweep hit'));
});

test('Lu Bu: a rout gives him another turn only on his own turn (myTurn)', () => {
  const lb = officer('l', { passiveName: 'Terror', passive: { triggers: [
    { on: 'kill', if: { myTurn: true }, do: [{ extraTurn: { self: true } }] },
    { on: 'enemyFalls', range: 1, if: { myTurn: true }, targetIf: { officer: false }, limit: 'turn', do: [{ extraTurn: { self: true } }] }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5, officerId: 'l' }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 4, y: 5 }], [lb]);
  // an enemy's turn: the enemy next to him routs (e.g. it attacked him and lost) — no extra turn
  s.turn.activation = { unitId: ids[1], step: 'move', started: true, tilesMoved: 0, from: { x: 6, y: 5 } };
  u(1).morale = 0; u(1).status = 'routed'; SK.onFall(s, u(1));
  assert.ok(!(s.skillExtra || []).some(e => e.unitId === ids[0]), 'not on an enemy turn');
  // his own turn: the other enemy next to him routs — another turn
  s.turn.activation = { unitId: ids[0], step: 'move', started: true, tilesMoved: 0, from: { x: 5, y: 5 } };
  u(2).morale = 0; u(2).status = 'routed'; SK.onFall(s, u(2));
  assert.ok((s.skillExtra || []).some(e => e.unitId === ids[0]), 'on his own turn');
  assert.ok(s.log.some(l => l.detail?.extraTurn && l.detail.unit === ids[0] && l.detail.skill === 'Terror'), 'logged for the ANOTHER TURN animation');
});

test('Lu Bu: end-of-turn terror — officerless units lose 5 morale, units with an officer roll a contested Command roll', () => {
  const lb = officer('l', { passiveName: 'Terror', passive: { triggers: [
    { on: 'turnEnd', do: [{ contest: { side: 'enemies', range: 1 }, lose: [{ morale: -5, who: { target: true } }] }] }] } });
  const strong = { ...officer('s'), command: 12 }, weak = { ...officer('w'), command: 0 };
  const { s, u } = setup([{ side: 'player', x: 5, y: 5, officerId: 'l' }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 4, y: 5, officerId: 's' }, { side: 'enemy', x: 5, y: 6, officerId: 'w' }, { side: 'enemy', x: 8, y: 8 }], [lb, strong, weak]);
  const before = [1, 2, 3, 4].map(i => u(i).morale);
  SK.onActivationEnd(s, u(0));
  assert.strictEqual(u(1).morale, before[0] - 5, 'no officer: loses 5');
  assert.strictEqual(u(2).morale, before[1], 'officer wins the roll: no loss');
  assert.strictEqual(u(3).morale, before[2] - 5, 'officer loses the roll: loses 5');
  assert.strictEqual(u(4).morale, before[3], 'not adjacent');
  assert.ok(s.log.some(l => /has no officer to resist/.test(l.text || l.msg || JSON.stringify(l))));
  // the animation groups these by the passive that rolled them
  const c = s.log.filter(l => l.detail?.type === 'skillContest');
  assert.ok(c.length === 3 && c.every(l => l.detail.src === u(0).id && l.detail.skill === 'Terror'));
});

test('Lu Bu: an enemy his attack breaks surrenders when his turn ends — another turn (David, 2026-11-09)', () => {
  const lb = officer('l', { passiveName: 'Terror', passive: { triggers: [
    { on: 'turnEnd', do: [{ contest: { side: 'enemies', range: 1 }, lose: [{ morale: -5, who: { target: true } }] }] },
    { on: 'enemyFalls', range: 99, if: { myTurn: true }, limit: 'turn', do: [{ extraTurn: { self: true } }] }] } });
  const { s, u, ids } = setup([{ side: 'player', x: 5, y: 5, officerId: 'l' }, { side: 'enemy', x: 6, y: 5 }, { side: 'enemy', x: 10, y: 10 }], [lb]);
  u(1).morale = 12;
  R.setRng(() => 0.9);
  s.turn.activation = { unitId: ids[0], step: 'move', started: true, tilesMoved: 0, from: { x: 5, y: 5 } };
  must(R.act(s, HOST, { type: 'attack', unitId: ids[0], targetId: ids[1] }));
  assert.notStrictEqual(u(1).status, 'active');
  assert.ok(s.log.some(l => /takes another turn/.test(l.text)), 'he takes another turn');
});
