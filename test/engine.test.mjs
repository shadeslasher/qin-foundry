import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
const P2 = { id: 'p2', host: false };

// Dice queue: each d10 call pops the next value (then falls back to 0).
function dice(values) { const q = values.slice(); R.setRng(() => (q.length ? q.shift() : 0) / 10 + 0.001); }

function must(res) { assert.ok(res.ok, res.error); return res; }

function setup() {
  const s = R.newState();
  s.players.p1 = { name: 'Alice' }; s.players.p2 = { name: 'Bob' };
  return s;
}
function add(s, o) { return must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId; }

test('melee: winner deals damage + difference, loser deals base; casualties minus defense; morale loss', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 5 });   // dmg 6 def 3 UV 2
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 4 });               // dmg 6 def 3 UV 2
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));            // no officers: straight to officer-less
  assert.strictEqual(R.prompt(s).kind, 'claim');
  must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  // Attacker: yy (7-2)=5 + UV2 + attacker 2 = 9. Defender: yy (0-0)=0 + UV2 = 2. diff 7.
  dice([7, 2, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const A = R.unitById(s, a), D = R.unitById(s, d);
  assert.strictEqual(D.men, 100 - (6 + 7 - 3));   // 90
  assert.strictEqual(A.men, 100 - (6 - 3));       // 97
  assert.strictEqual(D.morale, 50 - 7);
  assert.strictEqual(A.morale, 50);
});

test('officer-less units count Command, Fire and Skill as 0; officer adds them', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'wen_ping', side: 'player', owner: 'p1', x: 2, y: 2 });
  const d = add(s, { typeId: 'yt_spearmen', side: 'enemy', x: 3, y: 2 });
  const A = R.unitById(s, a), D = R.unitById(s, d);
  dice([0, 0, 0, 0]);
  const rA = R.buildRoll(s, A, 'attacker', { attacker: A, defender: D });
  const rD = R.buildRoll(s, D, 'defender', { attacker: A, defender: D });
  assert.strictEqual(rA.total, 0 + 4 + 3 + 4 + 2 + 2);  // yy, Command 4, Fire 3, Qiangshu 4, UV 2, attacker +2
  assert.strictEqual(rD.total, 2);                      // UV only
});

test('ranged: attacker deals damage only on a win; melee defender out of reach returns nothing', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_archers', side: 'player', owner: 'p1', x: 5, y: 8 }); // dmg 3 def 2
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 6 });              // 2 tiles away
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'skipMove', unitId: a }));
  dice([0, 0, 9, 0]); // attacker 0+2+2=4, defender 9+2=11 -> defender wins
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  assert.strictEqual(R.unitById(s, d).men, 100);
  assert.strictEqual(R.unitById(s, a).men, 100);
  assert.strictEqual(R.unitById(s, a).morale, 50 - 7);
});

test('ranged attacker loses +2 after moving; ranged defender returns fire', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_archers', side: 'player', owner: 'p1', x: 5, y: 9 });
  const d = add(s, { typeId: 'yt_archers', side: 'enemy', x: 5, y: 6 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'move', unitId: a, x: 5, y: 8 }));
  dice([5, 0, 0, 0]); // attacker 5+2+0 = 7 (no +2), defender 0+2 = 2: diff 5
  const res = must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const log = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.strictEqual(log.attackRoll.total, 7);
  assert.strictEqual(R.unitById(s, d).men, 100 - (3 + 5 - 2));
  assert.strictEqual(R.unitById(s, a).men, 100 - (3 - 2)); // ranged defender returns base damage
});

test('cavalry charge: +1 per 2 tiles moved, no morale multiplier (rear neither)', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: 2 });
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  assert.strictEqual(R.unitById(s, d).facing, null, 'no facing at the start');
  R.unitById(s, d).facing = { dx: 0, dy: 1 }; // turned away from the cavalry
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 5, y: 4 })); // 2 tiles -> +1
  dice([3, 0, 0, 0]); // A: 3+2+2(att)+1(charge)+2(rear)=10, D: 0+2=2 -> diff 8
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.ok(r.charge && r.rear);
  assert.ok(r.attackRoll.parts.some(([l, v]) => /Cavalry charge \(2 tiles/.test(l) && v === 1));
  assert.ok(!r.defendRoll.parts.some(([l]) => /charg/i.test(l)), 'no defender penalty');
  assert.strictEqual(r.diff, 8);
  assert.strictEqual(R.unitById(s, d).morale, Math.max(0, 50 - 8), 'neither the rear attack nor the charge multiplies morale loss');
});

