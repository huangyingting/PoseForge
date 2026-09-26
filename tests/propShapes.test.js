import assert from "node:assert/strict";
import test from "node:test";
import { resolveSurface, SURFACES } from "../src/core/poseLibrary.js";
import {
  propBox,
  propContains,
  propData,
  propDistance,
  propOutline,
  propProblem,
  propTopAt,
  propTriangles,
  withBounds,
} from "../src/core/propShapes.js";
import { capsuleBoxContact, capsulePropContact } from "../src/core/collision.js";
import { buildTriangleTree } from "../src/core/meshDistance.js";
import { measurePropSurface } from "../src/core/surfaceProps.js";
import {
  measureSupportContactBounds,
  measureSurfaceSupport,
} from "../src/core/surfaceSupport.js";
import { buildProps } from "../src/render/props.js";

const [ball] = SURFACES.ball.props.map(withBounds);
const [wedge] = SURFACES.wedge.props.map(withBounds);
const [, backrest] = SURFACES.car_seat.props.map(withBounds);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const allProps = () => Object.values(SURFACES).flatMap((surface) => surface.props);
// The wedge's slope rises 0.18 over 0.6 towards -z.
const slope = Math.hypot(0.6, 0.18);
const wedgeTop = (z) => 0.18 * (0.3 - z) / 0.6;

/** One triangle of a body's skin, its outer side turned towards `centre`. */
function skin(points, centre) {
  const [a, b, c] = points;
  const u = b.map((n, k) => n - a[k]),
    v = c.map((n, k) => n - a[k]);
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const towards = normal.reduce((sum, n, k) => sum + n * (centre[k] - a[k]), 0) > 0;
  return buildTriangleTree([{ positions: (towards ? [a, b, c] : [a, c, b]).flat(), indices: [0, 1, 2] }]);
}

