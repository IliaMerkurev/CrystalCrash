import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBonusVisuals} from '../src/bonus-visuals.js';
import {BonusWorld} from '../src/bonus-world.js';
import {BonusController, BONUS_DEFS} from '../src/bonus-controller.js';

const visuals = createBonusVisuals();
const accent = visuals.createBallAccent('pulse');
const {bands, aura} = accent.userData.pulseAnimation;
assert.equal(bands.length, 2);
assert.equal(accent.children.length, 3, 'bounded two-band and single-aura graph');
assert.equal(bands[0].children.length, 2, 'each band has a soft halo and a bright core');
assert.equal(bands[0].children[0].geometry, bands[1].children[0].geometry);
assert.equal(bands[0].children[1].geometry, bands[1].children[1].geometry);
for (const band of bands) for (const mesh of band.children) {
  const {radius, tube, arc} = mesh.geometry.parameters;
  assert(radius - tube > .58, 'luminous band is fully outside the .5-radius ball');
  assert.equal(arc, Math.PI * 2, 'complete bands are visible from every viewing angle');
  assert.equal(mesh.material.blending, THREE.AdditiveBlending);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.depthTest, true, 'ball and scenery still occlude the light');
  assert.equal(mesh.material.toneMapped, false);
  assert(mesh.material.color.r > mesh.material.color.g * 1.5, 'warm amber remains colored');
}
const image = aura.material.map.image;
const alphaAt = (x, y) => image.data[(y * image.width + x) * 4 + 3];
assert.equal(alphaAt(31, 31), 0, 'aura center is transparent, preserving the metal ball');
assert.equal(alphaAt(0, 0), 0);
assert(alphaAt(52, 31) > 230, 'soft ring is bright outside the ball silhouette');
assert(aura.scale.x > 1.7 && aura.scale.x < 2);
const geometry = bands[0].children[1].geometry, material = bands[0].children[1].material;
const beforeScale = bands[0].scale.x, beforeOpacity = material.opacity;
visuals.animateBallAccent(accent, .6);
assert.notEqual(bands[0].scale.x, beforeScale, 'active cue breathes');
assert.equal(material.opacity, beforeOpacity, 'animation never mutates shared materials');
assert.equal(bands[0].children[1].geometry, geometry);
for (let i = 0; i < 100; i++) {
  visuals.animateBallAccent(accent, i * .17);
  assert(bands.every(b => b.scale.x > .93 && b.scale.x < 1.04), 'breathing stays gentle');
}

// All new resources appear in startup warmup and remain shared across repeated
// accent construction. Releasing temporary objects must not dispose live assets.
let released = 0;
const resources = new Set([aura.material.map]);
accent.traverse(o => {
  if (o.geometry && !o.isSprite) resources.add(o.geometry); // Sprite's quad is Three.js-owned.
  if (o.material) resources.add(o.material);
});
for (const resource of resources) resource.addEventListener('dispose', () => released++);
for (let i = 0; i < 12; i++) {
  const next = visuals.createBallAccent('pulse');
  assert.equal(next.userData.pulseAnimation.bands[0].children[1].geometry, geometry);
  assert.equal(next.userData.pulseAnimation.bands[0].children[1].material, material);
  assert.equal(next.userData.pulseAnimation.aura.material, aura.material);
  visuals.releaseInstance(next);
}
const warmup = visuals.warmupObjects();
const warmedAccent = warmup.getObjectByName('ball-accent-pulse');
assert(warmedAccent?.visible);
const warmed = new Set();
warmedAccent.traverse(o => {
  if (o.geometry && !o.isSprite) warmed.add(o.geometry);
  if (o.material) warmed.add(o.material);
  if (o.material?.map) warmed.add(o.material.map);
});
assert.equal(warmed.size, resources.size);
for (const resource of resources) assert(warmed.has(resource), 'startup draws each new shared resource');
visuals.releaseInstance(warmup);
assert.equal(released, 0, 'warmup cleanup leaves live shared assets intact');
visuals.dispose();
assert.equal(released, resources.size, 'factory cleanup releases every Pulse resource once');
visuals.dispose();
assert.equal(released, resources.size, 'cleanup is idempotent');

