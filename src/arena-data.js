import { GLASS, TUNE } from './config.js';
import { BONUS_DEFS } from './bonus-controller.js';
import { BOMB_LANDING_Y, bombLandingPoint } from './bomb-placement.js';

/** Authored CrystalCrash progression. Tiers in blueprints are one-based.
 * Stack coordinates use a collision-safe horizontal/depth pitch, with row zero
 * nearest the player. Each tier is physically supported by the tier beneath it.
 * Bonus tokens decorate a specific T1 cube; no runtime roll adds containers.
 */
const P = '1:pulse', I = '1:pierce', A = '1:arc';
const F = '1:frost', S = '1:split', G = '1:gravity', B = '1:heavy';
const ARENAS = [
  {
    name: 'First Spark', skill: 'Release, return, collect',
    rear: [[-1, 0, 3], [0, 0, 4], [1, 0, 3], [-1, 1, 4], [1, 1, 4]],
    stacks: [
      [-1.5, 1, [1, 1, 1]], [-.5, 1, [1, P, 1]],
      [.5, 1, [1, 1, 1]], [1.5, 1, [1, 1, 1]],
    ],
  },
  {
    name: 'Double Tap', skill: 'Repeat a hit or choose a support',
    rear: [[-2, 0, 3], [-1, 0, 3], [1, 0, 3], [2, 0, 3], [-1, 1, 4], [1, 1, 4]],
    stacks: [
      [-2, 1, [2, 1, 1, 1]], [-1, 1, [2, P, 1, 1]],
      [1, 1, [2, 1, 1, 1]], [2, 1, [2, 1, 1, 1]],
    ],
  },
  {
    name: 'Split Decision', skill: 'Choose either branch around the strong node',
    rear: [[-2, 0, 3], [0, 0, 4], [2, 0, 3], [-1, 1, 5], [1, 1, 6]],
    stacks: [
      [-1, 0, [2, P, 1]], [1, 0, [2, I, 1]],
      [-2, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-1, 2, [2, 1, 1]], [1, 2, [1, 1, 1]],
      [0, 1, [3, 1]],
    ],
  },
  {
    name: 'Glass Bridge', skill: 'Remove the two accessible bridge supports',
    rear: [[-2, 0, 4], [-1, 0, 3], [1, 0, 3], [2, 0, 4], [-1, 1, 4], [1, 1, 4]],
    stacks: [
      [-1, 1, [1, 2, 1]], [1, 1, [1, 2, 1]],
      [-2, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-1, 0, [2, I, 1]], [1, 0, [2, P, 1]],
      [-1, 2, [3, 1]], [1, 2, [3, 1]],
    ],
    bridge: true,
  },
  {
    name: 'The Core', skill: 'Open the sides around the single strong core',
    rear: [[-2, 0, 4], [-1, 0, 4], [1, 0, 4], [2, 0, 4], [-1, 1, 4], [1, 1, 4]],
    stacks: [
      [-1, 1, [1, 2, 1]], [1, 1, [1, 2, 1]],
      [-2, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-1, 0, [2, A, 1]], [1, 0, [2, I, 1]],
      [-1, 2, [3, 1]], [1, 2, [3, 1]],
    ],
    bridge: true, core: true,
  },
  {
    name: 'Side Routes', skill: 'Collect a power before taking the side diagonal',
    stacks: [
      [0, 0, [A, 1, 1]], [2, 0, [2, P, 1]],
      [-1, 1, [2, 1, 1]], [0, 1, [2, 1, 1]],
      [1, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-2, 2, [2, 1, 1]], [-1, 2, [3, 2, 1]],
      [1, 2, [3, 4, 5]],
    ],
  },
  {
    name: 'Thin Line', skill: 'Aim Pierce down three separated depth lanes',
    stacks: [
      [-2, 0, [2, I, 1]], [0, 0, [2, A, 1]], [2, 0, [2, 1, 1]],
      [-2, 1, [2, 1, 1]], [0, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-2, 2, [3, 2, 1]], [0, 2, [3, 4, 5]], [2, 2, [3, 2, 1]],
    ],
  },
  {
    name: 'Crossfire', skill: 'Transfer your aim between unequal groups across the opening',
    stacks: [
      [-2, 0, [2, P, 1]], [-1, 0, [1, F, 1]], [2, 0, [2, I, 1]],
      [-2, 1, [2, 1, 1]], [-1, 1, [2, 1, 1]], [1, 1, [2, 1, 1]],
      [-2, 2, [3, 2, 1]], [-1, 2, [3, 4, 5]], [1, 2, [3, 2, 1]],
    ],
  },
  {
    name: 'Weak Link', skill: 'Break soft supports beneath compact strong clusters',
    stacks: [
      [-2, 0, [2, A, 1]], [-1, 0, [2, 1, 1]],
      [1, 0, [2, P, 1]], [2, 0, [2, 1, 1]],
      [-1.5, 1, [2, 1, 1]], [1.5, 1, [2, 1, 1]],
      [-2, 2, [1, 3]], [-1, 2, [1, 3, 4]],
      [1, 2, [1, 3, 5]], [2, 2, [1, 3]],
    ],
  },
  {
    name: 'Crystal Crown', skill: 'Clear supports, side sections, then the crown',
    stacks: [
      [-2, 0, [2, 1, 1]], [-1, 0, [2, I, 1]],
      [1, 0, [2, A, 1]], [2, 0, [2, S, 1]],
      [-2, 1, [2, 1, 1, 3, 4]], [0, 1, [1, 3, 4, 5]],
      [2, 1, [2, 1, 1, 3, 1]],
      [-1, 2, [2, 1, 1, 3]], [1, 2, [2, 1, 1]],
    ],
  },
  {
    name: 'Cold Return', skill: 'Mark strong glass, then return before the frost fades',
    stacks: [
      // The exposed front container opens a clean approach to three T3 targets.
      [0, 0, [F, 1]],
      [-1, 1, [3, 2, 1]], [0, 1, [3, 2, 1]], [1, 1, [3, 2, 1]],
      [-1.5, 2, [2, 1, 1]], [-.5, 2, [2, 1, 1, 4, 5]],
      [.5, 2, [2, 1, 1]], [1.5, 2, [2, 1, 1]],
    ],
  },
  {
    name: 'Echo Fan', skill: 'Send two echoes into the broad wings of the formation',
    stacks: [
      [0, 0, [S, 1, 1]],
      [-2, 1, [2, 1, 1]], [-1, 1, [2, 1, 1]],
      [1, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-2, 2, [2, 1, 1]], [-1, 2, [3, 2, 1]], [0, 2, [4, 3, 5]],
      [1, 2, [3, 2, 1]], [2, 2, [2, 1, 1]],
    ],
  },
  {
    name: 'Orbit Shift', skill: 'Pull a compact group toward the weakened central support',
    stacks: [
      [0, 0, [G, 1]], [-2, 0, [2, 1, 1]], [2, 0, [2, 1, 1]],
      // Adjacent stacks are within the 3-ball-diameter well radius while their
      // initial rotated collision bounds remain separate.
      [-1, 1, [2, 1, 1]], [0, 1, [3, 2, 1]], [1, 1, [2, 1, 1]],
      [-1, 2, [3, 2, 1]], [0, 2, [3, 4, 5]], [1, 2, [3, 2, 1]],
    ],
  },
  {
    name: 'Decisive Strike', skill: 'Spend the heavy strike on an exposed armored support',
    stacks: [
      [0, 0, [B, 1]], [-2, 0, [2, 1, 1]], [2, 0, [2, 1, 1]],
      // Two exposed strong bases give a deliberate T4-versus-T5 target choice.
      [-1, 1, [4, 3, 1]], [1, 1, [5, 3, 1]],
      [-2, 2, [2, 1, 1]], [-1, 2, [3, 2, 1]], [0, 2, [4, 3, 1]],
      [1, 2, [3, 2, 1]], [2, 2, [2, 1, 1]],
    ],
  },
];

