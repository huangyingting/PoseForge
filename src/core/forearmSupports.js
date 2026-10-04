/** Bounded pelvis/arm grounding for bilateral forearm-supported reclines. */
import { refresh, chainForBone } from "./solver.js";
import { isFixedPlacement } from "./placement.js";
import { LIMB_CHAINS } from "./ik.js";
import { resolveLandmark } from "./landmarks.js";
import { quatRotate } from "./math.js";
import { captureEndFrame, solveEndFrames } from "./supportFrames.js";
import { palmNormal, turnPalm } from "./palmPose.js";

const arms = [LIMB_CHAINS.armL, LIMB_CHAINS.armR];
const armBones = new Set(arms.flatMap((c) => [c.root, c.mid, c.end, c.tip]));
export const FOREARM_ROOT_LIMIT = 0.16;
export const FOREARM_WRIST_LIMIT = 0.06;

export function forearmSupportFrame(actor, report, contacts) {
  if (
    actor.mobility <= 0 ||
    isFixedPlacement(actor.spec?.placement) ||
    actor.carried ||
    actor.mountedOn != null ||
    report?.basis !== "rendered" ||
    report.supports.length !== 3
  )
    return null;
  const seat = report.supports.find(
    (s) => s.landmark === "buttocks",
  )?.measurement;
  const forearms = ["l", "r"].map(
    (side) =>
      report.supports.find((s) => s.landmark === "forearm" && s.side === side)
        ?.measurement,
  );
  if (
    !seat?.withinFootprint ||
    forearms.some(
      (s) =>
        !s?.withinFootprint ||
        s.plane !== seat.plane ||
        s.gap > FOREARM_WRIST_LIMIT,
    )
  )
    return null;
  const upright =
    actor.evaluated.matrices[actor.skeleton.boneIndex("pelvis")][5];
  if (upright < 0.1 || upright > 0.75) return null;
  if (
    actor.spec?.jointMode === "fixed" &&
    [...armBones].some(
      (bone) => Object.keys(actor.spec.joints?.[bone] ?? {}).length,
    )
  )
    return null;
  // These hands need free orientation to clear the surface. Do not reshape
  // arms also assigned a positive partner contact.
  if (
    contacts.some(
      (contact) =>
        contact.strength > 0 &&
        ["from", "to"].some(
          (end) =>
            contact[`${end}Actor`] === actor.index &&
            ["armL", "armR"].includes(
              chainForBone(
                resolveLandmark(contact[end], contact[`${end}Side`])?.bone ??
                  "",
              ),
            ),
        ),
    )
  )
    return null;
  const lateral = quatRotate(actor.pose.root.quaternion, [1, 0, 0]);
  const length = Math.hypot(lateral[0], lateral[2]);
  if (length < 0.5) return null;
  return {
    pose: structuredClone(actor.pose),
    lateral: [lateral[0] / length, 0, lateral[2] / length],
    ends: arms.map((chain) => captureEndFrame(actor, chain)),
  };
}

export function forearmFramePreserved(actor, frame) {
  const root = actor.pose.root,
    original = frame.pose.root;
  return (
    Math.abs(root.position[1] - original.position[1]) <= FOREARM_ROOT_LIMIT &&
    [0, 2].every(
      (axis) => Math.abs(root.position[axis] - original.position[axis]) < 1e-7,
    ) &&
    root.quaternion.every(
      (n, k) => Math.abs(n - original.quaternion[k]) < 1e-7,
    ) &&
    Object.entries(frame.pose.joints).every(
      ([bone, angles]) =>
        armBones.has(bone) ||
        Object.entries(angles).every(
          ([channel, n]) =>
            Math.abs(actor.pose.joints[bone][channel] - n) < 1e-7,
        ),
    ) &&
    frame.ends.every(({ chain, position }) => {
      const current =
        actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
      return (
        Math.hypot(...current.map((n, k) => n - position[k])) <=
          FOREARM_WRIST_LIMIT &&
        Object.entries(frame.pose.joints[chain.end]).every(
          ([channel, n]) =>
            Math.abs(actor.pose.joints[chain.end][channel] - n) <= 60,
        )
      );
    })
  );
}

export function* forearmSupportPoses(actor, report, frame) {
  const seat = report.supports.find(
    (s) => s.landmark === "buttocks",
  )?.measurement;
  if (!seat) return;
  const supports = ["l", "r"].map(
    (side) =>
      report.supports.find((s) => s.landmark === "forearm" && s.side === side)
        .measurement,
  );
  const base = structuredClone(actor.pose);
  const palms = arms.map((chain) => palmNormal(actor, chain.tip.slice(-1)));
  const wrists = arms.map((chain) =>
    actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)].slice(),
  );
  // Retain lateral clearance already accepted by a preceding support pass.
  // Retrying narrower hand placement wastes budget and can recreate overlap.
  const retainedSpread = wrists.map((position, i) =>
    position.reduce(
      (sum, n, k) =>
        sum + (n - frame.ends[i].position[k]) * frame.lateral[k] * arms[i].side,
      0,
    ),
  );
  // The palms lie flat beside the forearms, and a wrist bent back a few
  // degrees lifts the fingers off the surface the forearm is lowered onto.
  for (const [gain, spread, extension] of [
    [2, 0.01, 6],
    [1, 0.01, 6],
    [1, 0.025, 6],
    [1, 0.04, 6],
    [2, 0.025, 8],
    [1, 0.01, 10],
    [1, 0.025, 10],
    [2, 0.04, 8],
  ]) {
    const trial = { ...actor, pose: structuredClone(base) };
    trial.pose.root.position[1] += 0.002 + (seat.penetration || -seat.gap);
    if (
      Math.abs(trial.pose.root.position[1] - frame.pose.root.position[1]) >
      FOREARM_ROOT_LIMIT
    ) {
      yield null;
      continue;
    }
    refresh(trial);
    const targets = frame.ends.map((end, i) => ({
      ...end,
      pole: frame.lateral.map((n, k) => (k === 1 ? -0.5 : n * end.chain.side)),
      position: end.position.map((n, k) =>
        k === 1
          ? wrists[i][1] +
            gain * (0.002 + (supports[i].penetration || -supports[i].gap))
          : n +
            Math.max(spread, retainedSpread[i]) *
              frame.lateral[k] *
              end.chain.side,
      ),
    }));
    solveEndFrames(trial, targets);
    arms.forEach((chain, i) => {
      // An arm lowered on a new line leaves the hand where it was only as
      // far as the wrist bends; the forearm's twist takes up the rest.
      turnPalm(trial, chain.tip.slice(-1), palms[i], { sweep: false });
      trial.pose.joints[chain.end] = trial.skeleton.clampAngles(chain.end, {
        ...trial.pose.joints[chain.end],
        flexion: trial.pose.joints[chain.end].flexion - extension,
      });
    });
    refresh(trial);
    yield forearmFramePreserved(trial, frame) ? trial.pose : null;
  }
}
