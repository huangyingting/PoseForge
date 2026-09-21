import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import {
  solveScene,
  refresh,
  measureSceneSafety,
  measureContactTargets,
} from "../src/core/solver.js";
import {
  createSurfaceContactQuery,
  measureSurfaceSafety,
  refineSurfaceContacts,
  surfaceContactSteps,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";

const templates = new Map(
  ["male", "female"].map((type) => [
    type,
    withGarments(
      featureRelief(
        buildHumanTemplate(
          readFileSync(
            new URL(`../assets/models/realistic-${type}.glb`, import.meta.url),
          ),
        ),
        { bodyType: type, build: 1 },
      ),
      { bodyType: type, wearing: ["top", "shorts"] },
    ),
  ]),
);
const base = () =>
  structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.helping-hand").scene,
  );
const forScene = (solved) =>
  solved.actors.map((actor) => templates.get(actor.bodyType));
const poses = (solved) =>
  structuredClone(solved.actors.map((actor) => actor.pose));

test("body-model reports are remeasured consistently on the returned pose", () => {
  const solved = solveScene(checkScene(base()));
  const measured = measureContactTargets(solved);
  solved.quality.contactDetail.forEach((report, index) =>
    assert.ok(Math.abs(report.distance - measured[index]) < 1e-9),
  );
});

test("fixed joint channels survive rendered refinement and cancellation", () => {
  const spec = base();
  spec.actors[0].jointMode = "fixed";
  spec.actors[0].joints = {
    shoulder_r: { abduction: 12 },
    elbow_r: { flexion: 45 },
  };
  const solved = solveScene(checkScene(spec)),
    bodies = forScene(solved);
  refineSurfaceContacts(solved, bodies);
  assert.equal(solved.actors[0].pose.joints.shoulder_r.abduction, 12);
  assert.equal(solved.actors[0].pose.joints.elbow_r.flexion, 45);
  const before = poses(solved),
    steps = surfaceContactSteps(solved, bodies);
  steps.next();
  steps.next();
  steps.return();
  assert.deepEqual(poses(solved), before);
});

test("intersecting hands escape the target surface without moving a seated support or adding collisions", () => {
  const spec = checkScene({
    support: { surface: "chair" },
    relationship: { arrangement: "straddle_lap" },
    actors: [
      { bodyType: "male", posture: "seated", wearing: ["top", "shorts"] },
      {
        bodyType: "female",
        posture: "seated_straddle",
        wearing: ["top", "shorts"],
      },
    ],
    contacts: [],
  });
  const solved = solveScene(spec),
    bodies = forScene(solved);
  const initialPoses = poses(solved);
  const initial = measureSurfaceSafety(
    solved,
    createSurfaceContactQuery(solved.actors, bodies),
  );
  assert.deepEqual(
    initial.limbIntersections,
    [true, true],
    "fixture must begin with crossed surfaces",
  );
  refineSurfaceContacts(solved, bodies);
  const hands = solved.quality.contactDetail.filter(
    (contact) => contact.from === "hand",
  );
  assert.equal(hands.length, 2);
  for (const hand of hands) {
    assert.equal(hand.intersects, false);
    assert.ok(
      hand.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
      `${hand.surfaceGap} hand gap`,
    );
  }
  assert.deepEqual(solved.quality.limbIntersections, [false, false]);
  assert.ok(
    solved.quality.surfaceRefinement.steps <= 32,
    "default work budget must be sufficient",
  );
  for (const key of [
    "maxDepth",
    "maxSelfDepth",
    "maxBodyDepth",
    "propPenetration",
    "totalDepth",
  ])
    assert.ok(solved.quality[key] <= initial[key] + 1e-8, key);
  const originalViolations = new Map(
    initial.violations.map((v) => [v.key, v.depth]),
  );
  assert.ok(
    solved.quality.violations.every(
      (v) => v.depth <= (originalViolations.get(v.key) ?? 0) + 1e-8,
    ),
  );
  assert.deepEqual(
    solved.actors[0].pose,
    initialPoses[0],
    "supporting figure moved",
  );
  solved.actors.forEach((actor, index) =>
    assert.deepEqual(actor.pose.root, initialPoses[index].root),
  );
  for (const joint of [
    "hip_l",
    "hip_r",
    "knee_l",
    "knee_r",
    "ankle_l",
    "ankle_r",
  ])
    assert.deepEqual(
      solved.actors[1].pose.joints[joint],
      initialPoses[1].joints[joint],
    );
});

test("rendered hand-to-forearm distance closes without added collisions or source-template mutations", () => {
  const solved = solveScene(checkScene(base())),
    bodies = forScene(solved);
  const beforePose = poses(solved),
    before = measureSceneSafety(solved);
  const sample = bodies[0].submeshes[0].positions.slice();
  refineSurfaceContacts(solved, bodies);
  const report = solved.quality.contactDetail[0];
  assert.ok(
    report.beforeSurfaceGap > 0.012,
    "fixture must demonstrate the original visible gap",
  );
  assert.ok(
    report.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
    `${report.surfaceGap} remains`,
  );
  assert.equal(report.basis, "rendered");
  assert.equal(report.intersects, false);
  assert.notDeepEqual(poses(solved), beforePose, "the rig itself must move");
  for (const key of [
    "maxDepth",
    "maxSelfDepth",
    "maxBodyDepth",
    "totalDepth",
    "propPenetration",
  ])
    assert.ok(solved.quality[key] <= before[key] + 1e-8, key);
  assert.deepEqual(
    bodies[0].submeshes[0].positions,
    sample,
    "cached geometry must stay immutable",
  );
  assert.ok(
    Math.abs(
      createSurfaceContactQuery(solved.actors, bodies)(solved.contacts[0])
        .distance - report.surfaceGap,
    ) < 1e-9,
  );
  assert.ok(
    report.targetDistance > report.surfaceGap,
    "target error and actual surface gap are distinct",
  );
});

