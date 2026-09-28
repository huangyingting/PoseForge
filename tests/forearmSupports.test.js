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
  forearmSupportFrame,
  forearmFramePreserved,
  FOREARM_ROOT_LIMIT,
  FOREARM_WRIST_LIMIT,
} from "../src/core/forearmSupports.js";
import { solvedPreview } from "../src/core/posePreview.js";
import { quatFromAxisAngle, quatMultiply } from "../src/core/math.js";

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
function scene(bodyType = "male", surface = "floor") {
  const spec = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.floor-rest").scene,
  );
  spec.actors[0].bodyType = bodyType;
  spec.support.surface = surface;
  return spec;
}
function prepare(spec) {
  const solved = solveScene(checkScene(spec)),
    bodies = solved.actors.map(template);
  const query = createSurfaceContactQuery(solved.actors, bodies);
  return { solved, bodies, query };
}
const poses = (s) => structuredClone(s.actors.map((a) => a.pose));
function frameFor(solved, query) {
  return forearmSupportFrame(
    solved.actors[0],
    measureRenderedSupports(solved, query)[0],
    solved.contacts,
  );
}
function grounded(solved, query) {
  assert.deepEqual(solvedPreview(solved).issues, []);
  assert.ok(solved.actors[0].seatResidual <= 0.004);
  assert.equal(solved.actors[0].supportPenetration, 0);
  assert.ok(query.lowest(0) >= solved.surface.ground - 1e-7);
  assert.equal(solved.quality.maxSelfDepth, 0);
  assert.ok(solved.quality.renderedBalance[0]?.supported);
  assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
  assert.equal(solved.quality.floorSurfaces[0].penetration, 0);
}

test("the floor-rest reference grounds pelvis and forearms without driving hands through the floor", () => {
  const spec = scene(),
    originalSpec = structuredClone(spec);
  const { solved, bodies, query } = prepare(spec),
    actor = solved.actors[0];
  const frame = frameFor(solved, query),
    before = measureRenderedSupports(solved, query)[0];
  assert.ok(before.gap > 0.09);
  // The unrefined hands start well through the floor: about 19mm, fingertips
  // first.
  assert.ok(query.lowest(0) < -0.015);
  refineSurfaceContacts(solved, bodies);
  grounded(solved, query);
  assert.ok(forearmFramePreserved(actor, frame));
  assert.ok(solved.quality.surfaceRefinement.forearmSteps > 0);
  assert.ok(solved.quality.surfaceRefinement.forearmSteps <= 8);
  assert.ok(solved.quality.surfaceRefinement.steps <= 32);
  for (const side of ["l", "r"]) {
    assert.ok(
      query.support(0, { landmark: "hand", side }, solved.surface)
        .penetration === 0,
    );
    assert.ok(
      query.support(0, { landmark: "foot", side }, solved.surface).gap > 0.08,
      "undeclared elevated feet are not forced onto the floor",
    );
  }
  assert.deepEqual(spec, originalSpec);
});

test("forearm grounding fits both body types and proportion variations on floor and bed", () => {
  for (const bodyType of ["female", "male"])
    for (const [stature, build] of [
      [null, 1],
      [1.55, 0.9],
      [1.9, 1.1],
    ])
      for (const surface of ["floor", "bed"]) {
        const spec = scene(bodyType, surface);
        Object.assign(spec.actors[0], { id: "custom-recline", build });
        if (stature) spec.actors[0].stature = stature;
        const { solved, bodies, query } = prepare(spec),
          frame = frameFor(solved, query);
        refineSurfaceContacts(solved, bodies);
        grounded(solved, query);
        assert.ok(
          forearmFramePreserved(solved.actors[0], frame),
          `${bodyType}/${stature}/${surface}`,
        );
        assert.ok(solved.quality.surfaceRefinement.forearmSteps <= 8);
      }
});

test("forearm grounding follows world translation and heading without relocating the root horizontally", () => {
  const { solved, bodies, query } = prepare(scene()),
    actor = solved.actors[0];
  actor.pose.root.position[0] += 0.8;
  actor.pose.root.position[2] -= 0.6;
  actor.pose.root.quaternion = quatMultiply(
    quatFromAxisAngle([0, 1, 0], 1.3),
    actor.pose.root.quaternion,
  );
  refresh(actor);
  const frame = frameFor(solved, query);
  refineSurfaceContacts(solved, bodies);
  grounded(solved, query);
  assert.ok(forearmFramePreserved(actor, frame));
});

test("fixed placement, zero mobility and required fixed arm channels remain authoritative", () => {
  for (const mode of [
    "placement",
    "mobility",
    "shoulder_l",
    "elbow_r",
    "wrist_l",
  ]) {
    const spec = scene(),
      actor = spec.actors[0];
    if (mode === "placement")
      Object.assign(actor, captureSolvedPose(solveScene(spec).actors[0]));
    else if (mode === "mobility") actor.mobility = 0;
    else {
      actor.jointMode = "fixed";
      actor.joints = {
        [mode]: structuredClone(solveScene(spec).actors[0].pose.joints[mode]),
      };
    }
    const { solved, bodies } = prepare(spec),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(poses(solved), before, mode);
    assert.equal(solved.quality.surfaceRefinement.forearmSteps, 0);
    assert.ok(solvedPreview(solved).issues.includes("Support gap"));
  }
});

