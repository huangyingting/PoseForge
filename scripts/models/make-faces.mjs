/**
 * Regenerate the faces in assets/models/faces: how far each expression in
 * src/core/expressions.js moves every body's skin, brows and lashes.
 *
 *   node scripts/models/make-faces.mjs [body ...] [--out dir]
 *
 * For every body in bodies.json, MakeHuman builds the body exactly as
 * make-bodies.mjs does and then poses its face in each expression and writes
 * down where everything went (`faces` in makehuman_body.py). The posing is
 * MakeHuman's own - its face pose units on its default skeleton's face bones,
 * which the game-engine rig the bodies are exported with does not have - so,
 * like the hair, it has to happen there.
 *
 * What comes back is per MakeHuman vertex, in MakeHuman's coordinates. The
 * transform to the template's is found and checked as make-hair.mjs finds it
 * (`calibrate`), and each of the GLB's vertices is then the MakeHuman vertex
 * at the same point: the exporter only copied vertices, at the seams of the
 * skin photograph, and never moved one. The brows and lashes are the pair the
 * body type wears (`FACE_TRIMS`), split exactly as their cards were.
 *
 * The mouth comes from MakeHuman too: its teeth (with the gums, told apart by
 * their texture) and its tongue, fitted to the body and posed with the face,
 * so the lower teeth drop with the jaw (`mouthParts`). And how dark it is in
 * there, which the app has no way to know - its occlusion is sampled from
 * collision volumes with no mouth in them - is measured here by rays against
 * the face and the teeth, for the skin round and inside the mouth and for every
 * vertex of the teeth, the gums and the tongue, at rest and in each expression
 * (`shadeMouth`).
 *
 * A fine body (make-fine-bodies.mjs) has no MakeHuman face to pose. It stands
 * for a MakeHuman body whose face its own was bent onto, so each of its
 * vertices moves as the point of that body's surface nearest it moves, found
 * among the triangles facing the same way, and where the lips meet on the same
 * lip. Its lips, which are one surface, are cut apart where they are joined,
 * and behind them is that body's mouth: its teeth, its tongue and the inside
 * of its lips. Its brows and lashes are that body's, moved as they were, and
 * move as they do.
 *
 * Writes faces-<body>.bin, in the hair cards' container (see
 * src/core/hairCards.js): for each expression, the skin vertices it moves and
 * by how much, in steps of `FACE_STEP`, and the offset of every brow and lash
 * card vertex; the mouth's parts at rest and how far each expression moves
 * them; the shade in the mouth at rest and in each expression; and, for a fine
 * body, the triangles its lips are cut along. A vertex that moves by less than
 * a few microns is left out.
 *
 * Needs what make-bodies.mjs needs to run MakeHuman, and the bodies and hair
 * already in assets/models. About a minute a body.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXPRESSIONS, FACE_STEP } from "../../src/core/expressions.js";
import { FACE_TRIMS } from "../../src/core/hair.js";
import { packCards, readCards } from "../../src/core/hairCards.js";
import { movedNormals } from "../../src/core/humanMesh.js";
import { decodePNG, sampleAtlas } from "../atlas.mjs";
import { TriangleGrid, vertexNormals } from "./make-fine-bodies.mjs";
import { MAKEHUMAN, bodies, calibrate, corners, fit, models, template } from "./makehuman.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const out = resolve(option("out", join(models, "faces")));

/** The fine bodies, and the MakeHuman body each stands for. */
const FINE = { "female-fine": "female", "male-fine": "male", "neutral-fine": "neutral" };
const names = args.length ? args : [...Object.keys(bodies), ...Object.keys(FINE)];
for (const name of names) if (!bodies[name] && !FINE[name]) throw new Error(`no body "${name}"`);

/** Expressions with something in them; `neutral` is the scan as it is. */
const POSED = Object.entries(EXPRESSIONS).filter(([, mix]) => Object.keys(mix).length);

/** Offsets under this many steps are not worth a vertex. */
const LEAST = 2;

const typeOf = (name) => name.split("-")[0];
const trimsOf = (name) => {
  const { brows, lashes } = FACE_TRIMS[typeOf(name)];
  return [
    [brows, "Eyebrows", `eyebrows/${brows}/${brows}.mhpxy`],
    [lashes, "Eyelashes", `eyelashes/${lashes}/${lashes}.mhpxy`],
  ];
};
const cards = readCards(readFileSync(join(models, "hair", "cards.bin")));