test('cavalry charge scales with distance; one tile is no charge', () => {
  for (const [startY, bonus] of [[0, 2], [3, 0]]) {
    const s = setup();
    const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: startY });
    const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
    must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
    must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
    s.freeMovement = false;
    must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 5, y: 4 }));
    dice([3, 0, 0, 0]);
    must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
    const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
    const part = r.attackRoll.parts.find(([l]) => /Cavalry charge/.test(l));
    assert.strictEqual(part ? part[1] : 0, bonus);
    assert.strictEqual(r.charge, bonus > 0);
  }
});

test('Fierce Charge tiers', () => {
  const run = (fierce, startY, rearFacing = false) => {
    const s = setup();
    const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: startY });
    const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
    R.unitById(s, a).fierceCharge = fierce;
    must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
    if (rearFacing) R.unitById(s, d).facing = { dx: 0, dy: 1 };
    must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
    s.freeMovement = false;
    must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 5, y: 4 }));
    dice([3, 0, 0, 0]);
    must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
    const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
    const sum = (re) => r.attackRoll.parts.filter(([l]) => re.test(l)).reduce((t, [, v]) => t + v, 0);
    return { r, charge: sum(/Cavalry charge/), fierceFlat: sum(/^Fierce Charge$/), morale: R.unitById(s, d).morale };
  };
  let x = run(1, 2); // 2 tiles: +1 distance, +1 Fierce Charge
  assert.strictEqual(x.charge, 1); assert.strictEqual(x.fierceFlat, 1);
  x = run(1, 3); // 1 tile: no charge, so no Fierce Charge either
  assert.strictEqual(x.charge, 0); assert.strictEqual(x.fierceFlat, 0);
  x = run(2, 1); // 3 tiles at +1 per tile
  assert.strictEqual(x.charge, 3); assert.strictEqual(x.fierceFlat, 0);
  x = run(2, 3); // 1 tile is a charge for Fierce Charge+
  assert.strictEqual(x.charge, 1); assert.ok(x.r.charge);
  const plain = run(2, 1), dbl = run(3, 1); // same roll; ++ doubles the morale loss
  assert.strictEqual(dbl.charge, 3);
  assert.strictEqual(50 - dbl.morale, Math.min(50, 2 * (50 - plain.morale)));
  const rear = run(3, 1, true); // rear adds nothing: Fierce Charge++ alone, x2
  assert.strictEqual(50 - rear.morale, Math.min(50, 2 * rear.r.diff));
});

test('encirclement from a move waits until the move is committed (undo leaves morale alone)', () => {
  const s = setup();
  // enemy at (5,5) with a wall of player units on three sides; the fourth side gets closed by the mover
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  for (const [x, y] of [[4, 5], [6, 5], [5, 4]]) add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x, y });
  const m = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 8 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  const start = R.unitById(s, d).morale;
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: m }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: m, x: 5, y: 6 }));
  assert.strictEqual(R.unitById(s, d).morale, start, 'not applied yet');
  must(R.act(s, P1, { type: 'undoMove', unitId: m }));
  assert.strictEqual(R.unitById(s, d).morale, start, 'undo: nothing to give back');
  must(R.act(s, P1, { type: 'moveTo', unitId: m, x: 5, y: 6 }));
  must(R.act(s, P1, { type: 'holdPosition', unitId: m }));
  assert.ok(R.unitById(s, d).morale <= Math.max(0, start - 50), 'hold commits the move: -50');
  assert.ok(R.unitById(s, d).surrounded);
});

test('only Player units earn XP', () => {
  const s = setup();
  const p = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 4 });
  const e = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: p }));
  dice([5, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: p, targetId: e }));
  const r = s.log.filter(x => x.detail && x.detail.type === 'attack').pop().detail.result;
  assert.ok(r.xpAttacker > 0, 'player unit earns XP');
  assert.strictEqual(r.xpDefender, 0, 'enemy unit earns none');
  assert.strictEqual(R.unitById(s, e).xp || 0, 0);
});

test('strength penalties follow the soldier figures: 2 left -1, 1 left -2 (cavalry of 50)', () => {
  const pen = (men, maxMen, typeId = 'han_ji_inf') => {
    const s = setup();
    const p = add(s, { typeId, side: 'player', owner: 'p1', x: 5, y: 4 });
    const e = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
    Object.assign(R.unitById(s, p), { men, maxMen });
    must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
    must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: p }));
    dice([3, 0, 3, 0]);
    must(R.act(s, P1, { type: 'attack', unitId: p, targetId: e }));
    const r = s.log.filter(x => x.detail && x.detail.type === 'attack').pop().detail.result;
    return r.attackRoll.parts.filter(([l]) => /soldier/.test(l)).reduce((t, [, v]) => t + v, 0);
  };
  assert.strictEqual(pen(100, 100), 0);
  assert.strictEqual(pen(41, 100), 0, '3 soldiers: no penalty');
  assert.strictEqual(pen(40, 100), -1);
  assert.strictEqual(pen(21, 100), -1);
  assert.strictEqual(pen(20, 100), -2);
  assert.strictEqual(pen(1, 100), -2);
  assert.strictEqual(pen(20, 50), -1, 'cavalry: 20 of 50 is 2 soldiers');
  assert.strictEqual(pen(10, 50), -2);
});

