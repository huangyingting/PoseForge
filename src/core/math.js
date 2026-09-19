/**
 * Minimal dependency-free 3D math.
 *
 * The whole core layer (skeleton, SDF, collision, solver) is built on plain
 * arrays so it runs identically in the browser, in Node tests, and in the
 * headless CLI renderer. three.js is only used by the WebGL presentation layer.
 *
 * Conventions: right-handed, Y up, metres, radians. Quaternions are [x,y,z,w].
 * Matrices are column-major 16-element arrays, matching WebGL and three.js.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const EPS = 1e-9;

export const clamp = (value, min, max) =>
  value < min ? min : value > max ? max : value;

export const lerp = (a, b, t) => a + (b - a) * t;

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || EPS), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ vec3 */

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const v3copy = (a) => [a[0], a[1], a[2]];
export const v3set = (out, x, y, z) => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
};
export const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const v3mulv = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const v3lenSq = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const v3len = (a) => Math.sqrt(v3lenSq(a));
export const v3dist = (a, b) => v3len(v3sub(a, b));
export const v3distSq = (a, b) => v3lenSq(v3sub(a, b));
export const v3lerp = (a, b, t) => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
export const v3neg = (a) => [-a[0], -a[1], -a[2]];

export function v3normalize(a) {
  const length = v3len(a);
  return length < EPS ? [0, 0, 0] : [a[0] / length, a[1] / length, a[2] / length];
}

export function v3setLength(a, length) {
  return v3mul(v3normalize(a), length);
}

/** Any unit vector perpendicular to `a`. Stable for every input direction. */
export function v3perpendicular(a) {
  const axis =
    Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return v3normalize(v3cross(a, axis));
}

/* ------------------------------------------------------------------ quat */

export const quatIdentity = () => [0, 0, 0, 1];

export function quatFromAxisAngle(axis, angle) {
  const n = v3normalize(axis);
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(half)];
}

/** Intrinsic XYZ Euler (radians) -> quaternion. */
export function quatFromEulerXYZ(x, y, z) {
  const cx = Math.cos(x * 0.5);
  const sx = Math.sin(x * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);
  const cz = Math.cos(z * 0.5);
  const sz = Math.sin(z * 0.5);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatConjugate = (q) => [-q[0], -q[1], -q[2], q[3]];

export function quatNormalize(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  return length < EPS ? [0, 0, 0, 1] : [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function quatRotate(q, v) {
  // t = 2 * cross(q.xyz, v); v' = v + q.w * t + cross(q.xyz, t)
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + q[1] * tz - q[2] * ty,
    v[1] + q[3] * ty + q[2] * tx - q[0] * tz,
    v[2] + q[3] * tz + q[0] * ty - q[1] * tx,
  ];
}

/** Inverse-rotate a vector: equivalent to quatRotate(quatConjugate(q), v). */
export const quatRotateInverse = (q, v) => quatRotate(quatConjugate(q), v);

/** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
export function quatFromUnitVectors(from, to) {
  const a = v3normalize(from);
  const b = v3normalize(to);
  const d = v3dot(a, b);
  if (d > 1 - 1e-8) return quatIdentity();
  if (d < -1 + 1e-8) {
    const axis = v3perpendicular(a);
    return quatFromAxisAngle(axis, Math.PI);
  }
  const axis = v3cross(a, b);
  return quatNormalize([axis[0], axis[1], axis[2], 1 + d]);
}

export function quatSlerp(a, b, t) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let target = b;
  if (cos < 0) {
    cos = -cos;
    target = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) {
    return quatNormalize([
      lerp(a[0], target[0], t),
      lerp(a[1], target[1], t),
      lerp(a[2], target[2], t),
      lerp(a[3], target[3], t),
    ]);
  }
  const theta = Math.acos(cos);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [
    a[0] * wa + target[0] * wb,
    a[1] * wa + target[1] * wb,
    a[2] * wa + target[2] * wb,
    a[3] * wa + target[3] * wb,
  ];
}

export function quatAngle(q) {
  return 2 * Math.acos(clamp(Math.abs(q[3]), -1, 1));
}

/**
 * Swing-twist decomposition about `axis` (unit). Returns `{ swing, twist }`
 * with `q === swing * twist`. Used by the joint-limit code, which constrains
 * the swing cone and the twist angle independently.
 */
export function quatSwingTwist(q, axis) {
  const projection = v3dot([q[0], q[1], q[2]], axis);
  let twist = quatNormalize([
    axis[0] * projection,
    axis[1] * projection,
    axis[2] * projection,
    q[3],
  ]);
  if (projection * twist[3] < 0 && Math.abs(projection) > EPS) {
    // keep the twist on the same hemisphere as the input
    twist = [-twist[0], -twist[1], -twist[2], -twist[3]];
  }
  const swing = quatMultiply(q, quatConjugate(twist));
  return { swing: quatNormalize(swing), twist };
}

/* ------------------------------------------------------------------ mat4 */

export const mat4Identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mat4Compose(position, quaternion, scale = [1, 1, 1]) {
  const [x, y, z, w] = quaternion;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const [sx, sy, sz] = scale;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    position[0], position[1], position[2], 1,
  ];
}

export function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3;
    }
  }
  return out;
}