/**
 * The inside of the mouth: MakeHuman's teeth and tongue, fitted to the body and
 * posed with its face, so the lower teeth and the tongue drop with the jaw.
 */
const MOUTH = [
  ["teeth", "Teeth", "teeth/teeth_base/teeth_base.mhpxy"],
  ["tongue", "Tongue", "tongue/tongue01/tongue01.mhpxy"],
];

/**
 * The teeth proxy is the teeth and the gums they stand in, told apart only by
 * its texture, which paints the gums red: a face goes to the gums if it is
 * painted red there, and to the teeth otherwise.
 */
const TEETH_TEXTURE = join(MAKEHUMAN, "data/teeth/materials/teeth.png");
const isGum = ([r, g]) => r > 3 * g + 0.01;

/** A dense offset, in template units, as the steps it is stored in. */
function quantise(offsets, what) {
  return Int16Array.from(offsets, (value) => {
    const step = Math.round(value / FACE_STEP);
    if (Math.abs(step) > 32767) throw new Error(`${what} moves ${(value * 1720).toFixed(1)}mm, past what FACE_STEP can store`);
    return step;
  });
}

/**
 * One expression's skin offsets, `dense` three per vertex, as the vertices
 * that move and how far.
 */
function sparse(dense, what) {
  const moved = [];
  for (let v = 0; v < dense.length / 3; v += 1)
    if (Math.max(Math.abs(dense[v * 3]), Math.abs(dense[v * 3 + 1]), Math.abs(dense[v * 3 + 2])) >= LEAST * FACE_STEP) moved.push(v);
  const offsets = new Float64Array(moved.length * 3);
  moved.forEach((v, i) => offsets.set(dense.subarray(v * 3, v * 3 + 3), i * 3));
  return { vertices: dense.length / 3 < 65536 ? Uint16Array.from(moved) : Uint32Array.from(moved), offsets: quantise(offsets, what) };
}

/**
 * The mouth's parts as the app draws them - the teeth, the gums and the
 * tongue - each a mesh of the proxy vertices its faces use, at rest in the
 * template's frame, with how far each of those vertices moves in every
 * expression, dense.
 */
function mouthParts(fitted, toTemplate, height) {
  const texture = decodePNG(readFileSync(TEETH_TEXTURE));
  const parts = {};
  for (const [proxy] of MOUTH) {
    const { coords, faces, faceUVs, uvs } = fitted.proxies[proxy];
    const triangles = {};
    faces.forEach((face, f) => {
      let part = proxy;
      if (proxy === "teeth") {
        const at = [...new Set(faceUVs[f])].map((uv) => uvs[uv]);
        const u = at.reduce((sum, [x]) => sum + x, 0) / at.length;
        const v = at.reduce((sum, [, y]) => sum + y, 0) / at.length;
        // MakeHuman's v runs up the image, as `corners` has it.
        part = isGum(sampleAtlas(texture, u, 1 - v)) ? "gums" : "teeth";
      }
      const list = (triangles[part] ??= []);
      const [a, b, c, d] = face;
      if (a !== b && b !== c && a !== c) list.push(a, b, c);
      if (a !== c && c !== d && a !== d) list.push(a, c, d);
    });
    for (const [part, list] of Object.entries(triangles)) {
      const remap = new Map();
      const indices = Uint32Array.from(list, (v) => {
        if (!remap.has(v)) remap.set(v, remap.size);
        return remap.get(v);
      });
      const source = [...remap.keys()];
      const positions = new Float32Array(source.length * 3);
      source.forEach((v, i) => positions.set(toTemplate(coords[v]), i * 3));
      const offsets = {};
      for (const [expression] of POSED) {
        const moved = fitted.expressions[expression].proxies[proxy];
        const dense = new Float64Array(source.length * 3);
        source.forEach((v, i) => {
          for (let axis = 0; axis < 3; axis += 1) dense[i * 3 + axis] = moved[v][axis] / height;
        });
        offsets[expression] = dense;
      }
      parts[part] = { positions, indices, offsets };
    }
  }
  return parts;
}

