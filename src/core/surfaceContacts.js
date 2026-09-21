/** Rendered-surface measurements and collision-checked free-limb corrections. */
import { skinHumanMesh } from "./humanMesh.js";
import {
  landmarkPoint,
  landmarkSurface,
  resolveLandmark,
} from "./landmarks.js";
import { LIMB_CHAINS, solveTwoBoneIK } from "./ik.js";
import { CHANNELS } from "./skeleton.js";
import { clamp, quatRotate, v3dot, v3sub } from "./math.js";
import {
  standingContactPoses,
  standingFramePreserved,
} from "./standingContacts.js";
import {
  chainForBone,
  refresh,
  measureSceneSafety,
  measureContactTargets,
  measureBodySupportResidual,
  balanceFromPoints,
} from "./solver.js";
import {
  buildTriangleTree,
  refitTriangleTree,
  closestMeshPoints,
} from "./meshDistance.js";
import {
  measureSurfaceSupport,
  measureSupportContactBounds,
} from "./surfaceSupport.js";
import { measurePropSurface } from "./surfaceProps.js";
import { SURFACES } from "./poseLibrary.js";
import {
  seatedSupportFrame,
  seatedFramePreserved,
  seatedSupportPoses,
} from "./seatedSupports.js";
import {
  kneelingSupportFrame,
  kneelingFramePreserved,
  kneelingSupportPoses,
} from "./kneelingSupports.js";
import {
  forearmSupportFrame,
  forearmFramePreserved,
  forearmSupportPoses,
} from "./forearmSupports.js";
import {
  levelSeatedSupportFrame,
  levelSeatedFramePreserved,
  levelSeatedSupportPoses,
} from "./levelSeatedSupports.js";

export const SURFACE_CONTACT_TOLERANCE = 0.004;
const vDistanceSq = (a, b) =>
  a.reduce((sum, value, k) => sum + (value - b[k]) ** 2, 0);
const topologyCache = new WeakMap();

