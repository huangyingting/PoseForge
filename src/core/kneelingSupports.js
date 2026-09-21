/** Small knee/shin support corrections with feet and contacted hands retained. */
import { refresh, chainForBone } from "./solver.js";
import { isFixedPlacement } from "./placement.js";
import { LIMB_CHAINS } from "./ik.js";
import { resolveLandmark } from "./landmarks.js";
import { quatRotate } from "./math.js";
import {
  captureEndFrame,
  solveEndFrames,
  endFramesPreserved,
} from "./supportFrames.js";

export const KNEELING_ROOT_LIMIT = 0.06;
export const KNEELING_HORIZONTAL_LIMIT = 0.04;
const legs = [LIMB_CHAINS.legL, LIMB_CHAINS.legR];

export function kneelingSupportFrame(actor, surface, report, query, contacts) {
  if (
    actor.mobility <= 0 ||
    isFixedPlacement(actor.spec?.placement) ||
    actor.carried ||
    actor.mountedOn != null ||
    report?.basis !== "rendered" ||
    report.supports.length !== 2 ||
    actor.evaluated.matrices[actor.skeleton.boneIndex("pelvis")][5] < 0.75
  )
    return null;
  const kind = report.supports[0].landmark;
  if (
    !["knee", "shin"].includes(kind) ||
    report.supports.some(
      (s) => s.landmark !== kind || !s.measurement?.withinFootprint,
    ) ||
    new Set(report.supports.map((s) => s.side)).size !== 2
  )
    return null;
  const feet = ["l", "r"].map((side) =>
    query.support(actor.index, { landmark: "foot", side }, surface),
  );
  if (feet.some((s) => !s?.withinFootprint || s.gap > 0.06)) return null;
  const arms = new Set();
  for (const contact of contacts) {
    if (contact.strength <= 0) continue;
    for (const end of ["from", "to"])
      if (contact[`${end}Actor`] === actor.index) {
        const chain = chainForBone(
          resolveLandmark(contact[end], contact[`${end}Side`])?.bone ?? "",
        );
        if (chain === "armL" || chain === "armR") arms.add(LIMB_CHAINS[chain]);
      }
  }
  const chains = [...legs, ...arms];
  if (
    actor.spec?.jointMode === "fixed" &&
    chains.some((chain) =>
      [chain.root, chain.mid, chain.end, chain.tip].some(
        (bone) => Object.keys(actor.spec.joints?.[bone] ?? {}).length,
      ),
    )
  )
    return null;
  const forward = quatRotate(actor.pose.root.quaternion, [0, 0, 1]);
  const length = Math.hypot(forward[0], forward[2]);
  if (length < 0.5) return null;
  return {
    root: structuredClone(actor.pose.root),
    forward: [forward[0] / length, 0, forward[2] / length],
    ends: [
      ...legs.map((chain, i) =>
        captureEndFrame(
          actor,
          chain,
          0.002 + (feet[i].penetration || -feet[i].gap),
        ),
      ),
      ...[...arms].map((chain) => captureEndFrame(actor, chain)),
    ],
  };
}

export function kneelingFramePreserved(actor, frame) {
  return (
    Math.abs(actor.pose.root.position[1] - frame.root.position[1]) <=
      KNEELING_ROOT_LIMIT &&
    Math.hypot(
      ...[0, 2].map(
        (axis) => actor.pose.root.position[axis] - frame.root.position[axis],
      ),
    ) <= KNEELING_HORIZONTAL_LIMIT &&
    actor.pose.root.quaternion.every(
      (value, k) => Math.abs(value - frame.root.quaternion[k]) < 1e-7,
    ) &&
    endFramesPreserved(actor, frame.ends)
  );
}

export function* kneelingSupportPoses(actor, report, frame) {
  const samples = report.supports.map((s) => s.measurement);
  const correction = samples.some((s) => s.penetration > 0)
    ? 0.002 + Math.max(...samples.map((s) => s.penetration))
    : 0.002 - Math.min(...samples.map((s) => s.gap));
  const base = structuredClone(actor.pose);
  for (const [factor, slide] of [
    [1, 0],
    [0.2, 0.9],
    [0.3, 0.6],
    [0.5, 0.4],
    [0.75, 0.2],
    [1, -0.3],
    [0.25, 0.7],
    [0.6, 0.35],
  ]) {
    const trial = { ...actor, pose: structuredClone(base) };
    trial.pose.root.position[1] += correction * factor;
    for (const axis of [0, 2])
      trial.pose.root.position[axis] +=
        Math.abs(correction) * slide * frame.forward[axis];
    if (
      Math.abs(trial.pose.root.position[1] - frame.root.position[1]) >
        KNEELING_ROOT_LIMIT ||
      Math.hypot(
        ...[0, 2].map(
          (axis) => trial.pose.root.position[axis] - frame.root.position[axis],
        ),
      ) > KNEELING_HORIZONTAL_LIMIT
    ) {
      yield null;
      continue;
    }
    refresh(trial);
    solveEndFrames(trial, frame.ends);
    yield kneelingFramePreserved(trial, frame) ? trial.pose : null;
  }
}
