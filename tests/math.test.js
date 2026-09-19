/**
 * Vector, quaternion and matrix primitives.
 *
 * These are the only functions in the project with no domain in them, which
 * makes them the only ones that can be checked against closed-form answers
 * rather than against tolerances chosen by eye. Everything above them inherits
 * whatever is wrong here, so they are worth pinning exactly.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEG,
  clamp,
  closestPointOnSegment,
  closestPointsBetweenSegments,
  mat4InvertRigid,
  mat4Multiply,
  mat4TransformPoint,
  quatAngle,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatMultiply,
  quatNormalize,
  quatRotate,
  quatRotateInverse,
  quatSlerp,
  quatSwingTwist,
  smoothstep,
  v3cross,
  v3dist,
  v3dot,
  v3len,
  v3normalize,
  v3perpendicular,
} from "../src/core/math.js";

const near = (got, want, tolerance = 1e-9, message = "") =>
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${message} expected ${want}, got ${got} (tolerance ${tolerance})`
  );

const nearVec = (got, want, tolerance = 1e-9, message = "") => {
  for (let i = 0; i < want.length; i += 1) near(got[i], want[i], tolerance, `${message}[${i}]`);
};

test("clamp and smoothstep stay inside their ranges", () => {
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(0.25, 0, 1), 0.25);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  near(smoothstep(0, 1, 0.5), 0.5);
  // Smooth means zero slope at both ends, which is the whole reason to prefer
  // it to a lerp. Checked as a finite difference rather than by inspection.
  const slope = (smoothstep(0, 1, 0.001) - smoothstep(0, 1, 0)) / 0.001;
  assert.ok(slope < 0.01, `expected a flat start, got slope ${slope}`);
});

test("normalize leaves a zero vector alone rather than producing NaN", () => {
  nearVec(v3normalize([0, 0, 0]), [0, 0, 0]);
  nearVec(v3normalize([0, 3, 0]), [0, 1, 0]);
  near(v3len(v3normalize([1, 2, 3])), 1);
});

test("perpendicular is perpendicular for every axis-aligned input", () => {
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
    [0.6, 0.8, 0],
  ]) {
    const perpendicular = v3perpendicular(axis);
    near(v3dot(axis, perpendicular), 0, 1e-12, `axis ${axis}`);
    near(v3len(perpendicular), 1, 1e-12, `axis ${axis}`);
  }
});

test("cross products follow the right-hand rule", () => {
  nearVec(v3cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  nearVec(v3cross([0, 1, 0], [0, 0, 1]), [1, 0, 0]);
  nearVec(v3cross([0, 0, 1], [1, 0, 0]), [0, 1, 0]);
});

test("a quarter turn about each axis lands where it should", () => {
  const quarter = Math.PI / 2;
  nearVec(quatRotate(quatFromAxisAngle([0, 1, 0], quarter), [0, 0, 1]), [1, 0, 0], 1e-12);
  nearVec(quatRotate(quatFromAxisAngle([1, 0, 0], quarter), [0, 1, 0]), [0, 0, 1], 1e-12);
  nearVec(quatRotate(quatFromAxisAngle([0, 0, 1], quarter), [1, 0, 0]), [0, 1, 0], 1e-12);
});

test("rotating by the inverse is the same as the inverse rotation", () => {
  const q = quatNormalize(quatFromAxisAngle(v3normalize([0.3, -0.5, 0.8]), 1.1));
  const point = [0.2, -0.7, 0.4];
  nearVec(quatRotateInverse(q, quatRotate(q, point)), point, 1e-12);
});

test("rotation composes in the order it is applied", () => {
  const first = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const second = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const point = [0, 0, 1];
  // quatMultiply(a, b) must mean "b then a", the same convention as matrices.
  nearVec(
    quatRotate(quatMultiply(second, first), point),
    quatRotate(second, quatRotate(first, point)),
    1e-12
  );
});

test("quatFromUnitVectors takes one direction to the other, including reversals", () => {
  const cases = [
    [[0, 1, 0], [0, 0, 1]],
    [[1, 0, 0], [-1, 0, 0]], // antiparallel: the degenerate case
    [[0, 0, 1], [0, 0, 1]], // identical: the other degenerate case
    [v3normalize([1, 2, 3]), v3normalize([-3, 1, 0.5])],
  ];
  for (const [from, to] of cases) {
    const q = quatFromUnitVectors(from, to);
    nearVec(quatRotate(q, from), to, 1e-9, `${from} -> ${to}`);
  }
});

test("quatAngle reports the turn that was asked for", () => {
  for (const degrees of [0, 30, 90, 179]) {
    const q = quatFromAxisAngle(v3normalize([0.2, 1, -0.4]), degrees * DEG);
    near(quatAngle(q), degrees * DEG, 1e-9, `${degrees} degrees`);
  }
});

test("slerp is the identity at both ends and halves the angle in between", () => {
  const a = quatFromAxisAngle([0, 1, 0], 0);
  const b = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  nearVec(quatSlerp(a, b, 0), a, 1e-12);
  nearVec(quatSlerp(a, b, 1), b, 1e-12);
  near(quatAngle(quatSlerp(a, b, 0.5)), Math.PI / 4, 1e-9);
});

test("swing and twist multiply back to the rotation they came from", () => {
  const axis = [0, 1, 0];
  const q = quatNormalize(quatFromAxisAngle(v3normalize([0.4, 0.7, -0.2]), 0.9));
  const { swing, twist } = quatSwingTwist(q, axis);
  nearVec(quatMultiply(swing, twist), q, 1e-9);
  // The twist is about the axis, so it must leave the axis itself untouched.
  nearVec(quatRotate(twist, axis), axis, 1e-9);
});

test("closest point on a segment clamps to the ends", () => {
  const a = [0, 0, 0];
  const b = [1, 0, 0];
  nearVec(closestPointOnSegment([0.5, 1, 0], a, b).point, [0.5, 0, 0]);
  nearVec(closestPointOnSegment([-3, 1, 0], a, b).point, a);
  near(closestPointOnSegment([-3, 1, 0], a, b).t, 0);
  nearVec(closestPointOnSegment([9, 1, 0], a, b).point, b);
  near(closestPointOnSegment([9, 1, 0], a, b).t, 1);
});

test("closest points between two segments handles crossing, parallel and degenerate", () => {
  // Perpendicular and offset in y: the answer is the crossing point of their
  // projections, one unit apart.
  let hit = closestPointsBetweenSegments([-1, 0, 0], [1, 0, 0], [0, 1, -1], [0, 1, 1]);
  near(v3dist(hit.c1, hit.c2), 1, 1e-9);
  near(Math.sqrt(hit.distanceSq), 1, 1e-9);

  // Parallel: any pair at the right separation is correct, so only the distance
  // is pinned.
  hit = closestPointsBetweenSegments([0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 2, 0]);
  near(v3dist(hit.c1, hit.c2), 2, 1e-9);

  // Zero length on both sides: still has to produce the two points.
  hit = closestPointsBetweenSegments([0, 0, 0], [0, 0, 0], [3, 4, 0], [3, 4, 0]);
  near(v3dist(hit.c1, hit.c2), 5, 1e-9);

  // Touching at a shared endpoint: zero, and no NaN from the division.
  hit = closestPointsBetweenSegments([0, 0, 0], [1, 0, 0], [1, 0, 0], [2, 0, 0]);
  near(v3dist(hit.c1, hit.c2), 0, 1e-9);
});

test("a rigid matrix inverse undoes the transform it came from", () => {
  const rotation = quatFromAxisAngle(v3normalize([0.3, 1, 0.2]), 0.7);
  const translate = [0.4, -1.2, 2];
  const compose = (q, t) => {
    // Built from the primitives under test rather than imported, so that a wrong
    // mat4Compose cannot quietly agree with a wrong mat4InvertRigid.
    const x = quatRotate(q, [1, 0, 0]);
    const y = quatRotate(q, [0, 1, 0]);
    const z = quatRotate(q, [0, 0, 1]);
    return [...x, 0, ...y, 0, ...z, 0, ...t, 1];
  };
  const m = compose(rotation, translate);
  const inverse = mat4InvertRigid(m);
  const point = [1.5, -0.25, 0.75];
  nearVec(mat4TransformPoint(inverse, mat4TransformPoint(m, point)), point, 1e-9);
  // And the product of the two is the identity.
  const identity = mat4Multiply(m, inverse);
  for (let i = 0; i < 16; i += 1) near(identity[i], i % 5 === 0 ? 1 : 0, 1e-9, `element ${i}`);
});
