/**
 * Body volumes.
 *
 * A body is a list of round cones (capsules with independent end radii) bound
 * to skeleton bones. This single list drives three things at once:
 *
 *   - the rendered surface, via a smooth union signed distance field
 *   - collision detection, via exact segment-segment capsule tests
 *   - ambient occlusion, by sampling the same field around each vertex
 *
 * Keeping them identical is the point: the silhouette you see is exactly the
 * volume the solver keeps from interpenetrating.
 *
 * The torso is built from horizontal capsule "slabs" stacked along the spine.
 * Smooth-unioning them yields the elliptical cross-section a real torso has,
 * while every primitive stays circular so the collision maths stays exact.
 */

import { closestPointOnSegment, v3add, v3dist, v3sub, v3mul, v3lenSq } from "./math.js";

/** Collision groups; used for classifying contacts, not for exempting them. */
export const GROUP = {
  TORSO: "torso",
  HEAD: "head",
  ARM_L: "armL",
  ARM_R: "armR",
  LEG_L: "legL",
  LEG_R: "legR",
};

/**
 * How many joints apart two bones may be before their volumes are expected to
 * be distinct. Within this radius the primitives are deliberately authored to
 * overlap - the two thighs meet across the pelvis (hip_l and hip_r are two
 * joints apart), the deltoid sinks into the ribcage, the forearm folds into
 * the upper arm - and the smooth-min union turns that overlap into the surface
 * we actually render. Reporting it as penetration would be reporting the
 * body's own anatomy as an error.
 *
 * Everything beyond it collides for real, which is why a hand cannot pass
 * through its own chest here.
 */
const AUTHORED_OVERLAP_JOINTS = 2;

/**
 * Smooth-min union bulges the surface outward where primitives overlap, so a
 * torso built to its exact target section measures wider than the target once
 * rendered. Primitives are authored a little under size to compensate; the
 * factor is calibrated against `scripts/measure-body.mjs`, which measures the
 * SDF itself rather than the primitives.
 *
 * It sits close to 1 because the blend radii are deliberately small. That is
 * worth preserving: `bodyDistance` folds the union pairwise, so inflation
 * accumulates with the number of overlapping primitives - five of them meet at
 * the hip - and generous blending there costs centimetres of silhouette.
 */
const BLEND_SHRINK = 0.97;

/**
 * The same compensation for limbs. Limb primitives mostly meet end-to-end
 * rather than overlapping broadside, so the union inflates them far less than
 * it does the stacked torso sections and this stays near 1.
 */
const LIMB_SHRINK = 0.96;

/**
 * Should this pair of volumes on the *same* body be skipped?
 * The exempt set is precomputed per volume at build time, so this is a hash
 * lookup in the narrowphase inner loop.
 */
export function selfCollisionExempt(volumeA, volumeB) {
  return volumeA.selfIgnore?.has(volumeB.id) ?? false;
}

/**
 * Build the volume list for a skeleton.
 *
 * @param {import("./skeleton.js").Skeleton} skeleton
 * @param {object} [options]
 * @param {number} [options.bust] chest fullness multiplier, 0 disables the pair
 * @param {boolean} [options.anatomy] draw genital geometry, on by default
 * @returns {Array<object>} primitives in bone-local space
 */
