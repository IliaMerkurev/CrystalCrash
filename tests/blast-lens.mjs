// Focused CPU/mock-renderer checks. These do not claim browser/GPU visual QA.
// Run: node --test tests/blast-lens.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import { BlastLens, BLAST_LENS_LIMITS } from '../src/blast-lens.js';
import { BlackHoleLens } from '../src/blackhole-lens.js';

function mockRenderer(width = 1200, height = 800) {
 return {
  width, height, autoClear: true, copies: 0, draws: 0, inits: 0, compiles: 0,
  error: 0, checks: 0,
  getDrawingBufferSize(out) { return out.set(this.width, this.height); },
  initTexture(texture) { this.inits++; this.initialized = texture; },
  async compileAsync(scene, camera) { this.compiles++; this.compiledScene = scene; this.compiledCamera = camera; },
  copyFramebufferToTexture(texture, zero) {
   this.copies++;
   this.copied = texture;
   assert.equal(zero.x, 0); assert.equal(zero.y, 0);
   if (this.copyThrows) throw new Error('copy failed');
  },
  getContext() {
   this.context ??= { NO_ERROR: 0, getError: () => { this.checks++; return this.error; } };
   return this.context;
  },
  render(scene, camera) {
   assert.equal(this.autoClear, false, 'post-copy draw must preserve the original frame');
   this.draws++; this.renderedScene = scene; this.renderedCamera = camera;
   if (this.drawThrows) throw new Error('draw failed');
  },
 };
}

function camera(aspect = 1.5) {
 const result = new THREE.PerspectiveCamera(42, aspect, .1, 200);
 result.position.set(0, 0, 10);
 result.lookAt(0, 0, 0);
 result.updateProjectionMatrix(); result.updateMatrixWorld();
 return result;
}

const origin = new THREE.Vector3();
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
 `${actual} differs from ${expected}`);

test('Idle, warmup, clear and expired lenses never copy or draw the frame', async () => {
 const r = mockRenderer(), lens = new BlastLens(r), view = camera();
 assert.equal(lens.active, false);
 lens.update(.1); assert.equal(lens.render(view), false);
 await lens.warm();
 assert.equal(r.compiles, 1); assert.equal(r.compiledScene, lens.scene); assert.equal(r.compiledCamera, lens.camera);
 assert.equal(r.copies, 0); assert.equal(r.draws, 0);
 lens.trigger(origin, 2); lens.update(.1);
 assert.equal(lens.render(view), true);
 assert.equal(r.copies, 1); assert.equal(r.draws, 1);
 assert.equal(r.renderedScene, lens.scene); assert.equal(r.renderedCamera, lens.camera);
 assert.equal(r.autoClear, true);
 lens.clear(); assert.equal(lens.render(view), false);
 lens.trigger(origin, 2); lens.update(10); assert.equal(lens.render(view), false);
 assert.equal(r.copies, 1); assert.equal(r.draws, 1);
 assert.equal(lens.age, BLAST_LENS_LIMITS.duration);
 assert.equal(lens.material.uniforms.strength.value, 0);
});

test('Lifetime is 0.64 seconds of simulation time; pause and invalid dt freeze exactly', () => {
 const lens = new BlastLens(mockRenderer()), u = lens.material.uniforms;
 assert.ok(BLAST_LENS_LIMITS.duration >= .55 && BLAST_LENS_LIMITS.duration <= .7);
 lens.trigger(origin, 2); lens.update(.08);
 assert.equal(u.strength.value, 1);
 const age = lens.age, progress = u.progress.value, strength = u.strength.value;
 for (const dt of [0, -1, NaN, Infinity, -Infinity]) lens.update(dt);
 assert.equal(lens.age, age); assert.equal(u.progress.value, progress); assert.equal(u.strength.value, strength);
 for (let i = 0; i < 100; i++) lens.render(camera());
 assert.equal(lens.age, age, 'rendering cannot advance the simulation clock');
 lens.update(.32);
 assert.ok(u.strength.value > 0 && u.strength.value < 1);
 lens.update(.239);
 assert.equal(lens.active, true);
 assert.ok(u.strength.value < .0001);
 lens.update(.0011);
 assert.equal(lens.active, false); assert.equal(u.progress.value, 1); assert.equal(u.strength.value, 0);
});