/**
 * How far a ray from inside the mouth looks for something in its way: three
 * and a half centimetres, which is past the lips from anywhere behind them and
 * short of anything across the room.
 */
const REACH = 0.02;

/**
 * Directions over the hemisphere about +z, spread evenly over the disc under
 * it and lifted onto it - denser towards the pole, as the light a surface takes
 * in is weighted - so the share of them that get out is how much of the room a
 * point is lit by.
 */
const RAYS = Array.from({ length: 64 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 64);
  const turn = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(turn), r * Math.sin(turn), Math.sqrt(1 - r * r)];
});

/**
 * The share of rays that get out, below which a point is in the mouth rather
 * than on the face: an open valley on a face keeps three quarters of its sky,
 * a point behind the lips a small part of it.
 */
const OPEN = 0.75;

/**
 * Directions within forty degrees of straight out of the face, +z, spread
 * evenly over that cap of the sphere. What light gets into a mouth comes in at
 * the front of it, and the teeth drawn in it cast and take no shadows, so a
 * tooth that can see out between the lips is lit by all that can: the sky it
 * keeps is only the dark of the rest.
 */
const AHEAD = Array.from({ length: 32 }, (_, i) => {
  const z = 1 - ((i + 0.5) / 32) * (1 - Math.cos((40 * Math.PI) / 180));
  const r = Math.sqrt(1 - z * z);
  const turn = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(turn), r * Math.sin(turn), z];
});

/** The least light anything in the mouth keeps, as the eyes keep a little. */
const DARKEST = 0.05;

/**
 * How lit each of `which` is by what `grid` leaves open about it: the more of
 * the sky over its normal it keeps (1 at `OPEN`), or of the way out of the
 * front of the mouth, `AHEAD`.
 */
function openness(grid, positions, normals, which) {
  const out = new Float32Array(which.length);
  const seen = new Map();
  which.forEach((v, i) => {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    // The copies of a point at a seam of the skin photograph see the same;
    // the two sides of a crease do not.
    const key = `${p.map((x) => Math.round(x * 1e7))},${n.map((x) => Math.round(x * 100))}`;
    if (seen.has(key)) return (out[i] = seen.get(key));
    const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const tl = Math.hypot(...t);
    for (let k = 0; k < 3; k += 1) t[k] /= tl;
    const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const origin = p.map((x, k) => x + n[k] * 2e-6);
    let open = 0;
    for (const [x, y, z] of RAYS) {
      const d = [0, 1, 2].map((k) => t[k] * x + b[k] * y + n[k] * z);
      if (!grid.blocked(origin, d, REACH)) open += 1;
    }
    // Only what faces the way out can see out of it.
    let ahead = 0;
    for (const d of AHEAD) if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > 0 && !grid.blocked(origin, d, REACH)) ahead += 1;
    out[i] = Math.min(1, Math.max(open / RAYS.length / OPEN, ahead / AHEAD.length));
    seen.set(key, out[i]);
  });
  return out;
}

/**
 * The shade inside the mouth, with the face in one expression: how much each
 * point of the skin round the mouth is darkened for being inside it, and how
 * much light each vertex of the teeth, the gums and the tongue gets.
 *
 * The occlusion the app draws a body with is sampled from its collision
 * volumes, and the head there is a solid cone: it has no mouth in it to be
 * dark, and the inside of the lips, the roof of the mouth and the teeth would
 * all come out as lit as a cheek. So it is measured here instead, by rays
 * against the face and everything in the mouth, and a point that keeps most of
 * its sky - anything on the outside of the face - is left alone.
 *
 * @param body the template's skin, as it was baked
 * @param positions its vertices in this expression
 * @param parts the mouth's parts, `{positions, indices}` in this expression
 * @param centre the front of the teeth, at rest
 * @returns {{skin:{vertices:number[], shade:Uint8Array}, parts:Object<string, Uint8Array>}}
 */
