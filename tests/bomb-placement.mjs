import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { arenaBlocks, arenaDefinition, setArenaRunSeed } from '../src/arena-data.js';
import { BONUS_DEFS } from '../src/bonus-controller.js';
import { createBonusVisuals } from '../src/bonus-visuals.js';
import { BOMB_LANDING_Y, bombLandingPoint } from '../src/bomb-placement.js';
import { GLASS, TUNE } from '../src/config.js';

const DEFAULT_SEED = 0x00c57a11;
const RADIUS = BONUS_DEFS.bomb.radiusD * .76;
const profiles = {
  default: {},
  portrait: { layoutZ: z => z * 2.4, bounds: { top: -15, half: 6.25 } },
  wide: { layoutZ: z => z * .75, bounds: { top: -4.8, half: z => 5.4 + (z + 4.8) * .05 } },
  short: { layoutZ: z => z * .22, bounds: { top: -1.5, half: 2.8 } },
};

// Independently mirror addBlock's final collision-bounds clamp, including the
// unrotated bridge. All originals, not only T1 or bonus cubes, can be blasted.
function originalCenter(spec, bounds = {}) {
  const half = typeof bounds.half === 'function' ? bounds.half : () => bounds.half ?? 6.25;
  const rotated = spec[4] === spec[5] && spec[5] === spec[6];
  const extentX = rotated ? (spec[4] + spec[6]) / Math.sqrt(2) / 2 : spec[4] / 2;
  const extentZ = rotated ? extentX : spec[6] / 2;
  const limit = Math.min(half(spec[2] - extentZ), half(spec[2] + extentZ)) - extentX - .34;
  return { x: Math.max(-limit, Math.min(limit, spec[0])), y: spec[1], z: spec[2] };
}

function blastCount(centers, carrier, bounds, override) {
  const point = override || bombLandingPoint(centers[carrier], bounds);
  return centers.filter((center, index) => index !== carrier &&
    Math.hypot(center.x - point.x, center.y - BOMB_LANDING_Y, center.z - point.z) <= RADIUS).length;
}

test('Bomb scoring uses the actual normalized released model landing height', () => {
  const visuals = createBonusVisuals(THREE), bomb = visuals.createModel('bomb');
  try {
    bomb.scale.setScalar(TUNE.ballRadius * 2 * 1.3);
    const box = new THREE.Box3().setFromObject(bomb);
    assert.equal(Math.max(.1, -box.min.y + .012), BOMB_LANDING_Y);
    assert.equal(BOMB_LANDING_Y, .506);
    assert.equal(RADIUS, 3.3440000000000003);
  } finally { visuals.releaseInstance(bomb); visuals.dispose(); }
});

test('Bomb landing clamp stays in the upper field and obeys the rail width at final Z', () => {
  const bounds = { top: -15, mid: 2, half: z => 4 + (z + 15) * .05 };
  assert.deepEqual(bombLandingPoint({ x: 1, z: -5 }, bounds), { x: 1, z: -5 });
  const rear = bombLandingPoint({ x: -12, z: -30 }, bounds);
  assert.equal(rear.z, -14.19);
  assert.equal(rear.x, -(bounds.half(rear.z) - .71));
  const front = bombLandingPoint({ x: 12, z: 5 }, bounds);
  assert.equal(front.z, 1.95);
  assert.equal(front.x, bounds.half(front.z) - .71);
  assert.deepEqual(bombLandingPoint({ x: 0, z: -2 }), { x: 0, z: -2 });
});

