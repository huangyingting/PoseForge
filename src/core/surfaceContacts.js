/** Rendered-surface measurements and collision-checked free-limb corrections. */
import { skinHumanMesh } from "./humanMesh.js";
import { landmarkPoint, resolveLandmark } from "./landmarks.js";
import { LIMB_CHAINS, solveTwoBoneIK } from "./ik.js";
import {
  chainForBone,
  refresh,
  measureSceneSafety,
  measureContactTargets,
} from "./solver.js";
import { buildTriangleTree, closestMeshPoints } from "./meshDistance.js";

export const SURFACE_CONTACT_TOLERANCE = 0.004;
const vDistanceSq = (a, b) =>
  a.reduce((sum, value, k) => sum + (value - b[k]) ** 2, 0);
const topologyCache = new WeakMap();

function region(actor, name, side) {
  const landmark = resolveLandmark(name, side);
  if (!landmark) return null;
  let bones = [landmark.bone],
    radius = 0.11;
  if (name === "hand") {
    bones = [`wrist_${landmark.side}`];
    radius = 0.14;
  } else if (name === "foot") {
    bones = [`ankle_${landmark.side}`, `toe_${landmark.side}`];
    radius = 0.16;
  } else if (
    name === "forearm" ||
    name === "upperArm" ||
    name === "shin" ||
    name === "thigh"
  )
    radius = 0.2;
  else if (["elbow", "knee", "ankle", "shoulder", "hip"].includes(name)) {
    bones = actor.skeleton.bones
      .filter(
        (bone) => actor.skeleton.boneDistance(bone.name, landmark.bone) <= 1,
      )
      .map((bone) => bone.name);
    radius = 0.075;
  } else if (name === "head" || name === "face") radius = 0.16;
  else if (
    [
      "back",
      "upperBack",
      "lowerBack",
      "chest",
      "sternum",
      "torso",
      "waist",
      "abdomen",
      "ribs",
      "shoulders",
      "neck",
    ].includes(name)
  ) {
    bones = ["spine01", "spine02", "spine03", "neck"];
    radius = name === "torso" ? 0.28 : 0.15;
  }
  return {
    bones: new Set(bones),
    radius: radius * actor.skeleton.stature,
    anchor: landmarkPoint(actor, name, side),
  };
}

/** Finger joints inherit the wrist's region even though the core has no finger bones. */
function inheritedBones(template) {
  return template.joints.map((joint, index) => {
    let at = index;
    while (at >= 0) {
      const bone = template.joints[at].bone;
      if (bone) return bone;
      at = template.joints[at].parent;
    }
    return null;
  });
}
function topology(template, definition) {
  if (!topologyCache.has(template)) topologyCache.set(template, new Map());
  const cache = topologyCache.get(template);
  const key =
    [...definition.bones].sort().join("|") +
    `:${definition.whole ? "whole" : "region"}`;
  if (cache.has(key)) return cache.get(key);
  const bones = inheritedBones(template);
  const result = template.submeshes.map((part) => {
    if (!part.primary && !part.garment && !part.hair && part.colour)
      return null;
    const weight = new Float32Array(part.positions.length / 3);
    for (let v = 0; v < weight.length; v++)
      for (let k = 0; k < 4; k++) {
        if (definition.bones.has(bones[part.joints[v * 4 + k]]))
          weight[v] += part.weights[v * 4 + k];
      }
    const indices = [];
    for (let i = 0; i < part.indices.length; i += 3) {
      const a = part.indices[i],
        b = part.indices[i + 1],
        c = part.indices[i + 2];
      if (
        [a, b, c].filter(
          (v) => weight[v] >= (definition.whole ? 0.00001 : 0.35),
        ).length >= (definition.whole ? 1 : 2)
      )
        indices.push(a, b, c);
    }
    return Uint32Array.from(indices);
  });
  cache.set(key, result);
  return result;
}

