/** Bounded, support-preserving pose candidates for nearby standing contacts. */
import { refresh } from "./solver.js";
import { anglesFromQuaternion, LIMB_CHAINS, solveTwoBoneIK } from "./ik.js";
import { orientationFromAxes } from "./poseLibrary.js";
import {
  clamp,
  mat4InvertRigid,
  mat4Multiply,
  mat4TransformDirection,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatMultiply,
  v3normalize,
  v3sub,
} from "./math.js";

const legs = [LIMB_CHAINS.legL, LIMB_CHAINS.legR];
const arms = [LIMB_CHAINS.armL, LIMB_CHAINS.armR];

/** Keep cumulative corrections bounded when one figure has several contacts. */
export function standingFramePreserved(actor, baseline) {
  const root = actor.pose.root.position;
  if (
    Math.hypot(root[0] - baseline.root[0], root[2] - baseline.root[2]) > 0.04 ||
    root[1] < baseline.root[1] - 0.02 ||
    root[1] > baseline.root[1] + 1e-7
  )
    return false;
  return [...legs, ...arms].every((chain) => {
    const index = actor.skeleton.boneIndex(chain.end),
      current = actor.evaluated.matrices[index],
      old = baseline.evaluated.matrices[index];
    if (
      current.slice(0, 12).some((value, k) => Math.abs(value - old[k]) > 0.0005)
    )
      return false;
    if (arms.includes(chain))
      return (
        Math.hypot(
          ...current.slice(12, 15).map((value, k) => value - old[12 + k]),
        ) <= 0.0005
      );
    return (
      Math.abs(current[13] - old[13]) <= 0.0005 &&
      Math.hypot(current[12] - old[12], current[14] - old[14]) <= 0.07
    );
  });
}

/** Each yielded pose is independent of the actor and all preceding candidates.
 * Null candidates failed reach/frame constraints but still consume work. */
export function* standingContactPoses(actor, lower, upper) {
  if (
    actor.mobility <= 0 ||
    actor.carried ||
    actor.posture.supports.length !== 2 ||
    !actor.posture.supports.every((support) => support.landmark === "foot") ||
    new Set(actor.posture.supports.map((support) => support.side)).size !== 2 ||
    [...legs, ...arms].some((chain) => actor.spec?.joints?.[chain.end])
  )
    return;
  const evaluation = actor.evaluated;
  const pelvis = evaluation.matrices[actor.skeleton.boneIndex("pelvis")];
  if (pelvis[5] < 0.85) return;
  const base = structuredClone(actor.pose);
  const move = lower.to.map((value, axis) =>
    axis === 1 ? 0 : value - lower.from[axis],
  );
  const distance = Math.hypot(...move);
  if (distance < 1e-6 || distance > 0.04) return;
  const away = v3normalize(move.map((value) => -value));
  const lateral = v3normalize([pelvis[0], 0, pelvis[2]]);

  function endFrame(trial, chain, position) {
    const index = trial.skeleton.boneIndex(chain.end),
      old = evaluation.matrices[index];
    solveTwoBoneIK(trial.skeleton, trial.pose, chain, position, {
      evaluated: trial.evaluated,
      pole: v3sub(
        evaluation.positions[trial.skeleton.boneIndex(chain.mid)],
        evaluation.positions[trial.skeleton.boneIndex(chain.root)],
      ),
    });
    refresh(trial);
    const parent =
      trial.evaluated.matrices[trial.skeleton.bone(chain.end).parentIndex];
    const local = mat4Multiply(mat4InvertRigid(parent), old);
    trial.pose.joints[chain.end] = trial.skeleton.clampAngles(
      chain.end,
      anglesFromQuaternion(
        trial.skeleton,
        chain.end,
        orientationFromAxes(local.slice(4, 7), local.slice(8, 11)),
      ),
    );
    refresh(trial);
    const actual = trial.evaluated.matrices[index];
    return (
      Math.hypot(...position.map((value, axis) => value - actual[12 + axis])) <=
        0.0005 &&
      actual
        .slice(0, 12)
        .every((value, axis) => Math.abs(value - old[axis]) <= 0.0005)
    );
  }

  for (const factor of [0.7, 0.5, 0.3]) {
    for (const compensation of [2, 1.5, 1]) {
      for (const step of [0.02, 0.035]) {
        const trial = { ...actor, pose: structuredClone(base) };
        trial.pose.root.position = base.root.position.map(
          (value, axis) => value + move[axis] * factor,
        );
        refresh(trial);
        const targets = legs.map((chain) => [
          chain,
          evaluation.positions[trial.skeleton.boneIndex(chain.end)].map(
            (value, axis) =>
              value + step * (away[axis] + lateral[axis] * chain.side),
          ),
        ]);
        let drop = 0;
        for (const [chain, position] of targets) {
          const hip =
            trial.evaluated.positions[trial.skeleton.boneIndex(chain.root)];
          const reach =
            (trial.skeleton.bone(chain.mid).length +
              trial.skeleton.bone(chain.end).length) *
            0.999;
          const horizontalSq =
            (hip[0] - position[0]) ** 2 + (hip[2] - position[2]) ** 2;
          if (horizontalSq >= reach * reach) {
            drop = Infinity;
            break;
          }
          drop = Math.max(
            drop,
            hip[1] - position[1] - Math.sqrt(reach * reach - horizontalSq),
          );
        }
        if (drop > 0.02) {
          yield null;
          continue;
        }
        trial.pose.root.position[1] -= drop;
        refresh(trial);
        if (
          !targets.every(([chain, position]) =>
            endFrame(trial, chain, position),
          )
        ) {
          yield null;
          continue;
        }
        const bone = trial.skeleton.bone("spine01");
        const pivot =
          trial.evaluated.positions[trial.skeleton.boneIndex("spine01")];
        const current = upper.map(
          (value, axis) =>
            value + trial.pose.root.position[axis] - base.root.position[axis],
        );
        const first = quatFromUnitVectors(
          v3sub(current, pivot),
          v3sub(upper, pivot),
        );
        const turn = quatFromAxisAngle(
          first.slice(0, 3),
          2 * Math.acos(clamp(first[3], -1, 1)) * compensation,
        );
        const local = mat4TransformDirection(
          mat4InvertRigid(trial.evaluated.matrices[bone.parentIndex]),
          turn.slice(0, 3),
        );
        trial.pose.joints.spine01 = trial.skeleton.clampAngles(
          "spine01",
          anglesFromQuaternion(
            trial.skeleton,
            "spine01",
            quatMultiply(
              [...local, turn[3]],
              trial.skeleton.quaternionFromAngles(
                "spine01",
                trial.pose.joints.spine01,
              ),
            ),
          ),
        );
        refresh(trial);
        if (
          !arms.every((chain) =>
            endFrame(
              trial,
              chain,
              evaluation.positions[trial.skeleton.boneIndex(chain.end)],
            ),
          )
        ) {
          yield null;
          continue;
        }
        yield trial.pose;
      }
    }
  }
}