function element() {
  return {children: [], style: {setProperty() {}}, append(...items) {this.children.push(...items);},
    appendChild(item) {this.children.push(item);}, replaceChildren(...items) {this.children = items;},
    setAttribute() {}};
}
globalThis.document = {body: element(), createElement: element, createTextNode: text => ({textContent: text})};
const controller = new BonusController(), scene = new THREE.Scene();
const world = new BonusWorld({scene, controller, radius: .38,
  bounds: () => ({top: -10, mid: 0, bottom: 10, half: () => 5}),
  blocked: () => false, onSound() {}, onNotice() {}});
const camera = new THREE.PerspectiveCamera(), point = new THREE.Vector3(1, .38, -2);
const live = world.accents.pulse, liveData = live.userData.pulseAnimation;
world.render(camera, point);
assert.equal(live.visible, false);
controller.collect('pulse');
controller.collect('pierce');
world.render(camera, point);
assert.equal(live.visible, true);
assert.equal(world.accents.pierce.visible, true, 'other active bonuses remain visible');
assert.deepEqual(live.position.toArray(), point.toArray());
assert.equal(live.scale.x, .76, 'accent preserves ball-diameter scaling');
const initial = liveData.bands[0].scale.x;
world.time = .6;
world.render(camera, point);
assert.notEqual(liveData.bands[0].scale.x, initial, 'production render calls Pulse animation');
for (const kind of Object.keys(BONUS_DEFS).filter(k => k !== 'pulse')) {
  assert.equal(world.accents[kind].userData.pulseAnimation, undefined, 'other accents are unchanged');
}
controller.tick(BONUS_DEFS.pulse.duration);
world.render(camera, point);
assert.equal(live.visible, false, 'Pulse cue switches off immediately at timed expiry');
assert.equal(world.accents.pierce.visible, true, 'Pierce exit lifetime remains independent');
controller.collect('pulse');
world.render(camera, point);
assert.equal(live.visible, true);
assert.equal(live.userData.pulseAnimation, liveData, 'reactivation reuses the same objects');
world.reset();
world.render(camera, point);
assert.equal(live.visible, false);
const pink = new THREE.Color(0xf27ed2);
const makeEcho = i => ({valid: true, removed: false, isHeld: i === 0, staged: i === 1,
  mesh: {material: {color: pink}}, b: {isValid: () => true, translation: () => ({x: i * .8, y: .38, z: -i * .1})}});
const extras = Array.from({length: 242}, (_, i) => makeEcho(i));
const position = new THREE.Vector3(), matrix = new THREE.Matrix4();
controller.collect('pulse');
world.render(camera, point, extras.slice(0, 2));
let batch = world.extraPulse, data = batch.userData.pulseBatch;
assert.equal(batch.children.length, 3, 'three draws cover every extra ball');
assert.equal(data.core.count, 4);
assert.equal(data.halo.count, 4);
assert.equal(data.aura.count, 2, 'held and staged extras both retain the active cue');
assert.equal(data.core.geometry, liveData.bands[0].children[1].geometry);
assert.equal(data.core.material, liveData.bands[0].children[1].material);
assert.equal(data.halo.geometry, liveData.bands[0].children[0].geometry);
assert.equal(data.aura.material.map, liveData.aura.material.map);
let oldDisposals = 0;
for (const mesh of batch.children) mesh.addEventListener('dispose', () => oldDisposals++);
world.render(camera, point, extras.slice(0, 80));
assert.equal(oldDisposals, 3, 'growth frees old instance buffers');
assert.equal(batch.parent, null);
batch = world.extraPulse; data = batch.userData.pulseBatch;
assert.equal(data.capacity, 128);
assert.equal(data.core.count, 160);
assert.equal(data.halo.count, 160);
assert.equal(data.aura.count, 80);
assert.equal(batch.children.length, 3, '81-ball population does not add draw calls');
for (let i = 0; i < 80; i++) for (const component of [data.core, data.halo, data.aura]) {
  component.getMatrixAt(component === data.aura ? i : i * 2, matrix);
  position.setFromMatrixPosition(matrix);
  const p = extras[i].b.translation();
  assert(position.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-5, 'each instance follows its own body');
  assert(matrix.elements.every(Number.isFinite));
}
live.updateMatrix();liveData.bands[0].updateMatrix();
const expected = new THREE.Matrix4().multiplyMatrices(live.matrix, liveData.bands[0].matrix).setPosition(0, 0, 0);
data.core.getMatrixAt(0, matrix);matrix.setPosition(0, 0, 0);
for (let i = 0; i < 16; i++) assert(Math.abs(matrix.elements[i] - expected.elements[i]) < 1e-6, 'extras copy the main cue size, rotation and breathing');
world.render(camera, point, extras.slice(0, 2));
assert.equal(world.extraPulse, batch, 'smaller populations reuse the expanded pool');
assert.equal(data.core.count, 4);
world.render(camera, point, [extras[0], {...extras[1], removed: true}, {...extras[2], valid: false},
  {valid: true, b: {isValid: () => false, translation: () => assert.fail('invalid body read')}}, extras[1]]);