test('Repeated bombs replace one bounded transient and copy point values without retaining caller mutation', () => {
 const r = mockRenderer(), lens = new BlastLens(r), point = new THREE.Vector3(1, 2, 3);
 const texture = lens.texture, mesh = lens.mesh, geometry = mesh.geometry, material = mesh.material;
 const center = material.uniforms.center.value, halfTexel = material.uniforms.halfTexel.value;
 assert.equal(lens.trigger(point, 2), true);
 point.set(50, 60, 70);
 assert.deepEqual(lens.point.toArray(), [1, 2, 3]);
 for (let i = 0; i < 100; i++) {
  lens.trigger(origin, 2); lens.update(.025); lens.render(camera());
  assert.ok(material.uniforms.strength.value <= 1);
 }
 assert.equal(lens.texture, texture); assert.equal(lens.mesh, mesh); assert.equal(lens.mesh.geometry, geometry);
 assert.equal(lens.material, material); assert.equal(material.uniforms.center.value, center);
 assert.equal(material.uniforms.halfTexel.value, halfTexel); assert.equal(r.inits, 1);
 assert.equal(lens.scene.children.length, 1); assert.equal(lens.age, .025);
 const age = lens.age;
 for (const radius of [0, -1, NaN, Infinity]) assert.equal(lens.trigger(origin, radius), false);
 for (const point of [null, {}, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }]) {
  assert.equal(lens.trigger(point, 2), false);
 }
 assert.equal(lens.age, age, 'invalid requests do not alter the existing transient');
});

test('Framebuffer copy uses the safe RGBA8/NoColorSpace path and preserves encoded RGB/original alpha', () => {
 const r = mockRenderer(), lens = new BlastLens(r), texture = lens.texture, m = lens.material;
 assert.ok(texture.isFramebufferTexture);
 assert.equal(texture.colorSpace, THREE.NoColorSpace);
 assert.equal(texture.format, THREE.RGBAFormat);
 assert.equal(texture.type, THREE.UnsignedByteType);
 assert.equal(texture.internalFormat, null, 'leave RGBA8 storage selection to THREE');
 assert.equal(texture.minFilter, THREE.LinearFilter); assert.equal(texture.magFilter, THREE.LinearFilter);
 assert.equal(texture.generateMipmaps, false);
 assert.equal(m.toneMapped, false); assert.equal(m.blending, THREE.NoBlending);
 assert.equal(m.transparent, false); assert.equal(m.depthTest, false); assert.equal(m.depthWrite, false);
 assert.match(m.fragmentShader, /vec4 original = texture2D\(frame, vUv\)/);
 assert.match(m.fragmentShader, /gl_FragColor = vec4\(refracted\.rgb, original\.a\)/);
 assert.doesNotMatch(m.fragmentShader, /#include|LinearToSRGB|sRGBTransfer|pow\(/);
 assert.deepEqual(m.uniforms.halfTexel.value.toArray(), [.5 / 1200, .5 / 800]);
 lens.trigger(origin, 2); lens.update(.1); lens.render(camera());
 assert.equal(r.copied, texture); assert.equal(m.uniforms.frame.value, texture);
});

test('Identity diagnostic keeps the same bounded copy/draw path with exactly zero warp', () => {
 const r = mockRenderer(), lens = new BlastLens(r, { identity: true });
 lens.trigger(origin, 2);
 for (let i = 0; i < 30; i++) {
  lens.update(1 / 120);
  assert.equal(lens.material.uniforms.strength.value, 0);
  assert.equal(lens.render(camera()), true);
 }
 assert.equal(r.copies, 30); assert.equal(r.draws, 30);
 assert.equal(r.checks, 1, 'validate each texture copy path once, not each frame');
});

test('Projection follows arena offset and camera rotation, with circular and local bounds in both orientations', () => {
 for (const [width, height] of [[1600, 900], [900, 1600], [100, 2000]]) {
  const r = mockRenderer(width, height), lens = new BlastLens(r), view = camera(width / height);
  view.position.set(3, 7, 14); view.lookAt(0, 0, -1); view.updateMatrixWorld();
  const point = new THREE.Vector3(.5, 1, 2), worldPoint = point.clone().add(new THREE.Vector3(0, 0, -3));
  const projected = worldPoint.clone().project(view);
  lens.trigger(point, 2); lens.update(.1); assert.equal(lens.render(view, -3), true);
  const u = lens.material.uniforms;
  near(u.center.value.x, (projected.x + 1) * .5); near(u.center.value.y, (projected.y + 1) * .5);
  near(u.aspect.value, width / height);
  const expected = new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 0)
   .multiplyScalar(2).add(worldPoint).project(view);
  const short = Math.min(1, width / height);
  near(u.radius.value, THREE.MathUtils.clamp(Math.hypot((expected.x - projected.x) * width / height,
   expected.y - projected.y) * .5, BLAST_LENS_LIMITS.minScreenRadius * short,
   BLAST_LENS_LIMITS.maxScreenRadius * short));
  near(u.radius.value / u.aspect.value * width, u.radius.value * height, 1e-8);
  lens.trigger(origin, 1e6); lens.update(.1); lens.render(view);
  assert.ok(u.radius.value <= BLAST_LENS_LIMITS.maxScreenRadius * short);
  assert.ok(u.radius.value * 2 <= .64 && u.radius.value / u.aspect.value * 2 <= .64,
   'even extreme radius cannot become a whole-screen effect');
  lens.trigger(origin, 1e-8); lens.update(.1); lens.render(view);
  near(u.radius.value, BLAST_LENS_LIMITS.minScreenRadius * short);
 }
});

