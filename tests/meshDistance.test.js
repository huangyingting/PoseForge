import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTriangleTree,
  refitTriangleTree,
  closestMeshPoints,
  closestPointOnTriangle,
  triangleDistance,
} from "../src/core/meshDistance.js";

const triangle = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];
const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const tree = (triangles) =>
  buildTriangleTree([
    {
      positions: triangles.flat(2),
      indices: triangles.flat().map((_, i) => i),
    },
  ]);

test("triangle projection finds face, edge and vertex regions", () => {
  closestPointOnTriangle([0.2, 0.3, 2], ...triangle).forEach((v, k) =>
    close(v, [0.2, 0.3, 0][k]),
  );
  assert.deepEqual(
    closestPointOnTriangle([-1, 0.4, 0], ...triangle),
    [0, 0.4, 0],
  );
  assert.deepEqual(closestPointOnTriangle([2, -1, 0], ...triangle), [1, 0, 0]);
});

test("surface distance measures triangle interiors rather than nearest vertices", () => {
  const offset = [
    [0.2, 0.2, 0.019],
    [0.5, 0.2, 0.019],
    [0.2, 0.5, 0.019],
  ];
  const result = triangleDistance(triangle, offset);
  close(result.distance, 0.019);
  assert.equal(result.intersects, false);
  close(
    Math.hypot(...result.from.map((x, k) => x - result.to[k])),
    result.distance,
  );
  close(triangleDistance(offset, triangle).distance, result.distance);
});

test("crossing triangles are not mislabeled as a harmless zero-distance contact", () => {
  const other = [
    [0.2, 0.2, -1],
    [0.2, 0.2, 1],
    [0.8, 0.2, 0],
  ];
  const result = triangleDistance(triangle, other);
  assert.equal(result.intersects, true);
  close(result.distance, 0);
  const touching = triangle.map(([x, y, z]) => [x + 1, y, z]);
  assert.equal(triangleDistance(triangle, touching).intersects, false);
  close(triangleDistance(triangle, touching).distance, 0);
});

test("degenerate triangles and empty meshes remain finite or explicitly unavailable", () => {
  const point = [
    [0, 0, 2],
    [0, 0, 2],
    [0, 0, 2],
  ];
  close(triangleDistance(triangle, point).distance, 2);
  const line = [
    [0, 0, 2],
    [1, 0, 2],
    [0.5, 0, 2],
  ];
  close(triangleDistance(triangle, line).distance, 2);
  assert.equal(closestMeshPoints(tree([]), tree([triangle])), null);
});

test("hierarchy agrees with exhaustive triangle pairs, including millimeter-sized faces", () => {
  const all = Array.from({ length: 30 }, (_, i) =>
    triangle.map(([x, y, z]) => [x * 0.006 + i * 0.02, y * 0.008, z]),
  );
  const other = [
    [0.008, 0.004, 0.003],
    [0.003, -0.002, 0.003],
    [0.02, -0.003, 0.003],
  ];
  const brute = Math.min(
    ...all.map((t) => triangleDistance(t, other).distance),
  );
  const accelerated = closestMeshPoints(tree(all), tree([other]));
  close(accelerated.distance, brute);
  close(accelerated.distance, 0.003);
});

test("small skew edges retain an interior minimum even when no vertex projects onto the other face", () => {
  const a = [
    [-0.003, -0.0015, 0],
    [0.003, -0.0015, 0],
    [0, 0.003, 0],
  ];
  const b = [
    [-0.003, 0.0015, 0.002],
    [0.003, 0.0015, 0.002],
    [0, -0.003, 0.002],
  ];
  close(triangleDistance(a, b).distance, 0.002);
  close(closestMeshPoints(tree([a]), tree([b])).distance, 0.002);
});

test("back-facing or coincident equally oriented surfaces cannot verify proxy clearance", () => {
  const above = triangle.map(([x, y, z]) => [x, y, z + 0.01]);
  assert.equal(triangleDistance(triangle, above).facing, false);
  assert.equal(triangleDistance([...triangle].reverse(), above).facing, false);
  assert.equal(triangleDistance(triangle, [...above].reverse()).facing, true);
  assert.equal(triangleDistance(triangle, triangle).facing, false);
});

