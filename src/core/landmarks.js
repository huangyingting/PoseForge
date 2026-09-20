/**
 * Named body landmarks.
 *
 * The language layer speaks in phrases like "hands on her hips" or
 * "chest against his back". Those resolve to entries here, which are points in
 * bone-local space (as fractions of stature) plus the body volume group that
 * owns the region. The solver turns a landmark into either a world point or
 * the nearest point on the body's actual surface, so a hand placed on a hip
 * lands on the skin rather than inside the pelvis.
 */

import { closestOnVolume } from "./body.js";
import { v3add, v3dist, v3mul, v3normalize, v3sub } from "./math.js";

/**
 * `local` is [x, y, z] in fractions of stature, in the named bone's space.
 * `mirror` marks landmarks that exist per side.
 */
export const LANDMARKS = {
  pelvis: { bone: "pelvis", local: [0, 0, 0] },
  hips: { bone: "pelvis", local: [0, -0.01, 0] },
  hip: { bone: "pelvis", local: [0.055, 0.0, 0], mirror: true },
  groin: { bone: "pelvis", local: [0, -0.055, 0.03] },
  buttocks: { bone: "pelvis", local: [0, -0.05, -0.06] },
  lap: { bone: "pelvis", local: [0, 0.01, 0.075] },
  waist: { bone: "spine01", local: [0, 0.035, 0] },
  abdomen: { bone: "spine01", local: [0, 0.03, 0.05] },
  lowerBack: { bone: "spine01", local: [0, 0.03, -0.055] },
  torso: { bone: "spine02", local: [0, 0.045, 0] },
  ribs: { bone: "spine02", local: [0, 0.055, 0.045], mirror: true },
  chest: { bone: "spine03", local: [0, 0.035, 0.06] },
  sternum: { bone: "spine03", local: [0, 0.03, 0.05] },
  back: { bone: "spine02", local: [0, 0.05, -0.06] },
  upperBack: { bone: "spine03", local: [0, 0.04, -0.06] },
  shoulder: { bone: "shoulder_@", local: [0, 0, 0], mirror: true },
  shoulders: { bone: "spine03", local: [0, 0.066, 0] },
  neck: { bone: "neck", local: [0, 0.02, 0] },
  head: { bone: "head", local: [0, 0.06, 0] },
  face: { bone: "head", local: [0, 0.045, 0.045] },
  mouth: { bone: "head", local: [0, 0.028, 0.05] },
  // On `hand_@`, not on the wrist. `supportLowestY` only looks at volumes
  // whose bone *is* the landmark's bone, so while this named the wrist it
  // could not see the hand at all - `all_fours` seated the wrist on the floor
  // and left the palm 52mm through it. The local offset is the middle of the
  // palm, between the two rails that make it.
  hand: { bone: "hand_@", local: [0, 0.005, 0], mirror: true },
  forearm: { bone: "elbow_@", local: [0, -0.07, 0], mirror: true },
  elbow: { bone: "elbow_@", local: [0, 0, 0], mirror: true },
  upperArm: { bone: "shoulder_@", local: [0, -0.1, 0], mirror: true },
  thigh: { bone: "hip_@", local: [0, -0.12, 0], mirror: true },
  knee: { bone: "knee_@", local: [0, 0, 0], mirror: true },
  shin: { bone: "knee_@", local: [0, -0.12, 0], mirror: true },
  ankle: { bone: "ankle_@", local: [0, 0, 0], mirror: true },
  // Two bones, since the foot was split at the ball so the toes could bend.
  // The sole is half on `ankle_@` - heel and arch - and half on `toe_@`, and a
  // support that could only see the first half seated the arch on the floor
  // and left the toes 40mm above it. `also` is that second half: it widens what
  // counts as this landmark's *surface* without moving the point, which stays
  // at the ball where the weight goes.
  foot: { bone: "ankle_@", also: ["toe_@"], local: [0, -0.02, 0.06], mirror: true },
};

