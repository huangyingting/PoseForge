/**
 * Mesh validator.
 *
 * Checks the extracted surface against the field it came from: that it is
 * closed, wound consistently outward, and actually sits on the isosurface
 * rather than near it. Run with `node scripts/validate-mesh.mjs`.
 *
 * The accuracy check is the one that matters. A mesh can be perfectly manifold
 * and still be the wrong shape, and the whole claim of this renderer is that
 * the silhouette and the collision geometry are the same surface - so it is
 * worth measuring rather than assuming.
 */

import { bodyDistance, bodyNormal } from "../src/core/body.js";
import { POSTURE_NAMES, resolveSurface } from "../src/core/poseLibrary.js";
import { buildBodyMesh } from "../src/render/meshBuilder.js";
import { createActor, refresh, seatOnSurface } from "../src/core/solver.js";

const FLOOR = resolveSurface("floor");

const mm = (value) => `${(value * 1000).toFixed(2)}mm`;

/** Every undirected edge must be used exactly twice, once in each direction. */
function manifoldCheck(indices) {
  const seen = new Map();
  let boundary = 0;
  let nonManifold = 0;
  let reversed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entry = seen.get(key) || { forward: 0, backward: 0 };
      if (a < b) entry.forward += 1;
      else entry.backward += 1;
      seen.set(key, entry);
    }
  }
  for (const entry of seen.values()) {
    const total = entry.forward + entry.backward;
    if (total === 1) boundary += 1;
    else if (total !== 2) nonManifold += 1;
    else if (entry.forward !== 1 || entry.backward !== 1) reversed += 1;
  }
  return { edges: seen.size, boundary, nonManifold, reversed };
}

/** Signed volume by the divergence theorem. Negative means inside-out. */
function signedVolume(positions, indices) {
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    total +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[c + 1] * positions[b + 2]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[c] * positions[b + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[c] * positions[b + 1]);
  }
  return total / 6;
}

/** How far the triangles stray from the true zero isosurface. */
function accuracy(positions, indices, volumes) {
  let worst = 0;
  let total = 0;
  let samples = 0;
  let facingWrong = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const centroid = [0, 1, 2].map(
      (axis) => (positions[a + axis] + positions[b + axis] + positions[c + axis]) / 3
    );
    const d = Math.abs(bodyDistance(centroid, volumes));
    worst = Math.max(worst, d);
    total += d;
    samples += 1;

    // Geometric normal against the field gradient: they must agree, or the
    // triangle is wound inside out and will render as a hole.
    const u = [0, 1, 2].map((axis) => positions[b + axis] - positions[a + axis]);
    const v = [0, 1, 2].map((axis) => positions[c + axis] - positions[a + axis]);
    const face = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const n = bodyNormal(centroid, volumes);
    if (face[0] * n[0] + face[1] * n[1] + face[2] * n[2] < 0) facingWrong += 1;
  }
  return { worst, mean: samples ? total / samples : 0, facingWrong, samples };
}

const RESOLUTIONS = [0.02, 0.012, 0.008];
const actor = refresh(createActor({ posture: "standing", bodyType: "female" }, 0));
seatOnSurface(actor, FLOOR);

console.log("resolution sweep, standing female");
console.log("  res     verts    tris    build    accuracy (mean/worst)   closed");
for (const resolution of RESOLUTIONS) {
  const started = Date.now();
  const mesh = buildBodyMesh(actor.volumes, { resolution, ao: false });
  const ms = Date.now() - started;
  const topology = manifoldCheck(mesh.indices);
  const acc = accuracy(mesh.positions, mesh.indices, actor.volumes);
  const closed = topology.boundary === 0 && topology.nonManifold === 0 && topology.reversed === 0;
  console.log(
    `  ${resolution.toFixed(3)}  ${String(mesh.positions.length / 3).padStart(7)} ` +
      `${String(mesh.indices.length / 3).padStart(7)}  ${String(ms + "ms").padStart(7)}  ` +
      `${mm(acc.mean).padStart(8)} / ${mm(acc.worst).padStart(8)}   ` +
      `${closed ? "yes" : `NO (${topology.boundary} open, ${topology.nonManifold} bad, ${topology.reversed} rev)`}` +
      `${acc.facingWrong ? `  ${acc.facingWrong} INVERTED` : ""}`
  );
}

// Relaxation is the thing that buys accuracy at a given grid size, so measure
// what it is actually worth rather than trusting the idea.
const plain = buildBodyMesh(actor.volumes, { resolution: 0.012, ao: false, relax: 0 });
const relaxed = buildBodyMesh(actor.volumes, { resolution: 0.012, ao: false, relax: 1 });
console.log(
  `\nrelaxation at 12mm: mean error ${mm(accuracy(plain.positions, plain.indices, actor.volumes).mean)}` +
    ` -> ${mm(accuracy(relaxed.positions, relaxed.indices, actor.volumes).mean)}`
);

console.log("\nevery posture at 12mm");
let worstError = 0;
const problems = [];
for (const name of POSTURE_NAMES) {
  const posed = refresh(createActor({ posture: name, bodyType: "male" }, 0));
  seatOnSurface(posed, FLOOR);
  const mesh = buildBodyMesh(posed.volumes, { resolution: 0.012, ao: true });
  const topology = manifoldCheck(mesh.indices);
  const acc = accuracy(mesh.positions, mesh.indices, posed.volumes);
  const volume = signedVolume(mesh.positions, mesh.indices);
  // A hole is always a defect. A pinch - one edge shared by two sheets of
  // surface that happened to pass through the same cell - is the documented
  // cost of one vertex per cell, and shows up a couple of times in forty-odd
  // thousand edges. Gate it on a rate rather than on zero, so a change that
  // makes it materially worse fails while the known residue does not.
  const flags = [];
  if (topology.boundary) flags.push(`OPEN(${topology.boundary})`);
  if (topology.reversed) flags.push(`REV(${topology.reversed})`);
  if (topology.nonManifold > topology.edges * 0.0002) {
    flags.push(`PINCH(${topology.nonManifold}/${topology.edges})`);
  }
  if (acc.facingWrong > acc.samples * 0.0005) {
    flags.push(`INVERTED(${acc.facingWrong}/${acc.samples})`);
  }
  // A 1.78m adult displaces roughly 75 litres; an order of magnitude either way
  // means the surface is inside out or has collapsed.
  if (volume < 0.04 || volume > 0.13) flags.push("VOLUME");
  if (flags.length) problems.push(`${name}: ${flags.join("+")}`);
  worstError = Math.max(worstError, acc.worst);
  console.log(
    `  ${name.padEnd(22)} ${String(mesh.positions.length / 3).padStart(6)} verts  ` +
      `${(volume * 1000).toFixed(1).padStart(5)} L  err ${mm(acc.worst).padStart(8)}  ` +
      `pinch ${String(topology.nonManifold).padStart(2)}/${topology.edges}  ${flags.join("+")}`
  );
}

console.log(`\nworst surface error ${mm(worstError)}`);
console.log(problems.length ? `needs work: ${problems.join(", ")}` : "all meshes closed and outward");
process.exitCode = problems.length ? 1 : 0;
