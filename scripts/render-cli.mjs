/**
 * Headless render.
 *
 * A browser is the wrong place to check whether the renderer is right. Pulling
 * up a page, typing a sentence and squinting at it does not tell you whether
 * last week's version looked the same, and it cannot run in a test. So this
 * draws the same scene without a GPU: a z-buffered software rasteriser, a
 * shadow map, and a PNG encoder built on node's own zlib.
 *
 * It is deliberately a second implementation of the shading rather than a
 * shared one. The WebGL material is a patch into three's standard shader and
 * cannot be lifted out of it; trying to share code with this would mean
 * reimplementing three's lighting in JavaScript, and the result would agree
 * with the real renderer only by coincidence. What this is for is the part that
 * a second implementation checks well - that the geometry is where it should
 * be, that the figures are the right way round, that nothing is inside the
 * mattress - and for that, a picture that is merely similar is enough.
 *
 *   node scripts/render-cli.mjs "missionary on the bed"
 *   node scripts/render-cli.mjs "spooning" --view top --out top.png
 *   node scripts/render-cli.mjs "cowgirl" --svg
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { parseDescription } from "../src/nlp/parser.js";
import { solveScene } from "../src/core/solver.js";
import { buildBodyMesh } from "../src/render/meshBuilder.js";
import {
  mat4InvertRigid,
  mat4LookAt,
  mat4Multiply,
  mat4Orthographic,
  mat4Perspective,
  v3normalize,
} from "../src/core/math.js";

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
// Flags take a value, except the ones listed as switches. Splitting them
// explicitly is what stops `--svg "missionary"` from eating the description.
const SWITCHES = new Set(["svg", "quiet"]);
const options = new Map();
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }
  const name = arg.slice(2);
  if (SWITCHES.has(name)) options.set(name, true);
  else options.set(name, argv[++i]);
}
const flag = (name, fallback) => options.get(name) ?? fallback;
const has = (name) => options.has(name);

const text =
  positional[0] ?? "she is lying on her back on the bed, he is kneeling between her legs";

const WIDTH = Number(flag("width", 900));
const HEIGHT = Number(flag("height", 640));
const RESOLUTION = Number(flag("res", 12)) / 1000;
const OUT = flag("out", "pose.png");
// Supersampling, not a smarter edge rule. Everything in the picture is an
// interpenetrating curved surface, and the cases where a coverage heuristic
// goes wrong - a silhouette crossing another silhouette at a shallow angle -
// are exactly the cases this scene is made of.
const SS = Math.max(1, Math.min(3, Number(flag("aa", 2))));

const VIEWS = {
  front: [0, 0.18, 1],
  side: [1, 0.18, 0],
  top: [0.001, 1, 0.001],
  three_quarter: [0.75, 0.42, 1],
};
const VIEW = VIEWS[flag("view", "three_quarter")] ?? VIEWS.three_quarter;

const SKIN = [
  [0.88, 0.71, 0.61],
  [0.79, 0.56, 0.45],
];
const PROP_COLOUR = {
  bed: [0.91, 0.89, 0.85],
  "bed-frame": [0.43, 0.36, 0.29],
  sofa: [0.55, 0.6, 0.65],
  chair: [0.6, 0.52, 0.44],
  table: [0.71, 0.63, 0.52],
  bench: [0.66, 0.59, 0.5],
};
const GROUND_COLOUR = [0.85, 0.83, 0.8];

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const parsed = parseDescription(text);
const solved = solveScene(parsed.scene);

/**
 * A draw call: positions, normals, occlusion, indices and one flat colour.
 *
 * Bodies, furniture and the ground all reduce to this, which is why the
 * rasteriser below has no notion of what it is drawing. The alternative - a
 * separate path per kind of object - is how the shadow of a table ends up being
 * computed differently from the shadow of a person.
 */
const objects = [];

solved.actors.forEach((actor, index) => {
  const mesh = buildBodyMesh(actor.volumes, { resolution: RESOLUTION, ao: true });
  objects.push({
    positions: mesh.positions,
    normals: mesh.normals,
    occlusion: mesh.occlusion,
    indices: mesh.indices,
    colour: SKIN[index % SKIN.length],
    skin: true,
  });
});

