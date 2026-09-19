/**
 * Inverse kinematics.
 *
 * The IK is what turns a declared contact - a hand here, a foot on the floor -
 * into joint angles, so its accuracy is the accuracy of every pose above it. It
 * is also the one piece that is allowed to fail: a target beyond the arm's
 * reach has no answer, and the contract is that it says so in `error` and
 * `unreachable` rather than quietly producing a dislocated elbow. Both halves
 * are checked here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Skeleton, evaluatePose } from "../src/core/skeleton.js";
import {
  LIMB_CHAINS,
  blendAngles,
  chainReach,
  defaultPole,
  scaleQuaternion,
  solveAim,
  solveTwoBoneIK,
} from "../src/core/ik.js";
import {
  DEG,
  quatAngle,
  quatFromAxisAngle,
  v3add,
  v3cross,
  v3dist,
  v3dot,
  v3len,
  v3mul,
  v3normalize,
  v3sub,
} from "../src/core/math.js";

const rig = (bodyType = "female") => {
  const skeleton = new Skeleton({ bodyType });
  const pose = { root: { position: [0, 0, 0] }, joints: skeleton.restPose() };
  return { skeleton, pose, evaluated: evaluatePose(skeleton, pose) };
};

const at = (skeleton, evaluated, name) => evaluated.positions[skeleton.boneIndex(name)];

/** A target the chain can definitely hit: part-way out along a real direction. */
const reachableTarget = (skeleton, evaluated, chain, direction, fraction = 0.6) => {
  const root = at(skeleton, evaluated, chain.root);
  return v3add(root, v3mul(v3normalize(direction), chainReach(skeleton, chain) * fraction));
};

test("every limb chain names bones that exist and are in order", () => {
  const { skeleton } = rig();
  for (const [key, chain] of Object.entries(LIMB_CHAINS)) {
    const root = skeleton.boneIndex(chain.root);
    const mid = skeleton.boneIndex(chain.mid);
    const end = skeleton.boneIndex(chain.end);
    assert.ok(root >= 0 && mid >= 0 && end >= 0, `${key} names a missing bone`);
    // The analytic solution assumes root -> mid -> end is an unbroken parent
    // line; a gap would make `bone.length` the wrong segment.
    assert.equal(skeleton.bones[mid].parentIndex, root, `${key}: mid is not a child of root`);
    assert.equal(skeleton.bones[end].parentIndex, mid, `${key}: end is not a child of mid`);
    assert.ok(chainReach(skeleton, chain) > 0.1, `${key} reaches only ${chainReach(skeleton, chain)}`);
  }
});

test("a reachable target is hit to within a millimetre", () => {
  const { skeleton, pose, evaluated } = rig();
  // Directions chosen to be plainly in front of, below and beside each chain,
  // so nothing here is testing the range-of-motion limits by accident.
  const directions = {
    armL: [0.4, -0.6, 0.6],
    armR: [-0.4, -0.6, 0.6],
    legL: [0.2, -0.9, 0.3],
    legR: [-0.2, -0.9, 0.3],
  };
  for (const [key, chain] of Object.entries(LIMB_CHAINS)) {
    const target = reachableTarget(skeleton, evaluated, chain, directions[key]);
    const working = { root: pose.root, joints: { ...pose.joints } };
    const result = solveTwoBoneIK(skeleton, working, chain, target);
    assert.ok(result.ok, `${key} reported failure: ${JSON.stringify(result)}`);
    assert.ok(
      result.error < 0.001,
      `${key} missed by ${(result.error * 1000).toFixed(1)}mm`
    );
    // The reported `achieved` has to be the pose that was actually written,
    // not an intermediate the caller cannot reproduce.
    const check = evaluatePose(skeleton, working);
    assert.ok(
      v3dist(check.positions[skeleton.boneIndex(chain.end)], result.achieved) < 1e-9,
      `${key}: achieved does not match the written pose`
    );
  }
});

test("segment lengths survive the solve", () => {
  const { skeleton, pose, evaluated } = rig("male");
  const chain = LIMB_CHAINS.armL;
  const before = {
    upper: v3dist(at(skeleton, evaluated, chain.root), at(skeleton, evaluated, chain.mid)),
    lower: v3dist(at(skeleton, evaluated, chain.mid), at(skeleton, evaluated, chain.end)),
  };
  const target = reachableTarget(skeleton, evaluated, chain, [0.5, -0.3, 0.8], 0.85);
  const working = { root: pose.root, joints: { ...pose.joints } };
  const after = solveTwoBoneIK(skeleton, working, chain, target).evaluated;
  const now = {
    upper: v3dist(at(skeleton, after, chain.root), at(skeleton, after, chain.mid)),
    lower: v3dist(at(skeleton, after, chain.mid), at(skeleton, after, chain.end)),
  };
  assert.ok(Math.abs(before.upper - now.upper) < 1e-9, "the upper arm changed length");
  assert.ok(Math.abs(before.lower - now.lower) < 1e-9, "the forearm changed length");
});