function selected(level) {
  const n = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const index = (n - 1) % ARENAS.length;
  const cycle = Math.floor((n - 1) / ARENAS.length) + 1;
  return { level: n, index, cycle, arena: progression(n, index, ARENAS[index]) };
}

// Early cube formations and tiers stay unchanged. Thereafter,
// density rises with the actual level, including when the fourteen names repeat.
// This cap bounds expensive compound shells rather than only their visible cubes.
const DENSITY = [30, 36, 41, 45, 48, 52, 56, 60, 64, 68, 74, 80, 86, 92];
const BONUS_KINDS = ['pulse', 'pierce', 'arc', 'frost', 'split', 'gravity', 'heavy', 'bomb', 'blackhole'];
const bonusWeight = kind => kind === 'split' ? 1 : 3;
const isPowerfulBonus = kind => kind === 'gravity' || kind === 'blackhole';
let arenaRunSeed = 0x00c57a11;

/** Set once when starting/restarting a run, never while previewing or resizing.
 * Defaults to a fixed seed for reproducible builds and standalone module tests. */
export function setArenaRunSeed(seed) {
  if (!Number.isFinite(seed)) throw new RangeError('Arena run seed must be finite');
  arenaRunSeed = Math.floor(seed) >>> 0;
  return arenaRunSeed;
}

