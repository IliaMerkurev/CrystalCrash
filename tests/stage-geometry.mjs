import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createStageBoxGeometry } from '../src/stage-geometry.js';

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function inspect(geometry) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  const edges = new Map(), normalDirections = new Set();
  for (let offset = 0; offset < geometry.index.count; offset += 3) {
    const ids = [0, 1, 2].map(i => geometry.index.getX(offset + i));
    const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(p, id));
    const cross = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    assert.ok(cross.length() > 1e-9, 'Triangle must not be degenerate');
    const normal = cross.normalize();
    assert.ok(normal.dot(points[0]) > 0, 'Triangle must face outward');
    const plane = normal.dot(points[0]);
    for (let vertex = 0; vertex < p.count; vertex++) {
      const point = new THREE.Vector3().fromBufferAttribute(p, vertex);
      assert.ok(normal.dot(point) <= plane + 1e-6, 'All vertices must lie inside each convex face plane');
    }
    for (const id of ids) {
      const stored = new THREE.Vector3().fromBufferAttribute(n, id);
      near(stored.length(), 1); near(stored.dot(normal), 1);
      normalDirections.add(stored.toArray().map(value => value.toFixed(5)).join(','));
    }
    for (let i = 0; i < 3; i++) {
      const a = points[i].toArray().join(','), b = points[(i + 1) % 3].toArray().join(',');
      const key = [a, b].sort().join('|');
      const edge = edges.get(key) ?? { count: 0, balance: 0 };
      edge.count++; edge.balance += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  for (const value of geometry.getAttribute('uv').array) assert.ok(Number.isFinite(value) && value >= -1e-6 && value <= 1 + 1e-6);
  return { edges, normalDirections };
}

test('Chamfer box has exact bounds, 44 triangles and 26 flat face normals', () => {
  for (const [w, h, d, bevel] of [[4, 2, 3, 0.2], [0.12, 0.24, 8, 0.035], [2, 0.05, 2, 1]]) {
    const geometry = createStageBoxGeometry(THREE, w, h, d, bevel);
    assert.equal(geometry.index.count / 3, 44);
    assert.equal(geometry.getAttribute('position').count, 96);
    geometry.boundingBox.min.toArray().forEach((value, axis) => near(value, -[w, h, d][axis] / 2));
    geometry.boundingBox.max.toArray().forEach((value, axis) => near(value, [w, h, d][axis] / 2));
    const { edges, normalDirections } = inspect(geometry);
    assert.equal(normalDirections.size, 26, 'Six faces, twelve planar chamfers, eight flat corners');
    for (const edge of edges.values()) { assert.equal(edge.count, 2); assert.equal(edge.balance, 0); }
    geometry.dispose();
  }
});

test('Omitting the bottom removes exactly one central quad, preserving chamfers and dimensions', () => {
  const geometry = createStageBoxGeometry(THREE, 4, 2, 3, 0.2, { omitBottom: true });
  assert.equal(geometry.index.count / 3, 42);
  near(geometry.boundingBox.min.y, -1);
  const { edges, normalDirections } = inspect(geometry);
  assert.equal(normalDirections.size, 25);
  assert.equal([...edges.values()].filter(edge => edge.count === 1).length, 4);
  for (const [key, edge] of edges) {
    if (edge.count === 1) key.split('|').forEach(point => near(Number(point.split(',')[1]), -1));
    else { assert.equal(edge.count, 2); assert.equal(edge.balance, 0); }
  }
});

test('Zero bevel is an ordinary twelve-triangle closed box', () => {
  const geometry = createStageBoxGeometry(THREE, 4, 2, 3, 0);
  assert.equal(geometry.index.count / 3, 12);
  const { edges, normalDirections } = inspect(geometry);
  assert.equal(normalDirections.size, 6);
  for (const edge of edges.values()) { assert.equal(edge.count, 2); assert.equal(edge.balance, 0); }
  assert.equal(createStageBoxGeometry(THREE, 4, 2, 3, 0, { omitBottom: true }).index.count / 3, 10);
});

test('Invalid dimensions and bevels fail explicitly', () => {
  for (const dims of [[0, 2, 3], [-1, 2, 3], [1, NaN, 3], [1, 2, Infinity]]) {
    assert.throws(() => createStageBoxGeometry(THREE, ...dims, 0.1), RangeError);
  }
  for (const bevel of [-1, NaN, Infinity]) assert.throws(() => createStageBoxGeometry(THREE, 1, 2, 3, bevel), RangeError);
});
