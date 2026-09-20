/**
 * Collision detection between posed bodies, props, and the ground.
 *
 * Every body volume is a round cone, so the narrowphase is an exact
 * segment-segment closest-point test rather than the reference system's
 * ellipsoid approximations. Contacts carry a signed depth, a world normal and
 * the parametric position along each capsule, which is what lets the solver
 * convert a penetration into a joint-space correction instead of just shoving
 * the endpoint.
 *
 * Soft-tissue allowance: real bodies flatten where they touch. Each contact
 * gets a compression budget, so partners rest against each other instead of
 * hovering a centimetre apart - the failure mode that makes rigid-body posing
 * look wrong.
 */

import {
  aabbOverlaps,
  clamp,
  closestPointsBetweenSegments,
  v3add,
  v3cross,
  v3dot,
  v3lenSq,
  v3mul,
  v3normalize,
  v3sub,
} from "./math.js";
import { radiusAt, selfCollisionExempt } from "./body.js";

/** Default compression allowance per volume kind, in metres. */
export const COMPRESSION = {
  default: 0.010,
  soft: 0.018,
  declaredContact: 0.022,
};

/**
 * How far a single volume yields, when it yields more than `soft` says.
 *
 * `soft` is one number for every fleshy part of the body, which is right for
 * most of them - a calf and a forearm really do give about the same amount -
 * and wrong for the breast, which is the most compressible tissue on a person
 * and flattens to a fraction of its depth under a chest lying on it. Without
 * this, modelling a bust at all reads as two scenes' worth of penetration that
 * a photograph of the same pose plainly does not show.
 *
 * Read from the volume, so `body.js` says how soft each part of the body is
 * where it says how big that part is, and the two cannot drift apart.
 */
export const volumeCompression = (volume) =>
  volume.compression ?? (volume.soft ? COMPRESSION.soft : COMPRESSION.default);

/** Axis-aligned bounds of a single posed round cone. */
export function volumeBounds(volume, padding = 0) {
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const lo = Math.min(volume.a[i] - volume.ra, volume.b[i] - volume.rb);
    const hi = Math.max(volume.a[i] + volume.ra, volume.b[i] + volume.rb);
    min[i] = lo - padding;
    max[i] = hi + padding;
  }
  return { min, max };
}

/**
 * Exact contact between two round cones.
 * Returns `null` when they are further apart than `margin`.
 */
export function capsuleContact(v1, v2, margin = 0) {
  const { s, t, c1, c2, distanceSq } = closestPointsBetweenSegments(v1.a, v1.b, v2.a, v2.b);
  const r1 = radiusAt(v1, s);
  const r2 = radiusAt(v2, t);
  const sum = r1 + r2;
  if (distanceSq > (sum + margin) * (sum + margin)) return null;

  const distance = Math.sqrt(distanceSq);
  let normal;
  if (distance > 1e-7) {
    normal = v3mul(v3sub(c2, c1), 1 / distance);
  } else {
    // Concentric axes: pick a stable separating direction perpendicular to the
    // first capsule so the correction never collapses to zero.
    const axis = v3sub(v1.b, v1.a);
    const fallback = v3lenSq(axis) > 1e-9 ? v3cross(axis, [0, 1, 0]) : [1, 0, 0];
    normal = v3lenSq(fallback) > 1e-9 ? v3normalize(fallback) : [1, 0, 0];
  }

  return {
    depth: sum - distance,
    normal,
    pointA: v3add(c1, v3mul(normal, r1)),
    pointB: v3sub(c2, v3mul(normal, r2)),
    s,
    t,
    volumeA: v1,
    volumeB: v2,
  };
}

/**
 * Contact between a round cone and an axis-aligned box (props and furniture).
 * Samples along the capsule axis, which handles a limb lying across an edge
 * far better than testing the two endpoints alone.
 */
export function capsuleBoxContact(volume, box, samples = 7) {
  let best = null;
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    const point = [
      volume.a[0] + (volume.b[0] - volume.a[0]) * t,
      volume.a[1] + (volume.b[1] - volume.a[1]) * t,
      volume.a[2] + (volume.b[2] - volume.a[2]) * t,
    ];
    const radius = radiusAt(volume, t);
    const closest = [
      clamp(point[0], box.min[0], box.max[0]),
      clamp(point[1], box.min[1], box.max[1]),
      clamp(point[2], box.min[2], box.max[2]),
    ];
    const delta = v3sub(point, closest);
    const distanceSq = v3lenSq(delta);
    let depth;
    let normal;

    if (distanceSq > 1e-12) {
      const distance = Math.sqrt(distanceSq);
      depth = radius - distance;
      normal = v3mul(delta, 1 / distance); // points out of the box
    } else {
      // centre inside the box: escape along the nearest face
      let axis = 0;
      let bestGap = Infinity;
      let sign = 1;
      for (let k = 0; k < 3; k += 1) {
        const lo = point[k] - box.min[k];
        const hi = box.max[k] - point[k];
        if (lo < bestGap) {
          bestGap = lo;
          axis = k;
          sign = -1;
        }
        if (hi < bestGap) {
          bestGap = hi;
          axis = k;
          sign = 1;
        }
      }
      normal = [0, 0, 0];
      normal[axis] = sign;
      depth = radius + bestGap;
    }

    if (depth > 0 && (!best || depth > best.depth)) {
      best = { depth, normal, t, point, radius, volume, box };
    }
  }
  return best;
}

