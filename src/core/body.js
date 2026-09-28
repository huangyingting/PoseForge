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

import { closestPointOnSegment, v3add, v3sub, v3mul, v3lenSq, v3normalize } from "./math.js";

/** Collision groups; used for classifying contacts, not for exempting them. */
export const GROUP = {
  TORSO: "torso",
  HEAD: "head",
  ARM_L: "armL",
  ARM_R: "armR",
  LEG_L: "legL",
  LEG_R: "legR",
};

/** Shared by body construction and the drawable-template cache identity. */
export const DEFAULT_BUST = Object.freeze({ female: 1, male: 0, neutral: 0.7 });

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
 * The female crotch plate's own surface along the labial crest line, |x| = 9mm:
 * z forward of the pubis against y below the pelvis, both in millimetres,
 * measured by ray-casting this field down -y in the rest pose.
 *
 * Everything drawn on the plate - both labia, the minora, the hood - is
 * authored as a `burial` against this curve rather than at an absolute height,
 * which is what makes them rise out of the perineum instead of sitting on it.
 * The version before that put its cone axes below the plate's surface, so the
 * pair stood 17mm proud and read as two sausages laid in the crotch.
 *
 * Note that a node's sphere bottoms out at `crest - burial` whatever its
 * radius, so `burial` alone sets how proud a form stands here and the radius
 * only sets how wide it is. Confusing the two is what kept the first cleft
 * shallow; see the call site.
 */
const PLATE_CREST = [
  [0, -92.1], [8, -90.6], [16, -86.7], [24, -82.7], [32, -79.0], [40, -76.2], [48, -71.0],
  [52, -65.6], [56, -59.0], [60, -53.7], [64, -48.6], [68, -43.5],
];

/**
 * Where the pudendal cleft starts and ends, in mm forward of the pubis.
 *
 * The front end runs ten millimetres further forward than the form does, for
 * the reason the clitoral hood does below. A lens tapers to a point, and a
 * point at z = 48 is a point in the open: the scan's mons only closes over the
 * plate from about z = 52, so the anterior commissure was a visible spike
 * pinned to the skin above it with a hard edge all the way round. Rendered
 * with the part tinted, the whole vulva read as a red leaf laid on the crotch
 * rather than as something the body ends in.
 *
 * Carried to z = 58 the taper finishes 4.5mm inside the mons and what shows at
 * z = 48 is the lens at 0.65 of full width - 7.4mm of offset against 5.6mm of
 * radius - which is a labium running up under the mons, not a spike. The
 * posterior end is left alone: the fourchette really does come to a point, and
 * it is the one end of this form where nothing covers it.
 */
const LABIA_FRONT = 58;
const LABIA_BACK = 2;

/** The same for the labia minora, which stop short of both commissures. */
const MINORA_FRONT = 50;
const MINORA_BACK = 6;

/**
 * And for the clitoral hood, which sits over the front of the minora.
 *
 * It runs much further back than it shows. A round cone ends in a hemisphere,
 * so wherever this chain stops it stops with a little dome, and stopping it at
 * the point where it had finished tapering put a 19.6 degree step across the
 * midline - worse than the blunt version it replaced. Carrying the thin end on
 * to z = 27, well inside the minora's waist, buries that dome 0.9mm under them.
 */
const HOOD_FRONT = 55;
const HOOD_BACK = 33;

/**
 * Segments per labium, and per labium minus.
 *
 * Far more than the shape needs, because what the eye picks up here is not the
 * silhouette but the crease at every join. A chain of round cones is only C1
 * where consecutive segments happen to agree, and at eight segments the two
 * labia rendered as a ladder of transverse rungs down the cleft - 6.7 degrees
 * of surface tilt change over half a millimetre, which is nothing on a plot and
 * unmistakable under a light. The angle at a join falls off roughly as the
 * square of the segment count, so this is the cheapest fix available: the
 * volumes are all on `pelvis` and all mutually `selfIgnore`, so they cost a
 * broadphase box each and nothing in the narrowphase.
 */
const LABIA_NODES = 22;
const MINORA_NODES = 18;

/** Segments in the clitoral hood, which is shorter than either of them. */
const HOOD_NODES = 10;

/** Segments per half of the scrotum, for the same reason. */
const SCROTUM_NODES = 14;

/**
 * `PLATE_CREST`, interpolated and clamped to its ends.
 *
 * Monotone cubic (Fritsch-Carlson), not linear, and the difference is visible
 * rather than academic. Both labial chains place every node against this curve,
 * so a kink in it is a kink in them: the samples are 8mm apart and the linear
 * version's slope jumped from 0.19 to 0.49 at z = 8 and from 0.35 to 0.65 at
 * z = 40, which came out as a pair of hard transverse ridges right across the
 * vulva - measured at 3.6 degrees of surface tilt change over half a millimetre
 * at z = 7. Hermite tangents remove those without moving any sampled point, and
 * the Fritsch-Carlson limiter is what keeps the curve from overshooting between
 * them, which on a surface this shallow would read as a dent.
 */
