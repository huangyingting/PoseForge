import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_PRESETS,
  checkPreset,
  checkScene,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { validateScene } from "../src/core/scene.js";
import { createActor, refresh, solveScene } from "../src/core/solver.js";
import { previewKey, solvedPreview } from "../src/core/posePreview.js";

const chair = () =>
  checkScene({
    support: { surface: "chair" },
    relationship: { arrangement: "straddle_lap" },
    actors: [
      { bodyType: "male", posture: "seated", wearing: ["top", "shorts"] },
      {
        bodyType: "female",
        posture: "seated_straddle",
        wearing: ["top", "shorts"],
        joints: {
          hip_l: { flexion: 45, abduction: 65 },
          hip_r: { flexion: 45, abduction: 65 },
          knee_l: { flexion: 110 },
          knee_r: { flexion: 110 },
        },
      },
    ],
  });

test("joint modes validate, normalize and round trip without changing legacy defaults", () => {
  const spec = chair();
  assert.ok(spec.actors.every((actor) => actor.jointMode === "guided"));
  const legacy = structuredClone(spec);
  legacy.actors.forEach((actor) => delete actor.jointMode);
  assert.equal(previewKey(spec), previewKey(legacy));
  assert.deepEqual(
    solveScene(spec).actors.map((actor) => actor.pose),
    solveScene(legacy).actors.map((actor) => actor.pose),
  );
  spec.actors[1].jointMode = "fixed";
  assert.notEqual(previewKey(spec), previewKey(legacy));
  const preset = { ...structuredClone(BUILTIN_PRESETS[0]), scene: spec };
  assert.deepEqual(parseCatalog(serializeCatalog([preset])), [
    checkPreset(preset),
  ]);
  for (const value of ["locked", 1, true, [], {}]) {
    spec.actors[1].jointMode = value;
    assert.throws(() => checkScene(spec), /Joint mode/);
    const repaired = validateScene(spec);
    assert.equal(repaired.scene.actors[1].jointMode, "guided");
    assert.ok(
      repaired.issues.some((issue) => /joint mode/.test(issue.message)),
    );
  }
});

test("fixed mode preserves specified channels through contact, seating and collision iterations", () => {
  const spec = chair(),
    guided = solveScene(spec);
  assert.ok(
    Math.abs(guided.actors[1].pose.joints.hip_l.abduction - 65) > 10,
    "fixture must demonstrate that guided IK changes the authored hint",
  );
  spec.actors[1].jointMode = "fixed";
  const original = structuredClone(spec),
    fixed = solveScene(spec);
  for (const [bone, channels] of Object.entries(spec.actors[1].joints))
    for (const [channel, value] of Object.entries(channels))
      assert.equal(
        fixed.actors[1].pose.joints[bone][channel],
        value,
        `${bone}.${channel}`,
      );
  assert.notEqual(
    fixed.actors[1].pose.joints.hip_l.rotation,
    0,
    "an unspecified channel must remain available to the solver",
  );
  assert.deepEqual(spec, original);
  assert.ok(
    fixed.actors.every((actor) =>
      actor.evaluated.positions.flat().every(Number.isFinite),
    ),
  );
});

test("refresh reapplies only fixed channels and clamps direct caller values to joint limits", () => {
  const actor = createActor(
    {
      posture: "standing",
      jointMode: "fixed",
      joints: { elbow_l: { flexion: 60 }, hip_l: { abduction: 90 } },
    },
    0,
  );
  actor.pose.joints.elbow_l = { flexion: 12, abduction: 3, rotation: 9 };
  refresh(actor);
  assert.deepEqual(actor.pose.joints.elbow_l, {
    flexion: 60,
    abduction: 3,
    rotation: 9,
  });
  assert.equal(actor.pose.joints.hip_l.abduction, 70);
  actor.spec.jointMode = "guided";
  actor.pose.joints.elbow_l.flexion = 12;
  refresh(actor);
  assert.equal(actor.pose.joints.elbow_l.flexion, 12);
});

test("incompatible fixed support angles remain fixed and report the resulting support gap", () => {
  const spec = chair();
  spec.support.surface = "table";
  spec.actors = [spec.actors[0]];
  spec.actors[0].jointMode = "fixed";
  // Folded legs cannot span the 750 mm between this seat and the floor,
  // regardless of whole-figure placement or the solver's chosen root tilt.
  spec.actors[0].joints = {
    hip_l: { flexion: 90, abduction: 0 },
    hip_r: { flexion: 90, abduction: 0 },
    knee_l: { flexion: 150 },
    knee_r: { flexion: 150 },
  };
  const solved = solveScene(spec),
    actor = solved.actors[0];
  assert.equal(actor.pose.joints.hip_l.flexion, 90);
  assert.equal(actor.pose.joints.knee_l.flexion, 150);
  assert.ok(
    actor.seatResidual > 0.1,
    `unreported support gap: ${actor.seatResidual}`,
  );
  assert.ok(solvedPreview(solved).issues.includes("Support gap"));
});
