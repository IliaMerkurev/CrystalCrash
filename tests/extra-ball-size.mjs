// Run from the project root: node --test tests/extra-ball-size.mjs
// Real Three.js geometry/materials and Rapier bodies, including crowded layouts.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNE as C } from '../src/config.js';
import { SecondaryPowers } from '../src/secondary-powers.js';

await RAPIER.init();

const DT = 1 / 90;
const BOUNDS = { top: -6, bottom: 6, lowerZoneZ: 0, tableHalf: z => 2.5 - z * .02 };
const MAIN_POINT = { x: 1.6, y: C.ballRadius + .03, z: 5.3 };
const VELOCITY = { x: 9, y: 0, z: 10 };
const near = (actual, expected, label, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} versus ${expected}`);
};

function withPhysics(run) {
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -C.gravity, z: 0 });
  world.timestep = DT;
  const main = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(MAIN_POINT.x, MAIN_POINT.y, MAIN_POINT.z));
  const mainCollider = world.createCollider(RAPIER.ColliderDesc.ball(C.ballRadius)
    .setDensity(C.ballDensity).setCollisionGroups(0x00020017).setSolverGroups(0x00020017), main);
  const powers = new SecondaryPowers({ THREE, RAPIER, scene, world, colliders: new Map(), radius: C.ballRadius });
  try { run({ powers, scene, world, main, mainCollider }); }
  finally { powers.dispose(); world.free(); }
}

function multiply(powers, main, total) {
  for (let population = 1, activationId = 1; population < total; population *= 3, activationId++) {
    const sources = [
      { position: { ...main.translation() }, velocity: VELOCITY, radius: main.collider(0).radius() },
      ...powers.echoes.map(echo => ({ position: { ...echo.b.translation() }, velocity: { ...echo.b.linvel() }, radius: echo.c.radius() })),
    ];
    assert.equal(powers.spawnSplit({ activationId }, main.translation(), VELOCITY, activationId, sources, BOUNDS), true);
    assert.equal(powers.echoes.length + 1, population * 3, 'one generation is added per activation');
    assertSafeSpheres(powers, main.translation(), BOUNDS);
  }
}

function assertSafeSpheres(powers, mainPoint, bounds, parked = false) {
  const spheres = [{ position: mainPoint, radius: C.ballRadius }, ...powers.echoes.map(echo => ({ position: echo.b.translation(), radius: echo.c.radius() }))];
  for (let i = 1; i < spheres.length; i++) {
    const { position: p, radius } = spheres[i];
    near(radius, C.ballRadius, 'every collider matches the main radius');
    assert.ok(['x', 'y', 'z'].every(axis => Number.isFinite(p[axis])), 'finite body position');
    assert.ok(p.y >= radius, 'sphere is above the floor');
    assert.ok(Math.abs(p.x) + radius < bounds.tableHalf(p.z), 'sphere clears the rail');
    assert.ok(p.z - radius >= (parked ? bounds.lowerZoneZ : bounds.top), 'sphere clears the near boundary');
    assert.ok(p.z + radius < bounds.bottom, 'sphere clears the loss edge');
    for (let j = 0; j < i; j++) {
      const other = spheres[j];
      assert.ok(Math.hypot(p.x - other.position.x, p.y - other.position.y, p.z - other.position.z) >= radius + other.radius - 1e-5,
        `sphere pair ${i}/${j} does not overlap`);
    }
  }
}

test('Extra balls match main radius and polished steel reflectivity while retaining pink', () => {
  withPhysics(({ powers, main, mainCollider }) => {
    multiply(powers, main, 3);
    near(powers.echoRadius, mainCollider.radius(), 'shared physical radius');
    near(powers.echoGeometry.parameters.radius, C.ballRadius, 'rendered sphere radius');
    assert.equal(powers.echoGeometry.parameters.widthSegments, 32, 'same smooth sphere tessellation as main');
    assert.equal(powers.echoGeometry.parameters.heightSegments, 24);
    assert.equal(powers.echoMaterial.isMeshStandardMaterial, true);
    assert.equal(powers.echoMaterial.color.getHex(), 0xF27ED2, 'original pink tint is retained');
    assert.equal(powers.echoMaterial.metalness, 1);
    assert.equal(powers.echoMaterial.roughness, .095);
    assert.equal(powers.echoMaterial.envMapIntensity, 2.4);
    assert.equal(powers.echoMaterial.emissive.getHex(), 0, 'no emissive wash obscures reflections');
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (const echo of powers.echoes) {
      powers.echoInstances.getMatrixAt(echo.index, matrix);
      matrix.decompose(position, rotation, scale);
      for (const axis of ['x', 'y', 'z']) near(scale[axis], 1, 'instances do not shrink the geometry');
    }
  });
});

for (const total of [27, 81]) {
  test(`${total} equal-size balls spawn safely, park at edges, and remain catchable after transfer`, () => {
    withPhysics(({ powers, world, main, scene }) => {
      multiply(powers, main, total);
      assert.equal(powers.echoInstances.count, total - 1);
      assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1, 'one shared render batch');
      powers.parkForTransition(main.translation(), BOUNDS);
      for (const point of [MAIN_POINT, { x: -1.6, y: C.ballRadius + .03, z: .6 }, { x: 0, y: C.ballRadius + .03, z: 3 }]) {
        main.setTranslation(point, true);
        main.setNextKinematicTranslation(point);
        powers.followTransition(point, Infinity, BOUNDS);
        assertSafeSpheres(powers, point, BOUNDS, true);
        for (const echo of powers.echoes) {
          assert.equal(echo.c.collisionGroups(), 0, 'parked collider is isolated during travel');
          assert.equal(echo.b.isKinematic(), true);
        }
        world.step();
        assertSafeSpheres(powers, main.translation(), BOUNDS, true);
      }
      if (total === 81) assert.ok(powers.echoes.some(echo => echo.b.translation().y > C.ballRadius * 3), 'crowded parking uses separated height layers');
      powers.resumeAfterTransition(100);
      for (let i = 0; i < 30; i++) { powers.step(DT, 100 + i * DT, BOUNDS); world.step(); }
      assertSafeSpheres(powers, main.translation(), BOUNDS, true);
      assert.equal(powers.launchStaged({ x: 0, y: 0, z: -20 }), total - 1);
      for (const echo of powers.echoes) {
        assert.equal(echo.c.collisionGroups(), powers.echoGroups);
        assert.equal(echo.b.isDynamic(), true);
        assert.equal(powers.holdEcho(echo), true, 'every full-size extra can be caught');
      }
      for (let i = 0; i < 30; i++) { powers.step(DT, 101 + i * DT, BOUNDS); world.step(); }
      assert.equal(powers.echoes.length, total - 1);
      assertSafeSpheres(powers, main.translation(), BOUNDS, true);
    });
  });
}

test('Full-size extra catch hysteresis and loss edge use the actual collider radius', () => {
  withPhysics(({ powers, main }) => {
    multiply(powers, main, 3);
    const [echo] = powers.echoes;
    const bounds = { ...BOUNDS, lowerZoneZ: 4 };
    echo.b.setTranslation({ x: 0, y: C.ballRadius + .03, z: 5 }, true);
    echo.b.setLinvel({ x: 6, y: 0, z: 10 }, true);
    powers.step(DT, 1, bounds);
    near(echo.catchUntil, 2, 'catch window remains one second');
    near(Math.hypot(echo.b.linvel().x, echo.b.linvel().z), 2.8, 'catch speed remains manageable');
    const hysteresis = Math.max(.3, powers.echoRadius * 1.5);
    echo.b.setTranslation({ x: 0, y: C.ballRadius + .03, z: bounds.lowerZoneZ - hysteresis + .01 }, true);
    powers.step(DT, 1.1, bounds);
    assert.equal(echo.inLowerZone, true, 'inside radius-derived hysteresis does not rearm');
    echo.b.setTranslation({ x: 0, y: C.ballRadius + .03, z: bounds.lowerZoneZ - hysteresis - .01 }, true);
    powers.step(DT, 1.2, bounds);
    assert.equal(echo.inLowerZone, false, 'full upper excursion rearms catch');
    echo.b.setTranslation({ x: 0, y: C.ballRadius + .03, z: bounds.bottom + C.ballRadius - .01 }, true);
    powers.step(DT, 1.3, bounds);
    assert.equal(powers.isValid(echo), true, 'partially over the edge remains live');
    echo.b.setTranslation({ x: 0, y: C.ballRadius + .03, z: bounds.bottom + C.ballRadius + .01 }, true);
    powers.step(DT, 1.4, bounds);
    assert.equal(powers.isValid(echo), false, 'fully beyond the radius-adjusted edge is lost');
  });
});
