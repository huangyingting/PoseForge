/**
 * Clothes.
 *
 * Everything a figure can wear - underwear, swimwear, lingerie, the studio top
 * and shorts, stockings, a harness and cuffs - built the same way as each
 * other and not at all the way the hair is built. Hair sits *near* a head and
 * the shape it makes is its own; a garment sits *on* a body and the shape it
 * makes is the body's. So where `hair.js` generates a shell from a support
 * field and never looks at a triangle, this lifts a region of the drawn
 * surface a couple of millimetres off itself and hems it. Nothing is
 * approximated: the cup is the breast, the seat of the briefs is the buttock,
 * and they fit because they are the same vertices.
 *
 * Three consequences follow from that and they are all good.
 *
 * It costs nothing to pose. Each garment vertex keeps the joints and weights of
 * the body vertex it came from, so it is skinned by the same code, in the same
 * pass, and a bra stays on a woman who is lying on her side without anyone
 * writing a line of cloth simulation.
 *
 * It fits every body. The bust slider changes the breast; the cup is measured
 * off the changed breast at build time, so it changes with it. Nothing here is
 * a fixed coordinate that a different figure would break.
 *
 * And it is cheap. One offset layer and a hem, no inner surface - there is an
 * opaque body directly underneath, so the inside of a garment is the one
 * surface in this whole renderer that is guaranteed never to be seen.
 *
 * What the garments are *shaped* like is a handful of region functions over
 * measured landmarks, and those are where the work is. See `measure`. A strap
 * is a line laid along the skin (`surfacePath`) and the region round it
 * (`straps`); what a garment is made of is its finish, which is for the
 * renderers to draw (`GARMENT_FINISHES`).
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, t) => {
  const x = clamp01((t - a) / (b - a || 1e-9));
  return x * x * (3 - 2 * x);
};

/**
 * How far the fabric is lifted off the skin, as a fraction of stature.
 *
 * Two and a half millimetres at 1.72m, which is about what a doubled jersey
 * actually stands off a body and comfortably more than the skinning can move
 * the two apart. Both layers are driven by the same joints and weights, so they
 * cannot separate at all in principle; the margin is against the one case where
 * they can, which is a limit-clamped joint bending far enough that the skin
 * folds over itself underneath.
 */
const LIFT = 0.0025 / 1.72;

// Joints carry two names. `joint.name` is the rig's own - upperarm_l, calf_l,
// ball_l - and `joint.bone` is this project's remapping of the twenty-two it
// poses, shoulder_l, knee_l, toe_l. `jointSet` matches on `name`, so these
// patterns are in the rig's vocabulary. Written in the other one they match
// nothing at all and veto nothing at all, silently: `jointSet` cannot tell a
// pattern that excludes no joints from one that was meant to.
const ARM_BONES = /upperarm|lowerarm|hand|index|middle|pinky|ring|thumb/;
const LOWER_LEG_BONES = /calf|foot|ball/;
// What a strap laid over the shoulder has to keep off. Not the upper arm: the
// line of vertices where it takes over from the clavicle runs ragged across the
// back of the shoulder, and a strap made to find the skin only on one side of
// it follows it, in a zigzag a centimetre and a half wide.
const FOREARM_BONES = /lowerarm|hand|index|middle|pinky|ring|thumb/;

/** Colours to wear. Fabric, so none of them are fully saturated or fully dark. */
export const GARMENT_COLOURS = {
  black: [0.055, 0.052, 0.056],
  white: [0.86, 0.85, 0.83],
  grey: [0.30, 0.30, 0.32],
  red: [0.42, 0.075, 0.105],
  navy: [0.16, 0.21, 0.29],
  sage: [0.30, 0.46, 0.39],
  clay: [0.55, 0.30, 0.22],
  nude: [0.62, 0.48, 0.42],
};

/**
 * Everything `withGarments` knows how to make, and what each is called on a
 * control. Ordered by where on the body it goes, then from plain to not.
 */
export const GARMENT_LABELS = {
  bra: "Bra",
  "lace-bra": "Lace bra",
  "bikini-top": "Bikini top",
  top: "Top",
  briefs: "Briefs",
  "lace-thong": "Lace thong",
  "bikini-bottom": "Bikini bottom",
  "swim-briefs": "Swim briefs",
  "boxer-briefs": "Boxer briefs",
  jockstrap: "Jockstrap",
  shorts: "Shorts",
  stockings: "Stockings",
  "garter-belt": "Garter belt",
  harness: "Harness",
  cuffs: "Cuffs",
};
export const GARMENT_NAMES = Object.keys(GARMENT_LABELS);

/**
 * Pieces that go in the same place, of which a figure wears one.
 *
 * Two of them at once would be two surfaces lifted off the same skin by the
 * same distance, and they would fight over every pixel - so the scene keeps
 * the first it is given and says what it dropped (see `resolveWearing`).
 * Anything not in a slot is worn over or under whatever else is on, at its own
 * `layer`.
 */
export const GARMENT_SLOTS = {
  chest: ["bra", "lace-bra", "bikini-top", "top"],
  hips: ["briefs", "lace-thong", "bikini-bottom", "swim-briefs", "boxer-briefs", "jockstrap", "shorts"],
};

/**
 * What each garment is made of, which is what the renderers draw it as.
 *
 * cotton - knitted, matte, with a sheen off the nap.
 * lycra - swimwear: smoother, with a soft highlight.
 * lace - net and flowers cut out of the surface, so the skin shows through.
 * sheer - nylon, which the skin shows through everywhere, more face-on than
 *         edge-on, because edge-on the eye looks through more of it.
 * leather - dark and glossy.
 */
export const GARMENT_FINISHES = ["cotton", "lycra", "lace", "sheer", "leather"];
const OPAQUE = new Set(["cotton", "lycra", "leather"]);

/** The scale `trim` distances are stored at; see `lift`. */
export const TRIM = 0.01;

/**
 * Sets of pieces worth one click, for the control that offers them. Not a
 * scene field: choosing one writes its pieces into `wearing`.
 */
export const OUTFITS = {
  studio: ["top", "shorts"],
  underwear: ["bra", "briefs"],
  bikini: ["bikini-top", "bikini-bottom"],
  lingerie: ["lace-bra", "lace-thong", "stockings", "garter-belt"],
  swim: ["swim-briefs"],
  boxers: ["boxer-briefs"],
  leather: ["jockstrap", "harness"],
};

/**
 * One piece per slot: the first of each that the list names, in its order.
 *
 * @param {string[]} wearing
 * @returns {{wearing: string[], dropped: string[]}}
 */
export function resolveWearing(wearing) {
  const taken = new Set();
  const kept = [];
  const dropped = [];
  for (const name of wearing) {
    const slot = Object.keys(GARMENT_SLOTS).find((key) => GARMENT_SLOTS[key].includes(name));
    if (kept.includes(name)) continue;
    if (slot && taken.has(slot)) {
      dropped.push(name);
      continue;
    }
    if (slot) taken.add(slot);
    kept.push(name);
  }
  return { wearing: kept, dropped };
}

/** Pieces with cups, which need a breast to hold: made for female bodies only. */
export const CUPPED = new Set(["bra", "lace-bra", "bikini-top"]);

/** What a request for clothing means if it does not say. */
export const DEFAULT_WEARING = {
  female: ["bra", "briefs"],
  male: ["briefs"],
  neutral: ["briefs"],
};

/** Which joint, if any, dominates a vertex. */
function dominant(body, v) {
  let best = -1;
  let weight = 0;
  for (let k = 0; k < 4; k += 1) {
    const w = body.weights[v * 4 + k];
    if (w > weight) {
      weight = w;
      best = body.joints[v * 4 + k];
    }
  }
  return best;
}

/** The indices of the joints whose names match, plus their descendants by name. */
function jointSet(template, pattern) {
  const set = new Set();
  template.joints.forEach((joint, i) => {
    if (pattern.test(joint.name ?? "")) set.add(i);
  });
  return set;
}

/**
 * A signed margin per vertex, positive on the part of the body a garment is
 * allowed onto and negative on the limbs it is not.
 *
 * This replaces asking `dominant` which single bone owns a vertex and refusing
 * the answer outright, and the difference is the difference between a strap and
 * a torn rag. `dominant` is a step function of the weights: it returns the same
 * bone across a whole region and then flips, and the line it flips on is
 * wherever two smoothly varying numbers happen to cross, which on a real scan
 * wanders from one vertex to its neighbour and back. Cutting a garment on that
 * line puts the hem on it, teeth and all - and the teeth are one edge of the
 * scan wide, not one pixel, because a vertex refused outright drags the zero
 * crossing right up against itself.
 *
 * The share of a vertex's weight that sits on the named bones is the same
 * information without the step. It runs from zero on the chest to one down the
 * arm, smoothly, because that is what skin weights are for, and the half-share
 * contour is where `dominant` would have flipped - so this cuts in the same
 * place, along a curve instead of a staircase. The result is still only as
 * smooth as the scan's weights, which is far smoother than its choice of
 * maximum.
 *
 * Scaled into metres so it can be mixed with the geometric fields by `min`
 * without one of them swamping the other: a tenth of a share is four
 * millimetres, which is the order of the distances everything else here works
 * in.
 */
function boneMargin(template, body, pattern, cutoff = 0.5, scale = 0.04) {
  const set = jointSet(template, pattern);
  const count = body.positions.length / 3;
  const margin = new Float64Array(count);
  for (let v = 0; v < count; v += 1) {
    let share = 0;
    for (let k = 0; k < 4; k += 1) {
      if (set.has(body.joints[v * 4 + k])) share += body.weights[v * 4 + k];
    }
    margin[v] = (cutoff - share) * scale;
  }
  return margin;
}

/**
 * The landmarks the garments are cut from.
 *
 * All of it is read off the mesh rather than written down, because the two scans
 * differ and because the bust and build sliders move most of these before a
 * garment is ever built. A number in this file that came from a ruler would be
 * wrong for one body in three.
 *
 * Everything is in the template's bind space, which is stature-normalised with
 * the crown at y = 1 and the face down +z.
 */