function shadeMouth(body, positions, normals, parts, centre) {
  const near = (p, v, radius) => Math.hypot(p[v * 3] - centre[0], p[v * 3 + 1] - centre[1], p[v * 3 + 2] - centre[2]) < radius;
  // Everything within eight centimetres of the mouth that could be in the way,
  // gathered into one mesh.
  const soup = [];
  const indices = [];
  const add = (p, list, keep) => {
    const remap = new Map();
    for (let i = 0; i < list.length; i += 3) {
      if (keep && !keep(list[i])) continue;
      for (let k = 0; k < 3; k += 1) {
        const v = list[i + k];
        if (!remap.has(v)) {
          remap.set(v, soup.length / 3);
          soup.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
        }
        indices.push(remap.get(v));
      }
    }
  };
  add(positions, body.indices, (v) => near(positions, v, 0.045));
  for (const part of Object.values(parts)) add(part.positions, part.indices);
  const grid = new TriangleGrid(Float64Array.from(soup), Uint32Array.from(indices), 0.0012);

  const receivers = [];
  for (let v = 0; v < positions.length / 3; v += 1) if (near(positions, v, 0.03)) receivers.push(v);
  const open = openness(grid, positions, normals, receivers);
  const vertices = [];
  const shade = [];
  receivers.forEach((v, i) => {
    const value = Math.round(open[i] * 255);
    if (value < 254) {
      vertices.push(v);
      shade.push(value);
    }
  });

  const lit = {};
  for (const [name, part] of Object.entries(parts)) {
    const count = part.positions.length / 3;
    const all = Array.from({ length: count }, (_, v) => v);
    const seen = openness(grid, part.positions, vertexNormals(part.positions, part.indices), all);
    lit[name] = Uint8Array.from(seen, (value) => Math.round(Math.max(DARKEST, value ** 0.7) * 255));
  }
  return { skin: { vertices, shade: Uint8Array.from(shade) }, parts: lit };
}

/** The middle of the front of the teeth, at rest. */
function frontOfTeeth(mouth) {
  let front = -Infinity;
  let y = 0;
  const teeth = mouth.teeth.positions;
  for (let v = 0; v < teeth.length / 3; v += 1) {
    front = Math.max(front, teeth[v * 3 + 2]);
    y += teeth[v * 3 + 1] / (teeth.length / 3);
  }
  return [0, y, front];
}

/**
 * The shade inside the mouth at rest and in every expression, for a skin at
 * rest as `body` has it and moved by `skin`'s dense offsets.
 */
function shadeAll(body, skin, mouth) {
  const centre = frontOfTeeth(mouth);
  const count = body.positions.length / 3;
  const shaded = { rest: shadeMouth(body, body.positions, body.normals, mouth, centre) };
  for (const [expression, dense] of Object.entries(skin)) {
    const positions = new Float32Array(count * 3);
    const moved = new Uint8Array(count);
    for (let v = 0; v < count; v += 1)
      for (let axis = 0; axis < 3; axis += 1) {
        positions[v * 3 + axis] = body.positions[v * 3 + axis] + dense[v * 3 + axis];
        if (dense[v * 3 + axis]) moved[v] = 1;
      }
    const parts = Object.fromEntries(
      Object.entries(mouth).map(([name, part]) => [
        name,
        { indices: part.indices, positions: Float32Array.from(part.positions, (x, i) => x + part.offsets[expression][i]) },
      ]),
    );
    shaded[expression] = shadeMouth(body, positions, movedNormals(body, positions, moved), parts, centre);
  }
  return shaded;
}

/**
 * One MakeHuman body: its skin's offsets per expression, dense, one row of
 * three per GLB vertex, and its trims' per card vertex.
 */