/** A box as 12 triangles with flat normals. */
function boxObject(center, size, colour) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((s) => s / 2);
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    [[1, 0, 0], [[cx + sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz - sz]]],
    [[-1, 0, 0], [[cx - sx, cy - sy, cz + sz], [cx - sx, cy - sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz + sz]]],
    [[0, 1, 0], [[cx - sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz]]],
    [[0, -1, 0], [[cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz - sz]]],
    [[0, 0, 1], [[cx - sx, cy - sy, cz + sz], [cx - sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy - sy, cz + sz]]],
    [[0, 0, -1], [[cx + sx, cy - sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx - sx, cy - sy, cz - sz]]],
  ];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    occlusion: null,
    indices: Uint32Array.from(indices),
    colour,
  };
}

for (const prop of solved.props) {
  objects.push(boxObject(prop.center, prop.size, PROP_COLOUR[prop.kind] ?? [0.6, 0.6, 0.6]));
}

// The ground, as one big quad.
const R = 14;
objects.push({
  positions: Float32Array.from([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R]),
  normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  occlusion: null,
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  colour: GROUND_COLOUR,
  ground: true,
});

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const object of objects) {
  if (object.ground) continue;
  for (let v = 0; v < object.positions.length; v += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = object.positions[v + axis];
      if (value < bounds.min[axis]) bounds.min[axis] = value;
      if (value > bounds.max[axis]) bounds.max[axis] = value;
    }
  }
}
const focus = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
const extent = Math.max(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]), 0.5);

const FOV = (38 * Math.PI) / 180;
const distance = (extent * 0.62) / Math.tan(FOV / 2) + extent * 0.5;
const direction = v3normalize(VIEW);
const eye = focus.map((c, axis) => c + direction[axis] * distance);

