/**
 * The room's pictures, drawn in code: its floorboards, the rug, the picture on
 * the wall, the view through the window and a lamp's pool of light (see
 * `room.js`, which lays them on the room).
 *
 * Bytes, and nothing but arithmetic on seeded noise, so they are made the same
 * wherever they are made - on a worker, as the page starts (see `tiles.js`),
 * or here. Colours come already worked out, as the channels three would store.
 */

import { normals, roughnessData } from "./fabric.js";

/** A seeded generator in [0, 1). */
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice that wraps every `period` cells, a power of two. */
function valueNoise(random, period) {
  const lattice = Float32Array.from({ length: period * period }, random);
  const mask = period - 1;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = i & mask;
    const i1 = (i + 1) & mask;
    const j0 = (j & mask) * period;
    const j1 = ((j + 1) & mask) * period;
    const top = lattice[j0 + i0] + (lattice[j0 + i1] - lattice[j0 + i0]) * sx;
    const bottom = lattice[j1 + i0] + (lattice[j1 + i1] - lattice[j1 + i0]) * sx;
    return top + (bottom - top) * sy;
  };
}

// A Uint8Array rounds and clamps what it is given only by truncating and
// wrapping, so the bytes are made here.
const toByte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/**
 * Floorboards: rows of planks 18 cm wide, each a slightly different tone,
 * butted end to end at staggered joints, with a grain that wanders along the
 * plank and a dark hairline where two meet. One tile is 1.44 m square - eight
 * rows - so the repeat is longer than anything standing on it.
 *
 * And the relief to go with it, which is most of what separates a floor from a
 * photograph of one laid on the ground: each board's edge is eased, so the
 * joint is a groove that catches a line of light along one side; no board lies
 * quite flat with its neighbours, so each takes the window a little
 * differently; the late wood of the grain is sunk a little under the early; and
 * the varnish is duller in the joints, where the dust is, and along the grain.
 */
export function floorTile(look) {
  const size = 1024;
  const rows = 8;
  const random = seeded(0xf100 + Math.round(look.base[0] * 100));
  const grain = valueNoise(seeded(0x6a1), 64);
  const fleck = valueNoise(seeded(0x6a2), 256);
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const gloss = new Float32Array(size * size);
  const rowHeight = size / rows;
  const planks = [];
  for (let r = 0; r < rows; r += 1) {
    // Each row starts where the tile's own repeat can pick it up again, so
    // the joints stagger inside a row and still tile across the edge.
    const joints = [Math.floor(random() * size)];
    joints.push((joints[0] + Math.floor(size * (0.42 + 0.2 * random()))) % size);
    const tilts = [random() - 0.5, random() - 0.5];
    planks.push({ joints: joints.sort((a, b) => a - b), tones: [random(), random()], phase: random() * 40, tilts });
  }
  const [red, green, blue] = look.base;
  for (let y = 0; y < size; y += 1) {
    const r = Math.floor(y / rowHeight);
    const across = (y % rowHeight) / rowHeight;
    const { joints, tones, phase, tilts } = planks[r];
    const edgeY = Math.min(y % rowHeight, rowHeight - 1 - (y % rowHeight));
    for (let x = 0; x < size; x += 1) {
      const which = x >= joints[0] && x < joints[1] ? 0 : 1;
      const tone = (tones[which] - 0.5) * 2 * look.spread;
      const wander = grain(x / 64, (y + phase) / 9) * 3;
      const ring = Math.sin((across * 11 + wander + which * 3.1) * Math.PI);
      const figure = 0.06 * ring * ring + 0.05 * grain(x / 20, y / 3);
      const speck = 0.03 * (fleck(x / 2.5, y / 2.5) - 0.5);
      const edgeX = Math.min(Math.abs(x - joints[0]), Math.abs(x - joints[1]));
      const seam = edgeY < 1.5 || edgeX < 1.2 ? 0.55 : edgeY < 3 || edgeX < 2.5 ? 0.85 : 1;
      const shade = (1 + tone - figure + speck) * seam;
      const o = (y * size + x) * 4;
      data[o] = toByte(red * shade);
      data[o + 1] = toByte(green * shade);
      data[o + 2] = toByte(blue * shade);
      data[o + 3] = 255;
      // The eased edge over the last three texels - about four millimetres -
      // of every board, and the board's own lean across its width.
      const edge = Math.min(edgeY, edgeX);
      const ease = edge < 3 ? (1 - edge / 3) ** 2 : 0;
      const k = y * size + x;
      height[k] = -1.6 * ease + tilts[which] * 0.015 * (across - 0.5) * rowHeight - 1.2 * figure;
      gloss[k] = 0.9 + 1.6 * figure + 0.5 * ease + 0.8 * Math.max(0, tone);
    }
  }
  const relief = roughnessData(size, () => 1, (k) => gloss[k]);
  return { size, map: data, normal: normals(height, size, 1), roughness: relief };
}

