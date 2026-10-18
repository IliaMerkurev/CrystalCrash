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
 assert.deepEqual(result, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
 fx.pulse(); fx.bomb();
 assert.equal(fx.update(DT, { tornadoIntensity: 1, blackHoleActive: true, blackHoleIntensity: 1 }), result);
 assert.ok(magnitude(result) > 0);
 assert.equal(fx.reset(), result);
 assert.deepEqual(result, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
 tick(fx, 20);
 assert.deepEqual(result, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
 assert.deepEqual(Object.keys(result).sort(), ['x', 'y', 'z', 'focus', 'dolly'].sort(), 'only translation, focus blend and FOV output');
});

test('Zero dt freezes shake, wind, zoom, phase, and envelopes exactly', () => {
 const fx = new CameraFX(); fx.bomb(); fx.pulse();
 tick(fx, .15, { tornadoIntensity: .7, blackHoleActive: true, blackHoleIntensity: .8 });
 const pose = { ...fx.offsets }, time = fx.time, bombAge = fx.bombAge, pulseAge = fx.pulseAge;
 for (let i = 0; i < 100; i++) assert.deepEqual(fx.update(0, { transition: true, reducedMotion: true }), pose);
 near(fx.time, time); near(fx.bombAge, bombAge); near(fx.pulseAge, pulseAge);
 assert.deepEqual(fx.update(NaN), pose);
 assert.deepEqual(fx.update(-1), pose);
 fx.update(DT, { tornadoIntensity: .7, blackHoleActive: true, blackHoleIntensity: .8 });
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
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
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
 assert.deepEqual(bomb.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
});

test('All effects and repeated Bomb triggers obey combined world-space and zoom bounds', () => {
 const fx = new CameraFX();
 for (let i = 0; i < 2400; i++) {
  fx.pulse(); if (i % 6 === 0) fx.bomb();
  const pose = fx.update(DT, { tornadoIntensity: 5, blackHoleActive: true, blackHoleIntensity: 5 });
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(pose[axis]) <= CAMERA_FX_LIMITS[axis] + 1e-12);
  assert.ok(magnitude(pose) <= CAMERA_FX_LIMITS.translation + 1e-12);
  assert.ok(pose.dolly >= 0 && pose.dolly <= .3);
 }
 tick(fx, 20);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 }, 'combined effects leave no residual drift');
});

test('Black Hole dolly starts softly, continues all six seconds, then returns in 0.3 seconds', () => {
 const fx = new CameraFX(); let previous = 0;
 for (let i = 0; i < 720; i++) {
  const pose = fx.update(DT, { blackHoleActive: true });
  assert.ok(pose.dolly > previous, 'dolly must progress throughout the active duration');
  assert.ok(pose.dolly - previous < .001);
  previous = pose.dolly;
 }
 near(previous, .3);
 near(fx.offsets.focus, 1);
 const before = { ...fx.offsets };
 assert.deepEqual(fx.update(0), before, 'pause preserves the active pose');
 for (let i = 0; i < 36; i++) {
  const pose = fx.update(DT);
  assert.ok(pose.dolly <= previous);
  previous = pose.dolly;
 }
 near(previous, 0);
 near(fx.offsets.focus, 0);
 fx.update(DT);
 assert.equal(fx.offsets.dolly, 0);
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
  const normal = regular.update(DT, { tornadoIntensity: 1, blackHoleActive: true, blackHoleIntensity: 1 });
  const small = reduced.update(DT, { tornadoIntensity: 1, blackHoleActive: true, blackHoleIntensity: 1, reducedMotion: true });
  for (const axis of ['x', 'y', 'z']) near(small[axis], normal[axis] * .08);
  near(small.dolly, normal.dolly * .12);
  near(small.focus, normal.focus * .12);
 }
});

