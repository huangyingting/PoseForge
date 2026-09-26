/** Distances from a drawn support region to its declared supporting plane. */
import { buildTriangleTree, closestMeshPoints } from "./meshDistance.js";
import { supportPlaneFor } from "./poseLibrary.js";
import {
  propBox,
  propProblem,
  propShape,
  propTopAt,
  propTriangles,
} from "./propShapes.js";

const finite = (point) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

/**
 * The part of a prop a support rests on. A box's top is one flat quad at the
 * support plane; a ball's or a wedge's falls away from it, so it carries its
 * height over each plan position and the whole surface to measure against.
 */
function topOf(prop) {
  if (
    !finite(prop.center) ||
    !finite(prop.size) ||
    prop.size.some((n) => n <= 0)
  )
    return null;
  if (propShape(prop) !== "box") {
    if (propProblem(prop)) return null;
    const { min, max } = propBox(prop);
    return {
      min: [min[0], max[1], min[2]],
      max,
      heightAt: (x, z) => propTopAt(prop, x, z),
      tree: buildTriangleTree([propTriangles(prop)]),
    };
  }
  const [x, y, z] = prop.center,
    [w, h, d] = prop.size;
  const min = [x - w / 2, y + h / 2, z - d / 2];
  const max = [x + w / 2, min[1], z + d / 2];
  return {
    min,
    max,
    heightAt: null,
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

/**
 * Lowest triangle point over the actual footprint, including clipped edges -
 * lowest against the surface under it, which on a box is the plane.
 */
function lowestOver(tree, top, plane) {
  let point = null,
    height = plane,
    best = Infinity;
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
      for (const candidate of polygon) {
        const under = top.heightAt
          ? top.heightAt(candidate[0], candidate[2])
          : plane;
        if (under == null) continue;
        if (!point || candidate[1] - under < best) {
          point = candidate;
          height = under;
          best = candidate[1] - under;
        }
      }
    }
  }
  return point && { point, height };
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
      propIndex: null,
      withinFootprint: true,
    };
  }
  let best = null;
  for (const { prop, top } of surfaces) {
    const lowest = lowestOver(tree, top, plane);
    const point = lowest?.point;
    const nearest = point ? null : closestMeshPoints(tree, top.tree);
    if (!point && !nearest) continue;
    const delta = point ? point[1] - lowest.height : null;
    const measured = {
      gap: point ? Math.abs(delta) : nearest.distance,
      penetration: point ? Math.max(0, -delta) : 0,
      plane,
      prop: prop.kind,
      propIndex: (surface.props ?? []).indexOf(prop),
      withinFootprint: Boolean(point),
      point: point ?? nearest.from,
      target: point ? [point[0], lowest.height, point[2]] : nearest.to,
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

/** Project visible regional geometry near its support plane into contact bounds.
 * An empty bounds object is measured absence; null means geometry unavailable. */
export function measureSupportContactBounds(tree, support, surface) {
  if (!tree || !support || !surface || !finite(tree.min) || !finite(tree.max))
    return null;
  const plane = supportPlaneFor(support, surface);
  if (!Number.isFinite(plane)) return null;
  const targets = [];
  for (const prop of surface.props ?? []) {
    const top = topOf(prop);
    if (!top) return null;
    if (Math.abs(top.min[1] - plane) <= 1e-7) targets.push(top);
  }
  if (!targets.length) {
    if (plane !== surface.ground) return null;
    targets.push(null);
  }
  let min = null,
    max = null;
  for (const top of targets) {
    const stack = [tree];
    const include = (p) => {
      min ??= [p[0], p[2]];
      max ??= [p[0], p[2]];
      [0, 2].forEach((axis, k) => {
        min[k] = Math.min(min[k], p[axis]);
        max[k] = Math.max(max[k], p[axis]);
      });
    };
    while (stack.length) {
      const node = stack.pop();
      // A curved or sloped top is lower than the plane away from its crest.
      if (
        node.min[1] > plane + 0.03 ||
        (!top?.heightAt && node.max[1] < plane - 0.03)
      )
        continue;
      if (
        top &&
        (node.max[0] < top.min[0] ||
          node.min[0] > top.max[0] ||
          node.max[2] < top.min[2] ||
          node.min[2] > top.max[2])
      )
        continue;
      if (!node.triangles) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const triangle of node.triangles) {
        if (top?.heightAt) {
          // Near the surface under each vertex; the mesh is fine enough that
          // vertices stand in for the clipped band a flat top gets.
          for (const p of triangle.points) {
            const under = top.heightAt(p[0], p[2]);
            if (under != null && Math.abs(p[1] - under) <= 0.03) include(p);
          }
          continue;
        }
        let polygon = triangle.points;
        if (top)
          for (const axis of [0, 2]) {
            polygon = clip(polygon, axis, top.min[axis], 1);
            polygon = clip(polygon, axis, top.max[axis], -1);
          }
        polygon = clip(polygon, 1, plane - 0.03, 1);
        polygon = clip(polygon, 1, plane + 0.03, -1);
        for (const p of polygon) include(p);
      }
    }
  }
  return { min, max };
}