function hasFrostTargets(arena) {
  const needsMultipleHits = type => GLASS[type]?.hits > 1;
  if (arena.bridge && needsMultipleHits(3) || arena.core && needsMultipleHits(4)) return true;
  if (arena.rear?.some(([, , height]) => height > 0) && needsMultipleHits(0)) return true;
  return [...arena.stacks, ...(arena.reinforcements || [])]
    .some(([, , tiers]) => tiers.some(token => needsMultipleHits(decode(token).type)));
}

function bonusSchedule(level, arena) {
  if (level === 1) return ['pulse'];
  // A local PRNG depends only on run seed + absolute level. Metadata, preview,
  // generation and repeated resize queries never advance shared random state.
  let state = (arenaRunSeed ^ Math.imul(level >>> 0, 0x9e3779b1)
    ^ Math.imul(Math.floor(level / 0x100000000), 0x85ebca6b)) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 0x100000000;
  };
  const count = level <= 3 ? 2 : 2 + Math.floor(random() * 4);
  // Eligibility follows the completed formation, including repeated templates'
  // new tiers. Frost cannot improve an arena whose cubes all need only one hit.
  const frostUseful = hasFrostTargets(arena);
  const chosen = level === 2 ? ['bomb'] : [];
  const kinds = BONUS_KINDS.filter(kind => !chosen.includes(kind) && (kind !== 'frost' || frostUseful));
  // Weighted sampling without replacement: Split has one third of every other
  // kind's selection weight, not a fixed one-third marginal arena frequency.
  while (chosen.length < count) {
    let ticket = random() * kinds.reduce((sum, kind) => sum + bonusWeight(kind), 0);
    let index = 0;
    while (index < kinds.length - 1 && ticket >= bonusWeight(kinds[index])) {
      ticket -= bonusWeight(kinds[index++]);
    }
    const [kind] = kinds.splice(index, 1);
    chosen.push(kind);
    // A powerful pickup may coexist with ordinary powers, never the other
    // arena-wide power. Removing it here also keeps every draw distinct.
    if (isPowerfulBonus(kind)) {
      const incompatible = kinds.findIndex(isPowerfulBonus);
      if (incompatible !== -1) kinds.splice(incompatible, 1);
    }
  }
  if (!chosen.some(isPowerfulBonus) || count <= 3) return chosen;
  // Retain the selected powerful kind and the earliest one or two companions.
  // Do not simply truncate: that could discard a late-drawn powerful pickup.
  let companions = 1 + Math.floor(random() * 2);
  return chosen.filter(kind => isPowerfulBonus(kind) || companions-- > 0);
}

function progression(level, index, source) {
  if (level === 1) return source;
  const arena = { ...source, stacks: source.stacks.map(([x, row, tiers]) => [x, row, [...tiers]]) };
  if (level <= 5) return assignBonuses(arena, level);
  // Returning early templates use the whole rear region for their new density,
  // instead of putting the legacy back row between reinforcements and the gate.
  if (level > 14) delete arena.rear;
  const originalCount = arena.stacks.reduce((sum, [, , tiers]) => sum + tiers.length, 0)
    + (arena.rear || []).reduce((sum, [, , height]) => sum + height, 0)
    + Number(!!arena.bridge) + Number(!!arena.core);
  const targetCount = level <= 14 ? DENSITY[index] : Math.min(110, 92 + (level - 14) * 2);
  const patterns = level < 11
    ? [[1, 2, 1], [2, 1, 3], [1, 3, 1, 2], [2, 1], [1, 2, 1, 4]]
    : [[1, 3, 2, 1], [2, 1, 4], [1, 2, 5, 1], [3, 1, 2], [1, 4, 3, 2, 1]];
  const bands = level < 11 ? 3 : 4;
  const columns = [0, -2, 2, -1, 1, -3, 3];
  arena.reinforcements = [];
  let remaining = Math.max(0, targetCount - originalCount), tower = 0;
  while (remaining > 0) {
    const pattern = patterns[(tower + index) % patterns.length];
    const tiers = pattern.slice(0, Math.min(remaining, pattern.length));
    // Alternate bands first: even a modest formation visibly occupies the back
    // of the upper field, rather than extending one very tall frontal wall.
    const band = tower % bands, column = columns[Math.floor(tower / bands) % columns.length];
    arena.reinforcements.push([column, band, tiers]);
    remaining -= tiers.length; tower++;
  }
  arena.reinforcementBands = bands;
  return assignBonuses(arena, level);
}

