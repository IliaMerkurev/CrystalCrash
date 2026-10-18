// Run from the project root: node --test tests/camera-fx.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraFX, CAMERA_FX_LIMITS } from '../src/camera-fx.js';

const DT = 1 / 120;
const magnitude = pose => Math.hypot(pose.x, pose.y, pose.z);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
 `${actual} is not within ${tolerance} of ${expected}`);
const tick = (fx, seconds, options) => {
 let pose;
 for (let i = 0; i < Math.ceil(seconds / DT); i++) pose = fx.update(DT, options);
 return pose;
};

test('CameraFX starts/reset at exact zeros, reuses its result, and never accumulates drift', () => {
 const fx = new CameraFX();
 const result = fx.update(DT);
 assert.deepEqual(result, { x: 0, y: 0, z: 0, zoom: 0 });
 fx.pulse(); fx.bomb();
 assert.equal(fx.update(DT, { tornadoIntensity: 1, blackHoleIntensity: 1 }), result);
 assert.ok(magnitude(result) > 0);
 assert.equal(fx.reset(), result);
 assert.deepEqual(result, { x: 0, y: 0, z: 0, zoom: 0 });
 tick(fx, 20);
 assert.deepEqual(result, { x: 0, y: 0, z: 0, zoom: 0 });
 assert.deepEqual(Object.keys(result).sort(), ['x', 'y', 'z', 'zoom'].sort(), 'no rotation or yaw output');
});

test('Zero dt freezes shake, wind, zoom, phase, and envelopes exactly', () => {
 const fx = new CameraFX(); fx.bomb(); fx.pulse();
 tick(fx, .15, { tornadoIntensity: .7, blackHoleIntensity: .8 });
 const pose = { ...fx.offsets }, time = fx.time, bombAge = fx.bombAge, pulseAge = fx.pulseAge;
 for (let i = 0; i < 100; i++) assert.deepEqual(fx.update(0, { transition: true, reducedMotion: true }), pose);
 near(fx.time, time); near(fx.bombAge, bombAge); near(fx.pulseAge, pulseAge);
 assert.deepEqual(fx.update(NaN), pose);
 assert.deepEqual(fx.update(-1), pose);
 fx.update(DT, { tornadoIntensity: .7, blackHoleIntensity: .8 });
 assert.notDeepEqual(fx.offsets, pose);
});

test('Pulse spam has a cooldown, a sustained rate bound, and a small independent amplitude', () => {
 const fx = new CameraFX(); let accepted = 0, max = 0, quietFrames = 0;
 for (let i = 0; i < 1200; i++) {
  if (fx.pulse()) accepted++;
  assert.equal(fx.pulse(), false, 'same-event repeats are rejected');
  const pose = fx.update(DT);
  max = Math.max(max, magnitude(pose));
  if (magnitude(pose) < 1e-12) quietFrames++;
 }
 assert.ok(accepted >= 14 && accepted <= 17, `ten-second accepted count: ${accepted}`);
 assert.ok(max > .025 && max < .1, `bounded mini-shake peak: ${max}`);
 assert.ok(quietFrames > 600, 'sustained hit spam still has substantial quiet gaps');
 tick(fx, .3);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, zoom: 0 });
});

test('Bomb is stronger than Pulse, decays smoothly, and ends at zero', () => {
 const bomb = new CameraFX(), pulse = new CameraFX(); bomb.bomb(); pulse.pulse();
 let bombPeak = 0, pulsePeak = 0, latePeak = 0;
 for (let i = 0; i < 150; i++) {
  const b = magnitude(bomb.update(DT)), p = magnitude(pulse.update(DT));
  bombPeak = Math.max(bombPeak, b); pulsePeak = Math.max(pulsePeak, p);
  if (i > 90) latePeak = Math.max(latePeak, b);
 }
 assert.ok(bombPeak > pulsePeak * 3, `Bomb ${bombPeak}, Pulse ${pulsePeak}`);
 assert.ok(latePeak < bombPeak * .12, 'late envelope is substantially quieter');
 assert.deepEqual(bomb.offsets, { x: 0, y: 0, z: 0, zoom: 0 });
});

test('All effects and repeated Bomb triggers obey combined world-space and zoom bounds', () => {
 const fx = new CameraFX();
 for (let i = 0; i < 2400; i++) {
  fx.pulse(); if (i % 6 === 0) fx.bomb();
  const pose = fx.update(DT, { tornadoIntensity: 5, blackHoleIntensity: 5 });
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(pose[axis]) <= CAMERA_FX_LIMITS[axis] + 1e-12);
  assert.ok(magnitude(pose) <= CAMERA_FX_LIMITS.translation + 1e-12);
  assert.ok(pose.zoom >= 0 && pose.zoom <= .08);
 }
 tick(fx, 20);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, zoom: 0 }, 'combined effects leave no residual drift');
});

