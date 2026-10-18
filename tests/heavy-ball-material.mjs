import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color, MeshStandardMaterial, InstancedMesh, SphereGeometry } from 'three';
import { HeavyBallMaterial, HEAVY_GOLD_COLOR } from '../src/heavy-ball-material.js';

function setup() {
  const mainMaterial = new MeshStandardMaterial({ color: 0xe0e6ee, metalness: 1, roughness: .095, envMapIntensity: 2.4 });
  const extraMaterial = new MeshStandardMaterial({ color: 0xf27ed2, metalness: 1, roughness: .095, envMapIntensity: 2.4 });
  const animation = new HeavyBallMaterial({ mainMaterial, extraMaterial });
  return { mainMaterial, extraMaterial, animation };
}
const snapshot = m => ({ color: m.color.toArray(), emissive: m.emissive.toArray(), intensity: m.emissiveIntensity, version: m.version });
const gold = new Color(HEAVY_GOLD_COLOR).toArray();

test('smooth warm gold transition preserves polish and shader version; fade restores exact chrome/pink', () => {
  const { mainMaterial: main, extraMaterial: extra, animation: fx } = setup();
  const initial = [snapshot(main), snapshot(extra)];
  fx.update(.08, true, 2);
  assert.ok(fx.mix > 0 && fx.mix < 1);
  assert.notDeepEqual(main.color.toArray(), gold);
  assert.ok(main.emissive.r > 0);
  for (const m of [main, extra]) {
    assert.equal(m.metalness, 1); assert.equal(m.roughness, .095); assert.equal(m.envMapIntensity, 2.4);
    assert.equal(m.version, 0);
  }
  fx.update(.5, true, 2);
  assert.deepEqual(main.color.toArray(), gold);
  assert.deepEqual(extra.color.toArray(), gold);
  assert.deepEqual(main.emissive.toArray(), initial[0].emissive);
  fx.update(.1, false, 0);
  assert.ok(fx.mix > 0 && fx.mix < 1);
  fx.update(.5, false, 0);
  assert.deepEqual(snapshot(main), initial[0]); assert.deepEqual(snapshot(extra), initial[1]);
});

test('stacked and consumed charges stay gold; new split instances share gold immediately', () => {
  const { mainMaterial: main, extraMaterial: extra, animation: fx } = setup();
  fx.update(1, true, 1);
  fx.update(.1, true, 3);
  assert.equal(fx.mix, 1); assert.ok(extra.emissive.r > 0);
  fx.update(1, true, 2); fx.update(1, true, 1);
  assert.deepEqual(main.color.toArray(), gold);
  const geometry = new SphereGeometry(1, 4, 2);
  const split = new InstancedMesh(geometry, extra, 10);
  assert.equal(split.material, extra); assert.deepEqual(split.material.color.toArray(), gold);
  geometry.dispose();
});

test('pause freezes state and materials even when inventory changes; resume processes edge', () => {
  const { mainMaterial: main, animation: fx } = setup();
  fx.update(.08, true, 2);
  const before = snapshot(main), mix = fx.mix, age = fx.pulseAge;
  for (const dt of [0, -1, NaN]) fx.update(dt, false, 0);
  assert.deepEqual(snapshot(main), before); assert.equal(fx.mix, mix); assert.equal(fx.pulseAge, age);
  assert.equal(fx.active, true);
  fx.update(.5, false, 0); assert.equal(fx.mix, 0);
});

test('reset/dispose restore custom original emissive values without disposing shared materials', () => {
  const main = new MeshStandardMaterial({ color: 0xe0e6ee, emissive: 0x112233, emissiveIntensity: .4 });
  const original = snapshot(main);
  let disposals = 0; main.addEventListener('dispose', () => disposals++);
  const fx = new HeavyBallMaterial({ mainMaterial: main, extraMaterial: main });
  assert.equal(fx.materials.length, 1);
  fx.update(.1, true, 1); fx.reset(); assert.deepEqual(snapshot(main), original);
  fx.update(.1, true, 1); fx.dispose(); assert.deepEqual(snapshot(main), original);
  fx.update(1, true, 1); assert.deepEqual(snapshot(main), original); assert.equal(disposals, 0);
});

test('rapid toggle reverses continuously and reaches exact base', () => {
  const { mainMaterial: main, animation: fx } = setup();
  const original = snapshot(main);
  fx.update(.12, true, 1); const mix = fx.mix;
  fx.update(.001, false, 0); assert.ok(Math.abs(fx.mix - mix) < .001);
  fx.update(.06, true, 1); fx.update(1, false, 0);
  assert.deepEqual(snapshot(main), original);
});