function region(actor, name, side) {
  const landmark = resolveLandmark(name, side);
  if (!landmark) return null;
  let bones = [...landmark.bones],
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
    if (
      !definition.whole &&
      !part.primary &&
      !part.garment &&
      !part.hair &&
      part.colour
    )
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
  const wholeTrees = new Map();
  const pairs = new WeakMap();
  const crossings = new WeakMap();
  const closest = (a, b, crossingsOnly = false) => {
    if (!a || !b) return null;
    const results = crossingsOnly ? crossings : pairs;
    if (!results.has(a)) results.set(a, new WeakMap());
    const memo = results.get(a);
    if (!memo.has(b)) memo.set(b, closestMeshPoints(a, b, { crossingsOnly }));
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
    const figure = whole === true;
    const key = figure
      ? "$figure"
      : whole
        ? [...whole].sort().join("|")
        : `${name}.${side ?? ""}`;
    if (!entry.trees.has(key)) {
      const definition = whole
        ? { bones: whole, anchor: [0, 0, 0], radius: Infinity, whole: true }
        : region(actor, name, side);
      if (!definition?.anchor) return null;
      const regions = figure
        ? entry.parts.map((part) => part.indices)
        : topology(template, definition);
      const parts = [];
      let unavailable = false;
      entry.parts.forEach((part, i) => {
        if (!regions[i]?.length) return;
        if (figure) {
          if (
            regions[i].some(
              (vertex) =>
                !Number.isFinite(part.positions[vertex * 3]) ||
                !Number.isFinite(part.positions[vertex * 3 + 1]) ||
                !Number.isFinite(part.positions[vertex * 3 + 2]),
            )
          )
            unavailable = true;
          parts.push({ positions: part.positions, indices: regions[i] });
          return;
        }
        const indices = [],
          radiusSq = definition.radius ** 2;
        for (let j = 0; j < regions[i].length; j += 3) {
          const tri = [regions[i][j], regions[i][j + 1], regions[i][j + 2]];
          if (
            tri.some(
              (v) =>
                ![0, 1, 2].every((k) =>
                  Number.isFinite(part.positions[v * 3 + k]),
                ),
            )
          ) {
            unavailable = true;
            continue;
          }
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
      const treeKey = `${index}:${key}`;
      const result = unavailable
        ? null
        : whole
          ? refitTriangleTree(wholeTrees.get(treeKey), parts)
          : buildTriangleTree(parts);
      if (whole) wholeTrees.set(treeKey, result);
      entry.trees.set(key, result);
    }
    return entry.trees.get(key);
  }
  const query = (contact) => {
    const local = closest(
      tree(contact.fromActor, contact.from, contact.fromSide),
      tree(contact.toActor, contact.to, contact.toSide),
    );
    if (!local) return null;
    const group = limbGroup(contact, actors);
    const full = group && query.limbs(group, true);
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
  query.limbs = (group, crossingsOnly = false) =>
    closest(
      tree(group.fromActor, "", null, group.fromBones),
      tree(group.toActor, "", null, group.toBones),
      crossingsOnly,
    );
  query.figures = (fromActor, toActor, crossingsOnly = false) =>
    closest(
      tree(fromActor, "", null, true),
      tree(toActor, "", null, true),
      crossingsOnly,
    );
  query.support = (index, support, surface) =>
    measureSurfaceSupport(
      tree(index, support.landmark, support.side),
      support,
      surface,
    );
  query.supportBounds = (index, support, surface) =>
    measureSupportContactBounds(
      tree(index, support.landmark, support.side),
      support,
      surface,
    );
  query.prop = (index, prop) =>
    measurePropSurface(tree(index, "", null, true), prop);
  query.lowest = (index) => tree(index, "", null, true)?.min[1] ?? null;
  return query;
}

/** Keep the coarse estimate available when a support's mesh is missing. */
export function measureRenderedSupports(solved, query) {
  return solved.actors.map((actor, index) => {
    if (actor.supportBasis !== "surface")
      return {
        actor: index,
        basis: actor.supportBasis,
        gap: null,
        bodyGap: null,
        penetration: null,
        unavailable: 0,
        supports: [],
      };
    const supports = actor.posture.supports.map((support) => ({
      ...support,
      measurement: query.support(index, support, solved.surface),
    }));
    const unavailable = supports.filter(
      (support) => !support.measurement,
    ).length;
    const bodyGap = measureBodySupportResidual(actor, solved.surface);
    return {
      actor: index,
      basis: unavailable ? "body-model" : "rendered",
      gap: unavailable
        ? bodyGap
        : Math.max(0, ...supports.map((support) => support.measurement.gap)),
      bodyGap,
      penetration: unavailable
        ? null
        : Math.max(
            0,
            ...supports.map((support) => support.measurement.penetration),
          ),
      unavailable,
      supports,
    };
  });
}

export function measureRenderedBalance(solved, query) {
  return solved.actors.map((actor, index) => {
    if (actor.supportBasis !== "surface") return null;
    const supports = new Map(
      [
        ...actor.posture.supports,
        { landmark: "foot", side: "l" },
        { landmark: "foot", side: "r" },
      ].map((support) => [
        `${support.landmark}.${support.side ?? ""}`,
        support,
      ]),
    );
    const points = [];
    for (const support of supports.values()) {
      const bounds = query.supportBounds(index, support, solved.surface);
      if (!bounds) return null;
      if (bounds.min) points.push(bounds.min, bounds.max);
    }
    return { ...balanceFromPoints(actor, points), basis: "rendered-support" };
  });
}

/** The studio floor is distinct from raised bed/sofa support planes. */
export function measureFloorSurfaces(solved, query) {
  return solved.actors.map((actor, index) => {
    const minimumY = query.lowest(index);
    return {
      actor: index,
      minimumY,
      penetration:
        minimumY == null ? null : Math.max(0, SURFACES.floor.height - minimumY),
    };
  });
}

function* figureChecks(solved, query) {
  for (let fromActor = 0; fromActor < solved.actors.length; fromActor++)
    for (let toActor = fromActor + 1; toActor < solved.actors.length; toActor++)
      yield {
        fromActor,
        toActor,
        intersects: query.figures(fromActor, toActor, true)?.intersects ?? null,
      };
}

/** Every rendered figure pair, including pairs with no declared contact. */
export const measureFigureSurfaces = (solved, query) => [
  ...figureChecks(solved, query),
];

function* propChecks(solved, query) {
  for (let index = 0; index < solved.actors.length; index++)
    for (let k = 0; k < solved.props.length; k++) {
      const prop = solved.props[k],
        result = query.prop(index, prop);
      yield {
        actor: index,
        prop: k,
        kind: prop.kind,
        intersects: result?.intersects ?? null,
        reason: result ? result.reason : "surface_unavailable",
      };
    }
}
export const measurePropSurfaces = (solved, query) => [
  ...propChecks(solved, query),
];

function limbGroup(contact, actors) {
  const a = chainForBone(
    resolveLandmark(contact.from, contact.fromSide)?.bone ?? "",
  );
  const b = chainForBone(
    resolveLandmark(contact.to, contact.toSide)?.bone ?? "",
  );
  if (!a && !b) return null;
  const chainA = LIMB_CHAINS[a],
    chainB = LIMB_CHAINS[b];
  return {
    key: `${contact.fromActor}:${a ?? "body"}|${contact.toActor}:${b ?? "body"}`,
    fromActor: contact.fromActor,
    toActor: contact.toActor,
    fromBones: new Set(
      chainA
        ? [chainA.root, chainA.mid, chainA.end, chainA.tip]
        : actors[contact.fromActor].skeleton.bones.map((bone) => bone.name),
    ),
    toBones: new Set(
      chainB
        ? [chainB.root, chainB.mid, chainB.end, chainB.tip]
        : actors[contact.toActor].skeleton.bones.map((bone) => bone.name),
    ),
  };
}

function contactLimbGroups(solved) {
  const groups = new Map();
  for (const contact of solved.contacts) {
    if (contact.strength <= 0) continue;
    const group = limbGroup(contact, solved.actors);
    if (group) groups.set(group.key, group);
  }
  return [...groups.values()];
}

/** Coarse limb overlap may be superseded only by complete, outward-facing,
 * non-intersecting rendered limb surfaces. Self/prop/other-body checks remain. */
export function measureSurfaceSafety(
  solved,
  query,
  { wholeFigures = false, wholeProps = false } = {},
) {
  const groups = contactLimbGroups(solved).map((group) => ({
    ...group,
    result: query.limbs(group, true),
  }));
  const verifiedPair = (contact) => {
    if (
      groups.some(
        (group) =>
          group.result &&
          !group.result.intersects &&
          ((contact.bodyA === group.fromActor &&
            contact.bodyB === group.toActor &&
            group.fromBones.has(contact.volumeA.bone) &&
            group.toBones.has(contact.volumeB.bone)) ||
            (contact.bodyB === group.fromActor &&
              contact.bodyA === group.toActor &&
              group.fromBones.has(contact.volumeB.bone) &&
              group.toBones.has(contact.volumeA.bone))) &&
          // Only proxy overlaps need an exact nearest pair and its orientation.
          // The cheaper crossing-only traversal still checks every affected limb.
          query.limbs(group)?.facing,
      )
    )
      return true;
    if (!wholeFigures) return false;
    const result = query.figures(contact.bodyA, contact.bodyB);
    return !!result && !result.intersects && result.facing;
  };
  return {
    ...measureSceneSafety(solved, {
      verifiedPair,
      verifiedProp: (contact) => {
        if (!wholeProps) return false;
        const result = query.prop(contact.bodyIndex, contact.prop);
        return (
          !!result && result.intersects === false && result.facing === true
        );
      },
    }),
    ...(wholeProps
      ? { renderedBalance: measureRenderedBalance(solved, query) }
      : {}),
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

/** Nearby, anatomically framed reaches for a free hand contacting a torso. */
function handBodyReach(actor, targetActor, contact, chain) {
  const target = resolveLandmark(contact.to, contact.toSide);
  if (
    contact.from !== "hand" ||
    !target ||
    target.side ||
    !target.bone.startsWith("spine") ||
    !target.local[2] ||
    actor.spec?.joints?.[chain.end] ||
    actor.spec?.joints?.[chain.mid]?.rotation != null
  )
    return null;
  const matrix =
    targetActor.evaluated.matrices[targetActor.skeleton.boneIndex(target.bone)];
  const anchor = landmarkPoint(targetActor, contact.to, contact.toSide);
  const shoulder =
    actor.evaluated.positions[actor.skeleton.boneIndex(chain.root)];
  const relative = v3sub(shoulder, anchor),
    height = targetActor.skeleton.stature;
  const across = v3dot(relative, matrix.slice(0, 3)) / height;
  const along = clamp(
    v3dot(relative, matrix.slice(4, 7)) / height,
    -0.06,
    0.06,
  );
  const side = Math.sign(across) || chain.side;
  const lateral = side * clamp(Math.abs(across), 0.06, 0.1);
  const outward = Math.sign(target.local[2]);
  const probe = anchor.map(
    (value, axis) =>
      value +
      height *
        (matrix[axis] * lateral +
          matrix[4 + axis] * along +
          matrix[8 + axis] * outward * 0.12),
  );
  const surface = landmarkSurface(targetActor, contact.to, probe, {
    offset: actor.skeleton.stature * 0.018,
    defaultSide: contact.toSide,
  });
  if (!surface) return null;
  return {
    point: surface.point,
    pole: quatRotate(actor.pose.root.quaternion, [chain.side, 0, 1]),
    twist: -outward * 75,
  };
}

/** Mutates the solved rig, never the template or independent rendered vertices. */
export function* surfaceContactSteps(
  solved,
  templates,
  {
    maxPasses = 8,
    maxSteps = 32,
    maxBodySteps = 12,
    maxSeatingSteps = 8,
    maxKneelingSteps = 8,
    maxForearmSteps = 8,
    maxLevelSeatingSteps = 8,
  } = {},
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
        const contact = solved.contacts[i];
        let measured = measurements[i];
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
          actor.mobility === 0 &&
          actor.spec?.jointMode === "fixed" &&
          [chain.root, chain.mid, chain.end].every((bone) =>
            CHANNELS.every((channel) => {
              const range = actor.skeleton.bone(bone).rom[channel];
              return (
                range[0] === range[1] ||
                actor.spec.joints?.[bone]?.[channel] != null
              );
            }),
          )
        ) {
          reasons.set(i, "fixed_channels");
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
        const targetActor = solved.actors[contact.toActor];
        const bodyTarget = !chainForBone(
          resolveLandmark(contact.to, contact.toSide)?.bone ?? "",
        );
        const reach =
          measured.intersects &&
          handBodyReach(actor, targetActor, contact, chain);
        if (reach) {
          const original = clonePose(actor);
          for (const [twist, flexion, abduction] of [
            [reach.twist, 45, 24],
            [-reach.twist, 45, 24],
            [reach.twist, 0, 24],
            [reach.twist, 45, 0],
          ]) {
            if (steps >= maxSteps) break;
            steps++;
            actor.pose = clonePose({ pose: original });
            actor.pose.joints[chain.mid] = actor.skeleton.clampAngles(
              chain.mid,
              {
                ...actor.pose.joints[chain.mid],
                rotation: twist,
              },
            );
            actor.pose.joints[chain.end] = actor.skeleton.clampAngles(
              chain.end,
              {
                ...actor.pose.joints[chain.end],
                flexion,
                abduction,
              },
            );
            refresh(actor);
            // Turning the palm changes its offset from the wrist. Reaching
            // with that offset keeps the intended hand anchor, not just the
            // wrist, near the surface while the forearm takes another route.
            for (let repeat = 0; repeat < 3; repeat++) {
              const hand = landmarkPoint(actor, contact.from, contact.fromSide);
              const end =
                actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
              solveTwoBoneIK(
                actor.skeleton,
                actor.pose,
                chain,
                end.map(
                  (value, axis) => value + reach.point[axis] - hand[axis],
                ),
                { evaluated: actor.evaluated, pole: reach.pole, weight: 1 },
              );
              refresh(actor);
            }
            const accepted = acceptCandidate();
            if (!accepted) {
              actor.pose = clonePose({ pose: original });
              refresh(actor);
            }
            yield { steps };
            if (accepted) break;
          }
          measured = measurements[i];
          if (
            !measured.intersects &&
            measured.distance <= SURFACE_CONTACT_TOLERANCE
          )
            continue;
        }
        const saved = clonePose(actor);
        const end =
          actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
        const gain = measured.intersects
          ? 0
          : Math.min(0.025, measured.distance - 0.0015) / measured.distance;
        const delta = measured.intersects
          ? measured.normal.map((v) => v * 0.003)
          : measured.to.map((v, k) => (v - measured.from[k]) * gain);
        // A crossing triangle supplies a normal axis, not a signed penetration
        // depth. Either side may free the moving limb, and a dressed upper arm
        // can be thicker than the old 24 mm search. Try both sides, bounded at
        // 96 mm before the contact-weight blend. Every candidate still has to
        // pass the full safety and new-intersection checks above.
        for (const factor of measured.intersects
          ? [1, -1, 2, -2, 4, -4, 8, -8, 16, -16, 24, -24, 32, -32]
          : [1, 0.5, 0.25]) {
          if (steps >= maxSteps) break;
          steps++;
          const target = end.map((v, k) => v + delta[k] * factor);
          const result = solveTwoBoneIK(
            actor.skeleton,
            actor.pose,
            chain,
            target,
            {
              evaluated: actor.evaluated,
              weight: contact.strength ?? 1,
              // A small rendered correction must not reset an elbow that has
              // already found a clear route around the other figure.
              ...(bodyTarget
                ? {
                    pole: v3sub(
                      actor.evaluated.positions[
                        actor.skeleton.boneIndex(chain.mid)
                      ],
                      actor.evaluated.positions[
                        actor.skeleton.boneIndex(chain.root)
                      ],
                    ),
                  }
                : {}),
            },
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
    let bodySteps = 0;
    let bodyBaseline;
    const bodyFrames = solved.actors.map((actor) => ({
      root: [...actor.pose.root.position],
      evaluated: actor.evaluated,
    }));
    const adjustments = [];
    for (
      let i = 0;
      i < solved.contacts.length &&
      steps < maxSteps &&
      bodySteps < maxBodySteps;
      i++
    ) {
      const contact = solved.contacts[i],
        actor = solved.actors[contact.fromActor],
        measured = measurements[i];
      if (
        solved.surface.id !== "floor" ||
        contact.strength <= 0 ||
        !measured ||
        measured.intersects ||
        measured.distance <= SURFACE_CONTACT_TOLERANCE ||
        measured.distance > 0.04 ||
        resolveLandmark(contact.from, contact.fromSide)?.bone !== "pelvis" ||
        chainForBone(resolveLandmark(contact.to, contact.toSide)?.bone ?? "")
      )
        continue;
      const upperIndex = solved.contacts.findIndex(
        (other, k) =>
          other.strength > 0 &&
          other.fromActor === contact.fromActor &&
          other.toActor === contact.toActor &&
          resolveLandmark(other.from, other.fromSide)?.bone.startsWith(
            "spine",
          ) &&
          measurements[k] &&
          !measurements[k].intersects &&
          measurements[k].distance <= SURFACE_CONTACT_TOLERANCE,
      );
      if (upperIndex < 0) continue;
      const trials = standingContactPoses(
        actor,
        measured,
        measurements[upperIndex].from,
      );
      const original = clonePose(actor);
      while (steps < maxSteps && bodySteps < maxBodySteps) {
        const trial = trials.next();
        if (trial.done) break;
        steps++;
        bodySteps++;
        bodyBaseline ??= measureSurfaceSafety(solved, query, {
          wholeFigures: true,
        });
        let accepted = false;
        if (trial.value) {
          actor.pose = trial.value;
          refresh(actor);
          const candidate = solved.contacts.map(query),
            candidateScore = score(candidate, solved.contacts);
          const contactsSafe = candidate.every(
            (value, k) =>
              solved.contacts[k].strength <= 0 ||
              (value &&
                !value.intersects &&
                measurements[k] &&
                (measurements[k].intersects ||
                  value.distance <=
                    Math.max(
                      measurements[k].distance,
                      SURFACE_CONTACT_TOLERANCE,
                    ) +
                      1e-7)),
          );
          if (
            standingFramePreserved(actor, bodyFrames[contact.fromActor]) &&
            contactsSafe &&
            candidateScore < bestScore - 1e-10 &&
            measureFigureSurfaces(solved, query).every(
              (pair) => pair.intersects === false,
            )
          ) {
            const safety = measureSurfaceSafety(solved, query, {
              wholeFigures: true,
            });
            const violations = new Map(
              bodyBaseline.violations.map((value) => [value.key, value.depth]),
            );
            const balanced = safety.balance.every(
              (value, k) =>
                (!bodyBaseline.balance[k].supported || value.supported) &&
                (value.offset ?? Infinity) <=
                  (bodyBaseline.balance[k].offset ?? Infinity) + 1e-6,
            );
            if (
              balanced &&
              [
                "maxDepth",
                "maxSelfDepth",
                "maxBodyDepth",
                "propPenetration",
                "totalDepth",
              ].every((key) => safety[key] <= bodyBaseline[key] + 1e-8) &&
              safety.violations.every(
                (value) =>
                  value.depth <= (violations.get(value.key) ?? 0) + 1e-8,
              )
            ) {
              accepted = true;
              measurements = candidate;
              bestScore = candidateScore;
              reasons.delete(i);
              adjustments.push(
                `${actor.label ?? actor.id}: adjusted the standing stance to improve body contacts while preserving hand placement.`,
              );
            }
          }
        }
        if (!accepted) {
          actor.pose = clonePose({ pose: original });
          refresh(actor);
        }
        yield { steps };
        if (accepted) break;
      }
      trials.return();
    }
    // Ground visible support sets with bounded, pose-specific corrections. Furniture
    // proxy exceptions require complete drawn figure/box clearance, not only
    // the seat patch used to propose the candidate.
    const supportSteps = {
      seatingSteps: 0,
      kneelingSteps: 0,
      forearmSteps: 0,
      levelSeatingSteps: 0,
    };
    const supportStages = [
      {
        counter: "seatingSteps",
        limit: maxSeatingSteps,
        frame: (actor, report) =>
          seatedSupportFrame(actor, solved.surface, report),
        poses: seatedSupportPoses,
        preserved: seatedFramePreserved,
        footprint: (report) =>
          report.supports.find((s) => s.landmark === "buttocks")?.measurement
            ?.withinFootprint,
        message:
          "adjusted seated support against the rendered seat and floor while preserving foot placement.",
      },
      {
        counter: "kneelingSteps",
        limit: maxKneelingSteps,
        frame: (actor, report) =>
          kneelingSupportFrame(
            actor,
            solved.surface,
            report,
            query,
            solved.contacts,
          ),
        poses: kneelingSupportPoses,
        preserved: kneelingFramePreserved,
        footprint: (report) =>
          report.supports.every((s) => s.measurement?.withinFootprint),
        message:
          "adjusted kneeling support against the rendered surface while preserving foot frames and contacted hands.",
      },
      {
        counter: "forearmSteps",
        limit: maxForearmSteps,
        frame: (actor, report) =>
          forearmSupportFrame(actor, report, solved.contacts),
        poses: forearmSupportPoses,
        preserved: forearmFramePreserved,
        footprint: (report) =>
          report.supports.every((s) => s.measurement?.withinFootprint),
        message:
          "adjusted reclining support against the rendered surface while retaining lower-body joints and clearing the hands.",
      },
      {
        counter: "levelSeatingSteps",
        limit: maxLevelSeatingSteps,
        frame: levelSeatedSupportFrame,
        poses: levelSeatedSupportPoses,
        preserved: levelSeatedFramePreserved,
        footprint: (report) =>
          report.supports.every((s) => s.measurement?.withinFootprint),
        message:
          "adjusted seated support on a shared surface while preserving foot frames.",
      },
    ];
    for (const stage of supportStages) {
      for (
        let index = 0;
        index < solved.actors.length &&
        steps < maxSteps &&
        supportSteps[stage.counter] < stage.limit;
        index++
      ) {
        const actor = solved.actors[index];
        const originalSupports = measureRenderedSupports(solved, query);
        let support = originalSupports[index];
        const frame = stage.frame(actor, support);
        if (
          !frame ||
          (support.gap <= SURFACE_CONTACT_TOLERANCE &&
            support.penetration === 0)
        )
          continue;
        const baseline = measureSurfaceSafety(solved, query, {
          wholeFigures: true,
          wholeProps: true,
        });
        const violations = new Map(
          baseline.violations.map((v) => [v.key, v.depth]),
        );
        let changed = false;
        for (
          let pass = 0;
          pass < 3 &&
          steps < maxSteps &&
          supportSteps[stage.counter] < stage.limit;
          pass++
        ) {
          if (
            support.gap <= SURFACE_CONTACT_TOLERANCE &&
            support.penetration === 0
          )
            break;
          const original = clonePose(actor),
            trials = stage.poses(actor, support, frame);
          let accepted = false;
          while (
            steps < maxSteps &&
            supportSteps[stage.counter] < stage.limit
          ) {
            const trial = trials.next();
            if (trial.done) break;
            steps++;
            supportSteps[stage.counter]++;
            if (trial.value) {
              actor.pose = trial.value;
              refresh(actor);
              const reports = measureRenderedSupports(solved, query),
                next = reports[index],
                candidate = solved.contacts.map(query);
              const supportsSafe = reports.every(
                (value, k) =>
                  originalSupports[k].basis !== "rendered" ||
                  (value.basis === "rendered" &&
                    value.gap <=
                      Math.max(
                        originalSupports[k].gap,
                        SURFACE_CONTACT_TOLERANCE,
                      ) +
                        1e-7 &&
                    value.penetration <=
                      originalSupports[k].penetration + 1e-7),
              );
              const contactsSafe = candidate.every(
                (value, k) =>
                  solved.contacts[k].strength <= 0 ||
                  (value &&
                    !value.intersects &&
                    measurements[k] &&
                    value.distance <=
                      Math.max(
                        measurements[k].distance,
                        SURFACE_CONTACT_TOLERANCE,
                      ) +
                        1e-7),
              );
              const lowest = query.lowest(index);
              if (
                lowest != null &&
                lowest >= solved.surface.ground - 1e-7 &&
                stage.preserved(actor, frame) &&
                supportsSafe &&
                contactsSafe &&
                next.basis === "rendered" &&
                next.gap < support.gap - 1e-7 &&
                stage.footprint(next) &&
                measureFigureSurfaces(solved, query).every(
                  (pair) => pair.intersects === false,
                ) &&
                measurePropSurfaces(solved, query).every(
                  (pair) => pair.intersects === false,
                )
              ) {
                const safety = measureSurfaceSafety(solved, query, {
                  wholeFigures: true,
                  wholeProps: true,
                });
                const balanced = safety.balance.every((value, k) => {
                  const before =
                    baseline.renderedBalance?.[k] ?? baseline.balance[k];
                  const after = safety.renderedBalance?.[k] ?? value;
                  return (
                    !(
                      baseline.renderedBalance?.[k] &&
                      !safety.renderedBalance?.[k]
                    ) &&
                    (!before.supported || after.supported) &&
                    (after.offset ?? Infinity) <=
                      (before.offset ?? Infinity) + 1e-6
                  );
                });
                if (
                  balanced &&
                  [
                    "maxDepth",
                    "maxSelfDepth",
                    "maxBodyDepth",
                    "propPenetration",
                    "totalDepth",
                  ].every((key) => safety[key] <= baseline[key] + 1e-8) &&
                  safety.violations.every(
                    (value) =>
                      value.depth <= (violations.get(value.key) ?? 0) + 1e-8,
                  )
                ) {
                  accepted = true;
                  changed = true;
                  support = next;
                  measurements = candidate;
                  candidate.forEach((value, k) => {
                    if (
                      value &&
                      !value.intersects &&
                      value.distance <= SURFACE_CONTACT_TOLERANCE
                    )
                      reasons.delete(k);
                  });
                }
              }
            }
            if (!accepted) {
              actor.pose = clonePose({ pose: original });
              refresh(actor);
            }
            yield { steps, ...supportSteps };
            if (accepted) break;
          }
          trials.return();
          if (!accepted) break;
        }
        if (changed)
          adjustments.push(`${actor.label ?? actor.id}: ${stage.message}`);
      }
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
          reasons.get(i) === "fixed_channels" ||
          reasons.get(i) === "load_bearing",
        unreachable:
          reasons.get(i) === "out_of_reach" ||
          (!value && old?.unreachable) ||
          false,
      };
    });
    const figureSurfaces = [];
    for (const pair of figureChecks(solved, query)) {
      figureSurfaces.push(pair);
      yield { steps };
    }
    const warnings = [...(solved.quality.placementWarnings ?? [])];
    const floorSurfaces = measureFloorSurfaces(solved, query);
    for (const item of floorSurfaces) {
      const label =
        solved.actors[item.actor].label ?? solved.actors[item.actor].id;
      if (item.penetration == null)
        warnings.push(
          `${label}: the complete rendered floor clearance check is unavailable.`,
        );
      else if (item.penetration > 0.02)
        warnings.push(
          `${label}: the rendered figure extends ${Math.round(item.penetration * 1000)} mm below the floor.`,
        );
    }
    const propSurfaces = [];
    for (const pair of propChecks(solved, query)) {
      propSurfaces.push(pair);
      const label =
        solved.actors[pair.actor].label ?? solved.actors[pair.actor].id;
      if (pair.intersects === true)
        warnings.push(
          `${label}: the rendered figure intersects the ${pair.kind}; adjust the pose.`,
        );
      else if (pair.intersects === null)
        warnings.push(
          `${label}: the complete rendered ${pair.kind} clearance check is unavailable.`,
        );
      yield { steps };
    }
    for (const pair of figureSurfaces) {
      const names = [pair.fromActor, pair.toActor]
        .map((index) => solved.actors[index].label ?? solved.actors[index].id)
        .join(" and ");
      if (pair.intersects)
        warnings.push(
          `${names}: rendered figure surfaces intersect outside or within the contact regions; adjust the pose.`,
        );
      else if (pair.intersects === null)
        warnings.push(
          `${names}: the complete figure surface check is unavailable.`,
        );
    }
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
    const supportSurfaces = measureRenderedSupports(solved, query);
    for (const entry of supportSurfaces) {
      const actor = solved.actors[entry.actor];
      actor.bodySupportResidual = entry.bodyGap;
      actor.supportMeasurement =
        entry.basis === "rendered" || entry.basis === "body-model"
          ? entry.basis
          : null;
      actor.seatResidual = entry.gap;
      actor.supportPenetration = entry.penetration;
      if (entry.unavailable)
        warnings.push(
          `${actor.label ?? actor.id}: rendered support geometry is unavailable; the support gap is a body-model estimate.`,
        );
    }
    Object.assign(
      solved.quality,
      measureSurfaceSafety(solved, query, {
        wholeFigures: true,
        wholeProps: true,
      }),
      {
        contactDetail: detail,
        figureSurfaces,
        propSurfaces,
        floorSurfaces,
        supportSurfaces,
        adjustments,
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
          bodySteps,
          ...supportSteps,
          before,
          after: measurements.map((value) => value?.distance ?? null),
        },
      },
    );
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
