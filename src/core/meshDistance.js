/** Triangle-surface distance with a small bounding-volume hierarchy. */
import { v3cross, v3dot, v3sub } from "./math.js";

const EPS = 1e-12;
const point = (positions, index) => [
  positions[index * 3],
  positions[index * 3 + 1],
  positions[index * 3 + 2],
];
const squared = (a, b) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
function onSegment(p, a, b) {
  const d = v3sub(b, a),
    length = v3dot(d, d);
  return length < 1e-24
    ? [...a]
    : mix(a, b, clamp01(v3dot(v3sub(p, a), d) / length));
}
function closestEdges(p, q, r, s) {
  const d1 = v3sub(q, p),
    d2 = v3sub(s, r),
    delta = v3sub(p, r);
  const a = v3dot(d1, d1),
    e = v3dot(d2, d2),
    f = v3dot(d2, delta);
  let u = 0,
    v = 0;
  if (a < 1e-24) v = e < 1e-24 ? 0 : clamp01(f / e);
  else {
    const c = v3dot(d1, delta);
    if (e < 1e-24) u = clamp01(-c / a);
    else {
      const b = v3dot(d1, d2),
        denominator = a * e - b * b;
      // A relative test is essential for millimeter-sized triangles: a
      // fixed epsilon on the fourth-power denominator calls them parallel.
      u =
        denominator > 1e-12 * a * e
          ? clamp01((b * f - c * e) / denominator)
          : 0;
      v = (b * u + f) / e;
      if (v < 0) {
        v = 0;
        u = clamp01(-c / a);
      } else if (v > 1) {
        v = 1;
        u = clamp01((b - c) / a);
      }
    }
  }
  return [mix(p, q, u), mix(r, s, v)];
}

export function closestPointOnTriangle(p, a, b, c) {
  const ab = v3sub(b, a),
    ac = v3sub(c, a);
  if (v3dot(v3cross(ab, ac), v3cross(ab, ac)) < 1e-20) {
    return [
      [a, b],
      [b, c],
      [c, a],
    ]
      .map(([x, y]) => onSegment(p, x, y))
      .reduce((best, next) =>
        squared(p, next) < squared(p, best) ? next : best,
      );
  }
  const ap = v3sub(p, a),
    d1 = v3dot(ab, ap),
    d2 = v3dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [...a];
  const bp = v3sub(p, b),
    d3 = v3dot(ab, bp),
    d4 = v3dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [...b];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return mix(a, b, d1 / (d1 - d3));
  const cp = v3sub(p, c),
    d5 = v3dot(ab, cp),
    d6 = v3dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [...c];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return mix(a, c, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 >= d3 && d5 >= d6)
    return mix(b, c, (d4 - d3) / (d4 - d3 + d5 - d6));
  const denom = 1 / (va + vb + vc),
    v = vb * denom,
    w = vc * denom;
  return a.map((value, k) => value + ab[k] * v + ac[k] * w);
}

function crossing(start, end, triangle) {
  const [a, b, c] = triangle;
  const direction = v3sub(end, start),
    edge1 = v3sub(b, a),
    edge2 = v3sub(c, a);
  const h = v3cross(direction, edge2),
    det = v3dot(edge1, h);
  if (Math.abs(det) < EPS) return null;
  const s = v3sub(start, a),
    u = v3dot(s, h) / det;
  if (u < -EPS || u > 1 + EPS) return null;
  const q = v3cross(s, edge1),
    v = v3dot(direction, q) / det;
  if (v < -EPS || u + v > 1 + EPS) return null;
  const t = v3dot(edge2, q) / det;
  // Endpoint touch and a coplanar overlap are distance-zero, but not a
  // witnessed crossing of one surface through the other.
  if (t <= 1e-7 || t >= 1 - 1e-7) return null;
  return mix(start, end, t);
}

function triangleCrossing(a, b) {
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  for (const [x, y] of edges) {
    const p = crossing(a[x], a[y], b) ?? crossing(b[x], b[y], a);
    if (p) {
      const normal = v3cross(v3sub(b[1], b[0]), v3sub(b[2], b[0]));
      const length = Math.hypot(...normal) || 1;
      return {
        from: p,
        to: p,
        distance: 0,
        squared: 0,
        intersects: true,
        normal: normal.map((v) => v / length),
      };
    }
  }
  return null;
}

export function triangleDistance(a, b) {
  const intersection = triangleCrossing(a, b);
  if (intersection) return intersection;
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  const unitNormal = (triangle) => {
    const n = v3cross(
      v3sub(triangle[1], triangle[0]),
      v3sub(triangle[2], triangle[0]),
    );
    const length = Math.hypot(...n);
    return length > 1e-14 ? n.map((v) => v / length) : null;
  };
  const normalA = unitNormal(a),
    normalB = unitNormal(b);
  let best = { squared: Infinity, intersects: false };
  const keep = (from, to) => {
    const distance = squared(from, to);
    if (distance < best.squared)
      best = { from, to, squared: distance, intersects: false };
  };
  for (const p of a) keep(p, closestPointOnTriangle(p, ...b));
  for (const p of b) keep(closestPointOnTriangle(p, ...a), p);
  for (const [a0, a1] of edges)
    for (const [b0, b1] of edges) {
      keep(...closestEdges(a[a0], a[a1], b[b0], b[b1]));
    }
  const separation = v3sub(best.from, best.to);
  const facing =
    !!normalA &&
    !!normalB &&
    v3dot(separation, normalB) >= -1e-8 &&
    v3dot(separation, normalA) <= 1e-8 &&
    (best.squared > 1e-14 || v3dot(normalA, normalB) < 0.9);
  return { ...best, distance: Math.sqrt(best.squared), facing };
}

