/** Authored CrystalCrash progression. Tiers in blueprints are one-based.
 * Stack coordinates use a collision-safe horizontal/depth pitch, with row zero
 * nearest the player. Each tier is physically supported by the tier beneath it.
 * Bonus tokens decorate a specific T1 cube; no runtime roll adds containers.
 */
const P = '1:pulse', I = '1:pierce', A = '1:arc', H = '1:halo';
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
  return { level: n, index, cycle: Math.floor((n - 1) / ARENAS.length) + 1, arena: ARENAS[index] };
}

function decode(token) {
  const [tier, bonus] = String(token).split(':');
  return { type: Number(tier) - 1, bonus };
}

/** Returns fresh metadata. tierCounts is ordered T1..T5; bonuses use the host effect IDs.
 * Levels above fourteen repeat the exact authored cycle without added durability.
 */
export function arenaDefinition(level) {
  const { level: n, index, cycle, arena } = selected(level);
  const tierCounts = [0, 0, 0, 0, 0], bonuses = [];
  for (const [, , tiers] of arena.stacks) for (const token of tiers) {
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
  if (arena.rear) addRearFormation(specs, arena, cube, pitch, layoutZ, bounds);
  return specs;
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