test('Behind-camera, fully offscreen and invalid-offset events skip framebuffer work', () => {
 const r = mockRenderer(), lens = new BlastLens(r), view = camera();
 for (const point of [new THREE.Vector3(0, 0, 20), new THREE.Vector3(100, 0, 0), new THREE.Vector3(0, 100, 0)]) {
  lens.trigger(point, 2); lens.update(.1); assert.equal(lens.render(view), false);
 }
 lens.trigger(origin, 2); lens.update(.1);
 assert.equal(lens.render(view, NaN), false); assert.equal(lens.render(view, Infinity), false);
 assert.equal(r.copies, 0); assert.equal(r.draws, 0);
});

test('Shader has a rapidly expanding narrow annulus, bounded heat shimmer and hard local support', () => {
 const lens = new BlastLens(mockRenderer()), source = lens.material.fragmentShader;
 assert.match(source, /if \(q >= 1\.\) discard/);
 assert.match(source, /waveRadius = \.10 \+ \.90 \* \(1\. - \(1\. - progress\) \* \(1\. - progress\)\)/);
 assert.match(source, /waveWidth = \.055 \+ \.02 \* progress/);
 assert.match(source, /abs\(waveDistance\)/);
 assert.match(source, /sin\(waveDistance \* 3\.14159265\) \* ring/);
 assert.match(source, /displacement \*= boundary \* strength/);
 assert.match(source, /maxDisplacement \/ max\(length\(displacement\), \.00001\)/);
 assert.match(source, /clamp\(vUv \+ displacement \/ scale, halfTexel, vec2\(1\.\) - halfTexel\)/);
 assert.equal(lens.material.uniforms.maxDisplacement.value, .006);
 // Contract math mirrors the tested shader constants; it is not a GPU render.
 const wave = progress => .1 + .9 * (1 - (1 - progress) ** 2);
 let previous = wave(0);
 for (let i = 1; i <= 100; i++) {
  const progress = i / 100, radius = wave(progress);
  assert.ok(radius > previous && radius <= 1);
  assert.ok(.055 + .02 * progress <= .075000001);
  previous = radius;
 }
 assert.ok(wave(.25) > .49, 'wave crosses almost half its radius in its first 0.16 seconds');
});

test('Resize replaces and disposes only the framebuffer texture, with refreshed sample bounds', () => {
 const r = mockRenderer(), lens = new BlastLens(r), first = lens.texture, material = lens.material;
 let disposed = 0; first.addEventListener('dispose', () => disposed++);
 r.width = 600; r.height = 1000;
 lens.render(camera()); assert.equal(r.inits, 1, 'idle resize does not do lens GPU work');
 lens.trigger(origin, 2); lens.update(.1); lens.render(camera(.6));
 assert.equal(disposed, 1); assert.notEqual(lens.texture, first); assert.equal(lens.material, material);
 assert.equal(lens.texture.image.width, 600); assert.equal(lens.texture.image.height, 1000);
 assert.deepEqual(material.uniforms.halfTexel.value.toArray(), [.5 / 600, .5 / 1000]);
 assert.equal(r.inits, 2); assert.equal(r.checks, 1);
 lens.render(camera(.6)); assert.equal(r.inits, 2); assert.equal(r.checks, 1);
});