function bounds(triangles) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles)
    for (const p of triangle.points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
  return { min, max };
}
function boxDistance(a, b) {
  let distance = 0;
  for (let k = 0; k < 3; k++)
    distance += Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]) ** 2;
  return distance;
}
function branch(triangles) {
  const box = bounds(triangles);
  if (triangles.length <= 8)
    return { ...box, triangles, count: triangles.length };
  const extents = box.max.map((value, k) => value - box.min[k]);
  const axis = extents.indexOf(Math.max(...extents));
  triangles.sort((a, b) => a.center[axis] - b.center[axis]);
  const mid = Math.floor(triangles.length / 2);
  return {
    ...box,
    count: triangles.length,
    left: branch(triangles.slice(0, mid)),
    right: branch(triangles.slice(mid)),
  };
}

/** Parts are already posed; only supplied triangle indices enter the tree. */
export function buildTriangleTree(parts) {
  const triangles = [];
  for (const [partIndex, part] of parts.entries())
    for (let i = 0; i < part.indices.length; i += 3) {
      const points = [0, 1, 2].map((k) =>
        point(part.positions, part.indices[i + k]),
      );
      if (!points.flat().every(Number.isFinite)) continue;
      const triangle = {
        part: partIndex,
        vertices: Array.from(part.indices.slice(i, i + 3)),
        points,
        center: [0, 1, 2].map(
          (k) => (points[0][k] + points[1][k] + points[2][k]) / 3,
        ),
      };
      Object.assign(triangle, bounds([triangle]));
      triangles.push(triangle);
    }
  return triangles.length
    ? {
        ...branch(triangles),
        topology: parts.map((part) => Array.from(part.indices)),
      }
    : null;
}

/** Update an immutable hierarchy for new vertex positions. Changed topology or
 * missing/nonfinite triangles rebuild instead, so no old coverage can leak in. */
export function refitTriangleTree(previous, parts) {
  const topology = previous?.topology;
  if (
    !topology ||
    topology.length !== parts.length ||
    previous.count !==
      topology.reduce((sum, indices) => sum + indices.length / 3, 0) ||
    topology.some(
      (indices, i) =>
        indices.length !== parts[i].indices.length ||
        indices.some((value, k) => value !== parts[i].indices[k]),
    )
  )
    return buildTriangleTree(parts);

  function refit(node) {
    if (node.triangles) {
      const triangles = [];
      for (const triangle of node.triangles) {
        const points = triangle.vertices.map((vertex) =>
          point(parts[triangle.part].positions, vertex),
        );
        if (points.some((p) => p.some((value) => !Number.isFinite(value))))
          return null;
        triangles.push({
          part: triangle.part,
          vertices: triangle.vertices,
          points,
          ...bounds([{ points }]),
        });
      }
      return { triangles, count: triangles.length, ...bounds(triangles) };
    }
    const left = refit(node.left),
      right = refit(node.right);
    if (!left || !right) return null;
    return {
      left,
      right,
      count: node.count,
      min: left.min.map((value, k) => Math.min(value, right.min[k])),
      max: left.max.map((value, k) => Math.max(value, right.max[k])),
    };
  }
  const result = refit(previous);
  return result ? { ...result, topology } : buildTriangleTree(parts);
}

/** Exact minimum over supplied triangles. Crossing-only queries omit distance
 * and orientation when clear; they still use the same triangle crossing test. */
export function closestMeshPoints(a, b, { crossingsOnly = false } = {}) {
  if (!a || !b) return null;
  let best = { squared: crossingsOnly ? 0 : Infinity };
  const stack = [[a, b]];
  while (stack.length) {
    const [left, right] = stack.pop();
    if (boxDistance(left, right) > best.squared + EPS) continue;
    if (left.triangles && right.triangles) {
      for (const x of left.triangles)
        for (const y of right.triangles) {
          if (boxDistance(x, y) > best.squared + EPS) continue;
          const found = crossingsOnly
            ? triangleCrossing(x.points, y.points)
            : triangleDistance(x.points, y.points);
          if (!found) continue;
          if (found.intersects) return found;
          if (found.squared < best.squared) best = found;
        }
    } else {
      const expandLeft =
        !left.triangles && (right.triangles || left.count >= right.count);
      const candidates = expandLeft
        ? [
            [left.left, right],
            [left.right, right],
          ]
        : [
            [left, right.left],
            [left, right.right],
          ];
      candidates.sort(
        (x, y) => boxDistance(y[0], y[1]) - boxDistance(x[0], x[1]),
      );
      stack.push(...candidates);
    }
  }
  return crossingsOnly
    ? { intersects: false }
    : Number.isFinite(best.squared)
      ? best
      : null;
}
