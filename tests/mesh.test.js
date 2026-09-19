/**
 * Isosurface extraction.
 *
 * `buildBodyMesh` claims two things the reference system's marching cubes did
 * not: that the result is watertight and consistently wound by construction,
 * and that one Newton step per vertex puts it on the true surface rather than
 * on a linear guess. Both are checkable exactly - a closed orientable surface
 * has an Euler characteristic of 2 per component and a positive signed volume,
 * and the field can be asked directly how far off each vertex is.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildBodyMesh } from "../src/render/meshBuilder.js";
import { bodyDistance } from "../src/core/body.js";
import { v3dot, v3len, v3sub } from "../src/core/math.js";

let nextId = 0;
const cone = (a, b, ra, rb = ra, blend = 0.035) => ({
  id: nextId++,
  bone: "test",
  group: "torso",
  a,
  b,
  ra,
  rb,
  blend,
});

/** A sphere of radius 0.2 at the origin, with blending switched off. */
const SPHERE = [cone([0, 0, 0], [0, 0, 0], 0.2, 0.2, 0)];
const SPHERE_VOLUME = (4 / 3) * Math.PI * 0.2 ** 3;

const vertex = (mesh, i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
const normal = (mesh, i) => [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];

const triangles = (mesh) => {
  const out = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    out.push([mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]);
  }
  return out;
};

/** Enclosed volume by the divergence theorem. Positive means outward-facing. */
const signedVolume = (mesh) => {
  let total = 0;
  for (const [ia, ib, ic] of triangles(mesh)) {
    const [a, b, c] = [vertex(mesh, ia), vertex(mesh, ib), vertex(mesh, ic)];
    total +=
      (a[0] * (b[1] * c[2] - c[1] * b[2]) -
        a[1] * (b[0] * c[2] - c[0] * b[2]) +
        a[2] * (b[0] * c[1] - c[0] * b[1])) /
      6;
  }
  return total;
};

test("an empty body produces an empty mesh instead of throwing", () => {
  const mesh = buildBodyMesh([], { resolution: 0.02 });
  assert.equal(mesh.positions.length, 0);
  assert.equal(mesh.indices.length, 0);
  assert.equal(mesh.occlusion, null);
  assert.equal(mesh.resolution, 0.02);
  assert.deepEqual(mesh.bounds, [
    [0, 0, 0],
    [0, 0, 0],
  ]);
});

test("every index is a real vertex and every face is a triangle", () => {
  const mesh = buildBodyMesh(SPHERE, { resolution: 0.02 });
  const count = mesh.positions.length / 3;
  assert.ok(count > 100, `only ${count} vertices`);
  assert.equal(mesh.indices.length % 3, 0, "the index buffer is not a whole number of triangles");
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.occlusion.length, count);
  for (const index of mesh.indices) {
    assert.ok(index >= 0 && index < count, `index ${index} is outside the vertex list`);
  }
  for (const [a, b, c] of triangles(mesh)) {
    assert.ok(a !== b && b !== c && a !== c, "a degenerate triangle was emitted");
  }
  for (const value of mesh.positions) assert.ok(Number.isFinite(value), "a vertex is NaN");
});

test("the surface is closed and consistently wound", () => {
  const mesh = buildBodyMesh(SPHERE, { resolution: 0.02 });
  // On a closed, consistently oriented surface every directed edge appears
  // exactly once and its reverse appears exactly once. A hole shows up as an
  // unpaired edge; a winding flip shows up as a duplicate. This is the whole
  // claim behind stitching from edges rather than from cells, and it is what a
  // 2D exporter needs in order to trust the depth buffer.
  const directed = new Map();
  for (const [a, b, c] of triangles(mesh)) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${u},${v}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  for (const [key, times] of directed) {
    assert.equal(times, 1, `edge ${key} is used ${times} times - the winding flips`);
    const [u, v] = key.split(",");
    assert.ok(directed.has(`${v},${u}`), `edge ${key} has no opposite face - there is a hole`);
  }
});

test("the mesh has the Euler characteristic of the body it came from", () => {
  for (const [label, volumes, components] of [
    ["one sphere", SPHERE, 1],
    [
      "two separate blobs",
      [cone([0, 0, 0], [0, 0, 0], 0.1, 0.1, 0), cone([1, 0, 0], [1, 0, 0], 0.1, 0.1, 0)],
      2,
    ],
    [
      "a limb joined to a torso",
      [cone([0, 0, 0], [0.3, 0, 0], 0.08, 0.12), cone([0.3, 0, 0], [0.3, 0.3, 0], 0.1)],
      1,
    ],
  ]) {
    const mesh = buildBodyMesh(volumes, { resolution: 0.015 });
    const v = mesh.positions.length / 3;
    const f = mesh.indices.length / 3;
    const e = (f * 3) / 2; // exact, because the surface was just shown to be closed
    assert.equal(
      v - e + f,
      2 * components,
      `${label}: V-E+F is ${v - e + f}, not ${2 * components} - the mesh has a handle or a hole`
    );
  }
});