test('Copy-path GL errors fail closed without drawing a black frame and restore autoClear', () => {
 const r = mockRenderer(), lens = new BlastLens(r), warn = console.warn, messages = [];
 r.error = 1282; lens.trigger(origin, 2); lens.update(.1);
 try {
  console.warn = (...args) => messages.push(args);
  assert.equal(lens.render(camera()), false);
  assert.equal(lens.copyFailed, true); assert.equal(r.copies, 1); assert.equal(r.draws, 0);
  assert.equal(r.autoClear, true); assert.equal(lens.render(camera()), false);
  assert.equal(r.copies, 1); assert.equal(messages.length, 1);
  r.width = 800; r.error = 0;
  assert.equal(lens.render(camera()), true, 'a fresh resized texture may validate again');
  assert.equal(r.draws, 1); assert.equal(r.autoClear, true);
 } finally { console.warn = warn; }
});

test('Exceptional copy/draw paths restore renderer state, including an initially disabled autoClear', () => {
 for (const initial of [false, true]) for (const error of ['copyThrows', 'drawThrows']) {
  const r = mockRenderer(), lens = new BlastLens(r); r.autoClear = initial; r[error] = true;
  lens.trigger(origin, 2); lens.update(.1);
  assert.throws(() => lens.render(camera()), /failed/);
  assert.equal(r.autoClear, initial);
  if (error === 'copyThrows') assert.equal(r.draws, 0);
 }
});

test('Production final render stage composes scene, Black Hole copy/draw, then Blast copy/draw', async () => {
 const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
 const stage = source.match(/renderer\.render\(scene,camera\);[^\n]*?blastLens\?\.render\(camera,arenaOffset\);/);
 assert.ok(stage, 'production rendering must contain the Blast lens stage');
 const renderer = mockRenderer(), scene = new THREE.Scene(), view = camera();
 const blackHoleLens = new BlackHoleLens(renderer), blastLens = new BlastLens(renderer), order = [];
 blastLens.trigger(origin, 2); blastLens.update(.1);
 renderer.copyFramebufferToTexture = texture => {
  order.push(texture === blackHoleLens.texture ? 'Black Hole copy' : 'Blast copy');
  assert.equal(renderer.autoClear, true, 'previous lens must restore state before the next copy');
 };
 renderer.render = drawScene => {
  if (drawScene === scene) {
   assert.equal(renderer.autoClear, true); order.push('scene');
  } else {
   assert.equal(renderer.autoClear, false);
   order.push(drawScene === blackHoleLens.scene ? 'Black Hole draw' : 'Blast draw');
  }
 };
 const context = vm.createContext({ renderer, scene, camera: view, blackHoleLens, blastLens,
  arenaOffset: 0, QA_LENS_OFF: false, secondary: { blackHole: { point: origin, intensity: 1, range: 2 } } });
 vm.runInContext(stage[0], context);
 assert.deepEqual(order, ['scene', 'Black Hole copy', 'Black Hole draw', 'Blast copy', 'Blast draw']);
 assert.equal(renderer.autoClear, true);
 order.length = 0; blastLens.clear(); vm.runInContext(stage[0], context);
 assert.deepEqual(order, ['scene', 'Black Hole copy', 'Black Hole draw'], 'idle Blast adds no render work');
 blackHoleLens.dispose(); blastLens.dispose();
});

test('Dispose is idempotent, releases all owned GPU resources and cannot reactivate', async () => {
 const r = mockRenderer(), lens = new BlastLens(r);
 const disposed = { texture: 0, geometry: 0, material: 0 };
 lens.texture.addEventListener('dispose', () => disposed.texture++);
 lens.mesh.geometry.addEventListener('dispose', () => disposed.geometry++);
 lens.material.addEventListener('dispose', () => disposed.material++);
 lens.trigger(origin, 2); lens.update(.1); lens.dispose(); lens.dispose();
 assert.deepEqual(disposed, { texture: 1, geometry: 1, material: 1 });
 assert.equal(lens.active, false); assert.equal(lens.trigger(origin, 2), false);
 lens.update(.1); assert.equal(lens.render(camera()), false); await lens.warm();
 assert.equal(r.copies, 0); assert.equal(r.draws, 0); assert.equal(r.compiles, 0);
});
