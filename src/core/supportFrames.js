/** Shared IK end frames for render-aware support corrections. */
import { refresh } from "./solver.js";
import { solveTwoBoneIK, anglesFromQuaternion } from "./ik.js";
import { mat4Multiply, mat4InvertRigid, v3sub } from "./math.js";
import { orientationFromAxes } from "./poseLibrary.js";

export function captureEndFrame(actor, chain, vertical = 0) {
  const index = actor.skeleton.boneIndex(chain.end);
  const position = actor.evaluated.positions[index].slice();
  position[1] += vertical;
  return {
    chain,
    matrix: actor.evaluated.matrices[index].slice(),
    position,
    pole: v3sub(
      actor.evaluated.positions[actor.skeleton.boneIndex(chain.mid)],
      actor.evaluated.positions[actor.skeleton.boneIndex(chain.root)],
    ),
  };
}

export function solveEndFrames(actor, frames) {
  for (const { chain, matrix, position, pole } of frames) {
    solveTwoBoneIK(actor.skeleton, actor.pose, chain, position, {
      evaluated: actor.evaluated,
      pole,
    });
    refresh(actor);
    const parent =
      actor.evaluated.matrices[actor.skeleton.bone(chain.end).parentIndex];
    const local = mat4Multiply(mat4InvertRigid(parent), matrix);
    actor.pose.joints[chain.end] = actor.skeleton.clampAngles(
      chain.end,
      anglesFromQuaternion(
        actor.skeleton,
        chain.end,
        orientationFromAxes(local.slice(4, 7), local.slice(8, 11)),
      ),
    );
    refresh(actor);
  }
}

export function endFramesPreserved(actor, frames) {
  return frames.every(({ chain, matrix, position }) => {
    const actual =
      actor.evaluated.matrices[actor.skeleton.boneIndex(chain.end)];
    return (
      Math.hypot(...position.map((value, k) => value - actual[12 + k])) <=
        0.0005 &&
      actual
        .slice(0, 12)
        .every((value, k) => Math.abs(value - matrix[k]) <= 0.0005)
    );
  });
}
