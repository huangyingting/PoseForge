/**
 * Clothes.
 *
 * A bra and a pair of briefs, built the same way as each other and not at all
 * the way the hair is built. Hair sits *near* a head and the shape it makes is
 * its own; a garment sits *on* a body and the shape it makes is the body's. So
 * where `hair.js` generates a shell from a support field and never looks at a
 * triangle, this lifts a region of the drawn surface a couple of millimetres
 * off itself and hems it. Nothing is approximated: the cup is the breast, the
 * seat of the briefs is the buttock, and they fit because they are the same
 * vertices.
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
 * measured landmarks, and those are where the work is. See `measure`.
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

/** Everything `withGarments` knows how to make. */
export const GARMENT_NAMES = ["bra", "briefs", "top", "shorts"];

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
    // How big the breast is, as the straight-line distance from the apex to the
    // fold under it. This is the one number the cup's size comes from, so a bust
    // slider moves the cup with the breast and no separate knob is needed.
    reach: Math.hypot(apex[1] - underY, apex[2] - front[underSlot]),
    waistY: waistSlot / STEPS,
    hipY: hipSlot / STEPS,
    hipWidth: wide[hipSlot],
    crotchY: crotch,
    shoulder: template.jointByBone.get("shoulder_l")?.rest ?? null,
  };
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
 */
