/**
 * Prop shapes.
 *
 * Most furniture is a box, and every prop still carries the axis-aligned box
 * that bounds it in `size` and `center`: broad phases, previews and framing
 * read that and nothing else. A few supports are not boxes, and treating them
 * as one is the error the box was hiding. An exercise ball drawn as its cube
 * holds a body up at corners a ball does not have, and a wedge drawn as its
 * bounding box is a step. So a prop may also say what it is:
 *
 * - `shape: "sphere"` - a ball filling its (cubic) bounds.
 * - `shape: "prism"` - a convex `profile` of [z, y] points about `center`,
 *   counter-clockwise, running the full width of the bounds along x. A wedge,
 *   or a reclined backrest.
 *
 * Anything that needs the true surface - collision, what is underfoot, the
 * rendered mesh, its outline - asks here, so the solver and the renderer can
 * never disagree about where the ball is.
 */

export const PROP_SHAPES = ["box", "sphere", "prism"];

export const propShape = (prop) => prop.shape ?? "box";

/** The axis-aligned bounds, as the solver and composer store them. */
export function propBox(prop) {
  return {
    min: [
      prop.center[0] - prop.size[0] / 2,
      prop.center[1] - prop.size[1] / 2,
      prop.center[2] - prop.size[2] / 2,
    ],
    max: [
      prop.center[0] + prop.size[0] / 2,
      prop.center[1] + prop.size[1] / 2,
      prop.center[2] + prop.size[2] / 2,
    ],
  };
}

export const withBounds = (prop) => ({ ...prop, box: propBox(prop) });

/** The fields that describe a prop, for payloads that leave the solver. */
export function propData({ kind, size, center, shape, profile }) {
  return {
    kind,
    size,
    center,
    ...(shape && shape !== "box" ? { shape } : {}),
    ...(profile ? { profile } : {}),
  };
}

/** A box's profile, so every flat-sided prop is one prism. */
function profileOf(prop) {
  if (propShape(prop) === "prism") return prop.profile;
  const z = prop.size[2] / 2,
    y = prop.size[1] / 2;
  return [
    [-z, -y],
    [z, -y],
    [z, y],
    [-z, y],
  ];
}

/**
 * Signed distance from a point to a convex counter-clockwise polygon, with the
 * unit direction away from it. Negative inside, where the direction is the
 * outward normal of the nearest edge.
 */
function polygonDistance(profile, u, v) {
  let plane = -Infinity,
    planeNormal = null,
    best = Infinity,
    bestNormal = null;
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    const eu = b[0] - a[0],
      ev = b[1] - a[1];
    const length = Math.hypot(eu, ev);
    const nu = ev / length,
      nv = -eu / length;
    const side = (u - a[0]) * nu + (v - a[1]) * nv;
    if (side > plane) {
      plane = side;
      planeNormal = [nu, nv];
    }
    const t = Math.max(
      0,
      Math.min(1, ((u - a[0]) * eu + (v - a[1]) * ev) / (length * length)),
    );
    const du = u - (a[0] + eu * t),
      dv = v - (a[1] + ev * t);
    const distance = Math.hypot(du, dv);
    if (distance < best) {
      best = distance;
      bestNormal = distance > 1e-12 ? [du / distance, dv / distance] : [nu, nv];
    }
  }
  return plane <= 0
    ? { distance: plane, normal: planeNormal }
    : { distance: best, normal: bestNormal };
}

/**
 * Signed distance from a point to the prop's surface and the unit direction
 * out of it: negative inside, where the direction is the nearest way out.
 */
export function propDistance(prop, point) {
  const [cx, cy, cz] = prop.center;
  if (propShape(prop) === "sphere") {
    const delta = [point[0] - cx, point[1] - cy, point[2] - cz];
    const length = Math.hypot(...delta);
    return {
      distance: length - prop.size[0] / 2,
      normal: length > 1e-12 ? delta.map((n) => n / length) : [0, 1, 0],
    };
  }
  const flat = polygonDistance(profileOf(prop), point[2] - cz, point[1] - cy);
  const across = Math.abs(point[0] - cx) - prop.size[0] / 2;
  const side = point[0] >= cx ? 1 : -1;
  if (flat.distance <= 0 && across <= 0)
    return across > flat.distance
      ? { distance: across, normal: [side, 0, 0] }
      : { distance: flat.distance, normal: [0, flat.normal[1], flat.normal[0]] };
  const a = Math.max(flat.distance, 0),
    b = Math.max(across, 0);
  const distance = Math.hypot(a, b);
  return {
    distance,
    normal: [
      (b * side) / distance,
      (a * flat.normal[1]) / distance,
      (a * flat.normal[0]) / distance,
    ],
  };
}

export const propContains = (prop, point, inset = 1e-8) =>
  propDistance(prop, point).distance < -inset;

/**
 * The height of the prop's upper surface over a plan position, or null when
 * the position is outside its footprint. On a box that is its top; on a ball
 * or a wedge it falls away towards the edge.
 */
export function propTopAt(prop, x, z) {
  const [cx, cy, cz] = prop.center;
  const shape = propShape(prop);
  if (shape === "sphere") {
    const r = prop.size[0] / 2;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    return d2 > r * r ? null : cy + Math.sqrt(r * r - d2);
  }
  if (Math.abs(x - cx) > prop.size[0] / 2) return null;
  if (shape === "box")
    return Math.abs(z - cz) > prop.size[2] / 2 ? null : cy + prop.size[1] / 2;
  const u = z - cz;
  let top = null;
  const { profile } = prop;
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    const lo = Math.min(a[0], b[0]),
      hi = Math.max(a[0], b[0]);
    if (u < lo || u > hi) continue;
    const v =
      hi - lo < 1e-12
        ? Math.max(a[1], b[1])
        : a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
    top = top == null ? v : Math.max(top, v);
  }
  return top == null ? null : cy + top;
}