test('Hold gives +2 melee defense only, not against ranged', () => {
  const s = setup();
  const h = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 5 });
  const m = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 6 });
  const r = add(s, { typeId: 'yt_archers', side: 'enemy', x: 5, y: 8 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  R.unitById(s, h).round.holding = true;
  const roll = (att) => { const A = R.unitById(s, att), D = R.unitById(s, h); const ranged = R.typeOf(s, A).weapon === 'ranged';
    return R.buildRoll(s, D, 'defender', { attacker: A, defender: D, ranged, charge: false, rear: false, ambush: false }).parts.filter(([l]) => /Holding/.test(l)).reduce((t, [, v]) => t + v, 0); };
  assert.strictEqual(roll(m), 2, '+2 melee defense');
  assert.strictEqual(roll(r), 0);
});

test('formation attack modifiers, charge cancelling, extra rear bonus', () => {
  const s = setup();
  s.library.formations.push(
    { id: 'lz', name: 'Loose', defRanged: 3, defMelee: -2, atkMod: -1 },
    { id: 'sw', name: 'Spear Wall', moveMod: -1, defMelee: 3, noChargeBonus: true, defRanged: -2, rearAtk: 2 });
  const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: 1 });
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  R.unitById(s, a).formation = 'lz';
  R.unitById(s, d).formation = 'sw';
  R.typeOf(s, R.unitById(s, a)).formations = null; R.typeOf(s, R.unitById(s, d)).formations = null;
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  R.unitById(s, d).facing = { dx: 0, dy: 1 }; // facing away: the cavalry hits its rear
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 5, y: 4 }));
  dice([3, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  const has = (roll, re, v) => roll.parts.some(([l, x]) => re.test(l) && x === v);
  assert.ok(has(r.attackRoll, /^Attack \(Loose\)/, -1), 'Loose: attack -1 when attacking');
  assert.ok(!r.charge && has(r.attackRoll, /cancelled/, 0), 'Spear Wall cancels the charge bonus');
  assert.ok(has(r.attackRoll, /^Rear attack$/, 2) && has(r.attackRoll, /^Rear attack vs Spear Wall/, 2), 'rear +2 and +2 more');
  assert.ok(has(r.defendRoll, /^Melee defense \(Spear Wall\)/, 3));
  // when the Loose unit defends, its attack -1 doesn't count
  const D = R.buildRoll(s, R.unitById(s, a), 'defender', { attacker: R.unitById(s, d), defender: R.unitById(s, a), ranged: false });
  assert.ok(!D.parts.some(([l]) => /^Attack/.test(l)));
});

test('Wedge: winning attacker may move next to the enemy, or stay', () => {
  const s = setup();
  s.library.formations.push({ id: 'wd', name: 'Wedge', defAll: -2, winReposition: true });
  const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: 4 });
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  R.unitById(s, a).formation = 'wd'; R.typeOf(s, R.unitById(s, a)).formations = null;
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  dice([9, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  assert.strictEqual(s.turn.activation.step, 'reposition');
  assert.ok(!R.act(s, P1, { type: 'reposition', unitId: a, x: 9, y: 9 }).ok, 'only the offered tiles');
  must(R.act(s, P1, { type: 'reposition', unitId: a, x: 6, y: 5 }));
  assert.deepStrictEqual([R.unitById(s, a).x, R.unitById(s, a).y], [6, 5]);
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== a, 'turn over');
});