export function buildBodyVolumes(skeleton, { bust, anatomy = true } = {}) {
  const H = skeleton.stature;
  const g = skeleton.girth;
  const female = skeleton.chestType === "female";
  const male = skeleton.chestType === "male";
  const bustScale = bust ?? (female ? 1 : male ? 0.55 : 0.75);

  const volumes = [];
  let id = 0;
  const cone = (bone, group, a, ra, b, rb, blend = 0.035, extra = {}) => {
    volumes.push({
      id: id++,
      bone,
      group,
      a: a.map((value) => value * H),
      b: b.map((value) => value * H),
      ra: ra * H * g,
      rb: rb * H * g,
      blend: blend * H,
      ...extra,
    });
  };
  const ball = (bone, group, center, radius, blend = 0.035, extra = {}) =>
    cone(bone, group, center, radius, center, radius, blend, extra);

  // --- torso ------------------------------------------------------------
  // Each slab is a capsule spanning the body's width, so its cross-section is
  // a stadium: breadth = 2*(halfWidth + radius), depth = 2*radius. Authoring
  // the sections as breadth and depth means they are stated in the same terms
  // anthropometric tables use and can be checked directly against a
  // measurement of the rendered surface, instead of being tuned by eye.
  const section = (bone, y, breadth, depth, z = 0, blend = 0.03) => {
    const radius = (depth / 2) * BLEND_SHRINK;
    const halfWidth = Math.max(0.004, (breadth / 2) * BLEND_SHRINK - radius);
    volumes.push({
      id: id++,
      bone,
      group: GROUP.TORSO,
      a: [-halfWidth * H, y * H, z * H],
      b: [halfWidth * H, y * H, z * H],
      ra: radius * H,
      rb: radius * H,
      blend: blend * H,
    });
  };

  // Breadth/depth as fractions of stature at each level. The girth setting
  // scales the whole section, so a heavier build stays proportioned.
  const wide = (f, m) => (female ? f : male ? m : (f + m) / 2) * g;
  const deep = (f, m) => (female ? f : male ? m : (f + m) / 2) * g;

  section("pelvis", -0.035, wide(0.194, 0.183), deep(0.128, 0.128), 0.002);
  section("pelvis", 0.030, wide(0.175, 0.172), deep(0.118, 0.122), 0.002);
  section("spine01", 0.035, wide(0.157, 0.165), deep(0.109, 0.122), 0.004, 0.035);
  section("spine02", 0.020, wide(0.166, 0.178), deep(0.12, 0.132), 0.004, 0.035);
  section("spine02", 0.070, wide(0.174, 0.187), deep(0.132, 0.14), 0.002);
  section("spine03", 0.028, wide(0.18, 0.196), deep(0.128, 0.138), 0.0, 0.028);
  // Chest depth at shoulder level. 0.115/0.125 measured 20mm shy of the
  // reference for both body types, and the female figure only looked closer
  // because the bust's oversized blend was inflating the surface up here as a
  // side effect. Once the blend was cut to the size of the feature it belongs
  // to, the real shortfall showed. Authoring the depth is the honest way to
  // hold it.
  section("spine03", 0.066, wide(0.196, 0.214), deep(0.127, 0.137), -0.004, 0.028);

  // Gluteal mass, set back from the pelvis axis. It is narrow in X on
  // purpose: what a buttock owes the silhouette is depth from behind, and
  // spanning it wide instead makes the hips measure like a barrel.
  cone(
    "pelvis",
    GROUP.TORSO,
    [-0.022, -0.052, -0.042],
    0.046,
    [0.022, -0.052, -0.042],
    0.046,
    0.025
  );

  if (bustScale > 0.01) {
    for (const side of [-1, 1]) {
      // The blend radius here used to be 0.03 H, which on a 0.040 H sphere is
      // three quarters of the feature's own radius - and a smooth union whose
      // k approaches r does not soften a form, it dissolves it. A female
      // figure came out with flat pectorals. Blending at a third of the radius
      // keeps the join soft and the shape present.
      ball(
        "spine03",
        GROUP.TORSO,
        [side * (female ? 0.036 : 0.044), female ? 0.030 : 0.038, female ? 0.044 : 0.038],
        (female ? 0.040 : 0.034) * bustScale,
        0.014
      );
    }
  }

  // --- head and neck ----------------------------------------------------
  // Limbs are authored as circumferences, because that is the quantity
  // anthropometric tables carry and the one a tape measure reads. Every number
  // below is a girth as a fraction of stature and can be checked directly
  // against `scripts/measure-body.mjs`, instead of being a radius tuned by eye.
  const girthR = (f, m) =>
    ((female ? f : male ? m : (f + m) / 2) / (2 * Math.PI)) * LIMB_SHRINK;

  /**
   * A limb segment tapering between two tabulated circumferences, optionally
   * split at `splitAt` (a fraction of its length) into a proximal piece that
   * takes no part in self-collision and a distal piece that does.
   *
   * The pieces share the taper and overlap slightly, so their union is exactly
   * the undivided cone: splitting changes what collides, never what is drawn.
   */
  const limb = (bone, group, a, ra, b, rb, blend, { splitAt, ...extra } = {}) => {
    if (splitAt == null) {
      cone(bone, group, a, ra, b, rb, blend, extra);
      return;
    }
    const along = (t) => a.map((value, i) => value + (b[i] - value) * t);
    const radius = (t) => ra + (rb - ra) * t;
    const seam = splitAt + 0.03; // a little overlap, so no seam can open up
    cone(bone, group, a, ra, along(seam), radius(seam), blend, {
      ...extra,
      jointFiller: true,
    });
    cone(bone, group, along(splitAt), radius(splitAt), b, rb, blend, extra);
  };

  limb("neck", GROUP.HEAD, [0, -0.012, 0], girthR(0.2, 0.224), [0, 0.05, -0.002], girthR(0.186, 0.209), 0.022);

  // A skull is not a ball. Head breadth is 0.089 H, head length front to back
  // 0.114 H and head height 0.130 H, so a sphere can satisfy at most one of the
  // three - the 0.096 ball that used to be here was 25mm too narrow front to
  // back and 28mm short at the crown, which is most of why a rendered figure
  // read as an egg on a stick.
  //
  // The fix is the trick the torso already uses, turned through 90 degrees. A
  // capsule spanning *z* is circular in x and y, so 2r sets the breadth across
  // the head while the span sets the depth independently. Two stacked carry the
  // cranium; a forward-and-down taper gives the jaw a chin to end at, so the
  // head has a front.
  const skull = (y, back, front, r, blend = 0.028) =>
    cone("head", GROUP.HEAD, [0, y, back], r, [0, y, front], r, blend);
  skull(0.083, -0.014, 0.012, 0.0445);
  skull(0.052, -0.012, 0.016, 0.042);
  cone("head", GROUP.HEAD, [0, 0.034, 0.004], 0.036, [0, 0.014, 0.028], 0.017, 0.024);

  // --- arms -------------------------------------------------------------
  // The deltoid is sized by the thing it actually determines: bideltoid
  // breadth, which is what a silhouette shows at shoulder height. Its radius is
  // whatever reaches from the joint centre out to half that breadth, so the
  // number authored here is a measurable quantity rather than a guess at a
  // muscle's size.
  const shoulderX =
    (skeleton.bones[skeleton.boneIndex("clavicle_l")].offset[0] +
      skeleton.bones[skeleton.boneIndex("shoulder_l")].offset[0]) /
    H;
  const bideltoidHalf = (female ? 0.264 : male ? 0.28 : 0.272) / 2;
  const deltoidR = Math.max(0.022, ((bideltoidHalf - shoulderX) * LIMB_SHRINK) / g);

  for (const [suffix, group] of [["l", GROUP.ARM_L], ["r", GROUP.ARM_R]]) {
    // The deltoid is also a blend blob: it fills the gap between the ribcage
    // and the arm so the surface reads continuously. It is meant to sit inside
    // the torso, so it takes no part in self-collision - the upper-arm cone
    // below already carries the arm's collision duty. Against *other* bodies it
    // collides normally, so a shoulder pressing into a partner registers.
    ball(`shoulder_${suffix}`, group, [0, -0.004, 0], deltoidR, 0.025, {
      jointFiller: true,
    });
    // Split at the armpit: the proximal third is inside the chest envelope by
    // construction, so reporting it as a collision would report anatomy.
    limb(
      `shoulder_${suffix}`,
      group,
      [0, -0.012, 0],
      girthR(0.18, 0.193),
      [0, -0.186, 0],
      girthR(0.148, 0.158),
      0.022,
      { splitAt: 0.33 }
    );
    limb(
      `elbow_${suffix}`,
      group,
      [0, 0, 0],
      girthR(0.152, 0.164),
      [0, -0.146, 0.002],
      girthR(0.096, 0.101),
      0.02
    );
    // The forearm's last taper stops at the wrist crease. It used to run on to
    // 0.072 and simply end, a tapered stump where a hand belongs - the single
    // most obvious thing missing from a rendered figure.
    limb(
      `wrist_${suffix}`,
      group,
      [0, -0.006, 0],
      girthR(0.094, 0.099),
      [0, -0.048, 0.004],
      girthR(0.080, 0.084),
      0.018,
      { soft: true }
    );

    // --- hand ---
    // Authored on `hand_*`, a bone the rig has always carried and nothing has
    // ever drawn. Hand length is 0.108 H, breadth 0.044 H and thickness
    // 0.020 H: a hand is a flattened paddle, and a round cone is circular
    // across its axis, so no single cone can be one.
    //
    // A hand is a flattened paddle and a round cone is circular across its
    // axis, so no single cone can be one. Rails run the length of the hand,
    // spread across the palm's width: the rail axis carries length, the spread
    // between them carries breadth, and the radius carries thickness. Three
    // independent numbers, which is what a flattened shape needs.
    //
    // Which local axis carries the breadth is not a free choice, and getting it
    // wrong is invisible until something bears weight on the hand. The rig's
    // wrist `flexion` channel rotates about the bone's local x, so x has to be
    // the axis through the knuckles for flexion to bend the palm towards the
    // forearm. Built the other way round - breadth along z, as this first was -
    // flexion becomes sideways deviation instead, and no combination of joint
    // angles can lay the palm flat: `all_fours` rendered with both hands
    // standing on edge like a chop, thumbs out sideways. The foot uses the same
    // convention, breadth across x, which is what makes ankle flexion plantar-
    // flex rather than waggle.
    //
    // Stacking flattened pills down the hand instead - which is what this was
    // first - renders as a string of visibly separate pads, because
    // consecutive pills only ever meet near a point and the blend has nothing
    // to work with there.
    //
    // There are *three* rails rather than two for a reason worth stating: with
    // two, breadth = separation + 2r while overlap demands separation <= 2r, so
    // breadth can never exceed 4r and a 0.044 H hand is stuck at 0.022 H thick.
    // Pushed to that ceiling the rails meet in a razor-thin lens, and a thin
    // sharply-curved sheet is the one shape dual contouring samples badly - it
    // cost inverted triangles at 20mm and nearly doubled the worst surface
    // error. A middle rail lifts the ceiling to 6r, which buys deep overlaps at
    // the true breadth *and* the true thickness at once.
    const sign = suffix === "l" ? 1 : -1;
    for (const rail of [-1, 0, 1]) {
      cone(
        `hand_${suffix}`,
        group,
        [rail * 0.012, 0.042, 0],
        0.0100,
        [rail * 0.009, -0.040, 0],
        0.0090,
        0.012,
        { soft: true }
      );
    }
    // The thumb leaves the radial side - lateral, so +x on the left, which is
    // the side `sign` already names - low on the palm where its joint is, and
    // angled a little palmar so it opposes the fingers rather than lying in
    // line with them. Palmar is -z: that is what makes the palm face the floor
    // in `all_fours` rather than the ceiling, and since the rest of the hand is
    // symmetric about z the thumb is the only thing that says which side is
    // which.
    cone(
      `hand_${suffix}`,
      group,
      [sign * 0.016, 0.010, -0.004],
      0.0108,
      [sign * 0.026, -0.012, -0.012],
      0.0096,
      0.012,
      { soft: true }
    );
  }

  // --- legs -------------------------------------------------------------
  for (const [suffix, group] of [["l", GROUP.LEG_L], ["r", GROUP.LEG_R]]) {
    // The thigh cone starts at the gluteal fold, not at the hip joint. Run it
    // up to the joint and its widest point lands exactly at hip height, which
    // makes the hips measure as wide as a thigh rather than as wide as a
    // pelvis. Above the fold the gluteal mass and the pelvis carry the
    // silhouette; the cone's spherical cap still fills in behind them.
    limb(
      `hip_${suffix}`,
      group,
      [0, -0.045, 0],
      girthR(0.344, 0.328),
      [0, -0.245, 0.004],
      girthR(0.232, 0.236),
      0.028
    );
    limb(
      `knee_${suffix}`,
      group,
      [0, 0, 0],
      girthR(0.225, 0.228),
      [0, -0.246, 0.010],
      girthR(0.136, 0.129),
      0.022
    );
    // Gastrocnemius. A single taper from knee to ankle has no calf at all, so
    // the leg reads as a peg; this puts the bulge back where it belongs, high
    // on the shank and towards the rear.
    ball(`knee_${suffix}`, group, [0, -0.062, -0.014], girthR(0.175, 0.162), 0.025);
    // --- foot ---
    // What used to be here was one cone from the ankle to z = 0.100: a sausage
    // with no heel behind the leg, no flat sole and no toes.
    //
    // A foot is 0.152 H long, 0.055 H broad and sits on a *flat* sole 0.039 H
    // below the ankle joint - which is exactly `P.ankleHeight`, so getting the
    // sole right is what makes a standing figure stand rather than hover or
    // sink. Every y below is paired with its radius so that `y - r` is -0.039
    // for each piece, which is what makes the sole planar instead of a row of
    // scallops.
    //
    // Foot radii are divided by the girth scale so `cone` multiplies it back
    // out: shoe size does not track body mass, and letting it would tilt the
    // sole, since these y offsets are not scaled to match.
    const flat = (r) => r / g;
    // Malleoli, bridging the shank into the foot.
    ball(`ankle_${suffix}`, group, [0, -0.010, -0.004], flat(0.019), 0.016);
    // Three rails again, heel to toe, for the same reason as the hand: two
    // rails cap breadth at 4r, which at an honest 0.055 H forefoot forces a
    // 0.028 H thickness and leaves the rails meeting in a thin sharply-curved
    // sheet that dual contouring cannot sample. A middle rail lifts the cap to
    // 6r, so the forefoot gets its real breadth and a real thickness together.
    //
    // The outer rails' spread opens from heel to forefoot, which is the whole
    // difference between a heel breadth of 0.038 H and a forefoot of 0.055 H,
    // and the radius shrinks along the way because toes are thinner than a
    // heel.
    //
    // Each end pairs its height with its radius so that `y - r` is -0.039 at
    // both, and a round cone interpolates centre and radius linearly - so
    // `y - r` is that constant the whole length and the sole comes out
    // genuinely planar rather than scalloped. The whole foot sits on `ankle_*`
    // rather than being split at `toe_*`: nothing ever poses the toe joint, it
    // is only an IK tip, and splitting there buys a seam for nothing.
    for (const rail of [-1, 0, 1]) {
      cone(
        `ankle_${suffix}`,
        group,
        [rail * 0.004, -0.024, -0.027],
        flat(0.015),
        [rail * 0.0135, -0.025, 0.095],
        flat(0.014),
        0.018,
        { soft: true }
      );
    }
  }

  // --- anatomy ----------------------------------------------------------
  // Genital geometry, on the pelvis, gated by `anatomy` so a caller that only
  // wants proportions can switch it off. On by default, because this system
  // exists to judge how two bodies fit together and leaving it out moves the
  // contacted surface by a couple of centimetres exactly where the judgement
  // matters. Every piece is `soft`, so the narrowphase gives it the 18mm
  // compression budget rather than the 10mm default.
  //
  // Crotch height is 0.475 H and the pelvis bone sits at 0.530 H, which puts
  // the pubic arch at y = -0.055 in pelvis-local space. Everything here is
  // placed from that line.
  if (anatomy) {
    // Mons pubis, on every body type. It is what carries the front of the
    // pelvis down into the crotch instead of leaving a crease across it.
    //
    // Blends throughout this block are kept to roughly half the radius of the
    // piece they belong to. These are the smallest features on the body, and a
    // `smoothMin` whose k approaches r does not soften a form, it dissolves it
    // - the same mistake that once flattened the bust into pectorals.
    ball("pelvis", GROUP.TORSO, [0, -0.048, 0.044], female ? 0.024 : 0.021, 0.012, {
      soft: true,
    });
    if (male) {
      cone(
        "pelvis",
        GROUP.TORSO,
        [0, -0.058, 0.048],
        0.0130,
        [0, -0.098, 0.054],
        0.0115,
        0.008,
        { soft: true }
      );
      ball("pelvis", GROUP.TORSO, [0, -0.078, 0.034], 0.0190, 0.010, { soft: true });
    } else if (female) {
      cone(
        "pelvis",
        GROUP.TORSO,
        [0, -0.056, 0.034],
        0.0140,
        [0, -0.072, 0.022],
        0.0105,
        0.008,
        { soft: true }
      );
    }
  }

  // Precompute which pairs are authored to overlap, so the narrowphase never
  // reports the body's own construction as a collision.
  for (const volume of volumes) volume.selfIgnore = new Set();
  for (let i = 0; i < volumes.length; i += 1) {
    for (let j = i; j < volumes.length; j += 1) {
      const filler = volumes[i].jointFiller || volumes[j].jointFiller;
      const distance =
        i === j ? 0 : skeleton.boneDistance(volumes[i].bone, volumes[j].bone);
      if (!filler && distance > AUTHORED_OVERLAP_JOINTS) continue;
      volumes[i].selfIgnore.add(volumes[j].id);
      volumes[j].selfIgnore.add(volumes[i].id);
    }
  }

  return volumes;
}