function bake(name, work) {
  const output = join(work, `${name}.json`);
  const request = { expressions: Object.fromEntries(POSED), proxies: [...trimsOf(name), ...MOUTH], output };
  const fitted = fit(name, work, { POSEFORGE_FACES: JSON.stringify(request) }, output);
  const { toTemplate, height, worst, template: glb } = calibrate(name, fitted.body);

  // The MakeHuman vertex at each GLB vertex, through a grid of cells a tenth
  // of a millimetre across.
  const CELL = 1e-4;
  const cell = (p) => p.map((x) => Math.floor(x / CELL));
  const grid = new Map();
  fitted.body.forEach((point, j) => {
    const key = cell(toTemplate(point)).join(",");
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(j);
  });
  const body = glb.submeshes.find((submesh) => submesh.primary);
  const count = body.positions.length / 3;
  const source = new Int32Array(count);
  for (let v = 0; v < count; v += 1) {
    const p = [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]];
    const [cx, cy, cz] = cell(p);
    let best = -1;
    let bestDistance = 2e-6;
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1)
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const q = toTemplate(fitted.body[j]);
            const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
            if (d < bestDistance) {
              bestDistance = d;
              best = j;
            }
          }
    if (best < 0) throw new Error(`${name}: GLB vertex ${v} is at no MakeHuman vertex`);
    source[v] = best;
  }

  const skin = {};
  const trims = {};
  for (const [expression] of POSED) {
    const moved = fitted.expressions[expression];
    const dense = new Float64Array(count * 3);
    for (let v = 0; v < count; v += 1) for (let axis = 0; axis < 3; axis += 1) dense[v * 3 + axis] = moved.body[source[v]][axis] / height;
    skin[expression] = dense;
    for (const [trim] of trimsOf(name)) {
      const { split } = corners(fitted.proxies[trim]);
      if (split.length !== cards.meta.trims[trim].vertices) throw new Error(`${trim} on ${name} splits differently from cards.bin`);
      const offsets = new Float64Array(split.length * 3);
      split.forEach((vertex, i) => {
        for (let axis = 0; axis < 3; axis += 1) offsets[i * 3 + axis] = moved.proxies[trim][vertex][axis] / height;
      });
      (trims[trim] ??= {})[expression] = offsets;
    }
  }
  const mouth = mouthParts(fitted, toTemplate, height);
  return { count, skin, trims, mouth, shade: shadeAll(body, skin, mouth), worst, glb: body };
}

/**
 * A fine body's offsets, from the MakeHuman body it stands for: each vertex
 * moves as the nearest point on that body's surface does, among the triangles
 * facing within about seventy degrees of the same way and no further than a
 * centimetre and a half - and where the lips meet, on the same lip (see
 * `lipSides`). The rest do not move, and most of them are nowhere near the
 * face. Its lips are cut apart (`cutMouth`), and the mouth they open on is
 * that body's: its teeth, its tongue and the inside of its lips (`lining`).
 */
function transfer(name, base) {
  const fine = template(name).submeshes.find((submesh) => submesh.primary);
  const count = fine.positions.length / 3;
  const surface = new TriangleGrid(base.glb.positions, base.glb.indices, 0.005);
  const lips = lipSides(base);
  // Only near the face is anything moving.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const dense of Object.values(base.skin))
    for (let v = 0; v < base.count; v += 1) {
      if (Math.max(Math.abs(dense[v * 3]), Math.abs(dense[v * 3 + 1]), Math.abs(dense[v * 3 + 2])) < LEAST * FACE_STEP) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        lo[axis] = Math.min(lo[axis], base.glb.positions[v * 3 + axis]);
        hi[axis] = Math.max(hi[axis], base.glb.positions[v * 3 + axis]);
      }
    }
  const skin = Object.fromEntries(Object.keys(base.skin).map((expression) => [expression, new Float64Array(count * 3)]));
  const moves = new Int8Array(count);
  let near = 0;
  let found = 0;
  for (let v = 0; v < count; v += 1) {
    const p = [fine.positions[v * 3], fine.positions[v * 3 + 1], fine.positions[v * 3 + 2]];
    if (p.some((x, axis) => x < lo[axis] - 0.01 || x > hi[axis] + 0.01)) continue;
    near += 1;
    const n = [fine.normals[v * 3], fine.normals[v * 3 + 1], fine.normals[v * 3 + 2]];
    const facing = (t) => {
      const m = surface.normal(t);
      return m[0] * n[0] + m[1] * n[1] + m[2] * n[2] > 0.35;
    };
    const lip = lips.of(p, n);
    const hit = (lip && surface.nearest(p, 0.009, (t) => lips.sides[t] === lip && facing(t))) || surface.nearest(p, 0.009, facing);
    if (!hit) continue;
    found += 1;
    moves[v] = lips.sides[hit.triangle];
    const at = [0, 1, 2].map((k) => base.glb.indices[hit.triangle * 3 + k]);
    for (const [expression, dense] of Object.entries(base.skin))
      for (let axis = 0; axis < 3; axis += 1)
        skin[expression][v * 3 + axis] = at.reduce((sum, c, k) => sum + hit.bary[k] * dense[c * 3 + axis], 0);
  }
  const cut = cutMouth(fine, skin, moves, lips);
  const gone = new Set(cut);
  const opened = { ...fine, indices: fine.indices.filter((_, i) => !gone.has(Math.floor(i / 3))) };
  const mouth = { ...base.mouth, lining: lining(base) };
  return {
    count,
    skin,
    trims: base.trims,
    mouth,
    cut,
    shade: shadeAll(opened, skin, mouth),
    report: `${found}/${near} vertices near the face found on it, ${cut.length} triangles cut where the lips are joined`,
  };
}

