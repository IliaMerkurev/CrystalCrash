// Run from the project root: node tests/secondary-powers.mjs
// Real Three.js objects and Rapier rigid bodies; no browser, renderer, or mocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SecondaryPowers } from '../src/secondary-powers.js';

await RAPIER.init();

const DT = 1 / 90;
const RADIUS = .38;
const BOUNDS = { top: -100, bottom: 100, halfWidth: 100, lowerZoneZ: 4 };
const speed = body => {
  const v = body.linvel();
  return Math.hypot(v.x, v.y, v.z);
};
const near = (actual, expected, message = '', tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`);
};
const vectorNear = (actual, expected, message) => {
  for (const axis of ['x', 'y', 'z']) near(actual[axis], expected[axis], `${message} ${axis}`);
};

function withPhysics(run, gravity = { x: 0, y: -18, z: 0 }) {
  const scene = new THREE.Scene();
  const world = new RAPIER.World(gravity);
  world.timestep = DT;
  const colliders = new Map();
  const hits = [];
  const finished = [];
  const powers = new SecondaryPowers({
    THREE, RAPIER, scene, world, colliders, radius: RADIUS,
    onEchoHit: echo => hits.push(echo),
    onFinishSplit: id => finished.push(id),
  });
  try {
    return run({ scene, world, colliders, powers, hits, finished });
  } finally {
    powers.dispose();
    world.free();
  }
}

function split(powers, velocity = { x: 0, y: 0, z: -2 }, activationId = 77) {
  assert.equal(powers.spawnSplit({ activationId, duration: .01, hitsPerEcho: 1 },
    { x: 0, y: .5, z: 0 }, velocity, 0), true);
  assert.equal(powers.echoes.length, 2);
  return [...powers.echoes];
}

function addBlock(world, blocks, id, options = {}) {
  const { kind = 'block', x = .5, y = .3, z = 0, fixed = false, half = .2 } = options;
  const desc = fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
  const b = world.createRigidBody(desc.setTranslation(x, y, z));
  const c = world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half)
    .setMass(2).setFriction(.65)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply), b);
  // Damaged, split clusters are still playable targets.
  const o = { id, kind, b, cs: [c], damage: 2, stage: 1, ids: [0, 1, 2],
    origin: { clusters: new Set([id, id + 1000]), graph: { cells: [0, 1, 2, 3] } } };
  blocks.set(id, o);
  return o;
}

test('Split uses fast impulse launches and survives time/hit allowances without attraction', () => {
  withPhysics(({ powers, world, hits, finished }) => {
    const echoes = split(powers);
    for (const echo of echoes) {
      near(speed(echo.b), 16, 'minimum launch speed');
      echo.b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (let i = 0; i < 50; i++) assert.equal(powers.hit(echoes[0]), true);
    let attractionCalls = 0;
    const positions = echoes.map(echo => ({ ...echo.b.translation() }));
    for (let i = 0; i < 900; i++) {
      // The legacy fourth argument must not introduce any return/magnetic force.
      powers.step(DT, 1000 + i * DT, { ...BOUNDS, upperStallAcceleration: 0, lowerReturnAcceleration: 0 }, () => {
        attractionCalls++;
        return { x: 100, y: 100, z: 100 };
      });
      world.step();
    }
    assert.equal(attractionCalls, 0);
    assert.equal(powers.echoes.length, 2);
    assert.equal(echoes[0].hitCount, 50);
    assert.equal(hits.length, 50);
    assert.deepEqual(finished, []);
    echoes.forEach((echo, i) => vectorNear(echo.b.translation(), positions[i], 'unforced echo'));
    powers.clear();
    for (const echo of split(powers, { x: 0, y: 0, z: -100 })) {
      near(speed(echo.b), 30, 'maximum launch speed');
    }
  }, { x: 0, y: 0, z: 0 });
});

test('Lower-zone catch window lasts one second, has hysteresis, and preserves deliberate relaunch', () => {
  withPhysics(({ powers }) => {
    const [echo] = split(powers);
    echo.b.setTranslation({ x: 0, y: 1, z: 5 }, true);
    echo.b.setLinvel({ x: 6, y: 2, z: 10 }, true);
    powers.step(DT, 1, BOUNDS);
    const slowed = { ...echo.b.linvel() };
    near(Math.hypot(slowed.x, slowed.z), 2.8, 'one-second catch speed');
    near(slowed.y, 2, 'vertical velocity unchanged');
    near(echo.catchUntil, 2, 'one-second deadline');
    for (const [now, z] of [[1.1, 3.95], [1.2, 4.05], [1.3, 3.9], [1.4, 4.1]]) {
      echo.b.setTranslation({ x: 0, y: 1, z }, true);
      powers.step(DT, now, BOUNDS);
      near(echo.catchUntil, 2, 'small boundary oscillations never restart the timer');
      vectorNear(echo.b.linvel(), slowed, 'catch period stays slow');
    }
    powers.step(.1, 2.01, BOUNDS);
    assert.equal(echo.returning, true);
    near(echo.b.linvel().z, slowed.z + .8, 'expired catch window adds downward acceleration');
    assert.equal(powers.holdEcho(echo), true);
    powers.step(.1, 5, BOUNDS);
    near(speed(echo.b), 0, 'held echo receives no return force');
    assert.equal(powers.releaseEcho(echo, { x: 3, y: 0, z: -20 }), true);
    powers.step(DT, 5.01, BOUNDS);
    vectorNear(echo.b.linvel(), { x: 3, y: 0, z: -20 }, 'deliberate launch is not catch-speed capped');
    echo.b.setTranslation({ x: 0, y: 1, z: BOUNDS.lowerZoneZ - Math.max(.3,powers.echoRadius*1.5) - .1 }, true);
    powers.step(DT, 5.1, BOUNDS);
    assert.equal(echo.inLowerZone, false, 'full upper-zone excursion rearms entry');
    echo.b.setTranslation({ x: 0, y: 1, z: 5 }, true);
    powers.step(DT, 5.2, BOUNDS);
    near(echo.catchUntil, 6.2, 'a genuine new crossing receives a new window');
  });
});

test('Held echoes resist real gravity, preserve remapped position/orientation, and release dynamically', () => {
  withPhysics(({ powers, world }) => {
    const [echo] = split(powers);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .7);
    echo.b.setRotation(rotation, true);
    echo.b.setAngvel({ x: 3, y: 4, z: 5 }, true);
    assert.equal(powers.holdEcho(echo), true);
    const held = { ...echo.b.translation() };
    for (let i = 0; i < 900; i++) {
      powers.step(DT, i * DT, BOUNDS, { x: 1e4, y: -1e4, z: 1e4 });
      world.step();
    }
    vectorNear(echo.b.translation(), held, 'held position after ten physical seconds');
    assert.equal(echo.b.bodyType(), RAPIER.RigidBodyType.KinematicPositionBased);
    assert.equal(echo.valid, true);
    assert.equal(echo.isHeld, true);
    assert.equal(powers.isHeld(echo), true);
    powers.remap(p => { p.x += 5; p.z -= 10; return p; });
    powers.step(DT, 11, BOUNDS);
    world.step();
    powers.render();
    vectorNear(echo.b.translation(), { x: held.x + 5, y: held.y, z: held.z - 10 }, 'remapped hold');
    vectorNear(echo.mesh.position, echo.b.translation(), 'rendered position');
    for (const axis of ['x', 'y', 'z', 'w']) near(echo.b.rotation()[axis], rotation[axis], `rotation ${axis}`);
    assert.equal(powers.releaseEcho(echo, { x: 3, y: 0, z: -16 }), true);
    assert.equal(echo.b.bodyType(), RAPIER.RigidBodyType.Dynamic);
    assert.equal(powers.isHeld(echo), false);
    vectorNear(echo.b.linvel(), { x: 3, y: 0, z: -16 }, 'released velocity');
  });
});

test('Parked echoes survive travel and stage until the first main launch', () => {
  withPhysics(({ powers, world }) => {
    const echoes = split(powers);
    powers.parkForTransition({ x: 0, y: .41, z: 4 });
    const spacing = RADIUS + powers.echoRadius + .12;
    echoes.forEach((echo, i) => {
      near(echo.b.translation().x, (i === 0 ? -1 : 1) * spacing, 'parked spacing');
      assert.equal(echo.c.collisionGroups(), 0);
      assert.equal(echo.c.solverGroups(), 0);
      assert.equal(echo.isHeld, true);
      assert.equal(echo.transitionParked, true);
    });
    powers.followTransition({ x: 1, y: .41, z: -50 });
    assert.ok(echoes[0].b.translation().z < 4 && echoes[0].b.translation().z > -50,
      'first follow must interpolate rather than teleport');
    for (let i = 0; i < 100; i++) {
      powers.followTransition({ x: 1, y: .41, z: -50 }, DT);
      // Ordinary loss bounds must not discard parked balls between arenas.
      powers.step(DT, 2000 + i * DT, { top: -1, bottom: 1, halfWidth: .1 });
      world.step();
    }
    assert.deepEqual(powers.echoes, echoes);
    echoes.forEach(echo => near(echo.b.translation().z, -50, 'follow convergence'));
    powers.followTransition({ x: 0, y: .41, z: 4 }, Infinity);
    powers.remap(p => { p.x += .25; return p; });
    powers.resumeAfterTransition(2100);
    echoes.forEach(echo => {
      assert.equal(echo.c.collisionGroups(), powers.echoGroups);
      assert.equal(echo.c.solverGroups(), powers.echoGroups);
      assert.equal(echo.b.bodyType(), RAPIER.RigidBodyType.KinematicPositionBased);
      assert.equal(echo.isHeld, true);
      assert.equal(echo.staged, true);
      assert.equal(echo.transitionParked, false);
      near(speed(echo.b), 0, 'stationary staged survivor');
      assert.equal(powers.holdEcho(echo), false, 'staged echo cannot be picked separately');
      assert.equal(powers.releaseEcho(echo, { x: 0, y: 0, z: -20 }), false);
    });
    const stagedPositions = echoes.map(echo => ({ ...echo.b.translation() }));
    for (let i = 0; i < 180; i++) { powers.step(DT, 2101 + i * DT, BOUNDS); world.step(); }
    echoes.forEach((echo, index) => vectorNear(echo.b.translation(), stagedPositions[index], 'staged position resists gravity'));
    assert.equal(powers.launchStaged({ x: 0, y: 0, z: -20 }), 2);
    assert.equal(powers.launchStaged({ x: 0, y: 0, z: -20 }), 0, 'main-shot release happens once');
    const launchTime = powers.time;
    powers.step(DT, launchTime + DT, BOUNDS);
    world.step();
    assert.ok(echoes.every(echo => Math.hypot(echo.b.linvel().x, echo.b.linvel().z) > 19.5), 'real physics tick preserves full staged-launch speed');
    echoes.forEach(echo => {
      assert.equal(echo.staged, false);
      assert.equal(echo.isHeld, false);
      assert.equal(echo.b.bodyType(), RAPIER.RigidBodyType.Dynamic);
      near(Math.hypot(echo.b.linvel().x, echo.b.linvel().z), 20, 'coherent main-shot speed after damping', .02);
      assert.ok(echo.b.linvel().z < -19.8, 'small angular spread keeps the same direction');
      assert.equal(powers.holdEcho(echo), true, 'launched echo is catchable again');
    });
  });
});

test('Only lost echoes are removed and split completion waits for the last survivor', () => {
  withPhysics(({ powers, colliders, finished }) => {
    const [first, second] = split(powers);
    first.b.setTranslation({ x: 0, y: -3, z: 0 }, true);
    powers.step(DT, 1000, BOUNDS);
    assert.equal(powers.isValid(first), false);
    assert.equal(first.valid, false);
    assert.equal(colliders.has(first.c.handle), false);
    assert.equal(powers.isValid(second), true);
    assert.deepEqual(finished, []);
    second.b.setTranslation({ x: 0, y: .5, z: BOUNDS.bottom + 1 }, true);
    powers.step(DT, 1001, BOUNDS);
    assert.equal(powers.echoes.length, 0);
    assert.deepEqual(finished, [undefined]);
    split(powers, { x: 0, y: 0, z: -2 }, 78);
    powers.clear();
    assert.deepEqual(finished, [undefined], 'explicit reset does not send duplicate completion');
  });
});

test('Tornado selects damaged playable clusters, honors defaults, and excludes balls/pickups/debris', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map();
    for (let id = 0; id < 14; id++) addBlock(world, blocks, id,
      { x: .5 + (id % 4) * .6, z: Math.floor(id / 4) * .6 });
    const exclusions = [
      addBlock(world, blocks, 20, { kind: 'ball' }),
      addBlock(world, blocks, 21, { kind: 'pickup' }),
      addBlock(world, blocks, 22, { kind: 'fragment' }),
      addBlock(world, blocks, 23, { fixed: true }),
      addBlock(world, blocks, 24, { x: 20 }),
    ];
    const well = powers.createWell({ x: 0, y: .3, z: 0 }, 0, blocks);
    assert.equal(well.targets.length, 12);
    near(well.range, RADIUS * 2 * 6, 'default orbit range');
    near(well.acceleration, RADIUS * 2 * 35, 'default acceleration');
    near(well.targets[0].remaining, RADIUS * 2 * 24, 'default impulse budget');
    assert.equal(well.expires, 4);
    assert.equal(powers.wellRings.length, 5, 'bounded visual mesh count');
    for (const target of well.targets) {
      assert.ok(target.id < 14);
      assert.equal(powers.intact(blocks.get(target.id)), false, 'target is a damaged cluster');
      const c = blocks.get(target.id).cs[0];
      assert.equal(c.friction(), 0);
      assert.equal(c.frictionCombineRule(), RAPIER.CoefficientCombineRule.Min);
    }
    powers.step(.1, .1, BOUNDS);
    near(blocks.get(0).b.linvel().x, 0, 'no initial inward pull');
    assert.ok(blocks.get(0).b.linvel().z > 1, 'real tangential impulse starts the orbit');
    near(powers.wellRings[0].position.y, 0, 'funnel bottom');
    near(powers.wellRings[4].position.y * powers.wellMesh.scale.y, 2.5, 'funnel world height');
    near(powers.wellRings[0].userData.radius, .15, 'narrow funnel base');
    near(powers.wellRings[4].userData.radius, .6, 'wide funnel top');
    exclusions.forEach(o => {
      near(speed(o.b), 0, 'excluded body velocity');
      near(o.cs[0].friction(), .65, 'excluded collider friction');
    });
    powers.endWell();
    for (const target of well.targets) {
      const c = blocks.get(target.id).cs[0];
      near(c.friction(), .65, 'restored friction');
      assert.equal(c.frictionCombineRule(), RAPIER.CoefficientCombineRule.Multiply);
    }
  });
});

test('Tornado honors stronger explicit configuration and restores safely after target destruction', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map();
    for (let id = 0; id < 4; id++) addBlock(world, blocks, id, { x: .5 + id });
    const well = powers.createWell({ x: 0, y: .3, z: 0 }, 1, blocks,
      { radiusD: 20, duration: 8, accelerationD: 80, maxDeltaSpeedD: 60, maxTargets: 2 });
    assert.equal(well.targets.length, 2);
    near(well.range, 15.2, 'custom radius');
    near(well.acceleration, 60.8, 'custom acceleration');
    near(well.targets[0].remaining, 45.6, 'custom impulse budget');
    assert.equal(well.expires, 9);
    const removed = blocks.get(well.targets[0].id);
    world.removeRigidBody(removed.b);
    blocks.delete(removed.id);
    const replacement = addBlock(world, blocks, 100, { x: 1 });
    replacement.cs[0].setFriction(.91);
    replacement.cs[0].setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
    powers.step(DT, 2, BOUNDS);
    powers.endWell();
    near(replacement.cs[0].friction(), .91, 'replacement collider must not inherit old friction');
    assert.equal(replacement.cs[0].frictionCombineRule(), RAPIER.CoefficientCombineRule.Max);
    const survivor = blocks.get(well.targets[1].id).cs[0];
    near(survivor.friction(), .65, 'surviving target restored');
    assert.equal(survivor.frictionCombineRule(), RAPIER.CoefficientCombineRule.Multiply);
  });
});

test('Tornado orbits on a high-friction floor without central collapse and restores on expiry', () => {
  withPhysics(({ powers, world }) => {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    const floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20)
      .setFriction(.85), floor);
    const blocks = new Map();
    const target = addBlock(world, blocks, 1, { x: 3, half: .3 });
    for (let i = 0; i < 90; i++) world.step();
    const start = target.b.translation().x;
    const well = powers.createWell({ x: 0, y: .3, z: 0 }, 0, blocks);
    let halfSecondZ, smallestRadius = Infinity, angleTravel = 0, lastAngle = 0;
    for (let i = 0; i < 360; i++) {
      powers.step(DT, i * DT, BOUNDS);
      world.step();
      const p = target.b.translation(), angle = Math.atan2(p.z, p.x);
      const delta = Math.atan2(Math.sin(angle - lastAngle), Math.cos(angle - lastAngle));
      angleTravel += delta; lastAngle = angle;
      smallestRadius = Math.min(smallestRadius, Math.hypot(p.x, p.z));
      if (i === 44) halfSecondZ = p.z;
    }
    assert.ok(halfSecondZ > 1, 'cube must visibly orbit within half a second');
    assert.ok(smallestRadius > start * .9, 'orbit never collapses toward center');
    near(Math.hypot(target.b.translation().x, target.b.translation().z), start, 'retains original radius', .1);
    assert.ok(angleTravel > 3, 'cube travels more than half a turn in four seconds');
    assert.ok(well.targets[0].remaining > 0, 'orbit retains bounded correction headroom');
    near(floorCollider.friction(), .85, 'global floor friction remains untouched');
    powers.step(DT, 4.01, BOUNDS);
    assert.equal(powers.well, null);
    assert.equal(powers.wellMesh.visible, false);
    near(target.cs[0].friction(), .65, 'expired target friction');
    assert.equal(target.cs[0].frictionCombineRule(), RAPIER.CoefficientCombineRule.Multiply);
  });
});

function liveSnapshot(powers, main) {
  return Object.freeze([
    { position: { ...main.position }, velocity: { ...main.velocity }, radius: RADIUS },
    ...powers.echoes.map(echo => ({ position: { ...echo.b.translation() }, velocity: { ...echo.b.linvel() }, radius: powers.echoRadius })),
  ].map(source => Object.freeze({ position: Object.freeze(source.position), velocity: Object.freeze(source.velocity), radius: source.radius })));
}

function multiplySplit(powers, main, activationId, bounds = null) {
  const sources = liveSnapshot(powers, main);
  const before = powers.echoes.map(echo => ({ echo, position: { ...echo.b.translation() }, velocity: { ...echo.b.linvel() } }));
  assert.equal(powers.spawnSplit({ activationId, angleDegrees: 18 }, main.position, main.velocity, activationId, sources, bounds), true);
  assert.equal(powers.echoes.length, before.length + sources.length * 2, 'only the activation snapshot creates children');
  for (const old of before) {
    assert.equal(powers.isValid(old.echo), true, 'original echo remains live');
    vectorNear(old.echo.b.translation(), old.position, 'original position unchanged');
    vectorNear(old.echo.b.linvel(), old.velocity, 'original velocity unchanged');
  }
  return sources;
}

test('Repeated Split multiplies the frozen live population 1 → 3 → 9 → 27 exactly once per activation', () => {
  withPhysics(({ powers, finished, colliders, scene }) => {
    const main = { position: { x: 0, y: .41, z: 4.3 }, velocity: { x: 0, y: 0, z: -20 } };
    for (const [activationId, total] of [[101, 3], [102, 9], [103, 27]]) {
      const sources = multiplySplit(powers, main, activationId);
      assert.equal(powers.echoes.length + 1, total);
      assert.equal(sources.length, total / 3, 'snapshot never includes this activation’s children');
      assert.equal(powers.spawnSplit({ activationId }, main.position, main.velocity, 0, sources), false,
        'duplicate delivery of one activation cannot multiply recursively');
      assert.equal(powers.echoes.length + 1, total);
    }
    assert.equal(new Set(powers.echoes.map(echo => echo.id)).size, 26, 'stable unique echo identities');
    assert.equal(new Set(powers.echoes.map(echo => echo.b.handle)).size, 26, 'unique Rapier bodies');
    assert.equal(powers.liveEchoes.size, 26);
    assert.equal(powers.echoInstances.count, 26);
    assert.ok(powers.echoCapacity >= 26);
    assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1, 'one physical-ball render batch');
    assert.equal(scene.children.filter(child => child.isMesh && !child.isInstancedMesh).length, 0,
      'no separate mesh draw call per echo');
    const oldest = powers.echoes.find(echo => echo.activationId === 101);
    for (const echo of [...powers.echoes]) if (echo !== oldest) powers.removeEcho(echo);
    assert.deepEqual(finished, [], 'newer generations disappearing does not finish surviving older ones');
    assert.equal(powers.isValid(oldest), true);
    assert.equal(oldest.index, 0, 'swap removal keeps the live index valid');
    powers.removeEcho(oldest);
    assert.deepEqual(finished, [undefined], 'population completion carries no stale generation ID');
    assert.equal(powers.echoes.length, 0);
    assert.equal(powers.liveEchoes.size, 0);
    assert.equal(powers.echoInstances.count, 0);
    assert.equal(colliders.size, 0);
  });
});

test('A 27-ball transition formation fits the lower zone without overlaps and every echo remains catchable', () => {
  withPhysics(({ powers, world }) => {
    const main = { position: { x: 0, y: .41, z: 4.3 }, velocity: { x: 0, y: 0, z: -20 } };
    for (const activationId of [201, 202, 203]) multiplySplit(powers, main, activationId);
    const bounds = { lowerZoneZ: 0, bottom: 6, tableHalf: z => 3.5 - z * .05 };
    powers.parkForTransition(main.position, bounds);
    for (const point of [{ x: 0, y: .41, z: 4.3 }, { x: 2.45, y: .41, z: 5.5 }, { x: -2.45, y: .41, z: .6 }]) {
      powers.followTransition(point, Infinity, bounds);
      const positions = powers.echoes.map(echo => echo.b.translation());
      positions.forEach((p, index) => {
        assert.ok(p.z >= bounds.lowerZoneZ + powers.echoRadius, 'lower-zone center stays catchable');
        assert.ok(p.z <= bounds.bottom - powers.echoRadius, 'formation stays clear of the loss edge');
        assert.ok(Math.abs(p.x) + powers.echoRadius < bounds.tableHalf(p.z), 'formation stays inside table width');
        assert.ok(Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) >= RADIUS + powers.echoRadius,
          'echo does not overlap the main ball');
        for (let j = 0; j < index; j++) {
          const other = positions[j];
          assert.ok(Math.hypot(p.x - other.x, p.y - other.y, p.z - other.z) >= powers.echoRadius * 2,
            'echo formation has no overlapping pair');
        }
      });
    }
    powers.followTransition({ x: 0, y: .41, z: -50 }, Infinity, null);
    assert.ok(powers.echoes.every(echo => echo.b.translation().z < -45), 'unbounded travel follows the convoy');
    powers.followTransition(main.position, Infinity, bounds);
    powers.resumeAfterTransition(210);
    assert.equal(powers.launchStaged(main.velocity), 26);
    for (const echo of powers.echoes) {
      assert.equal(powers.isValid(echo), true);
      assert.equal(powers.holdEcho(echo), true, 'every survivor can be caught');
    }
    for (let i = 0; i < 90; i++) { powers.step(DT, 211 + i * DT, bounds); world.step(); }
    assert.equal(powers.echoes.length, 26);
  });
});

test('Instanced echo rendering grows through 27/81/243 balls without a gameplay cap', t => {
  withPhysics(({ powers, world, scene }) => {
    const main = { position: { x: 0, y: .41, z: 4.3 }, velocity: { x: 0, y: 0, z: -20 } };
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, .2, 50).setFriction(.35), floor);
    const warmup = powers.warmupObjects();
    const warmEcho = warmup.children.find(child => child.isInstancedMesh);
    assert.ok(warmEcho, 'warmup must compile the instanced echo shader');
    assert.equal(warmEcho.count, 1);
    const matrix = new THREE.Matrix4();
    warmEcho.getMatrixAt(0, matrix);
    assert.deepEqual(matrix.elements, new THREE.Matrix4().elements, 'warmup has a valid identity instance matrix');
    warmEcho.dispose();
    let activationId = 300;
    for (const total of [3, 9, 27, 81, 243]) {
      multiplySplit(powers, main, ++activationId);
      assert.equal(powers.echoes.length + 1, total);
      assert.ok(powers.echoCapacity >= total - 1);
      assert.equal(powers.echoInstances.count, total - 1);
      assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1);
      if (total < 27) continue;
      powers.parkForTransition(main.position, { lowerZoneZ: 0, bottom: 6, halfWidth: 6.25 });
      powers.resumeAfterTransition(0);
      assert.equal(powers.launchStaged(main.velocity), total - 1);
      for (const echo of powers.echoes) echo.b.setLinvel({ x: Math.sin(echo.id) * 15, y: 0, z: Math.cos(echo.id) * 15 }, true);
      assert.ok(powers.echoes.every(echo => echo.b.isDynamic() && (echo.c.collisionGroups() & 16) !== 0), 'benchmark uses active mutually colliding dynamic balls');
      const start = performance.now();
      for (let step = 0; step < 120; step++) {
        powers.step(DT, step * DT, BOUNDS);
        world.step();
        powers.render();
      }
      const average = (performance.now() - start) / 120;
      assert.equal(powers.echoes.length + 1, total, 'all benchmark balls remain physically live');
      t.diagnostic(`${total} total balls: ${average.toFixed(3)} ms per active headless CPU physics/update step on a floor; this is not rendered device FPS.`);
    }
    const echoes = [...powers.echoes];
    powers.clear();
    assert.equal(powers.liveEchoes.size, 0);
    assert.equal(powers.echoInstances.count, 0);
    assert.ok(echoes.every(echo => !echo.valid && !echo.b.isValid()), 'all physical bodies clean up');
  });
});

test('Non-transfer main reposition leaves live and held extra balls unchanged',()=>withPhysics(({powers})=>{const [held,moving]=split(powers);powers.holdEcho(held);const before={...moving.b.linvel()};powers.resumeAfterTransition(5);assert.equal(held.isHeld,true);vectorNear(moving.b.linvel(),before,'Moving extra retains velocity');}));

test('Real Rapier contacts bounce extra↔extra and main↔extra, including Pierce-compatible solver masks', () => {
  const neutral = { ...BOUNDS, upperStallAcceleration: 0, lowerReturnAcceleration: 0, lowerZoneZ: 50 };
  withPhysics(({ powers, world }) => {
    const [left, right] = split(powers);
    left.b.setTranslation({ x: -1, y: .5, z: 0 }, true);
    right.b.setTranslation({ x: 1, y: .5, z: 0 }, true);
    left.b.setLinvel({ x: 5, y: 0, z: 0 }, true);
    right.b.setLinvel({ x: -5, y: 0, z: 0 }, true);
    for (const echo of [left, right]) { echo.c.setRestitution(1); echo.c.setFriction(0); }
    const queue = new RAPIER.EventQueue(true);
    let pairContact = false;
    try {
      for (let i = 0; i < 50; i++) {
        powers.step(DT, i * DT, neutral);
        world.step(queue);
        queue.drainCollisionEvents((a, b, start) => {
          if (start && [a, b].includes(left.c.handle) && [a, b].includes(right.c.handle)) pairContact = true;
        });
      }
      assert.equal(pairContact, true, 'extra spheres produce a real contact event');
      assert.ok(left.b.linvel().x < -4 && right.b.linvel().x > 4, 'extra balls bounce away from each other');
    } finally { queue.free(); }
  }, { x: 0, y: 0, z: 0 });
  withPhysics(({ powers, world }) => {
    const [echo, other] = split(powers);
    powers.removeEcho(other, false);
    const main = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, .5, 0).setCcdEnabled(true));
    const mainCollider = world.createCollider(RAPIER.ColliderDesc.ball(RADIUS).setDensity(2)
      .setFriction(0).setRestitution(1).setCollisionGroups(0x00020017).setSolverGroups(0x00020013)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), main);
    echo.c.setSolverGroups(0x00100013);
    echo.c.setFriction(0); echo.c.setRestitution(1);
    echo.b.setTranslation({ x: 1, y: .5, z: 0 }, true);
    echo.b.setLinvel({ x: -5, y: 0, z: 0 }, true);
    main.setLinvel({ x: 5, y: 0, z: 0 }, true);
    const queue = new RAPIER.EventQueue(true);
    let pairContact = false;
    try {
      for (let i = 0; i < 50; i++) {
        powers.step(DT, i * DT, neutral);
        world.step(queue);
        queue.drainCollisionEvents((a, b, start) => {
          if (start && [a, b].includes(mainCollider.handle) && [a, b].includes(echo.c.handle)) pairContact = true;
        });
      }
      assert.equal(pairContact, true, 'main and extra spheres still contact during Pierce');
      assert.ok(echo.b.linvel().x > 0, 'extra ball reverses after the main-ball collision');
      assert.ok(main.linvel().x < 4.9, 'main ball also receives the collision impulse');
    } finally { queue.free(); }
  }, { x: 0, y: 0, z: 0 });
});

test('Repeated Split places 81 mutually colliding balls without overlaps or rail/loss-edge violations', () => {
  withPhysics(({ powers }) => {
    const main = { position: { x: 1.6, y: .41, z: 5.3 }, velocity: { x: 9, y: 0, z: 10 } };
    const bounds = { top: -6, bottom: 6, tableHalf: () => 2.4 };
    for (const activationId of [601, 602, 603, 604]) {
      multiplySplit(powers, main, activationId, bounds);
      const occupied = [{ position: main.position, radius: RADIUS },
        ...powers.echoes.map(echo => ({ position: echo.b.translation(), radius: powers.echoRadius }))];
      occupied.forEach((sphere, index) => {
        if (index) {
          assert.ok(Math.abs(sphere.position.x) + sphere.radius < bounds.tableHalf(sphere.position.z));
          assert.ok(sphere.position.z - sphere.radius > bounds.top);
          assert.ok(sphere.position.z + sphere.radius < bounds.bottom);
          assert.ok(sphere.position.y >= sphere.radius);
        }
        for (let j = 0; j < index; j++) {
          const other = occupied[j];
          assert.ok(Math.hypot(sphere.position.x - other.position.x, sphere.position.y - other.position.y,
            sphere.position.z - other.position.z) >= sphere.radius + other.radius,
          `overlapping physical spawn pair ${index}/${j}`);
        }
      });
    }
    assert.equal(powers.echoes.length, 80);
    assert.ok(powers.echoes.some(echo => echo.b.translation().y > main.position.y + powers.echoRadius),
      'dense rail-adjacent populations can use separated height layers');
  });
});

test('Upper-zone anti-stall impulse starts a settled extra ball rolling on a real floor', () => {
  withPhysics(({ powers, world }) => {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20).setFriction(.35), floor);
    const [echo, other] = split(powers);
    powers.removeEcho(other, false);
    echo.b.setTranslation({ x: 0, y: powers.echoRadius + .01, z: -3 }, true);
    echo.b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 90; i++) world.step();
    const before = echo.b.translation().z;
    for (let i = 0; i < 180; i++) {
      powers.step(DT, i * DT, { ...BOUNDS, lowerZoneZ: 4 });
      world.step();
    }
    assert.ok(echo.b.translation().z - before > 1, 'anti-stall force overcomes rolling/floor resistance');
    assert.ok(echo.b.linvel().z > .5, 'upper low-speed ball moves down the table');
    echo.b.setLinvel({ x: 10, y: 0, z: -8 }, true);
    const fast = { ...echo.b.linvel() };
    powers.step(DT, 3, BOUNDS);
    vectorNear(echo.b.linvel(), fast, 'fast upper-zone ball is not given a forced return impulse');
  });
});

test('A rested upper-zone extra traverses the real floor, gets one catch second, then returns through loss', () => {
  withPhysics(({ powers, world, finished }) => {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20).setFriction(.35), floor);
    const [echo, other] = split(powers);
    powers.removeEcho(other, false);
    echo.b.setTranslation({ x: 0, y: powers.echoRadius + .01, z: -3 }, true);
    echo.b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 90; i++) world.step();
    const bounds = { top: -10, bottom: 6, halfWidth: 20, lowerZoneZ: 0 };
    let entryTime = null, returnTime = null, lostTime = null;
    for (let i = 0; i < 900; i++) {
      const now = i * DT;
      powers.step(DT, now, bounds);
      if (!powers.isValid(echo)) { lostTime = now; break; }
      if (echo.inLowerZone && entryTime === null) entryTime = now;
      if (echo.returning && returnTime === null) returnTime = now;
      if (echo.inLowerZone && !echo.returning) {
        assert.ok(Math.hypot(echo.b.linvel().x, echo.b.linvel().z) <= 2.8001,
          'real catch-window motion remains slow');
      }
      world.step();
    }
    assert.notEqual(entryTime, null, 'anti-stall acceleration reaches the lower zone');
    assert.notEqual(returnTime, null, 'one-second catch window expires');
    assert.ok(returnTime - entryTime >= 1 - 1e-6 && returnTime - entryTime <= 1 + DT + 1e-6,
      'catch period is one actual simulation second');
    assert.notEqual(lostTime, null, 'downward return eventually crosses the loss boundary');
    assert.ok(lostTime > returnTime);
    assert.equal(echo.valid, false);
    assert.equal(powers.echoes.length, 0);
    assert.deepEqual(finished, [undefined]);
  });
});

test('Black Hole starts at zero force, ramps smoothly, and targets only playable cubes', () => {
  withPhysics(({ powers, world, hits }) => {
    const blocks = new Map();
    const cube = addBlock(world, blocks, 1, { x: 3 });
    const excluded = [
      addBlock(world, blocks, 2, { kind: 'ball' }),
      addBlock(world, blocks, 3, { kind: 'echo' }),
      addBlock(world, blocks, 4, { kind: 'pickup' }),
      addBlock(world, blocks, 5, { kind: 'fragment' }),
      addBlock(world, blocks, 6, { fixed: true }),
      addBlock(world, blocks, 7, { x: 20 }),
    ];
    const damage = cube.damage, stage = cube.stage, ids = [...cube.ids];
    Object.defineProperty(cube, 'damage', { get: () => damage, set: () => { throw new Error('direct damage is forbidden'); } });
    const hole = powers.createBlackHole({ x: 0, y: 2, z: 0 }, 10, blocks);
    assert.deepEqual(hole.targets.map(target => target.id), [1]);
    near(hole.radius, RADIUS * 13.2, 'default reduced 6.6-diameter radius');
    near(hole.acceleration, 50, 'bounded peak acceleration');
    near(hole.maxSpeed, 14, 'default speed cap');
    near(hole.expires, 13.5, '3.5-second life');
    near(hole.intensity, 0, 'initial visual intensity');
    cube.b.setLinvel({ x: 2, y: -1, z: .5 }, true);
    powers.step(.1, 10, BOUNDS);
    vectorNear(cube.b.linvel(), { x: 2, y: -1, z: .5 }, 'age-zero field applies no force or damping');
    for (const [age, intensity] of [[7/24, .15625], [7/12, .5], [7/6, 1]]) {
      cube.b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      powers.step(.1, 10 + age, BOUNDS);
      near(hole.age, age, 'public visual age');
      near(hole.intensity, intensity, 'smoothstep force envelope');
      near(speed(cube.b), 50 * intensity * .1, 'mass-independent capped impulse', 1e-4);
      assert.ok(cube.b.linvel().x < 0 && cube.b.linvel().y > 0, 'field pulls and lifts toward its elevated center');
    }
    for (const body of excluded) {
      near(speed(body.b), 0, 'excluded velocity');
      near(body.cs[0].friction(), .65, 'excluded friction');
    }
    assert.equal(cube.damage, damage);
    assert.equal(cube.stage, stage);
    assert.deepEqual(cube.ids, ids);
    assert.deepEqual(hits, [], 'field does not issue direct hit/damage callbacks');
    powers.remap(p => { p.x += 10; p.z -= 4; });
    vectorNear(hole.point, { x: 10, y: 2, z: -4 }, 'Black Hole center remaps with the arena');
  }, { x: 0, y: 0, z: 0 });
});

test('Black Hole honors canonical speedCap, configured target count, and a bounded default of 64', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map();
    for (let id = 0; id < 70; id++) addBlock(world, blocks, id,
      { x: (id % 10 - 4.5) * .5, z: (Math.floor(id / 10) - 3) * .5 });
    const initial = powers.createBlackHole({ x: 0, y: 2, z: 0 }, 0, blocks);
    assert.equal(initial.targets.length, 64, 'Black Hole is not restricted to the old small well cap');
    const hole = powers.createBlackHole({ x: 0, y: 2, z: 0 }, 0, blocks,
      { radiusD: 20, duration: 9, rampDuration: 0, acceleration: 100, speedCap: 4, maxSpeed: 99, maxTargets: 2 });
    assert.equal(hole.targets.length, 2);
    near(hole.radius, 15.2, 'configured radius');
    near(hole.expires, 9, 'configured duration');
    near(hole.maxSpeed, 4, 'speedCap takes precedence over legacy alias');
    powers.step(.1, 0, BOUNDS);
    for (const target of hole.targets) near(speed(target.body), 4, 'actual desired-speed cap');
    assert.equal(powers.frictionLeases.size, 2, 'replacement releases all former targets outside its new selection');
    powers.endBlackHole();
    assert.equal(powers.frictionLeases.size, 0);
    for (const cube of blocks.values()) near(cube.cs[0].friction(), .65, 'all original friction restored');
  }, { x: 0, y: 0, z: 0 });
});

test('Black Hole visibly lifts a real cube off a high-friction floor, arrives safely, and releases at 3.5 seconds', () => {
  withPhysics(({ powers, world }) => {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    const floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20).setFriction(.9), floor);
    const blocks = new Map(), cube = addBlock(world, blocks, 1, { x: 3, half: .3 });
    for (let i = 0; i < 90; i++) world.step();
    const center = { x: 0, y: 3, z: 0 }, start = { ...cube.b.translation() };
    const hole = powers.createBlackHole(center, 0, blocks);
    let maxHeight = start.y, maxSpeed = 0;
    for (let i = 0; i < 315; i++) {
      powers.step(DT, i * DT, BOUNDS);
      world.step();
      maxHeight = Math.max(maxHeight, cube.b.translation().y);
      maxSpeed = Math.max(maxSpeed, speed(cube.b));
      assert.ok(Number.isFinite(speed(cube.b)), 'attraction remains finite');
    }
    const p = cube.b.translation();
    assert.ok(maxHeight > start.y + 2, 'visible lift overcomes gravity and floor friction');
    assert.ok(Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) < .5,
      'arrival damping holds the cube near the elevated center');
    assert.ok(maxSpeed < 14.3, 'bounded attraction does not create an explosive speed');
    near(floorCollider.friction(), .9, 'global floor remains untouched');
    powers.step(DT, 3.5, BOUNDS);
    assert.equal(powers.blackHole, null);
    assert.equal(hole.active, false);
    assert.equal(hole.intensity, 0);
    near(cube.cs[0].friction(), .65, 'expiry restores cube friction');
    const releaseHeight = cube.b.translation().y;
    for (let i = 0; i < 30; i++) { powers.step(DT, 3.5 + (i + 1) * DT, BOUNDS); world.step(); }
    assert.ok(cube.b.translation().y < releaseHeight - .5, 'released cube falls under real gravity');
  });
});

test('Escaping the Black Hole radius releases force and friction immediately and permits later recapture', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map(), cube = addBlock(world, blocks, 1, { x: 1 });
    const hole = powers.createBlackHole({ x: 0, y: .3, z: 0 }, 0, blocks, { radiusD: 2 });
    assert.equal(hole.targets.length, 1);
    cube.b.setTranslation({ x: hole.radius + .1, y: .3, z: 0 }, true);
    cube.b.setLinvel({ x: 1, y: 2, z: 3 }, true);
    powers.step(.1, 2, BOUNDS);
    assert.equal(hole.targets.length, 0, 'range is checked each active step');
    vectorNear(cube.b.linvel(), { x: 1, y: 2, z: 3 }, 'escaped cube receives no impulse');
    near(cube.cs[0].friction(), .65, 'escaped cube friction restored');
    assert.equal(powers.frictionLeases.size, 0);
    cube.b.setTranslation({ x: 1, y: .3, z: 0 }, true);
    powers.step(DT, 2.21, BOUNDS);
    assert.equal(hole.targets.length, 1, 'bounded refresh can acquire a returning playable cluster');
    near(cube.cs[0].friction(), 0, 'recaptured cube leases friction again');
    cube.kind = 'fragment';
    powers.step(DT, 2.22, BOUNDS);
    assert.equal(hole.targets.length, 0, 'nonplayable debris drops out immediately');
    near(cube.cs[0].friction(), .65, 'debris conversion restores friction');
  }, { x: 0, y: 0, z: 0 });
});

test('Tornado and Black Hole share friction ownership and restore safely on replacement, clear, and transition', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map(), cube = addBlock(world, blocks, 1, { x: 1 });
    const point = { x: 0, y: .3, z: 0 };
    for (const endFirst of ['well', 'blackHole']) {
      powers.createWell(point, 0, blocks);
      powers.createBlackHole(point, 0, blocks);
      assert.equal(powers.frictionLeases.size, 1, 'one original friction record per collider');
      assert.equal([...powers.frictionLeases.values()][0].owners.size, 2);
      if (endFirst === 'well') powers.endWell(); else powers.endBlackHole();
      near(cube.cs[0].friction(), 0, 'one remaining effect keeps friction disabled');
      if (endFirst === 'well') powers.endBlackHole(); else powers.endWell();
      near(cube.cs[0].friction(), .65, 'last owner restores the original coefficient');
      assert.equal(cube.cs[0].frictionCombineRule(), RAPIER.CoefficientCombineRule.Multiply);
      assert.equal(powers.frictionLeases.size, 0);
    }
    powers.createBlackHole(point, 0, blocks);
    const replacement = powers.createBlackHole({ x: 100, y: 2, z: 0 }, 1, blocks);
    assert.equal(replacement.targets.length, 0);
    near(cube.cs[0].friction(), .65, 'replacement ends the old field lease');
    powers.createWell(point, 0, blocks); powers.createBlackHole(point, 0, blocks);
    powers.clear();
    assert.equal(powers.blackHole, null); assert.equal(powers.well, null);
    near(cube.cs[0].friction(), .65, 'reset restores concurrent leases');
    powers.createWell(point, 0, blocks); powers.createBlackHole(point, 0, blocks);
    powers.parkForTransition({ x: 0, y: .41, z: 4 });
    assert.equal(powers.blackHole, null); assert.equal(powers.well, null);
    assert.equal(powers.frictionLeases.size, 0);
    near(cube.cs[0].friction(), .65, 'transition ends both effects');
  });
});

test('Black Hole safely releases a destroyed body without corrupting a replacement collider', () => {
  withPhysics(({ powers, world }) => {
    const blocks = new Map(), old = addBlock(world, blocks, 1, { x: 1 });
    const hole = powers.createBlackHole({ x: 0, y: .3, z: 0 }, 0, blocks);
    world.removeRigidBody(old.b); blocks.delete(old.id);
    const replacement = addBlock(world, blocks, 1, { x: 20 });
    replacement.cs[0].setFriction(.91);
    replacement.cs[0].setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
    powers.step(DT, 1, BOUNDS);
    assert.equal(hole.targets.length, 0);
    assert.equal(powers.frictionLeases.size, 0);
    powers.endBlackHole();
    near(replacement.cs[0].friction(), .91, 'replacement collider identity is protected');
    assert.equal(replacement.cs[0].frictionCombineRule(), RAPIER.CoefficientCombineRule.Max);
  });
});

test('Bomb impulse grace preserves a free echo kick but rejects held, parked, staged, and removed echoes', () => {
  withPhysics(({ powers, world }) => {
    const [echo, other] = split(powers); powers.removeEcho(other, false);
    echo.b.setTranslation({ x: 0, y: 1, z: 5 }, true);
    echo.b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    powers.step(DT, 0, BOUNDS);
    assert.equal(echo.inLowerZone, true);
    const kick = { x: 12, y: 0, z: 2 };
    assert.equal(powers.blastEcho(echo, kick, .1, .6), true);
    for (let i = 0; i < 50; i++) {
      powers.step(DT, .1 + i * DT, BOUNDS); world.step();
      assert.ok(Math.hypot(echo.b.linvel().x, echo.b.linvel().z) > 11.5, 'actual motion keeps the Bomb kick during grace');
    }
    near(echo.impulseGraceUntil, .7, 'bounded grace lifetime');
    powers.step(DT, .71, BOUNDS);
    near(Math.hypot(echo.b.linvel().x, echo.b.linvel().z), 2.8, 'normal catch control resumes after grace');
    powers.holdEcho(echo);
    assert.equal(powers.grantImpulseGrace(echo), false);
    assert.equal(powers.blastEcho(echo, kick), false);
    near(speed(echo.b), 0, 'held ball cannot be bomb launched');
    powers.parkForTransition({ x: 0, y: .41, z: 4 });
    assert.equal(powers.blastEcho(echo, kick), false);
    powers.resumeAfterTransition(2);
    assert.equal(powers.grantImpulseGrace(echo), false);
    assert.equal(powers.blastEcho(echo, kick), false);
    near(speed(echo.b), 0, 'staged ball remains still');
    powers.launchStaged(kick);
    assert.equal(powers.grantImpulseGrace(echo, .6, 2), true);
    powers.removeEcho(echo, false);
    assert.equal(powers.grantImpulseGrace(echo), false);
  }, { x: 0, y: 0, z: 0 });
});