/**
 * A flat-woven rug: a plain field, a border band inside a margin, a fine line
 * either side of the band, and the fibre's noise over all of it. Drawn once
 * across the whole rug, not tiled, so the border goes round the edge.
 */
export function rugTile([field, border, line]) {
  const size = 512;
  const fibre = valueNoise(seeded(0x7a9), 128);
  const weave = valueNoise(seeded(0x7aa), 256);
  // A lattice of faint diamonds in the field, the way a kilim's is.
  const diamond = field.map((c, i) => c * 0.8 + border[i] * 0.2);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const edge = Math.min(u, 1 - u, v, 1 - v);
      let colour = field;
      if (edge > 0.035 && edge < 0.1) colour = border;
      if (Math.abs(edge - 0.035) < 0.006 || Math.abs(edge - 0.1) < 0.006 || Math.abs(edge - 0.14) < 0.004) colour = line;
      if (edge >= 0.14) {
        const d = Math.abs(((u * 9) % 1) - 0.5) + Math.abs(((v * 6) % 1) - 0.5);
        if (Math.abs(d - 0.36) < 0.025) colour = diamond;
      }
      const shade = 1 + 0.07 * (fibre(x / 3, y / 3) - 0.5) + 0.05 * (weave(x, y / 2) - 0.5);
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i += 1) data[o + i] = toByte(colour[i] * shade);
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/**
 * A quiet abstract for the frame: overlapping soft discs and bands, in the
 * first of `colours` and over it the rest, placed as `seed` - the first as a
 * number - has them.
 */
export function artTile(colours, seed) {
  const w = 256;
  const h = 320;
  const random = seeded(0xa27 + seed);
  const shapes = Array.from({ length: 6 }, (_, i) => ({
    x: random(),
    y: random(),
    r: 0.18 + random() * 0.28,
    c: colours[(i % (colours.length - 1)) + 1],
  }));
  const canvas = valueNoise(seeded(0xa28), 64);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const v = y / h;
      let [r, g, b] = colours[0];
      for (const s of shapes) {
        const d = Math.hypot(u - s.x, (v - s.y) * (h / w)) / s.r;
        const cover = Math.max(0, Math.min(1, (1 - d) * 6)) * 0.85;
        r += (s.c[0] - r) * cover;
        g += (s.c[1] - g) * cover;
        b += (s.c[2] - b) * cover;
      }
      const shade = 1 + 0.06 * (canvas(x / 2, y / 2) - 0.5);
      const o = (y * w + x) * 4;
      data[o] = toByte(r * shade);
      data[o + 1] = toByte(g * shade);
      data[o + 2] = toByte(b * shade);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * Daylight through the glass: pale sky, and the tops of trees across the way
 * against it. Out of focus - the eye is on the room - and washed out, the way
 * a view is from indoors when the room is what the exposure is set for; but a
 * window onto nothing at all, a sheet of blue, read as a panel painted blue.
 */
export function skyTile() {
  const w = 128;
  const h = 160;
  const crowns = valueNoise(seeded(0x5c1), 16);
  const clumps = valueNoise(seeded(0x5c2), 32);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const v = y / (h - 1);
    const sky = [0.8 + 0.18 * v, 0.88 + 0.1 * v, 0.97];
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      // The line of the treetops, and how deep into the leaves a point is.
      const line = 0.28 + 0.16 * crowns(u * 5, 0.5) + 0.05 * crowns(u * 16, 3.5);
      const inside = Math.min(1, Math.max(0, (line - v) / 0.035));
      const leaf = clumps(u * 12, v * 14);
      const foliage = [0.58 + 0.1 * leaf, 0.66 + 0.08 * leaf, 0.56 + 0.06 * leaf].map((c) => c - 0.12 * (1 - v / line));
      const o = (y * w + x) * 4;
      for (let i = 0; i < 3; i += 1) data[o + i] = toByte(sky[i] + (foliage[i] - sky[i]) * inside);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A soft round falloff, for the pool of light a lamp throws on a wall. */
export function glowTile() {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const d = Math.hypot(x / (n - 1) - 0.5, y / (n - 1) - 0.5) * 2;
      const a = Math.max(0, 1 - d) ** 2.2;
      const o = (y * n + x) * 4;
      data[o] = toByte(1);
      data[o + 1] = toByte(0.8);
      data[o + 2] = toByte(0.55);
      data[o + 3] = toByte(a);
    }
  }
  return { width: n, height: n, data };
}