function assignBonuses(arena, level) {
  const schedule = bonusSchedule(level, arena);
  const candidates = [];
  // Stamp the stable kind set onto temporary hosts for metadata. Once every
  // rear group has been placed, spreadBonusHosts selects the final world-space
  // towers without changing the geometry, tier, or number of targets.
  for (const [foreground, groups] of [[true, arena.stacks], [false, arena.reinforcements || []]]) {
    groups.forEach(([, row, tiers], order) => tiers.forEach((token, height) => {
      const { type, bonus } = decode(token);
      if (type !== 0) return;
      tiers[height] = 1;
      candidates.push({ tiers, height, row, order, foreground, authored: !!bonus });
    }));
  }
  candidates.sort((a, b) => Number(b.authored) - Number(a.authored)
    || Number(b.foreground) - Number(a.foreground) || a.row - b.row
    || a.height - b.height || a.order - b.order);
  if (candidates.length < schedule.length) throw new RangeError('Arena lacks distinct T1 bonus hosts');
  schedule.forEach((kind, i) => {
    const { tiers, height } = candidates[i];
    tiers[height] = `1:${kind}`;
  });
  return arena;
}

function decode(token) {
  const [tier, bonus] = String(token).split(':');
  return { type: Number(tier) - 1, bonus };
}

/** Returns fresh metadata. tierCounts is ordered T1..T5; bonuses use the host effect IDs.
 * Repeated names retain their authored foreground; added mixed-tier groups and
 * density grows to a bounded 110 originals. Bonus counts are 1/2/2, then
 * seeded random 2–5 distinct types on every subsequent level and repeat.
 * Split has one-third selection weight; Tornado and Black Hole are mutually
 * exclusive and limit an arena to 2–3 total bonuses. Arena 2 guarantees Bomb;
 * Frost is eligible only when the actual formation includes a multi-hit cube.
 */
export function arenaDefinition(level) {
  const { level: n, index, cycle, arena } = selected(level);
  const tierCounts = [0, 0, 0, 0, 0], bonuses = [];
  for (const [, , tiers] of [...arena.stacks, ...(arena.reinforcements || [])]) for (const token of tiers) {
    const { type, bonus } = decode(token);
    tierCounts[type]++;
    if (bonus) bonuses.push(bonus);
  }
  tierCounts[0] += (arena.rear || []).reduce((sum, [, , height]) => sum + height, 0);
  if (arena.bridge) tierCounts[3]++;
  if (arena.core) tierCounts[4]++;
  return {
    level: n, arena: index + 1, cycle, name: arena.name,
    label: `${String(index + 1).padStart(2, '0')} · ${arena.name}${cycle > 1 ? ` · Cycle ${cycle}` : ''}`,
    skill: arena.skill, tierCounts, bonuses,
    blockCount: tierCounts.reduce((sum, count) => sum + count, 0),
    quota: tierCounts.reduce((sum, count, type) => sum + count * [1, 2, 4, 6, 8][type], 0),
  };
}

/** Returns [x,y,z,type,sx,sy,sz,bonus?] specs accepted by addBlock.
 * layoutZ is the host's normalized-upper-arena to world-Z mapping. Depth pitch
 * compensates for that mapping so rotated neighboring cubes cannot intersect.
 * The host retains final tapered-table edge clamping and pickup safe points.
 */
