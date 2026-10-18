import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {BonusController, BONUS_DEFS} from '../src/bonus-controller.js';
import {BonusWorld} from '../src/bonus-world.js';

const hit = (powers, id, time) => powers.consumeDirect(powers.capture(), id, time);

test('Pulse applies three direct damage and an uncapped doubled-radius burst', () => {
  const powers = new BonusController();
  powers.collect('pulse');
  powers.collect('heavy');
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 1, 5);
  assert.equal(result.damage, 3);
  assert.deepEqual(result.effect, {kind: 'pulse', originId: 1, radiusD: 4.4, maxTargets: Infinity, damage: 3});
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.consumeDirect(batch, 2, 5).damage, 1);
  assert.equal(powers.active.kind, 'heavy', 'a batch cannot spend its queued power');
  assert.equal(hit(powers, 3, 6).damage, 3);
});

test('Pierce waits for first impact, hits unlimited distinct originals, then exits safely', () => {
  const powers = new BonusController();
  powers.collect('pierce');
  powers.collect('heavy');
  powers.tick(100);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  assert.equal(powers.snapshotHUD().active.remaining, null);
  const batch = powers.capture();
  for (let id = 0; id < 100; id++) {
    const result = powers.consumeDirect(batch, id, 100 + id / 100);
    assert.equal(result.damage, 8);
    assert.equal(result.suppressReflection, true);
    assert.equal(result.pierceExit, false);
  }
  assert.equal(hit(powers, 1, 102).damage, 0, 'a previously hit original is not hit twice');
  powers.tick(109.99);
  assert.equal(powers.pierceExit, false);
  powers.tick(110);
  assert.equal(powers.pierceExit, true);
  assert.equal(hit(powers, 101, 110).damage, 0);
  assert.equal(powers.active.kind, 'pierce');
  assert.equal(powers.finishPierceExit(), true);
  assert.equal(powers.suppressReflection, false);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.finishPierceExit(), false);
});

test('Frost marks without a hit cap for 10s, with per-impact brittle expiry', () => {
  const powers = new BonusController();
  powers.collect('frost');
  powers.collect('heavy');
  powers.tick(80);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  for (let id = 0; id < 50; id++) {
    const result = hit(powers, id, 80 + id / 10);
    assert.equal(result.damage, 1);
    assert.equal(result.effect.kind, 'frost');
  }
  assert.equal(powers.active.kind, 'frost');
  assert.equal(powers.frostMarks.size, 50);
  const brittle = hit(powers, 0, 85);
  assert.equal(brittle.damage, 2);
  assert.equal(brittle.frostConsumed, true);
  assert.equal(brittle.effect, null);
  assert.equal(powers.frostMarks.has(0), false);
  assert.equal(hit(powers, 0, 86).effect.expiresAt, 96, 'a surviving original can be marked again');
  powers.tick(90);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.frostMarks.has(49), true, 'later marks outlive activation until their own expiry');
  assert.equal(hit(powers, 49, 90).damage, 4, 'queued Heavy consumes brittle as one bonus damage');
  powers.tick(96);
  assert.equal(powers.frostMarks.size, 0);
});

test('Split runs independently of FIFO until loss, and rejects duplicate live/queued pickups', () => {
  const powers = new BonusController();
  powers.collect('split');
  assert.equal(powers.collect('split').accepted, false);
  powers.collect('frost');
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 1, 5);
  assert.equal(result.effect.persistent, true);
  assert.equal('duration' in result.effect, false);
  assert.equal('hitsPerEcho' in result.effect, false);
  assert.equal(powers.active.kind, 'frost');
  assert.equal(powers.splitActive, true);
  assert.equal(powers.consumeDirect(batch, 2, 5).effect, null);
  assert.equal(powers.active.startedAt, null);
  assert.equal(powers.collect('split').accepted, false);
  assert.equal(powers.collect('halo').accepted, true);
  powers.tick(1_000);
  assert.equal(powers.splitActive, true, 'live extra balls have no timer');
  assert.equal(powers.finishSplit(result.effect.activationId + 1), false);
  assert.equal(powers.finishSplit(result.effect.activationId), true);
  assert.equal(powers.active.kind, 'frost', 'ending extra balls does not advance FIFO');
  assert.equal(powers.collect('split').accepted, true);
  assert.equal(powers.collect('split').accepted, false);
});

test('Arc and Gravity describe the strengthened effects', () => {
  const powers = new BonusController();
  powers.collect('arc');
  assert.deepEqual(hit(powers, 10, 1).effect, {kind: 'arc', originId: 10, arenaWide: true, targetType: 'bottom-support-original', damage: 1});
  powers.collect('gravity');
  assert.deepEqual(hit(powers, 11, 2).effect, {kind: 'gravity', originId: 11, radiusD: 6, duration: 4, maxTargets: 12, accelerationD: 35, maxDeltaSpeedD: 24, targetType: 'intact-cube'});
  assert.equal(BONUS_DEFS.split.duration, undefined);
  assert.equal(BONUS_DEFS.split.hitsPerEcho, undefined);
});

test('Halo remains independent and reset clears all powers and stale contact tokens', () => {
  const powers = new BonusController();
  powers.collect('split');
  hit(powers, 0, 1);
  powers.collect('pierce');
  powers.collect('arc');
  powers.collect('halo');
  assert.equal(powers.collect('halo').accepted, false);
  assert.equal(powers.consumeHalo(), true);
  assert.equal(powers.consumeHalo(), false);
  const stale = powers.capture();
  powers.reset();
  assert.equal(powers.consumeDirect(stale, 100, 2).damage, 0);
  assert.equal(powers.active, null);
  assert.equal(powers.queued, null);
  assert.equal(powers.halo, false);
  assert.equal(powers.splitActive, false);
  assert.equal(powers.splitActivationId, null);
  assert.equal(powers.frostMarks.size, 0);
});

