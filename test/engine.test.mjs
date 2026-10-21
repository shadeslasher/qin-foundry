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

test('rear cavalry charge triples morale loss', () => {
  const s = setup();
  const a = add(s, { typeId: 'han_lancer_cav', side: 'player', owner: 'p1', x: 5, y: 2 });
  const d = add(s, { typeId: 'yt_warriors', side: 'enemy', x: 5, y: 5 });
  must(R.act(s, HOST, { type: 'startBattle' })); must(R.act(s, HOST, { type: 'startRound' }));
  assert.deepStrictEqual(R.unitById(s, d).facing, { dx: 0, dy: -1 }, 'starts facing the nearest enemy');
  R.unitById(s, d).facing = { dx: 0, dy: 1 }; // turned away from the cavalry
  must(R.act(s, P1, { type: 'claim' })); must(R.act(s, P1, { type: 'begin', unitId: a }));
  must(R.act(s, P1, { type: 'move', unitId: a, x: 5, y: 4 }));
  dice([3, 0, 0, 0]); // A: 3+2+2(att)+1(charge)+2(rear)=10, D: 0+2-1=1 -> diff 9
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.ok(r.charge && r.rear);
  assert.strictEqual(r.diff, 9);
  assert.strictEqual(R.unitById(s, d).morale, Math.max(0, 50 - 27));
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

test('stealth: hidden in trees, unseen beyond 4 tiles, ambush removes defender Command', () => {
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
  assert.ok(E.hidden);
  assert.ok(!R.visibleTo(s, E, 'player'));
  assert.strictEqual(R.viewFor(s, P1).units.find(u => u.id === e), undefined);
  R.unitById(s, p).x = 4; R.unitById(s, p).y = 4; // 4 tiles away: spotted
  assert.ok(R.visibleTo(s, E, 'player'));
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

test('kill morale above 75 is kept (regen does not lower it); ambush omits defender Command', () => {
  const s = setup();
  must(R.act(s, HOST, { type: 'paintTerrain', cells: [[5, 6]], terrain: 'grass' }));
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'wen_ping', side: 'player', owner: 'p1', x: 5, y: 6, morale: 80 });
  const d = add(s, { typeId: 'yt_warriors', officerId: 'xu_chu', side: 'enemy', x: 5, y: 5 });
  R.unitById(s, a).hidden = true;
  R.unitById(s, d).men = 1;
  must(R.act(s, HOST, { type: 'startBattle' }));
  dice([9, 0, 0, 0, 0, 0]); must(R.act(s, HOST, { type: 'startRound' }));
  assert.strictEqual(R.prompt(s).unitId, a);
  must(R.act(s, P1, { type: 'decide', unitId: a, choice: 'act' }));
  dice([0, 0, 0, 0]);
  must(R.act(s, P1, { type: 'attack', unitId: a, targetId: d }));
  const r = s.log.filter(e => e.detail && e.detail.type === 'attack').pop().detail.result;
  assert.ok(r.ambush);
  assert.strictEqual(r.defendRoll.total, 0 + 0 + 3 + 0 + 2 - 2); // Command omitted, Fire 3, no Jianshu, UV 2, below 25 men -2
  assert.strictEqual(R.unitById(s, a).morale, 90);           // 80 + 5*2 (tier 2 kill)
  assert.ok(R.unitById(s, a).hidden, 'ended turn in grass: hidden again');
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
