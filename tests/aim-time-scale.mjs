import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { AimTimeScale } from '../src/aim-time-scale.js';
import { BallTimeScale, relativeBallTimeScale } from '../src/ball-time-scale.js';

await RAPIER.init();
const DT = 1 / 90;
const near = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`);

function fixture(run, gravity = 0) {
  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  const scaler = new BallTimeScale();
  const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(.3).setMass(1), ball);
  const cube = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -10, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.3, .3, .3).setMass(1), cube);
  const step = (realDt = DT, globalScale = 1, intensity = 1) => {
    world.timestep = realDt * globalScale;
    scaler.beforeStep(world.timestep, [ball], intensity, globalScale);
    try { world.step(); } finally { scaler.afterStep(); }
  };
  try { run({ world, scaler, ball, cube, step }); } finally { scaler.reset(); world.free(); }
}

test('aiming smoothly approaches .4 in real time and release/cancel smoothly restores one', () => {
  const aim = new AimTimeScale();
  const first = aim.update(DT, true);
  assert.ok(first < 1 && first > .4, 'aim begins with a blend, not a snap');
  near(first, .4 + .6 * Math.exp(-DT / aim.attack), 1e-12);
  for (let i = 0; i < 300; i++) aim.update(DT, true);
  assert.equal(aim.scale, .4);
  const release = aim.update(DT, false);
  assert.ok(release > .4 && release < 1, 'release/cancel shares the smooth return');
  for (let i = 0; i < 600; i++) aim.update(DT, false);
  assert.equal(aim.scale, 1);
});

test('aim envelope is frame-rate independent and safe through rapid gesture reversals', () => {
  const lowRate = new AimTimeScale(), highRate = new AimTimeScale();
  for (let i = 0; i < 10; i++) lowRate.update(1 / 30, true);
  for (let i = 0; i < 40; i++) highRate.update(1 / 120, true);
  near(lowRate.scale, highRate.scale, 1e-12);
  for (let i = 0; i < 8; i++) lowRate.update(1 / 30, false);
  for (let i = 0; i < 32; i++) highRate.update(1 / 120, false);
  near(lowRate.scale, highRate.scale, 1e-12);
  for (let i = 0; i < 500; i++) {
    const previous = highRate.scale, aiming = i % 2 === 0;
    highRate.update(DT, aiming);
    assert.ok(highRate.scale >= .4 && highRate.scale <= 1);
    assert.ok(aiming ? highRate.scale <= previous : highRate.scale >= previous);
  }
});

test('pause freezes the envelope exactly, invalid clocks do nothing, reset clears it', () => {
  const aim = new AimTimeScale();
  aim.update(.2, true);
  const frozen = aim.scale;
  assert.equal(aim.update(10, false, { paused: true }), frozen);
  for (const dt of [0, -1, NaN, Infinity]) assert.equal(aim.update(dt, false), frozen);
  assert.ok(aim.update(DT, false) > frozen, 'cancelled gesture releases after resume');
  assert.equal(aim.reset(), 1);
  assert.equal(aim.scale, 1);
  const clamped = new AimTimeScale({ minimumScale: -10, attack: -1, release: NaN });
  assert.ok(Number.isFinite(clamped.update(DT, true)));
  assert.ok(clamped.scale >= .05 && clamped.scale <= 1);
});

test('absolute scales compose by minimum, never by multiplying the slowdowns', () => {
  near(relativeBallTimeScale(.35, .4), .875, 1e-12);
  near(.4 * relativeBallTimeScale(.35, .4), .35, 1e-12);
  assert.equal(relativeBallTimeScale(.7, .4), 1);
  assert.equal(relativeBallTimeScale(.35, .2), 1);
  assert.equal(relativeBallTimeScale(.35), .35);
  for (const bad of [0, -1, NaN, Infinity]) near(relativeBallTimeScale(.35, bad), .35);
});

test('Black Hole absolute envelope keeps real-time attack/release while world is slowed', () => {
  const normal = new BallTimeScale(), aimed = new BallTimeScale();
  for (let i = 0; i < 150; i++) {
    const intensity = i < 70 ? 1 : 0;
    normal.beforeStep(DT, [], intensity);
    const returned = aimed.beforeStep(DT * .4, [], intensity, .4);
    near(aimed.scale, normal.scale, 1e-12);
    assert.equal(returned, aimed.scale, 'return remains the absolute envelope');
  }
  const frozen = aimed.scale;
  aimed.beforeStep(0, [], 0, .4);
  assert.equal(aimed.scale, frozen);
});

test('real Rapier: .4 global world plus .875 relative ball produces .35 ball and .4 cube speed', () => fixture(({ world, scaler, ball, cube, step }) => {
  const aim = new AimTimeScale();
  aim.update(10, true);
  scaler.beforeStep(4, [], 1, aim.scale);
  assert.equal(aim.scale, .4); assert.equal(scaler.scale, .35);
  ball.setLinvel({ x: 2, y: 0, z: 0 }, true);
  cube.setLinvel({ x: 2, y: 0, z: 0 }, true);
  for (let i = 0; i < 900; i++) step(DT, aim.scale);
  near(ball.translation().x, 7, .002);
  near(cube.translation().x, 8, .002);
  near(ball.linvel().x, 2, .001);
  near(cube.linvel().x, 2, .001);
  near(world.timestep, DT * .4, 1e-9);
}));

test('real Rapier fixed-step accumulator retains .35/.4 rates without changing world timestep', () => fixture(({ world, scaler, ball, cube }) => {
  world.timestep = DT;
  scaler.beforeStep(4, [], 1, .4);
  ball.setLinvel({ x: 2, y: 0, z: 0 }, true);
  cube.setLinvel({ x: 2, y: 0, z: 0 }, true);
  let accumulator = 0, count = 0;
  for (let frame = 0; frame < 900; frame++) {
    accumulator += DT * .4;
    while (accumulator + 1e-12 >= DT) {
      scaler.beforeStep(DT, [ball], 1, .4);
      try { world.step(); } finally { scaler.afterStep(); }
      accumulator -= DT;
      count++;
    }
  }
  assert.equal(count, 360);
  near(ball.translation().x, 7, .002);
  near(cube.translation().x, 8, .002);
  near(world.timestep, DT, 1e-9);
}));

test('real Rapier aim alone never modifies ball velocity, forces, damping or gravity settings', () => fixture(({ scaler, ball, cube, step }) => {
  ball.setLinvel({ x: 2, y: 0, z: 0 }, true);
  cube.setLinvel({ x: 2, y: 0, z: 0 }, true);
  for (let i = 0; i < 90; i++) step(DT, .4, 0);
  near(ball.translation().x, .8, .0001);
  near(cube.translation().x, .8, .0001);
  assert.equal(scaler.scale, 1);
  near(ball.linvel().x, 2); near(ball.gravityScale(), 1);
  near(ball.linearDamping(), 0); near(ball.userForce().x, 0);
}));

test('real Rapier repeated aim/release and external impulse preserve logical velocity without drift', () => fixture(({ scaler, ball, cube, step }) => {
  const aim = new AimTimeScale();
  ball.setLinvel({ x: 2, y: 0, z: 0 }, true);
  cube.setLinvel({ x: 2, y: 0, z: 0 }, true);
  let speed = 2, expectedBall = 0, expectedCube = 0;
  for (let i = 0; i < 2200; i++) {
    if (i === 300) { ball.applyImpulse({ x: 4, y: 0, z: 0 }, true); speed = 6; }
    const global = aim.update(DT, i < 1200 && Math.floor(i / 100) % 2 === 0);
    step(DT, global, i < 1000 ? 1 : 0);
    expectedBall += speed * DT * Math.min(global, scaler.scale);
    expectedCube += 2 * DT * global;
    near(ball.linvel().x, speed, .001);
    near(cube.linvel().x, 2, .001);
  }
  near(ball.translation().x, expectedBall, .01);
  near(cube.translation().x, expectedCube, .01);
  assert.equal(aim.scale, 1); assert.equal(scaler.scale, 1);
  const x = ball.translation().x;
  for (let i = 0; i < 90; i++) step(DT, 1, 0);
  near(ball.translation().x - x, 6, .002);
}));

test('real Rapier composed gravity and persistent force advance at .35 and restore settings', () => fixture(({ scaler, ball, cube, step }) => {
  scaler.beforeStep(4, [], 1, .4);
  ball.setGravityScale(.7, true);
  ball.addForce({ x: 3, y: 0, z: 0 }, true);
  for (let i = 0; i < 90; i++) {
    step(DT, .4);
    near(ball.gravityScale(), .7);
    near(ball.userForce().x, 3);
  }
  near(ball.linvel().x, 3 * .35, .002);
  near(ball.linvel().y, -9 * .7 * .35, .002);
  near(cube.linvel().y, -9 * .4, .002);
}, -9));