test("crossing-only traversal matches exact queries without claiming distance or orientation", () => {
  const cases = [
    triangle.map(([x, y, z]) => [x, y, z + 0.01]),
    [
      [0.2, 0.2, -1],
      [0.2, 0.2, 1],
      [0.8, 0.2, 0],
    ],
    triangle.map(([x, y, z]) => [x + 1, y, z]),
    triangle,
  ];
  const many = Array.from({ length: 30 }, (_, i) =>
    triangle.map(([x, y, z]) => [x + 2 * i, y, z]),
  );
  for (const fixture of cases) {
    const a = tree(many),
      b = tree([fixture]);
    const exact = closestMeshPoints(a, b);
    const quick = closestMeshPoints(a, b, { crossingsOnly: true });
    assert.equal(quick.intersects, exact.intersects);
    if (quick.intersects) {
      close(quick.distance, 0);
      assert.equal(quick.normal.length, 3);
    } else {
      assert.deepEqual(quick, { intersects: false });
    }
    assert.equal(
      closestMeshPoints(b, a, { crossingsOnly: true }).intersects,
      exact.intersects,
    );
  }
  assert.equal(
    closestMeshPoints(null, tree([triangle]), { crossingsOnly: true }),
    null,
  );
});

test("refitting follows moved triangles, preserves the previous query and agrees with rebuilding", () => {
  const triangles = Array.from({ length: 30 }, (_, i) =>
    triangle.map(([x, y, z]) => [x * 0.01 + i * 0.1, y * 0.01, z + 0.03]),
  );
  const part = {
    positions: triangles.flat(2),
    indices: triangles.flat().map((_, i) => i),
  };
  const initial = buildTriangleTree([part]),
    saved = structuredClone(initial),
    target = tree([triangle]);
  for (const crossing of [false, true, false]) {
    const moved = structuredClone(part);
    // Move the last leaf across the original hierarchy, not just nearby.
    moved.positions.splice(
      29 * 9,
      9,
      ...(crossing
        ? [
            [0.2, 0.2, -1],
            [0.2, 0.2, 1],
            [0.8, 0.2, 0],
          ]
        : [
            [0.2, 0.2, 0.002],
            [0.5, 0.2, 0.002],
            [0.2, 0.5, 0.002],
          ]
      ).flat(),
    );
    const refitted = refitTriangleTree(initial, [moved]);
    const rebuilt = buildTriangleTree([moved]);
    for (const crossingsOnly of [false, true]) {
      const a = closestMeshPoints(refitted, target, { crossingsOnly }),
        b = closestMeshPoints(rebuilt, target, { crossingsOnly });
      assert.equal(a.intersects, b.intersects);
      if (!crossingsOnly) close(a.distance, b.distance);
    }
    assert.deepEqual(initial, saved);
    close(closestMeshPoints(initial, target).distance, 0.03);
  }
});

test("refitting rebuilds changed or partially missing topology without stale triangles", () => {
  const part = { positions: triangle.flat(), indices: [0, 1, 2] },
    initial = buildTriangleTree([part]);
  assert.equal(refitTriangleTree(initial, [{ ...part, indices: [] }]), null);
  const reversed = refitTriangleTree(initial, [
    { ...part, indices: [2, 1, 0] },
  ]);
  assert.deepEqual(
    reversed,
    buildTriangleTree([{ ...part, indices: [2, 1, 0] }]),
  );
  const missing = { ...part, positions: [NaN, ...part.positions.slice(1)] };
  assert.equal(refitTriangleTree(initial, [missing]), null);
  const partiallyMissing = buildTriangleTree([part, missing]);
  const restored = refitTriangleTree(partiallyMissing, [part, part]);
  assert.equal(
    restored.count,
    2,
    "newly available triangles must not be omitted",
  );
  assert.deepEqual(refitTriangleTree(null, [part]), initial);
});