/** Volume enclosed by triangles, positive when they are wound outward. */
function signedVolume({ positions, indices }) {
  const p = (i) => positions.slice(3 * i, 3 * i + 3);
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [p(indices[i]), p(indices[i + 1]), p(indices[i + 2])];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

const profileArea = (profile) =>
  profile.reduce((sum, [u, v], i) => {
    const [nu, nv] = profile[(i + 1) % profile.length];
    return sum + (u * nv - nu * v) / 2;
  }, 0);

test("every built-in prop is well formed and the new supports resolve by name", () => {
  for (const prop of allProps()) assert.equal(propProblem(prop), null, prop.kind);
  assert.equal(resolveSurface("exercise ball").id, "ball");
  assert.equal(resolveSurface("wedge cushion").id, "wedge");
  assert.equal(resolveSurface("car seat").id, "car_seat");
  assert.equal(SURFACES.ball.height, propTopAt(ball, 0, 0));
  assert.equal(SURFACES.wedge.height, propTopAt(wedge, 0, -0.3));
});

test("a ball's distance and top follow the sphere, not its bounding box", () => {
  const above = propDistance(ball, [0, 0.75, 0]);
  close(above.distance, 0.1);
  assert.deepEqual(above.normal, [0, 1, 0]);
  close(propDistance(ball, ball.center).distance, -0.325);
  // A corner of the bounds is well outside the ball.
  const corner = [0.3, 0.62, 0.3];
  assert.ok(propDistance(ball, corner).distance > 0.15);
  assert.equal(propContains(ball, corner), false);
  assert.equal(propContains(ball, [0, 0.6, 0]), true);
  close(propTopAt(ball, 0.2, 0), 0.325 + Math.sqrt(0.325 ** 2 - 0.04));
  assert.equal(propTopAt(ball, 0.3, 0.3), null);
});

test("a wedge's surface slopes from its tall end down to nothing", () => {
  for (const z of [-0.3, -0.1, 0, 0.2, 0.3]) close(propTopAt(wedge, 0.1, z), wedgeTop(z));
  assert.equal(propTopAt(wedge, 0.31, 0), null);
  assert.equal(propTopAt(wedge, 0, 0.31), null);
  // Over the slope, measured square to it.
  const over = propDistance(wedge, [0, wedgeTop(0) + 0.05, 0]);
  close(over.distance, (0.05 * 0.6) / slope);
  close(over.normal[1], 0.6 / slope);
  close(over.normal[2], 0.18 / slope);
  // Inside its bounds but above the slope is outside the wedge.
  const point = [0, 0.15, 0.2];
  assert.ok(point.every((n, k) => n > propBox(wedge).min[k] && n < propBox(wedge).max[k]));
  assert.equal(propContains(wedge, point), false);
  assert.equal(propContains(wedge, [0, 0.05, 0]), true);
  // Past a side face, and past both a side and the slope.
  const side = propDistance(wedge, [0.4, 0.05, 0]);
  close(side.distance, 0.1);
  assert.deepEqual(side.normal, [1, 0, 0]);
  close(propDistance(wedge, [0.4, wedgeTop(0) + 0.05, 0]).distance, Math.hypot(0.1, (0.05 * 0.6) / slope));
});

test("a raked backrest is as high as its highest edge over each position", () => {
  // Level at the top, and on the reclined front face lower down.
  close(propTopAt(backrest, 0, -0.51), 0.97);
  close(propTopAt(backrest, 0, -0.31), 0.485 - 0.085 + 0.57 * 0.3);
  // The vertical front face rises to the cushion top.
  close(propTopAt(backrest, 0, -0.25), 0.4);
  assert.equal(propTopAt(backrest, 0, -0.2), null);
});

test("prop meshes are closed and wound outward, so they enclose the shape's volume", () => {
  close(signedVolume(propTriangles(wedge)), 0.6 * 0.6 * 0.18 / 2);
  close(signedVolume(propTriangles(backrest)), 1.4 * profileArea(backrest.profile));
  const bed = SURFACES.bed.props[0];
  close(signedVolume(propTriangles(bed)), bed.size.reduce((a, b) => a * b));
  // A faceted ball is a little smaller than the true one.
  const sphere = (4 / 3) * Math.PI * 0.325 ** 3;
  const faceted = signedVolume(propTriangles(ball));
  assert.ok(faceted < sphere && faceted > 0.97 * sphere, `${faceted} vs ${sphere}`);
});

test("outlines trace the hard edges on the surface, or three great circles on a ball", () => {
  const onSurface = (prop, segments) => {
    for (const segment of segments) for (const point of segment) assert.ok(Math.abs(propDistance(prop, point).distance) < 1e-9, prop.kind);
  };
  assert.equal(propOutline(wedge).length, 9);
  onSurface(wedge, propOutline(wedge));
  assert.equal(propOutline(SURFACES.table.props[0]).length, 12);
  assert.equal(propOutline(ball).length, 72);
  onSurface(ball, propOutline(ball));
});

test("malformed props are named rather than drawn or collided with", () => {
  const box = { kind: "box", size: [1, 1, 1], center: [0, 0.5, 0] };
  assert.equal(propProblem({ ...wedge, profile: [...wedge.profile].reverse() }), "profile is not convex and counter-clockwise");
  assert.equal(propProblem({ ...wedge, size: [0.6, 0.3, 0.6] }), "profile does not fill its bounds");
  assert.equal(propProblem({ ...wedge, profile: wedge.profile.slice(0, 2) }), "profile");
  assert.equal(propProblem({ ...ball, size: [0.65, 0.6, 0.65] }), "sphere bounds");
  assert.equal(propProblem({ ...box, shape: "cone" }), "unknown shape cone");
  assert.equal(propProblem({ ...box, profile: wedge.profile }), "box with a profile");
  assert.equal(propProblem({ ...box, size: [1, 0, 1] }), "bounds");
  assert.equal(measurePropSurface(skin([[0, 1, 0], [0.1, 1, 0], [0, 1, 0.1]], [0, 0, 0]), { ...ball, size: [0.65, 0.6, 0.65] }), null);
});

test("props leave the solver with their shape, and boxes as they always were", () => {
  assert.deepEqual(propData(ball), { kind: "ball", size: ball.size, center: ball.center, shape: "sphere" });
  assert.deepEqual(propData(wedge), { kind: "wedge", size: wedge.size, center: wedge.center, shape: "prism", profile: wedge.profile });
  const bed = SURFACES.bed.props[0];
  assert.deepEqual(propData(bed), bed);
});

test("a limb beside a ball or over a wedge's slope does not collide with the box around it", () => {
  const limb = (a, b, r = 0.03) => ({ a, b, ra: r, rb: r });
  const corner = limb([0.28, 0.6, 0.28], [0.28, 0.6, 0.2]);
  assert.ok(capsuleBoxContact(corner, ball.box));
  assert.equal(capsulePropContact(corner, ball), null);
  // Sunk 1 cm into the crest: the full radius plus that, pushed straight up.
  const sunk = capsulePropContact(limb([-0.1, 0.64, 0], [0.1, 0.64, 0], 0.05), ball);
  close(sunk.depth, 0.06);
  assert.deepEqual(sunk.normal, [0, 1, 0]);
  // Lying along the slope, 1 cm clear of it and then 1 cm into it.
  const along = (gap) => limb([0, wedgeTop(-0.2) + ((0.03 + gap) * slope) / 0.6, -0.2], [0, wedgeTop(0.2) + ((0.03 + gap) * slope) / 0.6, 0.2]);
  assert.ok(capsuleBoxContact(along(0.01), wedge.box));
  assert.equal(capsulePropContact(along(0.01), wedge), null);
  const into = capsulePropContact(along(-0.01), wedge);
  close(into.depth, 0.01);
  close(into.normal[2], 0.18 / slope);
  // A box prop still collides as a box.
  const bed = withBounds(SURFACES.bed.props[0]);
  const onBed = limb([0, 0.56, 0], [0.2, 0.56, 0]);
  assert.deepEqual(capsulePropContact(onBed, bed), capsuleBoxContact(onBed, bed.box));
});

test("complete-figure checks read the ball's own surface", () => {
  // Inside the ball's bounds at a corner, facing it: clear.
  const corner = measurePropSurface(skin([[0.28, 0.6, 0.26], [0.26, 0.61, 0.3], [0.3, 0.58, 0.3]], ball.center), ball);
  assert.equal(corner.intersects, false);
  assert.ok(corner.distance > 0.1);
  // Wholly inside the ball.
  const inside = measurePropSurface(skin([[0, 0.4, 0], [0.05, 0.4, 0], [0, 0.4, 0.05]], [0, 0, 0]), ball);
  assert.equal(inside.intersects, true);
  assert.equal(inside.reason, "interior_vertex");
});

test("support on a wedge or a ball is measured against the surface under it", () => {
  const onWedge = resolveSurface("wedge");
  const lying = { landmark: "buttocks" };
  // A patch 4 mm above the slope, parallel to it.
  const patch = skin(
    [
      [-0.05, wedgeTop(-0.05) + 0.004, -0.05],
      [0.05, wedgeTop(-0.05) + 0.004, -0.05],
      [0, wedgeTop(0.05) + 0.004, 0.05],
    ],
    [0, 0, 0],
  );
  const measured = measureSurfaceSupport(patch, lying, onWedge);
  close(measured.gap, 0.004);
  assert.equal(measured.penetration, 0);
  assert.equal(measured.prop, "wedge");
  close(measured.target[1], wedgeTop(measured.target[2]));
  const bounds = measureSupportContactBounds(patch, lying, onWedge);
  close(bounds.min[0], -0.05);
  close(bounds.max[1], 0.05);
  // Seated on the crest of the ball, measured at the patch's vertices: the
  // deepest is the one nearest the crest.
  const seat = skin(
    [
      [-0.05, 0.64, -0.05],
      [0.05, 0.64, -0.05],
      [0, 0.64, 0.05],
    ],
    [0, 0, 0],
  );
  const sitting = measureSurfaceSupport(seat, lying, resolveSurface("ball"));
  close(sitting.penetration, propTopAt(ball, 0, 0.05) - 0.64);
  assert.equal(sitting.withinFootprint, true);
  // The feet go to the floor beside it, not to its crest.
  assert.equal(measureSurfaceSupport(seat, { landmark: "foot", side: "l" }, resolveSurface("ball")).prop, null);
});

test("rendered balls and wedges are the solver's shapes, drawn in place", () => {
  const group = buildProps([ball, wedge, SURFACES.bed.props[0]], { ground: false });
  const [sphere, prism, box] = group.children;
  assert.equal(sphere.userData.shape, "sphere");
  assert.equal(prism.userData.shape, "prism");
  assert.deepEqual(prism.userData.edges, propOutline(wedge));
  assert.equal(box.userData.shape, "box");
  assert.deepEqual(box.position.toArray(), SURFACES.bed.props[0].center);
  // Built in world space: the mesh stays at the origin and its bounds are the prop's.
  for (const [mesh, prop] of [
    [sphere, ball],
    [prism, wedge],
  ]) {
    assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
    mesh.geometry.computeBoundingBox();
    const { min, max } = propBox(prop);
    mesh.geometry.boundingBox.min.toArray().forEach((n, k) => close(n, min[k], 1e-6));
    mesh.geometry.boundingBox.max.toArray().forEach((n, k) => close(n, max[k], 1e-6));
  }
});
