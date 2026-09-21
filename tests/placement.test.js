import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_PRESETS,
  checkScene,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { validateScene } from "../src/core/scene.js";
import { createActor, refresh, solveScene } from "../src/core/solver.js";
import { previewKey, solvedPreview } from "../src/core/posePreview.js";
import {
  captureSolvedPose,
  checkPlacement,
  placementFromRoot,
  rootFromPlacement,
} from "../src/core/placement.js";
import { quatRotate } from "../src/core/math.js";
import { POSEABLE_BONES, CHANNELS } from "../src/core/skeleton.js";

const base = () =>
  structuredClone(
    BUILTIN_PRESETS.find((preset) => preset.id === "builtin.helping-hand")
      .scene,
  );
const close = (a, b, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const sameOrientation = (a, b) => {
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])
    quatRotate(a, axis).forEach((value, k) =>
      close(value, quatRotate(b, axis)[k]),
    );
};

test("placement XYZ rotations round trip through solved quaternions, including singular orientations", () => {
  const cases = [
    [0, 0, 0],
    [90, 90, 0],
    [-90, -90, 40],
    [25, 89.999, -75],
    [25, 90, -75],
    [180, -180, 180],
  ];
  for (let i = 0; i < 80; i++)
    cases.push([
      ((i * 53) % 360) - 180,
      ((i * 31) % 360) - 180,
      ((i * 17) % 360) - 180,
    ]);
  for (const rotation of cases) {
    const initial = rootFromPlacement({
      position: [0.123456789, 1.02, -0.23],
      rotation,
    });
    const restored = rootFromPlacement(placementFromRoot(initial));
    assert.deepEqual(restored.position, initial.position);
    sameOrientation(initial.quaternion, restored.quaternion);
  }
});

test("placement imports reject malformed transforms and preserve optional legacy behavior", () => {
  const original = base(),
    automatic = checkScene(original);
  assert.ok(automatic.actors.every((actor) => actor.placement === undefined));
  assert.equal(previewKey(original), previewKey(automatic));
  assert.deepEqual(
    solveScene(original).actors.map((a) => a.pose),
    solveScene(automatic).actors.map((a) => a.pose),
  );
  for (const bad of [
    true,
    [],
    {},
    { position: Array(3), rotation: [0, 0, 0] },
    { position: [0, 0], rotation: [0, 0, 0] },
    { position: [0, 11, 0], rotation: [0, 0, 0] },
    { position: [0, 0, 0], rotation: [0, 181, 0] },
    { position: [0, "1", 0], rotation: [0, 0, 0] },
    { position: [0, 0, 0], rotation: [0, NaN, 0] },
    { position: [0, 0, 0], rotation: [0, 0, 0], mode: "automatic" },
  ]) {
    const scene = base();
    scene.actors[0].placement = bad;
    assert.throws(() => checkScene(scene));
    const repaired = validateScene(scene);
    assert.equal(repaired.scene.actors[0].placement, undefined);
    assert.ok(repaired.issues.some((issue) => /Placement/.test(issue.message)));
  }
  assert.throws(() =>
    placementFromRoot({ position: [0, 0, 0], quaternion: [0, 0, 0, 0] }),
  );
  assert.throws(() =>
    placementFromRoot({
      position: [0, 0, 0],
      quaternion: [1e308, 1e308, 1e308, 1e308],
    }),
  );
  assert.deepEqual(
    checkPlacement({ position: [0, -0, 0], rotation: [0, 0, 0] }).position,
    [0, 0, 0],
  );
});

