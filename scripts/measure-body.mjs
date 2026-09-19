/**
 * Body proportion measurement.
 *
 * Measures the *rendered* silhouette - by sampling the same signed distance
 * field the mesher uses, so this measures what the viewer will actually see,
 * blending included - and compares it with anthropometric reference breadths
 * and depths. Run with `node scripts/measure-body.mjs`.
 */

import { bodyDistance, buildBodyVolumes, poseVolumes } from "../src/core/body.js";
import { Skeleton, evaluatePose } from "../src/core/skeleton.js";

/**
 * Reference breadth/depth as fractions of stature, from standard adult
 * anthropometry. `at` is the measurement height, also as a fraction.
 *
 * The shoulder figure is bideltoid, not biacromial: this measures a silhouette,
 * and what a silhouette shows at shoulder height is the outside of the deltoids,
 * not the bone landmarks underneath them.
 */
const REFERENCE = {
  female: [
    { name: "shoulders", at: 0.805, breadth: 0.264, depth: 0.135, set: "all" },
    { name: "chest", at: 0.72, breadth: 0.174, depth: 0.132 },
    { name: "waist", at: 0.63, breadth: 0.157, depth: 0.109 },
    { name: "hips", at: 0.53, breadth: 0.194, depth: 0.128, set: "body" },
  ],
  male: [
    { name: "shoulders", at: 0.81, breadth: 0.28, depth: 0.142, set: "all" },
    { name: "chest", at: 0.72, breadth: 0.187, depth: 0.14 },
    { name: "waist", at: 0.63, breadth: 0.165, depth: 0.122 },
    { name: "hips", at: 0.53, breadth: 0.183, depth: 0.128, set: "body" },
  ],
};

/**
 * Distance from `origin` along `direction` to the first surface crossing.
 * The body is not convex - a ray leaving the neck re-enters at the shoulder -
 * so march out to the first sign change before bisecting, rather than
 * bisecting the whole interval and landing on a later crossing.
 */
function surfaceDistance(volumes, origin, direction, limit) {
  const at = (t) =>
    bodyDistance(
      [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t],
      volumes
    );
  if (at(0) > 0) return null;
  const step = limit / 400;
  let inside = 0;
  let outside = null;
  for (let t = step; t <= limit; t += step) {
    if (at(t) > 0) {
      outside = t;
      break;
    }
    inside = t;
  }
  if (outside == null) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (inside + outside) / 2;
    if (at(mid) <= 0) inside = mid;
    else outside = mid;
  }
  return (inside + outside) / 2;
}

/** Widest extent of the surface along `axis` at height y. */
function extentAt(volumes, y, axis, limit) {
  let total = 0;
  for (const sign of [-1, 1]) {
    const direction = [0, 0, 0];
    direction[axis] = sign;
    const hit = surfaceDistance(volumes, [0, y, 0], direction, limit);
    if (hit == null) return 0;
    total += hit;
  }
  return total;
}

/**
 * Girth of a limb, measured perpendicular to its bone axis at parameter `t`.
 *
 * Only the limb's own primitives are sampled. Mid-limb that is the rendered
 * surface anyway - blending only reshapes the field near a junction - and
 * restricting the set is what stops the ray escaping into the neighbouring
 * body part, which at the neck is not a separate lump at all but continuous
 * with the shoulder mass.
 *
 * Reported as a circumference because that is how limbs are tabulated and how
 * a tape measure reads them.
 */
function girthAt(volumes, skeleton, evaluated, boneName, childName, t, axis = [1, 0, 0]) {
  const own = volumes.filter((v) => v.bone === boneName);
  const a = evaluated.positions[skeleton.boneIndex(boneName)];
  const b = evaluated.positions[skeleton.boneIndex(childName)];
  const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hit = surfaceDistance(own, p, axis, skeleton.stature * 0.25);
  return hit == null ? 0 : 2 * Math.PI * hit;
}

/**
 * Limb circumferences as fractions of stature, each at the station the
 * standard measurement is defined at: upper arm at the acromion-olecranon
 * midpoint, forearm and calf at their widest, wrist and ankle at the joint.
 */
