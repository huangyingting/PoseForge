/**
 * Scene solver.
 *
 * Turns an interpreted description into a physically consistent scene:
 *
 *   1. build each actor from its posture archetype
 *   2. place actors from the arrangement rule
 *   3. seat declared supports on the support surface
 *   4. iterate: satisfy contacts with IK -> detect collisions -> correct
 *   5. report residual penetration, unmet contacts and balance
 *
 * Corrections are split into a rigid stage (whole-actor translation and
 * rotation, weighted by how mobile each actor is) and an articulated stage
 * (limb contacts become IK target offsets). That separation is what stops a
 * deep torso overlap from being "fixed" by bending someone's arm, which is the
 * characteristic failure of single-stage endpoint nudging.
 */

import {
  buildBodyVolumes,
  gravityHang,
  poseVolumes,
  selfCollisionExempt,
  volumesBounds,
} from "./body.js";
import {
  COMPRESSION,
  capsuleBoxContact,
  capsuleContact,
  detectContacts,
  detectPropContacts,
  lowestPoint,
  penetrationReport,
  rigidCorrection,
} from "./collision.js";
import { LIMB_CHAINS, solveAim, solveTwoBoneIK } from "./ik.js";
import { landmarkPoint, landmarkSurface, resolveLandmark } from "./landmarks.js";
import {
  clamp,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatRotate,
  v3add,
  v3dist,
  v3len,
  v3lenSq,
  v3mul,
  v3normalize,
  v3sub,
} from "./math.js";
import {
  canBeCarried,
  isRecumbent,
  orientationFromAxes,
  reconcileArrangement,
  resolveArrangement,
  rollPosture,
  resolvePosture,
  resolveSurface,
  supportPlaneFor,
} from "./poseLibrary.js";
import { Skeleton, evaluatePose } from "./skeleton.js";
import { handShapes } from "./handPose.js";
import { rootFromPlacement } from "./placement.js";

/** Dempster segment mass fractions, used for the centre of mass. */
const SEGMENT_MASS = {
  pelvis: 0.142,
  spine01: 0.139,
  spine02: 0.139,
  spine03: 0.08,
  neck: 0.02,
  head: 0.081,
  shoulder: 0.028,
  elbow: 0.016,
  wrist: 0.006,
  hip: 0.1,
  knee: 0.0465,
  ankle: 0.0145,
};

/** Which limb chain owns a bone, if any. */
export function chainForBone(boneName) {
  if (/^(shoulder|elbow|wrist|hand)_l$/.test(boneName)) return "armL";
  if (/^(shoulder|elbow|wrist|hand)_r$/.test(boneName)) return "armR";
  if (/^(hip|knee|ankle|toe)_l$/.test(boneName)) return "legL";
  if (/^(hip|knee|ankle|toe)_r$/.test(boneName)) return "legR";
  return null;
}

/**
 * Bones on the path from the root to a declared support.
 *
 * These carry the body's weight. A knee resting on the floor makes the thigh
 * above it load-bearing too, even though only the knee was named. Bending any
 * of them does not move the limb out of the way, it drops the whole actor - so
 * collisions there belong to the rigid and straddle stages, not to the
 * articulated one, which would answer them by folding the leg.
 */
function loadBearingBones(skeleton, posture) {
  const bones = new Set();
  for (const support of posture.supports) {
    const resolved = resolveLandmark(support.landmark, support.side ?? null);
    if (!resolved) continue;
    for (let i = skeleton.boneIndex(resolved.bone); i >= 0; i = skeleton.bones[i].parentIndex) {
      bones.add(skeleton.bones[i].name);
    }
  }
  return bones;
}

/** Build one actor: skeleton, volumes and the posture's base pose. */
export function createActor(spec, index) {
  const skeleton = new Skeleton({
    bodyType: spec.bodyType || "neutral",
    stature: spec.stature,
    build: spec.build ?? 1,
  });
  let posture = resolvePosture(spec.posture) || resolvePosture("standing");
  const localVolumes = buildBodyVolumes(skeleton, { bust: spec.bust });
  const defaultOrientation = orientationFromAxes(posture.spineDir, posture.faceDir);
  const root = spec.placement ? rootFromPlacement(spec.placement) : {
    position: [0, skeleton.stature * posture.rootHeight, 0], quaternion: defaultOrientation,
  };
  if (spec.placement && isRecumbent(posture)) {
    const originalSide = quatRotate(defaultOrientation, [1, 0, 0])[1];
    const placedSide = quatRotate(root.quaternion, [1, 0, 0])[1];
    if (Math.abs(originalSide) > 0.5 && originalSide * placedSide < 0)
      posture = rollPosture(posture);
  }

  const joints = skeleton.restPose();
  for (const [bone, angles] of Object.entries(posture.joints)) {
    if (skeleton.index.has(bone)) joints[bone] = skeleton.clampAngles(bone, angles);
  }
  // Explicit limb overrides from the description win over the archetype.
  for (const [bone, angles] of Object.entries(spec.joints || {})) {
    if (skeleton.index.has(bone)) {
      joints[bone] = skeleton.clampAngles(bone, { ...joints[bone], ...angles });
    }
  }

  const pose = {
    root,
    joints,
  };

  return {
    id: spec.id || `actor${index}`,
    index,
    label: spec.label || spec.id || `Partner ${String.fromCharCode(65 + index)}`,
    bodyType: spec.bodyType || "neutral",
    skeleton,
    localVolumes,
    posture,
    pose,
    loadBearing: loadBearingBones(skeleton, posture),
    // How freely the solver may move this actor. The partner whose posture is
    // load-bearing stays put; the one on top does the accommodating.
    mobility: spec.placement ? 0 : spec.mobility ?? (posture.supports.length >= 2 ? 0.45 : 1),
    placementFixed: Boolean(spec.placement),
    placementMobility: spec.mobility ?? (posture.supports.length >= 2 ? 0.45 : 1),
    spec,
  };
}

/** Refresh an actor's evaluated pose and world-space volumes. */
export function refresh(actor) {
  if (actor.spec?.placement) {
    if (!actor.placementFixed) actor.placementMobility = actor.mobility;
    actor.pose.root = rootFromPlacement(actor.spec.placement);
    actor.placementFixed = true;
    actor.mobility = 0;
  } else if (actor.placementFixed) {
    actor.mobility = actor.spec?.mobility ?? actor.placementMobility;
    actor.placementFixed = false;
  }
  // Fixed mode holds only explicitly specified channels. The other channels
  // remain available to IK; refreshing also covers restored solver snapshots
  // and the renderer-aware refinement pass.
  if (actor.spec?.jointMode === "fixed") {
    for (const [bone, angles] of Object.entries(actor.spec.joints ?? {})) {
      if (!actor.skeleton.index.has(bone)) continue;
      actor.pose.joints[bone] = actor.skeleton.clampAngles(bone, {
        ...actor.pose.joints[bone],
        ...angles,
      });
    }
  }
  actor.evaluated = evaluatePose(actor.skeleton, actor.pose);
  // Gravity on the parts that hang, recomputed every refresh because it
  // depends on where the pelvis has ended up and on nothing else. Stored on
  // the actor so the drawing side can apply the identical rotation to the
  // drawn part - a shaft that collides in one place and is drawn in another
  // is worse than one that is rigid.
  actor.hang = gravityHang(actor.skeleton, actor.evaluated, actor.localVolumes);
  actor.volumes = poseVolumes(
    actor.skeleton,
    actor.evaluated,
    actor.localVolumes,
    actor.index,
    actor.hang
  );
  return actor;
}

/** Mass-weighted centre of mass of a posed actor. */
export function centreOfMass(actor) {
  let total = 0;
  const sum = [0, 0, 0];
  for (const bone of actor.skeleton.bones) {
    const kind = bone.name.replace(/_[lr]$/, "");
    const mass = SEGMENT_MASS[kind];
    if (!mass) continue;
    const position = actor.evaluated.positions[actor.skeleton.boneIndex(bone.name)];
    sum[0] += position[0] * mass;
    sum[1] += position[1] * mass;
    sum[2] += position[2] * mass;
    total += mass;
  }
  return total > 0 ? v3mul(sum, 1 / total) : [0, 0, 0];
}

/** Translate an actor's root. */
function translateActor(actor, delta) {
  actor.pose.root.position = v3add(actor.pose.root.position, delta);
}

/** Rotate an actor about a world pivot. */
function rotateActor(actor, axisAngle, pivot) {
  const angle = v3len(axisAngle);
  if (angle < 1e-6) return;
  const rotation = quatFromAxisAngle(v3mul(axisAngle, 1 / angle), angle);
  actor.pose.root.quaternion = quatNormalize(
    quatMultiply(rotation, actor.pose.root.quaternion)
  );
  const offset = v3sub(actor.pose.root.position, pivot);
  actor.pose.root.position = v3add(pivot, quatRotate(rotation, offset));
}

/**
 * Lowest surface point of the volumes attached to a landmark's bone.
 * Used to seat a support region on a surface without a full contact pass.
 */
function supportLowestY(actor, landmark) {
  const resolved = resolveLandmark(landmark.landmark, landmark.side ?? null);
  if (!resolved) return null;
  let lowest = Infinity;
  let point = null;
  for (const volume of actor.volumes) {
    if (!resolved.bones.includes(volume.bone)) continue;
    for (const [end, radius] of [
      [volume.a, volume.ra],
      [volume.b, volume.rb],
    ]) {
      if (end[1] - radius < lowest) {
        lowest = end[1] - radius;
        point = [end[0], end[1] - radius, end[2]];
      }
    }
  }
  return point ? { y: lowest, point } : null;
}

/** Coarse support residual on the current rig, independent of rendered data. */
export function measureBodySupportResidual(actor, surface) {
  if (actor.carried || actor.mountedOn != null || !actor.posture.supports.length)
    return null;
  let residual = 0;
  for (const support of actor.posture.supports) {
    const found = supportLowestY(actor, support);
    if (found)
      residual = Math.max(residual, Math.abs(found.y - supportPlaneFor(support, surface)));
  }
  return residual > 0.002 ? residual : 0;
}

/**
 * Which supports a whole-body rotation should be fitted to.
 *
 * Rotating the body is the only way to seat a trunk and the wrong way to seat a
 * foot, which a leg can reach on its own. When a posture's supports straddle
 * two planes, fitting all of them together lets the cheap answer win: a woman
 * bent over a table gets pitched forty degrees head-up, because that swings her
 * feet down to the floor faster than straightening her legs would, and it
 * leaves her chest 400mm above the table she is supposed to be lying on.
 *
 * So the rotation is fitted to the highest plane's supports alone whenever
 * there are two of them to define an axis. One is not enough - a lone pair of
 * buttocks on a chair seat cannot say which way up the sitter is - and there
 * the old all-supports fit is still the best available answer.
 */
function levellingSupports(actor, planeFor) {
  const supports = actor.posture.supports;
  let highest = -Infinity;
  for (const support of supports) highest = Math.max(highest, planeFor(support));
  const top = supports.filter((support) => planeFor(support) >= highest - 1e-6);
  return top.length >= 2 ? top : supports;
}