test("an out-of-reach target says so instead of pretending", () => {
  const { skeleton, pose, evaluated } = rig();
  const chain = LIMB_CHAINS.armR;
  const root = at(skeleton, evaluated, chain.root);
  const reach = chainReach(skeleton, chain);
  const target = v3add(root, [0, 0, reach * 3]);
  const working = { root: pose.root, joints: { ...pose.joints } };
  const result = solveTwoBoneIK(skeleton, working, chain, target);

  assert.equal(result.unreachable, true, "a target at three times the reach was called reachable");
  assert.equal(result.ok, false);
  // The residual is honest: roughly the two reaches' difference, not zero.
  assert.ok(result.error > reach, `error ${result.error} is implausibly small for the miss`);
  // And the arm is stretched toward it, not folded away from it or dislocated.
  const end = at(skeleton, result.evaluated, chain.end);
  assert.ok(
    v3len(v3sub(end, root)) > reach * 0.95,
    "the arm did not extend toward an unreachable target"
  );
});

test("a target closer than the folded limb clamps rather than inverting", () => {
  const { skeleton, pose, evaluated } = rig();
  const chain = LIMB_CHAINS.legL;
  const root = at(skeleton, evaluated, chain.root);
  // A centimetre below the hip: far inside the shortest distance a folded leg
  // can manage, which is where a naive law of cosines produces NaN.
  const target = v3add(root, [0, -0.01, 0]);
  const working = { root: pose.root, joints: { ...pose.joints } };
  const result = solveTwoBoneIK(skeleton, working, chain, target);
  for (const joint of [chain.root, chain.mid]) {
    for (const value of Object.values(working.joints[joint])) {
      assert.ok(Number.isFinite(value), `${joint} produced ${value}`);
    }
  }
  assert.ok(Number.isFinite(result.error), "error is not a number");
  // The knee is folded as far as it will go, which is the right answer here.
  assert.ok(working.joints[chain.mid].flexion > 100, `knee only reached ${working.joints[chain.mid].flexion}`);
});

test("the pole hint decides which way the elbow points", () => {
  const { skeleton, pose, evaluated } = rig();
  // A two-bone chain has a whole circle of solutions for any reachable target.
  // The pole is the only thing that chooses between them, so a hint that makes
  // no difference means the elbow is going wherever the seeding happens to
  // land it - which is how arms end up bending through the ribcage.
  for (const [key, direction] of [
    ["armL", [0.3, -0.5, 0.7]],
    ["legL", [0.2, -0.85, 0.45]],
  ]) {
    const chain = LIMB_CHAINS[key];
    const root = at(skeleton, evaluated, chain.root);
    const target = reachableTarget(skeleton, evaluated, chain, direction, 0.7);
    // Two genuinely opposed hints: perpendicular to the root->target axis, so
    // neither is asking the joint to point along the axis it cannot swing
    // about. The pole is a direction, not a point in space.
    const spin = v3normalize(v3cross(v3normalize(v3sub(target, root)), [0, 1, 0]));

    const run = (pole) => {
      const working = { root: pose.root, joints: { ...pose.joints } };
      const result = solveTwoBoneIK(skeleton, working, chain, target, { pole });
      return { mid: at(skeleton, result.evaluated, chain.mid), error: result.error };
    };
    const one = run(spin);
    const other = run(v3mul(spin, -1));

    // Both still hit the target: the pole picks among solutions, it does not
    // trade accuracy away.
    assert.ok(one.error < 0.005 && other.error < 0.005, `${key}: a pole hint cost accuracy`);
    assert.ok(
      v3dist(one.mid, other.mid) > 0.1,
      `${key}: opposed pole hints put the joint ${(v3dist(one.mid, other.mid) * 1000).toFixed(0)}mm apart`
    );
  }
});

