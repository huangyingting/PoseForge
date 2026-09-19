/**
 * Inverse kinematics in anatomical angle space.
 *
 * The solver never writes raw quaternions into the pose. Every IK result is
 * decomposed back into flexion / abduction / rotation and clamped to the
 * joint's range of motion, so a contact constraint can never produce a
 * hyperextended elbow or a knee that bends sideways.
 *
 * The angle composition is q = Rx(sf*flexion) * Rz(sa*abduction) * Ry(sr*rotation),
 * an intrinsic X-Z-Y Euler sequence whose per-channel signs come from the
 * bone's anatomical axes. `anglesFromQuaternion` is its exact inverse.
 */

import {
  DEG,
  RAD,
  clamp,
  quatFromAxisAngle,
  quatIdentity,
  quatMultiply,
  quatNormalize,
  quatRotate,
  quatFromUnitVectors,
  v3add,
  v3cross,
  v3dot,
  v3len,
  v3lenSq,
  v3mul,
  v3normalize,
  v3sub,
} from "./math.js";
import { evaluatePose } from "./skeleton.js";

/** Per-channel sign of a bone's anatomical axes. */
function channelSigns(bone) {
  return {
    flexion: bone.axes.flexion[0] || 1,
    abduction: bone.axes.abduction[2] || 1,
    rotation: bone.axes.rotation[1] || 1,
  };
}

/** Rotation matrix (row-major 3x3 as a flat 9 array) from a quaternion. */
function matrixFromQuat(q) {
  const [x, y, z, w] = quatNormalize(q);
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  return [
    1 - (y * y2 + z * z2), x * y2 - w * z2, x * z2 + w * y2,
    x * y2 + w * z2, 1 - (x * x2 + z * z2), y * z2 - w * x2,
    x * z2 - w * y2, y * z2 + w * x2, 1 - (x * x2 + y * y2),
  ];
}

/**
 * Exact inverse of `Skeleton.quaternionFromAngles`.
 *
 * An X-Z-Y Euler triple has two representations of the same rotation:
 * `(a, b, c)` and `(a+180, 180-b, c+180)`. `asin` only ever returns the first,
 * whose middle channel is capped at +/-90 degrees - not enough for a shoulder,
 * which abducts to 165. Both branches are therefore evaluated and the one that
 * fits the joint's range of motion wins.
 *
 * @returns {{flexion:number, abduction:number, rotation:number}} degrees
 */
export function anglesFromQuaternion(skeleton, boneName, q) {
  const bone = skeleton.bone(boneName);
  const signs = channelSigns(bone);
  const m = matrixFromQuat(q);
  // m = Rx(a) Rz(b) Ry(c); see the derivation in the module header.
  const m01 = m[1];
  const m00 = m[0];
  const m02 = m[2];
  const m11 = m[4];
  const m21 = m[7];

  const b = Math.asin(clamp(-m01, -1, 1));
  let a;
  let c;
  if (Math.abs(m01) < 0.9999) {
    c = Math.atan2(m02, m00);
    a = Math.atan2(m21, m11);
  } else {
    // gimbal lock: fold the rotation into the flexion channel
    c = 0;
    a = Math.atan2(-m[5], m[8]);
  }

  const toChannels = (ax, bx, cx) => ({
    flexion: (ax * RAD) / signs.flexion,
    abduction: (bx * RAD) / signs.abduction,
    rotation: (cx * RAD) / signs.rotation,
  });

  const primary = toChannels(a, b, c);
  const alternate = toChannels(
    wrapPi(a + Math.PI),
    wrapPi(Math.PI - b),
    wrapPi(c + Math.PI)
  );
  return romViolation(bone, alternate) < romViolation(bone, primary) - 1e-6
    ? alternate
    : primary;
}

/** Total degrees by which an angle triple exceeds a joint's range of motion. */
function romViolation(bone, angles) {
  const { rom } = bone;
  let total = 0;
  for (const channel of ["flexion", "abduction", "rotation"]) {
    const value = angles[channel];
    const [min, max] = rom[channel];
    if (value < min) total += min - value;
    else if (value > max) total += value - max;
  }
  return total;
}

function wrapPi(angle) {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}

