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
  DEG,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
} from "../src/core/math.js";
import {
  createSurfaceContactQuery,
  measureRenderedSupports,
  refineSurfaceContacts,
  surfaceContactSteps,
} from "../src/core/surfaceContacts.js";
import {
  levelSeatedSupportFrame,
  levelSeatedFramePreserved,
  LEVEL_SEATED_PITCH_LIMIT,
} from "../src/core/levelSeatedSupports.js";
import {
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
function scene(bodyType = "female", surface = "sofa") {
  const spec = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.reclined").scene,
  );
  spec.actors[0].bodyType = bodyType;
  spec.support.surface = surface;
  return spec;
}
function prepare(spec) {
  const solved = solveScene(checkScene(spec)),
    bodies = solved.actors.map(template);
  return {
    solved,
    bodies,
    query: createSurfaceContactQuery(solved.actors, bodies),
  };
}
const poses = (s) => structuredClone(s.actors.map((a) => a.pose));
const frameFor = (s, query) =>
  levelSeatedSupportFrame(s.actors[0], measureRenderedSupports(s, query)[0]);
function grounded(solved, query) {
  assert.deepEqual(solvedPreview(solved).issues, []);
  assert.ok(solved.actors[0].seatResidual <= 0.004);
  assert.equal(solved.actors[0].supportPenetration, 0);
  assert.ok(query.lowest(0) >= solved.surface.ground - 1e-7);
  assert.equal(solved.quality.maxSelfDepth, 0);
  assert.ok(solved.quality.renderedBalance[0]?.supported);
  assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
  assert.equal(solved.quality.propPenetration, 0);
}

test("both sofa reclines ground the visible seat, retain foot frames and clear the complete backrest", () => {
  for (const type of ["female", "male"]) {
    const spec = scene(type),
      original = structuredClone(spec);
    const { solved, bodies, query } = prepare(spec),
      frame = frameFor(solved, query);
    assert.ok(measureRenderedSupports(solved, query)[0].gap > 0.09);
    refineSurfaceContacts(solved, bodies);
    grounded(solved, query);
    assert.ok(levelSeatedFramePreserved(solved.actors[0], frame));
    assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps > 0);
    assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps <= 8);
    assert.ok(solved.quality.surfaceRefinement.steps <= 32);
    assert.ok(
      solved.quality.proxyPropPenetration > 0,
      "coarse disagreement remains available",
    );
    assert.deepEqual(spec, original);
  }
});

test("shared-plane seating fits eighteen body/proportion/floor-or-bed-or-sofa variations within budget", () => {
  for (const type of ["female", "male"])
    for (const [stature, build] of [
      [null, 1],
      [1.55, 0.9],
      [1.9, 1.1],
    ])
      for (const surface of ["floor", "bed", "sofa"]) {
        const spec = scene(type, surface);
        Object.assign(spec.actors[0], { id: "custom-seat", build });
        if (stature) spec.actors[0].stature = stature;
        const { solved, bodies, query } = prepare(spec),
          frame = frameFor(solved, query);
        refineSurfaceContacts(solved, bodies);
        grounded(solved, query);
        assert.ok(
          levelSeatedFramePreserved(solved.actors[0], frame),
          `${type}/${stature}/${surface}`,
        );
        assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps <= 8);
      }
});

test("shared-plane grounding follows a translated heading and a quarter-turned sofa", () => {
  for (const surface of ["floor", "sofa"]) {
    const { solved, bodies, query } = prepare(scene("female", surface)),
      actor = solved.actors[0];
    const rotation = quatFromAxisAngle(
      [0, 1, 0],
      surface === "floor" ? 1.3 : Math.PI / 2,
    );
    const shift = [0.8, 0, -0.6],
      move = (p) => quatRotate(rotation, p).map((n, i) => n + shift[i]);
    actor.pose.root.position = move(actor.pose.root.position);
    actor.pose.root.quaternion = quatMultiply(
      rotation,
      actor.pose.root.quaternion,
    );
    refresh(actor);
    solved.props = solved.props.map((p) => {
      const prop = {
        ...p,
        center: move(p.center),
        size: [p.size[2], p.size[1], p.size[0]],
      };
      prop.box = {
        min: prop.center.map((n, i) => n - prop.size[i] / 2),
        max: prop.center.map((n, i) => n + prop.size[i] / 2),
      };
      return prop;
    });
    solved.surface = { ...solved.surface, props: solved.props };
    const frame = frameFor(solved, query);
    refineSurfaceContacts(solved, bodies);
    grounded(solved, query);
    assert.ok(levelSeatedFramePreserved(actor, frame));
  }
});

test("fixed placement, zero mobility and required fixed leg channels remain authoritative", () => {
  for (const mode of [
    "placement",
    "mobility",
    "hip_l",
    "knee_r",
    "ankle_l",
    "toe_r",
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
    assert.equal(solved.quality.surfaceRefinement.levelSeatingSteps, 0);
    assert.ok(solvedPreview(solved).issues.includes("Support gap"));
  }
  const spec = scene();
  Object.assign(spec.actors[0], {
    jointMode: "fixed",
    joints: { spine02: { flexion: -4 }, neck: { flexion: 14 } },
  });
  const { solved, bodies, query } = prepare(spec);
  refineSurfaceContacts(solved, bodies);
  grounded(solved, query);
  assert.equal(solved.actors[0].pose.joints.spine02.flexion, -4);
  assert.equal(solved.actors[0].pose.joints.neck.flexion, 14);
});

test("fixed arms block wrist compensation without being overwritten by the seated phase", () => {
  const spec = scene("female", "floor");
  Object.assign(spec.actors[0], {
    jointMode: "fixed",
    joints: { wrist_l: { flexion: 0 } },
  });
  const { solved, bodies } = prepare(spec),
    before = poses(solved);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(poses(solved), before);
  assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps > 0);
  assert.ok(solvedPreview(solved).issues.includes("Support gap"));
});

