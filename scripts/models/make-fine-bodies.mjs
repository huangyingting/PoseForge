/**
 * Build the fine bodies in assets/models from Meta's Momentum Human Rig.
 *
 *   node scripts/models/make-fine-bodies.mjs [female|male|neutral ...] [--out dir]
 *
 * The MakeHuman bodies are cut for a game engine: 13,380 points on the female,
 * with edges across a shoulder or a hip running past two centimetres. MHR's
 * densest level (Apache-2.0, https://github.com/facebookresearch/MHR) is a
 * closed surface of 73,639 points and 147,274 triangles, fitted to thousands
 * of scans, with a rig and 45 identity shapes. So each fine body is MHR's
 * surface made to stand in for one of the default MakeHuman bodies. It is
 * written as realistic-<type>-fine.glb: that body's own file with the skin
 * swapped, the same skeleton, the same eyes. That is what lets everything made
 * for the MakeHuman body be carried across rather than made again:
 *
 *   - The pose (`pose`). MHR's bones are named onto the MakeHuman skeleton's
 *     (`RIG`) and its limbs turned to lie along the MakeHuman body's, finger by
 *     finger. The arms' joints are laid on the MakeHuman body's too, each bone
 *     stretched or shortened to reach, so that elbows, wrists and knuckles are
 *     where its weights bend them. The trunk and the clavicles keep MHR's
 *     angles: the two rigs put those joints in different places on the
 *     skeleton, so lining their bones up would lean the body instead of posing
 *     it.
 *   - The shape (`fitShape`). The identity shapes are fitted to the MakeHuman
 *     body's surface, point to plane - twice, because where the arms are laid
 *     depends on where the fit moves the body.
 *   - The face (`landmarks`, `warp`). The same points are found on both faces -
 *     down the midline, round the mouth, round each eye's opening, round each
 *     ear - and MHR's head is bent so that its land on MakeHuman's.
 *   - The rest (`conform`). What the shapes cannot say - where a knuckle sits,
 *     the line of a jaw - is taken up by a smooth field of offsets onto the
 *     MakeHuman surface, too wide to copy its facets.
 *   - The eyes (`pockets`). MHR's skin runs across its eyes. It is cut away
 *     there, and a pocket put in for MakeHuman's eyeballs to sit in, as they
 *     sit in MakeHuman's own skin.
 *   - The feet (`graft`). MHR's densest foot has no toes. Below the ankle the
 *     fine body is the MakeHuman body's own foot, cut as finely as MHR near
 *     the join and laid there on the smoothest surface through MakeHuman's
 *     points, and MHR's legs are eased onto it and sewn to it along one plane.
 *   - The skin (`paint`). Each vertex takes the UV, the joints and the weights
 *     of the nearest point on the MakeHuman body, a finger only from the same
 *     finger, and the triangles that straddle a seam of the photograph are
 *     given vertices of their own on either side of it. The fine bodies wear
 *     the default skins and bend as the MakeHuman bodies do.
 *   - The hair (`hair`). Each card of the MakeHuman body's fitted trims moves
 *     by as much as the skin nearest it did.
 *   - The clothes (`measureCutHeights`). The heights the MakeHuman body's
 *     clothes are cut at go into the file, so the fine body wears them there
 *     too rather than where its own denser surface would put them.
 *
 * Downloads MHR's release assets once into ~/.cache/poseforge-models/mhr and
 * reads the densest FBX with Blender 4 (mhr_dump.py; BLENDER, default
 * blender). Needs curl and unzip for the download, and the MakeHuman bodies
 * and their hair already in assets/models. About two and a half minutes a
 * body.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHumanTemplate, featureRelief, JOINT_MAP } from "../../src/core/humanMesh.js";
import { measureCutHeights } from "../../src/core/garments.js";
import { parseGLB, readAccessor } from "../../src/core/gltf.js";
import { CARD_BOX, packCards, readCards } from "../../src/core/hairCards.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const models = resolve(join(here, "../../assets/models"));
const out = resolve(option("out", models));
const BLENDER = process.env.BLENDER ?? "blender";
const CACHE = join(homedir(), ".cache/poseforge-models/mhr");
const RELEASE = "https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip";
const SUFFIX = "-fine";
const TYPES = ["female", "male", "neutral"];
const types = args.length ? args : TYPES;
/** A millimetre on a body 1.7 m tall, in stature. */
const MM = 1 / 1700;

const run = (command, argv, what) => {
  const result = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
};

/* ------------------------------------------------------------------ */
/* MHR                                                                 */
/* ------------------------------------------------------------------ */

/** The dumped LOD0 body, fetching and reading it first if it is not cached. */
function source() {
  const dump = join(CACHE, "lod0.bin");
  if (existsSync(dump)) return dump;
  mkdirSync(CACHE, { recursive: true });
  const zip = join(CACHE, "assets.zip");
  if (!existsSync(zip)) {
    run("curl", ["-fsSL", "-o", `${zip}.part`, RELEASE], "downloading MHR");
    renameSync(`${zip}.part`, zip);
  }
  run("unzip", ["-o", "-j", zip, "*/lod0.fbx", "*/LICENSE.txt", "-d", CACHE], "unpacking MHR");
  run(BLENDER, ["--background", "--factory-startup", "--python", join(here, "mhr_dump.py"), "--", join(CACHE, "lod0.fbx"), dump], "reading MHR");
  return dump;
}

/**
 * mhr_dump.py's arrays, moved into the template's frame: Y up, facing +Z, one
 * unit of stature, feet at zero (see `buildHumanTemplate`).
 */
function readMHR(file) {
  const bytes = readFileSync(file);
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.subarray(4, 4 + length).toString());
  let at = 4 + length;
  const take = (Type, count) => {
    const array = new Type(count);
    new Uint8Array(array.buffer).set(bytes.subarray(at, at + array.byteLength));
    at += array.byteLength;
    return array;
  };
  const count = header.vertices;
  const raw = take(Float32Array, count * 3);
  const shapes = take(Float32Array, header.identity.length * count * 3);
  const triangles = take(Uint32Array, header.triangles * 3);
  const groupIndex = take(Uint16Array, count * header.influences);
  const groupWeight = take(Float32Array, count * header.influences);

  let low = Infinity;
  let high = -Infinity;
  for (let v = 0; v < count; v += 1) {
    low = Math.min(low, raw[v * 3 + 2]);
    high = Math.max(high, raw[v * 3 + 2]);
  }
  const stature = high - low;
  const move = (from, to, lift) => {
    for (let i = 0; i < from.length; i += 3) {
      to[i] = from[i] / stature;
      to[i + 1] = (from[i + 2] - lift) / stature;
      to[i + 2] = -from[i + 1] / stature;
    }
    return to;
  };
  return {
    count,
    stature,
    positions: move(raw, new Float64Array(count * 3), low),
    shapes: move(shapes, new Float64Array(shapes.length), 0),
    shapeCount: header.identity.length,
    triangles,
    influences: header.influences,
    groupIndex,
    groupWeight,
    groups: header.groups,
    heads: new Map(header.bones.map((bone) => [bone.name, move(bone.head, [0, 0, 0], low)])),
  };
}

/* ------------------------------------------------------------------ */
/* The rig                                                             */
/* ------------------------------------------------------------------ */

const FINGERS = ["index", "middle", "ring", "pinky", "thumb"];
const twists = (bone, from, to) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${bone}_twist${from + i}_proc`, 1]));

/**
 * The MakeHuman joints, each with the MHR bone it stands at and the MHR vertex
 * groups whose weight it takes.
 *
 * MHR divides every long bone into twist segments that its own solver turns by
 * a fraction of the limb's roll, and the foot into the three joints of the
 * ankle and midfoot. Our rig rolls a limb as a whole and bends the foot at one
 * joint, so each set goes to the limb it belongs to. The one that is split is
 * the wrist's twist ring, which sits across the crease: all of it on the hand
 * folds the end of the forearm with the palm, all of it on the forearm leaves
 * a step where the hand's weight begins, and half on each is the blend. The
 * pinky's metacarpal, and the jaw, have no joint of their own here and ride
 * with the hand and the head.
 */
const RIG = [
  { name: "pelvis", bone: "root", groups: { root: 1 } },
  { name: "spine_01", bone: "c_spine0", parent: "pelvis", groups: { c_spine0: 1 } },
  { name: "spine_02", bone: "c_spine1", parent: "spine_01", groups: { c_spine1: 1 } },
  { name: "spine_03", bone: "c_spine2", parent: "spine_02", groups: { c_spine2: 1, c_spine3: 1 } },
  ...["l", "r"].flatMap((s) => [
    { name: `clavicle_${s}`, bone: `${s}_clavicle`, parent: "spine_03", groups: { [`${s}_clavicle`]: 1 } },
    { name: `upperarm_${s}`, bone: `${s}_uparm`, parent: `clavicle_${s}`, groups: twists(`${s}_uparm`, 0, 4) },
    {
      name: `lowerarm_${s}`,
      bone: `${s}_lowarm`,
      parent: `upperarm_${s}`,
      groups: { ...twists(`${s}_lowarm`, 1, 4), [`${s}_wrist_twist`]: 0.5 },
    },
    {
      name: `hand_${s}`,
      bone: `${s}_wrist`,
      parent: `lowerarm_${s}`,
      groups: { [`${s}_wrist`]: 1, [`${s}_wrist_twist`]: 0.5, [`${s}_pinky0`]: 1 },
    },
    ...FINGERS.flatMap((finger) =>
      [1, 2, 3].map((k) => ({
        name: `${finger}_0${k}_${s}`,
        bone: `${s}_${finger}${k}`,
        parent: k === 1 ? `hand_${s}` : `${finger}_0${k - 1}_${s}`,
        groups: { [`${s}_${finger}${k}`]: 1, ...(k === 3 ? { [`${s}_${finger}_null`]: 1 } : {}) },
      }))
    ),
  ]),
  { name: "neck_01", bone: "c_neck", parent: "spine_03", groups: { c_neck_twist1_proc: 1 } },
  { name: "head", bone: "c_head", parent: "neck_01", groups: { c_head: 1, c_jaw: 1 } },
  ...["l", "r"].flatMap((s) => [
    { name: `thigh_${s}`, bone: `${s}_upleg`, parent: "pelvis", groups: twists(`${s}_upleg`, 1, 4) },
    {
      name: `calf_${s}`,
      bone: `${s}_lowleg`,
      parent: `thigh_${s}`,
      groups: { [`${s}_lowleg`]: 1, ...twists(`${s}_lowleg`, 1, 4) },
    },
    {
      name: `foot_${s}`,
      bone: `${s}_foot`,
      parent: `calf_${s}`,
      groups: { [`${s}_talocrural`]: 1, [`${s}_subtalar`]: 1, [`${s}_transversetarsal`]: 1 },
    },
    { name: `ball_${s}`, bone: `${s}_ball`, parent: `foot_${s}`, groups: { [`${s}_ball`]: 1 } },
  ]),
];
const RIG_INDEX = new Map(RIG.map((joint, i) => [joint.name, i]));
for (const joint of RIG) joint.parentIndex = joint.parent ? RIG_INDEX.get(joint.parent) : -1;

/** MHR's weights on `RIG`'s joints: the four largest, summing to one. */
function mergeWeights(mhr) {
  const shares = mhr.groups.map(() => []);
  RIG.forEach((joint, j) => {
    for (const [group, share] of Object.entries(joint.groups)) {
      const g = mhr.groups.indexOf(group);
      if (g < 0) throw new Error(`MHR has no vertex group ${group}`);
      shares[g].push([j, share]);
    }
  });
  mhr.groups.forEach((group, g) => {
    if (!shares[g].length) throw new Error(`MHR's vertex group ${group} goes to no joint`);
  });

  const joints = new Uint16Array(mhr.count * 4);
  const weights = new Float32Array(mhr.count * 4);
  const sum = new Float64Array(RIG.length);
  for (let v = 0; v < mhr.count; v += 1) {
    const touched = [];
    for (let k = 0; k < mhr.influences; k += 1) {
      const w = mhr.groupWeight[v * mhr.influences + k];
      if (!(w > 0)) continue;
      for (const [j, share] of shares[mhr.groupIndex[v * mhr.influences + k]]) {
        if (!sum[j]) touched.push(j);
        sum[j] += w * share;
      }
    }
    touched.sort((a, b) => sum[b] - sum[a]);
    const kept = touched.slice(0, 4);
    const total = kept.reduce((t, j) => t + sum[j], 0);
    kept.forEach((j, k) => {
      joints[v * 4 + k] = j;
      weights[v * 4 + k] = sum[j] / total;
    });
    for (const j of touched) sum[j] = 0;
  }
  return { joints, weights };
}

/** Each vertex's joint of largest weight. */
function dominant({ joints, weights }, count) {
  const out = new Uint16Array(count);
  for (let v = 0; v < count; v += 1) {
    let best = 0;
    for (let k = 1; k < 4; k += 1) if (weights[v * 4 + k] > weights[v * 4 + best]) best = k;
    out[v] = joints[v * 4 + best];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Small linear algebra                                                */
/* ------------------------------------------------------------------ */

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / (Math.hypot(...a) || 1));
/** 3x3 matrices, row-major. */
const apply = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const compose = (a, b) => {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
};

/** The least rotation that carries direction `from` onto `to`. */
function turn(from, to) {
  const a = norm(from);
  const b = norm(to);
  const axis = cross(a, b);
  const s = Math.hypot(...axis);
  const c = dot(a, b);
  if (s < 1e-12) return I3.slice();
  const [x, y, z] = scale(axis, 1 / s);
  const t = 1 - c;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

/** Solve the symmetric positive-definite system `a x = b` in place (Cholesky). */
function solve(a, b, n) {
  for (let j = 0; j < n; j += 1) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k += 1) d -= a[j * n + k] * a[j * n + k];
    if (!(d > 0)) throw new Error("the fit's normal equations are not positive definite");
    d = Math.sqrt(d);
    a[j * n + j] = d;
    for (let i = j + 1; i < n; i += 1) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k += 1) s -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = s / d;
    }
  }
  const x = Float64Array.from(b);
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < i; k += 1) x[i] -= a[i * n + k] * x[k];
    x[i] /= a[i * n + i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let k = i + 1; k < n; k += 1) x[i] -= a[k * n + i] * x[k];
    x[i] /= a[i * n + i];
  }
  return x;
}

/** Area-weighted vertex normals. */
function vertexNormals(positions, indices) {
  const normals = new Float64Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

/* ------------------------------------------------------------------ */
/* Nearest points                                                      */
/* ------------------------------------------------------------------ */

/**
 * Barycentric weights of the point on triangle abc nearest p (Ericson,
 * Real-Time Collision Detection, 5.1.5).
 */
function nearestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
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
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator, w = vc * denominator;
  return [1 - v - w, v, w];
}