test("fixed placement survives refresh while releasing it restores automatic mobility", () => {
  const placement = { position: [0.25, 1.02, -0.4], rotation: [4, 30, -2] };
  const actor = createActor(
    { posture: "standing", mobility: 0.7, placement },
    0,
  );
  actor.pose.root.position = [3, 4, 5];
  actor.pose.root.quaternion = [0, 0, 0, 1];
  actor.pose.joints.elbow_l.flexion = 45;
  refresh(actor);
  assert.deepEqual(actor.pose.root.position, placement.position);
  sameOrientation(
    actor.pose.root.quaternion,
    rootFromPlacement(placement).quaternion,
  );
  assert.equal(actor.mobility, 0);
  assert.equal(actor.pose.joints.elbow_l.flexion, 45);
  delete actor.spec.placement;
  actor.pose.root.position[0] += 1;
  refresh(actor);
  assert.equal(actor.pose.root.position[0], 1.25);
  assert.equal(actor.mobility, 0.7);
});

test("every catalog rig can be captured as valid portable authoring data", () => {
  for (const preset of BUILTIN_PRESETS) {
    const scene = structuredClone(preset.scene),
      solved = solveScene(checkScene(scene));
    scene.actors.forEach((actor, i) =>
      Object.assign(actor, captureSolvedPose(solved.actors[i])),
    );
    const checked = checkScene(scene);
    assert.ok(
      checked.actors.every(
        (actor) => actor.placement && actor.jointMode === "fixed",
      ),
      preset.id,
    );
  }
});

test("fixed roots leave unedited joints free and report unsatisfied contacts and support planes", () => {
  const scene = base(),
    initial = solveScene(checkScene(scene));
  scene.actors[0].placement = placementFromRoot(initial.actors[0].pose.root);
  scene.actors[0].joints = { elbow_r: { flexion: 0 } };
  const solved = solveScene(checkScene(scene));
  assert.deepEqual(
    solved.actors[0].pose.root.position,
    scene.actors[0].placement.position,
  );
  assert.ok(
    solved.actors[0].pose.joints.elbow_r.flexion > 1,
    "free elbow must still reach",
  );
  const elevated = base();
  elevated.actors = [elevated.actors[0]];
  elevated.contacts = [];
  Object.assign(elevated.actors[0], captureSolvedPose(initial.actors[0]));
  elevated.actors[0].placement.position[1] += 0.3;
  const floating = solveScene(checkScene(elevated));
  assert.ok(floating.actors[0].seatResidual > 0.25);
  assert.ok(solvedPreview(floating).issues.includes("Support gap"));
});

test("capturing complete rigs round trips through presets without changing placement, joints or recumbent support sides", () => {
  for (const id of [
    "builtin.helping-hand",
    "builtin.named.side_by_side_facing",
  ]) {
    const preset = structuredClone(
      BUILTIN_PRESETS.find((entry) => entry.id === id),
    );
    const before = solveScene(checkScene(preset.scene));
    preset.scene.actors.forEach((actor, i) =>
      Object.assign(actor, captureSolvedPose(before.actors[i])),
    );
    const checked = parseCatalog(serializeCatalog([preset]))[0];
    const after = solveScene(checked.scene);
    const original = BUILTIN_PRESETS.find((entry) => entry.id === id).scene;
    if (original.actors.every((actor) => actor.placement && actor.jointMode === "fixed"))
      assert.equal(previewKey(preset.scene), previewKey(original), "capturing an already fixed layout is idempotent");
    else
      assert.notEqual(previewKey(preset.scene), previewKey(original));
    after.actors.forEach((actor, i) => {
      assert.deepEqual(
        actor.pose.root.position,
        before.actors[i].pose.root.position,
      );
      sameOrientation(
        actor.pose.root.quaternion,
        before.actors[i].pose.root.quaternion,
      );
      assert.deepEqual(
        actor.posture.supports,
        before.actors[i].posture.supports,
      );
      for (const { name } of POSEABLE_BONES)
        for (const channel of CHANNELS)
          close(
            actor.pose.joints[name][channel],
            before.actors[i].pose.joints[name][channel],
          );
      actor.evaluated.positions.forEach((position, k) =>
        position.forEach((value, axis) =>
          close(value, before.actors[i].evaluated.positions[k][axis]),
        ),
      );
    });
  }
});