export function mat4TransformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function mat4TransformDirection(m, d) {
  const [x, y, z] = d;
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

/** Inverse of a rigid transform (rotation + translation, no scale). */
export function mat4InvertRigid(m) {
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  return [
    m[0], m[4], m[8], 0,
    m[1], m[5], m[9], 0,
    m[2], m[6], m[10], 0,
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    -(m[4] * tx + m[5] * ty + m[6] * tz),
    -(m[8] * tx + m[9] * ty + m[10] * tz),
    1,
  ];
}

export function mat4LookAt(eye, target, up = [0, 1, 0]) {
  let z = v3normalize(v3sub(eye, target));
  if (v3lenSq(z) < EPS) z = [0, 0, 1];
  let x = v3cross(up, z);
  if (v3lenSq(x) < EPS) {
    x = v3cross(Math.abs(up[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0], z);
  }
  x = v3normalize(x);
  const y = v3cross(z, x);
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    eye[0], eye[1], eye[2], 1,
  ];
}

export function mat4Perspective(fovYRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovYRadians / 2);
  const range = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0,
  ];
}

export function mat4Orthographic(left, right, bottom, top, near, far) {
  const w = 1 / (right - left);
  const h = 1 / (top - bottom);
  const p = 1 / (far - near);
  return [
    2 * w, 0, 0, 0,
    0, 2 * h, 0, 0,
    0, 0, -2 * p, 0,
    -(right + left) * w, -(top + bottom) * h, -(far + near) * p, 1,
  ];
}

/* ------------------------------------------------------- geometry helpers */

/**
 * Closest points between segment `p1->q1` and segment `p2->q2`.
 * Ericson, Real-Time Collision Detection §5.1.9. Returns squared distance and
 * the parametric positions, which the capsule narrowphase needs to build a
 * contact normal.
 */
export function closestPointsBetweenSegments(p1, q1, p2, q2) {
  const d1 = v3sub(q1, p1);
  const d2 = v3sub(q2, p2);
  const r = v3sub(p1, p2);
  const a = v3dot(d1, d1);
  const e = v3dot(d2, d2);
  const f = v3dot(d2, r);
  let s;
  let t;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = v3dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = v3dot(d1, d2);
      const denominator = a * e - b * b;
      s = denominator > EPS ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const c1 = v3add(p1, v3mul(d1, s));
  const c2 = v3add(p2, v3mul(d2, t));
  return { s, t, c1, c2, distanceSq: v3distSq(c1, c2) };
}

/** Closest point on segment `a->b` to `p`, plus its parametric position. */
export function closestPointOnSegment(p, a, b) {
  const ab = v3sub(b, a);
  const lengthSq = v3lenSq(ab);
  if (lengthSq < EPS) return { point: v3copy(a), t: 0 };
  const t = clamp(v3dot(v3sub(p, a), ab) / lengthSq, 0, 1);
  return { point: v3add(a, v3mul(ab, t)), t };
}

/* --------------------------------------------------------------- bounding */

export const aabbCreate = () => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});

export function aabbExpandPoint(box, p, radius = 0) {
  for (let i = 0; i < 3; i += 1) {
    if (p[i] - radius < box.min[i]) box.min[i] = p[i] - radius;
    if (p[i] + radius > box.max[i]) box.max[i] = p[i] + radius;
  }
  return box;
}

export function aabbOverlaps(a, b, margin = 0) {
  return (
    a.min[0] - margin <= b.max[0] &&
    a.max[0] + margin >= b.min[0] &&
    a.min[1] - margin <= b.max[1] &&
    a.max[1] + margin >= b.min[1] &&
    a.min[2] - margin <= b.max[2] &&
    a.max[2] + margin >= b.min[2]
  );
}

export const aabbCenter = (box) => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];

export const aabbSize = (box) => [
  box.max[0] - box.min[0],
  box.max[1] - box.min[1],
  box.max[2] - box.min[2],
];
