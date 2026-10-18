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
world.visuals.dispose();

console.log('PASS Pulse accent: large amber bands, hollow soft glow, gentle breathing, pooled resources, warmup/disposal, active/expiry/reset and concurrent-bonus isolation');