const NEAR = Math.max(0.05, distance - extent * 1.5);
const FAR = distance + extent * 4;
const view = mat4InvertRigid(mat4LookAt(eye, focus, Math.abs(direction[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0]));
const projection = mat4Perspective(FOV, WIDTH / HEIGHT, NEAR, FAR);
const viewProjection = mat4Multiply(projection, view);

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

const KEY = v3normalize([2.4, 3.2, 2.0]);
const FILL = v3normalize([-3, 1.6, 1.4]);
const RIM = v3normalize([-1.2, 2.2, -3.2]);

const SHADOW_SIZE = 1024;
const shadowRadius = extent * 1.15 + 0.4;
const shadowEye = focus.map((c, axis) => c + KEY[axis] * (extent * 2.5 + 2));
const shadowView = mat4InvertRigid(mat4LookAt(shadowEye, focus));
const shadowProjection = mat4Orthographic(
  -shadowRadius,
  shadowRadius,
  -shadowRadius,
  shadowRadius,
  0.05,
  extent * 5 + 6
);
const shadowMatrix = mat4Multiply(shadowProjection, shadowView);

/* ------------------------------------------------------------------ */
/* Rasteriser                                                          */
/* ------------------------------------------------------------------ */

/** Transform a point, keeping w so the interpolation can be perspective-correct. */
function clipSpace(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/**
 * Scanline-fill every triangle, writing depth and calling back per surviving
 * fragment.
 *
 * Triangles that cross the near plane are dropped rather than clipped. Clipping
 * properly means splitting a triangle into two and re-deriving its attributes,
 * and the only geometry that can cross the near plane here is geometry behind
 * the camera - the camera is framed from the scene's own bounds and never ends
 * up inside anybody.
 */
function rasterise(matrix, width, height, depth, onFragment) {
  const area2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  for (const object of objects) {
    const { positions, normals, occlusion, indices } = object;
    const count = positions.length / 3;
    const sx = new Float32Array(count);
    const sy = new Float32Array(count);
    const sz = new Float32Array(count);
    const sw = new Float32Array(count);

    for (let v = 0; v < count; v += 1) {
      const [x, y, z, w] = clipSpace(
        matrix,
        positions[v * 3],
        positions[v * 3 + 1],
        positions[v * 3 + 2]
      );
      sw[v] = w;
      const inv = 1 / (w || 1e-6);
      sx[v] = (x * inv * 0.5 + 0.5) * width;
      sy[v] = (1 - (y * inv * 0.5 + 0.5)) * height;
      sz[v] = z * inv;
    }

    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t];
      const i1 = indices[t + 1];
      const i2 = indices[t + 2];
      if (sw[i0] <= 1e-4 || sw[i1] <= 1e-4 || sw[i2] <= 1e-4) continue;

      const area = area2(sx[i0], sy[i0], sx[i1], sy[i1], sx[i2], sy[i2]);
      // Both windings are drawn. The isosurface is closed, so backfaces are
      // invisible anyway, and the props are boxes seen from outside - but the
      // shadow pass needs backfaces, because the surface that casts a shadow is
      // the one facing the light, whichever way it faces the camera.
      if (Math.abs(area) < 1e-9) continue;

      const minX = Math.max(0, Math.floor(Math.min(sx[i0], sx[i1], sx[i2])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(sx[i0], sx[i1], sx[i2])));
      const minY = Math.max(0, Math.floor(Math.min(sy[i0], sy[i1], sy[i2])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(sy[i0], sy[i1], sy[i2])));
      if (minX > maxX || minY > maxY) continue;

      const invArea = 1 / area;
      const iw0 = 1 / sw[i0];
      const iw1 = 1 / sw[i1];
      const iw2 = 1 / sw[i2];

      for (let py = minY; py <= maxY; py += 1) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px += 1) {
          const cx = px + 0.5;
          let w0 = area2(sx[i1], sy[i1], sx[i2], sy[i2], cx, cy) * invArea;
          let w1 = area2(sx[i2], sy[i2], sx[i0], sy[i0], cx, cy) * invArea;
          let w2 = area2(sx[i0], sy[i0], sx[i1], sy[i1], cx, cy) * invArea;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;

          const z = w0 * sz[i0] + w1 * sz[i1] + w2 * sz[i2];
          const offset = py * width + px;
          if (z >= depth[offset]) continue;
          depth[offset] = z;
          if (!onFragment) continue;

          // Screen-space barycentrics interpolate a plane in screen space,
          // which is not how attributes vary across a perspective triangle.
          // Dividing through by w is the correction; without it the shading
          // slides across large near-edge-on triangles, which on a torso is a
          // visible band.
          const persp = w0 * iw0 + w1 * iw1 + w2 * iw2;
          const b0 = (w0 * iw0) / persp;
          const b1 = (w1 * iw1) / persp;
          const b2 = (w2 * iw2) / persp;

          onFragment(offset, object, i0, i1, i2, b0, b1, b2);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shadow pass                                                         */
/* ------------------------------------------------------------------ */

const shadowDepth = new Float32Array(SHADOW_SIZE * SHADOW_SIZE).fill(Infinity);
rasterise(shadowMatrix, SHADOW_SIZE, SHADOW_SIZE, shadowDepth, null);

/**
 * How much of the key light reaches a point.
 *
 * Four taps rather than one. A single comparison against a 1024-pixel map
 * across a two-metre scene gives a shadow edge two millimetres wide, which at
 * this output size is a hard jagged line; the contact shadow where two bodies
 * meet is the most important shadow in the picture and it is the one that looks
 * worst that way.
 *
 * The bias grows with the angle between the surface and the light. A flat bias
 * has to be set for the worst case, and the worst case here is the side of a
 * bed - nearly parallel to the light, so one shadow texel spans a long way
 * across it and the stored depth is wrong by most of that span. Setting a flat
 * bias large enough for that detaches every shadow in the picture from the
 * thing casting it.
 */
function shadowFactor(x, y, z, ndl) {
  const [cx, cy, cz, cw] = clipSpace(shadowMatrix, x, y, z);
  const inv = 1 / (cw || 1);
  const u = (cx * inv * 0.5 + 0.5) * SHADOW_SIZE;
  const v = (1 - (cy * inv * 0.5 + 0.5)) * SHADOW_SIZE;
  const depth = cz * inv;
  if (u < 1 || v < 1 || u >= SHADOW_SIZE - 1 || v >= SHADOW_SIZE - 1) return 1;

  const slope = Math.min(6, Math.sqrt(1 - ndl * ndl) / Math.max(ndl, 0.08));
  const bias = 0.0006 + 0.0012 * slope;
  let lit = 0;
  for (const [du, dv] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const su = Math.round(u + du);
    const sv = Math.round(v + dv);
    if (depth - bias <= shadowDepth[sv * SHADOW_SIZE + su]) lit += 0.25;
  }
  return lit;
}

/* ------------------------------------------------------------------ */
/* Main pass                                                           */
/* ------------------------------------------------------------------ */

const W = WIDTH * SS;
const H = HEIGHT * SS;
const depth = new Float32Array(W * H).fill(Infinity);
const colour = new Float32Array(W * H * 3);
const BACKDROP = [0.95, 0.94, 0.91];
for (let i = 0; i < W * H; i += 1) {
  colour[i * 3] = BACKDROP[0];
  colour[i * 3 + 1] = BACKDROP[1];
  colour[i * 3 + 2] = BACKDROP[2];
}

const eyeDir = [0, 0, 0];

rasterise(viewProjection, W, H, depth, (offset, object, i0, i1, i2, b0, b1, b2) => {
  const { positions, normals, occlusion, colour: base } = object;

  const px = b0 * positions[i0 * 3] + b1 * positions[i1 * 3] + b2 * positions[i2 * 3];
  const py = b0 * positions[i0 * 3 + 1] + b1 * positions[i1 * 3 + 1] + b2 * positions[i2 * 3 + 1];
  const pz = b0 * positions[i0 * 3 + 2] + b1 * positions[i1 * 3 + 2] + b2 * positions[i2 * 3 + 2];

  let nx = b0 * normals[i0 * 3] + b1 * normals[i1 * 3] + b2 * normals[i2 * 3];
  let ny = b0 * normals[i0 * 3 + 1] + b1 * normals[i1 * 3 + 1] + b2 * normals[i2 * 3 + 1];
  let nz = b0 * normals[i0 * 3 + 2] + b1 * normals[i1 * 3 + 2] + b2 * normals[i2 * 3 + 2];
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;

  const ao = occlusion
    ? b0 * occlusion[i0] + b1 * occlusion[i1] + b2 * occlusion[i2]
    : 1;

  eyeDir[0] = eye[0] - px;
  eyeDir[1] = eye[1] - py;
  eyeDir[2] = eye[2] - pz;
  const eyeLength = Math.hypot(eyeDir[0], eyeDir[1], eyeDir[2]) || 1;
  const vx = eyeDir[0] / eyeLength;
  const vy = eyeDir[1] / eyeLength;
  const vz = eyeDir[2] / eyeLength;

  // Wrapped diffuse. Skin lit from the side stays lit well past ninety degrees,
  // because the light that gets under the surface comes back out somewhere
  // nearby - and the eye reads that soft terminator as flesh.
  const wrap = object.skin ? 0.45 : 0.05;
  const ndl = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
  // A surface turned away from the light is in its own shadow, and there is
  // nothing for the shadow map to add. Skipping the lookup is both the right
  // answer and the one that removes the worst of the acne, because a grazing
  // surface is exactly where a depth comparison is least trustworthy.
  const shadow = ndl > 0 ? shadowFactor(px, py, pz, ndl) : 0;
  const key = Math.max(0, (ndl + wrap) / (1 + wrap)) * shadow * 2.1;
  const fill = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]) * 0.4;
  const rim = Math.max(0, nx * RIM[0] + ny * RIM[1] + nz * RIM[2]) * 0.55;

  // Hemisphere ambient, occluded. This is the term the field's AO acts on, and
  // it is what darkens the crease where two bodies touch.
  const sky = (ny * 0.5 + 0.5) * 0.5 * ao;
  const bounce = 0.11 * ao;

  let r = base[0] * (key * 1.03 + fill * 0.78 + sky * 0.88 + bounce) + rim * 0.9;
  let g = base[1] * (key * 0.96 + fill * 0.86 + sky * 0.92 + bounce) + rim * 0.9;
  let b = base[2] * (key * 0.9 + fill * 1.0 + sky * 1.0 + bounce) + rim * 0.92;

  if (object.skin) {
    // The transmission glow, concentrated where the surface turns away from the
    // camera and is not buried in a crease.
    const facing = 1 - Math.abs(nx * vx + ny * vy + nz * vz);
    const thin = Math.max(0, (ao - 0.35) / 0.65);
    const glow = facing * facing * facing * thin * 0.3;
    r += 0.62 * glow;
    g += 0.23 * glow;
    b += 0.16 * glow;
  }

  colour[offset * 3] = r;
  colour[offset * 3 + 1] = g;
  colour[offset * 3 + 2] = b;
});

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

/** Narkowicz's ACES fit, the same curve three's tone mapping uses. */
function tonemap(x) {
  const v = x * 0.6;
  return Math.max(0, Math.min(1, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)));
}