function measure(template, body) {
  const arms = jointSet(template, new RegExp(`${ARM_BONES.source}|clavicle`));
  const legs = jointSet(template, LOWER_LEG_BONES);
  const count = body.positions.length / 3;

  // A vertical profile of the trunk: how far forward, how far back and how wide
  // it is at each height. The arms are excluded because in the bind pose the
  // hands hang beside the hips, and a hand at 0.30 off the midline swamps a
  // waist at 0.07 - the first version of this measured the widest part of the
  // "torso" at the knuckles.
  const STEPS = 200;
  const front = new Float64Array(STEPS).fill(-Infinity);
  const back = new Float64Array(STEPS).fill(Infinity);
  const wide = new Float64Array(STEPS).fill(0);
  for (let v = 0; v < count; v += 1) {
    const joint = dominant(body, v);
    if (arms.has(joint) || legs.has(joint)) continue;
    const y = body.positions[v * 3 + 1];
    const slot = Math.floor(y * STEPS);
    if (slot < 0 || slot >= STEPS) continue;
    const x = Math.abs(body.positions[v * 3]);
    const z = body.positions[v * 3 + 2];
    if (z > front[slot]) front[slot] = z;
    if (z < back[slot]) back[slot] = z;
    if (x > wide[slot]) wide[slot] = x;
  }

  // The bust apex is the furthest-forward point of the chest, and the underbust
  // is the fold below it. Searching for a local maximum in the forward profile
  // rather than a global one keeps the chin and the belly out of it.
  let apexSlot = -1;
  for (let s = Math.floor(0.70 * STEPS); s <= Math.floor(0.78 * STEPS); s += 1) {
    if (front[s] > (apexSlot < 0 ? -Infinity : front[apexSlot])) apexSlot = s;
  }

  // The fold is where the descent from the apex stops, not where the profile is
  // lowest. Those are not the same point and the difference is not small: below
  // the fold the trunk is nearly a cylinder, so the profile wanders by a
  // millimetre or two over the whole of the ribs and the waist, and the global
  // minimum over that range lands wherever the noise happens to dip - on the
  // female scan, six centimetres below the breast. Every cup dimension is
  // derived from the apex-to-fold distance, so a fold six centimetres too low
  // gave a cup radius of 145mm, and the figure came back in a T-shirt.
  //
  // Stopping at the first slot whose drop falls under a millimetre and a half
  // finds the fold itself, which is the point of maximum curvature and the only
  // landmark on the front of a torso that a bra is actually built around - but
  // only once the walk is clear of the apex. An apex is a smooth maximum, so the
  // slot immediately below it always drops by less than any flatness threshold
  // worth using; on this scan the first step down is one millimetre. Tested
  // without the clearance the walk therefore breaks on its very first
  // comparison, every time, and the fold comes back equal to the apex. That is
  // not a visible failure - `reach` is zero, the cup has no radius, and the bra
  // renders as a flat strapless band, which looks enough like a garment to be
  // mistaken for a styling choice.
  let underSlot = apexSlot;
  for (let s = apexSlot - 1; s >= Math.floor(0.62 * STEPS); s -= 1) {
    const dropped = front[apexSlot] - front[s + 1];
    if (dropped > 0.004 && front[s] > front[s + 1] - 0.0009) break;
    underSlot = s;
  }

  // The waist is the narrowest the trunk gets between the ribs and the hips,
  // and the hip is the widest it gets below that.
  let waistSlot = Math.floor(0.64 * STEPS);
  for (let s = Math.floor(0.58 * STEPS); s <= Math.floor(0.68 * STEPS); s += 1) {
    if (wide[s] > 0 && wide[s] < wide[waistSlot]) waistSlot = s;
  }
  let hipSlot = Math.floor(0.52 * STEPS);
  for (let s = Math.floor(0.48 * STEPS); s <= Math.floor(0.56 * STEPS); s += 1) {
    if (wide[s] > wide[hipSlot]) hipSlot = s;
  }

  // The crotch: the lowest height at which the body is still one piece on the
  // midline. Below it the two thighs are separate and a sheet wrapped round the
  // axis would span the gap between them.
  let crotch = 0.52;
  for (let s = Math.floor(0.56 * STEPS); s >= Math.floor(0.42 * STEPS); s -= 1) {
    let midline = false;
    for (let v = 0; v < count && !midline; v += 1) {
      if (Math.abs(body.positions[v * 3]) > 0.012) continue;
      const y = body.positions[v * 3 + 1];
      if (Math.floor(y * STEPS) === s && body.positions[v * 3 + 2] > 0) midline = true;
    }
    if (!midline) break;
    crotch = s / STEPS;
  }

  // The apex sideways. Taken as the mean |x| of the forward-most vertices in the
  // apex band rather than the single furthest one, which on a 60,000-vertex scan
  // is noise.
  let ax = 0;
  let az = 0;
  let n = 0;
  const apexY = apexSlot / STEPS;
  for (let v = 0; v < count; v += 1) {
    const y = body.positions[v * 3 + 1];
    if (Math.abs(y - apexY) > 0.008) continue;
    if (body.positions[v * 3 + 2] < front[apexSlot] - 0.004) continue;
    ax += Math.abs(body.positions[v * 3]);
    az += body.positions[v * 3 + 2];
    n += 1;
  }

  const apex = n ? [ax / n, apexY, az / n] : [0.045, apexY, front[apexSlot]];
  const underY = underSlot / STEPS;
  // A body drawn over another's skeleton is cut where that one is; see
  // `measureCutHeights`.
  const cut = template.cutHeights ?? {};
  return {
    apex,
    underY,
    // How far forward the trunk reaches at a given height. A strap has to be
    // laid on the body and there is no other way to know where the body is: a
    // straight line from the top of a cup to the top of a shoulder runs through
    // open air in front of the sternum, and a strap built on it covers nothing
    // between the two ends. Smoothed over a couple of slots because a single
    // slot can miss.
    frontAt: (y) => {
      const slot = Math.round(y * STEPS);
      let best = -Infinity;
      for (let s = slot - 2; s <= slot + 2; s += 1) {
        if (s < 0 || s >= STEPS) continue;
        if (front[s] > best) best = front[s];
      }
      return best > -Infinity ? best : 0;
    },
    // The same for the back and the sides, which is all a guide for a strap
    // needs: a point near enough the surface for `surfaceProbe` to find it.
    backAt: (y) => {
      const slot = Math.max(0, Math.min(STEPS - 1, Math.round(y * STEPS)));
      return back[slot] < Infinity ? back[slot] : 0;
    },
    wideAt: (y) => wide[Math.max(0, Math.min(STEPS - 1, Math.round(y * STEPS)))],
    // How big the breast is, as the straight-line distance from the apex to the
    // fold under it. This is the one number the cup's size comes from, so a bust
    // slider moves the cup with the breast and no separate knob is needed.
    reach: Math.hypot(apex[1] - underY, apex[2] - front[underSlot]),
    waistY: cut.waistY ?? waistSlot / STEPS,
    hipY: cut.hipY ?? hipSlot / STEPS,
    hipWidth: wide[hipSlot],
    crotchY: cut.crotchY ?? crotch,
    shoulder: template.jointByBone.get("shoulder_l")?.rest ?? null,
    // Where the front of the trunk ends and the back begins, which is not z = 0:
    // the scans stand with the pelvis a centimetre or two either side of it.
    pelvisZ: template.jointByBone.get("pelvis")?.rest?.[14] ?? 0,
    // The thigh's axis, hip to knee, for the pieces that end on it.
    legAt: (y, side) => {
      const hip = template.jointByBone.get(`hip_${side > 0 ? "l" : "r"}`)?.rest;
      const knee = template.jointByBone.get(`knee_${side > 0 ? "l" : "r"}`)?.rest;
      if (!hip || !knee) return [side * 0.07, y, 0.02];
      const t = (y - hip[13]) / (knee[13] - hip[13] || 1);
      return [hip[12] + (knee[12] - hip[12]) * t, y, hip[14] + (knee[14] - hip[14]) * t];
    },
    kneeY: template.jointByBone.get("knee_l")?.rest?.[13] ?? 0.29,
  };
}

/**
 * The heights the pieces below the bust are cut at - the waist, the hips and
 * the crotch - as `measure` finds them on a body's own surface.
 *
 * A body drawn finer over another's skeleton carries the other's (as
 * `template.cutHeights`, written by scripts/models/make-fine-bodies.mjs from
 * the body at its default build), because found on its own surface they are
 * not the same heights. The waist is the narrowest row of the trunk and the
 * crotch the lowest row with a point near the midline, and on a scan whose
 * rows are a centimetre apart both land where its rows happen to fall: on the
 * surface five times as dense that stands in for the male, the narrowest row
 * is ten centimetres higher and his briefs came up to his navel. The same
 * figure drawn finer wears its clothes where it always did.
 */
export function measureCutHeights(template) {
  const { waistY, hipY, crotchY } = measure({ ...template, cutHeights: null }, template.submeshes.find((submesh) => submesh.primary));
  return { waistY, hipY, crotchY };
}

/** Squared distance from a point to a segment, and where along it the foot lands. */
function toSegment(p, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const ez = b[2] - a[2];
  const len = ex * ex + ey * ey + ez * ez || 1e-12;
  let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey + (p[2] - a[2]) * ez) / len;
  t = clamp01(t);
  const dx = p[0] - (a[0] + ex * t);
  const dy = p[1] - (a[1] + ey * t);
  const dz = p[2] - (a[2] + ez * t);
  return Math.hypot(dx, dy, dz);
}

/** The point of triangle `abc` nearest `p`, with its barycentric weights. */
function nearestOnTriangle(p, a, b, c) {
  // Ericson's region test, from Real-Time Collision Detection 5.1.5.
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [1 - v - w, v, w];
}

/**
 * A way to find the body's surface near a point: the point of the skin the
 * mask allows that is nearest it, and the skin's normal there.
 *
 * This is `frontNear` in the bra generalised to any side of the body, and for
 * the same reason - a strap is cut where a tube meets the skin, and a tube laid
 * even a centimetre off the surface meets it at a graze, which is a strap that
 * pinches and breaks. The guides it is given are landmarks a few millimetres to
 * a few centimetres from the skin; what comes back is on it.
 *
 * On the triangles, not the vertices. The back is tessellated in rows a
 * centimetre and a half apart, and a probe that answered with the nearest
 * vertex - or a mean of the few near it - moved in steps that size as its guide
 * slid along, so a strap laid through a run of them zigzagged down the back.
 * The nearest point of the surface moves as smoothly as the guide does. It is
 * found among the triangles round the vertices no further from the guide than
 * the nearest one is plus the longest edge, which is every triangle the answer
 * can be on.
 */
function surfaceProbe(body, allowed) {
  const count = body.positions.length / 3;
  const p = body.positions;
  const n = body.normals;
  const around = Array.from({ length: count }, () => []);
  let longest = 0;
  for (let t = 0; t < body.indices.length; t += 3) {
    const tri = [body.indices[t], body.indices[t + 1], body.indices[t + 2]];
    if (!tri.every((v) => allowed[v])) continue;
    for (const v of tri) around[v].push(t);
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      longest = Math.max(longest, Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]));
    }
  }
  const at = (v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
  return (guide) => {
    let nearest = Infinity;
    for (let v = 0; v < count; v += 1) {
      if (!around[v].length) continue;
      const d = Math.hypot(p[v * 3] - guide[0], p[v * 3 + 1] - guide[1], p[v * 3 + 2] - guide[2]);
      if (d < nearest) nearest = d;
    }
    if (nearest === Infinity) return { point: guide, normal: [0, 0, 1] };
    const reach = nearest + longest;
    const seen = new Set();
    let best = null;
    let bestD = Infinity;
    for (let v = 0; v < count; v += 1) {
      if (!around[v].length) continue;
      if (Math.abs(p[v * 3] - guide[0]) > reach || Math.abs(p[v * 3 + 1] - guide[1]) > reach) continue;
      if (Math.hypot(p[v * 3] - guide[0], p[v * 3 + 1] - guide[1], p[v * 3 + 2] - guide[2]) > reach) continue;
      for (const t of around[v]) {
        if (seen.has(t)) continue;
        seen.add(t);
        const tri = [body.indices[t], body.indices[t + 1], body.indices[t + 2]];
        const w = nearestOnTriangle(guide, at(tri[0]), at(tri[1]), at(tri[2]));
        const point = [0, 1, 2].map((k) => w[0] * p[tri[0] * 3 + k] + w[1] * p[tri[1] * 3 + k] + w[2] * p[tri[2] * 3 + k]);
        const d = Math.hypot(point[0] - guide[0], point[1] - guide[1], point[2] - guide[2]);
        if (d < bestD) {
          bestD = d;
          best = { tri, w, point };
        }
      }
    }
    const normal = [0, 1, 2].map((k) => best.w[0] * n[best.tri[0] * 3 + k] + best.w[1] * n[best.tri[1] * 3 + k] + best.w[2] * n[best.tri[2] * 3 + k]);
    const len = Math.hypot(...normal) || 1;
    return { point: best.point, normal: normal.map((value) => value / len) };
  };
}

/** A mask of the vertices less than half bound to the bones `pattern` names. */
function awayFrom(template, body, pattern) {
  const margin = boneMargin(template, body, pattern);
  return Uint8Array.from(margin, (value) => (value > 0 ? 1 : 0));
}

/**
 * A line laid along the skin through a list of guides, `depth` under it.
 *
 * Each span between two guides is walked in `steps` and every point of the walk
 * is put back on the surface, so the line bends with the body between the
 * guides rather than cutting the chord across a hollow - the one between the
 * buttock and the thigh is deep enough to lose a strap in.
 *
 * Then any two neighbours still joined by a chord that leaves the skin are
 * split, and split again, until none is. The walk does not guarantee that on
 * its own. A walk between guides that lie inside the body - round the side of
 * the neck, where a guide a few centimetres off the midline is under the skin -
 * has points whose nearest skin is on one side of it and then, the next step
 * on, on the other, and the chord between those two runs through the neck. A
 * strap a few millimetres round that chord meets no skin over the whole span:
 * the halter came out with the piece behind the neck hanging on its own, seven
 * centimetres from the rest. So the point a chord is split at is sought from
 * outside, off its midpoint along the normal its two ends share, where the
 * nearest skin is the arc between them rather than either end again.
 *
 * "Leaves the skin" is by a sixth of `depth`, which is tight for a reason: a
 * strap's width on the skin is the chord of a tube cut by it, and that falls
 * off steeply with how deep the line runs - under two millimetres deeper than
 * `depth` takes more than half the width off a halter string. A chord across a
 * curve always runs deeper in the middle, so the curve is followed closely
 * enough that it cannot run much deeper.
 */
function surfacePath(probe, guides, { depth = 0.003, steps = 5 } = {}) {
  const tolerance = depth / 6;
  const longest = 0.012;
  const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const on = [];
  const bridge = (a, b, level) => {
    if (level >= 6) return;
    const mid = [0, 1, 2].map((k) => (a.point[k] + b.point[k]) / 2);
    const length = distance(a.point, b.point);
    if (length <= longest && distance(probe(mid).point, mid) <= tolerance) return;
    const normal = [0, 1, 2].map((k) => a.normal[k] + b.normal[k]);
    const len = Math.hypot(...normal);
    const m = probe(len > 1e-6 ? mid.map((value, k) => value + (normal[k] / len) * (length / 2)) : mid);
    bridge(a, m, level + 1);
    on.push(m);
    bridge(m, b, level + 1);
  };
  for (let g = 0; g + 1 < guides.length; g += 1) {
    const a = guides[g];
    const b = guides[g + 1];
    for (let k = g ? 1 : 0; k <= steps; k += 1) {
      const t = k / steps;
      const next = probe([0, 1, 2].map((axis) => a[axis] + (b[axis] - a[axis]) * t));
      if (on.length) bridge(on[on.length - 1], next, 0);
      on.push(next);
    }
  }
  return on.map(({ point, normal }) => point.map((value, axis) => value - normal[axis] * depth));
}

/**
 * Straps along lines: the field is how far inside the nearest one a point is.
 *
 * A strap `width` wide on a line `depth` under the skin is the tube of radius
 * `sqrt((width/2)^2 + depth^2)` round it, cut by the surface; see the note on
 * the bra's straps for why the depth has to be held steady along the line.
 *
 * Each line's bounding box is checked first, because the field is evaluated at
 * every vertex of the scan and almost all of them are nowhere near a strap. A
 * point well clear of the box is given its distance to the box, which is no
 * more than its distance to the line, and not left out. Leaving it out made it
 * minus infinity, or whatever the rest of a garment's field said there - the
 * garter belt's is its band, a quarter of a metre up - and `refine` splits an
 * edge only where the field says a crossing could be hiding on it: a vertex a
 * couple of centimetres off a suspender, just outside the box, said there
 * could be none, and the suspender ran between two rows of the thigh's
 * vertices and was lost for four centimetres of its length. A bound is all the
 * test needs. The margin keeps every point near enough to a hem for the
 * number to place it measured exactly.
 */