test('initiative: officers first, hold, interject chain, officer-less alternation, final pass', () => {
  const s = setup();
  const o1 = add(s, { typeId: 'han_ji_inf', officerId: 'xu_chu', side: 'player', owner: 'p1', x: 1, y: 1 });
  const o2 = add(s, { typeId: 'han_ji_inf', officerId: 'han_dang', side: 'player', owner: 'p2', x: 3, y: 1 });
  const e1 = add(s, { typeId: 'yt_warriors', officerId: 'wen_ping', side: 'enemy', x: 10, y: 10 });
  const g1 = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 1, y: 5 });
  const g2 = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p2', x: 3, y: 5 });
  const eg = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 10, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  // initiative yy pairs in unit order o1, o2, e1 (+ tiebreak draws in between)
  dice([9, 0, 0, /* o1: 9+3=12 */ 6, 0, 0, /* o2: 6+3=9 */ 0, 0, 0 /* e1: 0+3=3 */]);
  must(R.act(s, HOST, { type: 'startRound' }));
  assert.deepStrictEqual(s.turn.order, [o1, o2, e1]);
  assert.strictEqual(R.prompt(s).unitId, o1);
  must(R.act(s, P1, { type: 'decide', unitId: o1, choice: 'hold' }));
  must(R.act(s, P2, { type: 'decide', unitId: o2, choice: 'hold' }));
  assert.strictEqual(R.prompt(s).unitId, e1);
  // e1 chooses to act, but before it starts, o2 interjects, then o1 interjects on o2
  must(R.act(s, HOST, { type: 'decide', unitId: e1, choice: 'act' }));
  must(R.act(s, P2, { type: 'interject', unitId: o2 }));
  must(R.act(s, P1, { type: 'interject', unitId: o1 }));
  assert.strictEqual(s.turn.activation.unitId, o1);
  assert.ok(s.turn.held.includes(o2), 'o2 goes back to holding');
  must(R.act(s, P1, { type: 'endTurn', unitId: o1 }));
  assert.strictEqual(R.prompt(s).unitId, e1); // back to e1's decision; o2 still held
  must(R.act(s, HOST, { type: 'decide', unitId: e1, choice: 'act' }));
  must(R.act(s, HOST, { type: 'endTurn', unitId: e1 }));
  // officer-less: player side first, claim buttons
  assert.strictEqual(R.prompt(s).kind, 'claim');
  assert.ok(!R.act(s, HOST, { type: 'begin', unitId: eg }).ok);
  must(R.act(s, P2, { type: 'claim' }));
  assert.ok(!R.act(s, P1, { type: 'claim' }).ok, 'first come first served');
  must(R.act(s, P2, { type: 'begin', unitId: g2 }));
  must(R.act(s, P2, { type: 'endTurn', unitId: g2 }));
  // enemy side next
  assert.strictEqual(R.prompt(s).kind, 'host-pick');
  // held officer interjects between officer-less turns
  must(R.act(s, P2, { type: 'interject', unitId: o2 }));
  must(R.act(s, P2, { type: 'endTurn', unitId: o2 }));
  assert.strictEqual(R.prompt(s).kind, 'host-pick');
  must(R.act(s, HOST, { type: 'begin', unitId: eg }));
  must(R.act(s, HOST, { type: 'endTurn', unitId: eg }));
  assert.strictEqual(R.prompt(s).kind, 'claim');
  must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: g1 }));
  must(R.act(s, P1, { type: 'endTurn', unitId: g1 }));
  // nothing held -> round over
  assert.strictEqual(s.turn.phase, 'formations');
  assert.strictEqual(s.turn.round, 2);
});

test('final pass: held officers act or forfeit, lowest initiative first', () => {
  const s = setup();
  const o1 = add(s, { typeId: 'han_ji_inf', officerId: 'xu_chu', side: 'player', owner: 'p1', x: 1, y: 1 });
  const o2 = add(s, { typeId: 'han_ji_inf', officerId: 'han_dang', side: 'player', owner: 'p2', x: 3, y: 1 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([9, 0, 0, 6, 0, 0]);
  must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'decide', unitId: o1, choice: 'hold' }));
  must(R.act(s, P2, { type: 'decide', unitId: o2, choice: 'hold' }));
  const p = R.prompt(s);
  assert.strictEqual(p.kind, 'final'); assert.strictEqual(p.unitId, o2);
  must(R.act(s, P2, { type: 'decide', unitId: o2, choice: 'forfeit' }));
  assert.strictEqual(R.prompt(s).unitId, o1);
  must(R.act(s, P1, { type: 'decide', unitId: o1, choice: 'act' }));
  must(R.act(s, P1, { type: 'endTurn', unitId: o1 }));
  assert.strictEqual(s.turn.phase, 'formations');
});

test('end-of-turn regen up to 75; kill morale can exceed 75 up to 100', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'wen_ping', side: 'player', owner: 'p1', x: 5, y: 5, morale: 70 });
  const d = add(s, { typeId: 'han_peasant_spear', side: 'enemy', x: 5, y: 4 });
  R.unitById(s, d).men = 1;
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'decide', unitId: a, choice: 'act' }));
  dice([5, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  assert.strictEqual(R.unitById(s, d).status, 'defeated');
  // 70 + 5 (tier 1 kill) = 75, regen stops at 75
  assert.strictEqual(R.unitById(s, a).morale, 75);
  R.unitById(s, a).morale = 98;
  R.unitById(s, a).morale += 0;
});

test('demoralized penalty, Han Dang ignores it; surrender at 0 morale costs adjacent allies 5', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'han_dang', side: 'player', owner: 'p1', x: 5, y: 5, morale: 20 });
  const b = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 6, y: 5, morale: 20 });
  const e = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 4 });
  const A = R.unitById(s, a), B = R.unitById(s, b), E = R.unitById(s, e);
  dice([0, 0, 0, 0]);
  assert.strictEqual(R.buildRoll(s, A, 'defender', { attacker: E, defender: A }).total, 0 + 4 + 3 + 0 + 2); // no -2
  assert.strictEqual(R.buildRoll(s, B, 'defender', { attacker: E, defender: B }).total, 2 - 2);
  must(R.act(s, HOST, { type: 'adjust', unitId: a, morale: -20 }));
  assert.strictEqual(A.status, 'surrendered');
  assert.strictEqual(B.morale, 15);
});