const LIMB_REFERENCE = {
  female: [
    { name: "upper arm", bone: "shoulder_l", child: "elbow_l", t: 0.5, want: 0.163 },
    { name: "forearm", bone: "elbow_l", child: "wrist_l", t: 0.2, want: 0.145 },
    { name: "wrist", bone: "elbow_l", child: "wrist_l", t: 0.95, want: 0.094 },
    { name: "thigh", bone: "hip_l", child: "knee_l", t: 0.15, want: 0.331 },
    { name: "calf", bone: "knee_l", child: "ankle_l", t: 0.25, want: 0.211 },
    { name: "ankle", bone: "knee_l", child: "ankle_l", t: 0.92, want: 0.133 },
    { name: "neck", bone: "neck", child: "head", t: 0.4, want: 0.193 },
  ],
  male: [
    { name: "upper arm", bone: "shoulder_l", child: "elbow_l", t: 0.5, want: 0.175 },
    { name: "forearm", bone: "elbow_l", child: "wrist_l", t: 0.2, want: 0.157 },
    { name: "wrist", bone: "elbow_l", child: "wrist_l", t: 0.95, want: 0.099 },
    { name: "thigh", bone: "hip_l", child: "knee_l", t: 0.15, want: 0.315 },
    { name: "calf", bone: "knee_l", child: "ankle_l", t: 0.25, want: 0.212 },
    { name: "ankle", bone: "knee_l", child: "ankle_l", t: 0.92, want: 0.126 },
    { name: "neck", bone: "neck", child: "head", t: 0.4, want: 0.217 },
  ],
};

const mm = (v) => `${(v * 1000).toFixed(0)}mm`.padStart(7);

for (const bodyType of ["female", "male"]) {
  const skeleton = new Skeleton({ bodyType });
  const H = skeleton.stature;
  const local = buildBodyVolumes(skeleton);
  // Stand the rest pose on the floor so measurement heights are ground-relative.
  const evaluated = evaluatePose(skeleton, {
    root: { position: [0, skeleton.hipHeight, 0], quaternion: [0, 0, 0, 1] },
    joints: skeleton.restPose(),
  });
  const volumes = poseVolumes(skeleton, evaluated, local);
  // Which primitives count towards each level. The arms hang beside the torso
  // at chest, waist and hip height, so including them would measure a forearm
  // and call it a waist - these are body measurements, taken with the arms out
  // of the way. At the shoulders the deltoids are the measurement, and at the
  // hips the top of the thigh genuinely forms the silhouette.
  const isTorso = (v) => v.group === "torso" || v.group === "head";
  const isLeg = (v) => v.group === "legL" || v.group === "legR";
  const SETS = {
    all: volumes,
    body: volumes.filter((v) => isTorso(v) || isLeg(v)),
    torso: volumes.filter(isTorso),
  };

  console.log(`\n${bodyType}  stature ${mm(H)}`);
  console.log("  level        breadth (want)          depth (want)");
  for (const ref of REFERENCE[bodyType]) {
    const y = ref.at * H;
    const set = SETS[ref.set || "torso"];
    const breadth = extentAt(set, y, 0, H * 0.4);
    const depth = extentAt(set, y, 2, H * 0.4);
    const wantBreadth = ref.breadth * H;
    const wantDepth = ref.depth * H;
    const flag =
      Math.abs(breadth - wantBreadth) > H * 0.02 || Math.abs(depth - wantDepth) > H * 0.02
        ? "  <-- off"
        : "";
    console.log(
      `  ${ref.name.padEnd(10)} ${mm(breadth)} (${mm(wantBreadth)})   ${mm(depth)} (${mm(wantDepth)})${flag}`
    );
  }

  console.log("  limb         girth   (want)");
  for (const ref of LIMB_REFERENCE[bodyType]) {
    const girth = girthAt(volumes, skeleton, evaluated, ref.bone, ref.child, ref.t);
    const want = ref.want * H;
    const flag = Math.abs(girth - want) > want * 0.12 ? "  <-- off" : "";
    console.log(`  ${ref.name.padEnd(10)} ${mm(girth)} (${mm(want)})${flag}`);
  }
}