/**
 * Rotate the actor so its declared support points become level.
 *
 * Translation alone cannot seat a body whose supports are not already
 * coplanar with the surface - a reclining figure would touch at the buttocks
 * and leave the back 200mm in the air. This fits the small horizontal rotation
 * that best levels the support points (least squares over the two horizontal
 * axes, lightly regularised so a two-point support like a pair of feet stays
 * well conditioned) and applies it about their centroid.
 */
function levelSupports(actor, planeFor, { maxAngle = 0.2, passes = 3 } = {}) {
  const supports = levellingSupports(actor, planeFor);
  if (supports.length < 2) return;

  for (let pass = 0; pass < passes; pass += 1) {
    const points = [];
    for (const support of supports) {
      const found = supportLowestY(actor, support);
      // Each support is measured against the height it is actually looking for,
      // not against the others. Level a sitter's buttocks and feet onto one
      // plane and you have not seated her, you have tipped her over backwards
      // until her feet came up to meet her hips.
      if (found) points.push([found.point[0], found.point[1] - planeFor(support), found.point[2]]);
    }
    if (points.length < 2) return;

    const centroid = v3mul(
      points.reduce((sum, p) => v3add(sum, p), [0, 0, 0]),
      1 / points.length
    );

    // Solve  d_i + v*x_i + u*z_i = 0  for (u, v); omega = [-u, 0, v].
    let zz = 0;
    let zx = 0;
    let xx = 0;
    let zd = 0;
    let xd = 0;
    let residual = 0;
    for (const p of points) {
      const x = p[0] - centroid[0];
      const z = p[2] - centroid[2];
      const d = p[1] - centroid[1];
      zz += z * z;
      zx += z * x;
      xx += x * x;
      zd += z * d;
      xd += x * d;
      residual += d * d;
    }
    if (Math.sqrt(residual / points.length) < 0.002) return;
    // Supports bunched together carry no reliable tilt information - fitting a
    // plane through them turns a small height difference into a huge rotation.
    if (Math.sqrt((xx + zz) / points.length) < 0.06) return;

    const lambda = 1e-4 * (xx + zz + 1);
    const a11 = zz + lambda;
    const a12 = zx;
    const a22 = xx + lambda;
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12) return;

    // Supports strung out in a line measure the tilt *along* that line and say
    // nothing whatever about the tilt across it.
    //
    // A figure on their side rests on one shoulder, one hip and one thigh, and
    // those three are all on the same straight line down the body. Least
    // squares does not know that a direction was never measured; asked for the
    // plane through three collinear points it returns whichever of the infinitely
    // many makes the arithmetic work, and the ridge above is four orders of
    // magnitude too small to damp it. What came back was the cap - 11.5 degrees
    // a pass, three passes - about the body's own long axis, so every side-lying
    // figure in the library lay down on her side and ended up 36 degrees onto
    // her back. The pose was right when it was built and wrong by the time it
    // was drawn.
    //
    // So decompose the scatter and invert only the directions it actually
    // constrains. Where the supports do span the ground - a seated figure's
    // buttocks and both feet - both directions survive and this is the same
    // least-squares fit it always was.
    const trace = xx + zz;
    const disc = Math.sqrt(Math.max(0, trace * trace - 4 * (xx * zz - zx * zx)));
    const eigenvalues = [(trace + disc) / 2, (trace - disc) / 2];
    const eigenvector = (value) => {
      let e = [zx, value - xx];
      if (Math.hypot(e[0], e[1]) < 1e-12) e = [value - zz, zx];
      if (Math.hypot(e[0], e[1]) < 1e-12) e = [1, 0];
      const length = Math.hypot(e[0], e[1]);
      return [e[0] / length, e[1] / length];
    };
    let u = 0;
    let v = 0;
    for (const value of eigenvalues) {
      // A direction carrying under 4% of the spread is one the supports do not
      // pin down. Dividing by it is how the noise gets amplified.
      if (value <= 1e-12 || value < eigenvalues[0] * 0.04) continue;
      const e = eigenvector(value);
      const scale = (-xd * e[0] + -zd * e[1]) / value;
      v += scale * e[0];
      u += scale * e[1];
    }

    const omega = [-u, 0, v];
    const angle = v3len(omega);
    if (angle < 1e-5) return;
    rotateActor(actor, v3mul(omega, Math.min(1, maxAngle / angle)), centroid);
    refresh(actor);
  }
}

/**
 * Where a bone sits in its limb chain. Corrections have to be applied to the
 * right joint: raising a wrist does nothing for an upper arm that is through
 * the floor, and moving an ankle does nothing for a knee.
 */
function boneRole(boneName, chain) {
  if (boneName === chain.root) return "root";
  if (boneName === chain.mid) return "mid";
  return "end";
}

/**
 * Raise any limb hanging below `plane` by articulating it, rather than by
 * lifting the whole body (which would pull the declared supports off).
 *
 * This is the safety net that makes an approximate posture legal: the prone
 * archetype's arms are authored folded forward, which in a face-down frame
 * drives them through the floor, and this swings them back up onto it.
 *
 * @returns {boolean} whether anything needed raising
 */
function settleLimbs(actor, planeAt, { passes = 4 } = {}) {
  let moved = false;
  for (let pass = 0; pass < passes; pass += 1) {
    /** @type {Map<string, {depth:number, role:string}>} */
    const deepest = new Map();
    for (const volume of actor.volumes) {
      const chainKey = chainForBone(volume.bone);
      if (!chainKey) continue;
      const end = volume.a[1] - volume.ra <= volume.b[1] - volume.rb ? volume.a : volume.b;
      const low = Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb);
      // Asked of the chain and of the point it is over, not of the scene. The
      // lowest plane in the scene is the floor, and a hand told it may go to
      // the floor while it is over a table goes there through the table.
      const depth = planeAt(chainKey, end) - low;
      if (depth <= 0.002) continue;
      const role = boneRole(volume.bone, LIMB_CHAINS[chainKey]);
      const existing = deepest.get(chainKey);
      if (!existing || depth > existing.depth) deepest.set(chainKey, { depth, role });
    }
    if (deepest.size === 0) return moved;
    moved = true;

    for (const [chainKey, { depth, role }] of deepest) {
      const chain = LIMB_CHAINS[chainKey];
      const skeleton = actor.skeleton;
      if (role === "root") {
        // The upper segment itself is underground: swing it about its root.
        const mid = actor.evaluated.positions[skeleton.boneIndex(chain.mid)];
        aimSegment(actor, chain, [mid[0], mid[1] + depth, mid[2]]);
      } else {
        const end = actor.evaluated.positions[skeleton.boneIndex(chain.end)];
        solveTwoBoneIK(skeleton, actor.pose, chain, [end[0], end[1] + depth, end[2]], {
          evaluated: actor.evaluated,
        });
        refresh(actor);
      }
    }
  }
  return moved;
}

/**
 * Swing a chain's upper segment so its middle joint reaches a point.
 * Two-bone IK moves the *end* of a chain, so it is the wrong tool for a knee
 * or an upper arm - it would reposition the ankle or wrist and leave the
 * offending segment exactly where it was.
 */
function aimSegment(actor, chain, targetPoint) {
  solveAim(actor.skeleton, actor.pose, [chain.root], [1], targetPoint, [0, -1, 0]);
  refresh(actor);
}

/**
 * Drive limb supports (feet, hands, knees, forearms) onto the surface.
 * @returns {boolean} whether any support needed moving
 */
function seatLimbSupports(actor, planeFor) {
  let moved = false;
  for (const support of actor.posture.supports) {
    const resolved = resolveLandmark(support.landmark, support.side ?? null);
    if (!resolved) continue;
    const chainKey = chainForBone(resolved.bone);
    if (!chainKey) continue;
    const chain = LIMB_CHAINS[chainKey];
    const role = boneRole(resolved.bone, chain);
    // A shoulder or thigh support is carried by the torso's placement, not by
    // the limb - driving the arm chain to seat a shoulder would flail the hand.
    if (role === "root") continue;

    const found = supportLowestY(actor, support);
    if (!found) continue;
    const gap = found.y - planeFor(support);
    if (Math.abs(gap) < 0.004) continue;
    moved = true;

    const skeleton = actor.skeleton;
    if (role === "mid") {
      const mid = actor.evaluated.positions[skeleton.boneIndex(chain.mid)];
      aimSegment(actor, chain, [mid[0], mid[1] - gap, mid[2]]);
    } else {
      const end = actor.evaluated.positions[skeleton.boneIndex(chain.end)];
      solveTwoBoneIK(skeleton, actor.pose, chain, [end[0], end[1] - gap, end[2]], {
        evaluated: actor.evaluated,
      });
      refresh(actor);
    }
  }
  return moved;
}

/**
 * Seat an actor on its support surface.
 *
 * The invariant is not "drop until something touches" but "the declared
 * supports are the lowest thing on the body, and all of them touch". Once that
 * holds, a single translation puts them on the surface and nothing else can be
 * underground.
 *
 * Each pass drives the limb supports onto the surface, raises any limb hanging
 * below the support plane - a kneeling figure's trailing feet, a prone
 * figure's folded forearms - and re-seats. It iterates because the two stages
 * interact: dropping a knee onto the floor moves the pelvis, which moves every
 * other support. Only the *support set* has to be authored correctly; the
 * joint angles are allowed to be approximate.
 */
