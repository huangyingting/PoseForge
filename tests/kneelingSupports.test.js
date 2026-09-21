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
  kneelingSupportFrame,
  kneelingFramePreserved,
  KNEELING_ROOT_LIMIT,
  KNEELING_HORIZONTAL_LIMIT,
} from "../src/core/kneelingSupports.js";
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
const scene = (id) =>
  structuredClone(BUILTIN_PRESETS.find((p) => p.id === `builtin.${id}`).scene);
const prepare = (spec) => {
  const solved = solveScene(checkScene(spec));
  return { solved, bodies: solved.actors.map(template) };
};
const poses = (s) => structuredClone(s.actors.map((a) => a.pose));

test("kneeling references close their visible supports while retaining feet and contacted hands", () => {
  for (const id of ["kneeling", "low-kneel", "paired-kneel"]) {
    const spec = scene(id),
      original = structuredClone(spec),
      { solved, bodies } = prepare(spec);
    refineSurfaceContacts(solved, bodies, { maxKneelingSteps: 0 });
    const query = createSurfaceContactQuery(solved.actors, bodies),
      reports = measureRenderedSupports(solved, query);
    const frames = solved.actors.map((a, i) =>
      kneelingSupportFrame(
        a,
        solved.surface,
        reports[i],
        query,
        solved.contacts,
      ),
    );
    const before = poses(solved);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, [], id);
    assert.ok(solved.quality.surfaceRefinement.kneelingSteps > 0);
    assert.ok(solved.quality.surfaceRefinement.kneelingSteps <= 8);
    assert.ok(solved.quality.surfaceRefinement.steps <= 32);
    assert.ok(
      solved.quality.contactDetail.every(
        (c) => !c.intersects && c.surfaceGap <= 0.004,
      ),
    );
    assert.ok(
      solved.quality.figureSurfaces.every((p) => p.intersects === false),
    );
    assert.ok(solved.quality.renderedBalance.every((b) => b?.supported));
    solved.actors.forEach((a, i) => {
      assert.ok(a.seatResidual <= 0.004);
      assert.equal(a.supportPenetration, 0);
      assert.ok(kneelingFramePreserved(a, frames[i]));
      assert.ok(query.lowest(i) >= solved.surface.ground - 1e-7);
      assert.ok(
        Math.abs(a.pose.root.position[1] - before[i].root.position[1]) <=
          KNEELING_ROOT_LIMIT,
      );
    });
    assert.deepEqual(spec, original);
  }
});

test("knee and shin corrections work across both body types, proportions and floor/bed surfaces", () => {
  for (const bodyType of ["female", "male"])
    for (const [stature, build] of [
      [1.55, 0.9],
      [1.9, 1.1],
    ])
      for (const posture of ["kneeling", "kneeling_low"])
        for (const surface of ["floor", "bed"]) {
          const { solved, bodies } = prepare({
            actors: [
              {
                id: "custom",
                bodyType,
                posture,
                stature,
                build,
                wearing: ["top", "shorts"],
              },
            ],
            support: { surface },
          });
          const before = poses(solved);
          refineSurfaceContacts(solved, bodies);
          assert.deepEqual(
            solvedPreview(solved).issues,
            [],
            `${bodyType}/${stature}/${posture}/${surface}`,
          );
          assert.ok(solved.actors[0].seatResidual <= 0.004);
          assert.equal(solved.actors[0].supportPenetration, 0);
          assert.ok(solved.quality.renderedBalance[0]?.supported);
          assert.ok(
            solved.quality.propSurfaces.every((p) => p.intersects === false),
          );
          assert.ok(
            Math.hypot(
              ...[0, 2].map(
                (axis) =>
                  solved.actors[0].pose.root.position[axis] -
                  before[0].root.position[axis],
              ),
            ) <= KNEELING_HORIZONTAL_LIMIT,
          );
        }
});

test("rendered balance can retain measured knee support when coarse capsules fall below their contact band", () => {
  const { solved, bodies } = prepare({
    actors: [
      {
        bodyType: "female",
        posture: "kneeling",
        stature: 1.9,
        build: 1.1,
        wearing: ["top", "shorts"],
      },
    ],
    support: { surface: "floor" },
  });
  refineSurfaceContacts(solved, bodies);
  assert.equal(solved.quality.balance[0].supported, false);
  assert.equal(solved.quality.renderedBalance[0].supported, true);
  assert.equal(solved.quality.renderedBalance[0].basis, "rendered-support");
  assert.ok(solved.actors[0].bodySupportResidual > 0.03);
  assert.ok(solved.actors[0].seatResidual < 0.004);
});

