// Victory and defeat conditions (2026-10-24), and fires that burn down.
import test from 'node:test';
import assert from 'node:assert';
import * as R from '../module/battle/engine.mjs';
import { evaluateObjectives, freshObjState } from '../module/battle/objectives.mjs';
import * as D from '../module/battle/engine-data.mjs';

const HOST = { id: 'host', host: true };
const P1 = { id: 'p1', host: false };
function must(res) { assert.ok(res.ok, res.error); return res; }
function plains(s, special = {}) {
  s.map.cols = 12; s.map.rows = 12; s.map.tiles = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s.map.tiles[x + ',' + y] = { terrain: 'plains' };
  Object.assign(s.map.tiles, special);
}
/** A player unit at (1,1) and an enemy at (10,10), far apart; objectives as given. */
function setup(objectives, special) {
  const s = R.newState(); s.players.p1 = { name: 'Alice' }; plains(s, special);
  const a = must(R.act(s, HOST, { type: 'addUnit', typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 1, y: 1 })).unitId;
  const e = must(R.act(s, HOST, { type: 'addUnit', typeId: 'yt_warriors', side: 'enemy', x: 10, y: 10 })).unitId;
  s.objectives = Object.assign({ victory: [], defeat: [], extraction: [] }, objectives);
  must(R.act(s, HOST, { type: 'startBattle' }));
  must(R.act(s, HOST, { type: 'skipTactics' }));
  return { s, a, e };
}
/** Play turns until the round ends (or the battle is decided). moves: unitId -> [x, y] to move to on its turn. */
function playRound(s, moves = {}) {
  const start = s.turn.round;
  for (let guard = 0; guard < 40 && s.turn.phase !== 'over'; guard++) {
    const p = R.prompt(s);
    if (p.kind === 'formations') { if (s.turn.round !== start) return; must(R.act(s, HOST, { type: 'startRound' })); continue; }
    if (p.kind === 'claim') { must(R.act(s, P1, { type: 'claim' })); continue; }
    if (p.kind === 'pick') { const u = s.units.find(u => u.side === 'player' && u.status === 'active' && !u.round.activated); must(R.act(s, P1, { type: 'begin', unitId: u.id })); continue; }
    if (p.kind === 'host-pick') { const u = s.units.find(u => u.side === p.side && u.status === 'active' && !u.round.activated); must(R.act(s, HOST, { type: 'begin', unitId: u.id })); continue; }
    if (p.kind === 'activation') {
      const u = R.unitById(s, p.unitId), actor = u.side === 'player' ? P1 : HOST;
      const to = moves[u.id];
      if (to) must(R.act(s, actor, { type: 'moveTo', unitId: u.id, x: to[0], y: to[1] }));
      must(R.act(s, actor, { type: 'endTurn', unitId: u.id }));
      continue;
    }
    return;
  }
}

test('evaluateObjectives: all victory conditions needed; any defeat loses; losing every player unit always loses', () => {
  const units = [{ id: 'a', side: 'player', status: 'active' }, { id: 'e', side: 'enemy', status: 'surrendered' }];
  const cfg = { victory: [{ id: 'v1', type: 'routAll' }, { id: 'v2', type: 'survive', rounds: 2 }], defeat: [{ id: 'd1', type: 'turnLimit', rounds: 5 }] };
  let ev = evaluateObjectives(cfg, units, { ...freshObjState(), roundsDone: 1 });
  assert.strictEqual(ev.result, null, 'routed all, but survive not done yet');
  assert.ok(ev.victory[0].done && !ev.victory[1].done);
  ev = evaluateObjectives(cfg, units, { ...freshObjState(), roundsDone: 2 });
  assert.strictEqual(ev.result, 'victory');
  ev = evaluateObjectives(cfg, [{ id: 'a', side: 'player', status: 'defeated' }, { id: 'e', side: 'enemy', status: 'active' }], freshObjState());
  assert.strictEqual(ev.result, 'defeat', 'all player units routed');
  assert.ok(ev.defeat.find(d => d.type === 'allPlayerRouted').triggered);
  ev = evaluateObjectives({ victory: [], defeat: [] }, units, freshObjState());
  assert.strictEqual(ev.result, null, 'no victory conditions: no automatic victory');
  ev = evaluateObjectives({ victory: [{ id: 'r', type: 'routUnit', unitIds: ['e', 'x'] }] }, units, freshObjState());
  assert.strictEqual(ev.victory[0].n, 2, 'a unit that is gone counts as routed');
});

test('seize: a player unit ending its turn on the tile wins', () => {
  const { s, a } = setup({ victory: [{ id: 'v', type: 'seize', x: 3, y: 1 }] });
  playRound(s, { [a]: [3, 1] });
  assert.strictEqual(s.outcome?.result, 'victory');
  assert.strictEqual(s.turn.phase, 'over');
  assert.strictEqual(R.prompt(s).kind, 'over');
});

