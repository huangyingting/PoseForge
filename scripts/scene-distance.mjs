/**
 * How different two interaction scenes look, as a multiple of the smallest
 * difference that reads at a glance: 1 or more is a different picture.
 *
 * Compared in the body's own terms, so the answer does not depend on where a
 * scene stands in the room, which way it faces or who is taller: the major
 * joints of each figure (the spine and the neck each as one bend), where each
 * partner is and how they are turned relative to the first, and how the first
 * lies against gravity. The support
 * counts too (a bed is not a floor), and so does the number of people. Body
 * type, outfit, hand shape, wrists, ankles and toes do not.
 */
import { rootFromPlacement } from "../src/core/placement.js";
import { quatAngle, quatMultiply, quatRotate } from "../src/core/math.js";

/** The smallest difference that shows: degrees at a joint, metres or degrees between partners. */
export const VISIBLE = { joint: 20, offset: 0.15, turn: 20, tilt: 20, height: 0.15 };

// The spine and the neck bend as one: three spine joints of 10° each are a 30° bend.
const JOINTS = [["spine01", "spine02", "spine03"], ["neck", "head"], "shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "hip_l", "hip_r", "knee_l", "knee_r"].map((bones) => [bones].flat());
const NAMES = JOINTS.map((bones) => (bones.length > 1 ? bones[0].replace(/\d+$/, "") : bones[0]));
const CHANNELS = ["flexion", "abduction", "rotation"];
const DEG = 180 / Math.PI;
const conjugate = (q) => [-q[0], -q[1], -q[2], q[3]];

/** What the comparison reads from a scene, computed once. */
export function poseSignature(scene) {
  const roots = scene.actors.map((actor) => rootFromPlacement(actor.placement));
  const [first] = roots;
  const inverse = conjugate(first.quaternion);
  return {
    surface: scene.support?.surface ?? "floor",
    joints: scene.actors.map((actor) => JOINTS.flatMap((bones) => CHANNELS.map((channel) => bones.reduce((sum, bone) => sum + (actor.joints?.[bone]?.[channel] ?? 0), 0)))),
    // Every partner in the first one's frame.
    offsets: roots.map((root) => quatRotate(inverse, root.position.map((v, k) => v - first.position[k]))),
    turns: roots.map((root) => quatMultiply(inverse, root.quaternion)),
    up: quatRotate(inverse, [0, 1, 0]),
    height: first.position[1],
  };
}

/**
 * The difference between two signatures in units of `VISIBLE`, with what
 * carries it. Infinity when the support or the number of people differs.
 */
export function poseDifference(p, q) {
  if (p.surface !== q.surface) return { difference: Infinity, by: "surface" };
  if (p.joints.length !== q.joints.length) return { difference: Infinity, by: "people" };
  let difference = 0;
  let by = null;
  const note = (value, what) => {
    if (value > difference) [difference, by] = [value, what];
  };
  p.joints.forEach((angles, i) => {
    for (let k = 0; k < angles.length; k += 1) {
      const d = Math.abs(angles[k] - q.joints[i][k]);
      if (d / VISIBLE.joint > difference) note(d / VISIBLE.joint, `actor ${i} ${NAMES[Math.floor(k / 3)]}.${CHANNELS[k % 3]}`);
    }
  });
  for (let i = 1; i < p.offsets.length; i += 1) {
    note(Math.hypot(...p.offsets[i].map((v, k) => v - q.offsets[i][k])) / VISIBLE.offset, `actor ${i} offset`);
    note((quatAngle(quatMultiply(conjugate(p.turns[i]), q.turns[i])) * DEG) / VISIBLE.turn, `actor ${i} turn`);
  }
  const tilt = Math.acos(Math.max(-1, Math.min(1, p.up.reduce((s, v, k) => s + v * q.up[k], 0)))) * DEG;
  note(tilt / VISIBLE.tilt, "tilt");
  note(Math.abs(p.height - q.height) / VISIBLE.height, "height");
  return { difference, by };
}

/**
 * Every pair of scenes that would read as the same picture, closest first.
 * `items` are `{ id, scene }`.
 */
export function lookalikes(items) {
  const signatures = items.map(({ scene }) => poseSignature(scene));
  const pairs = [];
  for (let i = 0; i < items.length; i += 1)
    for (let j = i + 1; j < items.length; j += 1) {
      const { difference, by } = poseDifference(signatures[i], signatures[j]);
      if (difference < 1) pairs.push({ a: items[i].id, b: items[j].id, difference, by });
    }
  return pairs.sort((x, y) => x.difference - y.difference);
}
