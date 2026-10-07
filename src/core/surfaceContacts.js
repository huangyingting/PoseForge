/** Rendered-surface measurements and collision-checked free-limb corrections. */
import { skinHumanMesh } from "./humanMesh.js";
import {
  landmarkPoint,
  landmarkSurface,
  resolveLandmark,
} from "./landmarks.js";
import { backFirstShape, fingersInShape } from "./handPose.js";
import { fitFingers } from "./fingerFit.js";
import { palmAims, palmNormal, turnPalm, turnPalms } from "./palmPose.js";
import { LIMB_CHAINS, solveTwoBoneIK } from "./ik.js";
import { CHANNELS } from "./skeleton.js";
import { clamp, quatRotate, v3dot, v3sub } from "./math.js";
import {
  standingContactPoses,
  standingFramePreserved,
  standingStepAllowed,
  standingStepBack,
} from "./standingContacts.js";
import {
  armDepth,
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
import { guidedPoseCandidate } from "./guidedPose.js";
import { limbFirstContact } from "./contactOrientation.js";
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
/** How far, in radians, a palm may face off what its hand is on and be left. */
const PALM_TOLERANCE = (30 * Math.PI) / 180;
const vDistanceSq = (a, b) =>
  a.reduce((sum, value, k) => sum + (value - b[k]) ** 2, 0);
const topologyCache = new WeakMap();

/** What of a body a contact on `name` is measured against: the skin of `bones` within `radius` of `anchor`. */
export function region(actor, name, side) {
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

/**
 * A template as the queries measure it. Hair cards are strands, not a surface:
 * where a card a centimetre off the scalp met a pillow or a partner, real hair
 * would part or flatten, and measured as solid the cards hold a supine head
 * off the bed and call a cheek on a hip a crossing. So a template drawn with
 * cards is measured with the shell that `withHair` fits under them instead,
 * which is a surface - the one a template without cards is drawn with. The
 * teeth and the tongue are behind the lips, which meet whatever they meet
 * first, and are not measured at all.
 */
const measuredTemplates = new WeakMap();
function measured(template) {
  const mouth = template?.submeshes.some((part) => part.mouth);
  if (!template?.hairShell && !mouth) return template;
  if (!measuredTemplates.has(template))
    measuredTemplates.set(template, {
      ...template,
      submeshes: [
        ...template.submeshes.filter((part) => !(template.hairShell && part.cards) && !part.mouth),
        ...(template.hairShell ? [template.hairShell] : []),
      ],
    });
  return measuredTemplates.get(template);
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
      template = measured(templates[index]);
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
  // The drawn figure, or all of it but the bones in `without`.
  query.figure = (index, without = null) =>
    tree(
      index,
      "",
      null,
      without
        ? new Set(
            actors[index].skeleton.bones
              .map((bone) => bone.name)
              .filter((name) => !without.has(name)),
          )
        : true,
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
/** How many contacts are still open: crossing, or further off than tolerance. */
const unmet = (measurements, contacts) =>
  measurements.filter(
    (value, i) =>
      value &&
      (contacts[i].strength ?? 1) > 0 &&
      (value.intersects || value.distance > SURFACE_CONTACT_TOLERANCE),
  ).length;
/**
 * Whether a candidate is progress. The margin keeps the search from taking
 * steps that gain nothing but rounding, but it is a squared distance, so a
 * contact less than ten micrometres past tolerance scores under it and no step
 * could close it: it would be left, and reported open, at 4.003 mm. A step that
 * closes a contact is progress however little the score moves.
 */
const improves = (candidate, candidateScore, measurements, bestScore, contacts) =>
  candidateScore < bestScore - 1e-10 ||
  (candidateScore < bestScore &&
    unmet(candidate, contacts) < unmet(measurements, contacts));
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
    aim: surface.normal.map((value) => -value),
    twist: -outward * 75,
  };
}

/**
 * Resting and gripping hands that reached what they touch back first, and the
 * shape each takes instead - see `backFirstShape`. The palm faces along the hand bone's
 * x axis, away from it on the left hand and along it on the right, where the
 * rig mirrors; every bundled body model is drawn that way round. What the hand
 * touches lies towards the other end of the contact's closest pair of points.
 */
function backFirstHands(solved, measurements) {
  const turns = [];
  const read = new Set();
  const put = (actor, side, facing) => {
    read.add(`${actor.index}.${side}`);
    const shape = backFirstShape(actor, side, facing);
    if (shape && !turns.some((turn) => turn.actor === actor && turn.side === side))
      turns.push({ actor, side, shape });
  };
  solved.contacts.forEach((contact, i) => {
    const gap = measurements[i];
    if (contact.strength <= 0 || !gap || gap.intersects || !(gap.distance > 1e-4))
      return;
    for (const end of ["from", "to"]) {
      const landmark = resolveLandmark(contact[end], contact[`${end}Side`]);
      if (landmark?.base !== "hand") continue;
      const actor = solved.actors[contact[`${end}Actor`]];
      const side = landmark.side;
      const toward =
        end === "from" ? v3sub(gap.to, gap.from) : v3sub(gap.from, gap.to);
      const matrix =
        actor.evaluated.matrices[actor.skeleton.boneIndex(landmark.bone)];
      put(
        actor,
        side,
        ((side === "r" ? 1 : -1) * v3dot(matrix.slice(0, 3), toward)) /
          gap.distance,
      );
    }
  });
  // A hand already on or in what it touches leaves no gap to read a direction
  // from. The surface it is on gives one: the palm should face into it.
  for (const { actor, side, aim, kind } of palmAims(solved)) {
    if ((kind !== "grip" && kind !== "rest") || read.has(`${actor}.${side}`))
      continue;
    const body = solved.actors[actor];
    put(body, side, v3dot(palmNormal(body, side), aim));
  }
  return turns;
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
    maxGuidedPoseSteps = 1,
    maxPalmSteps = 8,
  } = {},
) {
  const originalPoses = solved.actors.map(clonePose);
  const originalHands = solved.actors.map((actor) => actor.hands);
  let completed = false;
  try {
    yield { steps: 0 };
    const query = createSurfaceContactQuery(solved.actors, templates);
    let measurements = solved.contacts.map(query);
    const before = measurements.map((value) => value?.distance ?? null);
    const beforeIntersects = measurements.map(
      (value) => value?.intersects ?? false,
    );
    let steps = 0,
      guidedPoseSteps = 0;
    const adjustments = [];
    if (maxSteps > 0 && maxGuidedPoseSteps > 0) {
      const poses = guidedPoseCandidate(solved);
      if (poses) {
        steps++;
        guidedPoseSteps++;
        solved.actors.forEach((actor, i) => {
          actor.pose = poses[i];
          refresh(actor);
        });
        const candidate = solved.contacts.map(query);
        const supports = measureRenderedSupports(solved, query);
        const complete =
          candidate.every(
            (value, i) =>
              solved.contacts[i].strength <= 0 ||
              (value &&
                !value.intersects &&
                Number.isFinite(value.distance) &&
                value.distance <= SURFACE_CONTACT_TOLERANCE),
          ) &&
          supports.every(
            (support, i) =>
              solved.actors[i].supportBasis !== "surface" ||
              (support.basis === "rendered" &&
                support.unavailable === 0 &&
                support.penetration === 0 &&
                support.gap <= SURFACE_CONTACT_TOLERANCE),
          ) &&
          measureFloorSurfaces(solved, query).every(
            (entry) =>
              entry.minimumY != null &&
              entry.minimumY >= SURFACES.floor.height - 1e-7,
          ) &&
          measureFigureSurfaces(solved, query).every(
            (pair) => pair.intersects === false,
          ) &&
          measurePropSurfaces(solved, query).every(
            (pair) => pair.intersects === false,
          );
        const safety = complete
          ? measureSurfaceSafety(solved, query, {
              wholeFigures: true,
              wholeProps: true,
            })
          : null;
        const safe =
          safety &&
          [
            "maxDepth",
            "maxSelfDepth",
            "maxBodyDepth",
            "propPenetration",
            "totalDepth",
          ].every((key) => safety[key] <= 1e-8) &&
          solved.actors.every(
            (actor, i) =>
              actor.supportBasis !== "surface" ||
              safety.renderedBalance[i]?.supported === true,
          );
        if (safe) {
          measurements = candidate;
          adjustments.push(
            "Used the guided starting pose after verifying rendered contacts, supports and complete clearance.",
          );
        } else {
          solved.actors.forEach((actor, i) => {
            actor.pose = clonePose({ pose: originalPoses[i] });
            refresh(actor);
          });
        }
        yield { steps, guidedPoseSteps };
      }
    }
    const initialRoots = solved.actors.map((actor) => [
      ...actor.pose.root.position,
    ]);
    const initialSafety = measureSurfaceSafety(solved, query);
    const originalViolations = new Map(
      initialSafety.violations.map((v) => [v.key, v.depth]),
    );
    let currentSafety = initialSafety;
    let bestScore = score(measurements, solved.contacts);
    const reasons = new Map();
    // A hand reaching round a body tries half a dozen arms before it is moved
    // at all; a hand on a knee is moved at once. The short ones go first, so a
    // reach that ends out of range cannot spend the budget they needed.
    const reaching = (contact) => {
      const driven = limbFirstContact(contact, solved.actors);
      const target = resolveLandmark(driven.to, driven.toSide);
      return driven.from === "hand" && !!target && !target.side &&
        target.bone.startsWith("spine")
        ? 1
        : 0;
    };
    const order = solved.contacts
      .map((contact, i) => ({ i, cost: reaching(contact) }))
      .sort((a, b) => a.cost - b.cost)
      .map(({ i }) => i);
    for (let pass = 0; pass < maxPasses && steps < maxSteps; pass++) {
      let improved = false;
      for (const i of order) {
        if (steps >= maxSteps) break;
        const authoredContact = solved.contacts[i];
        const contact = limbFirstContact(authoredContact, solved.actors);
        // Reports and scoring retain authored direction; motion uses the free
        // limb's directed query so approach vectors and normals stay correct.
        const motionMeasurement = () =>
          contact === authoredContact ? measurements[i] : query(contact);
        let measured = motionMeasurement();
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
          if (
            newIntersection ||
            !improves(
              candidate,
              candidateScore,
              measurements,
              bestScore,
              solved.contacts,
            )
          )
            return false;
          measurements = candidate;
          currentSafety = safety;
          bestScore = candidateScore;
          improved = true;
          reasons.delete(i);
          return true;
        };
        const targetActor = solved.actors[contact.toActor];
        const side = chain.end.slice(-1);
        const reach =
          measured.intersects &&
          handBodyReach(actor, targetActor, contact, chain);
        if (reach) {
          const original = clonePose(actor);
          let kept = original;
          // The palm turned onto the body where the hand reaches, by the
          // forearm's twist and the wrist, and brought back to the point after
          // each turn, since turning the wrist swings the palm about it. A hand
          // on a back the arm has come round bends towards it at the wrist: a
          // straight one lays the forearm along the back, through the flank it
          // has to pass. So the bend is set first and the rest turned to it,
          // and only last is the wrist left to find its own. Where no turn of
          // the palm gets the forearm past the partner's arm, the forearm is
          // twisted the way the arm comes round and the hand reaches back
          // first, bent back and leant towards the thumb, and is laid once the
          // contacts have been met - see `backFirstHands`.
          for (const { flexion, twist, wrist } of [
            { flexion: 45 },
            { flexion: null },
            { twist: reach.twist, wrist: { flexion: -24, abduction: 15 } },
            { twist: -reach.twist, wrist: { flexion: -24, abduction: 15 } },
            { twist: reach.twist, wrist: { flexion: -24, abduction: 0 } },
            { twist: reach.twist, wrist: { flexion: 0, abduction: 15 } },
          ]) {
            if (steps >= maxSteps) break;
            steps++;
            actor.pose = clonePose({ pose: original });
            if (wrist) {
              actor.pose.joints[chain.mid] = actor.skeleton.clampAngles(
                chain.mid,
                { ...actor.pose.joints[chain.mid], rotation: twist },
              );
              actor.pose.joints[chain.end] = actor.skeleton.clampAngles(
                chain.end,
                { ...actor.pose.joints[chain.end], ...wrist },
              );
            } else if (flexion != null)
              actor.pose.joints[chain.end] = actor.skeleton.clampAngles(
                chain.end,
                { ...actor.pose.joints[chain.end], flexion },
              );
            refresh(actor);
            const may = (bone, channel) =>
              bone === chain.end
                ? flexion == null || channel !== "flexion"
                : bone === chain.mid && channel === "rotation";
            for (let repeat = 0; repeat < (wrist ? 3 : 4); repeat++) {
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
              if (wrist || repeat === 3) continue;
              turnPalm(actor, side, reach.aim, { free: may });
              refresh(actor);
            }
            const accepted = acceptCandidate();
            if (accepted) kept = clonePose(actor);
            else {
              actor.pose = clonePose({ pose: kept });
              refresh(actor);
            }
            yield { steps };
            if (
              accepted &&
              !measurements[i].intersects &&
              measurements[i].distance <= SURFACE_CONTACT_TOLERANCE
            )
              break;
          }
          measured = motionMeasurement();
          if (
            !measured.intersects &&
            measured.distance <= SURFACE_CONTACT_TOLERANCE
          )
            continue;
        }
        const moveLimb = (measured) => {
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
                // already found a clear route around the other figure, nor
                // swing one about the arm and the palm with it off the knee
                // it holds.
                pole: v3sub(
                  actor.evaluated.positions[
                    actor.skeleton.boneIndex(chain.mid)
                  ],
                  actor.evaluated.positions[
                    actor.skeleton.boneIndex(chain.root)
                  ],
                ),
              },
            );
            refresh(actor);
            if (acceptCandidate()) return true;
            actor.pose = clonePose({ pose: saved });
            refresh(actor);
            reasons.set(
              i,
              result.unreachable ? "out_of_reach" : "movement_limited",
            );
          }
          return false;
        };
        // A resting hand whose curled fingers are in what it is on is moved
        // out with them open first, and keeps them open only if that frees it.
        const opened =
          measured.intersects &&
          contact.from === "hand" &&
          fingersInShape(actor, side);
        let moved = false;
        if (opened) {
          const kept = actor.hands;
          actor.hands = { ...kept, [side]: opened };
          refresh(actor);
          moved = moveLimb(measured);
          if (moved)
            adjustments.push(
              `${actor.label ?? actor.id}: the ${side === "l" ? "left" : "right"} hand's fingers were in what it rests on, so it lies open.`,
            );
          else {
            actor.hands = kept;
            refresh(actor);
          }
        }
        // A limb freed from a crossing lands wherever the step that freed it
        // put it, often a centimetre off; it is brought in at once, while its
        // way back is still the one just measured.
        if ((moved || moveLimb(measured)) && measured.intersects) {
          const freed = motionMeasurement();
          if (
            freed &&
            !freed.intersects &&
            freed.distance > SURFACE_CONTACT_TOLERANCE
          )
            moveLimb(freed);
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
        const remaining = motionMeasurement();
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
    // A hand that holds nothing, hanging where the partner has come to stand.
    // The coarse figures keep its capsule clear, but the drawn hand is wider
    // than that - a spread thumb, a thigh in shorts - and can sit inside the
    // other body. Its arm swings back or out, a little at a time, keeping its
    // bend. This moves a figure beyond the limbs that reach, so it spends the
    // body budget, and only between figures a contact is still working on.
    const engaged = (a, b) =>
      solved.contacts.some(
        (contact, k) =>
          contact.strength > 0 &&
          !["fixed_channels", "load_bearing"].includes(reasons.get(k)) &&
          ((contact.fromActor === a && contact.toActor === b) ||
            (contact.fromActor === b && contact.toActor === a)),
      );
    for (const actor of solved.actors) {
      if (actor.mobility <= 0) continue;
      for (const name of ["armL", "armR"]) {
        const chain = LIMB_CHAINS[name];
        const bones = [chain.root, chain.mid, chain.end, chain.tip];
        if (
          bones.some(
            (bone) => actor.loadBearing.has(bone) || actor.spec?.joints?.[bone],
          ) ||
          solved.contacts.some(
            (contact) =>
              contact.strength > 0 &&
              ["from", "to"].some(
                (end) =>
                  contact[`${end}Actor`] === actor.index &&
                  chainForBone(
                    resolveLandmark(contact[end], contact[`${end}Side`])
                      ?.bone ?? "",
                  ) === name,
              ),
          )
        )
          continue;
        for (const partner of solved.actors) {
          if (partner === actor || !engaged(actor.index, partner.index))
            continue;
          const group = {
            fromActor: actor.index,
            toActor: partner.index,
            fromBones: new Set(bones),
            toBones: new Set(partner.skeleton.bones.map((bone) => bone.name)),
          };
          const crossing = query.limbs(group, true);
          if (!crossing?.intersects) continue;
          const original = clonePose(actor);
          const baseline = measureSurfaceSafety(solved, query);
          const violations = new Map(
            baseline.violations.map((value) => [value.key, value.depth]),
          );
          const end =
            actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
          const pole = v3sub(
            actor.evaluated.positions[actor.skeleton.boneIndex(chain.mid)],
            actor.evaluated.positions[actor.skeleton.boneIndex(chain.root)],
          );
          const flat = (vector) => {
            const length = Math.hypot(vector[0], vector[2]);
            return length > 1e-6
              ? [vector[0] / length, 0, vector[2] / length]
              : [0, 0, 0];
          };
          const away = flat(
            v3sub(actor.pose.root.position, partner.pose.root.position),
          );
          const outward = flat(
            v3sub(
              end,
              actor.evaluated.positions[actor.skeleton.boneIndex("pelvis")],
            ),
          );
          const both = flat(away.map((value, axis) => value + outward[axis]));
          for (const [direction, shift] of [
            [away, 0.02],
            [outward, 0.02],
            [both, 0.03],
            [away, 0.04],
            [outward, 0.04],
            [both, 0.06],
          ]) {
            if (steps >= maxSteps || bodySteps >= maxBodySteps) break;
            steps++;
            bodySteps++;
            solveTwoBoneIK(
              actor.skeleton,
              actor.pose,
              chain,
              end.map((value, axis) => value + direction[axis] * shift),
              { evaluated: actor.evaluated, pole, weight: 1 },
            );
            refresh(actor);
            const candidate = solved.contacts.map(query);
            const safety = measureSurfaceSafety(solved, query);
            const accepted =
              !query.limbs(group, true)?.intersects &&
              candidate.every(
                (value, k) =>
                  !measurements[k] ||
                  (value &&
                    (!value.intersects || measurements[k].intersects) &&
                    (value.intersects ||
                      value.distance <=
                        Math.max(
                          measurements[k].distance,
                          SURFACE_CONTACT_TOLERANCE,
                        ) +
                          1e-7)),
              ) &&
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
              );
            if (accepted) {
              measurements = candidate;
              bestScore = score(candidate, solved.contacts);
              adjustments.push(
                `${actor.label ?? actor.id}: moved a free arm out of ${partner.label ?? partner.id}.`,
              );
            } else {
              actor.pose = clonePose({ pose: original });
              refresh(actor);
            }
            yield { steps };
            if (accepted) break;
          }
        }
      }
    }
    let bodyBaseline;
    const bodyFrames = solved.actors.map((actor) => ({
      root: [...actor.pose.root.position],
      evaluated: actor.evaluated,
    }));
    // Whether the stance a standing figure has just been given keeps its feet
    // and hands, meets its contacts better and goes no deeper into anything;
    // kept if so.
    const acceptStance = (
      actor,
      i,
      change,
      { give = () => 0, crossed = [] } = {},
    ) => {
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
                Math.max(measurements[k].distance, SURFACE_CONTACT_TOLERANCE) +
                  give(k) +
                  1e-7)),
      );
      if (
        !standingFramePreserved(actor, bodyFrames[actor.index]) ||
        !contactsSafe ||
        !improves(
          candidate,
          candidateScore,
          measurements,
          bestScore,
          solved.contacts,
        ) ||
        !measureFigureSurfaces(solved, query).every(
          (pair, k) => pair.intersects === false || crossed[k],
        )
      )
        return false;
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
        !balanced ||
        ![
          "maxDepth",
          "maxSelfDepth",
          "maxBodyDepth",
          "propPenetration",
          "totalDepth",
        ].every((key) => safety[key] <= bodyBaseline[key] + 1e-8) ||
        !safety.violations.every(
          (value) => value.depth <= (violations.get(value.key) ?? 0) + 1e-8,
        )
      )
        return false;
      measurements = candidate;
      bestScore = candidateScore;
      reasons.delete(i);
      adjustments.push(`${actor.label ?? actor.id}: ${change}.`);
      return true;
    };
    // Two standing figures the coarse solve left chest just inside chest -
    // its capsules count as touching anywhere within a few millimetres, and
    // the drawn bodies are not the capsules. The one leaning in steps back by
    // a millimetre or two, its hands kept where they hold the other.
    for (const [i, contact] of solved.contacts.entries()) {
      const actor = solved.actors[contact.fromActor],
        partner = solved.actors[contact.toActor];
      if (
        steps >= maxSteps ||
        bodySteps >= maxBodySteps ||
        solved.surface.id !== "floor" ||
        contact.strength <= 0 ||
        !partner ||
        partner === actor ||
        !standingStepAllowed(actor) ||
        !measurements[i]?.intersects ||
        !resolveLandmark(contact.from, contact.fromSide)?.bone.startsWith(
          "spine",
        ) ||
        chainForBone(resolveLandmark(contact.to, contact.toSide)?.bone ?? "")
      )
        continue;
      const away = actor.pose.root.position.map((value, axis) =>
        axis === 1 ? 0 : value - partner.pose.root.position[axis],
      );
      const length = Math.hypot(...away);
      if (length < 1e-6) continue;
      const original = clonePose(actor);
      // Whatever else of the two bodies touches opens by as much as the
      // step, for the stance below to close again; and where the drawn
      // figures cross besides, at the feet, say, stepping back is no worse.
      const together = (k) =>
        solved.contacts[k].fromActor === contact.fromActor &&
        solved.contacts[k].toActor === contact.toActor &&
        !limbGroup(solved.contacts[k], solved.actors);
      const crossed = measureFigureSurfaces(solved, query).map(
        (pair) => pair.intersects !== false,
      );
      for (const distance of [0.0015, 0.003]) {
        if (steps >= maxSteps || bodySteps >= maxBodySteps) break;
        steps++;
        bodySteps++;
        bodyBaseline ??= measureSurfaceSafety(solved, query, {
          wholeFigures: true,
        });
        const pose = standingStepBack(
          actor,
          away.map((value) => value / length),
          distance,
        );
        let accepted = false;
        if (pose) {
          actor.pose = pose;
          refresh(actor);
          accepted = acceptStance(
            actor,
            i,
            "stepped back from a partner it was pressed into",
            { give: (k) => (together(k) ? distance : 0), crossed },
          );
        }
        if (!accepted) {
          actor.pose = clonePose({ pose: original });
          refresh(actor);
        }
        yield { steps };
        if (accepted) break;
      }
    }
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
          accepted = acceptStance(
            actor,
            i,
            "adjusted the standing stance to improve body contacts while preserving hand placement",
          );
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
    // A palm still turned off what its hand is on. A hand that reached a back
    // while the partner's arm was still in the way could only come at it the
    // wrong way round, and the arm has since been swung clear. It is turned as
    // the solver turns palms, the arm brought round to keep the hand on its
    // spot, and failing that with the arm left where it is: moved for the
    // turn, a forearm under the partner's arm went into it. Turned about the
    // forearm and the wrist alone, the hand swings into what it was on or off
    // it, and is brought back out along the way it now faces until nothing
    // crosses, then closed onto it. A turn is kept only if the palm ends facing
    // closer to it, nothing met comes apart, nothing is crossed that was not
    // and no clearance is worse. The
    // palms have a budget of their own: a hand that reached round a body and
    // ended out of range has often spent all of the shared one by now.
    let palmSafety = null,
      palmSteps = 0;
    const palmDepth = armDepth(solved.actors, solved.props, solved.surface.ground);
    for (const aim of palmAims(solved)) {
      const actor = solved.actors[aim.actor];
      const { side } = aim;
      const chainKey = side === "l" ? "armL" : "armR";
      const chain = LIMB_CHAINS[chainKey];
      // Measured against where the hand now is: brought back onto its spot it
      // may have come down where the surface faces another way.
      const off = () => {
        const now = palmAims(solved).find(
          (value) => value.actor === aim.actor && value.side === side,
        );
        return now
          ? Math.acos(clamp(v3dot(palmNormal(actor, side), now.aim), -1, 1))
          : Math.PI;
      };
      const was = Math.acos(
        clamp(v3dot(palmNormal(actor, side), aim.aim), -1, 1),
      );
      if (
        was <= PALM_TOLERANCE ||
        actor.mobility <= 0 ||
        actor.spec?.joints?.[chain.end] ||
        [chain.root, chain.mid, chain.end].some((bone) =>
          actor.loadBearing.has(bone),
        )
      )
        continue;
      const held = solved.contacts
        .map((contact) => limbFirstContact(contact, solved.actors))
        .filter(
          (contact) =>
            contact.strength > 0 &&
            contact.fromActor === aim.actor &&
            chainForBone(
              resolveLandmark(contact.from, contact.fromSide)?.bone ?? "",
            ) === chainKey,
        );
      const crossed = () => held.some((contact) => query(contact)?.intersects);
      const at = (bone) =>
        actor.evaluated.positions[actor.skeleton.boneIndex(bone)];
      const shift = (pose, move) => {
        actor.pose = clonePose({ pose });
        refresh(actor);
        solveTwoBoneIK(
          actor.skeleton,
          actor.pose,
          chain,
          at(chain.end).map((value, k) => value + move[k]),
          {
            evaluated: actor.evaluated,
            pole: v3sub(at(chain.mid), at(chain.root)),
          },
        );
        refresh(actor);
      };
      const original = clonePose(actor);
      // The drawn figure against the furniture, which the clearances above
      // read only as capsules: a hand turned on a sofa's arm can go into it.
      const props = () =>
        solved.props.map(
          (prop) => query.prop(aim.actor, prop)?.intersects ?? null,
        );
      let propsWere = null;
      for (const inPlace of [false, true]) {
        if (maxSteps <= 0 || palmSteps >= maxPalmSteps) break;
        palmSteps++;
        palmSafety ??= measureSurfaceSafety(solved, query);
        propsWere ??= props();
        const [turn] = turnPalms(solved, {
          aims: [aim],
          free: (_, bone, channel) =>
            !(inPlace && bone === chain.root) &&
            (actor.spec?.jointMode !== "fixed" ||
              actor.spec.joints?.[bone]?.[channel] == null),
          depth: inPlace ? null : palmDepth,
        });
        refresh(actor);
        if (turn && crossed()) {
          // Out in 8 mm steps to the first clear, then halved down to a
          // millimetre between that and the last that crossed.
          const turned = clonePose(actor);
          const out = (distance) => {
            shift(
              turned,
              aim.aim.map((v) => -v * distance),
            );
            return !crossed();
          };
          let inside = 0,
            clear = null;
          for (let distance = 0.008; distance < 0.065; distance += 0.008) {
            if (out(distance)) {
              clear = distance;
              break;
            }
            inside = distance;
          }
          if (clear != null) {
            for (let k = 0; k < 3; k++) {
              const middle = (inside + clear) / 2;
              if (out(middle)) clear = middle;
              else inside = middle;
            }
            out(clear);
          }
        }
        for (let repeat = 0; turn && repeat < 3; repeat++) {
          const open = held
            .map(query)
            .find(
              (value) =>
                value &&
                !value.intersects &&
                value.distance > SURFACE_CONTACT_TOLERANCE,
            );
          if (!open) break;
          const kept = clonePose(actor);
          const gain =
            Math.min(0.025, open.distance - 0.0015) / open.distance;
          shift(
            kept,
            open.to.map((value, k) => (value - open.from[k]) * gain),
          );
          if (crossed()) {
            actor.pose = kept;
            refresh(actor);
            break;
          }
        }
        const candidate = turn ? solved.contacts.map(query) : null;
        const safety = turn ? measureSurfaceSafety(solved, query) : null;
        yield { steps, palmSteps };
        if (
          !turn ||
          off() >= was ||
          candidate.some((value, k) => {
            const was = measurements[k];
            if (!was || was.intersects) return false;
            return (
              !value ||
              value.intersects ||
              value.distance >
                Math.max(was.distance, SURFACE_CONTACT_TOLERANCE) + 1e-7
            );
          }) ||
          [
            "maxDepth",
            "maxSelfDepth",
            "maxBodyDepth",
            "propPenetration",
            "totalDepth",
          ].some((key) => safety[key] > palmSafety[key] + 1e-8) ||
          safety.violations.some(
            (value) =>
              value.depth >
              (palmSafety.violations.find((was) => was.key === value.key)
                ?.depth ?? 0) +
                1e-8,
          ) ||
          safety.limbIntersections.some(
            (hit, k) => hit && !palmSafety.limbIntersections[k],
          ) ||
          props().some((hit, k) => hit !== false && propsWere[k] === false)
        ) {
          actor.pose = clonePose({ pose: original });
          refresh(actor);
          continue;
        }
        measurements = candidate;
        palmSafety = safety;
        adjustments.push(
          `${actor.label ?? actor.id}: turned the ${side === "l" ? "left" : "right"} palm onto what the hand is on.`,
        );
        break;
      }
    }
    // Last of all, because it needs each arm where it finally is: a resting or
    // gripping hand that arrived back first lies flat rather than closing on
    // nothing.
    // Its fingers straighten towards the partner, so the new shape is kept only
    // if nothing it touches is crossed, nothing met comes apart and no
    // clearance is worse than it was.
    let handSafety = null;
    for (const { actor, side, shape } of backFirstHands(solved, measurements)) {
      const kept = actor.hands;
      handSafety ??= measureSurfaceSafety(solved, query);
      actor.hands = { ...kept, [side]: shape };
      refresh(actor);
      const candidate = solved.contacts.map(query);
      const after = measureSurfaceSafety(solved, query);
      yield { steps };
      if (
        candidate.some(
          (value, k) =>
            (value?.intersects && !measurements[k]?.intersects) ||
            (measurements[k]?.distance <= SURFACE_CONTACT_TOLERANCE &&
              !(value?.distance <= SURFACE_CONTACT_TOLERANCE)),
        ) ||
        [
          "maxDepth",
          "maxSelfDepth",
          "maxBodyDepth",
          "propPenetration",
          "totalDepth",
        ].some((key) => after[key] > handSafety[key] + 1e-8)
      ) {
        actor.hands = kept;
        refresh(actor);
        continue;
      }
      measurements = candidate;
      handSafety = after;
      adjustments.push(
        `${actor.label ?? actor.id}: the ${side === "l" ? "left" : "right"} hand arrived back first, so it lies flat rather than ${kept[side] === "grip" ? "gripping" : "cupped"}.`,
      );
    }
    // Then, with every hand in its shape and where it will stay, the fingers
    // close only as far as what they hold - see `fitFingers`. A hand whose
    // fingers were what met a contact, and no longer meet it, keeps its curl.
    for (const { actor, side, closure } of fitFingers(
      solved,
      templates,
      query.figure,
    )) {
      const kept = actor.hands;
      actor.hands = { ...kept, closure: { ...kept.closure, [side]: closure } };
      refresh(actor);
      const candidate = solved.contacts.map(query);
      yield { steps };
      const met = (value) =>
        value && !value.intersects && value.distance <= SURFACE_CONTACT_TOLERANCE;
      if (candidate.some((value, k) => met(measurements[k]) && !met(value))) {
        actor.hands = kept;
        refresh(actor);
        continue;
      }
      measurements = candidate;
      adjustments.push(
        `${actor.label ?? actor.id}: the ${side === "l" ? "left" : "right"} hand's fingers close only as far as what they hold.`,
      );
    }
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
          guidedPoseSteps,
          bodySteps,
          palmSteps,
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
        actor.hands = originalHands[i];
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