test("the default pole puts knees forward and elbows back", () => {
  const { skeleton, evaluated } = rig();
  // The rest pose faces +z, so "forward" is +z in world space here.
  assert.ok(v3dot(defaultPole(LIMB_CHAINS.legL, evaluated, skeleton), [0, 0, 1]) > 0.5, "knee pole is not forward");
  assert.ok(v3dot(defaultPole(LIMB_CHAINS.armL, evaluated, skeleton), [0, 0, 1]) < -0.5, "elbow pole is not back");
  // And out to the correct side, which is what keeps arms from crossing.
  assert.ok(v3dot(defaultPole(LIMB_CHAINS.armL, evaluated, skeleton), [1, 0, 0]) > 0, "left elbow points right");
  assert.ok(v3dot(defaultPole(LIMB_CHAINS.armR, evaluated, skeleton), [1, 0, 0]) < 0, "right elbow points left");
});

test("weight blends between the old pose and the solved one", () => {
  const { skeleton, pose, evaluated } = rig();
  const chain = LIMB_CHAINS.armR;
  const target = reachableTarget(skeleton, evaluated, chain, [-0.5, -0.4, 0.7], 0.75);

  const full = { root: pose.root, joints: { ...pose.joints } };
  solveTwoBoneIK(skeleton, full, chain, target, { weight: 1 });
  const none = { root: pose.root, joints: { ...pose.joints } };
  const untouched = solveTwoBoneIK(skeleton, none, chain, target, { weight: 0 });
  const half = { root: pose.root, joints: { ...pose.joints } };
  solveTwoBoneIK(skeleton, half, chain, target, { weight: 0.5 });

  // Weight 0 leaves the pose exactly as it was, and reports the error of the
  // pose it left behind rather than of the solution it discarded.
  assert.deepEqual(none.joints[chain.root], pose.joints[chain.root]);
  const rest = v3dist(at(skeleton, evaluated, chain.end), target);
  assert.ok(Math.abs(untouched.error - rest) < 1e-9, "weight 0 reported the solved error");

  for (const axis of ["flexion", "abduction", "rotation"]) {
    const a = pose.joints[chain.root][axis];
    const b = full.joints[chain.root][axis];
    assert.ok(
      Math.abs(half.joints[chain.root][axis] - (a + b) / 2) < 1e-9,
      `${axis} did not land halfway`
    );
  }
});

test("blendAngles and scaleQuaternion interpolate the way the solver assumes", () => {
  const a = { flexion: 10, abduction: -20, rotation: 4 };
  const b = { flexion: 30, abduction: 20, rotation: -4 };
  assert.deepEqual(blendAngles(a, b, 0), a);
  assert.deepEqual(blendAngles(a, b, 1), b);
  assert.deepEqual(blendAngles(a, b, 0.5), { flexion: 20, abduction: 0, rotation: 0 });

  const q = quatFromAxisAngle(v3normalize([0.2, 1, -0.3]), 80 * DEG);
  assert.ok(Math.abs(quatAngle(scaleQuaternion(q, 0.25)) - 20 * DEG) < 1e-9, "quarter turn is wrong");
  assert.ok(quatAngle(scaleQuaternion(q, 0)) < 1e-9, "scaling to zero is not the identity");
  assert.ok(Math.abs(quatAngle(scaleQuaternion(q, 1)) - 80 * DEG) < 1e-9, "scaling to one changed the angle");
});

test("solveAim turns the head toward a target without spinning the body", () => {
  const { skeleton, pose } = rig();
  const working = { root: pose.root, joints: { ...pose.joints } };
  const before = evaluatePose(skeleton, working);
  const head = skeleton.boneIndex("head");
  const origin = before.positions[head];
  // Well off to the actor's left and a little down: a turn no single joint in
  // the neck could make alone.
  const target = v3add(origin, [1.2, -0.3, 0.6]);

  const after = solveAim(skeleton, working, ["neck", "head"], [0.4, 0.8], target);
  const toTarget = v3normalize(v3sub(target, after.positions[head]));

  const gaze = (evaluated) => {
    const m = evaluated.matrices[head];
    // The rig's local forward for a head is +y, the axis `solveAim` defaults to.
    return v3normalize([m[4], m[5], m[6]]);
  };
  assert.ok(
    v3dot(gaze(after), toTarget) > v3dot(gaze(before), toTarget) + 0.2,
    "the head did not turn toward the target"
  );
  // The pelvis is not in the chain and must not have moved.
  assert.ok(
    v3dist(before.positions[skeleton.boneIndex("pelvis")], after.positions[skeleton.boneIndex("pelvis")]) < 1e-9,
    "aiming the head moved the pelvis"
  );
});
