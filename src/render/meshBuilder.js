/**
 * Surface extraction from the body's signed distance field.
 *
 * The mesh comes out of the *same* field the collision narrowphase works
 * against - the round cones bound to the bones - so what the viewer sees is
 * exactly what the solver measured. A pose that reports 8mm of compression at
 * the hip shows 8mm of compression at the hip. Rendering from a separate skinned
 * mesh, which is the usual arrangement, gives up that guarantee immediately:
 * the collision proxy and the silhouette drift apart and there is no longer any
 * one answer to where the surface is.
 *
 * Surface nets rather than marching cubes. Both extract an isosurface, but
 * marching cubes pins every vertex to a grid edge, which on a smooth blended
 * body shows up as terracing across the shoulders and stair-steps down the
 * shins. Surface nets place one vertex per cell, free to sit anywhere inside
 * it, and then relax that vertex onto the true surface using the field's own
 * gradient - so a 12mm grid resolves detail a 12mm marching-cubes grid cannot,
 * and the output is manifold and quad-derived, which subdivides cleanly.
 *
 * The one place surface nets give ground is a cell containing two *separate*
 * sheets of surface - an upper arm passing within one voxel of the ribs, say.
 * One vertex per cell means the two sheets share it, and the mesh pinches
 * there rather than tearing: still closed, still watertight, but with a single
 * edge used by four triangles instead of two. In practice this is one or two
 * edges out of forty-five thousand at a 12mm grid, none at 8mm, and it is
 * invisible in a render. `scripts/validate-mesh.mjs` counts them so a change
 * that makes it materially worse cannot pass unnoticed.
 */

import { bodyDistance, bodyNormal, volumesBounds } from "../core/body.js";

/** Cells per side of a culling block. */
const BLOCK = 8;

/**
 * World AABB of one round cone, grown by the distance over which its blend can
 * still pull the surface around.
 */
function volumeBounds(volume) {
  const { a, b, ra, rb, blend } = volume;
  const pad = blend || 0;
  return [
    [
      Math.min(a[0] - ra, b[0] - rb) - pad,
      Math.min(a[1] - ra, b[1] - rb) - pad,
      Math.min(a[2] - ra, b[2] - rb) - pad,
    ],
    [
      Math.max(a[0] + ra, b[0] + rb) + pad,
      Math.max(a[1] + ra, b[1] + rb) + pad,
      Math.max(a[2] + ra, b[2] + rb) + pad,
    ],
  ];
}

/**
 * Sample the field over a grid, evaluating only the volumes that can reach each
 * block.
 *
 * A body is around seventy primitives but no point on it is near more than a
 * handful, so the naive loop spends its whole time proving that an ankle is far
 * from an ear. Binning the primitives by block first turns the inner loop from
 * seventy round-cone evaluations into about five, and blocks no primitive
 * reaches are skipped outright rather than sampled and discarded.
 *
 * The subsets keep the volumes in their original order, because `bodyDistance`
 * folds its smooth minimum sequentially and the result depends on that order.
 * Culling never changes the answer beyond the blend tolerance it is derived
 * from: a primitive outside the padded block cannot influence the fold.
 */
function sampleField(volumes, origin, step, dims) {
  const [nx, ny, nz] = dims;
  const field = new Float32Array(nx * ny * nz);
  const far = step * BLOCK * 4;
  field.fill(far);

  const blocks = [Math.ceil(nx / BLOCK), Math.ceil(ny / BLOCK), Math.ceil(nz / BLOCK)];
  const bins = new Map();
  for (const volume of volumes) {
    const [lo, hi] = volumeBounds(volume);
    const from = lo.map((v, axis) =>
      Math.max(0, Math.floor((v - origin[axis]) / step / BLOCK))
    );
    const to = hi.map((v, axis) =>
      Math.min(blocks[axis] - 1, Math.floor((v - origin[axis]) / step / BLOCK))
    );
    for (let bz = from[2]; bz <= to[2]; bz += 1) {
      for (let by = from[1]; by <= to[1]; by += 1) {
        for (let bx = from[0]; bx <= to[0]; bx += 1) {
          const key = (bz * blocks[1] + by) * blocks[0] + bx;
          let bin = bins.get(key);
          if (!bin) bins.set(key, (bin = []));
          bin.push(volume);
        }
      }
    }
  }

  const point = [0, 0, 0];
  for (const [key, subset] of bins) {
    const bx = key % blocks[0];
    const by = Math.floor(key / blocks[0]) % blocks[1];
    const bz = Math.floor(key / (blocks[0] * blocks[1]));
    const x1 = Math.min((bx + 1) * BLOCK, nx);
    const y1 = Math.min((by + 1) * BLOCK, ny);
    const z1 = Math.min((bz + 1) * BLOCK, nz);
    for (let k = bz * BLOCK; k < z1; k += 1) {
      point[2] = origin[2] + k * step;
      for (let j = by * BLOCK; j < y1; j += 1) {
        point[1] = origin[1] + j * step;
        const row = (k * ny + j) * nx;
        for (let i = bx * BLOCK; i < x1; i += 1) {
          point[0] = origin[0] + i * step;
          field[row + i] = bodyDistance(point, subset);
        }
      }
    }
  }
  return field;
}

