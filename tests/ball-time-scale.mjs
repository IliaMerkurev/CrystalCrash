import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { BallTimeScale } from '../src/ball-time-scale.js';
await RAPIER.init();
const DT = 1 / 90;
const near = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`);
function fixture(run, gravity = 0) {
  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  world.timestep = DT;
  const scaler = new BallTimeScale();
  const ball = (x = 0, y = 10) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(.3).setMass(1).setRestitution(1).setFriction(0), body);
    return body;
  };
  const step = (bodies, intensity = 1) => {
    scaler.beforeStep(DT, bodies, intensity);
    try { world.step(); } finally { scaler.afterStep(); }
  };
  try { run({ world, scaler, ball, step }); } finally { scaler.reset(); world.free(); }
}

test('free ball travels at smooth .35 scale, normal cube and world timestep untouched', () => fixture(({ world, scaler, ball, step }) => {
  const b = ball(); b.setLinvel({ x: 2, y: 0, z: 0 }, true);
  const cube = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -10, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.3, .3, .3), cube);
  cube.setLinvel({ x: 2, y: 0, z: 0 }, true);
  let expected = 0;
  for (let i = 0; i < 900; i++) { step([b]); expected += 2 * DT * scaler.scale; }
  near(b.translation().x, expected, .002); near(cube.translation().x, 20, .002);
  near(b.linvel().x, 2, .001); near(scaler.scale, .35); near(world.timestep, DT);
}));

test('external impulse during effect changes logical momentum and persists, release returns normal speed', () => fixture(({ scaler, ball, step }) => {
  const b = ball();
  for (let i = 0; i < 300; i++) step([b]);
  b.applyImpulse({ x: 6, y: 0, z: 0 }, true);
  for (let i = 0; i < 100; i++) step([b]);
  near(b.linvel().x, 6, .001);
  for (let i = 0; i < 600; i++) step([b], 0);
  near(scaler.scale, 1); near(b.linvel().x, 6, .002);
  const x = b.translation().x; for (let i = 0; i < 90; i++) step([b], 0);
  near(b.translation().x - x, 6, .002);
}));

test('gravity and persistent force use scaled acceleration and are restored', () => fixture(({ scaler, ball, step }) => {
  const b = ball(); b.setGravityScale(.7, true); b.addForce({ x: 3, y: 0, z: 0 }, true);
  let vx = 0, vy = 0;
  for (let i = 0; i < 90; i++) {
    step([b]); vx += 3 * scaler.scale * DT; vy += -9 * .7 * scaler.scale * DT;
    near(b.gravityScale(), .7); near(b.userForce().x, 3);
  }
  near(b.linvel().x, vx, .002); near(b.linvel().y, vy, .002);
}, -9));

test('angular velocity, torque and damping scale without losing settings', () => fixture(({ scaler, ball, step }) => {
  const b = ball(); b.setLinearDamping(.8); b.setAngularDamping(.6);
  b.setLinvel({ x: 4, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 3, z: 0 }, true);
  let expectedV = 4, expectedW = 3;
  for (let i = 0; i < 90; i++) {
    step([b]); expectedV /= 1 + .8 * scaler.scale * DT; expectedW /= 1 + .6 * scaler.scale * DT;
    near(b.linearDamping(), .8); near(b.angularDamping(), .6);
  }
  near(b.linvel().x, expectedV, .002); near(b.angvel().y, expectedW, .002);
  b.addTorque({ x: 0, y: .1, z: 0 }, true); step([b]); near(b.userTorque().y, .1);
}));

test('solver bounce preserved rather than overwritten by stale pre-collision velocity', () => fixture(({ world, ball, step }) => {
  const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(2, 10, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.2, 5, 5).setRestitution(1).setFriction(0), wall);
  const b = ball(); b.setLinvel({ x: 5, y: 0, z: 0 }, true);
  let bounced = false;
  for (let i = 0; i < 120; i++) { step([b]); if (b.linvel().x < -1) bounced = true; }
  assert.ok(bounced); assert.ok(b.linvel().x < -1);
}));

test('new split body immediately shares scale, duplicates never double-scale', () => fixture(({ scaler, ball, step }) => {
  const old = ball(); for (let i = 0; i < 300; i++) step([old]);
  const fresh = ball(10); fresh.setLinvel({ x: 3, y: 0, z: 0 }, true);
  const x = fresh.translation().x; step([old, fresh, fresh]);
  near(fresh.translation().x - x, 3 * DT * scaler.scale); near(fresh.linvel().x, 3);
}));

test('pause, removal, reset and bad inputs remain finite with exact property restoration', () => fixture(({ world, scaler, ball, step }) => {
  const b = ball(); b.setLinvel({ x: 2, y: 0, z: 0 }, true); step([b]);
  const scale = scaler.scale; scaler.beforeStep(0, [b], 0); scaler.afterStep();
  near(scaler.scale, scale); near(b.linvel().x, 2);
  scaler.beforeStep(DT, [b], 1); scaler.reset(); near(scaler.scale, 1); near(b.linvel().x, 2);
  const removed = ball(10); scaler.beforeStep(DT, [removed], 1); world.removeRigidBody(removed); scaler.afterStep();
  for (const intensity of [NaN, Infinity, -100, 100]) { step([b], intensity); assert.ok(Number.isFinite(b.linvel().x)); assert.ok(scaler.scale >= .35 && scaler.scale <= 1); }
  scaler.reset(); near(b.gravityScale(), 1);
}));

test('moving normal-time cube transfers a finite elastic impulse to a slow ball without tunneling', () => fixture(({ world, scaler, ball, step }) => {
  // Equal masses, central contact, restitution one: the moving cube transfers
  // its actual 6-unit/s velocity to the initially stationary ball. A selective
  // time solver stores that as 6 / s logical velocity, but the next integration
  // must use 6 again, NOT amplify that impulse repeatedly on successive frames.
  for (let i = 0; i < 400; i++) step([]);
  near(scaler.scale, .35);
  const b = ball(2); b.enableCcd(true);
  const cube = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 10, 0).setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.3, .3, .3)
    .setMass(1).setRestitution(1).setFriction(0), cube);
  cube.setLinvel({ x: 6, y: 0, z: 0 }, true);
  let hit = false, maxActual = 0, maxLogical = 0;
  for (let i = 0; i < 240; i++) {
    scaler.beforeStep(DT, [b], 1);
    const actual = Math.hypot(...Object.values(b.linvel()));
    assert.ok(Number.isFinite(actual));
    maxActual = Math.max(maxActual, actual);
    try { world.step(); } finally { scaler.afterStep(); }
    const logical = Math.hypot(...Object.values(b.linvel()));
    assert.ok(Number.isFinite(logical)); maxLogical = Math.max(maxLogical, logical);
    if (b.linvel().x > 1) hit = true;
    assert.ok(cube.translation().x < b.translation().x, 'cube never tunnels through the ball');
  }
  assert.ok(hit, 'dynamic cube actually collided');
  near(cube.linvel().x, 0, .06);
  near(b.linvel().x * scaler.scale, 6, .06);
  near(b.linvel().x, 6 / scaler.scale, .15);
  assert.ok(maxActual < 6.1, `actual speed remains bounded: ${maxActual}`);
  assert.ok(maxLogical < 6.1 / scaler.minimumScale, `logical speed remains bounded: ${maxLogical}`);
}));