/**
 * Broad + narrow phase over a set of posed bodies.
 *
 * @param {Array<{id:string, volumes:Array, mass:number}>} bodies
 * @param {object} [options]
 * @param {boolean} [options.selfCollision]
 * @param {number} [options.margin] extra detection range, metres
 * @param {Set<string>} [options.declared] `"actorA:boneA|actorB:boneB"` keys that
 *        are intended contacts and get a larger compression allowance
 * @returns {Array<object>} contacts, deepest first
 */
export function detectContacts(bodies, options = {}) {
  const { selfCollision = true, margin = 0, declared = null } = options;
  const contacts = [];

  const bounds = bodies.map((body) => body.volumes.map((volume) => volumeBounds(volume, margin)));

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i; j < bodies.length; j += 1) {
      const sameBody = i === j;
      if (sameBody && !selfCollision) continue;
      const bodyA = bodies[i];
      const bodyB = bodies[j];

      for (let x = 0; x < bodyA.volumes.length; x += 1) {
        const volumeA = bodyA.volumes[x];
        const startY = sameBody ? x + 1 : 0;
        for (let y = startY; y < bodyB.volumes.length; y += 1) {
          const volumeB = bodyB.volumes[y];
          if (sameBody && selfCollisionExempt(volumeA, volumeB)) continue;
          if (!aabbOverlaps(bounds[i][x], bounds[j][y])) continue;

          const contact = capsuleContact(volumeA, volumeB, margin);
          if (!contact) continue;

          const key = contactKey(bodyA.id, volumeA.bone, bodyB.id, volumeB.bone);
          const isDeclared = declared?.has(key) ?? false;
          const allowance = Math.max(
            isDeclared ? COMPRESSION.declaredContact : 0,
            volumeCompression(volumeA),
            volumeCompression(volumeB)
          );

          const effectiveDepth = contact.depth - allowance;
          if (effectiveDepth <= 0) continue;

          contacts.push({
            ...contact,
            depth: effectiveDepth,
            rawDepth: contact.depth,
            allowance,
            declared: isDeclared,
            bodyA: i,
            bodyB: j,
            self: sameBody,
            groupA: volumeA.group,
            groupB: volumeB.group,
          });
        }
      }
    }
  }

  contacts.sort((a, b) => b.depth - a.depth);
  return contacts;
}

export function contactKey(actorA, boneA, actorB, boneB) {
  const left = `${actorA}:${boneA}`;
  const right = `${actorB}:${boneB}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

/**
 * Contacts between bodies and static props (beds, chairs, the floor).
 * The floor is passed as a very large, very thin box so one code path handles
 * both resting on furniture and resting on the ground.
 */
export function detectPropContacts(bodies, props, margin = 0) {
  const contacts = [];
  for (let i = 0; i < bodies.length; i += 1) {
    for (const volume of bodies[i].volumes) {
      const volumeBox = volumeBounds(volume, margin);
      for (const prop of props) {
        if (!aabbOverlaps(volumeBox, prop.box)) continue;
        const contact = capsuleBoxContact(volume, prop.box);
        if (!contact) continue;
        const allowance = volumeCompression(volume);
        const depth = contact.depth - allowance;
        if (depth <= 0) continue;
        contacts.push({ ...contact, depth, bodyIndex: i, prop, allowance });
      }
    }
  }
  contacts.sort((a, b) => b.depth - a.depth);
  return contacts;
}

/** Summary statistics used for the UI's quality report and for tests. */
export function penetrationReport(contacts) {
  let max = 0;
  let total = 0;
  let selfCount = 0;
  for (const contact of contacts) {
    if (contact.depth > max) max = contact.depth;
    total += contact.depth;
    if (contact.self) selfCount += 1;
  }
  return {
    count: contacts.length,
    maxDepth: max,
    totalDepth: total,
    selfCount,
    clean: contacts.length === 0,
  };
}

/**
 * Lowest point of a body's volumes, used to seat actors on their support
 * surface without needing a full contact pass.
 */
export function lowestPoint(volumes) {
  let min = Infinity;
  for (const volume of volumes) {
    min = Math.min(min, volume.a[1] - volume.ra, volume.b[1] - volume.rb);
  }
  return min;
}

/**
 * Decompose a set of contacts into a single rigid correction (translation plus
 * a rotation about the body's centre) for one body.
 *
 * Averaging positions and torques rather than applying corrections one at a
 * time keeps the result stable when a body is wedged between several others.
 */
export function rigidCorrection(contacts, bodyIndex, centre, { torqueScale = 0.6 } = {}) {
  let translation = [0, 0, 0];
  let torque = [0, 0, 0];
  let weight = 0;

  for (const contact of contacts) {
    let normal;
    let point;
    let share;
    if (contact.bodyA === bodyIndex && contact.bodyB === bodyIndex) continue;
    if (contact.bodyA === bodyIndex) {
      normal = v3mul(contact.normal, -1); // push A away from B
      point = contact.pointA;
      share = contact.self ? 0 : 0.5;
    } else if (contact.bodyB === bodyIndex) {
      normal = contact.normal;
      point = contact.pointB;
      share = contact.self ? 0 : 0.5;
    } else {
      continue;
    }
    if (share === 0) continue;

    const impulse = v3mul(normal, contact.depth * share);
    translation = v3add(translation, impulse);
    torque = v3add(torque, v3cross(v3sub(point, centre), impulse));
    weight += 1;
  }

  if (weight === 0) return { translation: [0, 0, 0], torque: [0, 0, 0] };
  return {
    translation: v3mul(translation, 1 / weight),
    torque: v3mul(torque, torqueScale / weight),
  };
}

/** Does `normal` point mostly along `reference`? Used to classify supports. */
export const alignedWith = (normal, reference, threshold = 0.7) =>
  v3dot(v3normalize(normal), v3normalize(reference)) > threshold;