test('Transition suppresses gracefully and ignores new impact shakes', () => {
 const fx = new CameraFX(); tick(fx, 3, { tornadoIntensity: 1, blackHoleActive: true, blackHoleIntensity: 1 });
 const before = { ...fx.offsets };
 const first = { ...fx.update(DT, { transition: true }) };
 assert.ok(magnitude(first) > 0, 'transition suppression is eased instead of snapping to zero');
 assert.ok(Math.hypot(first.x - before.x, first.y - before.y, first.z - before.z) < .03);
 assert.ok(first.dolly > before.dolly * .9 && first.dolly < before.dolly);
 assert.equal(fx.pulse(), false); assert.equal(fx.bomb(), false);
 tick(fx, 2, { transition: true });
 assert.ok(magnitude(fx.offsets) < 1e-6 && fx.offsets.dolly < 1e-5);
 tick(fx, 20);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
});

test('Fixed simulation phase is deterministic and independent of random state', () => {
 const one = new CameraFX(), two = new CameraFX();
 for (let i = 0; i < 500; i++) {
  if (i % 77 === 0) { one.pulse(); two.pulse(); }
  if (i === 173) { one.bomb(); two.bomb(); }
  const options = { tornadoIntensity: i < 400 ? .8 : 0, blackHoleActive: true, blackHoleIntensity: i / 500 };
  assert.deepEqual(one.update(DT, options), two.update(DT, options));
 }
});