test("faces point outward, and enclose the volume the body actually has", () => {
  const coarse = buildBodyMesh(SPHERE, { resolution: 0.02 });
  const fine = buildBodyMesh(SPHERE, { resolution: 0.01 });
  const coarseVolume = signedVolume(coarse);
  const fineVolume = signedVolume(fine);

  // Positive means the triangles face out. Inward-facing geometry renders as a
  // silhouette-shaped hole, which is the classic marching-cubes winding bug.
  assert.ok(coarseVolume > 0, `the mesh is inside out (${coarseVolume})`);
  assert.ok(
    Math.abs(coarseVolume - SPHERE_VOLUME) / SPHERE_VOLUME < 0.02,
    `coarse volume is ${coarseVolume} against ${SPHERE_VOLUME}`
  );
  // And halving the grid spacing has to get closer, not merely different.
  assert.ok(
    Math.abs(fineVolume - SPHERE_VOLUME) < Math.abs(coarseVolume - SPHERE_VOLUME),
    "refining the grid did not converge on the true volume"
  );
  assert.ok(fine.positions.length > coarse.positions.length * 2, "refining produced no more detail");
});

test("relaxation puts the vertices on the surface, not near it", () => {
  const worstOffset = (mesh, volumes) => {
    let worst = 0;
    for (let v = 0; v < mesh.positions.length / 3; v += 1) {
      worst = Math.max(worst, Math.abs(bodyDistance(vertex(mesh, v), volumes)));
    }
    return worst;
  };
  const volumes = [cone([0, 0, 0], [0.3, 0, 0], 0.08, 0.12), cone([0.3, 0, 0], [0.3, 0.3, 0], 0.1)];
  const relaxed = worstOffset(buildBodyMesh(volumes, { resolution: 0.02 }), volumes);
  const raw = worstOffset(buildBodyMesh(volumes, { resolution: 0.02, relax: 0 }), volumes);

  // The averaged edge crossing is a linear guess on a curved surface and sits
  // measurably inside it. One Newton step costs a single field evaluation and
  // removes essentially all of that error - which is where the extra apparent
  // resolution comes from.
  assert.ok(raw > 0.0005, `the unrelaxed mesh was already exact (${raw}) - nothing is being tested`);
  assert.ok(relaxed < raw / 4, `relaxing only improved ${raw} to ${relaxed}`);
  assert.ok(relaxed < 0.0005, `relaxed vertices are still ${relaxed * 1000}mm off the surface`);
});

test("normals are unit length and agree with the field's gradient", () => {
  const mesh = buildBodyMesh(SPHERE, { resolution: 0.02 });
  for (let v = 0; v < mesh.positions.length / 3; v += 1) {
    const n = normal(mesh, v);
    assert.ok(Math.abs(v3len(n) - 1) < 1e-5, `normal ${v} has length ${v3len(n)}`);
    // On a sphere at the origin the outward normal is the position itself.
    const radial = vertex(mesh, v);
    assert.ok(
      v3dot(n, radial) / v3len(radial) > 0.999,
      `normal ${v} is ${v3dot(n, radial) / v3len(radial)} off radial`
    );
  }
});

test("normals point the same way the triangles face", () => {
  // Shading normals that disagree with the geometric winding light the model
  // from the wrong side, and nothing about the mesh itself reveals it.
  const mesh = buildBodyMesh(SPHERE, { resolution: 0.02 });
  let checked = 0;
  for (const [ia, ib, ic] of triangles(mesh)) {
    const [a, b, c] = [vertex(mesh, ia), vertex(mesh, ib), vertex(mesh, ic)];
    const u = v3sub(b, a);
    const w = v3sub(c, a);
    const face = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const length = v3len(face);
    if (length < 1e-12) continue; // a sliver says nothing about orientation
    assert.ok(
      v3dot(face, normal(mesh, ia)) > 0,
      `face ${ia},${ib},${ic} is wound against its own normal`
    );
    checked += 1;
  }
  assert.ok(checked > 100, `only ${checked} faces were orientable`);
});

test("occlusion darkens creases and leaves convex surfaces alone", () => {
  const convex = buildBodyMesh(SPHERE, { resolution: 0.02 });
  for (const value of convex.occlusion) {
    assert.ok(value >= 0 && value <= 1, `occlusion out of range: ${value}`);
    // Nothing can occlude a lone sphere, so the whole thing must read as open.
    assert.ok(value > 0.98, `an isolated sphere was shaded to ${value}`);
  }

  // Two volumes meeting at a right angle have a crease along the join, and the
  // contact shadow there is most of what makes touching bodies read as
  // touching rather than as two separate renders.
  const creased = [cone([0, 0, 0], [0.3, 0, 0], 0.08, 0.12), cone([0.3, 0, 0], [0.3, 0.3, 0], 0.1)];
  const mesh = buildBodyMesh(creased, { resolution: 0.015 });
  let darkest = 1;
  for (const value of mesh.occlusion) {
    assert.ok(value >= 0 && value <= 1, `occlusion out of range: ${value}`);
    darkest = Math.min(darkest, value);
  }
  assert.ok(darkest < 0.5, `the deepest crease only reached ${darkest}`);

  assert.equal(buildBodyMesh(SPHERE, { resolution: 0.03, ao: false }).occlusion, null);
});

test("the reported bounds contain the mesh", () => {
  const volumes = [cone([0, 0, 0], [0.3, 0, 0], 0.08, 0.12), cone([0.3, 0, 0], [0.3, 0.3, 0], 0.1)];
  const mesh = buildBodyMesh(volumes, { resolution: 0.02 });
  const [lo, hi] = mesh.bounds;
  for (let v = 0; v < mesh.positions.length / 3; v += 1) {
    const p = vertex(mesh, v);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(
        p[axis] >= lo[axis] - 1e-6 && p[axis] <= hi[axis] + 1e-6,
        `vertex ${v} is outside the reported bounds on axis ${axis}`
      );
    }
  }
});
