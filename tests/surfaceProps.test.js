import assert from "node:assert/strict";
import test from "node:test";
import { buildTriangleTree } from "../src/core/meshDistance.js";
import { measurePropSurface } from "../src/core/surfaceProps.js";

const box = () => ({ kind: "seat", center: [0, 0, 0], size: [2, 2, 2] });
const tree = (points) =>
  buildTriangleTree([{ positions: points.flat(), indices: [0, 1, 2] }]);

test("outward-facing clearance is measured against the complete box", () => {
  const patch = tree([
    [-0.2, 1.003, -0.2],
    [0.2, 1.003, -0.2],
    [0, 1.003, 0.2],
  ]);
  const result = measurePropSurface(patch, box());
  assert.equal(result.intersects, false);
  assert.equal(result.facing, true);
  assert.ok(Math.abs(result.distance - 0.003) < 1e-9);
  const side = tree([
    [1.002, -0.2, -0.2],
    [1.002, 0, 0.2],
    [1.002, 0.2, -0.2],
  ]);
  assert.equal(measurePropSurface(side, box()).intersects, false);
});

test("crossing faces and wholly contained parts cannot be mistaken for clearance", () => {
  const crossing = tree([
    [-2, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ]);
  assert.equal(measurePropSurface(crossing, box()).intersects, true);
  const inside = tree([
    [-0.1, 0, 0],
    [0.1, 0, 0],
    [0, 0.1, 0],
  ]);
  assert.equal(measurePropSurface(inside, box()).reason, "interior_vertex");
});

test("back-facing or absent geometry remains unknown rather than granting an exception", () => {
  const reversed = tree([
    [-0.2, 1.003, -0.2],
    [0, 1.003, 0.2],
    [0.2, 1.003, -0.2],
  ]);
  assert.equal(measurePropSurface(reversed, box()).intersects, null);
  assert.equal(measurePropSurface(null, box()), null);
  assert.equal(
    measurePropSurface(reversed, { ...box(), size: [2, NaN, 2] }),
    null,
  );
});

test("moving a prop invalidates its cached geometry while prior results remain unchanged", () => {
  const patch = tree([
      [-0.2, 1.003, -0.2],
      [0.2, 1.003, -0.2],
      [0, 1.003, 0.2],
    ]),
    prop = box();
  const before = measurePropSurface(patch, prop);
  prop.center[1] = 0.1;
  assert.equal(measurePropSurface(patch, prop).intersects, true);
  assert.equal(before.intersects, false);
  prop.center[1] = -0.1;
  assert.ok(Math.abs(measurePropSurface(patch, prop).distance - 0.103) < 1e-9);
});

test("a prop enclosed by an outward-facing shell is not certified as clear", () => {
  const vertices = [
      [4, 0, 0],
      [-4, 0, 0],
      [0, 4, 0],
      [0, -4, 0],
      [0, 0, 4],
      [0, 0, -4],
    ],
    indices = [];
  for (const x of [0, 1])
    for (const y of [2, 3])
      for (const z of [4, 5]) {
        const a = vertices[x],
          b = vertices[y],
          c = vertices[z],
          u = b.map((n, k) => n - a[k]),
          v = c.map((n, k) => n - a[k]);
        const normal = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        indices.push(
          ...(normal.reduce((sum, n, k) => sum + n * a[k], 0) > 0
            ? [x, y, z]
            : [x, z, y]),
        );
      }
  const shell = buildTriangleTree([{ positions: vertices.flat(), indices }]);
  const result = measurePropSurface(shell, box());
  assert.equal(result.intersects, null);
  assert.equal(result.reason, "orientation_unverified");
});