test('Every seeded Bomb maximizes landed 3D coverage over all existing T1 hosts across all arenas and cycles', () => {
  const seenLevels = new Set();
  const seeds = [0, 1, 0xffffffff, DEFAULT_SEED,
    ...Array.from({ length: 28 }, (_, index) => Math.imul(index + 2, 0x9e3779b1) >>> 0)];
  try {
    for (const seed of seeds) {
      setArenaRunSeed(seed);
      for (const [name, options] of Object.entries(profiles)) for (let level = 1; level <= 56; level++) {
        const metadata = arenaDefinition(level), specs = arenaBlocks(level, options);
        assert.equal(specs.length, metadata.blockCount);
        assert.deepEqual(specs.map(spec => spec[7]).filter(Boolean).sort(), [...metadata.bonuses].sort());
        const bombIndex = specs.findIndex(spec => spec[7] === 'bomb');
        if (bombIndex < 0) continue;
        seenLevels.add(level);
        assert.equal(specs[bombIndex][3], 0, 'Bomb never changes a tougher cube into a carrier');
        assert.equal(GLASS[specs[bombIndex][3]].hits, 1, 'a single normal hit breaks the carrier');
        const centers = specs.map(spec => originalCenter(spec, options.bounds));
        const actual = blastCount(centers, bombIndex, options.bounds);
        const eligible = specs.map((spec, index) => spec[3] === 0 ? index : -1).filter(index => index >= 0);
        const best = Math.max(...eligible.map(index => blastCount(centers, index, options.bounds)));
        assert.equal(actual, best, `${seed}/${name}/arena ${level}: Bomb covers the maximum other originals`);
        assert.ok(actual > 0, `${seed}/${name}/arena ${level}: Bomb is never isolated`);
        assert.deepEqual(arenaBlocks(level, options), specs, 'selection is deterministic');
      }
    }
    assert.deepEqual([...seenLevels].sort((a, b) => a - b), Array.from({ length: 55 }, (_, i) => i + 2));
  } finally { setArenaRunSeed(DEFAULT_SEED); }
});

test('Arena 2 improves Bomb coverage in normal and long portrait fields without changing the formation', () => {
  // Prior default-seed farthest-pair host indices are fixed geometry fixtures.
  const cases = [
    { name: 'default', previousHost: 33, before: 13, after: 17 },
    { name: 'portrait', previousHost: 32, before: 6, after: 10 },
  ];
  setArenaRunSeed(DEFAULT_SEED);
  for (const { name, previousHost, before, after } of cases) {
    const options = profiles[name], specs = arenaBlocks(2, options);
    const centers = specs.map(spec => originalCenter(spec, options.bounds));
    const carrier = specs.findIndex(spec => spec[7] === 'bomb');
    assert.equal(blastCount(centers, previousHost, options.bounds), before);
    assert.equal(blastCount(centers, carrier, options.bounds), after);
    assert.equal(carrier, 5);
    assert.equal(specs.length, 36);
    assert.deepEqual(arenaDefinition(2).tierCounts, [32, 4, 0, 0, 0]);
    assert.equal(specs[carrier][3], 0);
  }
});

test('Other powers spread greedily from Bomb across distinct towers and never overwrite its optimal host', () => {
  const squared = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const key = point => `${Math.round(point.x * 1e6)}:${Math.round(point.z * 1e6)}`;
  try {
    for (const seed of [0, 1, DEFAULT_SEED, 0xffffffff]) {
      setArenaRunSeed(seed);
      for (const options of Object.values(profiles)) for (let level = 2; level <= 56; level++) {
        const specs = arenaBlocks(level, options);
        const bombIndex = specs.findIndex(spec => spec[7] === 'bomb');
        if (bombIndex < 0) continue;
        const centers = specs.map(spec => originalCenter(spec, options.bounds));
        const candidates = specs.map((spec, index) => ({ spec, index, ...centers[index] }))
          .filter(candidate => candidate.spec[3] === 0);
        const towers = new Map();
        for (const candidate of candidates) {
          const id = key(candidate), previous = towers.get(id);
          if (!previous || candidate.y < previous.y) towers.set(id, candidate);
        }
        const selected = candidates.filter(candidate => candidate.spec[7]);
        assert.equal(new Set(selected.map(key)).size, Math.min(selected.length, towers.size));
        // Placement order for ordinary kinds is deliberately opaque. Recover
        // the greedy order by repeatedly checking the available widest choice.
        const chosen = [candidates.find(candidate => candidate.index === bombIndex)];
        while (chosen.length < selected.length && chosen.length < towers.size) {
          const unused = [...towers.values()].filter(candidate => !chosen.some(other => key(other) === key(candidate)));
          const minDistance = candidate => Math.min(...chosen.map(other => squared(candidate, other)));
          const maximum = Math.max(...unused.map(minDistance));
          const next = selected.filter(candidate => !chosen.includes(candidate))
            .find(candidate => Math.abs(minDistance(candidate) - maximum) < 1e-9);
          assert.ok(next, `arena ${level}: an ordinary power occupies the farthest remaining tower`);
          chosen.push(next);
        }
      }
    }
  } finally { setArenaRunSeed(DEFAULT_SEED); }
});
