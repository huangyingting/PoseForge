/** Bounded seat/leg candidates that preserve the original foot frames. */
import { refresh } from "./solver.js";
import { isFixedPlacement } from "./placement.js";
import { LIMB_CHAINS } from "./ik.js";
import {
  captureEndFrame,
  solveEndFrames,
  endFramesPreserved,
} from "./supportFrames.js";

const legs = [LIMB_CHAINS.legL, LIMB_CHAINS.legR];
export const SEATED_ROOT_LIMIT = 0.16;
export const SEATED_HORIZONTAL_LIMIT = 0.18;
export const SEATED_FOOT_LIMIT = 0.06;

export function seatedSupportFrame(actor, surface, report) {
  if (
    actor.mobility <= 0 ||
    isFixedPlacement(actor.spec?.placement) ||
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
    feet: legs.map((chain, i) =>
      captureEndFrame(
        actor,
        chain,
        0.002 + (feet[i].penetration || -feet[i].gap),
      ),
    ),
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
    endFramesPreserved(actor, frame.feet)
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
    solveEndFrames(trial, frame.feet);
    yield seatedFramePreserved(trial, frame) ? trial.pose : null;
  }
}
