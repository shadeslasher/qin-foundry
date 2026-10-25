// Reinforcement zones: pure rules (the brush, hooks and drawing need Foundry).
import test from 'node:test';
import assert from 'node:assert';
import { zonesOf, zoneAt, waitingZoneAt, isWaiting, dueZones, nextZoneName, arrivalRound } from '../module/battle/reinforce-rules.mjs';

const zones = [
  { id: 'a', name: 'Reinforcements A', squares: ['3,4', '4,4'], round: 5, arrived: false },
  { id: 'b', name: 'Reinforcements B', squares: ['9,9'], round: 3, arrived: true },
];

test('zones: lookup by square, waiting only in zones that have not arrived', () => {
  assert.deepStrictEqual(zonesOf(undefined), []);
  assert.deepStrictEqual(zonesOf({ zones }), zones);
  assert.strictEqual(zoneAt(zones, 4, 4)?.id, 'a');
  assert.strictEqual(zoneAt(zones, 5, 5), null);
  assert.strictEqual(waitingZoneAt(zones, 3, 4)?.id, 'a');
  assert.strictEqual(waitingZoneAt(zones, 9, 9), null, 'an arrived zone no longer holds units');
  assert.ok(isWaiting('a', zones));
  assert.ok(!isWaiting('b', zones), 'arrived');
  assert.ok(!isWaiting('zzz', zones), 'a removed zone releases its units');
  assert.ok(!isWaiting(undefined, zones));
});

test('zones: due at the start of their round, names and arrival rounds', () => {
  assert.deepStrictEqual(dueZones(zones, 4).map(z => z.id), []);
  assert.deepStrictEqual(dueZones(zones, 5).map(z => z.id), ['a']);
  assert.deepStrictEqual(dueZones(zones, 9).map(z => z.id), ['a'], 'late is still due; arrived ones never again');
  assert.strictEqual(nextZoneName(zones), 'Reinforcements C');
  assert.strictEqual(nextZoneName([]), 'Reinforcements A');
  assert.strictEqual(arrivalRound(3, 2), 5);
  assert.strictEqual(arrivalRound(3, 0), 4, 'at least the next round');
  assert.strictEqual(arrivalRound(0, 'x'), 1);
});
