/**
 * The drawn surface, finer than the scan wherever the scan's flat triangles
 * would show.
 *
 * The scans are tessellated for a body at rest, and sparingly where the body
 * is smooth: across a shoulder, a breast or a buttock the edges run past two
 * centimetres and up to nearly six. Shading hides that - the normals are
 * interpolated, so the light moves smoothly across each flat face - but the
 * outline cannot. Close up, a curved flank drawn against the room is a row of
 * straight segments, and the shadow terminator steps along the same chords.
 * Posing makes it worse, because a bent joint curves edges that were straight
 * in the scan.
 *
 * So each posed edge is tested against the curve its ends say it should follow:
 * the PN-triangle cubic (Vlachos et al., 2001), which leaves each end along
 * that end's own tangent plane. Its midpoint is the chord's, pushed off by
 * `(wa Na + wb Nb) / 8` where `wa` is how far the edge rises out of `A`'s
 * tangent plane and `wb` the same from `B`. An edge whose midpoint would stand
 * off its chord by more than `TOLERANCE` is split there, and the triangles
 * either side into two, three or four; twice over, so the halves of a long
 * curved edge can be split again. Everything flat enough already is left as it
 * was, which is most of the scan's edges.
 *
 * The decision belongs to the edge, not to either triangle, so a split edge is
 * split on both sides and there are no T-junctions to open cracks. "The edge"
 * means the edge in space, not in the index buffer: a UV seam draws one edge as
 * two, from separate copies of its vertices, and the copies have to agree or
 * the seam opens. They are matched by where they are in the scan - welded once
 * per template, in `weldOf` - and every copy gets the same midpoint, each with
 * its own UV. A crease, where the copies' normals disagree - the sole of a foot
 * meeting its side, a garment's face meeting its hem wall - is followed along
 * the line the two sides meet in, the one direction both of them allow. One
 * too shallow or too sharp for that line to mean much, inside thirty degrees
 * either way, is left alone. So are two other kinds of edge. An open border
 * may be sewn to another part, the anatomy to the skin, and that part would
 * not be split to match. And skin with cloth over it stays as the cloth was cut
 * to fit (see `withGarments`), the cloth being rounded only where it bulges,
 * away from the skin, never where it would dip into a hollow - which is also
 * what cloth does.
 *
 * It is drawing only. The solver, the contacts and the occlusion all work on
 * the scan's own vertices; the new ones take the average of their ends'
 * normals, UVs, trim and occlusion (`spread`), so the shading is the shading
 * the flat triangles had and only the shape between the vertices changes.
 */

/**
 * How far a midpoint may stand off its chord before the edge is split: a tenth
 * of a pixel at full-figure framing and about half of one at the closest the
 * camera comes. Halving it would add as many triangles again for a difference
 * nobody could point to.
 */
export const TOLERANCE = 0.0002;

/** Rounds of splitting. The second catches the halves of the longest edges. */
export const PASSES = 2;

/** Copies whose normals are closer than this are one smooth surface. */
const CREASE = 0.999;

/** How close two scan vertices have to be to be the same point. */
const WELD = 2e-6;

/** Key span for a pair of vertices: they stay below 2^22, keys below 2^44. */
const SPAN = 4194304;

const welds = new WeakMap();

/**
 * One id per point of the scan, shared by every copy of it, for a template's
 * bind positions. Kept for as long as the template is.
 */
export function weldOf(bind) {
  let weld = welds.get(bind);
  if (weld) return weld;
  const count = bind.length / 3;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => bind[a * 3] - bind[b * 3] || a - b);
  const ids = new Int32Array(count).fill(-1);
  let next = 0;
  for (let s = 0; s < count; s += 1) {
    const i = order[s];
    if (ids[i] >= 0) continue;
    ids[i] = next;
    for (let r = s + 1; r < count && bind[order[r] * 3] - bind[i * 3] <= WELD; r += 1) {
      const j = order[r];
      if (
        ids[j] < 0 &&
        Math.abs(bind[j * 3 + 1] - bind[i * 3 + 1]) <= WELD &&
        Math.abs(bind[j * 3 + 2] - bind[i * 3 + 2]) <= WELD
      )
        ids[j] = next;
    }
    next += 1;
  }
  weld = { ids, count: next };
  welds.set(bind, weld);
  return weld;
}

/**
 * One round of splitting. Returns null when no edge needed it.
 */