export function arenaBlocks(level, { cube = .88, layoutZ = z => z, bounds = {} } = {}) {
  const { arena, level: n } = selected(level), specs = [];
  const pitch = cube * Math.SQRT2 + .14;
  const depthScale = Math.abs(layoutZ(0) - layoutZ(-1));
  if (!(cube > 0) || !Number.isFinite(cube) || !(depthScale > 0)) {
    throw new RangeError('arenaBlocks needs a positive cube size and a nonzero layoutZ scale');
  }
  const rowZ = row => layoutZ(-1.1 - row * pitch / depthScale);
  for (const [column, row, tiers] of arena.stacks) {
    tiers.forEach((token, height) => {
      const { type, bonus } = decode(token);
      const spec = [column * pitch, cube * (height + .5) + .015, rowZ(row), type, cube, cube, cube];
      if (bonus) spec.push(bonus);
      specs.push(spec);
    });
  }
  // One unrotated lintel rests across the two three-cube pillars. The center
  // stays open below it, and the T1 pickup cubes are on the exposed front row.
  if (arena.bridge) {
    specs.push([0, cube * 3.5 + .015, rowZ(1), 3, 2 * pitch + cube, cube, cube]);
  }
  if (arena.core) {
    specs.push([0, cube * 4.5 + .015, rowZ(1), 4, cube, cube, cube]);
  }
  if (arena.rear) addRearFormation(specs, arena, cube, pitch, layoutZ, bounds);
  if (arena.reinforcements) addProgressionFormation(specs, arena, cube, pitch, layoutZ, bounds);
  if (n !== 1) spreadBonusHosts(specs, bounds);
  return specs;
}

/** Bomb belongs in the densest blast-sized cluster; the other chosen bonuses
 * spread out around it. Measuring final positions includes rear rows, short-field
 * fallback and tapered-edge clamping. Assignments remain seed/bounds stable. */
function spreadBonusHosts(specs, bounds) {
  const kinds = specs.filter(spec => spec[7]).map(spec => spec[7]);
  if (!kinds.length) return;
  const halfAt = typeof bounds.half === 'function' ? bounds.half
    : () => Number.isFinite(bounds.half) ? bounds.half : 6.25;
  const candidates = [], byTower = new Map();
  const originals = specs.map((spec, index) => {
    if (spec[7]) spec.length = 7;
    const rotated = spec[4] === spec[5] && spec[5] === spec[6];
    const ex = rotated ? (spec[4] + spec[6]) * Math.SQRT1_2 / 2 : spec[4] / 2;
    const ez = rotated ? ex : spec[6] / 2;
    const limit = Math.min(halfAt(spec[2] - ez), halfAt(spec[2] + ez)) - ex - .34;
    const x = Math.max(-limit, Math.min(limit, spec[0])), z = spec[2];
    const key = `${Math.round(x * 1e6)}:${Math.round(z * 1e6)}`;
    const candidate = { spec, index, x, y: spec[1], z, key };
    if (spec[3] !== 0) return candidate;
    candidates.push(candidate);
    const current = byTower.get(key);
    if (!current || spec[1] < current.spec[1]) byTower.set(key, candidate);
    return candidate;
  });
  if (candidates.length < kinds.length) throw new RangeError('Arena lacks distinct T1 bonus hosts');
  const order = (a, b) => b.z - a.z || a.x - b.x || a.spec[1] - b.spec[1] || a.index - b.index;
  const towers = [...byTower.values()].sort(order), chosen = [];
  const distance = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  if (kinds.includes('bomb')) {
    // The released Bomb model is normalized to one unit tall, centered, then
    // scaled by ball diameter * 1.3. BonusWorld rests its bottom .012 above the
    // table. Score the actual 3D blast, not a circle at the carrier's elevation:
    // tall towers and isolated rear hosts must not inflate useful coverage.
    const radiusSquared = (BONUS_DEFS.bomb.radiusD * TUNE.ballRadius * 2) ** 2;
    let best = null, bestCount = -1, bestDistance = Infinity;
    for (const candidate of candidates) {
      const landing = bombLandingPoint(candidate, bounds);
      let count = 0, totalDistance = 0;
      for (const original of originals) {
        if (original === candidate) continue; // The T1 carrier already broke.
        const d = distance(landing, original) + (original.y - BOMB_LANDING_Y) ** 2;
        if (d <= radiusSquared) { count++; totalDistance += d; }
      }
      if (count > bestCount || count === bestCount && (candidate.y < best.y ||
        candidate.y === best.y && (totalDistance < bestDistance - 1e-9 ||
        Math.abs(totalDistance - bestDistance) <= 1e-9 && order(candidate, best) < 0))) {
        best = candidate; bestCount = count; bestDistance = totalDistance;
      }
    }
    chosen.push(best);
    // Preserve every scheduled kind while assigning Bomb its scored host first.
    kinds.splice(kinds.indexOf('bomb'), 1); kinds.unshift('bomb');
  } else if (kinds.length > 1 && towers.length > 1) {
    // Start with the globally farthest pair so two-bonus arenas use opposite
    // regions instead of neighboring tiers or adjacent front containers.
    let pair = [towers[0], towers[1]], separation = -1;
    for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++) {
      const d = distance(towers[i], towers[j]);
      if (d > separation + 1e-9) { separation = d; pair = [towers[i], towers[j]]; }
    }
    chosen.push(...pair);
  } else chosen.push(towers[0]);
  const pickFarthest = pool => {
    let best = null, bestMin = -1, bestSum = -1;
    for (const candidate of pool) {
      if (chosen.includes(candidate)) continue;
      const distances = chosen.map(other => distance(candidate, other));
      const min = Math.min(...distances), sum = distances.reduce((a, b) => a + b, 0);
      if (min > bestMin + 1e-9 || Math.abs(min - bestMin) <= 1e-9 &&
        (sum > bestSum + 1e-9 || Math.abs(sum - bestSum) <= 1e-9 && (!best || order(candidate, best) < 0))) {
        best = candidate; bestMin = min; bestSum = sum;
      }
    }
    return best;
  };
  while (chosen.length < Math.min(kinds.length, towers.length)) {
    chosen.push(pickFarthest(towers.filter(candidate => !chosen.some(other => other.key === candidate.key))));
  }
  // Only extremely narrow/short custom bounds can leave fewer towers than
  // bonuses. Keep every kind on a distinct original, balancing occupied towers
  // before reusing one; never silently drop a pickup to satisfy spacing.
  while (chosen.length < kinds.length) {
    const remaining = candidates.filter(candidate => !chosen.includes(candidate));
    const occupancy = candidate => chosen.filter(other => other.key === candidate.key).length;
    const leastUsed = Math.min(...remaining.map(occupancy));
    chosen.push(pickFarthest(remaining.filter(candidate => occupancy(candidate) === leastUsed)));
  }
  chosen.forEach((candidate, index) => { candidate.spec[7] = kinds[index]; });
}

