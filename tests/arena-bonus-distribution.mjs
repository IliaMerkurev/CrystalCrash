import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { arenaBlocks, arenaDefinition, setArenaRunSeed } from '../src/arena-data.js';

const DEFAULT_SEED = 0x00c57a11;
const KINDS = ['pulse', 'pierce', 'arc', 'frost', 'split', 'gravity', 'heavy', 'bomb', 'blackhole'];
const POWERFUL = new Set(['gravity', 'blackhole']);
const ORDINARY = KINDS.filter(kind => kind !== 'split' && !POWERFUL.has(kind));
const seedFor = index => Math.imul(index, 0x9e3779b1) >>> 0;
const sorted = kinds => [...kinds].sort();
const profiles = {
  default: {},
  portrait: { layoutZ: z => z * 2.4, bounds: { top: -15, half: 6.25 } },
  wide: { layoutZ: z => z * .75, bounds: { top: -4.8, half: z => 5.4 + (z + 4.8) * .05 } },
  short: { layoutZ: z => z * .22, bounds: { top: -1.5, half: 2.8 } },
};

test('All fourteen arenas and four cycles keep stable, unique, compatible seeded bonuses', () => {
  const seenCounts = new Set(), seenKinds = new Set();
  const early = new Map([2, 3].map(level => [level, { withSplit: 0, withoutSplit: 0, sets: new Set() }]));
  try {
    for (const seed of [0, 1, 0xffffffff, DEFAULT_SEED, ...Array.from({ length: 24 }, (_, i) => seedFor(i + 2))]) {
      setArenaRunSeed(seed);
      for (let level = 1; level <= 56; level++) {
        const metadata = arenaDefinition(level), bonuses = metadata.bonuses;
        assert.equal(new Set(bonuses).size, bonuses.length, `unique types at ${seed}/${level}`);
        assert.ok(bonuses.every(kind => KINDS.includes(kind)));
        if (level === 1) assert.deepEqual(bonuses, ['pulse']);
        else if (level <= 3) {
          assert.equal(bonuses.length, 2);
          early.get(level)[bonuses.includes('split') ? 'withSplit' : 'withoutSplit']++;
          early.get(level).sets.add(sorted(bonuses).join(','));
        } else {
          assert.ok(bonuses.length >= 2 && bonuses.length <= 5);
          seenCounts.add(bonuses.length);
          bonuses.forEach(kind => seenKinds.add(kind));
        }
        const powerful = bonuses.filter(kind => POWERFUL.has(kind));
        assert.ok(powerful.length <= 1, `no Tornado/Black Hole pair at ${seed}/${level}`);
        if (powerful.length) assert.ok(bonuses.length >= 2 && bonuses.length <= 3);

        const specs = arenaBlocks(level);
        assert.deepEqual(sorted(specs.map(spec => spec[7]).filter(Boolean)), sorted(bonuses));
        assert.ok(specs.filter(spec => spec[7]).every(spec => spec[3] === 0), 'only T1 hosts');
        // Other queries, preview bounds and arena order must not advance a PRNG.
        arenaDefinition(level + 43);
        arenaBlocks(level, profiles.short);
        assert.deepEqual(arenaDefinition(level), metadata);
        assert.deepEqual(arenaBlocks(level), specs);
      }
    }
    assert.deepEqual([...seenCounts].sort(), [2, 3, 4, 5]);
    assert.deepEqual(sorted(seenKinds), sorted(KINDS));
    for (const [level, observations] of early) {
      assert.ok(observations.withSplit > 0, `Split remains possible on arena ${level}`);
      assert.ok(observations.withoutSplit > 0, `Split is not guaranteed on arena ${level}`);
      assert.ok(observations.sets.size > 4, `arena ${level} varies between runs`);
    }
  } finally { setArenaRunSeed(DEFAULT_SEED); }
});

// Independently enumerate the weighted-without-replacement probability tree.
// Inclusion probabilities differ from the 1:3 draw weight because each arena
// draws multiple unique kinds and powerful kinds reduce the final companions.
function expectedInclusions() {
  const early = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  const later = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  const weight = kind => kind === 'split' ? 1 : 3;
  const record = (counts, selected, probability) => {
    for (const kind of selected) counts[kind] += probability;
  };
  function visit(selected, remaining, probability) {
    const count = selected.length;
    if (count === 2) record(early, selected, probability);
    if (count >= 2) {
      const powerful = selected.find(kind => POWERFUL.has(kind));
      if (powerful && count > 3) {
        const ordinary = selected.filter(kind => !POWERFUL.has(kind));
        record(later, [powerful, ...ordinary.slice(0, 1)], probability / 8);
        record(later, [powerful, ...ordinary.slice(0, 2)], probability / 8);
      } else record(later, selected, probability / 4);
    }
    if (count === 5) return;
    const total = remaining.reduce((sum, kind) => sum + weight(kind), 0);
    for (const kind of remaining) {
      const next = remaining.filter(other => other !== kind && !(POWERFUL.has(kind) && POWERFUL.has(other)));
      visit([...selected, kind], next, probability * weight(kind) / total);
    }
  }
  visit([], KINDS, 1);
  return { early, later };
}

