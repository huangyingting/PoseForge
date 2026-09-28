import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spread, tessellate, TOLERANCE } from "../src/core/tessellate.js";
import { buildHumanTemplate } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";

/**
 * A latitude-longitude sphere, the way a scan is stored: a UV seam down one
 * meridian, where the first column of vertices is repeated with u = 1, and a
 * row of copies at each pole. Normals point out, or in with `inside`.
 */
function sphere({ radius = 0.1, columns = 12, rows = 8, inside = false } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let r = 0; r <= rows; r += 1)
    for (let c = 0; c <= columns; c += 1) {
      const theta = (Math.PI * r) / rows;
      const phi = (2 * Math.PI * (c % columns)) / columns;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      positions.push(...n.map((x) => x * radius));
      normals.push(...n.map((x) => (inside ? -x : x)));
      uvs.push(c / columns, r / rows);
    }
  const indices = [];
  const at = (r, c) => r * (columns + 1) + c;
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < columns; c += 1) {
      const quad = [at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c)];
      const faces = [
        [quad[0], quad[1], quad[2]],
        [quad[0], quad[2], quad[3]],
      ];
      for (const face of faces) indices.push(...(inside ? [face[0], face[2], face[1]] : face));
    }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/** Edges used once, found by position so a seam does not count as one. */
function borders(positions, indices) {
  const key = (v) => [0, 1, 2].map((k) => Math.round(positions[v * 3 + k] * 1e7)).join(",");
  const uses = new Map();
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e += 1) {
      const a = key(indices[t + e]);
      const b = key(indices[t + ((e + 1) % 3)]);
      if (a === b) continue;
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(edge, (uses.get(edge) ?? 0) + 1);
    }
  return [...uses].filter(([, count]) => count === 1).map(([edge]) => edge).sort();
}

const point = (positions, v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];

test("a coarse sphere comes out rounder, closed, and facing the same way", () => {
  const ball = sphere();
  const fine = tessellate(ball, ball.positions);
  const count = ball.positions.length / 3;
  assert.ok(fine.indices.length > ball.indices.length * 2, "the long edges were split");
  assert.equal(fine.parents.length / 2, fine.positions.length / 3 - count);
  // No cracks: every edge in space still has a triangle either side.
  assert.deepEqual(borders(fine.positions, fine.indices), []);
  // Each new vertex is nearer the sphere than the chord it was cut from.
  for (let m = 0; m < fine.parents.length; m += 2) {
    const [a, b] = [point(fine.positions, fine.parents[m]), point(fine.positions, fine.parents[m + 1])];
    const chord = Math.hypot(...a.map((x, k) => (x + b[k]) / 2));
    const made = Math.hypot(...point(fine.positions, count + m / 2));
    assert.ok(Math.abs(made - 0.1) < Math.abs(chord - 0.1), `vertex ${count + m / 2}`);
  }
  // Every triangle still faces out.
  for (let t = 0; t < fine.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => point(fine.positions, fine.indices[t + k]));
    const ab = b.map((x, k) => x - a[k]);
    const ac = c.map((x, k) => x - a[k]);
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...n) < 1e-12) continue; // the poles' copies
    const centre = a.map((x, k) => (x + b[k] + c[k]) / 3);
    assert.ok(n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] > 0, `triangle ${t / 3}`);
  }
});

test("both sides of a seam are cut at the same point, each with its own UV", () => {
  const ball = sphere();
  const fine = tessellate(ball, ball.positions);
  const uvs = spread(ball.uvs, fine.parents, 2);
  const byPlace = new Map();
  for (let v = ball.positions.length / 3; v < fine.positions.length / 3; v += 1) {
    const key = point(fine.positions, v).map((x) => Math.round(x * 1e6)).join(",");
    byPlace.set(key, [...(byPlace.get(key) ?? []), v]);
  }
  const shared = [...byPlace.values()].filter((copies) => copies.length > 1);
  for (const copies of shared)
    for (const v of copies) assert.deepEqual(point(fine.positions, v), point(fine.positions, copies[0]));
  // Down the seam, one copy has the first column's u and the other the last's.
  const seam = shared.filter((copies) => copies.some((v) => uvs[v * 2] === 0));
  assert.ok(seam.length >= 4, "the seam was split");
  for (const copies of seam) assert.ok(copies.some((v) => uvs[v * 2] === 1), "one copy either side of the seam");
});

