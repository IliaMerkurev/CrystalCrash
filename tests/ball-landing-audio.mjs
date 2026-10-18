import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { BallLandingAudio } from '../src/ball-landing-audio.js';
import { BallTimeScale } from '../src/ball-time-scale.js';
await RAPIER.init();
const DT = 1 / 90;
function fixture(run) {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  world.timestep = DT;
  const metadata = new Map();
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(20, .1, 20).setTranslation(0, -.1, 0));
  metadata.set(floor.handle, { kind: 'table' });
  const detector = new BallLandingAudio();
  const make = (x = 0, y = 3, restitution = 0) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(.38).setRestitution(restitution), body);
    return body;
  };
  const step = (bodies, scale = 1) => {
    detector.beforeStep(world, metadata, bodies, DT, scale);
    world.step();
    return detector.afterStep(world, metadata);
  };
  try { run({ world, metadata, floor, detector, make, step }); }
  finally { world.free(); }
}
test('initial air drop and subsequent genuine bounce landings sound; resting remains quiet', () => fixture(({ make, step }) => {
  const ball = make(0, 3, .8), events = [];
  for (let i = 0; i < 500; i++) events.push(...step([ball]));
  assert(events.length >= 2, `expected bounce landings, got ${events.length}`);
  assert(events.every(e => e.body === ball && e.impactSpeed > .65 && e.strength > 0 && e.strength <= 1));
  let quiet = 0;
  for (let i = 0; i < 500; i++) quiet += step([ball]).length;
  assert.equal(quiet, 0);
}));
test('grounded initial spawn is silent and multiple free balls land independently', () => fixture(({ make, step }) => {
  const resting = make(-4, .38), a = make(0, 3), b = make(4, 5);
  const events = [];
  for (let i = 0; i < 240; i++) events.push(...step([resting, a, a, b]));
  assert.deepEqual(events.map(e => e.body), [a, b]);
}));
test('rail contact, held bodies, and unlisted balls cannot produce landing events', () => fixture(({ world, metadata, floor, make, step }) => {
  metadata.set(floor.handle, { kind: 'rail' });
  const ball = make(), unlisted = make(4), held = make(8);
  held.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  for (let i = 0; i < 180; i++) assert.equal(step([ball, held]).length, 0);
  assert(unlisted.translation().y < .5);
}));
test('vertical table walls are not supporting floor manifolds', () => fixture(({ world, metadata, make, step }) => {
  const wall = world.createCollider(RAPIER.ColliderDesc.cuboid(.1, 10, 10).setTranslation(2, 4, 0));
  metadata.set(wall.handle, { kind: 'table' });
  const ball = make(0, 8); ball.setLinvel({ x: 10, y: -2, z: 0 }, true);
  for (let i = 0; i < 25; i++) assert.equal(step([ball]).length, 0);
}));
test('actual low impact velocity stays silent despite high canonical velocity', () => fixture(({ world, metadata, detector, make }) => {
  const ball = make(0, .8), scaler = new BallTimeScale(); scaler.scale = .1;
  let impacts = 0;
  for (let i = 0; i < 450; i++) {
    scaler.beforeStep(DT, [ball], 1);
    detector.beforeStep(world, metadata, [ball], DT, 1);
    world.step(); scaler.afterStep();
    impacts += detector.afterStep(world, metadata).length;
  }
  assert(ball.translation().y < .4);
  assert.equal(impacts, 0);
}));
test('global speed multiplier suppresses otherwise audible impacts', () => fixture(({ make, step }) => {
  const ball = make();
  let impacts = 0;
  for (let i = 0; i < 180; i++) impacts += step([ball], .01).length;
  assert.equal(impacts, 0);
}));
test('removed/ineligible bodies and reset clear all state and pending events', () => fixture(({ world, metadata, detector, make, step }) => {
  const ball = make(); step([ball]); assert.equal(detector._states.size, 1);
  step([]); assert.equal(detector._states.size, 0);
  step([ball]); world.removeRigidBody(ball); step([ball]); assert.equal(detector._states.size, 0);
  const next = make(); detector.beforeStep(world, metadata, [next], DT); detector.reset();
  assert.equal(detector._states.size, 0); assert.deepEqual(detector.afterStep(world, metadata), []);
}));