/** The 12 edges of a cell, as pairs of corner indices in x + 2y + 4z order. */
const CELL_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Extract the zero isosurface.
 *
 * @param {Array<object>} volumes world-space round cones (see `poseVolumes`)
 * @param {object} [options]
 * @param {number} [options.resolution] grid spacing in metres
 * @param {number} [options.padding] margin around the body's bounds
 * @param {boolean} [options.ao] compute per-vertex ambient occlusion
 * @param {number} [options.relax] how far to pull vertices onto the true
 *        surface, 0 disables
 * @returns {{positions:Float32Array, normals:Float32Array, indices:Uint32Array,
 *           occlusion:Float32Array|null, bounds:number[][], resolution:number}}
 */
export function buildBodyMesh(volumes, options = {}) {
  const { resolution = 0.012, padding = 0.04, ao = true, relax = 1 } = options;
  if (!volumes.length) return emptyMesh(resolution);

  const { min: lo, max: hi } = volumesBounds(volumes, padding);
  const step = resolution;
  const dims = [0, 1, 2].map((axis) => Math.ceil((hi[axis] - lo[axis]) / step) + 2);
  const [nx, ny, nz] = dims;
  const field = sampleField(volumes, lo, step, dims);

  const at = (i, j, k) => field[(k * ny + j) * nx + i];

  // One vertex per cell that the surface passes through. `cellVertex` indexes
  // into the vertex list, or -1 where the surface misses the cell entirely.
  const cells = (nx - 1) * (ny - 1) * (nz - 1);
  const cellVertex = new Int32Array(cells).fill(-1);
  const positions = [];
  const corner = new Float64Array(8);

  for (let k = 0; k < nz - 1; k += 1) {
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          const d = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          corner[c] = d;
          if (d < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        // Where the surface cuts each edge, averaged. This is the point the
        // cell's vertex starts from; it is already far better than the cell
        // centre, and the relaxation below finishes the job.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of CELL_EDGES) {
          const da = corner[a];
          const db = corner[b];
          if (da < 0 === db < 0) continue;
          const t = da / (da - db);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          crossings += 1;
        }
        if (!crossings) continue;

        const p = [
          lo[0] + (i + sx / crossings) * step,
          lo[1] + (j + sy / crossings) * step,
          lo[2] + (k + sz / crossings) * step,
        ];

        // The averaged crossing is the centroid of a set of linear guesses, and
        // on a curved surface the centroid sits slightly inside. One Newton
        // step along the gradient - the field is a true distance, so the step
        // length is just the distance itself - puts it on the surface. This is
        // what buys the extra apparent resolution over marching cubes, and it
        // costs one field evaluation per vertex.
        if (relax > 0) {
          const d = bodyDistance(p, volumes);
          if (Math.abs(d) < step) {
            const n = bodyNormal(p, volumes);
            const shift = Math.max(-step, Math.min(step, d)) * relax;
            p[0] -= n[0] * shift;
            p[1] -= n[1] * shift;
            p[2] -= n[2] * shift;
          }
        }

        cellVertex[(k * (ny - 1) + j) * (nx - 1) + i] = positions.length / 3;
        positions.push(p[0], p[1], p[2]);
      }
    }
  }

  const indices = stitch(field, cellVertex, dims);
  const count = positions.length / 3;
  const positionArray = Float32Array.from(positions);

  // Normals come from the field's analytic gradient rather than from averaging
  // face normals. Averaging is an approximation of the surface the triangles
  // happen to form; the gradient is the surface the body actually has, so the
  // shading stays smooth across the blend seams where the triangle density is
  // lowest and averaging looks worst.
  const normals = new Float32Array(count * 3);
  const sample = [0, 0, 0];
  for (let v = 0; v < count; v += 1) {
    sample[0] = positionArray[v * 3];
    sample[1] = positionArray[v * 3 + 1];
    sample[2] = positionArray[v * 3 + 2];
    const n = bodyNormal(sample, volumes);
    normals[v * 3] = n[0];
    normals[v * 3 + 1] = n[1];
    normals[v * 3 + 2] = n[2];
  }

  return {
    positions: positionArray,
    normals,
    indices,
    occlusion: ao ? occlusionFrom(positionArray, normals, volumes, step) : null,
    bounds: [lo, hi],
    resolution: step,
  };
}