/** Rear additions contain only T1, never a second random pickup. Work in world
 * units after layoutZ: normalized spacing alone shrinks on short aspect ratios.
 * bounds.half may be tableHalf(z) or a constant half-width. Existing formations
 * retain their authored locations; only additions adapt to the available space.
 */
function addRearFormation(specs, arena, cube, pitch, layoutZ, bounds) {
  const extent = cube * Math.SQRT1_2;
  const top = Number.isFinite(bounds.top) ? bounds.top : layoutZ(-6.15);
  const halfAt = typeof bounds.half === 'function' ? bounds.half
    : () => Number.isFinite(bounds.half) ? bounds.half : 6.25;
  const rearLimit = top + extent + .4;
  const farthestFace = Math.min(...specs.map(s => s[2] -
    (s[4] === s[5] && s[5] === s[6] ? (s[4] + s[6]) * Math.SQRT1_2 / 2 : s[6] / 2)));
  const frontLimit = farthestFace - extent - .14;
  if (frontLimit >= rearLimit) {
    const twoRows = frontLimit - rearLimit >= pitch;
    // Put the back row near the gate; stretch a second row into the empty rear
    // area while retaining at least one full collision-safe pitch between rows.
    const rows = twoRows
      ? [Math.max(rearLimit + pitch, Math.min(frontLimit, layoutZ(-3.8))), rearLimit]
      : [(frontLimit + rearLimit) / 2];
    const columns = new Map();
    for (const [column, band, height] of arena.rear) {
      const row = twoRows ? band : 0, z = rows[row];
      const usable = Math.min(3.8, halfAt(z - extent) - extent - .34, halfAt(z + extent) - extent - .34);
      const slots = Math.max(0, Math.floor(usable / pitch));
      const slot = Math.max(-slots, Math.min(slots, column));
      const key = `${row}:${slot}`;
      const current = columns.get(key) || { x: slot * pitch, z, height: 0 };
      current.height += height;
      columns.set(key, current);
    }
    for (const { x, z, height } of columns.values()) {
      for (let i = 0; i < height; i++) specs.push([x, cube * (i + .5) + .015, z, 0, cube, cube, cube]);
    }
    return;
  }
  // On an unusually short upper field no separate physical rear row can fit.
  // Extend existing front columns, which are clear of the bridge/core, instead
  // of placing cubes through the gate or silently dropping authored targets.
  const nearestRow = Math.min(...arena.stacks.map(([, row]) => row));
  const columns = arena.stacks.filter(([, row]) => row === nearestRow)
    .map(([column, row, tiers]) => ({ x: column * pitch,
      z: layoutZ(-1.1 - row * pitch / Math.abs(layoutZ(0) - layoutZ(-1))), height: tiers.length }));
  const count = arena.rear.reduce((sum, [, , height]) => sum + height, 0);
  for (let i = 0; i < count; i++) {
    const column = columns.reduce((best, next) => next.height < best.height ? next : best);
    specs.push([column.x, cube * (column.height + .5) + .015, column.z, 0, cube, cube, cube]);
    column.height++;
  }
}