/** A surface's triangles binned into a grid, for the nearest point on it. */
class TriangleGrid {
  constructor(positions, indices, cell) {
    this.positions = positions;
    this.indices = indices;
    this.cell = cell;
    const count = indices.length / 3;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3)
      for (let c = 0; c < 3; c += 1) {
        lo[c] = Math.min(lo[c], positions[i + c]);
        hi[c] = Math.max(hi[c], positions[i + c]);
      }
    this.lo = lo;
    this.size = lo.map((l, c) => Math.floor((hi[c] - l) / cell) + 1);
    this.normals = new Float64Array(count * 3);
    const boxes = new Int32Array(count * 6);
    const counts = new Int32Array(this.size[0] * this.size[1] * this.size[2] + 1);
    for (let t = 0; t < count; t += 1) {
      const [a, b, c] = this.corners(t);
      const n = cross(sub(b, a), sub(c, a));
      const area = Math.hypot(...n);
      if (!(area > 0)) {
        boxes[t * 6] = -1;
        continue;
      }
      this.normals.set(scale(n, 1 / area), t * 3);
      for (let k = 0; k < 3; k += 1) {
        boxes[t * 6 + k] = this.at(Math.min(a[k], b[k], c[k]), k);
        boxes[t * 6 + 3 + k] = this.at(Math.max(a[k], b[k], c[k]), k);
      }
      this.cells(boxes, t, (i) => (counts[i + 1] += 1));
    }
    for (let i = 1; i < counts.length; i += 1) counts[i] += counts[i - 1];
    this.start = counts;
    this.items = new Int32Array(counts[counts.length - 1]);
    const fill = counts.slice();
    for (let t = 0; t < count; t += 1) if (boxes[t * 6] >= 0) this.cells(boxes, t, (i) => (this.items[fill[i]++] = t));
    this.stamp = new Int32Array(count);
    this.visit = 0;
  }

  at(value, axis) {
    return Math.max(0, Math.min(this.size[axis] - 1, Math.floor((value - this.lo[axis]) / this.cell)));
  }

  cells(boxes, t, each) {
    const [nx, ny] = this.size;
    for (let z = boxes[t * 6 + 2]; z <= boxes[t * 6 + 5]; z += 1)
      for (let y = boxes[t * 6 + 1]; y <= boxes[t * 6 + 4]; y += 1)
        for (let x = boxes[t * 6]; x <= boxes[t * 6 + 3]; x += 1) each(x + nx * (y + ny * z));
  }

  corners(t) {
    const p = this.positions;
    return [0, 1, 2].map((k) => {
      const v = this.indices[t * 3 + k] * 3;
      return [p[v], p[v + 1], p[v + 2]];
    });
  }

  /**
   * The nearest point within `reach` on a triangle `accept(t)` allows, as
   * `{triangle, bary, point, distance}`, or null.
   */
  nearest(p, reach, accept = null) {
    const { cell, size } = this;
    const home = [0, 1, 2].map((k) => Math.floor((p[k] - this.lo[k]) / cell));
    let best = null;
    let bestDistance = reach;
    this.visit += 1;
    for (let ring = 0; (ring - 1) * cell <= Math.min(reach, bestDistance); ring += 1) {
      for (let dz = -ring; dz <= ring; dz += 1)
        for (let dy = -ring; dy <= ring; dy += 1)
          for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const x = home[0] + dx, y = home[1] + dy, z = home[2] + dz;
            if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) continue;
            const i = x + size[0] * (y + size[1] * z);
            for (let k = this.start[i]; k < this.start[i + 1]; k += 1) {
              const t = this.items[k];
              if (this.stamp[t] === this.visit) continue;
              this.stamp[t] = this.visit;
              if (accept && !accept(t)) continue;
              const [a, b, c] = this.corners(t);
              const bary = nearestOnTriangle(p, a, b, c);
              const point = [0, 1, 2].map((k) => bary[0] * a[k] + bary[1] * b[k] + bary[2] * c[k]);
              const distance = Math.hypot(...sub(p, point));
              if (distance < bestDistance) {
                bestDistance = distance;
                best = { triangle: t, bary, point, distance };
              }
            }
          }
    }
    return best;
  }

  normal(t) {
    return [this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]];
  }

  /**
   * Whether a ray from `origin` along the unit `direction` meets any triangle
   * within `reach`: the cells it passes through in order (Amanatides and Woo),
   * each triangle in them once. A ray starting outside the grid starts at its
   * nearest cell, which is near enough for the points this is asked about.
   */
  blocked(origin, direction, reach) {
    const { cell, size, lo, positions: p, indices } = this;
    const at = [0, 1, 2].map((k) => this.at(origin[k], k));
    const step = direction.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
    const next = [0, 1, 2].map((k) => (step[k] ? ((at[k] + (step[k] > 0 ? 1 : 0)) * cell + lo[k] - origin[k]) / direction[k] : Infinity));
    const delta = [0, 1, 2].map((k) => (step[k] ? cell / Math.abs(direction[k]) : Infinity));
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    this.visit += 1;
    for (;;) {
      const i = at[0] + size[0] * (at[1] + size[1] * at[2]);
      for (let j = this.start[i]; j < this.start[i + 1]; j += 1) {
        const t = this.items[j];
        if (this.stamp[t] === this.visit) continue;
        this.stamp[t] = this.visit;
        // Moller-Trumbore.
        const a = indices[t * 3] * 3;
        const b = indices[t * 3 + 1] * 3;
        const c = indices[t * 3 + 2] * 3;
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
        const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const determinant = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(determinant) < 1e-18) continue;
        const sx = ox - p[a], sy = oy - p[a + 1], sz = oz - p[a + 2];
        const u = (sx * hx + sy * hy + sz * hz) / determinant;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (dx * qx + dy * qy + dz * qz) / determinant;
        if (w < 0 || u + w > 1) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) / determinant;
        if (distance > 0 && distance < reach) return true;
      }
      const k = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
      if (next[k] > reach) return false;
      at[k] += step[k];
      if (at[k] < 0 || at[k] >= size[k]) return false;
      next[k] += delta[k];
    }
  }
}

/* ------------------------------------------------------------------ */
/* The MakeHuman body                                                  */
/* ------------------------------------------------------------------ */

/**
 * The default MakeHuman body of a type: its template, and its eye proxy as the
 * file has it, before `splitEyes` cuts it up, in the template's frame.
 */
function readMakeHuman(type) {
  const bytes = readFileSync(join(models, `realistic-${type}.glb`));
  const template = buildHumanTemplate(bytes);
  const gltf = parseGLB(bytes);
  const attribute = (mesh, name) => readAccessor(gltf, gltf.json.meshes[mesh].primitives[0].attributes[name]);
  const skin = attribute(0, "POSITION");
  let low = Infinity;
  for (let i = 2; i < skin.length; i += 3) low = Math.min(low, skin[i]);
  const raw = attribute(1, "POSITION");
  const positions = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    positions[i] = raw[i] / template.height;
    positions[i + 1] = (raw[i + 2] - low) / template.height;
    positions[i + 2] = -raw[i + 1] / template.height;
  }
  const proxy = {
    positions,
    uvs: Float32Array.from(attribute(1, "TEXCOORD_0")),
    indices: Uint32Array.from(readAccessor(gltf, gltf.json.meshes[1].primitives[0].indices)),
  };
  const body = template.submeshes.find((submesh) => submesh.primary);
  return { template, body, proxy };
}

/**
 * Where a vertex may take anything from the MakeHuman body, by the joint that
 * carries most of it: never from the other side of the body, a finger only
 * from the same finger or the palm, the palm from its own fingers or forearm.
 * So no vertex is painted, weighted or pulled from the finger beside it or the
 * thigh opposite.
 */
function zone(name) {
  const side = name.match(/_([lr])$/)?.[1] ?? null;
  const finger = name.match(/^(index|middle|ring|pinky|thumb)_0\d_[lr]$/);
  if (finger) return { kind: "finger", key: `${finger[1]}_${side}`, side };
  const limb = name.match(/^(hand|lowerarm)_[lr]$/);
  if (limb) return { kind: limb[1], key: name, side };
  return { kind: "other", key: "other", side };
}
function allows(from, to) {
  if (from.side && to.side && from.side !== to.side) return false;
  switch (from.kind) {
    case "finger":
      return to.key === from.key || to.kind === "hand";
    case "hand":
      return to.kind !== "other";
    case "lowerarm":
      return to.kind !== "finger";
    default:
      return to.kind === "other" || to.kind === "lowerarm";
  }
}

/** Each triangle's zone, by the joint that carries most of its corners. */
function triangleZones(template, body) {
  const out = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    const total = new Map();
    for (let c = 0; c < 3; c += 1) {
      const v = body.indices[i + c];
      for (let k = 0; k < 4; k += 1) {
        const j = body.joints[v * 4 + k];
        total.set(j, (total.get(j) ?? 0) + body.weights[v * 4 + k]);
      }
    }
    const [joint] = [...total].reduce((best, next) => (next[1] > best[1] ? next : best));
    out.push(zone(template.joints[joint].name));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pose and shape                                                      */
/* ------------------------------------------------------------------ */

/** The joint each limb joint's bone points at, on both rigs. */
function lead(name) {
  const limb = name.match(/^(upperarm|lowerarm|hand|thigh|calf)_([lr])$/);
  if (limb) {
    const next = { upperarm: "lowerarm", lowerarm: "hand", hand: "middle_01", thigh: "calf", calf: "foot" };
    return `${next[limb[1]]}_${limb[2]}`;
  }
  const finger = name.match(/^(\w+)_0([12])_([lr])$/);
  return finger ? `${finger[1]}_0${Number(finger[2]) + 1}_${finger[3]}` : null;
}

/**
 * Turn MHR's limbs onto the MakeHuman body's: each joint's rotation, and
 * where it ends up.
 *
 * The legs keep MHR's lengths. An arm's joints are laid on MakeHuman's
 * instead, each bone turned from where it starts to where MakeHuman's next
 * joint is, less the fit's `shift`, and stretched or shortened along itself to
 * reach it, so that the elbow, the wrist and every knuckle is where
 * MakeHuman's weights bend the skin. MHR's mean shoulders are higher than the
 * male's by two centimetres, and his palm a third longer than MHR's: kept
 * MHR's length and hung from that shoulder, the hand ended four centimetres
 * short, and fitted by its surface it lay along his palm and the first joint
 * of every finger, took the weights it found there, and bent at neither of
 * the others. A distal joint, with no next joint to reach, keeps MHR's length.
 *
 * A palm is turned twice, once to point at the middle finger and once about
 * that line to lay its knuckles across the same way, because a hand's
 * direction does not say which way it faces, and it is made as wide across
 * those as MakeHuman's too. A foot is not turned at all: the two rigs put the
 * ankle and the ball in different places on it, so lining those up tips one
 * sole into the floor, and both bodies already stand flat.
 */
function pose(heads, targets, shift = [0, 0, 0]) {
  const turns = [];
  const rotations = [];
  const places = [];
  RIG.forEach((joint, j) => {
    const p = joint.parentIndex;
    const above = p < 0 ? I3 : rotations[p];
    places[j] = p < 0 ? heads[j] : add(places[p], apply(turns[p], sub(heads[j], heads[p])));
    const next = lead(joint.name);
    if (/^(foot|ball)_/.test(joint.name)) {
      turns[j] = rotations[j] = I3;
      return;
    }
    if (!next) {
      turns[j] = rotations[j] = above;
      return;
    }
    const bone = sub(heads[RIG_INDEX.get(next)], heads[j]);
    const landed = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/.test(joint.name);
    const aim = landed ? sub(sub(targets.get(next), shift), places[j]) : sub(targets.get(next), targets.get(joint.name));
    let rotation = compose(turn(apply(above, bone), aim), above);
    // In MHR's own frame, before it is turned: along the bone, and across a palm.
    const axis = norm(bone);
    const stretches = [[axis, landed ? Math.hypot(...aim) / Math.hypot(...bone) : 1]];
    if (joint.name.startsWith("hand_")) {
      const side = joint.name.slice(-1);
      const [first, last] = [`index_01_${side}`, `pinky_01_${side}`];
      const flat = (v, a) => sub(v, scale(a, dot(v, a)));
      const [mine, theirs] = [sub(heads[RIG_INDEX.get(last)], heads[RIG_INDEX.get(first)]), sub(targets.get(last), targets.get(first))];
      const across = apply(rotation, mine);
      rotation = compose(turn(flat(across, norm(aim)), flat(theirs, norm(aim))), rotation);
      stretches.push([norm(flat(mine, axis)), Math.hypot(...flat(theirs, norm(aim))) / Math.hypot(...flat(mine, axis))]);
    }
    const stretch = stretches.reduce((m, [a, s]) => m.map((x, e) => x + (s - 1) * a[Math.floor(e / 3)] * a[e % 3]), I3);
    rotations[j] = rotation;
    turns[j] = compose(rotation, stretch);
  });
  return { turns, places };
}

/**
 * Per vertex, the weight-blended rotation and translation the pose applies:
 * `x' = rotation x + offset`. Blended skinning is affine in the rest position,
 * which is what makes the shape fit below linear.
 */
function blend(rig, heads, { turns, places }, count) {
  const rotation = new Float64Array(count * 9);
  const offset = new Float64Array(count * 3);
  const shift = turns.map((m, j) => sub(places[j], apply(m, heads[j])));
  for (let v = 0; v < count; v += 1) {
    for (let k = 0; k < 4; k += 1) {
      const w = rig.weights[v * 4 + k];
      if (!w) continue;
      const j = rig.joints[v * 4 + k];
      for (let e = 0; e < 9; e += 1) rotation[v * 9 + e] += w * turns[j][e];
      for (let e = 0; e < 3; e += 1) offset[v * 3 + e] += w * shift[j][e];
    }
  }
  return { rotation, offset };
}

/** `x' = rotation x + offset` for one vertex of a flat array. */
function moved(skinning, v, x) {
  const m = skinning.rotation.subarray(v * 9, v * 9 + 9);
  return add(apply(m, x), [skinning.offset[v * 3], skinning.offset[v * 3 + 1], skinning.offset[v * 3 + 2]]);
}

/**
 * MHR's surface in the posed rest frame for identity coefficients `c` and a
 * translation `t`.
 */
function shaped(mhr, skinning, c, t) {
  const out = new Float64Array(mhr.count * 3);
  const V = mhr.count;
  for (let v = 0; v < V; v += 1) {
    const x = [mhr.positions[v * 3], mhr.positions[v * 3 + 1], mhr.positions[v * 3 + 2]];
    for (let k = 0; k < c.length; k += 1) {
      if (!c[k]) continue;
      const at = (k * V + v) * 3;
      x[0] += c[k] * mhr.shapes[at];
      x[1] += c[k] * mhr.shapes[at + 1];
      x[2] += c[k] * mhr.shapes[at + 2];
    }
    out.set(add(moved(skinning, v, x), t), v * 3);
  }
  return out;
}

/**
 * Fit MHR's identity shapes, and a translation, to the MakeHuman surface.
 *
 * Iterated closest points, point to plane: each sampled MHR vertex is paired
 * with the nearest point on a MakeHuman triangle that faces the same way and
 * is in the vertex's zone, and the coefficients are solved to put it on that
 * triangle's plane. The residuals are down-weighted past a centimetre or so,
 * so a pairing that is simply wrong - an ear, the inside of a lip - does not
 * drag the rest. A weak prior on the coefficients keeps the shapes the fit
 * cannot see from wandering.
 */
function fitShape(mhr, rig, skinning, grid, zones, { iterations = 14, every = 3, prior = 3 } = {}) {
  const K = mhr.shapeCount;
  const N = K + 3;
  const V = mhr.count;
  const restNormals = vertexNormals(mhr.positions, mhr.triangles);
  const owner = dominant(rig, V);
  const samples = [];
  for (let v = 0; v < V; v += every) samples.push(v);
  const S = samples.length;
  // Each sample's Jacobian, 3 x K, and where it is posed at c = 0.
  const jacobian = new Float64Array(S * 3 * K);
  const base = new Float64Array(S * 3);
  const normal = new Float64Array(S * 3);
  samples.forEach((v, s) => {
    const m = skinning.rotation.subarray(v * 9, v * 9 + 9);
    for (let k = 0; k < K; k += 1) {
      const at = (k * V + v) * 3;
      const d = apply(m, [mhr.shapes[at], mhr.shapes[at + 1], mhr.shapes[at + 2]]);
      for (let e = 0; e < 3; e += 1) jacobian[(s * 3 + e) * K + k] = d[e];
    }
    base.set(moved(skinning, v, [mhr.positions[v * 3], mhr.positions[v * 3 + 1], mhr.positions[v * 3 + 2]]), s * 3);
    normal.set(norm(apply(m, [restNormals[v * 3], restNormals[v * 3 + 1], restNormals[v * 3 + 2]])), s * 3);
  });
  const sampleZones = samples.map((v) => zone(RIG[owner[v]].name));

  let theta = new Float64Array(N);
  const SIGMA = 0.006; // of stature, the residual past which a pairing counts for less
  const REACH = 0.025;
  const at = (s) => {
    const x = [0, 0, 0];
    for (let e = 0; e < 3; e += 1) {
      let value = base[s * 3 + e] + theta[K + e];
      for (let k = 0; k < K; k += 1) value += jacobian[(s * 3 + e) * K + k] * theta[k];
      x[e] = value;
    }
    return x;
  };
  let report = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const a = new Float64Array(N * N);
    const b = new Float64Array(N);
    let paired = 0;
    let squared = 0;
    const row = new Float64Array(N);
    for (let s = 0; s < S; s += 1) {
      const x = at(s);
      const n = [normal[s * 3], normal[s * 3 + 1], normal[s * 3 + 2]];
      const hit = grid.nearest(x, REACH, (t) => dot(grid.normal(t), n) > 0.5 && allows(sampleZones[s], zones[t]));
      if (!hit) continue;
      const plane = grid.normal(hit.triangle);
      const residual = dot(plane, sub(x, hit.point));
      const weight = 1 / (1 + (residual / SIGMA) ** 2);
      paired += 1;
      squared += residual * residual;
      // Point to plane, plus a little point to point so the surface cannot
      // slide along itself unopposed.
      const terms = [[plane, 1], [[1, 0, 0], 0.05], [[0, 1, 0], 0.05], [[0, 0, 1], 0.05]];
      for (const [direction, share] of terms) {
        for (let k = 0; k < K; k += 1) {
          row[k] = 0;
          for (let e = 0; e < 3; e += 1) row[k] += direction[e] * jacobian[(s * 3 + e) * K + k];
        }
        for (let e = 0; e < 3; e += 1) row[K + e] = direction[e];
        const target = dot(direction, sub(hit.point, [base[s * 3], base[s * 3 + 1], base[s * 3 + 2]]));
        const w = weight * share;
        for (let i = 0; i < N; i += 1) {
          if (!row[i]) continue;
          b[i] += w * row[i] * target;
          for (let j = 0; j <= i; j += 1) a[i * N + j] += w * row[i] * row[j];
        }
      }
    }
    for (let i = 0; i < N; i += 1) for (let j = 0; j < i; j += 1) a[j * N + i] = a[i * N + j];
    // The prior, in the data's units: a coefficient of `prior` costs as much
    // as one sample a SIGMA off its plane.
    for (let k = 0; k < K; k += 1) a[k * N + k] += 1 / ((prior / SIGMA) ** 2) * (S / 100);
    theta = solve(a, b, N);
    report = { paired, samples: S, rms: Math.sqrt(squared / paired) };
  }
  return { coefficients: Array.from(theta.subarray(0, K)), translation: Array.from(theta.subarray(K)), report };
}

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