function plateCrest(z) {
  const n = PLATE_CREST.length;
  if (z <= PLATE_CREST[0][0]) return PLATE_CREST[0][1];
  if (z >= PLATE_CREST[n - 1][0]) return PLATE_CREST[n - 1][1];
  const slope = [];
  for (let i = 0; i + 1 < n; i += 1) {
    slope.push((PLATE_CREST[i + 1][1] - PLATE_CREST[i][1]) / (PLATE_CREST[i + 1][0] - PLATE_CREST[i][0]));
  }
  const tangent = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0) tangent.push(slope[0]);
    else if (i === n - 1) tangent.push(slope[n - 2]);
    else if (slope[i - 1] * slope[i] <= 0) tangent.push(0);
    else tangent.push((slope[i - 1] + slope[i]) / 2);
  }
  for (let i = 0; i + 1 < n; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = Math.hypot(a, b);
    if (s > 3) {
      tangent[i] = (3 / s) * a * slope[i];
      tangent[i + 1] = (3 / s) * b * slope[i];
    }
  }
  for (let i = 1; i < n; i += 1) {
    const [z0, y0] = PLATE_CREST[i - 1];
    const [z1, y1] = PLATE_CREST[i];
    if (z > z1) continue;
    const h = z1 - z0;
    const t = (z - z0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * tangent[i - 1] +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * tangent[i]
    );
  }
  return PLATE_CREST[n - 1][1];
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
  // A man gets no bust at all. 0.55 of the female shape is not a pectoral, it
  // is a small breast, and that is what it looked like: the male figures were
  // drawn with the same round mound the women had, only lower-contrast. The
  // scanned male model already carries its own pectoral - a wide, flat plane of
  // muscle with the nipple near its lower outer corner - and that shape is
  // frame, not secondary-sex geometry, so the right amount for this file to add
  // on top of it is none. Neutral keeps a trace, because the neutral figure is
  // drawn with the female mesh and a bare chest on it reads as male.
  const bustScale = bust ?? DEFAULT_BUST[skeleton.chestType] ?? DEFAULT_BUST.neutral;

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
    // A breast is a teardrop, and a sphere cannot be one.
    //
    // What was here was a single ball per side, and it read as exactly that:
    // two balls stuck high on the chest, perfectly round in profile, meeting in
    // the middle. A round cone - two spheres and their tangent hull - has a
    // *straight* silhouette between its ends, so a small sphere high against
    // the ribs, a large one low and forward, and the hull between them gives
    // the upper slope while the large sphere alone gives the full lower pole.
    // That is the teardrop, and it is why the primitives are what they are.
    //
    // Every number below is measured off the scanned female body rather than
    // reasoned from a table, because the field is not the only thing that draws
    // a bust here: `featureRelief` pushes the scan's own chest out onto this
    // shape, and the scan already has breasts. Authoring against anthropometry
    // and ignoring what the mesh underneath was already doing is what produced
    // the version before this one, and it failed in three measurable ways:
    //
    //   - **It inflated a breast that existed.** The scan's apex is at z=128mm
    //     and this field's was at z=168mm, so every vertex on the chest got a
    //     40mm push - mean displacement 28mm, worst 68mm, against a 15mm mean
    //     edge. 3.2% of the chest triangles came out backfacing.
    //
    //   - **It lost the cleavage and the fold.** At that size the two masses
    //     drove the sternum forward 25mm and the underbust 45mm, so the whole
    //     region from the fold to the collarbone flattened into one shelf of
    //     flesh 100mm wide. A breast is defined by the two lines it is *not*
    //     continuous across, and both of them went.
    //
    //   - **It moved the nipple off the painted one.** The atlas has an areola
    //     on it. Sampling `skin-female.png` through the model's own UVs puts
    //     its centre at world (±104.5, 1215.5, 128.5)mm; the field's apex was
    //     at (±93, 1190, 168.5). The 28mm between them is two nipples on one
    //     breast in every textured render - a painted one on the upper outer
    //     slope and a modelled one near the pole.
    //
    // So the mass is fitted to the scan, not to a cup size. Apex on the painted
    // areola's own axis, front face 20mm proud of the scan surface there, and
    // the ball tangent enough to the chest wall at the bottom that the
    // inframammary fold at y=1170mm survives with a 17mm push rather than a
    // 45mm one. Displacement then comes out at a 20mm worst rather than 68mm,
    // which is inside what the refined ~5mm edges can carry without folding.
    //
    // One set of numbers for every body type that has a bust at all: a man gets
    // `bustScale` 0 and never reaches this block, and `bustScale` alone
    // separates the other two. The neutral figure was once drawn with the
    // female mesh, which is why the numbers are the female's; it has its own
    // now, and every other scan with a bust, made with MakeHuman's
    // breast-position modifiers set to put its painted areola here instead
    // (scripts/models/bodies.json; `validate-skin` measures it).
    const lift = 0.02711 * bustScale;

    // How far the bust yields in a collision, in metres, overriding the 18mm
    // every soft volume otherwise gets. A breast is not a calf: it is the most
    // compressible tissue on the body and flattens to a fraction of its depth
    // under a chest lying on it. The mass modelled here is 80mm across, so 30mm
    // is well inside what the tissue gives - and without it, simply having a
    // bust at all cost two corpus scenes their soundness, reported as
    // penetration in embraces that photograph perfectly fine. Absolute rather
    // than a fraction of stature, because the table it overrides is absolute.
    const give = { compression: 0.030 * bustScale };

    for (const side of [-1, 1]) {
      // Upper root on the chest wall at y=1272mm and 20mm across, main mass
      // centred at (±100.5, 1207, 102)mm with a 45mm radius: medial edge 55mm
      // off the midline so the sternum is never touched, lateral edge 145mm
      // which is past the side of the chest and so covers nothing, bottom at
      // 1162mm which is the fold.
      //
      // The root was 13mm first and the breast came out a cone: the hull
      // between a 13mm sphere and a 45mm one is a long straight taper, so the
      // upper pole ran dead flat from the collarbone to a point at the nipple.
      // A real upper pole is slightly full - it is the part a bra has to make
      // room for - and 20mm is what puts 10mm of it back without rounding the
      // slope into the sphere the whole shape is trying not to be.
      cone(
        "spine03",
        GROUP.TORSO,
        [side * 0.05301, 0.02628, 0.05422],
        0.01205 * bustScale,
        [side * 0.06054, -0.01288, 0.06145],
        lift,
        // Blend at a quarter of the radius. The old note here is still the
        // point - a smooth union whose k approaches r dissolves the form rather
        // than softening it, which is how this became pectorals once already -
        // but a teardrop needs a tighter join than a ball did, because the
        // shape it must not lose is the fold underneath.
        0.006,
        { feature: true, soft: true, ...give }
      );

      // Medial-inferior extension of the same mass, from a 27mm ball at
      // (±55, 1195, 88)mm into the mass centre at the mass's own radius, so the
      // two are one shape and not a union of two.
      //
      // Without it the mass stands alone with its medial edge 55mm off the
      // midline, which leaves a 110mm gap between the breasts. Pooled
      // measurements put the intermammary distance of a B cup at 50-70mm, and
      // 110mm does not read as a woman's chest at all - it reads as two balls
      // set on the sides of a flat sternum, which is what every earlier front
      // render shows.
      //
      // Worse than the width was what the step did to the drawn surface. At the
      // height of the pole the field is 13.5mm proud at x=72mm and 2.5mm proud
      // at x=45mm - and the 2.5mm is not shape, it is exactly the k/4 the 6mm
      // blend can reach. So the whole medial fall happened inside one blend
      // width, and `featureRelief` had to resolve a 11mm change of thickness
      // across 27mm of chest into a fold. It came out as a hooked crease with a
      // pit at the bottom of it, which was hunted in the mesher twice before it
      // was found here.
      //
      // This reaches the medial edge to 28mm, and it reaches it as a taper
      // rather than a wall. Both ends stay behind the mass in z - 116mm against
      // the mass's 147mm - so nothing here adds protrusion; and the medial end
      // sits 8mm *above* the bottom of the mass, because a real inframammary
      // fold is lowest near the mid-clavicular line and climbs as it runs in.
      // That is also what keeps the upper cleavage open: the extension is a
      // lower-pole shape, and above y=1220mm there is nothing of it left.
      cone(
        "spine03",
        GROUP.TORSO,
        [side * 0.03313, -0.02012, 0.05301],
        0.01627 * bustScale,
        [side * 0.06054, -0.01288, 0.06145],
        lift,
        0.006,
        { feature: true, soft: true, ...give }
      );

      // Nipple and areola, as a stub tapering off the front of the mass, on the
      // axis of the *painted* areola rather than the axis of the mass - 4mm
      // lateral of the pole, which is also where a nipple actually sits.
      //
      // A single small ball was tried first and produced nothing at all: sunk
      // to where it belongs it protrudes about 5mm, and a `smoothMin` at the
      // blend the mass uses (0.004 H, 6.6mm) erases a 5mm bump completely. The
      // rule the rest of this block already states - k well under r - bites
      // hardest on the smallest feature on the body.
      //
      // So: two radii, not one. The wide end sits almost flush and is the
      // areola, about 36mm across; the narrow end is the nipple, standing proud
      // of it. The taper between them is what a round cone gives for free.
      // Blended at 2.5mm, which is under half the nipple's own radius.
      //
      // The protrusion is 5.8mm over a base 17mm across and not the 9.9mm it
      // was first given, and the reason is a limit on the *drawing*, not on the
      // anatomy. `featureRelief` carries this shape onto the scanned mesh by
      // moving each vertex along its own normal, and a displacement folds the
      // surface over exactly when its gradient exceeds one. At 9.9mm over an
      // 8.6mm base radius the gradient was 1.2, and it folded: the drawn nipple
      // came out as a 40mm hook with the surface wrapped twice round it, while
      // the field it was made from rendered correctly - which is why this was
      // hunted in the mesher for a long time before being found here. 5.8mm
      // over 8.5mm is 0.68, with room left for the curvature of the mass
      // underneath. It is also the right number: a relaxed nipple stands 4-6mm.
      const apex = 0.06145 + lift;
      cone(
        "spine03",
        GROUP.TORSO,
        [side * 0.06295, -0.00776, apex - 0.0095],
        0.011 * Math.max(0.7, bustScale),
        [side * 0.06295, -0.00776, apex - 0.0020],
        0.0055 * Math.max(0.7, bustScale),
        0.0015,
        { feature: true, soft: true, ...give }
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
    // genuinely planar rather than scalloped.
    //
    // The foot is split at the ball, across the two bones that carry it: heel
    // and arch on `ankle_*`, toes on `toe_*`. It was one rigid piece on
    // `ankle_*` for as long as nothing posed the toe joint. Postures pose it
    // now - a kneeling figure's toes are tucked or flat, a standing one's are
    // not - so an unsplit foot would hold the collider flat while the drawn
    // toes bent straight through it.
    //
    // `toe_*` sits 0.0355 H below the ankle and the sole is at -0.039 H, so in
    // toe-local space the sole is only 0.0035 H down, and the forefoot rails
    // below sit *above* their own joint. That is not a mistake: the scan's
    // ball bone is at the sole rather than in the middle of the forefoot, and
    // ours has to land where theirs does or the toes are skinned to the wrong
    // place.
    const heelR = 0.015;
    const ballR = 0.0142;
    const tipR = 0.014;
    for (const rail of [-1, 0, 1]) {
      cone(
        `ankle_${suffix}`,
        group,
        [rail * 0.004, -0.024, -0.027],
        flat(heelR),
        [rail * 0.0114, ballR - 0.039, 0.068],
        flat(ballR),
        0.018,
        { soft: true }
      );
      cone(
        `toe_${suffix}`,
        group,
        [rail * 0.0114, ballR - 0.0035, 0],
        flat(ballR),
        [rail * 0.0135, tipR - 0.0035, 0.027],
        flat(tipR),
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
    // Blends throughout this block are kept to roughly a quarter of the radius
    // of the piece they belong to, and not the half they were first given. These
    // are the smallest features on the body, and a `smoothMin` whose k
    // approaches r does not soften a form, it dissolves it - the same mistake
    // that once flattened the bust into pectorals. At k/r = 0.57, which is what
    // the first version of this block used throughout, shaft and scrotum came
    // out as one smooth mass with no join between them and no glans on the end
    // of it: a single blob hanging off the groin, which is exactly what it
    // rendered as.
    //
    // The mons is deliberately *not* a `feature`, which is the flag that says
    // "draw this onto the scanned mesh as well". The scan already has a pubic
    // mound; the field's is a collider convenience sized to keep the crotch a
    // solid rather than a fork, and it stands about 20mm proud of the drawn
    // skin. Drawing it added that 20mm a second time, and worse: it is far the
    // largest volume on the pelvis, so it owned the seed and 70 of the 78 drawn
    // vertices the crotch cluster touched, and the genitals were built as
    // detail on a ball instead of as themselves.
    ball("pelvis", GROUP.TORSO, [0, -0.048, 0.044], female ? 0.026 : 0.023, 0.012, {
      soft: true,
    });
    //
    // Everything below is drawn where it is authored - `anatomyPart` tessellates
    // the field and does not move it onto the skin afterwards - so every number
    // in it is stated against the *drawn* body. Specifically against the drawn
    // body in the *rest pose*, which is not the same surface as the bind
    // template: `bindCorrections` and the skeleton's own rest pose rotate the
    // pelvis, and at the crotch that moves the skin by 40mm. Measuring the
    // template instead put the whole female vulva 20mm in front of the skin,
    // where the anterior commissure rendered as a bare ball stuck on the groin.
    // `skinHumanMesh(template, skeleton, evaluated)` is the surface to measure,
    // and it is the same one `featureRelief` evaluates the field against.
    //
    // Read off that surface at the midline, as a contour running down the front
    // of the pubis and back across the crotch floor:
    //
    //   female  (0.869, 0.099) (0.841, 0.085) (0.821, 0.071) (0.803, 0.050)
    //           (0.785, 0.031) (0.779, 0.003) (0.780, -0.009) (0.796, -0.020)
    //   male    (0.911, 0.113) (0.888, 0.103) (0.867, 0.088) (0.853, 0.068)
    //           (0.847, 0.044) (0.846, 0.019) (0.851, -0.002) (0.858, -0.021)
    //
    // Both turn a corner - female at about (0.783, 0.020), male at (0.851,
    // 0.065) - from a face sloping down and forward at 45 degrees onto a floor
    // facing straight down. Everything here is placed by arc length along that
    // contour and a depth under it, which is the only way to state "8mm proud
    // of the skin" for a surface that changes direction halfway along. A sphere
    // of radius r centred at depth d stands r - d proud and reaches r + d in,
    // so d is what fixes whether a piece is anatomy or an ornament resting on
    // the body; the first version of this block had no notion of it at all.
    if (male) {
      // The mons pubis. Sized and placed differently from the female's, because
      // the constraint here is not the scan but the field.
      //
      // Relief measures how much thicker the *field* is because of a feature and
      // applies that to the scan, so it only bites where the dome is the volume
      // the distance field answers with. Over the female pubis that is easy: her
      // drawn surface is at z = 99..101mm at y = 870 and the field without the
      // dome is at 101..102, so anything proud of one is proud of the other. On
      // this body they are 10..17mm apart - the hip capsule, 110.5mm of radius
      // at (+-47, 881, 4), reaches z = 114 where the drawn skin is at 97..104 -
      // and the first dome tried here was the female's scaled over, 46mm of
      // radius centred 46mm back at (0, 913, 72). It moved the skin 1.6mm. Both
      // terms of the measurement read ~0 on it: the ray leaves the hip capsule
      // long before it reaches the dome, and the perpendicular thickness is
      // capped at a quarter of the blend because the dome never becomes the
      // deeper volume.
      //
      // So: small and close instead of broad and deep. 35mm of radius centred at
      // (0, 900, 95) puts the scan's own pubic vertices 21mm inside the dome
      // against 10mm inside the hip capsule, which is the margin the pass reads.
      // The axis runs x = -12..12mm for width, as the female's does.
      //
      // Less proud than hers - the male fat pad over the symphysis is the
      // thinner one - and it has to be, because the shaft root is the most
      // forward thing in this region and a mound that buries it is a mound that
      // removes the penopubic angle.
      //
      // Relief, not a part: it displaces the scan, so it unions with the abdomen
      // with no crossing curve, and it does not swing with the package the way
      // everything in the part submesh does. That needed the feature clusters in
      // `featureRelief` split by kind as well as by bone - every other volume on
      // this bone is a part, and the whole cluster went the part way.
      cone(
        "pelvis",
        GROUP.TORSO,
        [-0.00674, -0.02416, 0.05337],
        0.01966,
        [0.00674, -0.02416, 0.05337],
        0.01966,
        0.008,
        { soft: true, feature: true }
      );

      // Nothing below this reaches the skin, and it is worth saying why so the
      // obvious repair is not tried again. Beside the shaft's root the scan
      // falls off a cliff: casting -z rays at the drawn body, the skin at
      // x = 20mm drops from z = 87.5 at y = 870 to 78.1 at y = 865, 9.4mm of
      // recess in 5mm of height, so the root emerges from the floor of a trench
      // and front on it reads as a tube through a wall. A 18mm capsule on an
      // axis from (-16, 868, 70) to (16, 868, 70) is exactly the shape that
      // fills the trench and touches nothing else - and it moved the skin 0.0mm.
      //
      // The field and the scan have parted company by then. At y = 860..870 the
      // field's front surface on the midline is at z = 119..123, because the hip
      // and pelvis capsules are still the nearest volume there, while the scan
      // is at 78..92. Relief measures the field, so a volume has to be proud of
      // 120mm to register - 40mm in front of the skin it is meant to lift, and
      // 30mm in front of the shaft. There is no such volume that is also the
      // shape of a penopubic pad. Above y = 880 the two surfaces are within
      // 10mm of each other and the mound works; below it, relief is the wrong
      // instrument and the crossing curve stands.


      // Flaccid, hanging forward over the scrotum, in three pieces.
      //
      // Sized from measurement rather than by eye, because by eye is how the
      // first version got a shaft 55mm thick. Flaccid length is about 90mm and
      // flaccid girth about 95mm, so the shaft is a 30mm cylinder - radius
      // 0.0084 H - and the earlier 0.0155 H was very nearly twice that in every
      // direction. A form that wide cannot hang clear of the thighs, and it did
      // not: it merged with them.
      //
      // The glans is a ball slightly wider than the shaft it caps, and the step
      // that leaves where the two meet is the corona. It is the one piece of
      // detail that makes the shape read as anatomy rather than as a peg, and it
      // costs one volume - but only if the step survives the blend. It did not
      // at first: the shaft ran out at 14.2mm of radius into a 15.8mm ball on a
      // 2.8mm blend, a 1.6mm step with 0.7mm of fill in it, and front on the tip
      // read as a plain rounded end. Tapering the shaft to 13mm and holding the
      // ball at 15.5 on a 1.8mm blend leaves 2.1mm of corona, which shows. The
      // distal shaft is 26mm across where it was 28, which is if anything nearer
      // the measurement.
      //
      // The root sits inside the pubic arch at y = 0.869, z = 0.067, 10mm up
      // the axis from the arch itself, where the front face of the mound turns
      // under. Radius 15.3mm there leaves it wholly buried and the cone emerges
      // through the skin about 15mm lower down, so the shaft grows out of the
      // pubis rather than being planted on it - the whole 0.880 and 0.870 bands
      // of the drawn part are inside the body and should be. Placed by eye
      // instead it sat at y = 0.8615 - below a floor at 0.847 - and the whole
      // package floated in open air under the body, touching nothing. The
      // emergence is still a crisp curve where the part's surface crosses the
      // skin's, because a part does not union with the body; that curve is the
      // penopubic angle, which is a crisp fold on a real body too, and it is as
      // close as this architecture gets.
      //
      // From there it hangs, and hanging is not a contour problem: the axis is
      // (0, -1, 0.516) normalised, 27.6 degrees down and forward, which is where
      // a flaccid shaft lies when it is draped over the sac. Note that
      // `gravityHang` reads this cone's `a` as its pivot and takes its lean from
      // `a` to `b`, so the root may be slid along the axis but not off it. The
      // glans caps it 7mm further on.
      //
      // Forward matters more than it looks, and the scan is why. Mapping the
      // minimum |x| of the drawn skin over the (y, z) plane below the crotch
      // shows the inner thighs in contact - within 6mm of the midline - for
      // every z behind 0.075, from the floor at y = 0.847 all the way down to
      // mid-thigh. In front of that line they open into a wedge: 26mm of half
      // gap at z = 0.09, 55mm at z = 0.11. So there is exactly one place under
      // this body where genitals can be, and it is in front of the thigh
      // contact, which is also where they are on a standing man with his legs
      // together. Hung straight down, or at the (0, -1, 0.22) this first had,
      // the shaft descends into the contact and all but a sliver of it - and
      // the whole scrotum - is inside the thighs.
      //
      // How far forward is now measured rather than reasoned about. Casting a
      // ray along +x from the midline and counting crossings of the drawn mesh
      // gives the half-width of the slot between the thighs directly, and below
      // the crotch floor it is far tighter than the earlier estimate from
      // nearest scan vertices - that estimate reported the far thigh, 140mm out,
      // for every cell the inner thigh surface happened to miss. Measured, at
      // world y 810..850 the half gap is 2mm at z = 0.060, 11mm at 0.075, 28mm
      // at 0.090 and 47mm at 0.105. So the only room under this body is forward
      // of z = 0.085, and everything here is placed against that.
      cone(
        "pelvis",
        GROUP.TORSO,
        [0, -0.04188, 0.04011],
        0.00860,
        [0, -0.08539, 0.07079],
        0.00730,
        0.00197,
        { soft: true, feature: true, part: true, hang: true, hangRoot: true }
      );

      // The root flare, which is the only instrument left for the crossing
      // curve. See the note under the mons: relief cannot reach down here,
      // because at y = 860..870 the field's front surface is at z = 119..123
      // while the scan is at 78..92, so nothing that lifts the skin beside the
      // root can ever be the deeper volume. The part, though, draws its own
      // surface, and how that surface *meets* the skin is still free.
      //
      // A cylinder crossing a plane at a steep angle leaves a rim; the same
      // cylinder crossing it obliquely leaves a fold. So the shaft is given a
      // ball at its base a little wider than itself - 18.7mm against 15.3 - and
      // the tessellated surface widens into the body instead of running into it
      // square. Centred exactly on the shaft's `a`, which is the pivot
      // `gravityHang` swings the package about, so the flare rotates in place
      // and cannot open a gap at the root however far the shaft leans.
      //
      // 18.7mm and not more. Its front face reaches z = 90.1 against 92.4 of
      // skin on the midline, so it stays buried there; at |x| = 15 it reaches
      // 82.5 against 78..87, which is the trench, and that is as far as it can
      // be taken before the flare itself breaks the surface and trades one rim
      // for a wider one.
      ball("pelvis", GROUP.TORSO, [0, -0.04188, 0.04011], 0.01050, 0.00300, {
        soft: true,
        feature: true,
        part: true,
        hang: true,
      });
      ball("pelvis", GROUP.TORSO, [0, -0.08865, 0.07309], 0.00871, 0.00101, {
        soft: true,
        feature: true,
        part: true,
        hang: true,
      });

      // Scrotum: two testes in one sac, set behind the shaft's root and hanging
      // to about the shaft's midpoint. Drawn as two pieces rather than one so
      // the shallow groove between them survives - that is the median raphe,
      // and it is the difference between a sac and an egg.
      //
      // Capsules, not balls. A testis is about 45mm long and 25mm across, and
      // a ball big enough to hang the 35mm a scrotum hangs is also 48mm wide;
      // the pair of them came to 78mm across, wider than the gap between the
      // thighs they are supposed to sit in.
      //
      // Pear-shaped, and sampled rather than authored as one capsule a side,
      // which is the second thing the measurement settled. A uniform capsule is
      // as wide at its neck as at its belly, so the sac's top half stood out
      // level with the shaft's root and either side of it: front on, two lobes
      // flanking the penis where there should be a neck tucked under the pubis
      // with the penis in front of it. The neck here is a 14mm stalk, the belly
      // is 51mm across, and the bottom is a 30mm rounded end - and because the
      // radius is sampled off a smooth curve instead of stepped between two
      // cones, none of the joins kink.
      //
      // The bulge is `sin(pi t^1.2)` under a root rather than `sin(pi t)`, which
      // is a small change with a point to it: the exponent slides the widest
      // section from halfway down to 56% down, and a scrotum is widest below its
      // middle. The linear terms then carry the taper, and they run the other
      // way from the version before this one, which grew its radius with t all
      // the way to the bottom and so finished wider than it started - a sac with
      // no underside.
      //
      // Hung at z = 0.076 rising to 0.088, behind the shaft rather than around
      // it. This is the correction that matters and it is worth stating what
      // was wrong, because the numbers looked reasonable. The sac was at z =
      // 0.080..0.092, chosen so its widest section had 27mm of half width
      // against 27mm of half gap between the thighs - which it did. But the
      // shaft passes through that same band, and at the sac's belly, y = 0.834,
      // the shaft's axis was at z = 0.0859 against the sac's 0.0860. They were
      // coplanar. The shaft's front face stood 0.6mm proud of the sac's, so
      // front on the two merged into a single 52mm dome with a stub hanging out
      // of the bottom of it - a mushroom, which is exactly what the render
      // showed. (The old comment here claimed a 9mm step; it was measuring the
      // sac's front at its own lobe axes and the shaft's at the midline, which
      // are not the same ray.)
      //
      // Moving the sac back and down fixes it without moving the shaft forward,
      // which is the alternative and a much worse one: clearing 14mm of shaft
      // radius plus 14mm of sac would have put the shaft at z = 0.120 at
      // mid-drop, 50mm proud of the pubic arch, which is not hanging but
      // pointing. Measured down the midline ray on the finished field, the
      // shaft's front face now leads the sac's by 15.4 to 17.8mm the whole way
      // down the sac, which reads as a shaft draped over a sac. 10mm of that
      // came out of the first attempt at this and was then given back: at z =
      // 0.070 the separation was 12.6mm and unmistakable, but the thigh gap is
      // only 11mm of half width there against the sac's 25mm, so the sac was
      // swallowed and the render showed a bare shaft with two slivers beside
      // it. 0.076 is where both readings hold.
      //
      // The remaining cost is exposure, and it is real but bounded. Ray-cast
      // against the drawn mesh, 40% of the part is inside the body - the shaft's
      // root, which should be, plus roughly the back half of the sac in the
      // bands from y = 0.860 down to y = 0.800. The back half of a scrotum is
      // between the thighs on a standing man too. What is lost is the outline of
      // the sac's widest point against the background, which he does not show
      // either.
      //
      // It reaches down to y = 0.797, 72mm below the root, with the glans 12mm
      // below that: at the 24mm drop it had first, the sac was two bumps crowded
      // against the pubis with the whole shaft hanging clear below it, which is
      // a shape no body has. Six millimetres of that drop are the last thing
      // tuned here - at y = 0.843 the sac's widest section sat level with the
      // shaft's emergence and read as a collar around it rather than as
      // something hanging behind it. The two halves overlap by 6.8mm at the
      // belly and the blend is a fifth of the radius, so what survives between
      // them is a 2.5mm groove - the median raphe, and the difference between a
      // sac and an egg. It was 5.7mm at the first attempt at the wider sac
      // below, and that is too much: front on the shaft hides the midline
      // anyway, and from underneath a 5.7mm notch between two spheres of equal
      // radius reads as two balls rather than as one sac with a seam.
      //
      // The neck is broad, and the version before this one narrowed it to a
      // 14mm stalk for a reason that stopped applying. That reason was that a
      // uniform capsule stands level with the shaft's root and flanks it, and
      // it was measured when the sac sat at z = 0.076 and the root at z = 0.067
      // - 9mm apart, so anything wide at the top came through beside the penis.
      // Both have since moved forward and the root now leads the sac's neck by
      // 21mm, so the neck can be as wide as a real one without flanking
      // anything. It has to be: at a 7mm half-width the sac's top was a point
      // in the middle of a 29mm gap between the thighs, and what the render
      // showed at the crotch was not a scrotum but a dark slot with a stalk in
      // it. At 16mm it fills the top of that gap, and the pit goes.
      //
      // Measured on the finished field: neck 30mm across at y = 0.847, which is
      // the scan's own crotch floor; belly 51mm at y = 0.815, against a
      // population scrotal width of 50-60mm; bottom 37mm. The shaft's front
      // face leads the sac's by 16.7mm down the midline, so it still reads as
      // draped over rather than sunk into. Ray-cast against the drawn mesh,
      // 17% of the part is now inside the body where it was 40%.
      //
      // How far *down* it hangs is the last thing settled here, and it was
      // settled by rendering the part on its own - `skinHumanMesh`'s
      // `pelvis-anatomy` submesh with nothing else in the frame, once with
      // these cones and once without them. On the whole body the sac is behind
      // a shaft and between two thighs and it is genuinely hard to tell which
      // silhouette belongs to what; alone, it took one picture.
      //
      // What that picture showed was a sac whose top was level with the
      // shaft's root and whose outline, from the front, swallowed the shaft
      // whole - a lumpy column with a glans on the bottom of it, no penis
      // visible in front of it at all. The cause is a lead, not a size. Down
      // the midline of the old numbers the shaft's front face stood only 9mm
      // proud of the sac's at the belly, against a shaft radius of 13, so the
      // shaft's whole cross-section lay inside the sac's silhouette and the
      // only thing separating them was a shading ridge over a 3mm blend.
      //
      // The lead comes back by dropping the sac rather than by pushing it
      // backwards, which is the repair that suggests itself and the wrong one:
      // the thigh gap is 11mm of half width at z = 75 against the sac's 25, so
      // anything moved back is swallowed, and that failure is already recorded
      // above. Dropping it works because the shaft leans forward as it
      // descends - 27.6 degrees of it - so every millimetre the sac's belly
      // falls is half a millimetre of z the shaft has gained over it. At
      // -102 - 54t the belly sits at y = -132 where the shaft's axis has
      // reached z = 111, and the front faces are 15mm apart: the shaft's back
      // is then in front of the sac's own axis, which is what "draped over"
      // means geometrically.
      //
      // It also puts the bottom of the sac level with the glans instead of
      // 10mm above it. On a standing man the testes hang to about the tip of a
      // flaccid penis; the old sac stopped short and read as two lumps pinned
      // under the pubis with the penis dangling out from between them.
      for (const side of [-1, 1]) {
        let previous = null;
        for (let i = 0; i <= SCROTUM_NODES; i += 1) {
          const t = i / SCROTUM_NODES;
          const bulge = Math.sin(Math.PI * t ** 1.2) ** 0.5;
          const radius = 10 + 2 * t + 5 * bulge;
          const node = {
            p: [
              (side * (5 + 1.5 * t + 3.5 * bulge)) / 1000 / H,
              (-102 - 54 * t) / 1000 / H,
              (85 + 15 * t) / 1000 / H,
            ],
            r: radius / 1000 / H,
          };
          if (previous) {
            cone("pelvis", GROUP.TORSO, previous.p, previous.r, node.p, node.r, 0.00112, {
              soft: true,
              feature: true,
              part: true,
              hang: true,
            });
          }
          previous = node;
        }
      }
    } else if (female) {
      // The vulva: a perineal plate carrying two labia majora and the cleft
      // between them.
      //
      // The plate first, because every version before this one left it out and
      // every one of them failed the same way. They were a lobe on a stalk -
      // invisible in the rest pose, where the thighs close over it, and a
      // detached tube the moment a pose opened the legs. The reason is that the
      // drawn crotch is a *tunnel*: only 33 scanned vertices lie in the whole
      // feature region, and a ray straight up from below hits nothing at all
      // between the thighs at |x| > 12mm. `anatomyPart` builds a closed surface
      // and sets it in that tunnel without unioning with the body, so with the
      // legs apart there was no skin behind the lobe and its far side and the
      // background were both in shot.
      //
      // So the part has to bring its own floor. Two cones run the pubic arch,
      // buried by about their own radius so the surface sits on the skin rather
      // than under or through it, and 48mm wide so the edges finish inside the
      // thighs instead of in the air between them. Opened up, what shows is a
      // continuous sheet of flesh with a cleft in it.
      //
      // The radius is measured, not chosen. Ray-casting the scan's own crotch
      // gives a floor that rises 9mm from the midline to |x| = 15mm, and a
      // circular section matching that curvature has r = 17mm - but 17mm is
      // only 34mm wide and leaves air out to the thigh at 25mm. 24mm is the
      // compromise: 3.7mm proud at |x| = 15, flush at 20, edge at 24. A few mm
      // of labial fullness across the crotch is right anyway; a gap is not.
      //
      // Interpenetrating the thigh is deliberate and free - `selfIgnore` covers
      // pelvis-to-thigh, so the narrowphase never reports it, and the drawn
      // thigh simply buries the plate's edge.
      //
      // The back cone is flat, because the scan's crotch floor is: y = 785mm
      // from z = 0 to z = 32mm. The front one ramps up under the mons at the
      // slope the scan has there, 27mm of rise over 26mm of run, which puts its
      // surface within 2mm of the drawn skin the whole way to z = 58mm.
      for (const [a, ra, b, rb] of [
        [[0, -0.04205, 0], 0.01446, [0, -0.03482, 0.02048], 0.01205],
        [[0, -0.03482, 0.02048], 0.01205, [0, -0.02096, 0.03494], 0.00964],
      ]) {
        cone("pelvis", GROUP.TORSO, a, ra, b, rb, 0.00301, {
          soft: true,
          feature: true,
          part: true,
        });
      }

      // The mons pubis, which the scan does not have at all.
      //
      // Ray-cast down the front of this body, the pubic region is a plain ramp:
      // z = 105mm at y = 900 falling to 47mm at y = 800, a constant 0.58 of
      // slope, and flat across x out to |x| = 40. There is no mound on it. That
      // ramp is why every version of the vulva below read as an island - the
      // labia have to emerge from *something*, and what they were emerging from
      // was a featureless slope with a tunnel under it.
      //
      // A capsule rather than a ball, because a ball big enough to be 70mm wide
      // is also 70mm tall and a mons is wider than it is tall. The axis runs
      // x = -15..15mm and the radius does the rest: 43.5mm is the sphere through
      // a cap 60mm across and 12mm proud, which is (a^2 + h^2) / 2h.
      //
      // Placed by putting the peak 12mm out along the scan's own surface normal
      // at (0, 849, 90) - the normal is (0, -0.502, 0.865), the ramp's - and
      // then backing off one radius along it. Tangent placement is the mistake
      // to avoid here and it is an easy one to make: offsetting the *surface
      // point* by a radius gives a sphere that touches the skin and adds
      // nothing.
      //
      // This is relief and not a part, which is the whole reason it works. Part
      // geometry is tessellated on its own and never unions with the scan, so
      // the first version of this - the same capsule with `part: true` - crossed
      // the skin on a hard curve and rendered as an egg laid on the pelvis, rim
      // all round and a cavity showing under it. Relief displaces the scan
      // itself, so there is no crossing curve to see. It needed the feature
      // clusters in `featureRelief` to be split by kind as well as by bone,
      // because every other volume on this bone is a part and the whole cluster
      // went the part way.
      //
      // Measured on the finished field: 8.0mm proud of the featureless field at
      // y = 0.870..0.880, 6.0mm at 0.890, 3.5mm at 0.850, and gone by 0.840
      // below and 0.910 above; ~110mm across at the widest, half of that at full
      // height. The drawn surface takes 5.2mm of it after the relief pass
      // relaxes the field difference over the skin. Less than the 12mm authored,
      // because the dome is measured against the field rather than against the
      // scan and the field over the pubis is already 1..2mm in front of the
      // drawn skin. Below it the plate's front cone is entirely inside the dome,
      // so the two are one shape and not a union of two.
      cone(
        "pelvis",
        GROUP.TORSO,
        [-0.00904, -0.00542, 0.03934],
        0.02621,
        [0.00904, -0.00542, 0.03934],
        0.02621,
        0.008,
        { soft: true, feature: true }
      );

      // The labia majora, as a pair of flat lenses lying on the plate rather
      // than as tubes resting on it. Every number below is stated against the
      // plate's own surface, measured by ray-casting the field down -y at the
      // crest line |x| = 9mm: that surface runs y = -92.1mm at z = 0 to
      // -71.0mm at z = 48, and each node here sits 5mm proud of it.
      //
      // 5mm, because the version before this one stood 17mm proud and that is
      // what made it read as two sausages laid in the crotch. Its cones were
      // only r = 9mm, but their axes sat *below* the plate's surface, so the
      // plate stopped being the ground the labia rose from and became a shelf
      // they sat on top of, with a crease all the way round. Tracking the plate
      // is what turns the two into one continuous form.
      //
      // Width is set by the scan, not by the tables. A meta-analysis of 6,070
      // women gives labia majora width 19.5mm (CI 15.3-23.7) and length 83.5mm
      // (78.7-88.3), but the scan's crotch is only 24mm of floor either side of
      // the midline before the thigh takes over, and a form authored to the
      // population mean hangs off the end of it into air - which is what a
      // 30mm-wide version did. The widest node here reaches |x| = 20mm, so each
      // labium is 20mm across at the waist and the pair span 40mm; length is
      // 48mm of chord from the anterior commissure at z = 48 to the posterior
      // one at z = 2, plus the plate's curve through the perineal corner.
      //
      // There is no subtraction in this field, only `smoothMin`, so the cleft
      // is the space the two lenses leave rather than something cut out of one.
      // A cleft that closes at both ends is the shape the real one has, and it
      // also removes the blunt terminations the parallel-tube version ended in.
      //
      // What sets its depth took two goes to get right, because the obvious
      // knob is the wrong one. A node's sphere bottoms out at `crest - burial`
      // whatever its radius, so `burial` alone sets how proud the labium
      // stands and the radius only sets how wide it is. The cleft is then
      //
      //     depth = min(burial, radius - sqrt(radius^2 - offset^2))
      //
      // and the first version had burial 5mm against offset 9, radius 11 - so
      // the spheres still met over the midline, the second term came to 4.7mm,
      // and ray-casting the finished field found 2.6mm of it left after the
      // 4mm blend. 2.6mm of dip on a form standing 7mm proud is not a cleft;
      // it rendered as a smooth egg with a shading line on it, which is
      // exactly the complaint.
      //
      // Both terms have to grow together, and the offset has to clear the
      // radius so the pair stop meeting at all. At the waist they are 10.5 and
      // 6.5, so each labium occupies |x| = 4..17 and the floor between them is
      // 8mm of bare plate 8mm down. At the commissures the offset drops inside
      // the radius again (1.6 against 3.8) and the two run together into one
      // rounded end. The crossover is at lens 0.355, which puts the open part
      // of the cleft at z = 5.4..44.6 of the 46mm length. Ray-cast, the finished
      // cleft is 1.8mm deep at the fourchette, 6.5mm at the waist and 2.4mm at
      // the anterior commissure.
      //
      // The outer edge is capped at 17mm rather than let out to the 19.5mm mean
      // half-width the tables give, and that is the standing pose's doing. The
      // part is rigid to the pelvis and does not union with the drawn body, so
      // wherever it crosses the thigh it cuts a hard-edged island out of it -
      // and with the legs together this scan leaves a wedge only 13mm of
      // half-width at the depth the crests sit at. Authored to 21mm they came
      // through it as two pointed fingers with daylight behind them. At 17mm
      // what shows is a pair of low rounded lobes with the cleft between them,
      // which is roughly what a real one shows from that angle. It cannot be
      // hidden altogether: no vulva of honest width fits inside this scan's
      // closed thighs, so the choice is only about what escapes.
      //
      // Sampled from a smooth profile rather than authored as a handful of
      // cones, because the handful is what the surface shows. Four cones a side
      // was tried and each one drew itself: a round cone's surface meets its
      // axis at asin(dr/dl), so where the radius stops growing and starts
      // shrinking the surface kinks, and the labium rendered as a 2x3 grid of
      // pillows. Raising the blend to 10mm did smooth them out and took the
      // cleft with it - `smoothMin` cannot make a groove, only fill one, so
      // blending enough to hide a crease also closes the one feature that makes
      // this read as a vulva. Nine nodes put every kink under 3 degrees, which a
      // 4mm blend absorbs while leaving the cleft alone.
      //
      // `sin(pi t)` to a fractional power is a lens: fat and flat through the
      // middle, tapering at both ends without coming to a point. The exponent
      // sets how long it stays fat - 0.7 holds the waist width over most of the
      // length, which is what a labium does and what a plain sine does not.
      for (const side of [-1, 1]) {
        let previous = null;
        for (let i = 0; i <= LABIA_NODES; i += 1) {
          const t = i / LABIA_NODES;
          const lens = Math.sin(Math.PI * t) ** 0.7;
          const z = LABIA_FRONT + (LABIA_BACK - LABIA_FRONT) * t;
          const radius = 3.8 + 2.7 * lens;
          const burial = 2.5 + 5.5 * lens;
          const node = {
            p: [
              (side * (1.6 + 8.9 * lens)) / 1000 / H,
              (plateCrest(z) - burial + radius) / 1000 / H,
              z / 1000 / H,
            ],
            r: radius / 1000 / H,
          };
          if (previous) {
            cone("pelvis", GROUP.TORSO, previous.p, previous.r, node.p, node.r, 0.00241, {
              soft: true,
              feature: true,
              part: true,
            });
          }
          previous = node;
        }
      }

      // The labia minora, which only became authorable once the cleft above was
      // deep enough to hold them. In the 2.6mm version there was nowhere to put
      // them: the majora's inner flanks met over the midline, so anything laid
      // between them was either swallowed or had to stand proud of the majora
      // themselves, which is the wrong silhouette. With the floor now 8mm wide
      // and buried 8mm under the crest - 6.5mm of it surviving the blend - a
      // pair of flanges 4.5mm proud sits *in* the cleft and reads as what it is.
      //
      // Thin, and that is the whole point of them - 3.3mm of radius at the
      // waist against the majora's 6.5. They are built the same way and for the
      // same reason, a sampled lens rather than stepped cones, but with a
      // flatter exponent (0.55) because a labium minus holds its depth further
      // towards the fourchette than a labium majus holds its width.
      //
      // The offset exactly equals the radius at the waist (3.3 and 3.3), so
      // unlike the majora these two still meet over the midline and leave a
      // groove rather than a gap. That groove is the vestibule, and how nearly
      // the two touch is the only knob on it: overlapping them at 2.9 against
      // 3.4 came out 1.6mm deep, of which `smoothMin` took 0.45 (a polynomial
      // smooth min fills at most k/4, not k, which is why a 1.8mm blend can sit
      // next to a feature this small at all), and 1.2mm of groove between two
      // folds rendered as a plain valley with nothing in it. Touching rather
      // than overlapping is the deepest it goes without separating the pair
      // outright, which would open a slot straight through to the plate.
      //
      // Measured on the finished surface the minora stand 1.1mm proud of the
      // midline at the anterior end, 3.7mm through the middle and 1.5mm at the
      // fourchette, inside a cleft that is 6.5mm deep at its deepest.
      for (const side of [-1, 1]) {
        let previous = null;
        for (let i = 0; i <= MINORA_NODES; i += 1) {
          const t = i / MINORA_NODES;
          const lens = Math.sin(Math.PI * t) ** 0.55;
          const z = MINORA_FRONT + (MINORA_BACK - MINORA_FRONT) * t;
          const radius = 1.8 + 1.5 * lens;
          const burial = 1.5 + 3 * lens;
          const node = {
            p: [
              (side * (1.6 + 1.7 * lens)) / 1000 / H,
              (plateCrest(z) - burial + radius) / 1000 / H,
              z / 1000 / H,
            ],
            r: radius / 1000 / H,
          };
          if (previous) {
            cone("pelvis", GROUP.TORSO, previous.p, previous.r, node.p, node.r, 0.00108, {
              soft: true,
              feature: true,
              part: true,
            });
          }
          previous = node;
        }
      }

      // The clitoral hood, where the minora converge under the anterior
      // commissure. A short taper rather than a bead: a bead on its own reads as
      // a lump sitting in the cleft, whereas running it back along the midline
      // makes it the front end of the pair below it.
      //
      // Sampled from the same kind of lens as everything else here, and for the
      // same reason. Three hand-placed cones was the first try and its blunt
      // posterior end put a 6.1 degree crease straight across the midline at
      // z = 34 - the one place on this whole feature where a crease is least
      // forgivable, because it is exactly where the eye goes.
      //
      // The peak lands at z = 37, ten millimetres behind the anterior
      // commissure, where it stands 5.5mm proud of the plate against the
      // minora's 4.5mm and the majora's 8mm - in the cleft, not over it. Both ends taper
      // away under their neighbours; see `HOOD_BACK` for why the posterior one
      // has to run so much further than the form does.
      {
        let previous = null;
        for (let i = 0; i <= HOOD_NODES; i += 1) {
          const t = i / HOOD_NODES;
          const lens = Math.sin(Math.PI * t) ** 0.6;
          const z = HOOD_FRONT + (HOOD_BACK - HOOD_FRONT) * t;
          const radius = 1.4 + 1.8 * lens;
          const burial = 2 + 3.5 * lens;
          const node = {
            p: [0, (plateCrest(z) - burial + radius) / 1000 / H, z / 1000 / H],
            r: radius / 1000 / H,
          };
          if (previous) {
            cone("pelvis", GROUP.TORSO, previous.p, previous.r, node.p, node.r, 0.0012, {
              soft: true,
              feature: true,
              part: true,
            });
          }
          previous = node;
        }
      }
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
 *
 * `hang` is the gravity correction from `gravityHang`, applied to the volumes
 * that carry the `hang` flag. Pass the same object to `skinHumanMesh` and the
 * drawn part moves with the collider; leave it out and both stay rigid, which
 * is what every caller that only wants proportions wants.
 */
export function poseVolumes(skeleton, evaluated, volumes, actorId = 0, hang = null) {
  const out = new Array(volumes.length);
  for (let i = 0; i < volumes.length; i += 1) {
    const volume = volumes[i];
    const m = evaluated.matrices[skeleton.boneIndex(volume.bone)];
    let a = transform(m, volume.a);
    let b = transform(m, volume.b);
    if (hang && volume.hang) {
      a = applyHang(hang, a);
      b = applyHang(hang, b);
    }
    out[i] = {
      id: volume.id,
      actorId,
      bone: volume.bone,
      group: volume.group,
      soft: Boolean(volume.soft),
      compression: volume.compression,
      feature: Boolean(volume.feature),
      part: Boolean(volume.part),
      hang: Boolean(volume.hang),
      blend: volume.blend,
      selfIgnore: volume.selfIgnore,
      ra: volume.ra,
      rb: volume.rb,
      a,
      b,
    };
  }
  return out;
}

/**
 * How far the hanging parts are allowed to swing away from where the pelvis
 * would carry them. Gravity wins over the skeleton here - a flaccid shaft and
 * a scrotum hang down whatever the hips are doing, which is the whole reason
 * this exists - but not without limit: past about 85 degrees the suspensory
 * ligament is what is holding the thing up, not the skin.
 */
const MAX_HANG_SWING = (85 * Math.PI) / 180;

/**
 * And how far it may swing *backwards*, into the body. Gravity's answer for a
 * man lying on his back is "straight down", and straight down from the pubic
 * arch of a supine pelvis is through the pelvis. The limit is stated against
 * the pelvis's own forward axis rather than as an angle from rest, because
 * what is being forbidden is anatomical - nothing rooted at the pubic arch
 * points behind it - and it is the constraint that turns "down" into the
 * answer a supine body actually has, which is that the package lies along the
 * groin toward the feet.
 */
const MIN_HANG_FORWARD = -0.1;

/**
 * Gravity for the parts that have no bone to hold them up.
 *
 * Everything else on this body is rigid to a joint, and for muscle and bone
 * that is right. It is not right for a scrotum, which hangs, or for a flaccid
 * shaft, which drapes: rotate the pelvis and those two keep pointing at the
 * floor, and a figure whose hips are tipped 70 degrees forward with its
 * genitals still pointing along the thigh axis reads as a mannequin.
 *
 * The correction is one rotation about the root of the package, shared by
 * every volume flagged `hang`, so the shaft stays draped over the sac and the
 * median raphe stays where it was authored. It is computed in world space and
 * handed to both consumers - `poseVolumes` for the collider, `skinHumanMesh`
 * for the drawn part - because those two live in different frames and the only
 * thing they certainly agree on is the world.
 *
 * @param {object} skeleton
 * @param {object} evaluated result of `evaluatePose`
 * @param {Array<object>} volumes bone-local volumes from `buildBodyVolumes`
 * @param {Array<number>} [gravity] world down, for a scene that has its own
 * @returns {{pivot: number[], axis: number[], angle: number}|null}
 */
export function gravityHang(skeleton, evaluated, volumes, gravity = [0, -1, 0]) {
  const root = volumes.find((volume) => volume.hangRoot);
  if (!root) return null;

  const m = evaluated.matrices[skeleton.boneIndex(root.bone)];
  const pivot = transform(m, root.a);
  const rigid = v3normalize(v3sub(transform(m, root.b), pivot));
  const down = v3normalize(gravity);
  // The pelvis's own forward, for the backwards limit below.
  const forward = v3normalize([m[8], m[9], m[10]]);

  // Where gravity wants the package, which is *not* straight down. A flaccid
  // shaft hangs down and a little forward because it is draped over the sac,
  // and that lean is a property of the drape, not of the hips - so it is
  // carried as an angle away from gravity rather than as an angle away from
  // the pelvis. The authored axis supplies it: the volumes are stated in a
  // pelvis whose rest orientation is the identity, so the local axis *is* the
  // world axis at rest, and the angle it makes with down is the lean.
  const authored = v3normalize(v3sub(root.b, root.a));
  const lean = Math.acos(Math.max(-1, Math.min(1, -authored[1])));
  // Forward, with gravity taken out of it, so the lean is measured in the
  // plane a pendulum would swing in. Prone and supine make this degenerate -
  // the body's forward *is* the vertical - and there the lean has no defined
  // direction, so it falls back to whichever way the package is already
  // pointing.
  const along = forward[0] * down[0] + forward[1] * down[1] + forward[2] * down[2];
  let level = v3sub(forward, v3mul(down, along));
  if (v3lenSq(level) < 1e-6) {
    const drift = rigid[0] * down[0] + rigid[1] * down[1] + rigid[2] * down[2];
    level = v3sub(rigid, v3mul(down, drift));
  }
  const target =
    v3lenSq(level) < 1e-6
      ? down
      : v3normalize(v3add(v3mul(down, Math.cos(lean)), v3mul(v3normalize(level), Math.sin(lean))));

  const cross = [
    rigid[1] * target[2] - rigid[2] * target[1],
    rigid[2] * target[0] - rigid[0] * target[2],
    rigid[0] * target[1] - rigid[1] * target[0],
  ];
  const sin = Math.hypot(cross[0], cross[1], cross[2]);
  // Already hanging, or exactly inverted - in which case there is no unique
  // way to fall and leaving it alone is better than picking one arbitrarily.
  if (sin < 1e-6) return null;
  const axis = [cross[0] / sin, cross[1] / sin, cross[2] / sin];

  const dot = rigid[0] * target[0] + rigid[1] * target[1] + rigid[2] * target[2];
  let angle = Math.min(Math.atan2(sin, dot), MAX_HANG_SWING);

  // Back off until the axis is no longer pointing into the body. The swing is
  // monotone in the angle over the range that matters, so bisection converges
  // on the largest legal rotation rather than giving up at the first violation.
  if (forwardAfter(rigid, axis, angle, forward) < MIN_HANG_FORWARD) {
    let lo = 0;
    let hi = angle;
    for (let i = 0; i < 16; i += 1) {
      const mid = (lo + hi) / 2;
      if (forwardAfter(rigid, axis, mid, forward) < MIN_HANG_FORWARD) hi = mid;
      else lo = mid;
    }
    angle = lo;
  }
  if (angle < 1e-4) return null;

  return { pivot, axis, angle };
}

/** How far forward the hang axis points after swinging by `angle`. */
function forwardAfter(rigid, axis, angle, forward) {
  const r = rotateAbout(rigid, axis, angle);
  return r[0] * forward[0] + r[1] * forward[1] + r[2] * forward[2];
}

/** Rodrigues: rotate `v` about the unit `axis` by `angle`. */
function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return [
    v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d * (1 - c),
    v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d * (1 - c),
    v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d * (1 - c),
  ];
}

/** A world point swung about the hang pivot. */
export function applyHang(hang, p) {
  const r = rotateAbout(v3sub(p, hang.pivot), hang.axis, hang.angle);
  return [r[0] + hang.pivot[0], r[1] + hang.pivot[1], r[2] + hang.pivot[2]];
}

/** A world direction swung about the hang pivot; normals need this, not that. */
export function applyHangDirection(hang, d) {
  return rotateAbout(d, hang.axis, hang.angle);
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
  // Written out component by component rather than through the vector
  // helpers: this is the innermost loop of every field evaluation, and the
  // three arrays those would allocate per call were a third of the time a pose
  // took to mesh. The arithmetic is theirs, term for term, so the distances
  // are the same to the last bit.
  const { a, b, ra, rb } = volume;
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const pax = p[0] - a[0];
  const pay = p[1] - a[1];
  const paz = p[2] - a[2];
  if (l2 < 1e-12) return Math.sqrt(pax * pax + pay * pay + paz * paz) - ra;

  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;

  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y;
  const qy = pay * l2 - bay * y;
  const qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
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

// One volume's terms in a `bodyField`, in this order.
const FIELD_STRIDE = 18;
// How far inside the proven bound a volume has to be before `bodyField` will
// skip it: 0.1 micron, a hundred million times the rounding in one distance.
const FIELD_SLACK = 1e-7;

/**
 * `bodyDistance` against one fixed set of volumes, for asking it at many
 * points: `bodyField(volumes)(x, y, z)`.
 *
 * Meshing, occlusion and the feature relief ask the same few volumes for
 * millions of points, and `roundConeDistance` spent a third of each call
 * working out terms that belong to the volume and not to the point - its axis,
 * its length, its taper. Here they are worked out once and kept in one flat
 * array. What is left is `roundConeDistance` and `smoothMin` term for term, in
 * the same order, so the answer is `bodyDistance`'s to the last bit.
 *
 * Most of those terms are also proving that an ankle is far from an ear, and
 * those are skipped without changing a bit. A round cone lies inside the ball
 * round its midpoint of radius half its length plus its larger radius, so its
 * distance is at least the distance to that ball. When that is more than the
 * running distance plus the volume's blend, `smoothMin` weighs the volume at
 * exactly zero - `h` comes out 1, and `di * 0 + d * 1 - blend * 0` is `d` - so
 * leaving it out is the same fold. The first volume is always taken, because it
 * is not blended but assigned, and a cone whose one sphere swallows the other
 * never is, because the analytic form is not a distance there. Measured over
 * the female scan's 47k vertices against her 150 volumes: a third of the time.
 * A second, tighter test against the axis segment cost more than it saved.
 *
 * The volumes are read once, now. A field made before they move does not
 * follow them.
 */
export function bodyField(volumes) {
  const terms = new Float64Array(volumes.length * FIELD_STRIDE);
  volumes.forEach(({ a, b, ra, rb, blend }, i) => {
    const bax = b[0] - a[0];
    const bay = b[1] - a[1];
    const baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = ra - rb;
    const bounded = l2 < 1e-12 || l2 - rr * rr > 0;
    const reach = bounded ? Math.sqrt(l2) / 2 + Math.max(ra, rb) + Math.max(blend, 0) + FIELD_SLACK : Infinity;
    terms.set([
      a[0], a[1], a[2], bax, bay, baz, l2, ra, rb, rr, l2 - rr * rr, 1 / l2, Math.sign(rr) * rr * rr, blend,
      a[0] + bax / 2, a[1] + bay / 2, a[2] + baz / 2, reach,
    ], i * FIELD_STRIDE);
  });
  return (px, py, pz) => {
    let d = Infinity;
    for (let o = 0; o < terms.length; o += FIELD_STRIDE) {
      // Infinite while `d` is, so the first volume always falls through.
      const clear = d + terms[o + 17];
      if (clear < 0) continue;
      const mx = px - terms[o + 14];
      const my = py - terms[o + 15];
      const mz = pz - terms[o + 16];
      if (mx * mx + my * my + mz * mz > clear * clear) continue;
      const pax = px - terms[o];
      const pay = py - terms[o + 1];
      const paz = pz - terms[o + 2];
      const l2 = terms[o + 6];
      const ra = terms[o + 7];
      let di;
      if (l2 < 1e-12) di = Math.sqrt(pax * pax + pay * pay + paz * paz) - ra;
      else {
        const bax = terms[o + 3];
        const bay = terms[o + 4];
        const baz = terms[o + 5];
        const a2 = terms[o + 10];
        const il2 = terms[o + 11];
        const y = pax * bax + pay * bay + paz * baz;
        const z = y - l2;
        const qx = pax * l2 - bax * y;
        const qy = pay * l2 - bay * y;
        const qz = paz * l2 - baz * y;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = y * y * l2;
        const z2 = z * z * l2;
        const k = terms[o + 12] * x2;
        if (Math.sign(z) * a2 * z2 > k) di = Math.sqrt(Math.max(0, x2 + z2)) * il2 - terms[o + 8];
        else if (Math.sign(y) * a2 * y2 < k) di = Math.sqrt(Math.max(0, x2 + y2)) * il2 - ra;
        else di = (Math.sqrt(Math.max(0, x2 * a2 * il2)) + y * terms[o + 9]) * il2 - ra;
      }
      if (d === Infinity) d = di;
      else {
        const blend = terms[o + 13];
        if (blend <= 1e-6) d = Math.min(d, di);
        else {
          const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (di - d)) / blend));
          d = di * (1 - h) + d * h - blend * h * (1 - h);
        }
      }
    }
    return d;
  };
}

/** `bodyNormal` for a `bodyField`, to the same last bit. */
export function fieldNormal(field, p, h = 1e-3) {
  const dx = field(p[0] + h, p[1], p[2]) - field(p[0] - h, p[1], p[2]);
  const dy = field(p[0], p[1] + h, p[2]) - field(p[0], p[1] - h, p[2]);
  const dz = field(p[0], p[1], p[2] + h) - field(p[0], p[1], p[2] - h);
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