test('Black Hole zoom ramps in progressively and returns smoothly after expiry', () => {
 const fx = new CameraFX(); let previous = 0;
 for (let i = 0; i < 720; i++) {
  const intensity = Math.min(1, i * DT / 2);
  const pose = fx.update(DT, { blackHoleIntensity: intensity });
  assert.ok(pose.zoom >= previous - 1e-12);
  assert.ok(pose.zoom - previous < .001);
  previous = pose.zoom;
 }
 assert.ok(previous > .07 && previous <= .075);
 let returnStart = previous;
 for (let i = 0; i < 1200; i++) {
  const pose = fx.update(DT);
  assert.ok(pose.zoom <= previous + 1e-12);
  assert.ok(previous - pose.zoom < .001, 'expiry must not snap the camera back');
  previous = pose.zoom;
 }
 assert.equal(previous, 0);
 assert.ok(returnStart > .07);
});

test('Tornado is high-amplitude low-frequency sway without frame-level jitter', () => {
 const fx = new CameraFX(); tick(fx, 4, { tornadoIntensity: 1 });
 let prior = { ...fx.offsets }, peak = 0, crossings = 0;
 for (let i = 0; i < 1440; i++) {
  const p = fx.update(DT, { tornadoIntensity: 1 });
  peak = Math.max(peak, Math.abs(p.x));
  assert.ok(Math.hypot(p.x - prior.x, p.y - prior.y, p.z - prior.z) / DT < .4,
   'wind moves gently between samples');
  if (Math.sign(p.x) !== Math.sign(prior.x)) crossings++;
  prior = { ...p };
 }
 assert.ok(peak > .19, 'sway is broader than the mini-shake');
 assert.ok(crossings >= 2 && crossings <= 5, `only a few oscillations over 12 seconds: ${crossings}`);
});

test('Reduced motion strongly attenuates translation and zoom', () => {
 const regular = new CameraFX(), reduced = new CameraFX();
 regular.bomb(); reduced.bomb(); regular.pulse(); reduced.pulse();
 for (let i = 0; i < 240; i++) {
  const normal = regular.update(DT, { tornadoIntensity: 1, blackHoleIntensity: 1 });
  const small = reduced.update(DT, { tornadoIntensity: 1, blackHoleIntensity: 1, reducedMotion: true });
  for (const axis of ['x', 'y', 'z']) near(small[axis], normal[axis] * .08);
  near(small.zoom, normal.zoom * .12);
 }
});

test('Transition suppresses gracefully and ignores new impact shakes', () => {
 const fx = new CameraFX(); tick(fx, 3, { tornadoIntensity: 1, blackHoleIntensity: 1 });
 const before = { ...fx.offsets };
 const first = { ...fx.update(DT, { transition: true }) };
 assert.ok(magnitude(first) > 0, 'transition suppression is eased instead of snapping to zero');
 assert.ok(Math.hypot(first.x - before.x, first.y - before.y, first.z - before.z) < .03);
 assert.ok(first.zoom > before.zoom * .9 && first.zoom < before.zoom);
 assert.equal(fx.pulse(), false); assert.equal(fx.bomb(), false);
 tick(fx, 2, { transition: true });
 assert.ok(magnitude(fx.offsets) < 1e-6 && fx.offsets.zoom < 1e-6);
 tick(fx, 20);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, zoom: 0 });
});

test('Fixed simulation phase is deterministic and independent of random state', () => {
 const one = new CameraFX(), two = new CameraFX();
 for (let i = 0; i < 500; i++) {
  if (i % 77 === 0) { one.pulse(); two.pulse(); }
  if (i === 173) { one.bomb(); two.bomb(); }
  const options = { tornadoIntensity: i < 400 ? .8 : 0, blackHoleIntensity: i / 500 };
  assert.deepEqual(one.update(DT, options), two.update(DT, options));
 }
});


test('Idle poses use exact positive zeros at every phase and large steps finish transient shakes', () => {
 const fx = new CameraFX();
 for (let i = 0; i < 2000; i++) {
  assert.deepEqual(fx.update(.073, { tornadoIntensity: NaN, blackHoleIntensity: -1 }),
   { x: 0, y: 0, z: 0, zoom: 0 });
 }
 fx.pulse(); fx.bomb(); fx.update(.02);
 assert.ok(magnitude(fx.offsets) > 0);
 assert.deepEqual(fx.update(5), { x: 0, y: 0, z: 0, zoom: 0 });
});

 test('Production camera has no legacy ordinary-hit shake path',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');assert(!/\bshake\b/.test(source));assert.equal((source.match(/cameraFX\.pulse\(\)/g)||[]).length,1);assert.equal((source.match(/cameraFX\.bomb\(\)/g)||[]).length,1);assert(source.includes('const cameraOffset=v3(fx.x,fx.y,fx.z)'));
 });