const PIXEL = 0.5 * MM;

/**
 * The surface seen from in front over a window, `lo` to `hi` in x and y: for
 * each half-millimetre pixel the nearest depth and the triangle it is on. Only
 * `triangles` are drawn, if given.
 */
function heightMap(positions, indices, lo, hi, triangles = null) {
  const w = Math.ceil((hi[0] - lo[0]) / PIXEL) + 1;
  const h = Math.ceil((hi[1] - lo[1]) / PIXEL) + 1;
  const depth = new Float64Array(w * h).fill(-Infinity);
  const owner = new Int32Array(w * h).fill(-1);
  const count = triangles ? triangles.length : indices.length / 3;
  for (let i = 0; i < count; i += 1) {
    const t = triangles ? triangles[i] : i;
    const q = [0, 1, 2].map((k) => {
      const v = indices[t * 3 + k] * 3;
      return [(positions[v] - lo[0]) / PIXEL, (positions[v + 1] - lo[1]) / PIXEL, positions[v + 2]];
    });
    const x0 = Math.max(0, Math.ceil(Math.min(q[0][0], q[1][0], q[2][0])));
    const x1 = Math.min(w - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0])));
    const y0 = Math.max(0, Math.ceil(Math.min(q[0][1], q[1][1], q[2][1])));
    const y1 = Math.min(h - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1])));
    if (x0 > x1 || y0 > y1) continue;
    const det = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    if (Math.abs(det) < 1e-12) continue;
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const l1 = ((x - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (y - q[0][1])) / det;
        const l2 = ((q[1][0] - q[0][0]) * (y - q[0][1]) - (x - q[0][0]) * (q[1][1] - q[0][1])) / det;
        if (l1 < -1e-9 || l2 < -1e-9 || l1 + l2 > 1 + 1e-9) continue;
        const z = q[0][2] + l1 * (q[1][2] - q[0][2]) + l2 * (q[2][2] - q[0][2]);
        if (z > depth[x + y * w]) {
          depth[x + y * w] = z;
          owner[x + y * w] = t;
        }
      }
  }
  return { w, h, lo, depth, owner, positions, indices };
}

const pixelOf = (map, u, v) => {
  const x = Math.round((u - map.lo[0]) / PIXEL);
  const y = Math.round((v - map.lo[1]) / PIXEL);
  return x >= 0 && y >= 0 && x < map.w && y < map.h ? x + y * map.w : -1;
};
const depthAt = (map, u, v) => {
  const i = pixelOf(map, u, v);
  return i < 0 ? -Infinity : map.depth[i];
};
/** Where pixel `i` of `map` is, in x and y. */
const placeOf = (map, i) => [map.lo[0] + (i % map.w) * PIXEL, map.lo[1] + Math.floor(i / map.w) * PIXEL];

/**
 * The point of the surface under pixel `i`, as a triangle and barycentric
 * weights - so it can be found again on the same triangles moved.
 */
function surfaceAt(map, i) {
  const t = map.owner[i];
  if (t < 0) throw new Error("a landmark has no surface under it");
  const [x, y] = placeOf(map, i);
  const [a, b, c] = [0, 1, 2].map((k) => {
    const v = map.indices[t * 3 + k] * 3;
    return [map.positions[v], map.positions[v + 1]];
  });
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  const l1 = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / det;
  const l2 = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / det;
  const bary = [1 - l1 - l2, l1, l2].map((w) => Math.max(0, w));
  const total = bary[0] + bary[1] + bary[2];
  return { triangle: t, bary: bary.map((w) => w / total) };
}
const onSurface = (positions, indices, { triangle, bary }) =>
  [0, 1, 2].map((c) => bary.reduce((sum, w, k) => sum + w * positions[indices[triangle * 3 + k] * 3 + c], 0));

/** Where `f` is largest (`sign` 1) or smallest (-1) over `from` to `to`, a pixel at a time. */
function extreme(f, from, to, sign) {
  let best = null;
  let bestValue = -Infinity;
  for (let s = Math.min(from, to); s <= Math.max(from, to); s += PIXEL) {
    const value = sign * f(s);
    if (value > bestValue) {
      bestValue = value;
      best = s;
    }
  }
  return best;
}

/**
 * The face's midline and mouth, found the same way on both bodies from the
 * height of the face along x = 0: the nasion is the deepest point between the
 * eyes, the tip of the nose the highest below them, and down from it in turn
 * the subnasale, the upper lip, the parting, the lower lip. The corners of the
 * mouth are followed out along the parting until it is no longer a groove. The
 * chin is taken 22 mm under the parting, since neither body has a point there
 * the height alone finds. Each is `[x, y, z]`; `cy` is the eyes' height.
 */
function faceLandmarks(map, cy) {
  // Averaged over a millimetre either side, so one row of facets cannot decide.
  const mid = (y) => {
    let sum = 0;
    let n = 0;
    for (let x = -MM; x <= MM + 1e-12; x += PIXEL) {
      const z = depthAt(map, x, y);
      if (z > -Infinity) {
        sum += z;
        n += 1;
      }
    }
    return n ? sum / n : -Infinity;
  };
  const out = new Map();
  const put = (name, y) => out.set(name, [0, y, mid(y)]);
  const nasion = extreme(mid, cy - 10 * MM, cy + 15 * MM, -1);
  const tip = extreme(mid, cy - 65 * MM, cy - 20 * MM, 1);
  const subnasale = extreme(mid, tip - 22 * MM, tip - 5 * MM, -1);
  const upper = extreme(mid, subnasale - 18 * MM, subnasale - 3 * MM, 1);
  const parting = extreme(mid, upper - 14 * MM, upper - 2 * MM, -1);
  const lower = extreme(mid, parting - 14 * MM, parting - 2 * MM, 1);
  put("nasion", nasion);
  put("pronasale", tip);
  put("subnasale", subnasale);
  put("labrale superius", upper);
  put("labrale inferius", lower);
  put("chin", parting - 22 * MM);
  // Through a parted mouth the height looks into it: the parting is stood just
  // behind the nearer lip instead.
  out.set("stomion", [0, parting, Math.max(mid(parting), Math.min(mid(upper), mid(lower)) - 4 * MM)]);
  for (const [side, sign] of [["l", 1], ["r", -1]]) {
    let y = parting;
    let last = [0, parting];
    for (let x = PIXEL; x < 40 * MM; x += PIXEL) {
      const u = sign * x;
      const column = (v) => depthAt(map, u, v);
      const valley = extreme(column, y - 1.5 * MM, y + 1.5 * MM, -1);
      const above = Math.max(...[1, 2, 3, 4].map((k) => column(valley + k * MM)));
      const below = Math.max(...[1, 2, 3, 4].map((k) => column(valley - k * MM)));
      if (!(Math.min(above, below) - column(valley) > 0.25 * MM)) break;
      y = valley;
      last = [u, valley];
    }
    out.set(`cheilion ${side}`, [last[0], last[1], depthAt(map, last[0], last[1])]);
  }
  return out;
}

/**
 * An eye's opening as seen from in front, `region` the pixels of `map` it
 * covers: its two corners and three points along each lid, a quarter, half and
 * three quarters of the way across, each on the lid's rim a pixel outside the
 * opening. Pixel indices, by name.
 */
function eyeRim(map, region, sign) {
  const { w, h } = map;
  const columns = new Map();
  for (let x = 0; x < w; x += 1) {
    let bottom = -1;
    let top = -1;
    for (let y = 0; y < h; y += 1)
      if (region[x + y * w]) {
        if (bottom < 0) bottom = y;
        top = y;
      }
    if (top >= 0) columns.set(x, [bottom, top]);
  }
  if (!columns.size) throw new Error("an eye has no opening");
  const across = [...columns.keys()].sort((a, b) => sign * (a - b));
  const [medial, lateral] = [across[0], across[across.length - 1]];
  const middle = (x) => Math.round((columns.get(x)[0] + columns.get(x)[1]) / 2);
  const out = new Map([
    ["medial", medial - sign + middle(medial) * w],
    ["lateral", lateral + sign + middle(lateral) * w],
  ]);
  for (const f of [0.25, 0.5, 0.75]) {
    const want = medial + f * (lateral - medial);
    const x = across.reduce((best, c) => (Math.abs(c - want) < Math.abs(best - want) ? c : best));
    const [bottom, top] = columns.get(x);
    out.set(`upper ${f}`, x + (top + 1) * w);
    out.set(`lower ${f}`, x + (bottom - 1) * w);
  }
  return out;
}

/** The pixels reachable from `start` through pixels `open(i)` allows. */
function flood(map, open, start) {
  const { w, h } = map;
  const region = new Uint8Array(w * h);
  if (!open(start)) throw new Error("the MakeHuman eye is shut");
  const stack = [start];
  region[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = nx + ny * w;
      if (!region[j] && open(j)) {
        region[j] = 1;
        stack.push(j);
      }
    }
  }
  return region;
}

/** The largest run of pixels `open(i)` allows, joined edge to edge. */
function largest(map, open) {
  const { w, h } = map;
  const label = new Int32Array(w * h).fill(-1);
  let best = null;
  for (let start = 0; start < w * h; start += 1) {
    if (label[start] >= 0 || !open(start)) continue;
    const run = [start];
    label[start] = start;
    for (let k = 0; k < run.length; k += 1) {
      const i = run[k];
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = nx + ny * w;
        if (label[j] < 0 && open(j)) {
          label[j] = start;
          run.push(j);
        }
      }
    }
    if (!best || run.length > best.length) best = run;
  }
  const region = new Uint8Array(w * h);
  for (const i of best ?? []) region[i] = 1;
  return region;
}

/**
 * The height with everything narrower than `2 r` pixels taken off it - its
 * morphological opening, the least over a square and then the most - which
 * on the side of a head is the skull without the ear.
 */
function opened(map, r) {
  const { w, h } = map;
  const pass = (from, most, across) => {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        let value = most ? -Infinity : Infinity;
        for (let k = -r; k <= r; k += 1) {
          const [a, b] = across ? [x + k, y] : [x, y + k];
          if (a < 0 || b < 0 || a >= w || b >= h) continue;
          const z = from[a + b * w];
          if (z === -Infinity) continue;
          value = most ? Math.max(value, z) : Math.min(value, z);
        }
        out[x + y * w] = value === Infinity ? -Infinity : value;
      }
    return out;
  };
  return pass(pass(pass(pass(map.depth, false, true), false, false), true, true), true, false);
}

/**
 * An ear, seen from its own side: `map` looks along x at z and y. The ear is
 * the largest patch standing more than 3 mm off the skull (see `opened`), and
 * its landmarks are that patch's top, bottom, front and back, and where it
 * stands furthest out. Pixel indices by name, the patch, and the skull.
 */
function earLandmarks(map) {
  const skull = opened(map, Math.round((15 * MM) / PIXEL));
  const region = largest(map, (i) => map.depth[i] - skull[i] > 3 * MM);
  const pixels = [];
  for (let i = 0; i < region.length; i += 1) if (region[i]) pixels.push(i);
  if (pixels.length < 100) throw new Error("an ear is missing");
  const pick = (score) => pixels.reduce((best, i) => (score(i) > score(best) ? i : best));
  const x = (i) => i % map.w;
  const y = (i) => Math.floor(i / map.w);
  return {
    points: new Map([
      ["top", pick(y)],
      ["bottom", pick((i) => -y(i))],
      ["front", pick(x)],
      ["back", pick((i) => -x(i))],
      ["out", pick((i) => map.depth[i] - skull[i])],
    ]),
    region,
    skull,
  };
}

/**
 * The MakeHuman eyeballs, one a side: the proxy's triangles on that side, and
 * the sphere through them.
 */
