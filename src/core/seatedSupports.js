/** Bounded seat/leg candidates that preserve the original foot frames. */
import { refresh } from "./solver.js";
import { LIMB_CHAINS, solveTwoBoneIK, anglesFromQuaternion } from "./ik.js";
import { mat4Multiply, mat4InvertRigid, v3sub } from "./math.js";
import { orientationFromAxes } from "./poseLibrary.js";

const legs = [LIMB_CHAINS.legL, LIMB_CHAINS.legR];
export const SEATED_ROOT_LIMIT = 0.16;
export const SEATED_HORIZONTAL_LIMIT = 0.18;
export const SEATED_FOOT_LIMIT = 0.06;

export function seatedSupportFrame(actor, surface, report) {
  if (
    actor.mobility <= 0 ||
    actor.spec?.placement ||
    actor.carried ||
    actor.mountedOn != null ||
    surface.height <= surface.ground ||
    report?.basis !== "rendered" ||
    actor.posture.supports.length !== 3 ||
    actor.evaluated.matrices[actor.skeleton.boneIndex("pelvis")][5] < 0.75
  )
    return null;
  const seat = report.supports.find(
    (s) => s.landmark === "buttocks",
  )?.measurement;
  const feet = ["l", "r"].map(
    (side) =>
      report.supports.find((s) => s.landmark === "foot" && s.side === side)
        ?.measurement,
  );
  if (
    !seat?.point ||
    !seat.target ||
    feet.some((sample) => !sample || sample.gap > SEATED_FOOT_LIMIT)
  )
    return null;
  const targetRoot = actor.pose.root.position.slice();
  if (!seat.withinFootprint) {
    const prop =
      surface.props[seat.propIndex] ??
      surface.props.find((prop) => prop.kind === seat.prop);
    if (!prop) return null;
    const toward = [
      prop.center[0] - seat.target[0],
      prop.center[2] - seat.target[2],
    ];
    const distance = Math.hypot(...toward);
    for (const [i, axis] of [0, 2].entries())
      targetRoot[axis] +=
        seat.target[axis] -
        seat.point[axis] +
        (distance ? (toward[i] / distance) * 0.025 : 0);
    if (
      Math.hypot(
        targetRoot[0] - actor.pose.root.position[0],
        targetRoot[2] - actor.pose.root.position[2],
      ) > SEATED_HORIZONTAL_LIMIT
    )
      return null;
  }
  const bones = legs.flatMap((chain) => [
    chain.root,
    chain.mid,
    chain.end,
    chain.tip,
  ]);
  if (
    actor.spec?.jointMode === "fixed" &&
    bones.some((bone) => Object.keys(actor.spec.joints?.[bone] ?? {}).length)
  )
    return null;
  return {
    root: structuredClone(actor.pose.root),
    targetRoot,
    feet: legs.map((chain, i) => {
      const index = actor.skeleton.boneIndex(chain.end),
        matrix = actor.evaluated.matrices[index];
      const position = actor.evaluated.positions[index].slice();
      position[1] += 0.002 + (feet[i].penetration || -feet[i].gap);
      return {
        chain,
        matrix: matrix.slice(),
        position,
        pole: v3sub(
          actor.evaluated.positions[actor.skeleton.boneIndex(chain.mid)],
          actor.evaluated.positions[actor.skeleton.boneIndex(chain.root)],
        ),
      };
    }),
  };
}

export function seatedFramePreserved(actor, frame) {
  const root = actor.pose.root;
  return (
    Math.abs(root.position[1] - frame.root.position[1]) <= SEATED_ROOT_LIMIT &&
    Math.hypot(
      root.position[0] - frame.root.position[0],
      root.position[2] - frame.root.position[2],
    ) <= SEATED_HORIZONTAL_LIMIT &&
    root.quaternion.every(
      (value, k) => Math.abs(value - frame.root.quaternion[k]) < 1e-7,
    ) &&
    frame.feet.every(({ chain, matrix, position }) => {
      const actual =
        actor.evaluated.matrices[actor.skeleton.boneIndex(chain.end)];
      return (
        Math.hypot(...position.map((value, k) => value - actual[12 + k])) <=
          0.0005 &&
        actual
          .slice(0, 12)
          .every((value, k) => Math.abs(value - matrix[k]) <= 0.0005)
      );
    })
  );
}

/** A null candidate failed joint limits, reach or cumulative frame bounds. */
export function* seatedSupportPoses(actor, report, frame) {
  const seat = report.supports.find(
    (s) => s.landmark === "buttocks",
  )?.measurement;
  if (!frame || !seat?.point || !seat.target) return;
  const correction = 0.002 + seat.target[1] - seat.point[1],
    base = structuredClone(actor.pose);
  for (const factor of [1, 0.9, 0.7]) {
    const trial = { ...actor, pose: structuredClone(base) };
    trial.pose.root.position[1] += correction * factor;
    for (const axis of [0, 2])
      trial.pose.root.position[axis] +=
        (frame.targetRoot[axis] - base.root.position[axis]) * factor;
    if (
      Math.abs(trial.pose.root.position[1] - frame.root.position[1]) >
      SEATED_ROOT_LIMIT
    ) {
      yield null;
      continue;
    }
    refresh(trial);
    for (const { chain, matrix, position, pole } of frame.feet) {
      solveTwoBoneIK(trial.skeleton, trial.pose, chain, position, {
        evaluated: trial.evaluated,
        pole,
      });
      refresh(trial);
      const parent =
        trial.evaluated.matrices[trial.skeleton.bone(chain.end).parentIndex];
      const local = mat4Multiply(mat4InvertRigid(parent), matrix);
      trial.pose.joints[chain.end] = trial.skeleton.clampAngles(
        chain.end,
        anglesFromQuaternion(
          trial.skeleton,
          chain.end,
          orientationFromAxes(local.slice(4, 7), local.slice(8, 11)),
        ),
      );
      refresh(trial);
    }
    yield seatedFramePreserved(trial, frame) ? trial.pose : null;
  }
}