test("a positive contact on either supporting arm prevents free wrist reshaping", () => {
  const { solved, query } = prepare(scene()),
    actor = solved.actors[0];
  const report = measureRenderedSupports(solved, query)[0];
  assert.ok(forearmSupportFrame(actor, report, []));
  for (const end of ["from", "to"])
    for (const part of ["hand.l", "forearm.r", "upperArm.l"]) {
      const contact = {
        fromActor: 1,
        toActor: 1,
        from: "chest",
        to: "chest",
        strength: 1,
        [`${end}Actor`]: actor.index,
        [end]: part,
      };
      assert.equal(forearmSupportFrame(actor, report, [contact]), null);
      contact.strength = 0;
      assert.ok(forearmSupportFrame(actor, report, [contact]));
    }
});

test("a complete obstacle below the floating pelvis blocks the proposed lowering", () => {
  const { solved, bodies, query } = prepare(scene()),
    actor = solved.actors[0];
  const obstacle = {
    kind: "obstacle",
    center: [actor.pose.root.position[0], 0.04, actor.pose.root.position[2]],
    size: [0.3, 0.08, 0.3],
  };
  obstacle.box = {
    min: obstacle.center.map((n, i) => n - obstacle.size[i] / 2),
    max: obstacle.center.map((n, i) => n + obstacle.size[i] / 2),
  };
  solved.props.push(obstacle);
  assert.equal(query.prop(0, obstacle).intersects, false);
  const before = poses(solved);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(poses(solved), before);
  assert.ok(solved.quality.surfaceRefinement.forearmSteps > 0);
  assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
  assert.ok(solvedPreview(solved).issues.includes("Support gap"));
});

test("captured forearm support round trips while absent meshes never grant a correction", () => {
  for (const type of ["female", "male"]) {
    const spec = scene(type),
      { solved, bodies, query } = prepare(spec);
    refineSurfaceContacts(solved, bodies);
    grounded(solved, query);
    const before = solved.actors[0].evaluated.positions.map((p) => p.slice());
    Object.assign(spec.actors[0], captureSolvedPose(solved.actors[0]));
    const restored = solveScene(checkScene(JSON.parse(JSON.stringify(spec))));
    const restoredQuery = createSurfaceContactQuery(restored.actors, bodies);
    refineSurfaceContacts(restored, bodies);
    grounded(restored, restoredQuery);
    assert.equal(restored.quality.surfaceRefinement.forearmSteps, 0);
    restored.actors[0].evaluated.positions.forEach((p, i) =>
      p.forEach((n, k) => assert.ok(Math.abs(n - before[i][k]) < 1e-7)),
    );
  }
  const { solved } = prepare(scene()),
    before = poses(solved);
  refineSurfaceContacts(solved, [null]);
  assert.deepEqual(poses(solved), before);
  assert.equal(solved.quality.surfaceRefinement.forearmSteps, 0);
  assert.ok(solvedPreview(solved).issues.includes("Support check unavailable"));
});

test("forearm candidates respect phase/global budgets and cancellation restores accepted poses", () => {
  for (const options of [{ maxForearmSteps: 0 }, { maxSteps: 0 }]) {
    const { solved, bodies } = prepare(scene()),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies, options);
    assert.deepEqual(poses(solved), before);
    assert.equal(solved.quality.surfaceRefinement.forearmSteps, 0);
  }
  const one = prepare(scene());
  refineSurfaceContacts(one.solved, one.bodies, { maxSteps: 1 });
  assert.ok(one.solved.quality.surfaceRefinement.steps <= 1);
  const { solved, bodies } = prepare(scene()),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const iterator = surfaceContactSteps(solved, bodies);
  let step;
  do {
    step = iterator.next();
    assert.equal(step.done, false);
  } while (
    !step.value.forearmSteps ||
    JSON.stringify(poses(solved)) === JSON.stringify(before)
  );
  iterator.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("the forearm frame guard rejects cumulative movement and unrelated joint drift", () => {
  const { solved, bodies, query } = prepare(scene()),
    actor = solved.actors[0],
    frame = frameFor(solved, query);
  refineSurfaceContacts(solved, bodies);
  assert.ok(forearmFramePreserved(actor, frame));
  const accepted = structuredClone(actor.pose);
  for (const change of [
    () => {
      actor.pose.root.position[1] =
        frame.pose.root.position[1] - FOREARM_ROOT_LIMIT - 0.001;
    },
    () => {
      actor.pose.root.position[0] += 0.001;
    },
    () => {
      actor.pose.joints.hip_l.flexion += 1;
    },
    () => {
      actor.pose.joints.wrist_l.flexion =
        frame.pose.joints.wrist_l.flexion + 61;
    },
  ]) {
    actor.pose = structuredClone(accepted);
    change();
    refresh(actor);
    assert.equal(forearmFramePreserved(actor, frame), false);
  }
  actor.pose = accepted;
  refresh(actor);
  const displaced = structuredClone(frame);
  displaced.ends[0].position[0] += FOREARM_WRIST_LIMIT + 0.02;
  assert.equal(forearmFramePreserved(actor, displaced), false);
});