export function seatOnSurface(
  actor,
  surface,
  { useIK = true, settle = true, passes = 6, lower = true } = {}
) {
  refresh(actor);
  // A surface is an object with two heights, not a single number. It used to be
  // a number, and a stale caller passing one reads `surface.ground` as undefined
  // - which does not throw, it poisons every height with NaN and hands back an
  // actor whose volumes are all NaN. That surfaces much later as an empty mesh
  // or a blank canvas, a long way from the call that caused it.
  if (!Number.isFinite(surface?.ground) || !Number.isFinite(surface?.height)) {
    throw new TypeError(
      `seatOnSurface needs a surface with numeric height and ground, got ${JSON.stringify(surface)}`
    );
  }
  const supports = actor.posture.supports;
  const groundY = surface.ground;
  const planeFor = (support) => supportPlaneFor(support, surface);

  /**
   * How far the actor has to rise for every support to be on or above the
   * height it wants. The maximum, not the minimum, because a support already
   * resting where it belongs must not be dragged under to bring another one up.
   * Where all the supports share a plane - which is every posture on a bed, and
   * every posture at all before there was a second height - this is exactly the
   * old "put the lowest support on the surface".
   */
  const deficit = () => {
    let most = -Infinity;
    for (const support of supports) {
      const found = supportLowestY(actor, support);
      if (found) most = Math.max(most, planeFor(support) - found.y);
    }
    return Number.isFinite(most) ? most : groundY - lowestPoint(actor.volumes);
  };

  /** The lowest height any declared support is looking for. */
  const lowestPlane = () =>
    supports.reduce((low, support) => Math.min(low, planeFor(support)), Infinity);

  /** Plane sought by each limb chain that carries a declared support. */
  const supportPlanes = new Map();
  for (const support of supports) {
    const resolved = resolveLandmark(support.landmark, support.side ?? null);
    const chainKey = resolved && chainForBone(resolved.bone);
    if (!chainKey) continue;
    const plane = planeFor(support);
    supportPlanes.set(chainKey, Math.min(supportPlanes.get(chainKey) ?? Infinity, plane));
  }

  // Seating normally snaps the supports onto the surface from either side. For
  // an actor mounted on another it may only ever lift.
  //
  // Someone kneeling astride a partner does have their knees on the bed, so
  // they are not `carried` and the seating is not wrong to apply - but the bed
  // is a floor under those knees, not the thing setting their height. Their
  // partner's body is, and it holds them a hand's breadth higher than kneeling
  // on the mattress alone would. Snapping down closes that gap by pulling them
  // through the person underneath, every iteration, which is exactly the 80mm
  // of pelvis-through-pelvis that no later stage could ever win back.
  const place = () => {
    const rise = deficit();
    if (rise < 0 && !lower) return;
    translateActor(actor, [0, rise, 0]);
    refresh(actor);
  };

  if (useIK && supports.length >= 2) levelSupports(actor, planeFor);
  place();

  if (!useIK) return clampAboveSurface(actor, groundY);

  for (let pass = 0; pass < passes; pass += 1) {
    // Re-level every pass: a knee under a near-vertical thigh cannot be
    // lowered by swinging the limb, only by tilting the whole body, so the
    // rigid and articulated stages have to alternate.
    if (supports.length >= 2) levelSupports(actor, planeFor, { passes: 1 });
    const seated = seatLimbSupports(actor, planeFor);
    const floor = Number.isFinite(lowestPlane()) ? lowestPlane() : groundY;
    // A limb that carries a declared support already has a plane of its own and
    // `seatLimbSupports` owns it: a foot on the floor beside a table is under
    // the table top, and asking what is over it would haul the leg back up onto
    // the table every pass. Everything else stops at whatever it is over.
    const settled = settle
      ? settleLimbs(actor, (chainKey, point) => supportPlanes.get(chainKey) ?? surfaceUnder(point, surface), {
          passes: 2,
        })
      : false;
    place();
    if (!seated && !settled) break;
  }

  return clampAboveSurface(actor, groundY);
}

/**
 * Lift the actor until nothing is underneath the surface.
 *
 * Seating puts the *declared* supports on the ground, which is the right
 * reference point - it is what the posture says is holding the body up - but it
 * says nothing about the parts that are not supports. A supine figure rests on
 * their back and heels, and their ankles are free to end up wherever the
 * collision stage pushes them, including 40mm inside the mattress.
 *
 * So seating is a target, not a floor. Whichever comes first - the supports
 * meeting the surface, or any part of the body meeting it - is where the actor
 * stops. That leaves the supports floating by the residual, which is visible if
 * it is large, and is why the amount is recorded rather than quietly applied:
 * a posture that needs a big correction has a support set that does not match
 * its own geometry, and that is worth knowing.
 *
 * This has to apply whether or not the limbs were given a chance to bend out of
 * the way. Sinking a body through a solid surface is not a cheaper answer, it is
 * a wrong one, and the iteration re-seats without IK on every pass.
 */
function clampAboveSurface(actor, surfaceY) {
  let residual = 0;
  let blocker = null;
  for (const volume of actor.volumes) {
    const depth = surfaceY - Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb);
    if (depth > residual) {
      residual = depth;
      blocker = volume.bone;
    }
  }
  actor.seatResidual = residual > 0.002 ? residual : 0;
  actor.seatBlocker = residual > 0.002 ? blocker : null;
  if (residual > 0.002) {
    translateActor(actor, [0, residual, 0]);
    refresh(actor);
  }
  return actor;
}

/**
 * Place actor `b` relative to actor `a` using an arrangement rule.
 * Offsets are expressed in the primary actor's own frame, so an arrangement
 * reads the same whichever way the pair is facing in world space.
 */
/** How far a volume list reaches along a direction, radii included. */
function extentAlong(volumes, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const volume of volumes) {
    for (const [point, radius] of [
      [volume.a, volume.ra],
      [volume.b, volume.rb],
    ]) {
      const projection = point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2];
      if (projection - radius < min) min = projection - radius;
      if (projection + radius > max) max = projection + radius;
    }
  }
  return { min, max };
}

/**
 * How deeply two actors overlap, split by what can still be done about it.
 *
 * `bulk` is torso against torso, which no later stage can undo - ribcages have
 * no joints to get out of the way with, so this is the hard limit on how close
 * a pair can be pushed. `all` includes limbs, which the straddle and articulated
 * stages do clear, but only so much: they need a shallow overlap to work from,
 * not a leg buried to the hip.
 */
function overlapBetween(a, b) {
  let bulk = 0;
  let all = 0;
  for (const volumeA of a.volumes) {
    for (const volumeB of b.volumes) {
      const hit = capsuleContact(volumeA, volumeB);
      // The two maxima are tracked independently. Skipping a pair because it is
      // shallower than the deepest seen so far loses every bulk overlap that
      // happens to sit behind a deeper limb one, and a torso buried in a torso
      // then reads as zero because an elbow is buried further.
      if (!hit || hit.depth <= 0) continue;
      if (hit.depth > all) all = hit.depth;
      if (hit.depth > bulk && isBulk(volumeA.group) && isBulk(volumeB.group)) bulk = hit.depth;
    }
  }
  return { bulk, all };
}

/**
 * Which way an actor is turned, in the ground plane.
 *
 * The direction they face, flattened. For a body whose face points at the
 * ceiling or the mattress that projects to nothing, and the fallback is the way
 * their spine runs - which is where their head is, and the only meaningful
 * answer to "which way are they lying" for someone flat on their back.
 */
function heading(actor) {
  const q = actor.pose.root.quaternion;
  for (const local of [
    [0, 0, 1],
    [0, 1, 0],
  ]) {
    const world = quatRotate(q, local);
    const length = Math.hypot(world[0], world[2]);
    if (length > 1e-3) return [world[0] / length, 0, world[2] / length];
  }
  return [0, 0, 1];
}