/** Queries reuse posed geometry until the actor's evaluated rig changes. */
export function createSurfaceContactQuery(actors, templates) {
  const cache = new Map();
  const pairs = new WeakMap();
  const closest = (a, b) => {
    if (!a || !b) return null;
    if (!pairs.has(a)) pairs.set(a, new WeakMap());
    const memo = pairs.get(a);
    if (!memo.has(b)) memo.set(b, closestMeshPoints(a, b));
    return memo.get(b);
  };
  function tree(index, name, side, whole = null) {
    const actor = actors[index],
      template = templates[index];
    if (!actor || !template) return null;
    let entry = cache.get(index);
    if (!entry || entry.evaluated !== actor.evaluated) {
      entry = {
        evaluated: actor.evaluated,
        parts: skinHumanMesh(
          template,
          actor.skeleton,
          actor.evaluated,
          undefined,
          actor.hands,
          actor.hang,
        ),
        trees: new Map(),
      };
      cache.set(index, entry);
    }
    const key = whole ? [...whole].sort().join("|") : `${name}.${side ?? ""}`;
    if (!entry.trees.has(key)) {
      const definition = whole
        ? { bones: whole, anchor: [0, 0, 0], radius: Infinity, whole: true }
        : region(actor, name, side);
      if (!definition?.anchor) return null;
      const regions = topology(template, definition);
      const parts = [];
      entry.parts.forEach((part, i) => {
        if (!regions[i]?.length) return;
        const indices = [],
          radiusSq = definition.radius ** 2;
        for (let j = 0; j < regions[i].length; j += 3) {
          const tri = [regions[i][j], regions[i][j + 1], regions[i][j + 2]];
          if (
            tri.some(
              (v) =>
                vDistanceSq(
                  part.positions.subarray(v * 3, v * 3 + 3),
                  definition.anchor,
                ) <= radiusSq,
            )
          )
            indices.push(...tri);
        }
        if (indices.length) parts.push({ positions: part.positions, indices });
      });
      entry.trees.set(key, buildTriangleTree(parts));
    }
    return entry.trees.get(key);
  }
  const query = (contact) => {
    const local = closest(
      tree(contact.fromActor, contact.from, contact.fromSide),
      tree(contact.toActor, contact.to, contact.toSide),
    );
    if (!local) return null;
    const group = limbGroup(contact);
    const full = group && query.limbs(group);
    return full?.intersects
      ? {
          ...local,
          intersects: true,
          regionIntersects: local.intersects,
          limbIntersects: true,
          normal: full.normal,
        }
      : local;
  };
  query.limbs = (group) =>
    closest(
      tree(group.fromActor, "", null, group.fromBones),
      tree(group.toActor, "", null, group.toBones),
    );
  return query;
}

function limbGroup(contact) {
  const a = chainForBone(
    resolveLandmark(contact.from, contact.fromSide)?.bone ?? "",
  );
  const b = chainForBone(
    resolveLandmark(contact.to, contact.toSide)?.bone ?? "",
  );
  if (!a || !b) return null;
  const chainA = LIMB_CHAINS[a],
    chainB = LIMB_CHAINS[b];
  return {
    key: `${contact.fromActor}:${a}|${contact.toActor}:${b}`,
    fromActor: contact.fromActor,
    toActor: contact.toActor,
    fromBones: new Set([chainA.root, chainA.mid, chainA.end, chainA.tip]),
    toBones: new Set([chainB.root, chainB.mid, chainB.end, chainB.tip]),
  };
}

function contactLimbGroups(solved) {
  const groups = new Map();
  for (const contact of solved.contacts) {
    if (contact.strength <= 0) continue;
    const group = limbGroup(contact);
    if (group) groups.set(group.key, group);
  }
  return [...groups.values()];
}

/** Coarse limb overlap may be superseded only by complete, outward-facing,
 * non-intersecting rendered limb surfaces. Self/prop/other-body checks remain. */
export function measureSurfaceSafety(solved, query) {
  const groups = contactLimbGroups(solved).map((group) => ({
    ...group,
    result: query.limbs(group),
  }));
  const verifiedPair = (contact) =>
    groups.some(
      (group) =>
        group.result &&
        !group.result.intersects &&
        group.result.facing &&
        ((contact.bodyA === group.fromActor &&
          contact.bodyB === group.toActor &&
          group.fromBones.has(contact.volumeA.bone) &&
          group.toBones.has(contact.volumeB.bone)) ||
          (contact.bodyB === group.fromActor &&
            contact.bodyA === group.toActor &&
            group.fromBones.has(contact.volumeB.bone) &&
            group.toBones.has(contact.volumeA.bone))),
    );
  return {
    ...measureSceneSafety(solved, { verifiedPair }),
    limbIntersections: groups.map((group) => !!group.result?.intersects),
  };
}

const score = (measurements, contacts) =>
  measurements.reduce(
    (sum, value, i) =>
      sum +
      (value
        ? (value.intersects
            ? 0.02 ** 2
            : Math.max(0, value.distance - SURFACE_CONTACT_TOLERANCE) ** 2) *
          (contacts[i].strength ?? 1)
        : 0),
    0,
  );
const clonePose = (actor) => ({
  root: {
    position: [...actor.pose.root.position],
    quaternion: [...actor.pose.root.quaternion],
  },
  joints: Object.fromEntries(
    Object.entries(actor.pose.joints).map(([key, value]) => [
      key,
      { ...value },
    ]),
  ),
});