assert.equal(data.aura.count, 2, 'removed and invalid bodies are skipped');
world.render(camera, point, extras);
batch = world.extraPulse; data = batch.userData.pulseBatch;
assert.equal(data.capacity, 256);
assert.equal(data.aura.count, 242, '243-ball population is not silently capped');
assert.equal(data.core.count, 484);
assert.equal(batch.children.length, 3);
assert.equal(extras[0].mesh.material.color.getHex(), 0xf27ed2, 'pink extra-ball material stays unchanged');

const warm = world.warmupObjects(), warmedBatch = warm.getObjectByName('pulse-extra-accents');
assert(warmedBatch?.visible);
for (const mesh of warmedBatch.children) assert(mesh.isInstancedMesh && mesh.count > 0);
assert.equal(warmedBatch.userData.pulseBatch.aura.material, data.aura.material);
const shader = {vertexShader: '#include <project_vertex>'};
data.aura.material.onBeforeCompile(shader);
assert(shader.vertexShader.includes('modelViewMatrix * instanceMatrix'));
assert(shader.vertexShader.includes('mvPosition.xy += position.xy * pulseSize'));
assert.equal(data.aura.material.customProgramCacheKey(), 'pulse-instanced-aura-v1');
world.visuals.releaseInstance(warm);
assert.equal(data.released, false, 'warmup cleanup does not release the live batch');
controller.tick(BONUS_DEFS.pulse.duration);
world.render(camera, point, extras);
assert.equal(batch.visible, false);
assert.equal(data.core.count + data.halo.count + data.aura.count, 0, 'expiry removes every extra cue immediately');
controller.collect('pulse');world.render(camera, point, extras.slice(0, 2));
assert.equal(world.extraPulse, batch);
assert.equal(data.aura.count, 2, 'reactivation reuses the existing expanded pool');
world.reset({preservePowers: true});
assert.equal(batch.visible, false);
assert.equal(data.aura.count, 0, 'section reset clears stale instances');
world.render(camera, point, extras.slice(0, 2));
assert.equal(data.aura.count, 2, 'preserved active power resumes on the current live population');
let finalDisposals = 0;
for (const mesh of batch.children) mesh.addEventListener('dispose', () => finalDisposals++);
world.dispose();world.dispose();
assert.equal(finalDisposals, 3, 'world disposal releases each instance buffer once');
assert.equal(data.released, true);
assert.equal(batch.parent, null);
assert.equal(scene.children.length, 0, 'world disposal removes its pooled render objects');

console.log('PASS Pulse accent: large amber bands, hollow soft glow, gentle breathing, pooled resources, warmup/disposal, active/expiry/reset and concurrent-bonus isolation');
console.log('PASS all-ball Pulse: 2/80/242 extras, three draws, shared visual resources, matching transforms, invalid filtering, uncapped pool growth/reuse, shader warmup and expiry/reset/disposal');