test("flat surfaces, straight creases and open borders are left as they were", () => {
  // A flat grid: nothing stands off its chord.
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i <= 4; i += 1)
    for (let j = 0; j <= 4; j += 1) positions.push(i * 0.05, 0, j * 0.05), normals.push(0, 1, 0);
  for (let i = 0; i < 4; i += 1)
    for (let j = 0; j < 4; j += 1) {
      const a = i * 5 + j;
      indices.push(a, a + 1, a + 6, a, a + 6, a + 5);
    }
  const flat = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
  const same = tessellate(flat, flat.positions);
  assert.equal(same.positions, flat.positions);
  assert.equal(same.indices, flat.indices);
  assert.equal(same.parents.length, 0);

  // A cube with a normal per face: every edge is a straight crease between
  // copies, which nothing pulls off its line.
  const cube = { positions: [], normals: [], indices: [] };
  for (let axis = 0; axis < 3; axis += 1)
    for (const side of [-1, 1]) {
      const base = cube.positions.length / 3;
      const [u, w] = [(axis + 1) % 3, (axis + 2) % 3];
      for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = [0, 0, 0];
        corner[axis] = side * 0.1;
        corner[u] = p * 0.1;
        corner[w] = q * 0.1;
        const n = [0, 0, 0];
        n[axis] = side;
        cube.positions.push(...corner);
        cube.normals.push(...n);
      }
      cube.indices.push(...(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => base + i));
    }
  const box = { positions: Float32Array.from(cube.positions), normals: Float32Array.from(cube.normals), indices: Uint32Array.from(cube.indices) };
  assert.equal(tessellate(box, box.positions).parents.length, 0);

  // The top half of a sphere: its rim is not split, whatever it curves by.
  const ball = sphere();
  const half = { ...ball, indices: ball.indices.slice(0, ball.indices.length / 2) };
  const fine = tessellate(half, half.positions);
  assert.ok(fine.parents.length > 0);
  assert.deepEqual(borders(fine.positions, fine.indices), borders(half.positions, half.indices));
});

test("a curved crease is split along the line its two sides meet in", () => {
  // A tin: twelve panels round the side, and a lid with its own copies of the
  // rim's vertices, facing up.
  const [radius, height, columns] = [0.1, 0.1, 12];
  const positions = [];
  const normals = [];
  const indices = [];
  const ring = (y, normal) => {
    const base = positions.length / 3;
    for (let c = 0; c < columns; c += 1) {
      const phi = (2 * Math.PI * c) / columns;
      positions.push(Math.cos(phi) * radius, y, Math.sin(phi) * radius);
      normals.push(...(normal ?? [Math.cos(phi), 0, Math.sin(phi)]));
    }
    return base;
  };
  const low = ring(0);
  const high = ring(height);
  for (let c = 0; c < columns; c += 1) {
    const d = (c + 1) % columns;
    indices.push(low + c, high + c, high + d, low + c, high + d, low + d);
  }
  const lid = ring(height, [0, 1, 0]);
  const centre = positions.length / 3;
  positions.push(0, height, 0);
  normals.push(0, 1, 0);
  for (let c = 0; c < columns; c += 1) indices.push(centre, lid + ((c + 1) % columns), lid + c);
  const tin = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
  const count = tin.positions.length / 3;
  const fine = tessellate(tin, tin.positions);
  // The bottom rim is open and stays as it was; the top rim is closed by the lid.
  assert.deepEqual(borders(fine.positions, fine.indices), borders(tin.positions, tin.indices));

  const rim = [];
  for (let v = count; v < fine.positions.length / 3; v += 1) {
    const [x, y, z] = point(fine.positions, v);
    if (Math.abs(y - height) < 1e-6 && Math.hypot(x, z) > radius / 2) rim.push(v);
  }
  // Both copies of every cut, the side's and the lid's: the twelve edges, and
  // then their twenty-four halves.
  assert.equal(rim.length, (columns + columns * 2) * 2);
  // The middle of the first edges' chords, from the axis.
  const chord = radius * Math.cos(Math.PI / columns);
  for (const v of rim) {
    const [x, , z] = point(fine.positions, v);
    assert.ok(Math.abs(Math.hypot(x, z) - radius) < (radius - chord) / 10, `vertex ${v} is on the rim`);
    const [nx, ny, nz] = point(fine.normals, v);
    const side = Math.abs(ny) < 1e-6 && Math.abs(Math.hypot(nx, nz) - 1) < 1e-6;
    const top = Math.abs(ny - 1) < 1e-6;
    assert.ok(side || top, `vertex ${v} faces the way its own side does`);
  }
  // Nothing on a tin is hollow, rim included.
  assert.equal(tessellate(tin, tin.positions, { bridge: true }).positions.length, fine.positions.length);
});