export function applyArrangement(primary, secondary, arrangement, surface) {
  refresh(primary);
  const H = primary.skeleton.stature;

  // Where "behind" is, for a partner who is not standing up.
  //
  // Arrangement offsets read as a mix of two frames and they are written that
  // way on purpose: x and z mean beside and behind *this* partner, so the pair
  // turns together, while y means up, in the world, because gravity does not
  // care which way anyone is facing. Rotating the whole vector by the primary's
  // full orientation honours the first and destroys the second - for a partner
  // bent over a table it turns "0.3 behind" into half a metre straight up, and
  // for one lying on their back it turns "0.3 above" into a third of a metre
  // along the mattress towards their head.
  //
  // It is not a subtle failure. The clearance backoff below infers its axis
  // from this vector, sees one with no horizontal component left, concludes
  // there is no approach direction to give ground along, and skips - which is
  // why a man standing behind a bent-over partner began the solve with 121mm of
  // his knees inside her thighs and never got any of it back.
  //
  // So: turn the horizontal part by where the primary is facing, and leave the
  // vertical part alone.
  const face = heading(primary);
  let [ox, oy, oz] = v3mul(arrangement.offset, H);

  // "Beside" means nothing to somebody lying on their side.
  //
  // The offset's x is a step along the shoulder axis - past the partner's arm,
  // across the bed - and that axis is horizontal for everybody in the library
  // except one. Roll a figure onto their side and it stands up: their upper
  // shoulder is now directly above the lower one, and there is no sideways left
  // to go. The horizontal direction that *is* still free is the one their chest
  // and back face, which for a partner nestling in behind them is the one that
  // was wanted all along.
  //
  // So a sideways step becomes a backward one. Spooning asked for 0.22 of a
  // stature beside and 0.06 behind, and was getting 0.06 behind and 0.22 along
  // the mattress towards the partner's head, which is how two people meant to
  // be touching ended up with 699mm between one's chest and the other's back -
  // four of the six spooning scenes in the suite, and the worst ratio in it.
  //
  // Only for a figure on their *side*. Lying on your back the shoulder axis is
  // as horizontal as it ever was, and "beside" means exactly what it says.
  const onSide =
    isRecumbent(primary.posture) &&
    Math.hypot(primary.posture.faceDir[0], primary.posture.faceDir[2]) > 0.5;
  if (onSide) {
    oz += ox;
    ox = 0;
  }

  const offsetWorld = [
    ox * face[2] + oz * face[0],
    oy,
    oz * face[2] - ox * face[0],
  ];

  // "Turn to face the other way" is a rotation about the body's own long axis,
  // which for someone standing happens to be the world vertical but for someone
  // lying down is horizontal. Yawing a side-lying actor about the vertical does
  // not turn them towards their partner at all - it swaps their head and feet,
  // and leaves the pair lying head to toe wondering why their chests are half a
  // metre apart.
  //
  // Only for a body lying *along* the ground, though. Someone on all fours also
  // has a horizontal spine, but they are propped up on their limbs, and turning
  // them about that axis does not turn them around - it tips them upside down,
  // head through the mattress and knees in the air. They turn about the vertical
  // like anyone else standing on something.
  //
  // And sometimes head to toe is the whole point. An arrangement that wants the
  // reversal rather than the roll says `turn: "vertical"`, because the two are
  // indistinguishable from the offset and the postures - they differ only in
  // what was meant. As with `clear`, a declaration beats an inference.
  const rolls = arrangement.turn !== "vertical" && isRecumbent(secondary.posture);
  const spineAxis = rolls ? v3normalize(secondary.posture.spineDir) : [0, 1, 0];
  const yawDegrees = arrangement.yaw || 0;
  const yaw = quatFromAxisAngle(spineAxis, yawDegrees * (Math.PI / 180));
  if (!secondary.spec.placement)
    secondary.pose.root.quaternion = quatNormalize(
      quatMultiply(yaw, secondary.pose.root.quaternion)
    );

  // Rolling a recumbent actor past halfway puts them on their other side, so
  // the landmarks that were holding them up are now the ones in the air.
  if (!secondary.spec.placement && rolls && Math.abs(yawDegrees) > 90) {
    secondary.posture = rollPosture(secondary.posture);
    secondary.loadBearing = loadBearingBones(secondary.skeleton, secondary.posture);
  }
  const anchor = primary.pose.root.position;
  secondary.pose.root.position = v3add(anchor, offsetWorld);
  refresh(secondary);

  // Whose job it is to hold the secondary up.
  //
  // Most mounted arrangements still rest on the surface: a partner straddling
  // another has their own knees on the bed either side, and seating them is what
  // puts those knees there. But a partner lying full length along another is
  // carried by that person entirely, and seating them means dropping them
  // through their partner onto the mattress - after which the only way left to
  // resolve the overlap is sideways, and the pair ends up lying next to each
  // other rather than one on the other.
  //
  // It cannot be inferred from the posture, because it is the same posture
  // either way: prone on a bed and prone on a person are both prone. The
  // arrangement is the only thing that knows.
  secondary.carried = Boolean(arrangement.carried) && canBeCarried(secondary.posture);

  // Who is on top of whom. Recorded rather than recomputed because the stages
  // that need it cannot see the arrangement: `separateFootprints` has to leave a
  // mounted pair alone, and the per-iteration re-seat has to know the difference
  // between a partner resting on a bed and one resting on a person.
  secondary.mountedOn = arrangement.mounted ? primary.index : null;

  // Arrangements that place one actor on top of the other should not then be
  // dropped onto the floor; only ground-supported postures get seated, and a
  // mounted one only ever gets lifted by it.
  const grounded = !secondary.carried && secondary.posture.supports.length > 0;
  const mounted = secondary.mountedOn != null;
  if (grounded) {
    seatOnSurface(secondary, surface, { lower: !mounted });
  }

  // Close on where the contacts actually are. For an actor standing on the
  // ground only the horizontal part is taken: their height is decided by what
  // they are standing on, and lifting them to meet a partner's chest would just
  // leave them hovering for the re-seat at the end of the iteration to undo.
  // A mounted actor is the opposite case - their height is decided by the
  // partner underneath, so the vertical part is the part that matters most.
  const alignment = alignToContacts(primary, secondary, arrangement);
  if (alignment) {
    translateActor(secondary, grounded && !mounted ? [alignment[0], 0, alignment[2]] : alignment);
    refresh(secondary);
    if (grounded) seatOnSurface(secondary, surface, { useIK: false, lower: !mounted });
  }

  // Aligning makes the two landmarks coincide, which is about half a torso too
  // far: what a contact asks for is that the two *surfaces* meet, and a landmark
  // sits well inside its own. So back the pair off until their volumes clear and
  // let the contact stage close the gap from there. Starting clear and closing in
  // is far more reliable than starting buried and digging out.
  //
  // What gets backed off is the measured overlap, not the gap between the two
  // bounding extents along the axis. For two people lying down face to face the
  // extents overlap along their whole length, and separating *those* would put a
  // body length between them - clear, but nowhere near the pose asked for.
  //
  // Which way they give ground, and how much has to clear, is the whole
  // difference between the cases. A pair laid out side by side backs off along
  // the axis that separated them in the first place, and every volume has to
  // clear: a leg threaded through a torso is not a state the later stages can
  // work from. A partner mounted on top came together vertically and retreats
  // the same way, and only the torsos have to come apart - their legs are
  // tangled by design, and backing off until those cleared too would lift them
  // clean off the person underneath.
  //
  // Those two are inferred from the offset, which is right for most of the
  // library but cannot express every case: a carried partner meets their
  // carrier horizontally, chest to chest, with their legs deliberately wrapped
  // around them. That is a horizontal approach with a torsos-only clearance,
  // which neither inference produces. An arrangement that knows it is such a
  // case says so with `clear`, and a declaration beats a guess.
  const horizontal = Math.hypot(offsetWorld[0], offsetWorld[2]);
  const declared = arrangement.clear;
  const axisKind =
    declared?.axis ??
    (arrangement.mounted
      ? "vertical"
      : horizontal > 1e-6 && Math.abs(offsetWorld[1]) < horizontal
        ? "approach"
        : "none");
  const measure = declared?.measure ?? (arrangement.mounted ? "bulk" : "all");

  if (axisKind !== "none" && (axisKind === "vertical" || horizontal > 1e-6)) {
    const axis =
      axisKind === "vertical"
        ? [0, 1, 0]
        : [offsetWorld[0] / horizontal, 0, offsetWorld[2] / horizontal];
    const tolerance = H * (measure === "bulk" ? 0.008 : 0.005);
    const retreat = (direction) => {
      let distance = 0;
      for (let pass = 0; pass < 8; pass += 1) {
        const overlap = overlapBetween(primary, secondary)[measure];
        if (overlap <= tolerance) break;
        const step = overlap + H * 0.004;
        distance += step;
        translateActor(secondary, v3mul(direction, step));
        refresh(secondary);
        // A ground-supported mounted actor must keep their limbs on the plane.
        if (grounded) seatOnSurface(secondary, surface, { useIK: axisKind === "vertical" });
      }
      return { distance, overlap: overlapBetween(primary, secondary)[measure] };
    };
    const pair = [primary, secondary];
    const placementContacts = (arrangement.contacts || [])
      .map((contact) => normaliseContact(contact, 1, 0, pair))
      .filter((contact) =>
        contact && contact.strength > 0 &&
        !LIMB_LANDMARKS.has(contact.from) && !LIMB_LANDMARKS.has(contact.to)
      );
    const placementError = () => placementContacts.reduce(
      (sum, contact) => sum + Math.abs(contactSeparation(pair, contact)?.error ?? Infinity) * contact.strength,
      0
    );
    const compareApproach =
      !declared && mounted && !grounded && !secondary.carried &&
      axisKind === "vertical" && horizontal > 1e-6 && placementContacts.length > 0;
    const aligned = compareApproach ? snapshotActor(secondary) : null;
    const vertical = retreat(axis);
    if (compareApproach) {
      const cleared = snapshotActor(secondary);
      const verticalError = placementError();
      restoreActor(secondary, aligned);
      const approach = retreat([offsetWorld[0] / horizontal, 0, offsetWorld[2] / horizontal]);
      const approachError = placementError();
      // A lap support is not necessarily a vertical stack. Two upright torsos
      // aligned at the pelvis can require almost a body length of upward
      // clearance but only a small horizontal retreat. Keep the shorter clear
      // seed only if its body contacts are at least as close. Otherwise a short
      // retreat can trade a seated support for a thigh overlap. A recumbent
      // support still normally selects the original vertical path. Neither
      // candidate is allowed a larger compression tolerance.
      if (
        !Number.isFinite(approachError) || approach.overlap > tolerance ||
        approachError > verticalError + 1e-8 ||
        (vertical.overlap <= tolerance && approach.distance >= vertical.distance)
      ) {
        restoreActor(secondary, cleared);
      }
    }
  }
  return secondary;
}

/**
 * Drive a limb so a landmark on this actor reaches a surface point on another.
 * Returns the residual distance so the caller can report unmet contacts.
 */
/**
 * Deepest overlap between one limb and its owner's own torso and head.
 *
 * Only the bulk counts as something to be kept out of. A limb folded against
 * its neighbour is ordinary - crossed forearms, a calf against a thigh - and
 * the general self-collision pass already has an opinion about those. What this
 * is watching for is the one failure reaching IK produces on its own: an elbow
 * driven through a ribcage in pursuit of a target the arm was never long enough
 * to reach.
 */
function limbThroughBulk(actor, group) {
  let worst = 0;
  const limb = actor.volumes.filter((volume) => volume.group === group);
  if (!limb.length) return 0;
  for (const volume of limb) {
    for (const other of actor.volumes) {
      if (!isBulk(other.group)) continue;
      if (selfCollisionExempt(volume, other) || selfCollisionExempt(other, volume)) continue;
      const hit = capsuleContact(volume, other);
      if (hit && hit.depth > worst) worst = hit.depth;
    }
  }
  return worst;
}

function solveContactIK(actor, contact, targetActor) {
  const resolved = resolveLandmark(contact.from, contact.fromSide ?? null);
  if (!resolved) return null;
  const chainKey = chainForBone(resolved.bone);
  if (!chainKey) return null;

  const chain = LIMB_CHAINS[chainKey];
  const current = landmarkPoint(actor, contact.from, contact.fromSide ?? null);
  if (!current) return null;

  const surface = landmarkSurface(targetActor, contact.to, current, {
    offset: actor.skeleton.stature * 0.018,
    defaultSide: contact.toSide ?? null,
  });
  if (!surface) return null;

  // The landmark sits at an offset from the chain's end joint; move the joint
  // by the same delta so the landmark itself lands on the target.
  const end = actor.evaluated.positions[actor.skeleton.boneIndex(chain.end)];
  const landmarkOffset = v3sub(current, end);
  const target = v3sub(surface.point, landmarkOffset);

  // Reaching is a goal; staying out of your own ribcage is a constraint.
  //
  // Two-bone IK aims the chain at the target and does not care what is in the
  // way, so a target the arm cannot reach - a hand asked for a partner's chest
  // from a posture that cannot get there - is answered by extending straight
  // through the shoulder and burying the elbow in the torso. The reach fails
  // either way. The difference is whether it fails as a gap, which the quality
  // report names and a reader can see is a gap, or as an arm inside a chest,
  // which reads as a broken body.
  //
  // So the same treatment the whole-body contact stage gets: take the full step
  // if it costs nothing, and otherwise back the weight off until it does.
  const group = actor.volumes.find((volume) => volume.bone === chain.end)?.group ?? null;
  const ceiling = group ? Math.max(limbThroughBulk(actor, group), COMPRESSION.default) : Infinity;
  const restore = [chain.root, chain.mid, chain.end]
    .filter((bone) => actor.pose.joints[bone])
    .map((bone) => [bone, { ...actor.pose.joints[bone] }]);

  const weight = contact.strength ?? 1;
  let result = null;
  let scale = 1;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = solveTwoBoneIK(actor.skeleton, actor.pose, chain, target, {
      evaluated: actor.evaluated,
      weight: weight * scale,
    });
    refresh(actor);
    if (ceiling === Infinity || limbThroughBulk(actor, group) <= ceiling) break;
    for (const [bone, angles] of restore) actor.pose.joints[bone] = { ...angles };
    refresh(actor);
    scale *= 0.4;
    if (attempt === 2) break;
  }

  const achieved = landmarkPoint(actor, contact.from, contact.fromSide ?? null);
  return {
    contact,
    distance: v3dist(achieved, surface.point),
    unreachable: Boolean(result?.unreachable),
  };
}

/**
 * Pull two torso landmarks together by moving the more mobile actor.
 * Used for "chest against back", "pelvis to pelvis" style constraints that a
 * limb cannot express.
 */
/**
 * Volumes forming a named region of an actor: the landmark's own bone, plus its
 * immediate neighbours in the skeleton, which share the same piece of surface.
 *
 * Neighbourhood is measured in joints rather than in metres. A radius in metres
 * means something different in every posture - on a seated actor a sphere
 * around the pelvis swallows both thighs, and a "pelvis to pelvis" contact then
 * reports itself satisfied by two knees touching while the pelvises are half a
 * metre apart. Joint distance does not drift like that: the neck is always one
 * joint from the head, folded up or stretched out.
 */
function regionVolumes(actor, name, side) {
  const resolved = resolveLandmark(name, side);
  if (!resolved) return [];
  const skeleton = actor.skeleton;
  return actor.volumes.filter(
    (volume) => skeleton.boneDistance(volume.bone, resolved.bone) <= 1
  );
}

/**
 * Signed separation between the two regions a contact names.
 *
 * Measured with the same narrowphase the collision stage uses, over the closest
 * pair of volumes, so "touching" means exactly one thing across the solver.
 * `error` is how far the pair still has to close: positive means apart.
 */