function proxyEyes(proxy) {
  return [1, -1].map((sign) => {
    const own = [];
    for (let v = 0; v < proxy.positions.length / 3; v += 1) if (Math.sign(proxy.positions[v * 3]) === sign) own.push(v);
    const mine = new Set(own);
    const triangles = [];
    for (let t = 0; t < proxy.indices.length / 3; t += 1) if (mine.has(proxy.indices[t * 3])) triangles.push(t);
    const { centre, radius } = sphere(own.map((v) => [proxy.positions[v * 3], proxy.positions[v * 3 + 1], proxy.positions[v * 3 + 2]]));
    return { sign, side: sign > 0 ? "l" : "r", triangles, centre, radius };
  });
}

/**
 * MHR's open eyes, one a side, as the triangles its skin spans each with.
 *
 * MHR models no eyeball. Where the eye is open its skin simply bridges the
 * lids: a band of long slivers from the upper lid's margin to the lower's,
 * with no vertex in between. So a side's opening is the run of such triangles,
 * joined edge to edge, that the line of sight from its eye's bone first meets.
 * Found once, on the mean body; the triangles are the same on every shape.
 */
function eyeCaps(mhr) {
  const P = mhr.positions;
  const T = mhr.triangles;
  const at = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  return [1, -1].map((sign) => {
    const side = sign > 0 ? "l" : "r";
    const bone = mhr.heads.get(`${side}_eye`);
    const long = new Set();
    for (let t = 0; t < T.length / 3; t += 1) {
      const corners = [0, 1, 2].map((k) => at(T[t * 3 + k]));
      const longest = Math.max(...[0, 1, 2].map((e) => Math.hypot(...sub(corners[e], corners[(e + 1) % 3]))));
      const d = sub(scale(corners.reduce(add), 1 / 3), bone);
      if (longest * mhr.stature > 0.003 && Math.hypot(...d) * mhr.stature < 0.022 && d[2] > 0) long.add(t);
    }
    const seed = cast(bone, [0, 0, 1], P, T, long).triangle;
    if (seed < 0) throw new Error(`MHR's ${side} eye has no opening in front of it`);
    const byEdge = new Map();
    for (const t of long)
      for (let e = 0; e < 3; e += 1) {
        const a = T[t * 3 + e];
        const b = T[t * 3 + ((e + 1) % 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!byEdge.has(key)) byEdge.set(key, []);
        byEdge.get(key).push(t);
      }
    const cap = new Set([seed]);
    const stack = [seed];
    while (stack.length) {
      const t = stack.pop();
      for (let e = 0; e < 3; e += 1) {
        const a = T[t * 3 + e];
        const b = T[t * 3 + ((e + 1) % 3)];
        for (const u of byEdge.get(a < b ? `${a},${b}` : `${b},${a}`))
          if (!cap.has(u)) {
            cap.add(u);
            stack.push(u);
          }
      }
    }
    return { sign, side, triangles: [...cap] };
  });
}

/**
 * The same landmarks on both faces: `targets` where they are on the MakeHuman
 * body, `sources` where they are on MHR's surface as it stands, as points on
 * its triangles. The eyes' are read against each body's own idea of an open
 * eye - on MakeHuman, where the proxy is in front of the skin; on MHR, where
 * the cap is. The ears' are read from the side (see `earLandmarks`), and
 * `ears` marks MHR's vertices on them: MakeHuman's ear is a different shape,
 * and pulled onto it by `conform` MHR's is flattened.
 */
function landmarks(body, proxy, eyes, positions, triangles, caps) {
  const names = [];
  const targets = [];
  const sources = [];
  const cy = (eyes[0].centre[1] + eyes[1].centre[1]) / 2;
  const lo = [-70 * MM, cy - 140 * MM];
  const hi = [70 * MM, cy + 60 * MM];
  const theirs = heightMap(body.positions, body.indices, lo, hi);
  const ours = heightMap(positions, triangles, lo, hi);
  const found = faceLandmarks(ours, cy);
  for (const [name, target] of faceLandmarks(theirs, cy)) {
    const [x, y] = found.get(name);
    names.push(name);
    targets.push(target);
    sources.push(surfaceAt(ours, pixelOf(ours, x, y)));
  }
  for (const eye of eyes) {
    const from = [eye.centre[0] - 25 * MM, eye.centre[1] - 20 * MM];
    const to = [eye.centre[0] + 25 * MM, eye.centre[1] + 20 * MM];
    const skin = heightMap(body.positions, body.indices, from, to);
    const ball = heightMap(proxy.positions, proxy.indices, from, to, eye.triangles);
    const open = flood(skin, (i) => ball.depth[i] >= skin.depth[i], pixelOf(skin, eye.centre[0], eye.centre[1]));
    const mine = heightMap(positions, triangles, from, to);
    const cap = new Set(caps.find((c) => c.sign === eye.sign).triangles);
    const shut = Uint8Array.from(mine.owner, (t) => (cap.has(t) ? 1 : 0));
    const rim = eyeRim(mine, shut, eye.sign);
    for (const [name, i] of eyeRim(skin, open, eye.sign)) {
      names.push(`eye ${eye.side} ${name}`);
      targets.push([...placeOf(skin, i), skin.depth[i]]);
      sources.push(surfaceAt(mine, rim.get(name)));
    }
  }
  const ears = new Uint8Array(positions.length / 3);
  const cz = (eyes[0].centre[2] + eyes[1].centre[2]) / 2;
  for (const [side, sign] of [["l", 1], ["r", -1]]) {
    // Looking in at the side of the head: z across, y up, and out along x.
    const sideways = (from) => {
      const out = new Float64Array(from.length);
      for (let v = 0; v < from.length; v += 3) out.set([from[v + 2], from[v + 1], sign * from[v]], v);
      return out;
    };
    const from = [cz - 150 * MM, cy - 80 * MM];
    const to = [cz - 30 * MM, cy + 40 * MM];
    const skin = heightMap(sideways(body.positions), body.indices, from, to);
    const mine = heightMap(sideways(positions), triangles, from, to);
    const theirs = earLandmarks(skin);
    const ours = earLandmarks(mine);
    for (const [name, i] of theirs.points) {
      const [z, y] = placeOf(skin, i);
      names.push(`ear ${side} ${name}`);
      targets.push([sign * skin.depth[i], y, z]);
      sources.push(surfaceAt(mine, ours.points.get(name)));
    }
    // The ear, front and back: whatever stands off the skull within a
    // millimetre or two of the patch seen.
    const reach = Math.round((2 * MM) / PIXEL);
    const near = new Uint8Array(mine.w * mine.h);
    for (let i = 0; i < near.length; i += 1) {
      if (!ours.region[i]) continue;
      const x = i % mine.w;
      const y = (i - x) / mine.w;
      for (let dy = -reach; dy <= reach; dy += 1)
        for (let dx = -reach; dx <= reach; dx += 1) {
          const [a, b] = [x + dx, y + dy];
          if (a >= 0 && b >= 0 && a < mine.w && b < mine.h) near[a + b * mine.w] = 1;
        }
    }
    for (let v = 0; v < ears.length; v += 1) {
      const i = pixelOf(mine, positions[v * 3 + 2], positions[v * 3 + 1]);
      if (i >= 0 && near[i] && sign * positions[v * 3] > ours.skull[i] - MM) ears[v] = 1;
    }
  }
  return { names, targets, sources, ears };
}

/**
 * Solve `a x = b` for a general `n` x `n` system and `m` right-hand sides,
 * row-major, in place (Gaussian elimination, partial pivoting).
 */
function eliminate(a, b, n, m) {
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r * n + col]) > Math.abs(a[pivot * n + col])) pivot = r;
    if (!(Math.abs(a[pivot * n + col]) > 1e-300)) throw new Error("the warp's system is singular");
    if (pivot !== col) {
      for (let c = 0; c < n; c += 1) [a[col * n + c], a[pivot * n + c]] = [a[pivot * n + c], a[col * n + c]];
      for (let c = 0; c < m; c += 1) [b[col * m + c], b[pivot * m + c]] = [b[pivot * m + c], b[col * m + c]];
    }
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r * n + col] / a[col * n + col];
      if (!f) continue;
      for (let c = col; c < n; c += 1) a[r * n + c] -= f * a[col * n + c];
      for (let c = 0; c < m; c += 1) b[r * m + c] -= f * b[col * m + c];
    }
  }
  for (let r = n - 1; r >= 0; r -= 1)
    for (let c = 0; c < m; c += 1) {
      let s = b[r * m + c];
      for (let k = r + 1; k < n; k += 1) s -= a[r * n + k] * b[k * m + c];
      b[r * m + c] = s / a[r * n + r];
    }
  return b;
}

/**
 * The smoothest bending of space that carries each of `from` onto the same
 * entry of `to` and leaves each of `still` where it is: the thin-plate spline
 * in three dimensions, kernel |r|, with an affine part.
 */
function thinPlate(from, to, still) {
  const points = [...from, ...still];
  const n = points.length;
  const N = n + 4;
  const a = new Float64Array(N * N);
  const b = new Float64Array(N * 3);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) a[i * N + j] = Math.hypot(...sub(points[i], points[j]));
    a[i * N + n] = a[n * N + i] = 1;
    for (let k = 0; k < 3; k += 1) a[i * N + n + 1 + k] = a[(n + 1 + k) * N + i] = points[i][k];
  }
  from.forEach((p, i) => b.set(sub(to[i], p), i * 3));
  const x = eliminate(a, b, N, 3);
  return (p) => {
    const d = [x[n * 3], x[n * 3 + 1], x[n * 3 + 2]];
    for (let k = 0; k < 3; k += 1) for (let c = 0; c < 3; c += 1) d[c] += p[k] * x[(n + 1 + k) * 3 + c];
    for (let i = 0; i < n; i += 1) {
      const r = Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]);
      for (let c = 0; c < 3; c += 1) d[c] += r * x[i * 3 + c];
    }
    return d;
  };
}

/** How much of each vertex rides with the head and neck, from MHR's own skinning. */
function headShare(rig, count) {
  const head = new Set([RIG_INDEX.get("head"), RIG_INDEX.get("neck_01")]);
  const out = new Float32Array(count);
  for (let v = 0; v < count; v += 1)
    for (let k = 0; k < 4; k += 1) if (head.has(rig.joints[v * 4 + k])) out[v] += rig.weights[v * 4 + k];
  return out;
}

/** Landmarks further than this from the head's still points. */
const STILL = 35 * MM;

/**
 * Bend MHR's head so its landmarks land on MakeHuman's, in place. The face
 * between them follows smoothly; the head beyond reach of any of them - every
 * 97th vertex of it, more than `STILL` from a landmark - stays put, and the
 * body below the neck is weighted out. Returns how far the landmarks were.
 */
function warp(positions, triangles, count, { sources, targets }, share) {
  const from = sources.map((s) => onSurface(positions, triangles, s));
  const still = [];
  for (let v = 0; v < count; v += 97) {
    if (share[v] < 0.5) continue;
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    if (from.every((q) => Math.hypot(...sub(p, q)) > STILL)) still.push(p);
  }
  const field = thinPlate(from, targets, still);
  for (let v = 0; v < count; v += 1) {
    if (!(share[v] > 0)) continue;
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    positions.set(add(p, scale(field(p), share[v])), v * 3);
  }
  const off = from.map((p, i) => Math.hypot(...sub(targets[i], p)));
  return { mean: off.reduce((a, b) => a + b) / off.length, worst: Math.max(...off), still: still.length };
}

/* ------------------------------------------------------------------ */
/* Conforming                                                          */
/* ------------------------------------------------------------------ */

/**
 * The part of the body a joint's skin moves with, for `conform`: the trunk and
 * head, each arm, each palm, each finger, each leg. Offsets are only ever
 * averaged within one part, so a thigh is not pulled by the other thigh an
 * inch away, nor a finger by the one beside it.
 */
function part(name) {
  const side = name.match(/_([lr])$/)?.[1];
  if (/^(upperarm|lowerarm)_/.test(name)) return `arm_${side}`;
  if (/^hand_/.test(name)) return name;
  const finger = name.match(/^(index|middle|ring|pinky|thumb)_0\d_([lr])$/);
  if (finger) return `${finger[1]}_${finger[2]}`;
  if (/^(thigh|calf|foot|ball)_/.test(name)) return `leg_${side}`;
  return "trunk";
}
const PARTS = [...new Set(RIG.map((joint) => part(joint.name)))];
const PART_OF = RIG.map((joint) => PARTS.indexOf(part(joint.name)));

/** Each vertex's weight on each of `PARTS`, from MHR's own skinning. */
function partWeights(rig, count) {
  const out = new Float32Array(count * PARTS.length);
  for (let v = 0; v < count; v += 1)
    for (let k = 0; k < 4; k += 1) out[v * PARTS.length + PART_OF[rig.joints[v * 4 + k]]] += rig.weights[v * 4 + k];
  return out;
}

/**
 * Points binned into cubes of side `cell`, each with a weight and a vector:
 * `blur(p)` is the Gaussian-weighted mean of the vectors round `p`, out to
 * three `sigma`s.
 */
class Blur {
  constructor(sigma) {
    this.sigma = sigma;
    this.cell = 3 * sigma;
    // Points are first pooled in cubes a quarter-sigma across: a Gaussian
    // that wide cannot tell them apart, and there are many fewer pools.
    this.pool = new Map();
  }

  add(p, weight, vector) {
    const q = sigma4(p, this.sigma);
    let bin = this.pool.get(q);
    if (!bin) this.pool.set(q, (bin = [0, 0, 0, 0, 0, 0, 0]));
    bin[0] += weight;
    for (let c = 0; c < 3; c += 1) {
      bin[1 + c] += weight * p[c];
      bin[4 + c] += weight * vector[c];
    }
  }

  seal() {
    this.cells = new Map();
    for (const bin of this.pool.values()) {
      const at = [bin[1] / bin[0], bin[2] / bin[0], bin[3] / bin[0]];
      const key = at.map((x) => Math.floor(x / this.cell)).join(",");
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push([...at, bin[0], bin[4], bin[5], bin[6]]);
    }
    delete this.pool;
    return this;
  }

  blur(p) {
    const home = p.map((x) => Math.floor(x / this.cell));
    const out = [0, 0, 0];
    let total = 0;
    const k = 1 / (2 * this.sigma * this.sigma);
    const reach = this.cell * this.cell;
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = this.cells.get(`${home[0] + dx},${home[1] + dy},${home[2] + dz}`);
          if (!list) continue;
          for (const [x, y, z, w, a, b, c] of list) {
            const r = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
            if (r > reach) continue;
            const g = Math.exp(-r * k);
            total += g * w;
            out[0] += g * a;
            out[1] += g * b;
            out[2] += g * c;
          }
        }
    return total > 1e-12 ? scale(out, 1 / total) : null;
  }
}
const sigma4 = (p, sigma) => p.map((x) => Math.floor((x * 4) / sigma)).join(",");

/**
 * What the identity shapes cannot reach - how long a forearm is, where a hand
 * sits on it, the set of a foot - taken up by a smooth field of offsets onto
 * the MakeHuman surface, in place.
 *
 * Each vertex measures its way to the nearest point it may take (see
 * `allows`). The field at a point is the Gaussian mean of those offsets, part
 * by part, blended by the vertex's weight on each part - the widest first and
 * narrower each round. At a centimetre and a half they move a cheek, a
 * knuckle or a knee; they cannot reach down to MakeHuman's own facets, which
 * is what keeps MHR's surface MHR's. `skip` marks vertices whose offsets say
 * nothing (see `ears`): they are moved, but do not pull.
 */