const SPHERE_SEGMENTS = 32;
const SPHERE_RINGS = 16;

/**
 * The closed surface as triangles, wound counter-clockwise seen from outside:
 * flat faces with their own vertices for flat-sided props, smooth for a ball.
 */
export function propTriangles(prop) {
  const [cx, cy, cz] = prop.center;
  const positions = [],
    normals = [],
    indices = [];
  if (propShape(prop) === "sphere") {
    const r = prop.size[0] / 2;
    for (let i = 0; i <= SPHERE_RINGS; i += 1) {
      const polar = (Math.PI * i) / SPHERE_RINGS;
      for (let j = 0; j <= SPHERE_SEGMENTS; j += 1) {
        const around = (2 * Math.PI * j) / SPHERE_SEGMENTS;
        const n = [
          Math.sin(polar) * Math.cos(around),
          Math.cos(polar),
          Math.sin(polar) * Math.sin(around),
        ];
        positions.push(cx + n[0] * r, cy + n[1] * r, cz + n[2] * r);
        normals.push(...n);
      }
    }
    const row = SPHERE_SEGMENTS + 1;
    for (let i = 0; i < SPHERE_RINGS; i += 1)
      for (let j = 0; j < SPHERE_SEGMENTS; j += 1) {
        const a = i * row + j,
          b = a + row;
        if (i > 0) indices.push(a, a + 1, b);
        if (i < SPHERE_RINGS - 1) indices.push(a + 1, b + 1, b);
      }
    return { positions, normals, indices };
  }
  const profile = profileOf(prop);
  const hx = prop.size[0] / 2;
  const face = (points, normal) => {
    const base = positions.length / 3;
    for (const p of points) {
      positions.push(...p);
      normals.push(...normal);
    }
    // Fan across a convex face, turned to face its outward normal.
    const e1 = points[1].map((n, k) => n - points[0][k]),
      e2 = points[2].map((n, k) => n - points[0][k]);
    const facing =
      normal[0] * (e1[1] * e2[2] - e1[2] * e2[1]) +
      normal[1] * (e1[2] * e2[0] - e1[0] * e2[2]) +
      normal[2] * (e1[0] * e2[1] - e1[1] * e2[0]);
    for (let k = 1; k < points.length - 1; k += 1)
      if (facing >= 0) indices.push(base, base + k, base + k + 1);
      else indices.push(base, base + k + 1, base + k);
  };
  const at = (x, [u, v]) => [cx + x, cy + v, cz + u];
  face(
    profile.map((p) => at(-hx, p)),
    [-1, 0, 0],
  );
  face(
    profile.map((p) => at(hx, p)),
    [1, 0, 0],
  );
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    face(
      [at(-hx, a), at(-hx, b), at(hx, b), at(hx, a)],
      [0, -(b[0] - a[0]) / length, (b[1] - a[1]) / length],
    );
  }
  return { positions, normals, indices };
}

/**
 * Line segments that draw the prop: its hard edges, or for a ball three great
 * circles, since a sphere has no edges and a schematic has no shading.
 */
export function propOutline(prop) {
  const [cx, cy, cz] = prop.center;
  const segments = [];
  if (propShape(prop) === "sphere") {
    const r = prop.size[0] / 2;
    const steps = 24;
    const ring = (point) => {
      for (let i = 0; i < steps; i += 1) {
        const a = (2 * Math.PI * i) / steps,
          b = (2 * Math.PI * (i + 1)) / steps;
        segments.push([point(a), point(b)]);
      }
    };
    ring((a) => [cx + r * Math.cos(a), cy, cz + r * Math.sin(a)]);
    ring((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a), cz]);
    ring((a) => [cx, cy + r * Math.sin(a), cz + r * Math.cos(a)]);
    return segments;
  }
  const profile = profileOf(prop);
  const hx = prop.size[0] / 2;
  const at = (x, [u, v]) => [cx + x, cy + v, cz + u];
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    segments.push([at(-hx, a), at(-hx, b)], [at(hx, a), at(hx, b)], [at(-hx, a), at(hx, a)]);
  }
  return segments;
}

/**
 * Whether a prop is well formed: finite positive bounds, and for the shapes
 * that are not boxes, bounds that are the shape's own - a ball as wide as it
 * is tall, a profile that is convex, counter-clockwise and fills the box.
 */
export function propProblem(prop) {
  const finite = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!finite(prop?.center) || !finite(prop?.size) || prop.size.some((n) => n <= 0))
    return "bounds";
  const shape = propShape(prop);
  if (!PROP_SHAPES.includes(shape)) return `unknown shape ${shape}`;
  if (shape === "sphere")
    return prop.size.every((n) => Math.abs(n - prop.size[0]) < 1e-9) ? null : "sphere bounds";
  if (shape === "box") return prop.profile ? "box with a profile" : null;
  const profile = prop.profile;
  if (
    !Array.isArray(profile) ||
    profile.length < 3 ||
    profile.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
  )
    return "profile";
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length],
      c = profile[(i + 2) % profile.length];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (turn <= 1e-12) return "profile is not convex and counter-clockwise";
  }
  const extent = (k) => [Math.min(...profile.map((p) => p[k])), Math.max(...profile.map((p) => p[k]))];
  const [z, y] = [extent(0), extent(1)];
  const half = [prop.size[2] / 2, prop.size[1] / 2];
  if (
    [z, y].some(
      ([lo, hi], k) => Math.abs(lo + half[k]) > 1e-9 || Math.abs(hi - half[k]) > 1e-9,
    )
  )
    return "profile does not fill its bounds";
  return null;
}