function contactSeparation(actors, contact) {
  const from = actors[contact.fromActor];
  const to = actors[contact.toActor];
  if (!from || !to) return null;
  const setA = regionVolumes(from, contact.from, contact.fromSide ?? null);
  const setB = regionVolumes(to, contact.to, contact.toSide ?? null);
  if (!setA.length || !setB.length) return null;

  const reach = (from.skeleton.stature + to.skeleton.stature) * 0.5;
  let best = null;
  for (const volumeA of setA) {
    for (const volumeB of setB) {
      // A contact is a persistent constraint, not a collision broad-phase
      // query. A finite search margin could erase distant targets from the
      // score/report and make a widely separated pair appear settled. Motion
      // remains bounded independently by `reach` in solveBodyContact.
      const hit = capsuleContact(volumeA, volumeB, Infinity);
      // `depth` is positive when overlapping and negative by the size of the
      // gap otherwise, so the largest depth is the closest pair.
      if (hit && (!best || hit.depth > best.depth)) best = hit;
    }
  }
  if (!best) return null;

  // Aim for a whisker of overlap: enough that the pair reads as touching rather
  // than floating, and well inside the compression the narrowphase tolerates
  // for a declared contact, so meeting the contact never creates a collision.
  const cushion = reach * 0.004;
  return { from, to, reach, best, error: cushion - best.depth };
}

/**
 * Satisfy a torso-to-torso contact by moving whole actors together.
 *
 * The target is surface contact, not coincident landmarks - two chests that
 * touch are half a body's depth apart at their centres, and how far apart
 * depends on the bodies. Closing the measured surface gap instead of a
 * tabulated one is what lets this stage and the collision stage agree on where
 * "touching" is, so they settle rather than fight.
 */
function solveBodyContact(actors, contact, relaxation = 1) {
  const separation = contactSeparation(actors, contact);
  if (!separation) return null;
  const { from, to, reach, best, error } = separation;
  if (Math.abs(error) < 0.006) return { contact, distance: Math.abs(error) };

  const totalMobility = from.mobility + to.mobility || 1;
  const gain = (contact.strength ?? 0.6) * 0.5 * relaxation;
  const wanted = clamp(error * gain, -reach * 0.08, reach * 0.08);
  const move = (scale) => {
    translateActor(from, v3mul(best.normal, (scale * from.mobility) / totalMobility));
    translateActor(to, v3mul(best.normal, (-scale * to.mobility) / totalMobility));
    refresh(from);
    refresh(to);
  };

  // Pushing apart is always safe. Pulling together is not: closing a gap is a
  // goal, staying out of each other is a constraint, and a stage that can only
  // slide whole bodies will happily bury a knee on its way to touching chests.
  // So back the step off until it stops making the worst overlap worse, and
  // take whatever closing distance survives. Without this the two stages take
  // turns undoing each other and the scene oscillates instead of converging;
  // with a single all-or-nothing veto instead, one buried limb would stop the
  // pair approaching at all.
  if (wanted <= 0) {
    move(wanted);
    return { contact, distance: Math.abs(error) };
  }

  const before = overlapBetween(from, to);
  const ceiling = {
    bulk: Math.max(before.bulk, COMPRESSION.declaredContact),
    all: Math.max(before.all, LIMB_TOLERANCE),
  };
  let step = wanted;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    move(step);
    const after = overlapBetween(from, to);
    if (after.bulk <= ceiling.bulk && after.all <= ceiling.all) {
      return { contact, distance: Math.abs(error) };
    }
    move(-step);
    step *= 0.4;
  }
  return { contact, distance: Math.abs(error), blocked: true };
}

/**
 * Slide the secondary so the contacts the arrangement asks for line up.
 *
 * The offsets in the library are written as fractions of stature, which is the
 * best a fixed number can do but still cannot know what posture it is being
 * applied to: 0.34 H in front of a standing partner is clear air, in front of a
 * seated one it is their knees, and in front of a supine one it is the middle of
 * their ribcage. The contacts, though, say exactly what is supposed to end up
 * touching what - so measure where those landmarks currently are and close the
 * difference. The offset stays useful as the direction to approach from; this
 * decides how far.
 *
 * Only whole-body landmarks vote. A hand reaching for a hip is the arm's job,
 * and letting it drag the entire body across the bed is how you get a partner
 * who has walked away from the pose in order to hold hands.
 */
function alignToContacts(primary, secondary, arrangement) {
  let sum = [0, 0, 0];
  let votes = 0;
  for (const contact of arrangement.contacts || []) {
    const from = splitLandmark(contact.from);
    const to = splitLandmark(contact.to);
    if (LIMB_LANDMARKS.has(from.base) || LIMB_LANDMARKS.has(to.base)) continue;
    const here = landmarkPoint(secondary, from.base, from.side);
    const there = landmarkPoint(primary, to.base, to.side);
    if (!here || !there) continue;
    sum = v3add(sum, v3mul(v3sub(there, here), contact.strength ?? 1));
    votes += contact.strength ?? 1;
  }
  if (votes <= 0) return null;
  return v3mul(sum, 1 / votes);
}

const LIMB_LANDMARKS = new Set(["hand", "foot", "forearm", "knee", "shin", "elbow", "ankle"]);

/** Split "hand.l" into a base landmark and a side. */
function splitLandmark(reference) {
  const [base, side] = String(reference).split(".");
  return { base, side: side ? (side === "left" ? "l" : side === "right" ? "r" : side) : null };
}

/**
 * Solve a scene.
 *
 * @param {object} scene interpreted description (see `sceneSchema` in scene.js)
 * @param {object} [options]
 * @param {number} [options.iterations]
 * @returns {object} solved scene with actors, props, and a quality report
 */