function conform(positions, triangles, count, rig, grid, zones, owner, skip, sigmas = [40, 25, 15]) {
  const P = PARTS.length;
  const weights = partWeights(rig, count);
  const vertexZones = Array.from({ length: count }, (_, v) => zone(RIG[owner[v]].name));
  const moved = [];
  for (const sigma of sigmas) {
    const normals = vertexNormals(positions, triangles);
    const blurs = PARTS.map(() => new Blur(sigma * MM));
    for (let v = 0; v < count; v += 1) {
      if (skip[v]) continue;
      const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
      const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      const hit = grid.nearest(p, 0.03, (t) => dot(grid.normal(t), n) > 0.3 && allows(vertexZones[v], zones[t]));
      if (!hit) continue;
      const d = sub(hit.point, p);
      for (let c = 0; c < P; c += 1) if (weights[v * P + c] > 0.02) blurs[c].add(p, weights[v * P + c], d);
    }
    blurs.forEach((blur) => blur.seal());
    const next = new Float64Array(positions.length);
    let total = 0;
    for (let v = 0; v < count; v += 1) {
      const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
      const shift = [0, 0, 0];
      for (let c = 0; c < P; c += 1) {
        const w = weights[v * P + c];
        if (!(w > 0)) continue;
        const d = blurs[c].blur(p);
        if (d) for (let e = 0; e < 3; e += 1) shift[e] += w * d[e];
      }
      next.set(add(p, shift), v * 3);
      total += Math.hypot(...shift);
    }
    positions.set(next);
    moved.push(total / count);
  }
  return moved;
}

/* ------------------------------------------------------------------ */
/* Skin                                                                */
/* ------------------------------------------------------------------ */

// How far one triangle's UVs, carried on over a neighbour that shares no corner
// with it, may miss the neighbour's own and the two still be one side of a
// seam: four texels, and half as far again as the carrying went, for the
// stretch between them. Across a seam the UVs jump by a good part of the atlas.
const SEAM = 2 / 1024;

/**
 * UVs for MHR's surface off the MakeHuman body's, cut along every seam the
 * photograph has.
 *
 * Each vertex takes the UV of the nearest allowed point on the MakeHuman
 * surface. Two points are on the same side of a seam if their MakeHuman
 * triangles give the corners they share the same UVs, or, sharing none, if
 * each one's UVs carried on to the other land about where the other's are. A
 * seam is not always the edge of a piece of the atlas, so it cannot be told by
 * the piece - a leg's wraps round and meets itself, and the slit up the inside
 * of the leg is inside it. Most triangles have all three corners on one side.
 * The few along a seam do not, and interpolating across it smears a strip of
 * whatever lies between the two sides in the atlas across the skin; nor may
 * one side be stretched over the other, because the atlas is drawn lighter
 * along its seams than the skin and the strip shows as a line. So such a
 * triangle is cut where the seam crosses its edges, found by halving, and each
 * piece given its own side's UVs, with vertices of its own at the cut on each.
 * A vertex already on a seam - as a MakeHuman one on it is - has both sides'
 * UVs, and each triangle takes the one that agrees with its other corners.
 * Where three sides meet in one triangle it takes the one under its middle.
 *
 * The joints and weights come the same way, off the nearest point: the MakeHuman
 * body's own, interpolated across its triangle, the four largest kept. The
 * skeleton is MakeHuman's too, so a fine body bends as the body it stands in
 * for does. `from` is each vertex's zone. The first `count` vertices keep their
 * order; the copies and the cuts' follow.
 */
function paint(positions, triangles, count, grid, body, zones, from) {
  const normals = vertexNormals(positions, triangles);
  const uvOf = (triangle, bary) => {
    const out = [0, 0];
    for (let c = 0; c < 3; c += 1) {
      const v = body.indices[triangle * 3 + c];
      out[0] += bary[c] * body.uvs[v * 2];
      out[1] += bary[c] * body.uvs[v * 2 + 1];
    }
    return out;
  };
  // Triangle `t`'s UVs carried on to `p`, off the triangle if need be.
  const carried = (t, p) => {
    const [a, b, c] = grid.corners(t);
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const d = sub(p, a);
    const [d00, d01, d11, d20, d21] = [dot(e1, e1), dot(e1, e2), dot(e2, e2), dot(d, e1), dot(d, e2)];
    const det = d00 * d11 - d01 * d01;
    const v = (d11 * d20 - d01 * d21) / det;
    const w = (d00 * d21 - d01 * d20) / det;
    return uvOf(t, [1 - v - w, v, w]);
  };
  const apart = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const ids = new Map();
  const weld = Int32Array.from({ length: body.positions.length / 3 }, (_, v) => {
    const key = Array.from(body.positions.subarray(v * 3, v * 3 + 3), (x) => Math.round(x * 1e6)).join(",");
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key);
  });
  // Two points on the skin, as {p, triangle, uv}, on one side of any seam.
  const agree = (a, b) => {
    if (a.triangle === b.triangle) return true;
    let shared = false;
    for (let i = 0; i < 3; i += 1)
      for (let j = 0; j < 3; j += 1) {
        const u = body.indices[a.triangle * 3 + i];
        const w = body.indices[b.triangle * 3 + j];
        if (weld[u] !== weld[w]) continue;
        if (apart([body.uvs[u * 2], body.uvs[u * 2 + 1]], [body.uvs[w * 2], body.uvs[w * 2 + 1]]) > 1e-5) return false;
        shared = true;
      }
    if (shared) return true;
    const [ab, ba] = [carried(a.triangle, b.p), carried(b.triangle, a.p)];
    return Math.max(apart(ab, b.uv), apart(ba, a.uv)) < SEAM + Math.max(apart(ab, a.uv), apart(ba, b.uv)) / 2;
  };
  const weightsAt = ({ triangle, bary }) => {
    const total = new Map();
    for (let c = 0; c < 3; c += 1) {
      const u = body.indices[triangle * 3 + c];
      for (let k = 0; k < 4; k += 1) {
        const j = body.joints[u * 4 + k];
        const w = bary[c] * body.weights[u * 4 + k];
        if (w > 0) total.set(j, (total.get(j) ?? 0) + w);
      }
    }
    const kept = [...total].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = kept.reduce((t, [, w]) => t + w, 0);
    return [0, 1, 2, 3].map((k) => (kept[k] ? [kept[k][0], kept[k][1] / sum] : [0, 0]));
  };
  const facing = (t, n) => dot(grid.normal(t), n) > 0.2;
  const find = (p, n, from) =>
    grid.nearest(p, 0.03, (t) => facing(t, n) && allows(from, zones[t])) ??
    grid.nearest(p, 0.06, (t) => allows(from, zones[t])) ??
    grid.nearest(p, 0.2);
  const point = (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const normal = (v) => [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
  const side = (p, hit) => ({ p, triangle: hit.triangle, uv: uvOf(hit.triangle, hit.bary) });

  const P = Array.from(positions.subarray(0, count * 3));
  const N = Array.from(normals.subarray(0, count * 3));
  const uvs = [];
  const joints = [];
  const weights = [];
  const own = [];
  const other = [];
  let far = 0;
  for (let v = 0; v < count; v += 1) {
    const p = point(v);
    const hit = find(p, normal(v), from[v]);
    if (hit.distance > 10 * MM) far += 1;
    own.push(side(p, hit));
    uvs.push(...own[v].uv);
    for (const [j, w] of weightsAt(hit)) joints.push(j), weights.push(w);
    // The other side of a seam, if one is as near, to a fifth of a millimetre.
    const across = grid.nearest(
      p,
      hit.distance + 0.2 * MM,
      (t) => facing(t, normal(v)) && allows(from[v], zones[t]) && !agree(own[v], side(p, { triangle: t, bary: nearestOnTriangle(p, ...grid.corners(t)) }))
    );
    other.push(across ? side(p, across) : null);
  }

  const added = new Map();
  const vertex = (key, p, n, uv, influences) => {
    if (!added.has(key)) {
      added.set(key, P.length / 3);
      P.push(...p);
      N.push(...n);
      uvs.push(...uv);
      for (const [j, w] of influences) joints.push(j), weights.push(w);
    }
    return added.get(key);
  };
  const four = (v) => [0, 1, 2, 3].map((k) => [joints[v * 4 + k], weights[v * 4 + k]]);
  // Vertex `v` on the side of the seam `to` is on: itself, its other side, or
  // failing both, `to`'s UVs carried on to it.
  const onSide = (v, to) => {
    if (agree(own[v], to)) return v;
    if (other[v] && agree(other[v], to)) return vertex(`${v}:other`, point(v), normal(v), other[v].uv, four(v));
    const uv = carried(to.triangle, point(v));
    return vertex(`${v}:${to.triangle}`, point(v), normal(v), uv, four(v));
  };
  // Where a seam crosses the edge from `a` to `b`, as a vertex on `end`'s side.
  const crossings = new Map();
  const crossing = (a, b, end) => {
    const [u, w] = a < b ? [a, b] : [b, a];
    const key = `${u},${w}`;
    if (!crossings.has(key)) {
      const [pu, pw, nu, nw] = [point(u), point(w), normal(u), normal(w)];
      const along = (t) => [add(scale(pu, 1 - t), scale(pw, t)), norm(add(scale(nu, 1 - t), scale(nw, t)))];
      let lo = { t: 0, side: own[u] };
      let hi = { t: 1, side: own[w] };
      for (let k = 0; k < 16; k += 1) {
        const t = (lo.t + hi.t) / 2;
        const [p, n] = along(t);
        const here = { t, side: side(p, find(p, n, from[u])) };
        if (agree(here.side, own[u])) lo = here;
        else hi = here;
      }
      // A seam through a corner, or near enough, crosses at that corner, on the
      // dot: the app welds the copies of a point by where they are, and a
      // hundredth of a millimetre can tell them apart and split its shading.
      const t = (lo.t + hi.t) / 2;
      const length = Math.hypot(...sub(pw, pu));
      const [p, n] = t * length < 0.1 * MM ? [pu, nu] : (1 - t) * length < 0.1 * MM ? [pw, nw] : along(t);
      crossings.set(key, { p, n, influences: weightsAt(find(p, n, from[u])), uv: new Map([[u, lo.side.uv], [w, hi.side.uv]]) });
    }
    const { p, n, influences, uv } = crossings.get(key);
    return vertex(`${key}:${end}`, p, n, uv.get(end), influences);
  };

  const indices = [];
  let split = 0;
  let cut = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const corners = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const firm = corners.filter((v) => !other[v]);
    const together = firm.every((v, k) => firm.slice(k + 1).every((w) => agree(own[v], own[w])));
    if (together) {
      const to = own[firm[0] ?? corners[0]];
      const placed = corners.map((v) => onSide(v, to));
      if (placed.some((v, k) => v !== corners[k])) split += 1;
      indices.push(...placed);
      continue;
    }
    split += 1;
    const turned = (k) => [corners[k % 3], corners[(k + 1) % 3], corners[(k + 2) % 3]];
    const odd = [0, 1, 2].find((k) => agree(own[corners[(k + 1) % 3]], own[corners[(k + 2) % 3]]));
    if (firm.length === 3 && odd !== undefined) {
      // Two corners on one side and `r` on the other.
      const [p, q, r] = turned(odd + 1);
      indices.push(p, q, crossing(q, r, q), p, crossing(q, r, q), crossing(r, p, p));
      indices.push(crossing(q, r, r), r, crossing(r, p, r));
      cut += 1;
    } else if (firm.length === 2) {
      // One corner on the seam, and the seam through the edge opposite it.
      const [a, b, w] = turned(corners.findIndex((v) => other[v]) + 1);
      indices.push(a, crossing(a, b, a), onSide(w, own[a]), crossing(a, b, b), b, onSide(w, own[b]));
      cut += 1;
    } else {
      const middle = [0, 1, 2].map((e) => corners.reduce((sum, v) => sum + positions[v * 3 + e], 0) / 3);
      const to = side(middle, find(middle, norm(corners.map(normal).reduce(add)), from[corners[0]]));
      indices.push(...corners.map((v) => onSide(v, to)));
    }
  }
  return {
    positions: Float64Array.from(P),
    normals: Float64Array.from(N),
    uvs: Float32Array.from(uvs),
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
    indices: Uint32Array.from(indices),
    report: { far, split, cut, added: added.size },
  };
}

/* ------------------------------------------------------------------ */
/* Eyes                                                                */
/* ------------------------------------------------------------------ */

/** The centre and radius of the sphere through `points`, least squares, by descent from their centroid. */
function sphere(points) {
  const centre = [0, 1, 2].map((c) => points.reduce((sum, p) => sum + p[c], 0) / points.length);
  const radius = () => points.reduce((sum, p) => sum + Math.hypot(...sub(p, centre)), 0) / points.length;
  for (let step = 0; step < 200; step += 1) {
    const r = radius();
    const gradient = [0, 0, 0];
    for (const p of points) {
      const d = sub(p, centre);
      const length = Math.hypot(...d) || 1;
      for (let c = 0; c < 3; c += 1) gradient[c] += (d[c] * (1 - r / length)) / points.length;
    }
    for (let c = 0; c < 3; c += 1) centre[c] += gradient[c] * 2;
  }
  return { centre, radius: radius() };
}

/**
 * Where the ray from `origin` through `direction` (unit) first meets one of
 * `list`'s triangles: `{distance, triangle}`, Infinity and -1 if it meets none
 * (Moller-Trumbore).
 */
function cast(origin, direction, positions, indices, list) {
  let distance = Infinity;
  let triangle = -1;
  for (const t of list) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    const A = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]];
    const e1 = sub([positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]], A);
    const e2 = sub([positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]], A);
    const h = cross(direction, e2);
    const determinant = dot(e1, h);
    if (Math.abs(determinant) < 1e-14) continue;
    const s = sub(origin, A);
    const u = dot(s, h) / determinant;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const w = dot(direction, q) / determinant;
    if (w < 0 || u + w > 1) continue;
    const k = dot(e2, q) / determinant;
    if (k > 0 && k < distance) {
      distance = k;
      triangle = t;
    }
  }
  return { distance, triangle };
}

/**
 * How near the lids may come to the eyeball, and how far inside the eyeball's
 * sphere the pocket behind it is closed.
 */
const CLEAR = 0.3 * MM;
const INSET = 1.5 * MM;

/**
 * Keep MHR's skin off the MakeHuman eyeball, in place: a vertex near an eye
 * standing less than `CLEAR` outside the proxy, along the line from the eye's
 * centre, is moved out to `CLEAR`. Returns how many moved, and the furthest.
 */
function clearEyes(positions, count, proxy, eyes) {
  let moved = 0;
  let furthest = 0;
  for (const eye of eyes)
    for (let v = 0; v < count; v += 1) {
      const d = sub([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], eye.centre);
      const length = Math.hypot(...d);
      if (length > eye.radius + 6 * MM) continue;
      const direction = scale(d, 1 / length);
      const { distance } = cast(eye.centre, direction, proxy.positions, proxy.indices, eye.triangles);
      if (!(distance < Infinity) || length >= distance + CLEAR) continue;
      positions.set(add(eye.centre, scale(direction, distance + CLEAR)), v * 3);
      moved += 1;
      furthest = Math.max(furthest, distance + CLEAR - length);
    }
  return { moved, furthest };
}