/**
 * How near where MakeHuman's lips meet a point of a fine body's is on the
 * underside of one lip or the top of the other: four millimetres, short of
 * where the upper lip turns up towards the nose.
 */
const MEET = 0.0025;

/**
 * Which lip each of the MakeHuman body's triangles is on, and which lip a
 * point of a fine body's is.
 *
 * The two bodies' lips do not meet at quite the same height, so where they
 * meet the nearest point on the MakeHuman body to a fine body's lower lip can
 * be on its upper one, and the two would part with the lower lip torn along
 * its top. MakeHuman's lips are two edges, with the inside of the mouth behind
 * them: where they meet is every two points within half a millimetre and a
 * bit of each other that some expression parts by more than `TORN`, the one
 * it lifts more on the upper lip. Every other point round the mouth is on the
 * lip of the nearest of those, over the surface. MHR's lips are one surface
 * folded in, and within `MEET` of where MakeHuman's meet, a point of it facing
 * down is the underside of the upper lip and one facing up the top of the
 * lower.
 *
 * @returns {{sides:Int8Array, of:(p:number[], n:number[]) => number, meets:(p:number[]) => boolean}}
 *   1 for the upper lip, -1 the lower, 0 for a triangle on neither or a point
 *   that could be on either; and whether a point is within `MEET` of where
 *   they meet
 */
function lipSides(base) {
  const P = base.glb.positions;
  const I = base.glb.indices;
  const count = P.length / 3;
  const centre = frontOfTeeth(base.mouth);
  const near = (v) => Math.hypot(P[v * 3] - centre[0], P[v * 3 + 1] - centre[1], P[v * 3 + 2] - centre[2]) < 0.03;
  const first = new Map();
  const weld = new Int32Array(count);
  for (let v = 0; v < count; v += 1) {
    const key = `${Math.round(P[v * 3] * 1e7)},${Math.round(P[v * 3 + 1] * 1e7)},${Math.round(P[v * 3 + 2] * 1e7)}`;
    if (!first.has(key)) first.set(key, v);
    weld[v] = first.get(key);
  }
  const next = new Map();
  for (let i = 0; i < I.length; i += 3)
    for (let e = 0; e < 3; e += 1) {
      const a = weld[I[i + e]];
      const b = weld[I[i + ((e + 1) % 3)]];
      if (a === b || !near(a) || !near(b)) continue;
      const length = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      for (const [from, to] of [[a, b], [b, a]]) {
        if (!next.has(from)) next.set(from, []);
        next.get(from).push([to, length]);
      }
    }
  // Where they meet.
  const side = new Map();
  const points = [...next.keys()];
  const expressions = Object.values(base.skin);
  for (let i = 0; i < points.length; i += 1)
    for (let j = i + 1; j < points.length; j += 1) {
      const [a, b] = [points[i], points[j]];
      if (Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) >= 0.0004) continue;
      let parted = 0;
      for (const dense of expressions) {
        const apart = dense[a * 3 + 1] - dense[b * 3 + 1];
        if (Math.abs(apart) > Math.abs(parted)) parted = apart;
      }
      if (Math.abs(parted) < TORN) continue;
      side.set(a, Math.sign(parted));
      side.set(b, -Math.sign(parted));
    }
  const meet = [...side.keys()];
  // And the rest, from there.
  const distance = new Map(meet.map((v) => [v, 0]));
  const queue = [...meet];
  while (queue.length) {
    queue.sort((a, b) => distance.get(b) - distance.get(a));
    const v = queue.pop();
    for (const [to, length] of next.get(v)) {
      const further = distance.get(v) + length;
      if (further >= (distance.get(to) ?? Infinity)) continue;
      if (!distance.has(to)) queue.push(to);
      distance.set(to, further);
      side.set(to, side.get(v));
    }
  }
  const sides = new Int8Array(I.length / 3);
  for (let t = 0; t < sides.length; t += 1) sides[t] = side.get(weld[I[t * 3]]) ?? 0;
  // The line they meet along, all of it.
  const upper = [...side].filter(([, s]) => s > 0).map(([v]) => v);
  const lower = [...side].filter(([, s]) => s < 0).map(([v]) => v);
  const gap = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const line = upper.filter((a) => lower.some((b) => gap(a, b) < 0.0009));
  const meets = (p) => line.some((v) => Math.hypot(P[v * 3] - p[0], P[v * 3 + 1] - p[1], P[v * 3 + 2] - p[2]) < MEET);
  const of = (p, n) => (Math.abs(n[1]) >= 0.3 && meets(p) ? (n[1] < 0 ? 1 : -1) : 0);
  return { sides, of, meets };
}