export function solveScene(scene, options = {}) {
  const { iterations = 45, collisionGain = 0.55, maxStep = 0.05 } = options;

  const surface = resolveSurface(scene.support?.surface);
  const surfaceY = surface.height;
  const props = (surface.props || []).map((prop) => ({
    ...prop,
    box: {
      min: [
        prop.center[0] - prop.size[0] / 2,
        prop.center[1] - prop.size[1] / 2,
        prop.center[2] - prop.size[2] / 2,
      ],
      max: [
        prop.center[0] + prop.size[0] / 2,
        prop.center[1] + prop.size[1] / 2,
        prop.center[2] + prop.size[2] / 2,
      ],
    },
  }));

  // 1. actors from their postures
  const actors = scene.actors.map((spec, index) => refresh(createActor(spec, index)));

  // 2. place the first actor, then arrange the rest around it
  seatOnSurface(actors[0], surface);
  // Stepping clear of a table changes which part of it is underfoot, so the
  // seating has to be redone - but only if the step happened. Seating is not
  // idempotent (`settleLimbs` keeps finding a little more to give), and doing
  // it twice on a floor scene with no props to stand off from is what put a
  // figure on her forearms and knees onto the top of her head. Every validator
  // seats once and saw nothing; only the renderer went round twice.
  if (standOffProps(actors[0], props, surface)) seatOnSurface(actors[0], surface);
  // An arrangement name the library does not know is worth saying out loud.
  // Quietly falling back to face-to-face renders a confident, wrong picture,
  // and the caller has no way to tell that from a correct one.
  const warnings = [];
  const asked = scene.relationship?.arrangement;
  let requested = resolveArrangement(asked);
  if (!requested) {
    if (asked) warnings.push(`unknown arrangement "${asked}", used face_to_face`);
    requested = resolveArrangement("face_to_face");
  }
  // "The same thing but facing the other way" is a common enough description to
  // be worth expressing without a second copy of every arrangement in the
  // library. It is one number - which way the secondary is turned - and the
  // arrangement is otherwise unchanged, so it belongs as an override rather than
  // as `straddle_supine_reversed` sitting next to `straddle_supine`.
  if (scene.relationship?.yaw != null) {
    requested = { ...requested, yaw: scene.relationship.yaw };
  }
  // An arrangement is written for two upright partners; what it means on the
  // ground depends on the postures it is being asked to arrange.
  let arrangement =
    actors.length > 1
      ? reconcileArrangement(requested, actors[0].posture, actors[1].posture)
      : requested;
  // Custom-only means the defaults influence neither the initial placement
  // alignment nor the iterative contact solve. Merely skipping the latter
  // would still quietly seed a user-authored pose from an unwanted contact.
  if (scene.relationship?.contactMode === 'custom') arrangement = { ...arrangement, contacts: [] };
  for (let i = 1; i < actors.length; i += 1) {
    const rule = i === 1 ? arrangement : fanOut(arrangement, i);
    applyArrangement(actors[0], actors[i], rule, surface);
  }

  separateFootprints(actors, surface.ground);
  for (const actor of actors) {
    if (actor.posture.supports.length) seatOnSurface(actor, surface, { useIK: false });
  }

  // 3. gather contacts: arrangement defaults plus anything the text asked for
  const contacts = [];
  for (const [sourceIndex, contact] of (arrangement.contacts || []).entries()) {
    if (actors.length < 2) break;
    const normalised = normaliseContact(contact, 1, 0, actors);
    if (normalised) contacts.push({ ...normalised, source: 'arrangement', sourceIndex });
  }
  for (const [sourceIndex, contact] of (scene.contacts || []).entries()) {
    const normalised = normaliseContact(contact, null, null, actors);
    if (normalised) contacts.push({ ...normalised, source: 'custom', sourceIndex });
  }

  const declaredKeys = new Set();
  for (const contact of contacts) {
    const fromBone = resolveLandmark(contact.from, contact.fromSide)?.bone;
    const toBone = resolveLandmark(contact.to, contact.toSide)?.bone;
    if (!fromBone || !toBone) continue;
    const left = `${actors[contact.fromActor].id}:${fromBone}`;
    const right = `${actors[contact.toActor].id}:${toBone}`;
    declaredKeys.add(left < right ? `${left}|${right}` : `${right}|${left}`);
  }

  // 4. iterate contacts against collisions
  //
  // The two stages pull against each other by nature - closing a contact
  // creates overlap, resolving overlap opens the contact - so the iteration is
  // annealed rather than run to a fixed point, and the best state seen is kept.
  // Without that the result is whatever the last iteration happened to leave,
  // which can easily be worse than something already passed through.
  const history = [];
  let contactReports = [];
  let best = null;
  let bestScore = Infinity;
  let bestReports = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const relaxation = 1 - iteration / (iterations * 1.6);

    // 4a. contacts
    contactReports = [];
    for (const contact of contacts) {
      const from = actors[contact.fromActor];
      const to = actors[contact.toActor];
      if (!from || !to) continue;
      const report = LIMB_LANDMARKS.has(splitLandmark(contact.from).base)
        ? solveContactIK(from, contact, to)
        : solveBodyContact(actors, contact, relaxation);
      if (report) contactReports.push(report);
    }

    // 4b. the ground, before anything is measured
    //
    // The contact stage slides whole actors along a contact normal, and a normal
    // that points downwards puts a knee through the floor on the way to closing
    // a contact. Seating here rather than at the end of the iteration is what
    // makes the snapshot below trustworthy: the state that gets scored, kept and
    // eventually returned is one that has already been put back on the ground.
    // Seat afterwards instead and the best-scoring state can be a mid-iteration
    // one that was never re-seated, which is a scene that measures well and has
    // somebody's shins buried in the carpet.
    settleOnGround(actors, props, surface);

    // 4c. collisions
    const bodies = actors.map((actor) => ({ id: actor.id, volumes: actor.volumes }));
    const bodyContacts = detectContacts(bodies, { declared: declaredKeys, selfCollision: true });
    const propContacts = detectPropContacts(bodies, props);

    const score = sceneScore(penetrationReport(bodyContacts), contactReports, propContacts);
    if (score < bestScore) {
      bestScore = score;
      best = actors.map(snapshotActor);
      bestReports = contactReports;
    }

    // Settled means both halves of the problem are answered: nothing is
    // interpenetrating *and* every declared contact is actually touching. An
    // empty penetration report on its own is also what two people standing a
    // metre apart produce, which is not the pose that was asked for. A contact
    // the bodies physically block is not pending - it is already as close as it
    // will ever get, and waiting on it would just burn iterations.
    const pending = contactReports.some(
      (entry) => !entry.unreachable && !entry.blocked && entry.distance > 0.012
    );
    if (bodyContacts.length === 0 && propContacts.length === 0 && !pending) {
      history.push(0);
      break;
    }
    history.push(penetrationReport(bodyContacts).maxDepth);

    // 4d. straddle stage - a supporting limb in the way swings out of the way
    widenStraddle(actors, bodyContacts, collisionGain * relaxation);

    // 4e. rigid stage - whole actors move for overlaps no joint can fix
    //
    // That means torso against torso, and anything involving a limb that is
    // holding the body up: you cannot lift an all-fours partner's thigh off
    // something by bending their leg, because their leg is what they are
    // standing on. Everything else is left to the articulated stage.
    const immovable = (contact) =>
      actors[contact.bodyA]?.loadBearing.has(contact.volumeA.bone) ||
      actors[contact.bodyB]?.loadBearing.has(contact.volumeB.bone);
    const rigidContacts = bodyContacts.filter(
      (contact) =>
        !contact.self &&
        ((isBulk(contact.groupA) && isBulk(contact.groupB)) || immovable(contact))
    );
    // Only bulk against bulk is finished with once the rigid stage has had it.
    // A load-bearing knee resting on a free arm is one of each: the knee cannot
    // bend out of the way, but the arm certainly can, and handing the whole
    // contact to the rigid stage would leave the arm pinned there forever.
    // `resolveLimbContacts` already refuses to bend a load-bearing bone, so it
    // is safe to let it see these and act on whichever side is free.
    const settledRigidly = rigidContacts.filter(
      (contact) => isBulk(contact.groupA) && isBulk(contact.groupB)
    );
    const totalMobility = actors.reduce((sum, actor) => sum + actor.mobility, 0) || 1;
    for (const actor of actors) {
      const centre = centreOfMass(actor);
      const { translation, torque } = rigidCorrection(rigidContacts, actor.index, centre);
      if (v3lenSq(translation) < 1e-12 && v3lenSq(torque) < 1e-12) continue;
      const share = (actor.mobility / totalMobility) * actors.length * collisionGain * relaxation;
      const step = limitStep(v3mul(translation, share), maxStep);
      translateActor(actor, step);
      rotateActor(actor, limitStep(v3mul(torque, share * 0.5), 0.12), centre);
      refresh(actor);
    }

    // 4f. articulated stage - limb overlaps bend limbs
    resolveLimbContacts(actors, bodyContacts, {
      gain: collisionGain * relaxation,
      maxStep,
      skip: settledRigidly,
    });

    // 4g. footprints
    //
    // Left to the end because it is the only stage that answers a question the
    // others cannot even ask: two actors whose supports want the same patch of
    // floor are not interpenetrating anywhere, so no contact and no collision
    // reports them. The ground pass at the top of the next iteration puts back
    // whatever height this costs.
    separateFootprints(actors, surface.ground, 0.6 * relaxation);
  }

  // 5. keep whichever state scored best, then measure that one
  let bodies = actors.map((actor) => ({ id: actor.id, volumes: actor.volumes }));
  let finalContacts = detectContacts(bodies, { declared: declaredKeys, selfCollision: true });
  let finalProps = detectPropContacts(bodies, props);
  if (best && bestScore < sceneScore(penetrationReport(finalContacts), contactReports, finalProps)) {
    actors.forEach((actor, index) => restoreActor(actor, best[index]));
    bodies = actors.map((actor) => ({ id: actor.id, volumes: actor.volumes }));
    finalContacts = detectContacts(bodies, { declared: declaredKeys, selfCollision: true });
    finalProps = detectPropContacts(bodies, props);
    // Re-measuring gives the distances for the state actually being returned,
    // but the verdicts - "the arm is not long enough", "the bodies block each
    // other" - come from watching the solver try, which a single measurement
    // cannot see. Carry them across from the iterate being restored.
    const verdicts = new Map(bestReports.map((entry) => [entry.contact, entry]));
    contactReports = contacts
      .map((contact) => {
        const measured = measureContact(actors, contact);
        if (!measured) return null;
        const verdict = verdicts.get(contact);
        return verdict ? { ...measured, unreachable: verdict.unreachable, blocked: verdict.blocked } : measured;
      })
      .filter(Boolean);
  }
  // Reports must describe the returned pose, including the ground/collision
  // adjustments after the last IK step, and use the same target definition
  // whether or not the best snapshot was restored.
  const finalVerdicts = new Map(contactReports.map(entry => [entry.contact, entry]));
  contactReports = contacts.map(contact => {
    const measured = measureContact(actors, contact);
    if (!measured) return null;
    const verdict = finalVerdicts.get(contact);
    return { ...measured, unreachable: verdict?.unreachable, blocked: verdict?.blocked };
  }).filter(Boolean);
  const report = penetrationReport(finalContacts);

  // What each hand is doing, decided once here rather than by every renderer
  // separately. It needs the contacts *and* the postures, and this is the only
  // place that holds both - see `handShapes` for why the declarations are a
  // better source for it than the solved geometry.
  for (const actor of actors) {
    actor.hands = handShapes(actor, contacts);
    // A clamp displacement describes one correction, not the final support
    // gaps. Re-measure guided and fixed poses after any snapshot restoration.
    // Partner-supported figures are not constrained to the surface plane.
    actor.supportBasis = actor.carried || actor.mountedOn != null
      ? "partner" : actor.posture.supports.length ? "surface" : "none";
    actor.seatResidual = measureBodySupportResidual(actor, surface);
  }

  // Say what could not be done. A pose where the chests never met is a
  // different picture from the one that was asked for, and the caller cannot
  // tell the two apart by looking at the geometry - the render comes out just
  // as confident either way. Naming the contact and the reason is what lets the
  // webapp tell the user their description does not fit together, rather than
  // showing them a wrong answer with no caveat.
  const placementWarnings = [...warnings];
  for (const entry of contactReports) {
    if (entry.distance <= 0.06) continue;
    const label = `${entry.contact.from} to ${entry.contact.to}`;
    const gap = `${Math.round(entry.distance * 1000)}mm`;
    if (entry.unreachable) {
      warnings.push(`${label} is out of reach in these postures, left ${gap} apart`);
    } else if (entry.blocked) {
      warnings.push(`${label} is as close as the bodies allow, ${gap} apart`);
    } else {
      warnings.push(`${label} could not be closed, left ${gap} apart`);
    }
  }

  return {
    id: scene.id,
    title: scene.title,
    description: scene.description,
    // `height` (where a trunk rests) and `ground` (where feet go) are both
    // published because they differ on a chair or a table. There is no `y`:
    // a single number here is what had the validators measuring a standing
    // man's feet against the table top and calling him 750mm underground.
    surface,
    props,
    actors,
    contacts,
    camera: scene.camera || defaultCamera(actors),
    quality: {
      ...report,
      propPenetration: finalProps.length ? finalProps[0].depth : 0,
      unmetContacts: contactReports.filter((entry) => entry.distance > 0.06).length,
      // `blocked` means the approach was refused every time it was tried: the
      // two bodies are already as close as their limbs allow. Saying so is more
      // use than reporting a bare 300mm gap, which reads as a solver failure
      // when it is actually a statement about the postures.
      contactDetail: contactReports.map((entry) => ({
        from: entry.contact.from,
        to: entry.contact.to,
        fromActor: entry.contact.fromActor,
        toActor: entry.contact.toActor,
        fromSide: entry.contact.fromSide,
        toSide: entry.contact.toSide,
        source: entry.contact.source,
        sourceIndex: entry.contact.sourceIndex,
        strength: entry.contact.strength,
        distance: entry.distance,
        blocked: Boolean(entry.blocked),
        unreachable: Boolean(entry.unreachable || entry.blocked),
      })),
      balance: actors.map((actor) => balanceOf(actor, surface)),
      convergence: history,
      warnings,
      placementWarnings,
    },
  };
}

/**
 * Slide actors sideways until their load-bearing volumes stop sharing ground.
 *
 * Two people standing chest to chest cannot both put their feet in the same
 * place - they stagger. Neither solver stage can discover that on its own: the
 * contact normal between two overlapping feet points front to back, along the
 * exact axis the chest contact is holding fixed, so pushing along it just
 * trades one error for another. The escape is lateral, and it has to be taken
 * deliberately.
 */
function separateFootprints(actors, surfaceY, gain = 0.8) {
  const band = 0.14;
  const footprint = (actor) =>
    actor.volumes.filter(
      (volume) =>
        actor.loadBearing.has(volume.bone) &&
        Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb) < surfaceY + band
    );

  for (let i = 0; i < actors.length; i += 1) {
    for (let j = i + 1; j < actors.length; j += 1) {
      const a = actors[i];
      const b = actors[j];

      // Two people cannot stand in the same place, which is what this stage is
      // for. Neither exception below is two people standing.
      //
      // A partner straddling another is not beside them: their knees are
      // *supposed* to land either side of their partner's hips and overlap them
      // in plan. Read as a footprint clash that is a sideways shove applied
      // every iteration, and the pair ends up alongside each other instead of
      // one astride the other - cowgirl drifted half a metre.
      //
      // And someone lying down has no footprint. Their whole body is on the
      // surface and all of it is load-bearing, so every limb that reaches them
      // reads as a clash - in missionary the kneeling partner's knees are
      // between their partner's legs, which is the pose, not a collision. Those
      // overlaps are real but they are ordinary ones: the rigid and articulated
      // stages already resolve them along the true contact normal, instead of
      // forcing everything sideways the way this stage must.
      if (a.mountedOn === b.index || b.mountedOn === a.index) continue;
      if (isRecumbent(a.posture) || isRecumbent(b.posture)) continue;

      const footA = footprint(a);
      const footB = footprint(b);
      if (!footA.length || !footB.length) continue;

      // Sideways means perpendicular, in the ground plane, to the line joining
      // the two actors - so the separation never disturbs how far apart they
      // are facing each other.
      const between = v3sub(centreOfMass(b), centreOfMass(a));
      const length = Math.hypot(between[0], between[2]);
      if (length < 1e-6) continue;
      const lateral = [-between[2] / length, 0, between[0] / length];

      let deepest = 0;
      let sign = 1;
      for (const volumeA of footA) {
        for (const volumeB of footB) {
          const hit = capsuleContact(volumeA, volumeB, 0);
          if (!hit || hit.depth <= deepest) continue;
          deepest = hit.depth;
          const along = hit.normal[0] * lateral[0] + hit.normal[2] * lateral[2];
          // A normal that is nearly all front-to-back says nothing about which
          // way to step; pick a side and be consistent, so the result is stable.
          sign = Math.abs(along) < 0.2 ? 1 : Math.sign(along);
        }
      }
      if (deepest < 0.004) continue;

      const total = a.mobility + b.mobility || 1;
      const step = deepest * gain * sign;
      translateActor(a, v3mul(lateral, (-step * a.mobility) / total));
      translateActor(b, v3mul(lateral, (step * b.mobility) / total));
      refresh(a);
      refresh(b);
    }
  }
}