test("missing meshes produce explicit estimates and do not move the pose", () => {
  const solved = solveScene(checkScene(base())),
    before = poses(solved);
  refineSurfaceContacts(solved, [null, templates.get("male")]);
  assert.deepEqual(poses(solved), before);
  const report = solved.quality.contactDetail[0];
  assert.equal(report.basis, "body-model");
  assert.equal(report.surfaceGap, null);
  assert.equal(report.reason, "surface_unavailable");
  assert.ok(Number.isFinite(report.distance));
});

test("supporting limbs, zero-strength contacts and authored wrists retain their constraints", () => {
  const scene = base();
  scene.contacts[0].from = "foot.r";
  scene.contacts[0].to = "hand.l";
  const supported = solveScene(checkScene(scene)),
    before = poses(supported);
  refineSurfaceContacts(supported, forScene(supported));
  assert.deepEqual(poses(supported), before);
  assert.equal(supported.quality.contactDetail[0].reason, "load_bearing");

  const disabled = base();
  disabled.contacts[0].strength = 0;
  const noPull = solveScene(checkScene(disabled)),
    noPullPose = poses(noPull);
  refineSurfaceContacts(noPull, forScene(noPull));
  assert.deepEqual(poses(noPull), noPullPose);

  const locked = base();
  locked.actors[0].joints = { wrist_r: { flexion: 0, abduction: 0 } };
  const explicit = solveScene(checkScene(locked)),
    wrist = structuredClone(explicit.actors[0].pose.joints.wrist_r);
  refineSurfaceContacts(explicit, forScene(explicit));
  assert.deepEqual(explicit.actors[0].pose.joints.wrist_r, wrist);
});

test("multiple contacts report the final shared-arm geometry, not stale intermediate positions", () => {
  const scene = base();
  scene.contacts.push({ ...scene.contacts[0], to: "hand.l" });
  const solved = solveScene(checkScene(scene)),
    bodies = forScene(solved);
  refineSurfaceContacts(solved, bodies);
  const query = createSurfaceContactQuery(solved.actors, bodies);
  solved.contacts.forEach((contact, index) =>
    assert.ok(
      Math.abs(
        query(contact).distance -
          solved.quality.contactDetail[index].surfaceGap,
      ) < 1e-9,
    ),
  );
});

test("coarse overlaps are reconciled only with clear complete limb meshes; missing geometry and unrelated collisions remain reported", () => {
  const scene = base();
  scene.actors[0].bodyType = "male";
  scene.actors[1].bodyType = "female";
  const solved = solveScene(checkScene(scene)),
    bodies = forScene(solved);
  const floorHeights = solved.actors.map((actor) =>
    ["ankle_l", "ankle_r", "knee_l", "knee_r"].map(
      (name) => actor.evaluated.positions[actor.skeleton.boneIndex(name)][1],
    ),
  );
  refineSurfaceContacts(solved, bodies);
  assert.ok(
    solved.quality.contactDetail[0].surfaceGap <= SURFACE_CONTACT_TOLERANCE,
  );
  assert.ok(
    solved.quality.proxyMaxDepth > 0.001,
    "fixture must exercise the coarse/drawn discrepancy",
  );
  assert.ok(solved.quality.verifiedProxyContacts > 0);
  assert.equal(solved.quality.maxDepth, 0);
  assert.ok(solved.quality.limbIntersections.every((hit) => !hit));
  solved.actors.forEach((actor, i) =>
    ["ankle_l", "ankle_r", "knee_l", "knee_r"].forEach((name, j) =>
      assert.ok(
        Math.abs(
          actor.evaluated.positions[actor.skeleton.boneIndex(name)][1] -
            floorHeights[i][j],
        ) < 1e-9,
      ),
    ),
  );
  const unverified = measureSurfaceSafety(
    solved,
    createSurfaceContactQuery(solved.actors, [null, bodies[1]]),
  );
  assert.equal(unverified.verifiedProxyContacts, 0);
  assert.equal(unverified.maxDepth, unverified.proxyMaxDepth);
  assert.ok(unverified.maxDepth > 0.001);
  solved.actors[1].pose.root.position = [
    ...solved.actors[0].pose.root.position,
  ];
  refresh(solved.actors[1]);
  const collision = measureSurfaceSafety(
    solved,
    createSurfaceContactQuery(solved.actors, bodies),
  );
  assert.ok(
    collision.maxDepth > 0.04,
    "a contact must not exempt unrelated torso intersections",
  );
});

test("explicitly pinned figures keep their root position during surface refinement", () => {
  const scene = base();
  scene.actors[0].bodyType = "male";
  scene.actors[0].mobility = 0;
  const solved = solveScene(checkScene(scene)),
    before = [...solved.actors[0].pose.root.position];
  refineSurfaceContacts(solved, forScene(solved));
  assert.deepEqual(solved.actors[0].pose.root.position, before);
});

test("canceling incremental refinement restores the original rig without publishing partial measurements", () => {
  const solved = solveScene(checkScene(base())),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const steps = surfaceContactSteps(solved, forScene(solved));
  assert.equal(steps.next().done, false);
  assert.equal(steps.next().done, false);
  steps.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});