test('full encirclement: -50 morale once', () => {
  const s = setup();
  const u = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 5, morale: 70 });
  add(s, { typeId: 'yt_warriors', side: 'enemy', x: 4, y: 5 });
  add(s, { typeId: 'yt_warriors', side: 'enemy', x: 6, y: 5 });
  add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 4 });
  const last = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 9, y: 9 });
  must(R.act(s, HOST, { type: 'place', unitId: last, x: 5, y: 6 }));
  assert.strictEqual(R.unitById(s, u).morale, 20);
  must(R.act(s, HOST, { type: 'adjust', unitId: u, men: -1 }));
  assert.strictEqual(R.unitById(s, u).morale, 20, 'not applied twice');
});

test('stealth: forests hide; hidden units stay unseen by other sides until revealed', () => {
  const s = setup();
  must(R.act(s, HOST, { type: 'paintTerrain', cells: [[2, 2]], terrain: 'trees' }));
  const e = add(s, { typeId: 'yt_warriors', officerId: 'wen_ping', side: 'enemy', x: 2, y: 3 });
  const p = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 10, y: 10 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, HOST, { type: 'decide', unitId: e, choice: 'act' }));
  must(R.act(s, HOST, { type: 'move', unitId: e, x: 2, y: 2 }));
  must(R.act(s, HOST, { type: 'endTurn', unitId: e }));
  const E = R.unitById(s, e);
  assert.ok(!E.hidden, 'not until the round ends');
  for (let i = 0; i < 10 && s.turn.round === 1; i++) R.act(s, HOST, { type: 'skipPrompt' });
  assert.ok(E.hidden, 'in the forest when the round ended');
  assert.ok(!R.visibleTo(s, E, 'player'));
  assert.ok(!R.visibleTo(s, E, 'neutral'));
  assert.strictEqual(R.viewFor(s, P1).units.find(u => u.id === e), undefined);
  R.unitById(s, p).x = 3; R.unitById(s, p).y = 2; // a player unit right next to it doesn't spot it by itself
  assert.ok(!R.visibleTo(s, E, 'player'));
  // a hidden ally is still seen by players
  assert.ok(R.visibleTo(s, { side: 'ally', hidden: true }, 'player'));
  // the GM can reveal it
  must(R.act(s, HOST, { type: 'setHidden', unitId: e, hidden: false }));
  assert.ok(R.visibleTo(s, E, 'player'));
  assert.ok(!R.act(s, P1, { type: 'setHidden', unitId: e, hidden: true }).ok, 'GM only');
});

test('stealth: ending a turn next to a hostile unit reveals; Player and Ally do not reveal each other', () => {
  const s = setup();
  const e = add(s, { typeId: 'yt_warriors', officerId: 'wen_ping', side: 'enemy', x: 5, y: 5 });
  add(s, { typeId: 'han_ji_inf', side: 'ally', x: 5, y: 4 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  R.unitById(s, e).hidden = true;
  dice([0, 0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, HOST, { type: 'decide', unitId: e, choice: 'act' }));
  must(R.act(s, HOST, { type: 'endTurn', unitId: e }));
  assert.ok(!R.unitById(s, e).hidden, 'enemy ended next to an ally: spotted');
});

test('formations: circle cannot move and blocks rear attacks', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  must(R.act(s, P1, { type: 'setFormation', unitId: a, formation: 'circle' }));
  must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  assert.ok(!R.act(s, P1, { type: 'move', unitId: a, x: 5, y: 6 }).ok);
});

test('players cannot control other players units', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  assert.ok(!R.act(s, P2, { type: 'setFormation', unitId: a, formation: 'loose' }).ok);
  assert.ok(!R.act(s, P2, { type: 'addUnit', typeId: 'han_ji_inf', side: 'player', x: 1, y: 1 }).ok);
});