test("a complete obstacle below the seat rejects shared-plane lowering", () => {
  const { solved, bodies, query } = prepare(scene("female", "bed")),
    actor = solved.actors[0];
  const prop = {
    kind: "obstacle",
    center: [
      actor.pose.root.position[0],
      solved.surface.height + 0.04,
      actor.pose.root.position[2],
    ],
    size: [0.26, 0.08, 0.8],
  };
  prop.box = {
    min: prop.center.map((n, i) => n - prop.size[i] / 2),
    max: prop.center.map((n, i) => n + prop.size[i] / 2),
  };
  assert.equal(query.prop(0, prop).intersects, false);
  solved.props.push(prop);
  const before = poses(solved);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(poses(solved), before);
  assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps > 0);
  assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
});

test("a close hand contact cannot be sacrificed to improve shared-plane seat support", () => {
  const spec = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.paired-kneel").scene,
  );
  for (const actor of spec.actors) actor.posture = "seated_reclined";
  const { solved, bodies } = prepare(spec);
  refineSurfaceContacts(solved, bodies, { maxLevelSeatingSteps: 0 });
  assert.ok(solved.quality.contactDetail.length > 0);
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
  refineSurfaceContacts(solved, bodies);
  assert.ok(solved.quality.surfaceRefinement.levelSeatingSteps > 0);
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
});

test("captured shared-plane seating round trips, while absent meshes never grant correction", () => {
  for (const [type, surface] of [
    ["female", "floor"],
    ["male", "sofa"],
  ]) {
    const spec = scene(type, surface),
      { solved, bodies, query } = prepare(spec);
    refineSurfaceContacts(solved, bodies);
    grounded(solved, query);
    const before = solved.actors[0].evaluated.positions.map((p) => p.slice());
    Object.assign(spec.actors[0], captureSolvedPose(solved.actors[0]));
    const restored = solveScene(checkScene(JSON.parse(JSON.stringify(spec))));
    const restoredQuery = createSurfaceContactQuery(restored.actors, bodies);
    refineSurfaceContacts(restored, bodies);
    grounded(restored, restoredQuery);
    assert.equal(restored.quality.surfaceRefinement.levelSeatingSteps, 0);
    restored.actors[0].evaluated.positions.forEach((p, i) =>
      p.forEach((n, k) => assert.ok(Math.abs(n - before[i][k]) < 1e-7)),
    );
  }
  const { solved } = prepare(scene()),
    before = poses(solved);
  refineSurfaceContacts(solved, [null]);
  assert.deepEqual(poses(solved), before);
  assert.equal(solved.quality.surfaceRefinement.levelSeatingSteps, 0);
  assert.ok(solvedPreview(solved).issues.includes("Support check unavailable"));
});

test("shared-plane candidates respect phase/global budgets and cancellation restores accepted poses", () => {
  for (const options of [{ maxLevelSeatingSteps: 0 }, { maxSteps: 0 }]) {
    const { solved, bodies } = prepare(scene()),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies, options);
    assert.deepEqual(poses(solved), before);
    assert.equal(solved.quality.surfaceRefinement.levelSeatingSteps, 0);
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
    !step.value.levelSeatingSteps ||
    JSON.stringify(poses(solved)) === JSON.stringify(before)
  );
  iterator.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("the frame guard independently rejects cumulative translation, non-pitch rotation and end-frame drift", () => {
  const { solved, bodies, query } = prepare(scene()),
    actor = solved.actors[0],
    frame = frameFor(solved, query);
  refineSurfaceContacts(solved, bodies);
  assert.ok(levelSeatedFramePreserved(actor, frame));
  for (const change of [
    (f) => {
      f.pose.root.position[1] =
        actor.pose.root.position[1] + SEATED_ROOT_LIMIT + 0.001;
    },
    (f) => {
      for (const i of [0, 2])
        f.pose.root.position[i] =
          actor.pose.root.position[i] -
          f.forward[i] * (SEATED_HORIZONTAL_LIMIT + 0.001);
    },
    (f) => {
      f.pose.root.position[0] += f.forward[2] * 0.01;
      f.pose.root.position[2] -= f.forward[0] * 0.01;
    },
    (f) => {
      f.pose.root.quaternion = quatMultiply(
        actor.pose.root.quaternion,
        quatFromAxisAngle([1, 0, 0], -(LEVEL_SEATED_PITCH_LIMIT + 1) * DEG),
      );
    },
    (f) => {
      f.pose.root.quaternion = quatMultiply(
        actor.pose.root.quaternion,
        quatFromAxisAngle([0, 1, 0], -5 * DEG),
      );
    },
    (f) => {
      f.feet[0].position[0] += 0.001;
    },
  ]) {
    const changed = structuredClone(frame);
    change(changed);
    assert.equal(levelSeatedFramePreserved(actor, changed), false);
  }
  const accepted = structuredClone(actor.pose);
  for (const bone of ["spine02", "toe_l", "hand_l"]) {
    actor.pose = structuredClone(accepted);
    actor.pose.joints[bone].flexion += 1;
    refresh(actor);
    assert.equal(levelSeatedFramePreserved(actor, frame), false);
  }
});