/**
 * Put everyone back where the floor, the furniture and their partners allow.
 *
 * Every other stage moves bodies for reasons of its own and none of them looks
 * at the ground, so this is what makes the rest safe to use: a rigid correction
 * that shoves a partner sideways also leaves them hovering above the bed or sunk
 * into it, and only the horizontal part of such a move should survive.
 */
function settleOnGround(actors, props, surface) {
  for (const actor of actors) {
    standOffProps(actor, props, surface);
    resolvePropPenetration(actor, props, surface.ground);
    if (actor.carried || !actor.posture.supports.length) continue;
    const mount = actor.mountedOn == null ? null : actors[actor.mountedOn];
    seatOnSurface(actor, surface, { useIK: false, lower: !mount });
    if (mount) settleOntoMount(actor, mount, surface);
  }
}

const isBulk = (group) => group === "torso" || group === "head";

/**
 * Let a mounted actor back down until something catches them.
 *
 * Seating a mounted actor only ever lifts, because the surface under their
 * knees is not what decides their height - see `seatOnSurface`. But refusing to
 * lower them at all is the opposite error: any correction that pushed them up
 * leaves them hovering there, knees in the air above a bed they are supposed to
 * be kneeling on.
 *
 * What catches them is whichever comes first: their own supports reaching the
 * surface, or their bulk meeting the partner they are mounted on. Kneeling
 * astride someone is both at once - knees on the bed, seat on the person - and
 * which of the two takes the weight is precisely the difference between
 * floating above the pose and sinking through it.
 */
function settleOntoMount(actor, mount, surface) {
  let plane = Infinity;
  let target = Infinity;
  for (const support of actor.posture.supports) {
    const found = supportLowestY(actor, support);
    if (!found) continue;
    plane = Math.min(plane, found.y);
    target = Math.min(target, supportPlaneFor(support, surface));
  }
  // How far they have to fall, bounded by whichever part of them is lowest and
  // not only by the declared supports. The supports are what the posture says is
  // holding the body up, but a trailing foot or a hanging forearm meets the
  // mattress first, and letting them through it is not a cheaper answer than
  // leaving the knees a little short - it is a wrong one.
  const fall = Math.min(plane, lowestPoint(actor.volumes)) - Math.min(target, surface.ground);
  if (!Number.isFinite(fall) || fall <= 0.002) return;

  // Never worse than it already is, and never tighter than the compression a
  // declared contact is allowed - the pelvis resting on a pelvis is the pose.
  const ceiling = Math.max(overlapBetween(actor, mount).bulk, COMPRESSION.declaredContact);
  let step = fall;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    translateActor(actor, [0, -step, 0]);
    refresh(actor);
    if (overlapBetween(actor, mount).bulk <= ceiling) return;
    translateActor(actor, [0, step, 0]);
    refresh(actor);
    step *= 0.45;
  }
}

/**
 * How far a limb may be pushed into another body while a contact closes.
 *
 * Generous on purpose - roughly a finger's width past the soft-tissue
 * allowance. The straddle and articulated stages clear limb overlaps every
 * iteration, so the approach only has to avoid getting so far ahead of them
 * that they cannot catch up.
 */
const LIMB_TOLERANCE = 0.045;

/**
 * How bad a scene is, as one number, so competing iterations can be ranked.
 *
 * Deepest penetration dominates, because one limb buried in a torso ruins an
 * image no matter how good everything else is; total depth breaks ties between
 * states with the same worst offender; unmet contacts are counted only beyond
 * the tolerance a viewer would notice.
 */
function sceneScore(penetration, contactReports, propContacts) {
  // The unmet penalty saturates, and deliberately. A contact 300mm short is
  // not a contact the solver is about to close - the postures simply do not put
  // those two parts near each other - and letting its cost grow without limit
  // lets an impossible goal buy real, visible interpenetration elsewhere. Past
  // the point where closing is plausible, all misses are just misses.
  const REACHABLE = 0.12;
  let unmet = 0;
  for (const entry of contactReports) {
    unmet += Math.min(REACHABLE, Math.max(0, entry.distance - 0.02));
  }
  return (
    penetration.maxDepth +
    0.15 * penetration.totalDepth +
    0.5 * unmet +
    (propContacts.length ? propContacts[0].depth : 0)
  );
}

/** An actor's full mutable state is its pose, so a deep copy of that restores it. */
function snapshotActor(actor) {
  const joints = {};
  for (const [bone, angles] of Object.entries(actor.pose.joints)) joints[bone] = { ...angles };
  return {
    root: {
      position: [...actor.pose.root.position],
      quaternion: [...actor.pose.root.quaternion],
    },
    joints,
  };
}

function restoreActor(actor, snapshot) {
  actor.pose = snapshot;
  return refresh(actor);
}

/**
 * Re-measure a contact without moving anything, for reporting a restored state.
 *
 * Deliberately the same measure `solveBodyContact` drives, so the score ranks
 * iterates by how well they met the contacts rather than by a quantity nothing
 * was ever trying to minimise.
 */
function measureContact(actors, contact) {
  if (LIMB_LANDMARKS.has(contact.from)) {
    const actor = actors[contact.fromActor], target = actors[contact.toActor];
    const current = landmarkPoint(actor, contact.from, contact.fromSide ?? null);
    const surface = current && landmarkSurface(target, contact.to, current, {
      offset: actor.skeleton.stature * 0.018,
      defaultSide: contact.toSide ?? null,
    });
    return surface ? { contact, distance: v3dist(current, surface.point) } : null;
  }
  const separation = contactSeparation(actors, contact);
  if (!separation) return null;
  return { contact, distance: Math.abs(separation.error) };
}

/** Recheck safety after a renderer-aware correction, using the solver's rules. */
export function measureSceneSafety(solved, { verifiedPair = () => false, verifiedProp = () => false } = {}) {
  const declared = new Set();
  for (const contact of solved.contacts) {
    const a = resolveLandmark(contact.from, contact.fromSide)?.bone;
    const b = resolveLandmark(contact.to, contact.toSide)?.bone;
    if (!a || !b) continue;
    const left = `${solved.actors[contact.fromActor].id}:${a}`;
    const right = `${solved.actors[contact.toActor].id}:${b}`;
    declared.add(left < right ? `${left}|${right}` : `${right}|${left}`);
  }
  const bodies = solved.actors.map(actor => ({ id: actor.id, volumes: actor.volumes }));
  const rawContacts = detectContacts(bodies, { declared, selfCollision: true });
  const contacts = rawContacts.filter(contact => contact.self || !verifiedPair(contact));
  const report = penetrationReport(contacts);
  const raw = penetrationReport(rawContacts);
  const rawProps = detectPropContacts(bodies, solved.props);
  const props = rawProps.filter(contact => !verifiedProp(contact));
  return { ...report,
    proxyMaxDepth: raw.maxDepth, proxyTotalDepth: raw.totalDepth,
    verifiedProxyContacts: rawContacts.length - contacts.length,
    violations: [...contacts.map(c => ({ key: `${c.bodyA}:${solved.actors[c.bodyA].volumes.indexOf(c.volumeA)}|${c.bodyB}:${solved.actors[c.bodyB].volumes.indexOf(c.volumeB)}`, depth: c.depth })),
      ...props.map(c => ({ key: `prop:${c.bodyIndex}:${solved.actors[c.bodyIndex].volumes.indexOf(c.volume)}:${solved.props.indexOf(c.prop)}`, depth: c.depth }))],
    maxSelfDepth: Math.max(0, ...contacts.filter(p => p.self).map(p => p.depth)),
    maxBodyDepth: Math.max(0, ...contacts.filter(p => !p.self).map(p => p.depth)),
    propPenetration: Math.max(0, ...props.map(p => p.depth)),
    proxyPropPenetration: Math.max(0, ...rawProps.map(p => p.depth)),
    verifiedPropContacts: rawProps.length - props.length,
    balance: solved.actors.map(actor => balanceOf(actor, solved.surface)) };
}

/** Final body-model target errors, separate from rendered surface distances. */
export function measureContactTargets(solved) {
  return solved.contacts.map(contact => measureContact(solved.actors, contact)?.distance ?? null);
}

function limitStep(vector, maximum) {
  const length = v3len(vector);
  if (length <= maximum || length < 1e-12) return vector;
  return v3mul(vector, maximum / length);
}

/** Additional actors fan out around the primary rather than stacking. */
function fanOut(arrangement, index) {
  const angle = (index - 1) * 72 + 36;
  const radians = angle * (Math.PI / 180);
  const radius = 0.42;
  return {
    ...arrangement,
    offset: [Math.sin(radians) * radius, arrangement.offset[1], Math.cos(radians) * radius],
    yaw: 180 - angle,
    contacts: [],
  };
}

/** Normalise a contact reference into indices plus base landmark and side. */
function normaliseContact(contact, defaultFrom, defaultTo, actors) {
  if (!resolveLandmark(contact.from) || !resolveLandmark(contact.to)) return null;
  const from = splitLandmark(contact.from);
  const to = splitLandmark(contact.to);
  const fromActor = resolveActorIndex(contact.fromActor ?? defaultFrom, actors);
  const toActor = resolveActorIndex(contact.toActor ?? defaultTo, actors);
  if (fromActor == null || toActor == null || fromActor === toActor) return null;
  return {
    from: from.base,
    fromSide: from.side,
    to: to.base,
    toSide: to.side,
    fromActor,
    toActor,
    type: contact.type || "rest",
    strength: contact.strength ?? 0.7,
  };
}

function resolveActorIndex(reference, actors) {
  if (reference == null) return null;
  if (typeof reference === "number") return reference < actors.length ? reference : null;
  const index = actors.findIndex((actor) => actor.id === reference || actor.label === reference);
  return index >= 0 ? index : null;
}

/**
 * Convert limb penetrations into IK target offsets.
 *
 * A contact partway along a limb needs the end effector to move further than
 * the contact point itself - by the reciprocal of how far along the chain the
 * contact sits. Clamping that factor keeps corrections near the shoulder or
 * hip from exploding.
 */
/**
 * Widen a limb that is holding the body up and is in the way.
 *
 * Neither of the other collision stages can answer this. The articulated stage
 * refuses to touch a load-bearing limb, correctly: bending a knee you are
 * kneeling on lowers you onto the thing you were trying to avoid. The rigid
 * stage can only slide whole actors, and sliding is wrong here - moving a
 * partner out from under someone is not what the pose asked for.
 *
 * What a person actually does is straddle: swing the limb out from the midline
 * and go around. Abduction is the one channel that does that, and it is safe on
 * a load-bearing limb precisely because it does not shorten the chain - the
 * knee stays on the floor, it just lands further out.
 */