function split(P, N, I, ids, idCount, heldAt, { tolerance, bridge }) {
  const vertexCount = P.length / 3;
  const corners = I.length;

  // Every edge in space, once, with one copy of it standing for all, its ends
  // in id order. Found by bucketing each corner's edge under the lower id at
  // its ends and matching the higher within the bucket, which is a handful
  // long - a round meets a couple of hundred thousand, and a hash of the pair
  // spends its time missing the cache.
  const lower = new Int32Array(corners);
  const higher = new Int32Array(corners);
  const start = new Int32Array(idCount + 1);
  for (let c = 0; c < corners; c += 1) {
    const iu = ids[I[c]];
    const iw = ids[I[c % 3 === 2 ? c - 2 : c + 1]];
    if (iu === iw) {
      lower[c] = -1;
      continue;
    }
    lower[c] = iu < iw ? iu : iw;
    higher[c] = iu < iw ? iw : iu;
    start[lower[c] + 1] += 1;
  }
  for (let i = 0; i < idCount; i += 1) start[i + 1] += start[i];
  const fill = start.slice(0, idCount);
  const bucket = new Int32Array(corners);
  for (let c = 0; c < corners; c += 1) if (lower[c] >= 0) bucket[fill[lower[c]]++] = c;

  const edgeOf = new Int32Array(corners).fill(-1);
  const firstA = new Int32Array(corners);
  const firstB = new Int32Array(corners);
  // The copy on the other side of a crease, where there is one.
  const creaseA = new Int32Array(corners).fill(-1);
  const creaseB = new Int32Array(corners);
  const uses = new Uint32Array(corners);
  const keep = new Uint8Array(corners);
  let edgeCount = 0;
  const agree = (u, v) =>
    u === v || N[u * 3] * N[v * 3] + N[u * 3 + 1] * N[v * 3 + 1] + N[u * 3 + 2] * N[v * 3 + 2] >= CREASE;
  for (let i = 0; i < idCount; i += 1) {
    for (let s = start[i]; s < start[i + 1]; s += 1) {
      const c = bucket[s];
      const u = I[c];
      const w = I[c % 3 === 2 ? c - 2 : c + 1];
      const a = ids[u] < ids[w] ? u : w;
      const b = ids[u] < ids[w] ? w : u;
      let e = -1;
      for (let r = start[i]; r < s; r += 1)
        if (higher[bucket[r]] === higher[c]) {
          e = edgeOf[bucket[r]];
          break;
        }
      if (e < 0) {
        e = edgeCount++;
        firstA[e] = a;
        firstB[e] = b;
        if (heldAt[ids[a]] || heldAt[ids[b]]) keep[e] = 1;
      } else if (!agree(a, firstA[e]) || !agree(b, firstB[e])) {
        if (creaseA[e] >= 0) keep[e] = 1;
        creaseA[e] = a;
        creaseB[e] = b;
      }
      uses[e] += 1;
      edgeOf[c] = e;
    }
  }

  // Which of them stand off their curve by enough to split, and where to. The
  // curve leaves each end in that end's tangent plane - or on a crease, along
  // the line the two sides meet in, which is square to both their normals - so
  // what pulls it off the chord is whatever of the chord does not go that way.
  // A crease whose sides are too nearly one surface for that line to be worth
  // anything is left alone.
  const pull = new Float64Array(3);
  const leaves = (v, other, dx, dy, dz) => {
    const n = v * 3;
    if (other < 0 || agree(v, other)) {
      const w = dx * N[n] + dy * N[n + 1] + dz * N[n + 2];
      pull[0] += w * N[n];
      pull[1] += w * N[n + 1];
      pull[2] += w * N[n + 2];
      return true;
    }
    const m = other * 3;
    const tx = N[n + 1] * N[m + 2] - N[n + 2] * N[m + 1];
    const ty = N[n + 2] * N[m] - N[n] * N[m + 2];
    const tz = N[n] * N[m + 1] - N[n + 1] * N[m];
    const square = tx * tx + ty * ty + tz * tz;
    if (square < 0.25) return false;
    const along = (dx * tx + dy * ty + dz * tz) / square;
    pull[0] += dx - along * tx;
    pull[1] += dy - along * ty;
    pull[2] += dz - along * tz;
    return true;
  };
  const mid = new Float64Array(edgeCount * 3);
  const cut = new Uint8Array(edgeCount);
  let cuts = 0;
  const limit = tolerance * tolerance * 64;
  for (let e = 0; e < edgeCount; e += 1) {
    const crease = creaseA[e] >= 0;
    if (keep[e] || uses[e] < 2 || (crease && uses[e] > 2)) continue;
    const a = firstA[e] * 3;
    const b = firstB[e] * 3;
    const dx = P[b] - P[a];
    const dy = P[b + 1] - P[a + 1];
    const dz = P[b + 2] - P[a + 2];
    pull.fill(0);
    if (!leaves(firstA[e], creaseA[e], dx, dy, dz) || !leaves(firstB[e], crease ? creaseB[e] : -1, -dx, -dy, -dz)) continue;
    const ox = pull[0];
    const oy = pull[1];
    const oz = pull[2];
    if (ox * ox + oy * oy + oz * oz <= limit) continue;
    // The midpoint goes out along the normals where the surface bulges and in
    // where it hollows; `bridge` keeps the hollows straight. Across a crease,
    // out is out from both sides.
    if (bridge) {
      let sx = N[a] + N[b];
      let sy = N[a + 1] + N[b + 1];
      let sz = N[a + 2] + N[b + 2];
      if (crease) {
        const c = creaseA[e] * 3;
        const d = creaseB[e] * 3;
        sx += N[c] + N[d];
        sy += N[c + 1] + N[d + 1];
        sz += N[c + 2] + N[d + 2];
      }
      if (ox * sx + oy * sy + oz * sz >= 0) continue;
    }
    cut[e] = 1;
    cuts += 1;
    mid[e * 3] = (P[a] + P[b]) / 2 - ox / 8;
    mid[e * 3 + 1] = (P[a + 1] + P[b + 1]) / 2 - oy / 8;
    mid[e * 3 + 2] = (P[a + 2] + P[b + 2]) / 2 - oz / 8;
  }
  if (!cuts) return null;

  // A new vertex for each copy of each split edge, all copies at one point.
  // Nearly every edge has the one copy; the others are UV seams.
  const midOf = new Int32Array(corners).fill(-1);
  const firstMid = new Int32Array(edgeCount).fill(-1);
  const others = new Map();
  const made = new Int32Array(corners * 3);
  let madeCount = 0;
  let triangles = 0;
  for (let t = 0; t < corners; t += 3) {
    let count = 0;
    for (let k = 0; k < 3; k += 1) {
      const c = t + k;
      const e = edgeOf[c];
      if (e < 0 || !cut[e]) continue;
      count += 1;
      const u = I[c];
      const w = I[k === 2 ? t : c + 1];
      const a = ids[u] < ids[w] ? u : w;
      const b = ids[u] < ids[w] ? w : u;
      let v;
      if (a === firstA[e] && b === firstB[e]) {
        if (firstMid[e] < 0) {
          firstMid[e] = vertexCount + madeCount;
          made[madeCount * 3] = e;
          made[madeCount * 3 + 1] = a;
          made[madeCount * 3 + 2] = b;
          madeCount += 1;
        }
        v = firstMid[e];
      } else {
        const key = a * SPAN + b;
        v = others.get(key);
        if (v === undefined) {
          v = vertexCount + madeCount;
          others.set(key, v);
          made[madeCount * 3] = e;
          made[madeCount * 3 + 1] = a;
          made[madeCount * 3 + 2] = b;
          madeCount += 1;
        }
      }
      midOf[c] = v;
    }
    triangles += count === 0 ? 1 : count === 3 ? 4 : count + 1;
  }

  const total = vertexCount + madeCount;
  const positions = new P.constructor(total * 3);
  positions.set(P);
  const normals = new N.constructor(total * 3);
  normals.set(N);
  const nextIds = new Int32Array(total);
  nextIds.set(ids);
  const parents = new Int32Array(madeCount * 2);
  for (let m = 0, v = vertexCount; m < madeCount; m += 1, v += 1) {
    const e = made[m * 3];
    const a = made[m * 3 + 1];
    const b = made[m * 3 + 2];
    parents[m * 2] = a;
    parents[m * 2 + 1] = b;
    positions[v * 3] = mid[e * 3];
    positions[v * 3 + 1] = mid[e * 3 + 1];
    positions[v * 3 + 2] = mid[e * 3 + 2];
    const nx = N[a * 3] + N[b * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[v * 3] = nx / length;
    normals[v * 3 + 1] = ny / length;
    normals[v * 3 + 2] = nz / length;
    nextIds[v] = idCount + e;
  }

  // The triangles, cut the way `refine` in garments.js cuts them, winding kept.
  const indices = new Uint32Array(triangles * 3);
  let o = 0;
  const put = (a, b, c) => {
    indices[o++] = a;
    indices[o++] = b;
    indices[o++] = c;
  };
  const distance = (u, w) => {
    const dx = positions[u * 3] - positions[w * 3];
    const dy = positions[u * 3 + 1] - positions[w * 3 + 1];
    const dz = positions[u * 3 + 2] - positions[w * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  for (let t = 0; t < corners; t += 3) {
    const m0 = midOf[t];
    const m1 = midOf[t + 1];
    const m2 = midOf[t + 2];
    const count = (m0 >= 0) + (m1 >= 0) + (m2 >= 0);
    if (count === 0) {
      put(I[t], I[t + 1], I[t + 2]);
      continue;
    }
    if (count === 3) {
      put(I[t], m0, m2);
      put(m0, I[t + 1], m1);
      put(m2, m1, I[t + 2]);
      put(m0, m1, m2);
      continue;
    }
    if (count === 1) {
      // Rotated so the split edge is the first; the winding comes with it.
      const e = m0 >= 0 ? 0 : m1 >= 0 ? 1 : 2;
      const m = midOf[t + e];
      const a = I[t + e];
      const b = I[t + ((e + 1) % 3)];
      const c = I[t + ((e + 2) % 3)];
      put(a, m, c);
      put(m, b, c);
      continue;
    }
    // Two split: rotated so the one left whole is the last, `c` to `a`, and
    // the quad beside the corner cut off at `b` split across its shorter
    // diagonal.
    const e = m0 < 0 ? 0 : m1 < 0 ? 1 : 2;
    const a = I[t + ((e + 1) % 3)];
    const b = I[t + ((e + 2) % 3)];
    const c = I[t + e];
    const ab = midOf[t + ((e + 1) % 3)];
    const bc = midOf[t + ((e + 2) % 3)];
    put(ab, b, bc);
    if (distance(a, bc) <= distance(ab, c)) {
      put(a, ab, bc);
      put(a, bc, c);
    } else {
      put(a, ab, c);
      put(ab, bc, c);
    }
  }

  return { positions, normals, indices, parents, ids: nextIds, idCount: idCount + edgeCount };
}

/**
 * A posed part's `positions`, `normals` and `indices`, split finer where they
 * curve, and the `parents` of each vertex added, in pairs and in order, for
 * `spread` to give it everything else a vertex carries. `bind` is the
 * template's own positions for the part, which is what its copies are matched
 * by. No edge touching a vertex marked in `held` is split - the skin under a
 * garment, which has to stay on the chords the garment was built from. With
 * `bridge`, no edge is split where the surface hollows: cloth, which spans a
 * hollow rather than following it down. A part with nothing to split comes
 * back as it was, with no parents.
 */
export function tessellate(part, bind, { held = null, bridge = false, tolerance = TOLERANCE, passes = PASSES } = {}) {
  const weld = weldOf(bind);
  // By point, not by copy, so both sides of a seam agree. Ids past the scan's
  // are the midpoints of free edges and read as free.
  const heldAt = new Uint8Array(weld.count);
  if (held) for (let v = 0; v < held.length; v += 1) if (held[v]) heldAt[weld.ids[v]] = 1;
  let { positions, normals, indices } = part;
  let ids = weld.ids;
  let idCount = weld.count;
  const lineage = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const next = split(positions, normals, indices, ids, idCount, heldAt, { tolerance, bridge });
    if (!next) break;
    ({ positions, normals, indices, ids, idCount } = next);
    lineage.push(next.parents);
  }
  const parents = new Int32Array(lineage.reduce((sum, pairs) => sum + pairs.length, 0));
  lineage.reduce((at, pairs) => (parents.set(pairs, at), at + pairs.length), 0);
  return { positions, normals, indices, parents };
}

/**
 * A per-vertex attribute `width` numbers wide - UVs, trim, occlusion - carried
 * onto the vertices `tessellate` added, each the mean of its parents. Parents
 * come before their children, so one pass in order does every round.
 */
export function spread(values, parents, width = 1) {
  if (!values) return null;
  const base = values.length / width;
  const out = new values.constructor((base + parents.length / 2) * width);
  out.set(values);
  for (let m = 0, v = base; m < parents.length; m += 2, v += 1) {
    const a = parents[m] * width;
    const b = parents[m + 1] * width;
    for (let k = 0; k < width; k += 1) out[v * width + k] = (out[a + k] + out[b + k]) / 2;
  }
  return out;
}
