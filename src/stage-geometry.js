/**
 * A single, planar chamfer on every box edge: six rectangular faces,
 * twelve edge quads and eight corner triangles (44 triangles total).
 * Dimensions describe the outer bounds, not the un-bevelled core.
 * Vertices are shared only within a face, preserving hard facet normals.
 * omitBottom removes only the central -Y quad; callers must ensure it is hidden.
 */
export function createStageBoxGeometry(THREE, width, height, depth, bevel = 0, { omitBottom = false } = {}) {
  if (![width, height, depth].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Stage box dimensions must be finite and positive.');
  }
  if (!Number.isFinite(bevel) || bevel < 0) {
    throw new RangeError('Stage box bevel must be finite and nonnegative.');
  }
  const half = [width / 2, height / 2, depth / 2];
  // Keep all faces nondegenerate even for an oversized requested bevel.
  const radius = Math.min(bevel, Math.min(...half) * 0.98);
  const inner = half.map(value => value - radius);
  const positions = [], normals = [], uvs = [], indices = [];
  const sub = (a, b) => a.map((value, axis) => value - b[axis]);
  const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = vector => vector.map(value => value / Math.hypot(...vector));
  function face(points, outward) {
    const normal = unit(outward);
    if (dot(cross(sub(points[1], points[0]), sub(points[2], points[0])), normal) < 0) points.reverse();
    const tangent = unit(sub(points[1], points[0]));
    const bitangent = cross(normal, tangent);
    const projected = points.map(point => [dot(point, tangent), dot(point, bitangent)]);
    const lo = [0, 1].map(axis => Math.min(...projected.map(uv => uv[axis])));
    const hi = [0, 1].map(axis => Math.max(...projected.map(uv => uv[axis])));
    const start = positions.length / 3;
    points.forEach((point, index) => {
      positions.push(...point);
      normals.push(...normal);
      uvs.push(...projected[index].map((value, axis) => (value - lo[axis]) / (hi[axis] - lo[axis])));
    });
    for (let index = 1; index < points.length - 1; index++) indices.push(start, start + index, start + index + 1);
  }
  const signs = [-1, 1];
  // Central rectangular faces.
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter(value => value !== axis);
    for (const sign of signs) {
      if (omitBottom && axis === 1 && sign === -1) continue;
      const normal = [0, 0, 0]; normal[axis] = sign;
      const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(pair => {
        const point = [0, 0, 0]; point[axis] = sign * half[axis];
        other.forEach((a, index) => { point[a] = pair[index] * inner[a]; });
        return point;
      });
      face(points, normal);
    }
  }
  if (radius > 0) {
    // One quad per original edge; there are no curved subdivisions.
    for (let free = 0; free < 3; free++) {
      const [a, b] = [0, 1, 2].filter(axis => axis !== free);
      for (const sa of signs) for (const sb of signs) {
        const normal = [0, 0, 0]; normal[a] = sa; normal[b] = sb;
        const points = [[0, -1], [1, -1], [1, 1], [0, 1]].map(([side, end]) => {
          const point = [0, 0, 0];
          point[a] = sa * (side === 0 ? half[a] : inner[a]);
          point[b] = sb * (side === 0 ? inner[b] : half[b]);
          point[free] = end * inner[free];
          return point;
        });
        face(points, normal);
      }
    }
    // One triangle closes each three-way corner.
    for (const sx of signs) for (const sy of signs) for (const sz of signs) {
      const corner = [sx, sy, sz];
      face([0, 1, 2].map(outer => corner.map((sign, axis) => sign * (axis === outer ? half[axis] : inner[axis]))), corner);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.stageBox = { bevel: radius, omitBottom, planarChamfer: true };
  return geometry;
}