/**
 * Join the per-cell vertices into triangles.
 *
 * Every grid edge that the surface crosses is shared by exactly four cells, and
 * those four vertices form one quad of the output. Working from edges rather
 * than from cells is what makes the result watertight by construction: an edge
 * either crosses or it does not, so neighbouring cells can never disagree about
 * whether to emit a face between them.
 */
function stitch(field, cellVertex, dims) {
  const [nx, ny, nz] = dims;
  const at = (i, j, k) => field[(k * ny + j) * nx + i];
  const cell = (i, j, k) => cellVertex[(k * (ny - 1) + j) * (nx - 1) + i];
  const indices = [];

  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Wind so the face points from inside to outside; the sign of the edge
    // crossing says which way that is. The four cells are listed anticlockwise
    // seen from the positive end of the edge, so a crossing that runs from
    // inside to outside along the edge needs the reversed order.
    if (flip) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
  };

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const here = at(i, j, k) < 0;
        // x edge: the four cells around it differ in j and k
        if (i < nx - 1 && j > 0 && k > 0 && here !== at(i + 1, j, k) < 0) {
          quad(
            cell(i, j - 1, k - 1), cell(i, j, k - 1),
            cell(i, j, k), cell(i, j - 1, k),
            here
          );
        }
        if (j < ny - 1 && i > 0 && k > 0 && here !== at(i, j + 1, k) < 0) {
          quad(
            cell(i - 1, j, k - 1), cell(i, j, k - 1),
            cell(i, j, k), cell(i - 1, j, k),
            !here
          );
        }
        if (k < nz - 1 && i > 0 && j > 0 && here !== at(i, j, k + 1) < 0) {
          quad(
            cell(i - 1, j - 1, k), cell(i, j - 1, k),
            cell(i, j, k), cell(i - 1, j, k),
            here
          );
        }
      }
    }
  }
  return Uint32Array.from(indices);
}

/**
 * Ambient occlusion sampled from the field itself.
 *
 * Marching out along the normal and comparing how far the surface *should* be
 * with how far it actually is measures how much of the body is folded back over
 * the point. It costs five field evaluations per vertex and needs no rays, no
 * acceleration structure and no second pass - and because it reads the same
 * field as everything else, the contact shadow where two bodies meet appears
 * exactly where the solver put the contact. That crease is most of what makes a
 * pair of figures read as touching rather than as two separate renders.
 */
function occlusionFrom(positions, normals, volumes, step) {
  const count = positions.length / 3;
  const out = new Float32Array(count);
  const p = [0, 0, 0];
  for (let v = 0; v < count; v += 1) {
    let occlusion = 0;
    let weight = 1;
    for (let s = 1; s <= 5; s += 1) {
      const reach = s * step * 1.6;
      p[0] = positions[v * 3] + normals[v * 3] * reach;
      p[1] = positions[v * 3 + 1] + normals[v * 3 + 1] * reach;
      p[2] = positions[v * 3 + 2] + normals[v * 3 + 2] * reach;
      occlusion += weight * Math.max(0, reach - bodyDistance(p, volumes));
      weight *= 0.62;
    }
    out[v] = Math.max(0, Math.min(1, 1 - occlusion / (step * 3.2)));
  }
  return out;
}

function emptyMesh(resolution) {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    occlusion: null,
    bounds: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    resolution,
  };
}