/**
 * How far apart, in some expression, MakeHuman's lips have to part two points
 * that touch at rest for those to be where they meet: a millimetre and a half.
 */
const TORN = 0.0009;

/**
 * How far apart some expression has to pull the two ends of an edge across
 * where a fine body's lips are joined for the triangles on it to be cut: half
 * a millimetre, which a kiss parts them by.
 */
const PARTED = 0.0003;

/**
 * The triangles a fine body's lips are joined by, to be cut.
 *
 * MHR's surface is closed across the mouth: its lips fold in a little way and
 * meet along one row of triangles, and each side of that row, moving with the
 * lip it is on, would stretch the row into a curtain across an open mouth. So
 * the row - every triangle in the fold with an edge from a point on one lip to
 * a point on the other that some expression parts - is left out of the body,
 * and the lips part as MakeHuman's do, each with its own side of the fold on
 * it. Closed, the two sides of the fold touch, and the slit at the back of it
 * is out of sight. A triangle facing out of the face is not in the fold but
 * past the corner of the mouth, where the skin between the lips stretches
 * rather than parts; some of the row, though, are slivers, three points all but
 * in one place, which face no way at all.
 *
 * @param {Int8Array} moves the lip each vertex moves with (see `lipSides`)
 */
function cutMouth(fine, skin, moves, lips) {
  const P = fine.positions;
  const I = fine.indices;
  const dense = Object.values(skin);
  const at = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const inward = (t) => {
    const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].map(at);
    const u = [0, 1, 2].map((k) => b[k] - a[k]);
    const w = [0, 1, 2].map((k) => c[k] - a[k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    // Twice the area: a fiftieth of a square millimetre is a sliver.
    const twice = Math.hypot(...n);
    return n[2] <= 0.5 * twice || twice < 1.4e-8;
  };
  const parted = (a, b) => Math.max(...dense.map((d) => Math.hypot(d[a * 3] - d[b * 3], d[a * 3 + 1] - d[b * 3 + 1], d[a * 3 + 2] - d[b * 3 + 2])));
  const cut = [];
  for (let t = 0; t < I.length / 3; t += 1)
    for (let e = 0; e < 3; e += 1) {
      const a = I[t * 3 + e];
      const b = I[t * 3 + ((e + 1) % 3)];
      if (moves[a] * moves[b] < 0 && lips.meets(at(a)) && lips.meets(at(b)) && parted(a, b) >= PARTED && inward(t)) {
        cut.push(t);
        break;
      }
    }
  return cut;
}

/**
 * How dark, at rest, a point of the MakeHuman body's skin is if it is inside
 * the mouth rather than on the lips: a fifth of the light, which the lips,
 * pressed together, keep more than, and the mouth behind them, shut, far less.
 */
const LINING = 0.2;

/**
 * The inside of the MakeHuman body's mouth, for a fine body, whose own has
 * none: MakeHuman's lips turn in to a mouth, the skin of which, moved as it is
 * moved, is behind a fine body's lips once they are cut apart (`cutMouth`), in
 * the same form as the teeth and the tongue (see `mouthParts`).
 */
function lining(base) {
  const P = base.glb.positions;
  const I = base.glb.indices;
  const inside = new Uint8Array(base.count);
  const { vertices, shade } = base.shade.rest.skin;
  vertices.forEach((v, i) => {
    if (shade[i] < LINING * 255) inside[v] = 1;
  });
  // One vertex for all the copies of a point at a seam of the photograph.
  const first = new Map();
  const remap = new Map();
  const list = [];
  for (let t = 0; t < I.length; t += 3) {
    if (!inside[I[t]] || !inside[I[t + 1]] || !inside[I[t + 2]]) continue;
    for (let k = 0; k < 3; k += 1) {
      const v = I[t + k];
      const key = `${Math.round(P[v * 3] * 1e7)},${Math.round(P[v * 3 + 1] * 1e7)},${Math.round(P[v * 3 + 2] * 1e7)}`;
      if (!first.has(key)) first.set(key, v);
      const welded = first.get(key);
      if (!remap.has(welded)) remap.set(welded, remap.size);
      list.push(remap.get(welded));
    }
  }
  const source = [...remap.keys()];
  const positions = new Float32Array(source.length * 3);
  source.forEach((v, i) => positions.set(P.subarray(v * 3, v * 3 + 3), i * 3));
  const offsets = Object.fromEntries(
    Object.entries(base.skin).map(([expression, dense]) => {
      const moved = new Float64Array(source.length * 3);
      source.forEach((v, i) => moved.set(dense.subarray(v * 3, v * 3 + 3), i * 3));
      return [expression, moved];
    }),
  );
  return { positions, indices: Uint32Array.from(list), offsets };
}

function write(name, baked) {
  const arrays = {};
  let moved = 0;
  for (const [expression, dense] of Object.entries(baked.skin)) {
    const { vertices, offsets } = sparse(dense, `${expression} on ${name}`);
    arrays[`${expression}.body.vertices`] = vertices;
    arrays[`${expression}.body`] = offsets;
    moved = Math.max(moved, vertices.length);
  }
  const trims = {};
  for (const [trim, byExpression] of Object.entries(baked.trims)) {
    for (const [expression, offsets] of Object.entries(byExpression)) {
      arrays[`${expression}.${trim}`] = quantise(offsets, `${trim} in ${expression} on ${name}`);
      trims[trim] = offsets.length / 3;
    }
  }
  const mouth = {};
  for (const [part, { positions, indices, offsets }] of Object.entries(baked.mouth)) {
    mouth[part] = positions.length / 3;
    arrays[`${part}.positions`] = positions;
    arrays[`${part}.indices`] = mouth[part] < 65536 ? Uint16Array.from(indices) : indices;
    for (const [expression, dense] of Object.entries(offsets)) {
      const { vertices, offsets: steps } = sparse(dense, `${part} in ${expression} on ${name}`);
      arrays[`${expression}.${part}.vertices`] = vertices;
      arrays[`${expression}.${part}`] = steps;
    }
  }
  if (baked.cut?.length) arrays["body.cut"] = Uint32Array.from(baked.cut);
  for (const [state, { skin, parts }] of Object.entries(baked.shade)) {
    arrays[`${state}.body.cavity.vertices`] = baked.count < 65536 ? Uint16Array.from(skin.vertices) : Uint32Array.from(skin.vertices);
    arrays[`${state}.body.cavity`] = skin.shade;
    for (const [part, lit] of Object.entries(parts)) arrays[`${state}.${part}.occlusion`] = lit;
  }
  const bytes = packCards({ body: name, step: FACE_STEP, vertices: baked.count, expressions: Object.keys(baked.skin), trims, mouth }, arrays);
  writeFileSync(join(out, `faces-${name}.bin`), bytes);
  return { moved, size: bytes.length };
}

mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "poseforge-faces-"));
try {
  const baked = new Map();
  const ordered = [...names.filter((name) => bodies[name]), ...names.filter((name) => FINE[name])];
  for (const name of ordered) {
    const started = Date.now();
    let result;
    let note;
    if (FINE[name]) {
      const base = baked.get(FINE[name]) ?? bake(FINE[name], join(work, FINE[name]));
      result = transfer(name, base);
      note = result.report;
    } else {
      result = bake(name, join(work, name));
      baked.set(name, result);
      note = `body within ${(result.worst * 1720 * 1000).toFixed(2)}um of its GLB`;
    }
    const { moved, size } = write(name, result);
    console.log(`${name}: up to ${moved} of ${result.count} vertices move, ${(size / 1024).toFixed(0)}kB; ${note}; ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