function straps(lines, { width, depth = 0.003 }) {
  const radius = Math.hypot(width / 2, depth);
  const reach = radius + 0.02;
  const boxes = lines.map((line) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of line)
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], point[k]);
        max[k] = Math.max(max[k], point[k]);
      }
    return { min, max };
  });
  return (x, y, z) => {
    let near = Infinity;
    for (let l = 0; l < lines.length; l += 1) {
      const { min, max } = boxes[l];
      const clear = Math.hypot(
        Math.max(min[0] - x, 0, x - max[0]),
        Math.max(min[1] - y, 0, y - max[1]),
        Math.max(min[2] - z, 0, z - max[2])
      );
      if (clear > reach) {
        near = Math.min(near, clear);
        continue;
      }
      const line = lines[l];
      for (let k = 0; k + 1 < line.length; k += 1) near = Math.min(near, toSegment([x, y, z], line[k], line[k + 1]));
    }
    return radius - near;
  };
}

/**
 * What stands in for the genitals under a garment on a man; see `briefs`.
 * Centred off the plain briefs' waist whatever the garment's own is, because
 * the anatomy it covers does not move up and down with the cut.
 */
function bulgeShape(marks, amount) {
  if (!amount) return undefined;
  const waist = marks.waistY - (marks.waistY - marks.hipY) * 0.35;
  const centre = [0, marks.crotchY + (waist - marks.crotchY) * 0.26, 0.052];
  return (x, y, z) => {
    const d = Math.hypot(x * 0.85, (y - centre[1]) * 1.05, (z - centre[2]) * 0.6);
    return amount * (1 - smoothstep(0.012, 0.062, d));
  };
}

/** An elastic in a colour that stands out from the garment's own. */
function contrast(colour) {
  const luminance = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
  return luminance < 0.3 ? [0.8, 0.79, 0.77] : [0.05, 0.05, 0.055];
}

/**
 * Where a stocking ends: two fifths of the way from the crotch to the knee,
 * which is where the thigh is widest and where a welt stays up. Shared with the
 * garter belt, whose straps have to end on it.
 */
const stockingTop = (marks) => marks.crotchY - (marks.crotchY - marks.kneeY) * 0.4;

/** A trim value for the band within `width` of a garment's edge. */
const hem = (width) => (x, y, z, f) => width - f;

/**
 * The longest edge `refine` leaves anywhere a garment's edge could be: about
 * four millimetres, a third of the narrowest strap here.
 */
const FINE_EDGE = 0.0025;

/**
 * The body, split finer wherever the garment's field says an edge of it could
 * be, with the field evaluated at every vertex.
 *
 * The cut in `lift` finds a hem where the field changes sign along an edge,
 * which is all it can do and is exact for a hem wider than the triangles it
 * crosses. A strap is not. The scan is tessellated for the body, not for the
 * clothes - its rows across the small of the back are fourteen millimetres
 * apart, and a thong's string there is eleven wide - so a strap can run
 * between two rows of vertices with every one of them outside it, and it
 * comes out as dashes where it happens to catch one. That is what the first
 * lace thong did, across both buttocks.
 *
 * So each edge that could hide a crossing is split at its midpoint, and the
 * triangles either side of it into two, three or four, the same way on both
 * sides because the decision is the edge's - no T-junctions, so no pinholes in
 * the cloth. "Could hide a crossing" is the Lipschitz test: the fields here are
 * distances, and a distance cannot get from `f(a)` at one end of an edge to the
 * other sign and back to `f(b)` in less than `|f(a)| + |f(b)|`. Edges that do
 * change sign are split too, so a hem that curves - a ring, a cup - lies on the
 * curve rather than on its chords. A few rounds takes the worst of the scan's
 * edges down to `FINE_EDGE` and leaves everything well away from a garment's
 * edge as it was.
 *
 * The midpoints stay on the chord: the skin is drawn as those flat triangles,
 * and a garment lifted off the curve they approximate would stand off the skin
 * by more in the middle of each than at its corners. Weights are blended by
 * joint as `cut` does and for the reasons given there. `source` is which of
 * the scan's own triangles each new one came from, for deciding what skin an
 * opaque garment hides.
 */
function refine(body, field, veto, rounds = 4) {
  const positions = Array.from(body.positions);
  const normals = Array.from(body.normals);
  const uvs = body.uvs ? Array.from(body.uvs) : null;
  const joints = Array.from(body.joints);
  const weights = Array.from(body.weights);
  const vetoes = veto ? Array.from(veto) : null;
  const f = [];
  const value = (v) => {
    const inside = field(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    return vetoes ? Math.min(inside, vetoes[v]) : inside;
  };
  for (let v = 0; v < body.positions.length / 3; v += 1) f.push(value(v));

  let triangles = Array.from(body.indices);
  let source = Array.from({ length: triangles.length / 3 }, (_, t) => t);

  const midpoint = (a, b) => {
    for (let k = 0; k < 3; k += 1) positions.push((positions[a * 3 + k] + positions[b * 3 + k]) / 2);
    const n = [0, 1, 2].map((k) => normals[a * 3 + k] + normals[b * 3 + k]);
    const len = Math.hypot(...n) || 1;
    normals.push(n[0] / len, n[1] / len, n[2] / len);
    if (uvs) uvs.push((uvs[a * 2] + uvs[b * 2]) / 2, (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2);
    const blend = new Map();
    for (const v of [a, b]) {
      for (let k = 0; k < 4; k += 1) {
        const weight = weights[v * 4 + k] / 2;
        if (weight > 0) blend.set(joints[v * 4 + k], (blend.get(joints[v * 4 + k]) ?? 0) + weight);
      }
    }
    const best = [...blend].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = best.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (let k = 0; k < 4; k += 1) {
      joints.push(best[k] ? best[k][0] : 0);
      weights.push(best[k] ? best[k][1] / total : 0);
    }
    const v = positions.length / 3 - 1;
    if (vetoes) vetoes.push((vetoes[a] + vetoes[b]) / 2);
    f.push(value(v));
    return v;
  };

  for (let round = 0; round < rounds; round += 1) {
    const split = new Map();
    const splitAt = (a, b) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let m = split.get(key);
      if (m !== undefined) return m;
      const length = Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2]
      );
      const crosses = f[a] > 0 !== f[b] > 0;
      m = length > FINE_EDGE && (crosses || Math.abs(f[a]) + Math.abs(f[b]) < length) ? midpoint(a, b) : -1;
      split.set(key, m);
      return m;
    };
    const next = [];
    const nextSource = [];
    let changed = false;
    for (let t = 0; t < triangles.length; t += 3) {
      const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
      const mids = [splitAt(tri[0], tri[1]), splitAt(tri[1], tri[2]), splitAt(tri[2], tri[0])];
      const count = mids.filter((m) => m >= 0).length;
      const out = [];
      if (count === 0) out.push(tri);
      else if (count === 3) {
        const [ab, bc, ca] = mids;
        out.push([tri[0], ab, ca], [ab, tri[1], bc], [ca, bc, tri[2]], [ab, bc, ca]);
      } else if (count === 1) {
        // Rotated so the split edge is the first; the winding comes with it.
        const e = mids.findIndex((m) => m >= 0);
        const [a, b, c] = [tri[e], tri[(e + 1) % 3], tri[(e + 2) % 3]];
        out.push([a, mids[e], c], [mids[e], b, c]);
      } else {
        // Two split: rotated so the one left whole is the last, `c` to `a`.
        const e = mids.findIndex((m) => m < 0);
        const [a, b, c] = [tri[(e + 1) % 3], tri[(e + 2) % 3], tri[e]];
        const ab = mids[(e + 1) % 3];
        const bc = mids[(e + 2) % 3];
        out.push([ab, b, bc], [a, ab, bc], [a, bc, c]);
      }
      if (count) changed = true;
      for (const piece of out) {
        next.push(...piece);
        nextSource.push(source[t / 3]);
      }
    }
    triangles = next;
    source = nextSource;
    if (!changed) break;
  }

  return {
    positions,
    normals,
    uvs,
    joints,
    weights,
    f,
    indices: triangles,
    source,
  };
}

/**
 * How far the cloth stands off the skin, over and above its lift, where it is
 * stretched across a hollow rather than lying in it.
 *
 * A garment lifted a constant distance off the skin is paint: it goes down into
 * the cleavage and into the fold under each breast, and the figure reads as
 * naked and coloured in. Real cloth is under tension, and cloth under tension
 * spans a hollow on the chord across it and touches only what stands proud.
 * That is a membrane over an obstacle, and the membrane is what this solves
 * for: each vertex moves towards the average of its neighbours and is kept
 * from going below the skin it started on. Over anything convex the average is
 * below the vertex and the cloth stays down; across a hollow it is above, and
 * the cloth bridges. The hem is held where it was cut, so the garment still
 * meets the body at its edges.
 *
 * Per welded point, so the copies along a UV seam stay together, and moving
 * mostly off the skin rather than over it - see `SLIDE` - so the UVs and the
 * weights stay those of the skin underneath.
 *
 * `cap` bounds the bridge, as a function of the bind-space point, because the
 * skin under a bridge moves when the figure does and the cloth only follows its
 * weights: a sheet across the cleavage is fine, but one across the armpit would
 * go through the arm the moment the arm came down. For the same reason a
 * vertex loses its allowance as the named `limbs` take its weight, and is back
 * on the skin by half.
 */
/**
 * How far a draped vertex may slide over the skin, as a share of how far it may
 * stand off it. Enough for the cloth under a breast to reach the chord from the
 * nipple to the ribs; any more and neighbouring vertices sliding opposite ways
 * fold the cloth over itself.
 */
const SLIDE = 0.4;