test('stealth: moving next to a hidden enemy reveals it; no hiding with enemies adjacent', () => {
  const s = setup();
  must(R.act(s, HOST, { type: 'paintTerrain', cells: [[5, 5], [8, 8]], terrain: 'trees' }));
  const e = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  const p = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 8 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  R.unitById(s, e).hidden = true;
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: p }));
  s.freeMovement = false;
  must(R.act(s, P1, { type: 'moveTo', unitId: p, x: 5, y: 6 }));
  assert.ok(!R.unitById(s, e).hidden, 'moved adjacent: revealed');
  must(R.act(s, P1, { type: 'undoMove', unitId: p }));
  assert.ok(!R.unitById(s, e).hidden, 'undo does not hide it again');
  // a player unit ending its turn in a forest next to an enemy cannot hide
  const s2 = setup();
  must(R.act(s2, HOST, { type: 'paintTerrain', cells: [[5, 6]], terrain: 'trees' }));
  add(s2, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  const p2 = add(s2, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 5, y: 8 });
  must(R.act(s2, HOST, { type: 'startBattle' })); must(R.act(s2, HOST, { type: 'startRound' }));
  must(R.act(s2, P1, { type: 'claim' })); must(R.act(s2, P1, { type: 'begin', unitId: p2 }));
  s2.freeMovement = false;
  must(R.act(s2, P1, { type: 'moveTo', unitId: p2, x: 5, y: 6 }));
  must(R.act(s2, P1, { type: 'endTurn', unitId: p2 }));
  assert.ok(!R.unitById(s2, p2).hidden);
});

test('attacking from hiding: +2, no strike back (defender still rolls), revealed', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'wen_ping', side: 'player', owner: 'p1', x: 5, y: 6, morale: 80 });
  const d = add(s, { typeId: 'yt_warriors', officerId: 'xu_chu', side: 'enemy', x: 5, y: 5 });
  R.unitById(s, a).hidden = true;
  R.unitById(s, d).men = 1;
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([9, 0, 0, 0, 0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  assert.strictEqual(R.prompt(s).unitId, a);
  must(R.act(s, P1, { type: 'decide', unitId: a, choice: 'act' }));
  dice([0, 0, 9, 0]);
  const menBefore = R.unitById(s, a).men;
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.ok(r.ambush);
  assert.ok(r.attackRoll.parts.some(([l, v]) => l === 'Attacking from hiding' && v === 2));
  assert.ok(r.defendRoll.parts.some(([l, v]) => l === 'Command' && v > 0), 'defender keeps its Command');
  assert.strictEqual(r.damageToAttacker || 0, 0);
  assert.strictEqual(R.unitById(s, a).men, menBefore, 'no strike back');
  assert.ok(!R.unitById(s, a).hidden, 'attacking reveals it');
});

test('homebrew: a double counts as its face value in unit rolls', () => {
  dice([7, 7]);
  assert.strictEqual(R.yinYang().value, 7);
  dice([0, 0]);
  assert.strictEqual(R.yinYang().value, 0);
});