const encode = (linear) => {
  const c = tonemap(linear);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};

const pixels = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
const inv = 1 / (SS * SS);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  pixels[row] = 0; // filter type: none
  for (let x = 0; x < WIDTH; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const offset = ((y * SS + sy) * W + x * SS + sx) * 3;
        r += colour[offset];
        g += colour[offset + 1];
        b += colour[offset + 2];
      }
    }
    const at = row + 1 + x * 3;
    pixels[at] = encode(r * inv);
    pixels[at + 1] = encode(g * inv);
    pixels[at + 2] = encode(b * inv);
  }
}

/* PNG container. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // truecolour
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
);

/* ------------------------------------------------------------------ */
/* Vector line art                                                     */
/* ------------------------------------------------------------------ */

/**
 * The same silhouette extraction the browser exporter does, against the depth
 * buffer that was just filled in rather than against a GPU depth pass.
 *
 * Having both is the point: the browser version depends on a render target
 * readback and a packed-depth round trip that cannot be exercised without a
 * GPU, and this one shares none of that. If the two disagree about where a
 * figure's outline is, one of them is wrong about the geometry.
 */
function lineArt() {
  const segments = [];
  const scale = 1 / SS;

  for (const object of objects) {
    if (object.ground) continue;
    const { positions, indices } = object;
    const count = indices.length / 3;
    // `front * 8 + back`, counting the adjacent triangles that face the camera
    // and those that do not. An edge they disagree about is the silhouette; an
    // edge with only one triangle is a hole in the surface.
    const edges = new Map();

    for (let t = 0; t < count; t += 1) {
      const i0 = indices[t * 3];
      const i1 = indices[t * 3 + 1];
      const i2 = indices[t * 3 + 2];
      const ax = positions[i0 * 3];
      const ay = positions[i0 * 3 + 1];
      const az = positions[i0 * 3 + 2];
      const ux = positions[i1 * 3] - ax;
      const uy = positions[i1 * 3 + 1] - ay;
      const uz = positions[i1 * 3 + 2] - az;
      const vx = positions[i2 * 3] - ax;
      const vy = positions[i2 * 3 + 1] - ay;
      const vz = positions[i2 * 3 + 2] - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const front =
        nx * (eye[0] - ax) + ny * (eye[1] - ay) + nz * (eye[2] - az) > 0 ? 8 : 1;

      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
        edges.set(key, (edges.get(key) ?? 0) + front);
      }
    }

    for (const [key, code] of edges) {
      const front = code >> 3;
      const back = code & 7;
      if (!((front > 0 && back > 0) || front + back === 1)) continue;
      const b = key % 4294967296;
      const a = (key - b) / 4294967296;
      const pa = screen(positions, a);
      const pb = screen(positions, b);
      if (!pa || !pb) continue;
      for (const run of visibleRuns(pa, pb)) {
        segments.push(
          `M${(run[0].x * scale).toFixed(1)} ${(run[0].y * scale).toFixed(1)}` +
            `L${(run[1].x * scale).toFixed(1)} ${(run[1].y * scale).toFixed(1)}`
        );
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>` +
    `<g fill="none" stroke="#1b1b1b" stroke-width="1.4" stroke-linecap="round">` +
    `<path d="${segments.join("")}"/></g></svg>`
  );
}

function screen(positions, index) {
  const [x, y, z, w] = clipSpace(
    viewProjection,
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2]
  );
  if (w <= 1e-4) return null;
  const inv = 1 / w;
  const ndc = z * inv;
  if (ndc < -1 || ndc > 1) return null;
  return { x: (x * inv * 0.5 + 0.5) * W, y: (1 - (y * inv * 0.5 + 0.5)) * H, z: ndc };
}

/**
 * Split a segment into the parts the depth buffer says are in front.
 *
 * Sampled rather than solved. The exact answer means intersecting the segment
 * with every triangle in the scene, and at the width a line is drawn at, a
 * sample every few pixels is indistinguishable from it.
 *
 * The comparison takes the *farthest* depth in a small neighbourhood rather
 * than the depth under the sample. A silhouette is by definition the pixel
 * where the surface is turning away fastest, so the depth gradient across it is
 * as steep as it gets anywhere in the picture, and half a pixel of rounding
 * puts the stored value well behind the line that generated it. Testing against
 * the nearest neighbour makes an object occlude its own outline, which is why
 * the first version of this drew the furniture perfectly and the people as
 * confetti.
 */
function visibleRuns(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.min(80, Math.ceil(length / (3 * SS))));
  const runs = [];
  let start = null;
  // In NDC depth, which is heavily non-linear - but both the line and the
  // buffer came out of the same projection, so the comparison is like for like.
  const tolerance = 1e-3;

  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);
    const z = from.z + (to.z - from.z) * t;
    let visible = x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
    if (visible) {
      let behind = -Infinity;
      for (let v = -1; v <= 1; v += 1) {
        for (let u = -1; u <= 1; u += 1) {
          const sample = depth[(y + v) * W + x + u];
          if (sample > behind) behind = sample;
        }
      }
      visible = z <= behind + tolerance;
    }
    if (visible && start === null) start = t;
    else if (!visible && start !== null) {
      runs.push([start, t]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, 1]);

  // A mesh edge at this resolution is only a handful of pixels long, so the
  // shortest run worth keeping is well under one output pixel.
  return runs
    .filter(([a, b]) => (b - a) * length > 0.4 * SS)
    .map(([a, b]) => [
      { x: from.x + dx * a, y: from.y + dy * a },
      { x: from.x + dx * b, y: from.y + dy * b },
    ]);
}

let svgOut = null;
if (has("svg")) {
  svgOut = OUT.replace(/\.png$/i, "") + ".svg";
  writeFileSync(svgOut, lineArt());
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

const triangles = objects.reduce((sum, object) => sum + object.indices.length / 3, 0);
console.log(`"${text}"`);
console.log(`  ${OUT}  ${WIDTH}x${HEIGHT} (${SS}x) · ${(triangles / 1000).toFixed(1)}k triangles`);
if (svgOut) console.log(`  ${svgOut}  vector outlines`);
console.log(
  `  postures ${solved.actors.map((a) => a.posture.id ?? a.spec.posture).join(" + ")} · ` +
    `${parsed.scene.relationship.arrangement ?? "solo"} on ${parsed.scene.support.surface}`
);
console.log(
  `  penetration ${(solved.quality.maxDepth * 1000).toFixed(0)}mm · ` +
    `${solved.quality.unmetContacts} unmet contacts`
);
for (const warning of [...parsed.warnings, ...solved.quality.warnings]) {
  console.log(`  ! ${warning}`);
}