function drapeLift({ px, nx, jx, wx, weld, tris, used, offset, cap, limbs = null, reach = 0.08 }) {
  const capAt = typeof cap === "function" ? cap : () => cap;
  const count = weld.length;
  // The welded mesh as rows of neighbours, compressed.
  const pairs = new Set();
  let edgeSum = 0;
  let edgeCount = 0;
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = weld[tris[i + e]];
      const b = weld[tris[i + ((e + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * count + b : b * count + a;
      if (pairs.has(key)) continue;
      pairs.add(key);
      edgeSum += Math.hypot(px[a * 3] - px[b * 3], px[a * 3 + 1] - px[b * 3 + 1], px[a * 3 + 2] - px[b * 3 + 2]);
      edgeCount += 1;
    }
  }
  const degree = new Int32Array(count + 1);
  for (const key of pairs) {
    degree[Math.floor(key / count) + 1] += 1;
    degree[(key % count) + 1] += 1;
  }
  for (let i = 0; i < count; i += 1) degree[i + 1] += degree[i];
  const fill = degree.slice(0, count);
  const rows = new Int32Array(degree[count]);
  for (const key of pairs) {
    const a = Math.floor(key / count);
    const b = key % count;
    rows[fill[a]++] = b;
    rows[fill[b]++] = a;
  }

  const hem = new Uint8Array(count);
  for (const [key, uses] of used) {
    if (uses !== 1) continue;
    const [a, b] = key.split(",").map(Number);
    hem[a] = 1;
    hem[b] = 1;
  }
  const limit = new Float64Array(count);
  const base = new Float64Array(count);
  const nodes = [];
  for (let v = 0; v < count; v += 1) {
    if (weld[v] !== v || degree[v + 1] === degree[v]) continue;
    base[v] = offset(v);
    if (hem[v]) continue;
    let share = 0;
    if (limbs) for (let k = 0; k < 4; k += 1) if (limbs.has(jx[v * 4 + k])) share += wx[v * 4 + k];
    limit[v] = Math.max(0, capAt(px[v * 3], px[v * 3 + 1], px[v * 3 + 2])) * clamp01(1 - 2 * share);
    if (limit[v] > 0) nodes.push(v);
  }

  // Solved twice, once as strings running up and down the body and once as
  // strings running round it, and the cloth takes whichever stands further off.
  // An even membrane cannot do what cloth does here, because the torso is a
  // cylinder: pulled evenly, the cloth is held down round the cylinder harder
  // than it is lifted across a fold, and comes away only along the bottom of
  // it. Cloth is pulled mostly one way at a time - a top hangs from the bust,
  // so it bridges the fold under the breast from top to bottom, and is pulled
  // across the chest, so it bridges the cleavage and the groove of the spine
  // from side to side - and each set of strings bridges one of those.
  //
  // Projected over-relaxed Gauss-Seidel, which converges in sweeps proportional
  // to the length of a string rather than its square.
  const edge = edgeSum / Math.max(1, edgeCount);
  const sweeps = Math.max(40, Math.min(200, Math.round((2.5 * reach) / Math.max(edge, 1e-4))));
  const weights = new Float64Array(rows.length);
  const anchor = new Float64Array(count * 3);
  for (let v = 0; v < count; v += 1) for (let k = 0; k < 3; k += 1) anchor[v * 3 + k] = px[v * 3 + k] + nx[v * 3 + k] * base[v];
  const solve = (upright) => {
    for (const v of nodes) {
      // Round the body is level and in the surface; up and down it is in the
      // surface and square to that - down the underside of a breast, too, where
      // the skin faces the floor and "vertical" would be across it.
      const n = [nx[v * 3], nx[v * 3 + 1], nx[v * 3 + 2]];
      let round = [n[2], 0, -n[0]];
      const size = Math.hypot(round[0], round[2]);
      round = size > 0.2 ? [round[0] / size, 0, round[2] / size] : [1, 0, 0];
      for (let r = degree[v]; r < degree[v + 1]; r += 1) {
        const u = rows[r];
        const d = [px[u * 3] - px[v * 3], px[u * 3 + 1] - px[v * 3 + 1], px[u * 3 + 2] - px[v * 3 + 2]];
        const normal = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        const across = d[0] * round[0] + d[2] * round[2];
        const flat = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - normal * normal || 1;
        const level = Math.min(1, (across * across) / flat);
        weights[r] = upright === null ? 1 : 0.04 + (upright ? 1 - level : level) ** 2;
      }
    }
    // Free to move in any direction but into the skin: along the normal only,
    // the underside of a breast - which faces the floor - could only be pushed
    // downwards, and never out to the chord from the nipple to the ribs.
    // `at` is where each point of the cloth is, the offset surface moved by
    // `move`, kept alongside it so a sweep reads one array.
    const move = new Float64Array(count * 3);
    const at = anchor.slice();
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      for (const v of nodes) {
        let total = 0;
        let tx = 0;
        let ty = 0;
        let tz = 0;
        for (let r = degree[v]; r < degree[v + 1]; r += 1) {
          const u = rows[r] * 3;
          const w = weights[r];
          tx += w * at[u];
          ty += w * at[u + 1];
          tz += w * at[u + 2];
          total += w;
        }
        const i = v * 3;
        const ax = nx[i];
        const ay = nx[i + 1];
        const az = nx[i + 2];
        const dx = move[i] + 1.7 * (tx / total - at[i]);
        const dy = move[i + 1] + 1.7 * (ty / total - at[i + 1]);
        const dz = move[i + 2] + 1.7 * (tz / total - at[i + 2]);
        // Not into the skin, not further off it than the cap, and not sliding
        // further over it than that either.
        const out = dx * ax + dy * ay + dz * az;
        const kept = Math.min(limit[v], Math.max(0, out));
        const sx = dx - out * ax;
        const sy = dy - out * ay;
        const sz = dz - out * az;
        const slid = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const scale = slid > limit[v] * SLIDE ? (limit[v] * SLIDE) / slid : 1;
        move[i] = sx * scale + kept * ax;
        move[i + 1] = sy * scale + kept * ay;
        move[i + 2] = sz * scale + kept * az;
        at[i] = anchor[i] + move[i];
        at[i + 1] = anchor[i + 1] + move[i + 1];
        at[i + 2] = anchor[i + 2] + move[i + 2];
      }
    }
    return move;
  };
  // Each vertex takes whichever set of strings holds it further off the skin,
  // blended over a fraction of a millimetre so the two regions meet smoothly.
  const down = solve(true);
  const round = solve(false);
  const move = new Float64Array(count * 3);
  for (const v of nodes) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < 3; k += 1) {
      a += down[v * 3 + k] * nx[v * 3 + k];
      b += round[v * 3 + k] * nx[v * 3 + k];
    }
    const t = smoothstep(-LIFT * 0.3, LIFT * 0.3, a - b);
    for (let k = 0; k < 3; k += 1) move[v * 3 + k] = round[v * 3 + k] + (down[v * 3 + k] - round[v * 3 + k]) * t;
  }
  // And the two blended, which can turn sharply where one takes over from the
  // other, smoothed as a field for a few sweeps - still off the skin, and never
  // further off it than the strings held it. Smoothing alone would lift the
  // points the strings rest on, the tip of a breast most of all, which is
  // exactly where a partner's chest meets it.
  const ceiling = new Float64Array(count);
  for (const v of nodes) {
    ceiling[v] = move[v * 3] * nx[v * 3] + move[v * 3 + 1] * nx[v * 3 + 1] + move[v * 3 + 2] * nx[v * 3 + 2] + LIFT * 0.1;
  }
  let from = move;
  let to = move.slice();
  for (let sweep = 0; sweep < 8; sweep += 1) {
    for (const v of nodes) {
      const d = [0, 0, 0];
      for (let r = degree[v]; r < degree[v + 1]; r += 1) {
        for (let k = 0; k < 3; k += 1) d[k] += from[rows[r] * 3 + k];
      }
      const n = degree[v + 1] - degree[v];
      for (let k = 0; k < 3; k += 1) d[k] = 0.5 * from[v * 3 + k] + (0.5 * d[k]) / n;
      const out = d[0] * nx[v * 3] + d[1] * nx[v * 3 + 1] + d[2] * nx[v * 3 + 2];
      const fix = Math.min(ceiling[v], Math.max(0, out)) - out;
      for (let k = 0; k < 3; k += 1) to[v * 3 + k] = d[k] + fix * nx[v * 3 + k];
    }
    [from, to] = [to, from];
  }
  move.set(from);
  return move;
}

/**
 * Lift a region of the body into a garment.
 *
 * `field` is a signed function of a point in bind space - positive inside the
 * garment - and `veto`, a signed margin per vertex, is `min`ed with it to keep
 * the garment off limbs the shape alone cannot tell it to avoid. The boundary
 * is where the result crosses zero, and triangles that straddle it are cut
 * there rather than being taken or dropped whole.
 *
 * The cutting is the difference between a garment and a rag, and it is worth
 * spelling out why, because taking whole triangles is obviously simpler and was
 * tried first. The scan is not uniformly tessellated: across the waist its
 * median edge is 5.4mm but its ninetieth percentile is 22.5mm and its longest
 * is 47.7mm, because a smooth cylinder of belly needs no detail and the mesher
 * gave it none. A whole-triangle rule puts the hem on those edges, so a
 * waistband that should be a line wanders up and down by a centimetre in
 * sawteeth - which is exactly how the first build rendered. Testing the
 * centroid instead of the corners halves the error and changes nothing about
 * its character. Only cutting removes it: the hem then lies on the zero set of
 * the field itself, to within the linear interpolation along one edge, and it
 * is straight because the field is.
 *
 * The hem is closed by a wall dropped from the boundary back down to the skin.
 * A region of surface offset outwards and left open is a decal with a crack
 * round it where the skin shows through the offset; the same region walled is a
 * piece of cloth with an edge. The wall is `LIFT` tall, which is a pixel at
 * figure scale and exactly the read wanted - not a visible band, but not a
 * surface that merges into the body either.
 *
 * Options, for the garments that are not all one piece of opaque cotton:
 *
 * - `layer` scales the lift, so pieces worn over one another stand off the skin
 *   by different amounts and do not fight over the same depth. A stocking is
 *   under everything, a garter strap over the stocking and the knickers, a
 *   harness over whatever the chest is wearing.
 * - `finish` says what the cloth is (see `GARMENT_FINISHES`). Only an opaque
 *   one hides the skin under it: lace has holes in it and a stocking is sheer,
 *   and the skin has to be there to be seen through them.
 * - `trim(x, y, z, f)` marks the parts of a garment made of something other
 *   than its body - a lace bra's straps and band, the elastic of a waistband, a
 *   stocking's welt - given the point and how far inside the garment it is.
 *   It is a signed distance into the trim, stored per vertex as `0.5 + d / TRIM`
 *   and read by the renderers as trim wherever it interpolates above a half.
 *   Stored as a distance rather than a yes or no because the renderers
 *   interpolate it across triangles five to twenty millimetres wide, and a flag
 *   interpolated over those draws its boundary wherever the tessellation puts
 *   it, while a distance interpolated over them puts it where the distance is
 *   zero - the same reason the hem is cut rather than taken from whole
 *   triangles.
 * - `trimColour` is what the trim is drawn in, where that is not the garment's
 *   own colour.
 * - `drape` lets the cloth leave the skin where the skin falls away under it
 *   (see `drapeLift`): `cap` is the most it may stand off, and `limbs` the
 *   joints whose share of a vertex takes that allowance away.
 *
 * The body's UVs come across with everything else, interpolated at the cuts,
 * so a pattern laid on the atlas - the lace - lies on the garment the way the
 * skin's own texture lies on the skin.
 */