/**
 * MHR's eye caps cut out, and a pocket like MakeHuman's own put in each's
 * place for the proxy to sit in: a wall from the lids' margin straight back to
 * `INSET` inside the eyeball's sphere, and a floor across it there, so all of
 * it but the lids' inner rim is behind the eyeball. The wall keeps the winding
 * the cap had along the margin, so the surface stays closed and facing out.
 * MHR's vertices keep their numbers and the pockets' follow.
 */
function pockets(positions, triangles, count, caps, eyes) {
  const P = Array.from(positions.subarray(0, count * 3));
  const cut = new Set(caps.flatMap((cap) => cap.triangles));
  const T = [];
  for (let t = 0; t < triangles.length / 3; t += 1) if (!cut.has(t)) T.push(triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]);
  const report = [];
  for (const cap of caps) {
    const eye = eyes.find((e) => e.sign === cap.sign);
    const uses = new Map();
    for (const t of cap.triangles)
      for (let e = 0; e < 3; e += 1) {
        const a = triangles[t * 3 + e];
        const b = triangles[t * 3 + ((e + 1) % 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        uses.set(key, uses.has(key) ? null : [a, b]);
      }
    const rim = [...uses.values()].filter(Boolean);
    const next = new Map(rim);
    if (next.size !== rim.length) throw new Error(`MHR's ${cap.side} eye cap is not a disc`);
    let length = 0;
    for (let v = rim[0][0]; ; ) {
      v = next.get(v);
      length += 1;
      if (v === rim[0][0]) break;
      if (v === undefined || length > rim.length) throw new Error(`MHR's ${cap.side} eye cap has more than one rim`);
    }
    if (length !== rim.length) throw new Error(`MHR's ${cap.side} eye cap has more than one rim`);

    const depth = eye.radius - INSET;
    const inner = new Map();
    const gaze = [0, 0, 0];
    for (const [a] of rim) {
      const direction = norm(sub([P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], eye.centre));
      inner.set(a, P.length / 3);
      P.push(...add(eye.centre, scale(direction, depth)));
      for (let c = 0; c < 3; c += 1) gaze[c] += direction[c];
    }
    const pole = P.length / 3;
    P.push(...add(eye.centre, scale(norm(gaze), depth)));
    for (const [a, b] of rim) T.push(a, b, inner.get(b), a, inner.get(b), inner.get(a), inner.get(a), inner.get(b), pole);
    report.push({ side: cap.side, rim: rim.length });
  }
  return { positions: Float64Array.from(P), triangles: Uint32Array.from(T), count: P.length / 3, report };
}

/* ------------------------------------------------------------------ */
/* Feet                                                                */
/* ------------------------------------------------------------------ */

// Where MHR's legs give way to MakeHuman's feet, a hand's width above the
// ankle, and how far above that MHR's skin is eased onto MakeHuman's to meet
// them. The two are within a millimetre there, median, and at worst two on the
// female and eleven on the male, behind the ankle, where MakeHuman's triangles
// are largest.
const ANKLE = 0.09;
const EASE = 0.04;
// Closer than this to the cut, a vertex is put on it; closer than `SAME` along
// it, a leg's point and a foot's are the same one.
const NEAR = 5e-4;
const SAME = 1e-4;
// MakeHuman's edges near the cut are split until they are no longer than this,
// which is about as long as MHR's are there.
const FINE = 0.005;

/** The loops `triangles` are open along below height `below`, each the way its triangles run it. */
function openLoops(triangles, positions, below) {
  const uses = new Map();
  for (let i = 0; i < triangles.length; i += 3)
    for (let e = 0; e < 3; e += 1) {
      const a = triangles[i + e];
      const b = triangles[i + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, uses.has(key) ? null : [a, b]);
    }
  const next = new Map();
  for (const edge of uses.values()) {
    if (!edge || positions[edge[0] * 3 + 1] >= below) continue;
    if (next.has(edge[0])) throw new Error("a leg's cut pinches");
    next.set(edge[0], edge[1]);
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start; v !== start || !loop.length; v = next.get(v)) {
      if (v === undefined || seen.has(v)) throw new Error("a leg's cut is not a closed loop");
      seen.add(v);
      loop.push(v);
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * `triangles` cut along the plane at height `ANKLE`: the part above kept if
 * `keep` is 1 and the part below if it is -1, each piece wound as the triangle
 * it came from. A vertex within `NEAR` of the plane is first put on it, so that
 * no piece is a sliver. Wherever an edge crosses, `positions` gains a vertex on
 * the plane, one for both triangles either side, and `made` is told the edge's
 * kept end.
 */
function clip(triangles, positions, keep, made) {
  const y = (v) => positions[v * 3 + 1] - ANKLE;
  for (const v of triangles) if (Math.abs(y(v)) < NEAR) positions[v * 3 + 1] = ANKLE;
  const crossings = new Map();
  const on = (a, b) => {
    const key = `${a},${b}`;
    if (!crossings.has(key)) {
      const s = y(a) / (y(a) - y(b));
      crossings.set(key, positions.length / 3);
      positions.push(...[0, 1, 2].map((c) => positions[a * 3 + c] + s * (positions[b * 3 + c] - positions[a * 3 + c])));
      positions[positions.length - 2] = ANKLE;
      made(a);
    }
    return crossings.get(key);
  };
  const out = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const c = [triangles[i], triangles[i + 1], triangles[i + 2]];
    // 1 kept, -1 not, 0 on the plane.
    const side = c.map((v) => Math.sign(keep * y(v)));
    if (!side.includes(-1)) {
      if (side.includes(1)) out.push(...c);
      continue;
    }
    if (!side.includes(1)) continue;
    const turned = (k) => [0, 1, 2].map((e) => c[(k + e) % 3]);
    if (side.includes(0)) {
      // One of each: the plane runs from the corner on it across the far edge.
      const k = side.indexOf(0);
      const [o, p, q] = turned(k);
      if (side[(k + 1) % 3] === 1) out.push(o, p, on(p, q));
      else out.push(o, on(q, p), q);
    } else if (side.filter((s) => s === 1).length === 1) {
      const [a, b, d] = turned(side.indexOf(1));
      out.push(a, on(a, b), on(a, d));
    } else {
      const [a, b, d] = turned(side.indexOf(-1));
      out.push(b, d, on(d, a), b, on(d, a), on(b, a));
    }
  }
  return out;
}

/**
 * Close a leg's cut onto its foot's. Both lie on the plane at `ANKLE`, run
 * round it opposite ways, and are within a millimetre of each other. Each of
 * the leg's points moves onto the nearest point of the foot's loop, and every
 * edge along the cut, either side, is split at the other side's points along
 * it, so the two meet vertex for vertex with no strip between them to show.
 * Points closer than `SAME` along the cut are made one first - a leg's onto a
 * foot's, which does not move - and the leg's triangles that leaves with no
 * area are dropped.
 */
function sew(leg, foot, positions, triangles) {
  const at = (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const n = foot.length;
  // How far round the foot's loop each point on the cut is, in its edges.
  const along = new Map(foot.map((v, i) => [v, i]));
  let moved = 0;
  for (const v of leg) {
    let best = { d: Infinity };
    for (let i = 0; i < n; i += 1) {
      const a = at(foot[i]);
      const ab = sub(at(foot[(i + 1) % n]), a);
      const s = Math.min(1, Math.max(0, dot(sub(at(v), a), ab) / dot(ab, ab)));
      const q = add(a, scale(ab, s));
      const d = Math.hypot(...sub(at(v), q));
      if (d < best.d) best = { d, t: i + s, q };
    }
    moved = Math.max(moved, best.d);
    positions.splice(v * 3, 3, ...best.q);
    along.set(v, best.t);
  }

  // Foot's points first where a leg's lies at the same place.
  const sorted = [...along.keys()].sort((a, b) => along.get(a) - along.get(b));
  const isFoot = (v) => Number.isInteger(along.get(v)) && foot[along.get(v)] === v;
  const same = new Map();
  const ring = [];
  for (const v of sorted) {
    const last = ring.at(-1);
    if (last === undefined || Math.hypot(...sub(at(v), at(last))) >= SAME || (isFoot(v) && isFoot(last))) ring.push(v);
    else if (isFoot(v)) {
      same.set(last, v);
      ring[ring.length - 1] = v;
    } else same.set(v, last);
  }
  // Round the end, back to the foot's first point.
  if (ring.length > 1 && !isFoot(ring.at(-1)) && Math.hypot(...sub(at(ring.at(-1)), at(ring[0]))) < SAME) same.set(ring.pop(), ring[0]);
  const one = (v) => (same.has(v) ? one(same.get(v)) : v);
  const kept = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const c = [0, 1, 2].map((e) => one(triangles[t + e]));
    if (new Set(c).size === 3) kept.push(...c);
  }
  triangles.length = 0;
  for (const v of kept) triangles.push(v);
  const cut = leg.map(one).filter((v, k, all) => v !== all[(k + 1) % all.length]);

  const place = new Map(ring.map((v, i) => [v, i]));
  const N = ring.length;
  let turn = 0;
  cut.forEach((v, k) => {
    const step = (place.get(v) - place.get(cut[(k + 1) % cut.length]) + N) % N;
    if (!step) throw new Error("a leg's cut doubles back along its foot's");
    turn += step;
  });
  if (turn !== N) throw new Error("a leg's cut winds round its foot's more than once");

  const edges = new Map();
  for (let t = 0; t < triangles.length; t += 3)
    for (let e = 0; e < 3; e += 1) {
      const [u, w] = [triangles[t + e], triangles[t + ((e + 1) % 3)]];
      if (place.has(u) && place.has(w)) edges.set(`${u},${w}`, t);
    }
  const split = (u, w, direction) => {
    const fan = [u];
    for (let i = (place.get(u) + direction + N) % N; ring[i] !== w; i = (i + direction + N) % N) fan.push(ring[i]);
    fan.push(w);
    if (fan.length === 2) return;
    const t = edges.get(`${u},${w}`);
    if (t === undefined) throw new Error("an edge along the cut is in no triangle");
    const r = [0, 1, 2].map((e) => triangles[t + e]).find((v) => v !== u && v !== w);
    triangles.splice(t, 3, fan[0], fan[1], r);
    for (let k = 1; k + 1 < fan.length; k += 1) triangles.push(fan[k], fan[k + 1], r);
  };
  foot.forEach((v, i) => split(v, foot[(i + 1) % n], 1));
  cut.forEach((v, k) => split(v, cut[(k + 1) % cut.length], -1));
  return { ring, points: N, merged: same.size, moved };
}

/**
 * MakeHuman's surface as it is drawn rather than as it is stored: each
 * triangle the PN-triangle cubic (Vlachos et al., 2001) its corners' normals
 * say it curves along, which is the curve `tessellate` splits its edges to
 * follow. The normals are welded by position, so that the UV seams do not
 * show in them. Returns the point on it at `bary` on `triangle`.
 */
function drawnSurface(body) {
  const ids = new Uint32Array(body.positions.length / 3);
  const seen = new Map();
  const points = [];
  ids.forEach((_, v) => {
    const p = body.positions.subarray(v * 3, v * 3 + 3);
    const key = Array.from(p, (x) => Math.round(x * 1e6)).join(",");
    if (!seen.has(key)) {
      seen.set(key, seen.size);
      points.push(...p);
    }
    ids[v] = seen.get(key);
  });
  const normals = vertexNormals(Float64Array.from(points), body.indices.map((v) => ids[v]));
  return ({ triangle, bary }) => {
    const corners = [0, 1, 2].map((k) => body.indices[triangle * 3 + k]);
    const p = corners.map((v) => Array.from(body.positions.subarray(v * 3, v * 3 + 3)));
    const n = corners.map((v) => Array.from(normals.subarray(ids[v] * 3, ids[v] * 3 + 3)));
    // The control point a third of the way from corner i to corner j.
    const third = (i, j) => scale(sub(add(scale(p[i], 2), p[j]), scale(n[i], dot(sub(p[j], p[i]), n[i]))), 1 / 3);
    const edges = [third(0, 1), third(1, 0), third(1, 2), third(2, 1), third(2, 0), third(0, 2)];
    const mean = scale(edges.reduce(add), 1 / 6);
    const middle = add(mean, scale(sub(mean, scale(add(add(p[0], p[1]), p[2]), 1 / 3)), 1 / 2));
    const [a, b, c] = bary;
    let out = [0, 0, 0];
    for (const [point, weight] of [
      [p[0], a * a * a], [p[1], b * b * b], [p[2], c * c * c],
      [edges[0], 3 * a * a * b], [edges[1], 3 * a * b * b],
      [edges[2], 3 * b * b * c], [edges[3], 3 * b * c * c],
      [edges[4], 3 * c * c * a], [edges[5], 3 * c * a * a],
      [middle, 6 * a * b * c],
    ])
      out = add(out, scale(point, weight));
    return out;
  };
}

/**
 * Triangles split until none of their edges `wants(a, b)` to be, each new
 * point where `place(piece, bary, a, b)` puts it, as [position, zone].
 *
 * Each edge is split or not by its own length and place, and the triangles
 * either side of it follow, so there are no T-junctions: into two, three or
 * four, as `tessellate` splits them. `pieces` are {c, triangle, bary}: corner
 * vertices, the triangle they lie on, and where on it.
 */
function finer(pieces, P, zoneOf, wants, place) {
  const at = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  for (let pass = 0; pass < 8; pass += 1) {
    const mids = new Map();
    const middle = (piece, k) => {
      const [a, b] = [piece.c[k], piece.c[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const bary = piece.bary[k].map((x, i) => (x + piece.bary[(k + 1) % 3][i]) / 2);
      if (!mids.has(key)) {
        mids.set(key, P.length / 3);
        const [position, zone] = place(piece, bary, a, b);
        P.push(...position);
        zoneOf.push(zone);
      }
      return { v: mids.get(key), bary };
    };
    const out = [];
    let split = 0;
    for (const piece of pieces) {
      const cut = [0, 1, 2].filter((k) => wants(piece.c[k], piece.c[(k + 1) % 3]));
      if (!cut.length) {
        out.push(piece);
        continue;
      }
      split += 1;
      // Turned so that the edges cut are the first ones.
      const k0 = cut.length === 2 ? [0, 1, 2].find((k) => !cut.includes(k)) + 1 : cut[0];
      const turn = (list) => [0, 1, 2].map((e) => list[(k0 + e) % 3]);
      const p = { c: turn(piece.c), triangle: piece.triangle, bary: turn(piece.bary) };
      const corner = (k) => ({ v: p.c[k], bary: p.bary[k] });
      const make = (...points) => out.push({ c: points.map((q) => q.v), triangle: p.triangle, bary: points.map((q) => q.bary) });
      const [a, b, c] = [0, 1, 2].map(corner);
      if (cut.length === 1) {
        const m = middle(p, 0);
        make(a, m, c);
        make(m, b, c);
      } else if (cut.length === 2) {
        const [m, n] = [middle(p, 0), middle(p, 1)];
        make(m, b, n);
        // The rest is a quad, cut along its shorter diagonal.
        if (Math.hypot(...sub(at(a.v), at(n.v))) < Math.hypot(...sub(at(m.v), at(c.v)))) {
          make(a, m, n);
          make(a, n, c);
        } else {
          make(a, m, c);
          make(m, n, c);
        }
      } else {
        const [m, n, o] = [middle(p, 0), middle(p, 1), middle(p, 2)];
        make(a, m, o);
        make(m, b, n);
        make(o, n, c);
        make(m, n, o);
      }
    }
    pieces = out;
    if (!split) break;
  }
  return pieces;
}

// How much more dearly the skin near the cut bends up a leg than round it,
// as a scale on height: see `fair`.
const UPRIGHT = 3;

/**
 * `finer`'s points, from `made` on, moved onto the surface through MakeHuman's
 * own that bends least. Returns how many moved, and the furthest any went.
 *
 * `drawnSurface` is one cubic a triangle, and two of them meet at an edge
 * without meeting at an angle: where MakeHuman's triangles are small, as they
 * are over most of the foot, nobody could see it, but behind some of the ankles
 * one triangle runs from the heel halfway up the calf, and cut finely enough
 * for the app's normals to follow it, its edges draw as ridges. Near the cut a
 * leg is one distance from a line up its middle for each way round it and
 * height up it, and each point is put at the distance the thin-plate spline
 * through MakeHuman's points gives (Duchon, 1977), those taken round the leg
 * three times so that it closes. MakeHuman's points there lie in rings round
 * the leg, much closer together round it than the rings are up it, and a
 * spline as free to bend either way sags between the rings - behind the male
 * ankle, by two millimetres. So height is measured `UPRIGHT` times smaller,
 * which makes bending up the leg that to the fourth times as dear: from one
 * ring to the next the skin runs close to straight, as MakeHuman's own
 * triangles do, but without their corners.
 */
function fair(P, first, made) {
  let points = 0;
  let most = 0;
  const ys = [];
  for (let v = made; v < P.length / 3; v += 1) ys.push(P[v * 3 + 1]);
  // A ring of MakeHuman's beyond the points either way.
  const [lo, hi] = [Math.min(...ys) - 3 * FINE, Math.max(...ys) + 3 * FINE];
  for (const side of [-1, 1]) {
    const own = [];
    for (let v = first; v < made; v += 1) if (Math.sign(P[v * 3]) === side && P[v * 3 + 1] > lo && P[v * 3 + 1] < hi) own.push(v);
    // The leg's middle, a line fitted up it.
    const mean = (f) => own.reduce((sum, v) => sum + f(v), 0) / own.length;
    const my = mean((v) => P[v * 3 + 1]);
    const line = (k) => {
      const mk = mean((v) => P[v * 3 + k]);
      const slope = mean((v) => (P[v * 3 + 1] - my) * (P[v * 3 + k] - mk)) / mean((v) => (P[v * 3 + 1] - my) ** 2);
      return (y) => mk + slope * (y - my);
    };
    const [cx, cz] = [line(0), line(2)];
    // Which way round, how far up (made smaller) and how far out.
    const polar = (v) => {
      const y = P[v * 3 + 1];
      const [dx, dz] = [P[v * 3] - cx(y), P[v * 3 + 2] - cz(y)];
      return [Math.atan2(dz, dx), y / UPRIGHT, Math.hypot(dx, dz)];
    };
    const radius = mean((v) => polar(v)[2]);
    const data = own.flatMap((v) => {
      const [angle, y, r] = polar(v);
      return [-1, 0, 1].map((turn) => [(angle + turn * 2 * Math.PI) * radius, y, r]);
    });
    const kernel = (du, dy) => {
      const d2 = du * du + dy * dy;
      return d2 > 0 ? (d2 * Math.log(d2)) / 2 : 0;
    };
    const n = data.length;
    const N = n + 3;
    const a = new Float64Array(N * N);
    const b = new Float64Array(N);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) a[i * N + j] = kernel(data[i][0] - data[j][0], data[i][1] - data[j][1]);
      a[i * N + n] = a[n * N + i] = 1;
      a[i * N + n + 1] = a[(n + 1) * N + i] = data[i][0];
      a[i * N + n + 2] = a[(n + 2) * N + i] = data[i][1];
      b[i] = data[i][2];
    }
    const w = eliminate(a, b, N, 1);
    for (let v = made; v < P.length / 3; v += 1) {
      if (Math.sign(P[v * 3]) !== side) continue;
      const [angle, y, r] = polar(v);
      const u = angle * radius;
      let to = w[n] + w[n + 1] * u + w[n + 2] * y;
      for (let i = 0; i < n; i += 1) to += w[i] * kernel(u - data[i][0], y - data[i][1]);
      const up = y * UPRIGHT;
      P[v * 3] = cx(up) + to * Math.cos(angle);
      P[v * 3 + 2] = cz(up) + to * Math.sin(angle);
      points += 1;
      most = Math.max(most, Math.abs(to - r));
    }
  }
  return { points, most };
}

/**
 * The triangles within `FINE` of the cut with their edges turned, where the
 * other diagonal of the two triangles either side of an edge makes the pair
 * rounder (Lawson's flip, until the angles facing each edge sum to less than a
 * half turn). Cutting and sewing leave long, low triangles along the cut,
 * fanned out from a corner just off it, and round an ankle a triangle that
 * spans that much of it and so little height leans well away from the skin -
 * by thirty degrees, some of them. It is only a sliver, but it shares its
 * corners with the triangles round it, and so its lean with their normals, and
 * the cut draws as a line. Returns how many were turned.
 */
function rounder(triangles, positions) {
  const at = (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const within = (t) => [0, 1, 2].every((e) => Math.abs(positions[triangles[t + e] * 3 + 1] - ANKLE) < FINE);
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const facing = (o, a, b) => {
    const [u, w] = [sub(at(a), at(o)), sub(at(b), at(o))];
    return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / Math.hypot(...u) / Math.hypot(...w))));
  };
  const facet = (a, b, c) => cross(sub(at(b), at(a)), sub(at(c), at(a)));
  // Every edge, so that no turn makes one twice; each with its triangles.
  const edges = new Map();
  for (let t = 0; t < triangles.length; t += 3)
    for (let e = 0; e < 3; e += 1) {
      const k = key(triangles[t + e], triangles[t + ((e + 1) % 3)]);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(t);
    }
  const queue = [...edges.keys()].filter((k) => edges.get(k).every(within));
  let turned = 0;
  for (let n = 0; n < queue.length && turned < 1e5; n += 1) {
    const owners = edges.get(queue[n]);
    if (!owners || owners.length !== 2 || !owners.every(within)) continue;
    const [t1, t2] = owners;
    // t1 is (a, b, c) and t2 (b, a, d).
    const e1 = [0, 1, 2].find((e) => key(triangles[t1 + e], triangles[t1 + ((e + 1) % 3)]) === queue[n]);
    const [a, b, c] = [0, 1, 2].map((e) => triangles[t1 + ((e1 + e) % 3)]);
    const d = [0, 1, 2].map((e) => triangles[t2 + e]).find((v) => v !== a && v !== b);
    if (edges.has(key(c, d)) || facing(c, a, b) + facing(d, b, a) <= Math.PI + 1e-6) continue;
    const was = add(facet(a, b, c), facet(b, a, d));
    if (dot(facet(a, d, c), was) <= 0 || dot(facet(d, b, c), was) <= 0) continue;
    triangles.splice(t1, 3, a, d, c);
    triangles.splice(t2, 3, d, b, c);
    edges.delete(queue[n]);
    edges.set(key(c, d), [t1, t2]);
    edges.get(key(a, d)).splice(edges.get(key(a, d)).indexOf(t2), 1, t1);
    edges.get(key(b, c)).splice(edges.get(key(b, c)).indexOf(t1), 1, t2);
    queue.push(key(a, d), key(d, b), key(b, c), key(c, a));
    turned += 1;
  }
  return turned;
}

