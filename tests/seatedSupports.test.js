import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene, refresh } from "../src/core/solver.js";
import { captureSolvedPose } from "../src/core/placement.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import {
  createSurfaceContactQuery,
  measureRenderedSupports,
  refineSurfaceContacts,
  surfaceContactSteps,
} from "../src/core/surfaceContacts.js";
import {
  seatedSupportFrame,
  seatedSupportPoses,
  seatedFramePreserved,
  SEATED_ROOT_LIMIT,
  SEATED_HORIZONTAL_LIMIT,
} from "../src/core/seatedSupports.js";
import { solvedPreview } from "../src/core/posePreview.js";

const raw = new Map(),
  dressed = new Map();
function template(actor) {
  const { bodyType, build, bust, wearing, outfit, hair } = actor.spec;
  if (!raw.has(bodyType))
    raw.set(
      bodyType,
      buildHumanTemplate(
        readFileSync(
          new URL(
            `../assets/models/realistic-${bodyType}.glb`,
            import.meta.url,
          ),
        ),
      ),
    );
  const key = JSON.stringify([bodyType, build, bust, wearing, outfit, hair]);
  if (!dressed.has(key))
    dressed.set(
      key,
      withHair(
        withGarments(
          featureRelief(raw.get(bodyType), { bodyType, build, bust }),
          { bodyType, wearing, colour: outfit },
        ),
        { bodyType, style: hair },
      ),
    );
  return dressed.get(key);
}
const scene = (type = "male") =>
  structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === `builtin.seated-${type}`).scene,
  );
const prepare = (spec) => {
  const solved = solveScene(checkScene(spec));
  return { solved, bodies: solved.actors.map(template) };
};
const poses = (solved) => structuredClone(solved.actors.map((a) => a.pose));

test("both clothed seated studies meet the visible seat and floor with clear complete furniture surfaces", () => {
  for (const type of ["male", "female"]) {
    const spec = scene(type),
      original = structuredClone(spec),
      { solved, bodies } = prepare(spec),
      actor = solved.actors[0];
    const before = measureRenderedSupports(
      solved,
      createSurfaceContactQuery(solved.actors, bodies),
    )[0];
    const frame = seatedSupportFrame(actor, solved.surface, before),
      upper = structuredClone(actor.pose.joints.shoulder_l);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.ok(actor.seatResidual <= 0.004);
    assert.ok(seatedFramePreserved(actor, frame));
    assert.deepEqual(actor.pose.joints.shoulder_l, upper);
    assert.ok(solved.quality.balance[0].supported);
    assert.equal(solved.quality.propPenetration, 0);
    assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
    assert.equal(solved.quality.propSurfaces.length, 2);
    assert.ok(solved.quality.surfaceRefinement.seatingSteps <= 8);
    if (before.gap > 0.004)
      assert.ok(solved.quality.surfaceRefinement.seatingSteps > 0);
    assert.ok(solved.quality.verifiedPropContacts > 0);
    assert.ok(solved.quality.proxyPropPenetration > 0.05);
    assert.ok(
      actor.bodySupportResidual > 0.05,
      "raw coarse discrepancy stays measurable",
    );
    assert.deepEqual(spec, original);
  }
});

test("seated grounding follows the support contract across sizes, builds and chair/bench surfaces", () => {
  for (const type of ["female", "male"])
    for (const [stature, build] of [
      [1.55, 0.9],
      [1.9, 1.1],
    ])
      for (const surface of ["chair", "bench"]) {
        const spec = scene(type);
        spec.actors[0].stature = stature;
        spec.actors[0].build = build;
        spec.actors[0].id = "custom-study";
        spec.support.surface = surface;
        const { solved, bodies } = prepare(spec),
          before = poses(solved);
        refineSurfaceContacts(solved, bodies);
        assert.deepEqual(
          solvedPreview(solved).issues,
          [],
          `${type}/${stature}/${surface}`,
        );
        assert.ok(solved.actors[0].seatResidual <= 0.004);
        assert.ok(
          Math.abs(
            solved.actors[0].pose.root.position[1] - before[0].root.position[1],
          ) <= SEATED_ROOT_LIMIT,
        );
        assert.ok(
          Math.hypot(
            ...[0, 2].map(
              (axis) =>
                solved.actors[0].pose.root.position[axis] -
                before[0].root.position[axis],
            ),
          ) <= SEATED_HORIZONTAL_LIMIT,
        );
        assert.ok(
          solved.quality.propSurfaces.every((p) => p.intersects === false),
        );
      }
});