function lift(scan, field, veto, colour, name, { bulge, layer = 1, finish = "cotton", trim, trimColour = null, drape = null } = {}) {
  const body = refine(scan, field, veto);
  const { f } = body;
  const count = body.positions.length / 3;

  // Vertices of the cut region, still on the skin. The lift is applied at the
  // end, so the field, the interpolation and the hem all work in one space.
  const px = [];
  const nx = [];
  const jx = [];
  const wx = [];
  const ux = [];
  const fx = [];
  const uvs = body.uvs ?? null;
  const fromVertex = new Int32Array(count).fill(-1);
  const fromCut = new Map();

  const keepVertex = (v) => {
    if (fromVertex[v] >= 0) return fromVertex[v];
    px.push(body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]);
    nx.push(body.normals[v * 3], body.normals[v * 3 + 1], body.normals[v * 3 + 2]);
    if (uvs) ux.push(uvs[v * 2], uvs[v * 2 + 1]);
    fx.push(f[v]);
    for (let k = 0; k < 4; k += 1) {
      jx.push(body.joints[v * 4 + k]);
      wx.push(body.weights[v * 4 + k]);
    }
    fromVertex[v] = px.length / 3 - 1;
    return fromVertex[v];
  };

  // A point on the edge from an inside vertex to an outside one.
  //
  // Its skin weights are the two ends' blended by the same parameter as its
  // position, which needs saying because the obvious cheaper thing - take the
  // inside end's weights outright - is what this did first and is what put the
  // teeth along the waistband. The reasoning behind it was that weights are a
  // choice of bones as much as a set of numbers, and blending slot-wise across
  // two vertices bound to different bones gives a vertex driven by a joint
  // neither end is attached to. That hazard is real; taking one end's weights
  // is not the way out of it.
  //
  // What taking one end costs is continuity. Consecutive hem vertices sit on
  // different edges of the scan, and those edges reach down to inside vertices
  // at quite different heights - the waist is tessellated in rows a few
  // millimetres apart and chords across it run to twenty - so the hem ends up
  // carrying a weight per vertex sampled from a scatter of points below it
  // rather than from the line it lies on. In bind space that is invisible,
  // because every one of those points is on the same skin and the hem is
  // exactly as flat as the field that cut it. Pose the figure and each hem
  // vertex follows whatever its donor did: measured on a standing figure the
  // waistband, dead flat in bind, came out spread over twenty-one millimetres
  // with nine-millimetre steps between neighbours. Teeth, in the mesh, needing
  // no help from the renderer - which is why raising the lift did not touch
  // them, why hiding the body showed them on the garment's own silhouette, and
  // why every measurement taken in bind space said the hem was perfect.
  //
  // Accumulating by joint rather than by slot keeps the safety and drops the
  // cost: a joint in the result came from one of the two ends by construction,
  // and taking the four heaviest and renormalising is what the four slots are
  // for. Dropping a fifth bone loses at most the lightest of four fractions of
  // a unit, against a hem that now varies as smoothly along its length as the
  // surface it was cut from.
  const cut = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (fromCut.has(key)) return fromCut.get(key);
    const span = f[a] - f[b];
    const t = clamp01(Math.abs(span) < 1e-12 ? 0.5 : f[a] / span);
    for (let k = 0; k < 3; k += 1) {
      px.push(body.positions[a * 3 + k] + (body.positions[b * 3 + k] - body.positions[a * 3 + k]) * t);
    }
    const n = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      n[k] = body.normals[a * 3 + k] + (body.normals[b * 3 + k] - body.normals[a * 3 + k]) * t;
    }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    nx.push(n[0] / len, n[1] / len, n[2] / len);
    if (uvs) {
      for (let k = 0; k < 2; k += 1) ux.push(uvs[a * 2 + k] + (uvs[b * 2 + k] - uvs[a * 2 + k]) * t);
    }
    fx.push(0);
    const blend = new Map();
    for (const [v, share] of [[a, 1 - t], [b, t]]) {
      for (let k = 0; k < 4; k += 1) {
        const weight = body.weights[v * 4 + k] * share;
        if (weight <= 0) continue;
        const joint = body.joints[v * 4 + k];
        blend.set(joint, (blend.get(joint) ?? 0) + weight);
      }
    }
    const best = [...blend].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = best.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (let k = 0; k < 4; k += 1) {
      jx.push(best[k] ? best[k][0] : 0);
      wx.push(best[k] ? best[k][1] / total : 0);
    }
    const index = px.length / 3 - 1;
    fromCut.set(key, index);
    return index;
  };

  // Skin well inside an opaque garment is never visible. Retain a narrow
  // border at cuffs and hems, where a cut fabric triangle only partly covers
  // its source skin triangle - which, since `refine`, means any of the scan's
  // triangles that some piece of it is not well inside.
  const hides = new Uint8Array(scan.indices.length / 3).fill(OPAQUE.has(finish) ? 1 : 0);
  // And, for `tessellate`, the scan's vertices with any of the garment over
  // them - see `withGarments`.
  const beneath = new Uint8Array(scan.positions.length / 3);
  const tris = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    const tri = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
    const inside = tri.filter((v) => f[v] > 0);
    if (!tri.every((v) => f[v] > LIFT * 0.5)) hides[body.source[i / 3]] = 0;
    if (!inside.length) continue;
    const source = body.source[i / 3] * 3;
    for (let k = 0; k < 3; k += 1) beneath[scan.indices[source + k]] = 1;
    if (inside.length === 3) {
      tris.push(keepVertex(tri[0]), keepVertex(tri[1]), keepVertex(tri[2]));
      continue;
    }
    // Rotate the triangle so the odd vertex out comes first. The winding has to
    // survive the rotation or the garment ends up with its face inwards, so the
    // odd vertex is found directly rather than by walking to the first sign
    // change - those are not the same index, and taking one for the other puts
    // the cut parameter on an edge whose ends are both outside. The result is
    // vertices interpolated far off the end of their edge: the first build of
    // this drew black spikes a metre long across the whole picture.
    if (inside.length === 1) {
      const k = tri.findIndex((v) => f[v] > 0);
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const c = tri[(k + 2) % 3];
      tris.push(keepVertex(a), cut(a, b), cut(a, c));
    } else {
      // Two inside. `c` is the one that is not, so `a` and `b` survive in
      // winding order and the quad they make with the two cut points is split
      // from `a`.
      const k = tri.findIndex((v) => !(f[v] > 0));
      const c = tri[k];
      const a = tri[(k + 1) % 3];
      const b = tri[(k + 2) % 3];
      const qb = cut(b, c);
      const qa = cut(c, a);
      const pa = keepVertex(a);
      tris.push(pa, keepVertex(b), qb, pa, qb, qa);
    }
  }
  if (!tris.length) return null;
  const coveredTriangles = [];
  for (let t = 0; t < hides.length; t += 1) if (hides[t]) coveredTriangles.push(t);

  // The scan is split along its UV seams: half of its edges are used by exactly
  // one triangle, because the two sides hold coincident copies of a vertex
  // rather than sharing it. That matters twice over. Counting edges by index
  // would call every seam a hem and drop a wall down the middle of the garment.
  // And a garment is an offset surface, so a vertex that exists twice with two
  // different normals gets pushed to two different places and the cloth tears
  // open along every seam - which is what put a row of teeth along the
  // waistband. Both go away by welding on position: one normal per point in
  // space, one edge per pair of points.
  let weld = new Int32Array(px.length / 3);
  const welds = new Map();
  for (let i = 0; i < weld.length; i += 1) {
    const key = `${Math.round(px[i * 3] * 1e6)},${Math.round(px[i * 3 + 1] * 1e6)},${Math.round(px[i * 3 + 2] * 1e6)}`;
    const seen = welds.get(key);
    if (seen === undefined) {
      welds.set(key, i);
      weld[i] = i;
    } else {
      weld[i] = seen;
      for (let k = 0; k < 3; k += 1) nx[seen * 3 + k] += nx[i * 3 + k];
    }
  }
  for (const seen of welds.values()) {
    const len = Math.hypot(nx[seen * 3], nx[seen * 3 + 1], nx[seen * 3 + 2]) || 1;
    for (let k = 0; k < 3; k += 1) nx[seen * 3 + k] /= len;
  }
  // The skin weights go across the weld with the normals, for the same reason
  // and to a much smaller effect. Coincident copies of a seam vertex are bound
  // to their bones by fractions of a unit the scan never had to keep consistent,
  // because both copies land on the same skin whichever set is used - the skin
  // is what the weights were fitted to. A garment is that surface pushed out
  // along a normal, so the two copies separate by the lift times the disagreement
  // once a bone turns. That is a fraction of a millimetre here, nowhere near the
  // teeth this was first written to explain - those were `cut` above - but a
  // point welded to one position and one normal has no business keeping two sets
  // of bones, and the copies are free to disagree by more on another scan.
  //
  // Taking the representative's outright rather than averaging: weights are a
  // choice of bones as much as a set of numbers, and one point in space needs
  // one choice. Which copy wins does not matter, only that the same one wins for
  // every triangle meeting there.
  for (let i = 0; i < weld.length; i += 1) {
    if (weld[i] === i) continue;
    for (let k = 0; k < 3; k += 1) nx[i * 3 + k] = nx[weld[i] * 3 + k];
    for (let k = 0; k < 4; k += 1) {
      jx[i * 4 + k] = jx[weld[i] * 4 + k];
      wx[i * 4 + k] = wx[weld[i] * 4 + k];
    }
  }
  const edgeKey = (a, b) =>
    weld[a] < weld[b] ? `${weld[a]},${weld[b]}` : `${weld[b]},${weld[a]}`;

  // An edge used by one triangle is on the hem. Counted on the cut mesh, so it
  // is the true boundary rather than whatever the original tessellation had.
  const used = new Map();
  const tally = () => {
    used.clear();
    for (let i = 0; i < tris.length; i += 3) {
      for (let e = 0; e < 3; e += 1) {
        const key = edgeKey(tris[i + e], tris[i + ((e + 1) % 3)]);
        used.set(key, (used.get(key) ?? 0) + 1);
      }
    }
  };
  tally();

  // The scan has holes of its own, a centimetre or two across, where a part
  // drawn separately covers the skin - the anatomy at the front of the pelvis
  // is one. Cut straight through, the cloth kept them, and with the anatomy
  // hidden under it they were two windows into the inside of the shorts. A hem
  // is a loop of cut points, every one of them with f = 0; a loop of the scan's
  // own vertices, all inside the garment and all close together, is one of
  // those holes, and the cloth is carried over it on a fan from its middle.
  // Grouped by what touches what rather than walked round, because a hole in
  // a scan can pinch to a point in the middle and walking a figure of eight
  // from one end loses the other half.
  const rim = [];
  const group = new Map();
  const root = (v) => {
    while (group.get(v) !== v) {
      group.set(v, group.get(group.get(v)));
      v = group.get(v);
    }
    return v;
  };
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = weld[tris[i + e]];
      const b = weld[tris[i + ((e + 1) % 3)]];
      if (!(fx[a] > 0 && fx[b] > 0) || used.get(edgeKey(a, b)) !== 1) continue;
      rim.push([a, b]);
      for (const v of [a, b]) if (!group.has(v)) group.set(v, v);
      group.set(root(a), root(b));
    }
  }
  const holes = new Map();
  for (const [a, b] of rim) {
    const key = root(a);
    if (!holes.has(key)) holes.set(key, { edges: [], ends: new Map() });
    const hole = holes.get(key);
    hole.edges.push([a, b]);
    hole.ends.set(a, (hole.ends.get(a) ?? 0) + 1);
    hole.ends.set(b, (hole.ends.get(b) ?? 0) - 1);
  }
  const patches = [];
  for (const { edges, ends } of holes.values()) {
    // Closed: every point on it is left as often as it is arrived at.
    if (edges.length < 3 || edges.length > 64 || [...ends.values()].some((n) => n !== 0)) continue;
    const loop = [...ends.keys()];
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const v of loop) {
      for (let k = 0; k < 3; k += 1) {
        lo[k] = Math.min(lo[k], px[v * 3 + k]);
        hi[k] = Math.max(hi[k], px[v * 3 + k]);
      }
    }
    if (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < 0.025) patches.push({ loop, edges });
  }
  for (const { loop, edges } of patches) {
    const n = px.length / 3;
    const mean = (array, width, k) => loop.reduce((sum, v) => sum + array[v * width + k], 0) / loop.length;
    for (let k = 0; k < 3; k += 1) px.push(mean(px, 3, k));
    const normal = [0, 1, 2].map((k) => mean(nx, 3, k));
    const len = Math.hypot(...normal) || 1;
    nx.push(normal[0] / len, normal[1] / len, normal[2] / len);
    if (uvs) ux.push(mean(ux, 2, 0), mean(ux, 2, 1));
    fx.push(loop.reduce((sum, v) => sum + fx[v], 0) / loop.length);
    const blend = new Map();
    for (const v of loop) {
      for (let k = 0; k < 4; k += 1) {
        if (wx[v * 4 + k] > 0) blend.set(jx[v * 4 + k], (blend.get(jx[v * 4 + k]) ?? 0) + wx[v * 4 + k]);
      }
    }
    const best = [...blend].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = best.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (let k = 0; k < 4; k += 1) {
      jx.push(best[k] ? best[k][0] : 0);
      wx.push(best[k] ? best[k][1] / total : 0);
    }
    // Each boundary edge runs a to b in the triangle that has it, so the patch
    // takes it b to a and faces the same way as the cloth round it.
    for (const [a, b] of edges) tris.push(b, a, n);
  }
  if (patches.length) {
    const grown = new Int32Array(px.length / 3);
    grown.set(weld);
    for (let i = weld.length; i < grown.length; i += 1) grown[i] = i;
    weld = grown;
    tally();
  }

  /* ---- lift it off the skin and hem it ---- */

  const offset = (i) =>
    LIFT * layer + (bulge ? bulge(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]) : 0);
  const draped = drape ? drapeLift({ px, nx, jx, wx, weld, tris, used, offset, ...drape }) : null;
  const shift = (w) => (draped ? Math.hypot(draped[w * 3], draped[w * 3 + 1], draped[w * 3 + 2]) : 0);
  const height = offset;

  const positions = [];
  const normals = [];
  const joints = [];
  const weights = [];
  const texcoords = [];
  const trims = [];
  const emit = (i, h, move = null) => {
    const m = move ? weld[i] * 3 : -1;
    positions.push(
      px[i * 3] + nx[i * 3] * h + (move ? move[m] : 0),
      px[i * 3 + 1] + nx[i * 3 + 1] * h + (move ? move[m + 1] : 0),
      px[i * 3 + 2] + nx[i * 3 + 2] * h + (move ? move[m + 2] : 0),
    );
    normals.push(nx[i * 3], nx[i * 3 + 1], nx[i * 3 + 2]);
    if (uvs) texcoords.push(ux[i * 2], ux[i * 2 + 1]);
    trims.push(trim ? 0.5 + trim(px[i * 3], px[i * 3 + 1], px[i * 3 + 2], fx[i]) / TRIM : 0);
    for (let k = 0; k < 4; k += 1) {
      joints.push(jx[i * 4 + k]);
      weights.push(wx[i * 4 + k]);
    }
    return positions.length / 3 - 1;
  };

  const face = new Int32Array(px.length / 3).fill(-1);
  const indices = [];
  for (const i of tris) {
    if (face[i] < 0) face[i] = emit(i, height(i), draped);
  }
  // Where the cloth has left the skin it has a shape of its own, and shading it
  // with the skin's normals would draw the cleavage it is stretched across. So
  // the face is re-shaded there from its own triangles, welded as the lift was,
  // fading back to the skin's normals where it lies on the skin.
  if (draped) {
    const shade = new Float64Array(px.length);
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [face[tris[i]], face[tris[i + 1]], face[tris[i + 2]]];
      const ux = positions[b * 3] - positions[a * 3];
      const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
      const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const vx = positions[c * 3] - positions[a * 3];
      const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
      const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const g = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (let e = 0; e < 3; e += 1) {
        const w = weld[tris[i + e]];
        for (let k = 0; k < 3; k += 1) shade[w * 3 + k] += g[k];
      }
    }
    // Twice over the triangles round each point, since the cloth's triangles
    // are the scan's, uneven, and their normals alone shade it in facets.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let w = 0; w < weld.length; w += 1) {
        const len = Math.hypot(shade[w * 3], shade[w * 3 + 1], shade[w * 3 + 2]) || 1;
        for (let k = 0; k < 3; k += 1) shade[w * 3 + k] /= len;
      }
      const spread = new Float64Array(shade.length);
      for (let i = 0; i < tris.length; i += 3) {
        const [a, b, c] = [weld[tris[i]], weld[tris[i + 1]], weld[tris[i + 2]]];
        for (let k = 0; k < 3; k += 1) {
          const sum = shade[a * 3 + k] + shade[b * 3 + k] + shade[c * 3 + k];
          spread[a * 3 + k] += sum;
          spread[b * 3 + k] += sum;
          spread[c * 3 + k] += sum;
        }
      }
      shade.set(spread);
    }
    for (let i = 0; i < face.length; i += 1) {
      if (face[i] < 0) continue;
      const w = weld[i];
      const len = Math.hypot(shade[w * 3], shade[w * 3 + 1], shade[w * 3 + 2]);
      const t = smoothstep(0, LIFT * 0.6, shift(w));
      if (len < 1e-12 || t <= 0) continue;
      const n = [0, 1, 2].map((k) => nx[i * 3 + k] + (shade[w * 3 + k] / len - nx[i * 3 + k]) * t);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = 0; k < 3; k += 1) normals[face[i] * 3 + k] = n[k] / l;
    }
  }
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(face[tris[i]], face[tris[i + 1]], face[tris[i + 2]]);
  }

  // Hem vertices are emitted again at both heights so the wall carries its own
  // normals. A two-millimetre wall sharing the face's smooth normals shades as
  // a continuation of the face and is invisible, and being seen is the whole
  // reason it is here.
  const wall = new Map();
  const at = (i, top) => {
    const w = weld[i];
    const key = `${w}|${top ? 1 : 0}`;
    if (!wall.has(key)) wall.set(key, emit(w, top ? height(w) : LIFT * Math.min(0.12, layer * 0.3)));
    return wall.get(key);
  };
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = tris[i + e];
      const b = tris[i + ((e + 1) % 3)];
      if (used.get(edgeKey(a, b)) !== 1) continue;
      // Wound so the wall's outward normal is the in-surface direction pointing
      // away from the triangle. With the face wound counter-clockwise seen from
      // outside - which the scan is - that falls out of the edge order for free.
      indices.push(at(a, true), at(a, false), at(b, false));
      indices.push(at(a, true), at(b, false), at(b, true));
    }
  }

  // Only the wall's normals are re-derived. Doing it over the whole garment
  // would flat-shade the face, which is a smooth offset of a smooth body and
  // should stay that way.
  const acc = new Float64Array(positions.length);
  const touched = new Set(wall.values());
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    if (!touched.has(a) && !touched.has(b) && !touched.has(c)) continue;
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      if (!touched.has(v)) continue;
      acc[v * 3] += gx;
      acc[v * 3 + 1] += gy;
      acc[v * 3 + 2] += gz;
    }
  }
  for (const v of touched) {
    const len = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]);
    if (len < 1e-12) continue;
    normals[v * 3] = acc[v * 3] / len;
    normals[v * 3 + 1] = acc[v * 3 + 1] / len;
    normals[v * 3 + 2] = acc[v * 3 + 2] / len;
  }

  return {
    name,
    primary: false,
    garment: true,
    finish,
    coveredTriangles,
    beneath,
    colour,
    trimColour: trim ? trimColour : null,
    trim: trim ? Float32Array.from(trims) : null,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: uvs ? Float32Array.from(texcoords) : null,
    indices: Uint32Array.from(indices),
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
  };
}

