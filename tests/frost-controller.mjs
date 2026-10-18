import assert from 'node:assert/strict';
import test from 'node:test';
import {BonusController, BONUS_DEFS} from '../src/bonus-controller.js';

test('Frost is an immediate arena effect with no timed or next-hit attack record', () => {
  const powers = new BonusController();
  powers.tick(125);
  const pickup = powers.collect('frost');
  assert.equal(pickup.accepted, true);
  assert.deepEqual(pickup.effect, {
    kind: 'frost', originId: null, persistent: true,
    targetType: 'all-current-originals', hitReduction: 1, minHits: 1,
  });
  assert.equal(Object.isFrozen(pickup.effect), true);
  assert.equal(powers.attacks.size, 0);
  assert.equal(powers.active, null);
  assert.equal(powers.has('frost'), false);
  assert.deepEqual(powers.capture().activationIds, {});
  assert.deepEqual(powers.snapshotHUD().activeEffects, []);
  for (const retired of ['duration', 'markDuration', 'bonusDamage']) {
    assert.equal(retired in BONUS_DEFS.frost, false);
    assert.equal(retired in pickup.effect, false);
  }
  assert.match(BONUS_DEFS.frost.description, /all cubes in the arena/);
  assert.match(BONUS_DEFS.frost.description, /round ends/);
  assert.match(BONUS_DEFS.frost.description, /one fewer hit.*minimum one/);
  assert.match(BONUS_DEFS.frost.description, /colors stay visible/);
});

test('freezeArena snapshots every valid original once and returns only newly frozen IDs', () => {
  const powers = new BonusController();
  const ids = [0, 1, 1, 110, 'cube-1', null, undefined, NaN, Infinity, -Infinity,
    -1, 1.5, '', '  ', {}, [], true, false, Number.MAX_SAFE_INTEGER + 1];
  assert.deepEqual(powers.freezeArena(ids), [0, 1, 110, 'cube-1']);
  assert.deepEqual([...powers.frostMarks], [[0, Infinity], [1, Infinity], [110, Infinity], ['cube-1', Infinity]]);
  assert.deepEqual(powers.freezeArena(new Set([1, 110, 111])), [111]);
  assert.deepEqual(powers.freezeArena(), []);
  assert.deepEqual(powers.freezeArena(null), []);
  assert.deepEqual(powers.freezeArena({}), []);
});

test('repeated Frost pickups cannot stack an existing arena durability reduction', () => {
  const powers = new BonusController();
  const durability = new Map([[1, 1], [2, 2], [3, 5]]);
  const collectFrost = () => {
    const {effect} = powers.collect('frost');
    for (const id of powers.freezeArena(durability.keys())) {
      durability.set(id, Math.max(effect.minHits, durability.get(id) - effect.hitReduction));
    }
  };
  collectFrost();
  assert.deepEqual([...durability.values()], [1, 1, 4]);
  for (let i = 0; i < 10; i++) collectFrost();
  assert.deepEqual([...durability.values()], [1, 1, 4]);
  assert.equal(powers.frostMarks.size, 3);
  assert.equal(powers.attacks.size, 0);
});

test('arena ice never expires through elapsed, paused or backward simulation time', () => {
  const powers = new BonusController();
  powers.freezeArena([1, 2]);
  for (const time of [0, 10, 10, 10000, 1, Number.MAX_VALUE]) {
    assert.deepEqual(powers.tick(time).expiredFrostIds, []);
    assert.deepEqual([...powers.frostMarks], [[1, Infinity], [2, Infinity]]);
  }
  assert.deepEqual(powers.snapshotHUD().frostMarks, [
    {originId: 1, expiresAt: Infinity, secondsLeft: Infinity},
    {originId: 2, expiresAt: Infinity, secondsLeft: Infinity},
  ]);
});

test('direct hits neither mark new cubes nor consume ice nor add Frost damage', () => {
  const powers = new BonusController();
  const priorBatch = powers.capture();
  powers.collect('frost');
  powers.freezeArena([1]);
  for (const snapshot of [priorBatch, powers.capture()]) {
    for (const id of [1, 1, 2]) {
      const result = powers.consumeDirect(snapshot, id, 20);
      assert.equal(result.damage, 1);
      assert.equal(result.frostConsumed, false);
      assert.equal(result.consumed, false);
      assert.deepEqual(result.effects, []);
      assert.equal(result.effect, null);
    }
  }
  assert.deepEqual([...powers.frostMarks], [[1, Infinity]]);
});

test('Frost coexists with immediate powers and leaves active attack identities intact', () => {
  const powers = new BonusController();
  for (const kind of ['pulse', 'pierce', 'heavy']) powers.collect(kind);
  const batch = powers.capture();
  const attacks = [...powers.attacks].map(([kind, attack]) => [kind, {...attack}]);
  for (const kind of ['frost', 'arc', 'gravity', 'blackhole', 'split', 'frost']) {
    assert.equal(powers.collect(kind).effect.kind, kind);
  }
  powers.freezeArena([1]);
  assert.deepEqual([...powers.attacks], attacks);
  const result = powers.consumeDirect(batch, 1, 0);
  assert.equal(result.damage, 8);
  assert.equal(result.pierced, true);
  assert.equal(result.frostConsumed, false);
  assert.deepEqual(result.effects.map(effect => effect.kind), ['pulse', 'heavy']);
  assert.equal(powers.frostMarks.get(1), Infinity);
  assert.equal(powers.consumeDirect(batch, 1, 0).damage, 0);
  assert.equal(powers.frostMarks.get(1), Infinity);
});

test('round resets clear all ice and stale captures; a new round can freeze the same IDs', () => {
  const powers = new BonusController();
  powers.collect('pulse');
  powers.collect('frost');
  powers.freezeArena([1, 2]);
  const stale = powers.capture();
  powers.reset();
  assert.equal(powers.frostMarks.size, 0);
  assert.deepEqual(powers.snapshotHUD().frostMarks, []);
  assert.equal(powers.consumeDirect(stale, 1, 0).damage, 0);
  assert.deepEqual(powers.freezeArena([1, 2]), [1, 2]);
  powers.frostMarks.clear();
  assert.deepEqual(powers.freezeArena([1, 2]), [1, 2], 'section-reset clear permits the new arena to freeze independently');
});