test('Representative seeded samples match Split 1:3 selection weights, not literal marginal frequency', () => {
  const expected = expectedInclusions();
  const actual = { early: Object.fromEntries(KINDS.map(kind => [kind, 0])), later: Object.fromEntries(KINDS.map(kind => [kind, 0])) };
  const levels = { early: [2, 3], later: [4, 7, 10, 14, 15, 28, 29, 42, 70] };
  const samples = 4096;
  try {
    for (let index = 0; index < samples; index++) {
      setArenaRunSeed(seedFor(index));
      for (const [phase, phaseLevels] of Object.entries(levels)) {
        for (const level of phaseLevels) for (const kind of arenaDefinition(level).bonuses) actual[phase][kind]++;
      }
    }
    for (const phase of ['early', 'later']) {
      const count = samples * levels[phase].length;
      for (const kind of KINDS) {
        const observed = actual[phase][kind] / count;
        assert.ok(Math.abs(observed - expected[phase][kind]) < .016,
          `${phase}/${kind}: observed ${observed.toFixed(4)}, weighted expectation ${expected[phase][kind].toFixed(4)}`);
      }
      const ordinaryMean = ORDINARY.reduce((sum, kind) => sum + actual[phase][kind], 0) / ORDINARY.length;
      const ratio = actual[phase].split / ordinaryMean;
      const expectedRatio = expected[phase].split / expected[phase].pulse;
      assert.ok(Math.abs(ratio - expectedRatio) < .04,
        `${phase}: Split inclusion ratio ${ratio.toFixed(4)} should match ${expectedRatio.toFixed(4)}`);
      assert.ok(ratio < .5, 'Split is substantially rarer than each ordinary kind');
    }
    assert.ok(expected.later.split / expected.later.pulse > 1 / 3,
      'unique multi-draw inclusion is deliberately not asserted as exactly one third');
  } finally { setArenaRunSeed(DEFAULT_SEED); }
});

test('Retuning preserves all pre-change cube geometry, tiers and progression through four cycles', () => {
  // Captured before changing the scheduler, omitting only the pickup-kind slot.
  const hashes = {
    default: '8ceb1c3f1e0fd9713689686e77d6ed8c0054195830066d7b4eb2f33831dded55',
    portrait: 'bfbd83e6785f7297189ec05ef0de79237ff71c13b37dbff85fc812962bd4eb26',
    wide: '979a5e353c4fc5dbd2b6d30f04bab4af93a42040c6046d7e71090d798f940ac0',
    short: 'b1aa8e65e69e10a580d7072ac706af63419d2896096ee6fa479ce65e41c8359f',
  };
  for (const [name, options] of Object.entries(profiles)) {
    const geometry = Array.from({ length: 56 }, (_, index) => arenaBlocks(index + 1, options).map(spec => spec.slice(0, 7)));
    assert.equal(createHash('sha256').update(JSON.stringify(geometry)).digest('hex'), hashes[name], name);
  }
});

test('World-space spread retains distinct towers and the farthest pair for every bonus set', () => {
  const distance = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  try {
    for (const seed of [1, DEFAULT_SEED, 0xffffffff]) {
      setArenaRunSeed(seed);
      for (const options of Object.values(profiles)) for (let level = 2; level <= 56; level++) {
        const specs = arenaBlocks(level, options);
        const bounds = options.bounds || {};
        const halfAt = typeof bounds.half === 'function' ? bounds.half : () => bounds.half ?? 6.25;
        const position = spec => {
          const extent = (spec[4] + spec[6]) * Math.SQRT1_2 / 2;
          const limit = Math.min(halfAt(spec[2] - extent), halfAt(spec[2] + extent)) - extent - .34;
          return { x: Math.max(-limit, Math.min(limit, spec[0])), z: spec[2] };
        };
        const candidates = specs.filter(spec => spec[3] === 0).map(position);
        const pickups = specs.filter(spec => spec[7]).map(position);
        const key = point => `${Math.round(point.x * 1e6)}:${Math.round(point.z * 1e6)}`;
        const towers = new Set(candidates.map(key));
        assert.equal(new Set(pickups.map(key)).size, Math.min(pickups.length, towers.size));
        const farthest = points => {
          let maximum = 0;
          for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) maximum = Math.max(maximum, distance(points[i], points[j]));
          return maximum;
        };
        assert.ok(Math.abs(farthest(pickups) - farthest(candidates)) < 1e-9,
          `arena ${level} keeps the farthest available host pair`);
      }
    }
  } finally { setArenaRunSeed(DEFAULT_SEED); }
});