/** Phrase fragments that select a side. */
export const SIDES = { left: "l", right: "r" };

/**
 * Resolve a landmark reference to a bone name and local offset.
 * @param {string} name landmark key, optionally "hip.left" / "knee.right"
 * @param {"l"|"r"|null} [defaultSide]
 */
export function resolveLandmark(name, defaultSide = null) {
  const [base, sideWord] = name.split(".");
  const entry = LANDMARKS[base];
  if (!entry) return null;

  let side = sideWord ? SIDES[sideWord] ?? sideWord : defaultSide;
  if (entry.mirror && !side) side = "l";

  const bone = entry.bone.includes("@")
    ? entry.bone.replace("@", side ?? "l")
    : entry.bone;
  // Every bone this landmark's surface lives on, `bone` first. Callers that
  // want a point use `bone`; callers that want "the lowest bit of her foot"
  // want all of them.
  const bones = [bone, ...(entry.also ?? []).map((name) => name.replace("@", side ?? "l"))];
  const local = [...entry.local];
  if (entry.mirror && !entry.bone.includes("@") && side === "r") local[0] = -local[0];
  return { bone, bones, local, side: side ?? null, base };
}

/**
 * World position of a landmark on a posed actor.
 * @param {object} actor solved actor `{ skeleton, evaluated }`
 */
export function landmarkPoint(actor, name, defaultSide = null) {
  const resolved = resolveLandmark(name, defaultSide);
  if (!resolved) return null;
  const { skeleton, evaluated } = actor;
  const index = skeleton.boneIndex(resolved.bone);
  const m = evaluated.matrices[index];
  const H = skeleton.stature;
  const p = [resolved.local[0] * H, resolved.local[1] * H, resolved.local[2] * H];
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * Nearest point on an actor's *surface* to `from`, restricted to the volumes
 * near a landmark. This is what a hand actually rests on.
 *
 * @returns {{point:number[], normal:number[], volume:object}|null}
 */
export function landmarkSurface(actor, name, from, { offset = 0, defaultSide = null } = {}) {
  const anchor = landmarkPoint(actor, name, defaultSide);
  if (!anchor) return null;
  const resolved = resolveLandmark(name, defaultSide);

  // Consider the landmark's own bone and its immediate neighbours in the
  // skeleton, so "hip" can still land on the thigh mass that actually covers
  // it. Neighbourhood is counted in joints, not metres: a sphere around the
  // waist of someone lying on their side also contains their raised forearm,
  // and "put your hand on her waist" then resolves to the nearest point on her
  // elbow. Joint distance cannot drift that way whatever the pose does.
  let best = null;
  for (const volume of actor.volumes) {
    const onBone = volume.bone === resolved.bone;
    if (!onBone && actor.skeleton.boneDistance(volume.bone, resolved.bone) > 1) continue;
    const candidate = closestOnVolume(from, volume);
    // Prefer surfaces close to the landmark the phrase actually named.
    const bias = onBone ? 0 : actor.skeleton.stature * 0.035;
    const score = v3dist(candidate.point, from) + bias + v3dist(candidate.point, anchor) * 0.35;
    if (!best || score < best.score) best = { ...candidate, volume, score };
  }
  if (!best) return null;

  const point = offset ? v3add(best.point, v3mul(best.normal, offset)) : best.point;
  return { point, normal: best.normal, volume: best.volume, anchor };
}

/** Outward direction from an actor's centre through a landmark. */
export function landmarkOutward(actor, name, defaultSide = null) {
  const point = landmarkPoint(actor, name, defaultSide);
  if (!point) return [0, 1, 0];
  const centre = landmarkPoint(actor, "torso");
  const delta = v3sub(point, centre);
  return v3normalize(delta.some(Boolean) ? delta : [0, 1, 0]);
}

/** Every landmark name the parser may emit. */
export const LANDMARK_NAMES = Object.keys(LANDMARKS);
