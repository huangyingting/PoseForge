import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import {
  buildHumanTemplate,
  featureRelief,
  skinHumanMesh,
} from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import {
  solveScene,
  createActor,
  refresh,
  measureSceneSafety,
  measureContactTargets,
} from "../src/core/solver.js";
import {
  createSurfaceContactQuery,
  measureFigureSurfaces,
  measureSurfaceSafety,
  refineSurfaceContacts,
  surfaceContactSteps,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";
import {
  standingContactPoses,
  standingFramePreserved,
} from "../src/core/standingContacts.js";
import {
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
} from "../src/core/math.js";
import { captureSolvedPose } from "../src/core/placement.js";

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
const standingPair = () =>
  structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.named.standing_embrace")
      .scene,
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

test("captured complete rigs retain refined standing geometry after save-format normalization", () => {
  const scene = standingPair(),
    original = solveScene(checkScene(scene));
  refineSurfaceContacts(original, forScene(original));
  const positions = original.actors.map((actor) =>
    structuredClone(actor.evaluated.positions),
  );
  scene.actors.forEach((actor, i) =>
    Object.assign(actor, captureSolvedPose(original.actors[i])),
  );
  const restored = solveScene(checkScene(JSON.parse(JSON.stringify(scene))));
  refineSurfaceContacts(restored, forScene(restored));
  assert.equal(restored.quality.unmetContacts, 0);
  assert.ok(
    restored.quality.figureSurfaces.every((pair) => pair.intersects === false),
  );
  assert.equal(restored.quality.surfaceRefinement.steps, 0);
  restored.actors.forEach((actor, i) =>
    actor.evaluated.positions.forEach((point, j) =>
      point.forEach((value, k) =>
        assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
      ),
    ),
  );
});

test("fully fixed placements and joint channels skip futile surface candidates and survive cancellation", () => {
  const scene = base(),
    original = solveScene(checkScene(scene));
  scene.actors.forEach((actor, i) =>
    Object.assign(actor, captureSolvedPose(original.actors[i])),
  );
  const solved = solveScene(checkScene(scene)),
    bodies = forScene(solved),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const steps = surfaceContactSteps(solved, bodies);
  steps.next();
  steps.next();
  steps.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
  refineSurfaceContacts(solved, bodies);
  assert.equal(solved.quality.surfaceRefinement.steps, 0);
  assert.equal(solved.quality.contactDetail[0].reason, "fixed_channels");
  assert.equal(solved.quality.contactDetail[0].blocked, true);
  assert.ok(solved.quality.unmetContacts > 0);
  assert.deepEqual(poses(solved), before);
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

test("coupled hand-to-back reaches clear complete arms without worsening unrelated contacts or collisions", () => {
  const solved = solveScene(checkScene(standingPair())),
    bodies = forScene(solved),
    initialPoses = poses(solved),
    query = createSurfaceContactQuery(solved.actors, bodies),
    initial = measureSurfaceSafety(solved, query),
    before = solved.contacts.map(query);
  assert.deepEqual(initial.limbIntersections, [true, true]);
  refineSurfaceContacts(solved, bodies, { maxBodySteps: 0 });
  const hands = solved.quality.contactDetail.filter((c) => c.from === "hand");
  assert.equal(hands.length, 2);
  for (const hand of hands) {
    assert.equal(hand.intersects, false);
    assert.ok(
      hand.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
      `${hand.surfaceGap} hand gap`,
    );
  }
  assert.deepEqual(solved.quality.limbIntersections, [false, false]);
  assert.ok(solved.quality.surfaceRefinement.steps <= 32);
  for (const key of [
    "maxDepth",
    "maxSelfDepth",
    "maxBodyDepth",
    "propPenetration",
    "totalDepth",
  ])
    assert.ok(solved.quality[key] <= initial[key] + 1e-8, key);
  const violations = new Map(initial.violations.map((v) => [v.key, v.depth]));
  assert.ok(
    solved.quality.violations.every(
      (v) => v.depth <= (violations.get(v.key) ?? 0) + 1e-8,
    ),
  );
  assert.deepEqual(
    solved.actors[0].pose,
    initialPoses[0],
    "target figure must not move",
  );
  solved.actors.forEach((actor, index) => {
    assert.deepEqual(actor.pose.root, initialPoses[index].root);
    for (const joint of [
      "hip_l",
      "hip_r",
      "knee_l",
      "knee_r",
      "ankle_l",
      "ankle_r",
    ])
      assert.deepEqual(
        actor.pose.joints[joint],
        initialPoses[index].joints[joint],
      );
  });
  solved.contacts.forEach((contact, i) => {
    if (contact.from !== "hand") {
      const after = query(contact);
      assert.equal(after.intersects, before[i].intersects);
      assert.ok(Math.abs(after.distance - before[i].distance) < 1e-9);
    }
  });
  assert.ok(
    solved.quality.unmetContacts > 0,
    "the remaining body gap must not be hidden",
  );
});

test("resting hands that reach a back back first lie flat against it without new collisions", () => {
  const solved = solveScene(checkScene(standingPair()));
  assert.deepEqual(solved.actors[1].hands, { l: "cup", r: "cup" });
  refineSurfaceContacts(solved, forScene(solved));
  assert.deepEqual(solved.actors[1].hands, { l: "lay", r: "lay" });
  for (const side of ["left", "right"])
    assert.ok(
      solved.quality.adjustments.includes(
        `Figure B: the ${side} hand arrived back first, so it lies flat rather than cupped.`,
      ),
    );
  assert.equal(solved.quality.unmetContacts, 0);
  assert.ok(
    solved.quality.figureSurfaces.every((pair) => pair.intersects === false),
  );
  assert.equal(solved.quality.maxBodyDepth, 0);
});

test("standing body contacts close with complete figure clearance and preserved support and wrist frames", () => {
  const solved = solveScene(checkScene(standingPair())),
    bodies = forScene(solved);
  refineSurfaceContacts(solved, bodies, { maxBodySteps: 0 });
  const before = poses(solved),
    actor = solved.actors[1],
    evaluation = actor.evaluated;
  const query = createSurfaceContactQuery(solved.actors, bodies);
  assert.equal(
    measureFigureSurfaces(solved, query)[0].intersects,
    true,
    "fixture must expose the crossing outside the hand patches",
  );
  const initial = measureSurfaceSafety(solved, query, { wholeFigures: true });
  const lowest = () => {
    let height = Infinity;
    for (const part of skinHumanMesh(
      bodies[1],
      actor.skeleton,
      actor.evaluated,
    ))
      for (let i = 1; i < part.positions.length; i += 3)
        height = Math.min(height, part.positions[i]);
    return height;
  };
  const groundBefore = lowest();
  refineSurfaceContacts(solved, bodies);
  assert.equal(solved.quality.unmetContacts, 0);
  assert.ok(
    solved.quality.contactDetail.every(
      (contact) =>
        !contact.intersects && contact.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
    ),
  );
  assert.deepEqual(solved.quality.figureSurfaces, [
    { fromActor: 0, toActor: 1, intersects: false },
  ]);
  assert.equal(query.figures(0, 1).intersects, false);
  assert.equal(query.figures(0, 1).facing, true);
  assert.ok(solved.quality.surfaceRefinement.bodySteps > 0);
  assert.ok(solved.quality.surfaceRefinement.steps <= 32);
  assert.deepEqual(solved.actors[0].pose, before[0]);
  assert.ok(
    Math.hypot(
      ...actor.pose.root.position.map(
        (value, i) => value - before[1].root.position[i],
      ),
    ) <= 0.04,
  );
  assert.ok(Math.abs(lowest() - groundBefore) <= 0.0005);
  for (const name of ["ankle_l", "ankle_r", "wrist_l", "wrist_r"]) {
    const index = actor.skeleton.boneIndex(name),
      old = evaluation.matrices[index],
      current = actor.evaluated.matrices[index];
    current
      .slice(0, 12)
      .forEach((value, i) =>
        assert.ok(Math.abs(value - old[i]) <= 0.0005, name),
      );
    assert.ok(
      Math.abs(current[13] - old[13]) <= 0.0005,
      `${name} support height`,
    );
    if (name.startsWith("wrist"))
      assert.ok(
        Math.hypot(
          ...current.slice(12, 15).map((value, i) => value - old[12 + i]),
        ) <= 0.0005,
      );
  }
  assert.ok(solved.quality.balance.every((balance) => balance.supported));
  for (const key of ["maxSelfDepth", "propPenetration", "totalDepth"])
    assert.ok(solved.quality[key] <= initial[key] + 1e-8, key);
});

test("canceling a standing-body candidate restores the complete original rig and quality", () => {
  const solved = solveScene(checkScene(standingPair())),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const steps = surfaceContactSteps(solved, forScene(solved));
  let moved = false;
  for (let i = 0; i < 64; i++) {
    const step = steps.next();
    assert.equal(
      step.done,
      false,
      "body candidate must yield before publishing",
    );
    if (
      solved.actors[1].pose.root.position.some(
        (value, k) => value !== before[1].root.position[k],
      )
    ) {
      moved = true;
      break;
    }
  }
  assert.ok(moved);
  assert.deepEqual(solved.quality, quality);
  steps.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("standing refinement follows the shared world frame rather than preset identity", () => {
  const solved = solveScene(checkScene(standingPair())),
    bodies = forScene(solved);
  refineSurfaceContacts(solved, bodies, { maxBodySteps: 0 });
  const heading = quatFromAxisAngle([0, 1, 0], 0.8);
  solved.actors.forEach((actor, i) => {
    actor.id = `custom-standing-${i}`;
    actor.pose.root.position = quatRotate(
      heading,
      actor.pose.root.position,
    ).map((value, k) => value + [1.2, 0, -0.7][k]);
    actor.pose.root.quaternion = quatMultiply(
      heading,
      actor.pose.root.quaternion,
    );
    refresh(actor);
  });
  refineSurfaceContacts(solved, bodies);
  assert.equal(solved.quality.unmetContacts, 0);
  assert.ok(
    solved.quality.figureSurfaces.every((pair) => pair.intersects === false),
  );
  assert.ok(solved.quality.balance.every((balance) => balance.supported));
});

test("a collision with an unrelated third figure rejects standing-body candidates within budget", () => {
  const solved = solveScene(checkScene(standingPair()));
  refineSurfaceContacts(solved, forScene(solved), { maxBodySteps: 0 });
  const blocker = createActor(
    { ...solved.actors[0].spec, id: "blocker", mobility: 0 },
    2,
  );
  blocker.pose = structuredClone(solved.actors[0].pose);
  blocker.pose.root.position[0] += 0.015;
  refresh(blocker);
  solved.actors.push(blocker);
  const before = poses(solved),
    bodies = forScene(solved);
  assert.equal(
    createSurfaceContactQuery(solved.actors, bodies).figures(0, 2, true)
      .intersects,
    true,
  );
  refineSurfaceContacts(solved, bodies, { maxBodySteps: 2 });
  assert.deepEqual(poses(solved), before);
  assert.equal(solved.quality.surfaceRefinement.bodySteps, 2);
  assert.ok(solved.quality.surfaceRefinement.steps <= 32);
  assert.ok(
    solved.quality.figureSurfaces.some(
      (pair) => pair.toActor === 2 && pair.intersects,
    ),
  );
});

test("standing candidates preserve fixed trunk channels without mutating the input rig", () => {
  const solved = solveScene(checkScene(standingPair())),
    bodies = forScene(solved);
  refineSurfaceContacts(solved, bodies, { maxBodySteps: 0 });
  const actor = solved.actors[1],
    fixed = actor.pose.joints.spine01.flexion;
  actor.spec.jointMode = "fixed";
  actor.spec.joints = { spine01: { flexion: fixed } };
  const before = poses(solved),
    query = createSurfaceContactQuery(solved.actors, bodies);
  const lower = query(
    solved.contacts.find((contact) => contact.from === "pelvis"),
  );
  const upper = query(
    solved.contacts.find((contact) => contact.from === "chest"),
  ).from;
  let candidates = 0,
    preserved = 0;
  for (const pose of standingContactPoses(actor, lower, upper)) {
    candidates++;
    if (pose) {
      preserved++;
      assert.equal(pose.joints.spine01.flexion, fixed);
    }
    assert.deepEqual(poses(solved), before);
  }
  assert.equal(candidates, 18);
  assert.ok(
    preserved > 0,
    "fixture must exercise non-null constrained candidates",
  );
});

test("cumulative standing bounds independently reject root, foot and wrist drift", () => {
  const actor = solveScene(checkScene(standingPair())).actors[1];
  const baseline = {
    root: [...actor.pose.root.position],
    evaluated: actor.evaluated,
  };
  const frame = (trial, name) =>
    trial.evaluated.matrices[trial.skeleton.boneIndex(name)];
  for (const change of [
    (trial) => {
      trial.pose.root.position[0] += 0.041;
    },
    (trial) => {
      trial.pose.root.position[1] -= 0.021;
    },
    (trial) => {
      frame(trial, "ankle_l")[12] += 0.071;
    },
    (trial) => {
      frame(trial, "ankle_l")[13] += 0.0006;
    },
    (trial) => {
      frame(trial, "wrist_l")[12] += 0.0006;
    },
    (trial) => {
      frame(trial, "wrist_l")[0] += 0.0006;
    },
  ]) {
    const trial = {
      ...actor,
      pose: structuredClone(actor.pose),
      evaluated: structuredClone(actor.evaluated),
    };
    assert.equal(standingFramePreserved(trial, baseline), true);
    change(trial);
    assert.equal(standingFramePreserved(trial, baseline), false);
  }
});

test("body trials respect pinned and authored placement, missing surfaces and explicit budgets", () => {
  const original = solveScene(checkScene(standingPair())),
    bodies = forScene(original);
  refineSurfaceContacts(original, bodies, { maxBodySteps: 0 });
  for (const constraint of [
    "pinned",
    "wrist",
    "ankle",
    "missing",
    "zero budget",
  ]) {
    const solved = solveScene(checkScene(standingPair()));
    solved.actors.forEach((actor, i) => {
      actor.pose = structuredClone(original.actors[i].pose);
      refresh(actor);
    });
    const actor = solved.actors[1];
    if (constraint === "pinned") actor.mobility = 0;
    if (["wrist", "ankle"].includes(constraint)) {
      const bone = `${constraint}_l`;
      actor.spec.joints = { [bone]: structuredClone(actor.pose.joints[bone]) };
    }
    const before = poses(solved);
    refineSurfaceContacts(
      solved,
      constraint === "missing" ? [null, bodies[1]] : bodies,
      constraint === "zero budget" ? { maxSteps: 0 } : {},
    );
    assert.deepEqual(poses(solved), before, constraint);
    assert.equal(solved.quality.surfaceRefinement.bodySteps, 0, constraint);
    if (constraint === "missing")
      assert.equal(solved.quality.figureSurfaces[0].intersects, null);
  }
});

test("canceling a compound hand candidate restores the rig and unpublished quality", () => {
  const solved = solveScene(checkScene(standingPair())),
    before = poses(solved),
    quality = structuredClone(solved.quality),
    steps = surfaceContactSteps(solved, forScene(solved));
  assert.deepEqual(steps.next().value, { steps: 0 });
  assert.deepEqual(steps.next().value, { steps: 1 });
  assert.notDeepEqual(
    poses(solved),
    before,
    "fixture must accept a compound candidate",
  );
  assert.deepEqual(solved.quality, quality);
  steps.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("hand-to-body candidates obey the shared work budget and preserve authored channels", () => {
  for (const maxSteps of [0, 1, 3]) {
    const solved = solveScene(checkScene(standingPair()));
    refineSurfaceContacts(solved, forScene(solved), { maxSteps });
    assert.ok(solved.quality.surfaceRefinement.steps <= maxSteps);
  }
  for (const jointMode of ["guided", "fixed"]) {
    const spec = standingPair();
    spec.actors[1].jointMode = jointMode;
    spec.actors[1].joints = {
      wrist_l: { flexion: 0, abduction: 0 },
      elbow_r: { rotation: 0 },
      ...(jointMode === "fixed" ? { shoulder_r: { abduction: 12 } } : {}),
    };
    const solved = solveScene(checkScene(spec)),
      before = poses(solved);
    refineSurfaceContacts(solved, forScene(solved), { maxSteps: 8 });
    assert.deepEqual(
      solved.actors[1].pose.joints.wrist_l,
      before[1].joints.wrist_l,
    );
    assert.equal(
      solved.actors[1].pose.joints.elbow_r.rotation,
      before[1].joints.elbow_r.rotation,
    );
    if (jointMode === "fixed")
      assert.equal(solved.actors[1].pose.joints.shoulder_r.abduction, 12);
  }
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
    { wholeFigures: true },
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

test("clear distant limbs use crossing checks without unnecessary exact distance searches", () => {
  const solved = solveScene(checkScene(base()));
  solved.actors[1].pose.root.position[0] += 3;
  refresh(solved.actors[1]);
  const query = createSurfaceContactQuery(solved.actors, forScene(solved));
  const original = query.limbs;
  let exact = 0,
    crossings = 0;
  query.limbs = (group, crossingsOnly = false) => {
    if (crossingsOnly) crossings++;
    else exact++;
    return original(group, crossingsOnly);
  };
  const safety = measureSurfaceSafety(solved, query);
  assert.ok(crossings > 0, "whole-limb crossing checks must still run");
  assert.equal(exact, 0);
  assert.ok(safety.limbIntersections.every((hit) => !hit));
  assert.equal(safety.verifiedProxyContacts, 0);
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
