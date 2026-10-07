/**
 * Fingers that close on what they hold until they meet it, and no further.
 *
 * A shape in `HAND_SHAPES` is one curl for every hand that is in it, and what
 * a hand holds is not one size. `grip` closes about as far as a hand round a
 * shoulder does; round a thigh, a hip or a waist - far broader than that, and
 * what most hands in the library hold - the same curl drove the fingers on
 * into the skin, and what was drawn was a fist sunk to the knuckles in the
 * partner. Of the hands the library rests or grips on a partner, nine in ten
 * crossed the partner's drawn surface, most of them by four to ten
 * centimetres of finger.
 *
 * So the fingers close into their shape as a hand does, from open towards the
 * full curl, and stop at the last closure at which they are still clear of
 * everything drawn: the partners, their own body beyond the arm, the furniture
 * and the floor. The four close together, as a hand's do - one finger left
 * straight among three curled, as each closing alone left them, is a hand
 * pointing, or making a sign - and the thumb on its own. Fingers already clear
 * at the full curl keep it, so a hand round a shoulder, or one in the air, is
 * drawn exactly as before. Ones not clear even open - the palm is in what it
 * is on - lie open, which is the least of them that can go in.
 *
 * Only the fingers move. The arm is where the pose put it, and on a fixed
 * figure it is the pose's to keep.
 */
import { bindCorrections, skinHumanMesh } from "./humanMesh.js";
import { buildTriangleTree, closestMeshPoints } from "./meshDistance.js";
import { measurePropSurface } from "./surfaceProps.js";

const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
/** What closes together: the thumb, and the four fingers. */
const GROUPS = [["thumb"], ["index", "middle", "ring", "pinky"]];
/** The closures tried, fullest first: the first at which a finger is clear is the one it keeps. */
const CLOSURES = [1, 0.8, 0.6, 0.4, 0.2, 0];
/** The bones of the arm a hand is on, whose skin a finger of it cannot be said to be in. */
const ARM = ["shoulder", "elbow", "wrist", "hand"];

const fingerTemplates = new WeakMap();

/**
 * One side's finger skin as a template of its own, cheap to pose over and over,
 * with each finger's triangles. A vertex belongs to the finger whose joint
 * weighs most on it, and a triangle to the finger that has two of its corners;
 * the palm and the back of the hand belong to none and are not moved here.
 */
function fingerTemplate(template, side) {
  if (!fingerTemplates.has(template)) fingerTemplates.set(template, {});
  const cache = fingerTemplates.get(template);
  if (cache[side] !== undefined) return cache[side];
  const fingerOf = template.joints.map((joint) => (joint.side === side && joint.finger && joint.curl ? joint.finger : null));
  const submeshes = [];
  const fingers = [];
  for (const part of template.submeshes) {
    if (!part.primary || !part.joints || !part.weights) continue;
    const count = part.positions.length / 3;
    const owner = new Array(count).fill(null);
    for (let v = 0; v < count; v++) {
      let best = 0;
      for (let k = 0; k < 4; k++) {
        const weight = part.weights[v * 4 + k];
        if (weight > best) {
          best = weight;
          owner[v] = fingerOf[part.joints[v * 4 + k]];
        }
      }
    }
    const remap = new Map();
    const byFinger = Object.fromEntries(FINGERS.map((finger) => [finger, []]));
    for (let t = 0; t < part.indices.length; t += 3) {
      const corners = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
      const finger = FINGERS.find((name) => corners.filter((v) => owner[v] === name).length >= 2);
      if (!finger) continue;
      for (const v of corners) if (!remap.has(v)) remap.set(v, remap.size);
      byFinger[finger].push(...corners.map((v) => remap.get(v)));
    }
    if (!remap.size) continue;
    const positions = new Float32Array(remap.size * 3);
    const normals = new Float32Array(remap.size * 3);
    const joints = new Uint16Array(remap.size * 4);
    const weights = new Float32Array(remap.size * 4);
    for (const [from, to] of remap) {
      positions.set(part.positions.subarray(from * 3, from * 3 + 3), to * 3);
      normals.set(part.normals.subarray(from * 3, from * 3 + 3), to * 3);
      joints.set(part.joints.subarray(from * 4, from * 4 + 4), to * 4);
      weights.set(part.weights.subarray(from * 4, from * 4 + 4), to * 4);
    }
    submeshes.push({ name: part.name, primary: true, positions, normals, joints, weights, indices: new Uint32Array(0) });
    fingers.push(Object.fromEntries(FINGERS.map((finger) => [finger, Uint32Array.from(byFinger[finger])])));
  }
  cache[side] = submeshes.length ? { template: { ...template, submeshes }, fingers } : null;
  return cache[side];
}

/**
 * Close the fingers of every hand that is not braced as far into its shape as
 * they go clear of everything drawn - see above. Writes `closure` into each
 * actor's `hands` and returns the hands it changed. `figure(index, without)`
 * is the drawn figure as a triangle tree, less the bones in `without`.
 *
 * @param {object} solved the solved scene
 * @param {Array<object>} templates one per actor
 * @param {(index: number, without?: Set<string>) => object} figure
 * @param {(actor: object, side: string) => boolean} [fits] which hands to fit
 * @returns {Array<{actor: object, side: string, closure: object}>}
 */
export function fitFingers(solved, templates, figure, fits = () => true) {
  const changed = [];
  const ground = solved.surface?.ground ?? -Infinity;
  solved.actors.forEach((actor, index) => {
    const template = templates[index];
    if (!template || !actor.hands) return;
    let align = null;
    for (const side of ["l", "r"]) {
      const shape = actor.hands[side];
      if (!shape || shape === "brace" || !fits(actor, side)) continue;
      const fingers = fingerTemplate(template, side);
      if (!fingers) continue;
      align ??= bindCorrections(template, actor.skeleton);
      const own = new Set(ARM.map((bone) => `${bone}_${side}`));
      const others = solved.actors.map((_, k) => (k === index ? figure(k, own) : figure(k))).filter(Boolean);
      const crosses = (tree) =>
        tree.min[1] < ground - 1e-3 ||
        others.some((other) => closestMeshPoints(tree, other, { crossingsOnly: true })?.intersects) ||
        solved.props.some((prop) => measurePropSurface(tree, prop)?.intersects === true);
      const closure = {};
      let open = GROUPS.slice();
      for (const level of CLOSURES) {
        const trial = { ...(actor.hands.closure?.[side] ?? {}) };
        for (const group of open) for (const finger of group) trial[finger] = level;
        const hands = { ...actor.hands, closure: { ...actor.hands.closure, [side]: trial } };
        const parts = skinHumanMesh(fingers.template, actor.skeleton, actor.evaluated, align, hands, null);
        const clear = (finger) => {
          const tree = buildTriangleTree(
            parts.map((part, k) => ({ positions: part.positions, indices: fingers.fingers[k][finger] })).filter((part) => part.indices.length),
          );
          return !tree || !crosses(tree);
        };
        open = open.filter((group) => {
          if (level > 0 && !group.every(clear)) return true;
          if (level < 1) for (const finger of group) closure[finger] = level;
          return false;
        });
        if (!open.length) break;
      }
      if (Object.keys(closure).length) changed.push({ actor, side, closure });
    }
  });
  return changed;
}