/**
 * A bra: two cups, a band under them and a strap over each shoulder.
 *
 * The cup is a ball rather than a cut-out patch of chest, because that is what a
 * cup is - a bra is not fabric laid on a breast, it is a shape the breast is put
 * into, and the boundary between covered and bare runs at a roughly constant
 * distance from a centre. `reach` is the apex-to-fold distance measured off this
 * particular body, so every dimension below moves with a bust slider and no
 * separate knob is needed.
 */
function bra(template, body, marks, colour, { lace = false } = {}) {
  const count = body.positions.length / 3;

  // The ball's centre is not the nipple. It sits back and down from it, about
  // where the breast meets the chest wall, and this matters more than it sounds
  // like it should. Centred on the apex, a ball has to be as deep as the breast
  // before its lower edge reaches the fold - because the chest falls away behind
  // as it descends, so the straight-line distance down to the band runs
  // diagonally - and a ball that big has swallowed the collarbone. At the radius
  // that does not, it stops above the band, and the bra renders as two discs
  // floating on the chest with bare skin underneath. Moving the centre inwards
  // lets one radius do both.
  const centre = [
    marks.apex[0],
    marks.apex[1] - marks.reach * 0.26,
    marks.apex[2] - marks.reach * 0.55,
  ];
  const cupR = marks.reach * 1.22;
  const cupTop = marks.apex[1] + marks.reach * 0.55;
  // The lace one plunges: the top edge falls from the strap towards the
  // centre, to a little above the fold, which is the cut lace is usually made
  // in and the one that shows the most of it.
  const plunge = marks.underY + marks.reach * 0.9;
  const topAt = lace
    ? (ax) => cupTop - (cupTop - plunge) * (1 - smoothstep(0.012, marks.apex[0] * 1.05, ax))
    : () => cupTop;
  const shoulderX = marks.shoulder ? marks.shoulder[12] : 0.095;

  // In the bind pose the arms hang at forty-five degrees with the hands beside
  // the hips, which puts the forearm at the same height as the band and a good
  // deal further out. Nothing here is subtle enough to tell the difference on
  // geometry alone - the first build banded both wrists - so the arms are
  // refused by name. The upper arm goes too: the strap passes over the
  // trapezius, which belongs to the clavicle and the spine, and a strap wide
  // enough to reach the deltoid is a sleeve.
  const veto = boneMargin(template, body, ARM_BONES);
  const probe = surfaceProbe(body, awayFrom(template, body, FOREARM_BONES));

  // How far forward the trunk reaches at a point on its front, arms left out so
  // a sample near the shoulder measures the trapezius and not the deltoid
  // hanging in front of it.
  //
  // A weighted mean over the neighbourhood and emphatically not the maximum over
  // it, which is what the profile in `measure` takes and is right there because
  // it is asked for the front of a whole slice. Asked for the front *at a point*
  // a maximum is biased by the slope, by the radius times the gradient, and the
  // chest between the sternum and the shoulder falls away at nearly forty-five
  // degrees: sampled that way these points came back nineteen to forty
  // millimetres proud of the surface they were meant to lie on, which is to say
  // in mid-air, and the strap cut from them was a few red flecks near the
  // collarbone. A symmetric weighting has no such bias - the two sides of the
  // slope cancel - and on a surface this smooth that is the whole of the error.
  const torso = jointSet(template, ARM_BONES);
  const frontNear = (x, y, radius) => {
    let sum = 0;
    let total = 0;
    for (let v = 0; v < count; v += 1) {
      if (body.positions[v * 3 + 2] <= 0) continue;
      if (torso.has(dominant(body, v))) continue;
      const dx = body.positions[v * 3] - x;
      const dy = body.positions[v * 3 + 1] - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const w = 1 - d / radius;
      sum += body.positions[v * 3 + 2] * w;
      total += w;
    }
    return total > 0 ? sum / total : -Infinity;
  };

  // Up the chest, over the trapezius and down the back. The rest is two straight
  // segments, because a single one from the shoulder to the back of the band
  // passes through the shoulder itself and a strap laid on it appears half
  // inside the deltoid.
  //
  // The run up the chest is sampled from the surface *around each point of the
  // strap* rather than from `marks.frontAt`, which is the forward profile of the
  // whole slice and so is the sternum. That distinction is the difference
  // between a strap and a row of red rags, and it is not obvious, because the
  // strap is only ever a few millimetres from the body either way and the field
  // is smooth wherever you evaluate it.
  //
  // What breaks is the *intersection*. A strap is the set of surface points
  // within 9.2mm of this line, so its width is `2*sqrt(9.2^2 - h^2)` where `h`
  // is how far the line sits under the skin - fine at four millimetres, nothing
  // at all past nine, and worst in between, where the width is changing fastest
  // with `h` and the tube meets the surface almost tangentially. At the shoulder
  // the sternum is some seventy millimetres forward of the chest the strap
  // crosses, so `h` ran through that whole range along one strap: the band
  // pinched, broke, and went ragged where it grazed, and no amount of looking at
  // the hem explained it because the hem was exactly where the field said. With
  // the line laid on the surface it crosses, `h` is four millimetres for the
  // length of it. The backward dive that used to be here was an attempt to
  // correct the sternum error with a constant and is not needed once the error
  // is gone.
  const strap = (side) => {
    const points = [];
    const shoulderY = marks.underY + 0.135;
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const y = cupTop + (shoulderY - cupTop) * t;
      const x = side * (marks.apex[0] * 1.02 + (shoulderX * 0.78 - marks.apex[0] * 1.02) * t);
      const surface = frontNear(x, y, 0.018);
      points.push([x, y, (surface > -Infinity ? surface : marks.frontAt(y)) - 0.004]);
    }
    // Over the trapezius and down the back to the band, laid on the skin the
    // way the other straps here are: two guesses at where the back was, which
    // is what this used to be, left the strap in the air behind the shoulder
    // blade and it stopped halfway down it.
    const back = surfacePath(probe, [
      points[points.length - 1],
      [side * shoulderX * 0.8, shoulderY + 0.03, -0.012],
      [side * shoulderX * 0.78, shoulderY - 0.04, marks.backAt(shoulderY - 0.04) - 0.01],
      [side * marks.hipWidth * 0.62, marks.underY + 0.002, marks.backAt(marks.underY) - 0.01],
    ], { depth: 0.004, steps: 6 });
    return [...points, ...back.slice(1)];
  };

  // Once, not once per vertex. `field` below is called for every vertex of the
  // scan and used to rebuild these two polylines each time, which cost nothing
  // worth noticing while they were arithmetic on landmarks; now that a point of
  // one is a search over the mesh for the surface beside it, the same line
  // turned a two-second build into one that does not finish.
  const lines = [strap(-1), strap(1)];

  const parts = (x, y, z) => {
    const side = x >= 0 ? 1 : -1;

    // The cup: the ball, cut off level above so the top edge of the bra is a
    // line rather than a circle - which is what a balconette is, and the most
    // ordinary thing to put someone in - and trimmed at the back so it does not
    // wrap round the ribs into the armpit.
    const d = Math.hypot(x - side * centre[0], y - centre[1], z - centre[2]);
    const cup =
      z > marks.apex[2] - marks.reach * 1.5 ? Math.min(cupR - d, topAt(Math.abs(x)) - y) : -1;

    // The band, all the way round at the fold.
    const band = Math.min(marks.underY + 0.006 - y, y - (marks.underY - 0.026));

    // The straps.
    const line = lines[side > 0 ? 1 : 0];
    let near = Infinity;
    for (let k = 0; k + 1 < line.length; k += 1) {
      const dist = toSegment([x, y, z], line[k], line[k + 1]);
      if (dist < near) near = dist;
    }

    // A lace bra hangs from something finer than a plain one's strap.
    return [cup, band, (lace ? 0.0068 : 0.0092) - near];
  };
  const field = (x, y, z) => Math.max(...parts(x, y, z));

  if (!lace) return lift(body, field, veto, colour, "bra", { drape: { cap: 0.008, limbs: jointSet(template, ARM_BONES) } });
  // Lace in the cups; the band, the straps and a narrow edge round the cups
  // are satin, because that is what holds a lace bra up and its shape together.
  const edge = hem(0.0025);
  return lift(body, field, veto, colour, "lace-bra", {
    finish: "lace",
    trim: (x, y, z, f) => {
      const [, band, strap] = parts(x, y, z);
      return Math.max(band, strap, edge(x, y, z, f));
    },
  });
}

/**
 * Briefs.
 *
 * The waistband is a height and the leg openings are a curve in azimuth, which
 * between them is the whole cut. Low at the front and back and high at the
 * sides is the shape of every pair of briefs ever made, and it is not a style
 * choice - it is where the leg meets the trunk. Squaring the sine gives the
 * curve directly, with no fitting needed.
 *
 * Below the crotch the trunk is two thighs rather than one body, and a region
 * defined by azimuth about the trunk's axis will happily wrap each of them.
 * That is what the crotch height is measured for: nothing below it is kept
 * except on the front and back midline, where there is still one body.
 *
 * On a man the briefs are given a bulge, and it is not decoration. The genitals
 * are drawn as separate submeshes that stand well clear of the surface these
 * vertices come from, so an offset of two and a half millimetres would have the
 * shaft straight through the front panel. `withGarments` drops those submeshes
 * when briefs are worn - they are under the cloth, and cloth is opaque - and
 * the bulge is what stands in for them.
 */
function briefs(template, body, marks, colour, { bulge = 0, swim = false } = {}) {
  const veto = boneMargin(template, body, new RegExp(`${LOWER_LEG_BONES.source}|${ARM_BONES.source}`));

  // Swim briefs are the same cut sitting lower on the hip, which is all that
  // tells them apart on a body - and in lycra rather than cotton.
  const plain = marks.waistY - (marks.waistY - marks.hipY) * 0.35;
  const waist = swim ? marks.crotchY + (plain - marks.crotchY) * 0.85 : plain;
  const rise = (waist - marks.crotchY) * 0.72;

  const field = (x, y, z) => {
    const side = Math.sin(Math.atan2(x, z)) ** 2;
    return Math.min(waist - y, y - (marks.crotchY + rise * side));
  };

  // The bulge tapers in every direction from the front of the crotch, so the
  // panel swells and the waistband does not.
  const shape = bulgeShape(marks, bulge);
  return swim
    ? lift(body, field, veto, colour, "swim-briefs", { bulge: shape, finish: "lycra" })
    : lift(body, field, veto, colour, "briefs", { bulge: shape });
}

/**
 * Low-rise bottoms cut from a front panel, a back panel and a string over each
 * hip: the bikini, and the lace thong, which is the same with the back panel
 * narrowed to a strip.
 *
 * The panels are widths in x as a function of height - wide at the top,
 * narrowing to a gusset at the crotch - rather than curves in azimuth like the
 * briefs' leg openings, because that is how these are cut: the leg opening of
 * a bikini runs up over the hip bone, nearly to the string, which no curve in
 * azimuth that also closes at the crotch can do. Front and back are told apart
 * by which side of the pelvis a point is on, so the gusset under the body is
 * where the two widths meet, and they are close enough there to meet without a
 * step.
 */
