/** Conservative complete-figure checks against axis-aligned furniture boxes. */
import { buildTriangleTree, closestMeshPoints } from "./meshDistance.js";

const boxes = new WeakMap(),
  pairs = new WeakMap();
const finite = (point) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

function boxSurface(prop) {
  if (
    !prop ||
    !finite(prop.center) ||
    !finite(prop.size) ||
    prop.size.some((n) => n <= 0)
  )
    return null;
  const key = JSON.stringify([prop.center, prop.size]);
  if (boxes.get(prop)?.key === key) return boxes.get(prop).tree;
  const positions = [];
  for (let i = 0; i < 8; i++)
    for (let axis = 0; axis < 3; axis++)
      positions.push(
        prop.center[axis] + prop.size[axis] * ((i >> axis) & 1 ? 0.5 : -0.5),
      );
  const indices = [];
  for (const [a, b, c, d] of [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ])
    indices.push(a, b, c, a, c, d);
  const tree = buildTriangleTree([{ positions, indices }]);
  boxes.set(prop, { key, tree });
  return tree;
}

function hasInteriorVertex(tree, box) {
  const inside = (point) =>
    point.every(
      (n, axis) => n > box.min[axis] + 1e-8 && n < box.max[axis] - 1e-8,
    );
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (
      node.max.some(
        (n, axis) =>
          n <= box.min[axis] + 1e-8 || node.min[axis] >= box.max[axis] - 1e-8,
      )
    )
      continue;
    if (inside(node.min) && inside(node.max)) return true;
    if (node.triangles) {
      if (node.triangles.some((triangle) => triangle.points.some(inside)))
        return true;
    } else stack.push(node.left, node.right);
  }
  return false;
}

/** An unverified orientation remains unknown, including a box enclosed by a shell. */
export function measurePropSurface(tree, prop) {
  const box = boxSurface(prop);
  if (!tree || !box || !finite(tree.min) || !finite(tree.max)) return null;
  if (!pairs.has(tree)) pairs.set(tree, new WeakMap());
  const cache = pairs.get(tree);
  if (cache.has(box)) return cache.get(box);
  let result;
  if (hasInteriorVertex(tree, box))
    result = {
      intersects: true,
      distance: 0,
      facing: false,
      reason: "interior_vertex",
    };
  else {
    const measured = closestMeshPoints(tree, box);
    result = !measured
      ? null
      : measured.intersects
        ? { ...measured, reason: "crossing" }
        : measured.facing
          ? { ...measured, reason: null }
          : { ...measured, intersects: null, reason: "orientation_unverified" };
  }
  cache.set(box, result);
  return result;
}
