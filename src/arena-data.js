/** Authored CrystalCrash progression. Tiers in blueprints are one-based.
 * Stack coordinates use a collision-safe horizontal/depth pitch, with row zero
 * nearest the player. Each tier is physically supported by the tier beneath it.
 * Bonus tokens decorate a specific T1 cube; no runtime roll adds containers.
 */
const P = '1:pulse', I = '1:pierce', A = '1:arc', H = '1:halo';
const ARENAS = [
  {
    name: 'First Spark', skill: 'Release, return, collect',
    stacks: [
      [-1.5, 1, [1, 1, 1]], [-.5, 1, [1, P, 1]],
      [.5, 1, [1, 1, 1]], [1.5, 1, [1, 1, 1]],
    ],
  },
  {
    name: 'Double Tap', skill: 'Repeat a hit or choose a support',
    stacks: [
      [-2, 1, [2, 1, 1, 1]], [-1, 1, [2, P, 1, 1]],
      [1, 1, [2, 1, 1, 1]], [2, 1, [2, 1, 1, 1]],
    ],
  },
  {
    name: 'Split Decision', skill: 'Choose either branch around the strong node',
    stacks: [
      [-1, 0, [2, P, 1]], [1, 0, [2, I, 1]],
      [-2, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-1, 2, [2, 1, 1]], [1, 2, [1, 1, 1]],
      [0, 1, [3, 1]],
    ],
  },
  {
    name: 'Glass Bridge', skill: 'Remove the two accessible bridge supports',
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
    stacks: [
      [-1, 1, [1, 2, 1]], [1, 1, [1, 2, 1]],
      [-2, 1, [2, 1, 1]], [2, 1, [2, 1, 1]],
      [-1, 0, [2, A, 1]], [1, 0, [2, I, 1]],
      [-1, 2, [3, 1]], [1, 2, [3, 1]],
    ],
    bridge: true, core: true,
  },
  {
    name: 'Side Routes', skill: 'Collect protection before taking the side diagonal',
    stacks: [
      [0, 0, [H, 1, 1]], [2, 0, [2, P, 1]],
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
      [-2, 0, [2, P, 1]], [-1, 0, [1, H, 1]], [2, 0, [2, I, 1]],
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
      [1, 0, [2, A, 1]], [2, 0, [2, H, 1]],
      [-2, 1, [2, 1, 1, 3, 4]], [0, 1, [1, 3, 4, 5]],
      [2, 1, [2, 1, 1, 3, 1]],
      [-1, 2, [2, 1, 1, 3]], [1, 2, [2, 1, 1]],
    ],
  },
];

function selected(level) {
  const n = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const index = (n - 1) % ARENAS.length;
  return { level: n, index, cycle: Math.floor((n - 1) / ARENAS.length) + 1, arena: ARENAS[index] };
}

function decode(token) {
  const [tier, bonus] = String(token).split(':');
  return { type: Number(tier) - 1, bonus };
}

/** Returns fresh metadata. tierCounts is ordered T1..T5; bonus IDs are MVP IDs.
 * Levels above ten repeat the exact authored cycle without added durability.
 */
export function arenaDefinition(level) {
  const { level: n, index, cycle, arena } = selected(level);
  const tierCounts = [0, 0, 0, 0, 0], bonuses = [];
  for (const [, , tiers] of arena.stacks) for (const token of tiers) {
    const { type, bonus } = decode(token);
    tierCounts[type]++;
    if (bonus) bonuses.push(bonus);
  }
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
export function arenaBlocks(level, { cube = .88, layoutZ = z => z } = {}) {
  const { arena } = selected(level), specs = [];
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
  return specs;
}