/**
 * Transform bone-local volumes into world space for a given evaluated pose.
 * Returns plain objects with world endpoints, ready for both the SDF and the
 * collision narrowphase.
 */
export function poseVolumes(skeleton, evaluated, volumes, actorId = 0) {
  const out = new Array(volumes.length);
  for (let i = 0; i < volumes.length; i += 1) {
    const volume = volumes[i];
    const m = evaluated.matrices[skeleton.boneIndex(volume.bone)];
    out[i] = {
      id: volume.id,
      actorId,
      bone: volume.bone,
      group: volume.group,
      soft: Boolean(volume.soft),
      blend: volume.blend,
      selfIgnore: volume.selfIgnore,
      ra: volume.ra,
      rb: volume.rb,
      a: transform(m, volume.a),
      b: transform(m, volume.b),
    };
  }
  return out;
}

function transform(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * Exact signed distance to one round cone.
 * Adapted from the standard analytic form: the surface is the convex hull of
 * two spheres, so the closest feature is either a sphere cap or the tangent
 * cone band between them.
 */
export function roundConeDistance(p, volume) {
  const { a, b, ra, rb } = volume;
  const ba = v3sub(b, a);
  const l2 = v3lenSq(ba);
  if (l2 < 1e-12) return v3dist(p, a) - ra;

  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;

  const pa = v3sub(p, a);
  const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const z = y - l2;
  const xx = v3lenSq([pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y]);
  const x2 = xx;
  const y2 = y * y * l2;
  const z2 = z * z * l2;

  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(Math.max(0, x2 + z2)) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(Math.max(0, x2 + y2)) * il2 - ra;
  return (Math.sqrt(Math.max(0, x2 * a2 * il2)) + y * rr) * il2 - ra;
}

/** Polynomial smooth minimum. Returns the blended distance. */
export function smoothMin(d1, d2, k) {
  if (k <= 1e-6) return Math.min(d1, d2);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (d2 - d1)) / k));
  return d2 * (1 - h) + d1 * h - k * h * (1 - h);
}