/** Mutates the solved rig, never the template or independent rendered vertices. */
export function* surfaceContactSteps(
  solved,
  templates,
  { maxPasses = 8, maxSteps = 32 } = {},
) {
  const originalPoses = solved.actors.map(clonePose);
  let completed = false;
  try {
    yield { steps: 0 };
    const query = createSurfaceContactQuery(solved.actors, templates);
    let measurements = solved.contacts.map(query);
    const before = measurements.map((value) => value?.distance ?? null);
    const beforeIntersects = measurements.map(
      (value) => value?.intersects ?? false,
    );
    const initialRoots = solved.actors.map((actor) => [
      ...actor.pose.root.position,
    ]);
    const initialSafety = measureSurfaceSafety(solved, query);
    const originalViolations = new Map(
      initialSafety.violations.map((v) => [v.key, v.depth]),
    );
    let currentSafety = initialSafety;
    let bestScore = score(measurements, solved.contacts),
      steps = 0;
    const reasons = new Map();
    for (let pass = 0; pass < maxPasses && steps < maxSteps; pass++) {
      let improved = false;
      for (let i = 0; i < solved.contacts.length && steps < maxSteps; i++) {
        const contact = solved.contacts[i],
          measured = measurements[i];
        if (
          !measured ||
          (!measured.intersects &&
            measured.distance <= SURFACE_CONTACT_TOLERANCE) ||
          contact.strength <= 0
        )
          continue;
        const actor = solved.actors[contact.fromActor];
        const resolved = resolveLandmark(contact.from, contact.fromSide);
        const chain = LIMB_CHAINS[chainForBone(resolved?.bone ?? "")];
        if (!chain) {
          reasons.set(i, "not_a_free_limb");
          continue;
        }
        if (
          [chain.root, chain.mid, chain.end].some((bone) =>
            actor.loadBearing.has(bone),
          )
        ) {
          reasons.set(i, "load_bearing");
          continue;
        }
        const acceptCandidate = () => {
          const safety = measureSurfaceSafety(solved, query);
          if (
            ![
              "maxDepth",
              "maxSelfDepth",
              "maxBodyDepth",
              "propPenetration",
              "totalDepth",
            ].every((key) => safety[key] <= initialSafety[key] + 1e-8)
          )
            return false;
          if (
            safety.violations.some(
              (v) => v.depth > (originalViolations.get(v.key) ?? 0) + 1e-8,
            )
          )
            return false;
          if (
            safety.limbIntersections.some(
              (hit, k) => hit && !currentSafety.limbIntersections[k],
            )
          )
            return false;
          const candidate = solved.contacts.map(query);
          const candidateScore = score(candidate, solved.contacts);
          const newIntersection = candidate.some(
            (value, j) => value?.intersects && !measurements[j]?.intersects,
          );
          if (newIntersection || candidateScore >= bestScore - 1e-10)
            return false;
          measurements = candidate;
          currentSafety = safety;
          bestScore = candidateScore;
          improved = true;
          reasons.delete(i);
          return true;
        };
        const saved = clonePose(actor);
        const end =
          actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
        const gain = measured.intersects
          ? 0
          : Math.min(0.025, measured.distance - 0.0015) / measured.distance;
        const delta = measured.intersects
          ? measured.normal.map((v) => v * 0.003)
          : measured.to.map((v, k) => (v - measured.from[k]) * gain);
        for (const factor of measured.intersects
          ? [1, 2, 4, 8]
          : [1, 0.5, 0.25]) {
          if (steps >= maxSteps) break;
          steps++;
          const target = end.map((v, k) => v + delta[k] * factor);
          const result = solveTwoBoneIK(
            actor.skeleton,
            actor.pose,
            chain,
            target,
            { evaluated: actor.evaluated, weight: contact.strength ?? 1 },
          );
          refresh(actor);
          if (acceptCandidate()) break;
          actor.pose = clonePose({ pose: saved });
          refresh(actor);
          reasons.set(
            i,
            result.unreachable ? "out_of_reach" : "movement_limited",
          );
        }
        // A small turn of a free wrist can meet a surface without pushing the
        // whole palm through the collision envelope. Respect authored wrist
        // angles and never use this on a load-bearing arm.
        if (
          contact.from === "hand" &&
          !actor.spec?.joints?.[chain.end] &&
          (measurements[i].intersects ||
            measurements[i].distance > SURFACE_CONTACT_TOLERANCE)
        ) {
          const beforeTurn = clonePose(actor);
          const angles = beforeTurn.joints[chain.end] ?? {};
          for (const [axis, degrees] of [
            ["flexion", -6],
            ["flexion", 6],
            ["abduction", -6],
            ["abduction", 6],
          ]) {
            if (steps >= maxSteps) break;
            steps++;
            actor.pose.joints[chain.end] = actor.skeleton.clampAngles(
              chain.end,
              { ...angles, [axis]: (angles[axis] ?? 0) + degrees },
            );
            refresh(actor);
            if (acceptCandidate()) break;
            actor.pose = clonePose({ pose: beforeTurn });
            refresh(actor);
          }
        }
        // A small step along the floor can make a reach possible for different
        // statures. Both feet/knees keep their height and relative support. Do
        // not slide seated figures off furniture or move an explicitly pinned
        // actor, and cap displacement from the original composition.
        const remaining = measurements[i];
        if (
          (remaining.intersects ||
            remaining.distance > SURFACE_CONTACT_TOLERANCE) &&
          actor.mobility > 0 &&
          !actor.carried &&
          solved.surface.id === "floor" &&
          actor.posture.supports.length &&
          actor.posture.supports.every((support) =>
            ["foot", "knee", "shin"].includes(support.landmark),
          )
        ) {
          const original = clonePose(actor);
          const direction = remaining.intersects
            ? remaining.normal
            : remaining.to.map((v, k) => v - remaining.from[k]);
          const length = Math.hypot(direction[0], direction[2]);
          if (length > 1e-6)
            for (const step of [
              Math.min(0.02, length),
              Math.min(0.01, length * 0.5),
            ]) {
              if (steps >= maxSteps) break;
              const wanted = [...original.root.position];
              wanted[0] += (direction[0] / length) * step;
              wanted[2] += (direction[2] / length) * step;
              if (
                Math.hypot(
                  wanted[0] - initialRoots[contact.fromActor][0],
                  wanted[2] - initialRoots[contact.fromActor][2],
                ) >
                actor.skeleton.stature * 0.04
              )
                continue;
              steps++;
              actor.pose.root.position = wanted;
              refresh(actor);
              if (acceptCandidate()) break;
              actor.pose = clonePose({ pose: original });
              refresh(actor);
            }
        }
        yield { steps };
      }
      if (!improved) break;
    }
    // Always query the final state again: another contact may move the same arm.
    measurements = solved.contacts.map(query);
    const targetDistances = measureContactTargets(solved);
    const previous = solved.quality.contactDetail;
    const detail = solved.contacts.map((contact, i) => {
      const old = previous.find(
        (p) =>
          p.source === contact.source && p.sourceIndex === contact.sourceIndex,
      );
      const value = measurements[i];
      return {
        from: contact.from,
        to: contact.to,
        fromActor: contact.fromActor,
        toActor: contact.toActor,
        fromSide: contact.fromSide,
        toSide: contact.toSide,
        source: contact.source,
        sourceIndex: contact.sourceIndex,
        strength: contact.strength,
        distance:
          value?.distance ?? targetDistances[i] ?? old?.distance ?? null,
        targetDistance: targetDistances[i],
        surfaceGap: value?.distance ?? null,
        beforeSurfaceGap: before[i],
        beforeIntersects: beforeIntersects[i],
        basis: value ? "rendered" : "body-model",
        intersects: value?.intersects ?? false,
        limbIntersects: value?.limbIntersects ?? false,
        tolerance: value ? SURFACE_CONTACT_TOLERANCE : 0.012,
        reason: value ? (reasons.get(i) ?? null) : "surface_unavailable",
        blocked:
          reasons.get(i) === "movement_limited" ||
          reasons.get(i) === "load_bearing",
        unreachable:
          reasons.get(i) === "out_of_reach" ||
          (!value && old?.unreachable) ||
          false,
      };
    });
    const warnings = [...(solved.quality.placementWarnings ?? [])];
    for (const item of detail) {
      if (item.strength === 0) continue;
      if (!Number.isFinite(item.distance))
        warnings.push(
          `${item.from} to ${item.to}: a contact measurement is unavailable.`,
        );
      else if (item.intersects)
        warnings.push(
          `${item.from} and ${item.to} surfaces intersect; adjust the pose.`,
        );
      else if (item.distance > (item.basis === "rendered" ? 0.012 : 0.06))
        warnings.push(
          `${item.from} to ${item.to}: ${Math.round(item.distance * 1000)}mm ${item.basis === "rendered" ? "between rendered surfaces" : "from the body-model target"}.`,
        );
    }
    Object.assign(solved.quality, measureSurfaceSafety(solved, query), {
      contactDetail: detail,
      warnings,
      unmetContacts: detail.filter(
        (item) =>
          item.strength > 0 &&
          (!Number.isFinite(item.distance) ||
            item.intersects ||
            item.distance >
              (item.basis === "rendered" ? SURFACE_CONTACT_TOLERANCE : 0.06)),
      ).length,
      surfaceRefinement: {
        steps,
        before,
        after: measurements.map((value) => value?.distance ?? null),
      },
    });
    completed = true;
    return solved;
  } finally {
    if (!completed)
      solved.actors.forEach((actor, i) => {
        actor.pose = originalPoses[i];
        refresh(actor);
      });
  }
}

/** Synchronous entry point for the CLI and geometry validators. */
export function refineSurfaceContacts(...args) {
  const steps = surfaceContactSteps(...args);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