test("fixed placement, zero mobility and fixed leg channels preserve authored seated rigs", () => {
  for (const mode of ["placement", "mobility", "joint"]) {
    const spec = scene();
    if (mode === "placement")
      Object.assign(
        spec.actors[0],
        captureSolvedPose(solveScene(spec).actors[0]),
      );
    if (mode === "mobility") spec.actors[0].mobility = 0;
    if (mode === "joint") {
      spec.actors[0].jointMode = "fixed";
      spec.actors[0].joints = { ankle_l: { flexion: -17 } };
    }
    const { solved, bodies } = prepare(spec),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(poses(solved), before, mode);
    assert.equal(solved.quality.surfaceRefinement.seatingSteps, 0);
    assert.ok(solvedPreview(solved).issues.includes("Support gap"));
  }
});

test("captured corrected seating survives reload, while missing meshes cannot reconcile coarse furniture overlap", () => {
  const spec = scene(),
    { solved, bodies } = prepare(spec);
  refineSurfaceContacts(solved, bodies);
  Object.assign(spec.actors[0], captureSolvedPose(solved.actors[0]));
  const restored = solveScene(checkScene(JSON.parse(JSON.stringify(spec))));
  refineSurfaceContacts(restored, bodies);
  assert.deepEqual(solvedPreview(restored).issues, []);
  assert.equal(restored.quality.surfaceRefinement.seatingSteps, 0);
  const before = poses(restored);
  refineSurfaceContacts(restored, [null]);
  assert.deepEqual(poses(restored), before);
  assert.ok(
    solvedPreview(restored).issues.includes("Furniture check unavailable"),
  );
  assert.ok(restored.quality.propPenetration > 0.05);
  assert.equal(restored.quality.verifiedPropContacts, 0);
  assert.equal(
    restored.quality.propPenetration,
    restored.quality.proxyPropPenetration,
  );
});

test("a new furniture crossing rejects every seating candidate without moving the pose", () => {
  const { solved, bodies } = prepare(scene());
  const prop = {
    kind: "obstacle",
    center: [0, 0.515, 0.2],
    size: [0.5, 0.03, 0.3],
  };
  prop.box = {
    min: prop.center.map((n, i) => n - prop.size[i] / 2),
    max: prop.center.map((n, i) => n + prop.size[i] / 2),
  };
  solved.props.push(prop);
  const before = poses(solved);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(poses(solved), before);
  assert.ok(solved.quality.surfaceRefinement.seatingSteps > 0);
  assert.ok(solved.actors[0].seatResidual > 0.05);
});

test("cancelling an accepted seated candidate restores the original rig and unpublished reports", () => {
  const { solved, bodies } = prepare(scene()),
    before = poses(solved),
    quality = structuredClone(solved.quality),
    gap = solved.actors[0].seatResidual;
  const steps = surfaceContactSteps(solved, bodies);
  let result;
  do {
    result = steps.next();
    assert.equal(result.done, false);
  } while (!result.value.seatingSteps);
  assert.notDeepEqual(
    poses(solved),
    before,
    "fixture must reach an accepted intermediate adjustment",
  );
  steps.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
  assert.equal(solved.actors[0].seatResidual, gap);
});

test("seating respects the shared budget and becomes idempotent after convergence", () => {
  const limited = prepare(scene()),
    before = poses(limited.solved);
  refineSurfaceContacts(limited.solved, limited.bodies, { maxSeatingSteps: 0 });
  assert.deepEqual(poses(limited.solved), before);
  const one = prepare(scene());
  refineSurfaceContacts(one.solved, one.bodies, { maxSteps: 1 });
  assert.equal(one.solved.quality.surfaceRefinement.steps, 1);
  assert.equal(one.solved.quality.surfaceRefinement.seatingSteps, 1);
  const complete = prepare(scene());
  refineSurfaceContacts(complete.solved, complete.bodies);
  const stable = poses(complete.solved);
  refineSurfaceContacts(complete.solved, complete.bodies);
  assert.deepEqual(poses(complete.solved), stable);
  assert.equal(complete.solved.quality.surfaceRefinement.seatingSteps, 0);
});

