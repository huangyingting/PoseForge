/**
 * Skeleton proportions and forward kinematics.
 *
 * The rig is built from anthropometric ratios rather than from a modelled
 * character, which means its proportions are a claim that can be checked. A
 * skeleton whose hip height is not 53% of its stature is not a stylistic
 * choice, it is a bug, and it will show up later as a figure whose feet do not
 * reach the floor from a chair.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BODY_PRESETS, HIP_HEIGHT_RATIO, Skeleton, evaluatePose } from "../src/core/skeleton.js";
import { v3dist, v3len, v3sub } from "../src/core/math.js";

const bone = (skeleton, evaluated, name) => evaluated.positions[skeleton.boneIndex(name)];

const chainLength = (skeleton, evaluated, names) => {
  let total = 0;
  for (let i = 1; i < names.length; i += 1) {
    total += v3dist(bone(skeleton, evaluated, names[i - 1]), bone(skeleton, evaluated, names[i]));
  }
  return total;
};

test("every preset builds a complete, uniquely named rig", () => {
  for (const preset of Object.keys(BODY_PRESETS)) {
    const skeleton = new Skeleton({ bodyType: preset });
    const names = skeleton.bones.map((b) => b.name);
    assert.equal(new Set(names).size, names.length, `${preset} has duplicate bone names`);
    for (const required of ["pelvis", "head", "ankle_l", "ankle_r", "wrist_l", "wrist_r"]) {
      assert.ok(names.includes(required), `${preset} is missing ${required}`);
    }
    // Every bone but the root must name a parent that comes before it, or the
    // single forward pass in `evaluatePose` reads a stale matrix.
    skeleton.bones.forEach((b, index) => {
      if (index === 0) return assert.equal(b.parentIndex, -1);
      assert.ok(b.parentIndex >= 0 && b.parentIndex < index, `${b.name} has a forward parent`);
    });
  }
});

test("stature scales the whole rig and nothing else", () => {
  const short = new Skeleton({ bodyType: "neutral", stature: 1.5 });
  const tall = new Skeleton({ bodyType: "neutral", stature: 2 });
  const ratio = 2 / 1.5;
  const a = evaluatePose(short, { root: { position: [0, 0, 0] }, joints: short.restPose() });
  const b = evaluatePose(tall, { root: { position: [0, 0, 0] }, joints: tall.restPose() });
  for (const name of ["head", "ankle_l", "wrist_r", "spine02"]) {
    const near = v3len(bone(short, a, name)) * ratio;
    const far = v3len(bone(tall, b, name));
    assert.ok(
      Math.abs(near - far) < 1e-9,
      `${name} did not scale: ${near} vs ${far}`
    );
  }
});

test("hip height is the documented fraction of stature", () => {
  for (const preset of Object.keys(BODY_PRESETS)) {
    const skeleton = new Skeleton({ bodyType: preset });
    const evaluated = evaluatePose(skeleton, {
      root: { position: [0, 0, 0] },
      joints: skeleton.restPose(),
    });
    // Measured from the sole, which is where the ankle's own offset puts the
    // floor - the rig is authored with the pelvis at the origin.
    const hip = bone(skeleton, evaluated, "pelvis")[1];
    const sole = bone(skeleton, evaluated, "ankle_l")[1];
    const ratio = (hip - sole) / skeleton.stature;
    assert.ok(
      Math.abs(ratio - HIP_HEIGHT_RATIO) < 0.06,
      `${preset}: hip height is ${ratio.toFixed(3)} of stature, expected ~${HIP_HEIGHT_RATIO}`
    );
  }
});

test("limbs are symmetric left to right", () => {
  const skeleton = new Skeleton({ bodyType: "female" });
  const evaluated = evaluatePose(skeleton, {
    root: { position: [0, 0, 0] },
    joints: skeleton.restPose(),
  });
  const leg = (side) => chainLength(skeleton, evaluated, [`hip_${side}`, `knee_${side}`, `ankle_${side}`]);
  const arm = (side) =>
    chainLength(skeleton, evaluated, [`shoulder_${side}`, `elbow_${side}`, `wrist_${side}`]);
  assert.ok(Math.abs(leg("l") - leg("r")) < 1e-9, "legs differ in length");
  assert.ok(Math.abs(arm("l") - arm("r")) < 1e-9, "arms differ in length");
  // And mirrored in x, not merely equal in length.
  const left = bone(skeleton, evaluated, "ankle_l");
  const right = bone(skeleton, evaluated, "ankle_r");
  assert.ok(Math.abs(left[0] + right[0]) < 1e-9, "ankles are not mirrored in x");
  assert.ok(Math.abs(left[1] - right[1]) < 1e-9, "ankles are at different heights");
});

test("a standing rig is about as tall as its stature says", () => {
  for (const preset of Object.keys(BODY_PRESETS)) {
    const skeleton = new Skeleton({ bodyType: preset });
    const evaluated = evaluatePose(skeleton, {
      root: { position: [0, 0, 0] },
      joints: skeleton.restPose(),
    });
    const top = bone(skeleton, evaluated, "headTop")[1];
    const sole = bone(skeleton, evaluated, "ankle_l")[1];
    const height = top - sole;
    // The skeleton stops at the ankle joint and the crown of the skull, so it
    // is a little short of the standing height by the thickness of a heel.
    const shortfall = skeleton.stature - height;
    assert.ok(
      shortfall > 0 && shortfall < 0.12,
      `${preset}: rig spans ${height.toFixed(3)} against a stature of ${skeleton.stature}`
    );
  }
});

test("build changes girth without changing where the joints are", () => {
  const slim = new Skeleton({ bodyType: "female", build: 0.85 });
  const heavy = new Skeleton({ bodyType: "female", build: 1.2 });
  assert.equal(slim.stature, heavy.stature);
  const a = evaluatePose(slim, { root: { position: [0, 0, 0] }, joints: slim.restPose() });
  const b = evaluatePose(heavy, { root: { position: [0, 0, 0] }, joints: heavy.restPose() });
  for (const name of ["ankle_l", "wrist_r", "head"]) {
    assert.ok(
      v3dist(bone(slim, a, name), bone(heavy, b, name)) < 1e-9,
      `${name} moved when only the build changed`
    );
  }
});

test("clampAngles keeps joints inside their range and passes valid ones through", () => {
  const skeleton = new Skeleton({ bodyType: "neutral" });
  const wide = skeleton.clampAngles("knee_l", { flexion: 9999, abduction: 9999, rotation: 9999 });
  const narrow = skeleton.clampAngles("knee_l", { flexion: -9999, abduction: -9999, rotation: -9999 });
  assert.ok(wide.flexion < 9999 && narrow.flexion > -9999, "knee flexion is unbounded");
  assert.ok(wide.flexion > narrow.flexion, "clamp range is inverted");
  // A knee is very nearly a hinge. It has a few degrees of play off-axis and
  // the rig keeps them, but asking for a right angle of knee abduction has to
  // come back as almost nothing.
  assert.ok(Math.abs(wide.abduction) <= 10, `knee abducts to ${wide.abduction}`);
  assert.ok(Math.abs(wide.rotation) <= 20, `knee rotates to ${wide.rotation}`);
  // A knee does not hyperextend.
  assert.ok(narrow.flexion >= 0, `knee flexes back to ${narrow.flexion}`);
  // A hip is not a hinge, and must not be clamped as though it were.
  const hip = skeleton.clampAngles("hip_l", { flexion: 9999, abduction: 9999, rotation: 9999 });
  assert.ok(hip.abduction > 30, `hip abducts only to ${hip.abduction}`);

  const fine = { flexion: 20, abduction: 0, rotation: 0 };
  assert.deepEqual(skeleton.clampAngles("knee_l", fine), fine);
});

test("posing a joint moves its descendants and leaves its ancestors alone", () => {
  const skeleton = new Skeleton({ bodyType: "male" });
  const rest = skeleton.restPose();
  const before = evaluatePose(skeleton, { root: { position: [0, 0, 0] }, joints: rest });

  const posed = { ...rest, knee_l: { flexion: 60, abduction: 0, rotation: 0 } };
  const after = evaluatePose(skeleton, { root: { position: [0, 0, 0] }, joints: posed });

  assert.ok(
    v3dist(bone(skeleton, before, "ankle_l"), bone(skeleton, after, "ankle_l")) > 0.05,
    "bending the knee did not move the ankle"
  );
  for (const untouched of ["pelvis", "hip_l", "knee_l", "ankle_r", "head"]) {
    assert.ok(
      v3dist(bone(skeleton, before, untouched), bone(skeleton, after, untouched)) < 1e-9,
      `${untouched} moved when only knee_l was posed`
    );
  }
  // Bending a hinge cannot change the length of the segment below it.
  const was = v3len(v3sub(bone(skeleton, before, "ankle_l"), bone(skeleton, before, "knee_l")));
  const now = v3len(v3sub(bone(skeleton, after, "ankle_l"), bone(skeleton, after, "knee_l")));
  assert.ok(Math.abs(was - now) < 1e-9, "the shin changed length");
});

test("the root transform moves the whole body rigidly", () => {
  const skeleton = new Skeleton({ bodyType: "female" });
  const joints = skeleton.restPose();
  const origin = evaluatePose(skeleton, { root: { position: [0, 0, 0] }, joints });
  const moved = evaluatePose(skeleton, { root: { position: [1, 2, -3] }, joints });
  for (const name of skeleton.bones.map((b) => b.name)) {
    const a = bone(skeleton, origin, name);
    const b = bone(skeleton, moved, name);
    assert.ok(
      Math.abs(b[0] - a[0] - 1) < 1e-9 &&
        Math.abs(b[1] - a[1] - 2) < 1e-9 &&
        Math.abs(b[2] - a[2] + 3) < 1e-9,
      `${name} did not translate rigidly`
    );
  }
});