/**
 * MakeHuman's feet on MHR's legs.
 *
 * MHR's densest foot is a sock: one smooth block from the ball of the foot to
 * the tips, with no toes in it, and MakeHuman's photograph of five toes looks
 * drawn on. So below `ANKLE` the fine body is the MakeHuman body's own surface -
 * its points, and near the cut more of them (`finer`) - and MHR's skin is eased
 * onto it for `EASE` above that, and all the way below, so that its edges cross
 * the cut on MakeHuman's skin. The new points are put on the surface the app
 * draws (`drawnSurface`) and then on the smoothest one through MakeHuman's own
 * (`fair`): MHR's points laid on its flat triangles would draw every one of
 * them, in a band round each ankle. MHR's triangles are split finer just above
 * the cut too. The two are cut along the same plane there, sewn together along
 * it (`sew`), and the triangles sewing leaves along it made rounder
 * (`rounder`). MHR's vertices keep their order, less those below the cut; the
 * cut's and the feet's follow. `from` is each vertex's zone, and is carried
 * along.
 */
function graft(positions, triangles, count, body, zones, from) {
  const drawn = drawnSurface(body);
  const P = Array.from(positions);
  const zoneOf = Array.from(from);
  const inherit = (v) => zoneOf.push(zoneOf[v]);
  const at = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const spans = (a, b, lo, hi) => Math.max(P[a * 3 + 1], P[b * 3 + 1]) > lo && Math.min(P[a * 3 + 1], P[b * 3 + 1]) < hi;
  const longer = (a, b, length) => Math.hypot(...sub(at(a), at(b))) > length;
  const whole = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  // MHR's triangles where they meet the cut, split to half as long again as
  // they are: the cut crosses MakeHuman's as well as MHR's, and sewn to so many
  // points an edge of MHR's just above it would span them as a chord, a
  // fraction of a millimetre inside the skin, and the slivers between the two
  // would lean inward by as many degrees as there are points.
  let upper = [];
  for (let t = 0; t < triangles.length; t += 3) upper.push({ c: [triangles[t], triangles[t + 1], triangles[t + 2]], triangle: t / 3, bary: whole });
  const graded = (a, b) => (FINE / 2) * (1 + Math.max(0, Math.min(P[a * 3 + 1], P[b * 3 + 1]) - ANKLE) / FINE);
  upper = finer(upper, P, zoneOf, (a, b) => spans(a, b, ANKLE, ANKLE + 2 * FINE) && longer(a, b, graded(a, b)), (piece, bary, a, b) => [
    scale(add(at(a), at(b)), 1 / 2),
    zoneOf[a],
  ]);
  const leg = P.length / 3;

  // MakeHuman's own vertices are split wherever its photograph or its shading
  // is, and are welded here: `paint` gives them their UVs again, and the seams.
  // Each piece of triangle keeps the one it came from, and where its corners
  // are on that. They reach as high as MHR is eased onto them.
  const welded = new Map();
  let pieces = [];
  for (let i = 0; i < body.indices.length; i += 3) {
    const corners = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
    if (!corners.some((u) => body.positions[u * 3 + 1] < ANKLE + EASE)) continue;
    const c = corners.map((u) => {
      const p = body.positions.subarray(u * 3, u * 3 + 3);
      const key = Array.from(p, (x) => Math.round(x * 1e6)).join(",");
      if (!welded.has(key)) {
        welded.set(key, P.length / 3);
        P.push(...p);
        zoneOf.push(zones[i / 3]);
      }
      return welded.get(key);
    });
    pieces.push({ c, triangle: i / 3, bary: whole });
  }
  const made = P.length / 3;
  // Split as fine as MHR, then made smooth: see `fair`. Some of
  // MakeHuman's triangles there are the height of a hand, so it is enough for
  // an edge to come near the cut.
  pieces = finer(pieces, P, zoneOf, (a, b) => spans(a, b, ANKLE - EASE / 2, ANKLE + EASE) && longer(a, b, FINE), (piece, bary) => [
    drawn({ triangle: piece.triangle, bary }),
    zones[piece.triangle],
  ]);
  const faired = fair(P, leg, made);
  // The skin as it is now, for MHR's to be eased onto.
  const skin = new TriangleGrid(Float64Array.from(P), Uint32Array.from(pieces.flatMap((piece) => piece.c)), 0.01);
  const skinZones = pieces.map((piece) => zones[piece.triangle]);
  const feet = clip(pieces.flatMap((piece) => piece.c), P, -1, inherit);

  let most = 0;
  for (let v = 0; v < leg; v += 1) {
    const p = at(v);
    if (p[1] < ANKLE - EASE || p[1] >= ANKLE + EASE) continue;
    const hit = skin.nearest(p, 0.01, (t) => allows(zoneOf[v], skinZones[t]));
    if (!hit) continue;
    const to = sub(hit.point, p);
    const s = Math.min(1, 1 - (p[1] - ANKLE) / EASE);
    P.splice(v * 3, 3, ...add(p, scale(to, s * s * (3 - 2 * s))));
    most = Math.max(most, Math.hypot(...to));
  }
  const cut = P.length / 3;
  const legs = clip(upper.flatMap((piece) => piece.c), P, 1, inherit);

  const cuts = openLoops(legs, P, ANKLE + 1e-6);
  const soles = openLoops(feet, P, ANKLE + 1e-6);
  const side = (loop) => Math.sign(loop.reduce((sum, v) => sum + P[v * 3], 0));
  if (cuts.length !== 2 || soles.length !== 2 || new Set(cuts.map(side)).size !== 2)
    throw new Error(`the legs cut into ${cuts.length} loops and the feet ${soles.length}`);
  const T = [...legs, ...feet];
  const seams = cuts.map((cut) => sew(cut, soles.find((sole) => side(sole) === side(cut)), P, T));
  // The cut was made across flat triangles; the skin either side of it
  // follows the curve they stand for.
  for (const v of seams.flatMap((seam) => seam.ring)) {
    const hit = skin.nearest([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], 0.002);
    if (hit) P.splice(v * 3, 3, ...hit.point);
  }
  const turned = rounder(T, P);

  const number = new Int32Array(P.length / 3).fill(-1);
  for (const v of T) number[v] = 0;
  const out = [];
  const outFrom = [];
  for (let v = 0; v < number.length; v += 1)
    if (number[v] === 0) {
      number[v] = out.length / 3;
      out.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      outFrom.push(zoneOf[v]);
    }
  return {
    positions: Float64Array.from(out),
    triangles: Uint32Array.from(T, (v) => number[v]),
    count: out.length / 3,
    from: outFrom,
    report: {
      dropped: number.subarray(0, count).filter((v) => v < 0).length,
      feet: number.subarray(leg, cut).filter((v) => v >= 0).length,
      faired: faired.points,
      fairedBy: faired.most,
      seam: seams.reduce((sum, seam) => sum + seam.points, 0),
      eased: most,
      moved: Math.max(...seams.map((seam) => seam.moved)),
      turned,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

/**
 * Move every trim fitted to the MakeHuman body onto the fine one: each card
 * vertex by the inverse-distance mean of how far its eight nearest MakeHuman
 * skin points are from the fine surface.
 */
function hair(type, body, surface, normalise) {
  const fitted = readCards(readFileSync(join(models, "hair", `cards-${type}.bin`)));
  // The MakeHuman skin, welded, and each point's way onto the fine surface.
  const seen = new Map();
  const points = [];
  const bodyNormals = body.normals;
  for (let v = 0; v < body.positions.length / 3; v += 1) {
    const key = [0, 1, 2].map((c) => Math.round(body.positions[v * 3 + c] * 1e5)).join(",");
    if (seen.has(key)) continue;
    seen.set(key, points.length);
    points.push({ p: [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]], n: [bodyNormals[v * 3], bodyNormals[v * 3 + 1], bodyNormals[v * 3 + 2]] });
  }
  for (const point of points) {
    const hit = surface.nearest(point.p, 0.02, (t) => dot(surface.normal(t), point.n) > 0.3);
    point.shift = hit ? sub(hit.point, point.p) : null;
  }
  const usable = points.filter((point) => point.shift);

  const arrays = {};
  const trims = {};
  for (const [trim, count] of Object.entries(fitted.meta.trims)) {
    const quantised = fitted.arrays[`${trim}.positions`];
    const positions = new Int16Array(count * 3);
    for (let v = 0; v < count; v += 1) {
      const q = [0, 1, 2].map((axis) => CARD_BOX.min[axis] + ((quantised[v * 3 + axis] + 32767) / 65534) * (CARD_BOX.max[axis] - CARD_BOX.min[axis]));
      const nearest = [];
      for (const point of usable) {
        const d = (point.p[0] - q[0]) ** 2 + (point.p[1] - q[1]) ** 2 + (point.p[2] - q[2]) ** 2;
        if (nearest.length < 8 || d < nearest[nearest.length - 1][0]) {
          nearest.push([d, point]);
          nearest.sort((a, b) => a[0] - b[0]);
          if (nearest.length > 8) nearest.pop();
        }
      }
      const shift = [0, 0, 0];
      let total = 0;
      for (const [d, point] of nearest) {
        const w = 1 / (d + 1e-8);
        total += w;
        for (let c = 0; c < 3; c += 1) shift[c] += w * point.shift[c];
      }
      const p = normalise(add(q, scale(shift, 1 / total)));
      for (let axis = 0; axis < 3; axis += 1) {
        const t = (p[axis] - CARD_BOX.min[axis]) / (CARD_BOX.max[axis] - CARD_BOX.min[axis]);
        if (!(t >= 0 && t <= 1)) throw new Error(`${trim} leaves CARD_BOX on axis ${axis}`);
        positions[v * 3 + axis] = Math.round(t * 65534 - 32767);
      }
    }
    arrays[`${trim}.positions`] = positions;
    trims[trim] = count;
  }
  return { file: packCards({ body: `${type}${SUFFIX}`, trims }, arrays), report: { anchored: usable.length, of: points.length } };
}

/**
 * How far MHR's surface stands off the MakeHuman body, part by part: the
 * median and the 90th percentile, in millimetres on a body of MHR's height.
 */
function residuals(mhr, owner, positions, grid) {
  const parts = {
    head: /^head$/,
    neck: /^neck/,
    trunk: /^(pelvis|spine)/,
    arms: /^(clavicle|upperarm|lowerarm)/,
    hands: /^(hand|index|middle|ring|pinky|thumb)/,
    legs: /^(thigh|calf)/,
    feet: /^(foot|ball)/,
  };
  const lists = Object.fromEntries(Object.keys(parts).map((part) => [part, []]));
  for (let v = 0; v < mhr.count; v += 7) {
    const name = RIG[owner[v]].name;
    const part = Object.keys(parts).find((key) => parts[key].test(name));
    const hit = grid.nearest([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], 0.1);
    lists[part].push(hit ? hit.distance * mhr.stature * 1000 : 100);
  }
  return Object.entries(lists)
    .map(([part, list]) => {
      list.sort((a, b) => a - b);
      return `${part} ${list[list.length >> 1].toFixed(1)}/${list[Math.floor(list.length * 0.9)].toFixed(1)}`;
    })
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* The file                                                            */
/* ------------------------------------------------------------------ */

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * The MakeHuman body's own file with its skin swapped for the fine one.
 *
 * Everything else is kept byte for byte - the skeleton, its inverse binds, the
 * eye proxy, the materials - so `buildHumanTemplate` finds every joint where
 * it found it on the MakeHuman body, the proxy is the one it knows how to
 * colour, and the skin's joint numbers mean what they meant. `mesh` is in the
 * template's frame and goes back into the file's: Z up, facing -Y, in its
 * units, feet where its feet were. `cutHeights` goes on the skin's mesh as it
 * is, in unit stature: the joints being where they were says the stature is
 * too.
 */
function writeGLB(file, type, mesh, cutHeights) {
  const gltf = parseGLB(readFileSync(join(models, `realistic-${type}.glb`)));
  const { json: source, bin } = gltf;
  const [primitive, ...others] = source.meshes[0].primitives;
  if (others.length || primitive.targets || source.animations) throw new Error(`realistic-${type}.glb is not laid out as expected`);
  const raw = readAccessor(gltf, primitive.attributes.POSITION);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 2; i < raw.length; i += 3) {
    low = Math.min(low, raw[i]);
    high = Math.max(high, raw[i]);
  }
  const H = high - low;

  const json = structuredClone(source);
  json.asset = {
    ...json.asset,
    generator: "PoseForge make-fine-bodies.mjs",
    copyright: "Surface: Meta Platforms, Inc. and affiliates, MHR (Apache-2.0). Skeleton, eyes and skin: MakeHuman (CC0).",
  };
  json.accessors = [];
  json.bufferViews = [];
  const chunks = [];
  let length = 0;
  const view = (data, from) => {
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.byteLength, ...from });
    chunks.push(data);
    length += data.byteLength;
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      length += pad;
    }
    return json.bufferViews.length - 1;
  };
  const store = (array, type, componentType, target, extra = {}) => {
    const bufferView = view(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), { target });
    json.accessors.push({ bufferView, componentType, count: array.length / COMPONENTS[type], type, ...extra });
    return json.accessors.length - 1;
  };
  // One of the file's own accessors, with the bytes it reads.
  const kept = new Map();
  const keep = (index) => {
    if (!kept.has(index)) {
      const accessor = source.accessors[index];
      const { byteOffset = 0, byteLength, byteStride, target } = source.bufferViews[accessor.bufferView];
      const bufferView = view(new Uint8Array(bin.buffer, bin.byteOffset + byteOffset, byteLength), { byteStride, target });
      json.accessors.push({ ...accessor, bufferView });
      kept.set(index, json.accessors.length - 1);
    }
    return kept.get(index);
  };

  const position = new Float32Array(mesh.positions.length);
  const normal = new Float32Array(mesh.normals.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
    position.set([x * H, -z * H, y * H + low], i);
    normal.set([mesh.normals[i], -mesh.normals[i + 2], mesh.normals[i + 1]], i);
    for (let c = 0; c < 3; c += 1) {
      min[c] = Math.min(min[c], position[i + c]);
      max[c] = Math.max(max[c], position[i + c]);
    }
  }
  json.meshes[0].extras = { ...json.meshes[0].extras, cutHeights };
  json.meshes[0].primitives[0] = {
    ...primitive,
    attributes: {
      POSITION: store(position, "VEC3", 5126, 34962, { min, max }),
      NORMAL: store(normal, "VEC3", 5126, 34962),
      TEXCOORD_0: store(mesh.uvs, "VEC2", 5126, 34962),
      JOINTS_0: store(mesh.joints, "VEC4", 5123, 34962),
      WEIGHTS_0: store(mesh.weights, "VEC4", 5126, 34962),
    },
    indices: store(mesh.indices, "SCALAR", 5125, 34963),
  };
  for (const other of json.meshes.slice(1))
    for (const p of other.primitives) {
      p.attributes = Object.fromEntries(Object.entries(p.attributes).map(([name, index]) => [name, keep(index)]));
      if (p.indices !== undefined) p.indices = keep(p.indices);
    }
  for (const skin of json.skins) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = keep(skin.inverseBindMatrices);
  json.buffers = [{ byteLength: length }];

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = text.length + ((4 - (text.length % 4)) % 4);
  const total = 12 + 8 + jsonLength + 8 + length;
  const bytes = new Uint8Array(total);
  const out = new DataView(bytes.buffer);
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  out.setUint32(12, jsonLength, true);
  out.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  bytes.fill(0x20, 20 + text.length, 20 + jsonLength);
  out.setUint32(20 + jsonLength, length, true);
  out.setUint32(24 + jsonLength, 0x004e4942, true);
  let at = 28 + jsonLength;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  writeFileSync(file, bytes);
  return bytes;
}