function lowRise(template, body, marks, colour, { thong = false, bulge = 0 } = {}) {
  const veto = boneMargin(template, body, new RegExp(`${LOWER_LEG_BONES.source}|${ARM_BONES.source}`));
  const rise = marks.waistY - marks.crotchY;
  const frontTop = marks.crotchY + rise * 0.42;
  const backTop = marks.crotchY + rise * 0.5;
  const hipTop = marks.crotchY + rise * 0.56;
  const band = thong ? 0.0065 : 0.005;
  const zc = marks.pelvisZ;

  const parts = (x, y, z) => {
    const ax = Math.abs(x);
    const forward = z > zc;
    const side = Math.sin(Math.atan2(x, z - zc)) ** 2;
    const middle = forward ? frontTop : backTop;
    const top = middle + (hipTop - middle) * side;
    const string = Math.min(top - y, y - (top - band));
    const t = clamp01((y - marks.crotchY) / (middle - marks.crotchY));
    const half = forward
      ? (thong ? 0.014 + 0.05 * t ** 0.9 : 0.015 + 0.045 * t ** 0.85)
      : thong
        ? 0.004 + 0.028 * smoothstep(0.72, 1, t)
        : 0.02 + 0.07 * t ** 0.7;
    const panel = Math.min(top - y, half - ax, y - (marks.crotchY - 0.02));
    return [string, panel];
  };
  const field = (x, y, z) => Math.max(...parts(x, y, z));
  const shape = bulgeShape(marks, bulge);

  if (!thong) return lift(body, field, veto, colour, "bikini-bottom", { bulge: shape, finish: "lycra" });
  // On a man the front panel stands off the skin by the bulge, and lace with
  // holes in it over a hollow two centimetres deep is a view into the figure,
  // not through a garment. So there it is made solid.
  const edge = hem(0.0022);
  return lift(body, field, veto, colour, "lace-thong", {
    bulge: shape,
    finish: bulge ? "lycra" : "lace",
    trim: bulge ? undefined : (x, y, z, f) => Math.max(parts(x, y, z)[0], edge(x, y, z, f)),
  });
}

/**
 * A triangle bikini top: a triangle over each breast, a string under both and
 * round the back, and a halter string from the top of each cup round the neck.
 *
 * The triangles are drawn on the front of the body as it is seen from ahead,
 * which is how a triangle top is cut - flat panels, gathered on the string -
 * and they are sized off the same apex-to-fold reach as the bra's cup, so they
 * grow with the bust.
 */
function bikiniTop(template, body, marks, colour) {
  const veto = boneMargin(template, body, ARM_BONES);
  const probe = surfaceProbe(body, awayFrom(template, body, FOREARM_BONES));
  const { apex, reach, underY } = marks;
  const back = apex[2] - reach * 1.8;
  const arms = jointSet(template, ARM_BONES);
  const p = body.positions;

  // A triangle top is hung from above the nipple, which is not the apex: the
  // apex is the middle of the most forward ring of the chest, and the breast
  // points outwards, so on every scan here the nipple is a centimetre and a
  // half further out. It is the point that stands furthest forward along a
  // line turned twenty degrees outwards, where it stands proud of the breast.
  const [sin, cos] = [Math.sin(0.35), Math.cos(0.35)];
  const tips = [null, null];
  for (let v = 0; v < p.length / 3; v += 1) {
    if (Math.abs(p[v * 3 + 1] - apex[1]) > reach || arms.has(dominant(body, v))) continue;
    const s = p[v * 3] > 0 ? 1 : 0;
    const forward = Math.abs(p[v * 3]) * sin + p[v * 3 + 2] * cos;
    if (!tips[s] || forward > tips[s][0]) tips[s] = [forward, Math.abs(p[v * 3]), p[v * 3 + 1]];
  }
  const nipple = tips[0] && tips[1] ? [(tips[0][1] + tips[1][1]) / 2, (tips[0][2] + tips[1][2]) / 2] : [apex[0], apex[1]];

  // The outer corner comes down to the band where the trunk still faces
  // forward. Out as far as the bust is big, as the bra's cup is, it is three to
  // five centimetres past the side of the trunk; nearer, but where the skin
  // already faces sideways, a cut along x meets it almost edge-on and comes out
  // ragged, and the cut at `back` takes the rest off in a hook. So it is walked
  // out along the band, on the skin as it is seen from ahead, until the trunk
  // turns more than fifty degrees away, on whichever side turns first.
  const belt = [];
  const I = body.indices;
  for (let k = 0; k < I.length; k += 3) {
    const tri = [I[k], I[k + 1], I[k + 2]];
    if (arms.has(dominant(body, tri[0]))) continue;
    const ys = tri.map((v) => p[v * 3 + 1]);
    if (Math.min(...ys) <= underY && Math.max(...ys) >= underY) belt.push(tri);
  }
  const ahead = (x) => {
    let z = -Infinity;
    for (const [a, b, c] of belt) {
      const den = (p[b * 3 + 1] - p[c * 3 + 1]) * (p[a * 3] - p[c * 3]) + (p[c * 3] - p[b * 3]) * (p[a * 3 + 1] - p[c * 3 + 1]);
      if (Math.abs(den) < 1e-14) continue;
      const u = ((p[b * 3 + 1] - p[c * 3 + 1]) * (x - p[c * 3]) + (p[c * 3] - p[b * 3]) * (underY - p[c * 3 + 1])) / den;
      const w = ((p[c * 3 + 1] - p[a * 3 + 1]) * (x - p[c * 3]) + (p[a * 3] - p[c * 3]) * (underY - p[c * 3 + 1])) / den;
      if (u < 0 || w < 0 || u + w > 1) continue;
      z = Math.max(z, u * p[a * 3 + 2] + w * p[b * 3 + 2] + (1 - u - w) * p[c * 3 + 2]);
    }
    return z;
  };
  const STEP = 0.003;
  let flank = apex[0] - reach * 0.4;
  while (flank < apex[0] + reach * 1.1) {
    const drop = Math.max(ahead(flank) - ahead(flank + STEP), ahead(-flank) - ahead(-flank - STEP));
    if (!(drop < STEP * 1.2)) break;
    flank += STEP;
  }

  // Counter-clockwise seen from the front, on the +x side; the other side is
  // the mirror image. With the corner where the trunk still faces forward, a
  // straight outer edge passes inside the nipple, so the outer edge goes out
  // round it instead: straight up from the corner to a centimetre outside the
  // nipple, and from there back in to the top on the arc through all three,
  // the way the gathered edge of a triangle sits round the breast rather than
  // across it. The arc all the way down bows out over the fold, and the cup
  // followed the fold round the side in a claw.
  const [top, corner, beside] = [
    [nipple[0] - 0.004, apex[1] + reach * 1.2],
    [flank, underY - 0.001],
    [nipple[0] + 0.01, nipple[1]],
  ];
  const edges = [
    [top, [0.011, underY - 0.004]],
    [[0.011, underY - 0.004], corner],
    [corner, beside],
  ].map(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a, [(b[0] - a[0]) / len, (b[1] - a[1]) / len]];
  });
  const circle = (() => {
    const [[ax, ay], [bx, by], [cx, cy]] = [top, corner, beside];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const centre = [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
    return { centre, radius: Math.hypot(ax - centre[0], ay - centre[1]) };
  })();

  const neckY = (template.jointByBone.get("neck")?.rest?.[13] ?? 0.85) - 0.008;
  const halter = [-1, 1].map((side) =>
    surfacePath(probe, [
      [side * top[0], top[1], marks.frontAt(top[1]) - 0.01],
      [side * 0.04, top[1] + 0.03, marks.frontAt(top[1] + 0.03) - 0.01],
      [side * 0.03, neckY - 0.008, 0.0],
      [side * 0.014, neckY, -0.028],
      [0, neckY + 0.002, -0.034],
    ])
  );
  const strings = straps(halter, { width: 0.006 });

  const field = (x, y, z) => {
    const ax = Math.abs(x);
    let cup = -1;
    if (z > back) {
      cup = circle.radius - Math.hypot(ax - circle.centre[0], y - circle.centre[1]);
      for (const [a, e] of edges) cup = Math.min(cup, e[0] * (y - a[1]) - e[1] * (ax - a[0]));
    }
    const band = Math.min(y - (underY - 0.0045), underY + 0.0005 - y);
    return Math.max(cup, band, strings(x, y, z));
  };
  return lift(body, field, veto, colour, "bikini-top", { finish: "lycra" });
}

/**
 * Stockings: each leg from the toes to the top of the thigh, sheer, with a
 * denser welt at the top.
 *
 * Under everything else - the lowest layer there is, so shorts, straps and
 * knickers all go over it - and the skin stays under it, since the skin is what
 * a stocking is seen by.
 */
function stockings(template, body, marks, colour) {
  const veto = boneMargin(template, body, ARM_BONES);
  const top = stockingTop(marks);
  const welt = 0.028;
  return lift(body, (x, y) => top - y, veto, colour, "stockings", {
    finish: "sheer",
    layer: 0.5,
    // Measured from the top edge itself rather than from `f`, which the arm
    // veto caps at two centimetres and so cannot tell a welt from a calf.
    trim: (x, y) => welt - (top - y),
  });
}

/**
 * A garter belt: a band of lace round the waist and four suspenders from it to
 * the stocking tops, one down the front of each thigh and one down the side.
 *
 * The suspenders are laid on the skin through guides on the belly, over the
 * hip and on the thigh, and end halfway down the welt, where a clip would
 * hold them. Over the stockings and the knickers, so both sit under the
 * straps as they would.
 */
function garterBelt(template, body, marks, colour) {
  const veto = boneMargin(template, body, ARM_BONES);
  const probe = surfaceProbe(body, awayFrom(template, body, ARM_BONES));
  const beltTop = marks.waistY + 0.004;
  const beltBottom = marks.waistY - 0.04;
  const end = stockingTop(marks) - 0.014;
  const zc = marks.pelvisZ;
  const lines = [];
  for (const side of [-1, 1]) {
    const thigh = marks.legAt(end, side);
    const mid = marks.crotchY + 0.015;
    lines.push(
      surfacePath(probe, [
        [side * 0.052, beltBottom + 0.004, marks.frontAt(beltBottom)],
        [thigh[0] - side * 0.004, end, thigh[2] + 0.06],
      ], { steps: 10 }),
      surfacePath(probe, [
        [side * marks.wideAt(beltBottom), beltBottom + 0.004, zc],
        [side * (marks.wideAt(mid) + 0.01), mid + 0.02, zc - 0.005],
        [thigh[0] + side * 0.06, end, thigh[2]],
      ])
    );
  }
  const suspenders = straps(lines, { width: 0.0075 });
  const belt = (y) => Math.min(beltTop - y, y - beltBottom);
  const edge = hem(0.0025);
  return lift(body, (x, y, z) => Math.max(belt(y), suspenders(x, y, z)), veto, colour, "garter-belt", {
    finish: "lace",
    layer: 1.6,
    trim: (x, y, z, f) => Math.max(suspenders(x, y, z), edge(x, y, z, f)),
  });
}

/**
 * Boxer briefs: waist to mid-thigh, close fitting, with a waistband in a
 * contrasting elastic. The shorts' region, cut tighter and higher, with the
 * bulge a man's briefs carry.
 */
function boxerBriefs(template, body, marks, colour, { bulge = 0 } = {}) {
  const veto = boneMargin(template, body, ARM_BONES);
  const waist = marks.waistY - 0.006;
  const band = 0.024;
  return lift(body, (x, y) => Math.min(waist - y, y - (marks.crotchY - 0.075)), veto, colour, "boxer-briefs", {
    bulge: bulgeShape(marks, bulge),
    trim: (x, y) => y - (waist - band),
    trimColour: contrast(colour),
  });
}

/**
 * A jockstrap: a wide elastic waistband low on the hips, a pouch, and a strap
 * from the bottom of the pouch under each buttock to the band at the side -
 * which leaves the buttocks bare, and is the point of it.
 */
function jockstrap(template, body, marks, colour, { bulge = 0 } = {}) {
  const veto = boneMargin(template, body, new RegExp(`${LOWER_LEG_BONES.source}|${ARM_BONES.source}`));
  const probe = surfaceProbe(body, awayFrom(template, body, new RegExp(`${LOWER_LEG_BONES.source}|${ARM_BONES.source}`)));
  const crotch = marks.crotchY;
  const bandTop = crotch + (marks.waistY - crotch) * 0.78;
  const bandBottom = bandTop - 0.026;
  const zc = marks.pelvisZ;
  const lines = [-1, 1].map((side) =>
    surfacePath(probe, [
      [side * 0.014, crotch - 0.004, zc - 0.008],
      [side * 0.045, crotch + 0.006, marks.backAt(crotch + 0.006) * 0.6],
      [side * 0.08, crotch + 0.024, marks.backAt(crotch + 0.024) * 0.8],
      [side * (marks.wideAt(bandBottom) - 0.012), bandBottom + 0.004, zc - 0.045],
    ], { steps: 6 })
  );
  const legStraps = straps(lines, { width: 0.012 });
  const parts = (x, y, z) => {
    const band = Math.min(bandTop - y, y - bandBottom);
    let pouch = -1;
    if (z > zc) {
      const t = clamp01((y - crotch) / (bandBottom - crotch));
      pouch = Math.min(bandBottom + 0.002 - y, 0.017 + 0.038 * t ** 0.8 - Math.abs(x), y - (crotch - 0.02));
    }
    return [band, pouch, legStraps(x, y, z)];
  };
  return lift(body, (x, y, z) => Math.max(...parts(x, y, z)), veto, colour, "jockstrap", {
    bulge: bulgeShape(marks, bulge),
    trim: (x, y, z) => {
      const [band, , strap] = parts(x, y, z);
      return Math.max(band, strap);
    },
    trimColour: contrast(colour),
  });
}