test("fixed placement, mobility and fixed leg settings remain authoritative", () => {
  for (const mode of ["placement", "mobility", "leg"]) {
    const spec = scene("low-kneel");
    if (mode === "placement")
      Object.assign(
        spec.actors[0],
        captureSolvedPose(solveScene(spec).actors[0]),
      );
    if (mode === "mobility") spec.actors[0].mobility = 0;
    if (mode === "leg") {
      spec.actors[0].jointMode = "fixed";
      spec.actors[0].joints = { knee_l: { flexion: 145 } };
    }
    const { solved, bodies } = prepare(spec),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(poses(solved), before, mode);
    assert.equal(solved.quality.surfaceRefinement.kneelingSteps, 0);
    assert.ok(solvedPreview(solved).issues.includes("Support gap"));
  }
});

test("a fixed contacted wrist blocks correction of that figure instead of being overwritten", () => {
  const { solved, bodies } = prepare(scene("paired-kneel"));
  refineSurfaceContacts(solved, bodies, { maxKneelingSteps: 0 });
  const actor = solved.actors[1];
  actor.spec.jointMode = "fixed";
  actor.spec.joints = { wrist_l: structuredClone(actor.pose.joints.wrist_l) };
  refresh(actor);
  const before = structuredClone(actor.pose);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(actor.pose, before);
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
});

test("captured kneeling support round trips unchanged and missing meshes never grant a correction", () => {
  const spec = scene("paired-kneel"),
    { solved, bodies } = prepare(spec);
  refineSurfaceContacts(solved, bodies);
  spec.actors.forEach((a, i) =>
    Object.assign(a, captureSolvedPose(solved.actors[i])),
  );
  const restored = solveScene(checkScene(JSON.parse(JSON.stringify(spec))));
  refineSurfaceContacts(restored, bodies);
  assert.deepEqual(solvedPreview(restored).issues, []);
  assert.equal(restored.quality.surfaceRefinement.kneelingSteps, 0);
  const absent = prepare(scene("low-kneel")),
    before = poses(absent.solved);
  refineSurfaceContacts(absent.solved, [null]);
  assert.deepEqual(poses(absent.solved), before);
  assert.equal(absent.solved.quality.renderedBalance[0], null);
  assert.ok(
    solvedPreview(absent.solved).issues.includes("Support check unavailable"),
  );
});

test("kneeling respects budgets and cancellation restores an accepted intermediate pose", () => {
  const none = prepare(scene("low-kneel")),
    original = poses(none.solved);
  refineSurfaceContacts(none.solved, none.bodies, { maxKneelingSteps: 0 });
  assert.deepEqual(poses(none.solved), original);
  const one = prepare(scene("paired-kneel"));
  refineSurfaceContacts(one.solved, one.bodies, { maxSteps: 1 });
  assert.ok(one.solved.quality.surfaceRefinement.steps <= 1);
  const { solved, bodies } = prepare(scene("paired-kneel")),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const iterator = surfaceContactSteps(solved, bodies);
  let result;
  do {
    result = iterator.next();
    assert.equal(result.done, false);
  } while (
    !result.value.kneelingSteps ||
    JSON.stringify(poses(solved)) === JSON.stringify(before)
  );
  iterator.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("cumulative root and end-frame drift cannot pass the kneeling guard", () => {
  const { solved, bodies } = prepare(scene("kneeling")),
    actor = solved.actors[0],
    query = createSurfaceContactQuery(solved.actors, bodies);
  const frame = kneelingSupportFrame(
    actor,
    solved.surface,
    measureRenderedSupports(solved, query)[0],
    query,
    solved.contacts,
  );
  refineSurfaceContacts(solved, bodies);
  assert.ok(kneelingFramePreserved(actor, frame));
  const root = structuredClone(actor.pose.root);
  actor.pose.root.position[1] =
    frame.root.position[1] - KNEELING_ROOT_LIMIT - 0.001;
  assert.equal(kneelingFramePreserved(actor, frame), false);
  actor.pose.root = root;
  actor.pose.root.position[0] += KNEELING_HORIZONTAL_LIMIT + 0.001;
  assert.equal(kneelingFramePreserved(actor, frame), false);
});

test("unclaimed below-floor parts and missing whole figures cannot produce a clean floor audit", () => {
  const { solved, bodies } = prepare({
    actors: [
      {
        bodyType: "male",
        posture: "lifted",
        wearing: ["top", "shorts"],
        placement: { position: [0, -1, 0], rotation: [0, 0, 0] },
      },
    ],
    support: { surface: "floor" },
  });
  assert.equal(solved.actors[0].supportBasis, "none");
  refineSurfaceContacts(solved, bodies);
  assert.ok(solved.quality.floorSurfaces[0].penetration > 0.5);
  assert.ok(solvedPreview(solved).issues.includes("Floor overlap"));
  refineSurfaceContacts(solved, [null]);
  assert.equal(solved.quality.floorSurfaces[0].penetration, null);
  assert.ok(solvedPreview(solved).issues.includes("Floor check unavailable"));
});