/** Fit mixed-tier rear groups into actual world bounds, independently of screen
 * aspect. All members stay on the safe side of the gate and tapered rails. */
function addProgressionFormation(specs, arena, cube, pitch, layoutZ, bounds) {
  if (!arena.reinforcements.length) return;
  const extent = cube * Math.SQRT1_2;
  const top = Number.isFinite(bounds.top) ? bounds.top : layoutZ(-6.15);
  const halfAt = typeof bounds.half === 'function' ? bounds.half
    : () => Number.isFinite(bounds.half) ? bounds.half : 6.25;
  const rearLimit = top + extent + .4;
  const frontLimit = Math.min(...specs.map(s => s[2] -
    (s[4] === s[5] && s[5] === s[6] ? (s[4] + s[6]) * Math.SQRT1_2 / 2 : s[6] / 2))) - extent - .14;
  const append = (column, token) => {
    const { type, bonus } = decode(token);
    const spec = [column.x, cube * (column.height + .5) + .015, column.z, type, cube, cube, cube];
    if (bonus) spec.push(bonus);
    specs.push(spec); column.height++;
  };
  if (frontLimit >= rearLimit) {
    const rowCount = Math.min(arena.reinforcementBands, 1 + Math.floor((frontLimit - rearLimit) / pitch));
    const columns = new Map();
    for (const [slot, band, tiers] of arena.reinforcements) {
      const row = Math.min(rowCount - 1, band);
      const z = rowCount > 1 ? frontLimit + (rearLimit - frontLimit) * row / (rowCount - 1) : (frontLimit + rearLimit) / 2;
      const usable = Math.min(4.3, halfAt(z - extent) - extent - .34, halfAt(z + extent) - extent - .34);
      const maxSlot = Math.max(0, Math.floor(usable / pitch));
      const fittedSlot = Math.max(-maxSlot, Math.min(maxSlot, slot));
      const key = `${row}:${fittedSlot}`;
      let column = columns.get(key);
      if (!column) { column = { x: fittedSlot * pitch, z, height: 0 }; columns.set(key, column); }
      for (const token of tiers) append(column, token);
    }
    return;
  }
  // A genuinely short field cannot fit another depth lane. Keep every original
  // and its pickup by extending safe front columns, never by overlap or clipping.
  const nearestRow = Math.min(...arena.stacks.map(([, row]) => row));
  const columns = arena.stacks.filter(([, row]) => row === nearestRow).map(([x, row, tiers]) => ({
    x: x * pitch, z: layoutZ(-1.1 - row * pitch / Math.abs(layoutZ(0) - layoutZ(-1))), height: tiers.length,
  }));
  for (const column of columns) {
    column.height = Math.max(column.height, ...specs.filter(s => Math.abs(s[0] - column.x) < .001 && Math.abs(s[2] - column.z) < .001)
      .map(s => Math.round((s[1] - .015) / cube + .5)));
  }
  for (const [, , tiers] of arena.reinforcements) for (const token of tiers) {
    append(columns.reduce((best, next) => next.height < best.height ? next : best), token);
  }
}