/** Rotation part of a 4x4 matrix applied to a vector. */
function rotateByMatrix(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

/** Inverse-rotate a vector by the rotation part of a rigid 4x4 matrix. */
function inverseRotateByMatrix(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

/** The four limb chains every actor has. */
export const LIMB_CHAINS = {
  armL: { root: "shoulder_l", mid: "elbow_l", end: "wrist_l", tip: "hand_l", kind: "arm", side: 1 },
  armR: { root: "shoulder_r", mid: "elbow_r", end: "wrist_r", tip: "hand_r", kind: "arm", side: -1 },
  legL: { root: "hip_l", mid: "knee_l", end: "ankle_l", tip: "toe_l", kind: "leg", side: 1 },
  legR: { root: "hip_r", mid: "knee_r", end: "ankle_r", tip: "toe_r", kind: "leg", side: -1 },
};

/**
 * Default pole direction (world space) for a chain, derived from the actor's
 * own orientation: elbows point back and out, knees point forward.
 */
export function defaultPole(chain, evaluated, skeleton) {
  const pelvis = evaluated.matrices[skeleton.boneIndex("pelvis")];
  const forward = v3normalize(rotateByMatrix(pelvis, [0, 0, 1]));
  const lateral = v3normalize(rotateByMatrix(pelvis, [chain.side, 0, 0]));
  return chain.kind === "arm"
    ? v3normalize(v3add(v3mul(forward, -1), v3mul(lateral, 0.55)))
    : v3normalize(v3add(forward, v3mul(lateral, 0.2)));
}

/**
 * Analytic two-bone IK.
 *
 * Writes clamped anatomical angles for the chain's root and mid joints into
 * `pose.joints` and returns a report including the residual error, which the
 * collision solver uses to decide whether a contact was actually satisfiable.
 *
 * @param {import("./skeleton.js").Skeleton} skeleton
 * @param {object} pose mutated in place
 * @param {object} chain one of `LIMB_CHAINS`
 * @param {number[]} target world-space position for the chain's end joint
 * @param {object} [options]
 * @param {number[]} [options.pole] world-space pole hint
 * @param {number} [options.weight] 0..1 blend toward the IK result
 * @param {object} [options.evaluated] pre-evaluated pose to avoid recomputing
 */
export function solveTwoBoneIK(skeleton, pose, chain, target, options = {}) {
  const { pole, weight = 1, softLimit = 0.999 } = options;
  const baseEvaluated = options.evaluated ?? evaluatePose(skeleton, pose);

  const rootBone = skeleton.bone(chain.root);
  const midBone = skeleton.bone(chain.mid);
  const endBone = skeleton.bone(chain.end);
  const l1 = midBone.length;
  const l2 = endBone.length;

  const rootIndex = skeleton.boneIndex(chain.root);
  const endIndex = skeleton.boneIndex(chain.end);
  const parentMatrix =
    rootBone.parentIndex >= 0 ? baseEvaluated.matrices[rootBone.parentIndex] : null;
  const rootWorld = baseEvaluated.positions[rootIndex];

  // Target expressed in the root joint's parent frame, relative to the joint.
  const localTarget = parentMatrix
    ? inverseRotateByMatrix(parentMatrix, v3sub(target, rootWorld))
    : v3sub(target, rootWorld);

  const reach = l1 + l2;
  const minReach = Math.abs(l1 - l2) + 1e-4;
  const rawDistance = v3len(localTarget);
  const distance = clamp(rawDistance, minReach, reach * softLimit);
  const unreachable = rawDistance > reach * softLimit;

  // 1. mid joint bend from the law of cosines
  const cosInterior = clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2), -1, 1);
  const bend = Math.PI - Math.acos(cosInterior);
  const midAngles = skeleton.clampAngles(chain.mid, {
    flexion: bend * RAD,
    abduction: pose.joints[chain.mid]?.abduction ?? 0,
    rotation: pose.joints[chain.mid]?.rotation ?? 0,
  });

  // 2. where the end joint lands with the root joint at identity
  const midQuat = skeleton.quaternionFromAngles(chain.mid, midAngles);
  const restEnd = v3add(midBone.offset, quatRotate(midQuat, endBone.offset));
  if (v3lenSq(restEnd) < 1e-12 || v3lenSq(localTarget) < 1e-12) {
    return { ok: false, reason: "degenerate", error: rawDistance, evaluated: baseEvaluated };
  }

  const previousRoot = pose.joints[chain.root] ?? { flexion: 0, abduction: 0, rotation: 0 };
  const previousMid = pose.joints[chain.mid] ?? { flexion: 0, abduction: 0, rotation: 0 };
  const axis = v3normalize(localTarget);
  const swingOnly = quatFromUnitVectors(v3normalize(restEnd), axis);

  /**
   * One full attempt for a given pole hint: analytic placement, Euler clamp,
   * then damped CCD refinement on the root joint. Returns the best angles it
   * reached without mutating `pose`.
   */
  const attempt = (poleWorld) => {
    let rootQuat = swingOnly;
    if (poleWorld) {
      const poleLocal = parentMatrix ? inverseRotateByMatrix(parentMatrix, poleWorld) : poleWorld;
      const currentPerp = perpendicularComponent(quatRotate(rootQuat, midBone.offset), axis);
      const desiredPerp = perpendicularComponent(poleLocal, axis);
      if (v3lenSq(currentPerp) > 1e-10 && v3lenSq(desiredPerp) > 1e-10) {
        const from = v3normalize(currentPerp);
        const to = v3normalize(desiredPerp);
        const angle = Math.atan2(v3dot(v3cross(from, to), axis), clamp(v3dot(from, to), -1, 1));
        rootQuat = quatMultiply(quatFromAxisAngle(axis, angle), rootQuat);
      }
    }

    let angles = skeleton.clampAngles(chain.root, anglesFromQuaternion(skeleton, chain.root, rootQuat));
    let evaluated = evaluatePose(skeleton, {
      ...pose,
      joints: { ...pose.joints, [chain.root]: angles, [chain.mid]: midAngles },
    });
    let error = v3len(v3sub(evaluated.positions[endIndex], target));

    // Clamping happens in Euler space, so it can pull the end joint off a
    // target that twist about the root->end axis would otherwise reach for
    // free. Refine with CCD; a damped line search gets past ROM corners where
    // a full step would overshoot and stall.
    for (let pass = 0; pass < 12 && error > 1e-4; pass += 1) {
      const parent = rootBone.parentIndex >= 0 ? evaluated.matrices[rootBone.parentIndex] : null;
      const origin = evaluated.positions[rootIndex];
      const from = v3sub(evaluated.positions[endIndex], origin);
      const to = v3sub(target, origin);
      if (v3lenSq(from) < 1e-12 || v3lenSq(to) < 1e-12) break;

      const swingWorld = quatFromUnitVectors(v3normalize(from), v3normalize(to));
      const axisLocal = parent
        ? inverseRotateByMatrix(parent, [swingWorld[0], swingWorld[1], swingWorld[2]])
        : [swingWorld[0], swingWorld[1], swingWorld[2]];
      const swingLocal = quatNormalize([axisLocal[0], axisLocal[1], axisLocal[2], swingWorld[3]]);
      const current = skeleton.quaternionFromAngles(chain.root, angles);

      let improved = false;
      for (const step of [1, 0.5, 0.25]) {
        const combined = quatMultiply(scaleQuaternion(swingLocal, step), current);
        const next = skeleton.clampAngles(chain.root, anglesFromQuaternion(skeleton, chain.root, combined));
        const candidate = evaluatePose(skeleton, {
          ...pose,
          joints: { ...pose.joints, [chain.root]: next, [chain.mid]: midAngles },
        });
        const candidateError = v3len(v3sub(candidate.positions[endIndex], target));
        if (candidateError < error - 1e-6) {
          angles = next;
          evaluated = candidate;
          error = candidateError;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    return { angles, evaluated, error };
  };

  // Seed from the caller's pole, the anatomical default, and two orthogonal
  // fallbacks. Hitting the target matters more than honouring the hint, so the
  // lowest-error attempt wins; ties keep the earliest (most preferred) seed.
  const defaultPoleWorld = defaultPole(chain, baseEvaluated, skeleton);
  const perpendicular = v3normalize(v3cross(axis, [0, 1, 0]));
  const seeds = [pole, defaultPoleWorld];
  if (v3lenSq(perpendicular) > 1e-8) {
    seeds.push(perpendicular, v3mul(perpendicular, -1));
  }
  seeds.push(null);

  let best = null;
  for (const seed of seeds) {
    if (seed === undefined) continue;
    const result = attempt(seed);
    if (!best || result.error < best.error - 1e-5) best = result;
    if (best.error < 1e-4) break;
  }

  let { angles: rootAngles, evaluated, error } = best;
  pose.joints[chain.root] = rootAngles;
  pose.joints[chain.mid] = midAngles;

  if (weight < 1) {
    pose.joints[chain.root] = blendAngles(previousRoot, rootAngles, weight);
    pose.joints[chain.mid] = blendAngles(previousMid, midAngles, weight);
    evaluated = evaluatePose(skeleton, pose);
    error = v3len(v3sub(evaluated.positions[endIndex], target));
  }

  return {
    ok: !unreachable && error < 0.03,
    error,
    unreachable,
    evaluated,
    achieved: evaluated.positions[endIndex],
  };
}

function perpendicularComponent(v, axis) {
  return v3sub(v, v3mul(axis, v3dot(v, axis)));
}

export function blendAngles(a, b, t) {
  return {
    flexion: a.flexion + (b.flexion - a.flexion) * t,
    abduction: a.abduction + (b.abduction - a.abduction) * t,
    rotation: a.rotation + (b.rotation - a.rotation) * t,
  };
}

/**
 * Point a bone's local `forward` axis at a world target, spreading the
 * rotation across several joints (used for head/neck gaze and spine leans).
 *
 * @param {string[]} boneNames ordered proximal -> distal
 * @param {number[]} weights fraction of the correction each bone absorbs
 */
export function solveAim(skeleton, pose, boneNames, weights, target, localForward = [0, 1, 0]) {
  let evaluated = evaluatePose(skeleton, pose);
  for (let i = 0; i < boneNames.length; i += 1) {
    const name = boneNames[i];
    const index = skeleton.boneIndex(name);
    const bone = skeleton.bones[index];
    const matrix = evaluated.matrices[index];
    const origin = [matrix[12], matrix[13], matrix[14]];
    const currentWorld = v3normalize(rotateByMatrix(matrix, localForward));
    const desiredWorld = v3normalize(v3sub(target, origin));
    if (v3lenSq(desiredWorld) < 1e-10) break;

    const swingWorld = quatFromUnitVectors(currentWorld, desiredWorld);
    const parentMatrix = bone.parentIndex >= 0 ? evaluated.matrices[bone.parentIndex] : null;
    // Convert the world-space swing into the bone's parent frame.
    const axisWorld = [swingWorld[0], swingWorld[1], swingWorld[2]];
    const axisLocal = parentMatrix ? inverseRotateByMatrix(parentMatrix, axisWorld) : axisWorld;
    const swingLocal = quatNormalize([axisLocal[0], axisLocal[1], axisLocal[2], swingWorld[3]]);

    const current = skeleton.quaternionFromAngles(name, pose.joints[name] ?? {});
    const scaled = scaleQuaternion(swingLocal, weights[i] ?? 1);
    const combined = quatMultiply(scaled, current);
    pose.joints[name] = skeleton.clampAngles(name, anglesFromQuaternion(skeleton, name, combined));
    evaluated = evaluatePose(skeleton, pose);
  }
  return evaluated;
}

/** Scale a rotation's angle while keeping its axis. */
export function scaleQuaternion(q, t) {
  if (t >= 0.999) return q;
  return quatSlerpIdentity(q, t);
}

function quatSlerpIdentity(q, t) {
  const normalized = quatNormalize(q);
  const w = clamp(normalized[3], -1, 1);
  const angle = 2 * Math.acos(Math.abs(w));
  if (angle < 1e-6) return quatIdentity();
  const sign = w < 0 ? -1 : 1;
  const axis = v3normalize([normalized[0] * sign, normalized[1] * sign, normalized[2] * sign]);
  return quatFromAxisAngle(axis, angle * t);
}

/**
 * How far a chain can reach from its root joint, in metres.
 * Callers use this to detect contacts that are geometrically impossible before
 * wasting solver iterations on them.
 */
export function chainReach(skeleton, chain) {
  return skeleton.bone(chain.mid).length + skeleton.bone(chain.end).length;
}

export { DEG };
