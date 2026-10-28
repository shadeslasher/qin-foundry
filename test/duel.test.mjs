// Officer duels on the battlefield (David, 2026-10-28).
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
const add = (s, o) => must(R.act(s, HOST, Object.assign({ type: 'addUnit' }, o))).unitId;

function setup({ enemyOwner = null } = {}) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' }; s.players.p2 = { name: 'Bob' };
  s.library.officers.push({ id: 'oa', name: 'Zhao Yun', fire: 0, command: 0, skills: {}, heroicActions: [] },
    { id: 'ob', name: 'Wen Chou', fire: 0, command: 0, skills: {}, heroicActions: [] });
  const a = add(s, { typeId: 'han_ji_inf', officerId: 'oa', side: 'player', owner: 'p1', x: 5, y: 5, morale: 60 });
  const b = add(s, { typeId: 'yt_warriors', officerId: 'ob', side: 'enemy', owner: enemyOwner, x: 6, y: 5, morale: 60 });
  must(R.act(s, HOST, { type: 'startBattle' }));
  s.tactics = null;
  s.turn = { ...s.turn, phase: 'officer', order: [a, b], decided: [], held: [] };
  must(R.act(s, P1, { type: 'decide', unitId: a, choice: 'act' }));
  return { s, a: R.unitById(s, a), b: R.unitById(s, b) };
}

test('duel: only officer units next to an enemy officer unit can challenge; it uses the action and waits', () => {
  const { s, a, b } = setup();
  assert.ok(R.actionMenu(s, a).duel);
  assert.deepStrictEqual(R.duelTargets(s, a).map(u => u.id), [b.id]);
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  assert.strictEqual(s.duels.pending.stage, 'asked');
  assert.ok(a.round.attacked, 'the challenge is the action for the turn');
  assert.ok(!R.act(s, P1, { type: 'endTurn', unitId: a.id }).ok, 'nothing else happens until the duel is settled');
  assert.ok(!R.act(s, P1, { type: 'duelAnswer', accept: true }).ok, 'only the challenged side (or the GM) answers');
});

test('refusing: -15 morale, never challenged again this battle, challenger turn ends', () => {
  const { s, a, b } = setup();
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  must(R.act(s, HOST, { type: 'duelAnswer', accept: false }));
  assert.strictEqual(b.morale, 45);
  assert.strictEqual(a.morale, 60, 'no gain for the challenger');
  assert.ok(s.duels.refused.includes(b.id));
  assert.ok(!s.turn.activation || s.turn.activation.unitId !== a.id, 'the challenger turn is over');
  assert.strictEqual(R.duelTargets(s, a).length, 0, 'cannot be challenged again');
});

test('a player officer answers for himself; the GM can too', () => {
  const { s, a, b } = setup({ enemyOwner: 'p2' });
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  assert.ok(!R.act(s, P1, { type: 'duelAnswer', accept: true }).ok);
  must(R.act(s, { id: 'p2', host: false }, { type: 'duelAnswer', accept: true }));
  assert.strictEqual(s.duels.pending.stage, 'fighting');
});

test('result: more Breath of Life levels dropped loses 25, the other gains 15; even = nothing', () => {
  let { s, a, b } = setup();
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  must(R.act(s, HOST, { type: 'duelAnswer', accept: true }));
  must(R.act(s, HOST, { type: 'duelResult', fromDrop: 1, toDrop: 2 }));
  assert.strictEqual(a.morale, 75); assert.strictEqual(b.morale, 35);
  assert.strictEqual(s.duels.pending, null);
  ({ s, a, b } = setup());
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  must(R.act(s, HOST, { type: 'duelAnswer', accept: true }));
  must(R.act(s, HOST, { type: 'duelResult', fromDrop: 1, toDrop: 1 }));
  assert.strictEqual(a.morale, 60); assert.strictEqual(b.morale, 60);
});

test('a slain officer: his unit loses 50 and its officer, the victor gains 25', () => {
  const { s, a, b } = setup();
  must(R.act(s, P1, { type: 'duel', unitId: a.id, targetId: b.id }));
  must(R.act(s, HOST, { type: 'duelAnswer', accept: true }));
  must(R.act(s, HOST, { type: 'duelResult', fromDrop: 1, toDrop: 6, toDead: true }));
  assert.strictEqual(b.morale, 10); assert.strictEqual(b.officerId, null);
  assert.strictEqual(a.morale, 85);
});

test('duel ground: overlays first (a camp on plains is a camp), then terrain; scene falls back to "anything else"', async () => {
  const { duelGround, duelSceneFor } = await import('../module/battle/duel-rules.mjs');
  assert.strictEqual(duelGround({ terrain: 'plains' }), 'plains');
  assert.strictEqual(duelGround({ terrain: 'farmland' }), 'plains');
  assert.strictEqual(duelGround({ terrain: 'plains', overlays: ['camp'] }), 'camp');
  assert.strictEqual(duelGround({ terrain: 'rocky', overlays: ['trees'] }), 'forest');
  assert.strictEqual(duelGround({ terrain: 'plains', overlays: ['hill'] }), 'hills');
  assert.strictEqual(duelGround({ terrain: 'ford' }), 'water');
  assert.strictEqual(duelGround(null), 'default');
  assert.strictEqual(duelSceneFor({ plains: 'S1', default: 'S9' }, 'plains'), 'S1');
  assert.strictEqual(duelSceneFor({ plains: 'S1', default: 'S9' }, 'forest'), 'S9');
  assert.strictEqual(duelSceneFor({}, 'forest'), null);
});