test('Idle poses use exact positive zeros at every phase and large steps finish transient shakes', () => {
 const fx = new CameraFX();
 for (let i = 0; i < 2000; i++) {
  assert.deepEqual(fx.update(.073, { tornadoIntensity: NaN, blackHoleIntensity: -1 }),
   { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
 }
 fx.pulse(); fx.bomb(); fx.update(.02);
 assert.ok(magnitude(fx.offsets) > 0);
 assert.deepEqual(fx.update(5), { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
});

 test('Production camera has no legacy ordinary-hit shake path',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');assert(!/\bshake\b/.test(source));assert.equal((source.match(/cameraFX\.pulse\(\)/g)||[]).length,1);assert.equal((source.match(/cameraFX\.bomb\(\)/g)||[]).length,1);assert(source.includes('const cameraOffset=v3(fx.x,fx.y,fx.z)'));assert(!/camera\.position\.lerp[^;]*fx\.zoom/.test(source));assert(!/fx\.zoom\b/.test(source),'Black Hole must not use a dolly-distance zoom');
 });


test('Black Hole focus and dolly both start at t0 with a soft focus ramp', () => {
 const fx = new CameraFX();
 fx.update(DT, { blackHoleActive: true });
 assert.ok(fx.offsets.focus > 0 && fx.offsets.focus < .001);
 assert.ok(fx.offsets.dolly > 0 && fx.offsets.dolly < .00001);
 tick(fx, .9, { blackHoleActive: true });
 assert.equal(fx.offsets.focus, 1);
 assert.ok(fx.offsets.dolly > 0 && fx.offsets.dolly < .03);
 tick(fx, .31);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
});

test('Inactive Black Hole cannot focus or zoom from stale intensity', () => {
 const fx = new CameraFX();
 tick(fx, 3, { blackHoleActive: false, blackHoleIntensity: 1 });
 assert.equal(fx.offsets.focus, 0);
 assert.equal(fx.offsets.dolly, 0);
});


test('Production THREE dolly zoom preserves subject size, moves throughout lifetime and returns without drift', async () => {
 const [{ readFile }, vm, THREE] = await Promise.all([import('node:fs/promises'), import('node:vm'), import('three')]);
 const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
 const start = source.indexOf('function updateAimCamera('), end = source.indexOf('\nfunction resize(', start);
 assert.ok(start >= 0 && end > start);
 for (const aspect of [9 / 16, 16 / 9]) for (const arenaOffset of [0, -36]) {
  const camera = new THREE.PerspectiveCamera(42, aspect, .1, 200);
  const context = {
   THREE, camera, cameraFX: new CameraFX(), cameraBase: new THREE.Vector3(0, 15, 20),
   v3: (...xyz) => new THREE.Vector3(...xyz), clamp: THREE.MathUtils.clamp,
   drag: null, reduced: false, paused: false, bonusTestOpen: false, started: true,
   secondary: { blackHole: null, well: null }, blackHoleLookPoint: null,
   aimBlend: 0, aimShift: 0, state: 'BALL_ACTIVE', transition: 0, TRAVEL: 1,
   STRIDE: 36, arenaOffset, C: { ballRadius: .38, startZ: 5 },
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  context.updateAimCamera(DT);
  const basePosition = camera.position.clone(), baseQuaternion = camera.quaternion.clone();
  const hole = new THREE.Vector3(1.2, 2.8, -5), worldHole = hole.clone().add(new THREE.Vector3(0, 0, arenaOffset));
  const baseDistance = basePosition.distanceTo(worldHole);
  const control = camera.clone();
  function width(view, right) {
   const a = worldHole.clone().addScaledVector(right, -.5).project(view);
   const b = worldHole.clone().addScaledVector(right, .5).project(view);
   return a.distanceTo(b);
  }
  for (let cycle = 0; cycle < 3; cycle++) {
   context.secondary.blackHole = { point: hole, intensity: 0 };
   let lastDistance = baseDistance;
   for (let frame = 0; frame < 720; frame++) {
    context.updateAimCamera(DT);
    const distance = camera.position.distanceTo(worldHole);
    assert.ok(distance < lastDistance, 'camera keeps moving closer through all six seconds');
    assert.ok(distance >= baseDistance * .7 - 1e-9, 'dolly remains bounded');
    lastDistance = distance;
    assert.ok(camera.fov >= 42 && camera.fov < 59, 'closer camera compensates with wider FOV');
    // Compare an actual projected unit-width billboard to the same orientation
    // at the undollied base pose. This isolates dolly compensation from pan.
    control.position.copy(basePosition); control.quaternion.copy(camera.quaternion);
    control.fov = 42; control.updateProjectionMatrix(); control.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    near(width(camera, right), width(control, right), 5e-6);
    if (frame >= 108) {
     const projected = worldHole.clone().project(camera);
     near(projected.x, 0, 1e-9); near(projected.y, 0, 1e-9);
    }
   }
   near(lastDistance, baseDistance * .7, 1e-9);
   const frozenPosition = camera.position.clone(), frozenQuaternion = camera.quaternion.clone(), frozenFov = camera.fov;
   context.paused = true; context.secondary.blackHole = null; context.updateAimCamera(.5);
   near(camera.position.distanceTo(frozenPosition), 0);
   near(camera.quaternion.angleTo(frozenQuaternion), 0, 1e-7); near(camera.fov, frozenFov);
   context.paused = false; context.updateAimCamera(DT);
   assert.ok(camera.position.distanceTo(worldHole) > lastDistance);
   assert.ok(camera.fov < frozenFov && camera.fov > 42);
   for (let frame = 0; frame < 37; frame++) context.updateAimCamera(DT);
   near(camera.position.distanceTo(basePosition), 0);
   near(camera.quaternion.angleTo(baseQuaternion), 0, 1e-7); near(camera.fov, 42, .001);
   assert.equal(context.cameraFX.offsets.focus, 0); assert.equal(context.cameraFX.offsets.dolly, 0);
  }
 }
});


test('Black Hole reactivation during return preserves the partial pose without snapping', () => {
 const fx = new CameraFX();
 tick(fx, 6, { blackHoleActive: true });
 tick(fx, .1);
 const before = { ...fx.offsets };
 assert.ok(before.focus > .5 && before.focus < 1);
 assert.ok(before.dolly > .15 && before.dolly < .3);
 const after = fx.update(DT, { blackHoleActive: true });
 assert.ok(after.focus >= before.focus && after.focus - before.focus < .001);
 assert.ok(after.dolly >= before.dolly && after.dolly - before.dolly < .00001);
 let prior = after.dolly;
 for (let i = 0; i < 720; i++) {
  fx.update(DT, { blackHoleActive: true });
  assert.ok(fx.offsets.dolly >= prior && fx.offsets.dolly <= .3);
  prior = fx.offsets.dolly;
 }
 near(fx.offsets.dolly, .3); near(fx.offsets.focus, 1);
 tick(fx, .31);
 assert.deepEqual(fx.offsets, { x: 0, y: 0, z: 0, focus: 0, dolly: 0 });
});