test('free movement (VTT): moves are recorded, over-distance moves warn instead of failing', () => {
  const s = setup(); s.freeMovement = true;
  const a = add(s, { typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 1, y: 1 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  const res = must(R.act(s, P1, { type: 'move', unitId: a, x: 9, y: 1 }));
  assert.match(res.warning, /moved 8 tiles/);
  assert.strictEqual(R.unitById(s, a).x, 9);
});

function unitType(id, o) {
  return Object.assign({ id, name: id, faction: 'X', tier: 1, category: 'infantry', weapon: 'melee', skill: 'Qiangshu',
    damage: 6, armor: 3, armorPen: 0, unitValue: 0, move: 3, rangeMin: 1, rangeMax: 1, formations: null }, o);
}
function duel(s, aType, dType, rolls, setupFn) {
  s.library.unitTypes.push(aType, dType);
  const a = add(s, { typeId: aType.id, side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: dType.id, side: 'enemy', x: 5, y: 4 });
  if (setupFn) setupFn(R.unitById(s, a), R.unitById(s, d));
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  dice(rolls);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  return [R.unitById(s, a), R.unitById(s, d)];
}

test('armor penetration lowers the armor that casualties are reduced by', () => {
  const s = setup();
  // attacker: 5 + 2 = 7, defender 0: diff 7. Damage 6+7 = 13 vs armor 4 - AP 3 = 1 -> 12 casualties
  const [A, D] = duel(s, unitType('ap', { armorPen: 3 }), unitType('tank', { armor: 4 }), [7, 2, 0, 0]);
  assert.strictEqual(D.men, 100 - 12);
  assert.strictEqual(A.men, 100); // defender's total was 0: its return damage is negated
});

test('XP: casualties dealt x enemy tier / own tier, rounded down; kill bonus 25 x ratio', () => {
  const s = setup();
  // tier 2 attacker vs tier 1 defender with 10 men: 13 damage - 3 armor = 10 casualties -> kill
  const [A] = duel(s, unitType('vet', { tier: 2 }), unitType('militia', { tier: 1 }), [7, 2, 0, 0], (a, d) => { d.men = 10; });
  // only the 10 men it had count: 10 * 1/2 = 5; kill 25 * 1/2 = 12.5 -> 12
  assert.strictEqual(A.xp, 5 + 12);
});

test('Turtle: no attacker bonus, +2 defending, 2 fewer casualties; strength penalty scales with max health', () => {
  const s = setup();
  s.library.formations.push({ id: 'turt', name: 'Turtle', moveMod: -2, casReduce: 2, noAttackerBonus: true, defAll: 2 });
  const [A, D] = duel(s, unitType('a1', {}), unitType('d1', { formations: null, category: 'cavalry' }), [7, 2, 0, 0],
    (a, d) => { d.formation = 'turt'; d.maxMen = 50; d.men = 50; });
  // attacker 5+2 = 7 vs defender 0+2 = 2 -> diff 5. Damage 6+5 = 11 - armor 3 - turtle 2 = 6
  assert.strictEqual(D.men, 50 - 6);
  // defender's return damage 6 - 3 armor = 3 (turtle reduction only protects the turtle)
  assert.strictEqual(A.men, 100 - 3);
});

function turnFor(s, aType, extra = []) {
  s.library.unitTypes.push(aType, ...extra.map(e => e.type));
  const a = add(s, { typeId: aType.id, side: 'player', owner: 'p1', x: 5, y: 5 });
  const others = extra.map(e => add(s, { typeId: e.type.id, side: e.side || 'enemy', x: e.x, y: e.y }));
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  return [a, ...others];
}

/** Give a unit an officer with no stats or abilities (for rules that need one, like forced march). */
function plainOfficer(s, u) {
  if (!s.library.officers.some(o => o.id === 'plain')) s.library.officers.push({ id: 'plain', name: 'Plain Officer', fire: 0, command: 0, skills: {}, heroicActions: [] });
  u.officerId = 'plain';
}

test('only officer units can force-march', () => {
  const s = setup();
  const [a] = turnFor(s, unitType('walker2', { move: 3 }), [{ type: unitType('far3'), x: 20, y: 12 }]);
  const u = R.unitById(s, a);
  assert.strictEqual(R.moveOptions(s, u).red.size, 0, 'no red squares without an officer');
  assert.ok(!R.act(s, P1, { type: 'moveTo', unitId: a, x: 9, y: 5 }).ok);
  plainOfficer(s, u);
  assert.ok(R.moveOptions(s, u).red.has('9,5'));
});

test('click-to-move: blue tiles keep the action, red tiles force march and end the turn', () => {
  const s = setup();
  const [a] = turnFor(s, unitType('walker', { move: 3 }), [{ type: unitType('far'), x: 20, y: 12 }]);
  const u = R.unitById(s, a);
  plainOfficer(s, u); // only officer units can force-march
  const { blue, red } = R.moveOptions(s, u);
  assert.ok(blue.has('8,5') && !blue.has('9,5') && red.has('9,5') && red.has('11,5') && !red.has('12,5'));
  assert.strictEqual(red.get('11,5').cost, 15);
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 7, y: 5 }));
  assert.strictEqual(u.x, 7);
  assert.strictEqual(s.turn.activation.step, 'act', 'still has its action after a blue move');
  const menu = R.actionMenu(s, u);
  assert.ok(!menu.move && menu.hold && menu.endTurn && !menu.attack);
  must(R.act(s, P1, { type: 'holdPosition', unitId: a }));
  assert.ok(u.round.holding && u.round.activated, 'hold after moving ends the turn');
});

test('forced march costs 5 morale per extra tile, ends the turn, and cannot drop morale to 0', () => {
  const s = setup();
  const [a] = turnFor(s, unitType('marcher', { move: 3 }), [{ type: unitType('far2'), x: 20, y: 12 }]);
  const u = R.unitById(s, a);
  plainOfficer(s, u);
  u.morale = 11; // 2 extra tiles = 10 (ok), 3 = 15 (would surrender)
  const { red } = R.moveOptions(s, u);
  assert.ok(red.has('10,5') && !red.has('11,5'));
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 10, y: 5 }));
  assert.strictEqual(u.morale, 1);
  assert.ok(u.round.activated && !s.turn.activation, 'forced march ended the turn');
});

test('action menu: attack only with an enemy in range', () => {
  const s = setup();
  const [a] = turnFor(s, unitType('fighter'), [{ type: unitType('adjacent'), x: 5, y: 4 }]);
  const menu = R.actionMenu(s, R.unitById(s, a));
  assert.ok(menu.attack && menu.move && !menu.ability && !menu.heroic, JSON.stringify(menu));
});

test('four sides: different sides are hostile (allies included), the same side never is', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('pl'), unitType('al'), unitType('ne'), unitType('pl2'));
  const p = add(s, { typeId: 'pl', side: 'player', owner: 'p1', x: 5, y: 5 });
  add(s, { typeId: 'al', side: 'ally', x: 5, y: 4 });
  add(s, { typeId: 'ne', side: 'neutral', x: 6, y: 5 });
  add(s, { typeId: 'pl2', side: 'player', owner: 'p1', x: 4, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: p }));
  const names = R.attackTargets(s, R.unitById(s, p)).map(u => u.typeId).sort();
  assert.deepStrictEqual(names, ['al', 'ne'], 'player can hit the ally and the neutral, not its own side');
});

