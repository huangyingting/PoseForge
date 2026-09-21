/** Distances from a drawn support region to its declared supporting plane. */
import { buildTriangleTree, closestMeshPoints } from "./meshDistance.js";
import { supportPlaneFor } from "./poseLibrary.js";

const finite = (point) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

function topOf(prop) {
  if (
    !finite(prop.center) ||
    !finite(prop.size) ||
    prop.size.some((n) => n <= 0)
  )
    return null;
  const [x, y, z] = prop.center,
    [w, h, d] = prop.size;
  const min = [x - w / 2, y + h / 2, z - d / 2];
  const max = [x + w / 2, min[1], z + d / 2];
  return {
    min,
    max,
    tree: buildTriangleTree([
      {
        positions: [
          min[0],
          min[1],
          min[2],
          min[0],
          min[1],
          max[2],
          max[0],
          min[1],
          max[2],
          max[0],
          min[1],
          min[2],
        ],
        indices: [0, 1, 2, 0, 2, 3],
      },
    ]),
  };
}

function clip(polygon, axis, edge, sign) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const da = (a[axis] - edge) * sign,
      db = (b[axis] - edge) * sign;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push(a.map((value, k) => value + (b[k] - value) * t));
    }
  }
  return out;
}

/** Lowest triangle point over the actual footprint, including clipped edges. */
function lowestOver(tree, top) {
  let point = null;
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (
      node.max[0] < top.min[0] ||
      node.min[0] > top.max[0] ||
      node.max[2] < top.min[2] ||
      node.min[2] > top.max[2]
    )
      continue;
    if (!node.triangles) {
      stack.push(node.left, node.right);
      continue;
    }
    for (const triangle of node.triangles) {
      let polygon = triangle.points;
      for (const axis of [0, 2]) {
        polygon = clip(polygon, axis, top.min[axis], 1);
        polygon = clip(polygon, axis, top.max[axis], -1);
      }
      for (const candidate of polygon)
        if (!point || candidate[1] < point[1]) point = candidate;
    }
  }
  return point;
}

/** Null means unavailable, never zero-distance contact. Does not move geometry. */
export function measureSurfaceSupport(tree, support, surface) {
  if (!tree || !support || !surface || !finite(tree.min) || !finite(tree.max))
    return null;
  const plane = supportPlaneFor(support, surface);
  if (!Number.isFinite(plane)) return null;
  const surfaces = [];
  for (const prop of surface.props ?? []) {
    const top = topOf(prop);
    if (!top) return null;
    if (Math.abs(top.min[1] - plane) <= 1e-7) surfaces.push({ prop, top });
  }
  if (!surfaces.length) {
    if (plane !== surface.ground) return null;
    const delta = tree.min[1] - plane;
    return {
      gap: Math.abs(delta),
      penetration: Math.max(0, -delta),
      plane,
      prop: null,
    };
  }
  let best = null;
  for (const { prop, top } of surfaces) {
    const point = lowestOver(tree, top);
    const nearest = point ? null : closestMeshPoints(tree, top.tree);
    if (!point && !nearest) continue;
    const delta = point ? point[1] - plane : null;
    const measured = {
      gap: point ? Math.abs(delta) : nearest.distance,
      penetration: point ? Math.max(0, -delta) : 0,
      plane,
      prop: prop.kind,
    };
    if (
      !best ||
      measured.penetration > best.penetration ||
      (measured.penetration === best.penetration && measured.gap < best.gap)
    )
      best = measured;
  }
  return best;
}