function widenStraddle(actors, contacts, gain) {
  const widen = new Map();
  for (const contact of contacts) {
    if (contact.self || contact.depth <= 0) continue;
    for (const [actorIndex, volume, otherGroup] of [
      [contact.bodyA, contact.volumeA, contact.groupB],
      [contact.bodyB, contact.volumeB, contact.groupA],
    ]) {
      const actor = actors[actorIndex];
      if (!actor?.loadBearing.has(volume.bone)) continue;
      // Only bulk gets straddled. A limb tangled with another limb is the
      // articulated stage's problem, and it has finer tools for it.
      if (!isBulk(otherGroup)) continue;
      const chain = LIMB_CHAINS[chainForBone(volume.bone)];
      if (!chain) continue;
      const key = `${actorIndex}:${chain.root}`;
      widen.set(key, Math.max(widen.get(key) ?? 0, contact.depth));
    }
  }

  for (const [key, depth] of widen) {
    const [actorIndex, root] = key.split(":");
    const actor = actors[Number(actorIndex)];
    const skeleton = actor.skeleton;
    const current = actor.pose.joints[root] ?? { flexion: 0, abduction: 0, rotation: 0 };
    // Abduction is signed so that positive always means "away from the
    // midline", whichever side the limb is on, so widening is just an increase.
    // Converting a depth to an angle through the limb's own length is what
    // keeps a long femur from over-swinging for the same penetration.
    const chain = LIMB_CHAINS[chainForBone(root)];
    const lever = skeleton.segmentLength(root, chain.end) || 0.4;
    const delta = (Math.atan2(depth * gain, lever) * 180) / Math.PI;
    const next = skeleton.clampAngles(root, { ...current, abduction: current.abduction + delta });
    if (Math.abs(next.abduction - current.abduction) < 1e-4) continue;
    actor.pose.joints[root] = next;
    refresh(actor);
  }
}

function resolveLimbContacts(actors, contacts, { gain, maxStep, skip }) {
  const corrections = new Map();
  const handled = skip ? new Set(skip) : null;

  const accumulate = (actorIndex, boneName, displacement, point) => {
    const chainKey = chainForBone(boneName);
    if (!chainKey) return;
    // A limb that is holding the body up has already been answered rigidly.
    if (actors[actorIndex]?.loadBearing.has(boneName)) return;
    const key = `${actorIndex}:${chainKey}`;
    const existing = corrections.get(key);
    if (existing) {
      existing.displacement = v3add(existing.displacement, displacement);
      existing.point = v3add(existing.point, point);
      existing.count += 1;
    } else {
      corrections.set(key, { actorIndex, chainKey, displacement, point, count: 1 });
    }
  };

  for (const contact of contacts) {
    if (contact.depth <= 0) continue;
    if (handled?.has(contact)) continue;
    const half = v3mul(contact.normal, contact.depth * 0.5);
    accumulate(contact.bodyA, contact.volumeA.bone, v3mul(half, -1), contact.pointA);
    accumulate(contact.bodyB, contact.volumeB.bone, half, contact.pointB);
  }

  for (const entry of corrections.values()) {
    const actor = actors[entry.actorIndex];
    if (!actor) continue;
    const chain = LIMB_CHAINS[entry.chainKey];
    const skeleton = actor.skeleton;
    const rootPosition = actor.evaluated.positions[skeleton.boneIndex(chain.root)];
    const endPosition = actor.evaluated.positions[skeleton.boneIndex(chain.end)];
    const fullLength =
      skeleton.bone(chain.mid).length + skeleton.bone(chain.end).length || 1e-3;

    const average = v3mul(entry.displacement, 1 / entry.count);
    const contactPoint = v3mul(entry.point, 1 / entry.count);
    // Lever arm: a correction needed at the elbow takes roughly twice as much
    // motion at the wrist, because the wrist is twice as far down the chain.
    const fraction = clamp(v3dist(contactPoint, rootPosition) / fullLength, 0.3, 1);
    const displacement = limitStep(v3mul(average, gain / fraction), maxStep);
    if (v3lenSq(displacement) < 1e-10) continue;

    solveTwoBoneIK(skeleton, actor.pose, chain, v3add(endPosition, displacement), {
      evaluated: actor.evaluated,
    });
    refresh(actor);
  }
}

/**
 * The limb chains carrying this posture's ground-plane supports.
 *
 * These are the parts that have to be *beside* a prop rather than on it, and
 * they are the only parts worth measuring. A trunk resting on a table is
 * supposed to be over it, and a pelvis is supposed to be at its edge - half in
 * the footprint and half out - so asking either of them to clear it pushes the
 * figure a third of a metre past where she belongs.
 */
function standingChains(actor, surface) {
  const chains = new Set();
  for (const support of actor.posture.supports) {
    if (supportPlaneFor(support, surface) > surface.ground) continue;
    const resolved = resolveLandmark(support.landmark, support.side ?? null);
    const chain = resolved && chainForBone(resolved.bone);
    if (chain) chains.add(chain);
  }
  return chains;
}

/**
 * The height of whatever is under a point: the top of the highest prop whose
 * plan footprint contains it, or failing that the ground.
 *
 * A support plane is not infinite and treating it as one fails in both
 * directions. Tell a hand half a metre past the edge of a table that it may
 * rest at table height and it hangs in mid air; tell one directly over the
 * table that it may go to the floor and it goes there through the top.
 */
function surfaceUnder(point, surface) {
  let top = surface.ground;
  // Read off the surface's own prop list rather than the solved boxes, so this
  // is answerable anywhere a surface is in hand - including inside seating,
  // which runs before the scene has been assembled.
  for (const prop of surface.props || []) {
    const half = [prop.size[0] / 2, prop.size[1] / 2, prop.size[2] / 2];
    if (Math.abs(point[0] - prop.center[0]) > half[0]) continue;
    if (Math.abs(point[2] - prop.center[2]) > half[2]) continue;
    top = Math.max(top, prop.center[1] + half[1]);
  }
  return top;
}

/** How far a box reaches along a direction, measured from the world origin. */
function boxSpan(box, dir) {
  const centre = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const half = [
    (box.max[0] - box.min[0]) / 2,
    (box.max[1] - box.min[1]) / 2,
    (box.max[2] - box.min[2]) / 2,
  ];
  const middle = centre[0] * dir[0] + centre[1] * dir[1] + centre[2] * dir[2];
  const reach =
    Math.abs(dir[0]) * half[0] + Math.abs(dir[1]) * half[1] + Math.abs(dir[2]) * half[2];
  return { min: middle - reach, max: middle + reach };
}

/**
 * Take a step back from a prop, rather than climbing onto it.
 *
 * Resolving a prop overlap by the shortest way out is the right answer for a
 * hand laid on a table and the wrong one for a body standing at it. A woman
 * bent over a table has her chest on the top and her feet on the floor, and her
 * hips sit 194mm inside the box between the two; the shortest way out of that
 * is straight up, which is how both figures ended up standing on the furniture.
 * What she needs is to move along the line she is facing until the table's edge
 * is at her hips - the distance is not a property of the posture, because it
 * depends on how deep the table is, so it has to be measured here.
 *
 * The same measure puts a partner standing behind her out of the half of the
 * table he was sharing with it, for the same reason: his legs are under it.
 */
function standOffProps(actor, props, surface) {
  if (!props.length) return false;
  const chains = standingChains(actor, surface);
  if (!chains.size) return false;
  const axis = heading(actor);
  let forward = 0;
  let back = 0;

  for (const volume of actor.volumes) {
    if (!chains.has(chainForBone(volume.bone))) continue;
    const low = Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb);
    for (const prop of props) {
      // Only what is *under* the top counts. A forearm laid on the table is
      // inside the box by the width of the compression allowance and wants no
      // correction at all; a shin at the same plan position is under the table
      // and wants the whole step. Measuring both the same way is what sent her
      // right past the edge and left her hovering beside it.
      if (low > prop.box.max[1] - COMPRESSION.default) continue;
      const contact = capsuleBoxContact(volume, prop.box);
      if (!contact || contact.depth - COMPRESSION.default <= 0) continue;
      const span = boxSpan(prop.box, axis);
      const a = volume.a[0] * axis[0] + volume.a[2] * axis[2];
      const b = volume.b[0] * axis[0] + volume.b[2] * axis[2];
      const near = Math.min(a - volume.ra, b - volume.rb);
      const far = Math.max(a + volume.ra, b + volume.rb);
      forward = Math.max(forward, span.max - near);
      back = Math.max(back, far - span.min);
    }
  }

  // Whichever way out is shorter. Taking the smaller of the two totals rather
  // than deciding per-volume keeps the figure rigid: half of her stepping back
  // while the other half steps forward is not a step, it is a tear.
  const push = Math.min(forward, back);
  if (push <= 0.002 || !Number.isFinite(push)) return false;
  const sign = forward <= back ? 1 : -1;
  translateActor(actor, [axis[0] * push * sign, 0, axis[2] * push * sign]);
  refresh(actor);
  return true;
}

/** Lift an actor out of props and the ground plane. */
function resolvePropPenetration(actor, props, surfaceY) {
  const bodies = [{ id: actor.id, volumes: actor.volumes }];
  const contacts = detectPropContacts(bodies, props);
  let lift = 0;
  for (const contact of contacts) {
    if (contact.normal[1] > 0.5) lift = Math.max(lift, contact.depth);
  }
  const groundGap = lowestPoint(actor.volumes) - surfaceY;
  if (groundGap < -0.001) lift = Math.max(lift, -groundGap);
  if (lift > 0.001) {
    translateActor(actor, [0, lift, 0]);
    refresh(actor);
  }
}

/**
 * Is the actor's centre of mass over its support? Reported rather than forced:
 * some interactions are genuinely supported by the partner, and silently
 * shifting the figure would hide that.
 */
function balanceOf(actor, surface) {
  const com = centreOfMass(actor);
  const contactPoints = [];
  for (const volume of actor.volumes) {
    for (const [point, radius] of [
      [volume.a, volume.ra],
      [volume.b, volume.rb],
    ]) {
      // Seats and other raised supports contribute alongside the floor. Their
      // finite footprint matters: being at chair height beside a chair is not
      // seated support. Deep penetration is not a valid support point either.
      const plane = surfaceUnder(point, surface);
      if (Math.abs(point[1] - radius - plane) < 0.03)
        contactPoints.push([point[0], point[2]]);
    }
  }
  if (contactPoints.length === 0) {
    return {
      actor: actor.id,
      supported: false,
      offset: null,
      note: actor.carried || actor.mountedOn != null
        ? "supported by partner"
        : "no measured surface support",
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of contactPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const insideX = com[0] >= minX - 0.02 && com[0] <= maxX + 0.02;
  const insideZ = com[2] >= minZ - 0.02 && com[2] <= maxZ + 0.02;
  const offset = Math.max(
    0,
    Math.max(minX - com[0], com[0] - maxX),
    Math.max(minZ - com[2], com[2] - maxZ)
  );
  return { actor: actor.id, supported: insideX && insideZ, offset, note: null };
}

/** Frame the whole group with a three-quarter view. */
function defaultCamera(actors) {
  const all = actors.flatMap((actor) => actor.volumes);
  const bounds = volumesBounds(all, 0.05);
  const centre = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const size = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  );
  return { azimuth: 35, elevation: 18, distance: Math.max(2.4, size * 2.1), target: centre, fov: 38 };
}
