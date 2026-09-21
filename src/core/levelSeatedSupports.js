/** Seat/foot corrections when all three supports share one surface plane. */
import { refresh } from "./solver.js";
import { isFixedPlacement } from "./placement.js";
import { LIMB_CHAINS } from "./ik.js";
import {
  DEG,
  RAD,
  quatConjugate,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
} from "./math.js";
import {
  captureEndFrame,
  solveEndFrames,
  endFramesPreserved,
} from "./supportFrames.js";
import {
  SEATED_ROOT_LIMIT,
  SEATED_HORIZONTAL_LIMIT,
  SEATED_FOOT_LIMIT,
} from "./seatedSupports.js";

const legs = [LIMB_CHAINS.legL, LIMB_CHAINS.legR];
const legBones = new Set(legs.flatMap((c) => [c.root, c.mid, c.end, c.tip]));
const movingLegBones = new Set(legs.flatMap((c) => [c.root, c.mid, c.end]));
const arms = [LIMB_CHAINS.armL, LIMB_CHAINS.armR];
const armBones = new Set(arms.flatMap((c) => [c.root, c.mid, c.end, c.tip]));
const movingArmBones = new Set(arms.flatMap((c) => [c.root, c.mid, c.end]));
export const LEVEL_SEATED_PITCH_LIMIT = 30;
export const LEVEL_SEATED_ARM_LIMIT = 60;

export function levelSeatedSupportFrame(actor, report) {
  if (
    actor.mobility <= 0 ||
    isFixedPlacement(actor.spec?.placement) ||
    actor.carried ||
    actor.mountedOn != null ||
    report?.basis !== "rendered" ||
    report.supports.length !== 3 ||
    actor.evaluated.matrices[actor.skeleton.boneIndex("pelvis")][5] < 0.5
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
    !seat?.withinFootprint ||
    feet.some(
      (s) =>
        !s?.withinFootprint ||
        s.plane !== seat.plane ||
        s.gap > SEATED_FOOT_LIMIT,
    )
  )
    return null;
  if (
    actor.spec?.jointMode === "fixed" &&
    [...legBones].some(
      (bone) => Object.keys(actor.spec.joints?.[bone] ?? {}).length,
    )
  )
    return null;
  const forward = quatRotate(actor.pose.root.quaternion, [0, 0, 1]);
  const length = Math.hypot(forward[0], forward[2]);
  if (length < 0.5) return null;
  return {
    pose: structuredClone(actor.pose),
    forward: [forward[0] / length, 0, forward[2] / length],
    maxPitch: Math.min(
      LEVEL_SEATED_PITCH_LIMIT,
      Math.max(0, Math.atan2(forward[1], length) * RAD),
    ),
    freeArms:
      actor.spec?.jointMode !== "fixed" ||
      ![...armBones].some(
        (bone) => Object.keys(actor.spec.joints?.[bone] ?? {}).length,
      ),
    feet: legs.map((chain, i) =>
      captureEndFrame(
        actor,
        chain,
        0.002 + (feet[i].penetration || -feet[i].gap),
      ),
    ),
  };
}

function movement(actor, frame) {
  const delta = actor.pose.root.position.map(
    (n, i) => n - frame.pose.root.position[i],
  );
  const forward = delta[0] * frame.forward[0] + delta[2] * frame.forward[2];
  let rotation = quatMultiply(
    quatConjugate(frame.pose.root.quaternion),
    actor.pose.root.quaternion,
  );
  if (rotation[3] < 0) rotation = rotation.map((n) => -n);
  return {
    vertical: delta[1],
    forward,
    lateral: Math.hypot(
      delta[0] - forward * frame.forward[0],
      delta[2] - forward * frame.forward[2],
    ),
    rotation,
    pitch: 2 * Math.atan2(rotation[0], rotation[3]) * RAD,
  };
}

export function levelSeatedFramePreserved(actor, frame) {
  const move = movement(actor, frame);
  return (
    Math.abs(move.vertical) <= SEATED_ROOT_LIMIT &&
    move.forward >= -1e-7 &&
    move.forward <= SEATED_HORIZONTAL_LIMIT + 1e-7 &&
    move.lateral < 1e-7 &&
    Math.abs(move.rotation[1]) < 1e-7 &&
    Math.abs(move.rotation[2]) < 1e-7 &&
    move.pitch >= -1e-7 &&
    move.pitch <= frame.maxPitch + 1e-7 &&
    Object.entries(frame.pose.joints).every(
      ([bone, angles]) =>
        movingLegBones.has(bone) ||
        Object.entries(angles).every(
          ([channel, n]) =>
            Math.abs(actor.pose.joints[bone][channel] - n) <=
            (movingArmBones.has(bone) ? LEVEL_SEATED_ARM_LIMIT : 1e-7),
        ),
    ) &&
    endFramesPreserved(actor, frame.feet)
  );
}

export function* levelSeatedSupportPoses(actor, report, frame) {
  const seat = report.supports.find(
    (s) => s.landmark === "buttocks",
  )?.measurement;
  if (!seat) return;
  const base = structuredClone(actor.pose),
    retained = movement(actor, frame);
  const hands = arms.map((chain) => captureEndFrame(actor, chain));
  // Retained offsets can collapse different requested tuples to one trial.
  const attempted = new Set();
  for (const [pitch, forward, holdHands] of [
    [0, 0, true],
    [0, 0, false],
    [10, 0.12, false],
    [20, 0.12, false],
    [10, 0.18, false],
    [20, 0.18, false],
    [30, 0.12, false],
    [30, 0.18, false],
  ]) {
    const nextPitch = Math.min(frame.maxPitch, Math.max(pitch, retained.pitch));
    const nextForward = Math.max(forward, retained.forward);
    const key = `${nextPitch.toFixed(7)}|${nextForward.toFixed(7)}|${holdHands}`;
    if (attempted.has(key)) continue;
    attempted.add(key);
    if (holdHands && !frame.freeArms) {
      yield null;
      continue;
    }
    const trial = { ...actor, pose: structuredClone(base) };
    // Leg IK also changes the visible seat shape, so approach its plane gently.
    trial.pose.root.position[1] +=
      0.9 * (0.002 + (seat.penetration || -seat.gap));
    if (
      Math.abs(trial.pose.root.position[1] - frame.pose.root.position[1]) >
      SEATED_ROOT_LIMIT
    ) {
      yield null;
      continue;
    }
    for (const axis of [0, 2])
      trial.pose.root.position[axis] =
        frame.pose.root.position[axis] + nextForward * frame.forward[axis];
    trial.pose.root.quaternion = quatMultiply(
      frame.pose.root.quaternion,
      quatFromAxisAngle([1, 0, 0], nextPitch * DEG),
    );
    refresh(trial);
    solveEndFrames(trial, frame.feet);
    const handTargets = hands.map((hand) => ({
      ...hand,
      position: hand.position.map(
        (n, axis) => n + (nextForward - retained.forward) * frame.forward[axis],
      ),
    }));
    if (holdHands) solveEndFrames(trial, handTargets);
    yield levelSeatedFramePreserved(trial, frame) &&
    (!holdHands || endFramesPreserved(trial, handTargets))
      ? trial.pose
      : null;
  }
}
