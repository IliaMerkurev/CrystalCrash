import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaCleanup } from '../src/arena-cleanup.js';

const original = (id, hits = 1) => ({ id, hits });

test('intact or unknown damage history prevents cleanup regardless of position', () => {
  const cleanup = new ArenaCleanup();
  const damaged = original(1);
  for (const intact of [{ id: 2, hits: 0, y: -100 }, { id: 2, damage: 99 }]) {
    assert.equal(cleanup.update(100, [damaged, intact]), null);
    assert.equal(cleanup.targetId, null);
    assert.equal(cleanup.waited, 0);
  }
  assert.equal(cleanup.update(.99, [damaged]), null);
  assert.equal(cleanup.update(.01, [damaged]), damaged);
});

test('strikes the same damaged original every simulation second until destroyed', () => {
  const cleanup = new ArenaCleanup();
  const first = original(1), next = original(2);
  assert.equal(cleanup.update(.5, [first, next]), null);
  assert.equal(cleanup.update(.5, [first, next]), first);
  // Reordering does not redirect cleanup, nor does splitting into new clusters:
  // the caller still provides the same original identity and damage history.
  assert.equal(cleanup.update(1, [next, first]), first);
  assert.equal(cleanup.update(.5, [next]), null);
  assert.equal(cleanup.update(.5, [next]), next);
});

test('simulation cadence is stable at 90 Hz', () => {
  const cleanup = new ArenaCleanup(), live = [original(1)];
  const hits = [];
  for (let frame = 1; frame <= 270; frame++) {
    if (cleanup.update(1 / 90, live)) hits.push(frame);
  }
  assert.deepEqual(hits, [90, 180, 270]);
});

test('long frames never bank catch-up strikes', () => {
  const cleanup = new ArenaCleanup(), survivor = original(1);
  assert.equal(cleanup.update(25, [survivor]), survivor);
  assert.equal(cleanup.update(0, [survivor]), null);
  assert.equal(cleanup.update(.01, [survivor]), null);
  assert.equal(cleanup.update(.98, [survivor]), null);
  assert.equal(cleanup.update(.01, [survivor]), survivor);
});

test('pause and invalid deltas cannot advance time', () => {
  const cleanup = new ArenaCleanup(), survivor = original(1);
  for (const dt of [0, -1, NaN, Infinity, undefined]) assert.equal(cleanup.update(dt, [survivor]), null);
  assert.equal(cleanup.update(.99, [survivor]), null);
  assert.equal(cleanup.update(.01, [survivor]), survivor);
});

test('new intact original clears pending countdown and target', () => {
  const cleanup = new ArenaCleanup(), first = original(1), intact = original(2, 0);
  cleanup.update(.9, [first]);
  assert.equal(cleanup.update(.1, [first, intact]), null);
  intact.hits = 1;
  assert.equal(cleanup.update(.9, [first, intact]), null);
  assert.equal(cleanup.update(.1, [first, intact]), first);
});

test('reset clears per-arena history even when original ids are reused', () => {
  const cleanup = new ArenaCleanup(), first = original(1);
  cleanup.update(.9, [first]);
  cleanup.reset();
  const nextArena = original(1);
  assert.equal(cleanup.update(.9, [nextArena]), null);
  assert.equal(cleanup.update(.1, [nextArena]), nextArena);
});

test('empty live graph resets cleanup and does not count visual debris', () => {
  const cleanup = new ArenaCleanup(), first = original(1);
  cleanup.update(.9, [first]);
  assert.equal(cleanup.update(100, []), null);
  assert.equal(cleanup.targetId, null);
  assert.equal(cleanup.update(.9, [first]), null);
  assert.equal(cleanup.update(.1, [first]), first);
});

test('supports explicit damage predicate without mutating supplied originals', () => {
  const cleanup = new ArenaCleanup({ isDamaged: o => o.wasDamaged === true });
  const survivor = Object.freeze({ id: 4, wasDamaged: true });
  assert.equal(cleanup.update(1, new Set([survivor])), survivor);
});

test('invalid interval is rejected', () => {
  for (const interval of [0, -1, NaN, Infinity]) assert.throws(() => new ArenaCleanup({ interval }), RangeError);
});