test("held vertices keep their edges, and bridged hollows stay straight", () => {
  const ball = sphere();
  const count = ball.positions.length / 3;
  const held = new Uint8Array(count).map((_, v) => (ball.positions[v * 3 + 1] > 0 ? 1 : 0));
  const fine = tessellate(ball, ball.positions, { held });
  assert.ok(fine.parents.length > 0);
  for (let m = 0; m < fine.parents.length; m += 1) {
    const parent = fine.parents[m];
    assert.ok(parent >= count || !held[parent], `vertex ${count + (m >> 1)} was cut from a held edge`);
  }
  assert.deepEqual(borders(fine.positions, fine.indices), []);
  assert.equal(tessellate(ball, ball.positions, { held: new Uint8Array(count).fill(1) }).parents.length, 0);

  // Seen from inside, a sphere is all hollow.
  const bowl = sphere({ inside: true });
  assert.ok(tessellate(bowl, bowl.positions).parents.length > 0);
  assert.equal(tessellate(bowl, bowl.positions, { bridge: true }).parents.length, 0);
  assert.ok(tessellate(ball, ball.positions, { bridge: true }).parents.length > 0);
});

test("spread gives each new vertex the mean of its parents, in order", () => {
  // 2 is cut from 0 and 1, and 3 from 0 and 2.
  const parents = Int32Array.from([0, 1, 0, 2]);
  assert.deepEqual([...spread(Float32Array.from([0, 1]), parents)], [0, 1, 0.5, 0.25]);
  assert.deepEqual([...spread(Float32Array.from([0, 0, 1, 2]), parents, 2)], [0, 0, 1, 2, 0.5, 1, 0.25, 0.5]);
  assert.equal(spread(null, parents), null);
});

test("a scanned body is split where it curves, and not under its stockings", () => {
  const scan = buildHumanTemplate(readFileSync(new URL("../assets/models/realistic-female.glb", import.meta.url)));
  const dressed = withGarments(scan, { bodyType: "female", wearing: ["stockings"] });
  const skin = dressed.submeshes.find((submesh) => submesh.primary);
  const count = skin.positions.length / 3;
  assert.equal(skin.beneath.length, count);
  const legs = skin.beneath.reduce((sum, under) => sum + under, 0);
  assert.ok(legs > count / 10 && legs < count / 2, `${legs} of ${count} vertices under the stockings`);

  const fine = tessellate(skin, skin.positions, { held: skin.beneath });
  assert.ok(fine.indices.length > skin.indices.length * 1.3, "the scan's long curved edges were split");
  assert.deepEqual(borders(fine.positions, fine.indices), borders(skin.positions, skin.indices));
  for (let m = 0; m < fine.parents.length; m += 1)
    assert.ok(fine.parents[m] >= count || !skin.beneath[fine.parents[m]], "an edge under the stockings was split");

  // Everything that is left stands off its curve by little more than the
  // tolerance: the second round catches the halves of the longest edges.
  const { positions: P, normals: N, indices: I } = fine;
  let worst = 0;
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e += 1) {
      const [a, b] = [I[t + e], I[t + ((e + 1) % 3)]];
      if (a >= count && b >= count) continue;
      if (skin.beneath[a] || skin.beneath[b]) continue;
      const d = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]);
      const wa = d[0] * N[a * 3] + d[1] * N[a * 3 + 1] + d[2] * N[a * 3 + 2];
      const wb = -(d[0] * N[b * 3] + d[1] * N[b * 3 + 1] + d[2] * N[b * 3 + 2]);
      worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((k) => (wa * N[a * 3 + k] + wb * N[b * 3 + k]) / 8)));
    }
  assert.ok(worst < TOLERANCE * 8, `${(worst / TOLERANCE).toFixed(1)} tolerances left`);
});