function lift(body, field, veto, colour, name, { bulge } = {}) {
  const count = body.positions.length / 3;
  const coveredTriangles = [];
  const f = new Float64Array(count);
  for (let v = 0; v < count; v += 1) {
    const inside = field(body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]);
    f[v] = veto ? Math.min(inside, veto[v]) : inside;
  }

  // Vertices of the cut region, still on the skin. The lift is applied at the
  // end, so the field, the interpolation and the hem all work in one space.
  const px = [];
  const nx = [];
  const jx = [];
  const wx = [];
  const fromVertex = new Int32Array(count).fill(-1);
  const fromCut = new Map();

  const keepVertex = (v) => {
    if (fromVertex[v] >= 0) return fromVertex[v];
    px.push(body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]);
    nx.push(body.normals[v * 3], body.normals[v * 3 + 1], body.normals[v * 3 + 2]);
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

  const tris = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    const tri = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
    const inside = tri.filter((v) => f[v] > 0);
    if (!inside.length) continue;
    if (inside.length === 3) {
      tris.push(keepVertex(tri[0]), keepVertex(tri[1]), keepVertex(tri[2]));
      // Skin well inside an opaque garment is never visible. Retain a narrow
      // border at cuffs and hems, where a cut fabric triangle only partly
      // covers its source skin triangle.
      if (tri.every(v => f[v] > LIFT * 0.5)) coveredTriangles.push(i / 3);
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

  // The scan is split along its UV seams: half of its edges are used by exactly
  // one triangle, because the two sides hold coincident copies of a vertex
  // rather than sharing it. That matters twice over. Counting edges by index
  // would call every seam a hem and drop a wall down the middle of the garment.
  // And a garment is an offset surface, so a vertex that exists twice with two
  // different normals gets pushed to two different places and the cloth tears
  // open along every seam - which is what put a row of teeth along the
  // waistband. Both go away by welding on position: one normal per point in
  // space, one edge per pair of points.
  const weld = new Int32Array(px.length / 3);
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

  /* ---- lift it off the skin and hem it ---- */

  const height = (i) =>
    LIFT + (bulge ? bulge(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]) : 0);

  const positions = [];
  const normals = [];
  const joints = [];
  const weights = [];
  const emit = (i, h) => {
    positions.push(px[i * 3] + nx[i * 3] * h, px[i * 3 + 1] + nx[i * 3 + 1] * h, px[i * 3 + 2] + nx[i * 3 + 2] * h);
    normals.push(nx[i * 3], nx[i * 3 + 1], nx[i * 3 + 2]);
    for (let k = 0; k < 4; k += 1) {
      joints.push(jx[i * 4 + k]);
      weights.push(wx[i * 4 + k]);
    }
    return positions.length / 3 - 1;
  };

  const face = new Int32Array(px.length / 3).fill(-1);
  const indices = [];
  for (const i of tris) {
    if (face[i] < 0) face[i] = emit(i, height(i));
  }
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(face[tris[i]], face[tris[i + 1]], face[tris[i + 2]]);
  }

  // An edge used by one triangle is on the hem. Counted on the cut mesh, so it
  // is the true boundary rather than whatever the original tessellation had.
  const used = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const key = edgeKey(tris[i + e], tris[i + ((e + 1) % 3)]);
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  }
  // Hem vertices are emitted again at both heights so the wall carries its own
  // normals. A two-millimetre wall sharing the face's smooth normals shades as
  // a continuation of the face and is invisible, and being seen is the whole
  // reason it is here.
  const wall = new Map();
  const at = (i, top) => {
    const w = weld[i];
    const key = `${w}|${top ? 1 : 0}`;
    if (!wall.has(key)) wall.set(key, emit(w, top ? height(w) : LIFT * 0.12));
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
    coveredTriangles,
    colour,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: null,
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
function bra(template, body, marks, colour) {
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
  const shoulderX = marks.shoulder ? marks.shoulder[12] : 0.095;

  // In the bind pose the arms hang at forty-five degrees with the hands beside
  // the hips, which puts the forearm at the same height as the band and a good
  // deal further out. Nothing here is subtle enough to tell the difference on
  // geometry alone - the first build banded both wrists - so the arms are
  // refused by name. The upper arm goes too: the strap passes over the
  // trapezius, which belongs to the clavicle and the spine, and a strap wide
  // enough to reach the deltoid is a sleeve.
  const veto = boneMargin(template, body, ARM_BONES);

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
    points.push([side * shoulderX * 0.82, shoulderY - 0.012, -0.03]);
    points.push([side * marks.hipWidth * 0.62, marks.underY + 0.052, -0.052]);
    return points;
  };

  // Once, not once per vertex. `field` below is called for every vertex of the
  // scan and used to rebuild these two polylines each time, which cost nothing
  // worth noticing while they were arithmetic on landmarks; now that a point of
  // one is a search over the mesh for the surface beside it, the same line
  // turned a two-second build into one that does not finish.
  const lines = [strap(-1), strap(1)];

  const field = (x, y, z) => {
    const side = x >= 0 ? 1 : -1;

    // The cup: the ball, cut off level above so the top edge of the bra is a
    // line rather than a circle - which is what a balconette is, and the most
    // ordinary thing to put someone in - and trimmed at the back so it does not
    // wrap round the ribs into the armpit.
    const d = Math.hypot(x - side * centre[0], y - centre[1], z - centre[2]);
    const cup =
      z > marks.apex[2] - marks.reach * 1.5 ? Math.min(cupR - d, cupTop - y) : -1;

    // The band, all the way round at the fold.
    const band = Math.min(marks.underY + 0.006 - y, y - (marks.underY - 0.026));

    // The straps.
    const line = lines[side > 0 ? 1 : 0];
    let near = Infinity;
    for (let k = 0; k + 1 < line.length; k += 1) {
      const dist = toSegment([x, y, z], line[k], line[k + 1]);
      if (dist < near) near = dist;
    }

    return Math.max(cup, band, 0.0092 - near);
  };

  return lift(body, field, veto, colour, "bra");
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
function briefs(template, body, marks, colour, { bulge = 0 } = {}) {
  const count = body.positions.length / 3;
  const veto = boneMargin(template, body, new RegExp(`${LOWER_LEG_BONES.source}|${ARM_BONES.source}`));

  const waist = marks.waistY - (marks.waistY - marks.hipY) * 0.35;
  const rise = (waist - marks.crotchY) * 0.72;

  const field = (x, y, z) => {
    const side = Math.sin(Math.atan2(x, z)) ** 2;
    return Math.min(waist - y, y - (marks.crotchY + rise * side));
  };

  // The bulge tapers in every direction from the front of the crotch, so the
  // panel swells and the waistband does not.
  const centre = [0, marks.crotchY + (waist - marks.crotchY) * 0.26, 0.052];
  const shape = bulge
    ? (x, y, z) => {
        const d = Math.hypot(x * 0.85, (y - centre[1]) * 1.05, (z - centre[2]) * 0.6);
        return bulge * (1 - smoothstep(0.012, 0.062, d));
      }
    : undefined;

  return lift(body, field, veto, colour, "briefs", { bulge: shape });
}

/** Simple studio clothing follows the same skin weights as the scanned body. */
function studioGarment(template, body, marks, colour, name) {
  const top = name === 'top';
  const veto = boneMargin(template, body, top
    ? /lowerarm|hand|index|middle|pinky|ring|thumb|head|neck/
    : ARM_BONES);
  const field = top
    ? (x, y, z) => Math.min(y - (marks.waistY - 0.035), 0.855 - y - Math.max(0, z) * 0.12)
    : (x, y) => Math.min(marks.waistY - 0.012 - y, y - (marks.crotchY - 0.11));
  return lift(body, field, veto, colour, name);
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
  const wanted = wearing ?? [];
  if (!wanted.length) return template;
  const body = template.submeshes.find((submesh) => submesh.primary);
  if (!body) return template;

  const tone = GARMENT_COLOURS[colour] ?? GARMENT_COLOURS.black;
  const marks = measure(template, body);
  const added = [];

  // A bra needs something to hold. On the male scan the apex search returns the
  // pectoral, which is real enough as a landmark but is not a breast, and a cup
  // built on it is a costume rather than an oversight - so it is refused.
  if (wanted.includes("bra") && bodyType === "female") {
    const piece = bra(template, body, marks, tone);
    if (piece) added.push(piece);
  }
  if (wanted.includes("briefs")) {
    const piece = briefs(template, body, marks, tone, {
      bulge: bodyType === "male" ? 0.021 : 0,
    });
    if (piece) added.push(piece);
  }
  for (const name of ['top', 'shorts']) {
    if (wanted.includes(name)) {
      const piece = studioGarment(template, body, marks, tone, name);
      if (piece) added.push(piece);
    }
  }
  if (!added.length) return template;

  const covered = wanted.includes("briefs") || wanted.includes('shorts');
  // Opaque fabric hides the interior skin faces. Keeping both layers lets
  // retargeted seams and interpolated cut weights expose skin through a shirt.
  // Only fully covered faces are removed; the clipped boundary keeps its skin.
  const hidden = new Set(added.flatMap(piece => piece.coveredTriangles));
  const visibleIndices = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    if (!hidden.has(i / 3)) visibleIndices.push(body.indices[i], body.indices[i + 1], body.indices[i + 2]);
  }
  const submeshes = template.submeshes.filter(
    (submesh) => !(covered && submesh.name === "pelvis-anatomy")
  ).map(submesh => submesh === body ? { ...body, indices: Uint32Array.from(visibleIndices) } : submesh);
  const garments = added.map(({ coveredTriangles, ...piece }) => piece);
  return { ...template, submeshes: [...submeshes, ...garments] };
}