test("a visible auxiliary part below the proposed floor blocks seating even outside the chair footprint", () => {
  const { solved, bodies } = prepare(scene()),
    before = poses(solved),
    rig = raw.get("male");
  const joint = rig.jointByBone.get("pelvis"),
    p = [joint.rest[12] + 0.5, joint.rest[13] - 0.36, joint.rest[14]];
  const joints = new Uint16Array(12),
    weights = new Float32Array(12);
  for (let i = 0; i < 3; i++) {
    joints[i * 4] = joint.index;
    weights[i * 4] = 1;
  }
  const accessory = {
    name: "floor guard fixture",
    primary: false,
    colour: [0.2, 0.3, 0.4],
    positions: new Float32Array([
      p[0] - 0.005,
      p[1],
      p[2] - 0.005,
      p[0] + 0.005,
      p[1],
      p[2] - 0.005,
      p[0],
      p[1],
      p[2] + 0.005,
    ]),
    normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    joints,
    weights,
  };
  const extra = [
    { ...bodies[0], submeshes: [...bodies[0].submeshes, accessory] },
  ];
  const height = () =>
    createSurfaceContactQuery(solved.actors, [
      { ...bodies[0], submeshes: [accessory] },
    ]).lowest(0);
  // Place the synthetic attachment 30 mm above the floor in the actual bind
  // mapping, rather than assuming the model's bind units equal world metres.
  const initialHeight = height();
  for (let i = 1; i < accessory.positions.length; i += 3)
    accessory.positions[i] += 0.01;
  const movedHeight = height(),
    slope = (movedHeight - initialHeight) / 0.01;
  assert.ok(Number.isFinite(slope) && Math.abs(slope) > 0.1);
  for (let i = 1; i < accessory.positions.length; i += 3)
    accessory.positions[i] += (0.03 - movedHeight) / slope;
  const accessoryHeight = height();
  assert.ok(
    accessoryHeight > 0 && accessoryHeight < 0.065,
    "accessory must begin just above the floor",
  );
  refineSurfaceContacts(solved, extra);
  assert.deepEqual(poses(solved), before);
  assert.ok(solved.quality.surfaceRefinement.seatingSteps > 0);
});

test("explicit root and foot-frame bounds reject cumulative drift", () => {
  const { solved, bodies } = prepare(scene()),
    actor = solved.actors[0];
  const report = measureRenderedSupports(
      solved,
      createSurfaceContactQuery(solved.actors, bodies),
    )[0],
    frame = seatedSupportFrame(actor, solved.surface, report);
  refineSurfaceContacts(solved, bodies);
  assert.ok(seatedFramePreserved(actor, frame));
  const settled = structuredClone(actor.pose.root);
  actor.pose.root.position[1] =
    frame.root.position[1] - SEATED_ROOT_LIMIT - 0.001;
  assert.equal(seatedFramePreserved(actor, frame), false);
  actor.pose.root.position[1] = frame.root.position[1];
  actor.pose.root.position[0] += SEATED_HORIZONTAL_LIMIT + 0.001;
  assert.equal(seatedFramePreserved(actor, frame), false);
  actor.pose.root = settled;
  const index = actor.skeleton.boneIndex("ankle_l"),
    matrix = actor.evaluated.matrices[index];
  actor.evaluated.matrices[index] = matrix.slice();
  actor.evaluated.matrices[index][12] += 0.001;
  assert.equal(seatedFramePreserved(actor, frame), false);
  actor.evaluated.matrices[index] = matrix.slice();
  actor.evaluated.matrices[index][0] += 0.001;
  assert.equal(seatedFramePreserved(actor, frame), false);
  actor.evaluated.matrices[index] = matrix;
});

test("seating cannot move a hand away from an already close partner contact", () => {
  const spec = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.helping-hand").scene,
  );
  spec.actors[0].posture = "seated";
  spec.support.surface = "chair";
  const { solved, bodies } = prepare(spec);
  refineSurfaceContacts(solved, bodies, { maxSeatingSteps: 0 });
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
  const before = poses(solved),
    actor = solved.actors[0],
    query = createSurfaceContactQuery(solved.actors, bodies);
  const support = measureRenderedSupports(solved, query)[0],
    frame = seatedSupportFrame(actor, solved.surface, support);
  const trials = seatedSupportPoses(actor, support, frame),
    trial = trials.next();
  trials.return();
  assert.ok(trial.value);
  actor.pose = trial.value;
  refresh(actor);
  const missed = query(solved.contacts[0]);
  assert.ok(
    missed.intersects || missed.distance > 0.004,
    "unprotected seat move must demonstrate the broken hand contact",
  );
  actor.pose = structuredClone(before[0]);
  refresh(actor);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(poses(solved), before);
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
});