/* ------------------------------------------------------------------ */
/* One body                                                            */
/* ------------------------------------------------------------------ */

export function loadMHR() {
  const mhr = readMHR(source());
  const rig = mergeWeights(mhr);
  const owner = dominant(rig, mhr.count);
  const heads = RIG.map((joint) => {
    const head = mhr.heads.get(joint.bone);
    if (!head) throw new Error(`MHR has no bone ${joint.bone}`);
    return head;
  });
  return { mhr, rig, owner, heads, caps: eyeCaps(mhr) };
}

/** MHR posed and shaped onto one MakeHuman body, before anything is conformed. */
export function fitBody(type, { mhr, rig, heads }) {
  const { template, body, proxy } = readMakeHuman(type);
  const targets = new Map(template.joints.map((joint) => [joint.name, joint.rest.slice(12, 15)]));
  for (const joint of RIG) if (!targets.has(joint.name)) throw new Error(`realistic-${type}.glb has no joint ${joint.name}`);
  const grid = new TriangleGrid(body.positions, body.indices, 0.01);
  const zones = triangleZones(template, body);
  // Twice: the arms are laid on MakeHuman's joints less the translation the
  // fit finds, and that is found with them laid.
  let [skinning, fit, shift] = [null, null, [0, 0, 0]];
  for (let pass = 0; pass < 2; pass += 1) {
    skinning = blend(rig, heads, pose(heads, targets, shift), mhr.count);
    fit = fitShape(mhr, rig, skinning, grid, zones);
    shift = fit.translation;
  }
  const positions = shaped(mhr, skinning, fit.coefficients, fit.translation);
  return { template, body, proxy, grid, zones, skinning, fit, positions };
}

/**
 * MHR's surface standing in for one MakeHuman body, in that body's frame:
 * fitted, its face bent onto MakeHuman's landmarks, conformed, bent again for
 * whatever conforming moved, stood exactly as tall, kept off the eyeballs,
 * with its eyes opened into pockets for them, and on MakeHuman's feet. `cut`
 * is the surface before the feet, and `whole` after.
 */
export function fineBody(type, loaded) {
  const { mhr, rig, owner, caps } = loaded;
  const fitted = fitBody(type, loaded);
  const { body, proxy, grid, zones, positions } = fitted;
  const eyes = proxyEyes(proxy);
  const marks = landmarks(body, proxy, eyes, positions, mhr.triangles, caps);
  const share = headShare(rig, mhr.count);
  const first = warp(positions, mhr.triangles, mhr.count, marks, share);
  const moved = conform(positions, mhr.triangles, mhr.count, rig, grid, zones, owner, marks.ears);
  const second = warp(positions, mhr.triangles, mhr.count, marks, share);
  // Exactly the MakeHuman body's height, feet at zero, so that written in its
  // frame the joints normalise to the same places (see `buildHumanTemplate`).
  let low = Infinity;
  let high = -Infinity;
  for (let v = 0; v < mhr.count; v += 1) {
    low = Math.min(low, positions[v * 3 + 1]);
    high = Math.max(high, positions[v * 3 + 1]);
  }
  for (let v = 0; v < mhr.count; v += 1) positions.set(scale(sub([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], [0, low, 0]), 1 / (high - low)), v * 3);
  const cleared = clearEyes(positions, mhr.count, proxy, eyes);
  const cut = pockets(positions, mhr.triangles, mhr.count, caps, eyes);
  // The pockets are the head's.
  const head = zone("head");
  const from = Array.from({ length: cut.count }, (_, v) => (v < mhr.count ? zone(RIG[owner[v]].name) : head));
  const whole = graft(cut.positions, cut.triangles, cut.count, body, zones, from);
  return { ...fitted, eyes, marks, first, second, moved, stretch: high - low, cleared, cut, whole };
}

export { readMakeHuman, TriangleGrid, vertexNormals, graft, paint, openLoops, writeGLB, sphere, cast, RIG, RIG_INDEX, zone, allows, triangleZones, residuals, conform, heightMap, landmarks, proxyEyes, onSurface, opened, earLandmarks };

if (import.meta.url === `file://${process.argv[1]}`) main();

function main() {
  for (const type of types) if (!TYPES.includes(type)) throw new Error(`no body type "${type}"`);
  const loaded = loadMHR();
  const { mhr, owner } = loaded;
  mkdirSync(join(out, "hair"), { recursive: true });
  for (const type of types) {
    const started = Date.now();
    const fine = fineBody(type, loaded);
    const { template, body, grid, zones, fit, cut, whole } = fine;
    const skin = paint(whole.positions, whole.triangles, whole.count, grid, body, zones, whole.from);
    const name = `${type}${SUFFIX}`;
    const bytes = writeGLB(join(out, `realistic-${name}.glb`), type, {
      positions: skin.positions,
      normals: skin.normals,
      uvs: skin.uvs,
      joints: skin.joints,
      weights: skin.weights,
      indices: skin.indices,
    }, measureCutHeights(featureRelief(template, { bodyType: type })));

    // Read back the way the app reads it: the MakeHuman body's joints, where
    // they were on it.
    const check = buildHumanTemplate(bytes);
    const missing = Object.keys(JOINT_MAP).filter((joint) => !check.joints.some((j) => j.name === joint));
    if (missing.length) throw new Error(`${name} lost joints ${missing.join(", ")}`);
    const drift = Math.max(...check.joints.map((joint, j) => Math.hypot(...[12, 13, 14].map((k) => joint.rest[k] - template.joints[j].rest[k]))));
    if (!(drift < 1e-6)) throw new Error(`${name}'s joints are ${drift} from the MakeHuman body's`);
    const curled = check.joints.filter((joint) => joint.curl).length;
    if (curled !== template.joints.filter((joint) => joint.curl).length) throw new Error(`${name} has ${curled} finger joints with a curl axis`);
    if (!check.cutHeights) throw new Error(`${name} lost the heights its clothes are cut at`);

    const cards = hair(type, body, new TriangleGrid(whole.positions, whole.triangles, 0.005), (p) => p);
    writeFileSync(join(out, "hair", `cards-${name}.bin`), cards.file);

    const mm = (x) => (x * 1700).toFixed(1);
    const parts = check.submeshes.map((submesh) => `${submesh.name} ${submesh.positions.length / 3}`);
    console.log(
      `${name}: ${check.submeshes[0].indices.length / 3} triangles; ${parts.join(", ")}\n` +
        `  fit rms ${(fit.report.rms * 1700).toFixed(2)}mm over ${fit.report.paired}/${fit.report.samples} samples\n` +
        `  landmarks ${mm(fine.first.mean)}mm (worst ${mm(fine.first.worst)}) before, ${mm(fine.second.mean)}mm (worst ${mm(fine.second.worst)}) after conforming ` +
        `${fine.moved.map(mm).join(", ")}mm; stood ${fine.stretch.toFixed(4)} tall\n` +
        `  off the MakeHuman body, median/90th in mm: ${residuals(mhr, owner, cut.positions, grid)}\n` +
        `  eyes: ${fine.cleared.moved} lid vertices moved clear, pockets ${fine.cut.report.map((e) => `${e.side} ${e.rim}`).join(", ")} edges round\n` +
        `  feet: ${whole.report.dropped} of MHR's vertices dropped for MakeHuman's ${whole.report.feet}, ${whole.report.faired} faired by up to ${mm(whole.report.fairedBy)}mm, ` +
        `sewn along ${whole.report.seam} points, ${whole.report.turned} edges turned, eased up to ${mm(whole.report.eased)}mm and ${mm(whole.report.moved)}mm at the seam\n` +
        `  skin: ${skin.report.far} vertices over 1cm from the MakeHuman surface, ${skin.report.split} seam triangles, ${skin.report.cut} of them cut, ${skin.report.added} vertices added\n` +
        `  hair: ${cards.report.anchored}/${cards.report.of} skin points anchored; ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
  }
}