/**
 * A chest harness in leather: a ring on the sternum, a strap from it over each
 * shoulder and down the back to a second ring between the shoulder blades, and
 * a strap from it round each side under the arm to the same ring behind.
 *
 * On a woman the front ring sits between the breasts and the side straps run
 * under them, which is where a harness is worn over a bust. Worn over whatever
 * else is on the chest.
 */
function harness(template, body, marks, colour, bodyType) {
  const veto = boneMargin(template, body, ARM_BONES);
  const probe = surfaceProbe(body, awayFrom(template, body, FOREARM_BONES));
  const female = bodyType === "female";
  const ringY = female ? (marks.apex[1] + marks.underY) / 2 + 0.004 : marks.apex[1] - 0.012;
  const sideY = female ? marks.underY - 0.009 : ringY - 0.022;
  const backY = ringY + 0.035;
  const front = probe([0, ringY, marks.frontAt(ringY)]);
  const back = probe([0, backY, marks.backAt(backY)]);
  const shoulderY = (template.jointByBone.get("neck")?.rest?.[13] ?? 0.85) - 0.014;
  const lines = [];
  for (const side of [-1, 1]) {
    lines.push(
      surfacePath(probe, [
        [side * 0.009, ringY + 0.01, front.point[2]],
        [side * 0.036, ringY + 0.05, marks.frontAt(ringY + 0.05) - 0.01],
        [side * 0.062, shoulderY, 0],
        [side * 0.05, shoulderY - 0.04, marks.backAt(shoulderY - 0.04)],
        [side * 0.009, backY + 0.012, back.point[2]],
      ], { steps: 6 }),
      surfacePath(probe, [
        [side * 0.012, ringY - 0.002, front.point[2]],
        [side * 0.06, sideY, marks.frontAt(sideY) - 0.015],
        [side * marks.wideAt(sideY), sideY - 0.004, marks.pelvisZ],
        [side * 0.06, backY - 0.012, marks.backAt(backY - 0.012)],
        [side * 0.012, backY, back.point[2]],
      ], { steps: 6 })
    );
  }
  const belts = straps(lines, { width: 0.011 });
  const ring = (centre, x, y, z) =>
    0.003 - Math.abs(Math.hypot(x - centre.point[0], y - centre.point[1], z - centre.point[2]) - 0.012);
  const rings = (x, y, z) => Math.max(z > front.point[2] - 0.03 ? ring(front, x, y, z) : -1, z < back.point[2] + 0.03 ? ring(back, x, y, z) : -1);
  return lift(body, (x, y, z) => Math.max(belts(x, y, z), rings(x, y, z)), veto, colour, "harness", {
    finish: "leather",
    layer: 2.2,
    // The rings are steel.
    trim: rings,
    trimColour: [0.62, 0.62, 0.64],
  });
}

/**
 * The trim of a garment with several bands - a hem at each edge - as the
 * distance into the nearest of them. Held above a floor, since an edge a
 * band is not measured from (a sleeve's, off the arm) is infinitely far, and
 * an infinite trim would interpolate across a triangle into nonsense.
 */
const bands = (depths) => Math.max(-0.05, ...depths);

/** Simple studio clothing follows the same skin weights as the scanned body. */
function studioGarment(template, body, marks, colour, name, bodyType) {
  const top = name === 'top';
  if (!top) {
    const waist = (y) => marks.waistY - 0.012 - y;
    const legs = (y) => y - (marks.crotchY - 0.11);
    const field = (x, y) => Math.min(waist(y), legs(y));
    // A waistband three centimetres deep and a hem at each leg, which the
    // renderer draws ribbed and sewn on - a pair of shorts all one surface to
    // the edge is a pair painted on.
    return lift(body, field, boneMargin(template, body, ARM_BONES), colour, name, {
      trim: (x, y) => bands([0.018 - waist(y), 0.012 - legs(y)]),
    });
  }
  // The neckline and the sleeves are cut on the skeleton's geometry rather than
  // on the skin weights, which is what they were cut on first and what gave the
  // collar its ragged edge: the share of the neck's weight round the base of
  // the neck wanders a centimetre either way between neighbouring vertices. A
  // crew neck is an oval round the base of the neck, wider in front so it
  // drops to the notch between the collarbones; a sleeve is a plane across the
  // upper arm, a little above the elbow.
  const neck = template.jointByBone.get("neck")?.rest;
  const neckY = (neck?.[13] ?? 0.85) - 0.002;
  const neckZ = neck?.[14] ?? 0;
  const arms = [];
  for (const side of ["l", "r"]) {
    const a = template.jointByBone.get(`shoulder_${side}`)?.rest;
    const b = template.jointByBone.get(`elbow_${side}`)?.rest;
    if (!a || !b) continue;
    const axis = [b[12] - a[12], b[13] - a[13], b[14] - a[14]];
    const len = Math.hypot(...axis) || 1;
    arms.push({ from: [a[12], a[13], a[14]], axis: axis.map((v) => v / len), len });
  }
  const sleeve = (x, y, z) => {
    let best = Infinity;
    for (const { from, axis, len } of arms) {
      const d = [x - from[0], y - from[1], z - from[2]];
      const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
      const r = Math.hypot(d[0] - t * axis[0], d[1] - t * axis[1], d[2] - t * axis[2]);
      // Only on the arm itself: the plane carried on would cut the waist.
      if (r < 0.045 && t > 0) best = Math.min(best, len * 0.72 - t);
    }
    return best;
  };
  // Round the neck rather than across it: the top of the shoulder by the neck
  // is all but level, and a level cut through a level surface wanders. Only
  // down to the shoulders, though: the oval is a column, and lower down it
  // meets the small of the back where the spine curves forward into it.
  const collar = (x, y, z) => {
    if (y < neckY - 0.07) return Infinity;
    const dz = z - neckZ;
    const r = Math.hypot(x / 0.05, dz / (dz > 0 ? 0.05 : 0.036));
    return (r - 1) * 0.05;
  };
  const field = (x, y, z) =>
    Math.min(
      y - (marks.waistY - 0.035),
      neckY + 0.012 - y,
      collar(x, y, z),
      sleeve(x, y, z),
    );
  // Draped from the bust only: across the cleavage and under each breast is
  // where a top painted on reads as skin. Below the bust it is let back down
  // to the belly by five centimetres under the fold, and a flat chest is not
  // draped at all, because a figure's belly and chest are exactly what a
  // partner's are pressed against - a shirt hung off a man's pectorals stands
  // a centimetre off his stomach, and in an embrace that centimetre is inside
  // the other figure.
  const veto = boneMargin(template, body, FOREARM_BONES);
  const bust = marks.underY;
  // A ribbed collar a centimetre and a half deep, and the sleeves and the
  // bottom turned up and sewn two centimetres from the edge.
  const trim = (x, y, z) =>
    bands([
      0.009 - Math.min(collar(x, y, z), neckY + 0.012 - y),
      0.012 - sleeve(x, y, z),
      0.012 - (y - (marks.waistY - 0.035)),
    ]);
  return lift(body, field, veto, colour, name, {
    trim,
    drape: bodyType === "female" && {
      cap: (x, y) => 0.014 * smoothstep(bust - 0.05, bust - 0.005, y),
      limbs: jointSet(template, /upperarm|lowerarm|hand/),
    },
  });
}

/**
 * Cuffs: a strap round each wrist and each ankle, which is what a restrained
 * figure in the references is wearing and all that tells one from a figure
 * lying in the same pose of their own accord.
 *
 * Each strap is a slice of the limb between two distances back from the joint
 * it closes on - measured along the bone off this skeleton's own rest pose, so
 * it lands above the wrist and the ankle bone on either scan - and is thicker
 * than cloth, because a strap that stands off the skin by what a shirt does
 * reads as a tan line. The veto is the arm and lower-leg share turned round:
 * in the bind pose the hands are no further from the thighs than a strap is
 * wide, and a band cut on distance alone takes a bite out of each hip.
 */
function cuffs(template, body, colour) {
  const bands = [];
  for (const side of ["l", "r"]) {
    for (const [upper, lower, near, far] of [
      ["elbow", "wrist", 0.008, 0.03],
      ["knee", "ankle", 0.016, 0.042],
    ]) {
      const a = template.jointByBone.get(`${upper}_${side}`)?.rest;
      const b = template.jointByBone.get(`${lower}_${side}`)?.rest;
      if (!a || !b) continue;
      const axis = [b[12] - a[12], b[13] - a[13], b[14] - a[14]];
      const len = Math.hypot(...axis) || 1;
      bands.push({ end: [b[12], b[13], b[14]], axis: axis.map((v) => v / len), near, far });
    }
  }
  const veto = boneMargin(template, body, /lowerarm|hand_|calf|foot/).map((margin) => -margin);
  const field = (x, y, z) => {
    let best = -Infinity;
    for (const { end, axis, near, far } of bands) {
      const d = [x - end[0], y - end[1], z - end[2]];
      const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
      const r = Math.hypot(d[0] - t * axis[0], d[1] - t * axis[1], d[2] - t * axis[2]);
      best = Math.max(best, Math.min(t + far, -near - t, 0.045 - r));
    }
    return best;
  };
  const thickness = 0.0025 / 1.72;
  return lift(body, field, veto, colour, "cuffs", { bulge: () => thickness, finish: "leather" });
}

/**
 * Dress a template.
 *
 * @param {object} template a template from `featureRelief`
 * @param {object} [options]
 * @param {string} [options.bodyType]
 * @param {string[]} [options.wearing] names from GARMENT_NAMES; `[]` for none
 * @param {string} [options.colour] a key of `GARMENT_COLOURS`
 * @returns {object} a new template; the original is not touched
 */
export function withGarments(template, { bodyType = "neutral", wearing, colour = "black" } = {}) {
  // The scene has already done this and said what it dropped; this is for
  // callers that have not, since the result of skipping it is two pieces
  // fighting over the same skin.
  const wanted = resolveWearing(wearing ?? []).wearing;
  if (!wanted.length) return template;
  const body = template.submeshes.find((submesh) => submesh.primary);
  if (!body) return template;

  const tone = GARMENT_COLOURS[colour] ?? GARMENT_COLOURS.black;
  const marks = measure(template, body);
  const bulge = bodyType === "male" ? 0.021 : 0;
  const makers = {
    bra: () => bra(template, body, marks, tone),
    "lace-bra": () => bra(template, body, marks, tone, { lace: true }),
    "bikini-top": () => bikiniTop(template, body, marks, tone),
    top: () => studioGarment(template, body, marks, tone, "top", bodyType),
    briefs: () => briefs(template, body, marks, tone, { bulge }),
    "lace-thong": () => lowRise(template, body, marks, tone, { thong: true, bulge }),
    "bikini-bottom": () => lowRise(template, body, marks, tone, { bulge }),
    "swim-briefs": () => briefs(template, body, marks, tone, { bulge, swim: true }),
    "boxer-briefs": () => boxerBriefs(template, body, marks, tone, { bulge }),
    jockstrap: () => jockstrap(template, body, marks, tone, { bulge }),
    shorts: () => studioGarment(template, body, marks, tone, "shorts", bodyType),
    stockings: () => stockings(template, body, marks, tone),
    "garter-belt": () => garterBelt(template, body, marks, tone),
    harness: () => harness(template, body, marks, tone, bodyType),
    cuffs: () => cuffs(template, body, tone),
  };
  const added = [];
  for (const name of GARMENT_NAMES) {
    if (!wanted.includes(name)) continue;
    // A cup needs something to hold. On the male scan the apex search returns
    // the pectoral, which is real enough as a landmark but is not a breast, and
    // a cup built on it is a costume rather than an oversight - so it is
    // refused.
    if (CUPPED.has(name) && bodyType !== "female") continue;
    const piece = makers[name]();
    if (piece) added.push(piece);
  }
  if (!added.length) return template;

  const covered = wanted.some((name) => GARMENT_SLOTS.hips.includes(name));
  // Opaque fabric hides the interior skin faces. Keeping both layers lets
  // retargeted seams and interpolated cut weights expose skin through a shirt.
  // Only fully covered faces are removed; the clipped boundary keeps its skin.
  const hidden = new Set(added.flatMap(piece => piece.coveredTriangles));
  const visibleIndices = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    if (!hidden.has(i / 3)) visibleIndices.push(body.indices[i], body.indices[i + 1], body.indices[i + 2]);
  }
  // Where skin and cloth are layered they were built on the same flat
  // triangles, the cloth a lift above them, and they stay that way: `beneath`
  // keeps `tessellate` from rounding the skin there, which would push it
  // through anything cut from the chords - a stocking stands off by barely a
  // millimetre. The cloth is rounded instead, and it is the outside.
  const beneath = new Uint8Array(body.positions.length / 3);
  for (const piece of added) piece.beneath.forEach((under, v) => under && (beneath[v] = 1));
  const submeshes = template.submeshes.filter(
    (submesh) => !(covered && submesh.name === "pelvis-anatomy")
  ).map(submesh => submesh === body ? { ...body, indices: Uint32Array.from(visibleIndices), beneath } : submesh);
  const garments = added.map(({ coveredTriangles, beneath, ...piece }) => piece);
  return { ...template, submeshes: [...submeshes, ...garments] };
}