test('hold: lasts the rounds unless an enemy ends its turn on it (the paired defeat)', () => {
  let { s } = setup({ victory: [{ id: 'h', type: 'hold', x: 5, y: 5, rounds: 2 }], defeat: [{ id: 'd', type: 'tileSeized', x: 5, y: 5, pair: 'h' }] });
  playRound(s); assert.ok(!s.outcome, 'one round held');
  assert.strictEqual(s.objEval.victory[0].n, 1);
  playRound(s); assert.strictEqual(s.outcome?.result, 'victory', 'two rounds held');
  ({ s } = setup({ victory: [{ id: 'h', type: 'hold', x: 10, y: 8, rounds: 2 }], defeat: [{ id: 'd', type: 'tileSeized', x: 10, y: 8, pair: 'h' }] }));
  const e = s.units.find(u => u.side === 'enemy').id;
  playRound(s, { [e]: [10, 8] });
  assert.strictEqual(s.outcome?.result, 'defeat', 'the enemy took it');
});

test('survive and turn limit count finished rounds; victory is checked first', () => {
  const { s } = setup({ victory: [{ id: 's', type: 'survive', rounds: 1 }], defeat: [{ id: 't', type: 'turnLimit', rounds: 1 }] });
  playRound(s);
  assert.strictEqual(s.outcome?.result, 'victory');
  const b = setup({ defeat: [{ id: 't', type: 'turnLimit', rounds: 1 }] });
  playRound(b.s);
  assert.strictEqual(b.s.outcome?.result, 'defeat');
});

test('escape: the chosen unit leaves from an extraction square', () => {
  const { s, a } = setup({ victory: [{ id: 'x', type: 'escape', unitIds: [] }], extraction: ['0,1', '0,2'] });
  s.objectives.victory[0].unitIds = [a];
  playRound(s, { [a]: [0, 1] });
  assert.strictEqual(R.unitById(s, a).status, 'escaped');
  assert.deepStrictEqual(s.objState.escaped, [a]);
  assert.strictEqual(s.outcome?.result, 'victory');
  const d = evaluateObjectives({ victory: [] }, [{ id: a, side: 'player', status: 'escaped' }], { ...freshObjState(), escaped: [a] });
  assert.strictEqual(d.result, null, 'escaped units are not lost');
});

test('rout a unit; a defeat condition on a routed unit', () => {
  let { s, e } = setup({ victory: [{ id: 'r', type: 'routUnit', unitIds: [] }] });
  s.objectives.victory[0].unitIds = [e];
  must(R.act(s, HOST, { type: 'adjust', unitId: e, morale: -100 }));
  assert.strictEqual(s.outcome?.result, 'victory', 'surrendered counts');
  let b = setup({ defeat: [{ id: 'd', type: 'unitRouted', unitIds: [] }] });
  b.s.objectives.defeat[0].unitIds = [b.a];
  R.unitById(b.s, b.a).men = 0; R.settle(b.s);
  assert.strictEqual(b.s.outcome?.result, 'defeat', 'destroyed counts');
});

test('fire: a burning square burns for its burn time, then burns down (burn victory)', () => {
  const { s } = setup({ victory: [{ id: 'b', type: 'burn', x: 6, y: 6 }] }, { '6,6': { terrain: 'plains', overlays: ['watchtower'] } });
  s.siege = { ladders: [], dropped: [], gates: [], fires: { '6,6': { left: 2 } } };
  assert.ok(R.tileRules(s, 6, 6).names.includes('Fire'), 'burning squares have the Fire overlay');
  playRound(s);
  assert.ok(!s.outcome, 'still burning');
  assert.strictEqual(s.siege.fires['6,6'].left, 1);
  playRound(s);
  assert.ok(s.siege.burnt['6,6'], 'burnt down');
  assert.ok(R.tileRules(s, 6, 6).names.includes('Ruins') && !R.tileRules(s, 6, 6).names.includes('Watchtower'), 'the watchtower is now ruins');
  assert.strictEqual(s.outcome?.result, 'victory');
});

test('the GM can end the battle at once with a victory or a defeat', () => {
  const { s } = setup({});
  assert.ok(!R.act(s, P1, { type: 'declareOutcome', result: 'victory' }).ok, 'players cannot');
  must(R.act(s, HOST, { type: 'declareOutcome', result: 'defeat' }));
  assert.strictEqual(s.outcome.result, 'defeat');
  assert.strictEqual(s.turn.phase, 'over');
  assert.ok(!R.act(s, HOST, { type: 'declareOutcome', result: 'victory' }).ok, 'already over');
});

test('stalemate ends the battle; starting a battle marks the tour', () => {
  const { s } = setup({});
  assert.ok(s.introAt > 0, 'startBattle sets introAt');
  must(R.act(s, HOST, { type: 'declareOutcome', result: 'stalemate' }));
  assert.strictEqual(s.outcome.result, 'stalemate');
  assert.strictEqual(R.prompt(s).kind, 'over');
});

test('with no player tactician the GM may place player tactics freely; players may not', () => {
  const s = R.newState(); s.players.p1 = { name: 'Alice' }; plains(s);
  must(R.act(s, HOST, { type: 'addUnit', typeId: 'han_ji_inf', side: 'player', owner: 'p1', x: 1, y: 1 }));
  must(R.act(s, HOST, { type: 'startBattle' }));
  const keys = D.TACTICS.filter(t => !t.highGround).map(t => t.key);
  const k1 = keys[0], k2 = keys.at(-1);
  must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: k1, x: 3, y: 3, highGround: true }));
  must(R.act(s, HOST, { type: 'placeTactic', side: 'player', key: k2, x: 5, y: 5, highGround: true }));
  assert.ok(!R.act(s, P1, { type: 'placeTactic', side: 'player', key: k1, x: 4, y: 4, highGround: true }).ok);
});