test('holding gives +2 melee defense', () => {
  const s = setup();
  s.library.unitTypes.push(unitType('h1'), unitType('h2'));
  const a = add(s, { typeId: 'h1', side: 'player', owner: 'p1', x: 5, y: 5 });
  const d = add(s, { typeId: 'h2', side: 'enemy', x: 5, y: 4 });
  R.unitById(s, d).round = Object.assign(R.unitById(s, d).round || {}, { holding: true });
  const roll = R.buildRoll(s, R.unitById(s, d), 'defender', { attacker: R.unitById(s, a), defender: R.unitById(s, d), ranged: false });
  assert.ok(roll.parts.some(([k, v]) => /Holding/.test(k) && v === 2));
});

test('undo: only a normal move, and only until something else happens', () => {
  const s = setup();
  const [a] = turnFor(s, unitType('undoer', { move: 3 }), [{ type: unitType('farU'), x: 20, y: 12 }]);
  const u = R.unitById(s, a);
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 7, y: 5 }));
  assert.ok(R.actionMenu(s, u).undo);
  must(R.act(s, P1, { type: 'undoMove', unitId: a }));
  assert.deepStrictEqual([u.x, u.y, s.turn.activation.step, u.round.moved], [5, 5, 'move', false]);
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 6, y: 5 }));
  s.library.officers = []; // no officer: try a heroic (fails) — failed actions keep the undo
  assert.ok(!R.act(s, P1, { type: 'heroic', unitId: a, index: 0 }).ok);
  assert.ok(R.actionMenu(s, u).undo);
});

test('levels: every 100 XP is a level', () => {
  const s = setup();
  const [A] = duel(s, unitType('lv', { tier: 1 }), unitType('big', { tier: 4 }), [7, 2, 0, 0], (a, d) => { a.xp = 90; });
  // 10 casualties x 4/1 = 40 XP -> 130 -> level 2 with 30 XP
  assert.strictEqual(A.level, 2);
  assert.strictEqual(A.xp, 30);
});

test('facing: none until attacking or attacked; the first attacker turns it; clears at the end of its turn', () => {
  const s = setup();
  const a = add(s, { typeId: 'yt_warriors', side: 'player', owner: 'p1', x: 5, y: 4 });
  const b = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  const c = add(s, { typeId: 'yt_warriors', side: 'player', owner: 'p1', x: 5, y: 6 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  const A = R.unitById(s, a), B = R.unitById(s, b), C = R.unitById(s, c);
  assert.deepStrictEqual([A.facing, B.facing, C.facing], [null, null, null]);
  // with no facing there is no rear
  dice([5, 5]); let r = R.resolveAttack(s, A, B, { free: true });
  assert.strictEqual(r.rear, false);
  assert.deepStrictEqual(A.facing, { dx: 0, dy: 1 }, 'attacking turns it to its target');
  assert.deepStrictEqual(B.facing, { dx: 0, dy: -1 }, 'the first attacker turns it');
  // a second attacker from behind: B doesn't turn, so it's a rear attack
  dice([5, 5]); r = R.resolveAttack(s, C, B, { free: true });
  assert.strictEqual(r.rear, true);
  assert.deepStrictEqual(B.facing, { dx: 0, dy: -1 });
  // moving doesn't turn a unit; ending its turn clears its facing
  s.freeMovement = false;
  const p = R.prompt(s);
  if (p.kind === 'claim') must(R.act(s, P1, { type: 'claim' }));
  must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'moveTo', unitId: a, x: 4, y: 4 }));
  assert.deepStrictEqual(A.facing, { dx: 0, dy: 1 }, 'moving keeps its facing');
  must(R.act(s, P1, { type: 'endTurn', unitId: a }));
  assert.strictEqual(A.facing, null);
});

test('facing is only up, down, left or right: the longer way wins, left/right on a perfect diagonal', () => {
  const s = setup();
  const a = add(s, { typeId: 'yt_warriors', side: 'player', owner: 'p1', x: 5, y: 5 });
  const targets = [[7, 6, { dx: 1, dy: 0 }], [4, 7, { dx: 0, dy: 1 }], [6, 6, { dx: 1, dy: 0 }], [4, 4, { dx: -1, dy: 0 }], [5, 2, { dx: 0, dy: -1 }]];
  const ids = targets.map(([x, y]) => add(s, { typeId: 'yt_warriors', side: 'enemy', x, y }));
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  const A = R.unitById(s, a);
  targets.forEach(([, , want], i) => { dice([5, 5]); R.resolveAttack(s, A, R.unitById(s, ids[i]), { free: true }); assert.deepStrictEqual(A.facing, want); });
});