/**
 * Signed distance to a posed body, as the smooth union of its volumes.
 * `volumes` must already be in world space (see `poseVolumes`).
 */
export function bodyDistance(p, volumes) {
  let d = Infinity;
  for (let i = 0; i < volumes.length; i += 1) {
    const volume = volumes[i];
    const di = roundConeDistance(p, volume);
    d = d === Infinity ? di : smoothMin(d, di, volume.blend);
  }
  return d;
}

/** Central-difference gradient of `bodyDistance`, normalised. */
export function bodyNormal(p, volumes, h = 1e-3) {
  const dx =
    bodyDistance([p[0] + h, p[1], p[2]], volumes) -
    bodyDistance([p[0] - h, p[1], p[2]], volumes);
  const dy =
    bodyDistance([p[0], p[1] + h, p[2]], volumes) -
    bodyDistance([p[0], p[1] - h, p[2]], volumes);
  const dz =
    bodyDistance([p[0], p[1], p[2] + h], volumes) -
    bodyDistance([p[0], p[1], p[2] - h], volumes);
  const length = Math.hypot(dx, dy, dz) || 1;
  return [dx / length, dy / length, dz / length];
}

/** Radius of a round cone at parametric position `t` along its axis. */
export const radiusAt = (volume, t) => volume.ra + (volume.rb - volume.ra) * t;

/**
 * Closest surface point on a round cone to `p`, plus the outward normal.
 * Used by the contact solver to place hands on partners.
 */
export function closestOnVolume(p, volume) {
  const { point, t } = closestPointOnSegment(p, volume.a, volume.b);
  const radius = radiusAt(volume, t);
  const delta = v3sub(p, point);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  const normal = length < 1e-8 ? [0, 1, 0] : v3mul(delta, 1 / length);
  return { point: v3add(point, v3mul(normal, radius)), normal, distance: length - radius, t };
}

/** World-space AABB of a posed volume list, with optional padding. */
export function volumesBounds(volumes, padding = 0) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const volume of volumes) {
    for (const [point, radius] of [
      [volume.a, volume.ra],
      [volume.b, volume.rb],
    ]) {
      for (let i = 0; i < 3; i += 1) {
        if (point[i] - radius - padding < min[i]) min[i] = point[i] - radius - padding;
        if (point[i] + radius + padding > max[i]) max[i] = point[i] + radius + padding;
      }
    }
  }
  return { min, max };
}
