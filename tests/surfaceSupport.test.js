import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildTriangleTree } from "../src/core/meshDistance.js";
import {
  measureSurfaceSupport,
  measureSupportContactBounds,
} from "../src/core/surfaceSupport.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { POSEABLE_BONES } from "../src/core/skeleton.js";
import {
  createSurfaceContactQuery,
  refineSurfaceContacts,
  surfaceContactSteps,
} from "../src/core/surfaceContacts.js";
import { solvedPreview } from "../src/core/posePreview.js";

const triangle = (points) =>
  buildTriangleTree([{ positions: points.flat(), indices: [0, 1, 2] }]);
const plane = (height, x = 0) =>
  triangle([
    [x - 0.1, height, -0.1],
    [x + 0.1, height, -0.1],
    [x, height, 0.1],
  ]);
const seat = { landmark: "buttocks" },
  foot = { landmark: "foot", side: "l" };
const chair = {
  height: 1,
  ground: 0,
  props: [{ kind: "chair", center: [0, 0.5, 0], size: [1, 1, 1] }],
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("rendered support uses the seat top or foot's ground plane, not one shared height", () => {
  const seated = measureSurfaceSupport(plane(1.012), seat, chair);
  close(seated.gap, 0.012);
  assert.equal(seated.penetration, 0);
  assert.equal(seated.prop, "chair");
  const standing = measureSurfaceSupport(plane(0.004), foot, chair);
  close(standing.gap, 0.004);
  assert.equal(standing.plane, 0);
  assert.equal(standing.prop, null);
});

test("clipped triangle edges define furniture support, and crossings retain their penetration", () => {
  const ramp = triangle([
    [-1, 0, -1],
    [1, 1, -1],
    [0, 0.5, 1],
  ]);
  const result = measureSurfaceSupport(ramp, seat, chair);
  close(result.penetration, 0.75);
  close(result.gap, 0.75);
  const crossing = triangle([
    [-0.1, 0.9, 0],
    [0.1, 1.1, 0],
    [0, 1.1, 0.1],
  ]);
  close(measureSurfaceSupport(crossing, seat, chair).penetration, 0.1);
  close(measureSurfaceSupport(plane(-0.2), foot, chair).penetration, 0.2);
});

test("furniture footprints are finite and multiple matching tops select the nearest real support", () => {
  const edge = triangle([
    [1, 1, -0.1],
    [1.2, 1, -0.1],
    [1, 1, 0.1],
  ]);
  close(measureSurfaceSupport(edge, seat, chair).gap, 0.5);
  const two = {
    ...chair,
    props: [
      ...chair.props,
      { kind: "second-seat", center: [3, 0.5, 0], size: [1, 1, 1] },
    ],
  };
  const result = measureSurfaceSupport(plane(1.01, 3), seat, two);
  close(result.gap, 0.01);
  assert.equal(result.prop, "second-seat");
  const mixed = buildTriangleTree([
    {
      positions: [-0.1, 1.005, -0.1, 0.1, 1.005, -0.1, 0, 1.005, 0.1],
      indices: [0, 1, 2],
    },
    {
      positions: [2.9, 0.8, -0.1, 3.1, 0.8, -0.1, 3, 0.8, 0.1],
      indices: [0, 1, 2],
    },
  ]);
  close(measureSurfaceSupport(mixed, seat, two).penetration, 0.2);
});

test("missing or invalid support geometry remains unavailable", () => {
  assert.equal(measureSurfaceSupport(null, seat, chair), null);
  assert.equal(
    measureSurfaceSupport(plane(1), seat, { height: 1, ground: 0, props: [] }),
    null,
  );
  assert.equal(
    measureSurfaceSupport(plane(1), seat, {
      ...chair,
      props: [{ center: [0, NaN, 0], size: [1, 1, 1] }],
    }),
    null,
  );
  assert.equal(
    measureSurfaceSupport(plane(1), seat, { height: NaN, ground: 0 }),
    null,
  );
});

test("rendered contact bounds clip both the furniture footprint and the proximity band", () => {
  const patch = triangle([
    [-1, 0.9, -1],
    [1, 1.1, -1],
    [0, 1, 1],
  ]);
  const bounds = measureSupportContactBounds(patch, seat, chair);
  close(bounds.min[0], -0.3);
  close(bounds.max[0], 0.3);
  close(bounds.min[1], -0.5);
  close(bounds.max[1], 0.5);
  const floor = measureSupportContactBounds(plane(0.01), foot, chair);
  assert.deepEqual(floor, { min: [-0.1, -0.1], max: [0.1, 0.1] });
});

test("measured absence of near contact stays distinct from unavailable balance geometry", () => {
  assert.deepEqual(measureSupportContactBounds(plane(1.1), seat, chair), {
    min: null,
    max: null,
  });
  assert.deepEqual(measureSupportContactBounds(plane(0.8), seat, chair), {
    min: null,
    max: null,
  });
  assert.deepEqual(measureSupportContactBounds(plane(1, 2), seat, chair), {
    min: null,
    max: null,
  });
  assert.equal(measureSupportContactBounds(null, seat, chair), null);
  assert.equal(
    measureSupportContactBounds(plane(1), seat, {
      ...chair,
      props: [{ center: [0, NaN, 0], size: [1, 1, 1] }],
    }),
    null,
  );
});

let template;
function dressed() {
  return (template ??= withGarments(
    featureRelief(
      buildHumanTemplate(
        readFileSync(
          new URL("../assets/models/realistic-male.glb", import.meta.url),
        ),
      ),
      { bodyType: "male", build: 1, bust: 0 },
    ),
    { bodyType: "male", wearing: ["top", "shorts"] },
  ));
}
function floatingSeat() {
  const joints = Object.fromEntries(
    POSEABLE_BONES.map(({ name }) => [
      name,
      { flexion: 0, abduction: 0, rotation: 0 },
    ]),
  );
  for (const side of ["l", "r"])
    Object.assign(joints, {
      [`hip_${side}`]: { flexion: 86, abduction: 9, rotation: 0 },
      [`knee_${side}`]: { flexion: 88, abduction: 0, rotation: 0 },
      [`ankle_${side}`]: { flexion: -17, abduction: 0, rotation: 0 },
      [`toe_${side}`]: { flexion: -5, abduction: 0, rotation: 0 },
      [`shoulder_${side}`]: { flexion: 10, abduction: 12, rotation: 0 },
      [`elbow_${side}`]: { flexion: 26, abduction: 0, rotation: 0 },
    });
  for (const bone of ["spine01", "spine02", "spine03"])
    joints[bone].flexion = 2;
  return solveScene(
    checkScene({
      actors: [
        {
          bodyType: "male",
          posture: "seated",
          wearing: ["top", "shorts"],
          jointMode: "fixed",
          joints,
          placement: { position: [0, 0.653, 0.198], rotation: [18.6, 0, 0] },
        },
      ],
      support: { surface: "chair" },
      relationship: { contactMode: "custom" },
      contacts: [],
    }),
  );
}

test("a dressed seat gap replaces a misleading coarse residual without moving the fixed rig", () => {
  const solved = floatingSeat(),
    actor = solved.actors[0],
    before = structuredClone(actor.pose),
    coarse = actor.seatResidual;
  assert.ok(
    coarse < 0.02,
    "fixture must have an apparently grounded coarse model",
  );
  refineSurfaceContacts(solved, [dressed()]);
  assert.equal(actor.supportMeasurement, "rendered");
  assert.equal(actor.bodySupportResidual, coarse);
  assert.ok(actor.seatResidual > 0.05);
  assert.deepEqual(actor.pose, before);
  const result = solved.quality.supportSurfaces[0];
  assert.equal(result.unavailable, 0);
  assert.ok(
    result.supports.find((s) => s.landmark === "buttocks").measurement.gap >
      0.05,
  );
  assert.ok(solvedPreview(solved).issues.includes("Support gap"));
  const measured = actor.seatResidual;
  refineSurfaceContacts(solved, [dressed()]);
  close(actor.seatResidual, measured);
  assert.equal(actor.bodySupportResidual, coarse);
  refineSurfaceContacts(solved, [null]);
  assert.equal(actor.supportMeasurement, "body-model");
  assert.equal(actor.seatResidual, coarse);
  assert.equal(solved.quality.supportSurfaces[0].unavailable, 3);
  assert.ok(solvedPreview(solved).issues.includes("Support check unavailable"));
});

test("nonfinite support patches cannot certify a partial surface, and cancellation preserves previous reports", () => {
  const solved = floatingSeat(),
    source = dressed();
  const invalid = {
    ...source,
    submeshes: source.submeshes.map((part) =>
      part.garment
        ? {
            ...part,
            positions: new Float32Array(part.positions.length).fill(NaN),
          }
        : part,
    ),
  };
  assert.equal(
    createSurfaceContactQuery(solved.actors, [invalid]).support(
      0,
      seat,
      solved.surface,
    ),
    null,
  );
  refineSurfaceContacts(solved, [source]);
  const before = structuredClone(solved.quality),
    actor = solved.actors[0],
    gap = actor.seatResidual;
  const steps = surfaceContactSteps(solved, [null]);
  steps.next();
  steps.return();
  assert.deepEqual(solved.quality, before);
  assert.equal(actor.seatResidual, gap);
  assert.equal(actor.supportMeasurement, "rendered");
});

test("buried rendered supports report penetration rather than zero-distance success or a floating gap", () => {
  const actor = floatingSeat().actors[0];
  const spec = structuredClone(actor.spec);
  spec.placement.position[1] -= 0.2;
  const solved = solveScene(
    checkScene({ actors: [spec], support: { surface: "chair" } }),
  );
  refineSurfaceContacts(solved, [dressed()]);
  assert.ok(solved.actors[0].supportPenetration > 0.15);
  assert.equal(solved.actors[0].supportMeasurement, "rendered");
  assert.ok(solvedPreview(solved).issues.includes("Support overlap"));
  assert.ok(!solvedPreview(solved).issues.includes("Support gap"));
});
