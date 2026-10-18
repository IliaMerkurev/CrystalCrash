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
      powers.step(DT, 1000 + i * DT, BOUNDS, () => {
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

test('Lower-zone slowdown happens once per crossing and preserves relaunch speed', () => {
  withPhysics(({ powers }) => {
    const [echo] = split(powers);
    echo.b.setTranslation({ x: 0, y: 1, z: 5 }, true);
    echo.b.setLinvel({ x: 6, y: 2, z: 10 }, true);
    powers.step(DT, 1, BOUNDS);
    vectorNear(echo.b.linvel(), { x: 1.92, y: 2, z: 3.2 }, 'first lower-zone crossing');
    powers.step(DT, 2, BOUNDS);
    vectorNear(echo.b.linvel(), { x: 1.92, y: 2, z: 3.2 }, 'same crossing is not slowed again');
    echo.b.setTranslation({ x: 0, y: 1, z: 0 }, true);
    powers.step(DT, 3, BOUNDS);
    echo.b.setTranslation({ x: 0, y: 1, z: 5 }, true);
    powers.step(DT, 4, BOUNDS);
    near(echo.b.linvel().z, 1.024, 'second lower-zone crossing');
    assert.equal(powers.holdEcho(echo), true);
    assert.equal(powers.releaseEcho(echo, { x: 3, y: 0, z: -20 }), true);
    powers.step(DT, 5, BOUNDS);
    vectorNear(echo.b.linvel(), { x: 3, y: 0, z: -20 }, 'freshly launched echo');
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

test('Parked echoes survive travel, follow smoothly, and resume catchable without old momentum', () => {
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
      assert.equal(echo.b.bodyType(), RAPIER.RigidBodyType.Dynamic);
      assert.equal(echo.isHeld, false);
      assert.equal(echo.transitionParked, false);
      near(speed(echo.b), 0, 'stationary resume');
      assert.equal(powers.holdEcho(echo), true, 'resumed echo remains catchable');
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

test('Gravity selects damaged playable clusters, honors defaults, and excludes balls/pickups/debris', () => {
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
    near(well.range, RADIUS * 2 * 6, 'default attraction radius');
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
    assert.ok(blocks.get(0).b.linvel().x < -2.65, 'real impulse must pull toward center');
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

test('Gravity honors stronger explicit configuration and restores safely after target destruction', () => {
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

test('Gravity pulls across a high-friction floor, brakes at its center, and restores on expiry', () => {
  withPhysics(({ powers, world }) => {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
    const floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20)
      .setFriction(.85), floor);
    const blocks = new Map();
    const target = addBlock(world, blocks, 1, { x: 3, half: .3 });
    for (let i = 0; i < 90; i++) world.step();
    const start = target.b.translation().x;
    const well = powers.createWell({ x: 0, y: .3, z: 0 }, 0, blocks);
    let halfSecondX;
    for (let i = 0; i < 360; i++) {
      powers.step(DT, i * DT, BOUNDS);
      world.step();
      if (i === 44) halfSecondX = target.b.translation().x;
    }
    assert.ok(start - halfSecondX > 2, 'cube must visibly approach within half a second');
    assert.ok(Math.abs(target.b.translation().x) < .2, 'cube must stay near the well instead of slingshotting');
    assert.ok(Math.abs(target.b.linvel().x) < .1, 'arrival must brake horizontal speed');
    assert.ok(well.targets[0].remaining > 0, 'arrival should retain correction headroom');
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
    { position: { ...main.position }, velocity: { ...main.velocity } },
    ...powers.echoes.map(echo => ({ position: { ...echo.b.translation() }, velocity: { ...echo.b.linvel() } })),
  ].map(source => Object.freeze({ position: Object.freeze(source.position), velocity: Object.freeze(source.velocity) })));
}

function multiplySplit(powers, main, activationId) {
  const sources = liveSnapshot(powers, main);
  const before = powers.echoes.map(echo => ({ echo, position: { ...echo.b.translation() }, velocity: { ...echo.b.linvel() } }));
  assert.equal(powers.spawnSplit({ activationId, angleDegrees: 18 }, main.position, main.velocity, activationId, sources), true);
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
      for (const echo of powers.echoes) echo.b.setLinvel({ x: Math.sin(echo.id) * 15, y: 0, z: Math.cos(echo.id) * 15 }, true);
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