function element() {
  return {children: [], attributes: {}, style: {setProperty() {}}, textContent: '',
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }};
}
globalThis.document = {body: element(), createElement: element, createTextNode: text => ({textContent: text})};
const textOf = node => node.textContent + (node.children || []).map(textOf).join('');
function makeWorld() {
  const controller = new BonusController();
  const world = new BonusWorld({scene: new THREE.Scene(), controller, radius: .38,
    bounds: () => ({top: -10, mid: 0, bottom: 10, half: () => 5}), blocked: () => false,
    onSound() {}, onNotice() {}});
  return {world, controller};
}

test('Section reset preserves powers/FIFO/Halo and timers, while clearing physical pickups', () => {
  const {world, controller} = makeWorld();
  controller.collect('split');
  hit(controller, 1, 1);
  controller.collect('frost');
  hit(controller, 2, 20);
  controller.collect('pierce');
  controller.collect('halo');
  controller.tick(23);
  const before = controller.snapshotHUD();
  world.release({id: 40, bonus: 'pulse'});
  assert.equal(world.pickups.length, 1);
  world.reset({preservePowers: true});
  assert.deepEqual(controller.snapshotHUD(), before);
  assert.equal(world.pickups.length, 0);
  controller.tick(23);
  assert.equal(controller.snapshotHUD().active.secondsLeft, 7);
  world.reset({run: true});
  assert.equal(controller.active, null);
  assert.equal(controller.queued, null);
  assert.equal(controller.halo, false);
  assert.equal(controller.splitActive, false);
});

test('HUD uses timed seconds and persistent Split text rather than spent charges', () => {
  const {world, controller} = makeWorld();
  controller.collect('split');
  hit(controller, 1, 0);
  controller.collect('pierce');
  controller.collect('frost');
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · HIT GLASS · 10s/);
  assert.match(textOf(world.hud), /NEXT · Frost · 10s/);
  assert.match(textOf(world.hud), /SPLIT · EXTRA BALLS LIVE/);
  assert.doesNotMatch(textOf(world.hud), /SPLIT[^∩]*10s/);
  hit(controller, 2, 0);
  controller.tick(3);
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · ACTIVE · 7s/);
  controller.tick(10);
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · EXITING/);
  controller.finishPierceExit();
  hit(controller, 3, 10);
  controller.tick(12);
  world.updateHUD();
  assert.match(textOf(world.hud), /FROST · MARKING · 8s/);
});

test('Arc links all 64 targets with finite jagged forks in one bounded mesh', () => {
  const {world} = makeWorld();
  const origin = new THREE.Vector3(0, .5, 0);
  const targets = Array.from({length: 64}, (_, i) => new THREE.Vector3((i % 8) - 4, .5, -1 - Math.floor(i / 8)));
  assert.equal(world.arcTargets(origin, targets), 64);
  assert.equal(world.arcs.filter(f => f.mesh.visible).length, 1);
  const fx = world.arcs[0], geometry = fx.mesh.geometry, positions = geometry.attributes.position;
  assert.equal(geometry.drawRange.count, 64 * 24);
  assert.equal(positions.count, 64 * 24);
  assert.ok([...positions.array].every(Number.isFinite));
  for (let i = 0; i < 64; i++) {
    const start = new THREE.Vector3().fromBufferAttribute(positions, i * 24);
    const end = new THREE.Vector3().fromBufferAttribute(positions, i * 24 + 15);
    assert.ok(start.distanceTo(origin) < 1e-6);
    assert.ok(end.distanceTo(targets[i]) < 1e-6);
  }
  assert.equal(world.arcTargets(origin, [...targets, origin]), 65);
  assert.equal(world.arc([origin, targets[0], targets[1]]), 2);
  world.update(.4, origin, new THREE.Vector3(), false, new Map());
  assert.equal(world.arcs.filter(f => f.mesh.visible).length, 0);
});

test('Arc covers all 110 targets in distinct pooled chunks even when the pool is full', () => {
  const {world} = makeWorld();
  const origin = new THREE.Vector3(0, .5, 0);
  const targets = Array.from({length: 110}, (_, i) => new THREE.Vector3((i % 11) - 5, .5, -1 - Math.floor(i / 11)));
  const meshes = world.arcs.map(f => f.mesh), sceneCount = world.scene.children.length;
  for (const fx of world.arcs) { fx.mesh.visible = true; fx.age = 0; fx.mesh.material.color.set(0xffffff); }
  assert.equal(world.arcTargets(origin, targets), 110);
  assert.deepEqual(world.arcs.map(f => f.mesh), meshes, 'no pool expansion or replacement meshes');
  assert.equal(world.scene.children.length, sceneCount);
  const chunks = world.arcs.filter(f => f.mesh.material.color.getHex() === 0xb68cff);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(f => f.mesh.geometry.drawRange.count), [64 * 24, 46 * 24]);
  let targetIndex = 0;
  for (const {mesh} of chunks) {
    const positions = mesh.geometry.attributes.position;
    assert.ok([...positions.array].every(Number.isFinite));
    for (let vertex = 0; vertex < mesh.geometry.drawRange.count; vertex += 24) {
      const start = new THREE.Vector3().fromBufferAttribute(positions, vertex);
      const end = new THREE.Vector3().fromBufferAttribute(positions, vertex + 15);
      assert.ok(start.distanceTo(origin) < 1e-6);
      assert.ok(end.distanceTo(targets[targetIndex++]) < 1e-6);
    }
  }
  assert.equal(targetIndex, 110);
});
